"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeMerchant } from "@/lib/normalize";
import { classify, type Rule } from "@/lib/rules";
import { findEmailMatch, keepsClassification, type EmailTransaction } from "@/lib/merge-email";
import { kyotoParser } from "@/lib/parsers/kyoto";
import { yuchoParser } from "@/lib/parsers/yucho";
import { vpassParser } from "@/lib/parsers/vpass";
import { lastKnownBalance, verifyBalanceChain, type ChainIssue } from "@/lib/parsers/balance-chain";
import type { ParsedRow, ParserId } from "@/lib/parsers/types";
import { todayJst } from "@/lib/format";
import type { Account, TxType } from "@/lib/types";

const PARSERS = { kyoto: kyotoParser, yucho: yuchoParser, vpass: vpassParser };

/** 口座1つぶんの取込結果 */
export type AccountSummary = {
  accountName: string;
  inserted: number;
  /** メール速報の行を上書きした件数（3章の重複排除） */
  merged: number;
  skipped: number;
  pendingReview: number;
  openingBalance: number | null;
};

export type ImportSummary = {
  /** 1ファイルに複数カードが入ることがある（Vpass。9.10） */
  accounts: AccountSummary[];
  parsed: number;
  inserted: number;
  merged: number;
  skipped: number;
  pendingReview: number;
  periodFrom: string | null;
  periodTo: string | null;
  warnings: string[];
  chainIssues: ChainIssue[];
};

export type ImportState = {
  error: string | null;
  summary: ImportSummary | null;
};

type AccountRow = Pick<Account, "id" | "name" | "type"> & { card_patterns: string[] | null };
type Supabase = Awaited<ReturnType<typeof createClient>>;

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function importCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const accountId = field(formData, "account_id");
  const parserId = field(formData, "parser_id") as ParserId;
  const filename = field(formData, "filename");
  const fileHash = field(formData, "file_hash");
  const content = String(formData.get("content") ?? "");

  if (!(parserId in PARSERS)) return fail("対応していないCSVの形式です");
  if (!content) return fail("ファイルの中身が空です");
  if (!fileHash) return fail("ファイルの識別子を作れませんでした");

  const parser = PARSERS[parserId];
  if (parser.accountSource === "user" && !accountId) {
    return fail("取り込み先の口座を選んでください");
  }

  const supabase = await createClient();

  const { data: accountRows, error: accountError } = await supabase
    .from("accounts")
    .select("id, name, type, card_patterns");
  if (accountError) return fail(`口座を読めませんでした: ${accountError.message}`);
  const accounts = (accountRows ?? []) as AccountRow[];

  // 9.5: 同じ内容のファイルは取り込まない。
  // 実例として ny20260922172847.csv と ny20260922174646.csv が同一内容だった。
  // 1ファイルから口座ごとに履歴を作るので、口座を問わず1件でもあれば取込済み。
  const { data: already } = await supabase
    .from("import_batches")
    .select("filename, imported_at")
    .eq("file_hash", fileHash)
    .limit(1);
  if (already && already.length > 0) {
    const b = already[0] as { filename: string; imported_at: string };
    return fail(
      `このファイルは取込済みです（${b.filename} / ${String(b.imported_at).slice(0, 10)}）。` +
        "中身が同一のため、二重計上を避けて中止しました。",
    );
  }

  // クライアント側の解析結果は信用せず、ここで解析し直す
  const parsed = parser.parse(content, filename, todayJst());
  if (parsed.error) return fail(parsed.error);
  if (parsed.rows.length === 0) return fail("取り込める明細がありませんでした");

  const warnings = [...parsed.warnings];
  const chain = verifyBalanceChain(parsed.rows);
  if (!chain.ok) {
    warnings.push(
      `残高が繋がらない箇所が ${chain.issues.length} 件あります。明細の取りこぼしが疑われます。`,
    );
  }

  const grouped = groupByAccount(parsed.rows, parser.accountSource, accounts, accountId);
  if ("error" in grouped) return fail(grouped.error);

  const { data: ruleRows, error: ruleError } = await supabase
    .from("rules")
    .select(
      "id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id, channel, memo_template, is_active",
    );
  if (ruleError) return fail(`ルールを読めませんでした: ${ruleError.message}`);
  const rules = (ruleRows ?? []) as unknown as Rule[];

  const summaries: AccountSummary[] = [];
  for (const group of grouped.groups) {
    const result = await importGroup(supabase, group, rules, filename, fileHash, warnings);
    if ("error" in result) return fail(result.error);
    summaries.push(result.summary);
  }

  revalidatePath("/", "layout");

  return {
    error: null,
    summary: {
      accounts: summaries,
      parsed: parsed.rows.length,
      inserted: sum(summaries, (s) => s.inserted),
      merged: sum(summaries, (s) => s.merged),
      skipped: sum(summaries, (s) => s.skipped),
      pendingReview: sum(summaries, (s) => s.pendingReview),
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      warnings,
      chainIssues: chain.issues,
    },
  };
}

