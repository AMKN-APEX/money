import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parserFor } from "../src/lib/parsers/email";
import { smbcEmailParser } from "../src/lib/parsers/email/smbc";
import { pocketcardEmailParser } from "../src/lib/parsers/email/pocketcard";
import { splitUsageKind, toDateTime, toYen } from "../src/lib/parsers/email/text";
import { normalizeMerchant } from "../src/lib/normalize";
import { classify, type Rule } from "../src/lib/rules";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

// ---------------------------------------------------------------- 共通処理

test("toYen は全角・カンマ付きの金額を読む", () => {
  assert.equal(toYen("6,525円"), 6525);
  assert.equal(toYen("１，２３４円".normalize("NFKC")), 1234);
  assert.equal(toYen("金額なし"), null);
  assert.equal(toYen(null), null);
});

test("toDateTime は秒の有無どちらでも読む", () => {
  assert.deepEqual(toDateTime("2026/09/23 16:51:00"), { date: "2026-09-23", time: "16:51:00" });
  assert.deepEqual(toDateTime("ご利用日時:2026/9/3 9:04"), { date: "2026-09-03", time: "09:04" });
  assert.equal(toDateTime("2026/13/40"), null);
});

test("splitUsageKind は行末の利用区分だけを切り離す", () => {
  assert.deepEqual(splitUsageKind("ユニクロ・GU・PLSTオンライン(買物)"), {
    name: "ユニクロ・GU・PLSTオンライン",
    kind: "買物",
  });
  // 店名の一部の括弧は残す（切ると CSV 側の摘要と一致しなくなる）
  assert.deepEqual(splitUsageKind("パナソニツク(カ"), { name: "パナソニツク(カ", kind: null });
});

test("差出人からパーサーを選ぶ", () => {
  assert.equal(parserFor("statement@vpass.ne.jp")?.id, "smbc");
  assert.equal(parserFor("三井住友カード <statement@vpass.ne.jp>")?.id, "smbc");
  assert.equal(parserFor("announce@pinf.pocketcard.co.jp")?.id, "pocketcard");
  // まだパーサーを書いていないカード会社
  assert.equal(parserFor("info@mail.rakuten-card.co.jp"), null);
  assert.equal(parserFor(null), null);
});

// ---------------------------------------------------------------- 三井住友カード

test("三井住友: 全角とNBSP混じりの本文から利用1件を読む", () => {
  const r = smbcEmailParser.parse(fixture("smbc-usage.txt"));

  assert.equal(r.kind, "usage");
  assert.equal(r.cardLabel, "三井住友カードデビュープラスVISA");
  assert.equal(r.usages.length, 1);

  const u = r.usages[0];
  assert.equal(u.date, "2026-09-23");
  assert.equal(u.time, "16:54");
  assert.equal(u.amount, 4950);
  // 全角は NFKC で畳み、行末の利用区分（買物）は落とす
  assert.equal(u.merchant, "ユニクロ・GU・PLSTオンライン");
  assert.equal(u.memo, null);
  assert.equal(u.needsReview, false);
});

test("三井住友: 本文のカード名がシード済みのパターンに当たる", () => {
  const r = smbcEmailParser.parse(fixture("smbc-usage.txt"));
  // supabase/migrations/20260923000001_email_cards.sql で登録したパターン
  assert.ok(normalizeMerchant(r.cardLabel).includes("デビユープラス"));
  // Amazonカードのパターン（未登録）には当たらない
  assert.ok(!normalizeMerchant(r.cardLabel).includes("AMAZON"));
});

test("三井住友: 利用通知でないメールは取り込まない", () => {
  const promo = [
    "いつも三井住友カードをご利用いただきありがとうございます。",
    "Vpassアプリのリニューアルのお知らせです。",
    "キャンペーン期間中は最大10,000円相当のVポイントが当たります。",
  ].join("\n");

  const r = smbcEmailParser.parse(promo);
  assert.equal(r.kind, "other");
  assert.equal(r.usages.length, 0);
});

test("三井住友: 日時はあるのに金額が無ければ失敗として残す", () => {
  const broken = "ご利用日時：2026/09/23 16:54\nご利用内容の表示は Vpass アプリでご確認ください";
  const r = smbcEmailParser.parse(broken);

  assert.equal(r.kind, "error");
  assert.match(r.error ?? "", /読み取れませんでした/);
});

// ---------------------------------------------------------------- ポケットカード

test("ポケットカード: 利用1件を読む（店名は出ない仕様）", () => {
  const r = pocketcardEmailParser.parse(fixture("pocketcard-usage.txt"));

  assert.equal(r.kind, "usage");
  assert.equal(r.cardLabel, "ZOZOCARD2");
  assert.equal(r.usages.length, 1);

  const u = r.usages[0];
  assert.equal(u.date, "2026-09-23");
  assert.equal(u.time, "16:51:00");
  assert.equal(u.amount, 3300);
  assert.equal(u.merchant, "ポケットカード加盟店");
  assert.equal(u.needsReview, false);
});

test("ポケットカード: カード名がシード済みのパターンに当たる", () => {
  const r = pocketcardEmailParser.parse(fixture("pocketcard-usage.txt"));
  assert.ok(normalizeMerchant(r.cardLabel).includes("ZOZOCARD"));
});

test("ポケットカード: キャッシングは自動確定させない", () => {
  const body = fixture("pocketcard-usage.txt").replace("ポケットカード加盟店\n\n■ご利用日時", "ネットキャッシング\n\n■ご利用日時");
  const r = pocketcardEmailParser.parse(body);

  assert.equal(r.usages[0].merchant, "ネットキャッシング");
  assert.equal(r.usages[0].needsReview, true);
});

test("ポケットカード: 宣伝メールは取り込まない", () => {
  const r = pocketcardEmailParser.parse("いつもＺＯＺＯＣＡＲＤ２をご利用いただき、誠にありがとうございます。\nセール開催のお知らせです。");
  assert.equal(r.kind, "other");
});

// ---------------------------------------------------------------- 取引への変換

test("ZOZOカードの利用は店名が無くても被服費になる", () => {
  // seed の「ZOZOカードの利用はすべて被服費」に相当するルール
  const rules: Rule[] = [
    {
      id: "zozo-all",
      priority: 40,
      match_type: "contains",
      pattern: "",
      account_id: "acct-zozo",
      set_type: "expense",
      category_id: "cat-clothes",
      to_account_id: null,
      channel: "card",
      memo_template: null,
      is_active: true,
    },
  ];

  const r = pocketcardEmailParser.parse(fixture("pocketcard-usage.txt"));
  const c = classify({ matchText: r.usages[0].matchText, direction: "out" }, "acct-zozo", rules);

  assert.equal(c.category_id, "cat-clothes");
  assert.equal(c.ruleId, "zozo-all");
});

test("同じメールを2回解析しても重複キーは変わらない", () => {
  const body = fixture("smbc-usage.txt");
  assert.equal(
    smbcEmailParser.parse(body).usages[0].dedupSeed,
    smbcEmailParser.parse(body).usages[0].dedupSeed,
  );
});
