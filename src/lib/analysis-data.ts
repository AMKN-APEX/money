import { createClient } from "@/lib/supabase/server";
import { CATEGORY_COLUMNS } from "@/lib/queries";
import {
  monthsEndingAt,
  summarizeMonths,
  type MonthSummary,
  type SpendingRow,
} from "@/lib/spending";
import type { Category } from "@/lib/types";

/** 分析画面で遡る月数。月ごとの比較はこの範囲で出す */
export const HISTORY_MONTHS = 12;

/** Supabase は1回の select で最大1000行しか返さない。取りこぼさないよう分けて読む */
const PAGE = 1000;

export type AnalysisData = {
  months: string[];
  summaries: MonthSummary[];
  rows: SpendingRow[];
  categories: Category[];
  error: string | null;
};

/** ym を最後の月とする12ヶ月ぶんの支出・収入 */
export async function loadAnalysis(ym: string): Promise<AnalysisData> {
  const supabase = await createClient();
  const months = monthsEndingAt(ym, HISTORY_MONTHS);
  const from = `${months[0]}-01`;
  const [y, m] = ym.split("-").map(Number);
  const to = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const { data: catData, error: catError } = await supabase
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .order("sort_order");
  if (catError) return { months, summaries: [], rows: [], categories: [], error: catError.message };
  const categories = (catData ?? []) as Category[];

  const rows: SpendingRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("date, amount, type, category_id, merchant")
      .in("type", ["expense", "income"])
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) return { months, summaries: [], rows: [], categories, error: error.message };
    const page = (data ?? []) as SpendingRow[];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < PAGE) break;
  }

  return { months, summaries: summarizeMonths(rows, categories, months), rows, categories, error: null };
}
