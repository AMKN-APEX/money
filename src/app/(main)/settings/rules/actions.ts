"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeMerchant, type MatchType } from "@/lib/normalize";

/**
 * 自動分類ルールの編集。
 *
 * ルールは未分類トレイで1件分類するたびに勝手に増える（9.7 の「学習」）。
 * 増える一方で直せないと、一度の分類ミスがそのまま将来の全取引に効き続ける。
 * 実際に「ＪＲ九州列車予約サービス → 交際費」で学習してしまい、
 * SQLを書かないと直せない状態になった。それを画面から直せるようにしたもの。
 */

function back(message: string): never {
  redirect(`/settings/rules?result=${encodeURIComponent(message)}`);
}

export async function updateRule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const rawPattern = String(formData.get("pattern") ?? "");
  const matchType = String(formData.get("match_type") ?? "prefix") as MatchType;
  const categoryId = String(formData.get("category_id") ?? "");
  const isActive = formData.get("is_active") === "on";
  if (!id) return;

  // 照合は正規化済みの文字列に対して行う（9.2）。入力をそのまま保存すると、
  // 半角カナや全角で書いたときに永久に当たらないルールができる。
  // 正規表現だけは畳むと壊れるのでそのまま持つ。
  const pattern = matchType === "regex" ? rawPattern.trim() : normalizeMerchant(rawPattern);

  const supabase = await createClient();
  const { error } = await supabase
    .from("rules")
    .update({
      pattern,
      match_type: matchType,
      category_id: categoryId || null,
      is_active: isActive,
    })
    .eq("id", id);
  if (error) back(`保存できませんでした: ${error.message}`);

  revalidatePath("/settings/rules");
  revalidatePath("/", "layout");
  back(`「${pattern}」を保存しました`);
}

export async function deleteRule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("rules").delete().eq("id", id);
  if (error) back(`削除できませんでした: ${error.message}`);

  revalidatePath("/settings/rules");
  revalidatePath("/", "layout");
  // 削除しても、そのルールで分類済みの取引はそのまま残る
  back("削除しました（分類済みの取引はそのままです）");
}
