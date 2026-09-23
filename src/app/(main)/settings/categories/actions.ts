"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CategoryKind } from "@/lib/types";

/**
 * 費目の追加・名前変更・削除。
 *
 * 費目は運用しながら増える。「何を買ったか分からない店」を括る費目のように、
 * 使ってみて初めて要ると分かるものが多い。SQLを書かないと足せない状態では
 * 分類そのものが続かないので、画面から触れるようにしてある。
 */

function back(message: string): never {
  redirect(`/settings/categories?result=${encodeURIComponent(message)}`);
}

function done() {
  revalidatePath("/settings/categories");
  revalidatePath("/", "layout");
}

export async function addCategory(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parent_id") ?? "");
  const kind = String(formData.get("kind") ?? "expense") as CategoryKind;
  if (!name) back("費目名を入れてください");

  const supabase = await createClient();

  // 子は親の種別に従う。支出の下に収入がぶら下がると集計が壊れる
  let finalKind = kind;
  if (parentId) {
    const { data: parent } = await supabase
      .from("categories")
      .select("kind")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) back("親の費目が見つかりません");
    finalKind = (parent as { kind: CategoryKind }).kind;
  }

  const { error } = await supabase.from("categories").insert({
    name,
    parent_id: parentId || null,
    kind: finalKind,
    // 末尾に置く。並べ替えはまだ画面から触れない
    sort_order: 500,
  });
  if (error) back(`追加できませんでした: ${error.message}`);

  done();
  back(`「${name}」を追加しました`);
}

export async function renameCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) back("費目名を入れてください");

  const supabase = await createClient();
  const { error } = await supabase.from("categories").update({ name }).eq("id", id);
  if (error) back(`変更できませんでした: ${error.message}`);

  done();
  back(`「${name}」に変更しました`);
}

/**
 * 削除。使われている費目は消さない。
 *
 * 消すと取引の費目が外れて未分類に戻り、何がどこへ行ったか追えなくなる。
 * 使っている取引を先に付け替えてもらう。
 */
export async function deleteCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();

  const [txCount, ruleCount, childCount] = await Promise.all([
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("rules").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", id),
  ]);

  const used: string[] = [];
  if (txCount.count) used.push(`取引 ${txCount.count} 件`);
  if (ruleCount.count) used.push(`ルール ${ruleCount.count} 件`);
  if (childCount.count) used.push(`子の費目 ${childCount.count} 件`);
  if (used.length > 0) {
    back(`${used.join(" / ")} で使われているため削除できません。先に付け替えてください`);
  }

  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) back(`削除できませんでした: ${error.message}`);

  done();
  back("削除しました");
}
