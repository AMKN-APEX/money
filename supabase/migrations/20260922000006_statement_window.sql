-- 口座ごとの照会可能期間
-- 設計: docs/design.md 9.4
--
-- 何ヶ月前まで明細をダウンロードできるか。当月を 0 として数える。
--   京都銀行  前々月まで → 2
--   ゆうちょ  先月まで   → 1（2026-09-22 に判明。当初は「全期間」と表示されていた）
--
-- ある月 M の明細は、M の statement_months_back ヶ月後の末日を過ぎると
-- 二度と取得できない。取り込み忘れがそのまま永久の欠損になるため、
-- アプリはこの値から取得期限を逆算して催促する。

alter table accounts add column statement_months_back smallint
  check (statement_months_back between 0 and 120);

comment on column accounts.statement_months_back is
  '明細をダウンロードできる遡及月数。当月=0。null は期限の催促をしない';

do $win$
declare uid uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  update accounts set statement_months_back = 2
    where user_id = uid and name = '京都銀行';
  update accounts set statement_months_back = 1
    where user_id = uid and name = 'ゆうちょ銀行';

  update accounts
     set note = 'ゆうちょダイレクトは先月・今月の2ヶ月分しか照会できない。毎月必ず取得すること'
   where user_id = uid and name = 'ゆうちょ銀行';
end;
$win$;
