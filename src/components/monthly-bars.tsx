"use client";

import Link from "next/link";
import { useState } from "react";
import { yen } from "@/lib/format";

export type MonthBar = { ym: string; label: string; amount: number };

/** 目盛りの上限を 1・2・5 × 10ⁿ に切り上げる（読みやすい区切りにするため） */
function niceCeil(n: number): number {
  if (n <= 0) return 10000;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}

/** 目盛りの表記。1万以上は「12万」、未満は「5,000」 */
function short(n: number): string {
  if (n === 0) return "0";
  if (n >= 10000) return `${Number((n / 10000).toFixed(1))}万`;
  return n.toLocaleString("ja-JP");
}

/**
 * 月ごとの支出の棒グラフ（1系列なので凡例は出さない。見出しが系列名）。
 *
 * 数字は棒の上に全部並べず、上の読み取り欄に1つだけ出す。触れている月（なければ選択中の月）の値。
 * iPhone にはホバーが無いので、棒は押すとその月の分析に移るリンクにしてある。
 * 縦軸は 0・半分・上限 の3本だけ。線は目立たない色にする。
 */
export function MonthlyBars({ bars, selected }: { bars: MonthBar[]; selected: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const top = niceCeil(Math.max(...bars.map((b) => b.amount), 0));
  const ticks = [top, top / 2, 0];
  const shown = bars.find((b) => b.ym === (hover ?? selected)) ?? bars[bars.length - 1];

  return (
    <figure>
      <p className="text-sm tabular-nums" aria-live="polite">
        <span className="text-slate-400">{shown.label}</span>{" "}
        <span className="font-semibold text-slate-100">{yen(shown.amount)}</span>
      </p>
      <div className="mt-3 flex gap-2">
        {/* 縦軸の目盛り */}
        <div className="relative h-36 w-9 shrink-0 text-right text-[10px] text-slate-500 tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>
              {short(t)}
            </span>
          ))}
        </div>
        <div className="flex-1">
          <div className="relative flex h-36 items-end gap-1" onPointerLeave={() => setHover(null)}>
            {/* 目盛り線。棒の後ろに敷く */}
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 border-t ${t === 0 ? "border-slate-600" : "border-slate-800"}`}
                style={{ top: `${100 - (t / top) * 100}%` }}
              />
            ))}
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
                  className="relative flex h-full flex-1 items-end"
                >
                  <span
                    className="block w-full rounded-t"
                    style={{
                      height: `${Math.max((b.amount / top) * 100, b.amount > 0 ? 2 : 0)}%`,
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
                {/* 月の目盛りは1つおき。狭い画面で詰まらないように。いちばん新しい月は必ず出す */}
                {i % 2 === (bars.length - 1) % 2 ? `${Number(b.ym.slice(5))}月` : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">月ごとの支出。棒を押すとその月の分析を表示します</figcaption>
    </figure>
  );
}
