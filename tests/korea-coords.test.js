"use strict";
/* 한국 평면 좌표계 변환(MNKoreaCoords).
 * 기준값은 2026-09-18 카카오 좌표 변환 API(transcoord, input WGS84)가 실제로 돌려준 값이다.
 * 카카오 'TM' = EPSG:5174(보정 중부원점 Bessel), 'WTM' = EPSG:5181, 'WCONGNAMUL' = 5181×2.5, 'UTM' = 52N.
 * 카카오는 UTM-K(5179)를 받지 않아(400) 5179 는 공개된 서울시청 값과 왕복으로 본다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../src/js/korea-coords.js");

const kakao = [
  { name:"서울시청", lat:37.5663, lng:126.9779, "5174":[197978, 451558], "5181":[198048, 451863], wcongnamul:[495119, 1129657], "32652":[321415, 4159619] },
  { name:"제주시청", lat:33.4996, lng:126.5312, "5174":[156361, 451], "5181":[156438, 758], wcongnamul:[391094, 1896], "32652":[270656, 3709403] },
  { name:"부산시청", lat:35.1796, lng:129.0756, "5174":[389004, 188684], "5181":[389077, 188994], wcongnamul:[972692, 472484], "32652":[506884, 3892963] }
];
const metres = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180)) * 111320;

test("카카오 변환값과 1m 안으로 맞는다(평면 → 위경도)", () => {
  for (const place of kakao) {
    for (const id of ["5174", "5181", "wcongnamul", "32652"]) {
      const scale = id === "wcongnamul" ? 2.5 : 1;   // 카카오 값은 정수로 잘려 있어 그만큼 여유를 둔다
      const back = K.toWgs84(id, place[id][0], place[id][1]);
      assert.ok(metres(back, [place.lat, place.lng]) < 1 * scale, `${place.name} ${id} ${back}`);
    }
  }
});

test("보정 없는 중부원점(2097)은 5174 와 동서로 250m 남짓 어긋난다", () => {
  const a = K.toWgs84("2097", 197978, 451558), b = K.toWgs84("5174", 197978, 451558);
  const gap = metres(a, b);
  assert.ok(gap > 200 && gap < 300, String(gap));
});

test("모든 좌표계가 왕복해도 1cm 안으로 돌아오고, UTM-K 서울시청 값이 맞다", () => {
  for (const system of K.SYSTEMS) {
    for (const place of kakao) {
      const plane = K.fromWgs84(system.id, place.lat, place.lng);
      const back = K.toWgs84(system.id, plane[0], plane[1]);
      assert.ok(metres(back, [place.lat, place.lng]) < 0.01, `${system.id} ${place.name}`);
    }
  }
  const utmk = K.fromWgs84("5179", 37.5663, 126.9779);
  assert.ok(Math.abs(utmk[0] - 953892) < 2 && Math.abs(utmk[1] - 1952010) < 2, String(utmk));
});

test("값 범위로 좌표계를 짐작하고, x·y 를 거꾸로 적은 표도 알아본다", () => {
  const utmk = kakao.map(p => K.fromWgs84("5179", p.lat, p.lng));
  assert.equal(K.guess(utmk, ["x", "y"]).candidates[0], "5179");
  assert.equal(K.guess(utmk, ["x", "y"]).swap, false);
  const swapped = utmk.map(([x, y]) => [y, x]);
  assert.equal(K.guess(swapped, ["x", "y"]).swap, true);
  // 중부원점 계열은 값만으로 못 가른다 — 열 이름에 '좌표정보'(인허가 자료)가 있으면 Bessel 을 앞세운다.
  const tm = kakao.map(p => K.fromWgs84("2097", p.lat, p.lng));
  assert.equal(K.guess(tm, ["사업장명", "좌표정보(x)", "좌표정보(y)"]).candidates[0], "2097");
  assert.equal(K.guess(tm, ["x", "y"]).candidates[0], "5186");
  const utm = kakao.map(p => K.fromWgs84("32652", p.lat, p.lng));
  assert.equal(K.guess(utm, []).candidates[0], "32652");
  assert.deepEqual(K.guess([[37.5, 127]], []).candidates, []);
});

test("평면 좌표인지, 한국 안인지 가른다", () => {
  assert.equal(K.looksProjected(197978, 451558), true);
  assert.equal(K.looksProjected(126.97, 37.56), false);
  assert.equal(K.looksProjected("", 5), false);
  assert.equal(K.inKorea([37.24, 131.86]), true);   // 독도
  assert.equal(K.inKorea([40, 127]), false);
  assert.equal(K.toWgs84("nope", 1, 2), null);
  assert.equal(K.toWgs84("5179", "abc", 2), null);
});
