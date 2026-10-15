import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { itemsToLines } from "../src/lib/parsers/pdf-lines";
import { rakutenParser } from "../src/lib/parsers/rakuten";
import { pocketcardParser } from "../src/lib/parsers/pocketcard";
import { paypayCardParser } from "../src/lib/parsers/paypaycard";
import { vpassParser } from "../src/lib/parsers/vpass";
import { kyotoParser } from "../src/lib/parsers/kyoto";
import { cardForPayment, indistinguishableCards, paidOutside } from "../src/lib/card-statements";
import { shortDate } from "../src/lib/format";
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

test("PDFの文字: フォーム送信で改行が \\r\\n になっても読める", () => {
  // ブラウザからサーバーへ送ると改行が \r\n に置き換わる。
  // 支払期日は行末にあるので、\r が残ると読めなくなっていた
  const crlf = (name: string) => fixture(name).replace(/\r?\n/g, "\r\n");

  const pocket = pocketcardParser.parse(crlf("pocketcard-statement-202609.txt"), "p.pdf", "2026-09-27");
  assert.equal(pocket.error, null);
  assert.deepEqual(pocket.warnings, []);
  assert.deepEqual(pocket.statements, [{ paymentDate: "2026-09-01", amount: 13680 }]);
  assert.equal(pocket.rows[0].merchant, "志なのすけ 枚方");

  const rakuten = rakutenParser.parse(crlf("rakuten-202607.txt"), "r.pdf", "2026-09-27");
  assert.equal(rakuten.error, null);
  assert.deepEqual(rakuten.statements, [{ paymentDate: "2026-07-27", amount: 100000 }]);
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

// ---------------------------------------------------------------- Vpass の変わった行

const VPASS_HEAD = "山田　太郎　様,4980-03**-****-****,三井住友カードデビュープラスＶＩＳＡ\r\n";

test("Vpass: 店名に囲まれていないカンマがあっても列を取り違えない", () => {
  const csv =
    VPASS_HEAD +
    "2025/08/27,GITHUB, INC. (GITHUB.COM ),1687,１,１,1687,11.00　USD　153.434　08 28\r\n" +
    ",,,,,1687,\r\n";
  const r = vpassParser.parse(csv, "202509.csv", "2026-09-27");
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rows[0].merchant, "GITHUB, INC. (GITHUB.COM )");
  assert.equal(r.rows[0].amount, 1687);
  assert.equal(r.rows[0].memo, "11.00　USD　153.434　08 28");
});

test("Vpass: 利用金額が空のキャッシュバックは当月支払額のマイナスで読む", () => {
  const csv =
    VPASS_HEAD +
    "2025/11/30,モバイルＩＣＯＣＡチャージ,5000,１,１,5000,\r\n" +
    "2025/11/30,キャッシュバック（ポイント交換）,,,,-7800,\r\n" +
    ",,,,,-2800,\r\n";
  const r = vpassParser.parse(csv, "202512.csv", "2026-09-27");
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rows[1].amount, 7800);
  assert.equal(r.rows[1].direction, "in");
});

test("Vpass: 確定前の明細は取り込まず、理由を返す", () => {
  const csv = "2026/9/24,ユニクロ・ＧＵ・ＰＬＳＴオンライン,ご本人,1回払い,,'26/10,9980,9980,,,,,\r\n";
  assert.equal(vpassParser.looksLikeMine(csv), true);
  const r = vpassParser.parse(csv, "202610.csv", "2026-09-27");
  assert.equal(r.rows.length, 0);
  assert.match(r.error ?? "", /確定前/);
});

