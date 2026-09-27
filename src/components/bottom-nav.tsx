"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 取込とメール速報は設定から開く（2026-09-27 本人の希望）。
 * メールは自動で取り込まれるようになり、取込も月1回なので、下の欄に置くほどではなくなった。
 * 空いた場所に、毎日見たい「分析」を置く。
 */
const TABS = [
  { href: "/", label: "ホーム", also: [] },
  { href: "/transactions", label: "取引", also: [] },
  { href: "/analysis", label: "分析", also: [] },
  { href: "/accounts", label: "口座", also: [] },
  // 設定から開く画面にいるあいだは「設定」を選択中にする
  { href: "/settings", label: "設定", also: ["/import", "/emails", "/review"] },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 border-t border-slate-800 bg-slate-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : [tab.href, ...tab.also].some((p) => pathname.startsWith(p));
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`block py-3.5 text-center text-xs font-medium transition ${
                  active ? "text-emerald-400" : "text-slate-500"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
