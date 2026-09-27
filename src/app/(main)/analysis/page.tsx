import Link from "next/link";
import { loadAnalysis } from "@/lib/analysis-data";
import { averageByCategory, topMerchants } from "@/lib/spending";
import { isYearMonth, monthRange, todayJst, yen } from "@/lib/format";
import { MonthlyBars } from "@/components/monthly-bars";
import { CategoryDonut } from "@/components/category-donut";
import { assignColors, colorOf } from "@/lib/category-colors";

/** 3ヶ月平均との差を「▲ +1,234円」の形で。色だけに頼らず記号と符号も付ける */
function Delta({ diff }: { diff: number }) {
  if (diff === 0) return <span className="text-slate-500">±0</span>;
  const up = diff > 0;
  return (
    <span className={up ? "text-rose-400" : "text-emerald-400"}>
      {up ? "▲ +" : "▼ −"}
      {yen(Math.abs(diff)).replace("￥", "")}
    </span>
  );
}

export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  const params = await searchParams;
  const raw = typeof params.month === "string" ? params.month : "";
  const thisMonth = todayJst().slice(0, 7);
  const ym = isYearMonth(raw) && raw <= thisMonth ? raw : thisMonth;
  const month = monthRange(ym);

  // 色の割り当ては「今月までの12ヶ月」で決める。どの月を開いても同じ費目は同じ色にするため
  const [data, latest] = await Promise.all([
    loadAnalysis(ym),
    ym === thisMonth ? null : loadAnalysis(thisMonth),
  ]);
  if (data.error) {
    return (
      <p className="rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
        読み込めませんでした: {data.error}
      </p>
    );
  }

  const current = data.summaries[data.summaries.length - 1];
  const previous = data.summaries[data.summaries.length - 2];
  const average3 = averageByCategory(data.summaries.slice(-4, -1));
  const average3Total = Math.round(
    data.summaries.slice(-4, -1).reduce((a, m) => a + m.expense, 0) / 3,
  );
  const merchants = topMerchants(data.rows, data.categories, ym);
  const colors = assignColors((latest ?? data).summaries);
  const partial = ym === thisMonth;

  const bars = data.summaries.map((m) => ({
    ym: m.ym,
    label: monthRange(m.ym).label,
    amount: m.expense,
  }));

  return (
    <>
      {/* 月の切り替え */}
      <div className="flex items-center justify-between">
        <Link href={`/analysis?month=${month.prev}`} aria-label="前の月" className="rounded-lg px-3 py-2 text-slate-400">
          ←
        </Link>
        <h1 className="text-lg font-bold">{month.label}の分析</h1>
        {ym < thisMonth ? (
          <Link href={`/analysis?month=${month.next}`} aria-label="次の月" className="rounded-lg px-3 py-2 text-slate-400">
            →
          </Link>
        ) : (
          <span className="px-3 py-2 text-slate-700" aria-hidden>
            →
          </span>
        )}
      </div>

      {/* 今月の支出（ヒーロー数値）と、比べる相手 */}
      <section className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-sm text-slate-400">支出{partial && "（今日まで）"}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{yen(current.expense)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-slate-950/60 p-2.5">
            <dt className="text-slate-500">先月 {yen(previous.expense)}</dt>
            <dd className="mt-0.5 text-sm tabular-nums">
              <Delta diff={current.expense - previous.expense} />
            </dd>
          </div>
          <div className="rounded-xl bg-slate-950/60 p-2.5">
            <dt className="text-slate-500">3ヶ月平均 {yen(average3Total)}</dt>
            <dd className="mt-0.5 text-sm tabular-nums">
              <Delta diff={current.expense - average3Total} />
            </dd>
          </div>
        </dl>
        {/* 収入と収支。支出だけ見ていると、足りているのかが分からない */}
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-slate-950/60 p-2.5">
            <dt className="text-slate-500">収入</dt>
            <dd className="mt-0.5 text-sm tabular-nums">{yen(current.income)}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/60 p-2.5">
            <dt className="text-slate-500">収支（収入 − 支出）</dt>
            <dd
              className={`mt-0.5 text-sm tabular-nums ${
                current.income - current.expense < 0 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {current.income - current.expense < 0 ? "▼ " : "▲ "}
              {yen(current.income - current.expense)}
            </dd>
          </div>
        </dl>
        {current.extraordinary !== 0 && (
          <p className="mt-3 text-xs text-slate-500">別枠（特別支出・経費精算）: {yen(current.extraordinary)}</p>
        )}
      </section>

      {/* 費目ごと。ドーナツで全体の割合を見て、下の一覧で金額と3ヶ月平均との差を見る */}
      <section className="mt-6">
        <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold text-slate-400">
          <span>何に使ったか</span>
          <span className="text-xs font-normal text-slate-500">右端は3ヶ月平均との差</span>
        </h2>
        {current.byCategory.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            この月の支出はまだありません
          </p>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <CategoryDonut categories={current.byCategory} total={current.expense} colors={colors} />
            {/* 凡例を兼ねた一覧。色だけに頼らないよう、名前と金額を必ず並べる */}
            <ul className="mt-4 divide-y divide-slate-800 text-sm">
              {current.byCategory.map((c) => {
                const share = current.expense > 0 ? Math.round((c.amount / current.expense) * 100) : 0;
                return (
                  <li key={c.name} className="flex items-center gap-2 py-2">
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: colorOf(colors, c.name) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 tabular-nums">{yen(c.amount)}</span>
                    <span className="w-9 shrink-0 text-right text-xs text-slate-500 tabular-nums">{share}%</span>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums">
                      <Delta diff={c.amount - (average3.get(c.name) ?? 0)} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* 月ごとの比較 */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-400">月ごとの支出（12ヶ月）</h2>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <MonthlyBars bars={bars} selected={ym} />
          <details className="mt-3 text-xs text-slate-400">
            <summary className="cursor-pointer">表で見る</summary>
            <table className="mt-2 w-full tabular-nums">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 text-left font-normal">月</th>
                  <th className="py-1 text-right font-normal">支出</th>
                  <th className="py-1 text-right font-normal">収入</th>
                </tr>
              </thead>
              <tbody>
                {[...data.summaries].reverse().map((m) => (
                  <tr key={m.ym} className="border-t border-slate-800">
                    <td className="py-1">{monthRange(m.ym).label}</td>
                    <td className="py-1 text-right text-slate-200">{yen(m.expense)}</td>
                    <td className="py-1 text-right">{yen(m.income)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </section>

      {/* お金を使った店 */}
      {merchants.length > 0 && (
        <section className="mt-6 mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-400">よく使った店</h2>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 text-sm">
            {merchants.map((m) => (
              <li key={m.merchant} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="truncate">{m.merchant}</span>
                <span className="shrink-0 tabular-nums">
                  {yen(m.amount)}
                  {m.count > 1 && <span className="ml-1 text-xs text-slate-500">{m.count}回</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
