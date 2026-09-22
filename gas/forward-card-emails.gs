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
 * ── 仕組み ────────────────────────────────────────────────────
 * 送信済みのメールには Gmail のラベルを付けて二度送らないようにする。
 * サーバー側も Gmail のメッセージIDで重複を弾くので、二重計上はしない。
 * 解析はサーバーで後から行う。ここでは中身を見ずにそのまま送る。
 */

var LABEL_NAME = 'money-sent';

/**
 * 対象の差出人。届かないカードがあればここに足す。
 * アプリの「メール」画面で、何が届いて何が届いていないか確認できる。
 */
var SENDERS = [
  'vpass.ne.jp',          // 三井住友カード（Amazonカード / デビュープラス）
  'smbc-card.com',        // 三井住友カード（別ドメインで来る場合）
  'rakuten-card.co.jp',   // 楽天カード
  'mail.rakuten-card.co.jp',
  'paypay-card.co.jp',    // PayPayカード
  'paypay-corp.co.jp',
  'pocketcard.co.jp',     // ポケットカード（ZOZOカード）
  'zozo.jp'
];

/** 一度に送る通数。GAS の実行時間制限に収める */
var BATCH_SIZE = 25;

function forwardCardEmails() {
  var props = PropertiesService.getScriptProperties();
  var endpoint = props.getProperty('ENDPOINT');
  var secret = props.getProperty('INGEST_SECRET');

  if (!endpoint || !secret) {
    throw new Error('スクリプト プロパティに ENDPOINT と INGEST_SECRET を設定してください');
  }

  var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);

  var from = SENDERS.map(function (d) { return 'from:' + d; }).join(' OR ');
  // 取りこぼしても翌月まで拾えるように、少し広めに遡る
  var query = 'newer_than:30d -label:' + LABEL_NAME + ' (' + from + ')';

  var threads = GmailApp.search(query, 0, BATCH_SIZE);
  if (threads.length === 0) {
    Logger.log('送るメールはありません');
    return;
  }

  var messages = [];
  var sentThreads = [];

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var msgs = thread.getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      messages.push({
        gmailId: m.getId(),
        receivedAt: m.getDate().toISOString(),
        from: m.getFrom(),
        subject: m.getSubject(),
        // HTMLメールでも本文テキストを送る。解析はサーバー側で行う
        body: m.getPlainBody()
      });
    }
    sentThreads.push(thread);
  }

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-secret': secret },
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    // ラベルを付けずに終わるので、次回の実行でやり直される
    throw new Error('送信に失敗しました: ' + code + ' ' + response.getContentText());
  }

  // 送れたぶんだけラベルを付ける
  for (var k = 0; k < sentThreads.length; k++) {
    sentThreads[k].addLabel(label);
  }

  Logger.log(messages.length + ' 通送信: ' + response.getContentText());
}

/**
 * 送信済みラベルを外して最初からやり直す。
 * パーサーを直したあとに、過去のメールを解析し直したいときに使う。
 * （サーバー側は Gmail のメッセージIDで重複を弾くので、送り直しても増えない）
 */
function resetSentLabel() {
  var label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) return;

  var threads = label.getThreads();
  for (var i = 0; i < threads.length; i++) {
    threads[i].removeLabel(label);
  }
  Logger.log(threads.length + ' 件のラベルを外しました');
}
