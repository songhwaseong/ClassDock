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
      , MAP_KAKAO_CATEGORIES, MAP_REGION_UNKNOWN, MAP_GEOCODE_BATCH_MAX
      , mapKakaoAddressInfo, mapKakaoRegionInfo, mapOsmReverseInfo, mapKakaoCategoryPlaces
      , mapCirclePoints, mapShapeLabelAnchor, mapRegionNameOf, mapRegionTally
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

test("완료하거나 클릭한 면적 영역은 Esc·Delete로 지우고 입력 중에는 보존한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /model\.shapes\.push\(shape\); addShapeLayer\(shape\); selectShape\(shape\)/);
  assert.match(source, /layer\.on\("click", \(\) => selectShape\(shape\)\)/);
  const handler = /function onSelectedShapeKey\(e\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(handler, "onSelectedShapeKey 를 찾지 못했다");
  assert.match(handler[1], /adding \|\| drawingMode/);
  assert.match(handler[1], /input,textarea,select,\[contenteditable\]/);
  for (const key of ["Escape", "Delete", "Backspace"]) assert.ok(handler[1].includes('e.key !== "' + key + '"'));
  assert.match(handler[1], /removeShape\(selectedShape\)/);
  assert.match(source, /window\.removeEventListener\("keydown", onSelectedShapeKey\)/);
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
  for (const route of ["/tile-proxy", "/tile-cache-status", "/tile-cache-clear", "/geocode", "/can-proxy-tiles", "/map-search-key", "/map-search-key-status", "/map-search-provider"]){
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

  const csGeo = /static bool TryFetchGeocode\(([\s\S]*?)\n    \}/.exec(csharp);
  assert.ok(csGeo);
  assert.match(csGeo[1], /request\.UserAgent = "ClassDock/);
  assert.match(csGeo[1], /GeocodeMinIntervalMs/);
  assert.match(csharp, /const int GeocodeMinIntervalMs = 11\d\d;/);

  const goGeo = /func fetchGeocode\(([\s\S]*?)\n\}/.exec(go);
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
  // 입력 중에 도는 것은 최근 검색어를 추리는 일뿐이어야 한다(글자마다 지오코더를 부르지 않는다).
  const onInput = /input\.addEventListener\("input", \(\) => \{([^}]*)\}\)/.exec(search[1]);
  assert.ok(onInput);
  assert.doesNotMatch(onInput[1], /search\(\)|mapGeocode/);
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

test("카카오 주소·키워드 검색은 런처가 REST 키를 붙이고 실패하면 OSM으로 돌아간다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");

  for (const launcher of [csharp, go]){
    assert.match(launcher, /https:\/\/dapi\.kakao\.com\/v2\/local\/search\/address\.json/);
    assert.match(launcher, /https:\/\/dapi\.kakao\.com\/v2\/local\/search\/keyword\.json/);
    assert.match(launcher, /KakaoAK /);
    assert.match(launcher, /kakao-key-required/);
  }
  assert.match(source, /mapFetchGeocode\(q, "kakao-address"\)/);
  assert.match(source, /mapFetchGeocode\(q, "kakao-keyword"\)/);
  assert.match(source, /mapFetchGeocode\(q, "osm"\)/);
  assert.ok(source.indexOf('mapFetchGeocode(q, "kakao-address")') < source.indexOf('mapFetchGeocode(q, "kakao-keyword")'));
  assert.ok(source.indexOf('mapFetchGeocode(q, "kakao-keyword")') < source.indexOf('mapFetchGeocode(q, "osm")'));
  assert.match(source, /raw && Array\.isArray\(raw\.documents\)/);
  assert.match(source, /"\/geocode\?provider=" \+ encodeURIComponent\(provider\)/);
});

test("카카오 REST 키는 브라우저 설정에 남기지 않고 로컬 런처가 보호한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  const state = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  const build = fs.readFileSync(path.join(__dirname, "../desktop/build.bat"), "utf8");

  assert.match(html, /id="settingMapSearchProvider"/);
  assert.match(html, /type="password" id="settingMapSearchKey"/);
  assert.match(html, /Admin 키는 입력하지 마세요/);
  assert.match(state, /mapSearchProvider:\s*"osm"/);
  assert.doesNotMatch(state, /mapSearchKey\s*:/);
  assert.match(app, /fetch\("\/map-search-key\?remember="/);
  assert.match(app, /method:"DELETE"/);
  assert.match(app, /"X-ClassDock-Action":"1"/);
  assert.match(app, /saveAppSettings\(\{ mapSearchProvider:"kakao" \}\)/);
  assert.match(app, /\/map-search-provider\?value=/);

  assert.match(csharp, /ProtectedData\.Protect\([\s\S]*DataProtectionScope\.CurrentUser/);
  assert.match(csharp, /ProtectedData\.Unprotect\([\s\S]*DataProtectionScope\.CurrentUser/);
  assert.match(csharp, /kakao-map-key\.bin/);
  assert.match(csharp, /RequiresLocalAuthToken[\s\S]*\/map-search-key/);
  assert.match(csharp, /KakaoMapKeyStatusJson\(\)[\s\S]*hasKey[\s\S]*remembered[\s\S]*persistentSupported[\s\S]*provider/);
  assert.match(csharp, /map-search-provider\.txt/);
  assert.match(build, /\/r:System\.Security\.dll/);

  assert.match(go, /persistentSupported": false/);
  assert.match(go, /Go 폴백은 OS 키 저장소를 가정할 수 없어 실행 중에만 기억한다/);
});

test("앱 모드와 일반 브라우저가 달라도 런처의 지도 검색 공급자를 동기화한다", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");

  assert.match(app, /status\.provider === "kakao" \|\| status\.provider === "osm"/);
  assert.match(app, /saveAppSettings\(\{ mapSearchProvider:status\.provider \}\)/);
  assert.match(app, /window\.__classDockMapSearchProviderReady = refreshMapSearchKeyStatus\(\)/);
  assert.match(source, /await window\.__classDockMapSearchProviderReady/);
  assert.match(csharp, /SaveMapSearchProvider\("kakao"\)/);
  assert.match(csharp, /SaveMapSearchProvider\("osm"\)/);
  assert.match(csharp, /path\.StartsWith\("\/map-search-provider"/);
  assert.match(go, /setMapSearchProvider\("kakao"\)/);
  assert.match(go, /setMapSearchProvider\("osm"\)/);
});

test("주소 검색은 첫 결과 위치를 즉시 표시하고 임시 표식은 지도 캡처에서 뺀다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const search = /function mapAttachPlaceSearch\(([\s\S]*?)\n\}/.exec(source);
  const mover = /function mapSearchLocationMover\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(search);
  assert.ok(mover);
  assert.match(search[1], /if \(items\.length\) onMove\(items\[0\]\.lat, items\[0\]\.lng, 15, items\[0\]\.name\)/);
  assert.match(search[1], /onMove\(place\.lat, place\.lng, 15, place\.name\)/);
  assert.match(mover[1], /L\.circleMarker/);
  assert.match(mover[1], /fillColor:"#e11d48"/);
  assert.match(source, /MAP_CAPTURE_HIDDEN_PANES[^\n]*\.map-search-location-pane/);
});

test("주변 시설은 갈래 대신 직접 적은 말로도 반경 안을 찾는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const nearby = /async function mapNearbyPlaces\(target, lat, lng, radius\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(nearby);
  // 적은 말이 있으면 키워드 검색, 없으면 갈래 검색 — 기준점·반경·쪽수는 두 길이 같다.
  assert.match(nearby[1], /keyword \? "kakao-keyword" : "kakao-category"/);
  assert.match(nearby[1], /if \(!keyword\) spot\.category = code/);
  assert.match(nearby[1], /slice\(0, MAP_NEARBY_KEYWORD_MAX\)/);
  // 직접 적은 말은 갈래가 아니므로 이름표·색을 그 말로 만든다.
  assert.match(source, /\{ code:"", label:keyword, color:"purple" \}/);
  assert.match(source, /mapNearbyPlaces\(keyword \? \{ keyword \} : \{ code:category\.code \}/);
  assert.match(source, /class="map-input map-nearby-keyword"/);
  // 갈래 칸은 직접 찾기를 적는 순간 흐려져 어느 쪽으로 찾는지 보인다.
  assert.match(source, /categorySelect\.disabled = !!keywordInput\.value\.trim\(\)/);

  // 두 런처 모두 기준점이 있는 키워드 검색은 갈래 검색과 같은 쪽수(15개·page)로 받아야 한다.
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  assert.match(csharp, /bool around = provider == "kakao-keyword" && spot\.HasPoint/);
  assert.match(csharp, /"\?size=" \+ \(around \? "15" : "5"\)/);
  assert.match(csharp, /"&page=" \+ \(spot\.Page\.Length > 0 \? spot\.Page : "1"\)/);
  const goKeyword = /if provider == "kakao-keyword" && spot\.hasPoint\(\) \{([\s\S]*?)\n\t\t\}/.exec(go);
  assert.ok(goKeyword);
  assert.match(goKeyword[1], /values\.Set\("size", "15"\)/);
  assert.match(goKeyword[1], /values\.Set\("page", page\)/);
});

test("지도 문서는 공용 되돌리기 이력을 쓰고 touch() 한 곳에서 기록한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  // 내용이 바뀌는 곳은 모두 touch() 를 부르므로 기록도 거기 한 곳에 건다.
  const touch = /const touch = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(touch);
  assert.match(touch[1], /recordSoon\(\)/);
  assert.match(source, /const recordSoon = \(\) => \{ if \(history && !bulkDepth\) history\.commitSoon\(200\); \};/);
  // 스냅샷 범위 = 저장되는 내용. 보고 있는 자리(중심·확대)는 넣지 않는다.
  const capture = /capture: \(\) => JSON\.stringify\((\[.*imageVersion\])\)/.exec(source);
  assert.ok(capture);
  assert.match(capture[1], /model\.title/);
  assert.match(capture[1], /model\.markers/);
  assert.match(capture[1], /model\.shapes/);
  assert.match(capture[1], /imageVersion/);
  assert.doesNotMatch(capture[1], /model\.center|model\.zoom/);
  // 배경 이미지(dataUrl 수 MB)는 단계마다 복제하지 않고 버전 표에 한 번만 둔다.
  assert.match(source, /const imageVersions = new Map\(\[\[0, model\.backgroundImage \|\| null\]\]\)/);
  assert.equal((source.match(/noteImageChange\(\);/g) || []).length, 2);
  // 단계 수와 총량을 함께 막는다(CSV 로 표시 수천 개가 들어올 수 있다).
  assert.match(source, /limit: MNEditHistory\.LIMITS\.board/);
  assert.match(source, /maxBytes: 24 \* 1024 \* 1024/);
  // 주소 좌표 찾기는 줄마다가 아니라 통째로 한 단계.
  const geocode = /const runPendingGeocode = async \(pending\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(geocode);
  assert.match(geocode[1], /bulkDepth\+\+/);
  assert.match(geocode[1], /bulkDepth--;\s*\n\s*recordSoon\(\);/);
  // 입력칸 안에서는 브라우저의 글자 되돌리기를 그대로 둔다.
  const key = /function onHistoryKey\(e\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(key);
  assert.match(key[1], /closest\("input,textarea,select,\[contenteditable='true'\]"\)\) return/);
  assert.match(key[1], /if \(e\.shiftKey\) history\.redo\(\); else history\.undo\(\)/);
  assert.match(source, /window\.removeEventListener\("keydown", onHistoryKey\)/);
  assert.match(source, /if \(history\) history\.cancel\(\)/);
});

test("주변 시설로 넣은 표시·반경 원은 꼬리표를 달고 묶음째 되돌리거나 지운다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  // 꼬리표는 .map 에 함께 저장된다(정규화에 들어 있어야 옛 파일도 빈 값으로 열린다).
  const marker = /function mapNormalizeMarker\(raw\)\{([\s\S]*?)\n\}/.exec(source);
  const shape = /function mapNormalizeShape\(raw\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(marker); assert.ok(shape);
  for (const normalize of [marker[1], shape[1]]){
    assert.match(normalize, /source: mapNormalizeSource\(value\.source\)/);
    assert.match(normalize, /batch: mapNormalizeBatch\(value\.batch\)/);
  }
  assert.match(source, /function mapNormalizeSource\(value\)\{[\s\S]*?\/\^\[a-z\]\{1,12\}\$\//);
  // 주변 시설은 표시와 반경 원에 같은 묶음 번호를 단다.
  // 도구막대(화면 가운데)와 우클릭 메뉴(누른 자리)가 같은 runNearby 를 타므로 여기 한 곳만 본다.
  const nearby = /const runNearby = async \(at, opts = \{\}\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(nearby);
  assert.match(source, /nearbyBtn\.addEventListener\("click", \(\) => runNearby\(map\.getCenter\(\)\)\)/);
  assert.match(nearby[1], /const batch = mapBatchId\(\)/);
  assert.equal((nearby[1].match(/source:"nearby", batch/g) || []).length, 2);
  assert.match(nearby[1], /action:\{ label:mapT\("되돌리기"\)/);
  assert.match(nearby[1], /removeTagged\(item => item\.batch === batch\)/);
  // 지우기: 좁게 지우는 쪽(주변 시설만)이 Enter 기본값인 ok 자리에 온다.
  const clear = /clearItemsBtn\.addEventListener\("click", async \(\) => \{([\s\S]*?)\n  \}\);/.exec(source);
  assert.ok(clear);
  assert.match(clear[1], /confirmDialog\(message,\s*\n?\s*mapTf\("주변 시설로 넣은 것만[^)]*\)[\s\S]*?altText:allText/);
  assert.match(clear[1], /if \(answer === "ok"\) announceRemoved\(removeTagged\(isNearbyItem\)\)/);
  assert.match(clear[1], /else if \(answer === "alt"\) announceRemoved\(removeTagged\(\(\) => true\)\)/);
  // 손으로 찍은 표시는 꼬리표가 없으므로 '주변 시설만' 에 휩쓸리지 않는다.
  assert.match(source, /const isNearbyItem = \(item\) => item\.source === "nearby"/);
});

test("지도 우클릭 메뉴는 누른 자리를 기준으로 열리고 도구막대와 같은 함수를 부른다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const open = /map\.on\("contextmenu", \(e\) => \{([\s\S]*?)\n  \}\);/.exec(source);
  assert.ok(open);
  // 마커·도형에서 올라온 우클릭과 그리는 중의 우클릭은 여기서 가로채지 않는다.
  assert.match(open[1], /if \(e\.propagatedFrom\) return;/);
  assert.match(open[1], /if \(adding \|\| drawingMode\) return;/);
  // 누른 자리는 지구 밖으로 나가지 않게 눌러 두고, 메뉴 머리말에 그대로 보여 준다.
  assert.match(open[1], /contextLatLng = L\.latLng\(mapClampLat\(e\.latlng\.lat\), mapClampLng\(e\.latlng\.lng\)\)/);
  // 카카오 검색을 껐으면 도구막대와 똑같이 감춘다(눌러도 안 되는 항목을 두지 않는다).
  assert.match(open[1], /contextNearbyBtn\.hidden = nearbyBtn\.hidden/);
  // 메뉴 문구는 도구막대처럼 만들 때 한 번만 훑는다(언어 전환은 i18n 이 되돌려 그린다).
  assert.match(source, /document\.body\.appendChild\(contextMenu\);\n[\s\S]{0,120}?mapTranslate\(contextMenu\);/);
  // 실행은 도구막대와 같은 함수 — 되돌리기 기록이 두 갈래로 갈라지지 않는다.
  assert.match(source, /runNearby\(at, \{ atPoint:true \}\)/);
  assert.match(source, /if \(autoAddress\) fillMarkerAddress\(marker, \{ onlyEmpty:true, quiet:true \}\)[\s\S]*?contextNearbyBtn/);
  assert.match(source, /Math\.min\(map\.getZoom\(\) \+ 1, maxViewZoom\(\)\)/);
  // 열고 닫을 때 문서에 건 리스너를 짝 맞춰 뗀다.
  const close = /function closeContextMenu\(\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(close);
  assert.match(close[1], /document\.removeEventListener\("pointerdown", onContextOutside, true\)/);
  assert.match(close[1], /window\.removeEventListener\("keydown", onContextKey, true\)/);
  assert.match(close[1], /map\.off\("movestart zoomstart", closeContextMenu\)/);
  const cleanup = /doc\.cleanupFns\.push\(\(\) => \{([\s\S]*?)\n  \}\);/.exec(source);
  assert.match(cleanup[1], /closeContextMenu\(\);/);
  assert.match(cleanup[1], /contextMenu\.remove\(\)/);
  assert.match(styles, /\.map-context-menu\{/);
  assert.match(styles, /\.map-context-menu\[hidden\]\{display:none\}/);
  /* 확대 버튼 위 우클릭은 브라우저 기본 메뉴만 막는다. Leaflet 이 컨트롤에서 전파를 끊으므로
     버블 단계로는 오지 않는다 — 캡처(true)로 걸어야 잡힌다. */
  const guard = /stage\.addEventListener\("contextmenu", \(e\) => \{([\s\S]*?)\n  \}, true\);/.exec(source);
  assert.ok(guard, "확대 버튼 우클릭 가드는 캡처 단계여야 한다");
  assert.match(guard[1], /closest\("\.leaflet-control-zoom"\)\) e\.preventDefault\(\)/);
});

test("우클릭 메뉴의 도구 항목은 도구막대 단추를 그대로 비춘다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  // 누르면 그 단추를 누른다 — 실행 경로가 갈라지지 않으니 되돌리기 기록도 한 갈래다.
  const mirror = /const contextMirror = \(button, label\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(mirror);
  assert.match(mirror[1], /closeContextMenu\(\); button\.click\(\);/);
  // 이름·설명·꺼짐·숨김·켜짐은 열 때마다 단추에서 읽어 온다(따로 들지 않는다).
  const sync = /const syncContextMirrors = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(sync);
  assert.match(sync[1], /if \(!mirror\.fixedLabel\) mirror\.item\.textContent = mirror\.button\.textContent/);
  assert.match(sync[1], /mirror\.item\.hidden = !!mirror\.button\.hidden/);
  assert.match(sync[1], /mirror\.item\.disabled = !!mirror\.button\.disabled/);
  assert.match(sync[1], /classList\.toggle\("is-on", mirror\.button\.classList\.contains\("is-on"\)\)/);
  assert.match(source, /syncContextMirrors\(\);\n\s*contextMenu\.hidden = false;/);
  // 지우기·되돌리기·저장까지 수업 중에 쓰는 도구가 메뉴에 함께 있다.
  for (const button of ["lineBtn", "areaBtn", "addressBtn", "clearItemsBtn", "regionBtn", "boardBtn", "saveBtn"])
    assert.match(source, new RegExp("contextMirror\\(" + button + "\\)"), button + " 미러 항목이 없다");
  // 화살표뿐인 단추는 메뉴용 이름을 따로 주고, 그 이름도 영어 사전에 있어야 한다.
  for (const label of ["↶ 되돌리기 (Ctrl+Z)", "↷ 다시 실행 (Ctrl+Shift+Z)"])
    assert.ok(i18n.includes('"' + label + '"'), label + " 사전 항목이 없다");
  assert.match(source, /contextMirror\(undoBtn, "↶ 되돌리기 \(Ctrl\+Z\)"\)/);
  assert.match(source, /contextMirror\(redoBtn, "↷ 다시 실행 \(Ctrl\+Shift\+Z\)"\)/);
  // 항목이 늘었으므로 작은 화면에서도 메뉴가 화면 밖으로 흘러넘치지 않아야 한다.
  assert.match(styles, /\.map-context-menu\{[\s\S]*?max-height:calc\(100vh - 16px\);overflow-y:auto/);
  assert.match(styles, /\.map-context-menu button\.is-on::after\{content:"✓"/);
});

test("최근 검색어는 최신순 8개까지 중복 없이 남고 성공한 검색만 기록한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /const MAP_SEARCH_HISTORY_KEY = "mn\.mapSearchHistory"/);
  assert.match(source, /const MAP_SEARCH_HISTORY_MAX = 8/);
  const remember = /function mapRememberSearch\(text\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(remember);
  // 같은 말을 또 찾으면 줄이 늘지 않고 맨 위로만 올라간다.
  assert.match(remember[1], /filter\(item => item\.toLowerCase\(\) !== key\)/);
  assert.match(remember[1], /slice\(0, MAP_SEARCH_HISTORY_MAX\)/);
  const search = /const search = async \(\) =>([\s\S]*?)\n  \};/.exec(source);
  assert.ok(search);
  // 못 찾은 검색어는 기록하지 않는다(빈 결과로 빠져나간 뒤에 기록한다).
  const notFound = search[1].indexOf("그런 이름의 장소를 찾지 못했어요");
  const remembered = search[1].indexOf("mapRememberSearch(text);\n      showResults(places)");
  assert.ok(notFound > 0 && remembered > notFound);
});

test("검색란을 누르면 최근 검색어를 펼치고 화살표·Enter 로 고를 수 있다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const attach = /function mapAttachPlaceSearch\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(attach);
  assert.match(attach[1], /input\.addEventListener\("focus", openHistory\)/);
  assert.match(attach[1], /input\.addEventListener\("click", openHistory\)/);
  assert.match(attach[1], /input\.addEventListener\("input", \(\) => \{ cancelPendingClose\(\); showHistory\(\); \}\)/);
  // 치는 중에는 그 글자가 든 기록만 남긴다.
  assert.match(attach[1], /history = mapSearchHistory\(\)\.filter\(item => !typed \|\| item\.toLowerCase\(\)\.includes\(typed\)\)/);
  assert.match(attach[1], /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/);
  assert.match(attach[1], /moveActive\(e\.key === "ArrowDown" \? 1 : -1\)/);
  assert.match(attach[1], /if \(active >= 0 && options\[active\]\) options\[active\]\.click\(\)/);
  // 한 줄 지우기·전체 지우기
  assert.match(attach[1], /mapForgetSearch\(query\)/);
  assert.match(attach[1], /mapClearSearchHistory\(\)/);
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(css, /\.map-result\.is-current\{background:var\(--panel-hover\)\}|\.map-result:hover,\.map-result\.is-current\{background:var\(--panel-hover\)\}/);
  assert.match(css, /\.map-result-row\{display:flex/);
});

test("검색 표식은 지도를 눌러도 남고 Esc 로만 지운다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const mover = /function mapSearchLocationMover\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(mover);
  // permanent 가 빠지면 Leaflet 이 지도 클릭마다 말풍선을 닫아 버리고, 점은 클릭을 받지 않아 다시 못 연다.
  assert.match(mover[1], /bindTooltip\([^\n]*permanent:true/);
  assert.match(mover[1], /move\.clear = \(\) =>/);
  const key = /function onSearchLocationKey\(e\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(key);
  assert.match(key[1], /e\.key !== "Escape" \|\| e\.defaultPrevented/);
  assert.match(key[1], /if \(adding \|\| drawingMode \|\| selectedShape\) return/);
  assert.match(key[1], /moveToSearchLocation\.clear\(\)/);
  assert.match(source, /window\.addEventListener\("keydown", onSearchLocationKey\)/);
  assert.match(source, /window\.removeEventListener\("keydown", onSearchLocationKey\)/);
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

/* ===== 주소 CSV 일괄 지오코딩 ===== */

/* 학교에서 만드는 표는 좌표가 아니라 주소만 있는 쪽이 훨씬 흔하다. 그런 표를 "쓸 수 없는 CSV"로
   되돌리면 기능 전체가 무용지물이 되므로, 찾아야 할 줄로 넘겨받는 것이 이 기능의 전부다. */
test("좌표 없이 주소만 있는 CSV도 받아 찾을 줄로 돌려준다", () => {
  const api = loadMapViewer();
  const parsed = api.mapMarkersFromCsv('이름,주소,메모\r\n시청,서울특별시 중구 세종대로 110,답사 시작\r\n');
  assert.equal(parsed.markers.length, 0);
  assert.equal(parsed.pending.length, 1);
  assert.equal(parsed.pending[0].query, "서울특별시 중구 세종대로 110");
  assert.equal(parsed.pending[0].label, "시청");
  assert.equal(parsed.pending[0].note, "답사 시작");

  // 좌표가 있는 줄과 주소만 있는 줄이 섞여 있어도 각각 제 갈래로 간다.
  const mixed = api.mapMarkersFromCsv('이름,위도,경도,주소\r\n학교,37.5,127.0,\r\n시청,,,서울시청\r\n');
  assert.equal(mixed.markers.length, 1);
  assert.equal(mixed.pending.length, 1);
  assert.equal(mixed.pending[0].query, "서울시청");

  // 주소도 좌표도 없이 이름만 있으면 이름으로 찾아본다("경복궁").
  const nameOnly = api.mapMarkersFromCsv('이름,주소\r\n경복궁,\r\n');
  assert.equal(nameOnly.pending[0].query, "경복궁");
});

/* 좌표를 적었는데 999 같은 오타면 그건 자료 오류다. 이름을 장소로 착각해 검색을 부르면
   수업 중에 엉뚱한 자리에 표시가 생긴다 — 예전처럼 조용히 제외해야 한다. */
test("좌표 칸을 채웠지만 값이 잘못된 줄은 검색하지 않고 제외한다", () => {
  const api = loadMapViewer();
  const parsed = api.mapMarkersFromCsv('이름,위도,경도\r\n학교,37.5,127.0\r\n오류,999,127\r\n');
  assert.equal(parsed.markers.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.pending.length, 0);
  // 좌표 칸을 아예 비운 줄은 (0, 0) 표시가 아니라 찾을 줄이 된다.
  const blank = api.mapMarkersFromCsv('이름,위도,경도,주소\r\n시청,,,서울시청\r\n');
  assert.equal(blank.markers.length, 0);
  assert.equal(blank.pending[0].query, "서울시청");
});

test("위도·경도도 주소도 없는 CSV만 형식 오류로 되돌린다", () => {
  const api = loadMapViewer();
  assert.throws(() => api.mapMarkersFromCsv('이름,메모\r\n학교,여기\r\n'), /csv-columns/);
});

test("한 번에 찾는 주소는 상한을 넘기지 않는다", () => {
  const api = loadMapViewer();
  const rows = ["이름,주소"];
  for (let i = 0; i < api.MAP_GEOCODE_BATCH_MAX + 25; i++) rows.push("자리" + i + ",서울시 " + i + "로");
  const parsed = api.mapMarkersFromCsv(rows.join("\r\n") + "\r\n");
  assert.equal(parsed.pending.length, api.MAP_GEOCODE_BATCH_MAX);
  assert.equal(parsed.skipped, 25);
});

test("CSV 내보내기·들이기는 시도·시군구까지 왕복한다", () => {
  const api = loadMapViewer();
  const marker = api.mapNormalizeMarker({ lat:37.5665, lng:126.978, label:"시청", region:"서울특별시", district:"중구" });
  const back = api.mapMarkersFromCsv(api.mapMarkersToCsv([marker]));
  assert.equal(back.markers[0].region, "서울특별시");
  assert.equal(back.markers[0].district, "중구");
  // 지역이 없던 옛 .map 도 그대로 열린다(빈 문자열로 시작).
  const old = api.mapDocParse(JSON.stringify({
    type:"classdock-map", version:2, markers:[{ lat:37, lng:127, label:"옛 표시" }]
  }));
  assert.equal(old.markers[0].region, "");
  assert.equal(old.markers[0].district, "");
});

/* ===== 좌표 → 주소·행정구역 ===== */

test("카카오·OSM의 서로 다른 응답을 같은 모양의 자리 정보로 읽는다", () => {
  const api = loadMapViewer();
  const kakao = api.mapKakaoAddressInfo({ documents:[{
    road_address:{ address_name:"서울 중구 세종대로 110", building_name:"서울시청", region_1depth_name:"서울", region_2depth_name:"중구" },
    address:{ address_name:"서울 중구 태평로1가 31" }
  }] });
  assert.equal(kakao.name, "서울시청");
  assert.equal(kakao.region, "서울");
  assert.equal(kakao.district, "중구");

  const region = api.mapKakaoRegionInfo({ documents:[
    { region_type:"B", region_1depth_name:"서울특별시", region_2depth_name:"중구", region_3depth_name:"태평로1가" },
    { region_type:"H", region_1depth_name:"서울특별시", region_2depth_name:"중구", region_3depth_name:"명동" }
  ] });
  assert.equal(region.town, "명동", "수업에서 쓰는 이름은 행정동(H) 쪽이다");

  const osm = api.mapOsmReverseInfo({ name:"서울특별시청", display_name:"서울특별시청, 세종대로",
    address:{ road:"세종대로", city:"서울특별시", borough:"중구", state:"서울특별시" } });
  assert.equal(osm.name, "서울특별시청");
  assert.equal(osm.region, "서울특별시");
  // 시도와 시군구가 같은 이름으로 오면(특별시) 한 단계 아래를 시군구로 쓴다.
  assert.equal(osm.district, "중구");

  assert.equal(api.mapKakaoAddressInfo({ documents:[] }), null);
  assert.equal(api.mapOsmReverseInfo({}), null);
});

/* ===== 반경 안 시설 ===== */

test("카카오 카테고리 응답에서 좌표가 성한 장소만 표시로 쓴다", () => {
  const api = loadMapViewer();
  const places = api.mapKakaoCategoryPlaces({ documents:[
    { place_name:"○○초등학교", x:"127.0", y:"37.5", road_address_name:"○○로 1", distance:"320" },
    { place_name:"좌표 없음", x:"", y:"" },
    { place_name:"", x:"127.1", y:"37.6" }
  ] });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "○○초등학교");
  assert.equal(places[0].distance, 320);
});

/* 지도 모델에는 원이 없다. 반경을 눈에 보이게 하려고 다각형으로 만드는데, 그 다각형이 실제
   반경·넓이와 맞지 않으면 "반경 1km 원의 넓이"를 그대로 읽는 수업이 틀린 값을 가르치게 된다. */
test("반경 원은 실제 반경과 넓이(πr²)에 맞는 다각형으로 만든다", () => {
  const api = loadMapViewer();
  const points = api.mapCirclePoints(37.5, 127.0, 1000, 72);
  assert.equal(points.length, 72);
  for (const point of points){
    const meters = api.mapDistanceMeters([37.5, 127.0], point);
    assert.ok(Math.abs(meters - 1000) < 20, "반경에서 " + Math.round(meters) + "m 떨어졌다");
  }
  const area = api.mapPolygonAreaSquareMeters(points);
  const circle = Math.PI * 1000 * 1000;
  assert.ok(Math.abs(area - circle) / circle < 0.01);
  // 기본 꼭짓점 수가 적으면 크게 확대했을 때 변이 눈에 띄어 원이 삐뚤삐뚤해 보인다.
  assert.equal(api.mapCirclePoints(37.5, 127.0, 1000).length, 120);
  // 반경 원의 이름표는 한가운데(정작 보려는 곳)를 덮지 않도록 위쪽 테두리에 둔다.
  const radiusCircle = { type:"area", source:"nearby", points:api.mapCirclePoints(37.5, 127.0, 1000) };
  const anchor = api.mapShapeLabelAnchor(radiusCircle);
  assert.ok(anchor);
  assert.ok(anchor[0] > 37.5, "위쪽 테두리라 중심보다 북쪽이다");
  assert.ok(Math.abs(anchor[1] - 127.0) < 0.0001, "좌우로는 가운데다");
  assert.ok(Math.abs(api.mapDistanceMeters([37.5, 127.0], anchor) - 1000) < 20);
  // 손으로 그린 영역은 지금까지처럼 한가운데에 둔다.
  assert.equal(api.mapShapeLabelAnchor({ type:"area", source:"", points:radiusCircle.points }), null);
  // Leaflet 기본 smoothFactor 는 점을 픽셀 기준으로 솎아 낸다 — 원이 찌그러지고 찍은 꼭짓점도 사라진다.
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const addShape = /const addShapeLayer = \(shape\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(addShape);
  assert.match(addShape[1], /smoothFactor:0/);
  // 이름표 자리는 레이어를 지도에 붙인 뒤에 옮겨야 한다(붙기 전에는 말풍선이 뜨지 않는다).
  assert.ok(addShape[1].indexOf("layer.addTo(map)") < addShape[1].indexOf("layer.openTooltip(anchor)"));
  assert.match(addShape[1], /direction:\(shape\.type === "area" && !anchor\) \? "center" : "top"/);
  assert.match(source, /dashArray:"7 6", fillOpacity:0\.12, smoothFactor:0/);
});

test("카카오 갈래 목록은 코드·색이 모두 성하다", () => {
  const api = loadMapViewer();
  assert.ok(api.MAP_KAKAO_CATEGORIES.length >= 8);
  const colors = api.MAP_MARKER_COLORS.map(color => color.id);
  for (const item of api.MAP_KAKAO_CATEGORIES){
    assert.match(item.code, /^[A-Z]{2}[0-9]$/, item.code);
    assert.ok(colors.includes(item.color), item.label + " 의 색 " + item.color);
  }
});

/* ===== 지역별 개수 ===== */

test("지역별 개수는 많은 곳부터 세고 '지역 없음'은 언제나 맨 뒤에 둔다", () => {
  const api = loadMapViewer();
  const markers = [
    { region:"경기도", district:"수원시" },
    { region:"경기도", district:"수원시" },
    { region:"서울특별시", district:"중구" },
    { region:"", district:"" }
  ].map(api.mapNormalizeMarker);
  const byDistrict = api.mapRegionTally(markers, "district").map(row => [row.label, row.count]);
  assert.deepEqual(byDistrict[0], ["수원시", 2]);
  assert.deepEqual(byDistrict[byDistrict.length - 1], [api.MAP_REGION_UNKNOWN, 1]);

  const byRegion = api.mapRegionTally(markers, "region").map(row => [row.label, row.count]);
  assert.deepEqual(byRegion[0], ["경기도", 2]);

  // 시군구가 비면 시도라도 쓴다(세종·제주처럼 한 단계인 곳이 있다).
  const oneLevel = api.mapNormalizeMarker({ region:"세종특별자치시", district:"" });
  assert.equal(api.mapRegionNameOf(oneLevel, "district"), "세종특별자치시");
  assert.equal(api.mapRegionNameOf(api.mapNormalizeMarker({}), "district"), "");
});

/* 세는 것으로 끝나면 지도와 통계가 따로 논다. 이 앱의 값은 지도 → 칠판 차트가 한 흐름이라는
   점이므로, 칠판 쪽 훅과 지도 쪽 호출이 함께 있어야 한다. */
test("지역별 개수는 칠판의 자료 차트 훅으로 이어진다", () => {
  const board = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const hook = /doc\.insertBoardChart = \(spec\) => \{([\s\S]*?)\n  \};/.exec(board);
  assert.ok(hook, "insertBoardChart 훅을 찾지 못했다");
  assert.match(hook[1], /MNBoardTools\.chartGroup/);
  assert.match(hook[1], /placeBoardGroup\(group\)/);
  // 그림이 아니라 그룹으로 넣어야 칠판에서 다시 고치고 되돌릴 수 있다.
  assert.doesNotMatch(hook[1], /insertBoardImage|toDataURL/);
  assert.match(source, /boardDoc\.insertBoardChart\(\{/);
  assert.match(source, /rows: rows\.map\(row => \(\{ label:row\.label, values:\[row\.count\] \}\)\)/);
});

/* ===== 카카오 확장 API의 계약 ===== */

/* 런처가 둘이라 한쪽만 늘리면 그 기능이 조용히 한쪽에서만 동작한다(타일 허용 목록과 같은 함정). */
test("두 런처가 같은 카카오 Local API 엔드포인트를 갖춘다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  for (const launcher of [csharp, go]){
    assert.match(launcher, /https:\/\/dapi\.kakao\.com\/v2\/local\/search\/category\.json/);
    assert.match(launcher, /https:\/\/dapi\.kakao\.com\/v2\/local\/geo\/coord2address\.json/);
    assert.match(launcher, /https:\/\/dapi\.kakao\.com\/v2\/local\/geo\/coord2regioncode\.json/);
    for (const provider of ["kakao-category", "kakao-coord2address", "kakao-coord2region", "osm-reverse"]){
      assert.ok(launcher.includes('"' + provider + '"'), provider);
    }
  }
});

/* 브라우저가 보낸 값을 그대로 주소에 붙이면 남의 서버로 보내는 요청을 만들 수 있다.
   좌표·반경·갈래는 런처에서 숫자·코드 꼴만 통과시킨다. */
test("좌표로 부르는 요청은 런처가 숫자·코드 꼴만 통과시킨다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  const csSpot = /static GeocodeSpot ReadGeocodeSpot\(([\s\S]*?)\n    \}/.exec(csharp);
  assert.ok(csSpot);
  assert.match(csSpot[1], /GeocodeNumber\(QueryValue\(path, "x"\), -180, 180\)/);
  assert.match(csSpot[1], /GeocodeNumber\(QueryValue\(path, "y"\), -85, 85\)/);
  assert.match(csSpot[1], /GeocodeNumber\(QueryValue\(path, "radius"\), 1, 20000\)/);
  const goSpot = /func readGeocodeSpot\(([\s\S]*?)\n\}/.exec(go);
  assert.ok(goSpot);
  assert.match(goSpot[1], /geocodeNumber\(query\.Get\("x"\), -180, 180\)/);
  assert.match(goSpot[1], /geocodeNumber\(query\.Get\("radius"\), 1, 20000\)/);
  // 기준점 없이 부르면 검색어 대신 오류를 돌려준다.
  assert.match(csharp, /geocode-bad-point/);
  assert.match(go, /geocode-bad-point/);
  assert.match(csharp, /geocode-bad-category/);
  assert.match(go, /geocode-bad-category/);
});

/* 카카오에만 있는 기능은 OSM 폴백이 없다. 꺼 둔 채로 버튼만 보이면 눌러도 안 되는 단추가 된다. */
test("주변 시설은 카카오를 켰을 때만 화면에 내놓고 주소 확인은 OSM으로도 돌아간다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /nearbyBtn\.hidden = true/);
  assert.match(source, /mapProviderIsKakao\(\)\.then\(\(kakao\) => \{ nearbyBtn\.hidden = !kakao; \}\)/);
  const nearby = /async function mapNearbyPlaces\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(nearby);
  assert.match(nearby[1], /throw new Error\("kakao-required"\)/);
  // 반대로 주소·행정구역은 OSM 역지오코딩으로 대신할 수 있어야 두 기능이 모두에게 열린다.
  const info = /async function mapPlaceInfoAt\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(info);
  assert.match(info[1], /"kakao-coord2region"/);
  assert.match(info[1], /"osm-reverse"/);
  assert.ok(info[1].indexOf("kakao-coord2address") < info[1].indexOf("osm-reverse"), "카카오를 먼저 보고 OSM 으로 돌아간다");
});

/* 표시 하나마다 한 번씩 부르는 길이라, 같은 자리를 다시 물으면 그만큼 남의 서버를 두드린다. */
test("좌표로 물어본 자리 정보는 캐시해 같은 자리를 두 번 묻지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const info = /async function mapPlaceInfoAt\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(info);
  assert.match(info[1], /_mapPlaceInfoCache\.has\(cacheKey\)/);
  assert.match(info[1], /_mapPlaceInfoCache\.set\(cacheKey, info\)/);
  // 한 줄씩 차례로 찾는다 — 한꺼번에 던지면 공급자 쪽 초당 제한에 걸린다.
  const batch = /async function mapResolvePendingMarkers\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(batch);
  assert.doesNotMatch(batch[1], /Promise\.all|Promise\.allSettled/);
  assert.match(batch[1], /shouldStop\(\)/);
  assert.match(batch[1], /message === "geocode-launcher-required"\) throw error/);
});

test("새 지도 파일 이름은 두 번째부터 번호가 붙는다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapScratchFileName(1), "지도.map");
  assert.equal(api.mapScratchFileName(3), "지도 3.map");
  assert.equal(api.mapDocDefaultTitle("지도 3.map"), "지도 3");
});
