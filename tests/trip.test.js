"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const diary = require("../src/js/diary.js");

/* trip.js 는 ZIP·해시·스티커 정규화를 일기장 것에 기댄다(브라우저에서는 둘 다 전역이다).
   Node 에서도 같은 모양이 되도록 일기장 전역을 먼저 깔고 불러온다. */
for (const name of ["diaryCrc32", "diaryZipBuild", "diaryZipRead", "diaryNormalizeSticker", "diaryNormalizeStroke",
  "diaryNormalizeStyle", "diaryNormalizeTags", "diaryCleanSticker", "diaryDefaultStyle", "diaryWeatherInfo",
  "diaryMoodInfo", "diaryStickerKind", "diaryNormalizeAngle", "DIARY_ART_DEFAULT_COLOR", "DIARY_TEXT_DEFAULT_COLOR",
  "DIARY_MAX_STROKES", "DIARY_MAX_STICKERS"]) {
  if (diary[name] !== undefined) globalThis[name] = diary[name];
}
const trip = require("../src/js/trip.js");
const documentTypes = require("../src/js/document-types.js");

const read = rel => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const jpg = seed => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, seed + 1, seed + 2, seed + 3]);

/* ---------- 갈래 라벨 표 ---------- */

test("라벨 표는 한국어·영어가 같은 키를 갖고, 줄마다 세 갈래가 다 있다", () => {
  const ko = Object.keys(trip.TRIP_WORDS).sort();
  const en = Object.keys(trip.TRIP_WORDS_EN).sort();
  assert.deepEqual(en, ko, "영어 표에 빠진 낱말이 있으면 첫 갈래 말이 새어 나온다");
  for (const id of ko) {
    assert.equal(trip.TRIP_WORDS[id].length, 3, id + " 한국어");
    assert.equal(trip.TRIP_WORDS_EN[id].length, 3, id + " 영어");
  }
});

test("빈 문자열은 '그 갈래에서 감춤'이다", () => {
  assert.equal(trip.tripWord("trip", "cost"), "쓴 돈");
  assert.equal(trip.tripWord("field", "cost"), "");
  assert.equal(trip.tripHasWord("field", "cost"), false);
  assert.equal(trip.tripHasWord("field", "prompts"), true);
  assert.equal(trip.tripHasWord("survey", "fields"), true);
  assert.equal(trip.tripHasWord("trip", "fields"), false);
});

test("틀({n})은 갈래마다 자리가 달라 낱말 교체로는 안 된다", () => {
  assert.equal(trip.tripWordf("trip", "dayNth", { n:3 }), "3째 날");
  assert.equal(trip.tripWordf("field", "dayNth", { n:3 }), "활동 3");
  assert.equal(trip.tripWordf("survey", "dayNth", { n:3 }), "3차 조사");
  assert.equal(trip.tripWordf("trip", "dayCount", { n:2 }), "2일");
  assert.equal(trip.tripWordf("survey", "dayCount", { n:2 }), "조사 2차례");
});

test("모르는 갈래는 첫 갈래로 읽는다", () => {
  assert.equal(trip.tripPurpose("wat"), "trip");
  assert.equal(trip.tripPurpose(null), "trip");
  assert.equal(trip.tripPurpose("survey"), "survey");
});

/* ---------- 장소의 종류 ---------- */

test("장소 종류는 갈래마다 일곱이고 합집합은 열셋이다", () => {
  assert.equal(trip.TRIP_SPOT_KINDS.length, 13);
  for (const purpose of trip.TRIP_PURPOSES) {
    assert.equal(trip.tripSpotKinds(purpose).length, 7, purpose + " 갈래의 고르개");
  }
});

test("종류 아이콘은 모두 일기장 내장 그림에 이미 있다(새로 그릴 SVG 가 없다)", () => {
  for (const [id, icon] of trip.TRIP_SPOT_KINDS) {
    assert.ok(diary.DIARY_ART_IDS.includes(icon), id + " 의 아이콘 " + icon + " 이 DIARY_ART 에 없다");
  }
});

