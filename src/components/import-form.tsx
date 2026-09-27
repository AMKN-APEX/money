"use client";

import { useState } from "react";
import { importCsv, type CardOpening, type ImportState } from "@/app/(main)/import/actions";
import { kyotoParser } from "@/lib/parsers/kyoto";
import { yuchoParser } from "@/lib/parsers/yucho";
import { vpassParser } from "@/lib/parsers/vpass";
import { paypayCardParser } from "@/lib/parsers/paypaycard";
import { rakutenParser } from "@/lib/parsers/rakuten";
import { pocketcardParser } from "@/lib/parsers/pocketcard";
import { verifyBalanceChain } from "@/lib/parsers/balance-chain";
import type { BankParser, ParserId } from "@/lib/parsers/types";
import { extractPdfText, isPdf } from "@/lib/pdf-text";
import { todayJst, yen } from "@/lib/format";
import type { Account } from "@/lib/types";

const PARSERS: BankParser[] = [
  kyotoParser,
  yuchoParser,
  vpassParser,
  paypayCardParser,
  rakutenParser,
  pocketcardParser,
];

/**
 * パーサーと口座の対応。seed の issuer と合わせている。
 * vpass は1ファイルに複数カードが入るので、口座はサーバー側がカード名から決める。
 */
const ISSUER_OF: Partial<Record<ParserId, string>> = {
  kyoto: "京都銀行",
  yucho: "ゆうちょ銀行",
  paypaycard: "PayPayカード",
  rakuten: "楽天カード",
  pocketcard: "ポケットカード",
};

/**
 * 金融機関のCSVは CP932 が多い（PayPayカードは UTF-8）。ブラウザの TextDecoder は
 * shift_jis を必ず持っているので、ここで UTF-8 に直してからサーバーへ渡す。
 * サーバーの ICU に依存しなくて済む。
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
  /** 同名ファイルを2回選んでも区別できるように */
  key: string;
  filename: string;
  hash: string;
  /** CSV はそのまま、PDF は取り出した文字（pdf-lines.ts の形） */
  content: string;
  parser: BankParser | null;
  accountId: string;
  rowCount: number;
  periodFrom: string | null;
  periodTo: string | null;
  warnings: string[];
  chainIssues: { lineNo: number; date: string; diff: number }[];
  /** ファイル内に入っていたカード名（Vpass は複数枚ぶんが1ファイルに入る） */
  cards: { label: string; count: number }[];
  error: string | null;
  /** 取り込んだ結果。未実行なら null */
  result: ImportState | null;
};

async function readFile(file: File, index: number, accounts: Account[]): Promise<Preview> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256(buffer);
  const base = {
    key: `${index}:${file.name}`,
    filename: file.name,
    hash,
    accountId: "",
    rowCount: 0,
    periodFrom: null,
    periodTo: null,
    warnings: [],
    chainIssues: [],
    cards: [],
    result: null,
  };

  let content: string;
  const pdf = isPdf(buffer);
  try {
    content = pdf ? await extractPdfText(buffer) : decode(buffer);
  } catch (e) {
    return {
      ...base,
      content: "",
      parser: null,
      error: `PDFを読めませんでした（${e instanceof Error ? e.message : String(e)}）`,
    };
  }

  const format = pdf ? "pdf" : "csv";
  const parser = PARSERS.find((p) => p.format === format && p.looksLikeMine(content)) ?? null;
  if (!parser) {
    return {
      ...base,
      content,
      parser: null,
      error:
        "どの金融機関の明細か判別できませんでした。対応しているのは " +
        PARSERS.map((p) => p.label).join(" / ") +
        " です。",
    };
  }

  const parsed = parser.parse(content, file.name, todayJst());
  const issuer = ISSUER_OF[parser.id];
  const match = issuer ? accounts.find((a) => a.issuer === issuer) : undefined;

  return {
    ...base,
    content,
    parser,
    // 判別できた金融機関の口座を選んでおく
    accountId: match?.id ?? "",
    rowCount: parsed.rows.length,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    warnings: parsed.warnings,
    chainIssues: verifyBalanceChain(parsed.rows).issues,
    cards: countCards(parsed.rows),
    error: parsed.error,
  };
}

function isReady(p: Preview): boolean {
  const picksAccount = p.parser?.accountSource !== "file";
  return Boolean(p.parser && !p.error && (!picksAccount || p.accountId));
}

