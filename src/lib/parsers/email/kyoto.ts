/**
 * 京都銀行（京銀ダイレクトバンキング）の入金通知メール。
 * 実物の本文で確認済み（2026-09-27 / 給与の振込）。
 *
 *   いつも京銀ダイレクトバンキングをご利用いただきありがとうございます。
 *   口座に振込入金がございましたのでお知らせいたします。
 *   入金口座　：山科支店　普通預金　口座番号　０００００＊＊＊
 *   入金日　　：２０２６年０９月２５日　０１時０５分５８秒
 *   入金額　　：￥２８４，９８８
 *   内容　　　：パナソニツクインダストリ―（カ
 *
 * カードの利用通知と違う点:
 *   - **入金**（口座にお金が入る向き）。給与の自動分類は京都銀行CSVと同じルールに当たる
 *   - 項目名と値が同じ行に `：` で並ぶ
 *   - 日時は `年月日 時分秒`、金額は `￥` で始まり「円」が付かない
 *   - 内容は銀行の摘要そのもの（途中で切れる・長音が `―`）。CSVの摘要と同じ形に
 *     正規化されるので、あとでCSVを取り込むとこの行が上書きされる（3章の重複排除）
 *
 * 口座は本文の「京銀ダイレクトバンキング」から決める（accounts.card_patterns）。
 */
import { normalizeMerchant } from "../../normalize";
import { toLines } from "./text";
import type { EmailParseResult, EmailParser } from "./types";

const SERVICE = /いつも(.+?)をご利用いただ/;
const DEPOSIT = /振込入金がございました/;

export const kyotoEmailParser: EmailParser = {
  id: "kyoto",
  label: "京都銀行（入金通知）",

  handles(fromAddress) {
    return /kyotobank/i.test(fromAddress);
  },

  parse(body): EmailParseResult {
    const lines = toLines(body);
    const cardLabel = lines.map((l) => l.match(SERVICE)?.[1]?.trim()).find(Boolean) ?? null;

    if (!lines.some((l) => DEPOSIT.test(l))) {
      // ログイン通知・お知らせなど
      return { kind: "other", cardLabel, usages: [], error: null };
    }

    const dateText = field(lines, "入金日");
    const amountText = field(lines, "入金額");
    const when = toJpDateTime(dateText);
    const amount = toYenMark(amountText);
    if (!when || amount === null) {
      return {
        kind: "error",
        cardLabel,
        usages: [],
        error: `入金日か入金額を読み取れませんでした（入金日: ${dateText ?? "なし"} / 入金額: ${amountText ?? "なし"}）`,
      };
    }

    const merchant = field(lines, "内容") ?? "";
    return {
      kind: "usage",
      cardLabel,
      usages: [
        {
          date: when.date,
          time: when.time,
          amount,
          direction: "in",
          merchant,
          matchText: merchant,
          memo: null,
          needsReview: false,
          dedupSeed: `email:${when.date}:${when.time}:in:${amount}:${normalizeMerchant(merchant)}`,
        },
      ],
      error: null,
    };
  },
};

/** `入金額 :¥284,988` のように、項目名と値が同じ行にある形から値を取る */
function field(lines: string[], name: string): string | null {
  for (const line of lines) {
    const m = line.match(new RegExp(`^${name}\\s*:\\s*(.+)$`));
    if (m) return m[1].trim();
  }
  return null;
}

/** `2026年09月25日 01時05分58秒` → { date: "2026-09-25", time: "01:05:58" } */
function toJpDateTime(text: string | null): { date: string; time: string } | null {
  const m = text?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})時(\d{1,2})分(\d{1,2})秒/);
  if (!m) return null;
  const pad = (s: string) => s.padStart(2, "0");
  return {
    date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`,
    time: `${pad(m[4])}:${pad(m[5])}:${pad(m[6])}`,
  };
}

/** `¥284,988` → 284988 */
function toYenMark(text: string | null): number | null {
  const m = text?.match(/[¥\\]\s*([0-9][0-9,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
