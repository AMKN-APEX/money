import { signOut } from "@/app/login/actions";
import { createClient, getUser } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const user = await getUser();
  const supabase = await createClient();

  const [categories, rules] = await Promise.all([
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase.from("rules").select("id", { count: "exact", head: true }),
  ]);

  return (
    <>
      <h1 className="text-xl font-bold">設定</h1>

      <dl className="mt-5 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 text-sm">
        <div className="flex justify-between px-4 py-3">
          <dt className="text-slate-400">ログイン中</dt>
          <dd>{user?.email}</dd>
        </div>
        <div className="flex justify-between px-4 py-3">
          <dt className="text-slate-400">費目</dt>
          <dd className="tabular-nums">{categories.count ?? 0} 件</dd>
        </div>
        <div className="flex justify-between px-4 py-3">
          <dt className="text-slate-400">自動分類ルール</dt>
          <dd className="tabular-nums">{rules.count ?? 0} 件</dd>
        </div>
      </dl>

      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300"
        >
          ログアウト
        </button>
      </form>
    </>
  );
}
