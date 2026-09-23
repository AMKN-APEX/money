import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMerchant } from "./normalize";
import { classify, type Rule } from "./rules";
import { parserFor } from "./parsers/email";
import type { ParsedUsage } from "./parsers/email";
import type { TxType } from "./types";

/**
 * 受信箱に溜まった未解析メールを解析して取引にする。
 * 設計: docs/design.md 3章 / 13章。
 *
 * 受信（api/ingest/email）と解析を分けてあるのは、文面が変わってパーサーが
 * 壊れてもメールそのものは失われないようにするため。ここは何度実行しても
 * よく、取り込み済みのメールは status で弾かれる。
 *
 * ログイン中のクライアント（RLS あり）でも、受信APIの管理クライアント
 * （RLS なし）でも動かせるよう、user_id は必ず明示して渡す。
 */

export type EmailApplyResult = {
  /** 解析を試みたメールの数 */
  processed: number;
  /** 作成した取引 */
  created: number;
  /** 同じ取引が既にあり作らなかったもの */
  duplicated: number;
  /** 利用通知ではないので対象外にしたメール */
  ignored: number;
  /** 読めなかった・カードを特定できなかったメール */
  failed: number;
  /** 未分類トレイ行きになった取引 */
  pendingReview: number;
  /** 担当するパーサーが無い差出人（未解析のまま残す） */
  unknownSender: number;
};

type EmailRow = {
  id: string;
  gmail_id: string;
  received_at: string;
  from_address: string | null;
  body: string;
};

type AccountRow = { id: string; name: string; email_card_pattern: string | null };

const EMPTY: EmailApplyResult = {
  processed: 0,
  created: 0,
  duplicated: 0,
  ignored: 0,
  failed: 0,
  pendingReview: 0,
  unknownSender: 0,
};

