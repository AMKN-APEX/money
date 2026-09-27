-- 未分類トレイに溜まっていた取引の分類と、そのルール（2026-09-27 本人の依頼）
-- 何度実行しても同じ結果になる。
--
-- ファミリーマート・Amazon・LIPPS は 20260923000004 でルールを作ったが、
-- **ルールは作ったあとに入ってきた取引にしか効かない**。それより前に取り込んだ
-- 行が未分類のまま残っていた。ここでルールを足したうえで、未分類の行にも当てる。
--
-- 方針は docs/design.md「明細から費目が決められない店の扱い」のとおり:
--   スーパー・百貨店・ショッピングモール … 何を買ったか分からないので「その他」
--   街コン（machicon JAPAN）              … 人に会うための支出なので「交際費」
--
-- 分類しないもの:
--   PayPayカードの「チャージ」30,000円 … 何のチャージか本人に確認中

do $classify$
declare
  uid     uuid;
  conveni uuid;
  tsuhan  uuid;
  biyo    uuid;
  sonota  uuid;
  kosai   uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select c.id into conveni from categories c
    join categories p on p.id = c.parent_id
   where c.user_id = uid and c.name = 'コンビニ' and p.name = '食費';
  select id into tsuhan from categories where user_id = uid and parent_id is null and name = '通販';
  select id into biyo   from categories where user_id = uid and parent_id is null and name = '美容';
  select id into sonota from categories where user_id = uid and parent_id is null and name = 'その他';
  select id into kosai  from categories where user_id = uid and parent_id is null and name = '交際費';

  if conveni is null or tsuhan is null or biyo is null or sonota is null or kosai is null then
    raise exception '費目が見つかりません。20260923000004_categories.sql を先に実行してください';
  end if;

  -- pattern は normalizeMerchant() を通した形（全角→半角・大文字・空白除去・小書き→大書き）
  create temp table classify_map (pattern text primary key, category_id uuid) on commit drop;
  insert into classify_map values
    ('フアミリーマート', conveni),   -- ／ｉＤ 付きも前方一致で当たる
    ('AMAZON.CO.JP',     tsuhan),
    ('LIPPSHAIR',        biyo),
    ('阪急百貨店',       sonota),
    ('平和堂',           sonota),
    ('イオン',           sonota),   -- イオンリテール / イオンスタイル / イオンモール / イオン 大日
    ('無印良品',         sonota),
    ('NUCHAYAMACHI',     sonota),   -- NU茶屋町（梅田のショッピングモール）
    ('MACHICON',         kosai);

  -- 今後の取引のためのルール。どのカードでも同じ扱いなので口座は限定しない。
  -- イオンは前方一致が広いので、優先度を下げておく（イオンシネマ等を別に決めたら、そちらが勝つ）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id)
  select uid, case when m.pattern = 'イオン' then 45 else 35 end, 'prefix', m.pattern, null, 'expense', m.category_id
    from classify_map m
   where not exists (select 1 from rules r where r.user_id = uid and r.pattern = m.pattern);

  -- 未分類のまま残っている支出に当てる。
  -- LIKE だと摘要の _ や % がワイルドカードになるので starts_with で比べる
  update transactions t
     set category_id = m.category_id,
         status      = 'confirmed'
    from classify_map m
   where t.user_id = uid
     and t.status = 'pending_review'
     and t.type = 'expense'
     and starts_with(t.merchant_normalized, m.pattern);
end;
$classify$;
