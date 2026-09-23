"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { applyEmailParsers, type EmailApplyResult } from "@/lib/email-apply";

/**
 * 解析の結果を必ず画面に返す。
 *
 * 解析し直した結果また対象外になると、対象外は既定で隠れているため
 * 画面がまったく変わらない。正しく動いていても「押しても何も起きない」
 * ようにしか見えないので、何件をどう処理したかを言葉で出す。
 */
function summarize(r: EmailApplyResult): string {
  if (r.processed === 0 && r.unknownSender === 0) {
    return "解析するメールはありませんでした";
  }

  const parts: string[] = [];
  if (r.created > 0) parts.push(`取引 ${r.created} 件を作成`);
  if (r.duplicated > 0) parts.push(`すでに取引済み ${r.duplicated} 件`);
  if (r.pendingReview > 0) parts.push(`未分類トレイ ${r.pendingReview} 件`);
  if (r.ignored > 0) parts.push(`利用通知ではない ${r.ignored} 件`);
  if (r.failed > 0) parts.push(`解析できず ${r.failed} 件`);
  if (r.unknownSender > 0) parts.push(`パーサー未対応の差出人 ${r.unknownSender} 件`);

  return `${r.processed} 件を解析しました` + (parts.length > 0 ? ` → ${parts.join(" / ")}` : "");
}

/** 未解析のメールを解析する。結果の文言を返す（画面へは呼び出し側が渡す） */
async function runParser(): Promise<string> {
  const user = await getUser();
  if (!user) return "ログインしていません";

  const supabase = await createClient();
  const result = await applyEmailParsers(supabase, user.id);

  revalidatePath("/emails");
  revalidatePath("/", "layout");
  return summarize(result);
}

/** 結果を見せたい画面へ戻る。open を付けるとそのメールを開いた状態にする */
function backToList(result: string, opts: { showIgnored?: boolean; openId?: string } = {}): never {
  const params = new URLSearchParams();
  if (opts.showIgnored) params.set("ignored", "1");
  if (opts.openId) params.set("open", opts.openId);
  params.set("result", result);
  redirect(`/emails?${params.toString()}`);
}

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
 * そのとき画面は変わらないため、結果を文言で見せたうえでそのメールを開いておく。
 */
export async function restoreEmail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("email_messages")
    .update({ status: "unparsed", error: null })
    .eq("id", id);

  const result = await runParser();
  revalidatePath("/settings");
  backToList(result, { showIgnored: true, openId: id });
}

/** 溜まっている未解析メールを解析する */
export async function parseEmails() {
  const result = await runParser();
  backToList(result);
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

  const result = await runParser();
  backToList(result, { openId: id });
}

/**
 * 対象外にしたメールを全部まとめて解析し直す。
 *
 * パーサーが無かった頃に手で対象外にしたメールを拾い直すための操作。
 * 安全に押せる: 利用通知でないメールは、解析がもう一度そう判断して
 * 対象外へ戻る。すでに取引になっているメールは重複キーで弾かれる。
 *
 * 戻り先は対象外を表示した状態にする。隠れたままだと結果を確かめようがない。
 */
export async function reparseIgnored() {
  const supabase = await createClient();
  await supabase
    .from("email_messages")
    .update({ status: "unparsed", error: null })
    .eq("status", "ignored");

  const result = await runParser();
  backToList(result, { showIgnored: true });
}
