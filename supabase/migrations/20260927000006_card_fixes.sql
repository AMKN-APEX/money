-- カードの請求と締め日の補正（2026-09-27）
-- 何度実行しても同じ結果になる。実行後、設定の「カードの残高を計算し直す」を押す。

do $cards$
declare
  uid    uuid;
  amazon uuid;
  debut  uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into amazon from accounts where user_id = uid and name = 'Amazonカード';
  select id into debut  from accounts where user_id = uid and name = '三井住友デビュープラス';

  -- 2026年9月請求（9/26 支払。土曜なので引落は 9/28）の Vpass 明細は、請求を記録する仕組み
  -- （20260927000001）より前の 9/23 に取り込んでいた。落とし直しても中身が同じで
  -- 「取込済み」になり、請求が記録されないままだった。明細の合計行の額を入れる
  insert into card_statements (user_id, account_id, payment_date, amount)
  values (uid, amazon, '2026-09-26', 160051),
         (uid, debut,  '2026-09-26', 110044)
  on conflict (account_id, payment_date) do nothing;

  -- 三井住友2枚は「15日締め」で登録していたが、明細は月末締め
  -- （2026年9月請求 = 8/1〜8/31 の利用。2026年8月請求 = 7/3〜7/31）
  update accounts set closing_day = 31 where id in (amazon, debut);

  -- 口座のメモを今の状態に合わせる（確認待ちだった事項が片付いた）
  update accounts set note = '買い物全般。銀行摘要はデビュープラスと同一（9.3）'
   where id = amazon;
  update accounts set note = 'サブスク・電気・ICOCAチャージ・iD決済'
   where id = debut;
  update accounts set note = 'NISA積立のみ（楽天証券）'
   where user_id = uid and name = '楽天カード';
  update accounts set note = '携帯料金（ソフトバンク）と、ときどき普通の支払い'
   where user_id = uid and name = 'PayPayカード';
  update accounts set note = 'ZOZOTOWN が中心だが、飲食店でも使う。引落日1日'
   where user_id = uid and name = 'ZOZOカード';
end;
$cards$;
