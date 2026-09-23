/**
 * 三井住友カード（Vpass）のご利用明細CSV。
 * 実ファイルで確認済み（2026-09-23 / 2026年9月請求分）。設計 docs/design.md 9.10。
 *
 * **ヘッダー行が無い。** 代わりにカードごとの見出し行が挟まる:
 *
 *   高島　公ノ丞　様,4980-03**-****-****,三井住友カードデビュープラスＶＩＳＡ
 *   2026/08/02,ジーユー／ＮＦＣ,1290,１,１,1290,
 *   2026/08/07,モバイルＩＣＯＣＡチャージ,5000,１,１,5000,
 *   高島　公ノ丞　様,6900-11**-****-****,ＡｐｐｌｅＰａｙ／ｉＤ
 *   2026/08/15,ファミリーマート／ｉＤ,1488,１,１,1488,ﾌｱﾐﾘ-ﾏ-ﾄｶﾔｼﾏｴｷﾏｴ/ID
 *   ,,,,,110044,
 *
 * 列: 利用日 / 利用先 / 利用金額 / 支払区分 / 回数 / 当月支払額 / 備考
 * 最終行は請求額の合計（利用日が空）。
 *
 * 癖:
 *   - **1ファイルに複数カードが入る。** 取り込み先は利用者に選ばせず、
 *     カード名から決める（cardLabel → accounts.card_patterns）
 *   - **ＡｐｐｌｅＰａｙ／ｉＤ が別カード番号の見出しで現れる。**
 *     方針1のとおり独立した口座にはしない。同じ請求にまとめられており
 *     （合計行が両セクションの和と一致することを実ファイルで確認）、
 *     デビュープラスの取引として channel = id で記録する
 *   - **返品がマイナス金額で出る**（`-1970` / 備考「返品」）
 *   - 海外利用は末尾にまとめられ、日付順に並ばない。備考にレートが入る
 *   - 数字以外はほぼ全角。正規化は normalizeMerchant() 側で行う
 */
import { parseCsv, toAmount } from "./csv";
import type { BankParser, ParseResult, ParsedRow } from "./types";

const COL = {
  date: 0,
  merchant: 1,
  amount: 2,
  payType: 3,
  times: 4,
  billed: 5,
  note: 6,
} as const;

/** カード見出し行の2列目。`4980-03**-****-****` */
const MASKED_NUMBER = /^\d{4}-\d{2}\*{2}-\*{4}-\*{4}$/;
const DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

export const vpassParser: BankParser = {
  id: "vpass",
  accountSource: "file",
  label: "三井住友カード（Vpass）",

  looksLikeMine(text) {
    // ヘッダーが無いので、カード見出し行があるかで判定する
    return parseCsv(text).some((row) => MASKED_NUMBER.test((row[1] ?? "").trim()));
  },

  parse(text): ParseResult {
    const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (table.length === 0) return empty("ファイルが空です");
    if (!table.some((row) => MASKED_NUMBER.test((row[1] ?? "").trim()))) {
      return empty("VpassのCSVではないようです（カードの見出し行が見つかりません）");
    }

    const warnings: string[] = [];
    const rows: ParsedRow[] = [];
    const seen = new Map<string, number>();
    let cardLabel: string | null = null;
    let billedTotal: number | null = null;
    let billedSum = 0;

    for (const [i, cells] of table.entries()) {
      const lineNo = i + 1;
      const first = (cells[COL.date] ?? "").trim();

      if (MASKED_NUMBER.test((cells[1] ?? "").trim())) {
        cardLabel = (cells[2] ?? "").trim() || null;
        if (!cardLabel) {
          warnings.push(`${lineNo}行目: カード名が空の見出し行がありました`);
        }
        continue;
      }

      // 末尾の合計行（利用日が空で、当月支払額だけ入っている）
      if (first === "") {
        const total = toAmount(cells[COL.billed]);
        if (total !== null) billedTotal = total;
        continue;
      }

      const md = first.normalize("NFKC").match(DATE);
      if (!md) {
        warnings.push(`${lineNo}行目: 利用日を読めないため飛ばしました（${first}）`);
        continue;
      }
      const date = `${md[1]}-${md[2].padStart(2, "0")}-${md[3].padStart(2, "0")}`;

      const amount = toAmount(cells[COL.amount]);
      if (amount === null || amount === 0) {
        warnings.push(`${lineNo}行目: 利用金額を読めないため飛ばしました（${cells[COL.amount]}）`);
        continue;
      }
      if (cardLabel === null) {
        warnings.push(`${lineNo}行目: どのカードの明細か分からないため飛ばしました`);
        continue;
      }

      billedSum += toAmount(cells[COL.billed]) ?? 0;

      const merchant = (cells[COL.merchant] ?? "").trim();
      const note = (cells[COL.note] ?? "").trim();

      // 同じ日・同じ店・同じ金額の明細が本当に2件並ぶことがある
      // （実例: 2026/08/24 JR九州列車予約サービス 1,970円 × 2）。
      // 一意なIDが無いので、出現順で区別する
      const key = `${cardLabel}:${date}:${merchant}:${amount}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);

      rows.push({
        date,
        amount: Math.abs(amount),
        // マイナスは返品。カードの負債が減る＝入金側として扱う
        direction: amount < 0 ? "in" : "out",
        merchant,
        matchText: merchant,
        sourceRef: null,
        balanceAfter: null,
        dedupSeed: `vpass:${key}:${occurrence}`,
        lineNo,
        cardLabel,
        memo: note || null,
      });
    }

    if (rows.length === 0) return empty("取り込める明細がありませんでした");

    // 合計行と突き合わせて、読み落としが無いことを確かめる（9.5 の残高チェーンの代わり）
    if (billedTotal !== null && billedTotal !== billedSum) {
      warnings.push(
        `当月支払額の合計が明細と合いません（明細 ${billedSum.toLocaleString("ja-JP")}円 / ` +
          `合計行 ${billedTotal.toLocaleString("ja-JP")}円）。読み落としの可能性があります。`,
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

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
