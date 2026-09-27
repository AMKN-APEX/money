-- カードの店のルールを、どのカードで払っても当たるようにする（2026-09-27 本人の指摘）
-- 何度実行しても同じ結果になる。
--
-- 未分類トレイで覚えたルールは、その取引の口座に限定されていた（「Amazonカードだけ」）。
-- 同じ店をほかのカードで払うと当たらず、また未分類に入る。
-- カードの支出のルールは全口座向けにする。これから覚えるものも同じ（review/actions.ts）。
--
-- 限定したまま残すもの:
--   - 振替のルール（楽天カードの「楽天証券」= 積立 など。どの口座からかに意味がある）
--   - 銀行の口座のルール（ゆうちょの「カード」= ATM引き出し など。摘要が口座ごとに違う意味を持つ）
--   - PayPayカードの「チャージ」（ほかの口座の「チャージ」は別のものの場合がある）

do $rules$
declare
  uid uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  create temp table card_rules on commit drop as
  select r.id, r.pattern
    from rules r
    join accounts a on a.id = r.account_id
   where r.user_id = uid
     and a.type = 'credit_card'
     and r.set_type = 'expense'
     and r.to_account_id is null
     and r.pattern <> ''
     and r.pattern <> 'チヤージ';

  -- 同じ条件の全口座向けルールがすでにあれば、限定版は要らない（全口座向けが先に当たる）
  delete from rules r
   using card_rules c
   where r.id = c.id
     and exists (
       select 1 from rules g
        where g.user_id = uid and g.account_id is null and g.pattern = c.pattern
     );

  -- 残りは全口座向けにする。同じ条件のものが複数のカードにあれば、1つだけ全口座向けにして残りは消す
  delete from rules r
   using card_rules c
   where r.id = c.id
     and exists (
       select 1 from card_rules c2
        join rules r2 on r2.id = c2.id
        where c2.pattern = c.pattern and c2.id < c.id
     );

  update rules r
     set account_id = null
    from card_rules c
   where r.id = c.id;
end;
$rules$;
