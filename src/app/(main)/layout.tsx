import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <div className="flex-1 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto w-full max-w-2xl px-5 py-6">{children}</div>
      </div>
      <BottomNav />
    </div>
  );
}
