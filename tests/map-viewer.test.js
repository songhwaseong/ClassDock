"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMapViewer(){
  const context = {
    console, Blob, URL, Map, Set, Date, Math, JSON,
    setTimeout, clearTimeout,
    document:{}, window:{}, location:{ protocol:"file:" }, navigator:{ onLine:true }
  };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  vm.runInContext(source + `
    ;globalThis.__map = {
      MAP_BASEMAPS, MAP_MARKER_COLORS,
      mapDocEmpty, mapDocParse, mapDocSerialize, mapDocContentKey,
      mapNormalizeMarker, mapNormalizeShape, mapNormalizeBackgroundImage,
      mapClampLat, mapClampLng, mapScratchFileName, mapDocDefaultTitle,
      mapFormatBytes, mapParseCoords, mapDistanceMeters, mapLineLengthMeters,
      mapPolygonAreaSquareMeters, mapFormatDistance, mapFormatArea
      , mapCsvRows, mapMarkersFromCsv, mapMarkersToCsv
    };`, context);
  return context.__map;
}

test(".map은 같은 모델을 항상 같은 JSON으로 직렬화하고 그대로 되읽는다", () => {
  const api = loadMapViewer();
  const model = api.mapDocEmpty("우리 동네");
  model.markers.push(api.mapNormalizeMarker({ lat:37.5665, lng:126.978, label:"학교", color:"blue" }));
  const first = api.mapDocSerialize(model);
  assert.equal(first, api.mapDocSerialize(model));
  const back = api.mapDocParse(first);
  assert.equal(back.title, "우리 동네");
  assert.equal(back.markers.length, 1);
  assert.equal(back.markers[0].label, "학교");
  assert.equal(back.markers[0].color, "blue");
});

test("지도 문서가 아닌 JSON은 편집 모델로 열지 않는다", () => {
  const api = loadMapViewer();
  assert.throws(() => api.mapDocParse('{"type":"something-else"}'));
  assert.throws(() => api.mapDocParse("not json at all"));
});

test("손으로 고친 좌표·확대·색이 들어와도 지도가 깨지지 않게 눌러 담는다", () => {
  const api = loadMapViewer();
  const model = api.mapDocParse(JSON.stringify({
    type:"classdock-map",
    center:[999, -999],
    zoom:9999,
    basemap:"존재하지-않는-배경",
    markers:[{ lat:"90.5", lng:"181", color:"형광색" }]
  }));
  assert.equal(model.center[0], 85);
  assert.equal(model.center[1], -180);
  assert.equal(model.zoom, 19);
  assert.equal(model.basemap, "osm");
  assert.equal(model.markers[0].lat, 85);
  assert.equal(model.markers[0].lng, 180);
  assert.equal(model.markers[0].color, "red");
  assert.ok(model.markers[0].id, "id 가 없던 표시에도 새 id 를 붙인다");
});

/* 지도를 움직였다는 이유로 문서가 "고쳐짐(●)"이 되면, 정작 표시를 지웠는지가 묻힌다.
   보기 위치는 저장에는 들어가되 저장 안 됨 판정에서는 빠져야 한다. */
test("보기 위치만 달라진 지도는 저장 안 됨으로 보지 않는다", () => {
  const api = loadMapViewer();
  const model = api.mapDocEmpty("지도");
  const before = api.mapDocContentKey(model);
  model.center = [37.5, 127.0];
  model.zoom = 15;
  assert.equal(api.mapDocContentKey(model), before);
  model.markers.push(api.mapNormalizeMarker({ lat:37.5, lng:127.0 }));
  assert.notEqual(api.mapDocContentKey(model), before);
});

test("기존 .map은 새 도형·사용자 배경 필드 없이도 그대로 열리고 새 모델은 왕복한다", () => {
  const api = loadMapViewer();
  const old = api.mapDocParse(JSON.stringify({ type:"classdock-map", version:1, title:"옛 지도", basemap:"osm", center:[37,127], zoom:10, markers:[] }));
  assert.deepEqual([...old.shapes], []);
  assert.equal(old.backgroundImage, null);

  const model = api.mapDocEmpty("확장 지도");
  model.shapes.push(api.mapNormalizeShape({ type:"line", points:[[37,127],[37.01,127.02]], label:"답사로" }));
  model.backgroundImage = api.mapNormalizeBackgroundImage({
    name:"학교 배치도.png", dataUrl:"data:image/png;base64,AAAA",
    bounds:[[36.9,126.9],[37.1,127.1]], width:1200, height:800
  });
  model.basemap = "custom";
  const back = api.mapDocParse(api.mapDocSerialize(model));
  assert.equal(back.basemap, "custom");
  assert.equal(back.shapes[0].label, "답사로");
  assert.equal(back.backgroundImage.name, "학교 배치도.png");
});

