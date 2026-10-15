/**
 * カードの開始残高を、明細の請求と銀行からの引落の突き合わせで決める。
 * 設計 docs/design.md 9.11。
 *
 * カードの残高は「利用（マイナス）＋ 銀行からの引落（プラス）」の積み上げで出す。
 * カード明細は15〜24ヶ月遡れるのに、銀行CSVは2〜3ヶ月しか遡れない。
 * 遡って取り込んだ利用に対応する引落はアプリのどこにも無く、払い終わった額が
 * 未払いとして残る。
 *
 * 明細には「支払日にいくら引き落とすか」が載っている。これを取引の引落と照合し、
 * **引落が見つからず、支払日が引落口座の銀行CSVより前の請求**は、アプリの外で
 * 払い済みとみなして開始残高に足す。
 *
 * 取込のたびに全カードぶん計算し直す。あとから銀行CSVを取り込んで引落が
 * 見つかれば、その請求は開始残高から外れる（二重に足されない）。
 */

export type Statement = { paymentDate: string; amount: number };
export type Payment = { id: string; date: string; amount: number };

/**
 * 引落日は支払日から前後にずれる。休日なら翌営業日で、Vpass は支払日を
 * ファイル名から推定している（26日と決め打ち）。連休を含めて1週間見る
 */
const WINDOW_DAYS = 7;

/**
 * 開始残高に入れる額と、その内訳。
 * cutoff は引落口座の銀行CSVが始まる日。それ以降の請求は、引落が見つからなければ未払い。
 */
export function paidOutside(
  statements: Statement[],
  payments: Payment[],
  cutoff: string,
): { amount: number; statements: Statement[] } {
  const used = new Set<string>();
  const outside: Statement[] = [];

  for (const s of [...statements].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))) {
    const match = payments
      .filter((p) => !used.has(p.id) && p.amount === s.amount)
      .map((p) => ({ p, gap: Math.abs(dayDiff(p.date, s.paymentDate)) }))
      .filter(({ gap }) => gap <= WINDOW_DAYS)
      .sort((x, y) => x.gap - y.gap)[0];

    if (match) {
      used.add(match.p.id);
      continue;
    }
    // 銀行CSVの範囲に入っている請求は、引落が無ければまだ払っていない（残高のマイナスとして正しい）
    if (s.paymentDate < cutoff) outside.push(s);
  }

  return { amount: outside.reduce((acc, s) => acc + s.amount, 0), statements: outside };
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * 銀行の摘要では見分けられないカード（同じ会社・同じ引落口座）。9.3。
 * 三井住友の Amazonカード とデビュープラスは、どちらの引落も「ミツイスミトモカード」になる。
 * 1枚しか無ければ空。
 */
export function indistinguishableCards<
  A extends { id: string; type: string; issuer: string | null; payment_account_id: string | null },
>(accounts: A[], cardId: string): A[] {
  const card = accounts.find((a) => a.id === cardId);
  if (!card || card.type !== "credit_card" || !card.issuer) return [];
  const same = accounts.filter(
    (a) =>
      a.type === "credit_card" &&
      a.issuer === card.issuer &&
      a.payment_account_id === card.payment_account_id,
  );
  return same.length > 1 ? same : [];
}

/**
 * 銀行の引落が、どのカードの請求を払ったものかを請求額で決める。
 * 同額の請求が支払日の前後7日にあるカードが1枚だけならそのカード。無い・2枚以上なら null。
 *
 * 摘要からルールで決めると、見分けられないカードの引落がすべて同じカードに付く。
 * 2026-10 に Amazonカードの引落3回（計 261,424円）がデビュープラスに付いていた。
 */
export function cardForPayment(
  payment: { date: string; amount: number },
  cards: { accountId: string; statements: Statement[] }[],
): string | null {
  const hits = cards.filter((c) =>
    c.statements.some(
      (s) => s.amount === payment.amount && Math.abs(dayDiff(payment.date, s.paymentDate)) <= WINDOW_DAYS,
    ),
  );
  return hits.length === 1 ? hits[0].accountId : null;
}
