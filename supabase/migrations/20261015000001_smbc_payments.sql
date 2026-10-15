-- 三井住友カードの引落を、請求額で正しいカードに付け直す（2026-10-15 本人の指摘）
-- 何度実行しても同じ結果になる。
--
-- 京都銀行の摘要は Amazonカード / デビュープラスのどちらも「ミツイスミトモカード」（9.3）。
-- 未分類トレイで覚えたルール「ミツイスミトモカードカ → デビュープラス」が全部の引落に当たり、
-- Amazonカードの引落3回（7/27 61,315 / 8/26 40,058 / 9/28 160,051。計 261,424円）が
-- デビュープラスに付いていた。デビュープラスはマイナス（払いすぎ）、Amazonカードは
-- 「まだ請求に入っていない利用」が 32万円 と出ていた。
--
-- 引落と同額の請求が支払日の前後7日にあるカードが1枚だけなら、そのカードに付け直す。
-- これからの取込は src/app/(main)/import/actions.ts で同じ判定をする。

do $smbc$
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

  update transactions t
     set to_account_id = s.account_id
    from card_statements s
   where t.user_id = uid
     and t.type = 'transfer'
     and t.to_account_id in (amazon, debut)
     and s.account_id in (amazon, debut)
     and s.account_id <> t.to_account_id
     and s.amount = t.amount
     and abs(s.payment_date - t.date) <= 7
     -- 同じ金額・近い日付の請求が2枚あったら決めない
     and (select count(*) from card_statements s2
           where s2.account_id in (amazon, debut)
             and s2.amount = t.amount
             and abs(s2.payment_date - t.date) <= 7) = 1;
end;
$smbc$;