test("거리·면적 계산은 학교 수업에서 쓰는 단위로 안정적으로 계산한다", () => {
  const api = loadMapViewer();
  const oneDegree = api.mapDistanceMeters([0,0], [0,1]);
  assert.ok(oneDegree > 111000 && oneDegree < 112000);
  assert.ok(api.mapLineLengthMeters([[0,0],[0,1],[1,1]]) > 220000);
  const area = api.mapPolygonAreaSquareMeters([[0,0],[0,1],[1,1],[1,0]]);
  assert.ok(area > 12e9 && area < 13e9);
  assert.equal(api.mapFormatDistance(850), "850 m");
  assert.equal(api.mapFormatDistance(1250), "1.25 km");
  assert.equal(api.mapFormatArea(2500), "2,500 m²");
});

test("표시 CSV는 쉼표·줄바꿈 메모를 왕복하고 잘못된 좌표를 제외한다", () => {
  const api = loadMapViewer();
  const parsed = api.mapMarkersFromCsv('\uFEFF이름,위도,경도,메모,색상\r\n"서울, 시청",37.5668,126.9784,"첫 줄\n둘째 줄",blue\r\n오류,999,127,,red\r\n');
  assert.equal(parsed.markers.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.markers[0].label, "서울, 시청");
  assert.equal(parsed.markers[0].note, "첫 줄\n둘째 줄");
  const roundtrip = api.mapMarkersFromCsv(api.mapMarkersToCsv(parsed.markers));
  assert.equal(roundtrip.markers[0].label, "서울, 시청");
  assert.equal(roundtrip.markers[0].color, "blue");
});

test("확장 지도 UI는 사용자 이미지·거리선·면적 영역·CSV를 실제 편집 경로에 연결한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  for (const token of ["map-image-pick", "map-image-clear", "map-draw-line", "map-draw-area", "map-csv-import", "map-csv-export"]){
    assert.ok(source.includes(token), token);
  }
  assert.match(source, /L\.imageOverlay\(model\.backgroundImage\.dataUrl/);
  assert.match(source, /map\.createPane\("mapImagePane"\)/);
  assert.match(source, /pane: "mapImagePane"/);
  assert.match(source, /L\.polyline\(shape\.points/);
  assert.match(source, /L\.polygon\(shape\.points/);
  assert.match(source, /mapPrepareBackgroundImage\(file\)/);
  assert.match(source, /mapMarkersFromCsv\(await file\.text\(\)\)/);
  assert.match(source, /mapMarkersToCsv\(model\.markers\)/);
});

/* 배경지도 호스트는 런처의 /tile-proxy 허용 목록(launcher.cs TileProxyHosts)에 있어야 한다.
   한쪽만 늘리면 exe 에서 그 배경만 조용히 회색으로 남는다. */
test("배경지도 호스트는 런처 타일 프록시 허용 목록 안에 있다", () => {
  const api = loadMapViewer();
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const block = /static readonly string\[\] TileProxyHosts = \{([\s\S]*?)\};/.exec(launcher);
  assert.ok(block, "launcher.cs 에서 TileProxyHosts 를 찾지 못했다");
  const allowed = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  for (const [id, spec] of Object.entries(api.MAP_BASEMAPS)){
    const host = new URL(spec.url.replace("{s}.", "")).host;
    assert.ok(allowed.some(a => host === a || host.endsWith("." + a)),
      `${id} 의 호스트 ${host} 가 허용 목록에 없다`);
  }
});

/* 공개 OSM 타일은 오프라인 사전 다운로드를 금지한다. 실제로 화면에 뜬 타일의 일반 캐시는
   허용되므로 프록시는 유지하되, 보지 않은 범위·확대 단계를 만드는 코드는 없어야 한다. */
test("공개 타일을 미리 받지 않고 실제로 본 타일만 자동 캐시한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.doesNotMatch(source, /mapPrefetchTiles|mapTilesForBounds|MAP_PREPARE_TILE_LIMIT/);
  assert.match(source, /실제로 본 타일만/);
  assert.match(source, /openMapOfflineStatus/);
});

