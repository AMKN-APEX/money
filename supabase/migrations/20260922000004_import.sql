-- CSV取込のための準備
-- 設計: docs/design.md 9.4（照会可能期間）/ 9.5（残高チェーン・同一ファイル判定）

-- ブラウザの crypto.subtle は MD5 を持たないため SHA-256 を使う。
-- 列名が実体と食い違うので改名する。
alter table import_batches rename column file_md5 to file_hash;

-- 開始残高。
-- 取引は CSV が遡れる範囲（京都銀行なら前々月まで）しか無いので、それ以前の
-- 残高をここに置く。CSV の各行が持つ残高（9.5）から逆算して自動で埋める。
alter table accounts add column opening_balance bigint not null default 0;
alter table accounts add column opening_balance_date date;

comment on column accounts.opening_balance is
  'CSV取込時に、明細の残高と取引の積み上げの差から自動算出する。手入力はしない';

-- 残高ビューに開始残高を足す
create or replace view account_balances with (security_invoker = on) as
select
  a.id      as account_id,
  a.user_id as user_id,
  (a.opening_balance + coalesce(sum(
    case
      when t.type = 'income'   and t.account_id    = a.id then  t.amount
      when t.type = 'expense'  and t.account_id    = a.id then -t.amount
      when t.type = 'transfer' and t.account_id    = a.id then -t.amount
      when t.type = 'transfer' and t.to_account_id = a.id then  t.amount
      else 0
    end
  ), 0))::bigint as balance,
  count(t.id)   as transaction_count,
  max(t.date)   as last_transaction_date
from accounts a
left join transactions t
  on t.user_id = a.user_id
 and (t.account_id = a.id or t.to_account_id = a.id)
group by a.id, a.user_id, a.opening_balance;

-- 9.4: 未取込月を検出するため、口座ごとの取込済み期間を引けるようにする
create view import_coverage with (security_invoker = on) as
select
  b.user_id,
  b.account_id,
  min(b.period_from) as covered_from,
  max(b.period_to)   as covered_to,
  max(b.imported_at) as last_imported_at,
  count(*)           as batch_count
from import_batches b
group by b.user_id, b.account_id;
