// PDF明細（楽天・ポケットカード）をブラウザで読むための pdfjs の付属ファイルを public/ に置く。
// worker と、日本語フォントの文字コード表（cmaps）はバンドルに入らず、実行時に URL で取りに行く。
// 生成物なのでコミットしない（.gitignore）。dev / build の前に自動で走る。
import { cpSync, mkdirSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = "public/pdfjs";

mkdirSync(to, { recursive: true });
cpSync(`${from}/legacy/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
cpSync(`${from}/cmaps`, `${to}/cmaps`, { recursive: true });
console.log("pdfjs の worker と cmaps を public/pdfjs に置きました");