test("칠판 캡처는 프록시 쿼리별 타일을 구분해 한 타일을 반복하지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const capture = /async function mapCaptureDataUrl\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(capture, "mapCaptureDataUrl 을 찾지 못했다");
  assert.match(capture[1], /htmlToImage\.toPng\(stage/);
  assert.match(capture[1], /includeQueryParams:\s*true/);
});

test("캐시 용량은 사람이 읽는 단위로 보여 준다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapFormatBytes(0), "1KB");
  assert.equal(api.mapFormatBytes(512 * 1024), "512KB");
  assert.equal(api.mapFormatBytes(3.5 * 1024 * 1024), "3.5MB");
  assert.equal(api.mapFormatBytes(400 * 1024 * 1024), "400MB");
});

/* 타일 디스크 캐시(런처). exe 는 실행마다 포트가 달라 브라우저 저장소를 못 쓰므로, 이 캐시가
   "인터넷 없는 교실"의 유일한 근거다. 계약이 조용히 뒤집히지 않게 소스에서 확인한다. */
test("런처 타일 프록시는 7일 캐시를 우선하고 만료 캐시는 오프라인 fallback으로 쓴다", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const body = /static bool TryProxyMapTile\(([\s\S]*?)\n    \}/.exec(launcher);
  assert.ok(body, "TryProxyMapTile 을 찾지 못했다");
  const diskRead = body[1].indexOf("TryReadCachedTile");
  const network = body[1].indexOf("WebRequest.Create");
  assert.ok(diskRead >= 0 && network >= 0);
  assert.ok(diskRead < network, "디스크를 먼저 확인해야 인터넷이 끊겨도 열린다");
  assert.match(launcher, /TileCacheMaxAge = TimeSpan\.FromDays\(7\)/);
  assert.match(body[1], /IsTileCacheFresh\(cachedAtUtc\)/);
  assert.match(body[1], /staleData/);
  assert.ok(body[1].includes("WriteCachedTile"), "받아 온 타일은 디스크에 남겨야 한다");
  // 받다가 실패해도(오프라인) 이미 받아 둔 타일은 계속 나와야 한다.
  assert.match(body[1], /catch\s*\{[\s\S]*staleData[\s\S]*TryReadCachedTile/);
});

test("두 런처는 400MB를 넘긴 쓰기 직후 정리하고 C# 메모리 캐시는 MIME도 보존한다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  assert.doesNotMatch(csharp, /TileCacheSweepEvery|TileWritesSinceSweep/);
  assert.match(csharp, /TileDiskBytes > TileCacheMaxBytes\) SweepTileCache/);
  assert.match(csharp, /class TileMemoryEntry[\s\S]*public string Mime/);
  assert.match(csharp, /mime = cached\.Mime/);
  assert.doesNotMatch(go, /tileSweepEvery|tileWritesSince/);
  assert.match(go, /tileDiskBytes > tileCacheMaxBytes/);
});

test("타일 캐시 조회·비우기는 토큰이 있어야 부를 수 있다", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const gate = /static bool RequiresLocalAuthToken\(([\s\S]*?)\n        return false;/.exec(launcher);
  assert.ok(gate, "RequiresLocalAuthToken 을 찾지 못했다");
  assert.ok(gate[1].includes('path == "/tile-cache-clear"'));
  assert.ok(gate[1].includes('path == "/tile-cache-status"'));
  // 지우는 쪽은 토큰에 더해 동작 헤더까지 요구한다(다른 파괴적 엔드포인트와 같은 규칙).
  const route = launcher.indexOf('path == "/tile-cache-clear"', launcher.indexOf("---- 라우팅 ----"));
  assert.ok(route > 0);
  assert.ok(launcher.slice(route, route + 400).includes("HasLocalActionHeader"));
});

/* `.map` 은 자바스크립트 소스맵도 쓰는 확장자다. 압축·폴더 안에서 소스맵을 만나면 텍스트로
   열되 "지도가 깨졌다"고 알리면 안 된다 — 실패 안내는 지도라고 주장하는 파일에만. */
