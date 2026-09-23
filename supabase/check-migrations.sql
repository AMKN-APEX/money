-- どのマイグレーションまで適用されているかを確かめる。
-- Supabase の SQL Editor に貼って実行する。読むだけで、何も変更しない。
--
-- 1行だけ返る。false の項目が、まだ当てていないマイグレーション。
-- 2026-09-23 に statement_months_back（6番）が未適用だと分かったのがきっかけ。
-- 列が無いと Supabase の select がエラーになるが、アプリ側は空扱いで進むため、
-- 未取込リマインドが黙って動かなくなっていた。**取り込み漏れは取り返せない**ので、
-- 迷ったらこれで確かめる。

with col as (
  select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'accounts'
)
select
  to_regclass('public.transactions')     is not null            as "01_init",
  (select count(*) > 0 from accounts)                           as "02_seed",
  to_regclass('public.account_balances') is not null            as "03_balances",
  exists(select 1 from col where column_name = 'opening_balance')        as "04_import",
  to_regclass('public.import_coverage')  is not null            as "04_coverage",
  exists(select 1 from rules where pattern = 'カード' and channel = 'cash') as "05_yucho_rules",
  exists(select 1 from col where column_name = 'statement_months_back')  as "06_statement_window",
  to_regclass('public.email_messages')   is not null            as "07_email_ingest",
  exists(select 1 from col where column_name = 'card_patterns')          as "0923_02_vpass",
  exists(select 1 from rules where pattern = 'エルピオ')         as "0923_03_vpass_rules",
  -- true なら 0923_02 が途中で止まっている（本来は消える列）
  exists(select 1 from col where column_name = 'email_card_pattern')     as "旧列が残っている";
