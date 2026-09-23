-- メール速報からカードを特定するためのパターン
-- 設計: docs/design.md 13章（Phase 3）
--
-- 実物のメールで判明したこと（2026-09-23）:
--   三井住友  「三井住友カードデビュープラスＶＩＳＡについてカードの利用内容を…」
--   ポケット  「いつもＺＯＺＯＣＡＲＤ２をご利用いただき…」
-- どちらも本文にカードの名前が書かれている。これを使えば、銀行明細では
-- 区別できない三井住友カード2枚（9.3）をメール側で振り分けられる。
--
-- 照合は normalizeMerchant() を通した形の部分一致で行う（ルールの pattern と同じ）。
-- 一致する口座が無いメールは推測で取り込まず、「解析できず」として残す。
-- 取りこぼしに気づけることのほうが、自動で入ることより大事なため。

alter table accounts add column email_card_pattern text;

comment on column accounts.email_card_pattern is
  '利用通知メール本文のカード名に対する部分一致パターン（normalizeMerchant 済みの形）。null は未確認';

do $cards$
declare uid uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  -- 実物のメールで確認済み
  update accounts set email_card_pattern = 'デビユープラス'
   where user_id = uid and name = '三井住友デビュープラス';
  update accounts set email_card_pattern = 'ZOZOCARD'
   where user_id = uid and name = 'ZOZOカード';

  -- 未確認。実物のメールが届いたら文面のカード名に合わせて埋める。
  -- それまでは「解析できず」として受信箱に残り、取り込まれない。
  update accounts
     set note = coalesce(note, '') || ' / 利用通知メールのカード名は未確認（email_card_pattern が null）'
   where user_id = uid
     and name in ('Amazonカード', '楽天カード', 'PayPayカード');
end;
$cards$;