type Group = { account: AccountRow; rows: ParsedRow[] };

/**
 * 明細を口座ごとに振り分ける。
 *
 * Vpass のCSVは1ファイルに複数カードが入る（9.10）ため、利用者に選ばせず
 * カード名から決める。**当てはまる口座が無ければ取り込まない。**
 * 推測で別のカードに積むと、銀行明細では2枚を区別できない（9.3）ぶん
 * あとから気づけなくなる。
 */
function groupByAccount(
  rows: ParsedRow[],
  source: "user" | "file",
  accounts: AccountRow[],
  selectedId: string,
): { groups: Group[] } | { error: string } {
  if (source === "user") {
    const account = accounts.find((a) => a.id === selectedId);
    if (!account) return { error: "その口座は存在しません" };
    return { groups: [{ account, rows }] };
  }

  const groups = new Map<string, Group>();
  const unknown = new Set<string>();

  for (const row of rows) {
    const label = row.cardLabel ?? "";
    const account = resolveCard(accounts, label);
    if (!account) {
      unknown.add(label || "(カード名なし)");
      continue;
    }
    const group = groups.get(account.id) ?? { account, rows: [] };
    group.rows.push(row);
    groups.set(account.id, group);
  }

  if (unknown.size > 0) {
    return {
      error:
        `どの口座のカードか分からない明細があります: ${[...unknown].join(" / ")}。` +
        "口座の card_patterns にこのカード名を登録してください。" +
        "取り違えを避けるため、ファイル全体の取り込みを中止しました。",
    };
  }
  if (groups.size === 0) return { error: "取り込める明細がありませんでした" };
  return { groups: [...groups.values()] };
}

function resolveCard(accounts: AccountRow[], cardLabel: string): AccountRow | null {
  if (!cardLabel) return null;
  const normalized = normalizeMerchant(cardLabel);

  return (
    accounts
      .flatMap((a) => (a.card_patterns ?? []).map((pattern) => ({ account: a, pattern })))
      .filter(({ pattern }) => pattern && normalized.includes(pattern))
      // 複数当たったら長いほうを採る
      .sort((x, y) => y.pattern.length - x.pattern.length)[0]?.account ?? null
  );
}