test("다른 갈래에서 고른 종류도 버리지 않고 이름을 찾아 준다", () => {
  // 답사 고르개에는 '잠자리'가 없지만, 값이 들어 있으면 그대로 보여 줘야 한다.
  assert.equal(trip.tripSpotKinds("survey").some(k => k[0] === "stay"), false);
  assert.equal(trip.tripSpotKindName("survey", "stay"), "잠자리");
  const day = trip.tripNormalizeDay({ spots:[{ name:"숙소", kind:"stay" }] });
  assert.equal(day.spots[0].kind, "stay");
});

test("아예 모르는 종류 글자도 남긴다", () => {
  const day = trip.tripNormalizeDay({ spots:[{ name:"어딘가", kind:"made-up" }] });
  assert.equal(day.spots[0].kind, "made-up");
});

/* ---------- 정규화 ---------- */

test("빈 날은 저장하지 않는다", () => {
  const model = trip.tripNormalize({
    format:trip.TRIP_FORMAT, version:1,
    days:[{ id:"dy-1", title:"", text:"" }, { id:"dy-2", title:"첫날" }]
  });
  assert.equal(model.days.length, 1);
  assert.equal(model.days[0].title, "첫날");
});

test("날짜는 실제 있는 날만, 없어도 된다(학습지·답사는 날짜 없이 쓴다)", () => {
  const ok = trip.tripNormalizeDay({ date:"2026-07-20", title:"a" });
  const bad = trip.tripNormalizeDay({ date:"2026-02-30", title:"a" });
  const none = trip.tripNormalizeDay({ title:"활동 1" });
  assert.equal(ok.date, "2026-07-20");
  assert.equal(bad.date, "");
  assert.equal(none.date, "");
});

test("새 여행일지 지도는 한국 전국에서 시작하고 저장된 유효 좌표는 유지한다", () => {
  const fresh = trip.tripEmpty("새 여행", "trip");
  assert.deepEqual(fresh.map.center, [36.5, 127.9]);
  assert.equal(fresh.map.zoom, 7);
  assert.deepEqual(trip.tripNormalizeMap({ center:null }).center, [36.5, 127.9]);
  assert.deepEqual(trip.tripNormalizeMap({ center:[37.5665, 126.978], zoom:12 }).center, [37.5665, 126.978]);
  assert.equal(trip.tripNormalizeMap({ center:[37.5665, 126.978], zoom:12 }).zoom, 12);
  assert.deepEqual(trip.tripNormalizeMap({ center:[0, 0] }).center, [0, 0], "실제로 저장한 0, 0은 유지한다");
});

test("비어 있는 장소 좌표를 적도 원점으로 잘못 읽지 않는다", () => {
  const spot = trip.tripNormalizeSpot({ name:"좌표 없는 곳", lat:null, lng:null });
  assert.equal(spot.lat, null);
  assert.equal(spot.lng, null);
});

test("좌표와 시각은 믿지 않는다", () => {
  const day = trip.tripNormalizeDay({ spots:[
    { name:"a", lat:33.4, lng:126.9, at:"9:30" },
    { name:"b", lat:999, lng:126.9, at:"25:00" },
    { name:"c", lat:33.4, lng:9999 }
  ] });
  assert.deepEqual([day.spots[0].lat, day.spots[0].lng], [33.4, 126.9]);
  assert.equal(day.spots[0].at, "09:30");
  assert.equal(day.spots[1].lat, null);
  assert.equal(day.spots[1].at, "");
  assert.equal(day.spots[2].lng, null, "위도만 맞고 경도가 틀리면 좌표가 없는 것으로 본다");
});

