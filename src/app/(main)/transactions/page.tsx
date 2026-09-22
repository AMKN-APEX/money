import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadMasters } from "@/lib/queries";
import { isYearMonth, monthRange, shortDate, todayJst, yen } from "@/lib/format";
import type { Transaction } from "@/lib/types";

const TX_COLUMNS =
  "id, date, amount, type, account_id, to_account_id, category_id, merchant, channel, memo, source, status";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const raw = typeof params.month === "string" ? params.month : "";
  const month = monthRange(isYearMonth(raw) ? raw : todayJst().slice(0, 7));

  const supabase = await createClient();
  const [txRes, masters] = await Promise.all([
    supabase
      .from("transactions")
      .select(TX_COLUMNS)
      .gte("date", month.from)
      .lte("date", month.to)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
    loadMasters(),
  ]);

  if (txRes.error) {
    return (
      <p className="rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
        読み込めませんでした: {txRes.error.message}
      </p>
    );
  }

  const transactions = (txRes.data ?? []) as unknown as Transaction[];
  const accountName = new Map(masters.accounts.map((a) => [a.id, a.name]));
  const category = new Map(masters.categories.map((c) => [c.id, c]));

  // 9.6: 特別支出・経費精算は通常の月次収支から外す
  const normal = transactions.filter((t) => {
    const c = t.category_id ? category.get(t.category_id) : null;
    return !c?.is_extraordinary;
  });
  const total = (type: Transaction["type"]) =>
    normal.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
  const income = total("income");
  const expense = total("expense");

  // 日付ごとにまとめる
  const byDate = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const list = byDate.get(t.date) ?? [];
    list.push(t);
    byDate.set(t.date, list);
  }

  return (
    <>
      {/* 月の切り替え */}
      <div className="flex items-center justify-between">
        <Link
          href={`/transactions?month=${month.prev}`}
          aria-label="前の月"
          className="rounded-lg px-3 py-2 text-slate-400"
        >
          ←
        </Link>
        <h1 className="text-lg font-bold">{month.label}</h1>
        <Link
          href={`/transactions?month=${month.next}`}
          aria-label="次の月"
          className="rounded-lg px-3 py-2 text-slate-400"
        >
          →
        </Link>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-slate-900/60 p-2.5">
          <dt className="text-xs text-slate-500">収入</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-emerald-400">{yen(income)}</dd>
        </div>
        <div className="rounded-xl bg-slate-900/60 p-2.5">
          <dt className="text-xs text-slate-500">支出</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-rose-400">{yen(expense)}</dd>
        </div>
        <div className="rounded-xl bg-slate-900/60 p-2.5">
          <dt className="text-xs text-slate-500">収支</dt>
          <dd
            className={`mt-0.5 font-semibold tabular-nums ${
              income - expense < 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {yen(income - expense)}
          </dd>
        </div>
      </dl>

      {transactions.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
          {month.label}の取引はまだありません
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {[...byDate.entries()].map(([date, list]) => (
            <section key={date}>
              <h2 className="mb-1.5 px-1 text-xs font-medium text-slate-500">
                {shortDate(date)}
              </h2>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
                {list.map((t) => {
                  const cat = t.category_id ? category.get(t.category_id) : null;
                  const from = accountName.get(t.account_id) ?? "?";
                  const to = t.to_account_id ? accountName.get(t.to_account_id) : null;
                  const title =
                    t.merchant ||
                    cat?.name ||
                    (t.type === "transfer" ? "振替" : "未分類");
                  return (
                    <li key={t.id}>
                      <Link
                        href={`/transactions/${t.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{title}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {t.type === "transfer" ? `${from} → ${to ?? "?"}` : from}
                            {cat && t.merchant && `・${cat.name}`}
                            {cat?.is_extraordinary && "・別枠"}
                            {t.status === "pending_review" && "・未分類"}
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
            </section>
          ))}
        </div>
      )}

      <Link
        href="/transactions/new"
        className="fixed bottom-20 right-5 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-3xl font-light text-slate-950 shadow-lg shadow-emerald-500/20"
        aria-label="取引を追加"
      >
        +
      </Link>
    </>
  );
}
