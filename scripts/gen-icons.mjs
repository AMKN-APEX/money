// PWA 用アイコンを生成する。外部依存なし（zlib のみ）。
//   node scripts/gen-icons.mjs
// 出力: public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png,
//       src/app/apple-icon.png, src/app/icon.png
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BG = [15, 23, 42]; // slate-900
const FG = [52, 211, 153]; // emerald-400

// ---------------------------------------------------------------- PNG 出力

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10-12: compression / filter / interlace = 0

  // 各行の先頭にフィルタ種別 0 を置く
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    rgb.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 描画

function makeCanvas(size, bg) {
  const buf = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    buf[i * 3] = bg[0];
    buf[i * 3 + 1] = bg[1];
    buf[i * 3 + 2] = bg[2];
  }
  return buf;
}

function px(buf, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 3;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
}

function rect(buf, size, x0, y0, x1, y1, color) {
  for (let y = Math.round(y0); y < Math.round(y1); y++) {
    for (let x = Math.round(x0); x < Math.round(x1); x++) px(buf, size, x, y, color);
  }
}

/** 太さ t の線分。端点を含めて正方形ブラシで塗る */
function line(buf, size, x0, y0, x1, y1, t, color) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  const h = t / 2;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const cx = x0 + (x1 - x0) * p;
    const cy = y0 + (y1 - y0) * p;
    rect(buf, size, cx - h, cy - h, cx + h, cy + h, color);
  }
}

/** 円マークを描く。scale は安全領域（maskable）向けの縮小率 */
function drawYen(size, scale = 1) {
  const buf = makeCanvas(size, BG);
  const c = size / 2;
  const u = (v) => c + (v - 0.5) * size * scale; // 0..1 の座標を実座標へ
  const t = size * 0.078 * scale;

  // 上の二本のはらい
  line(buf, size, u(0.28), u(0.26), u(0.5), u(0.505), t, FG);
  line(buf, size, u(0.72), u(0.26), u(0.5), u(0.505), t, FG);
  // 縦棒
  rect(buf, size, u(0.5) - t / 2, u(0.47), u(0.5) + t / 2, u(0.79), FG);
  // 横二本（細めにして間隔を空ける）
  const bt = t * 0.78;
  rect(buf, size, u(0.31), u(0.575), u(0.69), u(0.575) + bt, FG);
  rect(buf, size, u(0.31), u(0.685), u(0.69), u(0.685) + bt, FG);

  return encodePng(size, buf);
}

const outputs = [
  ["public/icon-192.png", 192, 1],
  ["public/icon-512.png", 512, 1],
  // maskable は外周 20% が切られる想定で中身を縮める
  ["public/icon-maskable-512.png", 512, 0.78],
  ["src/app/apple-icon.png", 180, 1],
  ["src/app/icon.png", 192, 1],
];

for (const [path, size, scale] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, drawYen(size, scale));
  console.log("wrote", path, `${size}x${size}`);
}
