/* 색칠 지도용 행정경계(vendor/korea-regions.js) 만들기.
 *
 * 원자료: vuski/admdongkor (통계청 SGIS 행정동 경계를 가공, CC BY 4.0 + 공공누리 제1유형)
 * 받는 법(한 번만, 앱 의존성에는 넣지 않는다):
 *   mkdir tmp && cd tmp && npm init -y && npm i admdongkor
 *   node -e 'import("admdongkor").then(async a=>{const fs=require("fs");for(const k of ["20260701","20251231"])for(const l of ["sido","sgg"])fs.writeFileSync(`${l}-${k}.json`,JSON.stringify(await a.get(k,l)))})'
 * 만들기:
 *   node tools/build-korea-regions.mjs <그 폴더>
 *
 * 담는 방식 — 교실 PC 에서 가볍게 열리도록 줄였다.
 *  · 좌표는 소수 넷째 자리(약 10m)로 반올림해 "구글 인코딩 폴리라인" 글자로 담는다(JSON 배열의 약 1/4).
 *  · 시점 두 개(최신·통합 전)는 모양이 같은 경계를 한 번만 담고 번호로 가리킨다.
 *    통계 자료는 대개 한두 해 늦으므로 옛 이름(광주광역시·전라남도·인천 중구…)으로 칠할 수 있어야 한다.
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("사용법: node tools/build-korea-regions.mjs <admdongkor JSON 폴더>"); process.exit(1); }

const VINTAGES = [
  { id:"2026-07", key:"20260701", label:"2026년 7월 (최신)" },
  { id:"2025-12", key:"20251231", label:"2025년 12월 (광주·전남 통합 전)" }
];
const SCALE = 1e4;

function encodeRing(ring){
  let out = "", prevLat = 0, prevLng = 0, lastLat = null, lastLng = null;
  const push = (value) => {
    let v = value < 0 ? ~(value << 1) : (value << 1);
    while (v >= 0x20){ out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of ring){
    const ilat = Math.round(lat * SCALE), ilng = Math.round(lng * SCALE);
    if (ilat === lastLat && ilng === lastLng) continue;   // 반올림으로 겹친 점
    push(ilat - prevLat); push(ilng - prevLng);
    prevLat = ilat; prevLng = ilng; lastLat = ilat; lastLng = ilng;
  }
  return out;
}
// 고리는 "," 로, 다각형은 ";" 로 가른다 — 둘 다 인코딩 글자 범위(63~126) 밖이다.
function encodeGeometry(geometry){
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map(rings => rings.map(encodeRing).filter(r => r.length >= 6).join(",")).filter(Boolean).join(";");
}

const geoms = [];
const geomIndex = new Map();
const refOf = (geometry) => {
  const code = encodeGeometry(geometry);
  if (!geomIndex.has(code)){ geomIndex.set(code, geoms.length); geoms.push(code); }
  return geomIndex.get(code);
};

const out = { vintages:{} };
for (const vintage of VINTAGES){
  const read = (level) => JSON.parse(fs.readFileSync(path.join(dir, `${level}-${vintage.key}.json`), "utf8"));
  const sido = read("sido").features.map(f => [f.properties.sidonm, refOf(f.geometry)]);
  const sgg = read("sgg").features.map(f => [f.properties.sidonm, f.properties.sggnm, refOf(f.geometry)]);
  out.vintages[vintage.id] = { label:vintage.label, sido, sgg };
}

const header = `/* 대한민국 시도·시군구 경계 (색칠 지도용, 좌표 약 10m 단위로 줄임)
 * 본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로
 * 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor),
 * CC BY 4.0으로 배포됩니다. 이 파일은 tools/build-korea-regions.mjs 가 만든 생성물입니다. */
`;
const body = `var MN_KOREA_REGIONS = ${JSON.stringify({
  attribution:"행정경계: 통계청 SGIS(공공누리 1유형) · 가공 vuski/admdongkor(CC BY 4.0)",
  scale:SCALE, geoms, vintages:out.vintages
})};\n`;
const target = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "vendor", "korea-regions.js");
fs.writeFileSync(target, header + body);
console.log(`경계 ${geoms.length}개 · ${(Buffer.byteLength(header + body) / 1024).toFixed(0)}KB → ${target}`);
