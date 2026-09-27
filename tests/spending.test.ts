import { test } from "node:test";
import assert from "node:assert/strict";
import {
  averageByCategory,
  monthsEndingAt,
  summarizeMonths,
  topMerchants,
  type SpendingRow,
} from "../src/lib/spending";
import type { Category } from "../src/lib/types";

const cat = (id: string, name: string, parent: string | null = null, extra = false): Category => ({
  id,
  parent_id: parent,
  name,
  kind: "expense",
  is_extraordinary: extra,
  sort_order: 0,
});

const CATEGORIES = [
  cat("food", "食費"),
  cat("eatout", "外食", "food"),
  cat("cafe", "カフェ", "food"),
  cat("fun", "娯楽"),
  cat("reimb", "経費精算", null, true),
];

const row = (date: string, amount: number, category_id: string | null, type: SpendingRow["type"] = "expense", merchant = "店"): SpendingRow => ({
  date,
  amount,
  type,
  category_id,
  merchant,
});

test("分析: 子の費目は親にまとめ、多い順に並べる", () => {
  const [m] = summarizeMonths(
    [row("2026-09-01", 1000, "eatout"), row("2026-09-02", 500, "cafe"), row("2026-09-03", 2000, "fun")],
    CATEGORIES,
    ["2026-09"],
  );
  assert.equal(m.expense, 3500);
  assert.deepEqual(
    m.byCategory.map((c) => [c.name, c.amount]),
    [["娯楽", 2000], ["食費", 1500]],
  );
});

test("分析: 振替と特別支出は通常の支出に入れない。費目なしは未分類", () => {
  const [m] = summarizeMonths(
    [
      row("2026-09-01", 100000, null, "transfer"),
      row("2026-09-02", 36305, "reimb", "income"),
      row("2026-09-03", 800, null),
      row("2026-09-04", 250000, null, "income"),
    ],
    CATEGORIES,
    ["2026-09"],
  );
  assert.equal(m.expense, 800);
  assert.equal(m.income, 250000);
  assert.equal(m.extraordinary, -36305);
  assert.deepEqual(m.byCategory.map((c) => c.name), ["未分類"]);
});

test("分析: 支出の無い月も0円の月として並ぶ", () => {
  const ms = summarizeMonths([row("2026-09-01", 100, "fun")], CATEGORIES, ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(ms.map((m) => m.expense), [0, 0, 100]);
});

test("分析: 3ヶ月平均は使っていない月を0円として数える", () => {
  const ms = summarizeMonths(
    [row("2026-06-10", 3000, "fun"), row("2026-08-10", 3000, "fun")],
    CATEGORIES,
    ["2026-06", "2026-07", "2026-08"],
  );
  assert.equal(averageByCategory(ms).get("娯楽"), 2000);
});

test("分析: 店の上位は金額順で、回数も数える", () => {
  const top = topMerchants(
    [
      row("2026-09-01", 500, "cafe", "expense", "コメダ"),
      row("2026-09-05", 700, "cafe", "expense", "コメダ"),
      row("2026-09-02", 1000, "fun", "expense", "ラウンドワン"),
      row("2026-08-30", 9999, "fun", "expense", "先月の店"),
    ],
    CATEGORIES,
    "2026-09",
  );
  assert.deepEqual(top, [
    { merchant: "コメダ", amount: 1200, count: 2 },
    { merchant: "ラウンドワン", amount: 1000, count: 1 },
  ]);
});

test("分析: 月の並びは年をまたいで古い順", () => {
  assert.deepEqual(monthsEndingAt("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});
