import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_COLUMNS, CATEGORY_COLUMNS } from "@/lib/queries";
import { SubmitButton } from "@/components/submit-button";
import type { MatchType } from "@/lib/normalize";
import type { Account, Category, TxType } from "@/lib/types";
import { deleteRule, updateRule } from "./actions";

type RuleRow = {
  id: string;
  priority: number;
  match_type: MatchType;
  pattern: string;
  account_id: string | null;
  set_type: TxType | null;
  category_id: string | null;
  to_account_id: string | null;
  memo_template: string | null;
  is_active: boolean;
};

const MATCH_LABEL: Record<MatchType, string> = {
  exact: "完全一致",
  prefix: "前方一致",
  contains: "含む",
  regex: "正規表現",
};
const MATCH_TYPES: MatchType[] = ["prefix", "contains", "exact", "regex"];
const TYPE_LABEL: Record<TxType, string> = { expense: "支出", income: "収入", transfer: "振替" };

export default async function RulesPage({ searchParams }: PageProps<"/settings/rules">) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;
  const result = typeof params.result === "string" ? params.result : null;

  const supabase = await createClient();
  const [rulesRes, catsRes, accountsRes] = await Promise.all([
    supabase
      .from("rules")
      .select(
        "id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id, memo_template, is_active",
      )
      .order("priority")
      .order("pattern"),
    supabase.from("categories").select(CATEGORY_COLUMNS).order("sort_order"),
    supabase.from("accounts").select(ACCOUNT_COLUMNS).order("sort_order"),
  ]);

  if (rulesRes.error) {
    return (
      <>
        <h1 className="text-xl font-bold">自動分類ルール</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          読み込めませんでした: {rulesRes.error.message}
        </p>
      </>
    );
  }

  const rules = (rulesRes.data ?? []) as RuleRow[];
  const categories = (catsRes.data ?? []) as Category[];
  const accounts = (accountsRes.data ?? []) as Account[];
  const categoryName = new Map(categories.map((c) => [c.id, fullName(c, categories)]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">自動分類ルール</h1>
        <Link href="/settings" className="text-xs text-slate-400">
          設定へ戻る
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        取り込んだ明細を自動で分類する条件。上にあるものから順に当たる
      </p>

      {result && (
        <p className="mt-4 rounded-xl border border-sky-900 bg-sky-950/40 p-4 text-sm text-sky-200">
          {result}
        </p>
      )}

      <p className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
        未分類トレイで「ルールとして覚える」を押すたびに、ここへ1件増えます。
        分類を間違えたまま覚えると以後ずっと同じ間違いをするので、気づいたらここで直してください。
        なお**すでに分類済みの取引は、ルールを直しても変わりません**（各取引の画面から直せます）。
      </p>

      {rules.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          ルールがまだありません。
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {rules.map((rule) => {
            const editing = editId === rule.id;
            return (
              <li
                key={rule.id}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60"
              >
                <Link
                  href={editing ? "/settings/rules" : `/settings/rules?edit=${rule.id}`}
                  className="block px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`min-w-0 truncate text-sm font-medium ${
                        rule.is_active ? "" : "text-slate-600 line-through"
                      }`}
                    >
                      {rule.pattern || "（すべて）"}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {MATCH_LABEL[rule.match_type]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {rule.account_id ? accountName.get(rule.account_id) ?? "?" : "全口座"}
                    {" → "}
                    {rule.set_type && `${TYPE_LABEL[rule.set_type]}・`}
                    <span className="text-slate-200">
                      {rule.category_id ? categoryName.get(rule.category_id) ?? "?" : "費目なし"}
                    </span>
                    {rule.to_account_id && ` → ${accountName.get(rule.to_account_id) ?? "?"}`}
                  </p>
                </Link>

                {editing && (
                  <div className="flex flex-col gap-3 border-t border-slate-800 p-3">
                    <form action={updateRule} className="flex flex-col gap-3">
                      <input type="hidden" name="id" value={rule.id} />

                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs text-slate-400">
                          条件（保存するとき照合用の形に揃えます）
                        </span>
                        <input
                          name="pattern"
                          defaultValue={rule.pattern}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                        />
                      </label>

                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs text-slate-400">当て方</span>
                        <select
                          name="match_type"
                          defaultValue={rule.match_type}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                        >
                          {MATCH_TYPES.map((m) => (
                            <option key={m} value={m}>
                              {MATCH_LABEL[m]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs text-slate-400">費目</span>
                        <select
                          name="category_id"
                          defaultValue={rule.category_id ?? ""}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                        >
                          <option value="">費目なし</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {fullName(c, categories)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="is_active"
                          defaultChecked={rule.is_active}
                          className="size-4 accent-emerald-500"
                        />
                        <span>このルールを使う</span>
                      </label>

                      <SubmitButton
                        pendingLabel="保存中…"
                        className="w-full rounded-lg bg-emerald-500 py-2.5 text-xs font-semibold text-slate-950"
                      >
                        保存する
                      </SubmitButton>
                    </form>

                    <form action={deleteRule}>
                      <input type="hidden" name="id" value={rule.id} />
                      <SubmitButton
                        pendingLabel="削除しています…"
                        className="w-full rounded-lg border border-rose-900 py-2.5 text-xs text-rose-400"
                      >
                        このルールを削除
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 「固定費 > ガス」のように親を添えて表示する */
function fullName(category: Category, all: Category[]): string {
  if (!category.parent_id) return category.name;
  const parent = all.find((c) => c.id === category.parent_id);
  return parent ? `${parent.name} > ${category.name}` : category.name;
}
