/**
 * 三井住友カード（Vpass）の利用通知メール。
 * 実物で確認済み（2026-09-23 / 差出人 statement@vpass.ne.jp）。
 *
 *   いつも三井住友カードをご利用いただきありがとうございます。
 *   三井住友カードデビュープラスＶＩＳＡについてカードの利用内容をお知らせします。
 *
 *   ご利用日時：2026/09/23 16:54
 *   ユニクロ・ＧＵ・ＰＬＳＴオンライン（買物）    9,980円
 *
 * **本文にカード名が入る。** 銀行明細では Amazonカードとデビュープラスを
 * 区別できない（9.3）が、メールなら振り分けられる。
 *
 * ただし本文の注意書きにあるとおり、
 *   「携帯電話や公共料金などの継続的なご利用、及び ETCやPiTaPa等、
 *     一部の電子マネー利用については通知されません」
 * サブスク・電気代・ICOCAチャージは**メールに現れない**。
 * このカードの固定費は Vpass のCSVでしか取れない（13章）。
 */
import { normalizeMerchant } from "../../normalize";
import { splitUsageKind, toDateTime, toLines, toYen } from "./text";
import type { EmailParseResult, EmailParser, ParsedUsage } from "./types";

/** 「〜についてカードの利用内容をお知らせします」からカード名を取る */
const CARD_LINE = /^(.+?)について、?カードの(?:ご)?利用内容/;
const USAGE_AT = /^ご利用日時/;
/** 利用先と金額は同じ行に空白区切りで並ぶ */
const MERCHANT_AND_AMOUNT = /^(.+?)[\s　]+([0-9][0-9,]*)\s*円$/;
const AMOUNT_ONLY = /^([0-9][0-9,]*)\s*円$/;

export const smbcEmailParser: EmailParser = {
  id: "smbc",
  label: "三井住友カード（Vpass）",

  handles(fromAddress) {
    return /vpass\.ne\.jp|smbc-card\.(co\.jp|com)/i.test(fromAddress);
  },

  parse(body): EmailParseResult {
    const lines = toLines(body);

    const cardLabel = lines.reduce<string | null>(
      (found, line) => found ?? line.match(CARD_LINE)?.[1]?.trim() ?? null,
      null,
    );

    const starts = lines.flatMap((line, i) => (USAGE_AT.test(line) ? [i] : []));
    if (starts.length === 0) {
      // 宣伝・ログイン通知・設定変更の確認など。取り込む対象ではない
      return { kind: "other", cardLabel, usages: [], error: null };
    }

    const usages: ParsedUsage[] = [];
    for (const start of starts) {
      const usage = readUsage(lines, start, starts);
      if (usage) usages.push(usage);
    }

    if (usages.length === 0) {
      return {
        kind: "error",
        cardLabel,
        usages: [],
        error: "ご利用日時はあるのに、利用先と金額を読み取れませんでした（文面が変わった可能性）",
      };
    }

    return { kind: "usage", cardLabel, usages, error: null };
  },
};

function readUsage(lines: string[], start: number, allStarts: number[]): ParsedUsage | null {
  // 日時は見出しと同じ行にある。無ければ直後の行を見る
  const when = toDateTime(lines[start]) ?? toDateTime(lines[start + 1] ?? "");
  if (!when) return null;

  const nextStart = allStarts.find((i) => i > start) ?? lines.length;
  const limit = Math.min(nextStart, start + 10);

  for (let i = start + 1; i < limit; i++) {
    const line = lines[i];
    if (line === "") continue;

    // 「利用先  金額円」の1行。ふつうはこちら
    let merchantText: string | null = null;
    let amount: number | null = null;

    const both = line.match(MERCHANT_AND_AMOUNT);
    if (both) {
      merchantText = both[1].trim();
      amount = toYen(`${both[2]}円`);
    } else if (AMOUNT_ONLY.test(line)) {
      // 金額だけが行になっている場合は、直前の空でない行を利用先とみなす
      amount = toYen(line);
      merchantText = lastNonEmpty(lines, i, start);
    }

    if (!merchantText || amount === null) continue;
    // 日時の行そのものを拾わないようにする
    if (USAGE_AT.test(merchantText)) continue;

    const { name, kind } = splitUsageKind(merchantText);
    const cashing = kind !== null && kind.includes("キャッシング");

    return {
      date: when.date,
      time: when.time,
      amount,
      merchant: name,
      matchText: name,
      memo: kind && kind !== "買物" ? `利用区分: ${kind}` : null,
      needsReview: cashing,
      dedupSeed: `email:${when.date}:${when.time ?? ""}:${amount}:${normalizeMerchant(name)}`,
    };
  }

  return null;
}

function lastNonEmpty(lines: string[], before: number, floor: number): string | null {
  for (let i = before - 1; i > floor; i--) {
    if (lines[i] !== "") return lines[i];
  }
  return null;
}
