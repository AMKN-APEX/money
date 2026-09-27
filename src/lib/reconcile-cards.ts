import type { createClient } from "@/lib/supabase/server";
import { paidOutside, type Payment, type Statement } from "@/lib/card-statements";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** カードの開始残高を計算し直した結果（9.11） */
export type CardOpening = {
  accountName: string;
  /** アプリの外で払い済みとみなした請求の合計 */
  amount: number;
  /** そのうち何回分の請求か */
  statementCount: number;
};

/**
 * カードの開始残高を、請求と銀行からの引落の突き合わせで決め直す。9.11。
 *
 * **アプリの外で払ったとみなすのは、引落口座の銀行CSVが始まる日より前の請求だけ。**
 * それ以降の請求は、引落があれば銀行CSVに必ず出てくる。見つからなければまだ払っていない
 * （休日で引落がずれた・銀行CSVをまだ取り込んでいない）ので、未払いのまま残す。
 * 当初は「支払日が今日より前なら払い済み」としていたが、9/26（土）の請求が9/28の引落より
 * 先に払い済み扱いになり、カードの未払いが実際より少なく出た（2026-09-27）。
 *
 * 取込のたびと、設定の「カードの残高を計算し直す」から呼ぶ。
 */
export async function reconcileCardOpenings(supabase: Supabase, today: string): Promise<CardOpening[]> {
  const [accountsRes, statementsRes, coverageRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, opening_balance, payment_account_id")
      .eq("type", "credit_card"),
    supabase.from("card_statements").select("account_id, payment_date, amount"),
    supabase.from("import_coverage").select("account_id, covered_from"),
  ]);
  // 表が無い（マイグレーション未適用）ときに開始残高を0で塗り替えないよう、何もしない
  if (accountsRes.error || statementsRes.error || coverageRes.error) return [];

  const cards = (accountsRes.data ?? []) as {
    id: string;
    name: string;
    opening_balance: number | null;
    payment_account_id: string | null;
  }[];
  if (cards.length === 0) return [];

  const { data: paymentRows, error: paymentError } = await supabase
    .from("transactions")
    .select("id, date, amount, to_account_id")
    .eq("type", "transfer")
    .in(
      "to_account_id",
      cards.map((c) => c.id),
    );
  if (paymentError) return [];

  const coveredFrom = new Map(
    ((coverageRes.data ?? []) as { account_id: string; covered_from: string | null }[]).map((c) => [
      c.account_id,
      c.covered_from,
    ]),
  );

  const changed: CardOpening[] = [];
  for (const card of cards) {
    const statements: Statement[] = ((statementsRes.data ?? []) as { account_id: string; payment_date: string; amount: number }[])
      .filter((s) => s.account_id === card.id)
      .map((s) => ({ paymentDate: String(s.payment_date), amount: Number(s.amount) }));
    const payments: Payment[] = ((paymentRows ?? []) as { id: string; date: string; amount: number; to_account_id: string }[])
      .filter((p) => p.to_account_id === card.id)
      .map((p) => ({ id: String(p.id), date: String(p.date), amount: Number(p.amount) }));

    // 引落口座の銀行CSVが始まる日。まだ1度も取り込んでいなければ今日で代用する
    const cutoff = (card.payment_account_id && coveredFrom.get(card.payment_account_id)) || today;
    const outside = paidOutside(statements, payments, cutoff);
    if (outside.amount === Number(card.opening_balance ?? 0)) continue;

    const latest = outside.statements.map((s) => s.paymentDate).sort().at(-1) ?? null;
    const { error } = await supabase
      .from("accounts")
      .update({ opening_balance: outside.amount, opening_balance_date: latest })
      .eq("id", card.id);
    if (!error) {
      changed.push({
        accountName: card.name,
        amount: outside.amount,
        statementCount: outside.statements.length,
      });
    }
  }
  return changed;
}
