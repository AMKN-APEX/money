-- ゆうちょ銀行の自動分類ルール
-- 設計: docs/design.md 9.1「分類ルール（詳細１ベース）」
--
-- ゆうちょは 詳細１（取引種別）+ 詳細２（相手方）を連結した文字列に対して
-- 前方一致で照合する。詳細１ が先頭に来るため、種別だけで判定できる。
-- 再実行しても重複しない。

do $seed$
declare
  uid   uuid;
  yucho uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into yucho from accounts where user_id = uid and name = 'ゆうちょ銀行';
  if yucho is null then
    raise exception 'ゆうちょ銀行の口座がありません。seed を先に流してください';
  end if;

  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel, memo_template)
  select uid, r.priority, r.match_type::rule_match_type, r.pattern, yucho, r.set_type::tx_type,
         (select id from categories c
            where c.user_id = uid and c.name = r.cat
              and (r.parent is null or c.parent_id = (select id from categories p
                   where p.user_id = uid and p.parent_id is null and p.name = r.parent))
            limit 1),
         r.channel::payment_channel, r.memo
  from (values
    -- 方針3: 現金は引き出した時点で支出。使途は追わない
    (10, 'prefix', 'カード',   'expense', '現金引出', null::text, 'cash', 'ATMでの現金引き出し'),
    (10, 'prefix', '手数料',   'expense', '手数料',   null, 'bank', null),
    (10, 'prefix', '料金',     'expense', '手数料',   null, 'bank', null),
    (10, 'prefix', '給与',     'income',  '給与',     null, 'bank', '給与（第二振込）'),
    (10, 'prefix', 'ことら',   'income',  '送金受取・立替精算', null, 'bank', null)
  ) as r(priority, match_type, pattern, set_type, cat, parent, channel, memo)
  where not exists (
    select 1 from rules x where x.user_id = uid and x.account_id = yucho and x.pattern = r.pattern
  );

  -- 9.1: 詳細１ = 振込 は相手が個人なら送金受取、法人なら内容次第で判断が分かれる。
  -- 自動で決められないのでルールを作らず、未分類トレイに送る。
end;
$seed$;
