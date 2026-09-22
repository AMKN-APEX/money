"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeMerchant } from "@/lib/normalize";
import { classify, type Rule } from "@/lib/rules";
import { kyotoParser } from "@/lib/parsers/kyoto";
import { yuchoParser } from "@/lib/parsers/yucho";
import { lastKnownBalance, verifyBalanceChain, type ChainIssue } from "@/lib/parsers/balance-chain";
import type { ParserId } from "@/lib/parsers/types";
import { todayJst } from "@/lib/format";
import type { Account, TxType } from "@/lib/types";

const PARSERS = { kyoto: kyotoParser, yucho: yuchoParser };

export type ImportSummary = {
  accountName: string;
  parsed: number;
  inserted: number;
  skipped: number;
  pendingReview: number;
  periodFrom: string | null;
  periodTo: string | null;
  warnings: string[];
  chainIssues: ChainIssue[];
  openingBalance: number | null;
};

export type ImportState = {
  error: string | null;
  summary: ImportSummary | null;
};

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function importCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const accountId = field(formData, "account_id");
  const parserId = field(formData, "parser_id") as ParserId;
  const filename = field(formData, "filename");
  const fileHash = field(formData, "file_hash");
  const content = String(formData.get("content") ?? "");

  if (!accountId) return fail("取り込み先の口座を選んでください");
  if (!(parserId in PARSERS)) return fail("対応していないCSVの形式です");
  if (!content) return fail("ファイルの中身が空です");
  if (!fileHash) return fail("ファイルの識別子を作れませんでした");

  const supabase = await createClient();

  const { data: accountRow, error: accountError } = await supabase
    .from("accounts")
    .select("id, name, type")
    .eq("id", accountId)
    .maybeSingle();
  if (accountError) return fail(`口座を読めませんでした: ${accountError.message}`);
  if (!accountRow) return fail("その口座は存在しません");
  const account = accountRow as Pick<Account, "id" | "name" | "type">;

  // 9.5: 同じ内容のファイルは取り込まない。
  // 実例として ny20260922172847.csv と ny20260922174646.csv が同一内容だった。
  const { data: already } = await supabase
    .from("import_batches")
    .select("id, filename, imported_at")
    .eq("file_hash", fileHash)
    .maybeSingle();
  if (already) {
    return fail(
      `このファイルは取込済みです（${already.filename} / ${String(already.imported_at).slice(0, 10)}）。` +
        "中身が同一のため、二重計上を避けて中止しました。",
    );
  }

  // クライアント側の解析結果は信用せず、ここで解析し直す
  const parsed = PARSERS[parserId].parse(content, filename, todayJst());
  if (parsed.error) return fail(parsed.error);
  if (parsed.rows.length === 0) return fail("取り込める明細がありませんでした");

  const warnings = [...parsed.warnings];
  const chain = verifyBalanceChain(parsed.rows);
  if (!chain.ok) {
    warnings.push(
      `残高が繋がらない箇所が ${chain.issues.length} 件あります。明細の取りこぼしが疑われます。`,
    );
  }

  // 9.4: 前回取り込んだ期間との間に空きがあれば知らせる
  const { data: coverage } = await supabase
    .from("import_coverage")
    .select("covered_to")
    .eq("account_id", accountId)
    .maybeSingle();
  if (coverage?.covered_to && parsed.periodFrom) {
    const gapStart = nextDay(String(coverage.covered_to));
    if (parsed.periodFrom > gapStart) {
      warnings.push(
        `${gapStart} から ${prevDay(parsed.periodFrom)} までが未取込です。` +
          "この期間のCSVもダウンロードしてください。",
      );
    }
  }

  const { data: ruleRows, error: ruleError } = await supabase
    .from("rules")
    .select(
      "id, priority, match_type, pattern, account_id, set_type, category_id, to_account_id, channel, memo_template, is_active",
    );
  if (ruleError) return fail(`ルールを読めませんでした: ${ruleError.message}`);
  const rules = (ruleRows ?? []) as unknown as Rule[];

  // 行単位の重複排除。ゆうちょは明細IDで、京都銀行は行の内容から作ったキーで判定する
  const { data: existingRows } = await supabase
    .from("transactions")
    .select("dedup_key, source_ref")
    .eq("account_id", accountId)
    .gte("date", parsed.periodFrom ?? "1900-01-01")
    .lte("date", parsed.periodTo ?? "2999-12-31");
  const seenKeys = new Set<string>();
  const seenRefs = new Set<string>();
  for (const r of (existingRows ?? []) as { dedup_key: string | null; source_ref: string | null }[]) {
    if (r.dedup_key) seenKeys.add(r.dedup_key);
    if (r.source_ref) seenRefs.add(r.source_ref);
  }

  let skipped = 0;
  let pendingReview = 0;
  const pending: Record<string, unknown>[] = [];

  for (const row of parsed.rows) {
    const dedupKey = `${accountId}:${row.dedupSeed}`;
    if (seenKeys.has(dedupKey) || (row.sourceRef && seenRefs.has(row.sourceRef))) {
      skipped++;
      continue;
    }
    seenKeys.add(dedupKey);
    if (row.sourceRef) seenRefs.add(row.sourceRef);

    const cls = classify({ matchText: row.matchText, direction: row.direction }, accountId, rules);

    let type: TxType = cls.type;
    let toAccountId = cls.to_account_id;
    let status: "confirmed" | "pending_review" = cls.ruleId ? "confirmed" : "pending_review";
    let memo = cls.memo;

    // 9.3: 振替と分かっても相手口座を特定できない場合がある
    // （三井住友カード2枚が同じ摘要になる）。保留にして人に決めてもらう。
    if (type === "transfer" && !toAccountId) {
      type = row.direction === "in" ? "income" : "expense";
      toAccountId = null;
      status = "pending_review";
      memo = memo ?? "振替の可能性あり（相手口座を特定できませんでした）";
    }
    if (status === "pending_review") pendingReview++;

    pending.push({
      date: row.date,
      amount: row.amount,
      type,
      account_id: accountId,
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
      account_id: accountId,
      filename,
      file_hash: fileHash,
      period_from: parsed.periodFrom,
      period_to: parsed.periodTo,
      row_count: pending.length,
      dup_count: skipped,
    })
    .select("id")
    .single();
  if (batchError) return fail(`取込履歴を作れませんでした: ${batchError.message}`);

  if (pending.length > 0) {
    const withBatch = pending.map((p) => ({ ...p, import_batch_id: batch.id }));
    const { error: insertError } = await supabase.from("transactions").insert(withBatch);
    if (insertError) {
      // 取引が入らなかったのに履歴だけ残ると、次回この file_hash で弾かれてしまう
      await supabase.from("import_batches").delete().eq("id", batch.id);
      return fail(`取り込めませんでした: ${insertError.message}`);
    }
  }

  const openingBalance = await reconcileOpeningBalance(
    supabase,
    account,
    lastKnownBalance(parsed.rows),
  );

  revalidatePath("/", "layout");

  return {
    error: null,
    summary: {
      accountName: account.name,
      parsed: parsed.rows.length,
      inserted: pending.length,
      skipped,
      pendingReview,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      warnings,
      chainIssues: chain.issues,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  account: Pick<Account, "id" | "name" | "type">,
  last: { date: string; balance: number } | null,
): Promise<number | null> {
  // カードの明細は「残高」の意味が違うので対象外
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
