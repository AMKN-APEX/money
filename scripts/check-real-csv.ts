// 実データ（data/ 配下・gitignore済み）でパーサーと残高チェーンを確認する。
//   npx tsx scripts/check-real-csv.ts
import { readdirSync, readFileSync } from "node:fs";
import { kyotoParser } from "../src/lib/parsers/kyoto";
import { yuchoParser } from "../src/lib/parsers/yucho";
import { verifyBalanceChain } from "../src/lib/parsers/balance-chain";
import { normalizeMerchant } from "../src/lib/normalize";

const parsers = [kyotoParser, yuchoParser];

for (const file of readdirSync("data").filter((f) => f.toLowerCase().endsWith(".csv"))) {
  const bytes = readFileSync(`data/${file}`);
  const text = new TextDecoder("shift_jis").decode(bytes);
  const parser = parsers.find((p) => p.looksLikeMine(text));

  if (!parser) {
    console.log(`${file}: 対応するパーサーなし`);
    continue;
  }

  const r = parser.parse(text, file, new Date().toISOString().slice(0, 10));
  const chain = verifyBalanceChain(r.rows);

  console.log(
    `${file}  [${parser.id}]  ${r.rows.length}件  ${r.periodFrom}〜${r.periodTo}  ` +
      `残高チェーン ${chain.ok ? "OK" : `NG(${chain.issues.length})`} / 検証${chain.checked}組`,
  );
  for (const w of r.warnings) console.log(`   警告: ${w}`);
  for (const i of chain.issues) {
    console.log(`   不整合 ${i.lineNo}行目 ${i.date}: 期待 ${i.expected} 実際 ${i.actual} 差 ${i.diff}`);
  }
}

console.log("\n--- 正規化された摘要（ルールの pattern はこの形で持つ） ---");
const seen = new Set<string>();
for (const file of readdirSync("data").filter((f) => f.toLowerCase().endsWith(".csv"))) {
  const text = new TextDecoder("shift_jis").decode(readFileSync(`data/${file}`));
  const parser = parsers.find((p) => p.looksLikeMine(text));
  if (!parser) continue;
  for (const row of parser.parse(text, file, "2026-09-22").rows) {
    const n = normalizeMerchant(row.matchText);
    if (seen.has(n)) continue;
    seen.add(n);
    console.log(`  ${row.merchant.padEnd(26)} → ${n}`);
  }
}
