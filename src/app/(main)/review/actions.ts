"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TxType } from "@/lib/types";

/**
 * 未分類トレイで1件を確定する。
 *
 * 設計 docs/design.md 9.7:
 * 「未知の摘要は必ず未分類トレイに送り、そこで1回分類したらルールとして学習する」
 * これが無いと、電気の供給元変更のように摘要が変わるたびに分類が壊れていく。
 */
export async function resolvePending(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "") || null;
  const toAccountId = String(formData.get("to_account_id") ?? "") || null;
  const learn = formData.get("learn") === "on";
  if (!id) return;

  const supabase = await createClient();

  const { data: tx } = await supabase
    .from("transactions")
    .select("id, type, account_id, merchant_normalized")
    .eq("id", id)
    .maybeSingle();
  if (!tx) return;

  const current = tx as {
    id: string;
    type: TxType;
    account_id: string;
    merchant_normalized: string | null;
  };

  // 振替先を選んだら振替として扱う
  const type: TxType = toAccountId ? "transfer" : current.type;

  await supabase
    .from("transactions")
    .update({
      type,
      to_account_id: toAccountId,
      category_id: categoryId,
      status: "confirmed",
    })
    .eq("id", id);

  if (learn && current.merchant_normalized && !isPlaceholderMerchant(current.merchant_normalized)) {
    await learnRule(supabase, {
      pattern: current.merchant_normalized,
      accountId: current.account_id,
      type,
      categoryId,
      toAccountId,
    });
  }

  revalidatePath("/", "layout");
}

/**
 * 店名の代わりに入る決まり文句か。
 * ポケットカードの利用通知は店名を出さず「ポケットカード加盟店」等しか入らない（13章）。
 * これをルールとして覚えると、そのカードの以後の利用がすべて同じ費目になる。
 */
function isPlaceholderMerchant(normalized: string): boolean {
  return normalized.endsWith("加盟店") || normalized.endsWith("キヤツシング");
}

/**
 * 分類をルールとして覚える。
 *
 * **カードの支出は全口座に当てる。** 同じ店でも払うカードは変わる。以前は取引の口座に
 * 限定して覚えていたため、Amazonカードで覚えた店をデビュープラスで払うと、また未分類に
 * 入っていた（2026-09-27）。
 * 銀行の摘要（「カード」= ATM引き出し、「手数料」）や振替・収入は、口座ごとに意味が
 * 違うので、今までどおりその口座に限定する。
 */
async function learnRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    pattern: string;
    accountId: string;
    type: TxType;
    categoryId: string | null;
    toAccountId: string | null;
  },
) {
  const { data: account } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", input.accountId)
    .maybeSingle();
  const allAccounts = (account as { type: string } | null)?.type === "credit_card" && input.type === "expense";
  const ruleAccountId = allAccounts ? null : input.accountId;

  const lookup = supabase.from("rules").select("id").eq("pattern", input.pattern);
  const { data: existing } = await (ruleAccountId
    ? lookup.eq("account_id", ruleAccountId)
    : lookup.is("account_id", null)
  ).maybeSingle();

  const payload = {
    priority: 50,
    match_type: "prefix" as const,
    pattern: input.pattern,
    account_id: ruleAccountId,
    set_type: input.type,
    category_id: input.categoryId,
    to_account_id: input.toAccountId,
    is_active: true,
  };

  if (existing) {
    await supabase.from("rules").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("rules").insert(payload);
  }

  // 覚えたルールを、当たる範囲（全口座 or その口座）の未分類にもその場で適用する。
  // 前方一致の判定は JS 側で行う（LIKE のワイルドカードを摘要が含む可能性があるため）
  const pendingQuery = supabase
    .from("transactions")
    .select("id, merchant_normalized")
    .eq("status", "pending_review");
  const { data: pendingRows } = await (ruleAccountId
    ? pendingQuery.eq("account_id", ruleAccountId)
    : // 全口座に当てるのはカードの支出だけ。ほかの口座の返品（収入）には当てない
      pendingQuery.eq("type", "expense"));

  const targets = ((pendingRows ?? []) as { id: string; merchant_normalized: string | null }[])
    .filter((r) => r.merchant_normalized?.startsWith(input.pattern))
    .map((r) => r.id);

  if (targets.length > 0) {
    await supabase
      .from("transactions")
      .update({
        type: input.type,
        to_account_id: input.toAccountId,
        category_id: input.categoryId,
        status: "confirmed",
      })
      .in("id", targets);
  }
}
