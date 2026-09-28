"use strict";

// mp4-writer.js: 만든 MP4 의 상자 구조를 직접 읽어 확인한다. 저장소에 ffmpeg.exe 가 있으면 실제 H.264·AAC 를 넣어
// ffmpeg 로 다시 풀어 장면·소리가 원본과 같은지도 본다(없으면 그 시험만 건너뛴다).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadModule, ROOT } = require("./photo-album-harness.js");

const MNMp4Writer = loadModule("mp4-writer.js", "MNMp4Writer");
const u32 = (bytes, at) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
const u16 = (bytes, at) => (bytes[at] << 8) + bytes[at + 1];
const CONTAINERS = new Set(["moov","trak","mdia","minf","stbl","dinf"]);
// 상자 나무: { type, start, size, body, children }
function boxes(bytes, start = 0, end = bytes.length){
  const list = [];
  for (let at = start; at + 8 <= end;){
    const size = u32(bytes, at), type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= end, `${type} 상자 크기가 범위를 넘음`);
    const box = { type, start:at, size, body:at + 8 };
    if (CONTAINERS.has(type)) box.children = boxes(bytes, at + 8, at + size);
    list.push(box); at += size;
  }
  return list;
}
const find = (list, ...types) => types.reduce((current, type) => { const hit = (Array.isArray(current) ? current : current.children).find(box => box.type === type); assert.ok(hit, type + " 상자 없음"); return hit; }, list);
function sampleTable(bytes, trak){
  const stbl = find(trak, "mdia", "minf", "stbl"), table = type => stbl.children.find(box => box.type === type);
  const stsz = table("stsz"), count = u32(bytes, stsz.body + 8);
  const sizes = Array.from({ length:count }, (_, i) => u32(bytes, stsz.body + 12 + i*4));
  const stco = table("stco"), offset = u32(bytes, stco.body + 8);
  const stss = table("stss"), keys = stss ? Array.from({ length:u32(bytes, stss.body + 4) }, (_, i) => u32(bytes, stss.body + 8 + i*4)) : null;
  const ctts = table("ctts");
  const handler = String.fromCharCode(...bytes.slice(find(trak, "mdia", "hdlr").body + 8, find(trak, "mdia", "hdlr").body + 12));
  return { sizes, offset, keys, ctts, handler, stsd:table("stsd") };
}
const sample = (length, fill) => ({ data:Uint8Array.from({ length }, (_, i) => (fill + i) & 255) });
const avcC = Uint8Array.from([1, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0, 2, 0x67, 0x42, 1, 0, 1, 0x68]);

test("영상만: ftyp→moov→mdat 순서, 조각 크기·위치·열쇠 장면이 맞고 순서가 그대로면 ctts 가 없다", () => {
  const samples = [0, 1, 2, 3].map(i => ({ ...sample(10 + i, i*16), key:i === 0 || i === 2, timestamp:i*1e6/30 }));
  const bytes = MNMp4Writer.mux({ width:320, height:240, fps:30, samples, avcC });
  const top = boxes(bytes);
  assert.deepEqual(top.map(box => box.type), ["ftyp", "moov", "mdat"]);
  const trak = find(top, "moov", "trak"), table = sampleTable(bytes, trak);
  assert.equal(table.handler, "vide");
  assert.deepEqual(table.sizes, [10, 11, 12, 13]);
  assert.deepEqual(table.keys, [1, 3]);
  assert.equal(table.ctts, undefined);
  assert.equal(table.offset, top[2].body, "조각은 mdat 바로 뒤에서 시작");
  let at = table.offset;
  samples.forEach(({ data }) => { assert.deepEqual([...bytes.slice(at, at + data.length)], [...data]); at += data.length; });
  const mvhd = find(top, "moov", "mvhd"); assert.equal(u32(bytes, mvhd.body + 12), 1000); assert.equal(u32(bytes, mvhd.body + 16), 133);
  const tkhd = find(trak, "tkhd"); assert.equal(u32(bytes, tkhd.body + 76) / 65536, 320); assert.equal(u32(bytes, tkhd.body + 80) / 65536, 240);
});

