/**
 * ポケットカード（ZOZOカード）のご利用代金明細書（PDF）。
 * 実ファイルで確認済み（2026-09-27 / 2026年8月〜10月支払分）。
 *
 * **CSVは出ない。** 15ヶ月まで遡れるが、請求のない月はPDF自体が無い。
 * ブラウザで文字を取り出し（pdf-lines.ts）、次のようなタブ区切りの行にしてから読む:
 *
 *   今回ご利用金額	今回割引金額	割引後今回ご利用額	今回ご請求金額	今回お支払期日
 *   13,680円	0円	13,680円	13,680円	2026年09月01日
 *   …
 *   【今回ご利用明細】
 *   …
 *   0000-00**-****-0000	ＺＯＺＯＣＡＲＤ２
 *   2026/07/04	志なのすけ	枚方	6750	6750	SP	１回払い
 *   2026/07/05	ＺＯＺＯＴＯＷＮ	3300	3300	SP	１回払い
 *
 * 明細の列: 利用日 / 利用先 / 利用金額 / 割引額 / 請求金額 / 対象点数 / 支払区分 / …
 * 割引額と対象点数は空欄だと断片が出てこないので、列の位置では読めない。
 * 利用日の次から最初の数字までを利用先、最初の数字を利用金額、
 * SP/CS の直前の数字を請求金額として読む。
 *
 * 癖:
 *   - **太字が重ね書き**で、利用日が2度出てくる（pdf-lines.ts で畳む）
 *   - **利用先が空白で2つの断片に割れる**（`志なのすけ	枚方`）
 *   - **ZOZOTOWN 以外でも使われている**（サイゼリヤ等）。
 *     「ZOZOカード = 被服費」と決め打ちしてはいけない
 */
import { toAmount } from "./csv";
import { cellsOf } from "./pdf-lines";
import type { BankParser, ParseResult, ParsedRow } from "./types";

const DATE = /^(\d{4})\/(\d{2})\/(\d{2})$/;
const JP_DATE = /^(\d{4})年(\d{2})月(\d{2})日$/;
const NUMBER = /^-?[\d,]+$/;

export const pocketcardParser: BankParser = {
  id: "pocketcard",
  accountSource: "user",
  format: "pdf",
  label: "ポケットカード（ZOZOカードのPDF）",

  looksLikeMine(text) {
    return text.includes("ポケットカード株式会社") && text.includes("ご利用代金明細書");
  },

  parse(text): ParseResult {
    if (!pocketcardParser.looksLikeMine(text)) {
      return empty("ポケットカードの明細書ではないようです");
    }
    const lines = text.split("\n").map(cellsOf);
    const warnings: string[] = [];

    // 「今回お支払期日」の見出しの次の行。末尾が期日、その手前が今回ご請求金額
    const summaryAt = lines.findIndex((c) => c.includes("今回お支払期日"));
    const summary = summaryAt >= 0 ? lines[summaryAt + 1] ?? [] : [];
    const dueAt = summary.findIndex((c) => JP_DATE.test(c));
    const paymentDate = dueAt > 0 ? toIsoDate(summary[dueAt]) : null;
    const billed = dueAt > 0 ? toAmount(summary[dueAt - 1].replace(/円$/, "")) : null;
    if (billed === null || !paymentDate) {
      return empty("請求額か支払期日を読めませんでした。明細書の様式が変わった可能性があります");
    }

    const tableAt = lines.findIndex((c) => c[0] === "【今回ご利用明細】");
    if (tableAt < 0) return empty("ご利用明細の表が見つかりませんでした");

    const rows: ParsedRow[] = [];
    const seen = new Map<string, number>();
    let billedSum = 0;

    for (let i = tableAt + 1; i < lines.length; i++) {
      const cells = lines[i];
      const date = toIsoDate(cells[0]);
      if (!date) continue;

      const firstNumber = cells.findIndex((c, k) => k > 0 && NUMBER.test(c));
      const typeAt = cells.findIndex((c) => c === "SP" || c === "CS");
      if (firstNumber < 2 || typeAt < 0) {
        warnings.push(`明細の行を読めないため飛ばしました（${cells.join(" ")}）`);
        continue;
      }
      if (cells[typeAt] === "CS") {
        // キャッシングは買い物ではない。使っていない前提なので、出てきたら知らせる
        warnings.push(`キャッシングの行を飛ばしました（${cells.join(" ")}）`);
        continue;
      }

      const merchant = cells.slice(1, firstNumber).join(" ");
      const amount = toAmount(cells[firstNumber]);
      if (amount === null || amount === 0) {
        warnings.push(`利用金額を読めない行を飛ばしました（${cells.join(" ")}）`);
        continue;
      }
      billedSum += toAmount(cells[typeAt - 1]) ?? 0;

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
        dedupSeed: `pocketcard:${key}:${occurrence}`,
        lineNo: i + 1,
        memo: null,
      });
    }

    if (rows.length === 0) return empty("取り込める明細がありませんでした");

    if (billedSum !== billed) {
      warnings.push(
        `請求金額の合計が今回ご請求金額と合いません（明細 ${billedSum.toLocaleString("ja-JP")}円 / ` +
          `請求 ${billed.toLocaleString("ja-JP")}円）。読み落としの可能性があります。`,
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
  const s = (raw ?? "").trim();
  const m = s.match(DATE) ?? s.match(JP_DATE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