test("들른 곳은 시각순으로 정렬하고 빈 시각과 같은 시각은 기존 차례를 지킨다", () => {
  const spots = [
    { id:"none-a", at:"" }, { id:"late", at:"18:20" }, { id:"early-a", at:"8:05" },
    { id:"early-b", at:"08:05" }, { id:"middle", at:"12:30" }, { id:"none-b", at:"" }
  ];
  assert.deepEqual(trip.tripSortSpotsByTime(spots).map(spot => spot.id),
    ["early-a", "early-b", "middle", "late", "none-a", "none-b"]);
  assert.deepEqual(spots.map(spot => spot.id), ["none-a", "late", "early-a", "early-b", "middle", "none-b"]);
  const day = trip.tripNormalizeDay({ spots:spots.map(spot => ({ ...spot, name:spot.id })) });
  assert.deepEqual(day.spots.map(spot => spot.id), ["early-a", "early-b", "middle", "late", "none-a", "none-b"]);
});

test("가리키는 사진이 ZIP 에 없으면 버린다", () => {
  const has = name => name === "assets/aaaa.jpg";
  const day = trip.tripNormalizeDay({ spots:[{ name:"a", photos:["assets/aaaa.jpg", "assets/bbbb.jpg", "http://x/y.jpg"] }] }, has);
  assert.deepEqual(day.spots[0].photos, ["assets/aaaa.jpg"]);
});

test("빈 장소 줄은 버린다", () => {
  const day = trip.tripNormalizeDay({ title:"첫날", spots:[{ name:"" }, { name:"성산" }] });
  assert.equal(day.spots.length, 1);
});

test("모르는 판은 거절한다", () => {
  assert.throws(() => trip.tripNormalize({ format:"classdock-trip", version:99 }), /trip-version/);
  assert.throws(() => trip.tripNormalize({ format:"classdock-diary", version:1 }), /trip-format/);
});

/* ---------- 저장 열쇠와 무손실 ---------- */

test("저장 열쇠는 시각을 빼서 저장 뒤 되돌리기가 다시 '깨끗'이 된다", () => {
  const a = trip.tripEmpty("제주", "trip");
  const b = { ...a, updatedAt:a.updatedAt + 60000 };
  assert.equal(trip.tripContentKey(a), trip.tripContentKey(b));
});

test("갈래를 바꿔도 자료는 한 글자도 안 바뀐다(무손실)", () => {
  const model = trip.tripNormalize({
    format:trip.TRIP_FORMAT, version:1, purpose:"trip",
    days:[{ id:"dy-1", title:"첫날", text:"성산에 갔다", spots:[
      { id:"sp-1", name:"성산일출봉", kind:"sight", cost:{ amount:5000, currency:"KRW" },
        fields:[{ k:"지형", v:"현무암" }] }
    ], prompts:[{ q:"무엇을 보았나요?", a:"바다" }] }]
  });
  const before = JSON.parse(trip.tripContentKey(model));
  const after = JSON.parse(trip.tripContentKey({ ...model, purpose:"survey" }));
  assert.equal(after.purpose, "survey");
  delete before.purpose; delete after.purpose;
  assert.deepEqual(after, before, "갈래 말고는 아무것도 달라지면 안 된다");
});

test("여행에만 있는 경비도 학습지 갈래에서 그대로 남는다", () => {
  const model = trip.tripNormalize({
    format:trip.TRIP_FORMAT, version:1, purpose:"field",
    days:[{ id:"dy-1", title:"a", spots:[{ id:"sp-1", name:"매점", cost:{ amount:1500, currency:"KRW" } }] }]
  });
  assert.deepEqual(model.days[0].spots[0].cost, { amount:1500, currency:"KRW" });
});

/* ---------- 사진 목록과 ZIP ---------- */

