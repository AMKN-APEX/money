"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/(main)/transactions/actions";
import type { Account, Category, CategoryKind, PaymentChannel, TxType } from "@/lib/types";

const TYPES: { value: TxType; label: string; accent: string }[] = [
  { value: "expense", label: "支出", accent: "bg-rose-500 text-slate-950" },
  { value: "income", label: "収入", accent: "bg-emerald-500 text-slate-950" },
  { value: "transfer", label: "振替", accent: "bg-sky-500 text-slate-950" },
];

const KIND_OF: Record<TxType, CategoryKind> = {
  expense: "expense",
  income: "income",
  transfer: "transfer",
};

const CHANNELS: { value: PaymentChannel | ""; label: string }[] = [
  { value: "", label: "指定しない" },
  { value: "card", label: "カード" },
  { value: "id", label: "iD" },
  { value: "apple_pay", label: "Apple Pay" },
  { value: "emoney", label: "電子マネー" },
  { value: "cash", label: "現金" },
  { value: "bank", label: "口座引落・振込" },
];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-emerald-500 py-3.5 text-base font-semibold text-slate-950 transition active:scale-[0.99] disabled:opacity-60"
    >
      {pending ? "保存中…" : label}
    </button>
  );
}

export type TransactionInitial = {
  id?: string;
  type?: TxType;
  amount?: number;
  date?: string;
  account_id?: string;
  to_account_id?: string | null;
  category_id?: string | null;
  merchant?: string | null;
  channel?: PaymentChannel | null;
  memo?: string | null;
};

export function TransactionForm({
  accounts,
  categories,
  action,
  today,
  defaultAccounts,
  initial,
  submitLabel,
}: {
  accounts: Account[];
  categories: Category[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  today: string;
  /** 種別ごとの既定口座（その種別で最後に使ったもの） */
  defaultAccounts: Record<TxType, string>;
  initial?: TransactionInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, { error: null });

  const initialType = initial?.type ?? "expense";
  const [type, setType] = useState<TxType>(initialType);
  const [accountId, setAccountId] = useState(
    initial?.account_id ?? defaultAccounts[initialType] ?? "",
  );
  const [toAccountId, setToAccountId] = useState(initial?.to_account_id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");

  const isEdit = Boolean(initial?.id);

  const kind = KIND_OF[type];
  const visible = categories.filter((c) => c.kind === kind);
  const parents = visible
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const childrenOf = (id: string) =>
    visible.filter((c) => c.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);

  const accountLabel =
    type === "income" ? "入金先" : type === "transfer" ? "振替元" : "支払元";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5"
    >
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="account_id" value={accountId} />
      {type === "transfer" && (
        <input type="hidden" name="to_account_id" value={toAccountId} />
      )}
      <input type="hidden" name="category_id" value={categoryId} />

      {/* 種別 */}
      <div role="group" aria-label="種別" className="grid grid-cols-3 gap-2">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={type === t.value}
            onClick={() => {
              setType(t.value);
              setCategoryId("");
              // 費目も口座も種別ごとに意味が変わるので、既定に引き直す
              if (!isEdit) setAccountId(defaultAccounts[t.value] ?? "");
            }}
            className={`rounded-xl py-2.5 text-sm font-semibold transition ${
              type === t.value ? t.accent : "bg-slate-800 text-slate-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 金額 */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">金額</span>
        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4">
          <span className="text-lg text-slate-500">¥</span>
          <input
            name="amount"
            defaultValue={initial?.amount ?? ""}
            inputMode="numeric"
            pattern="[0-9,]*"
            autoComplete="off"
            required
            autoFocus={!isEdit}
            placeholder="0"
            className="w-full bg-transparent py-3 text-right text-2xl font-semibold tabular-nums outline-none"
          />
        </div>
      </label>

      {/* 日付 */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">日付</span>
        <input
          name="date"
          type="date"
          defaultValue={initial?.date ?? today}
          required
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
      </label>

      {/* 口座 */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">{accountLabel}</span>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        >
          <option value="">選択してください</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {/* 振替先 */}
      {type === "transfer" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">振替先</span>
          <select
            value={toAccountId ?? ""}
            onChange={(e) => setToAccountId(e.target.value)}
            required
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
          >
            <option value="">選択してください</option>
            {accounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      )}

      {/* 費目 */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">
          費目{type === "transfer" && <span className="text-slate-600">（任意）</span>}
        </span>
        <select
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        >
          <option value="">未分類</option>
          {parents.map((p) => {
            const kids = childrenOf(p.id);
            if (kids.length === 0) {
              return (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              );
            }
            return (
              <optgroup key={p.id} label={p.name}>
                {kids.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>

      {/* 店名 */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">
          店名・相手先 <span className="text-slate-600">（任意）</span>
        </span>
        <input
          name="merchant"
          defaultValue={initial?.merchant ?? ""}
          autoComplete="off"
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
      </label>

      {/* 決済手段（方針1: iD はカードの決済チャネルとして記録する） */}
      {type === "expense" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">
            決済手段 <span className="text-slate-600">（任意）</span>
          </span>
          <select
            name="channel"
            defaultValue={initial?.channel ?? ""}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* メモ */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">
          メモ <span className="text-slate-600">（任意）</span>
        </span>
        <input
          name="memo"
          defaultValue={initial?.memo ?? ""}
          autoComplete="off"
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-rose-400">
          {state.error}
        </p>
      )}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
