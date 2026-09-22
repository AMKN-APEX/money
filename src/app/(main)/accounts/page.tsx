import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_COLUMNS } from "@/lib/queries";
import { yen } from "@/lib/format";
import { ACCOUNT_TYPE_LABEL, isLiability, type Account } from "@/lib/types";

const GROUPS = [
  { title: "資産", match: (a: Account) => !isLiability(a.type) },
  { title: "負債（クレジットカード）", match: (a: Account) => isLiability(a.type) },
];

export default async function AccountsPage() {
  const supabase = await createClient();
  const [accountsRes, balanceRes] = await Promise.all([
    supabase.from("accounts").select(ACCOUNT_COLUMNS).order("sort_order"),
    supabase.from("account_balances").select("account_id, balance"),
  ]);

  const error = accountsRes.error?.message ?? balanceRes.error?.message;
  if (error) {
    return (
      <>
        <h1 className="text-xl font-bold">口座</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          読み込めませんでした: {error}
        </p>
      </>
    );
  }

  const accounts = (accountsRes.data ?? []) as Account[];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const balances = new Map(
    ((balanceRes.data ?? []) as { account_id: string; balance: number }[]).map((b) => [
      b.account_id,
      Number(b.balance),
    ]),
  );

  return (
    <>
      <h1 className="text-xl font-bold">口座</h1>

      {GROUPS.map((group) => {
        const list = accounts.filter(group.match);
        if (list.length === 0) return null;
        const liability = group.title.startsWith("負債");
        const groupTotal = list.reduce(
          (a, acc) => a + (liability ? -1 : 1) * (balances.get(acc.id) ?? 0),
          0,
        );

        return (
          <section key={group.title} className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-400">{group.title}</h2>
              <span className="text-sm font-semibold tabular-nums">{yen(groupTotal)}</span>
            </div>
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
              {list.map((a) => {
                const raw = balances.get(a.id) ?? 0;
                // カードはマイナスが未払残高。符号を反転して見せる
                const shown = liability ? -raw : raw;
                return (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {ACCOUNT_TYPE_LABEL[a.type]}
                          {!a.is_active && "・停止中"}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 font-semibold tabular-nums ${
                          shown < 0 ? "text-rose-400" : "text-slate-100"
                        }`}
                      >
                        {yen(shown)}
                      </span>
                    </div>
                    {isLiability(a.type) && (
                      <p className="mt-1 text-xs text-slate-500">
                        {a.closing_day
                          ? `${a.closing_day === 31 ? "月末" : `${a.closing_day}日`}締め`
                          : "締め日 未確認"}
                        {a.payment_day && ` / ${a.payment_day}日払い`}
                        {a.payment_account_id &&
                          ` → ${byId.get(a.payment_account_id)?.name ?? "?"}`}
                      </p>
                    )}
                    {a.note && <p className="mt-1 text-xs text-slate-600">{a.note}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <p className="mt-6 text-xs text-slate-600">
        残高は登録済みの取引から計算しています。初期残高をまだ入れていない口座は、
        実際の残高とずれます。
      </p>
    </>
  );
}
