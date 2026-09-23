import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_COLUMNS } from "@/lib/queries";
import { SubmitButton } from "@/components/submit-button";
import type { Category, CategoryKind } from "@/lib/types";
import { addCategory, deleteCategory, renameCategory } from "./actions";

const KIND_LABEL: Record<CategoryKind, string> = {
  expense: "支出",
  income: "収入",
  transfer: "振替",
};
const KINDS: CategoryKind[] = ["expense", "income", "transfer"];

export default async function CategoriesPage({ searchParams }: PageProps<"/settings/categories">) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;
  const result = typeof params.result === "string" ? params.result : null;

  const supabase = await createClient();
  const [{ data, error }, usage] = await Promise.all([
    supabase.from("categories").select(CATEGORY_COLUMNS).order("sort_order"),
    supabase.from("transactions").select("category_id"),
  ]);

  if (error) {
    return (
      <>
        <h1 className="text-xl font-bold">費目</h1>
        <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          読み込めませんでした: {error.message}
        </p>
      </>
    );
  }

  const categories = (data ?? []) as Category[];
  const parents = categories.filter((c) => c.parent_id === null);

  // どれだけ使われているかが見えると、整理するときの判断材料になる
  const counts = new Map<string, number>();
  for (const row of (usage.data ?? []) as { category_id: string | null }[]) {
    if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">費目</h1>
        <Link href="/settings" className="text-xs text-slate-400">
          設定へ戻る
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-400">支出・収入の分類。増やしたり名前を変えたりできる</p>

      {result && (
        <p className="mt-4 rounded-xl border border-sky-900 bg-sky-950/40 p-4 text-sm text-sky-200">
          {result}
        </p>
      )}

      {KINDS.map((kind) => {
        const list = parents.filter((p) => p.kind === kind);
        if (list.length === 0) return null;

        return (
          <section key={kind} className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-400">{KIND_LABEL[kind]}</h2>
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
              {list.flatMap((parent) => [
                <Row
                  key={parent.id}
                  category={parent}
                  count={counts.get(parent.id) ?? 0}
                  editing={editId === parent.id}
                  depth={0}
                />,
                ...categories
                  .filter((c) => c.parent_id === parent.id)
                  .map((child) => (
                    <Row
                      key={child.id}
                      category={child}
                      count={counts.get(child.id) ?? 0}
                      editing={editId === child.id}
                      depth={1}
                    />
                  )),
              ])}
            </ul>
          </section>
        );
      })}

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold">費目を追加</h2>
        <form action={addCategory} className="mt-3 flex flex-col gap-3">
          <input
            name="name"
            placeholder="費目名"
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400">親の費目（種別は親に合わせます）</span>
            <select
              name="parent_id"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
            >
              <option value="">なし（大分類として追加）</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {KIND_LABEL[p.kind]} / {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400">種別（親を選んだ場合は無視されます）</span>
            <select
              name="kind"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton
            pendingLabel="追加しています…"
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950"
          >
            追加する
          </SubmitButton>
        </form>
      </section>
    </>
  );
}

function Row({
  category,
  count,
  editing,
  depth,
}: {
  category: Category;
  count: number;
  editing: boolean;
  depth: number;
}) {
  return (
    <li className={depth > 0 ? "pl-8" : ""}>
      <Link
        href={editing ? "/settings/categories" : `/settings/categories?edit=${category.id}`}
        className="flex items-center justify-between gap-3 px-4 py-3"
      >
        <span className="min-w-0 truncate text-sm">
          {depth > 0 && <span className="text-slate-600">└ </span>}
          {category.name}
          {category.is_extraordinary && (
            <span className="ml-2 text-xs text-amber-500">特別支出</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-slate-500 tabular-nums">{count} 件 →</span>
      </Link>

      {editing && (
        <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
          <form action={renameCategory} className="flex gap-2">
            <input type="hidden" name="id" value={category.id} />
            <input
              name="name"
              defaultValue={category.name}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
            />
            <SubmitButton
              pendingLabel="保存中…"
              className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-slate-950"
            >
              名前を保存
            </SubmitButton>
          </form>
          <form action={deleteCategory}>
            <input type="hidden" name="id" value={category.id} />
            <SubmitButton
              pendingLabel="削除しています…"
              className="w-full rounded-lg border border-rose-900 py-2.5 text-xs text-rose-400"
            >
              この費目を削除
            </SubmitButton>
          </form>
        </div>
      )}
    </li>
  );
}
