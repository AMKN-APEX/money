/**
 * 楽天カードの「カード利用お知らせメール」。
 * 実物の本文で確認済み（2026-09-27 / 楽天証券の積立 100,000円）。
 *
 *   楽天カード（Visa）をご利用いただき誠にありがとうございます。
 *   <カードご利用情報>
 *   《リボ払いへ変更できないショッピングご利用分》
 *   ■利用日: 2026/09/16
 *   ■利用先: 楽天証券投信積立０．５％～
 *   ■利用者: 本人
 *   ■支払方法: 1回
 *   ■利用金額: 100,000 円
 *   ■支払月: 2026/10
 *
 * - 項目名と値が同じ行に `: ` で並ぶ（三井住友の `：`、ポケットカードの改行とは違う）
 * - 1通に複数の利用が載りうる。■利用日 が出るたびに1件と数える
 * - このカードは楽天証券の積立専用。店名が「楽天証券…」なので、明細PDFと同じ
 *   ルールで振替（投資）になる。あとで明細PDFを取り込むと、この行が上書きされる（3章）
 * - 本文の注意書きのとおり、キャンセルの通知は来ない
 */
import { normalizeMerchant } from "../../normalize";
import { toDateTime, toLines, toYen } from "./text";
import type { EmailParseResult, EmailParser, ParsedUsage } from "./types";

const CARD = /^(.+?)をご利用いただき/;
const field = (name: string) => new RegExp(`^■${name}\\s*[:：]\\s*(.+)$`);
const USED_AT = field("利用日");
const MERCHANT = field("利用先");
const AMOUNT = field("利用金額");

export const rakutenEmailParser: EmailParser = {
  id: "rakuten",
  label: "楽天カード",

  handles(fromAddress) {
    return /rakuten-card\.co\.jp/i.test(fromAddress);
  },

  parse(body): EmailParseResult {
    const lines = toLines(body);
    const cardLabel = lines.map((l) => l.match(CARD)?.[1]?.trim()).find(Boolean) ?? null;

    // ■利用日 から次の ■利用日 までを1件とする
    const starts = lines.flatMap((l, i) => (USED_AT.test(l) ? [i] : []));
    if (starts.length === 0) {
      // 引き落とし日の案内・キャンペーンなど
      return { kind: "other", cardLabel, usages: [], error: null };
    }

    const usages: ParsedUsage[] = [];
    for (const [k, start] of starts.entries()) {
      const block = lines.slice(start, starts[k + 1] ?? lines.length);
      const pick = (re: RegExp) => block.map((l) => l.match(re)?.[1]?.trim()).find(Boolean) ?? null;

      const dateText = pick(USED_AT);
      const amountText = pick(AMOUNT);
      const when = toDateTime(dateText);
      const amount = toYen(amountText);
      if (!when || amount === null) {
        return {
          kind: "error",
          cardLabel,
          usages: [],
          error: `利用日か利用金額を読み取れませんでした（利用日: ${dateText ?? "なし"} / 利用金額: ${amountText ?? "なし"}）`,
        };
      }

      const merchant = pick(MERCHANT) ?? "";
      usages.push({
        date: when.date,
        time: when.time,
        amount,
        merchant,
        matchText: merchant,
        memo: null,
        needsReview: false,
        dedupSeed: `email:${when.date}:${amount}:${normalizeMerchant(merchant)}`,
      });
    }

    return { kind: "usage", cardLabel, usages, error: null };
  },
};
