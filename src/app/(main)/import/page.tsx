import { ImportForm } from "@/components/import-form";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_COLUMNS, loadImportReminders } from "@/lib/queries";
import { ImportReminderBanner } from "@/components/import-reminder";
import { todayJst } from "@/lib/format";

import type { Account } from "@/lib/types";

type Batch = {
  id: string;
  account_id: string;
  filename: string;
  period_from: string | null;
  period_to: string | null;
  row_count: number;
  dup_count: number;
  imported_at: string;
};

export default async function ImportPage() {
  const supabase = await createClient();
  const [accountsRes, batchesRes, reminders] = await Promise.all([
    supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("is_active", true).order("sort_order"),
    supabase
      .from("import_batches")
      .select("id, account_id, filename, period_from, period_to, row_count, dup_count, imported_at")
      .order("imported_at", { ascending: false })
      .limit(10),
    loadImportReminders(todayJst()),
  ]);

  const accounts = (accountsRes.data ?? []) as Account[];
  const batches = (batchesRes.data ?? []) as Batch[];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  // CSVを取り込むのは入出金のある口座だけ
  const importable = accounts.filter((a) => a.type === "bank" || a.type === "emoney");

  return (
    <>
      <h1 className="text-xl font-bold">CSV取込</h1>
      <p className="mt-1 text-sm text-slate-400">
        京都銀行とゆうちょ銀行に対応しています
      </p>

      {reminders.length > 0 && (
        <div className="mt-4">
          <ImportReminderBanner reminders={reminders} asLink={false} />
        </div>
      )}

      <div className="mt-5">
        <ImportForm accounts={importable} />
      </div>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold text-slate-400">取込履歴</h2>
        {batches.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            まだ取り込んでいません
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            {batches.map((b) => (
              <li key={b.id} className="px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{accountName.get(b.account_id) ?? "?"}</span>
                  <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                    {b.imported_at.slice(0, 10)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {b.filename}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  {b.period_from} 〜 {b.period_to}・{b.row_count}件取込
                  {b.dup_count > 0 && `・${b.dup_count}件は重複で除外`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-xs leading-relaxed text-slate-500">
        <p className="font-medium text-slate-400">取り込みの仕組み</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
          <li>同じ内容のファイルは、ファイル名が違っても二重取込になりません</li>
          <li>
            明細の残高が前後で繋がるかを検証し、取りこぼしがあれば知らせます
          </li>
          <li>
            自動分類ルールに当たらなかった明細は「未分類」に入ります。推測で費目を
            埋めることはしません
          </li>
          <li>
            明細の残高から、CSVで遡れない期間の残高（開始残高）を自動で算出します
          </li>
        </ul>
        <p className="mt-3">
          照会可能期間は 京都銀行が前々月まで、ゆうちょ銀行は先月までです。
          期限を過ぎた月の明細は二度と取得できないため、毎月1日に前月分を落とすのを習慣にしてください。
        </p>
      </section>
    </>
  );
}
