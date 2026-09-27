/**
 * 分析画面で費目に付ける色。サーバー（一覧の色見本）とブラウザ（ドーナツ）の両方で使う。
 *
 * **色は費目に固定する（その月の順位で塗らない）。** 月を切り替えても同じ費目は同じ色になるよう、
 * 「今月までの12ヶ月でよく使った順」の上位8費目に色を割り当てる。どの月を開いても同じ割り当てになる。
 * 最初は費目名で決め打ちしたが、現金引出・家電・医療のように決め打ちから漏れた費目が灰色の
 * 「ほか」に固まり、ドーナツの3分の1が灰色になって読めなかった（2026-09-27）。
 *
 * 8色は dataviz の検証スクリプトで、この順に隣り合う組み合わせを確認済み
 * （アプリの背景 #0f172a に対して、色覚の違いでも見分けられる）。ドーナツの扇もこの順に並べる。
 */
import type { MonthSummary } from "./spending";

export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const OTHER_COLOR = "#64748b";

export type CategoryColor = { name: string; color: string };

/** 12ヶ月の合計が多い順に、上位8費目へ色を割り当てる */
export function assignColors(summaries: MonthSummary[]): CategoryColor[] {
  const totals = new Map<string, number>();
  for (const m of summaries) {
    for (const c of m.byCategory) totals.set(c.name, (totals.get(c.name) ?? 0) + c.amount);
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, PALETTE.length)
    .map(([name], i) => ({ name, color: PALETTE[i] }));
}

export function colorOf(colors: CategoryColor[], name: string): string {
  return colors.find((c) => c.name === name)?.color ?? OTHER_COLOR;
}