test("Vpass: Amazonカードの ＡｐｐｌｅＰａｙ 見出しは本カードの口座に入れる", () => {
  const csv =
    "山田　太郎　様,5334-91**-****-****,Ａｍａｚｏｎマスター\r\n" +
    "2026/09/01,ＡＭＡＺＯＮ．ＣＯ．ＪＰ,25297,１,１,25297,\r\n" +
    "山田　太郎　様,5334-99**-****-****,ＡｐｐｌｅＰａｙ\r\n" +
    "2026/09/29,モバイルＩＣＯＣＡチャージ,5000,１,１,5000,\r\n" +
    ",,,,,30297,\r\n";
  const r = vpassParser.parse(csv, "202610.csv", "2026-10-15");
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.rows.map((x) => x.cardLabel), ["Ａｍａｚｏｎマスター", "Ａｍａｚｏｎマスター"]);
  // 重複排除のキーは見出しの名前のまま
  assert.match(r.rows[1].dedupSeed ?? "", /^vpass:ＡｐｐｌｅＰａｙ:/);
  assert.equal(r.statements?.[0].amount, 30297);
});

test("Vpass: デビュープラスの ＡｐｐｌｅＰａｙ／ｉＤ も本カードの名前で口座を決める", () => {
  const csv =
    VPASS_HEAD +
    "2026/09/02,ゼッテリア,790,１,１,790,\r\n" +
    "山田　太郎　様,6900-11**-****-****,ＡｐｐｌｅＰａｙ／ｉＤ\r\n" +
    "2026/09/08,ファミリーマート／ｉＤ,415,１,１,415,\r\n" +
    ",,,,,1205,\r\n";
  const r = vpassParser.parse(csv, "202610 (1).csv", "2026-10-15");
  assert.equal(r.rows[1].cardLabel, "三井住友カードデビュープラスＶＩＳＡ");
  assert.match(r.rows[1].dedupSeed ?? "", /^vpass:ＡｐｐｌｅＰａｙ／ｉＤ:/);
});

// ---------------------------------------------------------------- 見分けられないカードの引落（9.3）

test("三井住友の2枚は見分けられない。引落口座が違えば別扱い", () => {
  const accounts = [
    { id: "amazon", type: "credit_card", issuer: "三井住友カード", payment_account_id: "kyoto" },
    { id: "debut", type: "credit_card", issuer: "三井住友カード", payment_account_id: "kyoto" },
    { id: "rakuten", type: "credit_card", issuer: "楽天カード", payment_account_id: "kyoto" },
    { id: "kyoto", type: "bank", issuer: "京都銀行", payment_account_id: null },
  ];
  assert.deepEqual(indistinguishableCards(accounts, "debut").map((a) => a.id), ["amazon", "debut"]);
  assert.deepEqual(indistinguishableCards(accounts, "rakuten"), []);
  assert.deepEqual(indistinguishableCards(accounts, "kyoto"), []);
});

test("引落の相手カードを請求額で決める（2026-09-28 の実例）", () => {
  const cards = [
    { accountId: "amazon", statements: [{ paymentDate: "2026-09-26", amount: 160051 }] },
    { accountId: "debut", statements: [{ paymentDate: "2026-09-26", amount: 110044 }] },
  ];
  assert.equal(cardForPayment({ date: "2026-09-28", amount: 160051 }, cards), "amazon");
  assert.equal(cardForPayment({ date: "2026-09-28", amount: 110044 }, cards), "debut");
  // 請求が無い・遠い日付なら決めない（未分類へ）
  assert.equal(cardForPayment({ date: "2026-09-28", amount: 12345 }, cards), null);
  assert.equal(cardForPayment({ date: "2026-10-28", amount: 160051 }, cards), null);
});

test("同額の請求が2枚にあれば決めない", () => {
  const cards = [
    { accountId: "amazon", statements: [{ paymentDate: "2026-09-26", amount: 5000 }] },
    { accountId: "debut", statements: [{ paymentDate: "2026-09-26", amount: 5000 }] },
  ];
  assert.equal(cardForPayment({ date: "2026-09-28", amount: 5000 }, cards), null);
});

test("日付の表示は、サーバーのタイムゾーンによらず同じ日になる", () => {
  assert.equal(shortDate("2026-10-26"), "10/26(月)");
});
