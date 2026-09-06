"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMapViewer(windowOverrides){
  const context = {
    console, Blob, URL, Map, Set, Date, Math, JSON,
    setTimeout, clearTimeout,
    document:{}, window:Object.assign({}, windowOverrides || {}), location:{ protocol:"file:" }, navigator:{ onLine:true }
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
      , mapCsvRows, mapCsvLooksLikeTimeline, mapTimelineEventsToPending
      , mapMarkersFromCsv, mapMarkersToCsv, mapMarkersToRows, mapMarkersToMemoRows
      , mapGeoJsonImport, mapGeoJsonExport, mapGpxImport, mapGpxExport, mapKmlImport, mapKmlExport
      , mapPointInPolygon, mapMarkersInArea, mapClusterPixelGroups, mapKakaoRoadviewUrl, mapOpenKakaoRoadview
      , MAP_ROADVIEW_WINDOW_NAME, MAP_ROADVIEW_WINDOW_FEATURES, MAP_GEO_IMPORT_MAX_ITEMS
      , MAP_KAKAO_CATEGORIES, MAP_REGION_UNKNOWN, MAP_GEOCODE_BATCH_MAX
      , mapKakaoPlaces, mapKakaoAddressInfo, mapKakaoRegionInfo, mapOsmReverseInfo, mapKakaoCategoryPlaces
      , mapKakaoSpotPlaces, mapKakaoCategoryTail, mapKakaoPlaceUrl, mapKakaoPlaceSlides, MAP_SPOT_MIN_ZOOM
      , mapCirclePoints, mapShapeLabelAnchor, mapRegionNameOf, mapRegionTally
      , MAP_SEARCH_MENU_LABEL, MAP_SEARCH_TEXT_MAX, MAP_SEARCH_QUERY_MAX, mapSearchTextFrom, mapSearchQueryFrom, mapSearchMenuItem
      , mapNiceScaleMeters, mapGridStep, mapGridValues, mapGridLabel, mapSourceLabel
      , MAP_GRID_STEPS, MAP_GRID_MAX_LINES, MAP_DOC_VERSION
      , mapNormalizePhoto, mapPhotoTotalChars, MAP_PHOTO_MAX_DATA_CHARS, MAP_PHOTO_TOTAL_MAX_CHARS
      , MAP_SEARCH_RESULT_MAX, MAP_LABEL_MIN_ZOOM, MAP_LABEL_MAX_MARKERS
      , MAP_ROUTE_TANGLE_MARKERS, MAP_ROUTE_COLOR
      , MAP_DRIVE_MAX_MARKERS, MAP_DRIVE_COLOR, MAP_DRIVE_CACHE_MAX
      , MAP_DRIVE_PRIORITIES, MAP_DRIVE_AVOIDS, MAP_DRIVE_FUELS, mapNormalizeDriveOptions
      , MAP_DRIVE_TRAFFIC, mapDriveTrafficInfo, mapOptimizeDriveOrder, mapDriveOrderedItems, mapSampleRoutePoints
      , mapFormatDuration, mapDirectionsSpot, mapDirectionsRoute, mapDirectionsRoutes, mapDriveGuide
      , MAP_NEARBY_MAX_KINDS, MAP_NEARBY_TOTAL_CHOICES, MAP_NEARBY_DEFAULT_TOTAL
      , MAP_NEARBY_MAX_PER_KIND, mapNearbyKindLimits, mapNearbyKindColors
    };`, context);
  return context.__map;
}

/* 지도 편집기는 정리(cleanupFns)를 여러 덩어리로 나눠 등록한다 — Leaflet·우클릭 메뉴·복구본
   타이머가 각자 자기 것을 걷는다. 어느 덩어리를 보는지 시험마다 골라 쓰라고 모아서 돌려준다. */
function mapCleanupBodies(source){
  return [...source.matchAll(/doc\.cleanupFns\.push\(\(\) => \{([\s\S]*?)\n  \}\);/g)].map(match => match[1]);
}

test(".map은 같은 모델을 항상 같은 JSON으로 직렬화하고 장소 상세 주소까지 그대로 되읽는다", () => {
  const api = loadMapViewer();
  const model = api.mapDocEmpty("우리 동네");
  model.markers.push(api.mapNormalizeMarker({
    lat:37.5665, lng:126.978, label:"학교", color:"blue",
    address:"서울 중구 세종대로 110", phone:"02-120", category:"공공기관 > 시청",
    roadAddress:"서울 중구 세종대로 110", lotAddress:"서울 중구 태평로1가 31",
    placeUrl:"http://place.map.kakao.com/26338954/"
  }));
  const first = api.mapDocSerialize(model);
  assert.equal(first, api.mapDocSerialize(model));
  const back = api.mapDocParse(first);
  assert.equal(back.title, "우리 동네");
  assert.equal(back.markers.length, 1);
  assert.equal(back.markers[0].label, "학교");
  assert.equal(back.markers[0].color, "blue");
  assert.equal(back.markers[0].address, "서울 중구 세종대로 110");
  assert.equal(back.markers[0].phone, "02-120");
  assert.equal(back.markers[0].category, "공공기관 > 시청");
  assert.equal(back.markers[0].roadAddress, "서울 중구 세종대로 110");
  assert.equal(back.markers[0].lotAddress, "서울 중구 태평로1가 31");
  assert.equal(back.markers[0].placeUrl, "https://place.map.kakao.com/26338954");
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
  assert.equal(api.mapNormalizeMarker({ placeUrl:"https://evil.example/26338954" }).placeUrl, "");
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

test("연대표 CSV를 지도 CSV보다 먼저 판별하고 사건 정보를 주소 검색 표시로 바꾼다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapCsvLooksLikeTimeline(
    "시작,종료,제목,분류,유적지,유적지 주소,설명,색상\r\n1945-08-15,,광복,현대,대한민국역사박물관,서울 종로구 세종대로 198,해방,rose\r\n"), true);
  assert.equal(api.mapCsvLooksLikeTimeline(
    "이름,위도,경도,주소\r\n시청,37.5,127,서울시청\r\n"), false);

  const photo = { name:"광복.jpg", dataUrl:"data:image/jpeg;base64,AA==", width:10, height:8 };
  const converted = api.mapTimelineEventsToPending([
    { title:"광복", start:"1945-08-15", category:"현대", placeName:"대한민국역사박물관",
      placeAddress:"서울 종로구 세종대로 198", description:"해방", color:"rose", image:photo },
    { title:"정부 수립", start:"1948-08-15", placeName:"서울광장", color:"blue" },
    { title:"장소 없는 사건", start:"1950", description:"지도에서는 제외" }
  ]);
  assert.equal(converted.pending.length, 2);
  assert.equal(converted.noPlace, 1);
  assert.equal(converted.overLimit, 0);
  assert.equal(converted.pending[0].query, "서울 종로구 세종대로 198");
  assert.equal(converted.pending[0].label, "광복");
  assert.equal(converted.pending[0].color, "red");
  assert.equal(converted.pending[0].source, "timeline");
  assert.equal(converted.pending[0].photo, photo);
  assert.match(converted.pending[0].note, /1945-08-15[\s\S]*현대[\s\S]*대한민국역사박물관[\s\S]*해방/);
  assert.equal(converted.pending[1].query, "서울광장");
});

test("지도 자료 들이오기는 표와 키 없는 지도 파일 공용 해석기를 연결한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /csvImportBtn\.textContent = "자료 들이기"/);
  assert.match(source, /csvInput\.accept = "\.csv,\.xlsx,\.geojson,\.json,\.gpx,\.kml,/);
  assert.match(source, /isSheet \|\| mapCsvLooksLikeTimeline\(csvText\)/);
  assert.match(source, /globalThis\.timelineEventsFromXlsx/);
  assert.match(source, /globalThis\.timelineEventsFromCsv/);
  assert.match(source, /timelineApi\.sorted\(result\.events\)/);
  assert.match(source, /runPendingGeocode\(imported\.pending, timelineOptions \|\| \{\}\)/);
  assert.match(source, /mapGeoJsonImport\(text\)/);
  assert.match(source, /mapGpxImport\(text\)/);
  assert.match(source, /mapKmlImport\(text\)/);
});

test("확장 지도 UI는 사용자 이미지·거리선·면적 영역·CSV를 실제 편집 경로에 연결한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  for (const token of ["map-image-pick", "map-image-clear", "map-draw-line", "map-draw-area", "map-csv-import", "map-csv-export", "map-csv-memo"]){
    assert.ok(source.includes(token), token);
  }
  assert.match(source, /L\.imageOverlay\(model\.backgroundImage\.dataUrl/);
  assert.match(source, /map\.createPane\("mapImagePane"\)/);
  assert.match(source, /pane: "mapImagePane"/);
  assert.match(source, /L\.polyline\(shape\.points/);
  assert.match(source, /L\.polygon\(shape\.points/);
  assert.match(source, /mapPrepareBackgroundImage\(file\)/);
  assert.match(source, /mapMarkersFromCsv\(csvText\)/);
  assert.match(source, /mapMarkersToCsv\(model\.markers\)/);
  assert.match(source, /window\.addTableToScratchpad\(mapMarkersToMemoRows\(model\.markers\)\)/);
});

test("메모 표는 카카오 장소 정보를 요청한 순서로 담고 편집용 열은 제외한다", () => {
  const api = loadMapViewer();
  const marker = api.mapNormalizeMarker({
    lat:37.5665, lng:126.978, label:"시청", note:"쉼표, 있음", color:"blue",
    address:"서울 중구 세종대로 110", phone:"02-120", region:"서울특별시", district:"중구",
    category:"사회,공공기관 > 지방행정기관 > 시청", roadAddress:"서울 중구 세종대로 110",
    lotAddress:"서울 중구 태평로1가 31", placeUrl:"https://place.map.kakao.com/17866469"
  });
  // vm 안에서 만든 배열이라 그대로는 realm 이 달라 비교되지 않는다 — 값만 떠서 견준다.
  const rows = JSON.parse(JSON.stringify(api.mapMarkersToRows([marker])));
  assert.deepEqual(rows[0], ["이름", "위도", "경도", "메모", "색상", "주소", "전화번호", "시도", "시군구"]);
  assert.deepEqual(rows[1], ["시청", "37.566500", "126.978000", "쉼표, 있음", "blue",
    "서울 중구 세종대로 110", "02-120", "서울특별시", "중구"]);
  const memoRows = JSON.parse(JSON.stringify(api.mapMarkersToMemoRows([marker])));
  assert.deepEqual(memoRows[0], ["이름", "업종·카테고리", "도로명 주소", "지번 주소", "전화번호",
    "카카오 장소 상세 링크(place_url)", "위도", "경도"]);
  assert.deepEqual(memoRows[1], ["시청", "사회,공공기관 > 지방행정기관 > 시청", "서울 중구 세종대로 110",
    "서울 중구 태평로1가 31", "02-120", "https://place.map.kakao.com/17866469", "37.566500", "126.978000"]);
  // 표 그대로 CSV 로 굳혔다가 다시 들이면 같은 표시로 돌아온다.
  const back = api.mapMarkersFromCsv(api.mapMarkersToCsv([marker]));
  assert.equal(back.markers[0].note, "쉼표, 있음");
  assert.equal(back.markers[0].address, "서울 중구 세종대로 110");
  assert.equal(back.markers[0].phone, "02-120");
  assert.equal(back.markers[0].district, "중구");
  assert.deepEqual(JSON.parse(JSON.stringify(api.mapMarkersToMemoRows([]))),
    [["이름", "업종·카테고리", "도로명 주소", "지번 주소", "전화번호",
      "카카오 장소 상세 링크(place_url)", "위도", "경도"]]);
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
  // 첫 점 뒤에는 다음 점을 찍기 전까지 마지막 점→마우스의 임시 구간이 따라다닌다.
  assert.match(source, /let draftGuideLayer = null/);
  assert.match(source, /const points = \[draftPoints\[draftPoints\.length - 1\], hover\]/);
  assert.match(source, /interactive:false/);
  assert.match(source, /map\.on\("mousemove", \(e\) => updateDraftGuide\(e\.latlng\)\)/);
  assert.match(source, /map\.on\("mouseout", clearDraftGuide\)/);
  assert.match(source, /if \(draftGuideLayer\) map\.removeLayer\(draftGuideLayer\)/);
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
  // 정리 블록은 여럿이다(복구본 타이머 등) — Leaflet 을 걷는 쪽을 집어서 본다.
  const cleanup = mapCleanupBodies(source).find(body => /map\.remove/.test(body));
  assert.ok(cleanup, "Leaflet 을 걷는 정리 블록이 있어야 한다");
  assert.match(cleanup, /mapResizeObserver\.disconnect/);
  assert.match(cleanup, /removeEventListener\("keydown", onInteractionKey\)/);
});

/* 런처가 둘(C#·Go)이라 목록이 갈라지면 그 배경지도만 한쪽에서 조용히 회색으로 남는다.
   두 파일을 함께 읽어 같은 허용 목록인지 확인한다. */
test("GeoJSON은 표시·경로·영역을 키 없이 왕복한다", () => {
  const api = loadMapViewer();
  const imported = api.mapGeoJsonImport(JSON.stringify({ type:"FeatureCollection", features:[
    { type:"Feature", properties:{ name:"학교", description:"정문", color:"blue" },
      geometry:{ type:"Point", coordinates:[127.1, 37.5] } },
    { type:"Feature", properties:{ name:"답사로" },
      geometry:{ type:"LineString", coordinates:[[127.1,37.5],[127.2,37.6]] } },
    { type:"Feature", properties:{ name:"조사 범위", color:"#16a34a" },
      geometry:{ type:"Polygon", coordinates:[[[127,37],[128,37],[128,38],[127,37]]] } }
  ] }));
  assert.equal(imported.markers.length, 1);
  assert.equal(imported.markers[0].label, "학교");
  assert.equal(imported.markers[0].color, "blue");
  assert.equal(imported.shapes.length, 2);
  assert.equal(imported.shapes[0].type, "line");
  assert.equal(imported.shapes[1].type, "area");
  const back = api.mapGeoJsonImport(api.mapGeoJsonExport(imported.markers, imported.shapes));
  assert.equal(back.markers.length, 1);
  assert.equal(back.shapes.length, 2);
  assert.equal(back.shapes[1].label, "조사 범위");
});

test("GPX·KML은 GPS 경로와 지도 영역을 오프라인으로 왕복한다", () => {
  const api = loadMapViewer();
  const gpx = api.mapGpxImport('<?xml version="1.0"?><gpx><wpt lat="37.5" lon="127.1"><name>출발 &amp; 도착</name><desc>메모</desc></wpt><trk><name>답사</name><trkseg><trkpt lat="37.5" lon="127.1"/><trkpt lat="37.6" lon="127.2"/></trkseg></trk></gpx>');
  assert.equal(gpx.markers[0].label, "출발 & 도착");
  assert.equal(gpx.markers[0].note, "메모");
  assert.equal(gpx.shapes[0].label, "답사");
  assert.equal(api.mapGpxImport(api.mapGpxExport(gpx.markers, gpx.shapes, "우리 지도")).shapes.length, 1);

  const area = api.mapKmlImport('<?xml version="1.0"?><kml><Document><Placemark><name>범위</name><Polygon><outerBoundaryIs><LinearRing><coordinates>127,37 128,37 128,38 127,37</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>');
  assert.equal(area.shapes.length, 1);
  assert.equal(area.shapes[0].type, "area");
  assert.equal(api.mapKmlImport(api.mapKmlExport([], area.shapes, "범위 지도")).shapes[0].label, "범위");
});

test("면적 경계 안 표시와 화면 클러스터를 API 없이 계산한다", () => {
  const api = loadMapViewer();
  const polygon = [[37,127],[37,128],[38,128],[38,127]];
  assert.equal(api.mapPointInPolygon([37.5,127.5], polygon), true);
  assert.equal(api.mapPointInPolygon([37,127.5], polygon), true, "경계 위 점도 포함");
  assert.equal(api.mapPointInPolygon([39,127.5], polygon), false);
  const shape = { type:"area", points:polygon };
  const markers = [{ lat:37.5, lng:127.5 }, { lat:39, lng:127.5 }];
  assert.equal(api.mapMarkersInArea(markers, shape).length, 1);
  const groups = api.mapClusterPixelGroups([{ id:"a", x:5, y:5 }, { id:"b", x:20, y:18 }, { id:"c", x:150, y:5 }], 72);
  assert.deepEqual(Array.from(groups, group => group.length), [2, 1]);
});

test("로드뷰는 별도 키 없이 좌표 공개 URL을 전용 창 하나에서 재사용한다", () => {
  let openCount = 0;
  let focusCount = 0;
  const roadviewWindow = { closed:false, location:"", opener:{}, focus(){ focusCount += 1; } };
  const api = loadMapViewer({
    open(url, name, features){
      openCount += 1;
      roadviewWindow.location = url;
      assert.equal(name, "ClassDockRoadview");
      assert.match(features, /popup=yes/);
      return roadviewWindow;
    }
  });
  assert.equal(api.mapKakaoRoadviewUrl(37.5, 127.1), "https://map.kakao.com/link/roadview/37.500000,127.100000");
  assert.equal(api.mapKakaoRoadviewUrl(999, 127), "");
  assert.equal(api.mapOpenKakaoRoadview(37.5, 127.1), true);
  assert.equal(api.mapOpenKakaoRoadview(37.6, 127.2), true);
  assert.equal(openCount, 1, "두 번째 좌표도 처음 연 전용 창을 써야 한다");
  assert.equal(roadviewWindow.location, "https://map.kakao.com/link/roadview/37.600000,127.200000");
  assert.equal(roadviewWindow.opener, null);
  assert.equal(focusCount, 2);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /roadviewBtn\.addEventListener\("click", \(\) => mapOpenKakaoRoadview\(marker\.lat, marker\.lng\)\)/);
  assert.match(source, /mapOpenKakaoRoadview\(spot\.lat, spot\.lng\)/);
  assert.match(source, /contextItem\("🚶 이 자리 로드뷰"/);
  assert.match(source, /MAP_ROADVIEW_WINDOW_NAME = "ClassDockRoadview"/);
  assert.match(source, /if \(!_mapRoadviewWindow\.closed\)/);
  assert.match(source, /_mapRoadviewWindow\.location = url/);
  assert.match(source, /_mapRoadviewWindow\.focus\(\)/);
  assert.match(source, /window\.open\(url, MAP_ROADVIEW_WINDOW_NAME, MAP_ROADVIEW_WINDOW_FEATURES\)/);
  assert.doesNotMatch(source, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.match(source, /mapClusterPixelGroups\(items, 72\)/);
  assert.match(source, /openMapAreaStats\(shape, model\.markers\)/);
  assert.match(source, /mapGeoJsonImport\(csvText\)/);
});

test("장소 정보 버튼은 주변 시설 바로 다음에 로드뷰를 두고 상세 보기는 마지막에 둔다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /actions\.append\(pinBtn, copyBtn, nearBtn, roadviewBtn, detailBtn\)/);
});

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

test("카카오 장소 검색은 전화번호와 업종을 고른 장소 말풍선까지 보존한다", () => {
  const api = loadMapViewer();
  const places = api.mapKakaoPlaces({ documents:[{
    id:"26338954", place_name:"카카오프렌즈 코엑스점", x:"127.059", y:"37.512",
    category_name:"가정,생활 > 문구,사무용품 > 디자인문구",
    road_address_name:"서울 강남구 영동대로 513", address_name:"서울 강남구 삼성동 159",
    phone:"02-6002-1880", place_url:"https://place.map.kakao.com/26338954"
  }] });
  assert.equal(places.length, 1);
  assert.equal(places[0].title, "카카오프렌즈 코엑스점");
  assert.equal(places[0].category, "디자인문구");
  assert.equal(places[0].categoryFull, "가정,생활 > 문구,사무용품 > 디자인문구");
  assert.equal(places[0].phone, "02-6002-1880");
  assert.equal(places[0].placeId, "26338954");

  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /onMove\(place\.lat, place\.lng, 15, place\.name, place\)/);
  assert.match(source, /setContent\(buildSpotPopup\(\{ \.\.\.place, title:place\.title \|\| place\.name, lat, lng \}\)\)/);
});

test("카카오 상세 창은 Local API의 장소 주소만 iframe으로 연다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapKakaoPlaceUrl("http://place.map.kakao.com/26338954"), "https://place.map.kakao.com/26338954");
  assert.equal(api.mapKakaoPlaceUrl("https://place.map.kakao.com/26338954/"), "https://place.map.kakao.com/26338954");
  assert.equal(api.mapKakaoPlaceUrl("https://evil.example/26338954"), "");
  assert.equal(api.mapKakaoPlaceUrl("https://place.map.kakao.com/not-a-place"), "");
  assert.equal(api.mapKakaoPlaceUrl("javascript:alert(1)"), "");
  assert.deepEqual(JSON.parse(JSON.stringify(api.mapKakaoPlaceSlides([
    { id:"a", name:"학교", placeUrl:"http://place.map.kakao.com/26338954/" },
    { id:"b", label:"병원", url:"https://place.map.kakao.com/17866469" },
    { id:"c", name:"중복", placeUrl:"https://place.map.kakao.com/26338954" },
    { id:"d", name:"외부", placeUrl:"https://evil.example/1" }
  ]))), [
    { id:"a", name:"학교", url:"https://place.map.kakao.com/26338954" },
    { id:"b", name:"병원", url:"https://place.map.kakao.com/17866469" }
  ]);

  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const modal = /function openMapKakaoPlaceModal\(([^]*?)\n\}/.exec(source);
  assert.ok(modal);
  assert.match(modal[1], /frame\.src = activeUrl/);
  assert.match(modal[1], /frame\.src = "about:blank"/);
  assert.match(modal[1], /window\.open\(activeUrl, "_blank", "noopener,noreferrer"\)/);
  assert.match(modal[1], /position\.textContent = \(placeIndex \+ 1\) \+ " \/ " \+ places\.length/);
  assert.match(modal[1], /const wrapped = \(\(Math\.trunc\(Number\(nextIndex\) \|\| 0\) % places\.length\) \+ places\.length\) % places\.length/);
  assert.doesNotMatch(modal[1], /prevBtn\.disabled|nextBtn\.disabled/);
  assert.doesNotMatch(modal[1], /placeIndex > 0|placeIndex < places\.length - 1/);
  assert.match(source, /detailBtn\.hidden = !mapKakaoPlaceUrl\(spot\.placeUrl\)/);
  assert.match(source, /openMapKakaoPlaceModal\(\[\{ name:spot\.title \|\| name, placeUrl:spot\.placeUrl \}\], 0\)/);
  assert.match(source, /detailBtn\.hidden = !mapKakaoPlaceUrl\(marker\.placeUrl\)/);
  assert.match(source, /item\.source === "nearby" && item\.batch === marker\.batch/);
  assert.match(source, /openMapKakaoPlaceModal\(peers\.map/);

  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(css, /\.modal-card\.map-place-card\{[^}]*height:min\(88vh,900px\)/);
  assert.match(css, /\.map-place-frame\{[^}]*width:100%;height:100%;border:0/);
  assert.match(css, /\.map-place-nav-btn\{/);
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

test("주소 검색은 고른 후보로만 옮기고 검색 표식은 지도 고르기 캡처에만 넣는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const search = /function mapAttachPlaceSearch\(([\s\S]*?)\n\}/.exec(source);
  const mover = /function mapSearchLocationMover\(([\s\S]*?)\n\}/.exec(source);
  const picker = /async function openMapPicker\(\)([\s\S]*?)\n\}\n\n\/\* ===== 열기/.exec(source);
  assert.ok(search);
  assert.ok(mover);
  assert.ok(picker);
  /* 후보가 여럿인데 찾자마자 옮기면, 첫 결과가 엉뚱할 때 목록에서 제 후보를 찾는 동안 보던
     자리를 잃는다 — 고른 뒤에 움직인다. 옮기는 길은 pick 하나뿐이라 두 갈래로 갈라지지 않는다. */
  const shown = /const showResults = \(places\) => \{([\s\S]*?)\n  \};/.exec(search[1]);
  assert.ok(shown);
  assert.doesNotMatch(shown[1], /onMove\(/);
  // 후보가 하나면 고를 것이 없다 — 한 줄짜리 목록을 한 번 더 누르게 하지 않고 곧장 옮긴다.
  assert.match(shown[1], /if \(items\.length === 1\)\{[\s\S]*?pick\(items\[0\]\);[\s\S]*?return true;/);
  // 여럿일 때는 첫 줄을 짚어 두어, 검색한 Enter 에 이어 Enter 한 번이면 첫 후보로 간다.
  assert.match(shown[1], /if \(items\.length\) setActive\(0\)/);
  assert.match(search[1], /onMove\(place\.lat, place\.lng, 15, place\.name, place\)/);
  assert.equal((search[1].match(/onMove\(/g) || []).length, 2, "좌표 입력과 pick 두 곳뿐이다");
  // 곧장 옮긴 자리에서는 "아래에서 고르세요" 안내가 뜨지 않아야 한다.
  assert.match(search[1], /if \(!showResults\(places\)\) setNote\(/);
  assert.match(mover[1], /L\.circleMarker/);
  assert.match(mover[1], /fillColor:"#e11d48"/);
  // 일반 지도 문서 내보내기는 편집 중인 임시 표식을 빼되, 칠판에서 고른 화면은 보이는 검색
  // 결과 자체가 자료이므로 빨간 점과 장소명·주소 이름표를 함께 찍는다.
  assert.match(source, /MAP_CAPTURE_HIDDEN_PANES[^\n]*\.map-search-location-pane/);
  assert.match(source, /options\.includeSearchLocation && selector === "\.map-search-location-pane"/);
  assert.match(picker[1], /mapCaptureDataUrl\(stage, spec\.attribution, \[\], \{ includeSearchLocation:true \}\)/);
});

test("주변 시설은 갈래 대신 직접 적은 말로도 반경 안을 찾는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const nearby = /async function mapNearbyPlaces\(target, lat, lng, radius, limit\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(nearby);
  // 적은 말이 있으면 키워드 검색, 없으면 갈래 검색 — 기준점·반경·쪽수는 두 길이 같다.
  assert.match(nearby[1], /keyword \? "kakao-keyword" : "kakao-category"/);
  assert.match(nearby[1], /if \(!keyword\) spot\.category = code/);
  assert.match(nearby[1], /slice\(0, MAP_NEARBY_KEYWORD_MAX\)/);
  // 직접 적은 말은 갈래가 아니므로 이름표·색을 그 말로 만든다.
  assert.match(source, /\[\{ code:"", label:keyword, color:"purple" \}\]/);
  assert.match(source, /mapNearbyPlaces\(\{ keyword \}, center\.lat, center\.lng, radius,[\s\S]*?Math\.min\(totalLimit, MAP_NEARBY_MAX_PER_KIND\)\)/);
  assert.match(source, /class="map-input map-nearby-keyword"/);
  // 갈래 칸은 직접 찾기를 적는 순간 흐려져 어느 쪽으로 찾는지 보인다.
  assert.match(source, /const keywordMode = !!keywordInput\.value\.trim\(\)/);
  assert.match(source, /row\.box\.disabled = keywordMode \|\| \(full && !row\.box\.checked\)/);
  assert.match(source, /totalSelect\.addEventListener\("change", syncKinds\)/);
  // 직접 찾기도 고른 전체 상한을 따르되 카카오 한 갈래 상한인 45곳을 넘지 않는다.
  assert.match(source, /Math\.min\(totalLimit, MAP_NEARBY_MAX_PER_KIND\)/);

  // 두 런처 모두 기준점이 있는 키워드 검색은 갈래 검색과 같은 쪽수(15개·page)로 받아야 한다.
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  assert.match(csharp, /bool around = provider == "kakao-keyword" && spot\.HasPoint/);
  // 이름 검색 쪽 후보 수는 따로 정한다(GeocodeResultLimit) — 여기서는 15개 길만 본다.
  assert.match(csharp, /"\?size=" \+ \(around \? "15" : GeocodeResultLimit\)/);
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
  const capture = /capture: \(\) => JSON\.stringify\((\[[\s\S]*?imageVersion[\s\S]*?\])\)/.exec(source);
  assert.ok(capture);
  assert.match(capture[1], /model\.title/);
  assert.match(capture[1], /model\.markers/);
  assert.match(capture[1], /model\.shapes/);
  assert.match(capture[1], /imageVersion/);
  assert.match(capture[1], /model\.grid/);          // 격자는 저장되는 내용이므로 되돌리기에도 들어간다
  assert.match(capture[1], /mapNormalizeDriveOptions\(model\.driveOptions\)/);
  assert.doesNotMatch(capture[1], /model\.center|model\.zoom/);
  // 배경 이미지(dataUrl 수 MB)는 단계마다 복제하지 않고 버전 표에 한 번만 둔다.
  assert.match(source, /const imageVersions = new Map\(\[\[0, model\.backgroundImage \|\| null\]\]\)/);
  assert.equal((source.match(/noteImageChange\(\);/g) || []).length, 2);
  // 단계 수와 총량을 함께 막는다(CSV 로 표시 수천 개가 들어올 수 있다).
  assert.match(source, /limit: MNEditHistory\.LIMITS\.board/);
  assert.match(source, /maxBytes: 24 \* 1024 \* 1024/);
  // 주소 좌표 찾기는 줄마다가 아니라 통째로 한 단계.
  const geocode = /const runPendingGeocode = async \(pending, options = \{\}\) => \{([\s\S]*?)\n  \};/.exec(source);
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
  assert.match(nearby[1], /address:place\.address/);
  assert.match(nearby[1], /phone:place\.phone/);
  assert.match(nearby[1], /category:place\.categoryFull \|\| place\.category/);
  assert.match(nearby[1], /roadAddress:place\.roadAddress/);
  assert.match(nearby[1], /lotAddress:place\.lotAddress/);
  assert.match(nearby[1], /placeUrl:place\.placeUrl/);
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
  // 그리는 중에는 마커 위인지보다 먼저 완료하고, 평소 마커·도형 우클릭은 가로채지 않는다.
  assert.match(open[1], /if \(drawingMode\)\{[\s\S]*?clearDraftGuide\(\);[\s\S]*?finishDrawing\(true\);[\s\S]*?return;/);
  assert.ok(open[1].indexOf("if (drawingMode)") < open[1].indexOf("if (e.propagatedFrom) return;"));
  assert.match(open[1], /if \(e\.propagatedFrom\) return;/);
  assert.match(open[1], /if \(adding\) return;/);
  assert.match(open[1], /origin\.preventDefault/);
  // 누른 자리는 지구 밖으로 나가지 않게 눌러 두고, 메뉴 머리말에 그대로 보여 준다.
  assert.match(open[1], /contextLatLng = L\.latLng\(mapClampLat\(e\.latlng\.lat\), mapClampLng\(e\.latlng\.lng\)\)/);
  // 카카오 검색을 껐어도 감추지 않는다 — 도구막대와 같은 잣대로 흐려지기만 한다(nearbyButtons).
  assert.match(source, /nearbyButtons\.push\(contextNearbyBtn\)/);
  assert.doesNotMatch(open[1], /contextNearbyBtn\.hidden/);
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
  const cleanup = mapCleanupBodies(source).find(body => /contextMenu\.remove\(\)/.test(body));
  assert.ok(cleanup, "우클릭 메뉴를 걷는 정리 블록이 있어야 한다");
  assert.match(cleanup, /closeContextMenu\(\);/);
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
  for (const button of ["lineBtn", "areaBtn", "routeBtn", "addressBtn", "clearItemsBtn", "regionBtn", "boardBtn", "saveBtn"])
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

/* 전체화면에서 지도를 넓게 보려고 편집 도구를 접는다. 접는 대상이 도구 줄뿐이어야 저장·되돌리기
   ·'저장 안 됨' 표시와 다시 펴는 단추가 창 모드에 남는다. */
test("편집 도구는 접을 수 있고 머리말 줄은 창 모드에 남는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  // 도구막대는 두 줄이다 — 머리말(.map-bar)과 접히는 도구 줄(.map-tools).
  assert.match(source, /toolRow\.className = "map-tools"/);
  assert.match(source, /root\.append\(bar, toolRow, body, imageInput, csvInput\)/);
  const head = /bar\.append\(([^)]*)\);/.exec(source);
  assert.ok(head, "머리말 줄 append 를 찾지 못했다");
  for (const keep of ["titleInput", "searchWrap", "toolsToggleBtn", "undoBtn", "redoBtn", "saveBtn", "status"])
    assert.ok(head[1].includes(keep), keep + " 는 머리말 줄에 남아야 한다");
  const tools = /toolRow\.append\(([\s\S]*?)\);/.exec(source);
  assert.ok(tools, "도구 줄 append 를 찾지 못했다");
  for (const moved of ["addBtn", "lineBtn", "areaBtn", "clearItemsBtn", "pngBtn", "taskBtn"])
    assert.ok(tools[1].includes(moved), moved + " 는 도구 줄에 있어야 한다");
  // 오프라인 지도 단추(런처 전용)도 머리말이 아니라 도구 줄에 붙는다.
  assert.match(source, /toolRow\.appendChild\(prepareBtn\)/);
  // 창 모드에서는 도구 줄만 접는다.
  const apply = /function applyToolbarVisible\(\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(apply);
  assert.match(apply[1], /bar\.hidden = fullscreenNow && !toolbarVisible/);
  assert.match(apply[1], /toolRow\.hidden = !toolbarVisible/);
  // 보기 상태라 .map 파일이 아니라 화면 환경설정으로 기억한다.
  assert.match(source, /const MAP_TOOLBAR_KEY = "mapToolbarVisible"/);
  assert.match(source, /localStorage\.getItem\(MAP_TOOLBAR_KEY\) !== "false"/);
  assert.match(source, /localStorage\.setItem\(MAP_TOOLBAR_KEY, String\(toolbarVisible\)\)/);
  // 접은 뒤에도 우클릭 메뉴가 같은 단추를 비춘다 — 이름을 고정하지 않아 숨기기↔보이기가 따라 바뀐다.
  assert.match(source, /contextMirror\(toolsToggleBtn\);/);
  // 새 줄도 발표 모드에서는 함께 사라지고, 두 줄이 붙어 있을 때 사이 선은 옅다.
  assert.match(styles, /\.map-doc\.is-presenting \.map-tools/);
  assert.match(styles, /\.map-tools\{display:flex/);
  assert.match(styles, /\.map-bar\.has-tools\{border-bottom-color/);
});

/* ⛶ 전체화면은 Esc·⛶ 로 나가는 길이 따로 있으니 머리말까지 접어 지도만 남긴다. 다만 임시 접기라
   환경설정에 쓰지 않고, 나가면 들어가기 전 상태로 되돌린다. */
test("전체화면에서는 머리말까지 접고 나오면 들어가기 전 상태로 되돌린다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const sync = /function syncFullscreenState\(\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(sync);
  assert.match(sync[1], /toolbarBeforeFullscreen = toolbarVisible/);
  assert.match(sync[1], /if \(toolbarBeforeFullscreen !== null\)\{ toolbarVisible = toolbarBeforeFullscreen/);
  // 임시 접기는 저장하지 않는다 — 기억을 쓰는 길은 직접 고른 setToolbarVisible 뿐이다.
  assert.ok(!/localStorage\.setItem/.test(sync[1]), "전체화면 임시 접기를 환경설정에 쓰면 안 된다");
  const setter = /function setToolbarVisible\(visible\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(setter);
  assert.match(setter[1], /toolbarBeforeFullscreen = null/);   // 직접 고른 값이 임시 접기보다 우선
  // 창 안 폴백(body.viewer-fullscreen)은 이벤트가 없어 클래스 변화도 함께 지켜본다.
  assert.match(source, /document\.addEventListener\("fullscreenchange", syncFullscreenState\)/);
  assert.match(source, /attributeFilter:\["class"\]/);
  assert.match(source, /syncFullscreenState\(\);\s*\/\/ 이미 전체화면인 채로/);
  // 열어 둔 문서를 닫으면 키·전체화면 감시를 함께 걷는다.
  const cleanup = mapCleanupBodies(source).find(body => /onToolbarKey/.test(body));
  assert.ok(cleanup, "접기 관련 정리 블록이 있어야 한다");
  assert.match(cleanup, /removeEventListener\("keydown", onToolbarKey\)/);
  assert.match(cleanup, /fullscreenClassWatch\.disconnect/);
});

/* H 한 글자짜리 단축키라 글자를 치는 자리에서는 절대 걸리면 안 된다. */
test("H 접기는 입력칸·발표·대화창·문제 풀이 화면에서는 걸리지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const key = /function onToolbarKey\(e\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(key);
  assert.match(key[1], /if \(taskMode \|\| e\.defaultPrevented\) return/);
  assert.match(key[1], /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return/);
  assert.match(key[1], /doc\.el && doc\.el\.hidden/);
  assert.match(key[1], /root\.classList\.contains\("is-presenting"\)/);
  /* 열려 있는 대화창만 봐야 한다. 앱 셸에는 숨은 .modal 이 늘 열댓 개 들어 있어서
     :not([hidden]) 을 빼면 조건이 언제나 참이 되고 H 가 통째로 죽는다(실제로 그랬다). */
  assert.match(key[1], /document\.querySelector\("\.modal:not\(\[hidden\]\)"\)/);
  assert.doesNotMatch(key[1], /querySelector\("\.modal"\)/);
  assert.match(key[1], /closest\("input,textarea,select,\[contenteditable='true'\]"\)/);
  // 지도 문제(학생 화면)에서는 두 줄 다 접힌 채로 두고, 우클릭 메뉴에서도 항목이 빠진다.
  assert.match(source, /toolsToggleBtn\.hidden = taskMode/);
  assert.match(source, /toolRow\.hidden = true;/);
  const apply = /function applyToolbarVisible\(\)\{([\s\S]*?)\n  \}/.exec(source);
  assert.match(apply[1], /^\s*if \(taskMode\) return;/);
});

/* 검색 후보 수는 세 곳(화면 목록·C# 런처·Go 런처)이 함께 정한다. 한쪽만 올리면 다른 쪽에서
   잘려 아무 효과가 없으므로 값이 갈라지지 않는지 본다. */
test("검색 후보 개수는 화면 목록과 두 런처가 같은 값을 쓴다", () => {
  const api = loadMapViewer();
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  const limit = api.MAP_SEARCH_RESULT_MAX;
  assert.equal(limit, 8);
  // 화면 목록은 상수로 자른다(숫자를 그 자리에 박아 두면 런처와 어긋난 것을 알 길이 없다).
  assert.match(source, /items = places\.slice\(0, MAP_SEARCH_RESULT_MAX\)/);
  // C# 런처 — Nominatim limit 과 카카오 주소·키워드 size 가 같은 상수를 쓴다.
  const csharp = /const string GeocodeResultLimit = "(\d+)";/.exec(launcher);
  assert.ok(csharp, "launcher.cs 에서 GeocodeResultLimit 을 찾지 못했다");
  assert.equal(Number(csharp[1]), limit);
  assert.match(launcher, /"\?format=jsonv2&limit=" \+ GeocodeResultLimit/);
  assert.match(launcher, /"\?size=" \+ \(around \? "15" : GeocodeResultLimit\)/);
  // Go 폴백 런처도 같은 값이어야 한다.
  const golang = /geocodeResultLimit = "(\d+)"/.exec(go);
  assert.ok(golang, "main.go 에서 geocodeResultLimit 을 찾지 못했다");
  assert.equal(Number(golang[1]), limit);
  assert.match(go, /values\.Set\("limit", geocodeResultLimit\)/);
  assert.match(go, /values\.Set\("size", geocodeResultLimit\)/);
  // 주변 시설은 다른 길이라 그대로 15개씩 받는다(여기를 함께 건드리지 않았는지 확인).
  assert.match(launcher, /"&size=15&sort=distance&page="/);
  assert.match(go, /values\.Set\("size", "15"\)/);
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
  /* 좌표로 옮기는 길에도 같은 기록 호출이 있으므로(그쪽은 못 찾을 일이 없다) 빈 결과로
     빠져나가는 줄 뒤에서부터 찾는다. */
  const remembered = notFound > 0 ? search[1].indexOf("mapRememberSearch(text);", notFound) : -1;
  assert.ok(notFound > 0 && remembered > notFound);
  // 기록한 뒤에 목록을 그린다(찾아낸 말만 남기고, 그 자리에서 바로 다시 쓸 수 있게).
  assert.ok(search[1].indexOf("showResults(places)") > remembered);
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
  // 기록 8줄 뒤에 붙는 전체 지우기는 스크롤 아래로 사라지지 않는 고정 꼬리말이어야 한다.
  assert.match(css, /\.map-result\.is-clear\{[^}]*position:sticky;[^}]*bottom:0/);
  // 창이 낮거나 도구막대가 접혀도 남은 화면 높이에 맞추고, 위쪽이 더 넓으면 위로 펼친다.
  assert.match(attach[1], /const fitResultsToViewport = \(\) =>/);
  assert.match(attach[1], /window\.innerHeight - wrapRect\.bottom/);
  assert.match(attach[1], /const openUp = below < wanted && above > below/);
  assert.match(attach[1], /results\.style\.maxHeight = Math\.min\(240, openUp \? above : below\) \+ "px"/);
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

  /* 검색을 마치면 후보 목록이 열린 채로 남고 지도에는 표식이 찍힌다. 검색칸이 Esc 를 삼키면
     그 한 번이 표식을 지우지 못해 "Esc 가 안 먹는다"로 보인다 — 목록을 닫고 흘려보내야 한다. */
  const inputKey = /input\.addEventListener\("keydown", \(e\) => \{([\s\S]*?)\n  \}\);/.exec(source);
  assert.ok(inputKey);
  const escBranch = /if \(e\.key === "Escape" && !results\.hidden\)\{([\s\S]*?)\n    \}/.exec(inputKey[1]);
  assert.ok(escBranch);
  assert.match(escBranch[1], /closeResults\(\)/);
  assert.doesNotMatch(escBranch[1], /preventDefault|stopPropagation/);

  /* Leaflet 은 말풍선을 닫아도 map._popup 을 비우지 않는다. 그대로 두면 키보드 처리기가 그 뒤의
     Esc 를 모두 삼켜, 말풍선을 한 번이라도 연 지도에서는 표식이 Esc 로 지워지지 않는다. */
  assert.match(source, /if \(map\._popup === e\.popup\) map\._popup = null/);
  const leaflet = fs.readFileSync(path.join(__dirname, "../vendor/leaflet.min.js"), "utf8");
  assert.match(leaflet, /closePopup:function\(t\)\{return\(t=arguments\.length\?t:this\._popup\)&&t\.close\(\),this\}/,
    "Leaflet 이 closePopup 에서 _popup 을 비우게 바뀌면 이 우회는 걷어낼 수 있다");
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
    { place_name:"○○초등학교", x:"127.0", y:"37.5", road_address_name:"○○로 1", address_name:"○○동 10", distance:"320",
      category_name:"교육,학문 > 학교 > 초등학교", phone:"02-123-4567" },
    { place_name:"좌표 없음", x:"", y:"" },
    { place_name:"", x:"127.1", y:"37.6" }
  ] });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "○○초등학교");
  assert.equal(places[0].category, "초등학교");
  assert.equal(places[0].categoryFull, "교육,학문 > 학교 > 초등학교");
  assert.equal(places[0].roadAddress, "○○로 1");
  assert.equal(places[0].lotAddress, "○○동 10");
  assert.equal(places[0].phone, "02-123-4567");
  assert.equal(places[0].distance, 320);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /place\.phone \? "☎ " \+ place\.phone/);
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
  const list = api.MAP_KAKAO_CATEGORIES;
  /* 카카오가 나눠 둔 category_group_code 는 열여덟 가지이고 그 전부를 담는다 — 하나라도 빠지면
     그 갈래는 '직접 찾기'로만 닿을 수 있는데, 키워드 검색은 이름에 그 말이 든 곳만 찾아
     갈래 검색과 결과가 다르다(숙박으로 적으면 이름에 '숙박'이 든 곳만 나온다). */
  assert.equal(list.length, 18);
  const colors = api.MAP_MARKER_COLORS.map(color => color.id);
  for (const item of list){
    assert.match(item.code, /^[A-Z]{2}[0-9]$/, item.code);
    assert.ok(colors.includes(item.color), item.label + " 의 색 " + item.color);
    assert.ok(item.label, item.code + " 에 이름이 없다");
  }
  assert.equal(new Set(list.map(item => item.code)).size, list.length, "코드가 겹친다");
  assert.equal(new Set(list.map(item => item.label)).size, list.length, "이름이 겹친다");
  // 창에 펼쳐지는 이름은 모두 영어 사전에 있어야 EN 으로 바꿨을 때 한국어로 남지 않는다.
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  for (const item of list) assert.ok(i18n.includes('"' + item.label + '":'), item.label + " 의 영문이 없다");
});

test("주변 시설은 갈래를 여러 개 골라 한 번에 넣는다", () => {
  const api = loadMapViewer();
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  /* 기본 전체 75곳을 갈래 수에 따라 유동 배분한다. 한 갈래는 카카오 노출 상한 45곳까지 늘고,
     다섯 갈래는 예전과 같은 15곳씩이다. 사용자가 고르는 최대 100곳도 이름표 문턱 아래다. */
  assert.equal(api.MAP_NEARBY_MAX_KINDS, 5);
  assert.deepEqual([...api.MAP_NEARBY_TOTAL_CHOICES], [30, 45, 75, 100]);
  assert.equal(api.MAP_NEARBY_DEFAULT_TOTAL, 75);
  assert.equal(api.MAP_NEARBY_MAX_PER_KIND, 45);
  assert.ok(Math.max(...api.MAP_NEARBY_TOTAL_CHOICES) < api.MAP_LABEL_MAX_MARKERS,
    "고를 수 있는 전체 최대치가 이름표를 접는 문턱을 넘으면 안 된다");
  assert.deepEqual([...api.mapNearbyKindLimits(1, 75)], [45]);
  assert.deepEqual([...api.mapNearbyKindLimits(2, 75)], [38, 37]);
  assert.deepEqual([...api.mapNearbyKindLimits(3, 75)], [25, 25, 25]);
  assert.deepEqual([...api.mapNearbyKindLimits(4, 75)], [19, 19, 19, 18]);
  assert.deepEqual([...api.mapNearbyKindLimits(5, 75)], [15, 15, 15, 15, 15]);
  // 필요한 수만큼 받은 쪽에서 멈추고 한 갈래는 세 쪽(45곳)을 넘지 않는다.
  const nearby = /async function mapNearbyPlaces\(target, lat, lng, radius, limit\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(nearby);
  assert.match(nearby[1], /Math\.min\(MAP_NEARBY_MAX_PER_KIND/);
  assert.match(nearby[1], /if \(cap && places\.length >= cap\) break;/);
  assert.match(nearby[1], /return cap \? places\.slice\(0, cap\) : places;/);

  /* 색: 여섯 색을 열세 갈래가 나눠 써 겹친다(학교·학원이 둘 다 파랑). 같이 고르면 지도에서
     갈래를 가를 수 없으므로 뒤엣것이 남는 색으로 비껴야 한다. */
  const byLabel = (label) => api.MAP_KAKAO_CATEGORIES.find(item => item.label === label);
  const pair = [byLabel("학교"), byLabel("학원")];
  assert.equal(pair[0].color, pair[1].color, "이 검사는 색이 겹치는 짝을 전제로 한다");
  const colored = api.mapNearbyKindColors(pair);
  assert.equal(colored[0].color, pair[0].color, "먼저 고른 갈래는 제 색을 지킨다");
  assert.notEqual(colored[1].color, colored[0].color);
  // 어떤 다섯을 골라도 서로 다른 색이 나온다(색이 여섯이라 늘 자리가 남는다).
  const five = ["학교", "학원", "병원", "약국", "편의점"].map(byLabel);
  const fiveColors = api.mapNearbyKindColors(five).map(kind => kind.color);
  assert.equal(new Set(fiveColors).size, 5);
  for (const color of fiveColors) assert.ok(api.MAP_MARKER_COLORS.some(item => item.id === color));
  // 배정은 원본을 건드리지 않는다 — 목록은 창을 여닫는 사이 그대로여야 한다.
  assert.equal(byLabel("학원").color, pair[1].color);

  // 창: 갈래는 체크박스로 펼쳐지고, 다 채우면 아직 안 고른 것만 잠긴다.
  assert.match(source, /class="map-nearby-kind-grid"/);
  assert.match(source, /box\.type = "checkbox"; box\.value = item\.code/);
  assert.match(source, /const full = picked\.length >= MAP_NEARBY_MAX_KINDS/);
  /* 창은 빈 채로 열린다 — 셀렉트 때처럼 하나가 미리 골라져 있으면 병원만 보려던 사람이 그것을
     풀지 않고 넣게 된다. 대신 하나를 고를 때까지 '찾아서 넣기'가 잠긴다. */
  assert.doesNotMatch(source, /kindRows\[0\]\.box\.checked = true/);
  assert.match(source, /okBtn\.disabled = !keywordMode && !picked\.length/);
  // 색 점은 고르는 사이에 따라 움직여야 넣기 전에 어느 색인지 읽힌다.
  assert.match(source, /row\.dot\.style\.background = mapColorHex\(row\.box\.checked \? colored\[at\+\+\]\.color : row\.item\.color\)/);

  /* 한 갈래가 넘어져도 나머지는 넣는다. 다만 하나도 못 건지면 까닭을 그대로 올려야
     카카오 꺼짐·런처 없음 안내가 살아 있다. */
  const byKinds = /async function mapNearbyPlacesByKinds\(kinds, lat, lng, radius, totalLimit\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(byKinds);
  assert.match(byKinds[1], /const limits = mapNearbyKindLimits\(kinds\.length, totalLimit\)/);
  assert.match(byKinds[1], /limits\[index\]/);
  assert.match(byKinds[1], /catch\(error\)\{ failed\.push\(kind\); if \(!firstError\) firstError = error; continue; \}/);
  assert.match(byKinds[1], /if \(!places\.length && firstError\) throw firstError;/);
  assert.match(byKinds[1], /places\.push\(\{ \.\.\.place, kind \}\)/);
  // 못 부른 갈래는 상태줄에 남긴다 — 토스트 자리는 되돌리기가 쓰고 있다.
  assert.match(source, /setStatus\(mapTf\("\{labels\}은\(는\) 찾지 못해 나머지만 넣었습니다"/);

  // 표시는 제 갈래 색으로 들어가고, 갈래 이름이 메모 첫 줄에 남아 색이 겹쳐도 되짚을 수 있다.
  assert.match(source, /const kind = place\.kind \|\| picked\.kinds\[0\]/);
  assert.match(source, /color:kind\.color,/);
  assert.match(source, /note:\[kind\.code \? mapT\(kind\.label\) : ""/);
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

/* 카카오에만 있는 기능은 OSM 폴백이 없다. 감추는 대신 흐리게 두고 눌렀을 때 켜는 법을 알려 준다
   — 감추면 이런 기능이 있다는 것조차 모르고 지나친다. */
test("주변 시설은 카카오를 껐을 때 흐려지고 주소 확인은 OSM으로도 돌아간다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /nearbyBtn\.classList\.add\("is-unavailable"\)/);
  assert.match(source, /async function mapKakaoSearchAccess\(\)/);
  assert.match(source, /refreshNearbyReady\(\)/);
  assert.match(source, /ready:provider && available && hasKey/);
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

/* ===== 클릭한 자리 안내 ===== */

test("클릭한 자리 안내는 장소 이름·갈래·전화까지 읽고 큰 갈래는 버린다", () => {
  const api = loadMapViewer();
  const places = api.mapKakaoSpotPlaces({ documents:[
    { place_name:"서울역", x:"126.97", y:"37.55", category_name:"교통,수송 > 지하철,전철 > 수도권1호선",
      road_address_name:"서울 중구 한강대로 405", address_name:"서울 중구 봉래동2가 122",
      phone:"02-1234-5678", distance:"42" },
    { place_name:"좌표 없음", x:"", y:"" }
  ] });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "서울역");
  // 말풍선에는 맨 끝 갈래만 쓴다 — "교통,수송 > …" 를 그대로 보여 주면 이름보다 길다.
  assert.equal(places[0].category, "수도권1호선");
  assert.equal(places[0].phone, "02-1234-5678");
  assert.equal(places[0].distance, 42);
  assert.equal(api.mapKakaoCategoryTail("가 > 나 > 다"), "다");
  assert.equal(api.mapKakaoCategoryTail(""), "");

  /* 누른 곳이 '무엇'인지 아는 값은 이름이 붙은 자리에서만 오는 building 뿐이다. 주소로 메운
     이름(도로명·display_name)이 여기 섞이면 빈 들판을 눌러도 건물을 찾은 것처럼 보인다. */
  const kakao = api.mapKakaoAddressInfo({ documents:[{
    road_address:{ address_name:"서울 중구 세종대로 110", building_name:"서울시청" },
    address:{ address_name:"서울 중구 태평로1가 31" }
  }] });
  assert.equal(kakao.building, "서울시청");
  assert.equal(api.mapKakaoAddressInfo({ documents:[{
    road_address:{ address_name:"서울 중구 세종대로 110", building_name:"" },
    address:{ address_name:"서울 중구 태평로1가 31" }
  }] }).building, "");
  assert.equal(api.mapOsmReverseInfo({ name:"서울역", display_name:"서울역, 한강대로", address:{} }).building, "서울역");
  assert.equal(api.mapOsmReverseInfo({ display_name:"한강대로 405", address:{} }).building, "");
});

/* Leaflet 은 말풍선을 흰 바탕·#333 글자로 못박아 둔다. 그 안의 글씨는 앱 색표로 그리므로,
   바탕을 앱 쪽으로 가져오지 않으면 다크모드에서 밝은 글자가 흰 바탕에 묻힌다. */
test("지도 말풍선은 Leaflet 기본색 대신 앱 테마 색을 쓴다", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const rule = /\.leaflet-container \.leaflet-popup-content-wrapper,\s*\n\s*\.leaflet-container \.leaflet-popup-tip\{([^}]*)\}/.exec(css);
  assert.ok(rule, "말풍선 바탕·글자색을 앱 색표로 덮어써야 한다");
  assert.match(rule[1], /background:var\(--panel\)/);
  assert.match(rule[1], /color:var\(--ink\)/);
  /* Leaflet 쪽 선택자(.leaflet-popup-content-wrapper)보다 구체적이어야 한다 — 그래야 두 CSS 의
     싣는 차례와 상관없이 이긴다(leaflet.css 는 늦게 붙을 수도 있다). */
  const leafletCss = fs.readFileSync(path.join(__dirname, "../vendor/leaflet.css"), "utf8");
  assert.match(leafletCss, /\.leaflet-popup-content-wrapper,\s*\n\.leaflet-popup-tip \{[^}]*background: white/);
  // 제목은 말풍선에서 가장 진해야 하는 줄이다(주소·갈래보다 먼저 읽힌다).
  assert.match(css, /\.map-spot-title\{[^}]*color:var\(--ink\)/);
});

test("클릭한 자리 안내는 카카오가 없어도 주소까지는 나오고, 검색은 많아야 두 번이다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const spot = /async function mapSpotAt\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(spot);
  // 좌표 → 주소가 먼저다. 카카오 검색은 갈래·전화를 곁들이는 자리라 실패해도 말풍선은 열린다.
  assert.ok(spot[1].indexOf("mapPlaceInfoAt") < spot[1].indexOf("mapProviderIsKakao"));
  assert.match(spot[1], /catch\(_\)\{ \}/);
  assert.match(spot[1], /throw new Error\("geocode-launcher-required"\)/);
  // 갈래를 다 훑으면 클릭 한 번에 검색이 열세 번 나간다 — 이름으로 한 번, 지하철역으로 한 번뿐이다.
  assert.equal((spot[1].match(/mapSpotSearch\(/g) || []).length, 2);
  assert.match(spot[1], /mapSpotSearch\(\{ code:"SW8" \}/);
  // 한 쪽(15개)만 받는다 — 첫 곳만 쓸 것이라 쪽을 이어 받을 까닭이 없다.
  const search = /async function mapSpotSearch\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(search);
  assert.doesNotMatch(search[1], /for \(let page/);

  /* 멀리서 누른 자리는 몇 백 미터를 가리킨다. 그 자리의 주소를 그대로 보여 주면 누른 건물의
     것이 아니어서, 가르치는 자리에서 틀린 값을 읽게 된다. */
  const api = loadMapViewer();
  assert.ok(api.MAP_SPOT_MIN_ZOOM >= 15);
  const show = /async function showSpotInfo\(([\s\S]*?)\n  \}/.exec(source);
  assert.ok(show);
  assert.match(show[1], /map\.getZoom\(\) < MAP_SPOT_MIN_ZOOM/);
  assert.match(show[1], /if \(spotBusy\) return/);
  /* 말풍선을 닫으려고 누른 클릭이 곧바로 새 말풍선을 열면 지도를 눌러 닫을 방법이 없어진다.
     Leaflet 은 preclick 에서 닫으므로 그 전의 상태를 봐 둔다. */
  assert.match(source, /map\.on\("preclick", \(\) => \{ popupWasOpen = popupOpen; \}\)/);
  // 도형에서 올라온 클릭(propagatedFrom)은 그 도형의 말풍선 자리라 안내가 덮지 않는다.
  assert.match(source, /if \(spotInfo && spotReady && !popupWasOpen && !e\.propagatedFrom\) showSpotInfo\(e\.latlng\)/);
  // 읽기만 하는 말풍선이라 문서를 건드리지 않는다 — 남기려면 '표시로 넣기'를 눌러야 한다.
  assert.doesNotMatch(show[1], /model\.markers\.push/);
  // 런처가 없어도 감추지 않는다 — 흐리게 두고 눌렀을 때 까닭을 알려 준다.
  assert.match(source, /spotBtn\.classList\.add\("is-unavailable"\)/);
  assert.match(source, /mapTileProxyBase\(\)\.then\(\(base\) => setSpotReady\(!!base\)\)/);
});

/* 쓸 수 없는 도구를 감추면 그런 기능이 있다는 것조차 모르고 지나친다. 흐리게 두고, 눌렀을 때
   켜는 법을 알려 주되, 그때 상태를 한 번 더 확인해 "켰는데도 안 된다"가 없게 한다. */
test("아직 쓸 수 없는 도구는 감추지 않고 흐리게 두고 누르면 켜는 법을 알려 준다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  // 감추던 자리가 남아 있으면 안내가 영영 닿지 않는다.
  assert.doesNotMatch(source, /nearbyBtn\.hidden/);
  assert.doesNotMatch(source, /spotBtn\.hidden/);
  // 흐린 채로 눌렀을 때 상태를 다시 확인하고 나서 안내한다(그 사이 설정을 켰을 수 있다).
  const nearby = /const runNearby = async \(at, opts = \{\}\) => \{([\s\S]*?)\n    const center =/.exec(source);
  assert.ok(nearby, "runNearby 앞머리의 안내 갈래를 찾지 못했다");
  assert.match(nearby[1], /await refreshNearbyReady\(\)/);
  assert.match(nearby[1], /if \(!nearbyReady\)\{[\s\S]*?return;/);
  assert.match(source, /ready:provider && available && hasKey/);
  assert.match(source, /window\.addEventListener\("classdock-map-search-status-change", onMapSearchStatusChange\)/);
  assert.match(source, /window\.removeEventListener\("classdock-map-search-status-change", onMapSearchStatusChange\)/);
  assert.match(source, /error\.message === "kakao-key-required"[\s\S]*?카카오 REST API 키가 없어 주변 시설을 찾을 수 없어요/);
  assert.match(source, /setSpotReady\(!!await mapTileProxyBase\(\)\)/);
  // 안내 문구는 켜는 자리(설정 · 런처)를 짚어 주고, 영어 사전에도 있어야 한다.
  for (const guide of [
    "주변 시설은 카카오 지도 검색을 켜야 찾을 수 있어요 — 설정 → 지도 검색에서 카카오를 고르고 REST API 키를 넣어 주세요.",
    "카카오 REST API 키가 없어 주변 시설을 찾을 수 없어요 — 설정 → 지도 검색에서 키를 등록해 주세요.",
    "장소 정보는 ClassDock 런처로 열었을 때 쓸 수 있어요 — 브라우저로 연 화면에서는 누른 자리를 되물을 수 없습니다."
  ]){
    assert.ok(source.includes(guide), "안내 문구가 없다: " + guide);
    assert.ok(i18n.includes('"' + guide + '"'), "사전에 없다: " + guide);
  }
  // 우클릭 메뉴도 도구막대의 흐림을 그대로 비춘다.
  const sync = /const syncContextMirrors = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(sync);
  assert.match(sync[1], /classList\.toggle\("is-unavailable", mirror\.button\.classList\.contains\("is-unavailable"\)\)/);
  // disabled 가 아니라 클래스다 — disabled 인 단추에는 클릭이 오지 않아 안내할 자리가 없다.
  assert.match(styles, /\.map-btn\.is-unavailable,\.map-spot-btn\.is-unavailable,\.map-context-menu button\.is-unavailable\{opacity/);

  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  assert.match(app, /window\.__classDockMapSearchKeyStatus = detail/);
  assert.match(app, /new CustomEvent\("classdock-map-search-status-change", \{ detail \}\)/);
});

/* ===== 저장 전 안전망 ===== */

/* 새로고침 한 번에 저장 안 한 지도가 사라지면 수업 중에 되살릴 길이 없다. 다른 형식(.mnote·
   노트북·표·이미지)이 쓰는 작업공간 복구본을 지도도 같이 쓴다. */
test("저장하지 않은 지도는 작업공간 복구본으로 새로고침을 넘긴다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const save = /async function mapSaveRecovery\(doc\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(save);
  /* 아직 저장하지 않은 새 지도는 ● 가 켜지기 전에도 남겨야 한다 — 정작 가장 잃기 쉬운 문서라
     hasUnsavedEdits 만 보면 빈 지도 탭이 그대로 사라진다. */
  assert.match(save[1], /if \(!doc\.hasUnsavedEdits && !\(doc\.isScratch && !doc\._named\)\) return false/);
  assert.match(save[1], /recoverySnapshotFile\(doc, new TextEncoder\(\)\.encode\(json\), "application\/json"\)/);
  assert.match(save[1], /rememberWorkspace\(\[file\], false, \{ silent:true \}\)/);
  /* saveDocumentRecoverySnapshot 은 workspacePath 가 있어야 움직인다 — 새 지도에는 그 값이 없어
     조용히 걸러진다. 그래서 경로를 세우는 부분만 빌려 쓰고 작업공간에는 직접 넣는다. */
  const docs = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  assert.match(docs, /async function saveDocumentRecoverySnapshot[\s\S]*?!doc\.workspacePath/);
  assert.match(docs, /workspacePath: options\.workspacePath \|\| null/);

  // 편집할 때마다 곧바로 쓰지 않는다 — 표시를 끌면 touch 가 연달아 들어온다.
  assert.match(source, /const MAP_RECOVERY_DELAY = \d+/);
  const schedule = /const scheduleRecovery = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(schedule);
  assert.match(schedule[1], /appSettings\.pdfRecovery/, "설정의 자동 저장·복원을 따른다");
  assert.match(schedule[1], /setTimeout\([\s\S]*?mapSaveRecovery\(doc\)/);
  // 저장 안 됨(●) 판정과 같은 자리에서 예약한다 — 고침이 한 갈래로 모이는 곳이다.
  const touch = /const touch = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(touch);
  assert.match(touch[1], /scheduleRecovery\(\)/);
  // 백업 내보내기도 마지막 편집분까지 담도록 공용 훅에 매단다(다른 형식과 같은 이름).
  assert.match(source, /doc\.flushBackupRecovery = flushMapBackup/);
  assert.match(source, /if \(doc\.flushBackupRecovery === flushMapBackup\) delete doc\.flushBackupRecovery/);
  // 표시를 찍기 전의 빈 새 지도도 한 번은 남긴다.
  assert.match(source, /if \(doc\.isScratch && !doc\._named\) scheduleRecovery\(\)/);
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

/* ===== 글 문서에서 고른 지명으로 찾기 =====
   .docx·메모에서 낱말을 긁고 우클릭 → "지도에서 검색" 을 누르면 지도 탭의 검색칸으로 넘어간다. */
test("지도로 넘길 낱말은 줄바꿈을 눕히고 문단째 긁은 것은 거른다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapSearchTextFrom("  경복궁 "), "경복궁");
  assert.equal(api.mapSearchTextFrom("서울특별시\n종로구\t세종로"), "서울특별시 종로구 세종로");
  assert.equal(api.mapSearchTextFrom(""), "");
  assert.equal(api.mapSearchTextFrom(null), "");
  // 장소 이름은 짧다 — 문단을 통째로 넘기면 찾을 수 없는 말이 되므로 쓸 수 없는 선택으로 본다.
  assert.equal(api.mapSearchTextFrom("가".repeat(api.MAP_SEARCH_TEXT_MAX)), "가".repeat(api.MAP_SEARCH_TEXT_MAX));
  assert.equal(api.mapSearchTextFrom("가".repeat(api.MAP_SEARCH_TEXT_MAX + 1)), "");
});

test("저장된 유적지 주소는 문단 선택보다 긴 지도 검색어로 넘길 수 있다", () => {
  const api = loadMapViewer();
  const address = "서울특별시 종로구 사직로 161 경복궁 관리소 앞 역사문화 안내소 ".repeat(2).trim();
  assert.ok(address.length > api.MAP_SEARCH_TEXT_MAX);
  assert.equal(api.mapSearchQueryFrom(address), address);
  assert.equal(api.mapSearchQueryFrom("가".repeat(api.MAP_SEARCH_QUERY_MAX)), "가".repeat(api.MAP_SEARCH_QUERY_MAX));
  assert.equal(api.mapSearchQueryFrom("가".repeat(api.MAP_SEARCH_QUERY_MAX + 1)), "");
});

test("우클릭 메뉴 항목은 고른 글자가 쓸 만할 때만 켜진다", () => {
  const api = loadMapViewer();
  const enabled = api.mapSearchMenuItem("경복궁");
  assert.equal(enabled.label, api.MAP_SEARCH_MENU_LABEL);
  assert.equal(enabled.disabled, false);
  assert.equal(typeof enabled.action, "function");
  // 고른 것이 없어도 항목은 남긴다 — 감추면 이런 길이 있다는 것을 알 수 없다.
  assert.equal(api.mapSearchMenuItem("").disabled, true);
  assert.equal(api.mapSearchMenuItem("가".repeat(api.MAP_SEARCH_TEXT_MAX + 1)).disabled, true);
});

test("고른 낱말은 최근에 보던 지도로, 열린 지도가 없으면 새 지도로 간다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const body = /async function searchMapForText\(([\s\S]*?)\n\}/.exec(source);
  assert.ok(body);
  assert.match(body[1], /mapRecentMapDoc\(\) \|\| await newMapScratch\(\)/);
  assert.match(body[1], /setActiveDoc\(doc\.id\)/);
  /* 탭이 아직 그려지지 않았으면 검색칸도 없다 — 담아 두고 마운트가 받아 처리한다. 이미 그려 둔
     탭이면 담긴 말이 그대로 남아 있으므로 여기서 곧장 부른다(두 번 찾지 않게 담긴 말을 지운다). */
  assert.match(body[1], /doc\._mapPendingSearch = text/);
  assert.match(body[1], /await ensureRendered\(doc\)/);
  assert.match(body[1], /doc\._mapPendingSearch === text && typeof doc\.mapSearchFor === "function"/);
  // 새 지도를 연 쪽이 기다릴 수 있어야 한다 — handleFiles 가 만든 문서를 돌려준다.
  assert.match(source, /return Promise\.resolve\(handleFiles\(\[new File\(\[starter\]/);
  assert.match(source, /function searchMapForPlace\(raw\)\{ return searchMapForText\(raw, \{ allowAddress:true \}\); \}/);
});

test("지도 탭은 검색칸이 준비된 자리에서 다른 문서의 부탁을 받는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /closeResults\.searchFor = \(text\) => \{/);
  assert.match(source, /const placeSearch = mapAttachPlaceSearch\(gotoInput, searchBtn, searchResults/);
  assert.match(source, /doc\.mapSearchFor = \(text\) => placeSearch\.searchFor\(text\)/);
  assert.match(source, /if \(doc\._mapPendingSearch\)\{[\s\S]*?doc\.mapSearchFor\(pending\)/);
  // 닫힌 탭의 검색칸을 다른 문서가 계속 부르지 않게 정리에서 함께 끊는다.
  assert.ok(mapCleanupBodies(source).some(body => /doc\.mapSearchFor = null/.test(body)));
});

/* 편집기·표 셀은 공용 메뉴 두 개가 모두 쓰므로, 거기에 한 번 넣으면 텍스트·코드·노트북 셀·
   메모·스프레드시트 셀이 함께 따라온다. 부르는 쪽마다 옵션을 넘기지 않는다. */
test("글자를 다루는 공용 우클릭 메뉴에는 지도·파일 검색이 내장된다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");
  // textarea 편집기(코드·텍스트·노트북 셀·메모 글 블록) — 항목이 많아 '선택한 낱말로 검색' 아래로 접었다.
  assert.match(source, /search: typeof selectionSearchMenuItems === "function"/);
  assert.match(source, /selectionSearchMenuItems\(value\.slice\(selection\.start, selection\.end\), ta\)/);
  assert.match(source, /label:"선택한 낱말로 검색"[\s\S]{0,140}children: search\.map/);
  // contenteditable(메모·스프레드시트 표 셀)
  assert.match(source, /addSelectionSearchItems\(addItem, addSeparator, range \? range\.toString\(\) : "", el\)/);
  // 그 기능이 없는 화면에서는 눌러도 아무 일 없는 항목을 남기지 않는다.
  assert.match(source, /if \(typeof mapSearchMenuItem === "function"\) items\.push/);
  assert.match(source, /if \(typeof fileSearchMenuItem === "function"\) items\.push/);
  // DOCX 는 제 계층 메뉴를 쓰지만 같은 목록을 받아 문구·판정이 갈라지지 않는다.
  const docx = fs.readFileSync(path.join(__dirname, "../src/js/docx-editor.js"), "utf8");
  assert.match(docx, /selectionSearchMenuItems\(hasSelection \? commandRange\.toString\(\) : "", paragraph\)/);
  assert.match(docx, /\.\.\.searchItems,/);
});

/* 보기 전용 화면(PDF·한글·PPT·텍스트 보기)에는 편집기가 없어 매달 자리가 없다 — 문서 영역에서
   한 번만 받아 모든 뷰어가 같은 메뉴를 쓰게 한다. */
test("보기 화면의 선택 글자 메뉴는 브라우저 기본 메뉴를 함부로 뺏지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");
  const body = /function installViewSelectionContextMenu\(\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(body);
  assert.match(body[1], /if \(event\.defaultPrevented\) return/);              // 제 메뉴를 가진 화면
  assert.match(body[1], /input, textarea, \[contenteditable='true'\]/);        // 편집 메뉴가 맡는 자리
  assert.match(body[1], /getElementById\("content"\)/);                        // 사이드바·탭은 제외
  assert.match(body[1], /selection\.isCollapsed \|\| !selection\.rangeCount/);  // 고른 글자가 있을 때만
  assert.match(body[1], /selectionHitsPoint\(selection\.getRangeAt\(0\), event\.clientX, event\.clientY\)/);
  // 메뉴는 복사 + 이어 찾기 줄들. 시험 화면 판정에 쓸 실제 대상도 넘기고 시작할 때 한 번만 매단다.
  assert.match(source, /addSelectionSearchItems\(addItem, addSeparator, text, contextElement\)/);
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  assert.match(app, /installViewSelectionContextMenu\(\)/);
});

/* ===== 축척 막대 · 위경도 격자 · 표시 목록 (2026-08-18) ===== */

test("축척 막대 길이는 1·2·5 눈금으로 내려 맞춘다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapNiceScaleMeters(1370), 1000);
  assert.equal(api.mapNiceScaleMeters(2400), 2000);
  assert.equal(api.mapNiceScaleMeters(7800), 5000);
  assert.equal(api.mapNiceScaleMeters(96), 50);
  assert.equal(api.mapNiceScaleMeters(1), 1);
  // 지도 칸이 아직 0×0 이면 화면 거리가 0 으로 온다 — 막대를 그리지 않는다는 뜻으로 0.
  assert.equal(api.mapNiceScaleMeters(0), 0);
  assert.equal(api.mapNiceScaleMeters(NaN), 0);
});

test("격자 간격은 화면을 서너 칸 이상으로 나누는 가장 큰 눈금", () => {
  const api = loadMapViewer();
  assert.equal(api.mapGridStep(90), 30);      // 대륙이 보이는 자리
  assert.equal(api.mapGridStep(4), 1);        // 나라 하나쯤
  assert.equal(api.mapGridStep(0.9), 0.2);    // 도시 하나
  assert.equal(api.mapGridStep(0.01), 0.002); // 학교 둘레
  // 간격이 화면보다 크면 선이 한 줄도 안 보인다 — 늘 화면보다 잘게 잡힌다.
  for (const span of [90, 12, 4, 0.9, 0.05, 0.01]) assert.ok(api.mapGridStep(span) <= span / 3 + 1e-9, String(span));
  assert.equal(api.mapGridStep(0), api.MAP_GRID_STEPS[api.MAP_GRID_STEPS.length - 1]);
});

test("격자 눈금은 0(적도·본초자오선) 에 맞춰 떨어지고 폭주하지 않는다", () => {
  const api = loadMapViewer();
  assert.deepEqual([...api.mapGridValues(-1.2, 1.2, 1)], [-1, 0, 1]);
  assert.deepEqual([...api.mapGridValues(36.05, 36.35, 0.1)], [36.1, 36.2, 36.3]);
  // 뒤집힌 범위·잘못된 간격은 선을 그리지 않는다(손으로 고친 .map).
  assert.deepEqual([...api.mapGridValues(10, 5, 1)], []);
  assert.deepEqual([...api.mapGridValues(0, 10, 0)], []);
  assert.equal(api.mapGridValues(-90, 90, 0.001).length, api.MAP_GRID_MAX_LINES);
});

test("격자 이름표는 간격만큼만 자세히 적고 0 은 이름으로 부른다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapGridLabel(37.5, 0.5, "lat"), "37.5°N");
  assert.equal(api.mapGridLabel(-37.5, 1, "lat"), "38°S");
  assert.equal(api.mapGridLabel(127.025, 0.005, "lng"), "127.025°E");
  assert.equal(api.mapGridLabel(-127, 1, "lng"), "127°W");
  assert.equal(api.mapGridLabel(0, 1, "lat"), "0° 적도");
  assert.equal(api.mapGridLabel(0, 1, "lng"), "0° 본초자오선");
});

/* 격자는 "격자를 보이게 만들어 둔 지도"로 건네지는 것이라 문서에 저장한다.
   옛 .map 에는 없던 값이므로 없으면 끈 것으로 봐야 옛 지도의 화면이 달라지지 않는다. */
test("위경도 격자는 .map 에 저장되고 옛 파일은 꺼진 채로 열린다", () => {
  const api = loadMapViewer();
  const old = api.mapDocParse(JSON.stringify({
    type:"classdock-map", version:3, title:"옛 지도", basemap:"osm", center:[37,127], zoom:10, markers:[]
  }));
  assert.equal(old.grid, false);

  const model = api.mapDocEmpty("격자 지도");
  const before = api.mapDocContentKey(model);
  model.grid = true;
  assert.notEqual(api.mapDocContentKey(model), before, "격자를 켜면 저장 안 됨(●) 이 켜진다");
  const again = api.mapDocParse(api.mapDocSerialize(model));
  assert.equal(again.grid, true);
  assert.equal(again.version, api.MAP_DOC_VERSION);
});

/* 표시 이름은 마우스를 올려야 보였다. 늘 보이게 켤 수 있게 하되, 겹쳐서 못 읽는 축소에서는
   잠시 숨긴다(Leaflet 에 이름표 겹침 정리가 없다). 격자와 같은 성격이라 .map 에 함께 담는다. */
test("표시 이름표는 .map 에 저장되고 옛 파일은 꺼진 채로 열린다", () => {
  const api = loadMapViewer();
  const old = api.mapDocParse(JSON.stringify({
    type:"classdock-map", version:5, title:"옛 지도", basemap:"osm", center:[37,127], zoom:10, markers:[]
  }));
  assert.equal(old.labels, false);

  const model = api.mapDocEmpty("이름표 지도");
  const before = api.mapDocContentKey(model);
  model.labels = true;
  assert.notEqual(api.mapDocContentKey(model), before, "이름표를 켜면 저장 안 됨(●) 이 켜진다");
  const again = api.mapDocParse(api.mapDocSerialize(model));
  assert.equal(again.labels, true);
  assert.equal(again.version, api.MAP_DOC_VERSION);
});

/* 표시 잇는 선도 격자·이름표와 같은 성격이라(= "이어 둔 지도"로 건네진다) .map 에 담는다.
   담는 것은 켜 두었다는 사실뿐이고 선 자체는 표시에서 매번 다시 그린다 — 굳혀 두면 표시를
   옮기거나 지운 순간 선이 거짓말이 된다. */
test("표시 잇는 선은 .map 에 저장되고 옛 파일은 꺼진 채로 열린다", () => {
  const api = loadMapViewer();
  const old = api.mapDocParse(JSON.stringify({
    type:"classdock-map", version:6, title:"옛 지도", basemap:"osm", center:[37,127], zoom:10, markers:[]
  }));
  assert.equal(old.route, false);

  const model = api.mapDocEmpty("이어 둔 지도");
  const before = api.mapDocContentKey(model);
  model.route = true;
  assert.notEqual(api.mapDocContentKey(model), before, "선을 켜면 저장 안 됨(●) 이 켜진다");
  const again = api.mapDocParse(api.mapDocSerialize(model));
  assert.equal(again.route, true);
  assert.equal(again.version, api.MAP_DOC_VERSION);
  // 선을 저장하지 않는다는 것이 요점이다 — .map 에 폴리라인이 새로 생기면 안 된다.
  assert.deepEqual(again.shapes, []);
});

test("표시 잇는 선은 목록 순서를 따르고 감춘 묶음은 빼며 내용이 바뀔 때마다 다시 그린다", () => {
  const api = loadMapViewer();
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  // 이을 차례는 표시 배열 순서 그대로다(발표 순서·목록의 ↑↓ 와 같은 차례여야 헷갈리지 않는다).
  assert.match(source,
    /const routePoints = \(\) => model\.markers\.filter\(markerVisible\)\.map\(marker => \[marker\.lat, marker\.lng\]\);/);
  // 표시가 둘이 안 되면 선을 걷어 낸다(한 점짜리 선은 그릴 것이 없다).
  // 미리 선언해 둔 빈 함수(let redrawRoute = () => {};)가 아니라 실제 본문을 잡는다.
  const draw = /\n  redrawRoute = \(\) => \{\n([\s\S]*?)\n  \};/.exec(source);
  assert.ok(draw);
  assert.match(draw[1], /if \(points\.length < 2\)\{/);
  assert.match(draw[1], /map\.removeLayer\(routeLayer\); routeLayer = null;/);
  // 이미 그린 선은 다시 만들지 않고 점만 갈아 끼운다 — 켤 때마다 새로 만들면 화면이 깜빡인다.
  assert.match(draw[1], /routeLayer\.setLatLngs\(points\)/);
  // setLatLngs 는 영구 tooltip 자리를 옮기지 않으므로 바뀐 선의 가운데로 이름표도 직접 옮긴다.
  assert.match(draw[1], /routeTooltip\.setLatLng\(routeLayer\.getCenter\(\)\)/);
  // 내용이 바뀌는 길은 전부 touch 를 지난다 — 다시 그리기를 거기 한 곳에만 매달아 빠뜨리지 않는다.
  const touch = /const touch = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(touch);
  assert.match(touch[1], /redrawRoute\(\);/);
  // 목록에서 감춘 묶음은 선에서도 빠진다(없는 표시로 선이 돌아가면 읽을 수 없다).
  const visibility = /const applyMarkerVisibility = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(visibility);
  assert.match(visibility[1], /redrawRoute\(\);/);
  // 끄는 동안에도 따라온다(놓는 순간에만 그리면 선이 툭 튄다). 다만 그때 touch 는 부르지 않는다.
  assert.match(source, /layer\.on\("drag", \(\) => \{\n\s*if \(!model\.route\) return;/);
  // 되돌리기 범위도 격자·이름표와 같다.
  assert.match(source, /!!model\.grid, !!model\.labels, !!model\.route, !!model\.drive,[\s\S]*?mapNormalizeDriveOptions\(model\.driveOptions\), mapNormalizeRadius\(model\.radius\)\]\)/);
  assert.match(source, /model\.route = saved\[7\] === true;/);
  // 되돌리기는 마커 레이어를 새로 만드므로, 감춘 묶음의 보기 상태와 선도 함께 다시 입힌다.
  assert.match(source, /drawGrid\(\);[\s\S]*?applyMarkerVisibility\(\);[\s\S]*?applyBasemap\(\);/);
  // 선은 도형(overlayPane 400)·표시(markerPane 600) 아래에 깔되 격자(350) 위에 둔다.
  assert.match(source, /createPane\("mapRoutePane"\)/);
  assert.match(source, /routePane\.style\.zIndex = "380"/);
  assert.ok(api.MAP_ROUTE_TANGLE_MARKERS >= 10);
  assert.match(styles, /\.map-route-label\{/);
});

test("이름표는 읽을 수 있는 확대에서만 내놓고 표시가 너무 많으면 켜지 않는다", () => {
  const api = loadMapViewer();
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.ok(api.MAP_LABEL_MIN_ZOOM > 1 && api.MAP_LABEL_MIN_ZOOM < 19);
  assert.ok(api.MAP_LABEL_MAX_MARKERS >= 100);
  // 켜 두었어도 확대가 모자라면 내지 않는다.
  assert.match(source, /const labelsWanted = \(\) => !!model\.labels && map\.getZoom\(\) >= MAP_LABEL_MIN_ZOOM/);
  // Leaflet 은 매단 뒤에 permanent 를 바꿀 수 없다 — 다시 매다는 수밖에 없고, 그래서 실제로
  // 달라질 때만 부른다(확대할 때마다 수백 개를 다시 매달면 지도가 끊긴다).
  const sync = /const syncMarkerLabels = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(sync);
  assert.match(sync[1], /if \(labelsWanted\(\) === labelsShown\) return/);
  assert.match(sync[1], /bindMarkerTooltip\(layer, marker\)/);
  assert.match(source, /map\.on\("zoomend", syncMarkerLabels\)/);
  // 켜 둔 채로 저장된 지도는 처음부터, 되돌리기로 되살아난 지도도 그 상태로 다시 매단다.
  assert.equal((source.match(/labelsShown = labelsWanted\(\);/g) || []).length, 2);
  // 표시가 너무 많으면 켜지 않고 까닭을 알려 준다(켜 둔 것을 끄는 길은 막지 않는다).
  assert.match(source, /if \(!model\.labels && model\.markers\.length > MAP_LABEL_MAX_MARKERS\)\{/);
  // 이름표는 클릭을 가로채지 않는다 — 핀을 눌러 편집 풍선을 여는 길이 막히면 안 된다.
  assert.match(styles, /\.map-pin-label\{[\s\S]*?pointer-events:none/);
});

test("표시 목록의 묶음 이름은 꼬리표를 사람 말로 바꾼다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapSourceLabel(""), "직접 찍은 표시");
  assert.equal(api.mapSourceLabel("nearby"), "주변 시설");
  assert.equal(api.mapSourceLabel("timeline"), "연대표 표");
  assert.equal(api.mapSourceLabel("unknown"), "unknown");   // 모르는 꼬리표도 묶음은 갈라 준다
});

/* 축척·방위·격자는 화면 장식이 아니라 인쇄물에 남아야 하는 것이다. Leaflet 컨트롤 칸은 캡처
   직전에 통째로 감추므로(확대 단추가 그림에 박히지 않게) 그 안에 두면 그림에서 사라진다. */
test("축척·방위표는 컨트롤 칸이 아니라 지도 칸에 붙어 캡처에 남는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /legend\.className = "map-legend"/);
  assert.match(source, /stage\.appendChild\(legend\)/);
  const hidden = /const MAP_CAPTURE_HIDDEN_PANES = \[(.*?)\];/.exec(source);
  assert.ok(hidden);
  assert.doesNotMatch(hidden[1], /map-legend|map-grid/);
  // 격자는 배경 위·도형 아래(overlayPane 400) 라야 거리선과 영역을 가리지 않는다.
  assert.match(source, /createPane\("mapGridPane"\)/);
  assert.match(source, /gridPane\.style\.zIndex = "350"/);
  assert.doesNotMatch(source, /L\.control\.scale/);   // Leaflet 컨트롤은 캡처에서 감춰지므로 쓰지 않는다
});

test("목록에서 감춘 묶음은 지도에서도 그림에서도 함께 빠진다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const visibility = /const applyMarkerVisibility = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(visibility);
  assert.match(visibility[1], /redrawClusters\(\)/);
  assert.match(source, /redrawClusters = \(\) => \{[\s\S]*?markerVisible\(marker\)[\s\S]*?map\.hasLayer\(layer\)/);
  // 화면에 없는 표시의 이름만 그림에 새겨지면 읽을 수 없다.
  assert.match(source, /model\.markers\.filter\(m => m\.label && markerVisible\(m\)[\s\S]*?map\.hasLayer\(markerLayers\.get\(m\.id\)\)\)/);
  // 감춰 둔 묶음에 새 표시를 찍으면 눌러도 아무 일이 없는 것처럼 보인다.
  assert.match(source, /hiddenSources\.delete\(marker\.source \|\| ""\)/);
  // 목록은 내용이 바뀌는 길 한 곳(touch)에서만 다시 그린다 — 빠뜨리는 길이 생기지 않게.
  const touch = /const touch = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.match(touch[1], /scheduleListRefresh\(\)/);
});

/* 화면을 그대로 인쇄하면 도구막대·목록만 찍히고 지도 칸은 빈 종이가 된다(화이트보드·악보와 같다). */
test("지도 인쇄는 캡처한 그림 한 장을 찍고 머리글 인쇄 단추도 그 길로 온다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const print = /const printMap = async \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(print);
  assert.match(print[1], /await captureMapPng\(\)/);
  assert.match(print[1], /classList\.add\("map-printing"\)/);
  assert.match(print[1], /image\.onload = resolve/);        // 다 그려지기 전에 찍으면 빈 종이
  assert.match(print[1], /removeEventListener\("afterprint", cleanup\)/);
  assert.match(source, /doc\.printMap = printMap/);
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  assert.match(app, /state\.kind === "map" && typeof state\.printMap === "function"/);
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(css, /body\.map-printing>\*\{display:none!important\}/);
  assert.match(css, /body\.map-printing>\.map-print\{display:block!important\}/);
  // 탭을 닫으면 머리글 단추가 사라진 지도를 계속 부르지 않게 고리를 끊는다.
  const cleanups = mapCleanupBodies(source).join("\n");
  assert.match(cleanups, /doc\.printMap = null/);
  assert.match(cleanups, /clearTimeout\(listTimer\)/);
});

/* ===== 표시 사진 · 발표 모드 · 지도 문제 (2026-08-18) ===== */

test("표시 사진은 data URL 만 받고 한 장·전체 크기를 눌러 담는다", () => {
  const api = loadMapViewer();
  const small = "data:image/jpeg;base64," + "A".repeat(100);
  const marker = api.mapNormalizeMarker({ lat:37, lng:127, photo:{ name:"답사.jpg", dataUrl:small, width:800, height:600 } });
  assert.equal(marker.photo.dataUrl, small);
  assert.equal(marker.photo.width, 800);
  // 바깥 주소는 받지 않는다 — 인터넷이 없으면 빈 칸이 되고, 남의 서버로 요청이 나간다.
  assert.equal(api.mapNormalizeMarker({ lat:37, lng:127, photo:{ dataUrl:"https://example.com/a.jpg" } }).photo, null);
  // 한 장 상한을 넘는 사진은 통째로 버린다(반쯤 담긴 지도를 만들지 않는다).
  const huge = "data:image/jpeg;base64," + "A".repeat(api.MAP_PHOTO_MAX_DATA_CHARS);
  assert.equal(api.mapNormalizeMarker({ lat:37, lng:127, photo:{ dataUrl:huge } }).photo, null);
  // 옛 .map 의 표시에는 사진 칸이 없다 — null 로 시작한다.
  assert.equal(api.mapNormalizeMarker({ lat:37, lng:127 }).photo, null);
  assert.equal(api.mapPhotoTotalChars([
    { photo:{ dataUrl:small } }, { photo:null }, {}, { photo:{ dataUrl:small } }
  ]), small.length * 2);
});

test("사진은 .map 에 함께 저장되고 저장 안 됨(●) 판정에도 들어간다", () => {
  const api = loadMapViewer();
  const model = api.mapDocEmpty("답사 지도");
  model.markers.push(api.mapNormalizeMarker({ lat:37.5, lng:127, label:"운동장" }));
  const before = api.mapDocContentKey(model);
  model.markers[0].photo = { name:"a.jpg", dataUrl:"data:image/jpeg;base64,AAAA", width:10, height:10 };
  assert.notEqual(api.mapDocContentKey(model), before);
  const again = api.mapDocParse(api.mapDocSerialize(model));
  assert.equal(again.markers[0].photo.dataUrl, "data:image/jpeg;base64,AAAA");
  assert.equal(again.version, api.MAP_DOC_VERSION);
});

/* 발표 순서를 새 필드로 두지 않은 까닭 — 순서는 이미 저장되는 표시 배열 그 자체다. 목록의 ▲▼가
   배열을 바꾸고, 발표는 그 배열을 그대로 훑는다(화면마다 따로 노는 순서를 만들지 않는다). */
test("발표 모드는 표시 배열 순서를 그대로 돌고 감춘 묶음은 뺀다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /const presentList = \(\) => model\.markers\.filter\(markerVisible\)/);
  assert.doesNotMatch(source, /marker\.step|questionOrder/);          // 순서 전용 필드를 만들지 않았다
  // 목록의 ▲▼ 는 "지금 보이는 줄"의 앞뒤와 자리를 바꾼다(걸러 놓은 목록에서도 눈에 보이는 대로).
  const move = /const moveBy = \(delta\) => \{([\s\S]*?)\n      \};/.exec(source);
  assert.ok(move);
  assert.match(move[1], /matched\.indexOf\(marker\)/);
  assert.match(move[1], /model\.markers\[from\] = neighbour/);
  assert.match(move[1], /touch\(\)/);
  // 발표 카드는 지도 칸 바깥에 얹는다 — 안에 두면 칠판·PNG 캡처에 카드가 통째로 찍힌다.
  assert.match(source, /body\.append\(stage, listPanel, present\)/);
  // 발표는 보기만 하는 일이라, 끝내면 보던 자리로 돌려놓는다.
  assert.match(source, /if \(presentReturn\) map\.setView\(presentReturn\.center, presentReturn\.zoom\)/);
});

test("지도 문제 학생 화면은 편집 도구를 감추고 답을 문서에 적지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  // 문제 파일의 지도만 가져오고 정답 표시는 학생 지도에 넣지 않는다.
  const opener = /function openMapTaskDoc\(task, hash, opts = \{\}\)\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(opener);
  assert.match(opener[1], /markers: \[\],/);
  assert.match(opener[1], /answers: new Map\(\)/);
  // 학생 화면에서는 도구막대·목록·우클릭 메뉴를 내놓지 않는다(답 찍기와 섞이고 정답을 적게 된다).
  assert.match(source, /bar\.hidden = true;\s+\/\/ 편집 도구는 문제 풀이 화면에 내놓지 않는다/);
  assert.match(source, /if \(doc\.mapTaskCtx\) return;/);
  // 답은 model.markers 가 아니라 ctx.answers 에만 쌓인다.
  assert.match(source, /ctx\.answers\.set\(question\.id, point\)/);
  assert.doesNotMatch(source, /model\.markers\.push\(.*answer/i);
  // 채점·제출은 과제 패키지가 맡는다 — 없으면 눌러도 안 되는 단추를 만들지 않는다.
  assert.match(source, /typeof mapTaskGrade !== "function"/);
  assert.match(source, /typeof exportMapTaskSubmission !== "function"/);
  assert.match(source, /if \(typeof openMapTaskBuilder === "function"\)/);
});

/* ── 자동차 길찾기(카카오모빌리티) ──
   길은 문서에 담지 않고 켤 때마다 다시 묻는다. 그래서 시험이 지키는 것은 두 가지다 — 좌표를
   카카오가 받는 꼴로 정확히 뒤집어 보내는지, 돌아온 답에서 화면에 그릴 선을 제대로 꺼내는지. */
test("길찾기 요청은 첫 표시를 출발·마지막을 도착으로 두고 좌표를 경도,위도 차례로 보낸다", () => {
  const api = loadMapViewer();
  const spot = api.mapDirectionsSpot([[37.5665, 126.9780], [37.4979, 127.0276], [37.5796, 126.9770]], {
    priority:"TIME", avoid:["toll", "schoolzone", "bogus"], fuel:"DIESEL", hipass:true, alternatives:true
  });
  assert.equal(spot.x, "126.978000");
  assert.equal(spot.y, "37.566500");
  assert.equal(spot.x2, "126.977000");
  assert.equal(spot.y2, "37.579600");
  // 사이에 있는 표시만 들르는 곳이 된다(카카오는 x=경도·y=위도 차례).
  assert.equal(spot.via, "127.027600,37.497900");
  assert.equal(spot.priority, "TIME");
  assert.equal(spot.avoid, "toll|schoolzone");
  assert.equal(spot.fuel, "DIESEL");
  assert.equal(spot.hipass, "true");
  assert.equal(spot.alternatives, "true");
  // 표시가 하나뿐이면 물을 것이 없다 — 런처까지 가지 않고 여기서 끊는다.
  assert.equal(api.mapDirectionsSpot([[37.5, 127.0]]), null);
  assert.equal(api.mapDirectionsSpot([]), null);
});

test("길찾기 답에서 도로 좌표를 하나로 잇고 이음매의 겹친 점은 버린다", () => {
  const api = loadMapViewer();
  const result = api.mapDirectionsRoute({
    routes: [{
      result_code: 0,
      result_msg: "길찾기 성공",
      summary: { distance: 12345, duration: 1500, priority:"TIME", fare:{ toll:2400, taxi:17800 } },
      sections: [
        { distance:4000, duration:500,
          roads: [{ name:"세종대로", distance:4000, duration:500, traffic_speed:14, traffic_state:2,
            vertexes: [126.9780, 37.5665, 126.9800, 37.5670] }],
          guides: [{ name:"출발지", guidance:"출발지", x:126.9780, y:37.5665, distance:0, duration:0, type:100 }] },
        // 들르는 곳이 있으면 구간이 나뉘고 이음매에 같은 점이 한 번 더 온다.
        { distance:8345, duration:1000,
          roads: [{ name:"강남대로", distance:8345, duration:1000, traffic_speed:31, traffic_state:4,
            vertexes: [126.9800, 37.5670, 127.0276, 37.4979] }],
          guides: [{ name:"", guidance:"우회전", x:126.9800, y:37.5670, distance:4000, duration:500, type:2 }] }
      ]
    }]
  });
  assert.equal(result.error, "");
  assert.equal(JSON.stringify(result.points), JSON.stringify([[37.5665, 126.9780], [37.5670, 126.9800], [37.4979, 127.0276]]));
  assert.equal(result.distance, 12345);
  assert.equal(result.duration, 1500);
  assert.equal(result.toll, 2400);
  assert.equal(result.taxi, 17800);
  assert.equal(result.priority, "TIME");
  assert.deepEqual(JSON.parse(JSON.stringify(result.sections.map(section => ({ distance:section.distance, duration:section.duration })))),
    [{ distance:4000, duration:500 }, { distance:8345, duration:1000 }]);
  assert.equal(result.roads.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.roads[0])), {
    name:"세종대로", distance:4000, duration:500, trafficSpeed:14, trafficState:2,
    points:[[37.5665,126.978],[37.567,126.98]]
  });
  assert.equal(result.guides.length, 2);
  assert.equal(result.guides[1].guidance, "우회전");
  assert.equal(result.guides[1].type, 2);
  assert.equal(api.mapDriveTrafficInfo(2).label, "지체");
  assert.equal(api.mapDriveTrafficInfo(4).color, "#16a34a");
});

test("길찾기 상세 설정은 허용된 값만 저장하고 예전 지도에는 안전한 기본값을 채운다", () => {
  const api = loadMapViewer();
  assert.deepEqual(JSON.parse(JSON.stringify(api.mapNormalizeDriveOptions({
    priority:"BOGUS", avoid:["uturn", "toll", "uturn", "hack"], fuel:"ELECTRIC",
    hipass:1, alternatives:true, reverse:true, optimize:true, compare:false
  }))), {
    priority:"RECOMMEND", avoid:["toll", "uturn"], fuel:"GASOLINE",
    hipass:false, alternatives:true, reverse:true, optimize:true, compare:false
  });
  const model = api.mapDocEmpty("상세 길찾기");
  model.driveOptions = api.mapNormalizeDriveOptions({ priority:"DISTANCE", avoid:["motorway"], fuel:"LPG", hipass:true });
  const back = api.mapDocParse(api.mapDocSerialize(model));
  assert.equal(back.driveOptions.priority, "DISTANCE");
  assert.deepEqual([...back.driveOptions.avoid], ["motorway"]);
  assert.equal(back.driveOptions.fuel, "LPG");
  assert.equal(back.driveOptions.hipass, true);
});

test("경유지 자동 최적화는 출발·도착을 고정하고 가운데 표시의 최단 직선 순서를 정확히 고른다", () => {
  const api = loadMapViewer();
  const items = [
    { label:"출발", lat:0, lng:0 }, { label:"먼저 들어온 먼 곳", lat:0, lng:2 },
    { label:"가까운 곳", lat:0, lng:1 }, { label:"도착", lat:0, lng:3 }
  ];
  assert.equal(JSON.stringify(api.mapOptimizeDriveOrder(items).map(item => item.label)),
    JSON.stringify(["출발", "가까운 곳", "먼저 들어온 먼 곳", "도착"]));
  assert.equal(JSON.stringify(api.mapDriveOrderedItems(items, { reverse:true, optimize:true }).map(item => item.label)),
    JSON.stringify(["도착", "먼저 들어온 먼 곳", "가까운 곳", "출발"]));
  const many = Array.from({ length:2100 }, (_, index) => [37, 126 + index / 100000]);
  const sampled = api.mapSampleRoutePoints(many);
  assert.equal(sampled.length, 2000);
  assert.equal(JSON.stringify(sampled[0]), JSON.stringify(many[0]));
  assert.equal(JSON.stringify(sampled.at(-1)), JSON.stringify(many.at(-1)));
});

test("길을 못 찾은 답은 HTTP 200 이어도 실패로 가른다", () => {
  const api = loadMapViewer();
  // 카카오는 길이 없어도 200 을 주고 result_code 로만 알려 준다(바다 건너편 …).
  const failed = api.mapDirectionsRoute({ routes: [{ result_code: 104, result_msg: "출발지와 도착지가 5m 이내" }] });
  assert.equal(failed.error, "directions-failed");
  assert.equal(failed.points.length, 0);
  // 도로 좌표가 한 점뿐이면 그릴 선이 없다.
  const empty = api.mapDirectionsRoute({ routes: [{ result_code: 0, sections: [{ roads: [{ vertexes: [126.9, 37.5] }] }] }] });
  assert.equal(empty.error, "directions-empty");
  assert.equal(api.mapDirectionsRoute(null).error, "directions-empty");
  assert.equal(api.mapDirectionsRoute({ routes: [] }).error, "directions-empty");
});

test("예상 소요시간은 분으로 읽히고 0분으로 떨어지지 않는다", () => {
  const api = loadMapViewer();
  assert.equal(api.mapFormatDuration(20), "1분");        // 코앞이라도 0분은 길이 없는 것처럼 읽힌다
  assert.equal(api.mapFormatDuration(1500), "25분");
  assert.equal(api.mapFormatDuration(3600), "1시간");
  assert.equal(api.mapFormatDuration(5400), "1시간 30분");
});

test("자동차 길찾기 켜 둔 사실은 .map 에 남고 길 자체는 담기지 않는다", () => {
  const api = loadMapViewer();
  const model = api.mapDocEmpty("소풍 길");
  assert.equal(model.drive, false);
  model.drive = true;
  const text = api.mapDocSerialize(model);
  assert.match(text, /"drive": true/);
  // 도로 좌표는 어디에도 담기지 않는다 — 표시를 옮긴 뒤에도 옛 길이 남으면 지도가 거짓말을 한다.
  assert.doesNotMatch(text, /vertexes|sections/);
  assert.equal(api.mapDocParse(text).drive, true);
  // 켜고 끈 것은 저장되는 내용이라 ● 판정에도 들어간다.
  assert.notEqual(api.mapDocContentKey(model), api.mapDocContentKey(api.mapDocEmpty("소풍 길")));
  // 이 값이 없던 옛 지도는 꺼진 것으로 읽는다(옛 지도의 화면이 달라지지 않게).
  const old = JSON.parse(text);
  delete old.drive;
  assert.equal(api.mapDocParse(JSON.stringify(old)).drive, false);
});

test("자동차 길찾기는 설정한 순서에서 표시 7개까지만 한 번에 잇는다", () => {
  const api = loadMapViewer();
  // 카카오 경유지 상한(5)에 출발·도착을 더한 값이다.
  assert.equal(api.MAP_DRIVE_MAX_MARKERS, 7);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(source, /const points = mapDriveOrderedItems\(allPoints, settings\)/);
  assert.match(source, /설정한 순서의 \{max\}개만 길을 찾았습니다/);
  assert.match(source, /driveTrafficLayers[\s\S]*?mapDriveTrafficInfo\(road\.trafficState\)/);
  assert.match(source, /onSaveRoute:[\s\S]*?mapSampleRoutePoints\(route\.points\)[\s\S]*?addShapeLayer\(shape\)/);
  // 표시를 끌어 옮기는 동안에는 묻지 않는다(하루 무료 몫을 드래그 한 번에 다 쓰지 않게).
  assert.match(source, /driveTimer = setTimeout\(\(\) => \{ runDrive\(\); \}, MAP_DRIVE_DELAY_MS\)/);
  // 같은 표시 배치로 두 번 묻지 않는다 — 실패한 배치도 '손을 본 것'으로 적어 같은 안내를
  // 되풀이하지 않는다(제목을 한 글자 칠 때마다 touch 가 들어온다).
  assert.match(source, /if \(signature === driveKey\) return;/);
  assert.match(source, /driveFailed\(result\.error, signature\)/);
  // 표시가 하나 이하로 줄었을 때 진행 중이던 옛 답도 무효화해야 삭제한 경로가 되살아나지 않는다.
  assert.match(source, /const dropDrive = \(\) => \{[\s\S]*?driveSeq\+\+;[\s\S]*?driveLayer/);
});

test("카카오 키가 없으면 길찾기 비교 버튼을 실제 비활성화한다", () => {
  const api = loadMapViewer();
  assert.match(api.mapDriveGuide({ provider:false }), /카카오 지도 검색을 켜야/);
  assert.match(api.mapDriveGuide({ provider:true, available:false }), /런처에서 사용할 수 있어요/);
  assert.match(api.mapDriveGuide({ provider:true, available:true, hasKey:false }), /REST API 키/);
  assert.equal(api.mapDriveGuide({ provider:true, available:true, hasKey:true }), "");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  // 켜 둔 채로 저장한 지도를 열 때도, 카카오가 갖춰졌을 때만 묻는다.
  assert.match(source, /if \(model\.drive\) refreshNearbyReady\(\)\.then\(\(\) => \{ if \(nearbyReady\) scheduleDrive\(\); \}\)/);
  assert.match(source, /driveBtn\.disabled = true/);
  assert.match(source, /driveBtn\.disabled = !nearbyReady/);
  assert.match(source, /driveBtn\.title = nearbyReady[\s\S]*?mapDriveGuide\(nearbyAccess\)/);
  assert.match(source, /await refreshNearbyReady\(\);[\s\S]*?if \(!nearbyReady\)[\s\S]*?return;[\s\S]*?openMapDriveSettings/);
});

test("두 런처는 길찾기를 무기한 장소 캐시에서 빼고 상세 경로에 더 큰 응답 상한을 쓴다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  for (const launcher of [csharp, go]){
    assert.match(launcher, /DirectionsMaxBytes|directionsMaxBytes/);
    assert.match(launcher, /provider != "kakao-directions"/);
  }
  assert.match(csharp, /provider == "kakao-directions" \? DirectionsMaxBytes : GeocodeMaxBytes/);
  assert.match(go, /if provider == "kakao-directions" \{\s*maxBytes = directionsMaxBytes/);
});

test("두 런처는 길찾기 상세 옵션을 허용 목록으로 제한해 카카오에 전달한다", () => {
  const csharp = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  const go = fs.readFileSync(path.join(__dirname, "../desktop/main.go"), "utf8");
  for (const launcher of [csharp, go]){
    assert.match(launcher, /RECOMMEND.*TIME.*DISTANCE/s);
    assert.match(launcher, /GASOLINE.*DIESEL.*LPG/s);
    assert.match(launcher, /ferries.*toll.*motorway.*schoolzone.*uturn/s);
    assert.match(launcher, /car_fuel/);
    assert.match(launcher, /car_hipass/);
    assert.match(launcher, /alternatives/);
  }
});
