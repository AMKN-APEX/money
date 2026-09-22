import Link from "next/link";
import { TransactionForm } from "@/components/transaction-form";
import { loadDefaultAccounts, loadMasters } from "@/lib/queries";
import { todayJst } from "@/lib/format";
import { createTransaction } from "../actions";
import type { TxType } from "@/lib/types";

const TYPES = ["income", "expense", "transfer"];

export default async function NewTransactionPage({
  searchParams,
}: PageProps<"/transactions/new">) {
  const params = await searchParams;
  const rawType = typeof params.type === "string" ? params.type : "";
  const initialType = (TYPES.includes(rawType) ? rawType : "expense") as TxType;

  const [{ accounts, categories, error }, defaultAccounts] = await Promise.all([
    loadMasters(),
    loadDefaultAccounts(),
  ]);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">取引を追加</h1>
        <Link href="/transactions" className="text-sm text-slate-400">
          キャンセル
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          マスタを読み込めませんでした: {error}
        </p>
      ) : (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          action={createTransaction}
          today={todayJst()}
          defaultAccounts={defaultAccounts}
          initial={{ type: initialType }}
          submitLabel="保存"
        />
      )}
    </>
  );
}
