"use strict";

// 같은 값을 여러 언어가 따로 들고 있는 곳의 짝 맞춤 검사.
//
// ClassDock 에는 런처가 둘이다(Windows 는 launcher.cs, 그 밖의 곳은 main.go). 지도 타일·지오코딩·환율·지하철
// 프록시는 두 런처에 똑같이 들어 있고, 한쪽만 고치면 그 런처에서만 조용히 다르게 동작한다
// (허용 목록에서 빠진 배경지도는 회색으로 남고, 캐시 기간이 다르면 한 교실에서 화면마다 값이 어긋난다).
// 이미 다른 테스트가 보는 짝: WORKSPACE_CAP↔WorkspaceMaxBytes(folder-workspace), 검색 후보 수·배경지도 호스트(map-viewer).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const cs = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");
const go = fs.readFileSync(path.join(root, "desktop/main.go"), "utf8");
const javaRuntime = fs.readFileSync(path.join(root, "src/js/java-runtime.js"), "utf8");

// "400L * 1024 * 1024", "2 * 1024 * 1024" 같은 곱셈식만 계산한다(그 밖의 모양이면 검사를 고치라고 실패시킨다).
function product(expression, label){
  const text = String(expression).replace(/\b(\d+)L\b/g, "$1").trim();
  assert.match(text, /^\d+(\s*\*\s*\d+)*$/, `${label}: 곱셈식이 아니다 → ${expression}`);
  return text.split("*").reduce((total, part) => total * Number(part.trim()), 1);
}
function csConst(name){
  const found = new RegExp(`const\\s+(?:int|long|string)\\s+${name}\\s*=\\s*([^;]+);`).exec(cs);
  assert.ok(found, `launcher.cs 에서 ${name} 을 찾지 못했다`);
  return found[1].trim();
}
function csTimeSpanMs(name){
  const found = new RegExp(`TimeSpan\\s+${name}\\s*=\\s*TimeSpan\\.From(Days|Hours|Minutes|Seconds)\\((\\d+)\\)`).exec(cs);
  assert.ok(found, `launcher.cs 에서 TimeSpan ${name} 을 찾지 못했다`);
  return Number(found[2]) * { Days:86400000, Hours:3600000, Minutes:60000, Seconds:1000 }[found[1]];
}
function goConst(name){
  // 따옴표 값은 통째로 잡는다(값 안의 https:// 를 줄 끝 주석으로 오인하지 않게). 그 밖의 값은 // 주석 앞까지.
  const found = new RegExp(`^\\s*${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^\\n]*?)\\s*(?://[^\\n]*)?$`, "m").exec(go);
  assert.ok(found, `main.go 에서 ${name} 을 찾지 못했다`);
  return found[1].trim();
}
function goDurationMs(name){
  const text = goConst(name);
  const found = /^(\d+)\s*\*\s*time\.(Hour|Minute|Second|Millisecond)$/.exec(text)
    || /^(\d+)\s*\*\s*24\s*\*\s*time\.(Hour)$/.exec(text);
  assert.ok(found, `main.go ${name} 의 모양을 해석하지 못했다 → ${text}`);
  const unit = { Hour:3600000, Minute:60000, Second:1000, Millisecond:1 }[found[2]];
  return Number(found[1]) * unit * (/\*\s*24\s*\*/.test(text) ? 24 : 1);
}
const unquote = (text) => JSON.parse(text);

test("지도 타일 프록시 허용 호스트는 두 런처가 같은 목록이다", () => {
  const csBlock = /static readonly string\[\] TileProxyHosts = \{([\s\S]*?)\};/.exec(cs);
  const goBlock = /var tileProxyHosts = \[\]string\{([\s\S]*?)\}/.exec(go);
  assert.ok(csBlock && goBlock, "허용 목록을 찾지 못했다");
  const hosts = (block) => [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(hosts(goBlock), hosts(csBlock));
});

test("프록시 크기·캐시 상한과 시간 간격은 두 런처가 같다", () => {
  const sizes = [
    ["TileMaxBytes", "tileMaxBytes"], ["TileCacheMaxBytes", "tileCacheMaxBytes"],
    ["GeocodeMaxBytes", "geocodeMaxBytes"], ["DirectionsMaxBytes", "directionsMaxBytes"],
    ["RateMaxBytes", "rateMaxBytes"], ["RateCacheMaxBytes", "rateCacheMaxBytes"],
    ["SubwayMaxBytes", "subwayMaxBytes"], ["SubwayRowLimit", "subwayRowLimit"]
  ];
  for (const [csName, goName] of sizes){
    assert.equal(product(goConst(goName), goName), product(csConst(csName), csName), `${csName} ↔ ${goName}`);
  }
  const durations = [
    ["TileCacheMaxAge", "tileCacheMaxAge"], ["RateTodayCacheMaxAge", "rateTodayCacheAge"], ["SubwayCacheMaxAge", "subwayCacheAge"]
  ];
  for (const [csName, goName] of durations){
    assert.equal(goDurationMs(goName), csTimeSpanMs(csName), `${csName} ↔ ${goName}`);
  }
  assert.equal(goDurationMs("geocodeMinGap"), product(csConst("GeocodeMinIntervalMs"), "GeocodeMinIntervalMs"), "지오코딩 최소 간격");
});

test("프록시가 부르는 바깥 주소와 User-Agent 는 두 런처가 같다", () => {
  const endpoints = [
    ["DefaultGeocodeEndpoint", "defaultGeocoder"],
    ["KakaoAddressEndpoint", "kakaoAddressURL"], ["KakaoKeywordEndpoint", "kakaoKeywordURL"],
    ["KakaoCategoryEndpoint", "kakaoCategoryURL"], ["KakaoCoordAddressEndpoint", "kakaoCoordAddressURL"],
    ["KakaoCoordRegionEndpoint", "kakaoCoordRegionURL"], ["KakaoDirectionsEndpoint", "kakaoDirectionsURL"],
    ["KoreaEximRateEndpoint", "koreaEximRateURL"], ["EcbRateEndpoint", "ecbRateURL"]
  ];
  for (const [csName, goName] of endpoints){
    assert.equal(unquote(goConst(goName)), unquote(csConst(csName)), `${csName} ↔ ${goName}`);
  }
  // 지하철 주소는 C# 이 앞부분만, Go 가 서식 문자열 전체를 들고 있다.
  assert.ok(unquote(goConst("subwayPositionURL")).startsWith(unquote(csConst("SubwayPositionEndpoint"))), "지하철 API 주소");
  const agent = unquote(goConst("userAgent"));
  const csAgents = [...cs.matchAll(/request\.UserAgent = ("ClassDock\/1\.0 \(local classroom app; https:[^"]+")/g)].map(m => unquote(m[1]));
  assert.ok(csAgents.length >= 3, "launcher.cs 의 지도·환율·지하철 User-Agent 를 찾지 못했다");
  for (const value of csAgents) assert.equal(value, agent);
});

test("자바 설치 안내 문구의 판 번호는 런처가 실제로 받는 JDK 판과 같다", () => {
  const ui = /const JAVA_INSTALL_FEATURE_VERSION = (\d+);/.exec(javaRuntime);
  assert.ok(ui, "java-runtime.js 에서 JAVA_INSTALL_FEATURE_VERSION 을 찾지 못했다");
  assert.equal(Number(ui[1]), product(csConst("JdkFeatureVersion"), "JdkFeatureVersion"));
});