test("소스맵(.map)은 지도 실패로 알리지 않고 조용히 텍스트로 넘긴다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const body = /async function loadMapDoc\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(body, "loadMapDoc 을 찾지 못했다");
  assert.match(body[1], /indexOf\(MAP_DOC_TYPE\) >= 0 && typeof toast === "function"/);
  assert.match(body[1], /return typeof loadText === "function" \? loadText\(file, opts\) : null;/);
});

/* 앱 전용 문서 확장자는 "열 수 있는 형식"에 등록해 둬야 한다.
   등록하지 않아도 "내용이 텍스트면 연다"는 폴백 덕에 작은 파일은 열리지만, 그 폴백에는
   32MB 상한(UNKNOWN_TEXT_ARCHIVE_PROBE_CAP)이 있어 사진이 여러 장 든 블록 문서는 조용히 빠진다.
   등록하면 압축 항목 상한(ZIP_ENTRY_CAP)을 따른다. */
test("압축 안의 앱 전용 문서·악보는 열 수 있는 형식에 들어 있다", () => {
  const types = require(path.join(__dirname, "../src/js/document-types.js"));
  for (const ext of ["map", "mnote", "msheet", "musicxml"]) assert.ok(types.ZIP_OPENABLE.includes(ext), ext);
  assert.ok(types.ZIP_ENTRY_CAP > 32 * 1024 * 1024, "등록의 목적이 상한을 올리는 것이다");
  /* .mxl 은 그 자체가 ZIP(=이진)이라 "내용이 텍스트면 연다" 폴백에 아예 걸리지 않는다 —
     목록에 없으면 크기와 무관하게 통째로 빠지므로, 여기 있는 것이 유일한 통로다. */
  assert.ok(types.ZIP_OPENABLE.includes("mxl"), "mxl");
  // 열기 대상 목록에 있어도 확장자 판정은 그대로여야 한다.
  assert.equal(types.fileExtOf("우리동네.map"), "map");
  assert.equal(types.extCategory("map", "우리동네.map"), "map");
  assert.equal(types.iconFor("map", "우리동네.map"), "지도");
});

/* 한/EN 전환. 사전에 없는 문구는 한국어로 남으므로 조용히 새 나간다 — 코드가 쓰는 키가
   사전에 다 있는지 확인한다(치환 목적의 조립 문구는 PARAMS 쪽). */
test("지도 UI 문구는 영어 사전에 빠짐없이 들어 있다", () => {
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const missing = [];
  for (const [, text] of source.matchAll(/\bmapT\("((?:[^"\\]|\\.)*)"\)/g)){
    if (!i18n.includes('"' + text + '"')) missing.push(text);
  }
  for (const [, text] of source.matchAll(/\bmapTf\(\s*"((?:[^"\\]|\\.)*)"/g)){
    if (!i18n.includes('"' + text + '"')) missing.push(text);
  }
  assert.deepEqual(missing, [], "i18n.js 사전에 없는 문구");
  // 배경지도 이름은 선택 상자에 그대로 뜨므로 사전에 있어야 한다.
  const api = loadMapViewer();
  for (const spec of Object.values(api.MAP_BASEMAPS)) assert.ok(i18n.includes('"' + spec.label + '"'), spec.label);
  for (const color of api.MAP_MARKER_COLORS) assert.ok(i18n.includes('"' + color.label + '"'), color.label);
});

test("동적으로 만든 지도 화면은 현재 언어로 다시 훑고 상태 문구도 번역한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  // 도구막대 · 지도 고르기 창 · 오프라인 현황 창 · 마커 편집 풍선 네 곳
  assert.ok(source.match(/mapTranslate\(/g).length >= 5);
  assert.match(source, /mapTranslate\(bar\)/);
  assert.match(source, /mapTranslate\(form\)/);
  assert.match(source, /mapTranslate\(modal\)/);
  assert.match(source, /"● " \+ mapT\("저장 안 됨"\)/);
});

test("지도 문서를 닫으면 Leaflet·옵저버·전역 키 리스너를 함께 정리한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const cleanup = /doc\.cleanupFns\.push\(\(\) => \{([\s\S]*?)\n  \}\);/.exec(source);
  assert.ok(cleanup);
  assert.match(cleanup[1], /mapResizeObserver\.disconnect/);
  assert.match(cleanup[1], /map\.remove/);
  assert.match(cleanup[1], /removeEventListener\("keydown", onInteractionKey\)/);
});

