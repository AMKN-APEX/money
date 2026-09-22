/**
 * 京都銀行（京銀ダイレクトバンキング）のCSVパーサー。
 * 仕様は docs/design.md 9.2。実ファイルで確認済み。
 *
 *   "番号","明細区分","取扱日付","起算日","お支払金額","お預り金額","小切手","取引区分","残高","摘要"
 *   "001","","8月3日","","\27,459","","","出金","\2,401,863","ﾎﾟｹﾂﾄｶ-ﾄﾞ"
 *
 * 癖:
 *   - 取扱日付に年が無い → ファイル名のダウンロード日から補う
 *   - 番号は日ごとの連番でユニークではない → 重複判定は行の内容から作る
 *   - 金額は `\1,234` 形式
 */
import { downloadDateFromFilename, pad2, parseCsv, resolveYear, toAmount } from "./csv";
import type { BankParser, ParseResult, ParsedRow } from "./types";

const HEADER = ["番号", "明細区分", "取扱日付", "起算日"];
const COL = {
  no: 0,
  date: 2,
  paid: 4, // お支払金額 = 出金
  received: 5, // お預り金額 = 入金
  balance: 8,
  description: 9,
} as const;

export const kyotoParser: BankParser = {
  id: "kyoto",
  label: "京都銀行（京銀ダイレクト）",

  looksLikeMine(text) {
    const first = parseCsv(text)[0] ?? [];
    return HEADER.every((h, i) => first[i] === h);
  },

  parse(text, filename, today): ParseResult {
    const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (table.length === 0) return empty("ファイルが空です");

    const header = table[0];
    if (!HEADER.every((h, i) => header[i] === h)) {
      return empty("京都銀行のCSVではないようです（1行目が想定のヘッダーと違います）");
    }

    // 年の補完に使う基準日。ファイル名から取れなければ今日で代用する
    const downloadDate = downloadDateFromFilename(filename) ?? today;
    const warnings: string[] = [];
    if (!downloadDateFromFilename(filename)) {
      warnings.push(
        `ファイル名から取得日を読めませんでした。${downloadDate} を基準に年を補完します。` +
          "取得日が違う場合は年がずれる可能性があります。",
      );
    }

    const rows: ParsedRow[] = [];
    for (let i = 1; i < table.length; i++) {
      const cells = table[i];
      const lineNo = i + 1;

      const md = (cells[COL.date] ?? "").match(/(\d{1,2})月(\d{1,2})日/);
      if (!md) {
        warnings.push(`${lineNo}行目: 取扱日付を読めないため飛ばしました（${cells[COL.date]}）`);
        continue;
      }
      const month = Number(md[1]);
      const day = Number(md[2]);
      const date = `${resolveYear(month, day, downloadDate)}-${pad2(month)}-${pad2(day)}`;

      const out = toAmount(cells[COL.paid]);
      const inAmount = toAmount(cells[COL.received]);
      if (out === null && inAmount === null) {
        warnings.push(`${lineNo}行目: 金額が空のため飛ばしました`);
        continue;
      }
      if (out !== null && inAmount !== null) {
        warnings.push(`${lineNo}行目: 入金と出金の両方に値があるため飛ばしました`);
        continue;
      }

      const amount = (out ?? inAmount) as number;
      const description = (cells[COL.description] ?? "").trim();
      const balanceAfter = toAmount(cells[COL.balance]);
      const no = (cells[COL.no] ?? "").trim();

      rows.push({
        date,
        amount: Math.abs(amount),
        direction: out !== null ? "out" : "in",
        merchant: description,
        matchText: description,
        sourceRef: null,
        balanceAfter,
        // 9.2: 番号は日ごとの連番なので、行の内容を合わせてキーにする
        dedupSeed: `kyoto:${date}:${no}:${amount}:${description}:${balanceAfter ?? ""}`,
        lineNo,
      });
    }

    if (rows.length === 0) return empty("取り込める明細がありませんでした");

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      periodFrom: dates[0],
      periodTo: dates[dates.length - 1],
      warnings,
      error: null,
    };
  },
};

function empty(error: string): ParseResult {
  return { rows: [], periodFrom: null, periodTo: null, warnings: [], error };
}
