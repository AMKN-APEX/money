import { createClient } from "@/lib/supabase/server";
import type { Account, Category, TxType } from "@/lib/types";

export const ACCOUNT_COLUMNS =
  "id, name, type, issuer, closing_day, payment_day, payment_account_id, is_active, sort_order, note";

export const CATEGORY_COLUMNS = "id, parent_id, name, kind, is_extraordinary, sort_order";

/** 取引フォームに必要なマスタ。口座は有効なものだけ */
export async function loadMasters(): Promise<{
  accounts: Account[];
  categories: Category[];
  error: string | null;
}> {
  const supabase = await createClient();
  const [accountsRes, categoriesRes] = await Promise.all([
    supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("is_active", true).order("sort_order"),
    supabase.from("categories").select(CATEGORY_COLUMNS).order("sort_order"),
  ]);

  return {
    accounts: (accountsRes.data ?? []) as Account[],
    categories: (categoriesRes.data ?? []) as Category[],
    error: accountsRes.error?.message ?? categoriesRes.error?.message ?? null,
  };
}

/**
 * 種別ごとに「最後に使った口座」。取引フォームの既定値に使う。
 * 端末に覚えさせるより、どの端末から開いても同じ既定になるほうが都合がよい。
 */
export async function loadDefaultAccounts(): Promise<Record<TxType, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select("type, account_id")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  const defaults = { income: "", expense: "", transfer: "" } as Record<TxType, string>;
  for (const row of (data ?? []) as { type: TxType; account_id: string }[]) {
    if (!defaults[row.type]) defaults[row.type] = row.account_id;
  }
  return defaults;
}