/* 런처가 둘(C#·Go)이라 목록이 갈라지면 그 배경지도만 한쪽에서 조용히 회색으로 남는다.
   두 파일을 함께 읽어 같은 허용 목록인지 확인한다. */
test("두 런처의 타일 허용 목록은 서로 같다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  const pick = (source, pattern) => {
    const block = pattern.exec(source);
    assert.ok(block, "허용 목록을 찾지 못했다");
    return [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).sort();
  };
  const fromCs = pick(csharp, /static readonly string\[\] TileProxyHosts = \{([\s\S]*?)\};/);
  const fromGo = pick(go, /var tileProxyHosts = \[\]string\{([\s\S]*?)\n\}/);
  assert.deepEqual(fromGo, fromCs);
});

/* 타일 프록시 가능 여부는 파일 저장 가능 여부와 다른 능력이다 — Go 폴백 런처는 저장은 못 해도
   타일은 받아 준다. 프로브를 저장 쪽에 다시 묶으면 Go 런처에서 지도 캐시가 통째로 꺼진다. */
test("타일 프록시 판단은 저장 가능 여부가 아니라 전용 프로브를 쓴다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const body = /async function mapTileProxyBase\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(body);
  assert.match(body[1], /fetch\("\/can-proxy-tiles"/);
  assert.doesNotMatch(body[1], /saveFileBackendAvailable/);
  for (const launcher of ["../desktop/launcher.cs", "../desktop/main.go"]){
    assert.ok(fs.readFileSync(path.join(__dirname, launcher), "utf8").includes("/can-proxy-tiles"), launcher);
  }
});

test("Go 폴백 런처도 타일 프록시·디스크 캐시·장소 검색을 갖춘다", () => {
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  for (const route of ["/tile-proxy", "/tile-cache-status", "/tile-cache-clear", "/geocode", "/can-proxy-tiles"]){
    assert.ok(go.includes('"' + route + '"'), route);
  }
  // 디스크를 인터넷보다 먼저 본다(끊긴 교실에서 열리는 근거).
  const proxy = /func proxyMapTile\(([\s\S]*?)\n\}/.exec(go);
  assert.ok(proxy);
  assert.ok(proxy[1].indexOf("readCachedTile") < proxy[1].indexOf("httpClient.Do"));
  assert.match(go, /tileCacheMaxAge\s*= 7 \* 24 \* time\.Hour/);
  assert.ok(proxy[1].includes("tileCacheFresh(cachedAt)"));
  assert.ok(proxy[1].includes("return staleData, staleMime, cached"));
  assert.ok(proxy[1].includes("writeCachedTile"));
  // 지우는 쪽은 동작 헤더를 요구한다(C# 과 같은 규칙).
  assert.match(go, /tile-cache-clear[\s\S]{0,320}X-ClassDock-Action/);
});

/* Nominatim 정책: 식별 User-Agent + 초당 1건 이하 + 요청 시 공급자 교체 가능.
   file:// 브라우저는 식별 UA를 붙일 수 없으므로 직접 호출하지 않는다. */
