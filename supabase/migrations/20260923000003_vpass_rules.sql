-- Vpass の実明細で出た摘要の分類（2026-09-23 本人に確認）
-- 設計: docs/design.md 9.10
--
-- 9.7 の「未知の摘要は必ず未分類トレイに送り、そこで1回分類したらルールとして学習する」
-- の流れをそのまま前倒しで入れる。実データで確認済みの摘要だけを対象にする。

do $rules$
declare
  uid     uuid;
  kaden   uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  -- 家電は既存の費目に収まらない。日用品に混ぜると、たまに出る大きな買い物が
  -- 毎月の生活費に紛れて月次の比較が読めなくなる
  insert into categories (user_id, name, kind, sort_order, is_extraordinary)
  values (uid, '家電', 'expense', 45, false)
  on conflict do nothing;

  select id into kaden from categories
   where user_id = uid and parent_id is null and name = '家電';

  -- エルピオ = ガス（電気ではない。エルピオは両方扱うため実物で確認した）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 30, 'prefix', 'エルピオ', null, 'expense',
         (select id from categories c
            where c.user_id = uid and c.name = 'ガス'
              and c.parent_id = (select id from categories p
                                   where p.user_id = uid and p.parent_id is null and p.name = '固定費')),
         'card'
  where not exists (select 1 from rules where user_id = uid and pattern = 'エルピオ');

  -- APPLE COM BILL は金額がばらつくが、いずれもサブスク。
  -- どのサービスかは明細に出ないので、小分類は付けず親の「サブスク」に入れる
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 30, 'prefix', 'APPLECOMBILL', null, 'expense',
         (select id from categories where user_id = uid and parent_id is null and name = 'サブスク'),
         'card'
  where not exists (select 1 from rules where user_id = uid and pattern = 'APPLECOMBILL');

  -- 社内製品従業員購入制度 = 家電の購入（給与天引きではなくカード払い）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 30, 'prefix', '社内製品従業員購入制度', null, 'expense', kaden, 'card'
  where not exists (select 1 from rules where user_id = uid and pattern = '社内製品従業員購入制度');
end;
$rules$;
