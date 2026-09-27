-- 楽天カードの利用通知メールを取り込むための設定（2026-09-27）
-- 何度実行しても同じ結果になる。
--
-- メールの口座は本文のカード名と accounts.card_patterns の部分一致で決める。
-- 楽天カードの通知は「楽天カード（Visa）をご利用いただき…」で始まる。
-- pattern は normalizeMerchant() を通した形（全角の括弧は消える: 楽天カードVISA）。
update accounts
   set card_patterns = array_append(card_patterns, '楽天カード')
 where name = '楽天カード'
   and not ('楽天カード' = any(card_patterns));
