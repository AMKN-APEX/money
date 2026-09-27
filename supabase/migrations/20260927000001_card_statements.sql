-- カード明細の請求と、PDF明細（楽天・ポケットカード）/ PayPayカードCSV の取込に要る変更
-- 設計: docs/design.md 9.11。実ファイルで確認済み（2026-09-27）
--
-- 何度実行しても同じ結果になる。適用済みかは supabase/check-migrations.sql で確かめる。

-- ---------------------------------------------------------------- 請求
-- カード明細1枚ぶんの「支払日にいくら引き落とされるか」。
--
-- 銀行CSVは2〜3ヶ月しか遡れないが、カード明細は15〜24ヶ月遡れる。
-- 利用だけを遡って取り込むと、それに対応する銀行からの引落がアプリに無いため、
-- 払い終わった額がカードの未払いとして残高に積み上がる（楽天だけで100万円超）。
-- 請求を記録し、対応する引落が取引に無いものは「アプリの外で払い済み」として
-- カードの開始残高に入れる（src/lib/card-statements.ts）。
--
-- 支払日1つにつき1件。同じ明細を落とし直してもファイルの中身（作成日時）が
-- 変わるため file_hash では弾けない。ここで一意にしておく。
create table if not exists card_statements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id   uuid not null references accounts (id) on delete cascade,
  payment_date date not null,
  amount       bigint not null check (amount > 0),
  created_at   timestamptz not null default now(),
  unique (account_id, payment_date)
);

alter table card_statements enable row level security;

do $rls$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'card_statements' and policyname = 'card_statements_owner'
  ) then
    create policy card_statements_owner on card_statements for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$rls$;

-- ---------------------------------------------------------------- ルール
do $rules$
declare
  uid     uuid;
  zozo    uuid;
  rakuten uuid;
  ppcard  uuid;
  rakusho uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into zozo    from accounts where user_id = uid and name = 'ZOZOカード';
  select id into rakuten from accounts where user_id = uid and name = '楽天カード';
  select id into ppcard  from accounts where user_id = uid and name = 'PayPayカード';
  select id into rakusho from accounts where user_id = uid and name = '楽天証券';

  -- ZOZOカードは ZOZOTOWN 以外でも使われていた（PDF明細でサイゼリヤ等を確認）。
  -- 「このカードの利用はすべて被服費」の決め打ちをやめ、ZOZOTOWN だけにする。
  -- メール速報は店名が「ポケットカード加盟店」としか出ないため未分類トレイに入り、
  -- PDF明細を取り込んだときに本当の店名で上書きされる。
  update rules set match_type = 'prefix', pattern = 'ZOZOTOWN'
   where user_id = uid and account_id = zozo and match_type = 'contains' and pattern = '';

  -- 楽天の明細は漢字で「楽天証券投信積立」と出る。既存のルールは銀行摘要向けの
  -- カナ（ラクテンシヨウケン）なので当たらない
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id)
  select uid, 15, 'prefix', '楽天証券', rakuten, 'transfer',
         (select id from categories c
            where c.user_id = uid and c.name = '投資'
              and c.parent_id = (select id from categories p where p.user_id = uid and p.parent_id is null and p.name = '振替')),
         rakusho
  where rakuten is not null
    and not exists (select 1 from rules where user_id = uid and account_id = rakuten and pattern = '楽天証券');

  -- 携帯料金は PayPayカード払いだった（確認待ち事項2 が確定）。
  -- 明細の表記は `ソフトバンクМ`。末尾の М はキリル文字で NFKC でも畳まれないので、前方一致にする
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 30, 'prefix', 'ソフトバンク', ppcard, 'expense',
         (select id from categories c
            where c.user_id = uid and c.name = '通信費'
              and c.parent_id = (select id from categories p where p.user_id = uid and p.parent_id is null and p.name = '固定費')),
         'card'
  where ppcard is not null
    and not exists (select 1 from rules where user_id = uid and account_id = ppcard and pattern = 'ソフトバンク');

  -- 締め日（明細から確認）。次回請求予定額（Phase 4）に使う。
  --   楽天カード   … 月末締め・翌月27日払い（8/16利用 → 9/27請求）
  --   PayPayカード … 月末締め・翌月27日払い（7/26利用 → 8/27請求）
  update accounts set closing_day = 31
   where user_id = uid and id in (rakuten, ppcard) and closing_day is null;
end;
$rules$;
