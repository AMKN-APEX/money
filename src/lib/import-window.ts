/**
 * 「いつまでにCSVを取らないとデータが消えるか」の計算。
 * 設計 docs/design.md 9.4。
 *
 * 照会可能期間は金融機関ごとに違う。
 *   京都銀行  … 前々月まで（当月を含めて3ヶ月）→ monthsBack = 2
 *   ゆうちょ  … 先月まで（当月を含めて2ヶ月）  → monthsBack = 1
 *
 * ある月 M の明細は「M の monthsBack ヶ月後の末日」を過ぎると取得できなくなる。
 * 例: monthsBack = 1 なら、8月分は9月末を過ぎると永久に取れない。
 */

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type MissingMonth = {
  /** YYYY-MM */
  ym: string;
  /** この日を過ぎると取得できなくなる */
  deadline: string;
  /** 残り日数。0 なら今日が最終日 */
  daysLeft: number;
};

/**
 * 未取込の月を、取得期限つきで洗い出す。
 *
 * - 対象は「取得可能な最古の月」から「先月」まで。今月はまだ終わっていないので含めない
 * - すでに取得できなくなった月は諦めるしかないので出さない
 * - coveredTo がその月の末日でなければ、その月は取り直す対象にする
 */
export function missingMonths(opts: {
  today: string;
  /** 取込済みの最終日。未取込なら null */
  coveredTo: string | null;
  monthsBack: number;
}): MissingMonth[] {
  const thisMonth = monthOf(opts.today);
  const lastMonth = addMonths(thisMonth, -1);
  const oldestAvailable = addMonths(thisMonth, -opts.monthsBack);

  let start: string;
  if (opts.coveredTo === null) {
    start = oldestAvailable;
  } else {
    const covered = monthOf(opts.coveredTo);
    // その月の末日まで埋まっていれば次の月から、途中までなら同じ月をやり直す
    start = opts.coveredTo >= lastDayOf(covered) ? addMonths(covered, 1) : covered;
    if (start < oldestAvailable) start = oldestAvailable;
  }

  const result: MissingMonth[] = [];
  for (let ym = start; ym <= lastMonth; ym = addMonths(ym, 1)) {
    const deadline = lastDayOf(addMonths(ym, opts.monthsBack));
    result.push({ ym, deadline, daysLeft: daysBetween(opts.today, deadline) });
  }
  return result;
}

/** 2026-08 → 8月 */
export function monthLabel(ym: string): string {
  return `${Number(ym.slice(5, 7))}月`;
}
