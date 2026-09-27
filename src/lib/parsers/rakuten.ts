/**
 * 楽天カード（楽天e-NAVI）のご利用代金請求明細書（PDF）。
 * 実ファイルで確認済み（2026-09-27 / 2025年7月〜2026年9月請求分の15枚）。
 *
 * **CSVは出ない。** e-NAVI から落とせるのはPDFだけ。15ヶ月まで遡れる。
 * ブラウザで文字を取り出し（pdf-lines.ts）、次のようなタブ区切りの行にしてから読む:
 *
 *   2026年07月ご請求金額	ご利用カード	…
 *   100,000円	楽天カード（Visa） ****-****-****-0000
 *   お支払日	返済方法	引落口座	請求確定日	利用獲得ポイント	調整額	返金額
 *   2026/07/27	口座振替	京都銀行	2026/07/20	500ポイント	0円	0円
 *   …
 *   利用日	利用店名	利用者	支払方法	利用金額	手数料/利息	支払総額	当月支払額	当月請求額	翌月繰越残高
 *   2026/06/16	楽天証券投信積立０．５％～	本人*	1回払い	100,000	0	100,000	100,000	100,000	0
 *
 * 癖:
 *   - **明細の列が時期で違う。** 2026年6月請求から「当月支払額」の列が増えた。
 *     「当月請求額」は常に後ろから2番目なので、そこで読む
 *   - 請求のない月はPDF自体が無い（本人談）
 *   - このカードは楽天証券の積立専用で、明細は月1行
 */
import { toAmount } from "./csv";
import { cellsOf } from "./pdf-lines";
import type { BankParser, ParseResult, ParsedRow } from "./types";

const DATE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

export const rakutenParser: BankParser = {
  id: "rakuten",
  accountSource: "user",
  format: "pdf",
  label: "楽天カード（e-NAVI のPDF）",

  looksLikeMine(text) {
    return text.includes("楽天カード株式会社") && text.includes("ご利用代金請求明細書");
  },

  parse(text): ParseResult {
    if (!rakutenParser.looksLikeMine(text)) {
      return empty("楽天カードの請求明細書ではないようです");
    }
    const lines = text.split("\n").map(cellsOf);
    const warnings: string[] = [];

    // 請求額は「〇〇年〇〇月ご請求金額」の次の行の先頭
    const titleAt = lines.findIndex((c) => /^\d{4}年\d{2}月ご請求金額$/.test(c[0] ?? ""));
    const billed = titleAt >= 0 ? toAmount(lines[titleAt + 1]?.[0]?.replace(/円$/, "")) : null;

    // 支払日は「お支払日」の見出しの次の行の先頭
    const payAt = lines.findIndex((c) => c[0] === "お支払日");
    const paymentDate = payAt >= 0 ? toIsoDate(lines[payAt + 1]?.[0]) : null;

    if (billed === null || !paymentDate) {
      return empty("請求額か支払日を読めませんでした。明細書の様式が変わった可能性があります");
    }

    const headerAt = lines.findIndex((c) => c[0] === "利用日" && c[1] === "利用店名");
    if (headerAt < 0) return empty("ご利用明細の表が見つかりませんでした");

    const rows: ParsedRow[] = [];
    const seen = new Map<string, number>();
    let billedSum = 0;

    for (let i = headerAt + 1; i < lines.length; i++) {
      const cells = lines[i];
      const date = toIsoDate(cells[0]);
      // 表の後ろには注記が続く。日付で始まらない行は表の外
      if (!date) continue;
      if (cells.length < 9) {
        warnings.push(`明細の列が足りない行を飛ばしました（${cells.join(" ")}）`);
        continue;
      }

      const merchant = cells[1].trim();
      const amount = toAmount(cells[4]);
      if (amount === null || amount === 0) {
        warnings.push(`利用金額を読めない行を飛ばしました（${cells.join(" ")}）`);
        continue;
      }
      billedSum += toAmount(cells[cells.length - 2]) ?? 0;

      const key = `${date}:${merchant}:${amount}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);

      rows.push({
        date,
        amount: Math.abs(amount),
        direction: amount < 0 ? "in" : "out",
        merchant,
        matchText: merchant,
        sourceRef: null,
        balanceAfter: null,
        dedupSeed: `rakuten:${key}:${occurrence}`,
        lineNo: i + 1,
        memo: null,
      });
    }

    if (rows.length === 0) return empty("取り込める明細がありませんでした");

    if (billedSum !== billed) {
      warnings.push(
        `当月請求額の合計が請求額と合いません（明細 ${billedSum.toLocaleString("ja-JP")}円 / ` +
          `請求額 ${billed.toLocaleString("ja-JP")}円）。読み落としの可能性があります。`,
      );
    }

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      statements: [{ paymentDate, amount: billed }],
      periodFrom: dates[0],
      periodTo: dates[dates.length - 1],
      warnings,
      error: null,
    };
  },
};

function toIsoDate(raw: string | undefined): string | null {
  const m = (raw ?? "").trim().match(DATE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
