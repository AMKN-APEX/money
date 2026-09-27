-- 未分類トレイの一括分類（2026-09-27 本人の依頼: 「なんとなくこれだろう」で分けて、違うものを指摘する）
-- 何度実行しても同じ結果になる。
--
-- 店名から推測した分類なので、間違いは本人が未分類トレイ以外（取引の詳細）で直す。
-- 推測の方針:
--   - 誰と行ったか分からない飲食店は、酒場・居酒屋を「交際費」、それ以外を「食費 > 外食」
--   - スーパー・百貨店・駅ビル・モールは、design.md のとおり「その他」
--   - 旅行先の宿・観光地・土産は「娯楽」
--   - 薬局は、病院の帰りに寄ったと思われる調剤薬局（エイト薬局）を「医療」、
--     ドラッグストア（スギ薬局）を「日用品」
--
-- 本人の指摘で直したもの（2026-09-27）:
--   - プレミアムウォーターはサブスク / 天満産直市場・ぎゃらりぃ栞屋・京橋ホールは飲み屋なので交際費
--   - 鳥貴族はひとりで行くこともあるのでルールにしない（今ある1件は金額から交際費）
--   - 「コンビニ」を「コンビニ・自販機」に改名 / キンタは外食 / カデイアツクは関空の自販機
--   - ヤマザキタケル 36,305円は会社の経費精算（Claude.ai の料金の立替）
--   - インターネット振込 270,000円は楽天証券への入金（振替）
--   - カードの返品・払い戻しは収入の「返金」（JR九州の払い戻しなど）
--
-- 注意: 「コンビニ」の改名により、20260923000004 / 20260927000002 を流し直すと
--   旧名の費目を作り直したり、見つからずに止まったりする。流し直さないこと。
--
-- 「ミツイスミトモカード」の引落は、摘要でAmazonカードとデビュープラスを区別できない（9.3）。
-- 請求（card_statements）と金額・日付で突き合わせ、1枚に決まるものだけ振替にする。
--
-- **この SQL のあとに、何か1つ明細を取り込むこと。** カードの開始残高は取込のたびに
-- 計算し直している。引落が振替になったぶん、開始残高から外れる必要がある。

