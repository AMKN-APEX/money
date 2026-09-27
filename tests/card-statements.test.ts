import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { itemsToLines } from "../src/lib/parsers/pdf-lines";
import { rakutenParser } from "../src/lib/parsers/rakuten";
import { pocketcardParser } from "../src/lib/parsers/pocketcard";
import { paypayCardParser } from "../src/lib/parsers/paypaycard";
import { vpassParser } from "../src/lib/parsers/vpass";
import { kyotoParser } from "../src/lib/parsers/kyoto";
import { paidOutside } from "../src/lib/card-statements";
import { normalizeMerchant } from "../src/lib/normalize";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

// ---------------------------------------------------------------- PDFの行

test("PDFの断片: 同じ高さを1行にまとめ、左から並べる", () => {
  const lines = itemsToLines([
    { str: "6270", x: 235, y: 276.3 },
    { str: "2026/06/28", x: 9, y: 276.3 },
    { str: "ＺＯＺＯＴＯＷＮ", x: 51, y: 276.0 },
    // 高さが 0.5pt ずれても同じ行
    { str: "１回払い", x: 352, y: 275.8 },
    { str: "2026/06/30", x: 9, y: 264.8 },
  ]);
  assert.deepEqual(lines, ["2026/06/28\tＺＯＺＯＴＯＷＮ\t6270\t１回払い", "2026/06/30"]);
});

test("PDFの断片: 太字の重ね書きは畳むが、離れた位置の同じ金額は残す", () => {
  const lines = itemsToLines([
    { str: "2026/07/04", x: 8.8, y: 276.3 },
    { str: "2026/07/04", x: 9.0, y: 276.3 },
    { str: "6750", x: 235.7, y: 276.3 },
    { str: "6750", x: 309.1, y: 276.3 },
  ]);
  assert.deepEqual(lines, ["2026/07/04\t6750\t6750"]);
});

// ---------------------------------------------------------------- 楽天

test("楽天: 請求と明細を読む（当月支払額の列が無い旧様式）", () => {
  const r = rakutenParser.parse(fixture("rakuten-202509.txt"), "statement_202509.pdf", "2026-09-27");
  assert.equal(r.error, null);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].date, "2025-08-16");
  assert.equal(r.rows[0].amount, 30000);
  assert.equal(r.rows[0].direction, "out");
  assert.deepEqual(r.statements, [{ paymentDate: "2025-09-29", amount: 30000 }]);
});

test("楽天: 当月支払額の列が増えた新様式でも読める", () => {
  const r = rakutenParser.parse(fixture("rakuten-202607.txt"), "statement_202607.pdf", "2026-09-27");
  assert.equal(r.error, null);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rows[0].date, "2026-06-16");
  assert.equal(r.rows[0].amount, 100000);
  assert.deepEqual(r.statements, [{ paymentDate: "2026-07-27", amount: 100000 }]);
});

test("楽天: 明細の店名が積立ルール（楽天証券）に前方一致する", () => {
  const r = rakutenParser.parse(fixture("rakuten-202607.txt"), "statement_202607.pdf", "2026-09-27");
  assert.ok(normalizeMerchant(r.rows[0].matchText).startsWith("楽天証券"));
});

// ---------------------------------------------------------------- ポケットカード

test("ポケットカード: 割れた店名をつなぎ、請求額と支払期日を読む", () => {
  const r = pocketcardParser.parse(
    fixture("pocketcard-statement-202609.txt"),
    "pocketcard_2026_9.pdf",
    "2026-09-27",
  );
  assert.equal(r.error, null);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.merchant, x.amount]),
    [
      ["2026-07-04", "志なのすけ 枚方", 6750],
      ["2026-07-05", "ＺＯＺＯＴＯＷＮ", 3300],
      ["2026-07-15", "ＺＯＺＯＴＯＷＮ", 3630],
    ],
  );
  assert.deepEqual(r.statements, [{ paymentDate: "2026-09-01", amount: 13680 }]);
});

test("ポケットカード: 明細の合計が請求額と合わなければ知らせる", () => {
  const broken = fixture("pocketcard-statement-202609.txt").replace(/^2026\/07\/15.*\n/m, "");
  const r = pocketcardParser.parse(broken, "pocketcard_2026_9.pdf", "2026-09-27");
  assert.equal(r.rows.length, 2);
  assert.equal(r.warnings.length, 1);
});

