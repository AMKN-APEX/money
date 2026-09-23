import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadMasters } from "@/lib/queries";
import { shortDate, yen } from "@/lib/format";
import type { Category, Transaction } from "@/lib/types";
import { resolvePending } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const KIND_LABEL = { expense: "支出", income: "収入", transfer: "振替" } as const;

export default async function ReviewPage() {
  const supabase = await createClient();
  const [pendingRes, masters] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, date, amount, type, account_id, to_account_id, category_id, merchant, merchant_normalized, memo, source, status",
      )
      .eq("status", "pending_review")
      .order("date", { ascending: false })
      .limit(100),
    loadMasters(),
  ]);

  if (pendingRes.error) {
    return (
      <>
        <h1 className="text-xl font-bold">未分類</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          読み込めませんでした: {pendingRes.error.message}
        </p>
      </>
    );
  }

  const pending = (pendingRes.data ?? []) as unknown as Transaction[];
  const accountName = new Map(masters.accounts.map((a) => [a.id, a.name]));

  return (
    <>
      <h1 className="text-xl font-bold">未分類</h1>
      <p className="mt-1 text-sm text-slate-400">
        自動分類ルールに当たらなかった取引です
      </p>

      {pending.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
          未分類の取引はありません
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {pending.map((t) => (
            <form
              key={t.id}
              action={resolvePending}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <input type="hidden" name="id" value={t.id} />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.merchant || "（摘要なし）"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {shortDate(t.date)}・{accountName.get(t.account_id) ?? "?"}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    t.type === "income" ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {t.type === "income" ? "+" : "−"}
                  {yen(t.amount)}
                </span>
              </div>

              {t.memo && <p className="mt-2 text-xs text-amber-400">{t.memo}</p>}

              <div className="mt-3 flex flex-col gap-2">
                <select
                  name="category_id"
                  defaultValue={t.category_id ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">費目を選ぶ</option>
                  {categoryOptions(masters.categories)}
                </select>

                <select
                  name="to_account_id"
                  defaultValue={t.to_account_id ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">振替ではない</option>
                  {masters.accounts
                    .filter((a) => a.id !== t.account_id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        振替先: {a.name}
                      </option>
                    ))}
                </select>
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  name="learn"
                  defaultChecked
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                />
                この摘要を覚えて、次から自動で分類する
              </label>

              {t.merchant_normalized && (
                <p className="mt-1 text-xs text-slate-600">
                  覚える条件: 摘要が「{t.merchant_normalized}」で始まるもの
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <Link
                  href={`/transactions/${t.id}`}
                  className="flex-1 rounded-lg border border-slate-700 py-2.5 text-center text-sm text-slate-300"
                >
                  詳しく編集
                </Link>
                <SubmitButton
                  pendingLabel="確定中…"
                  className="flex-1 rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950"
                >
                  確定
                </SubmitButton>
              </div>
            </form>
          ))}
        </div>
      )}
    </>
  );
}

/** 支出・収入・振替をまとめて選べるようにする（振替先を選ぶと振替になるため） */
function categoryOptions(categories: Category[]) {
  return (["expense", "income", "transfer"] as const).map((kind) => {
    const inKind = categories.filter((c) => c.kind === kind);
    const parents = inKind.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

    return (
      <optgroup key={kind} label={KIND_LABEL[kind]}>
        {parents.flatMap((p) => {
          const kids = inKind
            .filter((c) => c.parent_id === p.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          if (kids.length === 0) {
            return [
              <option key={p.id} value={p.id}>
                {p.name}
              </option>,
            ];
          }
          return kids.map((k) => (
            <option key={k.id} value={k.id}>
              {p.name} / {k.name}
            </option>
          ));
        })}
      </optgroup>
    );
  });
}
