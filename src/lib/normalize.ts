/**
 * 摘要（店名・振込人名）の正規化。設計 docs/design.md 9.2 参照。
 *
 * 銀行の摘要は半角カナで、次の癖がある:
 *   - 長音が ASCII ハイフン `-`（U+002D）で来る  例: ﾎﾟｹﾂﾄｶ-ﾄﾞ
 *   - 小書き文字を使わない                        例: ﾆﾂｸ = ニック
 *   - 長い名称は途中で切れる                      例: ﾊﾟﾅｿﾆﾂｸｲﾝﾀﾞｽﾄﾘ-(ｶ
 *   - 全角スペースが混ざる                        例: 料　金（ゆうちょの詳細１）
 *
 * そのため NFKC だけでは足りず、小書き文字と長音・空白・括弧まで畳んだ
 * 「照合用の形」を作る。ルールの pattern もこの形で保存する。
 */

const SMALL_KANA: Record<string, string> = {
  ァ: "ア",
  ィ: "イ",
  ゥ: "ウ",
  ェ: "エ",
  ォ: "オ",
  ッ: "ツ",
  ャ: "ヤ",
  ュ: "ユ",
  ョ: "ヨ",
  ヮ: "ワ",
  ヵ: "カ",
  ヶ: "ケ",
};

/** 長音として扱う文字（ASCII ハイフン・各種ダッシュ・全角マイナス・波ダッシュ） */
const PROLONGED = /[-‐-―−－ー]/g;

export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(PROLONGED, "ー")
    .replace(/[\s　]+/g, "")
    .replace(/[()（）[\]【】]/g, "")
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => SMALL_KANA[c]);
}

/**
 * 正規化済みの摘要に対してルールの pattern を照合する。
 * 摘要は途中で切れることがあるため、既定は前方一致（prefix）。
 */
export type MatchType = "exact" | "prefix" | "contains" | "regex";

export function matchesPattern(
  normalizedMerchant: string,
  pattern: string,
  matchType: MatchType,
): boolean {
  switch (matchType) {
    case "exact":
      return normalizedMerchant === pattern;
    case "prefix":
      return normalizedMerchant.startsWith(pattern);
    case "contains":
      return normalizedMerchant.includes(pattern);
    case "regex":
      return new RegExp(pattern).test(normalizedMerchant);
  }
}
