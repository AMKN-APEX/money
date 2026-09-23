/**
 * 利用通知メールの本文を読むための共通処理。
 *
 * カード各社のメールはHTMLをプレーンテキストに落としたもので、次の癖がある:
 *   - 数字・記号・英字が全角                  例: ２０２６／０９／２３ / ９，９８０円
 *   - 空行と不可視の空白（NBSP）が大量に入る
 *   - 項目名と値が別々の行に来る              例: ■ご利用金額 → 次の行に 6,525円
 *
 * 先に本文まるごとを NFKC 正規化してしまえば、全角も NBSP も畳めて
 * 以降の処理が素の文字列操作になる。表示用の文字列もこの形を使う
 * （全角のまま出すより読みやすいため）。
 */

/** 本文を NFKC 正規化し、行末の空白を落とした行配列にする */
export function toLines(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.replace(/[\s　]+$/g, "").replace(/^[\s　]+/g, ""));
}

/** `■ご利用金額` のような見出し行の、次に現れる空でない行を返す */
export function valueAfter(lines: string[], heading: string): string | null {
  const at = lines.findIndex((line) => line.startsWith(heading));
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i] !== "") return lines[i];
  }
  return null;
}

/** `6,525円` → 6525。円が無い / 0以下なら null */
export function toYen(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/([0-9][0-9,]*)\s*円/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `2026/09/23 16:51:00` → { date: "2026-09-23", time: "16:51:00" } */
export function toDateTime(text: string | null | undefined): { date: string; time: string | null } | null {
  if (!text) return null;
  const m = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D{1,3}(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;

  const [, y, mo, d, hh, mi, ss] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const pad = (n: string | number) => String(n).padStart(2, "0");
  return {
    date: `${y}-${pad(month)}-${pad(day)}`,
    time: hh ? `${pad(hh)}:${mi}${ss ? `:${ss}` : ""}` : null,
  };
}

/**
 * 行末の利用区分を切り離す。
 *   `ユニクロ・GU・PLSTオンライン(買物)` → { name: "ユニクロ・GU・PLSTオンライン", kind: "買物" }
 * CSVの明細には区分が付かないため、付けたままだとルールが両方に当たらない。
 */
export function splitUsageKind(merchant: string): { name: string; kind: string | null } {
  const m = merchant.match(/^(.*\S)\s*[(（]([^()（）]{1,12})[)）]$/);
  if (!m) return { name: merchant, kind: null };
  return { name: m[1], kind: m[2] };
}
