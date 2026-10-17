import { createClient } from "@/lib/supabase/server";
import { CATEGORY_COLUMNS } from "@/lib/queries";
import {
  monthsEndingAt,
  summarizeMonths,
  type MonthSummary,
  type SpendingRow,
} from "@/lib/spending";
import type { Category } from "@/lib/types";
import { netWorthByMonth, type NetWorthAccount, type NetWorthPoint, type NetWorthTx } from "@/lib/net-worth";

/** 分析画面で遡る月数。月ごとの比較はこの範囲で出す */
export const HISTORY_MONTHS = 12;

/** Supabase は1回の select で最大1000行しか返さない。取りこぼさないよう分けて読む */
const PAGE = 1000;

export type AnalysisData = {
  months: string[];
  summaries: MonthSummary[];
  rows: SpendingRow[];
  categories: Category[];
  /**
   * 収入が記録されている最初の日。給料は銀行に振り込まれるので、銀行CSVの取込範囲の
   * いちばん古い日になる。カードの明細は15ヶ月以上遡れるのに銀行は2〜3ヶ月しか遡れないため、
   * それより前の月は支出だけあって収入が無い。0円と出すと赤字に見えるので「記録なし」と出す
   */
  incomeFrom: string | null;
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
  if (catError) return { months, summaries: [], rows: [], categories: [], incomeFrom: null, error: catError.message };
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
    if (error) return { months, summaries: [], rows: [], categories, incomeFrom: null, error: error.message };
    const page = (data ?? []) as SpendingRow[];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < PAGE) break;
  }

  // 銀行口座の取込範囲のうち、いちばん古い日
  const [{ data: banks }, { data: coverage }] = await Promise.all([
    supabase.from("accounts").select("id").eq("type", "bank"),
    supabase.from("import_coverage").select("account_id, covered_from"),
  ]);
  const bankIds = new Set(((banks ?? []) as { id: string }[]).map((b) => b.id));
  const incomeFrom =
    ((coverage ?? []) as { account_id: string; covered_from: string | null }[])
      .filter((c) => bankIds.has(c.account_id) && c.covered_from)
      .map((c) => c.covered_from as string)
      .sort()[0] ?? null;

  return {
    months,
    summaries: summarizeMonths(rows, categories, months),
    rows,
    categories,
    incomeFrom,
    error: null,
  };
}

export type NetWorthData = {
  points: NetWorthPoint[];
  /** 残高が分かる最初の日。銀行の明細が無ければ null */
  knownFrom: string | null;
  error: string | null;
};

/**
 * months の各月末の純資産。ホームの純資産と同じく、止めていない口座だけを足す。
 * 残高は「開始残高 + 取引の積み上げ」なので、取引は期間の頭からではなく全部読む
 */
export async function loadNetWorth(months: string[]): Promise<NetWorthData> {
  const supabase = await createClient();
  const [accountsRes, coverageRes] = await Promise.all([
    supabase.from("accounts").select("id, type, opening_balance").eq("is_active", true),
    supabase.from("import_coverage").select("account_id, covered_from"),
  ]);
  const failed = accountsRes.error ?? coverageRes.error;
  if (failed) return { points: [], knownFrom: null, error: failed.message };

  const accounts = ((accountsRes.data ?? []) as NetWorthAccount[]).map((a) => ({
    ...a,
    opening_balance: Number(a.opening_balance),
  }));

  // すべての銀行の明細が揃った日から。1行でも明細の無い銀行があれば、残高は分からない
  const covered = new Map(
    ((coverageRes.data ?? []) as { account_id: string; covered_from: string | null }[]).map((c) => [
      c.account_id,
      c.covered_from,
    ]),
  );
  const bankStarts = accounts.filter((a) => a.type === "bank").map((a) => covered.get(a.id) ?? null);
  const knownFrom =
    bankStarts.length > 0 && bankStarts.every(Boolean) ? (bankStarts as string[]).sort().at(-1)! : null;

  const last = months[months.length - 1];
  const [y, m] = last.split("-").map(Number);
  const to = `${last}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const txs: NetWorthTx[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("date, amount, type, account_id, to_account_id")
      .lte("date", to)
      .order("date")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) return { points: [], knownFrom, error: error.message };
    const page = (data ?? []) as NetWorthTx[];
    txs.push(...page.map((t) => ({ ...t, amount: Number(t.amount) })));
    if (page.length < PAGE) break;
  }

  return { points: netWorthByMonth(accounts, txs, months, knownFrom), knownFrom, error: null };
}
