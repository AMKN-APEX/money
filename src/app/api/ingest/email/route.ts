import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

/**
 * Gmail から転送されたカード利用通知メールの受け口。
 * 設計: docs/design.md 3章。
 *
 * GAS はログイン状態を持てないため、RLS を通せない。ここだけ Supabase の
 * secret key を使い、共有シークレットのヘッダーで入口を守る。
 * 解析はここではやらない。まず保存だけして、パーサーは後から適用する。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 50;
const MAX_BODY_CHARS = 100_000;

type IncomingMessage = {
  gmailId?: unknown;
  receivedAt?: unknown;
  from?: unknown;
  subject?: unknown;
  body?: unknown;
};

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // 長さが違うと timingSafeEqual が例外を投げるので先に弾く
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "INGEST_SECRET が未設定です" }, { status: 500 });
  }
  if (!secretMatches(request.headers.get("x-ingest-secret"), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = admin();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SECRET_KEY が未設定です" }, { status: 500 });
  }

  let payload: { messages?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON として読めません" }, { status: 400 });
  }

  const incoming = Array.isArray(payload.messages) ? (payload.messages as IncomingMessage[]) : null;
  if (!incoming) {
    return NextResponse.json({ error: "messages が配列ではありません" }, { status: 400 });
  }
  if (incoming.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `一度に送れるのは ${MAX_MESSAGES} 件までです` },
      { status: 413 },
    );
  }

  // 利用者は1名。最初のユーザーを所有者にする
  const { data: users, error: userError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (userError || !users?.users.length) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 500 });
  }
  const userId = users.users[0].id;

  const rows = [];
  const rejected: string[] = [];

  for (const m of incoming) {
    const gmailId = typeof m.gmailId === "string" ? m.gmailId.trim() : "";
    const body = typeof m.body === "string" ? m.body : "";
    const receivedAt = typeof m.receivedAt === "string" ? m.receivedAt : "";

    if (!gmailId || !body || !receivedAt || Number.isNaN(Date.parse(receivedAt))) {
      rejected.push(gmailId || "(gmailId なし)");
      continue;
    }

    rows.push({
      user_id: userId,
      gmail_id: gmailId,
      received_at: new Date(receivedAt).toISOString(),
      from_address: typeof m.from === "string" ? m.from.slice(0, 500) : null,
      subject: typeof m.subject === "string" ? m.subject.slice(0, 1000) : null,
      body: body.slice(0, MAX_BODY_CHARS),
      status: "unparsed" as const,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ received: incoming.length, inserted: 0, rejected });
  }

  // 同じ Gmail メッセージが再送されても増えない
  const { data, error } = await supabase
    .from("email_messages")
    .upsert(rows, { onConflict: "user_id,gmail_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const inserted = data?.length ?? 0;
  return NextResponse.json({
    received: incoming.length,
    inserted,
    duplicates: rows.length - inserted,
    rejected,
  });
}
