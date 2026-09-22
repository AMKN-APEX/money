"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeMerchant } from "@/lib/normalize";
import type { PaymentChannel, TxType } from "@/lib/types";

export type FormState = { error: string | null };

const TX_TYPES: TxType[] = ["income", "expense", "transfer"];
const CHANNELS: PaymentChannel[] = ["card", "id", "apple_pay", "cash", "bank", "emoney"];

type Parsed = {
  date: string;
  amount: number;
  type: TxType;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  merchant: string | null;
  merchant_normalized: string | null;
  channel: PaymentChannel | null;
  memo: string | null;
};

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** 入力を検証して保存できる形にする。エラーは日本語のメッセージで返す */
function parse(formData: FormData): Parsed | string {
  const type = text(formData, "type") as TxType;
  if (!TX_TYPES.includes(type)) return "種別を選んでください";

  // 全角数字・カンマ・円記号を許容する
  const rawAmount = text(formData, "amount").normalize("NFKC").replace(/[,\s¥￥]/g, "");
  const amount = Number(rawAmount);
  if (!rawAmount || !Number.isFinite(amount)) return "金額を数字で入力してください";
  if (!Number.isInteger(amount)) return "金額は1円単位で入力してください";
  if (amount <= 0) return "金額は1円以上で入力してください";

  const date = text(formData, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "日付を選んでください";

  const account_id = text(formData, "account_id");
  if (!account_id) return type === "income" ? "入金先の口座を選んでください" : "口座を選んでください";

  let to_account_id: string | null = null;
  if (type === "transfer") {
    to_account_id = text(formData, "to_account_id") || null;
    if (!to_account_id) return "振替先の口座を選んでください";
    if (to_account_id === account_id) return "振替元と振替先が同じです";
  }

  const channelRaw = text(formData, "channel");
  const channel = CHANNELS.includes(channelRaw as PaymentChannel)
    ? (channelRaw as PaymentChannel)
    : null;

  const merchant = text(formData, "merchant") || null;

  return {
    date,
    amount,
    type,
    account_id,
    to_account_id,
    category_id: text(formData, "category_id") || null,
    merchant,
    // 9.2 の正規化。あとでルール学習に使えるよう手入力でも入れておく
    merchant_normalized: merchant ? normalizeMerchant(merchant) : null,
    channel: type === "expense" ? channel : null,
    memo: text(formData, "memo") || null,
  };
}

export async function createTransaction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parse(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .insert({ ...parsed, source: "manual", status: "confirmed" });

  if (error) return { error: `保存できませんでした: ${error.message}` };

  revalidatePath("/", "layout");
  redirect(`/transactions?month=${parsed.date.slice(0, 7)}`);
}

export async function updateTransaction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");
  if (!id) return { error: "更新対象が分かりません" };

  const parsed = parse(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  // 振替でなくなった場合に to_account_id を必ず消す（制約違反になるため）
  const { error } = await supabase.from("transactions").update(parsed).eq("id", id);

  if (error) return { error: `更新できませんでした: ${error.message}` };

  revalidatePath("/", "layout");
  redirect(`/transactions?month=${parsed.date.slice(0, 7)}`);
}

export async function deleteTransaction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("transactions").delete().eq("id", id);

  revalidatePath("/", "layout");
  redirect(month ? `/transactions?month=${month}` : "/transactions");
}
