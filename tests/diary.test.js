"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
const diary = require("../src/js/diary.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const png = (seed) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1, seed + 2]);

test("CRC32 는 표준 값과 같다", () => {
  assert.equal(diary.diaryCrc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  assert.equal(diary.diaryCrc32(new Uint8Array(0)), 0);
});

test("무압축 ZIP 을 만들고 다시 읽으면 이름(한글)·바이트가 그대로다", async () => {
  const files = [
    { name:"diary.json", bytes:new TextEncoder().encode('{"a":"일기"}') },
    { name:"assets/abcd1234.png", bytes:png(7) }
  ];
  const zip = diary.diaryZipBuild(files, new Date(2026, 8, 18, 10, 30, 12));
  const back = await diary.diaryZipRead(zip);
  assert.deepEqual([...back.keys()], ["diary.json", "assets/abcd1234.png"]);
  assert.equal(new TextDecoder().decode(back.get("diary.json")), '{"a":"일기"}');
  assert.deepEqual([...back.get("assets/abcd1234.png")], [...png(7)]);
});

test("다른 프로그램이 DEFLATE 로 다시 묶은 항목도 읽는다", async () => {
  const text = "하루 ".repeat(200);
  const raw = zlib.deflateRawSync(Buffer.from(text, "utf8"));
  // 우리 쓰기 함수로 STORE ZIP 을 만든 뒤 한 항목을 DEFLATE 로 바꿔 끼운다.
  const name = new TextEncoder().encode("diary.json");
  const size = Buffer.byteLength(text, "utf8");
  const crc = diary.diaryCrc32(new TextEncoder().encode(text));
  const out = Buffer.alloc(30 + name.length + raw.length + 46 + name.length + 22);
  let p = 0;
  out.writeUInt32LE(0x04034b50, p); out.writeUInt16LE(20, p + 4); out.writeUInt16LE(0x0800, p + 6); out.writeUInt16LE(8, p + 8);
  out.writeUInt32LE(crc, p + 14); out.writeUInt32LE(raw.length, p + 18); out.writeUInt32LE(size, p + 22); out.writeUInt16LE(name.length, p + 26);
  Buffer.from(name).copy(out, p + 30); raw.copy(out, p + 30 + name.length);
  p += 30 + name.length + raw.length;
  const cd = p;
  out.writeUInt32LE(0x02014b50, p); out.writeUInt16LE(20, p + 4); out.writeUInt16LE(20, p + 6); out.writeUInt16LE(0x0800, p + 8); out.writeUInt16LE(8, p + 10);
  out.writeUInt32LE(crc, p + 16); out.writeUInt32LE(raw.length, p + 20); out.writeUInt32LE(size, p + 24); out.writeUInt16LE(name.length, p + 28);
  out.writeUInt32LE(0, p + 42); Buffer.from(name).copy(out, p + 46);
  p += 46 + name.length;
  out.writeUInt32LE(0x06054b50, p); out.writeUInt16LE(1, p + 8); out.writeUInt16LE(1, p + 10); out.writeUInt32LE(p - cd, p + 12); out.writeUInt32LE(cd, p + 16);
  const back = await diary.diaryZipRead(new Uint8Array(out));
  assert.equal(new TextDecoder().decode(back.get("diary.json")), text);
});

test("ZIP 이 아니면 거절한다", async () => {
  await assert.rejects(() => diary.diaryZipRead(new TextEncoder().encode("그냥 글")), /diary-not-zip/);
});

test("일기장을 저장했다 열면 글·꾸미기·스티커·사진이 그대로 돌아온다", async () => {
  const model = diary.diaryEmpty("나의 일기");
  model.style = diary.diaryNormalizeStyle({ lines:"grid", gap:"wide", bg:"assets/bg000001.jpg", fit:"tile", veil:0.25 });
  model.entries.push(
    { date:"2026-09-18", title:"비 온 날", text:"우산을 챙겼다.\n저녁엔 개었다.", style:null,
      stickers:[{ id:"st-a", asset:"assets/st000001.png", x:0.2, y:0.5, w:0.3, ar:0.75 }] },
    { date:"2026-09-17", title:"", text:"", style:null, stickers:[] }       // 빈 날 — 저장에서 빠진다
  );
  const assets = new Map([
    ["assets/bg000001.jpg", { bytes:png(1) }],
    ["assets/st000001.png", { bytes:png(2) }],
    ["assets/unused01.png", { bytes:png(3) }]                              // 아무도 안 쓰는 사진 — 저장에서 빠진다
  ]);
  const bytes = diary.diaryPack(model, assets, Date.UTC(2026, 8, 18));
  const names = [...(await diary.diaryZipRead(bytes)).keys()];
  assert.deepEqual(names, ["diary.json", "assets/bg000001.jpg", "assets/st000001.png"]);

  const back = await diary.diaryUnpack(bytes);
  assert.equal(back.model.title, "나의 일기");
  assert.deepEqual(back.model.style, { lines:"grid", gap:"wide", bg:"assets/bg000001.jpg", fit:"tile", veil:0.25, font:"gothic", genkoCols:0,
    paper:"none", paperColor:diary.DIARY_PAPER_DEFAULT_COLOR, paperTone:0.5 });
  assert.equal(back.model.entries.length, 1);
  assert.equal(back.model.entries[0].text, "우산을 챙겼다.\n저녁엔 개었다.");
  assert.deepEqual(back.model.entries[0].stickers, [{ id:"st-a", kind:"photo", asset:"assets/st000001.png", x:0.2, y:0.5, w:0.3, ar:0.75, rot:0, flip:false }]);
  assert.deepEqual([...back.assets.get("assets/st000001.png").bytes], [...png(2)]);
  assert.equal(diary.diaryContentKey(back.model), diary.diaryContentKey(model));
});

test("ZIP 에 없는 사진을 가리키는 스티커·배경은 버리고, 이상한 값은 기본값으로 되돌린다", async () => {
  const json = JSON.stringify({
    format:"classdock-diary", version:1, title:"t",
    style:{ lines:"zigzag", gap:"huge", bg:"assets/missing1.png", fit:"stretch", veil:"" },
    entries:[
      { date:"2026-02-30", text:"없는 날짜" },
      { date:"2026-09-01", text:"a", stickers:[{ asset:"assets/missing1.png" }, { asset:"../evil.png" }, { asset:"assets/ok000001.png", x:"", w:9 }] },
      { date:"2026-09-01", text:"같은 날 두 번째 — 버린다" }
    ]
  });
  const zip = diary.diaryZipBuild([
    { name:"diary.json", bytes:new TextEncoder().encode(json) },
    { name:"assets/ok000001.png", bytes:png(4) }
  ]);
  const { model } = await diary.diaryUnpack(zip);
  assert.deepEqual(model.style, diary.diaryDefaultStyle());
  assert.equal(model.entries.length, 1);
  assert.equal(model.entries[0].text, "a");
  assert.equal(model.entries[0].stickers.length, 1);
  assert.equal(model.entries[0].stickers[0].x, 0.1);            // Number("")=0 이 아니라 기본값
  assert.equal(model.entries[0].stickers[0].w, 1.5);            // 상한으로 자름
});

test("다른 형식·새 버전은 거절한다", () => {
  assert.throws(() => diary.diaryNormalize({ format:"classdock-note", version:1 }), /diary-format/);
  assert.throws(() => diary.diaryNormalize({ format:"classdock-diary", version:99 }), /diary-version/);
});

test("새 일기장 뼈대는 곧바로 열리는 ZIP 이다", async () => {
  assert.equal(diary.diaryScratchFileName(1), "일기장.diary");
  assert.equal(diary.diaryScratchFileName(3), "일기장 3.diary");
  const { model } = await diary.diaryUnpack(diary.diaryStarterBytes("여름 일기.diary"));
  assert.equal(model.title, "여름 일기");
  assert.deepEqual(model.entries, []);
});

test("암호 일기장은 글과 사진을 함께 봉인하고 맞는 암호로만 열린다", async () => {
  assert.equal(diary.diaryCryptoReady(), true);
  const model = diary.diaryEmpty("비밀 일기");
  model.entries.push(diary.diaryNormalizeEntry({
    date:"2026-09-18", title:"아무도 모르는 제목", text:"유일한 비밀 문장 918",
    stickers:[{ id:"secret-photo", asset:"assets/secret01.png", x:0.1, y:0.2, w:0.3, ar:1 }]
  }));
  const assets = new Map([["assets/secret01.png", { bytes:png(41) }]]);
  const plain = diary.diaryPack(model, assets, Date.UTC(2026, 8, 18));
  const protection = await diary.diaryDeriveProtection("correct horse battery staple", null, 1000);
  const sealedA = await diary.diarySealBytes(plain, protection);
  const sealedB = await diary.diarySealBytes(plain, protection);

  assert.equal(diary.diaryIsEncrypted(sealedA), true);
  assert.equal(diary.diaryEncryptedInfo(sealedA).iterations, 1000);
  assert.notDeepEqual([...diary.diaryEncryptedInfo(sealedA).iv], [...diary.diaryEncryptedInfo(sealedB).iv]);
  assert.equal(Buffer.from(sealedA).includes(Buffer.from("diary.json")), false);
  assert.equal(Buffer.from(sealedA).includes(Buffer.from("유일한 비밀 문장 918")), false);
  assert.equal(await diary.diaryOpenSealed(sealedA, "wrong password"), null);

  const opened = await diary.diaryOpenSealed(sealedA, "correct horse battery staple");
  assert.ok(opened && opened.protection && opened.protection.key);
  const back = await diary.diaryUnpack(opened.bytes);
  assert.equal(back.model.entries[0].text, "유일한 비밀 문장 918");
  assert.deepEqual([...back.assets.get("assets/secret01.png").bytes], [...png(41)]);
});

test("암호 봉투를 바꾸면 인증에 실패하고 비정상 KDF 값은 계산 전에 거절한다", async () => {
  const protection = await diary.diaryDeriveProtection("긴 암호 문구입니다", null, 1000);
  const sealed = await diary.diarySealBytes(new TextEncoder().encode("protected bytes"), protection);
  const changed = sealed.slice(); changed[changed.length - 1] ^= 1;
  assert.equal(await diary.diaryOpenSealed(changed, "긴 암호 문구입니다"), null);
  const badKdf = sealed.slice(); new DataView(badKdf.buffer).setUint32(8, 0xffffffff, true);
  await assert.rejects(() => diary.diaryOpenSealed(badKdf, "긴 암호 문구입니다"), /diary-encrypted-kdf/);
});

test("달력은 일요일부터 6주를 채우고 날짜 계산은 달·해를 넘긴다", () => {
  const grid = diary.diaryMonthGrid(2026, 8);                    // 2026년 9월 — 1일이 화요일
  assert.equal(grid.length, 42);
  assert.equal(grid[0].key, "2026-08-30");
  assert.equal(grid[2].key, "2026-09-01");
  assert.equal(grid[2].inMonth, true);
  assert.equal(grid[0].inMonth, false);
  assert.equal(diary.diaryAddDays("2026-12-31", 1), "2027-01-01");
  assert.equal(diary.diaryAddDays("2028-03-01", -1), "2028-02-29");
  assert.equal(diary.diaryDateLabel("2026-09-18"), "2026년 9월 18일 금요일");
  assert.equal(diary.diaryIsDateKey("2026-02-29"), false);
});

test("줄 무늬는 줄 간격과 글줄 높이가 같고, 줄 공책엔 여백선이 있다", () => {
  for (const gap of Object.keys(diary.DIARY_GAPS)){
    const m = diary.diaryLineMetrics({ lines:"ruled", gap });
    assert.equal(m.padTop, m.gap);
    const bg = diary.diaryLineBackground({ lines:"ruled", gap });
    assert.match(bg.size, new RegExp("100% " + m.gap + "px"));
    assert.match(bg.image, /--diary-margin/);
  }
  assert.equal(diary.diaryLineBackground({ lines:"blank" }).image, "none");
  assert.match(diary.diaryLineBackground({ lines:"dots", gap:"normal" }).image, /radial-gradient/);
});

test("따로 꾸민 날은 그 날의 꾸미기를, 나머지는 일기장 꾸미기를 쓴다", () => {
  const model = diary.diaryEmpty();
  const own = { date:"2026-09-18", title:"", text:"", style:{ ...diary.diaryDefaultStyle(), lines:"dots" }, stickers:[] };
  assert.equal(diary.diaryEffectiveStyle(model, own).lines, "dots");
  assert.equal(diary.diaryEffectiveStyle(model, { ...own, style:null }).lines, "ruled");
  assert.equal(diary.diaryEntryIsEmpty(own), false);            // 꾸미기만 한 날도 남긴다
});

test("검색 글과 목록 이름은 날짜·제목·본문에서 뽑는다", () => {
  const model = diary.diaryEmpty();
  model.entries.push({ date:"2026-09-18", title:"", text:"\n  첫 줄\n둘째 줄", style:null, stickers:[] });
  assert.equal(diary.diaryEntryLabel(model.entries[0]), "첫 줄");
  assert.match(diary.diaryPlainText(model), /2026년 9월 18일 금요일\n\n  첫 줄/);
  assert.ok(diary.diaryEntryMatches(model.entries[0], "둘째"));
  assert.ok(diary.diaryEntryMatches(model.entries[0], "금요일"));
  assert.equal(diary.diaryEntryLabel({ title:"", text:"", stickers:[{}, {}] }), "사진 2장");
});

test(".diary 는 파일 열기·새로 만들기 메뉴·manifest·검색에 연결된다", () => {
  const html = read("classdock.html");
  assert.match(html, /accept="[^"]*\.diary/);
  assert.match(html, /id="sbNewDiary"/);
  assert.match(html, /id="dzNewDiary"/);
  assert.match(html, /src="src\/js\/diary\.js"/);
  assert.match(read("src/js/file-loaders.js"), /ext === "diary"[\s\S]{0,80}loadDiary/);
  assert.match(read("scripts.manifest.json"), /"diary\.js"/);
  assert.match(read("src/js/documents.js"), /isDiarySearchable\(doc\)\) return diarySearchText\(doc\)/);
  assert.match(read("src/js/command-palette.js"), /newDiaryScratch/);
  const diarySource = read("src/js/diary.js");
  assert.match(diarySource, /body\.append\(side, entryRail, main\)/);       // 달력 · 카드 목록 · 편집기 3단
  assert.match(diarySource, /firstSticker[\s\S]{0,300}diary-entry-card-thumb/);
  assert.match(diarySource, /diary-entry-card-drawing/);                    // 카드에서도 펜 그림을 축소 렌더링
  const css = read("src/styles.css");
  assert.match(css, /--diary-c-side:224px;--diary-c-rail:300px/);                 // 3단 폭은 변수로 두고
  assert.match(css, /grid-template-columns:var\(--diary-c-side\) var\(--diary-c-rail\) minmax\(0,1fr\)/);
  // 접으면 남은 칸이 앞 칸 폭을 물려받아 짜부라지므로 틀을 다시 정해야 한다
  assert.match(css, /is-side-collapsed \.diary-body\{grid-template-columns:var\(--diary-c-rail\) minmax\(0,1fr\)\}/);
  assert.match(css, /is-rail-collapsed \.diary-body\{grid-template-columns:var\(--diary-c-side\) minmax\(0,1fr\)\}/);
  assert.match(css, /is-side-collapsed\.is-rail-collapsed \.diary-body\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.diary-doc\.is-focus \.diary-side,\.diary-doc\.is-focus \.diary-entry-rail\{display:none\}/);
  // 종이에 떨어뜨린 사진이 새 탭으로 새지 않게 전역 드롭 오버레이가 일기장을 비켜 간다.
  assert.match(read("src/js/app.js"), /state\.kind === "diary"/);
  const types = require("../src/js/document-types.js");
  const api = types.MNDocumentTypes || types;
  assert.ok(api.ZIP_OPENABLE.includes("diary"));
});

