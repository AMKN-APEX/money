/**
 * 三井住友カード（Vpass）の利用通知メール。
 * 実物で確認済み（2026-09-23 / 差出人 statement@vpass.ne.jp）。
 *
 * GAS は getPlainBody() でメールを送ってくる。HTMLメールでも届くのは
 * **プレーンテキスト版**であり、メールアプリの画面とは中身が違う。
 * 実物はこの形:
 *
 *   ご利用カード：三井住友カードデビュープラスＶＩＳＡ
 *
 *   ◇利用日：2026/09/23 12:50
 *   ◇利用先：エスト／ＮＦＣ
 *   ◇利用取引：買物
 *   ◇利用金額：4,400円
 *
 * 項目名が付いて縦に並ぶ。当初は画面の見た目（表で左右に並ぶ）に合わせて
 * 書いてしまい、`ご利用日時` を探して見つからず、利用通知を丸ごと
 * 対象外に落としていた。**現物のテキストを見てから書くこと。**
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

/** `ご利用カード：三井住友カードデビュープラスＶＩＳＡ` */
const CARD = /(?:ご利用カード|カード名称?)\s*[：:]\s*(\S.*)$/;
/** HTML版の言い回し。プレーンテキストが無いメールへの保険 */
const CARD_HEADLINE = /^(.+?)について、?カードの(?:ご)?利用内容/;

/** 項目名。先頭の ◇ ■ ● は付いたり付かなかったりする */
const label = (name: string) => new RegExp(`[◇■●・]?\s*(?:ご)?${name}\s*[：:]\s*(.*)$`);
const USED_AT = label("利用日(?:時)?");
const MERCHANT = label("利用先");
const USAGE_KIND = label("利用取引");
const AMOUNT = label("利用金額");

/** 項目名が無い版（HTMLから落ちたテキスト）では、利用先と金額が1行に並ぶ */
const MERCHANT_AND_AMOUNT = /^(.+?)[\s　]+([0-9][0-9,]*)\s*円$/;
const AMOUNT_ONLY = /^([0-9][0-9,]*)\s*円$/;

/** 1件ぶんの記載がどこまで続くか。次の利用日か、この行数まで */
const BLOCK_LINES = 12;

export const smbcEmailParser: EmailParser = {
  id: "smbc",
  label: "三井住友カード（Vpass）",

  handles(fromAddress) {
    return /vpass\.(ne\.)?jp|smbc-card\.(co\.jp|com)/i.test(fromAddress);
  },

  parse(body): EmailParseResult {
    const lines = toLines(body);
    const cardLabel = findCardLabel(lines);

    const starts = lines.flatMap((line, i) => (USED_AT.test(line) ? [i] : []));
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
      // 何をどう読み損ねたのか、直すのに要る情報を画面に出す。
      // 文面を見に行かなくても、受信箱の表示だけで原因が分かるようにする。
      const around = lines
        .slice(starts[0], starts[0] + 6)
        .filter((line) => line !== "")
        .join(" ⏎ ")
        .slice(0, 160);
      return {
        kind: "error",
        cardLabel,
        usages: [],
        error: `利用日はあるのに、利用先と金額を読み取れませんでした。該当箇所: ${around}`,
      };
    }

    return { kind: "usage", cardLabel, usages, error: null };
  },
};

function findCardLabel(lines: string[]): string | null {
  for (const line of lines) {
    const named = line.match(CARD);
    if (named) return named[1].trim();
  }
  for (const line of lines) {
    const headline = line.match(CARD_HEADLINE);
    if (headline) return headline[1].trim();
  }
  return null;
}

function readUsage(lines: string[], start: number, allStarts: number[]): ParsedUsage | null {
  const when = toDateTime(lines[start].match(USED_AT)?.[1] ?? lines[start]);
  if (!when) return null;

  const nextStart = allStarts.find((i) => i > start) ?? lines.length;
  const limit = Math.min(nextStart, start + BLOCK_LINES, lines.length);
  const block = lines.slice(start + 1, limit);

  const found = readLabelled(block) ?? readInline(block);
  if (!found) return null;

  const { name, kind } = splitUsageKind(found.merchant);
  const usageKind = found.kind ?? kind;
  const cashing = usageKind !== null && usageKind.includes("キャッシング");

  return {
    date: when.date,
    time: when.time,
    amount: found.amount,
    merchant: name,
    matchText: name,
    memo: usageKind && usageKind !== "買物" ? `利用区分: ${usageKind}` : null,
    needsReview: cashing,
    dedupSeed: `email:${when.date}:${when.time ?? ""}:${found.amount}:${normalizeMerchant(name)}`,
  };
}

type Found = { merchant: string; amount: number; kind: string | null };

/** 項目名が付いている版（プレーンテキストの実物） */
function readLabelled(block: string[]): Found | null {
  let merchant: string | null = null;
  let amount: number | null = null;
  let kind: string | null = null;

  for (const line of block) {
    if (merchant === null) {
      const m = line.match(MERCHANT);
      if (m?.[1]?.trim()) {
        merchant = m[1].trim();
        continue;
      }
    }
    if (kind === null) {
      const k = line.match(USAGE_KIND);
      if (k?.[1]?.trim()) {
        kind = k[1].trim();
        continue;
      }
    }
    if (amount === null) {
      const a = line.match(AMOUNT);
      if (a) amount = toYen(a[1]);
    }
  }

  if (merchant === null || amount === null) return null;
  return { merchant, amount, kind };
}

/**
 * 項目名が無い版。
 * HTMLしか持たないメールが来た場合に備えた保険で、実物では未確認。
 */
function readInline(block: string[]): Found | null {
  for (const [i, line] of block.entries()) {
    if (line === "") continue;

    const both = line.match(MERCHANT_AND_AMOUNT);
    if (both) {
      const amount = toYen(`${both[2]}円`);
      if (amount !== null) return { merchant: both[1].trim(), amount, kind: null };
    }

    if (AMOUNT_ONLY.test(line)) {
      const amount = toYen(line);
      const merchant = lastNonEmpty(block, i);
      if (amount !== null && merchant) return { merchant, amount, kind: null };
    }
  }
  return null;
}

function lastNonEmpty(block: string[], before: number): string | null {
  for (let i = before - 1; i >= 0; i--) {
    if (block[i] !== "") return block[i];
  }
  return null;
}
