"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * メール速報は毎日動くのに設定の奥に埋まっていて、開くまでの手数が多かった。
 * 6つ並ぶので文字は小さめにする。
 */
const TABS = [
  { href: "/", label: "ホーム" },
  { href: "/transactions", label: "取引" },
  { href: "/emails", label: "メール" },
  { href: "/accounts", label: "口座" },
  { href: "/import", label: "取込" },
  { href: "/settings", label: "設定" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 border-t border-slate-800 bg-slate-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
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
