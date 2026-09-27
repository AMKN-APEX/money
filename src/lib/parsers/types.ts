/** パーサーが返す1明細 */
export type ParsedRow = {
  /** YYYY-MM-DD */
  date: string;
  /** 正の整数（円） */
  amount: number;
  /** 口座から見た向き。in = 入金 / out = 出金 */
  direction: "in" | "out";
  /** 画面に出す相手先 */
  merchant: string;
  /** ルール照合にかける文字列（正規化前） */
  matchText: string;
  /** 口座側が持つ一意な明細ID。ゆうちょのみ */
  sourceRef: string | null;
  /** その行の時点の残高。残高チェーン検証（9.5）に使う */
  balanceAfter: number | null;
  /** 重複判定キーの素。口座IDは呼び出し側が前置する */
  dedupSeed: string;
  /** エラー表示用の行番号（1始まり） */
  lineNo: number;
  /**
   * ファイル内に書かれていたカードの名前。
   * Vpass のCSVは1ファイルに複数カードが入るため、行ごとにどのカードか持つ。
   * 口座を利用者に選ばせる銀行CSVでは null。
   */
  cardLabel?: string | null;
  /** 明細に付いてきた補足（iDの店舗名・海外利用のレート・返品など） */
  memo?: string | null;
};

/**
 * カード明細1枚ぶんの請求。支払日にこの額が引き落とされる。
 *
 * 銀行CSVは2〜3ヶ月しか遡れないため、それより前の引落はアプリに入らない。
 * カードの利用だけを遡って取り込むと、払ったはずの額が未払いとして残高に
 * 積み上がる。請求を記録しておき、対応する引落が無いものは「アプリの外で
 * 払い済み」として開始残高に入れる（src/lib/card-statements.ts）。
 */
export type StatementBill = {
  /** YYYY-MM-DD。休日で後ろにずれることがあるので、照合は前後に幅を持たせる */
  paymentDate: string;
  /** 請求額（円） */
  amount: number;
  /** どのカードの請求か。1ファイルに複数カードが入る形式（Vpass）でだけ使う */
  cardLabel?: string | null;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** カード明細の請求。銀行CSVでは空 */
  statements?: StatementBill[];
  periodFrom: string | null;
  periodTo: string | null;
  /** 致命的ではないが利用者に見せたい注意 */
  warnings: string[];
  /** パースそのものが失敗した理由。null なら成功 */
  error: string | null;
};

export type ParserId = "kyoto" | "yucho" | "vpass" | "paypaycard" | "rakuten" | "pocketcard";

export type BankParser = {
  id: ParserId;
  label: string;
  /**
   * 何のファイルを受け付けるか。pdf はブラウザで文字を取り出してから
   * （src/lib/parsers/pdf-lines.ts）パーサーにかける
   */
  format: "csv" | "pdf";
  /**
   * 取り込み先の口座をどう決めるか。
   *   user … 利用者が選ぶ（銀行CSV。ファイルに口座の手がかりが無い）
   *   file … ファイル内のカード名から決める（Vpass。1ファイルに複数カード）
   */
  accountSource: "user" | "file";
  /** その口座のCSVらしいか。アップロード時の取り違え防止 */
  looksLikeMine(text: string): boolean;
  parse(text: string, filename: string, today: string): ParseResult;
};
