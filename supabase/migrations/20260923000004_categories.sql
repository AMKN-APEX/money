-- 実際に分類してみて足りなかった費目と、その分類ルール（2026-09-23 本人の指示）
-- 何度実行しても同じ結果になる。
--
-- 背景: 明細には店名しか出ないため、「何を買ったか」は本人にも分からない買い物がある。
-- そこで**店の種類で括る費目**を足した。推測で食費や日用品に混ぜるより、
-- 「コンビニでいくら使ったか」のほうが本人にとって意味がある。

do $cat$
declare
  uid      uuid;
  shokuhi  uuid;
  conveni  uuid;
  tsuhan   uuid;
  biyo     uuid;
  sonota   uuid;
  kotsu    uuid;
  kosai    uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into shokuhi from categories
   where user_id = uid and parent_id is null and name = '食費';

  -- コンビニは食費の子にした。買うものの大半は食べ物で、
  -- 独立させると食費の合計が実態より小さく見えるため
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, shokuhi, 'コンビニ', 'expense', 40, false)
  on conflict do nothing;

  -- 通販は中身がばらばら（日用品・娯楽・家電）で、明細からは判別できない。
  -- 「Amazonでいくら使ったか」として見るほうが実態に合う
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, null, '通販', 'expense', 47, false)
  on conflict do nothing;

  -- 散髪・美容院。食費でも日用品でもないので独立させる
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, null, '美容', 'expense', 85, false)
  on conflict do nothing;

  -- どれにも当てはまらない支出の受け皿。
  -- 百貨店やスーパーのように何を買ったか分からない店はここで拾う
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, null, 'その他', 'expense', 190, false)
  on conflict do nothing;

  select id into conveni from categories
   where user_id = uid and parent_id = shokuhi and name = 'コンビニ';
  select id into tsuhan from categories
   where user_id = uid and parent_id is null and name = '通販';
  select id into biyo from categories
   where user_id = uid and parent_id is null and name = '美容';
  select id into kotsu from categories
   where user_id = uid and parent_id is null and name = '交通費';
  select id into kosai from categories
   where user_id = uid and parent_id is null and name = '交際費';

  -- ------------------------------------------------------------ ルール
  -- pattern は normalizeMerchant() を通した形。前方一致なので
  -- 「フアミリーマート」は「ファミリーマート／ｉＤ」にも当たる
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 35, 'prefix', p.pattern, null, 'expense', p.cat, 'card'
  from (values
    ('フアミリーマート', conveni),
    ('ローソン',         conveni),
    ('セブンイレブン',   conveni),
    -- 実データの表記ゆれ用（長音・ハイフン入り）
    ('セブンーイレブン', conveni),
    ('AMAZON.CO.JP',     tsuhan),
    ('LIPPSHAIR',        biyo)
  ) as p(pattern, cat)
  where p.cat is not null
    and not exists (select 1 from rules r where r.user_id = uid and r.pattern = p.pattern);

  -- ------------------------------------------------ 分類し間違えたものの修正
  -- 未分類トレイで学習したルールが実態と違っていた。以後は設定画面から直せる。
  update rules set category_id = kotsu
   where user_id = uid and pattern like 'JR九州%' and kotsu is not null;
  update transactions set category_id = kotsu
   where user_id = uid and merchant_normalized like 'JR九州%' and kotsu is not null;

  update rules set category_id = kosai
   where user_id = uid and pattern like '梅田ワーフ%' and kosai is not null;
  update transactions set category_id = kosai
   where user_id = uid and merchant_normalized like '梅田ワーフ%' and kosai is not null;
end;
$cat$;
