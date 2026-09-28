"use strict";

// gif-encoder.js: 만든 GIF 를 시험 안의 작은 GIF 해독기로 다시 풀어 확인한다(외부 도구 없이).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./photo-album-harness.js");

const MNGifEncoder = loadModule("gif-encoder.js", "MNGifEncoder");

// GIF89a 를 읽어 크기·반복·장면(지연, 색 번호)·전역 팔레트를 돌려준다.
function decodeGif(bytes){
  let p = 0;
  const u8 = () => bytes[p++], u16 = () => { const value = bytes[p] | bytes[p + 1] << 8; p += 2; return value; };
  const text = length => { const value = String.fromCharCode(...bytes.slice(p, p + length)); p += length; return value; };
  const subBlocks = () => { const parts = []; let size; while ((size = u8())){ parts.push(bytes.slice(p, p + size)); p += size; } return parts; };
  const signature = text(6), width = u16(), height = u16(), flags = u8(); u8(); u8();
  let palette = null;
  if (flags & 0x80){ const size = 3*(1 << ((flags & 7) + 1)); palette = bytes.slice(p, p + size); p += size; }
  const frames = []; let delay = 0, loop = null;
  while (p < bytes.length){
    const block = u8();
    if (block === 0x3b) break;
    if (block === 0x21){
      const label = u8();
      if (label === 0xf9){ u8(); u8(); delay = u16(); u8(); u8(); }
      else if (label === 0xff){ const id = text(u8()); for (const data of subBlocks()) if (id === "NETSCAPE2.0" && data[0] === 1) loop = data[1] | data[2] << 8; }
      else subBlocks();
      continue;
    }
    if (block !== 0x2c) throw new Error("알 수 없는 블록 " + block);
    u16(); u16(); const frameWidth = u16(), frameHeight = u16(); u8();
    const minCodeSize = u8(), data = Uint8Array.from(subBlocks().flatMap(part => [...part]));
    frames.push({ delay, indices:lzwDecode(data, minCodeSize, frameWidth*frameHeight) });
  }
  return { signature, width, height, loop, palette, frames };
}
function lzwDecode(data, minCodeSize, count){
  const clear = 1 << minCodeSize, end = clear + 1, out = [];
  let size, dict, previous, bit = 0;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = dict[end] = null; size = minCodeSize + 1; previous = null; };
  const read = () => { let value = 0; for (let i = 0; i < size; i++, bit++) value |= ((data[bit >> 3] >> (bit & 7)) & 1) << i; return value; };
  reset();
  while (bit + size <= data.length*8){
    const code = read();
    if (code === clear){ reset(); continue; }
    if (code === end) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && previous) entry = previous.concat(previous[0]);
    else throw new Error("잘못된 LZW 코드 " + code);
    for (const index of entry) out.push(index);
    if (previous) dict.push(previous.concat(entry[0]));
    previous = entry;
    if (dict.length === (1 << size) && size < 12) size++;
  }
  assert.equal(out.length, count, "해독한 점 개수");
  return out;
}
const pixels = (width, height, color) => { const data = new Uint8ClampedArray(width*height*4); for (let i = 0; i < width*height; i++){ const [r, g, b] = color(i); data.set([r, g, b, 255], i*4); } return { width, height, data }; };
const colorAt = (gif, index) => [...gif.palette.slice(index*3, index*3 + 3)];

test("GIF 머리: 장면 수·지연(1/100초)·끝없는 반복·크기", async () => {
  const frames = [0, 1, 2].map(f => pixels(97, 61, i => [i % 97, (i/97|0)*4, f*80]));
  const gif = decodeGif(await MNGifEncoder.encode(frames, { delay:100 }));
  assert.equal(gif.signature, "GIF89a"); assert.equal(gif.width, 97); assert.equal(gif.height, 61);
  assert.equal(gif.loop, 0); assert.equal(gif.frames.length, 3); gif.frames.forEach(frame => assert.equal(frame.delay, 10));
});

test("색이 256개 이하면 한 점도 틀리지 않고 되살아난다(사전을 여러 번 비우는 큰 그림 포함)", async () => {
  let seed = 7; const random = () => (seed = (seed*48271) % 2147483647);
  const color = c => [c, (c*7) % 256, (c*13) % 256];
  const source = pixels(263, 171, () => color(random() % 200));
  const gif = decodeGif(await MNGifEncoder.encode([source]));
  gif.frames[0].indices.forEach((index, i) => assert.deepEqual(colorAt(gif, index), [...source.data.slice(i*4, i*4 + 3)], "점 " + i));
});

test("색이 많은 사진은 256색으로 줄이되 오차가 작다", async () => {
  const source = pixels(97, 61, i => [(i % 97)*255/97, (i/97|0)*255/61, 128]);
  const gif = decodeGif(await MNGifEncoder.encode([source]));
  let total = 0;
  gif.frames[0].indices.forEach((index, i) => { const [r, g, b] = colorAt(gif, index); total += Math.abs(r - source.data[i*4]) + Math.abs(g - source.data[i*4 + 1]) + Math.abs(b - source.data[i*4 + 2]); });
  assert.ok(total/(97*61) < 18, "평균 오차(세 색 합) " + (total/(97*61)).toFixed(1));
});

test("한 점짜리 그림과 빈 장면 목록", async () => {
  const gif = decodeGif(await MNGifEncoder.encode([pixels(1, 1, () => [10, 20, 30])]));
  assert.deepEqual(colorAt(gif, gif.frames[0].indices[0]), [10, 20, 30]);
  await assert.rejects(() => MNGifEncoder.encode([]), /gif-no-frames/);
});
