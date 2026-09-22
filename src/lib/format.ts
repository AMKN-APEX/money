const YEN = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

/** 円。小数は扱わない */
export function yen(amount: number | null | undefined): string {
  return YEN.format(amount ?? 0);
}

/** 2026-09-22 → 9/22(火) */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00+09:00`);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}

/** 今日（JST）を YYYY-MM-DD で返す */
export function todayJst(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

/** YYYY-MM の月範囲。前後の月も返す */
export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  };
  return {
    ym,
    from: `${ym}-01`,
    to: `${ym}-${pad(lastDay)}`,
    label: `${y}年${m}月`,
    prev: shift(-1),
    next: shift(1),
  };
}

/** 当月（JST基準） */
export function currentMonthRange(now = new Date()) {
  return monthRange(todayJst(now).slice(0, 7));
}

/** YYYY-MM として妥当か */
export function isYearMonth(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
