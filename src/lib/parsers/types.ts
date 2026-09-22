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
};

export type ParseResult = {
  rows: ParsedRow[];
  periodFrom: string | null;
  periodTo: string | null;
  /** 致命的ではないが利用者に見せたい注意 */
  warnings: string[];
  /** パースそのものが失敗した理由。null なら成功 */
  error: string | null;
};

export type ParserId = "kyoto" | "yucho";

export type BankParser = {
  id: ParserId;
  label: string;
  /** その口座のCSVらしいか。アップロード時の取り違え防止 */
  looksLikeMine(text: string): boolean;
  parse(text: string, filename: string, today: string): ParseResult;
};
