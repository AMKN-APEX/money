"use client";

import { useState, useTransition } from "react";
import { analyzeSpending, type AiAnalysisState } from "@/app/(main)/analysis/actions";

/**
 * AI に支出の分析を頼むボタン。押したときだけ呼ぶ（呼ぶたびに料金がかかるため、開いただけでは呼ばない）。
 */
export function AiAnalysis({ ym, label }: { ym: string; label: string }) {
  const [state, setState] = useState<AiAnalysisState & { ym: string | null }>({
    text: null,
    error: null,
    ym: null,
  });
  const [pending, startTransition] = useTransition();

  // 別の月に移ったら、前の月の分析は出さない
  const current = state.ym === ym ? state : { text: null, error: null };

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await analyzeSpending(ym);
            setState({ ...result, ym });
          })
        }
        className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
      >
        {pending ? "分析しています…（30秒ほどかかります）" : `${label}の使い方をAIに見てもらう`}
      </button>

      {current.error && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
          {current.error}
        </p>
      )}

      {current.text && (
        <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm leading-relaxed text-slate-200">
          {current.text}
        </div>
      )}
    </div>
  );
}
