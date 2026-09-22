import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_TYPE_LABEL, isLiability, type Account } from "@/lib/types";

const GROUPS = [
  { title: "資産", match: (a: Account) => !isLiability(a.type) },
  { title: "負債（クレジットカード）", match: (a: Account) => isLiability(a.type) },
];

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, type, issuer, closing_day, payment_day, payment_account_id, is_active, sort_order, note")
    .order("sort_order");

  if (error) {
    return (
      <>
        <h1 className="text-xl font-bold">口座</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          読み込めませんでした: {error.message}
        </p>
      </>
    );
  }

  const accounts = (data ?? []) as Account[];
  const byId = new Map(accounts.map((a) => [a.id, a]));

  return (
    <>
      <h1 className="text-xl font-bold">口座</h1>

      {GROUPS.map((group) => {
        const list = accounts.filter(group.match);
        if (list.length === 0) return null;
        return (
          <section key={group.title} className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-400">{group.title}</h2>
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
              {list.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{a.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {ACCOUNT_TYPE_LABEL[a.type]}
                      {!a.is_active && "・停止中"}
                    </span>
                  </div>
                  {isLiability(a.type) && (
                    <p className="mt-1 text-xs text-slate-500">
                      {a.closing_day ? `${a.closing_day === 31 ? "月末" : `${a.closing_day}日`}締め` : "締め日 未確認"}
                      {a.payment_day && ` / ${a.payment_day}日払い`}
                      {a.payment_account_id && ` → ${byId.get(a.payment_account_id)?.name ?? "?"}`}
                    </p>
                  )}
                  {a.note && <p className="mt-1 text-xs text-slate-600">{a.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