/* ---------- 2단계: 날씨·기분 · 스티커 돌리기/뒤집기 · 그림일기 · 글꼴 ---------- */

test("2단계 필드(날씨·기분·돌리기·뒤집기·글꼴·그림일기)가 저장했다 열어도 그대로다", async () => {
  const model = diary.diaryEmpty("여행");
  model.style = diary.diaryNormalizeStyle({ lines:"picture", gap:"normal", font:"myeongjo" });
  model.entries.push({ date:"2026-09-19", title:"", text:"바다", style:null, weather:"sunny", mood:"happy",
    stickers:[{ id:"st-b", asset:"assets/st000002.png", x:0.1, y:0.2, w:0.4, ar:0.5, rot:-30, flip:true }] });
  const bytes = diary.diaryPack(model, new Map([["assets/st000002.png", { bytes:png(5) }]]));
  const { model:back } = await diary.diaryUnpack(bytes);
  assert.equal(back.version, diary.DIARY_VERSION);
  assert.equal(back.style.lines, "picture");
  assert.equal(back.style.font, "myeongjo");
  assert.equal(back.entries[0].weather, "sunny");
  assert.equal(back.entries[0].mood, "happy");
  assert.deepEqual(back.entries[0].stickers[0], { id:"st-b", kind:"photo", asset:"assets/st000002.png", x:0.1, y:0.2, w:0.4, ar:0.5, rot:-30, flip:true });
  assert.equal(diary.diaryContentKey(back), diary.diaryContentKey(model));
});

test("1단계에서 만든 파일(version 1)도 열리고, 새 필드는 기본값이 된다", async () => {
  const json = JSON.stringify({ format:"classdock-diary", version:1, title:"옛 일기",
    style:{ lines:"ruled", gap:"normal", bg:"", fit:"cover", veil:0.4 },
    entries:[{ date:"2026-09-18", text:"옛 글", stickers:[{ id:"s", asset:"assets/old00001.png", x:0.1, y:0.1, w:0.3, ar:1 }] }] });
  const zip = diary.diaryZipBuild([{ name:"diary.json", bytes:new TextEncoder().encode(json) }, { name:"assets/old00001.png", bytes:png(6) }]);
  const { model } = await diary.diaryUnpack(zip);
  assert.equal(model.style.font, "gothic");
  assert.equal(model.entries[0].weather, "");
  assert.equal(model.entries[0].stickers[0].rot, 0);
  assert.equal(model.entries[0].stickers[0].flip, false);
});