test("굳힌 지도 그림도 참조 목록에 든다(빠뜨리면 다음 저장에서 사라진다)", () => {
  const model = trip.tripEmpty("제주", "trip");
  model.map = { ...model.map, still:"assets/mapmap.jpg", stillKey:"k" };
  model.days = [trip.tripNormalizeDay({
    id:"dy-1", title:"a", still:"assets/dayday.jpg",
    spots:[{ name:"성산", photos:["assets/photo1.jpg"] }]
  })];
  const used = [...trip.tripReferencedAssets(model)].sort();
  assert.deepEqual(used, ["assets/dayday.jpg", "assets/mapmap.jpg", "assets/photo1.jpg"]);
  model.map.still = "";
  model.map.stillKey = "";
  model.days[0].still = "";
  model.days[0].stillKey = "";
  assert.deepEqual([...trip.tripReferencedAssets(model)], ["assets/photo1.jpg"]);
});

test("ZIP 으로 묶었다 풀면 그대로이고, 안 쓰는 사진은 빠진다", async () => {
  const model = trip.tripEmpty("제주 3박 4일", "survey");
  model.days = [trip.tripNormalizeDay({
    id:"dy-1", date:"2026-07-20", title:"첫째 날", text:"바람이 셌다",
    spots:[{ id:"sp-1", name:"성산일출봉", address:"제주 서귀포시", lat:33.458, lng:126.942,
      kind:"observe", at:"09:30", photos:["assets/keepme.jpg"], fields:[{ k:"지형", v:"현무암" }] }]
  }, () => true)];
  const assets = new Map([
    ["assets/keepme.jpg", { bytes:jpg(1) }],
    ["assets/dropme.jpg", { bytes:jpg(9) }]
  ]);
  const bytes = trip.tripPack(model, assets, 1770000000000);
  const back = await trip.tripUnpack(bytes);
  assert.equal(back.model.title, "제주 3박 4일");
  assert.equal(back.model.purpose, "survey");
  assert.equal(back.model.days.length, 1);
  const spot = back.model.days[0].spots[0];
  assert.equal(spot.name, "성산일출봉");
  assert.equal(spot.at, "09:30");
  assert.deepEqual(spot.fields, [{ k:"지형", v:"현무암" }]);
  assert.deepEqual([...back.assets.keys()], ["assets/keepme.jpg"], "모델이 안 가리키는 사진은 안 담긴다");
  assert.equal(trip.tripContentKey(back.model), trip.tripContentKey(model), "왕복해도 저장 열쇠가 같다");
});

/* ---------- 국내·해외 ---------- */

test("국내·해외는 한 곳에서 정하고, 좌표가 없으면 국내로 본다", () => {
  const make = spots => ({ days:[{ spots }] });
  assert.equal(trip.tripIsDomestic(make([])), true, "좌표가 없으면 국내");
  assert.equal(trip.tripIsDomestic(make([{ lat:33.4, lng:126.9 }])), true);
  assert.equal(trip.tripIsDomestic(make([{ lat:35.6, lng:139.7 }])), false, "도쿄");
  assert.equal(trip.tripIsDomestic(make([{ lat:37.5, lng:127.0 }, { lat:35.6, lng:139.7 }])), true, "반이 국내면 국내");
  assert.equal(trip.tripIsDomestic(make([{ name:"주소만" }])), true);
});

/* ---------- 새 문서 ---------- */

test("새 문서 이름은 갈래를 따르고, 같은 이름이면 번호가 붙는다", () => {
  assert.equal(trip.tripScratchFileName("trip", 1), "여행일지.trip");
  assert.equal(trip.tripScratchFileName("field", 1), "체험학습.trip");
  assert.equal(trip.tripScratchFileName("survey", 2), "답사 2.trip");
});

test("새 문서 뼈대는 동기로 만들어진다(폴더에서 만들 때 필요하다)", () => {
  const bytes = trip.tripStarterBytes("체험학습.trip", "field");
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
});

/* ---------- 사진에서 찍은 때·자리 읽기(EXIF) ---------- */

/* 시험용 JPEG 를 손으로 짠다. 실제 사진을 저장소에 넣지 않으려는 것도 있지만,
   무엇이 들어 있는지 한눈에 보이는 쪽이 이 파서에는 더 낫다. */
