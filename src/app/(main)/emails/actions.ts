"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * 利用通知ではないメール（宣伝・ログイン通知・手続き完了など）を受信箱から外す。
 *
 * 削除ではなく status を変えるだけにしてある。GAS は Gmail のメッセージIDで
 * 冪等に送ってくるので、行を消すと次の巡回でまた入ってくる。
 */
export async function ignoreEmail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("email_messages").update({ status: "ignored" }).eq("id", id);

  revalidatePath("/emails");
  revalidatePath("/settings");
}

/** 対象外にしたものを未解析に戻す */
export async function restoreEmail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("email_messages").update({ status: "unparsed" }).eq("id", id);

  revalidatePath("/emails");
  revalidatePath("/settings");
}
