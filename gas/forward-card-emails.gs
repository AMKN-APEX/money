/**
 * カード利用通知メールを家計簿アプリへ転送する Google Apps Script。
 * 設計: docs/design.md 3章
 *
 * ── セットアップ ──────────────────────────────────────────────
 * 1. https://script.google.com/ で新しいプロジェクトを作る
 * 2. このファイルの中身をまるごと貼り付ける
 * 3. 歯車（プロジェクトの設定）→ スクリプト プロパティ に次の2つを追加する
 *      ENDPOINT       https://money-money-6fc1.vercel.app/api/ingest/email
 *      INGEST_SECRET  （Vercel に設定したものと同じ文字列）
 *    ※ コードに直接書かない。プロパティに置けば、共有しても漏れない
 * 4. 関数 `forwardCardEmails` を選んで一度「実行」する
 *    → Gmail へのアクセス許可を求められるので承認する
 * 5. 時計アイコン（トリガー）→ トリガーを追加
 *      実行する関数: forwardCardEmails
 *      イベントのソース: 時間主導型 / 分ベースのタイマー / 10分おき
 *
 * ※ プロジェクト名は自由に変えてよい。ただの表示名で、動作には影響しない。
 *
 * ── 重複をどう防ぐか（2026-09-23 に作り直した） ────────────────
 * **ラベルで送信済みを管理してはいけない。Gmail のラベルはスレッド単位だから。**
 *
 * カードの利用通知は毎回まったく同じ件名で届くため、Gmail がそれらを
 * ひとつのスレッドにまとめる。スレッドにラベルを付ける方式だと、
 *   1通目を送る → スレッドにラベルが付く → 以降の新着は同じスレッドに入る
 *   → `-label:` で除外され、**二度と送られない**
 * という蓋がされる。実際、9/22 の1通で蓋がされ、9/23 の利用通知が
 * 1通も届かなくなっていた。
 *
 * そこでラベルはやめ、**直近 LOOKBACK_DAYS 日ぶんを毎回まるごと送る**。
 * サーバーは Gmail のメッセージIDで重複を弾く（email_messages の
 * unique(user_id, gmail_id)）ので、何度送っても増えない。
 * 「送りすぎても無害、送り漏らすと致命的」なので、重い側に倒してある。
 */

/**
 * 対象の差出人。届かないカードがあればここに足す。
 * アプリの「メール速報」画面で、何が届いて何が届いていないか確認できる。
 */
var SENDERS = [
  'vpass.ne.jp',          // 三井住友カード（Amazonカード / デビュープラス）
  'smbc-card.com',        // 三井住友カード（別ドメインで来る場合）
  'rakuten-card.co.jp',   // 楽天カード
  'mail.rakuten-card.co.jp',
  'paypay-card.co.jp',    // PayPayカード
  'paypay-corp.co.jp',
  'pocketcard.co.jp',     // ポケットカード（ZOZOカード）※ pinf.pocketcard.co.jp も含む
  'zozo.jp'
];

/** 毎回さかのぼる日数。トリガーが数日止まっても取りこぼさない長さにする */
var LOOKBACK_DAYS = 7;

/** 1回のPOSTで送る通数。サーバー側の上限は50 */
var CHUNK = 40;

/** 検索するスレッド数の上限 */
var MAX_THREADS = 200;

/** 10分おきのトリガーから呼ぶ */
function forwardCardEmails() {
  forwardSince(LOOKBACK_DAYS);
}

/**
 * 過去30日ぶんをまとめて送り直す。
 * パーサーを直したあとや、取りこぼしに気づいたときに手で実行する。
 * サーバーが重複を弾くので、何度実行しても取引は増えない。
 */
function backfillCardEmails() {
  forwardSince(30);
}

function forwardSince(days) {
  var props = PropertiesService.getScriptProperties();
  var endpoint = props.getProperty('ENDPOINT');
  var secret = props.getProperty('INGEST_SECRET');

  if (!endpoint || !secret) {
    throw new Error('スクリプト プロパティに ENDPOINT と INGEST_SECRET を設定してください');
  }

  var from = SENDERS.map(function (d) { return 'from:' + d; }).join(' OR ');
  var query = 'newer_than:' + days + 'd (' + from + ')';

  var threads = GmailApp.search(query, 0, MAX_THREADS);
  if (threads.length === 0) {
    Logger.log('対象のメールはありません');
    return;
  }

  // スレッド検索なので、窓の外の古いメッセージも一緒に付いてくる。日時で切る
  var cutoff = new Date().getTime() - days * 24 * 60 * 60 * 1000;

  var messages = [];
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      if (m.getDate().getTime() < cutoff) continue;

      messages.push({
        gmailId: m.getId(),
        receivedAt: m.getDate().toISOString(),
        from: m.getFrom(),
        subject: m.getSubject(),
        // HTMLメールでも本文テキストを送る。解析はサーバー側で行う
        body: m.getPlainBody()
      });
    }
  }

  if (messages.length === 0) {
    Logger.log('対象のメールはありません');
    return;
  }

  var sent = 0;
  for (var k = 0; k < messages.length; k += CHUNK) {
    var chunk = messages.slice(k, k + CHUNK);
    var response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-ingest-secret': secret },
      payload: JSON.stringify({ messages: chunk }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      // 次回の実行でやり直される（送信済みの記録を持たないため、取りこぼさない）
      throw new Error('送信に失敗しました: ' + code + ' ' + response.getContentText());
    }

    sent += chunk.length;
    Logger.log(chunk.length + ' 通送信: ' + response.getContentText());
  }

  Logger.log('合計 ' + sent + ' 通を送信しました（' + days + '日ぶん）');
}

/**
 * 旧版が付けていた money-sent ラベルを外して消す。
 * 新しい方式では使わない。1回だけ実行すればよい。
 */
function removeLegacySentLabel() {
  var label = GmailApp.getUserLabelByName('money-sent');
  if (!label) {
    Logger.log('money-sent ラベルはありません');
    return;
  }

  var threads = label.getThreads();
  for (var i = 0; i < threads.length; i++) {
    threads[i].removeLabel(label);
  }
  label.deleteLabel();
  Logger.log(threads.length + ' 件からラベルを外して削除しました');
}
