import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, lastDayOf, missingMonths } from "../src/lib/import-window";

test("addMonths は年をまたいでも正しい", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-09", -2), "2026-07");
});

test("lastDayOf はうるう年を含めて末日を返す", () => {
  assert.equal(lastDayOf("2026-09"), "2026-09-30");
  assert.equal(lastDayOf("2026-02"), "2026-02-28");
  assert.equal(lastDayOf("2028-02"), "2028-02-29");
});

test("ゆうちょ（先月まで）: 一度も取り込んでいないと先月分だけが対象", () => {
  const got = missingMonths({ today: "2026-09-22", coveredTo: null, monthsBack: 1 });

  assert.deepEqual(
    got.map((m) => m.ym),
    ["2026-08"],
  );
  // 8月分は9月末を過ぎると取れない
  assert.equal(got[0].deadline, "2026-09-30");
  assert.equal(got[0].daysLeft, 8);
});

test("京都銀行（前々月まで）: 未取込なら7月・8月が対象", () => {
  const got = missingMonths({ today: "2026-09-22", coveredTo: null, monthsBack: 2 });

  assert.deepEqual(
    got.map((m) => m.ym),
    ["2026-07", "2026-08"],
  );
  // 7月分の期限は9月末、8月分は10月末
  assert.equal(got[0].deadline, "2026-09-30");
  assert.equal(got[1].deadline, "2026-10-31");
});

test("月末まで取り込めていればその月は対象外", () => {
  const got = missingMonths({ today: "2026-09-22", coveredTo: "2026-08-31", monthsBack: 2 });
  assert.deepEqual(got, []);
});

test("月の途中までしか取り込めていなければ、その月をやり直す", () => {
  const got = missingMonths({ today: "2026-09-22", coveredTo: "2026-08-15", monthsBack: 2 });
  assert.deepEqual(
    got.map((m) => m.ym),
    ["2026-08"],
  );
});

test("すでに取得できなくなった月は挙げない（諦めるしかないため）", () => {
  // 2026-01 までしか取り込めていないが、9月時点で取れるのは7月以降
  const got = missingMonths({ today: "2026-09-22", coveredTo: "2026-01-31", monthsBack: 2 });
  assert.deepEqual(
    got.map((m) => m.ym),
    ["2026-07", "2026-08"],
  );
});

test("今月は終わっていないので対象に含めない", () => {
  const got = missingMonths({ today: "2026-09-30", coveredTo: "2026-08-31", monthsBack: 1 });
  assert.deepEqual(got, []);
});

test("期限当日は daysLeft = 0", () => {
  const got = missingMonths({ today: "2026-09-30", coveredTo: null, monthsBack: 1 });
  assert.equal(got[0].ym, "2026-08");
  assert.equal(got[0].daysLeft, 0);
});
