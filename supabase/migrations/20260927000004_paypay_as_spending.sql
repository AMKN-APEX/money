-- PayPay残高を追わない。チャージした時点で「使った」とする（2026-09-27 本人の決定）
-- 設計: docs/design.md 方針5 を改める。何度実行しても同じ結果になる。
--
-- 背景: PayPay で払った分を取り込む手段が無く、残高はチャージのたびに増える一方だった。
-- 本人は「チャージした額は、浮いたお金として自由に使う」という使い方をしている。
-- そこでチャージを振替ではなく支出（費目「こづかい」）にし、PayPay残高の口座は止める。
-- PayPay で何に使ったかは追わない。こづかいの枠の中の話として扱う。
--
-- 対象:
--   京都銀行 → PayPay残高 のチャージ（摘要 RS PAYPAY）
--   PayPayカード → PayPay残高 のチャージ（明細の「チャージ」。PayPayクレジットで残高に入れたもの）

do $paypay$
declare
  uid     uuid;
  paypay  uuid;
  ppcard  uuid;
  kozukai uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into paypay from accounts where user_id = uid and name = 'PayPay残高';
  select id into ppcard from accounts where user_id = uid and name = 'PayPayカード';

  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, null, 'こづかい', 'expense', 95, false)
  on conflict do nothing;
  select id into kozukai from categories
   where user_id = uid and parent_id is null and name = 'こづかい';

  -- ルール: PayPay残高への振替 → こづかいの支出
  update rules
     set set_type = 'expense', to_account_id = null, category_id = kozukai
   where user_id = uid and to_account_id = paypay;

  -- PayPayカードの「チャージ」（normalizeMerchant で チヤージ）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 20, 'exact', 'チヤージ', ppcard, 'expense', kozukai, 'card'
   where ppcard is not null
     and not exists (select 1 from rules where user_id = uid and account_id = ppcard and pattern = 'チヤージ');

  -- 取引: PayPay残高への振替 → こづかいの支出
  update transactions
     set type = 'expense', to_account_id = null, category_id = kozukai, status = 'confirmed'
   where user_id = uid and type = 'transfer' and to_account_id = paypay;

  -- 未分類に残っている PayPayカードのチャージ
  update transactions
     set type = 'expense', category_id = kozukai, status = 'confirmed'
   where user_id = uid and account_id = ppcard and merchant_normalized = 'チヤージ'
     and status = 'pending_review';

  -- 口座を止める。取引がまだ残っていたら（手入力など）、消さずに知らせる
  if exists (select 1 from transactions where user_id = uid and (account_id = paypay or to_account_id = paypay)) then
    raise notice 'PayPay残高 を使っている取引が残っています。口座は止めずに残しました';
  else
    update accounts set is_active = false, opening_balance = 0
     where id = paypay;
  end if;
end;
$paypay$;