export async function applyEmailParsers(
  supabase: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<EmailApplyResult> {
  const { data: emailRows } = await supabase
    .from("email_messages")
    .select("id, gmail_id, received_at, from_address, body")
    .eq("user_id", userId)
    .eq("status", "unparsed")
    .order("received_at", { ascending: true })
    .limit(limit);

  const emails = (emailRows ?? []) as EmailRow[];
  if (emails.length === 0) return { ...EMPTY };

  const [{ data: accountRows }, { data: ruleRows }] = await Promise.all([
    supabase.from("accounts").select("id, name, email_card_pattern").eq("user_id", userId),
    supabase
      .from("rules")
      .select(
        "id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id, channel, memo_template, is_active",
      )
      .eq("user_id", userId),
  ]);

  const accounts = (accountRows ?? []) as AccountRow[];
  const rules = (ruleRows ?? []) as unknown as Rule[];
  const result: EmailApplyResult = { ...EMPTY };

  for (const email of emails) {
    const parser = parserFor(email.from_address);
    if (!parser) {
      // まだパーサーを書いていないカード会社。捨てずに受信箱へ残す
      result.unknownSender++;
      continue;
    }

    result.processed++;
    const parsed = parser.parse(email.body);

    if (parsed.kind === "other") {
      await markEmail(supabase, email.id, {
        status: "ignored",
        parser_id: parser.id,
        error: "利用通知ではないと判断しました",
      });
      result.ignored++;
      continue;
    }

    if (parsed.kind === "error") {
      await markEmail(supabase, email.id, {
        status: "failed",
        parser_id: parser.id,
        error: parsed.error,
      });
      result.failed++;
      continue;
    }

    const account = resolveAccount(accounts, parsed.cardLabel);
    if (!account) {
      await markEmail(supabase, email.id, {
        status: "failed",
        parser_id: parser.id,
        error:
          `カードを特定できませんでした（本文のカード名: ${parsed.cardLabel ?? "読み取れず"}）。` +
          "口座の email_card_pattern に、このカード名に当たるパターンを登録してください。",
      });
      result.failed++;
      continue;
    }

    let firstTxId: string | null = null;
    let failure: string | null = null;

    for (const [index, usage] of parsed.usages.entries()) {
      // 1通に複数の利用が載る場合に備えて、2件目以降は連番で区別する。
      // dedup_key も source_ref も一意制約が付いているため、同じ値では入らない。
      const suffix = index === 0 ? "" : `#${index}`;
      const outcome = await saveUsage(supabase, userId, account, usage, rules, {
        emailId: email.id,
        dedupKey: `${account.id}:${usage.dedupSeed}${suffix}`,
        sourceRef: `${email.gmail_id}${suffix}`,
      });
      if (outcome.error) {
        failure = outcome.error;
        break;
      }
      if (outcome.duplicated) result.duplicated++;
      else result.created++;
      if (outcome.pendingReview) result.pendingReview++;
      firstTxId = firstTxId ?? outcome.transactionId;
    }

    if (failure) {
      await markEmail(supabase, email.id, {
        status: "failed",
        parser_id: parser.id,
        error: failure,
      });
      result.failed++;
      continue;
    }

    await markEmail(supabase, email.id, {
      status: "parsed",
      parser_id: parser.id,
      error: null,
      transaction_id: firstTxId,
    });
  }

  return result;
}

/**
 * 本文のカード名から口座を決める。
 * 一致が無ければ**推測しない**。取り込まれないほうが、違うカードに
 * 積まれるより直しやすい（9.3 と同じ考え方）。
 */
function resolveAccount(accounts: AccountRow[], cardLabel: string | null): AccountRow | null {
  if (!cardLabel) return null;
  const normalized = normalizeMerchant(cardLabel);

  return (
    accounts
      .filter((a) => a.email_card_pattern && normalized.includes(a.email_card_pattern))
      // 「ZOZOCARD」と「ZOZOCARD2」のように複数当たったら、長いほうを採る
      .sort((a, b) => (b.email_card_pattern?.length ?? 0) - (a.email_card_pattern?.length ?? 0))[0] ?? null
  );
}

type SaveOutcome = {
  transactionId: string | null;
  duplicated: boolean;
  pendingReview: boolean;
  error: string | null;
};

async function saveUsage(
  supabase: SupabaseClient,
  userId: string,
  account: AccountRow,
  usage: ParsedUsage,
  rules: Rule[],
  ref: { emailId: string; dedupKey: string; sourceRef: string },
): Promise<SaveOutcome> {
  const dedupKey = ref.dedupKey;

  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (existing) {
    return { transactionId: (existing as { id: string }).id, duplicated: true, pendingReview: false, error: null };
  }

  const cls = classify({ matchText: usage.matchText, direction: "out" }, account.id, rules);

  let type: TxType = cls.type;
  let toAccountId = cls.to_account_id;
  let memo = joinMemo(usage.memo, cls.memo);
  // 振替と分かっても相手口座が決まらないものは保留にする（CSV取込と同じ扱い）
  if (type === "transfer" && !toAccountId) {
    type = "expense";
    toAccountId = null;
    memo = joinMemo(memo, "振替の可能性あり（相手口座を特定できませんでした）");
  }

  const pendingReview = usage.needsReview || !cls.ruleId || (cls.type === "transfer" && !cls.to_account_id);

  const { data: inserted, error } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      date: usage.date,
      amount: usage.amount,
      type,
      account_id: account.id,
      to_account_id: toAccountId,
      category_id: cls.category_id,
      merchant: usage.merchant || null,
      merchant_normalized: normalizeMerchant(usage.matchText) || null,
      channel: cls.channel,
      memo,
      source: "email",
      source_ref: ref.sourceRef,
      status: pendingReview ? "pending_review" : "confirmed",
      dedup_key: dedupKey,
      email_message_id: ref.emailId,
    })
    .select("id")
    .single();

  if (error) {
    return { transactionId: null, duplicated: false, pendingReview: false, error: `取引を作れませんでした: ${error.message}` };
  }

  return {
    transactionId: (inserted as { id: string }).id,
    duplicated: false,
    pendingReview,
    error: null,
  };
}

function joinMemo(...parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(" / ") : null;
}

async function markEmail(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from("email_messages").update(patch).eq("id", id);
}
