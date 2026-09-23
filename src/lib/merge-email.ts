import { normalizeMerchant } from "./normalize";
import type { TxStatus } from "./types";

/**
 * メール速報とCSVの重複排除。設計: docs/design.md 3章。
 *
 *   dedup_key = 日付±3日 + 金額一致 + 正規化店名の類似度
 *   CSV を正とし、メール由来レコードを上書きマージする
 *
 * 同じ買い物が両方から入るため、これが無いと二重計上になる。
 * メール速報は「承認照会」の通知であって確定ではない（13章）ので、
 * 確定値であるCSVを正とし、メール由来の行を**置き換える**。新しく足さない。
 *
 * 日付がずれるのは、速報が売上データの到着時に配信されるため。
 * 利用した日と、カード会社に売上が届く日は一致しない。
 */

export type EmailTransaction = {
  id: string;
  date: string;
  amount: number;
  merchant_normalized: string | null;
  category_id: string | null;
  status: TxStatus;
  memo: string | null;
};

export type MergeTarget = { date: string; amount: number; matchText: string };

export type MergeDecision =
  | { kind: "insert" }
  | { kind: "merge"; target: EmailTransaction }
  /** 金額と日付は合うのに、どれと同じか決められない。人に見せる */
  | { kind: "ambiguous"; candidates: EmailTransaction[] };

/** 速報の配信と利用日のずれをどこまで許すか */
const DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 店名が出ないカードの、店名の代わりに入っている文字列。
 * ポケットカードは「ポケットカード加盟店」「VISA加盟店」等しか出さない（13章）。
 * これらは店名として比較しても意味がないので、金額と日付だけで照合する。
 */
const PLACEHOLDER = /加盟店$|キヤツシング/;

export function findEmailMatch(
  row: MergeTarget,
  candidates: EmailTransaction[],
  usedIds: ReadonlySet<string> = new Set(),
): MergeDecision {
  const near = candidates.filter(
    (c) => !usedIds.has(c.id) && c.amount === row.amount && within(row.date, c.date),
  );
  if (near.length === 0) return { kind: "insert" };

  const rowMerchant = normalizeMerchant(row.matchText);

  const strong: EmailTransaction[] = [];
  const weak: EmailTransaction[] = [];

  for (const c of near) {
    const candidateMerchant = c.merchant_normalized ?? "";
    if (comparable(rowMerchant) && comparable(candidateMerchant)) {
      // どちらも店名が分かる。似ていなければ別の買い物とみなす
      if (looksSame(rowMerchant, candidateMerchant)) strong.push(c);
    } else {
      // 片方でも店名が無いなら、金額と日付だけで判断するしかない
      weak.push(c);
    }
  }

  if (strong.length > 0) return { kind: "merge", target: closest(row.date, strong) };
  if (weak.length === 1) return { kind: "merge", target: weak[0] };
  // 店名で絞れないまま候補が複数。取り違えるより人に決めてもらう
  if (weak.length > 1) return { kind: "ambiguous", candidates: weak };
  return { kind: "insert" };
}

function within(a: string, b: string): boolean {
  const diff = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return diff <= DAYS * DAY_MS;
}

function comparable(merchant: string): boolean {
  return merchant !== "" && !PLACEHOLDER.test(merchant);
}

/**
 * 同じ店とみなせるか。
 * CSVの摘要は途中で切れることがある（9.2）ので、前方一致も同じ店として扱う。
 */
function looksSame(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return commonPrefix(a, b) >= 4;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function closest(date: string, candidates: EmailTransaction[]): EmailTransaction {
  return candidates.reduce((best, c) =>
    Math.abs(Date.parse(c.date) - Date.parse(date)) <
    Math.abs(Date.parse(best.date) - Date.parse(date))
      ? c
      : best,
  );
}

/**
 * マージするとき、分類を上書きしてよいか。
 * 人が未分類トレイで決めた費目や、ルールで確定した費目を壊さない。
 */
export function keepsClassification(target: EmailTransaction): boolean {
  return target.status === "confirmed" && target.category_id !== null;
}