export function ImportForm({ accounts }: { accounts: Account[] }) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);

  async function onPick(files: FileList | null) {
    const list = files ? [...files] : [];
    if (list.length === 0) {
      setPreviews([]);
      return;
    }
    setReading(true);
    try {
      const read = await Promise.all(list.map((f, i) => readFile(f, i, accounts)));
      // 古い明細から順に取り込む。未取込期間の警告（9.4）が前後関係で誤らないように
      read.sort((a, b) => (a.periodFrom ?? "").localeCompare(b.periodFrom ?? ""));
      setPreviews(read);
    } finally {
      setReading(false);
    }
  }

  function setAccount(key: string, accountId: string) {
    setPreviews((ps) => ps.map((p) => (p.key === key ? { ...p, accountId } : p)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    try {
      // 1件ずつ順に送る。同時に送ると、同じ口座の重複判定が互いを見られない
      for (const p of previews) {
        if (!isReady(p) || p.result?.summary) continue;
        const fd = new FormData();
        fd.set("filename", p.filename);
        fd.set("file_hash", p.hash);
        fd.set("content", p.content);
        fd.set("parser_id", p.parser!.id);
        fd.set("account_id", p.accountId);
        let result: ImportState;
        try {
          result = await importCsv({ error: null, summary: null }, fd);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err), summary: null };
        }
        setPreviews((ps) => ps.map((x) => (x.key === p.key ? { ...x, result } : x)));
      }
    } finally {
      setRunning(false);
    }
  }

  const pendingCount = previews.filter((p) => isReady(p) && !p.result?.summary).length;
  const done = previews.filter((p) => p.result);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-400">明細ファイル（CSV・PDF。複数選べます）</span>
        <input
          type="file"
          multiple
          accept=".csv,.pdf,text/csv,application/pdf"
          onChange={(e) => onPick(e.target.files)}
          className="rounded-xl border border-dashed border-slate-700 bg-slate-900 px-4 py-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-slate-200"
        />
      </label>

      {reading && <p className="text-sm text-slate-400">ファイルを読んでいます…</p>}

      {previews.map((p) => (
        <FileCard key={p.key} preview={p} accounts={accounts} onAccount={setAccount} />
      ))}

      {done.length > 0 && <Totals previews={done} />}

      <button
        type="submit"
        disabled={running || reading || pendingCount === 0}
        aria-busy={running}
        className="w-full rounded-xl bg-emerald-500 py-3.5 text-base font-semibold text-slate-950 disabled:opacity-40"
      >
        {running
          ? `取り込み中…（残り ${pendingCount} 件）`
          : pendingCount > 1
            ? `${pendingCount} 件を取り込む`
            : "取り込む"}
      </button>
    </form>
  );
}

