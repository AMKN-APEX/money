/**
 * 実物の Vpass CSV でパーサーを確かめる手元用スクリプト。
 * 実データは data/ に置く（gitignore 済み）。
 *   npx tsx scripts/check-vpass.ts "data/202609.csv"
 */
import { readFileSync } from "node:fs";
import { vpassParser } from "../src/lib/parsers/vpass";
import { normalizeMerchant } from "../src/lib/normalize";

const file = process.argv[2];
if (!file) throw new Error("CSVのパスを渡してください");

// 金融機関のCSVは CP932。本番はブラウザで変換してから渡す
const text = new TextDecoder("shift_jis").decode(readFileSync(file));
const r = vpassParser.parse(text, file, "2026-09-23");

console.log("looksLikeMine:", vpassParser.looksLikeMine(text));
console.log("error:", r.error);
console.log("期間:", r.periodFrom, "〜", r.periodTo, "/", r.rows.length, "件");
for (const w of r.warnings) console.log("警告:", w);

const byCard = new Map<string, typeof r.rows>();
for (const row of r.rows) {
  const k = row.cardLabel ?? "(不明)";
  byCard.set(k, [...(byCard.get(k) ?? []), row]);
}

for (const [card, rows] of byCard) {
  const sum = rows.reduce((a, x) => a + (x.direction === "out" ? x.amount : -x.amount), 0);
  console.log(`\n■ ${card}  → 正規化: ${normalizeMerchant(card)}`);
  console.log(`  ${rows.length} 件 / 差引 ${sum.toLocaleString("ja-JP")}円`);
  for (const x of rows) {
    const sign = x.direction === "in" ? "-" : " ";
    console.log(
      `  ${x.date} ${sign}${String(x.amount).padStart(6)} ${x.merchant}` +
        (x.memo ? `  [${x.memo}]` : ""),
    );
  }
}
