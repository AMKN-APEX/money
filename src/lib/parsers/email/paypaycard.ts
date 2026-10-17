/**
 * PayPayカードの「請求金額のお知らせ」メール。
 * 実物の本文で確認済み（2026-10-16 / 10月請求 1,855円）。
 *
 *   2026年10月の請求金額のお知らせ
 *   ━━━━━━━━━━━━
 *   請求金額：1,855円（確定）
 *   ━━━━━━━━━━━━
 *   利用カード：PayPayカード（Visa）
 *   支払い日：2026年10月27日（火）
 *   支払い口座：京都銀行 山科支店 普通 *****73
 *
 * **利用の通知ではなく、請求の確定通知。** 取引は作らず card_statements に入れる。
 * 京都銀行の引落（PAYPAYｶ-ﾄﾞ）との突き合わせと、口座画面の引落予定に使われる（9.11）。
 * 利用の中身はこのメールに無いので、明細CSVの取込は引き続き要る。
 *
 * - 請求が0円の月にも届く（本文の注意書き）。0円は請求ではないので対象外にする
 * - 日付は `2026年10月27日` の和文。他社の `2026/10/27` とは違う
 * - 利用通知メールはまだ実物が無い。来たら対象外になるので、文面を見てから足す
 */
import type { EmailParseResult, EmailParser } from "./types";
import { toLines, toYen } from "./text";

const BILLED = /^請求金額\s*[:：]\s*(.+)$/;
const CARD = /^利用カード\s*[:：]\s*(.+)$/;
const PAYMENT_DATE = /^支払い?日\s*[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/;

export const paypaycardEmailParser: EmailParser = {
  id: "paypaycard",
  label: "PayPayカード",

  handles(fromAddress) {
    return /paypay-card\.co\.jp/i.test(fromAddress);
  },

  parse(body): EmailParseResult {
    const lines = toLines(body);
    const pick = (re: RegExp) => lines.map((l) => l.match(re)).find(Boolean) ?? null;

    const cardLabel = pick(CARD)?.[1]?.trim() ?? null;
    const billedText = pick(BILLED)?.[1]?.trim() ?? null;
    if (!billedText) {
      // 宣伝・キャンペーン・ログイン通知など
      return { kind: "other", cardLabel, usages: [], error: null };
    }

    // 0円の請求は記録しない（card_statements は正の額だけ）
    if (/^0\s*円/.test(billedText)) {
      return { kind: "other", cardLabel, usages: [], error: null };
    }

    const amount = toYen(billedText);
    const d = pick(PAYMENT_DATE);
    const paymentDate = d ? toIsoDate(d[1], d[2], d[3]) : null;
    if (amount === null || !paymentDate) {
      return {
        kind: "error",
        cardLabel,
        usages: [],
        error: `請求金額か支払い日を読み取れませんでした（請求金額: ${billedText} / 支払い日: ${d?.[0] ?? "なし"}）`,
      };
    }

    return { kind: "statement", cardLabel, usages: [], statement: { paymentDate, amount }, error: null };
  },
};

function toIsoDate(y: string, m: string, d: string): string | null {
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
