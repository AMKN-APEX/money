/**
 * 分析画面の集計。取引と費目から、月ごと・費目ごとの支出を作る。
 *
 * - 費目は**親でまとめる**（食費 > 外食 と 食費 > カフェ は「食費」）。
 *   子まで並べると20行を超え、何に使っているかの全体像が読めなくなる
 * - 特別支出・経費精算（is_extraordinary）は通常の支出から外し、別枠で数える（9.6）
 * - 振替は数えない（カードの引落・積立は支出ではない。方針2 / 方針6）
 * - 費目の付いていない支出は「未分類」にまとめる
 */
import type { Category, TxType } from "./types";

export type SpendingRow = {
  date: string;
  amount: number;
  type: TxType;
  category_id: string | null;
  merchant: string | null;
};

export type CategoryTotal = {
  /** 親の費目の id。未分類は null */
  id: string | null;
  name: string;
  amount: number;
};

export type MonthSummary = {
  ym: string;
  expense: number;
  income: number;
  /** 特別支出（支出 − 収入）。別枠 */
  extraordinary: number;
  byCategory: CategoryTotal[];
};

export const UNCATEGORIZED = "未分類";

export function summarizeMonths(
  rows: SpendingRow[],
  categories: Category[],
  months: string[],
): MonthSummary[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentOf = (id: string | null): Category | null => {
    const c = id ? byId.get(id) : undefined;
    if (!c) return null;
    return c.parent_id ? (byId.get(c.parent_id) ?? c) : c;
  };

  const result = new Map<string, MonthSummary & { cat: Map<string, CategoryTotal> }>(
    months.map((ym) => [
      ym,
      { ym, expense: 0, income: 0, extraordinary: 0, byCategory: [], cat: new Map() },
    ]),
  );

  for (const row of rows) {
    const month = result.get(row.date.slice(0, 7));
    if (!month || row.type === "transfer") continue;

    const own = row.category_id ? byId.get(row.category_id) : undefined;
    const parent = parentOf(row.category_id);
    if (own?.is_extraordinary || parent?.is_extraordinary) {
      month.extraordinary += row.type === "expense" ? row.amount : -row.amount;
      continue;
    }

    if (row.type === "income") {
      month.income += row.amount;
      continue;
    }

    month.expense += row.amount;
    const key = parent?.id ?? UNCATEGORIZED;
    const total = month.cat.get(key) ?? { id: parent?.id ?? null, name: parent?.name ?? UNCATEGORIZED, amount: 0 };
    total.amount += row.amount;
    month.cat.set(key, total);
  }

  return months.map((ym) => {
    const { cat, ...m } = result.get(ym)!;
    return { ...m, byCategory: [...cat.values()].sort((a, b) => b.amount - a.amount) };
  });
}

/** 直前 n ヶ月の、費目ごとの平均（その月に使っていない月は0円として数える） */
export function averageByCategory(history: MonthSummary[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const m of history) {
    for (const c of m.byCategory) sums.set(c.name, (sums.get(c.name) ?? 0) + c.amount);
  }
  const n = Math.max(history.length, 1);
  return new Map([...sums].map(([name, total]) => [name, Math.round(total / n)]));
}

/** 店ごとの支出の上位。特別支出と振替は除く */
export function topMerchants(
  rows: SpendingRow[],
  categories: Category[],
  ym: string,
  limit = 10,
): { merchant: string; amount: number; count: number }[] {
  const extra = new Set(categories.filter((c) => c.is_extraordinary).map((c) => c.id));
  const totals = new Map<string, { merchant: string; amount: number; count: number }>();
  for (const r of rows) {
    if (r.type !== "expense" || !r.date.startsWith(ym)) continue;
    if (r.category_id && extra.has(r.category_id)) continue;
    const name = r.merchant?.trim() || "（店名なし）";
    const t = totals.get(name) ?? { merchant: name, amount: 0, count: 0 };
    t.amount += r.amount;
    t.count += 1;
    totals.set(name, t);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** ym から遡って n ヶ月（古い順） */
export function monthsEndingAt(ym: string, n: number): string[] {
  const [y, m] = ym.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
