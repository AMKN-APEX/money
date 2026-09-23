import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/format";
import { ignoreEmail, parseEmails, reparseIgnored, restoreEmail, retryEmail } from "./actions";

type EmailMessage = {
  id: string;
  received_at: string;
  from_address: string | null;
  subject: string | null;
  body: string;
  status: "unparsed" | "parsed" | "ignored" | "failed";
  parser_id: string | null;
  transaction_id: string | null;
  error: string | null;
};

const STATUS_LABEL: Record<EmailMessage["status"], string> = {
  unparsed: "未解析",
  parsed: "取引を作成済み",
  ignored: "対象外",
  failed: "解析できず",
};

const STATUS_CLASS: Record<EmailMessage["status"], string> = {
  unparsed: "text-amber-400",
  parsed: "text-emerald-400",
  ignored: "text-slate-600",
  failed: "text-rose-400",
};

/** 差出人から、どのカードのメールかを推測して見せる */
function senderLabel(from: string | null): string {
  const f = (from ?? "").toLowerCase();
  if (f.includes("vpass") || f.includes("smbc-card")) return "三井住友カード";
  if (f.includes("rakuten-card")) return "楽天カード";
  if (f.includes("paypay")) return "PayPayカード";
  if (f.includes("pocketcard") || f.includes("zozo")) return "ZOZOカード";
  return from ?? "不明";
}

export default async function EmailsPage({ searchParams }: PageProps<"/emails">) {
  const params = await searchParams;
  const openId = typeof params.open === "string" ? params.open : null;
  const showIgnored = params.ignored === "1";

  const supabase = await createClient();
  let query = supabase
    .from("email_messages")
    .select("id, received_at, from_address, subject, body, status, parser_id, transaction_id, error")
    .order("received_at", { ascending: false })
    .limit(50);
  if (!showIgnored) query = query.neq("status", "ignored");

  const [{ data, error }, ignoredCount] = await Promise.all([
    query,
    supabase
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "ignored"),
  ]);

  if (error) {
    return (
      <>
        <h1 className="text-xl font-bold">メール速報</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          読み込めませんでした: {error.message}
        </p>
      </>
    );
  }

  const messages = (data ?? []) as EmailMessage[];
  const unparsed = messages.filter((m) => m.status === "unparsed").length;

  /**
   * 開閉のリンクは、対象外の表示状態を引き継がせる。
   * 引き継がないと、対象外のメールをタップした瞬間にフィルタが外れて
   * 一覧から消え、そのメールだけ永久に開けなくなる。
   */
  const listHref = showIgnored ? "/emails?ignored=1" : "/emails";
  const openHref = (id: string) => `${listHref}${showIgnored ? "&" : "?"}open=${id}`;

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">メール速報</h1>
        {(ignoredCount.count ?? 0) > 0 && (
          <Link
            href={showIgnored ? "/emails" : "/emails?ignored=1"}
            className="text-xs text-slate-400"
          >
            {showIgnored ? "対象外を隠す" : `対象外 ${ignoredCount.count} 件を表示`}
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-400">カード会社から届いた利用通知メール</p>

      {/*
        解析の操作は、一覧が空でも必ず出す。
        既定で対象外を隠しているため、全部を対象外にすると一覧は0件になる。
        「メールが無い」のではなく「隠れている」だけなのに、そこでボタンまで
        消えると手の打ちようが無くなる。
      */}
      <div
        className={`mt-4 rounded-xl border p-4 text-sm ${
          unparsed > 0
            ? "border-amber-900 bg-amber-950/40 text-amber-300"
            : "border-slate-800 bg-slate-900/60 text-slate-400"
        }`}
      >
        <p>
          {unparsed > 0
            ? `未解析のメールが ${unparsed} 件あります。受信時に自動で解析されますが、パーサーを直したあとはここからやり直せます。`
            : "未解析のメールはありません。"}
        </p>
        <form action={parseEmails}>
          <button
            type="submit"
            className={`mt-3 w-full rounded-lg border py-2.5 text-xs ${
              unparsed > 0 ? "border-amber-700 text-amber-200" : "border-slate-700 text-slate-300"
            }`}
          >
            いま解析する
          </button>
        </form>
        {(ignoredCount.count ?? 0) > 0 && (
          <form action={reparseIgnored}>
            <button
              type="submit"
              className="mt-2 w-full rounded-lg border border-slate-700 py-2.5 text-xs text-slate-300"
            >
              対象外の {ignoredCount.count} 件も解析し直す
            </button>
          </form>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          <p>
            {(ignoredCount.count ?? 0) > 0
              ? "表示できるメールがありません（対象外にしたものは隠れています）。"
              : "表示できるメールがありません。"}
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-4 text-xs text-slate-500">
            <li>各カードのサイトで利用通知メールが有効になっているか</li>
            <li>Google Apps Script のトリガーが動いているか</li>
            <li>GAS の差出人リストに、実際の差出人ドメインが入っているか</li>
          </ul>
        </div>
      ) : (
        <>

          <ul className="mt-5 flex flex-col gap-2">
            {messages.map((m) => {
              const open = openId === m.id;
              return (
                <li
                  key={m.id}
                  className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60"
                >
                  <Link
                    href={open ? listHref : openHref(m.id)}
                    className="block px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {senderLabel(m.from_address)}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                        {shortDate(m.received_at.slice(0, 10))}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {m.subject ?? "(件名なし)"}
                    </p>
                    <p className={`mt-1 text-xs ${STATUS_CLASS[m.status]}`}>
                      {STATUS_LABEL[m.status]}
                      {m.parser_id && `・${m.parser_id}`}
                      {m.error && `・${m.error}`}
                    </p>
                  </Link>

                  {open && (
                    <>
                      <pre className="max-h-96 overflow-auto border-t border-slate-800 bg-slate-950/70 p-4 text-xs whitespace-pre-wrap text-slate-300">
                        {m.body}
                      </pre>
                      <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
                        {m.status === "parsed" && m.transaction_id && (
                          <Link
                            href={`/transactions/${m.transaction_id}`}
                            className="rounded-lg border border-emerald-800 py-2.5 text-center text-xs text-emerald-300"
                          >
                            作成された取引を開く
                          </Link>
                        )}
                        {m.status === "failed" && (
                          <form action={retryEmail}>
                            <input type="hidden" name="id" value={m.id} />
                            <button
                              type="submit"
                              className="w-full rounded-lg border border-slate-700 py-2.5 text-xs text-slate-300"
                            >
                              もう一度解析する
                            </button>
                          </form>
                        )}
                        <form action={m.status === "ignored" ? restoreEmail : ignoreEmail}>
                          <input type="hidden" name="id" value={m.id} />
                          <button
                            type="submit"
                            className="w-full rounded-lg border border-slate-700 py-2.5 text-xs text-slate-300"
                          >
                            {m.status === "ignored" ? "未解析に戻す" : "対象外にする"}
                          </button>
                        </form>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
