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

/* ---------- 문서에 적어 둔 것과 어긋나지 않게 ---------- */

test("설계 문서가 말하는 개수와 실제가 같다", () => {
  const doc = read("docs/여행일지-설계.md");
  assert.match(doc, /합집합\*\* \| \*\*13\*\*/, "부록 B 의 합집합 수");
  assert.equal(trip.TRIP_SPOT_KINDS.length, 13);
  assert.equal(trip.TRIP_PURPOSES.length, 3);
});
