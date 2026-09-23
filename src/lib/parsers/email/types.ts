/**
 * カード会社の利用通知メールのパーサー。
 * 設計: docs/design.md 3章 / 13章。
 *
 * CSVパーサー（../types.ts）と分けてある。CSVは「口座を選んでファイルを渡す」
 * のに対し、メールは「どのカードかも本文から読む」ため入口が違う。
 */

/** メール1通から取れた利用1件 */
export type ParsedUsage = {
  /** YYYY-MM-DD（JST） */
  date: string;
  /** HH:MM / HH:MM:SS。取れなければ null */
  time: string | null;
  /** 正の整数（円） */
  amount: number;
  /** 画面に出す利用先。ポケットカードのように出ない会社もある */
  merchant: string;
  /** ルール照合にかける文字列（正規化前） */
  matchText: string;
  /** 利用者に伝えたいこと。null なら何もない */
  memo: string | null;
  /**
   * 自動確定させず必ず人に見せる。
   * キャッシングのように、支出として計上してよいか機械では決められないもの。
   */
  needsReview: boolean;
  /** 重複判定キーの素。口座IDは呼び出し側が前置する */
  dedupSeed: string;
};

export type EmailParserId = "smbc" | "pocketcard";

export type EmailParseResult = {
  /**
   * usage … 利用通知。usages に中身がある
   * other … 宣伝・ログイン通知など、取り込む対象ではないメール
   * error … 利用通知のはずなのに読めなかった。文面が変わった可能性がある
   */
  kind: "usage" | "other" | "error";
  /** 本文に書かれていたカードの名前。口座の特定に使う */
  cardLabel: string | null;
  usages: ParsedUsage[];
  error: string | null;
};

export type EmailParser = {
  id: EmailParserId;
  label: string;
  /** この差出人を担当するか */
  handles(fromAddress: string): boolean;
  parse(body: string): EmailParseResult;
};
