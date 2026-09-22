import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kyotoParser } from "../src/lib/parsers/kyoto";
import { yuchoParser } from "../src/lib/parsers/yucho";
import { verifyBalanceChain } from "../src/lib/parsers/balance-chain";
import { resolveYear, toAmount } from "../src/lib/parsers/csv";
import { normalizeMerchant } from "../src/lib/normalize";
import { classify, type Rule } from "../src/lib/rules";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

// ---------------------------------------------------------------- csv

test("toAmount は円記号（CP932ではバックスラッシュ）とカンマを剥がす", () => {
  assert.equal(toAmount("\\712,869"), 712869);
  assert.equal(toAmount("¥1,000"), 1000);
  assert.equal(toAmount(""), null);
  assert.equal(toAmount(undefined), null);
});

test("resolveYear はダウンロード日より未来なら前年にする", () => {
  // 2026-01-10 に取得したCSVの「12月28日」は 2025年
  assert.equal(resolveYear(12, 28, "2026-01-10"), 2025);
  assert.equal(resolveYear(1, 5, "2026-01-10"), 2026);
  // 同日は未来ではない
  assert.equal(resolveYear(1, 10, "2026-01-10"), 2026);
});

// ---------------------------------------------------------------- 京都銀行

test("京都銀行: 年をまたぐ日付を補完して読む", () => {
  const r = kyotoParser.parse(fixture("kyoto-sample.csv"), "ny20260110120000.csv", "2026-01-10");

  assert.equal(r.error, null);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(
    r.rows.map((x) => x.date),
    ["2025-12-28", "2026-01-05", "2026-01-05"],
  );
  assert.equal(r.periodFrom, "2025-12-28");
  assert.equal(r.periodTo, "2026-01-05");
});

test("京都銀行: 入金と出金を取り違えない", () => {
  const r = kyotoParser.parse(fixture("kyoto-sample.csv"), "ny20260110120000.csv", "2026-01-10");

  assert.deepEqual(
    r.rows.map((x) => [x.direction, x.amount]),
    [
      ["out", 1000],
      ["in", 50000],
      ["out", 3554],
    ],
  );
  assert.equal(r.rows[2].merchant, "ﾈﾔｶﾞﾜ ｽｲﾄﾞｳ");
});

test("京都銀行: 番号は日ごとの連番なので重複キーは行の内容から作る", () => {
  const r = kyotoParser.parse(fixture("kyoto-sample.csv"), "ny20260110120000.csv", "2026-01-10");
  const seeds = new Set(r.rows.map((x) => x.dedupSeed));
  // 1行目と2行目はどちらも番号 001 だが、別の取引として区別される
  assert.equal(seeds.size, 3);
});

test("京都銀行: ゆうちょのCSVを渡したら拒否する", () => {
  assert.equal(kyotoParser.looksLikeMine(fixture("yucho-sample.csv")), false);
  assert.equal(kyotoParser.looksLikeMine(fixture("kyoto-sample.csv")), true);

  const r = kyotoParser.parse(fixture("yucho-sample.csv"), "x.csv", "2026-01-10");
  assert.match(r.error ?? "", /京都銀行/);
});

// ---------------------------------------------------------------- ゆうちょ

test("ゆうちょ: 先頭6行のプリアンブルを飛ばして7行目をヘッダーとして読む", () => {
  const r = yuchoParser.parse(fixture("yucho-sample.csv"), "202609223620_01.csv", "2026-09-22");

  assert.equal(r.error, null);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(
    r.rows.map((x) => x.date),
    ["2026-08-01", "2026-08-10", "2026-08-20"],
  );
});

test("ゆうちょ: 入出金明細IDをそのまま冪等キーに使う", () => {
  const r = yuchoParser.parse(fixture("yucho-sample.csv"), "x.csv", "2026-09-22");
  assert.deepEqual(
    r.rows.map((x) => x.sourceRef),
    ["9000000001", "9000000002", "9000000003"],
  );
});

test("ゆうちょ: 詳細１が先頭に来るので種別だけで前方一致できる", () => {
  const r = yuchoParser.parse(fixture("yucho-sample.csv"), "x.csv", "2026-09-22");
  assert.equal(r.rows[0].matchText, "カード");
  assert.equal(r.rows[1].matchText, "給与 ﾃｽﾄｶﾌﾞｼｷｶﾞｲｼﾔ");
  // 全角スペース入りの「料　金」も正規化すれば 料金 になる
  assert.equal(normalizeMerchant(r.rows[2].matchText).startsWith("料金"), true);
});