test("PDFの判別: 楽天とポケットカードを取り違えない", () => {
  assert.equal(rakutenParser.looksLikeMine(fixture("pocketcard-statement-202609.txt")), false);
  assert.equal(pocketcardParser.looksLikeMine(fixture("rakuten-202607.txt")), false);
});

// ---------------------------------------------------------------- PayPayカード

test("PayPayカード: ゼロ埋めの無い日付を読み、同じ明細2件を区別する", () => {
  const r = paypayCardParser.parse(fixture("paypaycard-sample.csv"), "detail202606(0000).csv", "2026-09-27");
  assert.equal(r.error, null);
  assert.deepEqual(
    r.rows.map((x) => x.date),
    ["2026-04-30", "2026-05-30", "2026-05-31", "2026-05-31"],
  );
  assert.notEqual(r.rows[2].dedupSeed, r.rows[3].dedupSeed);
  assert.equal(r.rows[1].memo, "PayPayアプリでクレジット払い");
  // 同じ支払日の行は1回の請求にまとまる
  assert.deepEqual(r.statements, [{ paymentDate: "2026-06-29", amount: 37063 }]);
});

test("PayPayカード: 携帯料金の表記がルール（ソフトバンク）に前方一致する", () => {
  const r = paypayCardParser.parse(fixture("paypaycard-sample.csv"), "detail202606(0000).csv", "2026-09-27");
  assert.ok(normalizeMerchant(r.rows[0].matchText).startsWith("ソフトバンク"));
});

test("PayPayカード: 他社のCSVと取り違えない", () => {
  assert.equal(paypayCardParser.looksLikeMine(fixture("kyoto-sample.csv")), false);
  assert.equal(kyotoParser.looksLikeMine(fixture("paypaycard-sample.csv")), false);
  assert.equal(vpassParser.looksLikeMine(fixture("paypaycard-sample.csv")), false);
});

// ---------------------------------------------------------------- Vpass の請求

test("Vpass: ファイル名の請求月から26日払いの請求を作る", () => {
  const r = vpassParser.parse(fixture("vpass-sample.csv"), "202609 (1).csv", "2026-09-23");
  assert.equal(r.statements?.length, 1);
  assert.equal(r.statements?.[0].paymentDate, "2026-09-26");
  assert.equal(r.statements?.[0].amount, 47500);
});

test("Vpass: ファイル名から請求月が読めなければ請求を作らず知らせる", () => {
  const r = vpassParser.parse(fixture("vpass-sample.csv"), "meisai.csv", "2026-09-23");
  assert.deepEqual(r.statements, []);
  assert.ok(r.warnings.some((w) => w.includes("請求月")));
});

// ---------------------------------------------------------------- 開始残高

test("開始残高: 引落が取引に無い過去の請求だけを足す", () => {
  const statements = [
    { paymentDate: "2025-07-28", amount: 30000 }, // 銀行CSVより前
    { paymentDate: "2026-08-27", amount: 100000 }, // 銀行CSVに引落あり
    { paymentDate: "2026-10-27", amount: 100000 }, // まだ来ていない
  ];
  const payments = [{ id: "p1", date: "2026-08-27", amount: 100000 }];
  const r = paidOutside(statements, payments, "2026-09-27");
  assert.equal(r.amount, 30000);
  assert.deepEqual(r.statements, [{ paymentDate: "2025-07-28", amount: 30000 }]);
});

test("開始残高: 休日で後ろにずれた引落も同じ請求とみなす", () => {
  // 2026-08-01 は土曜。ポケットカードの引落は 8/3 だった
  const r = paidOutside(
    [{ paymentDate: "2026-08-01", amount: 27459 }],
    [{ id: "p1", date: "2026-08-03", amount: 27459 }],
    "2026-09-27",
  );
  assert.equal(r.amount, 0);
});

test("開始残高: 同額の請求が続いても、1件の引落を2度使わない", () => {
  const r = paidOutside(
    [
      { paymentDate: "2026-07-27", amount: 100000 },
      { paymentDate: "2026-08-27", amount: 100000 },
    ],
    [{ id: "p1", date: "2026-08-27", amount: 100000 }],
    "2026-09-27",
  );
  assert.equal(r.amount, 100000);
  assert.equal(r.statements[0].paymentDate, "2026-07-27");
});
