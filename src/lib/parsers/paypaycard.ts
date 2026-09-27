/**
 * PayPayカードのご利用明細CSV。
 * 実ファイルで確認済み（2026-09-27 / 2026年5月〜9月請求分）。
 *
 *   "利用日/キャンセル日","利用店名・商品名","利用者","決済方法","支払区分","利用金額","手数料","支払総額","当月支払金額","翌月以降繰越金額","調整額","当月お支払日"
 *   "2026/4/30","ソフトバンクМ","本人*","PayPayカード","1回","6763","0","6763","6763","0","0","2026/6/29"
 *
 * 癖:
 *   - UTF-8（BOM付き）。他社のような CP932 ではない
 *   - ファイル名 `detail202606(7705).csv` の数字は請求月とカード番号の末尾
 *   - 1ファイル = 1回の請求。行ごとに「当月お支払日」が入っている
 *   - 決済方法が `PayPayカード`（カードを直接使った）と `PayPayクレジット`
 *     （PayPayアプリでクレジット払いを選んだ）に分かれる。どちらもこのカードの請求
 *   - 利用日の月日はゼロ埋めされない（`2026/4/12`）
 *   - 一意な明細IDが無い
 *   - 24ヶ月まで遡れる
 */
import { parseCsv, pad2, toAmount } from "./csv";
import type { BankParser, ParseResult, ParsedRow, StatementBill } from "./types";

const HEADER = ["利用日/キャンセル日", "利用店名・商品名", "利用者", "決済方法"];
const COL = {
  date: 0,
  merchant: 1,
  method: 3,
  amount: 5,
  billed: 8,
  paymentDate: 11,
} as const;

const DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

export const paypayCardParser: BankParser = {
  id: "paypaycard",
  accountSource: "user",
  format: "csv",
  label: "PayPayカード",

  looksLikeMine(text) {
    const first = parseCsv(text)[0] ?? [];
    return HEADER.every((h, i) => first[i]?.trim() === h);
  },

  parse(text): ParseResult {
    const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (table.length === 0) return empty("ファイルが空です");
    if (!HEADER.every((h, i) => table[0][i]?.trim() === h)) {
      return empty("PayPayカードのCSVではないようです（1行目が想定のヘッダーと違います）");
    }

    const warnings: string[] = [];
    const rows: ParsedRow[] = [];
    const seen = new Map<string, number>();
    const bills = new Map<string, number>();

    for (const [i, cells] of table.slice(1).entries()) {
      const lineNo = i + 2;
      const date = toIsoDate(cells[COL.date]);
      if (!date) {
        warnings.push(`${lineNo}行目: 利用日を読めないため飛ばしました（${cells[COL.date]}）`);
        continue;
      }
      const amount = toAmount(cells[COL.amount]);
      if (amount === null || amount === 0) {
        warnings.push(`${lineNo}行目: 利用金額を読めないため飛ばしました（${cells[COL.amount]}）`);
        continue;
      }

      const paymentDate = toIsoDate(cells[COL.paymentDate]);
      if (paymentDate) {
        bills.set(paymentDate, (bills.get(paymentDate) ?? 0) + (toAmount(cells[COL.billed]) ?? 0));
      }

      const merchant = (cells[COL.merchant] ?? "").trim();
      const method = (cells[COL.method] ?? "").trim();

      // 同じ日・同じ店・同じ金額が本当に2件並ぶことがある（Vpass と同じ）
      const key = `${date}:${merchant}:${amount}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);

      rows.push({
        date,
        amount: Math.abs(amount),
        // マイナスはキャンセル。カードの負債が減る＝入金側
        direction: amount < 0 ? "in" : "out",
        merchant,
        matchText: merchant,
        sourceRef: null,
        balanceAfter: null,
        dedupSeed: `paypaycard:${key}:${occurrence}`,
        lineNo,
        memo: method === "PayPayクレジット" ? "PayPayアプリでクレジット払い" : null,
      });
    }

    if (rows.length === 0) return empty("取り込める明細がありませんでした");

    const statements: StatementBill[] = [...bills]
      .filter(([, total]) => total > 0)
      .map(([paymentDate, total]) => ({ paymentDate, amount: total }));

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      statements,
      periodFrom: dates[0],
      periodTo: dates[dates.length - 1],
      warnings,
      error: null,
    };
  },
};

function toIsoDate(raw: string | undefined): string | null {
  const m = (raw ?? "").trim().normalize("NFKC").match(DATE);
  if (!m) return null;
  return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
}

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