function FileCard({
  preview: p,
  accounts,
  onAccount,
}: {
  preview: Preview;
  accounts: Account[];
  onAccount: (key: string, accountId: string) => void;
}) {
  const picksAccount = p.parser?.accountSource !== "file";
  // 残高を持つのは銀行の明細だけ。カード明細で「整合」と出すと誤解を招く
  const hasBalance = p.parser?.id === "kyoto" || p.parser?.id === "yucho";
  const summary = p.result?.summary;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
      <p className="truncate font-medium">{p.filename}</p>

      {p.error ? (
        <p className="mt-2 text-rose-400">{p.error}</p>
      ) : (
        <>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
            <div className="flex gap-2">
              <dt>形式</dt>
              <dd className="text-slate-200">{p.parser?.label}</dd>
            </div>
            <div className="flex gap-2">
              <dt>明細</dt>
              <dd className="text-slate-200 tabular-nums">{p.rowCount} 件</dd>
            </div>
            <div className="flex gap-2">
              <dt>期間</dt>
              <dd className="text-slate-200 tabular-nums">
                {p.periodFrom} 〜 {p.periodTo}
              </dd>
            </div>
          </dl>

          {p.cards.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs">
              {p.cards.map((c) => (
                <li key={c.label} className="flex justify-between gap-3">
                  <span className="truncate text-slate-300">{c.label}</span>
                  <span className="shrink-0 text-slate-500 tabular-nums">{c.count} 件</span>
                </li>
              ))}
            </ul>
          )}

          {hasBalance && (
            <p className="mt-3 text-xs text-slate-500">
              残高チェーン:{" "}
              {p.chainIssues.length === 0 ? (
                <span className="text-emerald-400">整合（取りこぼしなし）</span>
              ) : (
                <span className="text-amber-400">{p.chainIssues.length} 件の不整合</span>
              )}
            </p>
          )}

          {p.chainIssues.slice(0, 3).map((i) => (
            <p key={i.lineNo} className="mt-1 text-xs text-amber-400">
              {i.lineNo}行目（{i.date}）で {yen(Math.abs(i.diff))} 分が繋がりません
            </p>
          ))}

          {p.warnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-amber-400">
              {w}
            </p>
          ))}

          {picksAccount ? (
            <label className="mt-3 flex items-center gap-3">
              <span className="shrink-0 text-xs text-slate-400">取り込み先</span>
              <select
                value={p.accountId}
                disabled={Boolean(summary)}
                onChange={(e) => onAccount(p.key, e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base outline-none focus:border-emerald-500"
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
            <p className="mt-3 text-xs text-slate-500">
              取り込み先は、ファイルに書かれたカード名から自動で決まります。
              当てはまる口座が無いカードがあれば、取り違えを避けるため取り込みを中止します。
            </p>
          )}
        </>
      )}

      {p.result?.error && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-xs text-rose-300">
          {p.result.error}
        </p>
      )}

      {summary && (
        <div className="mt-3 rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-xs">
          <p className="font-semibold text-emerald-300">
            {summary.accounts.map((a) => a.accountName).join(" / ")} に取り込みました
          </p>
          <p className="mt-1 text-slate-400 tabular-nums">
            追加 {summary.inserted}・速報を上書き {summary.merged}・重複で除外 {summary.skipped}・
            未分類 {summary.pendingReview}
          </p>
          {/* 1ファイルに複数カードが入る場合は内訳を出す（Vpass。9.10） */}
          {summary.accounts.length > 1 &&
            summary.accounts.map((a) => (
              <p key={a.accountName} className="mt-1 text-slate-500 tabular-nums">
                {a.accountName}: 追加 {a.inserted} / 上書き {a.merged} / 除外 {a.skipped}
              </p>
            ))}
          {summary.accounts.map(
            (a) =>
              a.openingBalance !== null && (
                <p key={a.accountName} className="mt-1 text-slate-400">
                  {a.accountName}: 明細の残高から開始残高を {yen(a.openingBalance)} と算出し、
                  口座に設定しました。
                </p>
              ),
          )}
          {summary.warnings.map((w) => (
            <p key={w} className="mt-1 text-amber-400">
              {w}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** 全ファイルの合計と、カードの開始残高の最終的な値 */
function Totals({ previews }: { previews: Preview[] }) {
  const summaries = previews.flatMap((p) => (p.result?.summary ? [p.result.summary] : []));
  const failed = previews.filter((p) => p.result?.error).length;
  const pendingReview = summaries.reduce((acc, s) => acc + s.pendingReview, 0);

  // 取込のたびに計算し直しているので、カードごとに最後の値が現在の値
  const openings = new Map<string, CardOpening>();
  for (const s of summaries) for (const o of s.cardOpenings) openings.set(o.accountName, o);

  return (
    <section className="rounded-2xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm">
      <p className="font-semibold text-emerald-300">
        {summaries.length} 件を取り込みました
        {failed > 0 && <span className="text-rose-400">（{failed} 件は失敗）</span>}
      </p>
      <p className="mt-1 text-xs text-slate-400 tabular-nums">
        追加 {summaries.reduce((acc, s) => acc + s.inserted, 0)}・速報を上書き{" "}
        {summaries.reduce((acc, s) => acc + s.merged, 0)}・重複で除外{" "}
        {summaries.reduce((acc, s) => acc + s.skipped, 0)}
      </p>

      {[...openings.values()].map((o) => (
        <p key={o.accountName} className="mt-2 text-xs text-slate-400">
          {o.accountName}: 銀行の明細より前に払い終わった請求 {o.statementCount} 回分（
          {yen(o.amount)}）を、開始残高として設定しました。
        </p>
      ))}

      {pendingReview > 0 && (
        <a href="/review" className="mt-3 block text-xs font-medium text-emerald-400">
          未分類の {pendingReview} 件を分類する →
        </a>
      )}
    </section>
  );
}
