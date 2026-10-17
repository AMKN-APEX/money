import { test } from "node:test";
import assert from "node:assert/strict";
import { netWorthByMonth, type NetWorthAccount, type NetWorthTx } from "../src/lib/net-worth";

const bank: NetWorthAccount = { id: "bank", type: "bank", opening_balance: 500_000 };
const card: NetWorthAccount = { id: "card", type: "credit_card", opening_balance: 0 };

const tx = (date: string, amount: number, type: NetWorthTx["type"], account_id: string, to_account_id: string | null = null): NetWorthTx => ({
  date,
  amount,
  type,
  account_id,
  to_account_id,
});

test("純資産: 月末までの取引を積み、カードの未払は負債として引く", () => {
  const txs = [
    tx("2026-08-25", 250_000, "income", "bank"),
    tx("2026-08-30", 10_000, "expense", "card"),
    tx("2026-09-15", 3_000, "expense", "card"),
    // カードの引落は振替なので、純資産は動かない
    tx("2026-09-27", 10_000, "transfer", "bank", "card"),
  ];
  const [aug, sep] = netWorthByMonth([bank, card], txs, ["2026-08", "2026-09"], "2026-08-01");

  assert.deepEqual(
    { assets: aug.assets, liabilities: aug.liabilities, net: aug.net },
    { assets: 750_000, liabilities: 10_000, net: 740_000 },
  );
  assert.deepEqual(
    { assets: sep.assets, liabilities: sep.liabilities, net: sep.net },
    { assets: 740_000, liabilities: 3_000, net: 737_000 },
  );
});

test("純資産: 銀行の明細が始まる前に終わる月は分からない（null）", () => {
  const points = netWorthByMonth([bank], [], ["2026-07", "2026-08", "2026-09"], "2026-08-03");
  assert.deepEqual(
    points.map((p) => p.net),
    [null, 500_000, 500_000],
  );
  // 銀行の明細がまったく無ければ全部分からない
  assert.ok(netWorthByMonth([bank], [], ["2026-09"], null).every((p) => p.net === null));
});

test("純資産: 止めた口座（一覧に無い口座）との振替は、こちら側だけ動かす", () => {
  const txs = [tx("2026-09-10", 30_000, "transfer", "bank", "stopped")];
  const [sep] = netWorthByMonth([bank], txs, ["2026-09"], "2026-09-01");
  assert.equal(sep.net, 470_000);
});
