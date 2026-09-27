/**
 * PDF明細から文字を取り出す（ブラウザ専用）。
 *
 * pdfjs は大きいので、PDFが選ばれたときに初めて読み込む。
 * worker と日本語フォントの文字コード表（cmaps）は scripts/copy-pdfjs.mjs が
 * public/pdfjs に置いたものを使う。cmaps が無いと楽天の明細は文字化けではなく
 * 「文字が1つも出ない」になる（90ms-RKSJ-H を使っているため）。
 *
 * iPhone の Safari でも動くよう legacy ビルドを使う。
 */
import { pagesToText, type PdfItem } from "@/lib/parsers/pdf-lines";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

  // getDocument は渡した配列を worker へ移して使えなくする。ハッシュ計算に使う元は残す
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  });
  const doc = await task.promise;

  try {
    const pages: PdfItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items.flatMap((it) =>
          "str" in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5] }] : [],
        ),
      );
    }
    return pagesToText(pages);
  } finally {
    await task.destroy();
  }
}

/** 先頭が `%PDF-` ならPDF。拡張子は信用しない */
export function isPdf(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer.slice(0, 5));
  return String.fromCharCode(...head) === "%PDF-";
}