async function importGroup(
  supabase: Supabase,
  group: Group,
  rules: Rule[],
  filename: string,
  fileHash: string,
  warnings: string[],
): Promise<{ summary: AccountSummary } | { error: string }> {
  const { account, rows } = group;
  const dates = rows.map((r) => r.date).sort();
  const periodFrom = dates[0];
  const periodTo = dates[dates.length - 1];

  // 9.4: 前回取り込んだ期間との間に空きがあれば知らせる
  const { data: coverage } = await supabase
    .from("import_coverage")
    .select("covered_to")
    .eq("account_id", account.id)
    .maybeSingle();
  if (coverage?.covered_to) {
    const gapStart = nextDay(String(coverage.covered_to));
    if (periodFrom > gapStart) {
      warnings.push(
        `${account.name}: ${gapStart} から ${prevDay(periodFrom)} までが未取込です。` +
          "この期間のCSVもダウンロードしてください。",
      );
    }
  }

  // 行単位の重複排除。ゆうちょは明細IDで、それ以外は行の内容から作ったキーで判定する
  const { data: existingRows } = await supabase
    .from("transactions")
    .select("dedup_key, source_ref")
    .eq("account_id", account.id)
    .gte("date", periodFrom)
    .lte("date", periodTo);
  const seenKeys = new Set<string>();
  const seenRefs = new Set<string>();
  for (const r of (existingRows ?? []) as { dedup_key: string | null; source_ref: string | null }[]) {
    if (r.dedup_key) seenKeys.add(r.dedup_key);
    if (r.source_ref) seenRefs.add(r.source_ref);
  }

  // 3章: 同じ取引がメール速報とCSVの両方から入る。CSVを正として上書きする。
  // 速報は売上データの到着時に配信されるため日付がずれる。前後3日を見る。
  const { data: emailRows } = await supabase
    .from("transactions")
    .select("id, date, amount, merchant_normalized, category_id, status, memo")
    .eq("account_id", account.id)
    .eq("source", "email")
    .gte("date", shiftDay(periodFrom, -3))
    .lte("date", shiftDay(periodTo, 3));
  const emailCandidates = (emailRows ?? []) as EmailTransaction[];

  let skipped = 0;
  let pendingReview = 0;
  const pending: Record<string, unknown>[] = [];
  const merges: { id: string; patch: Record<string, unknown> }[] = [];
  const mergedIds = new Set<string>();

  for (const row of rows) {
    const dedupKey = `${account.id}:${row.dedupSeed}`;
    if (seenKeys.has(dedupKey) || (row.sourceRef && seenRefs.has(row.sourceRef))) {
      skipped++;
      continue;
    }
    seenKeys.add(dedupKey);
    if (row.sourceRef) seenRefs.add(row.sourceRef);

    const cls = classify({ matchText: row.matchText, direction: row.direction }, account.id, rules);

    let type: TxType = cls.type;
    let toAccountId = cls.to_account_id;
    let status: "confirmed" | "pending_review" = cls.ruleId ? "confirmed" : "pending_review";
    let memo = joinMemo(row.memo ?? null, cls.memo);

    // 9.3: 振替と分かっても相手口座を特定できない場合がある
    // （三井住友カード2枚が同じ摘要になる）。保留にして人に決めてもらう。
    if (type === "transfer" && !toAccountId) {
      type = row.direction === "in" ? "income" : "expense";
      toAccountId = null;
      status = "pending_review";
      memo = joinMemo(memo, "振替の可能性あり（相手口座を特定できませんでした）");
    }

    const decision = findEmailMatch(
      { date: row.date, amount: row.amount, matchText: row.matchText },
      emailCandidates,
      mergedIds,
    );

    if (decision.kind === "ambiguous") {
      warnings.push(
        `${row.date} の ${row.amount.toLocaleString("ja-JP")}円 は、メール速報の候補が ` +
          `${decision.candidates.length} 件あり、どれと同じ取引か決められませんでした。` +
          "別の取引として追加したので、重複していれば片方を削除してください。",
      );
    }

    if (decision.kind === "merge") {
      const target = decision.target;
      mergedIds.add(target.id);

      // 人が未分類トレイで決めた費目や、ルールで確定した費目は壊さない
      const keep = keepsClassification(target);
      if (!keep && status === "pending_review") pendingReview++;

      merges.push({
        id: target.id,
        patch: {
          date: row.date,
          merchant: row.merchant || null,
          merchant_normalized: normalizeMerchant(row.matchText) || null,
          source: "csv",
          source_ref: row.sourceRef,
          dedup_key: dedupKey,
          balance_after: row.balanceAfter,
          ...(keep
            ? {}
            : {
                type,
                to_account_id: toAccountId,
                category_id: cls.category_id,
                channel: cls.channel,
                status,
              }),
          memo: joinMemo(target.memo, row.memo ?? null) ?? memo,
        },
      });
      continue;
    }

    if (status === "pending_review") pendingReview++;

    pending.push({
      date: row.date,
      amount: row.amount,
      type,
      account_id: account.id,
      to_account_id: toAccountId,
      category_id: cls.category_id,
      merchant: row.merchant || null,
      merchant_normalized: normalizeMerchant(row.matchText) || null,
      channel: cls.channel,
      memo,
      source: "csv",
      source_ref: row.sourceRef,
      status,
      dedup_key: dedupKey,
      balance_after: row.balanceAfter,
    });
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      account_id: account.id,
      filename,
      file_hash: fileHash,
      period_from: periodFrom,
      period_to: periodTo,
      row_count: pending.length + merges.length,
      dup_count: skipped,
    })
    .select("id")
    .single();
  if (batchError) return { error: `取込履歴を作れませんでした: ${batchError.message}` };

  if (pending.length > 0) {
    const withBatch = pending.map((p) => ({ ...p, import_batch_id: batch.id }));
    const { error: insertError } = await supabase.from("transactions").insert(withBatch);
    if (insertError) {
      // 取引が入らなかったのに履歴だけ残ると、次回この file_hash で弾かれてしまう
      await supabase.from("import_batches").delete().eq("id", batch.id);
      return { error: `取り込めませんでした: ${insertError.message}` };
    }
  }

  // メール速報の行をCSVの内容で置き換える。email_message_id は残すので、
  // どのメールから始まった取引かは後からも辿れる
  for (const m of merges) {
    const { error: mergeError } = await supabase
      .from("transactions")
      .update({ ...m.patch, import_batch_id: batch.id })
      .eq("id", m.id);
    if (mergeError) {
      warnings.push(`メール速報の行を更新できませんでした: ${mergeError.message}`);
    }
  }

  const openingBalance = await reconcileOpeningBalance(supabase, account, lastKnownBalance(rows));

  return {
    summary: {
      accountName: account.name,
      inserted: pending.length,
      merged: merges.length,
      skipped,
      pendingReview,
      openingBalance,
    },
  };
}

