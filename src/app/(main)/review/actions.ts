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

  if (learn && current.merchant_normalized) {
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
  const { data: existing } = await supabase
    .from("rules")
    .select("id")
    .eq("account_id", input.accountId)
    .eq("pattern", input.pattern)
    .maybeSingle();

  const payload = {
    priority: 50,
    match_type: "prefix" as const,
    pattern: input.pattern,
    account_id: input.accountId,
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

  // 覚えたルールを、同じ口座の未分類にもその場で適用する。
  // 前方一致の判定は JS 側で行う（LIKE のワイルドカードを摘要が含む可能性があるため）
  const { data: pendingRows } = await supabase
    .from("transactions")
    .select("id, merchant_normalized")
    .eq("account_id", input.accountId)
    .eq("status", "pending_review");

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
