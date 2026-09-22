import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentMonthRange, yen } from "@/lib/format";
import { ACCOUNT_TYPE_LABEL, type Account } from "@/lib/types";

type MonthRow = {
  amount: number;
  type: "income" | "expense" | "transfer";
  category: { is_extraordinary: boolean } | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const month = currentMonthRange();

  const [accountsRes, monthRes, pendingRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, issuer, closing_day, payment_day, payment_account_id, is_active, sort_order, note")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("transactions")
      .select("amount, type, category:categories(is_extraordinary)")
      .gte("date", month.from)
      .lte("date", month.to),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_review"),
  ]);

  const error = accountsRes.error ?? monthRes.error ?? pendingRes.error;
  if (error) {
    return (
      <>
        <h1 className="text-xl font-bold">ホーム</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          データを読み込めませんでした: {error.message}
        </p>
      </>
    );
  }

  const accounts = (accountsRes.data ?? []) as Account[];
  const rows = (monthRes.data ?? []) as unknown as MonthRow[];

  // 9.6: 特別支出・経費精算は通常の月次収支から外す
  const normal = rows.filter((r) => !r.category?.is_extraordinary);
  const extra = rows.filter((r) => r.category?.is_extraordinary);
  const sum = (list: MonthRow[], type: MonthRow["type"]) =>
    list.filter((r) => r.type === type).reduce((a, r) => a + r.amount, 0);

  const income = sum(normal, "income");
  const expense = sum(normal, "expense");
  const extraTotal = sum(extra, "expense") - sum(extra, "income");
  const pendingCount = pendingRes.count ?? 0;

  return (
    <>
      <h1 className="text-xl font-bold">ホーム</h1>
      <p className="mt-1 text-sm text-slate-400">{month.label}</p>

      <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">収支</span>
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

      {pendingCount > 0 && (
        <p className="mt-4 rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-300">
          未分類の取引が {pendingCount} 件あります
        </p>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-400">口座</h2>
          <Link href="/accounts" className="text-xs text-emerald-400">
            すべて見る
          </Link>
        </div>
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            口座が未登録です。supabase/migrations/20260922000002_seed.sql を実行してください。
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{a.name}</span>
                <span className="text-xs text-slate-500">{ACCOUNT_TYPE_LABEL[a.type]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
