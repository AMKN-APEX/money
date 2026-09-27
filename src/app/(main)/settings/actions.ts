"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { reconcileCardOpenings } from "@/lib/reconcile-cards";
import { todayJst } from "@/lib/format";

/**
 * カードの開始残高を計算し直す（9.11）。ふだんは取込のたびに自動で走る。
 * 請求を SQL で足したときなど、取込を挟まずに反映したいときに使う。
 */
export async function recomputeCardBalances() {
  const supabase = await createClient();
  await reconcileCardOpenings(supabase, todayJst());
  revalidatePath("/", "layout");
}
