-- PayPayカードの「請求金額のお知らせ」メールを取り込むための設定（2026-10-17）
-- 何度実行しても同じ結果になる。
--
-- メールの口座は本文のカード名と accounts.card_patterns の部分一致で決める。
-- 本文は「利用カード：PayPayカード（Visa）」。
-- pattern は normalizeMerchant() を通した形（英字は大文字、全角の括弧は消える: PAYPAYカードVISA）。
update accounts
   set card_patterns = array_append(card_patterns, 'PAYPAYカード')
 where name = 'PayPayカード'
   and not ('PAYPAYカード' = any(card_patterns));
