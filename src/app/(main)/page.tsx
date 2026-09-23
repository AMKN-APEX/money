import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadImportReminders, loadMasters } from "@/lib/queries";
import { currentMonthRange, shortDate, todayJst, yen } from "@/lib/format";
import { isLiability, type Transaction } from "@/lib/types";
import { ImportReminderBanner } from "@/components/import-reminder";

const TX_COLUMNS =
  "id, date, amount, type, account_id, to_account_id, category_id, merchant, channel, memo, source, status";

const QUICK = [
  { type: "expense", label: "支出", accent: "bg-rose-500" },
  { type: "income", label: "収入", accent: "bg-emerald-500" },
  { type: "transfer", label: "振替", accent: "bg-sky-500" },
] as const;

export default async function DashboardPage() {
  const supabase = await createClient();
  const month = currentMonthRange();

  const [monthRes, recentRes, balanceRes, pendingRes, mailRes, masters, reminders] = await Promise.all([
    supabase.from("transactions").select(TX_COLUMNS).gte("date", month.from).lte("date", month.to),
    supabase
      .from("transactions")
      .select(TX_COLUMNS)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("account_balances").select("account_id, balance"),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_review"),
    // 未解析のまま残っているメール（パーサー未対応の差出人など）と、解析に失敗したもの
    supabase
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .in("status", ["unparsed", "failed"]),
    loadMasters(),
    loadImportReminders(todayJst()),
  ]);

  const error =
    monthRes.error?.message ??
    recentRes.error?.message ??
    balanceRes.error?.message ??
    masters.error;

  if (error) {
    return (
      <>
        <h1 className="text-xl font-bold">ホーム</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          データを読み込めませんでした: {error}
        </p>
      </>
    );
  }

  const category = new Map(masters.categories.map((c) => [c.id, c]));
  const accountName = new Map(masters.accounts.map((a) => [a.id, a.name]));
  const rows = (monthRes.data ?? []) as unknown as Transaction[];
  const recent = (recentRes.data ?? []) as unknown as Transaction[];
  const balances = new Map(
    ((balanceRes.data ?? []) as { account_id: string; balance: number }[]).map((b) => [
      b.account_id,
      Number(b.balance),
    ]),
  );

  // 9.6: 特別支出・経費精算は通常の月次収支から外す
  const isExtra = (t: Transaction) =>
    Boolean(t.category_id && category.get(t.category_id)?.is_extraordinary);
  const sum = (list: Transaction[], type: Transaction["type"]) =>
    list.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);

  const normal = rows.filter((t) => !isExtra(t));
  const extra = rows.filter(isExtra);
  const income = sum(normal, "income");
  const expense = sum(normal, "expense");
  const extraTotal = sum(extra, "expense") - sum(extra, "income");

  const assets = masters.accounts
    .filter((a) => !isLiability(a.type))
    .reduce((a, acc) => a + (balances.get(acc.id) ?? 0), 0);
  // カードはマイナスが未払残高。符号を反転して負債額にする
  const liabilities = masters.accounts
    .filter((a) => isLiability(a.type))
    .reduce((a, acc) => a - (balances.get(acc.id) ?? 0), 0);

  const pendingCount = pendingRes.count ?? 0;
  const mailCount = mailRes.count ?? 0;

  return (
    <>
      <h1 className="text-xl font-bold">ホーム</h1>
      <p className="mt-1 text-sm text-slate-400">{month.label}</p>

      <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">今月の収支</span>
          <span
            className={`text-3xl font-bold tabular-nums ${
              income - expense < 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {yen(income - expense)}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-slate-950/60 p-3">
            <dt className="text-slate-400">収入</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{yen(income)}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/60 p-3">
            <dt className="text-slate-400">支出</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{yen(expense)}</dd>
          </div>
        </dl>
        {extraTotal !== 0 && (
          <p className="mt-3 text-xs text-slate-500">
            別枠（特別支出・経費精算）: {yen(extraTotal)}
          </p>
        )}
      </section>

      {/* クイック追加 */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {QUICK.map((q) => (
          <Link
            key={q.type}
            href={`/transactions/new?type=${q.type}`}
            className={`rounded-xl py-3 text-center text-sm font-semibold text-slate-950 ${q.accent}`}
          >
            + {q.label}
          </Link>
        ))}
      </div>

      {pendingCount > 0 && (
        <Link
          href="/review"
          className="mt-4 block rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-300"
        >
          未分類の取引が {pendingCount} 件あります →
        </Link>
      )}

      {mailCount > 0 && (
        <Link
          href="/emails"
          className="mt-3 block rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-300"
        >
          取り込めていないメールが {mailCount} 件あります →
        </Link>
      )}

      {/* 9.4: 照会可能期間を過ぎた月の明細は二度と取れない */}
      <ImportReminderBanner reminders={reminders} />

      {/* 純資産 */}
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">純資産</span>
          <span className="text-2xl font-bold tabular-nums">{yen(assets - liabilities)}</span>
        </div>
        <dl className="mt-3 flex justify-between text-xs text-slate-500">
          <div className="flex gap-2">
            <dt>資産</dt>
            <dd className="tabular-nums text-slate-300">{yen(assets)}</dd>
          </div>
          <div className="flex gap-2">
            <dt>カード未払</dt>
            <dd className="tabular-nums text-slate-300">{yen(liabilities)}</dd>
          </div>
        </dl>
      </section>

      {/* 最近の取引 */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-400">最近の取引</h2>
          <Link href="/transactions" className="text-xs text-emerald-400">
            すべて見る
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            まだ取引がありません。上の「+ 支出」から追加できます。
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            {recent.map((t) => {
              const cat = t.category_id ? category.get(t.category_id) : null;
              const title =
                t.merchant || cat?.name || (t.type === "transfer" ? "振替" : "未分類");
              return (
                <li key={t.id}>
                  <Link
                    href={`/transactions/${t.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{title}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {shortDate(t.date)}・{accountName.get(t.account_id) ?? "?"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        t.type === "expense"
                          ? "text-rose-400"
                          : t.type === "income"
                            ? "text-emerald-400"
                            : "text-sky-400"
                      }`}
                    >
                      {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}
                      {yen(t.amount)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
