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

/** 当月の範囲（JST基準）を YYYY-MM-DD で返す */
export function currentMonthRange(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: first, to: `${y}-${pad(m + 1)}-${pad(lastDay)}`, label: `${y}年${m + 1}月` };
}
