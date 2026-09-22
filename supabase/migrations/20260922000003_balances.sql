-- 口座残高のビュー
--
-- 資産口座（銀行・電子マネー・証券）は プラスが残高。
-- 負債口座（クレジットカード）は 利用で減り引落で戻るため、マイナスが未払額になる。
-- 方針6 の発生主義（カード利用日に支出 / 引落日は銀行→カードの振替）と整合する。
--
-- security_invoker を付けることで、参照したユーザーの権限で元テーブルを読む。
-- これが無いとビューの所有者権限で読まれ、RLS を素通りしてしまう。

create view account_balances with (security_invoker = on) as
select
  a.id      as account_id,
  a.user_id as user_id,
  coalesce(sum(
    case
      when t.type = 'income'   and t.account_id    = a.id then  t.amount
      when t.type = 'expense'  and t.account_id    = a.id then -t.amount
      when t.type = 'transfer' and t.account_id    = a.id then -t.amount
      when t.type = 'transfer' and t.to_account_id = a.id then  t.amount
      else 0
    end
  ), 0)::bigint as balance,
  count(t.id)   as transaction_count,
  max(t.date)   as last_transaction_date
from accounts a
left join transactions t
  on t.user_id = a.user_id
 and (t.account_id = a.id or t.to_account_id = a.id)
group by a.id, a.user_id;