/**
 * 開始残高の逆算。
 *
 * CSV が遡れる範囲より前の残高はどこにも無いため、そのままでは口座残高が
 * 実際とずれる。明細の残高（9.5）と、取り込んだ取引の積み上げとの差が
 * ちょうどその「それ以前の残高」になるので、これを accounts に持たせる。
 * 手入力させると取込後に二重計上になるため、必ずここで計算する。
 */
async function reconcileOpeningBalance(
  supabase: Supabase,
  account: Pick<Account, "id" | "name" | "type">,
  last: { date: string; balance: number } | null,
): Promise<number | null> {
  // カードの明細は残高を持たないので対象外
  if (!last || (account.type !== "bank" && account.type !== "emoney")) return null;

  const { data, error } = await supabase
    .from("transactions")
    .select("amount, type, account_id, to_account_id")
    .lte("date", last.date)
    .or(`account_id.eq.${account.id},to_account_id.eq.${account.id}`);
  if (error) return null;

  const rows = (data ?? []) as {
    amount: number;
    type: TxType;
    account_id: string;
    to_account_id: string | null;
  }[];

  const movement = rows.reduce((acc, t) => {
    if (t.type === "income" && t.account_id === account.id) return acc + t.amount;
    if (t.type === "expense" && t.account_id === account.id) return acc - t.amount;
    if (t.type === "transfer" && t.account_id === account.id) return acc - t.amount;
    if (t.type === "transfer" && t.to_account_id === account.id) return acc + t.amount;
    return acc;
  }, 0);

  const opening = last.balance - movement;
  await supabase
    .from("accounts")
    .update({ opening_balance: opening, opening_balance_date: last.date })
    .eq("id", account.id);

  return opening;
}

function joinMemo(...parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(" / ") : null;
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

function fail(error: string): ImportState {
  return { error, summary: null };
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const nextDay = (iso: string) => shiftDay(iso, 1);
const prevDay = (iso: string) => shiftDay(iso, -1);
