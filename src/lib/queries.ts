import { createClient } from "@/lib/supabase/server";
import type { Account, Category, TxType } from "@/lib/types";
import { missingMonths, type MissingMonth } from "@/lib/import-window";

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

export type ImportReminder = {
  accountId: string;
  accountName: string;
  /** 取得できなくなる前に落とすべき月 */
  months: MissingMonth[];
};

/**
 * 未取込の月を取得期限つきで洗い出す。設計 docs/design.md 9.4。
 *
 * 照会可能期間は金融機関ごとに違い（京都銀行は前々月まで、ゆうちょは先月まで）、
 * 期限を過ぎた月の明細は二度と手に入らない。判定そのものは
 * src/lib/import-window.ts に切り出してあり、テストで固めている。
 */
export async function loadImportReminders(today: string): Promise<ImportReminder[]> {
  const supabase = await createClient();
  const [accountsRes, coverageRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, statement_months_back")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("import_coverage").select("account_id, covered_to"),
  ]);

  const coverage = new Map(
    ((coverageRes.data ?? []) as { account_id: string; covered_to: string | null }[]).map((c) => [
      c.account_id,
      c.covered_to,
    ]),
  );

  const accounts = (accountsRes.data ?? []) as {
    id: string;
    name: string;
    type: string;
    statement_months_back: number | null;
  }[];

  const reminders: ImportReminder[] = [];
  for (const a of accounts) {
    // 遡及月数が設定されていない口座は催促しない（CSVを取らない口座もある）
    if (a.statement_months_back === null) continue;

    const months = missingMonths({
      today,
      coveredTo: coverage.get(a.id) ?? null,
      monthsBack: a.statement_months_back,
    });
    if (months.length > 0) {
      reminders.push({ accountId: a.id, accountName: a.name, months });
    }
  }

  // 期限が近いものを先に見せる
  return reminders.sort((x, y) => x.months[0].daysLeft - y.months[0].daysLeft);
}
