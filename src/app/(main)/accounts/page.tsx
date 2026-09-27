import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_COLUMNS } from "@/lib/queries";
import { currentMonthRange, shortDate, todayJst, yen } from "@/lib/format";
import { ACCOUNT_TYPE_LABEL, isLiability, type Account } from "@/lib/types";

const GROUPS = [
  { title: "資産", match: (a: Account) => !isLiability(a.type) },
  { title: "負債（クレジットカード）", match: (a: Account) => isLiability(a.type) },
];

export default async function AccountsPage() {
  const supabase = await createClient();
  const month = currentMonthRange();
  const today = todayJst();
  const [accountsRes, balanceRes, investRes, billRes] = await Promise.all([
    supabase.from("accounts").select(ACCOUNT_COLUMNS).order("sort_order"),
    supabase.from("account_balances").select("account_id, balance"),
    // 方針2: NISA積立は支出ではなく振替。支出には出てこないので、
    // 「いくら積み立てたか」は証券口座に入ってきた振替を数えて出す（3章）
    supabase
      .from("transactions")
      .select("date, amount, to_account_id")
      .eq("type", "transfer")
      .not("to_account_id", "is", null),
    // カードの請求（9.11）。支払日が休日だと引落は後ろにずれるので、1週間前から見る
    supabase
      .from("card_statements")
      .select("account_id, payment_date, amount")
      .gte("payment_date", shiftDay(today, -7))
      .order("payment_date"),
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

  const allAccounts = (accountsRes.data ?? []) as Account[];
  // 止めた口座（PayPay残高など）は出さない。引落口座の名前を引くためだけに全件を持つ
  const accounts = allAccounts.filter((a) => a.is_active);
  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  const balances = new Map(
    ((balanceRes.data ?? []) as { account_id: string; balance: number }[]).map((b) => [
      b.account_id,
      Number(b.balance),
    ]),
  );

  // カードごとの、まだ引き落とされていない請求（支払日の早い順）。
  // 銀行の明細に同じ額の引落が前後7日にあれば、払い済みとして外す
  const payments = (investRes.data ?? []) as { date: string; amount: number; to_account_id: string }[];
  const bills = new Map<string, { date: string; amount: number }[]>();
  for (const b of (billRes.data ?? []) as { account_id: string; payment_date: string; amount: number }[]) {
    const amount = Number(b.amount);
    const paid = payments.some(
      (p) =>
        p.to_account_id === b.account_id &&
        Number(p.amount) === amount &&
        p.date >= shiftDay(b.payment_date, -7) &&
        p.date <= shiftDay(b.payment_date, 7),
    );
    if (paid) continue;
    bills.set(b.account_id, [...(bills.get(b.account_id) ?? []), { date: b.payment_date, amount }]);
  }

  // 証券口座ごとの今月の投資額。累計は残高（開始残高 + 振替）をそのまま使う
  const invested = new Map<string, { thisMonth: number }>();
  for (const t of (investRes.data ?? []) as {
    date: string;
    amount: number;
    to_account_id: string;
  }[]) {
    const current = invested.get(t.to_account_id) ?? { thisMonth: 0 };
    if (t.date >= month.from && t.date <= month.to) current.thisMonth += t.amount;
    invested.set(t.to_account_id, current);
  }

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
                    {isLiability(a.type) && <CardBreakdown unpaid={shown} bills={bills.get(a.id) ?? []} />}
                    {a.type === "securities" && (
                      <p className="mt-1 text-xs text-sky-400 tabular-nums">
                        {/* 累計は残高と同じ。アプリに取引が無い昔の積立は開始残高に入れてある */}
                        積立 累計 {yen(balances.get(a.id) ?? 0)}
                        <span className="text-slate-500">
                          {" / "}今月 {yen(invested.get(a.id)?.thisMonth ?? 0)}
                        </span>
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
        実際の残高とずれます。証券口座の「積立」は投資した金額の合計で、
        評価額（時価）ではありません。
      </p>
    </>
  );
}

/**
 * カードの未払い額の内訳。
 * 未払い額 = 取り込んだ利用（明細・利用通知メール）− 銀行から引き落とされた額。
 * そのうち明細で確定している請求と、まだ請求に入っていない利用（締め日のあと・明細を
 * 取り込んでいない月）に分けて見せる。1つの数字だと「いつの分か」が分からないため。
 */
function CardBreakdown({ unpaid, bills }: { unpaid: number; bills: { date: string; amount: number }[] }) {
  const billed = bills.reduce((acc, b) => acc + b.amount, 0);
  const unbilled = unpaid - billed;
  if (unpaid === 0 && bills.length === 0) return null;

  return (
    <dl className="mt-1.5 grid gap-0.5 text-xs tabular-nums">
      {bills.map((b) => (
        <div key={b.date} className="flex justify-between gap-3">
          <dt className="text-slate-400">{shortDate(b.date)} 引落予定（請求確定）</dt>
          <dd>{yen(b.amount)}</dd>
        </div>
      ))}
      {unbilled !== 0 && (
        <div className="flex justify-between gap-3">
          <dt className="text-slate-400">まだ請求に入っていない利用</dt>
          <dd>{yen(unbilled)}</dd>
        </div>
      )}
    </dl>
  );
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