test("장소 검색은 런처 프록시에서만 실행되고 공급자를 설정으로 교체할 수 있다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

  const csGeo = /static bool TryGeocodePlace\(([\s\S]*?)\n    \}/.exec(csharp);
  assert.ok(csGeo);
  assert.match(csGeo[1], /request\.UserAgent = "ClassDock/);
  assert.match(csGeo[1], /GeocodeMinIntervalMs/);
  assert.match(csharp, /const int GeocodeMinIntervalMs = 11\d\d;/);

  const goGeo = /func geocodePlace\(([\s\S]*?)\n\}/.exec(go);
  assert.ok(goGeo);
  assert.match(goGeo[1], /User-Agent/);
  assert.match(goGeo[1], /geocodeMinGap/);

  assert.match(csharp, /CLASSDOCK_GEOCODER_URL/);
  assert.match(go, /CLASSDOCK_GEOCODER_URL/);
  assert.doesNotMatch(source, /nominatim\.openstreetmap\.org/);
  assert.match(source, /if \(!proxyBase\) throw new Error\("geocode-launcher-required"\)/);
  // 글자를 칠 때마다가 아니라 Enter 또는 명시적인 검색 버튼에서만 찾는다.
  const search = /function mapAttachPlaceSearch\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(search);
  assert.match(search[1], /if \(e\.key !== "Enter"\) return;/);
  assert.match(search[1], /button\.addEventListener\("click"/);
  assert.match(search[1], /input\.focus\(\);\s*search\(\)/);
  assert.match(search[1], /e\.relatedTarget === button/);
  assert.doesNotMatch(search[1], /addEventListener\("input"/);
  assert.match(source, /class="map-btn map-search-submit"[^>]*>검색<\/button>/);

  // 프록시 확인이 느려도 창을 열자마자 검색할 수 있어야 한다.
  const picker = /async function openMapPicker\(\)([\s\S]*?)\n\}\n\n\/\* ===== 열기/.exec(source);
  assert.ok(picker);
  assert.ok(picker[1].indexOf("mapAttachPlaceSearch(") < picker[1].indexOf("await mapTileProxyBase()"));

  // Leaflet의 컨트롤은 z-index 1000까지 쓴다. 후보 목록이 그 뒤로 숨으면 검색 성공도 무반응처럼 보인다.
  const resultsLayer = /\.map-results\{[^}]*z-index:(\d+)/.exec(styles);
  assert.ok(resultsLayer);
  assert.ok(Number(resultsLayer[1]) > 1000);
});

test("지도 고르기에서 지도를 드래그해도 모달 이동이 함께 시작되지 않는다", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  const ignore = /const IGNORE = "([^"]+)"/.exec(app);
  assert.ok(ignore);
  assert.match(ignore[1], /\.leaflet-container/);
});

test("지도 고르기 창 크기를 바꾸면 Leaflet 영역을 다시 계산하고 닫을 때 감시를 정리한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const picker = /async function openMapPicker\(\)([\s\S]*?)\n\}\n\n\/\* ===== 열기/.exec(source);
  assert.ok(picker);
  assert.match(picker[1], /pickerResizeObserver = new ResizeObserver/);
  assert.match(picker[1], /pickerResizeObserver\.observe\(stage\)/);
  assert.match(picker[1], /map\.invalidateSize\(\{ pan:false, debounceMoveend:true \}\)/);
  assert.match(picker[1], /pickerResizeObserver\.disconnect\(\)/);
  assert.match(picker[1], /cancelAnimationFrame\(resizeFrame\)/);
});

test("인터넷이 없거나 타일이 반복 실패하면 지도 위에 연결 안내를 표시한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const helper = /function mapAttachNetworkNotice\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(helper);
  assert.match(helper[1], /navigator\.onLine !== false/);
  assert.match(helper[1], /failures >= 3/);
  assert.match(helper[1], /window\.addEventListener\("offline", onOffline\)/);
  assert.match(helper[1], /window\.addEventListener\("online", onOnline\)/);
  assert.match(helper[1], /layer\.redraw\(\)/);
  assert.equal((source.match(/= mapAttachNetworkNotice\(stage, map/g) || []).length, 2);
  assert.match(source, /MAP_CAPTURE_HIDDEN_PANES[^\n]*\.map-network-notice/);
  const banner = /\.map-network-notice\{[^}]*z-index:(\d+)/.exec(styles);
  assert.ok(banner);
  assert.ok(Number(banner[1]) > 1000);
});

test("좌표처럼 생긴 입력만 좌표로 읽는다", () => {
  const api = loadMapViewer();
  // vm 안에서 만든 배열은 프로토타입이 달라 strict deepEqual 이 실패한다 — 펼쳐서 비교한다.
  const coords = (text) => { const v = api.mapParseCoords(text); return v ? [...v] : v; };
  assert.deepEqual(coords("37.5665, 126.978"), [37.5665, 126.978]);
  assert.deepEqual(coords("  37.5665   126.978 "), [37.5665, 126.978]);
  assert.deepEqual(coords("99, 200"), [85, 180]);      // 지구 밖은 눌러 담는다
  assert.equal(api.mapParseCoords("경복궁"), null);
  assert.equal(api.mapParseCoords("서울 시청"), null);
  assert.equal(api.mapParseCoords("37.5665"), null);
  assert.equal(api.mapParseCoords(""), null);
});

test("새 지도 파일 이름은 두 번째부터 번호가 붙는다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapScratchFileName(1), "지도.map");
  assert.equal(api.mapScratchFileName(3), "지도 3.map");
  assert.equal(api.mapDocDefaultTitle("지도 3.map"), "지도 3");
});
