/**
 * ゆうちょ銀行（ゆうちょダイレクト）のCSVパーサー。
 * 仕様は docs/design.md 9.1。
 *
 *   1: お客さま口座情報
 *   2: 現在高：,"227,729",円,
 *   3: 出力日時：令和 08 年 09 月 22 日 17 時 36 分
 *   4: お客さま口座番号：XXXXX-XXXXXXXX
 *   5: 照会対象：全期間
 *   6: 明細件数：7
 *   7: 取引日,入出金明細ＩＤ,受入金額（円）,払出金額（円）,詳細１,詳細２,現在（貸付）高,
 *
 * 癖:
 *   - 先頭6行はプリアンブル。7行目がヘッダー
 *   - 「ＩＤ」は全角。末尾のカンマで列が1つ多く見える
 *   - 取引日は YYYYMMDD（年が入っているので推定不要）
 *   - 入出金明細ＩＤ が一意なので、そのまま冪等キーに使える
 *   - 詳細１ に `料　金` のような全角スペース入りがある
 */
import { parseCsv, toAmount } from "./csv";
import type { BankParser, ParseResult, ParsedRow } from "./types";

const HEADER_HEAD = ["取引日", "入出金明細ＩＤ"];
const COL = {
  date: 0,
  id: 1,
  received: 2, // 受入金額 = 入金
  paid: 3, // 払出金額 = 出金
  detail1: 4, // 取引種別
  detail2: 5, // 相手方
  balance: 6,
} as const;

export const yuchoParser: BankParser = {
  id: "yucho",
  label: "ゆうちょ銀行（ゆうちょダイレクト）",

  looksLikeMine(text) {
    return findHeaderIndex(parseCsv(text)) >= 0;
  },

  parse(text): ParseResult {
    const table = parseCsv(text);
    const headerIndex = findHeaderIndex(table);
    if (headerIndex < 0) {
      return empty("ゆうちょ銀行のCSVではないようです（ヘッダー行が見つかりません）");
    }

    const warnings: string[] = [];

    // プリアンブルの「明細件数」は取込件数の検証に使う（9.1）
    const declared = declaredCount(table.slice(0, headerIndex));

    const rows: ParsedRow[] = [];
    for (let i = headerIndex + 1; i < table.length; i++) {
      const cells = table[i];
      const lineNo = i + 1;
      if (cells.every((c) => c.trim() === "")) continue;

      const rawDate = (cells[COL.date] ?? "").trim();
      const md = rawDate.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!md) {
        warnings.push(`${lineNo}行目: 取引日を読めないため飛ばしました（${rawDate}）`);
        continue;
      }
      const date = `${md[1]}-${md[2]}-${md[3]}`;

      const inAmount = toAmount(cells[COL.received]);
      const out = toAmount(cells[COL.paid]);
      if (inAmount === null && out === null) {
        warnings.push(`${lineNo}行目: 金額が空のため飛ばしました`);
        continue;
      }
      if (inAmount !== null && out !== null) {
        warnings.push(`${lineNo}行目: 入金と出金の両方に値があるため飛ばしました`);
        continue;
      }

      const detail1 = (cells[COL.detail1] ?? "").trim();
      const detail2 = (cells[COL.detail2] ?? "").trim();
      const sourceRef = (cells[COL.id] ?? "").trim() || null;

      rows.push({
        date,
        amount: Math.abs((inAmount ?? out) as number),
        direction: inAmount !== null ? "in" : "out",
        merchant: detail2 || detail1,
        // 詳細１ が先頭に来るので、種別だけで前方一致できる（9.1 の分類ルール）
        matchText: `${detail1} ${detail2}`.trim(),
        sourceRef,
        balanceAfter: toAmount(cells[COL.balance]),
        dedupSeed: sourceRef ? `yucho:${sourceRef}` : `yucho:${date}:${inAmount ?? out}:${detail1}:${detail2}`,
        lineNo,
      });

      if (!sourceRef) {
        warnings.push(`${lineNo}行目: 入出金明細ＩＤが空です。重複判定が弱くなります`);
      }
    }

    if (rows.length === 0) return empty("取り込める明細がありませんでした");

    if (declared !== null && declared !== rows.length) {
      warnings.push(
        `明細件数はファイル上 ${declared} 件ですが ${rows.length} 件を読み取りました。` +
          "取りこぼしがないか確認してください。",
      );
    }

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      periodFrom: dates[0],
      periodTo: dates[dates.length - 1],
      warnings,
      error: null,
    };
  },
};

function findHeaderIndex(table: string[][]): number {
  return table.findIndex((r) => HEADER_HEAD.every((h, i) => (r[i] ?? "").trim() === h));
}

/** 「明細件数：7」から件数を取る */
function declaredCount(preamble: string[][]): number | null {
  for (const row of preamble) {
    const line = row.join(",");
    const m = line.match(/明細件数[：:]\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
