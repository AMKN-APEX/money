-- 京都銀行の入金通知メール（給与の速報）を取り込むための設定
-- 設計: docs/design.md 13章。何度実行しても同じ結果になる。
--
-- メールの口座は本文の名前と accounts.card_patterns の部分一致で決める（カードと同じ仕組み）。
-- 京都銀行の通知は「いつも京銀ダイレクトバンキングをご利用いただき…」で始まる。
-- pattern は normalizeMerchant() を通した形。
update accounts
   set card_patterns = array_append(card_patterns, '京銀ダイレクト')
 where name = '京都銀行'
   and not ('京銀ダイレクト' = any(card_patterns));
