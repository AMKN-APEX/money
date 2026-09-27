"use server";

import Anthropic from "@anthropic-ai/sdk";
import { loadAnalysis } from "@/lib/analysis-data";
import { averageByCategory, topMerchants } from "@/lib/spending";
import { isYearMonth, monthRange, todayJst } from "@/lib/format";

export type AiAnalysisState = { text: string | null; error: string | null };

/**
 * 支出の分析を Claude に頼む。
 *
 * 渡すのは月ごと・費目ごとの合計と、その月の店の上位だけ。取引の明細や口座の情報は渡さない。
 * 数字はサーバーで集計し直す（画面から送られてきた数字は使わない）。
 */
const SYSTEM = `あなたは家計簿アプリの中で、持ち主の支出を見て助言する相談相手です。
渡される JSON は、ある月までの12ヶ月ぶんの支出の集計です。

前提:
- 振替（カードの引落・証券口座への積立）は支出に含めていない。
- 「こづかい」は PayPay へのチャージ。使い道は追っておらず、チャージした時点で使ったものとしている。
- 「交際費」は人と会うための支出（友人との飲み会など）。「食費 > 外食」はひとりでの食事。
- 特別支出（経費精算など）は通常の支出から外して別枠にしてある。
- 「未分類」はまだ費目を決めていない支出。
- partial が true の月は途中までの集計なので、月末まで使った場合と比べてはいけない。

やること:
- 使いすぎている費目を、先月や3ヶ月平均との差の金額で具体的に指摘する。
- 増えた理由が店の上位から読み取れるなら、店名を挙げる。一度きりの大きな買い物（家電など）と、毎月続く出費を分けて考える。
- 来月から具体的にできることを提案する。
- データから分からないことは推測で書かない。説教はしない。

書き方:
- 日本語。次の4つの見出しを「■」で始めて、その下に「・」で始まる短い項目を2〜4個ずつ。
  ■ まとめ / ■ 使いすぎかも / ■ よかった点 / ■ 来月やること
- Markdown の記号（#、**、表）は使わない。全体で600字以内。金額は「12,345円」の形。`;

export async function analyzeSpending(ym: string): Promise<AiAnalysisState> {
  if (!isYearMonth(ym)) return { text: null, error: "月の指定が正しくありません" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      text: null,
      error: "AIの鍵（ANTHROPIC_API_KEY）が設定されていません。Vercel の環境変数に追加してください。",
    };
  }

  const data = await loadAnalysis(ym);
  if (data.error) return { text: null, error: `データを読めませんでした: ${data.error}` };

  const today = todayJst();
  const current = data.summaries[data.summaries.length - 1];
  const previous = data.summaries.slice(-4, -1);
  const average = averageByCategory(previous);
  const month = monthRange(ym);
  const partial = today >= month.from && today <= month.to;

  const payload = {
    month: month.label,
    partial,
    days_elapsed: partial ? Number(today.slice(8, 10)) : null,
    days_in_month: Number(month.to.slice(8, 10)),
    this_month: {
      expense: current.expense,
      income: current.income,
      extraordinary: current.extraordinary,
      by_category: current.byCategory.map((c) => ({
        name: c.name,
        amount: c.amount,
        previous_month: data.summaries.at(-2)?.byCategory.find((p) => p.name === c.name)?.amount ?? 0,
        average_3_months: average.get(c.name) ?? 0,
      })),
      top_merchants: topMerchants(data.rows, data.categories, ym, 15),
    },
    history: data.summaries.slice(0, -1).map((m) => ({
      month: m.ym,
      expense: m.expense,
      income: m.income,
      by_category: Object.fromEntries(m.byCategory.map((c) => [c.name, c.amount])),
    })),
  };

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      // 安全のための判定で断られたときは、別のモデルで自動的にやり直す
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });

    if (response.stop_reason === "refusal") {
      return { text: null, error: "AIが分析を断りました。時間をおいて試してください。" };
    }
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    return text ? { text, error: null } : { text: null, error: "AIの返答が空でした" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { text: null, error: "AIの鍵（ANTHROPIC_API_KEY）が正しくありません。" };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { text: null, error: "AIが混み合っています。少し待ってから試してください。" };
    }
    if (e instanceof Anthropic.APIError) {
      return { text: null, error: `AIの呼び出しに失敗しました（${e.status ?? "?"}）: ${e.message}` };
    }
    throw e;
  }
}