test("B 프레임처럼 표시 순서가 섞이면 ctts 를 0 이상으로 밀고 편집 목록으로 0초에 시작시킨다", () => {
  const order = [0, 3, 1, 2];
  const samples = order.map((pts, i) => ({ ...sample(8, i), key:i === 0, timestamp:pts*1e6/30 }));
  const bytes = MNMp4Writer.mux({ width:16, height:16, fps:30, samples, avcC });
  const trak = find(boxes(bytes), "moov", "trak"), table = sampleTable(bytes, trak);
  assert.ok(table.ctts); assert.equal(bytes[table.ctts.body], 0, "음수가 없으니 판 0");
  const runs = u32(bytes, table.ctts.body + 4), offsets = [];
  for (let i = 0; i < runs; i++){ const count = u32(bytes, table.ctts.body + 8 + i*8), offset = u32(bytes, table.ctts.body + 12 + i*8); for (let n = 0; n < count; n++) offsets.push(offset/3000); }
  const raw = order.map((pts, i) => pts - i), shift = -Math.min(...raw);
  assert.deepEqual(offsets, raw.map(offset => offset + shift));
  assert.ok(offsets.every(offset => offset >= 0));
  const edts = trak.children.find(box => box.type === "edts"); assert.ok(edts, "편집 목록");
  const elst = edts.body + 8; assert.equal(u32(bytes, elst + 4), 1); assert.equal(u32(bytes, elst + 12), shift*3000, "앞 지연만큼 잘라 낸다");
  const plain = MNMp4Writer.mux({ width:16, height:16, fps:30, samples:[0,1].map(i => ({ ...sample(4, i), key:!i, timestamp:i*1e6/30 })), avcC });
  assert.equal(find(boxes(plain), "moov", "trak").children.some(box => box.type === "edts"), false, "순서가 그대로면 편집 목록도 없다");
});

test("소리 트랙: 영상 뒤에 이어 담고 mp4a·esds 에 설정(ASC)과 표본 빈도를 적는다", () => {
  const video = [0, 1, 2].map(i => ({ ...sample(20, i), key:i === 0, timestamp:i*1e6/30 }));
  const audio = { samples:[sample(5, 100), sample(6, 110), sample(7, 120)], asc:Uint8Array.from([0x11, 0x90]), sampleRate:48000, channels:2 };
  const bytes = MNMp4Writer.mux({ width:64, height:64, fps:30, samples:video, avcC, audio });
  const top = boxes(bytes), moov = find(top, "moov"), traks = moov.children.filter(box => box.type === "trak");
  assert.equal(traks.length, 2);
  const [v, a] = traks.map(trak => sampleTable(bytes, trak));
  assert.equal(a.handler, "soun"); assert.deepEqual(a.sizes, [5, 6, 7]);
  assert.equal(a.offset, v.offset + 60, "소리 조각은 영상 조각 바로 뒤");
  assert.deepEqual([...bytes.slice(a.offset, a.offset + 5)], [...audio.samples[0].data]);
  const mp4a = a.stsd.body + 8, entry = String.fromCharCode(...bytes.slice(mp4a + 4, mp4a + 8));
  assert.equal(entry, "mp4a"); assert.equal(u16(bytes, mp4a + 8 + 16), 2, "채널"); assert.equal(u32(bytes, mp4a + 8 + 24) >>> 16, 48000, "표본 빈도");
  const esds = bytes.slice(mp4a, mp4a + u32(bytes, mp4a)), asc = [0x05, 0x80, 0x80, 0x80, 2, 0x11, 0x90];
  assert.ok(esds.join(",").includes(asc.join(",")), "esds 안에 ASC");
  assert.equal(u32(bytes, find(top, "moov", "mvhd").body + 96), 3, "다음 트랙 번호");
});

test("조각이 없거나 설정이 없으면 거절한다", () => {
  assert.throws(() => MNMp4Writer.mux({ width:1, height:1, fps:30, samples:[], avcC }), /mp4-no-samples/);
  assert.throws(() => MNMp4Writer.mux({ width:1, height:1, fps:30, samples:[{ ...sample(4, 0), key:true, timestamp:0 }] }), /mp4-no-avcc/);
});