function exifJpeg({ when = "2026:07:20 09:30:11", lat = null, lng = null, little = true } = {}) {
  const parts = [];                                   // TIFF 블록 안의 조각들
  const u16 = v => { const b = Buffer.alloc(2); little ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b; };
  const u32 = v => { const b = Buffer.alloc(4); little ? b.writeUInt32LE(v) : b.writeUInt32BE(v); return b; };
  const rat = (n, d) => Buffer.concat([u32(n), u32(d)]);
  const entry = (tag, type, count, valueBuf) => Buffer.concat([u16(tag), u16(type), u32(count), valueBuf]);

  const whenBytes = Buffer.from(when + "\0", "latin1");
  // TIFF 머리(8) + IFD0 + ExifIFD + GPS + 자료
  const header = Buffer.concat([Buffer.from(little ? "II" : "MM", "latin1"), u16(42), u32(8)]);
  const hasGps = lat != null && lng != null;
  const ifd0Count = 1 + (hasGps ? 1 : 0);
  const ifd0At = 8;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifAt = ifd0At + ifd0Size;
  const exifSize = 2 + 1 * 12 + 4;
  const gpsAt = exifAt + exifSize;
  const gpsSize = hasGps ? 2 + 4 * 12 + 4 : 0;
  let dataAt = gpsAt + gpsSize;

  const whenAt = dataAt; dataAt += whenBytes.length;
  const latAt = dataAt; if (hasGps) dataAt += 24;
  const lngAt = dataAt; if (hasGps) dataAt += 24;

  const ifd0 = [u16(ifd0Count), entry(0x8769, 4, 1, u32(exifAt))];
  if (hasGps) ifd0.push(entry(0x8825, 4, 1, u32(gpsAt)));
  ifd0.push(u32(0));
  parts.push(Buffer.concat(ifd0));
  parts.push(Buffer.concat([u16(1), entry(0x9003, 2, whenBytes.length, u32(whenAt)), u32(0)]));
  if (hasGps) {
    parts.push(Buffer.concat([u16(4),
      entry(0x0001, 2, 2, Buffer.from((lat < 0 ? "S" : "N") + "\0\0\0", "latin1")),
      entry(0x0002, 5, 3, u32(latAt)),
      entry(0x0003, 2, 2, Buffer.from((lng < 0 ? "W" : "E") + "\0\0\0", "latin1")),
      entry(0x0004, 5, 3, u32(lngAt)),
      u32(0)]));
  }
  parts.push(whenBytes);
  if (hasGps) {
    const triple = v => Buffer.concat([rat(Math.floor(Math.abs(v)), 1),
      rat(Math.floor((Math.abs(v) - Math.floor(Math.abs(v))) * 60), 1),
      rat(Math.round((((Math.abs(v) - Math.floor(Math.abs(v))) * 60) % 1) * 60 * 100), 100)]);
    parts.push(triple(lat), triple(lng));
  }
  const tiff = Buffer.concat([header, ...parts]);
  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const size = Buffer.alloc(2); size.writeUInt16BE(app1Body.length + 2);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]), size, app1Body, Buffer.from([0xFF, 0xDA, 0x00, 0x02])
  ]));
}

test("사진에서 찍은 때를 읽는다", () => {
  const out = trip.tripReadExif(exifJpeg({ when:"2026:07:20 09:30:11" }));
  assert.equal(out.date, "2026-07-20");
  assert.equal(out.at, "09:30");
  assert.equal(out.lat, null);
});

test("사진에서 찍은 자리를 읽는다(남·서는 음수)", () => {
  const north = trip.tripReadExif(exifJpeg({ lat:33.458, lng:126.942 }));
  assert.ok(Math.abs(north.lat - 33.458) < 0.001, "위도 " + north.lat);
  assert.ok(Math.abs(north.lng - 126.942) < 0.001, "경도 " + north.lng);
  const south = trip.tripReadExif(exifJpeg({ lat:-33.87, lng:-151.21 }));
  assert.ok(south.lat < 0 && south.lng < 0, "남·서는 음수여야 한다");
});

