import { matchesPattern, normalizeMerchant, type MatchType } from "./normalize";
import type { PaymentChannel, TxType } from "./types";

export type Rule = {
  id: string;
  priority: number;
  match_type: MatchType;
  pattern: string;
  /** null なら全口座が対象 */
  account_id: string | null;
  set_type: TxType | null;
  category_id: string | null;
  to_account_id: string | null;
  channel: PaymentChannel | null;
  memo_template: string | null;
  is_active: boolean;
};

export type Classification = {
  type: TxType;
  category_id: string | null;
  to_account_id: string | null;
  channel: PaymentChannel | null;
  memo: string | null;
  /** 当たったルール。null なら未分類トレイ行き */
  ruleId: string | null;
};

/**
 * 摘要からルールを引いて取引の形を決める。
 * 設計 docs/design.md 9.7 のとおり、**当たらなかったものは必ず未分類にする**。
 * 推測で費目を埋めると、契約先変更などで摘要が変わったことに気づけなくなる。
 */
export function classify(
  input: { matchText: string; direction: "in" | "out" },
  accountId: string,
  rules: Rule[],
): Classification {
  const normalized = normalizeMerchant(input.matchText);

  const candidates = rules
    .filter((r) => r.is_active)
    .filter((r) => r.account_id === null || r.account_id === accountId)
    .sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length);

  for (const rule of candidates) {
    if (!matchesPattern(normalized, rule.pattern, rule.match_type)) continue;

    const type = rule.set_type ?? fallbackType(input.direction);
    return {
      type,
      category_id: rule.category_id,
      to_account_id: type === "transfer" ? rule.to_account_id : null,
      channel: rule.channel,
      memo: rule.memo_template,
      ruleId: rule.id,
    };
  }

  return {
    type: fallbackType(input.direction),
    category_id: null,
    to_account_id: null,
    channel: null,
    memo: null,
    ruleId: null,
  };
}

function fallbackType(direction: "in" | "out"): TxType {
  return direction === "in" ? "income" : "expense";
}

/**
 * 振替として分類されたのに相手口座が決まらない場合は取り込めない。
 * 9.3 の「三井住友カード2枚を摘要で区別できない」がこれに当たる。
 */
export function isIncomplete(c: Classification): boolean {
  return c.type === "transfer" && !c.to_account_id;
}
