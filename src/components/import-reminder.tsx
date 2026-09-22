import Link from "next/link";
import { monthLabel } from "@/lib/import-window";
import type { ImportReminder } from "@/lib/queries";

/**
 * 未取込の月と取得期限の掲示。設計 docs/design.md 9.4。
 * 期限を過ぎた月の明細は二度と手に入らないので、残り日数を前面に出す。
 */
export function ImportReminderBanner({
  reminders,
  asLink = true,
}: {
  reminders: ImportReminder[];
  asLink?: boolean;
}) {
  if (reminders.length === 0) return null;

  const soonest = Math.min(...reminders.map((r) => r.months[0].daysLeft));
  const urgent = soonest <= 7;

  const body = (
    <>
      <p className={`font-semibold ${urgent ? "text-rose-300" : "text-sky-300"}`}>
        {urgent
          ? `CSVの取得期限が迫っています（あと${soonest}日）`
          : "取り込んでいない月があります"}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {reminders.map((r) =>
          r.months.map((m) => (
            <li
              key={`${r.accountId}-${m.ym}`}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="text-slate-300">
                {r.accountName} {monthLabel(m.ym)}分
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  m.daysLeft <= 7 ? "text-rose-400" : "text-slate-400"
                }`}
              >
                {m.deadline.slice(5).replace("-", "/")}まで
                {m.daysLeft <= 14 && `（あと${m.daysLeft}日）`}
              </span>
            </li>
          )),
        )}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        期限を過ぎると、その月の明細は二度とダウンロードできません
      </p>
    </>
  );

  const className = `block rounded-xl border p-4 ${
    urgent ? "border-rose-900 bg-rose-950/40" : "border-sky-900 bg-sky-950/40"
  }`;

  return asLink ? (
    <Link href="/import" className={`mt-4 ${className}`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
