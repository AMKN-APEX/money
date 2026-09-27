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
 *   - **店名のカンマが囲まれていない。** `GITHUB, INC. (GITHUB.COM )` のように
 *     店名にカンマがあると列が1つずれる（2025年9月請求で確認）。列の位置は決め打ちせず、
 *     「利用金額」と、その3つ右の「当月支払額」がどちらも数字になる位置を探す
 *   - **利用金額が空の行がある。** ポイントのキャッシュバックは当月支払額だけに
 *     マイナスで入る（`キャッシュバック（ポイント交換）,,,,,-7800,`）。当月支払額で読む
 *   - **確定前の明細は別の形式で落ちてくる**（`202610.csv`。カード見出し行が無く、
 *     列も違う）。どのカードの明細か分からず、確定後の明細と重複するため取り込まない
 *   - **支払日がファイルのどこにも無い。** ファイル名 `202609.csv`（`202609 (1).csv`）が
 *     請求月なので、その月の26日（三井住友の引落日）を支払日とする。
 *     休日で後ろにずれる分は、引落との照合で幅を持たせて吸収する
 */
import { parseCsv, toAmount } from "./csv";
import type { BankParser, ParseResult, ParsedRow, StatementBill } from "./types";

const COL = {
  date: 0,
  merchant: 1,
  amount: 2,
  payType: 3,
  times: 4,
  billed: 5,
  note: 6,
} as const;

/** 確定前の明細の6列目（請求月）。`'26/10` */
const UNCONFIRMED_MONTH = /^'\d{2}\/\d{1,2}$/;
const NUMBER = /^-?[\d,]+$/;

/** カード見出し行の2列目。`4980-03**-****-****` */
const MASKED_NUMBER = /^\d{4}-\d{2}\*{2}-\*{4}-\*{4}$/;
const DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
/** 三井住友カードの引落日（毎月26日） */
const PAYMENT_DAY = "26";

export const vpassParser: BankParser = {
  id: "vpass",
  accountSource: "file",
  format: "csv",
  label: "三井住友カード（Vpass）",

  looksLikeMine(text) {
    // ヘッダーが無いので、カード見出し行があるかで判定する。
    // 確定前の明細も引き受けて、parse で「取り込めない理由」を返す
    return parseCsv(text).some(
      (row) => MASKED_NUMBER.test((row[1] ?? "").trim()) || UNCONFIRMED_MONTH.test((row[5] ?? "").trim()),
    );
  },

  parse(text, filename): ParseResult {
    const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (table.length === 0) return empty("ファイルが空です");
    if (table.some((row) => UNCONFIRMED_MONTH.test((row[5] ?? "").trim()))) {
      return empty(
        "確定前のご利用明細です。どのカードの明細かがファイルに書かれておらず、" +
          "確定後の明細と重複するため取り込みません。請求が確定してから落とし直してください" +
          "（それまでの利用は利用通知メールで入っています）。",
      );
    }
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

      const cols = locateColumns(cells);
      const amount = cols ? (toAmount(cells[cols.amount]) ?? toAmount(cells[cols.billed])) : null;
      if (!cols || amount === null || amount === 0) {
        warnings.push(`${lineNo}行目: 利用金額を読めないため飛ばしました（${cells.join(",")}）`);
        continue;
      }
      if (cardLabel === null) {
        warnings.push(`${lineNo}行目: どのカードの明細か分からないため飛ばしました`);
        continue;
      }

      billedSum += toAmount(cells[cols.billed]) ?? 0;

      const merchant = cells.slice(COL.merchant, cols.amount).join(",").trim();
      const note = cells.slice(cols.billed + 1).join(",").trim();

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

    // 1ファイル = 1枚のカードの1回の請求（iD はデビュープラスの請求に含まれる）
    const statements: StatementBill[] = [];
    const month = filename.match(/^(\d{4})(\d{2})(?:\D|$)/);
    if (month && billedTotal !== null && billedTotal > 0) {
      statements.push({
        paymentDate: `${month[1]}-${month[2]}-${PAYMENT_DAY}`,
        amount: billedTotal,
        cardLabel: rows[0].cardLabel,
      });
    } else if (!month) {
      warnings.push(
        "ファイル名から請求月を読めませんでした（`202609.csv` の形を想定）。" +
          "引落との照合に使う請求は記録しません。",
      );
    }

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

/**
 * 利用金額と当月支払額の列を探す。ふつうは2列目と5列目だが、店名にカンマがあると右にずれる。
 * 当月支払額（利用金額の3つ右）は必ず数字、利用金額は数字か空（キャッシュバック）。
 */
function locateColumns(cells: string[]): { amount: number; billed: number } | null {
  for (let k = COL.amount; k + 3 < cells.length; k++) {
    const amount = cells[k].trim();
    const billed = cells[k + 3].trim();
    if ((amount === "" || NUMBER.test(amount)) && NUMBER.test(billed)) {
      return { amount: k, billed: k + 3 };
    }
  }
  return null;
}

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
