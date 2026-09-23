"use server";

import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { applyEmailParsers } from "@/lib/email-apply";

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

/**
 * 対象外にしたものを未解析に戻し、そのまま解析まで走らせる。
 *
 * 戻すのは「もう一度解析させたい」ときなので、解析しないと押した意味がない。
 * 利用通知でないメールなら、解析がもう一度そう判断して対象外に戻る。
 */
export async function restoreEmail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("email_messages")
    .update({ status: "unparsed", error: null })
    .eq("id", id);

  await parseEmails();
  revalidatePath("/settings");
}

/**
 * 溜まっている未解析メールを解析して取引にする。
 *
 * 受信時（api/ingest/email）にも同じ処理が走るので、ふだんは押す必要がない。
 * パーサーを直したあとに「解析できず」のメールをやり直すためのボタン。
 */
export async function parseEmails() {
  const user = await getUser();
  if (!user) return;

  const supabase = await createClient();
  await applyEmailParsers(supabase, user.id);

  revalidatePath("/emails");
  revalidatePath("/", "layout");
}

/** 「解析できず」を未解析に戻して、もう一度解析させる */
export async function retryEmail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("email_messages")
    .update({ status: "unparsed", error: null })
    .eq("id", id);

  await parseEmails();
}

/**
 * 対象外にしたメールを全部まとめて解析し直す。
 *
 * パーサーが無かった頃に手で対象外にしたメールを拾い直すための操作。
 * 安全に押せる: 利用通知でないメールは、解析がもう一度そう判断して
 * 対象外へ戻る。すでに取引になっているメールは重複キーで弾かれる。
 */
export async function reparseIgnored() {
  const supabase = await createClient();
  await supabase
    .from("email_messages")
    .update({ status: "unparsed", error: null })
    .eq("status", "ignored");

  await parseEmails();
}
