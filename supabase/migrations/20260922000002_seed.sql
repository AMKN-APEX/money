-- 口座・費目・自動分類ルールの初期投入
-- 設計: docs/design.md 1章（口座マスタ）/ 4章（費目）/ 9.2（摘要パターン）
--
-- 利用者は1名。auth.users の最初の1件を所有者として投入する。
-- 先に Supabase Auth でユーザーを1つ作ってから実行すること。
-- 再実行しても重複しない（on conflict do nothing）。

do $seed$
declare
  uid uuid;
  kyoto  uuid;
  yucho  uuid;
  rakusho uuid;
  paypay uuid;
  amazon uuid;
  debut  uuid;
  zozo   uuid;
  rakuten uuid;
  ppcard uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  -- ------------------------------------------------------------ 資産口座
  insert into accounts (user_id, name, type, issuer, sort_order, note) values
    (uid, '京都銀行',   'bank',       '京都銀行',   10, '給与第一振込。ほぼ全カードの引落元'),
    (uid, 'ゆうちょ銀行','bank',       'ゆうちょ銀行', 20, '給与第二振込。現金引き出しと振込のみ'),
    (uid, '楽天証券',   'securities', '楽天証券',   30, 'NISA積立の受け皿。時価は手動更新'),
    (uid, 'PayPay残高', 'emoney',     'PayPay',     40, '主に京都銀行からチャージ')
  on conflict (user_id, name) do nothing;

  select id into kyoto   from accounts where user_id = uid and name = '京都銀行';
  select id into yucho   from accounts where user_id = uid and name = 'ゆうちょ銀行';
  select id into rakusho from accounts where user_id = uid and name = '楽天証券';
  select id into paypay  from accounts where user_id = uid and name = 'PayPay残高';

  -- ------------------------------------------------------ 負債口座（カード）
  -- 締め日は Vpass 等で要確認のものを note に残す（9.2 で確定しているのは引落日のみ）
  insert into accounts (user_id, name, type, issuer, closing_day, payment_day, payment_account_id, sort_order, note) values
    (uid, 'Amazonカード',        'credit_card', '三井住友カード', 15,   26, kyoto, 50,
     '買い物全般。銀行摘要はデビュープラスと同一（9.3）'),
    (uid, '三井住友デビュープラス','credit_card', '三井住友カード', 15,   26, kyoto, 60,
     'サブスク中心 + iD決済。電気（オクトパスエナジー）もここ'),
    (uid, '楽天カード',           'credit_card', '楽天カード',     null, 27, kyoto, 70,
     'NISA積立のみ（毎月100,000円）。締め日要確認'),
    (uid, 'PayPayカード',         'credit_card', 'PayPayカード',   null, 27, kyoto, 80,
     '携帯料金がここかどうか要確認。締め日要確認'),
    (uid, 'ZOZOカード',           'credit_card', 'ポケットカード', null,  1, kyoto, 90,
     'ZOZOTOWNの衣類のみ。引落摘要 ポケツトカード、引落日1日。締め日要確認')
  on conflict (user_id, name) do nothing;

  select id into amazon  from accounts where user_id = uid and name = 'Amazonカード';
  select id into debut   from accounts where user_id = uid and name = '三井住友デビュープラス';
  select id into rakuten from accounts where user_id = uid and name = '楽天カード';
  select id into ppcard  from accounts where user_id = uid and name = 'PayPayカード';
  select id into zozo    from accounts where user_id = uid and name = 'ZOZOカード';

  -- ---------------------------------------------------------------- 費目
  -- 親
  insert into categories (user_id, name, kind, sort_order, is_extraordinary) values
    (uid, '固定費',   'expense',  10, false),
    (uid, 'サブスク', 'expense',  20, false),
    (uid, '食費',     'expense',  30, false),
    (uid, '日用品',   'expense',  40, false),
    (uid, '被服費',   'expense',  50, false),
    (uid, '交通費',   'expense',  60, false),
    (uid, '娯楽',     'expense',  70, false),
    (uid, '医療',     'expense',  80, false),
    (uid, '交際費',   'expense',  90, false),
    (uid, '現金引出', 'expense', 100, false),
    (uid, '手数料',   'expense', 110, false),
    -- 9.6: 国民年金の追納は一時的な特別支出
    (uid, '社会保険料','expense', 120, true),
    (uid, '給与',     'income',  200, false),
    (uid, '利息',     'income',  210, false),
    (uid, '送金受取・立替精算', 'income', 220, false),
    -- 9.6: 出張交通費の払い戻し。通常収入から除外する
    (uid, '経費精算', 'income',  230, true),
    (uid, '振替',     'transfer',300, false)
  on conflict do nothing;

  -- 子
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  select uid, p.id, c.name, p.kind, c.ord, p.is_extraordinary
  from (values
    ('固定費',   '家賃',   10), ('固定費',   '水道',   20), ('固定費', '電気', 30),
    ('固定費',   'ガス',   40), ('固定費',   '通信費', 50),
    ('サブスク', '動画',   10), ('サブスク', '音楽',   20),
    ('サブスク', 'クラウド',30), ('サブスク', 'その他', 40),
    ('食費',     '食料品', 10), ('食費',     '外食',   20), ('食費', 'カフェ', 30),
    ('社会保険料','国民年金追納', 10),
    ('振替',     '投資',   10), ('振替',     'カード引落', 20), ('振替', 'チャージ', 30)
  ) as c(parent, name, ord)
  join categories p on p.user_id = uid and p.parent_id is null and p.name = c.parent
  on conflict do nothing;

  -- -------------------------------------------------------------- ルール
  -- pattern は src/lib/normalize.ts の normalizeMerchant() を通した形で保存する。
  -- 摘要は途中で切れるため既定は前方一致。9.2 の実データで確認済みのものだけ入れる。
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id, channel, memo_template)
  select uid, r.priority, r.match_type::rule_match_type, r.pattern, kyoto, r.set_type::tx_type,
         (select id from categories c where c.user_id = uid and c.name = r.cat
            and (r.parent is null or c.parent_id = (select id from categories p
                 where p.user_id = uid and p.parent_id is null and p.name = r.parent))
            limit 1),
         r.to_acct, 'bank'::payment_channel, r.memo
  from (values
    (10, 'prefix', 'パナソニツクインダストリー',   'income',   '給与',         null::text, null::uuid, '給与（第一振込）'),
    (10, 'prefix', 'パナソニツクグループシユウチユウフリコミ', 'income', '経費精算', null, null, '出張交通費の払い戻し'),
    (10, 'exact',  'ケツサンオリソク',             'income',   '利息',         null, null, '預金利息'),
    (20, 'exact',  'RSPAYPAY',                     'transfer', 'チャージ',     '振替', paypay,  'PayPay残高へチャージ'),
    (20, 'prefix', 'ラクテンカードサービス',       'transfer', 'カード引落',   '振替', rakuten, 'NISA積立（楽天カード）の引落'),
    (20, 'prefix', 'PAYPAYカード',                 'transfer', 'カード引落',   '振替', ppcard,  null),
    (20, 'prefix', 'ポケツトカード',               'transfer', 'カード引落',   '振替', zozo,    'ZOZOカードの引落'),
    (30, 'prefix', 'ネヤガワスイドウ',             'expense',  '水道',         '固定費', null, null),
    (30, 'prefix', 'フリコミテスウリヨウ',         'expense',  '手数料',       null, null, null),
    (30, 'prefix', 'PEシヤカイホケンリヨウトウ',   'expense',  '国民年金追納', '社会保険料', null, '学生納付特例分の追納')
  ) as r(priority, match_type, pattern, set_type, cat, parent, to_acct, memo)
  where not exists (
    select 1 from rules x where x.user_id = uid and x.pattern = r.pattern and x.account_id = kyoto
  );

  -- 9.3: ミツイスミトモカード は Amazonカード / デビュープラス を摘要で区別できない。
  -- 自動分類せず未分類トレイに送るため、あえてルールを作らない。
  -- 9.2: インターネツトフリコミ は振込先が摘要に出ないため同様。

  -- ZOZOカードの利用はすべて被服費（4章の初期ルール）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, channel)
  select uid, 40, 'contains', '', zozo, 'expense',
         (select id from categories where user_id = uid and name = '被服費'), 'card'
  where not exists (select 1 from rules where user_id = uid and account_id = zozo);

  -- 楽天カードの楽天証券あて（NISA積立）は支出ではなく振替（方針2）
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id)
  select uid, 15, 'contains', 'ラクテンシヨウケン', rakuten, 'transfer',
         (select id from categories c
            where c.user_id = uid and c.name = '投資'
              and c.parent_id = (select id from categories p where p.user_id = uid and p.parent_id is null and p.name = '振替')),
         rakusho
  where not exists (select 1 from rules where user_id = uid and account_id = rakuten and pattern = 'ラクテンシヨウケン');
end;
$seed$;
