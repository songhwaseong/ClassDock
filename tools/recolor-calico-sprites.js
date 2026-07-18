// 복실고양이(라그돌) 시트를 삼색고양이(칼리코) 배색으로 리컬러한다.
// 갈색 → 주황, 각 셀 상단(귀·꼬리 끝) 갈색 → 검정, 크림색 몸통 → 흰색으로 보정.
const zlib = require("zlib");
const fs = require("fs");

const SRC = process.argv[2] || "D:/my/src/assets/fluffy-cat-sprites-v2.png";
const OUT = process.argv[3] || "calico-recolor.png";
const CELL = 96, COLS = 6, ROWS = 4;

// ---------- PNG 디코드 (8bit RGBA, non-interlaced) ----------
const buf = fs.readFileSync(SRC);
const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
let pos = 8;
const idat = [];
while (pos < buf.length){
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  if (type === "IDAT") idat.push(buf.slice(pos + 8, pos + 8 + len));
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = W * 4;
const img = Buffer.alloc(W * H * 4);
function paeth(a, b, c){
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
for (let y = 0; y < H; y++){
  const f = raw[y * (stride + 1)];
  const row = y * stride, prev = (y - 1) * stride;
  for (let i = 0; i < stride; i++){
    const x = raw[y * (stride + 1) + 1 + i];
    const a = i >= 4 ? img[row + i - 4] : 0;
    const b = y > 0 ? img[prev + i] : 0;
    const c = y > 0 && i >= 4 ? img[prev + i - 4] : 0;
    let v;
    if (f === 0) v = x;
    else if (f === 1) v = x + a;
    else if (f === 2) v = x + b;
    else if (f === 3) v = x + ((a + b) >> 1);
    else v = x + paeth(a, b, c);
    img[row + i] = v & 0xff;
  }
}

// ---------- 리컬러 ----------
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

// 셀별 고양이 바운딩박스(불투명 픽셀 기준)
function cellBBox(cx0, cy0){
  let top = CELL, bot = 0;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++){
    if (img[((cy0 + y) * W + cx0 + x) * 4 + 3] > 40){
      if (y < top) top = y;
      if (y > bot) bot = y;
    }
  }
  return { top, bot };
}

for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++){
  const cx0 = cx * CELL, cy0 = cy * CELL;
  const bb = cellBBox(cx0, cy0);
  const blackLine = bb.top + (bb.bot - bb.top) * 0.24;   // 이 위의 갈색은 검정으로
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++){
    const off = ((cy0 + y) * W + cx0 + x) * 4;
    const a = img[off + 3];
    if (a < 10) continue;
    const r = img[off], g = img[off + 1], b = img[off + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx - mn;
    const L = lum(r, g, b);
    if (sat > 34 && r > g && g > b){
      // 갈색 털
      if (y < blackLine){
        // 검정 얼룩: 밝기를 눌러서 짙은 회흑색 그라데이션으로
        const t = Math.min(1, L / 165);
        img[off]     = clamp(38 + t * 66);
        img[off + 1] = clamp(34 + t * 60);
        img[off + 2] = clamp(38 + t * 64);
      } else {
        // 주황 얼룩: 명암 유지한 채 주황 계열로(사진처럼 차분한 톤)
        const k = (L / 145) * 0.92;
        img[off]     = clamp(198 * k);
        img[off + 1] = clamp(122 * k);
        img[off + 2] = clamp(64 * k);
      }
    } else if (sat <= 34 && L > 165){
      // 크림 몸통 → 더 하얗게
      img[off]     = clamp(r + (252 - r) * 0.6);
      img[off + 1] = clamp(g + (249 - g) * 0.6);
      img[off + 2] = clamp(b + (243 - b) * 0.6);
    }
  }
}

// ---------- PNG 인코딩 ----------
const crcTable = [];
for (let n = 0; n < 256; n++){
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(d){
  let c = 0xffffffff;
  for (const v of d) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6;
const out = Buffer.alloc(H * (stride + 1));
for (let y = 0; y < H; y++){
  out[y * (stride + 1)] = 0;
  img.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
}
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(out, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]));
console.log("saved", OUT);