test("모르는 날씨·기분·글꼴·줄 무늬는 버린다", () => {
  const e = diary.diaryNormalizeEntry({ date:"2026-09-18", text:"a", weather:"tornado", mood:"<script>" });
  assert.equal(e.weather, "");
  assert.equal(e.mood, "");
  const st = diary.diaryNormalizeStyle({ font:"Comic Sans", lines:"music" });
  assert.equal(st.font, "gothic");
  assert.equal(st.lines, "ruled");
});

test("각도는 -180 초과 180 이하로 모으고 -0 은 0 이 된다", () => {
  assert.equal(diary.diaryNormalizeAngle(370), 10);
  assert.equal(diary.diaryNormalizeAngle(-190), 170);
  assert.equal(diary.diaryNormalizeAngle(180), 180);
  assert.equal(diary.diaryNormalizeAngle(-180), 180);
  assert.ok(Object.is(diary.diaryNormalizeAngle(-360), 0));
  assert.equal(diary.diaryNormalizeSticker({ asset:"assets/abcd1234.png", rot:"" }).rot, 0);   // Number("")=0 함정과 무관하게 기본값
});

test("날씨·기분만 고른 날도 남고, 목록·검색에 이름으로 나온다", () => {
  const e = { date:"2026-09-18", title:"", text:"", style:null, weather:"rainy", mood:"tired", stickers:[] };
  assert.equal(diary.diaryEntryIsEmpty(e), false);
  assert.equal(diary.diaryEntryLabel(e), "비 · 피곤");
  assert.equal(diary.diaryWeatherMoodLabel(e), "날씨 비 · 기분 피곤");
  assert.ok(diary.diaryEntryMatches(e, "피곤"));
  const model = diary.diaryEmpty(); model.entries.push(e);
  assert.match(diary.diaryPlainText(model), /날씨 비 · 기분 피곤/);
  // 고르개 목록은 값이 겹치지 않는다
  for (const list of [diary.DIARY_WEATHERS, diary.DIARY_MOODS]) assert.equal(new Set(list.map(x => x[0])).size, list.length);
});