const FFMPEG = path.join(ROOT, "ffmpeg.exe");
test("실제 H.264(B 프레임 포함)·AAC 를 담아 ffmpeg 로 풀면 원본과 장면·소리가 같다", { skip:!fs.existsSync(FFMPEG) && "ffmpeg.exe 가 없어 건너뜀", timeout:120000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "classdock-mp4-"));
  const run = (...args) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { cwd:dir, maxBuffer:64*1024*1024 }).toString();
  const md5 = (...args) => execFileSync(FFMPEG, ["-v", "error", ...args, "-f", "framemd5", "-"], { cwd:dir, maxBuffer:64*1024*1024 }).toString().split(/\r?\n/).filter(line => line && !line.startsWith("#")).map(line => line.split(",").pop().trim());
  try {
    run("-f", "lavfi", "-i", "testsrc=size=160x120:rate=30", "-t", "2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-threads", "1", "-bf", "2", "-g", "30", "ref.mp4");
    run("-i", "ref.mp4", "-c", "copy", "-bsf:v", "h264_mp4toannexb,h264_metadata=aud=insert", "-f", "h264", "v.h264");
    run("-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000", "-ac", "2", "-c:a", "aac", "-f", "adts", "a.aac");
    const pts = execFileSync(FFMPEG, ["-v", "error", "-i", "ref.mp4", "-c", "copy", "-f", "framecrc", "-"], { cwd:dir }).toString().split(/\r?\n/).filter(line => line && !line.startsWith("#")).map(line => Number(line.split(",")[2]));
    const step = [...new Set(pts)].sort((x, y) => x - y), unit = step[1] - step[0];
    // Annex B → 장면별 AVCC 조각 + avcC
    const b = fs.readFileSync(path.join(dir, "v.h264")), nals = [];
    for (let i = 0, start = -1; i <= b.length; i++){
      const atStart = i < b.length && b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && b[i + 3] === 1));
      if (atStart || i === b.length){ if (start >= 0) nals.push(b.subarray(start, i)); if (atStart){ const length = b[i + 2] === 1 ? 3 : 4; start = i + length; i += length - 1; } }
    }
    let sps, pps; const units = [];
    for (const nal of nals){ const type = nal[0] & 31; if (type === 9){ units.push({ nals:[], key:false }); continue; } if (type === 7){ sps = sps || nal; continue; } if (type === 8){ pps = pps || nal; continue; } if (type === 5) units[units.length - 1].key = true; units[units.length - 1].nals.push(nal); }
    const samples = units.filter(access => access.nals.length).map((access, i) => ({ key:access.key, timestamp:(pts[i] - step[0])/unit*1e6/30,
      data:Uint8Array.from(access.nals.flatMap(nal => [nal.length >>> 24, nal.length >>> 16 & 255, nal.length >>> 8 & 255, nal.length & 255, ...nal])) }));
    const config = Uint8Array.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps]);
    // ADTS → AAC 조각 + ASC
    const a = fs.readFileSync(path.join(dir, "a.aac")), frames = []; let asc = null;
    for (let at = 0; at < a.length;){ const length = ((a[at + 3] & 3) << 11) | (a[at + 4] << 3) | (a[at + 5] >> 5), header = (a[at + 1] & 1) ? 7 : 9;
      if (!asc){ const type = ((a[at + 2] >> 6) & 3) + 1, rate = (a[at + 2] >> 2) & 15, channels = ((a[at + 2] & 1) << 2) | (a[at + 3] >> 6); asc = Uint8Array.from([(type << 3) | (rate >> 1), ((rate & 1) << 7) | (channels << 3)]); }
      frames.push({ data:a.subarray(at + header, at + length) }); at += length; }
    fs.writeFileSync(path.join(dir, "out.mp4"), MNMp4Writer.mux({ width:160, height:120, fps:30, samples, avcC:config, audio:{ samples:frames, asc, sampleRate:48000, channels:2 } }));
    assert.deepEqual(md5("-i", "out.mp4", "-map", "0:v"), md5("-i", "v.h264"), "장면이 원본과 같다");
    assert.deepEqual(md5("-i", "out.mp4", "-map", "0:a"), md5("-i", "a.aac"), "풀어 낸 소리가 원본과 같다");
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
