/**
 * ポケットカード（ZOZOカード）の利用通知メール。
 * 実物で確認済み（2026-09-23 / 差出人 announce@pinf.pocketcard.co.jp）。
 *
 *   いつもＺＯＺＯＣＡＲＤ２をご利用いただき、誠にありがとうございます。
 *
 *   ■ご利用先
 *   ポケットカード加盟店
 *   ■ご利用日時
 *   2026/09/23 16:51:00
 *   ■ご利用金額
 *   6,525円
 *
 * **利用先に店名は出ない。** 本文の注意書きのとおり、ここに入るのは
 * 「ポケットカード加盟店」「JCB加盟店」「VISA加盟店」「Mastercard加盟店」
 * 「iD加盟店」またはキャッシングの種別だけで、どの店かは分からない仕様。
 * ZOZOカードは用途がZOZOTOWNの衣類のみなので、口座で費目が決まる
 * シード済みのルール（seed の「ZOZOカードの利用はすべて被服費」）で足りる。
 *
 * 差出人 announce@ は宣伝メールと共通のため、差出人では選り分けられない。
 * 本文に ■ご利用日時 と ■ご利用金額 があることを利用通知の条件にする。
 */
import { normalizeMerchant } from "../../normalize";
import { toDateTime, toLines, toYen, valueAfter } from "./text";
import type { EmailParseResult, EmailParser } from "./types";

const HEAD = {
  merchant: "■ご利用先",
  usedAt: "■ご利用日時",
  amount: "■ご利用金額",
} as const;

/** 「いつも○○をご利用いただき」「○○のご利用内容について」からカード名を取る */
const CARD_LINES = [/いつも(.+?)をご利用いただ/, /^(.+?)のご利用内容について/];

export const pocketcardEmailParser: EmailParser = {
  id: "pocketcard",
  label: "ポケットカード（ZOZOカード）",

  handles(fromAddress) {
    return /pocketcard\.co\.jp/i.test(fromAddress);
  },

  parse(body): EmailParseResult {
    const lines = toLines(body);

    const cardLabel = lines.reduce<string | null>((found, line) => {
      if (found) return found;
      for (const re of CARD_LINES) {
        const m = line.match(re);
        if (m) return m[1].trim();
      }
      return null;
    }, null);

    const usedAt = valueAfter(lines, HEAD.usedAt);
    const amountText = valueAfter(lines, HEAD.amount);
    if (!usedAt && !amountText) {
      // 宣伝・お知らせなど。差出人が同じなので本文で判断するしかない
      return { kind: "other", cardLabel, usages: [], error: null };
    }

    const when = toDateTime(usedAt);
    const amount = toYen(amountText);
    if (!when || amount === null) {
      return {
        kind: "error",
        cardLabel,
        usages: [],
        error: `利用日時か金額を読み取れませんでした（日時: ${usedAt ?? "なし"} / 金額: ${amountText ?? "なし"}）`,
      };
    }

    // 店名は出ないが、ショッピングかキャッシングかの区別には使える
    const merchant = valueAfter(lines, HEAD.merchant) ?? "";
    const cashing = merchant.includes("キャッシング");

    return {
      kind: "usage",
      cardLabel,
      usages: [
        {
          date: when.date,
          time: when.time,
          amount,
          merchant,
          matchText: merchant,
          memo: cashing ? "キャッシング利用（借入。支出として扱ってよいか確認）" : null,
          needsReview: cashing,
          dedupSeed: `email:${when.date}:${when.time ?? ""}:${amount}:${normalizeMerchant(merchant)}`,
        },
      ],
      error: null,
    };
  },
};
