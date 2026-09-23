-- Vpass（三井住友カード）のCSV取込に必要な変更
-- 設計: docs/design.md 9.10 / 13章。実ファイルで確認済み（2026-09-23）

-- ---------------------------------------------------------------- カードの特定
-- 1口座に複数の呼び名が要るようになったため、配列にする。
--   デビュープラス … メールは「三井住友カードデビュープラスＶＩＳＡ」、
--                    CSVには「ＡｐｐｌｅＰａｙ／ｉＤ」という別セクションも現れる
-- iD は独立した資金源ではない（方針1）。同じ請求にまとめられていることを
-- 実ファイルの合計行で確認した（デビュープラス 103,632 + iD 6,412 = 110,044）。
-- 別口座にすると同じ支出が2件に見えるので、デビュープラスに寄せる。
alter table accounts add column card_patterns text[] not null default '{}';

comment on column accounts.card_patterns is
  '利用通知メール・CSVに現れるカード名の部分一致パターン（normalizeMerchant 済みの形）。空なら未確認';

update accounts set card_patterns = array[email_card_pattern]
 where email_card_pattern is not null;

alter table accounts drop column email_card_pattern;

-- ------------------------------------------------ 1ファイルに複数カードが入る
-- 同一ファイルから口座ごとに取込履歴を作るため、ファイルの一意性を口座単位にする。
-- 「このファイルは取込済みか」の判定は口座を問わず行うので、二重計上は起きない。
-- 制約名は作成時に自動で付いたもので、列名を変えても追随しない。名前で決め打ちせず引く
do $drop_unique$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'import_batches'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) like '%file_hash%'
     and pg_get_constraintdef(oid) not like '%account_id%';

  if cname is not null then
    execute format('alter table import_batches drop constraint %I', cname);
  end if;
end;
$drop_unique$;

alter table import_batches add constraint import_batches_user_account_file_key
  unique (user_id, account_id, file_hash);

do $vpass$
declare
  uid    uuid;
  debut  uuid;
  amazon uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into debut  from accounts where user_id = uid and name = '三井住友デビュープラス';
  select id into amazon from accounts where user_id = uid and name = 'Amazonカード';

  -- 実物で確認した呼び名
  update accounts set card_patterns = array['デビユープラス', 'APPLEPAY/ID']
   where id = debut;
  -- CSVの表記は「Ａｍａｚｏｎマスター」。通知メールの表記は未確認だが、
  -- どちらも AMAZON を含むはずなので部分一致で拾う
  update accounts set card_patterns = array['AMAZON']
   where id = amazon;

  -- 9.4: Vpass は15ヶ月分を照会できる。当月を0として14ヶ月前まで。
  -- 銀行（京都2 / ゆうちょ1）と違い、取り逃しの心配はほぼ無い
  update accounts set statement_months_back = 14
   where id in (debut, amazon);

  update accounts
     set note = 'サブスク中心 + iD決済。電気（Ｊａｐａｎ電力）とICOCAチャージもここ。'
                'iDはCSVでは別セクションだが同じ請求（方針1）'
   where id = debut;

  -- ------------------------------------------------------------ ルール追加
  -- 方針5: ICOCAは残高を追わず、チャージした時点で交通費として支出計上する。
  -- 実物のCSVで「モバイルＩＣＯＣＡチャージ」5,000円が月5回あることを確認した。
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel, memo_template)
  select uid, 30, 'prefix', 'モバイルICOCAチヤージ', null, 'expense',
         (select id from categories where user_id = uid and name = '交通費' and parent_id is null),
         'card', 'ICOCAチャージ（方針5: チャージ時点で交通費に計上）'
  where not exists (
    select 1 from rules where user_id = uid and pattern = 'モバイルICOCAチヤージ'
  );

  -- 9.7: 電気は三井住友カード払い。実物で摘要が「Ｊａｐａｎ電力株式会社」と判明。
  -- オクトパスエナジーに変更済みのため、次回以降は別の摘要で現れる（未分類トレイ行き）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 30, 'prefix', 'JAPAN電力', null, 'expense',
         (select id from categories c
            where c.user_id = uid and c.name = '電気'
              and c.parent_id = (select id from categories p
                                   where p.user_id = uid and p.parent_id is null and p.name = '固定費')),
         'card'
  where not exists (select 1 from rules where user_id = uid and pattern = 'JAPAN電力');
end;
$vpass$;
