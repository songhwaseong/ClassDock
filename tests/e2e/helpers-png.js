"use strict";

// 테스트용 단색 PNG 만들기(외부 픽스처 파일 없이 원하는 크기를 즉석에서). truecolor 8bit.
const zlib = require("node:zlib");

function chunk(type, data){
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

// rowColor(y) 가 줄마다 색을 준다 — 단색은 물론 위아래 두 색 띠도 만들 수 있다.
function makePng(width, height, rowColor){
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++){
    const row = y * stride;
    raw[row] = 0;                                   // 필터 없음
    const [r, g, b] = rowColor(y);
    for (let x = 0; x < width; x++){
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const solidPng = (width, height, rgb) => makePng(width, height, () => rgb);
// 위 절반·아래 절반이 다른 색 — 타일로 깔면 가로 띠가 반복되어 "몇 번 반복됐는지" 셀 수 있다.
const bandPng = (width, height, top, bottom) => makePng(width, height, (y) => (y < height / 2 ? top : bottom));

module.exports = { solidPng, bandPng };
