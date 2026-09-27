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

/**
 * 自動分類ルールの一覧。**費目ごとにまとめて出す**（2026-09-27 本人の希望）。
 * 優先度順に1列で並べていたときは、100件を超えると「どの費目にどんな店が入るか」が読めなかった。
 */
export default async function RulesPage({ searchParams }: PageProps<"/settings/rules">) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;
  // 編集を閉じたあとも、その費目は開いたままにする
  const openKey = typeof params.open === "string" ? params.open : null;
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
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const groups = groupByCategory(rules, categories);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">自動分類ルール</h1>
        <Link href="/settings" className="text-xs text-slate-400">
          設定へ戻る
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        取り込んだ明細を、店名などで自動で分類する条件。費目ごとにまとめてあります
      </p>

      {result && (
        <p className="mt-4 rounded-xl border border-sky-900 bg-sky-950/40 p-4 text-sm text-sky-200">
          {result}
        </p>
      )}

      <p className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
        未分類トレイで「ルールとして覚える」を押すたびに、ここへ1件増えます。
        分類を間違えたまま覚えると以後ずっと同じ間違いをするので、気づいたら押して直してください。
        なお<strong className="text-slate-300">すでに分類済みの取引は、ルールを直しても変わりません</strong>
        （各取引の画面から直せます）。
      </p>

      {rules.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          ルールがまだありません。
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {groups.map((g) => (
            <details
              key={g.key}
              // 編集中のルールがある費目は開いておく
              open={g.key === openKey || g.rules.some((r) => r.id === editId) || undefined}
              className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60"
            >
              <summary className="flex cursor-pointer items-baseline justify-between gap-3 px-4 py-3 text-sm font-semibold">
                <span>{g.label}</span>
                <span className="text-xs font-normal text-slate-500 tabular-nums">{g.rules.length} 件</span>
              </summary>
              <ul className="divide-y divide-slate-800 border-t border-slate-800">
                {g.rules.map((rule) => (
                  <RuleItem
                    key={rule.id}
                    rule={rule}
                    editing={editId === rule.id}
                    groupKey={g.key}
                    categories={categories}
                    accountName={accountName}
                  />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

type Group = { key: string; label: string; rules: RuleRow[] };

/**
 * ルールを費目ごとにまとめる。子の費目（食費 > 外食）は親（食費）の見出しに入れる。
 * 見出しの並びは費目の並び順。費目の付いていないルールは最後の「費目なし」。
 * 見出しの中は小分類ごと、その中を条件の五十音順（どの店が入っているかを探しやすくするため）。
 */
function groupByCategory(rules: RuleRow[], categories: Category[]): Group[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const topOf = (id: string | null): Category | null => {
    const c = id ? byId.get(id) : undefined;
    if (!c) return null;
    return c.parent_id ? (byId.get(c.parent_id) ?? c) : c;
  };

  const groups = new Map<string, Group>();
  for (const rule of rules) {
    const top = topOf(rule.category_id);
    const key = top?.id ?? "none";
    const group = groups.get(key) ?? { key, label: top?.name ?? "費目なし", rules: [] };
    group.rules.push(rule);
    groups.set(key, group);
  }

  const order = new Map(categories.map((c, i) => [c.id, i]));
  const rank = (r: RuleRow) => (r.category_id ? (order.get(r.category_id) ?? Infinity) : Infinity);
  return [...groups.values()]
    .map((g) => ({
      ...g,
      // 見出しの中は小分類（外食・カフェ…）ごとにまとめ、その中を五十音順に
      rules: [...g.rules].sort((a, b) => rank(a) - rank(b) || a.pattern.localeCompare(b.pattern, "ja")),
    }))
    .sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
}

function RuleItem({
  rule,
  editing,
  groupKey,
  categories,
  accountName,
}: {
  rule: RuleRow;
  editing: boolean;
  groupKey: string;
  categories: Category[];
  accountName: Map<string, string>;
}) {
  const category = categories.find((c) => c.id === rule.category_id);
  // 見出しが親の費目なので、行には子の名前だけ添える（親そのものなら出さない）
  const sub = category && category.id !== groupKey ? category.name : null;
  // ふだんと違う点だけ小さく添える。前方一致・全口座・支出は既定なので書かない
  const notes = [
    rule.account_id ? `${accountName.get(rule.account_id) ?? "?"}だけ` : null,
    rule.match_type !== "prefix" ? MATCH_LABEL[rule.match_type] : null,
    rule.set_type && rule.set_type !== "expense" ? TYPE_LABEL[rule.set_type] : null,
    rule.to_account_id ? `→ ${accountName.get(rule.to_account_id) ?? "?"}` : null,
    rule.is_active ? null : "使っていない",
  ].filter(Boolean);

  return (
    <li>
      <Link
        href={editing ? `/settings/rules?open=${groupKey}` : `/settings/rules?edit=${rule.id}`}
        scroll={false}
        className="block px-4 py-2.5"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className={`min-w-0 truncate text-sm ${rule.is_active ? "" : "text-slate-600 line-through"}`}>
            {rule.pattern || "（すべて）"}
          </span>
          {sub && <span className="shrink-0 text-xs text-slate-400">{sub}</span>}
        </div>
        {notes.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{notes.join("・")}</p>}
      </Link>

      {editing && (
        <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/40 p-3">
          <form action={updateRule} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={rule.id} />

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">条件（保存するとき照合用の形に揃えます）</span>
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
}

/** 「固定費 > ガス」のように親を添えて表示する */
function fullName(category: Category, all: Category[]): string {
  if (!category.parent_id) return category.name;
  const parent = all.find((c) => c.id === category.parent_id);
  return parent ? `${parent.name} > ${category.name}` : category.name;
}