test("바이트 차례(MM)도 읽는다", () => {
  const out = trip.tripReadExif(exifJpeg({ lat:37.5665, lng:126.978, little:false }));
  assert.equal(out.date, "2026-07-20");
  assert.ok(Math.abs(out.lat - 37.5665) < 0.001);
});

test("EXIF 가 없거나 JPEG 가 아니면 빈 값이고 던지지 않는다", () => {
  assert.deepEqual(trip.tripReadExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), { date:"", at:"", lat:null, lng:null });
  assert.deepEqual(trip.tripReadExif(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 2])), { date:"", at:"", lat:null, lng:null });
  assert.deepEqual(trip.tripReadExif(null), { date:"", at:"", lat:null, lng:null });
  assert.deepEqual(trip.tripReadExif(new Uint8Array(0)), { date:"", at:"", lat:null, lng:null });
});

test("사진 묶음의 새 촬영 날짜는 중복 없이 시간순으로 날을 만든다", () => {
  assert.deepEqual(trip.tripMissingPhotoDates(
    [{ date:"2026-07-20" }],
    [{ date:"2026-07-22" }, { date:"2026-07-21" }, { date:"2026-07-22" }, { date:"" }]
  ), ["2026-07-21", "2026-07-22"]);
  assert.deepEqual(trip.tripMissingPhotoDates(null, [{ date:"2026-02-30" }, null]), []);
});

test("사진 날짜로 날을 정렬하되 같은 날짜와 날짜 없는 기록의 기존 차례는 지킨다", () => {
  const days = [
    { id:"late", date:"2026-09-11" }, { id:"none-a", date:"" },
    { id:"early-a", date:"2026-09-08" }, { id:"early-b", date:"2026-09-08" },
    { id:"middle", date:"2026-09-09" }, { id:"none-b", date:"" }
  ];
  assert.deepEqual(trip.tripSortDaysByDate(days).map(day => day.id),
    ["early-a", "early-b", "middle", "late", "none-a", "none-b"]);
  assert.deepEqual(days.map(day => day.id), ["late", "none-a", "early-a", "early-b", "middle", "none-b"]);
});