test("7단계 태그·즐겨찾기는 정리해 저장되고 일기장 검색에도 잡힌다", async () => {
  const model = diary.diaryEmpty("기록");
  const entry = diary.diaryNormalizeEntry({
    date:"2026-09-18", favorite:true, tags:[" 학교 ", "#친구", "학교", "", "아주 긴 태그 이름도 안전하게 잘라서 저장합니다"]
  });
  model.entries.push(entry);
  assert.equal(diary.diaryEntryIsEmpty(entry), false);
  assert.deepEqual(entry.tags.slice(0, 3), ["학교", "친구", "아주 긴 태그 이름도 안전하게 잘라서 저장합"]);
  assert.ok(diary.diaryEntryMatches(entry, "친구"));
  assert.match(diary.diaryPlainText(model), /#학교/);
  const back = (await diary.diaryUnpack(diary.diaryPack(model, new Map()))).model.entries[0];
  assert.equal(back.favorite, true);
  assert.deepEqual(back.tags, entry.tags);
});

test("월간 돌아보기는 작성일·연속 기록·사진·기분·자주 쓴 말을 계산한다", () => {
  const entries = [
    diary.diaryNormalizeEntry({ date:"2026-09-01", text:"산책 산책 좋았다", mood:"happy", weather:"sunny", favorite:true, stickers:[] }),
    diary.diaryNormalizeEntry({ date:"2026-09-02", text:"산책 친구", mood:"happy", weather:"rainy", stickers:[{ id:"s", asset:"assets/photo.png", x:0, y:0, w:.2, ar:1 }] }, () => true),
    diary.diaryNormalizeEntry({ date:"2026-09-04", text:"친구와 공부", mood:"tired", weather:"sunny" }),
    diary.diaryNormalizeEntry({ date:"2026-10-01", text:"다른 달" })
  ];
  const stats = diary.diaryReviewStats(entries, 2026, 9);
  assert.equal(stats.count, 3);
  assert.equal(stats.longest, 2);
  assert.equal(stats.photos, 1);
  assert.equal(stats.favorite, 1);
  assert.deepEqual(stats.mood, ["happy", 2]);
  assert.deepEqual(stats.words[0], ["산책", 3]);
});

test("그림일기는 그림 칸 아래가 원고지이고, 그림 칸 좌우가 원고지 칸 줄 끝에 맞는다", () => {
  for (const gap of Object.keys(diary.DIARY_GAPS)){
    const style = { lines:"picture", gap };
    const m = diary.diaryLineMetrics(style, 760);
    const gm = diary.diaryGenkoMetrics(style, 760);
    assert.ok(m.box);
    assert.ok(diary.diaryUsesGenko(style));
    assert.ok(gm.padTop > m.box.top + m.box.height);             // 원고지는 그림 칸 아래에서 시작
    assert.equal(m.box.left, gm.offsetX);                        // 왼쪽 끝이 원고지 첫 칸 줄과 같다
    assert.equal(760 - m.box.left - m.box.right, gm.cols * gm.cell + 1);   // 폭은 원고지 줄 폭(끝 선 1px 포함)
  }
  assert.ok(diary.diaryUsesGenko({ lines:"genko" }));
  assert.ok(!diary.diaryUsesGenko({ lines:"ruled" }));
  assert.ok(diary.diaryGenkoMetrics({ lines:"genko", gap:"normal" }, 760).padTop < 34);   // 원고지만 쓸 땐 위 여백만
  assert.equal(diary.diaryLineMetrics({ lines:"picture", gap:"normal" }, 0).box.height, 4 * 34);   // 폭을 모를 때도 칸은 남는다
  assert.equal(diary.diaryLineMetrics({ lines:"ruled" }, 760).box, null);
});

test("돌린 스티커의 아래 끝은 돌린 뒤 상자로 잰다", () => {
  const flat = { x:0, y:0, w:0.4, ar:0.5, rot:0 };
  assert.ok(Math.abs(diary.diaryStickerBottom(flat) - 0.2) < 1e-9);
  const turned = { ...flat, rot:90 };
  assert.ok(Math.abs(diary.diaryStickerBottom(turned) - 0.3) < 1e-9);  // 가운데 0.1 + 세운 높이 0.4 의 절반
});

/* ---------- 3단계: 원고지 · 인쇄 · 영어 화면 ---------- */

const cellsOf = (lay) => lay.cells.map(c => [c.row, c.col, c.text]);

test("원고지: 한글은 한 칸에 하나, 영문·숫자는 두 자씩 한 칸", () => {
  assert.deepEqual(cellsOf(diary.diaryGenkoLayout("가나다", 10)), [[0, 0, "가"], [0, 1, "나"], [0, 2, "다"]]);
  const lay = diary.diaryGenkoLayout("abc1", 10);
  assert.deepEqual(cellsOf(lay), [[0, 0, "ab"], [0, 1, "c1"]]);
  assert.deepEqual(lay.pos[1], { row:0, col:0.5 });                 // 둘째 글자 앞 커서는 칸 한가운데
  assert.deepEqual(cellsOf(diary.diaryGenkoLayout("ab c", 10)), [[0, 0, "ab"], [0, 1, " "], [0, 2, "c"]]);
  assert.deepEqual(cellsOf(diary.diaryGenkoLayout("😊가", 10)), [[0, 0, "😊"], [0, 1, "가"]]);   // 그림 글자(서로게이트 쌍)도 한 칸
});

test("원고지: 줄이 차면 다음 줄로, Enter 는 다음 줄 첫 칸부터", () => {
  const lay = diary.diaryGenkoLayout("가나다라마", 4);
  assert.deepEqual(lay.cells[4], { row:1, col:0, start:4, end:5, text:"마" });
  assert.equal(lay.rows, 2);
  assert.deepEqual(cellsOf(diary.diaryGenkoLayout("가\n나", 4)), [[0, 0, "가"], [1, 0, "나"]]);
  assert.deepEqual(diary.diaryGenkoLayout("가\n", 4).pos[2], { row:1, col:0 });
});

test("원고지: 줄 끝에 온 문장부호는 끝 칸 옆 여백에 붙고, 빈칸은 새 줄 첫 칸을 비우지 않는다", () => {
  const hang = diary.diaryGenkoLayout("가나다라.마", 4);
  assert.equal(hang.cells[3].hang, ".");
  assert.deepEqual(hang.pos[4], { row:0, col:4 });
  assert.deepEqual(hang.cells[4], { row:1, col:0, start:5, end:6, text:"마" });
  const space = diary.diaryGenkoLayout("가나다라 마", 4);
  assert.equal(space.cells.length, 5);
  assert.equal(space.cells[3].hang, undefined);                     // 빈칸은 그리지 않는다
  assert.deepEqual(space.cells[4], { row:1, col:0, start:5, end:6, text:"마" });
});

test("원고지: 누른 자리에서 가장 가까운 글자 앞으로 커서가 간다", () => {
  const lay = diary.diaryGenkoLayout("가나다라마", 4);
  assert.equal(diary.diaryGenkoIndexAt(lay, 0, 2.4), 2);
  assert.equal(diary.diaryGenkoIndexAt(lay, 0, 2.6), 3);
  assert.equal(diary.diaryGenkoIndexAt(lay, 1, 0), 4);
  assert.equal(diary.diaryGenkoIndexAt(lay, 1, 3), 5);              // 줄 끝 너머 → 글 끝
  assert.equal(diary.diaryGenkoIndexAt(lay, 7, 0), 5);              // 없는 줄 → 글 끝
});

test("원고지 칸 수는 종이 폭에서 여백을 빼고 칸 크기로 나눈다", () => {
  const gm = diary.diaryGenkoMetrics({ gap:"normal" }, 780);
  assert.equal(gm.cell, 34);
  assert.equal(gm.cols, Math.floor((780 - 64) / 34));
  assert.equal(gm.pitch, 34 + Math.round(34 * 0.32));
  assert.ok(gm.offsetX >= 32 - 1);
  assert.ok(diary.DIARY_LINES.includes("genko"));
  assert.equal(diary.diaryNormalizeStyle({ lines:"genko" }).lines, "genko");
});

test("화면 글자는 사전이 없을 때 한국어 그대로, 틀 글자는 값을 채운다", () => {
  assert.equal(diary.diaryTf("사진 {n}장", { n:3 }), "사진 3장");
  assert.equal(diary.diaryT("오늘"), "오늘");
  assert.equal(diary.diaryUiMonthLabel(2026, 8), "2026년 9월");
  assert.equal(diary.diaryUiWeekday(0), "일");
});

test("일기장 화면 글자는 모두 영어 사전(i18n.js)에 있다", () => {
  const src = read("src/js/diary.js");
  const i18n = read("src/js/i18n.js");
  const keys = new Set();
  // 앞부분(정규식) 뒤에 한글이 든 "문자열"이 오는 자리를 모두 모은다.
  const lit = /"([^"\n]*[가-힣][^"\n]*)"/.source;
  const grab = (before) => { for (const m of src.matchAll(new RegExp(before.source + lit, "g"))) keys.add(m[1]); };
  grab(/diaryTf?\(/);                                              // 그때그때 고르는 글자
  grab(/diaryButton\(/);                                           // 단추 글자
  grab(/diaryButton\((?:"[^"]*"|diaryT\([^)]*\)), /);              // 단추 설명
  grab(/(?:placeholder|title) = /);
  grab(/setAttribute\("aria-label", /);
  grab(/textContent = /);
  grab(/section\(/);                                               // 꾸미기 창 제목
  keys.delete("가나다");                                                        // 글꼴 견본은 한글 그대로
  assert.ok(keys.size > 50, "뽑은 글자가 너무 적다: " + keys.size);
  const missing = [...keys].filter(k => !i18n.includes(JSON.stringify(k) + ":"));
  assert.deepEqual(missing, []);
});

/* ---------- 그림 칸 그리기 ---------- */

/* ---------- 내장 스티커(그림) · 글상자 ---------- */

test("내장 그림 스티커는 이름·색·투명도를 저장하고, 모르는 이름은 버린다", () => {
  const ok = diary.diaryNormalizeSticker({ kind:"art", art:"heart", color:"#EF4444", x:0.2, y:0.3, w:0.25 });
  assert.equal(ok.kind, "art");
  assert.equal(ok.art, "heart");
  assert.equal(ok.color, "#ef4444");                       // 색은 소문자로 모은다
  assert.equal(ok.opacity, 1);                              // 옛 파일은 완전 불투명
  assert.equal(diary.diaryNormalizeSticker({ kind:"art", art:"heart", opacity:0.35 }).opacity, 0.35);
  assert.equal(diary.diaryNormalizeSticker({ kind:"art", art:"heart", opacity:0 }).opacity, 0.1);
  assert.equal(ok.asset, undefined);                       // 사진 바이트를 가리키지 않는다
  assert.equal(ok.ar, diary.diaryArtInfo("heart")[3]);     // 높이는 그림 본래 비율이 기본
  assert.equal(diary.diaryNormalizeSticker({ kind:"art", art:"없는그림" }), null);
  assert.equal(diary.diaryNormalizeSticker({ kind:"art", art:"heart", color:"red; background:url(x)" }).color, diary.DIARY_ART_DEFAULT_COLOR);
});

test("모든 내장 그림은 이름·영어 이름·그릴 SVG 를 갖춘다", () => {
  assert.equal(diary.DIARY_ART.length, 144, "내장 그림 스티커 수");
  assert.equal(new Set(diary.DIARY_ART_IDS).size, diary.DIARY_ART.length);      // id 가 겹치지 않는다
  for (const [id, ko, en, ar, body] of diary.DIARY_ART){
    assert.match(id, /^[a-z]+$/, id);
    assert.ok(ko && en && ko !== en, id);
    assert.ok(ar > 0.05 && ar <= 2, id + " 비율: " + ar);
    assert.ok(body.startsWith("<"), id);
    const svg = diary.diaryArtSvg(id);
    assert.match(svg, /^<svg class="diary-art" viewBox="0 0 100 \d+"/, id);
    assert.ok(svg.includes(body), id);
  }
  assert.equal(diary.diaryArtSvg("없는그림"), "");
});

test("144개 스티커는 작은 타일로 12칸씩 배치한다", () => {
  const css = read("src/styles.css");
  assert.match(css, /\.diary-style-controls\.diary-art-grid\{[^}]*display:grid;grid-template-columns:repeat\(12,minmax\(0,1fr\)\);gap:3px/);
  assert.match(css, /\.diary-art-chip\{[^}]*padding:2px/);
});

test("글상자는 글·글자 크기·맞춤을 저장하고 높이(ar)는 저장하지 않는다", () => {
  const crlf = String.fromCharCode(13, 10), lf = String.fromCharCode(10);
  const s = diary.diaryNormalizeSticker({ kind:"text", text:"오늘 최고!" + crlf + "둘째 줄", size:0.06, align:"center", font:"pen" });
  assert.equal(s.kind, "text");
  assert.equal(s.text, "오늘 최고!" + lf + "둘째 줄");        // 줄 끝은 한 가지로 모은다
  assert.equal(s.align, "center");
  assert.equal(s.font, "pen");
  // 높이는 글에서 나오므로 저장 모양에는 없다 — 있으면 창 폭에 따라 잰 값이 달라져 안 고친 일기장이 '저장 안 됨'이 된다.
  const clean = diary.diaryCleanSticker({ ...s, ar:3.14 });
  assert.equal(clean.ar, undefined);
  assert.equal(clean.flip, false);                              // 거울 글씨가 되지 않게 뒤집기는 늘 꺼 둔다
  assert.equal(diary.diaryNormalizeSticker({ kind:"text", text:"   " }), null);   // 빈 글상자는 남기지 않는다
  assert.equal(diary.diaryNormalizeSticker({ kind:"text", text:"가".repeat(diary.DIARY_TEXT_MAX + 50) }).text.length, diary.DIARY_TEXT_MAX);
});

test("kind 가 없던 옛 스티커는 사진으로 읽고, 갈래는 필드로도 가른다", () => {
  assert.equal(diary.diaryStickerKind({ asset:"assets/a000.png" }), "photo");
  assert.equal(diary.diaryStickerKind({ art:"heart" }), "art");
  assert.equal(diary.diaryStickerKind({ text:"안녕" }), "text");
  assert.equal(diary.diaryStickerKind({ kind:"이상한값", asset:"assets/a000.png" }), "photo");
});

test("세 갈래 스티커를 저장했다 열면 그대로고, 사진 바이트는 사진만 챙긴다", async () => {
  const model = diary.diaryEmpty("꾸민 일기");
  model.entries.push(diary.diaryNormalizeEntry({ date:"2026-09-20", text:"", stickers:[
    { id:"st-p", asset:"assets/st000009.png", x:0.1, y:0.1, w:0.3, ar:0.75 },
    { id:"st-a", kind:"art", art:"star", color:"#3b82f6", opacity:0.35, x:0.5, y:0.2, w:0.2, rot:15 },
    { id:"st-t", kind:"text", text:"좋은 하루", color:"#1f2937", opacity:0.6, size:0.05, align:"right", x:0.2, y:0.8, w:0.5 }
  ] }, () => true));
  // 저장에 담을 사진은 사진 스티커 하나뿐이다(내장 그림·글상자는 바이트가 없다).
  assert.deepEqual([...diary.diaryReferencedAssets(model)], ["assets/st000009.png"]);
  const bytes = diary.diaryPack(model, new Map([["assets/st000009.png", { bytes:png(7) }]]));
  assert.deepEqual([...(await diary.diaryZipRead(bytes)).keys()], ["diary.json", "assets/st000009.png"]);
  const { model:back } = await diary.diaryUnpack(bytes);
  const [photo, art, text] = back.entries[0].stickers;
  assert.equal(photo.kind, "photo");
  assert.equal(photo.asset, "assets/st000009.png");
  assert.equal(art.art, "star");
  assert.equal(art.color, "#3b82f6");
  assert.equal(art.opacity, 0.35);
  assert.equal(art.rot, 15);
  assert.equal(text.text, "좋은 하루");
  assert.equal(text.align, "right");
  assert.equal(text.opacity, 0.6);
  assert.equal(diary.diaryContentKey(back), diary.diaryContentKey(model));
});

test("글상자 높이를 재어 채워도 저장본과 같다고 본다", () => {
  const model = diary.diaryEmpty("글상자");
  model.entries.push(diary.diaryNormalizeEntry({ date:"2026-09-20", stickers:[
    { id:"st-t", kind:"text", text:"창 폭마다 높이가 달라지는 글", w:0.4 }] }, () => true));
  const before = diary.diaryContentKey(model);
  model.entries[0].stickers[0].ar = 0.37;          // 화면에서 잰 높이를 채워 넣는다(measureTextStickers 가 하는 일)
  assert.equal(diary.diaryContentKey(model), before);
});

test("글상자 글은 목록 이름과 검색에 함께 잡힌다", () => {
  const entry = diary.diaryNormalizeEntry({ date:"2026-09-20", text:"", stickers:[
    { id:"st-t", kind:"text", text:"바다에 갔다" }] }, () => true);
  assert.equal(diary.diaryStickerText(entry), "바다에 갔다");
  assert.equal(diary.diaryEntryLabel(entry), "바다에 갔다");     // 본문이 비어도 종이에 보이는 글을 쓴다
  assert.equal(diary.diaryEntryMatches(entry, "바다"), true);
  const model = diary.diaryEmpty("검색");
  model.entries.push(entry);
  assert.ok(diary.diaryPlainText(model).includes("바다에 갔다"));
});

test("사진·스티커가 섞인 날의 이름은 갈래를 나눠 센다", () => {
  const entry = diary.diaryNormalizeEntry({ date:"2026-09-20", stickers:[
    { id:"a", asset:"assets/p0001.png" }, { id:"b", asset:"assets/p0002.png" },
    { id:"c", kind:"art", art:"heart" }] }, () => true);
  assert.equal(diary.diaryEntryLabel(entry), "사진 2장 · 스티커 1개");
});

test("내장 그림·글상자만 붙인 날도 빈 날로 버리지 않는다", () => {
  for (const sticker of [{ kind:"art", art:"heart" }, { kind:"text", text:"한 줄" }]){
    const entry = diary.diaryNormalizeEntry({ date:"2026-09-20", stickers:[{ id:"x", ...sticker }] }, () => true);
    assert.equal(diary.diaryEntryIsEmpty(entry), false, JSON.stringify(sticker));
  }
});

test("내장 그림 스티커가 확장된 파일은 version 11 이고 다음 버전은 거절한다", () => {
  assert.equal(diary.DIARY_VERSION, 11);
  const json = JSON.stringify({ format:"classdock-diary", version:12, title:"미래", entries:[] });
  assert.throws(() => diary.diaryNormalize(JSON.parse(json)), /diary-version/);
});

/* ---------- 종이 배경 효과 ---------- */

test("배경 효과는 모르는 이름·색·진하기를 기본값으로 떨어뜨린다", () => {
  const base = diary.diaryDefaultStyle();
  const bad = diary.diaryNormalizeStyle({ paper:"rainbow", paperColor:"red; background:url(x)", paperTone:9 });
  assert.equal(bad.paper, "none");
  assert.equal(bad.paperColor, base.paperColor);
  assert.equal(bad.paperTone, 1);                                   // 0~1 밖은 자른다
  assert.equal(diary.diaryNormalizeStyle({ paperTone:"" }).paperTone, base.paperTone);   // Number("")=0 이 아니라 기본값
  const ok = diary.diaryNormalizeStyle({ paper:"mesh", paperColor:"#FFAA00", paperTone:0.25 });
  assert.deepEqual([ok.paper, ok.paperColor, ok.paperTone], ["mesh", "#ffaa00", 0.25]);
});

test("배경 효과 그림은 고른 색을 종이색과 섞어 그린다", () => {
  const off = diary.diaryPaperBackground({ paper:"none" });
  assert.equal(off.image, "none");
  assert.equal(off.color, "transparent");
  for (const paper of diary.DIARY_PAPERS.filter(id => id !== "none")){
    const made = diary.diaryPaperBackground({ paper, paperColor:"#ffaa00", paperTone:0.5 });
    assert.equal(made.kind, paper);
    const css = made.image + " " + made.color;
    assert.ok(css.includes("#ffaa00"), paper);                      // 고른 색이 들어 있고
    assert.ok(css.includes("var(--diary-paper)"), paper);           // 늘 종이색과 섞는다(다크 테마를 따라가게)
  }
  // 진하기를 올리면 섞는 비율이 달라진다
  const light = diary.diaryPaperBackground({ paper:"linear", paperColor:"#ffaa00", paperTone:0 });
  const dark = diary.diaryPaperBackground({ paper:"linear", paperColor:"#ffaa00", paperTone:1 });
  assert.notEqual(light.image, dark.image);
});

test("거친 질감은 그림 파일이 아니라 그려 넣은 알갱이를 타일로 깐다", () => {
  const noise = diary.diaryPaperBackground({ paper:"noise", paperColor:"#7aa7ff", paperTone:0.5 });
  assert.ok(noise.image.includes("feTurbulence"));
  assert.ok(!noise.image.includes("assets/"));                      // 자산(사진)으로 새지 않는다 — 파일 크기가 늘지 않는 이유
  assert.equal(noise.repeat, "repeat, no-repeat");
  // 유리는 인쇄에서 사라지는 backdrop-filter 를 쓰지 않는다(그림만으로 서리를 만든다)
  const glass = diary.diaryPaperBackground({ paper:"glass", paperColor:"#7aa7ff", paperTone:0.5 });
  assert.ok(!/filter/.test(glass.image));
});

test("인쇄할 땐 배경 빼기는 일기장 전체 설정이고, 저장했다 열어도 남는다", async () => {
  const model = diary.diaryEmpty("인쇄");
  assert.equal(model.printPlain, false);
  model.entries.push({ date:"2026-09-20", text:"한 줄" });
  model.printPlain = true;
  const key = diary.diaryContentKey(model);
  const { model:back } = await diary.diaryUnpack(diary.diaryPack(model, new Map()));
  assert.equal(back.printPlain, true);
  assert.equal(diary.diaryContentKey(back), key);
  // 켜고 끄는 것도 '저장 안 됨'으로 보여야 하므로 내용 열쇠에 들어간다
  model.printPlain = false;
  assert.notEqual(diary.diaryContentKey(model), key);
  assert.equal(diary.diaryNormalize(JSON.parse(diary.diaryModelJson(model))).printPlain, false);
  assert.equal(diary.diaryNormalize(JSON.parse(diary.diaryModelJson({ ...model, printPlain:"예" }))).printPlain, true);
});

test("어두운 효과는 글자·줄 색을 갈아끼우는 CSS 규칙이 화면·인쇄·견본·목록 카드에 함께 있다", () => {
  const css = read("src/styles.css");
  for (const id of diary.DIARY_PAPER_DARK){
    assert.ok(diary.DIARY_PAPERS.includes(id), id);
    for (const sel of [".diary-paper", ".diary-print-paper", ".diary-paper-sample", ".diary-entry-card-thumb"]){
      assert.ok(css.includes(`${sel}[data-paper="${id}"]`), sel + " " + id);
    }
  }
});

test("그림 획은 색·굵기·점을 걸러 담고, 이상한 값은 버리거나 기본값으로", () => {
  const ok = diary.diaryNormalizeStroke({ c:"#EF4444", w:0.012, p:[0.1, 0.2, 0.3, 0.4, 0.5], e:true });
  assert.deepEqual(ok, { c:"#ef4444", w:0.012, p:[0.1, 0.2, 0.3, 0.4], e:true });   // 홀수 개 끝점은 버린다
  const odd = diary.diaryNormalizeStroke({ c:"red; background:url(x)", w:"", p:[0.1, "a", 9, 0.2, 0.5, 0.5] });
  assert.equal(odd.c, "#1f2937");
  assert.equal(odd.w, 0.012);                                        // Number("")=0 이 아니라 기본 굵기
  assert.deepEqual(odd.p, [1.1, 0.2, 0.5, 0.5]);                     // 숫자가 아닌 점은 건너뛰고, 칸 밖 좌표는 자른다
  assert.equal(diary.diaryNormalizeStroke({ c:"#000000", p:[] }), null);
  assert.equal(diary.diaryNormalizeStroke({ c:"#000000", w:5, p:[2, 9] }).w, 0.2);   // 굵기·좌표 상한
  assert.equal(new Set(diary.DIARY_PENS.map(x => x[0])).size, diary.DIARY_PENS.length);
});

test("그림만 그린 날도 남고, 저장했다 열면 획이 그대로다", async () => {
  const model = diary.diaryEmpty("그림");
  model.style = diary.diaryNormalizeStyle({ lines:"picture" });
  const drawing = [{ c:"#3b82f6", w:0.024, p:[0.1, 0.1, 0.5, 0.3, 0.9, 0.2] }, { c:"#3b82f6", w:0.03, p:[0.5, 0.3], e:true }];
  model.entries.push({ date:"2026-09-20", title:"", text:"", style:null, weather:"", mood:"", drawing, stickers:[] });
  assert.equal(diary.diaryEntryIsEmpty(model.entries[0]), false);
  const { model:back } = await diary.diaryUnpack(diary.diaryPack(model, new Map()));
  assert.equal(back.version, diary.DIARY_VERSION);
  assert.deepEqual(back.entries[0].drawing, drawing);
  assert.equal(diary.diaryContentKey(back), diary.diaryContentKey(model));
});

test("지우개 획은 이 캔버스만 지우고(destination-out) 다음 획은 다시 보통으로 그린다", () => {
  const ops = [];
  const ctx = new Proxy({}, {
    set(target, key, value){ if (key === "globalCompositeOperation") ops.push(value); target[key] = value; return true; },
    get(target, key){ return key in target ? target[key] : () => {}; }
  });
  diary.diaryDrawStrokes(ctx, [
    { c:"#000000", w:0.01, p:[0, 0, 1, 1] },
    { c:"#000000", w:0.03, p:[0.5, 0.5], e:true },
    { c:"#ef4444", w:0.01, p:[0, 1, 1, 0, 0.5, 0.5] }
  ], 500);
  assert.deepEqual(ops, ["source-over", "destination-out", "source-over", "source-over"]);
});

/* ---------- 손글씨 글꼴 ---------- */

test("손글씨 글꼴(펜·붓)을 고를 수 있고, 글자는 조금 키우되 줄 간격은 그대로다", () => {
  for (const id of ["pen", "brush"]){
    assert.ok(diary.DIARY_FONTS.includes(id));
    assert.equal(diary.diaryNormalizeStyle({ font:id }).font, id);
    assert.ok(diary.DIARY_FONT_STACKS[id].includes(diary.DIARY_HAND_FONTS[id].family));
    const plain = diary.diaryLineMetrics({ lines:"ruled", gap:"normal" });
    const hand = diary.diaryLineMetrics({ lines:"ruled", gap:"normal", font:id });
    assert.equal(hand.gap, plain.gap);
    assert.ok(hand.fontSize > plain.fontSize);
    const cell = diary.diaryGenkoMetrics({ lines:"genko", gap:"normal", font:id }, 700);
    assert.ok(cell.fontSize < cell.cell);                           // 원고지 칸 밖으로 넘치지 않는다
  }
  assert.equal(diary.diaryFontScale("gothic"), 1);
});

test("손글씨 글꼴 파일은 지연 로드 묶음·라이선스와 함께 들어 있다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json"));
  const lazy = require("../src/js/lazy.js");
  for (const [id, info] of Object.entries(diary.DIARY_HAND_FONTS)){
    const bundle = lazy.BUNDLES[info.bundle];
    assert.ok(bundle, info.bundle);
    const file = bundle.files[0];
    const entry = manifest.vendorScripts.find(item => item.file === file);
    assert.ok(entry && entry.lazy === info.bundle, file);
    const head = read("vendor/" + file).slice(0, 600);
    assert.ok(head.includes("__MN_HANDFONT." + id + " = \"d09GMg"), file);   // WOFF2 서명(wOF2)의 base64
    assert.match(head, /SIL OFL 1\.1/);
  }
  assert.match(read("vendor/licenses/nanum-handwriting-OFL.txt"), /SIL OPEN FONT LICENSE Version 1\.1/);
});

/* ---------- 스티커 여러 장 고르기 ---------- */

test("여러 장 앞뒤 순서: 고른 것끼리 순서는 지키고 함께 옮긴다", () => {
  const list = ["a", "b", "c", "d", "e"].map(id => ({ id }));
  const ids = (arr) => arr.map(s => s.id).join("");
  const picked = new Set(["b", "d"]);
  assert.equal(ids(diary.diaryReorder(list, picked, "front")), "acebd");
  assert.equal(ids(diary.diaryReorder(list, picked, "back")), "bdace");
  assert.equal(ids(diary.diaryReorder(list, picked, "forward")), "acbed");
  assert.equal(ids(diary.diaryReorder(list, picked, "backward")), "badce");
  // 이미 맨 앞에 붙어 있으면 그대로(한 덩어리)
  assert.equal(ids(diary.diaryReorder(list, new Set(["d", "e"]), "forward")), "abcde");
  assert.equal(ids(diary.diaryReorder(list, new Set(["a", "b"]), "backward")), "abcde");
  assert.equal(ids(list), "abcde");                                  // 원래 배열은 건드리지 않는다
});

/* ---------- 원고지 한 줄 칸 수 ---------- */

test("원고지 칸 수를 정하면 폭이 달라도 칸 수는 같고, 칸 크기만 폭에 맞춘다", () => {
  for (const n of diary.DIARY_GENKO_COLS.filter(Boolean)){
    for (const width of [680, 780, 1000]){
      const gm = diary.diaryGenkoMetrics({ lines:"genko", genkoCols:n }, width);
      assert.equal(gm.cols, n);
      assert.ok(gm.cols * gm.cell <= width - 64);                  // 좌우 여백 안에 들어온다
      assert.ok(gm.fontSize < gm.cell);
    }
  }
  // 칸 수가 같으면 줄바꿈 자리도 같다(화면 폭과 인쇄 폭이 달라도)
  const text = "가".repeat(25);
  const a = diary.diaryGenkoLayout(text, diary.diaryGenkoMetrics({ genkoCols:10 }, 780).cols);
  const b = diary.diaryGenkoLayout(text, diary.diaryGenkoMetrics({ genkoCols:10 }, 680).cols);
  assert.deepEqual(a.cells.map(c => [c.row, c.col]), b.cells.map(c => [c.row, c.col]));
  assert.equal(a.rows, 3);
  // 자동은 예전처럼 줄 간격 크기의 칸
  assert.equal(diary.diaryGenkoMetrics({ genkoCols:0, gap:"wide" }, 780).cell, 42);
});

test("큰 칸을 골라도 한 쪽 길이는 줄 간격으로 재고, 그림일기 칸은 원고지 줄 끝에 맞는다", () => {
  const big = diary.diaryGenkoMetrics({ lines:"genko", genkoCols:8, gap:"normal" }, 780);
  const auto = diary.diaryGenkoMetrics({ lines:"genko", genkoCols:0, gap:"normal" }, 780);
  assert.equal(big.pageH, auto.pageH);
  const style = { lines:"picture", genkoCols:10, gap:"normal" };
  const box = diary.diaryLineMetrics(style, 780).box;
  const gm = diary.diaryGenkoMetrics(style, 780);
  assert.equal(box.left, gm.offsetX);
  assert.equal(780 - box.left - box.right, gm.cols * gm.cell + 1);
  assert.equal(diary.diaryNormalizeStyle({ genkoCols:"10" }).genkoCols, 10);
  assert.equal(diary.diaryNormalizeStyle({ genkoCols:7 }).genkoCols, 0);   // 목록에 없는 칸 수는 자동
});


/* ---------- 저장·사진 처리 중 편집 회귀 ---------- */
function diaryDeferred(){
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function diarySaveHarness(overrides){
  const ctx = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, crypto:globalThis.crypto, console,
    markDocumentDirty:(doc, dirty) => { doc.hasUnsavedEdits = dirty; },
    ...overrides
  });
  vm.runInContext(read("src/js/diary.js"), ctx);
  const model = diary.diaryEmpty("저장 시험");
  model.entries.push(diary.diaryNormalizeEntry({ date:"2026-09-18", text:"저장 전" }));
  const doc = { diary:model, diaryAssets:new Map(), name:"test.diary", hasUnsavedEdits:true };
  return { doc, save:vm.runInContext("saveDiary", ctx) };
}

test("저장·작업공간 갱신 중 입력은 미저장으로 남고 재저장하면 보존된다", async () => {
  const disk = diaryDeferred(), workspace = diaryDeferred(), enteredWorkspace = diaryDeferred();
  let bytes, first = true;
  const { doc, save } = diarySaveHarness({
    saveTextDoc:async (value, target) => {
      bytes = value;
      if (first) await disk.promise;
      target.savedText = value;  // 공용 저장 함수가 바이트를 임시로 기록하는 동작도 재현
      return true;
    },
    markDocumentSavedSnapshot:async target => {
      enteredWorkspace.resolve();
      if (first) await workspace.promise;
      target.hasUnsavedEdits = false;
    }
  });
  const expectedKey = diary.diaryContentKey(doc.diary);
  const saving = save(doc);
  doc.diary.entries[0].text = "디스크 저장 중 입력";
  assert.equal(await save(doc), false);    // 중복 저장이 앞선 저장 기준을 덮어쓰지 않는다
  disk.resolve();
  await enteredWorkspace.promise;
  doc.diary.entries[0].text = "작업공간 갱신 중 입력";
  workspace.resolve();
  assert.equal(await saving, true);
  assert.equal((await diary.diaryUnpack(bytes)).model.entries[0].text, "저장 전");
  assert.equal(doc.savedText, expectedKey);
  assert.equal(doc.hasUnsavedEdits, true);
  first = false;
  assert.equal(await save(doc), true);
  assert.equal((await diary.diaryUnpack(bytes)).model.entries[0].text, "작업공간 갱신 중 입력");
  assert.equal(doc.hasUnsavedEdits, false);
});

test("암호 상태로 저장하면 디스크 바이트도 암호 봉투이고 보안 변경이 저장 기준에 포함된다", async () => {
  let written = null, snapshot = null;
  const { doc, save } = diarySaveHarness({
    saveTextDoc:async (bytes) => { written = bytes; return true; },
    markDocumentSavedSnapshot:async (_doc, bytes) => { snapshot = bytes; return true; }
  });
  doc.diaryProtection = await diary.diaryDeriveProtection("save-password-2026", null, 1000);
  doc.diarySecurityRevision = 1;
  doc.savedDiarySecurityRevision = 0;
  assert.equal(await save(doc), true);
  assert.equal(diary.diaryIsEncrypted(written), true);
  assert.equal(diary.diaryIsEncrypted(snapshot), true);
  assert.equal(doc.savedDiarySecurityRevision, 1);
  assert.equal(doc.hasUnsavedEdits, false);
  const opened = await diary.diaryOpenSealed(written, "save-password-2026");
  assert.equal((await diary.diaryUnpack(opened.bytes)).model.entries[0].text, "저장 전");
});
test("저장을 취소하거나 실패해도 다음 저장을 할 수 있다", async () => {
  let attempt = 0;
  const { doc, save } = diarySaveHarness({
    saveTextDoc:async () => {
      attempt++;
      if (attempt === 1) return false;
      if (attempt === 2) throw new Error("write failed");
      return true;
    }
  });
  const originalKey = doc.savedText;
  assert.equal(await save(doc), false);
  assert.equal(doc.savedText, originalKey);
  assert.equal(doc.hasUnsavedEdits, true);
  await assert.rejects(save(doc), /write failed/);
  assert.equal(await save(doc), true);
  assert.equal(doc.hasUnsavedEdits, false);
});

function diaryStickerHarness(){
  const pending = [];
  let id = 0, commits = 0;
  const ctx = vm.createContext({
    current:"2026-09-18", model:{ entries:[] }, paperWidth:600,
    paper:{ clientWidth:600, getBoundingClientRect:() => ({ top:0, height:600 }) }, selection:[], deleteBtn:{ disabled:true },
    DIARY_MAX_STICKERS:80, DIARY_STICKER_MAX_DIM:1200, DIARY_TEXT_MAX:diary.DIARY_TEXT_MAX,
    DIARY_ART_DEFAULT_COLOR:diary.DIARY_ART_DEFAULT_COLOR, DIARY_TEXT_DEFAULT_COLOR:diary.DIARY_TEXT_DEFAULT_COLOR,
    DIARY_FONT_STACKS:diary.DIARY_FONT_STACKS, DIARY_HAND_FONTS:diary.DIARY_HAND_FONTS,
    diaryArtInfo:diary.diaryArtInfo, diaryArtName:diary.diaryArtName, diaryStickerKind:diary.diaryStickerKind,
    diaryNormalizeAngle:diary.diaryNormalizeAngle, diaryArrangeStickers:diary.diaryArrangeStickers, diaryArrangeInBox:diary.diaryArrangeInBox,
    clampStickerPos:(s) => { s.x = Math.max(-s.w * 0.6, Math.min(1 - s.w * 0.4, s.x)); s.y = Math.max(-0.02, s.y); },
    diaryEffectiveStyle:diary.diaryEffectiveStyle, diaryEnsureFont:() => Promise.resolve(true),
    main:{ getBoundingClientRect:() => ({ top:0, height:600 }) },
    stickerLayer:{ querySelector:() => null, children:[] }, selectedStickers:() => [],
    pictureBoxRect:() => ({ left:32, top:34, width:536, height:330 }),
    diaryT:value => value, diaryTf:value => value, setStatus:() => {},
    diaryStickerId:() => "st-test-" + (++id),
    renderStickers:() => {}, layout:() => {}, renderCalendar:() => {}, refreshDirty:() => {},
    touch:() => { commits++; }, history:{ flush:() => {} },
    addAsset:() => { const task = diaryDeferred(); pending.push(task); return task.promise; }
  });
  ctx.entryOf = key => ctx.model.entries.find(e => e.date === key) || null;
  ctx.ensureEntry = key => {
    let entry = ctx.model.entries.find(e => e.date === key);
    if (!entry){ entry = diary.diaryNormalizeEntry({ date:key }); ctx.model.entries.push(entry); }
    return entry;
  };
  const source = read("src/js/diary.js");
  const fitStart = source.indexOf("  function fitStickerToBox(");
  const addStart = source.indexOf("  async function addStickers(");
  vm.runInContext(source.slice(fitStart, source.indexOf("  function openStickerMenu", fitStart))
    + source.slice(addStart, source.indexOf("  /* ----- 꾸미기 바꾸기", addStart)), ctx);
  return { ctx, pending, commits:() => commits, add:vm.runInContext("addStickers", ctx) };
}

test("여러 사진 처리 중 날짜·폭·모델이 바뀌어도 시작 날짜에 한 번에 붙인다", async () => {
  const h = diaryStickerHarness();
  h.ctx.ensureEntry(h.ctx.current);
  const adding = h.add([{ type:"image/png" }, { type:"image/png" }], { x:300, y:180 }, true);
  // goTo 는 빈 날짜를 지운다. 새 날짜의 선택 상태와 그림 칸도 바뀐다.
  h.ctx.model.entries = h.ctx.model.entries.filter(e => !diary.diaryEntryIsEmpty(e));
  h.ctx.current = "2026-09-19";
  h.ctx.selection = ["other-day-sticker"];
  h.ctx.paperWidth = 900;
  h.ctx.pictureBoxRect = () => ({ left:50, top:50, width:800, height:500 });
  h.pending[0].resolve({ name:"assets/test1.png", w:600, h:400 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ctx.model.entries.length, 0);   // 아직 준비 중인 묶음은 일부만 반영하지 않는다
  // 되돌리기도 entry 객체를 교체할 수 있다.
  h.ctx.model.entries = [diary.diaryNormalizeEntry({ date:"2026-09-18", text:"남겨 둘 글" })];
  h.pending[1].resolve({ name:"assets/test2.png", w:600, h:400 });
  await adding;
  const entry = h.ctx.model.entries[0];
  assert.equal(entry.date, "2026-09-18");
  assert.equal(entry.text, "남겨 둘 글");
  assert.equal(entry.stickers.length, 2);
  // 두 장은 그림 칸을 나눠 쓴다 — 크기·자리는 시작 당시 600px 폭과 330px 그림 칸으로 잰다(나중에 바뀐 900px 이 아니다).
  assert.ok(Math.abs(entry.stickers[0].w - 0.42793) < 0.0001);
  assert.ok(Math.abs(entry.stickers[1].w - 0.42793) < 0.0001);
  assert.equal(entry.stickers[0].y.toFixed(3), entry.stickers[1].y.toFixed(3));      // 같은 줄에 나란히
  assert.ok(entry.stickers[1].x > entry.stickers[0].x);
  assert.equal(h.ctx.selection[0], "other-day-sticker");
  assert.equal(h.commits(), 1);
});

test("사진 처리 중 다른 작업이 사진을 채워도 한 날 80장 제한을 지킨다", async () => {
  const h = diaryStickerHarness();
  const adding = h.add([{ type:"image/png" }], { x:300, y:180 });
  const entry = h.ctx.ensureEntry(h.ctx.current);
  entry.stickers = Array.from({ length:80 }, (_, i) => ({ id:"existing-" + i }));
  h.pending[0].resolve({ name:"assets/test1.png", w:600, h:400 });
  await adding;
  assert.equal(entry.stickers.length, 80);
  assert.equal(h.commits(), 0);
});

test("20만 자를 넘는 본문과 경계의 이모지도 저장·복구할 때 잘리지 않는다", async () => {
  const text = "가".repeat(199999) + "😊\n마지막 문장";
  const model = diary.diaryEmpty("긴 일기");
  model.entries.push(diary.diaryNormalizeEntry({ date:"2026-09-18", text }));
  assert.equal(model.entries[0].text, text);
  const unpacked = await diary.diaryUnpack(diary.diaryPack(model, new Map()));
  assert.equal(unpacked.model.entries[0].text, text);
  assert.equal(diary.diaryContentKey(unpacked.model), diary.diaryContentKey(model));
});

/* ---------- 사진 여러 장 정렬 ---------- */

const arrangeList = (n, ar) => Array.from({ length:n }, (_, i) => ({ id:"s" + i, ar, w:0.3, x:0.5, y:0.5 }));

test("줄 맞춰 깔기: 꽉 찬 줄은 쓸 폭을 정확히 채우고, 마지막 줄은 늘리지 않는다", () => {
  const places = diary.diaryArrangeStickers(arrangeList(3, 0.75), "row", { top:0.05 });
  assert.equal(places.length, 3);
  // 한 줄에 셋 — 왼쪽 0.04 에서 시작해 오른쪽 0.96 에서 끝난다(가운데 틈 0.02 씩).
  assert.ok(Math.abs(places[0].x - 0.04) < 1e-9);
  assert.ok(Math.abs(places[2].x + places[2].w - 0.96) < 1e-9);
  assert.equal(new Set(places.map(p => p.y.toFixed(6))).size, 1);
  assert.equal(new Set(places.map(p => p.w.toFixed(6))).size, 1);     // 같은 비율이면 같은 크기
  // 두 장뿐이면 종이 폭을 다 먹지 않는다 — 정렬이 확대가 되어서는 안 된다.
  const two = diary.diaryArrangeStickers(arrangeList(2, 0.75), "row", { top:0.05 });
  assert.ok(two[1].x + two[1].w < 0.9);
  assert.ok(Math.abs(two[0].w * two[0].ar - diary.DIARY_ARRANGE_ROW_H) < 1e-9);
});

test("줄 맞춰 깔기: 장수가 많으면 줄을 바꾸고, 돌려 놓았던 것은 똑바로 세운다", () => {
  const list = arrangeList(8, 0.75).map(s => ({ ...s, rot:20 }));
  const places = diary.diaryArrangeStickers(list, "row", { top:0.1 });
  const rows = [...new Set(places.map(p => p.y.toFixed(6)))];
  assert.ok(rows.length >= 3, "여러 줄로 나뉜다");
  assert.ok(Number(rows[0]) < Number(rows[1]));                       // 위에서 아래로
  assert.ok(Math.abs(Number(rows[0]) - 0.1) < 1e-9);                  // 준 top 에서 시작
  assert.ok(places.every(p => p.rot === 0));
  assert.deepEqual(places.map(p => p.id), list.map(s => s.id));       // 쌓는 순서 그대로
});

test("격자로 깔기: 열 수를 주면 그 열로, 안 주면 장수로 정한다", () => {
  const three = diary.diaryArrangeStickers(arrangeList(6, 0.75), "grid", { top:0, cols:3 });
  assert.equal(new Set(three.map(p => p.x.toFixed(6))).size, 3);
  assert.equal(new Set(three.map(p => p.y.toFixed(6))).size, 2);
  assert.equal(diary.diaryArrangeAutoCols(3), 2);
  assert.equal(diary.diaryArrangeAutoCols(9), 3);
  assert.equal(diary.diaryArrangeAutoCols(20), 4);
  // 세로 사진과 가로 사진이 섞이면 폭을 맞추고 줄 안에서 세로 가운데에 놓는다.
  const mixed = diary.diaryArrangeStickers([{ id:"a", ar:1.5 }, { id:"b", ar:0.5 }], "grid", { top:0, cols:2 });
  assert.equal(mixed[0].w.toFixed(6), mixed[1].w.toFixed(6));
  assert.ok(mixed[1].y > mixed[0].y);
  assert.ok(Math.abs((mixed[0].y + mixed[0].w * 1.5 / 2) - (mixed[1].y + mixed[1].w * 0.5 / 2)) < 1e-9);
});

test("사진첩처럼 깔기: 같은 입력이면 늘 같은 자리·같은 기울기다(무작위 금지)", () => {
  const once = diary.diaryArrangeStickers(arrangeList(4, 0.75), "scatter", { top:0.05 });
  const again = diary.diaryArrangeStickers(arrangeList(4, 0.75), "scatter", { top:0.05 });
  assert.deepEqual(once, again);
  assert.ok(once.some(p => p.rot !== 0));
  assert.ok(once.every(p => Math.abs(p.rot) <= 6));
  // 격자보다 촘촘해 서로 조금 겹친다(사진첩에 붙인 느낌).
  const grid = diary.diaryArrangeStickers(arrangeList(4, 0.75), "grid", { top:0.05, cols:2 });
  assert.ok(once[0].w > grid[0].w);
});

test("그림 칸 나눠 맞추기: 칸을 넘지 않고, 한 장은 예전처럼 칸을 꽉 채운다", () => {
  const box = { left:0.05, top:0.03, width:0.9, height:0.5 };
  for (const [n, ar] of [[2, 0.75], [3, 0.75], [5, 1.33], [6, 0.6]]){
    const places = diary.diaryArrangeInBox(arrangeList(n, ar), box);
    assert.equal(places.length, n);
    for (const p of places){
      assert.ok(p.x >= box.left - 1e-9 && p.x + p.w <= box.left + box.width + 1e-9, "가로로 칸을 넘지 않는다 " + n);
      assert.ok(p.y >= box.top - 1e-9 && p.y + p.w * p.ar <= box.top + box.height + 1e-9, "세로로 칸을 넘지 않는다 " + n);
    }
  }
  // 칸이 납작하면 한 줄로, 길쭉하면 한 열로 — 어느 쪽이 큰지는 칸 모양에 달렸다.
  const wide = diary.diaryArrangeInBox(arrangeList(3, 1), { left:0, top:0, width:1, height:0.2 });
  assert.equal(new Set(wide.map(p => p.y.toFixed(6))).size, 1);
  const tall = diary.diaryArrangeInBox(arrangeList(3, 1), { left:0, top:0, width:0.2, height:1 });
  assert.equal(new Set(tall.map(p => p.y.toFixed(6))).size, 3);
  assert.deepEqual(diary.diaryArrangeInBox([], box), []);
  assert.deepEqual(diary.diaryArrangeInBox(arrangeList(2, 1), null), []);
});

test("정렬 기능은 우클릭 메뉴·여러 장 붙이기·그림 칸에 모두 걸려 있다", () => {
  const source = read("src/js/diary.js");
  assert.match(source, /정렬해서 깔기[\s\S]{0,400}arrangePhotos\("row"\)/);
  assert.match(source, /arrangePhotos\("grid", \{ cols \}\)/);
  assert.match(source, /arrangePhotos\("scatter"\)/);
  // 여러 장을 한꺼번에 넣으면 계단식으로 겹쳐 쌓지 않고 곧바로 줄 맞춰 깐다.
  assert.ok(source.includes("if (fresh.length && fit){"));                        // 그림 칸에 넣으면 칸을 나눠 맞추고
  assert.ok(source.includes('diaryArrangeStickers(fresh, "row", { top })'));      // 그 밖에는 곧바로 줄 맞춰 깐다
  // 고르지 않고 정렬하면 '사진만' 손댄다 — 꾸미려고 흩뿌려 둔 그림 스티커를 격자로 끌어오면 안 된다.
  assert.match(source, /function arrangeTargets\(\)\{[\s\S]{0,200}entry\.stickers\.filter\(s => diaryStickerKind\(s\) === "photo"\)/);
  // 그림 칸을 나눌 때도 같은 규칙(칸 안의 그림 스티커는 그대로 둔다)
  assert.match(source, /stickersInBox\(entryOf\(targetDate\), targetBox, w\)\s*\n\s*\.filter\(s => diaryStickerKind\(s\) === "photo" && !fresh\.includes\(s\)\)/);
  assert.match(source, /stickersInBox\(entryOf\(targetDate\), targetBox, w\)/);   // 칸에 이미 든 사진까지 함께 나눈다
  assert.match(source, /pictureInput\.multiple = true/);
  // 겹친 것 고르기·크게 보기
  assert.match(source, /e\.altKey[\s\S]{0,200}cycleStickerAt\(e\)/);
  assert.match(source, /dblclick[\s\S]{0,120}openPhotoViewer/);
  assert.match(source, /window\.openImageLightbox/);
  const css = read("src/styles.css");
  assert.match(css, /\.diary-entry-card-thumb\[data-photos="3"\] img:nth-child\(3\)/);   // 카드 썸네일 모자이크
  assert.match(css, /\.diary-photo-grid\{/);                                            // 사진만 모아 보기
  assert.match(css, /\.diary-side-tabs\{display:grid;grid-template-columns:repeat\(4,1fr\)/);  // 탭이 넷
});

test("붙이는 사진은 긴 변 1200px 로 줄여 담는다(배경 그림만 2400px)", () => {
  const source = read("src/js/diary.js");
  // 하루에 여러 장을 남기는 일기장에서는 이 수가 곧 파일 크기다 — 저장할 때마다 ZIP 전체를 다시 쓴다.
  assert.match(source, /const DIARY_STICKER_MAX_DIM = 1200;/);
  assert.match(source, /const DIARY_BG_MAX_DIM = 2400;/);
  assert.match(source, /addAsset\(blob, DIARY_STICKER_MAX_DIM\)/);
  assert.match(source, /addAsset\(file, DIARY_BG_MAX_DIM\)/);
  assert.ok(read("사용법.md").includes("긴 쪽 1200픽셀"));        // 문서와 코드가 같은 수를 말한다
});
