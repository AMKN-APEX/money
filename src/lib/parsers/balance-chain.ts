import type { ParsedRow } from "./types";

/**
 * 残高チェーン検証。設計 docs/design.md 9.5。
 *
 *     前行の残高 + 入金 - 出金 == 当行の残高
 *
 * 京都銀行は前々月までしか遡れないため、取り込み漏れに気づけないと
 * データが永久に欠ける。機械的に検出できる唯一の手段がこれ。
 */
export type ChainIssue = {
  lineNo: number;
  date: string;
  expected: number;
  actual: number;
  /** 不足している金額。プラスなら「この行の前に入金が抜けている」 */
  diff: number;
};

export function verifyBalanceChain(rows: ParsedRow[]): {
  ok: boolean;
  checked: number;
  issues: ChainIssue[];
} {
  const issues: ChainIssue[] = [];
  let checked = 0;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (prev.balanceAfter === null || cur.balanceAfter === null) continue;

    checked++;
    const delta = cur.direction === "in" ? cur.amount : -cur.amount;
    const expected = prev.balanceAfter + delta;
    if (expected !== cur.balanceAfter) {
      issues.push({
        lineNo: cur.lineNo,
        date: cur.date,
        expected,
        actual: cur.balanceAfter,
        diff: cur.balanceAfter - expected,
      });
    }
  }

  return { ok: issues.length === 0, checked, issues };
}

/**
 * ファイル末尾の残高と、その時点の日付。
 * 開始残高の逆算に使う（取引の積み上げと銀行の残高の差が開始残高）。
 */
export function lastKnownBalance(rows: ParsedRow[]): { date: string; balance: number } | null {
  if (rows.length === 0) return null;

  // 日付の最大を取り、その日の中ではファイル上いちばん後ろの行を採る。
  // 同日に複数件あるとき、途中の行の残高を使うと締めがずれる。
  const maxDate = rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date === maxDate && rows[i].balanceAfter !== null) {
      return { date: maxDate, balance: rows[i].balanceAfter as number };
    }
  }
  return null;
}
