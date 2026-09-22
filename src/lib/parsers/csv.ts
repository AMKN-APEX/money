/**
 * CSV の分解と、銀行CSVでよく出る値の正規化。
 *
 * 文字コードの変換はここではやらない。金融機関のCSVは CP932 だが、
 * 変換はブラウザ側（TextDecoder("shift_jis")）で済ませてから渡す。
 * サーバーの ICU に依存せず、パーサーを素の文字列処理として試験できる。
 */

/** ダブルクォート囲み・エスケープ（""）・CRLF に対応した最小のCSV分解 */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * 金額。`\712,869` のような形で来る。
 * CP932 の円記号はデコードすると ASCII のバックスラッシュになるため、それも剥がす。
 * 空欄は null（入金・出金のどちらかは必ず空になる）。
 */
export function toAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = raw.normalize("NFKC").replace(/[\\¥￥,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * ファイル名 `ny20260922172847.csv` からダウンロード日を取る。
 * 京都銀行のCSVは取扱日付に年が無く、ここから補う必要がある（9.2）。
 */
export function downloadDateFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{4})(\d{2})(\d{2})\d{6}/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo}-${d}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * 年の無い「8月3日」を補完する。
 * その年で組んだ日付がダウンロード日より後なら前年のものとみなす（9.2）。
 */
export function resolveYear(month: number, day: number, downloadDate: string): number {
  const year = Number(downloadDate.slice(0, 4));
  const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
  return candidate > downloadDate ? year - 1 : year;
}
