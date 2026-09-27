"use client";

import Link from "next/link";
import { useState } from "react";
import { yen } from "@/lib/format";

export type MonthBar = { ym: string; label: string; amount: number };

/**
 * 月ごとの支出の棒グラフ（1系列なので凡例は出さない。見出しが系列名）。
 *
 * 数字は棒の上に全部並べず、上の読み取り欄に1つだけ出す。触れている月（なければ選択中の月）の値。
 * iPhone にはホバーが無いので、棒は押すとその月の分析に移るリンクにしてある。
 */
export function MonthlyBars({ bars, selected }: { bars: MonthBar[]; selected: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...bars.map((b) => b.amount), 1);
  const shown = bars.find((b) => b.ym === (hover ?? selected)) ?? bars[bars.length - 1];

  return (
    <figure>
      <p className="text-sm tabular-nums" aria-live="polite">
        <span className="text-slate-400">{shown.label}</span>{" "}
        <span className="font-semibold text-slate-100">{yen(shown.amount)}</span>
      </p>
      <div className="mt-3 flex h-36 items-end gap-1 border-b border-slate-700" onPointerLeave={() => setHover(null)}>
        {bars.map((b) => {
          const active = b.ym === selected;
          return (
            <Link
              key={b.ym}
              href={`/analysis?month=${b.ym}`}
              aria-label={`${b.label} ${yen(b.amount)}`}
              aria-current={active ? "page" : undefined}
              onPointerEnter={() => setHover(b.ym)}
              onFocus={() => setHover(b.ym)}
              onBlur={() => setHover(null)}
              // 当たり判定は棒より大きく、列の高さいっぱいにとる
              className="flex h-full flex-1 items-end"
            >
              <span
                className="block w-full rounded-t"
                style={{
                  height: `${Math.max((b.amount / max) * 100, b.amount > 0 ? 2 : 0)}%`,
                  background: "#3987e5",
                  opacity: active || hover === b.ym ? 1 : 0.45,
                }}
              />
            </Link>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-slate-500">
        {bars.map((b, i) => (
          <span key={b.ym} className="flex-1 text-center tabular-nums">
            {/* 月の目盛りは1つおき。狭い画面で詰まらないように */}
            {i % 2 === bars.length % 2 ? `${Number(b.ym.slice(5))}月` : ""}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">月ごとの支出。棒を押すとその月の分析を表示します</figcaption>
    </figure>
  );
}
