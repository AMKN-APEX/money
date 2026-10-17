/**
 * 純資産（資産 − カード未払）の月末ごとの推移。
 *
 * 口座の残高はどこにも履歴として残っていない。残高ビュー（account_balances）と同じく
 * 「開始残高 + 取引の積み上げ」で出しているので、月末までの取引だけを積めば
 * その月末の残高になる。ホームの純資産と同じ口座・同じ計算にしてあり、
 * 今月の点はホームの数字と一致する。
 *
 * **銀行の明細が始まる前の月は出さない。** 銀行CSVは2〜3ヶ月しか遡れず、それより前の
 * 銀行残高はアプリのどこにも無い（開始残高は「取り込んだ最初の取引の直前」の残高）。
 * カードの開始残高も、銀行の明細より前に払い終えた請求をまとめて入れたもの（9.11）なので、
 * 同じ日より前は意味を持たない。そこを計算すると、実際には無かった増減が線に出る。
 */

export type NetWorthAccount = { id: string; type: string; opening_balance: number };
export type NetWorthTx = {
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  account_id: string;
  to_account_id: string | null;
};

export type NetWorthPoint = {
  ym: string;
  /** 月末の日付。今月も月末（ホームの純資産と同じく、先付けの取引も含める） */
  asOf: string;
  /** 銀行の明細が始まる前の月は null（分からない） */
  assets: number | null;
  liabilities: number | null;
  net: number | null;
};

/** 取引1件が口座の残高を動かす量（account_balances と同じ符号） */
function effect(t: NetWorthTx, accountId: string): number {
  if (t.type === "income" && t.account_id === accountId) return t.amount;
  if (t.type === "expense" && t.account_id === accountId) return -t.amount;
  if (t.type === "transfer" && t.account_id === accountId) return -t.amount;
  if (t.type === "transfer" && t.to_account_id === accountId) return t.amount;
  return 0;
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * months（古い順）の各月末の純資産。
 * knownFrom は残高が分かる最初の日（銀行の明細のうち、いちばん遅く始まったもの）。
 * その日より前に終わる月は null にする。
 */
export function netWorthByMonth(
  accounts: NetWorthAccount[],
  txs: NetWorthTx[],
  months: string[],
  knownFrom: string | null,
): NetWorthPoint[] {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const balance = new Map(accounts.map((a) => [a.id, Number(a.opening_balance)]));
  let i = 0;

  return months.map((ym) => {
    const asOf = monthEnd(ym);
    for (; i < sorted.length && sorted[i].date <= asOf; i++) {
      const t = sorted[i];
      for (const id of [t.account_id, t.to_account_id]) {
        if (id && balance.has(id)) balance.set(id, balance.get(id)! + effect(t, id));
      }
    }

    if (!knownFrom || asOf < knownFrom) {
      return { ym, asOf, assets: null, liabilities: null, net: null };
    }

    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      const b = balance.get(a.id) ?? 0;
      // カードはマイナスが未払残高。符号を反転して負債額にする（ホームと同じ）
      if (a.type === "credit_card") liabilities -= b;
      else assets += b;
    }
    return { ym, asOf, assets, liabilities, net: assets - liabilities };
  });
}
