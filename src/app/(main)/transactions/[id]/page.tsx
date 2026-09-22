import Link from "next/link";
import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/transaction-form";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { loadDefaultAccounts, loadMasters } from "@/lib/queries";
import { todayJst } from "@/lib/format";
import { deleteTransaction, updateTransaction } from "../actions";
import type { Transaction } from "@/lib/types";

export default async function EditTransactionPage({ params }: PageProps<"/transactions/[id]">) {
  const { id } = await params;

  const supabase = await createClient();
  const [{ data, error }, masters, defaultAccounts] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, date, amount, type, account_id, to_account_id, category_id, merchant, channel, memo, source, status",
      )
      .eq("id", id)
      .maybeSingle(),
    loadMasters(),
    loadDefaultAccounts(),
  ]);

  if (error) {
    return (
      <p className="rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
        読み込めませんでした: {error.message}
      </p>
    );
  }
  if (!data) notFound();

  const tx = data as unknown as Transaction;
  const month = tx.date.slice(0, 7);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">取引を編集</h1>
        <Link href={`/transactions?month=${month}`} className="text-sm text-slate-400">
          キャンセル
        </Link>
      </div>

      <TransactionForm
        accounts={masters.accounts}
        categories={masters.categories}
        action={updateTransaction}
        today={todayJst()}
        defaultAccounts={defaultAccounts}
        initial={{
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          date: tx.date,
          account_id: tx.account_id,
          to_account_id: tx.to_account_id,
          category_id: tx.category_id,
          merchant: tx.merchant,
          channel: tx.channel,
          memo: tx.memo,
        }}
        submitLabel="更新"
      />

      <form action={deleteTransaction} className="mt-8">
        <input type="hidden" name="id" value={tx.id} />
        <input type="hidden" name="month" value={month} />
        <DeleteButton />
      </form>

      {tx.source !== "manual" && (
        <p className="mt-3 text-xs text-slate-600">
          この取引は{tx.source === "csv" ? "CSV取込" : "メール速報"}由来です。
          削除しても、同じファイル・メールを取り込み直せば復活します。
        </p>
      )}
    </>
  );
}