test("사진에서 만든 장소 사진은 카드에 보이고 날짜 없는 사진도 빈 여행일지에서 받는다", () => {
  const source = read("src/js/trip.js");
  const css = read("src/styles.css");
  assert.match(source, /const missingDates = tripMissingPhotoDates/);
  assert.match(source, /daysByDate\.set\(date, day\)/);
  assert.match(source, /if \(!target\)\{[\s\S]{0,120}target = ensureDay\(""\)/);
  assert.match(source, /className = "trip-spot-photos"/);
  assert.match(source, /window\.openImageLightbox\(spotPhotos\.map/);
  assert.match(source, /renderRail\(\); renderPage\(\);/);
  assert.match(css, /\.trip-spot-photo-view img\{[^}]*object-fit:cover/);
});

test("사진이 있는 지도 표식은 미리보기로, 없는 표식은 이름 툴팁으로 보인다", () => {
  const source = read("src/js/trip.js");
  const css = read("src/styles.css");
  assert.match(source, /function tripMapPhotoCard\(spot, markerNumber\)/);
  assert.match(source, /photos\.slice\(0, 4\)/);
  assert.match(source, /window\.openImageLightbox\(photos\.map/);
  assert.match(source, /if \(!\(spot\.photos \|\| \[\]\)\.some\(name => assets\.has\(name\)\)\)\{/);
  assert.match(source, /marker\.bindTooltip\(markerNumber/);
  assert.match(source, /marker\.on\("mouseover", openPreview\)/);
  assert.match(source, /marker\.on\("click", openPreview\)/);
  assert.match(css, /\.trip-map-photo-gallery\{[^}]*grid-template-columns:repeat\(2/);
});

test("스티커·꾸미기 창은 Leaflet 동선 지도 위에 뜬다", () => {
  const css = read("src/styles.css");
  assert.match(css, /\.trip-root\{[^}]*position:relative;[^}]*isolation:isolate/);
  assert.match(css, /\.trip-map-pane\{[^}]*z-index:0;[^}]*isolation:isolate/);
  assert.match(css, /\.diary-style-panel,\.diary-art-panel\{[^}]*z-index:40/);
});

test("여행일지 탭과 칩은 공용 문서 색상표를 쓴다", () => {
  const css = read("src/styles.css");
  assert.equal(documentTypes.extCategory("trip", "여행일지.trip"), "trip");
  assert.match(css, /\[data-cat="trip"\]\{--ic:#[0-9a-f]{6}\}/i);
});

test("편집 화면과 지도 화면 사이 분할 바는 폭을 조절하고 기억한다", () => {
  const source = read("src/js/trip.js");
  const css = read("src/styles.css");
  assert.match(source, /className = "trip-map-divider"/);
  assert.match(source, /body\.append\(rail, main, mapDivider, mapPane\)/);
  assert.match(source, /localStorage\.getItem\("mn\.tripMapWidth"\)/);
  assert.match(source, /localStorage\.setItem\("mn\.tripMapWidth"/);
  assert.match(source, /leafletMap\.invalidateSize\(\{ pan:false \}\)/);
  assert.match(source, /mapDivider\.addEventListener\("keydown"/);
  assert.match(css, /\.trip-map-divider\{[^}]*cursor:col-resize;[^}]*touch-action:none/);
  assert.match(css, /\.trip-map-divider,\.trip-map-pane\{display:none\}/);
});

test("여행일지 상단 편집 도구는 공용 아이콘과 짧은 이름을 함께 보인다", () => {
  const source = read("src/js/trip.js");
  const icons = read("src/js/icons.js");
  const css = read("src/styles.css");
  for (const [className, icon] of [
    ["trip-photo-btn", "image"], ["trip-exif-btn", "map"], ["trip-sticker-btn", "sticker"],
    ["trip-style-btn", "sliders"], ["trip-print-btn", "print"], ["trip-export-btn", "export"],
    ["trip-save-btn", "save"]
  ]) {
    assert.match(source, new RegExp('diaryButton\\("",[^\\n]*"[^"]*' + className + '[^"]*"[^\\n]*"' + icon + '"\\)'));
  }
  for (const label of ["되돌리기", "다시하기", "사진추가", "사진정보", "꾸미기", "편집/설정", "인쇄", "내보내기", "저장"]){
    assert.match(source, new RegExp('toolLabel\\([^\\n]*"' + label.replace("/", "\\/") + '"'));
  }
  assert.match(source, /className = "trip-brand"/);
  assert.match(source, /className = "trip-map-guide"/);
  assert.match(icons, /\bmap:\s*['"]/);
  assert.match(icons, /\bsun:\s*['"]/);
  assert.match(icons, /,export:\s*['"]/);
  assert.match(css, /\.trip-page-head\.diary-page-head\{[^}]*flex-direction:row/);
});

test("날짜 입력은 브라우저의 빈 요일 괄호 대신 날짜 글자만 따로 표시한다", () => {
  const source = read("src/js/trip.js");
  const css = read("src/styles.css");
  assert.match(source, /className = "trip-day-date-display"/);
  assert.match(source, /dayDateField\.append\(dayDateDisplay, dayDateIcon, dayDate\)/);
  assert.match(source, /dayDateDisplay\.textContent = day \? \(day\.date/);
  assert.match(css, /\.trip-day-date-field \.trip-day-date\{[^}]*opacity:0/);
  assert.match(css, /\.trip-day-date-display\{[^}]*font-variant-numeric:tabular-nums/);
});

test("마지막 날 삭제로 초점을 잃어도 활성 여행일지는 Ctrl+S로 저장한다", () => {
  const source = read("src/js/trip.js");
  const onKey = source.slice(source.indexOf("  const onKey = (e) => {"), source.indexOf("  document.addEventListener(\"keydown\", onKey, true);"));
  const activeGuard = onKey.indexOf("activeId !== doc.id");
  const saveKey = onKey.indexOf('toLowerCase() === "s"');
  const focusGuard = onKey.indexOf("doc.el.contains(document.activeElement)");
  assert.ok(activeGuard >= 0 && activeGuard < saveKey, "현재 활성 문서만 저장한다");
  assert.ok(saveKey < focusGuard, "저장은 문서 내부의 입력 초점에 의존하지 않는다");
  assert.match(onKey, /e\.preventDefault\(\); saveTrip\(doc\); return;/);
});

test("들른 곳을 지우면 지도 표식·동선과 날씨도 즉시 갱신한다", () => {
  const source = read("src/js/trip.js");
  assert.match(source,
    /removeBtn\.addEventListener\("click",[\s\S]*?day\.spots = day\.spots\.filter[\s\S]*?renderSpots\(\); renderRail\(\); renderMap\(\); syncWeather\(\); touch\(true\)/);
  assert.match(source,
    /if \(pickingFor === spot\.id\)\{[\s\S]*?pickingFor = "";[\s\S]*?mapStage\.classList\.remove\("is-picking"\)/);
});

test("찍은 때 글은 실제 있는 날만 받는다", () => {
  assert.deepEqual(trip.tripExifWhen("2026:07:20 09:30:11"), { date:"2026-07-20", at:"09:30" });
  assert.equal(trip.tripExifWhen("2026:02:30 09:30:11"), null, "없는 날");
  assert.equal(trip.tripExifWhen(""), null);
  assert.equal(trip.tripExifWhen("0000:00:00 00:00:00"), null);
});

test("일정 내보내기는 장소마다 첫 사용 가능한 사진을 문서에 담는다", async () => {
  const vm = require("node:vm");
  const context = vm.createContext({
    File,
    diaryAssetMime:() => "image/jpeg"
  });
  vm.runInContext(read("src/js/timeline.js"), context);
  vm.runInContext(read("src/js/trip.js"), context);
  const convert = vm.runInContext("tripToTimelineDoc", context);
  const assets = new Map([
    ["assets/one.jpg", { bytes:jpg(1) }],
    ["assets/two.jpg", { bytes:jpg(2) }]
  ]);
  const model = { title:"제주", purpose:"trip", days:[{ date:"2026-07-20", spots:[
    { name:"첫 장소", at:"09:00", lat:33.458, lng:126.942, photos:["assets/one.jpg"] },
    { name:"둘째 장소", at:"10:00", photos:["assets/missing.jpg", "assets/two.jpg"] },
    { name:"셋째 장소", at:"11:00", photos:[] }
  ] }] };
  const out = await convert(model, assets, async file => ({
    name:file.name, dataUrl:"data:image/jpeg;base64,AA==", width:1, height:1
  }));
  const events = JSON.parse(out.text).events;
  assert.deepEqual(events.map(e => e.title), ["첫 장소", "둘째 장소", "셋째 장소"]);
  assert.equal(events[0].lat, 33.458);
  assert.equal(events[0].lng, 126.942);
  assert.equal(events[1].lat, null);
  assert.equal(events[0].image.name, "첫 장소.jpg");
  assert.equal(events[1].image.name, "둘째 장소.jpg");
  assert.equal(events[2].image, null);
  assert.equal(out.photoCount, 2);
  assert.equal(out.skippedPhotos, 0);
});
/* ---------- 문서에 적어 둔 것과 어긋나지 않게 ---------- */

test("설계 문서가 말하는 개수와 실제가 같다", () => {
  const doc = read("docs/여행일지-설계.md");
  assert.match(doc, /합집합\*\* \| \*\*13\*\*/, "부록 B 의 합집합 수");
  assert.equal(trip.TRIP_SPOT_KINDS.length, 13);
  assert.equal(trip.TRIP_PURPOSES.length, 3);
});