do $bulk$
declare
  uid    uuid;
  yucho  uuid;
  amazon uuid;
  debut  uuid;
  hikiotoshi uuid;
  r      record;
  missing text;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception '先に Supabase Auth でユーザーを作成してください';
  end if;

  select id into yucho  from accounts where user_id = uid and name = 'ゆうちょ銀行';
  select id into amazon from accounts where user_id = uid and name = 'Amazonカード';
  select id into debut  from accounts where user_id = uid and name = '三井住友デビュープラス';

  -- ポイントのキャッシュバック（カードの請求から差し引かれる）を受ける収入の費目
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, null, 'ポイント還元', 'income', 240, false)
  on conflict do nothing;

  -- カードの返品・払い戻し。店のルールは支出なので、返品に当てると支出に数えられてしまう
  insert into categories (user_id, parent_id, name, kind, sort_order, is_extraordinary)
  values (uid, null, '返金', 'income', 235, false)
  on conflict do nothing;

  -- 自販機もここに入れるので名前を変える
  update categories c
     set name = 'コンビニ・自販機'
    from categories p
   where p.id = c.parent_id and p.name = '食費'
     and c.user_id = uid and c.name = 'コンビニ';

  -- pattern は normalizeMerchant() を通した形。長いものから当てる
  create temp table bulk_map (
    pattern     text primary key,
    parent      text not null,
    child       text,
    kind        text not null,
    learn       boolean not null,
    yucho_only  boolean not null,
    category_id uuid
  ) on commit drop;

  insert into bulk_map (pattern, parent, child, kind, learn, yucho_only) values
    ('ドスパラ', '家電', null, 'expense', true, false),
    ('エデイオン', '家電', null, 'expense', true, false),
    ('上新電機', '家電', null, 'expense', true, false),
    ('ビツクカメラ', '家電', null, 'expense', true, false),
    ('洋服の青山', '被服費', null, 'expense', true, false),
    ('ユニクロ', '被服費', null, 'expense', true, false),
    ('ジーユー', '被服費', null, 'expense', true, false),
    ('PADDLE.NET*SPEAK', 'サブスク', 'その他', 'expense', true, false),
    ('CLAUDE.AI', 'サブスク', 'その他', 'expense', true, false),
    ('AMAZONプライム会費', 'サブスク', 'その他', 'expense', true, false),
    ('GITHUB', 'サブスク', 'その他', 'expense', true, false),
    ('プレミアムウオーター', 'サブスク', 'その他', 'expense', true, false),
    ('サイゼリヤ', '食費', '外食', 'expense', true, false),
    ('クラズシ', '食費', '外食', 'expense', true, false),
    ('マクドナルド', '食費', '外食', 'expense', true, false),
    ('はま寿司', '食費', '外食', 'expense', true, false),
    ('大阪王将', '食費', '外食', 'expense', true, false),
    ('餃子の王将', '食費', '外食', 'expense', true, false),
    ('丸亀製麺', '食費', '外食', 'expense', true, false),
    ('やよい軒', '食費', '外食', 'expense', true, false),
    ('松屋', '食費', '外食', 'expense', true, false),
    ('松のや', '食費', '外食', 'expense', true, false),
    ('モスバーガー', '食費', '外食', 'expense', true, false),
    ('バーガーキング', '食費', '外食', 'expense', true, false),
    ('KFC', '食費', '外食', 'expense', true, false),
    ('びっくりドンキー', '食費', '外食', 'expense', true, false),
    ('てっぱんのスパゲテイ', '食費', '外食', 'expense', true, false),
    ('釜たけうどん', '食費', '外食', 'expense', true, false),
    ('カプリチヨーザ', '食費', '外食', 'expense', true, false),
    ('パパミラノ', '食費', '外食', 'expense', true, false),
    ('ラの壱', '食費', '外食', 'expense', true, false),
    ('ラクテンペイメンドコロ', '食費', '外食', 'expense', true, false),
    ('沼津魚がし鮨', '食費', '外食', 'expense', true, false),
    ('PLUSTABENTO', '食費', '外食', 'expense', true, false),
    ('JINWON', '食費', '外食', 'expense', true, false),
    ('CASINORESTAURANT', '食費', '外食', 'expense', true, false),
    ('PARTYAENGARDEN', '食費', '外食', 'expense', true, false),
    ('コメダ珈琲', '食費', 'カフェ', 'expense', true, false),
    ('スターバツクス', '食費', 'カフェ', 'expense', true, false),
    ('ラコリーナ', '食費', 'カフェ', 'expense', true, false),
    ('SIZUYA', '食費', 'カフェ', 'expense', true, false),
    ('ミニストツプ', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('もより市', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('キヨスク', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('JRーPLUS', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('コカ・コーラ', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('飲料自販機', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('カンサイコーヒー', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('SSIYU', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('ZIES25', '食費', 'コンビニ・自販機', 'expense', true, false),
    ('ダイニー', '交際費', null, 'expense', true, false),
    ('屋台酒場おおきに', '交際費', null, 'expense', true, false),
    ('コダワリニクサカバ', '交際費', null, 'expense', true, false),
    ('炭火焼鳥権兵衛', '交際費', null, 'expense', true, false),
    ('ミライザカ', '交際費', null, 'expense', true, false),
    ('塚田農場', '交際費', null, 'expense', true, false),
    ('鳥貴族', '交際費', null, 'expense', false, false),
    ('北海道秋葉原', '交際費', null, 'expense', true, false),
    ('バクダンヤ', '交際費', null, 'expense', true, false),
    ('株式会社ス*スペースマーケツト', '交際費', null, 'expense', true, false),
    ('ココイロギフト', '交際費', null, 'expense', true, false),
    ('島村楽器', '娯楽', null, 'expense', true, false),
    ('サウンドスタジオノア', '娯楽', null, 'expense', true, false),
    ('氷川キヤンプ場', '娯楽', null, 'expense', true, false),
    ('チケツトぴあ', '娯楽', null, 'expense', true, false),
    ('USJTICKET', '娯楽', null, 'expense', true, false),
    ('ユニバーサル・スタジオ', '娯楽', null, 'expense', true, false),
    ('ラウンドワン', '娯楽', null, 'expense', true, false),
    ('ビツグエコー', '娯楽', null, 'expense', true, false),
    ('ジヤンカラ', '娯楽', null, 'expense', true, false),
    ('湯快のゆ', '娯楽', null, 'expense', true, false),
    ('STEAM', '娯楽', null, 'expense', true, false),
    ('東京国立博物館', '娯楽', null, 'expense', true, false),
    ('ライヴポケツト', '娯楽', null, 'expense', true, false),
    ('あわじ花さじき', '娯楽', null, 'expense', true, false),
    ('上州屋', '娯楽', null, 'expense', true, false),
    ('ライフフイツト', '娯楽', null, 'expense', true, false),
    ('アパホテル', '娯楽', null, 'expense', true, false),
    ('IMJINKAK', '娯楽', null, 'expense', true, false),
    ('JOONGSOGIUP', '娯楽', null, 'expense', true, false),
    ('PEULAINGKEUBEOGEO', '娯楽', null, 'expense', true, false),
    ('TONGILCHON', '娯楽', null, 'expense', true, false),
    ('JR西日本', '交通費', null, 'expense', true, false),
    ('スマートイーエツクス', '交通費', null, 'expense', true, false),
    ('EXサービス', '交通費', null, 'expense', true, false),
    ('タイムズカー', '交通費', null, 'expense', true, false),
    ('BUSぷらざ', '交通費', null, 'expense', true, false),
    ('SKYTICKET', '交通費', null, 'expense', true, false),
    ('ニツポンレンタカー', '交通費', null, 'expense', true, false),
    ('ニコニコレンタカー', '交通費', null, 'expense', true, false),
    ('トリツプドツトコム', '交通費', null, 'expense', true, false),
    ('UBER*TRIP', '交通費', null, 'expense', true, false),
    ('株式会社LUUP', '交通費', null, 'expense', true, false),
    ('キグナス石油', '交通費', null, 'expense', true, false),
    ('コスモ石油', '交通費', null, 'expense', true, false),
    ('すが歯科', '医療', null, 'expense', true, false),
    ('スガシカ', '医療', null, 'expense', true, false),
    ('萱島生野病院', '医療', null, 'expense', true, false),
    ('デジスマ', '医療', null, 'expense', true, false),
    ('いわさか皮フ科', '医療', null, 'expense', true, false),
    ('エイト薬局', '医療', null, 'expense', true, false),
    ('スギ薬局', '日用品', null, 'expense', true, false),
    ('ニトリ', '日用品', null, 'expense', true, false),
    ('ホームセンターコーナン', '日用品', null, 'expense', true, false),
    ('ビユーテイプレイス', '美容', null, 'expense', true, false),
    ('BEAUTYPLACE', '美容', null, 'expense', true, false),
    ('枚方モール', 'その他', null, 'expense', true, false),
    ('オーパ', 'その他', null, 'expense', true, false),
    ('京都ポルタ', 'その他', null, 'expense', true, false),
    ('東京駅グランスタ', 'その他', null, 'expense', true, false),
    ('阪神百貨店', 'その他', null, 'expense', true, false),
    ('ASTY', 'その他', null, 'expense', true, false),
    ('LUCUA', 'その他', null, 'expense', true, false),
    ('グランフロント', 'その他', null, 'expense', true, false),
    ('広島駅ビル', 'その他', null, 'expense', true, false),
    ('関西空港', 'その他', null, 'expense', true, false),
    ('業務スーパー', 'その他', null, 'expense', true, false),
    ('ライフ寝屋川', 'その他', null, 'expense', true, false),
    ('ダイエー', 'その他', null, 'expense', true, false),
    ('ラクテンペイテンマサンチヨクイチバ', '交際費', null, 'expense', true, false),
    ('ギフトキヨスク', 'その他', null, 'expense', true, false),
    ('えびせんホワイテイ', 'その他', null, 'expense', true, false),
    ('大江ノ郷', 'その他', null, 'expense', true, false),
    ('ぎゃらりぃ栞屋', '交際費', null, 'expense', true, false),
    ('門真運転免許', 'その他', null, 'expense', true, false),
    ('京橋ホール', '交際費', null, 'expense', true, false),
    ('給与', '給与', null, 'income', true, true),
    ('振込ヤマザキタケル', '経費精算', null, 'income', false, true),
    ('ことらモリモトコウヘイ', '送金受取・立替精算', null, 'income', false, true),
    ('カードセブンギンコウ', '現金引出', null, 'expense', false, true),
    ('カード', '現金引出', null, 'expense', false, true),
    ('手数料', '手数料', null, 'expense', true, true),
    ('料金', '手数料', null, 'expense', true, true),
    ('キヤツシユバツク', 'ポイント還元', null, 'income', true, false),
    ('キンタ', '食費', '外食', 'expense', true, false),
    ('カデイアツク', '食費', 'コンビニ・自販機', 'expense', true, false)
;

  update bulk_map m
     set category_id = coalesce(
       (select c.id from categories c
          join categories p on p.id = c.parent_id
         where m.child is not null and c.user_id = uid and p.name = m.parent and c.name = m.child),
       (select c.id from categories c
         where m.child is null and c.user_id = uid and c.parent_id is null and c.name = m.parent));

  select string_agg(parent || coalesce('/' || child, ''), ', ') into missing
    from bulk_map where category_id is null;
  if missing is not null then
    raise exception '費目が見つかりません: %', missing;
  end if;

  -- 今後の取引のためのルール。人名（送金）や、既にルールのあるものは覚えない
  insert into rules (user_id, priority, match_type, pattern, account_id, set_type, category_id)
  select uid, 40, 'prefix', m.pattern, case when m.yucho_only then yucho end,
         m.kind::tx_type, m.category_id
    from bulk_map m
   where m.learn
     and not exists (select 1 from rules x where x.user_id = uid and x.pattern = m.pattern);

  -- 未分類の取引に当てる。長いパターンから順に当て、当たったものは次から外れる
  for r in select * from bulk_map order by length(pattern) desc loop
    update transactions t
       set category_id = r.category_id, status = 'confirmed'
     where t.user_id = uid
       and t.status = 'pending_review'
       and t.type = r.kind::tx_type
       and starts_with(t.merchant_normalized, r.pattern)
       and (not r.yucho_only or t.account_id = yucho);
  end loop;

  -- 三井住友カードの引落を、請求と突き合わせて振替にする
  select c.id into hikiotoshi from categories c
    join categories p on p.id = c.parent_id
   where c.user_id = uid and p.name = '振替' and c.name = 'カード引落';

  update transactions t
     set type = 'transfer', to_account_id = s.account_id, category_id = hikiotoshi,
         status = 'confirmed',
         memo = nullif(regexp_replace(coalesce(t.memo, ''),
                                      '( / )?振替の可能性あり（相手口座を特定できませんでした）', ''), '')
    from card_statements s
   where t.user_id = uid
     and t.status = 'pending_review'
     and starts_with(t.merchant_normalized, 'ミツイスミトモカード')
     and s.account_id in (amazon, debut)
     and s.amount = t.amount
     and abs(s.payment_date - t.date) <= 7
     -- 同じ金額・近い日付の請求が2枚あったら決めない
     and (select count(*) from card_statements s2
           where s2.account_id in (amazon, debut)
             and s2.amount = t.amount
             and abs(s2.payment_date - t.date) <= 7) = 1;

  -- 楽天証券への入金（NISA満額用。design.md 9.2）
  update transactions t
     set type = 'transfer',
         to_account_id = (select id from accounts where user_id = uid and name = '楽天証券'),
         category_id = (select c.id from categories c join categories p on p.id = c.parent_id
                         where c.user_id = uid and p.name = '振替' and c.name = '投資'),
         status = 'confirmed'
   where t.user_id = uid
     and t.status = 'pending_review'
     and starts_with(t.merchant_normalized, 'インターネツトフリコミ')
     and t.amount = 270000 and t.date = '2026-09-06';

  -- カードの返品・払い戻し。明細の金額がマイナスの行は、重複判定キーの金額にマイナスが残っている
  -- （例: …:ＪＲ九州列車予約サービス:-1970:1）。支出として確定済みのものも直す
  update transactions t
     set type = 'income', to_account_id = null, status = 'confirmed',
         category_id = (select id from categories where user_id = uid and parent_id is null and name = '返金')
    from accounts a
   where a.id = t.account_id and a.type = 'credit_card'
     and t.user_id = uid
     and t.source = 'csv'
     and t.dedup_key ~ ':-[0-9]+:[0-9]+$'
     and not starts_with(coalesce(t.merchant_normalized, ''), 'キヤツシユバツク');
end;
$bulk$;