test("ゆうちょ: 明細件数が読み取り件数と食い違ったら警告する", () => {
  const broken = fixture("yucho-sample.csv").replace("明細件数：3", "明細件数：5");
  const r = yuchoParser.parse(broken, "x.csv", "2026-09-22");
  assert.equal(r.rows.length, 3);
  assert.equal(
    r.warnings.some((w) => w.includes("5 件") && w.includes("3 件")),
    true,
  );
});

// ---------------------------------------------------------------- 残高チェーン

test("残高チェーン: 整合しているファイルは issues 0件", () => {
  for (const [parser, file, name] of [
    [kyotoParser, "kyoto-sample.csv", "ny20260110120000.csv"],
    [yuchoParser, "yucho-sample.csv", "x.csv"],
  ] as const) {
    const r = parser.parse(fixture(file), name, "2026-01-10");
    const chain = verifyBalanceChain(r.rows);
    assert.equal(chain.ok, true, `${file} の残高チェーンが合わない`);
    assert.equal(chain.checked, r.rows.length - 1);
  }
});

test("残高チェーン: 明細が1件抜けていることを検出する", () => {
  // 2行目（入金 50,000）を落とすと、3行目の残高が合わなくなる
  const lines = fixture("kyoto-sample.csv").split("\r\n");
  const broken = [lines[0], lines[1], lines[3]].join("\r\n");

  const r = kyotoParser.parse(broken, "ny20260110120000.csv", "2026-01-10");
  const chain = verifyBalanceChain(r.rows);

  assert.equal(chain.ok, false);
  assert.equal(chain.issues.length, 1);
  // 抜けた入金 50,000 がそのまま差額として出る
  assert.equal(chain.issues[0].diff, 50000);
});

// ---------------------------------------------------------------- ルール

const rule = (over: Partial<Rule>): Rule => ({
  id: "r",
  priority: 100,
  match_type: "prefix",
  pattern: "",
  account_id: null,
  set_type: null,
  category_id: null,
  to_account_id: null,
  channel: null,
  memo_template: null,
  is_active: true,
  ...over,
});

test("ルール: 摘要が途中で切れていても前方一致で当たる", () => {
  const rules = [
    rule({ id: "salary", pattern: "パナソニツクインダストリー", set_type: "income", category_id: "c-salary" }),
  ];
  // 実データは ﾊﾟﾅｿﾆﾂｸｲﾝﾀﾞｽﾄﾘ-(ｶ と途中で切れている
  const got = classify({ matchText: "ﾊﾟﾅｿﾆﾂｸｲﾝﾀﾞｽﾄﾘ-(ｶ", direction: "in" }, "acc", rules);

  assert.equal(got.ruleId, "salary");
  assert.equal(got.type, "income");
  assert.equal(got.category_id, "c-salary");
});

test("ルール: 当たらなければ未分類にする（推測で埋めない）", () => {
  const got = classify({ matchText: "ｲﾝﾀ-ﾈﾂﾄ(ﾌﾘｺﾐ)", direction: "out" }, "acc", []);

  assert.equal(got.ruleId, null);
  assert.equal(got.category_id, null);
  // 向きから支出とだけ決める
  assert.equal(got.type, "expense");
});

test("ルール: 他口座向けのルールは適用しない", () => {
  const rules = [rule({ id: "zozo", account_id: "zozo", match_type: "contains", set_type: "expense", category_id: "c-clothes" })];

  assert.equal(classify({ matchText: "なんでも", direction: "out" }, "zozo", rules).ruleId, "zozo");
  assert.equal(classify({ matchText: "なんでも", direction: "out" }, "kyoto", rules).ruleId, null);
});

test("ルール: priority の小さいものが優先される", () => {
  const rules = [
    rule({ id: "broad", priority: 90, match_type: "contains", pattern: "カード" }),
    rule({ id: "narrow", priority: 10, pattern: "ポケツトカード", set_type: "transfer", to_account_id: "zozo" }),
  ];
  const got = classify({ matchText: "ﾎﾟｹﾂﾄｶ-ﾄﾞ", direction: "out" }, "kyoto", rules);

  assert.equal(got.ruleId, "narrow");
  assert.equal(got.to_account_id, "zozo");
});
