import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { createClient, getUser } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";

export default async function SettingsPage() {
  const user = await getUser();
  const supabase = await createClient();

  const [categories, rules, pending, batches, unparsedMail] = await Promise.all([
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase.from("rules").select("id", { count: "exact", head: true }),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_review"),
    supabase.from("import_batches").select("id", { count: "exact", head: true }),
    supabase
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "unparsed"),
  ]);

  return (
    <>
      <h1 className="text-xl font-bold">設定</h1>

      <nav className="mt-5 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <Link href="/review" className="flex items-center justify-between px-4 py-3.5 text-sm">
          <span>未分類の取引</span>
          <span className={pending.count ? "text-amber-400 tabular-nums" : "text-slate-500"}>
            {pending.count ?? 0} 件 →
          </span>
        </Link>
        <Link href="/import" className="flex items-center justify-between px-4 py-3.5 text-sm">
          <span>CSV取込</span>
          <span className="text-slate-500 tabular-nums">{batches.count ?? 0} 回 →</span>
        </Link>
        <Link href="/emails" className="flex items-center justify-between px-4 py-3.5 text-sm">
          <span>メール速報</span>
          <span
            className={unparsedMail.count ? "text-amber-400 tabular-nums" : "text-slate-500"}
          >
            未解析 {unparsedMail.count ?? 0} 件 →
          </span>
        </Link>
      </nav>

      <dl className="mt-5 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 text-sm">
        <div className="flex justify-between px-4 py-3">
          <dt className="text-slate-400">ログイン中</dt>
          <dd className="truncate pl-3">{user?.email}</dd>
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
        <SubmitButton
          pendingLabel="ログアウトしています…"
          className="w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300"
        >
          ログアウト
        </SubmitButton>
      </form>
    </>
  );
}
