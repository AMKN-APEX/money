"use client";

import { useState } from "react";
import { yen } from "@/lib/format";
import { OTHER_COLOR, type CategoryColor } from "@/lib/category-colors";

/**
 * 費目の内訳のドーナツグラフ。色の決め方は src/lib/category-colors.ts。
 * 扇は色の表の順に並べ、隣り合う色が検証した組み合わせから外れないようにする。
 * 表に無い費目は灰色の「ほか」にまとめ、内訳は下の一覧で見る。
 */
type Slice = { name: string; amount: number; color: string };

const SIZE = 200;
const R = 80;
const WIDTH = 30;
/** 扇と扇のあいだの隙間（背景色の2px） */
const GAP = 2 / R;

function arc(start: number, end: number): string {
  // 小数を丸める。サーバーとブラウザで三角関数の末尾の桁がずれ、描画の食い違い（hydration）になる
  const round = (n: number) => Math.round(n * 100) / 100;
  const p = (a: number) => [round(SIZE / 2 + R * Math.sin(a)), round(SIZE / 2 - R * Math.cos(a))];
  const [x1, y1] = p(start);
  const [x2, y2] = p(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
}

export function CategoryDonut({
  categories,
  total,
  colors,
}: {
  categories: { name: string; amount: number }[];
  total: number;
  colors: CategoryColor[];
}) {
  const [active, setActive] = useState<string | null>(null);

  const slices: Slice[] = colors.flatMap(({ name, color }) => {
    const c = categories.find((x) => x.name === name);
    return c && c.amount > 0 ? [{ name, amount: c.amount, color }] : [];
  });
  const rest = categories
    .filter((c) => !colors.some((x) => x.name === c.name))
    .reduce((acc, c) => acc + c.amount, 0);
  if (rest > 0) slices.push({ name: "ほか", amount: rest, color: OTHER_COLOR });

  const focus = slices.find((s) => s.name === active);
  // 各扇の開始角。描画の中で足し合わせず、先に決めておく
  const sweeps = slices.map((s) => (total > 0 ? (s.amount / total) * Math.PI * 2 : 0));
  const starts = sweeps.map((_, i) => sweeps.slice(0, i).reduce((a, b) => a + b, 0));

  return (
    <div className="flex justify-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-56 max-w-full"
        role="img"
        aria-label={`費目の内訳。${slices.map((s) => `${s.name} ${yen(s.amount)}`).join("、")}`}
        onPointerLeave={() => setActive(null)}
      >
        {slices.map((s, i) => {
          const sweep = sweeps[i];
          const start = starts[i];
          // 1つしか無いときは円そのもの（弧で描くと始点と終点が重なって消える）
          if (slices.length === 1) {
            return (
              <circle key={s.name} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={s.color} strokeWidth={WIDTH} />
            );
          }
          const gap = Math.min(GAP, sweep / 3);
          return (
            <path
              key={s.name}
              d={arc(start + gap / 2, start + sweep - gap / 2)}
              fill="none"
              stroke={s.color}
              strokeWidth={active === s.name ? WIDTH + 6 : WIDTH}
              opacity={active && active !== s.name ? 0.4 : 1}
              onPointerEnter={() => setActive(s.name)}
              onClick={() => setActive(active === s.name ? null : s.name)}
              style={{ cursor: "pointer", transition: "opacity 120ms" }}
            >
              <title>{`${s.name} ${yen(s.amount)}`}</title>
            </path>
          );
        })}
        {/* 真ん中の読み取り。触れている費目、なければ合計 */}
        <text x={SIZE / 2} y={SIZE / 2 - 8} textAnchor="middle" className="fill-slate-400" fontSize="12">
          {focus ? focus.name : "支出の合計"}
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 14} textAnchor="middle" className="fill-slate-100" fontSize="18" fontWeight="700">
          {yen(focus ? focus.amount : total)}
        </text>
        {focus && total > 0 && (
          <text x={SIZE / 2} y={SIZE / 2 + 32} textAnchor="middle" className="fill-slate-400" fontSize="11">
            {Math.round((focus.amount / total) * 100)}%
          </text>
        )}
      </svg>
    </div>
  );
}
