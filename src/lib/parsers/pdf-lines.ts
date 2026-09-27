/**
 * PDF から取り出した文字片を「行」に組み直す。
 *
 * カード会社の明細はCSVを出さず、PDFしか取れないものがある（楽天e-NAVI・
 * ポケットカード。2026-09-27 確認）。PDF の文字は座標付きの断片で出てくるため、
 * 同じ高さの断片を1行にまとめ、左から順に並べてタブでつなぐ。
 *
 * 取り出し（pdfjs）はブラウザで行い、ここで作った文字列をサーバーへ渡す。
 * CSV と同じく「素の文字列」をパーサーにかけるので、テストもフィクスチャで書ける。
 *
 * 癖:
 *   - **太字は同じ文字を少しずらして2度書いてある**（ポケットカード）。
 *     そのまま並べると `2026/07/04	2026/07/04` になるので、
 *     ほぼ同じ位置の同じ文字列は1つに畳む。金額の列（利用金額と請求金額）は
 *     離れた位置にあるので畳まれない
 *   - 同じ行でも断片ごとに高さが 0.5pt ほどずれる。行間は 11pt 前後あるので、
 *     3pt 以内を同じ行とみなす
 */

export type PdfItem = { str: string; x: number; y: number };

/** 同じ行とみなす高さの差（pt） */
const SAME_LINE = 3;
/** 重ね書きとみなす横位置の差（pt） */
const OVERPRINT = 2;

/** 1ページぶんの断片を、上から順の行（タブ区切り）にする */
export function itemsToLines(items: PdfItem[]): string[] {
  const kept = items.filter((it) => it.str.trim() !== "");

  // PDF の y は下から上へ増える。上の行から読む
  const sorted = [...kept].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const it of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current[0].y - it.y) <= SAME_LINE) {
      current.push(it);
    } else {
      lines.push([it]);
    }
  }

  return lines.map((line) => {
    const byX = [...line].sort((a, b) => a.x - b.x);
    const tokens: PdfItem[] = [];
    for (const it of byX) {
      const overprinted = tokens.some(
        (t) => t.str === it.str && Math.abs(t.x - it.x) <= OVERPRINT,
      );
      if (!overprinted) tokens.push(it);
    }
    return tokens.map((t) => t.str.trim()).join("\t");
  });
}

/** ページごとの断片から、パーサーに渡す文字列を作る */
export function pagesToText(pages: PdfItem[][]): string {
  return pages.map((items) => itemsToLines(items).join("\n")).join("\n");
}

/** パーサー側で1行をセルに分ける */
export function cellsOf(line: string): string[] {
  return line.split("\t");
}
