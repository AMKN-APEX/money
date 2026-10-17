"use client";

import { useState } from "react";
import { yen } from "@/lib/format";

export type NetWorthDot = { ym: string; label: string; net: number | null };

/** 1・2・5 × 10ⁿ の刻み。目盛りを読みやすい区切りにするため */
function niceStep(span: number): number {
  const raw = span / 2;
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
}

/** 目盛りの表記。1万以上は「120万」、未満は「5,000」 */
function short(n: number): string {
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 10000) return `${sign}${Number((a / 10000).toFixed(1))}万`;
  return `${sign}${a.toLocaleString("ja-JP")}`;
}

/**
 * 月末の純資産の折れ線（1系列なので凡例は出さない。見出しが系列名）。
 *
 * 支出の棒グラフ（monthly-bars）と同じ作りにしてある: 数字は上の読み取り欄に1つだけ出し、
 * 触れている月（なければいちばん新しい月）の値と先月との差を見せる。
 * 縦軸は0から始めない。純資産は大きな額の上の小さな増減を見たいので、0からだと線が平らになる。
 * 残高が分からない月（null）は点を打たず、線も途切れさせる。
 */
export function NetWorthLine({ dots }: { dots: NetWorthDot[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const known = dots.filter((d): d is NetWorthDot & { net: number } => d.net !== null);
  if (known.length === 0) return null;

  const values = known.map((d) => d.net);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = niceStep(Math.max(max - min, Math.abs(max) * 0.02, 10000));
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const ticks = [hi, (hi + lo) / 2, lo];

  const x = (i: number) => ((i + 0.5) / dots.length) * 100;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;

  // 途切れのある線。分からない月で区切る
  const segments: string[] = [];
  let current: string[] = [];
  dots.forEach((d, i) => {
    if (d.net === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else current.push(`${x(i)},${y(d.net)}`);
  });
  if (current.length) segments.push(current.join(" "));

  const latest = dots.indexOf(known[known.length - 1]);
  const hovered = hover ? dots.findIndex((d) => d.ym === hover) : -1;
  const shownIndex = hovered >= 0 ? hovered : latest;
  const shown = dots[shownIndex];
  const before = shownIndex > 0 ? dots[shownIndex - 1].net : null;
  const diff = shown.net !== null && before !== null ? shown.net - before : null;

  return (
    <figure>
      <p className="text-sm tabular-nums" aria-live="polite">
        <span className="text-slate-400">{shown.label}末</span>{" "}
        {shown.net === null ? (
          <span className="text-slate-500">記録なし</span>
        ) : (
          <>
            <span className="font-semibold text-slate-100">{yen(shown.net)}</span>
            {diff !== null && (
              <span className={`ml-2 text-xs ${diff < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                先月比 {diff < 0 ? "▼ −" : "▲ +"}
                {yen(Math.abs(diff)).replace("￥", "")}
              </span>
            )}
          </>
        )}
      </p>
      <div className="mt-3 flex gap-2">
        {/* 縦軸の目盛り */}
        <div className="relative h-36 w-10 shrink-0 text-right text-[10px] text-slate-500 tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {short(t)}
            </span>
          ))}
        </div>
        <div className="flex-1">
          <div className="relative h-36" onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-slate-800"
                style={{ top: `${y(t)}%` }}
              />
            ))}
            {/* 線。横に伸びても太さが変わらないよう non-scaling-stroke にする */}
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {segments.map((points) => (
                <polyline
                  key={points}
                  points={points}
                  fill="none"
                  stroke="#3987e5"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {/* 点は HTML で置く（SVG を伸ばすと丸が楕円になるため） */}
            {dots.map((d, i) =>
              d.net === null ? null : (
                <span
                  key={d.ym}
                  aria-hidden
                  className="pointer-events-none absolute h-2 w-2 rounded-full ring-2 ring-slate-900"
                  style={{
                    left: `${x(i)}%`,
                    top: `${y(d.net)}%`,
                    background: "#3987e5",
                    transform: `translate(-50%, -50%) scale(${i === shownIndex ? 1.5 : 1})`,
                  }}
                />
              ),
            )}
            {/* 当たり判定は点より大きく、列の高さいっぱいにとる */}
            <div className="absolute inset-0 flex">
              {dots.map((d) => (
                <button
                  key={d.ym}
                  type="button"
                  aria-label={`${d.label}末 ${d.net === null ? "記録なし" : yen(d.net)}`}
                  onPointerEnter={() => setHover(d.ym)}
                  onFocus={() => setHover(d.ym)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover(d.ym)}
                  className="h-full flex-1"
                />
              ))}
            </div>
          </div>
          <div className="mt-1 flex text-[10px] text-slate-500">
            {dots.map((d, i) => (
              <span key={d.ym} className="flex-1 text-center tabular-nums">
                {/* 月の目盛りは1つおき。いちばん新しい月は必ず出す */}
                {i % 2 === (dots.length - 1) % 2 ? `${Number(d.ym.slice(5))}月` : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">月末ごとの純資産の推移。点を押すとその月末の額を表示します</figcaption>
    </figure>
  );
}
