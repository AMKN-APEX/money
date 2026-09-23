"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { importCsv, type ImportState } from "@/app/(main)/import/actions";
import { kyotoParser } from "@/lib/parsers/kyoto";
import { yuchoParser } from "@/lib/parsers/yucho";
import { vpassParser } from "@/lib/parsers/vpass";
import { verifyBalanceChain } from "@/lib/parsers/balance-chain";
import type { BankParser, ParserId } from "@/lib/parsers/types";
import { todayJst, yen } from "@/lib/format";
import type { Account } from "@/lib/types";

const PARSERS: BankParser[] = [kyotoParser, yuchoParser, vpassParser];

/**
 * パーサーと口座の対応。seed の issuer と合わせている。
 * vpass は1ファイルに複数カードが入るので、口座はサーバー側がカード名から決める。
 */
const ISSUER_OF: Partial<Record<ParserId, string>> = {
  kyoto: "京都銀行",
  yucho: "ゆうちょ銀行",
};

/**
 * 金融機関のCSVは CP932。ブラウザの TextDecoder は shift_jis を必ず持っているので、
 * ここで UTF-8 に直してからサーバーへ渡す。サーバーの ICU に依存しなくて済む。
 */
function decode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("shift_jis").decode(buffer);
  }
}

/** 明細をカード名ごとに数える。取り込む前に「何が入っているか」を見せる */
function countCards(rows: { cardLabel?: string | null }[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.cardLabel) continue;
    counts.set(row.cardLabel, (counts.get(row.cardLabel) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Preview = {
  filename: string;
  hash: string;
  content: string;
  parser: BankParser | null;
  rowCount: number;
  periodFrom: string | null;
  periodTo: string | null;
  warnings: string[];
  chainIssues: { lineNo: number; date: string; diff: number }[];
  /** ファイル内に入っていたカード名（Vpass は複数枚ぶんが1ファイルに入る） */
  cards: { label: string; count: number }[];
  error: string | null;
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="w-full rounded-xl bg-emerald-500 py-3.5 text-base font-semibold text-slate-950 disabled:opacity-40"
    >
      {pending ? "取り込み中…" : "取り込む"}
    </button>
  );
}

export function ImportForm({ accounts }: { accounts: Account[] }) {
  const [state, formAction] = useActionState<ImportState, FormData>(importCsv, {
    error: null,
    summary: null,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accountId, setAccountId] = useState("");

  async function onPick(file: File | undefined) {
    if (!file) {
      setPreview(null);
      return;
    }

    const buffer = await file.arrayBuffer();
    const content = decode(buffer);
    const hash = await sha256(buffer);
    const parser = PARSERS.find((p) => p.looksLikeMine(content)) ?? null;

    if (!parser) {
      setPreview({
        filename: file.name,
        hash,
        content,
        parser: null,
        rowCount: 0,
        periodFrom: null,
        periodTo: null,
        warnings: [],
        chainIssues: [],
        cards: [],
        error:
          "どの金融機関のCSVか判別できませんでした。対応しているのは " +
          PARSERS.map((p) => p.label).join(" / ") +
          " です。",
      });
      return;
    }

    const parsed = parser.parse(content, file.name, todayJst());
    const chain = verifyBalanceChain(parsed.rows);

    setPreview({
      filename: file.name,
      hash,
      content,
      parser,
      rowCount: parsed.rows.length,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      warnings: parsed.warnings,
      chainIssues: chain.issues,
      cards: countCards(parsed.rows),
      error: parsed.error,
    });

    // 判別できた金融機関の口座を選んでおく
    const issuer = ISSUER_OF[parser.id];
    const match = issuer ? accounts.find((a) => a.issuer === issuer) : undefined;
    setAccountId(match?.id ?? "");
  }

  // Vpass はファイル内のカード名から口座が決まるので、選ばせない
  const picksAccount = preview?.parser?.accountSource !== "file";
  const ready = Boolean(preview?.parser && !preview.error && (!picksAccount || accountId));
  const cards = preview?.cards ?? [];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="filename" value={preview?.filename ?? ""} />
      <input type="hidden" name="file_hash" value={preview?.hash ?? ""} />
      <input type="hidden" name="content" value={preview?.content ?? ""} />
      <input type="hidden" name="parser_id" value={preview?.parser?.id ?? ""} />
      <input type="hidden" name="account_id" value={accountId} />

      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-400">CSVファイル</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onPick(e.target.files?.[0])}
          className="rounded-xl border border-dashed border-slate-700 bg-slate-900 px-4 py-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-slate-200"
        />
      </label>

      {preview && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="truncate font-medium">{preview.filename}</p>

          {preview.error ? (
            <p className="mt-2 text-rose-400">{preview.error}</p>
          ) : (
            <>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                <div className="flex gap-2">
                  <dt>形式</dt>
                  <dd className="text-slate-200">{preview.parser?.label}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>明細</dt>
                  <dd className="text-slate-200 tabular-nums">{preview.rowCount} 件</dd>
                </div>
                <div className="flex gap-2">
                  <dt>期間</dt>
                  <dd className="text-slate-200 tabular-nums">
                    {preview.periodFrom} 〜 {preview.periodTo}
                  </dd>
                </div>
              </dl>

              {cards.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-xs">
                  {cards.map((c) => (
                    <li key={c.label} className="flex justify-between gap-3">
                      <span className="truncate text-slate-300">{c.label}</span>
                      <span className="shrink-0 text-slate-500 tabular-nums">{c.count} 件</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-3 text-xs text-slate-500">
                残高チェーン:{" "}
                {preview.chainIssues.length === 0 ? (
                  <span className="text-emerald-400">整合（取りこぼしなし）</span>
                ) : (
                  <span className="text-amber-400">
                    {preview.chainIssues.length} 件の不整合
                  </span>
                )}
              </p>

              {preview.chainIssues.slice(0, 3).map((i) => (
                <p key={i.lineNo} className="mt-1 text-xs text-amber-400">
                  {i.lineNo}行目（{i.date}）で {yen(Math.abs(i.diff))} 分が繋がりません
                </p>
              ))}

              {preview.warnings.map((w) => (
                <p key={w} className="mt-1 text-xs text-amber-400">
                  {w}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      {picksAccount ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">取り込み先の口座</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
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
      ) : (
        <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
          取り込み先は、ファイルに書かれたカード名から自動で決まります。
          当てはまる口座が無いカードがあれば、取り違えを避けるため取り込みを中止します。
        </p>
      )}

      {state.error && (
        <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
          {state.error}
        </p>
      )}

      {state.summary && <Summary summary={state.summary} />}

      <SubmitButton disabled={!ready} />
    </form>
  );
}

function Summary({ summary }: { summary: NonNullable<ImportState["summary"]> }) {
  return (
    <section className="rounded-2xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm">
      <p className="font-semibold text-emerald-300">
        {summary.accounts.map((a) => a.accountName).join(" / ")} に取り込みました
      </p>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        <div className="rounded-lg bg-slate-950/50 p-2">
          <dt className="text-slate-500">追加</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{summary.inserted}</dd>
        </div>
        {/* 3章: メール速報で先に入っていた行を、CSVの確定値で置き換えた件数 */}
        <div className="rounded-lg bg-slate-950/50 p-2">
          <dt className="text-slate-500">速報を上書き</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-sky-400">
            {summary.merged}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-950/50 p-2">
          <dt className="text-slate-500">重複で除外</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{summary.skipped}</dd>
        </div>
        <div className="rounded-lg bg-slate-950/50 p-2">
          <dt className="text-slate-500">未分類</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-amber-400">
            {summary.pendingReview}
          </dd>
        </div>
      </dl>

      {/* 1ファイルに複数カードが入る場合は内訳を出す（Vpass。9.10） */}
      {summary.accounts.length > 1 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-400">
          {summary.accounts.map((a) => (
            <li key={a.accountName} className="flex justify-between gap-3">
              <span className="truncate">{a.accountName}</span>
              <span className="shrink-0 tabular-nums">
                追加 {a.inserted} / 上書き {a.merged} / 除外 {a.skipped}
              </span>
            </li>
          ))}
        </ul>
      )}

      {summary.accounts.map(
        (a) =>
          a.openingBalance !== null && (
            <p key={a.accountName} className="mt-3 text-xs text-slate-400">
              {a.accountName}: 明細の残高から開始残高を {yen(a.openingBalance)} と算出し、
              口座に設定しました。
            </p>
          ),
      )}

      {summary.warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-amber-400">
          {w}
        </p>
      ))}

      {summary.pendingReview > 0 && (
        <a href="/review" className="mt-3 block text-xs font-medium text-emerald-400">
          未分類の {summary.pendingReview} 件を分類する →
        </a>
      )}
    </section>
  );
}
