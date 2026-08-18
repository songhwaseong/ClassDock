"use strict";
/*
 * 지도 문서(.map) — 수업에서 같이 보는 살아있는 지도.
 *
 * 왜 카카오맵이 아닌가: 카카오·네이버 지도 SDK 는 JS 키에 "사이트 도메인"을 등록해야 하는데
 * 이 앱은 실행할 때마다 127.0.0.1 의 빈 포트를 잡고(desktop/main.go), 오프라인 HTML 은 file://
 * 로도 열린다. 등록할 주소가 없으니 SDK 가 거부한다. 게다가 키가 배포본에 그대로 실려 학생
 * PC 마다 퍼지고, 타일을 저장해 두는 것도 약관에서 막는다 — "인터넷 없이 동작한다"는 이 앱의
 * 전제와 정면으로 부딪힌다. Leaflet + 공개 타일은 키도 도메인 등록도 없고 라이브러리 자체가
 * vendor 에 들어가 있어(오프라인), 인터넷은 배경 타일에만 필요하다.
 *
 * 배경 타일은 exe 로 돌 때 런처의 /tile-proxy 를 거친다 — 노트북 PDF 의 지도 스냅샷이 쓰던
 * 그 엔드포인트로, 서버가 타일을 캐시해 두므로 같은 지역을 다시 볼 때 훨씬 빠르다. 프록시가
 * 없는 환경(file://·옛 exe)에서는 타일 주소를 그대로 쓴다.
 */

const MAP_DOC_TYPE = "classdock-map";
const MAP_DOC_VERSION = 3;
const MAP_BACKGROUND_MAX_DATA_CHARS = 8 * 1024 * 1024;
const MAP_CSV_MAX_MARKERS = 5000;
/* 주소만 적힌 CSV 를 좌표로 바꿀 때의 상한. 한 줄에 한 번씩 검색을 부르므로(OSM 은 정책상 1초에
   한 건) 수업 시간 안에 끝나는 만큼만 받는다. */
const MAP_GEOCODE_BATCH_MAX = 200;

/* 배경지도 — 여기 넣는 호스트는 런처의 허용 목록(launcher.cs TileProxyHosts)에 반드시 있어야 한다.
   목록에 없는 호스트를 쓰면 프록시가 502 를 돌려주고 지도가 회색으로 남는다. */
const MAP_BASEMAPS = {
  osm: {
    label: "일반 지도",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: "© OpenStreetMap 기여자"
  },
  terrain: {
    label: "지형(등고선)",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    attribution: "© OpenTopoMap · © OpenStreetMap 기여자"
  },
  light: {
    label: "흑백(판서용)",
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    maxZoom: 19,
    attribution: "© CARTO · © OpenStreetMap 기여자"
  },
  satellite: {
    label: "위성 사진",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 18,
    attribution: "© Esri"
  }
};

const MAP_MARKER_COLORS = [
  { id:"red",    label:"빨강", hex:"#e11d48" },
  { id:"blue",   label:"파랑", hex:"#2563eb" },
  { id:"green",  label:"초록", hex:"#16a34a" },
  { id:"amber",  label:"노랑", hex:"#d97706" },
  { id:"purple", label:"보라", hex:"#7c3aed" },
  { id:"slate",  label:"검정", hex:"#334155" }
];

/* 표시를 새로 찍을 때 그 자리의 주소를 이름에 채울지. 지도 문서마다가 아니라 사람마다의 습관이라
   .map 파일이 아닌 이 브라우저에 남긴다(지도 고르기 창의 마지막 위치와 같은 자리). */
const MAP_AUTO_ADDRESS_KEY = "mn.mapAutoAddress";
function mapAutoAddressOn(){
  try { return localStorage.getItem(MAP_AUTO_ADDRESS_KEY) === "1"; } catch(_){ return false; }
}
function mapRememberAutoAddress(on){
  try { localStorage.setItem(MAP_AUTO_ADDRESS_KEY, on ? "1" : "0"); } catch(_){}
}

/* 지도를 누른 자리가 어디인지 말풍선으로 띄울지. 주소 자동 채우기와 같은 갈래(사람마다의 습관)라
   .map 파일이 아닌 이 브라우저에 남긴다. 기본은 켬 — 카카오 지도를 쓰다 온 사람은 건물을 누르면
   무언가 뜨는 것을 먼저 기대하기 때문이다. */
const MAP_SPOT_INFO_KEY = "mn.mapSpotInfo";
function mapSpotInfoOn(){
  try { return localStorage.getItem(MAP_SPOT_INFO_KEY) !== "0"; } catch(_){ return true; }
}
function mapRememberSpotInfo(on){
  try { localStorage.setItem(MAP_SPOT_INFO_KEY, on ? "1" : "0"); } catch(_){}
}

/* 최근 검색어 — 검색란을 누르면 아래로 펼친다. 같은 사람이 같은 곳을 되찾는 습관이므로 .map 파일이
   아니라 이 브라우저에 남긴다(문서를 나눠 줘도 남의 검색어가 따라가지 않는다). */
const MAP_SEARCH_HISTORY_KEY = "mn.mapSearchHistory";
const MAP_SEARCH_HISTORY_MAX = 8;
function mapSearchHistory(){
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_SEARCH_HISTORY_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.map(item => String(item || "").trim()).filter(Boolean).slice(0, MAP_SEARCH_HISTORY_MAX);
  } catch(_){ return []; }
}
function mapWriteSearchHistory(list){
  try { localStorage.setItem(MAP_SEARCH_HISTORY_KEY, JSON.stringify(list)); } catch(_){}
  return list;
}
// 찾았던 말을 또 찾으면 줄을 늘리지 않고 맨 위로만 올린다(대소문자·앞뒤 공백은 같은 말로 본다).
function mapRememberSearch(text){
  const value = String(text || "").trim();
  if (!value) return mapSearchHistory();
  const key = value.toLowerCase();
  return mapWriteSearchHistory(
    [value, ...mapSearchHistory().filter(item => item.toLowerCase() !== key)].slice(0, MAP_SEARCH_HISTORY_MAX));
}
function mapForgetSearch(text){
  const key = String(text || "").trim().toLowerCase();
  return mapWriteSearchHistory(mapSearchHistory().filter(item => item.toLowerCase() !== key));
}
function mapClearSearchHistory(){ return mapWriteSearchHistory([]); }

// 프록시로 받던 타일이 계속 실패하면(옛 exe 등) 조용히 직접 주소로 되돌린다.
const MAP_PROXY_FAIL_LIMIT = 6;
// 남한 전체가 한 화면에 들어오는 자리 — 새 지도의 기본값.
const MAP_DEFAULT_CENTER = [36.35, 127.85];
const MAP_DEFAULT_ZOOM = 7;

let _mapScratchCount = 0;
// 같은 메모 블록을 여는 동안 두 번째 클릭이 들어오면 첫 작업을 함께 기다린다. 열린 docs 만
// 검사하면 IndexedDB 읽기·파일 로딩 사이의 틈에 같은 블록을 두 탭으로 만들 수 있다.
const _mapMemoOpenTasks = new Map();

/* 한/EN 전환. 버튼·설명처럼 DOM 에 그대로 있는 문구는 mapTranslate 로 통째 번역하고(사전에
   없으면 한국어로 남는다), 숫자가 끼어 조립되는 문구만 mapT/mapTf 로 그때그때 옮긴다. */
function mapT(text){
  return typeof window.t === "function" ? window.t(text) : text;
}
function mapTf(template, vars){
  if (typeof window.tf === "function") return window.tf(template, vars);
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (vars[key] != null ? String(vars[key]) : whole));
}
function mapTranslate(root){
  if (root && window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(root);
}

/* ===== 모델 ===== */
function mapDocDefaultTitle(name){
  return String(name || "").replace(/\.map$/i, "") || "지도";
}
function mapMarkerId(){
  return "mk-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
function mapShapeId(){
  return "sh-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
/* 한 번에 넣은 표시·도형을 한 묶음으로 묶는 번호. '주변 시설'처럼 수십 개가 한꺼번에 들어오는
   길에 붙여 두면 그 묶음만 골라 되돌리거나 지울 수 있다. */
function mapBatchId(){
  return "bt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
// 꼬리표는 우리가 붙이는 짧은 슬러그만 받아들인다(손으로 고친 .map 이 들어와도 안전하게).
function mapNormalizeSource(value){
  const text = String(value == null ? "" : value).trim().toLowerCase();
  return /^[a-z]{1,12}$/.test(text) ? text : "";
}
function mapNormalizeBatch(value){
  const text = String(value == null ? "" : value).trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(text) ? text : "";
}
function mapColorHex(id){
  const found = MAP_MARKER_COLORS.find(c => c.id === id);
  return found ? found.hex : MAP_MARKER_COLORS[0].hex;
}
// 좌표는 지구 밖으로 못 나가게 눌러 둔다 — 손으로 고친 .map 파일이 들어와도 지도가 깨지지 않게.
function mapClampLat(value){
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(85, Math.max(-85, n)) : 0;
}
function mapClampLng(value){
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(180, Math.max(-180, n)) : 0;
}
function mapNormalizeMarker(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const colorId = MAP_MARKER_COLORS.some(c => c.id === value.color) ? value.color : "red";
  return {
    id: String(value.id || "") || mapMarkerId(),
    lat: mapClampLat(value.lat),
    lng: mapClampLng(value.lng),
    label: String(value.label == null ? "" : value.label).slice(0, 120),
    note: String(value.note == null ? "" : value.note).slice(0, 2000),
    color: colorId,
    // 행정구역(시도·시군구)은 '지역 통계'가 채워 넣는다. 옛 .map 에는 없으므로 늘 빈 문자열로 시작한다.
    region: String(value.region == null ? "" : value.region).slice(0, 40),
    district: String(value.district == null ? "" : value.district).slice(0, 40),
    /* 어디서 한꺼번에 들어온 표시인지(주변 시설 등)와 그때의 묶음 번호. 손으로 찍은 표시는 늘
       빈 값이라, '주변 시설로 넣은 것만 지우기'가 직접 찍은 표시를 건드리지 않는다. */
    source: mapNormalizeSource(value.source),
    batch: mapNormalizeBatch(value.batch)
  };
}
function mapNormalizePoint(raw){
  return Array.isArray(raw) && raw.length >= 2
    ? [mapClampLat(raw[0]), mapClampLng(raw[1])] : null;
}
function mapNormalizeShape(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const type = value.type === "area" ? "area" : "line";
  const points = (Array.isArray(value.points) ? value.points : []).map(mapNormalizePoint).filter(Boolean).slice(0, 2000);
  return {
    id: String(value.id || "") || mapShapeId(),
    type,
    points,
    label: String(value.label == null ? "" : value.label).slice(0, 120),
    color: /^#[0-9a-f]{6}$/i.test(String(value.color || "")) ? String(value.color).toLowerCase() : (type === "area" ? "#16a34a" : "#2563eb"),
    // 표시와 같은 꼬리표 — 주변 시설의 반경 원도 그 묶음과 함께 지워지도록.
    source: mapNormalizeSource(value.source),
    batch: mapNormalizeBatch(value.batch)
  };
}
function mapNormalizeBackgroundImage(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const dataUrl = String(value.dataUrl || "");
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl) || dataUrl.length > MAP_BACKGROUND_MAX_DATA_CHARS) return null;
  const bounds = Array.isArray(value.bounds) && value.bounds.length === 2
    ? [mapNormalizePoint(value.bounds[0]), mapNormalizePoint(value.bounds[1])] : null;
  if (!bounds || !bounds[0] || !bounds[1]) return null;
  const south = Math.min(bounds[0][0], bounds[1][0]);
  const north = Math.max(bounds[0][0], bounds[1][0]);
  const west = Math.min(bounds[0][1], bounds[1][1]);
  const east = Math.max(bounds[0][1], bounds[1][1]);
  if (north - south < 0.000001 || east - west < 0.000001) return null;
  return {
    name: String(value.name || "내 지도 이미지").slice(0, 180),
    dataUrl,
    bounds: [[south, west], [north, east]],
    width: Math.max(1, Math.min(10000, Math.round(Number(value.width) || 1))),
    height: Math.max(1, Math.min(10000, Math.round(Number(value.height) || 1)))
  };
}
function mapDocEmpty(title){
  return {
    type: MAP_DOC_TYPE,
    version: MAP_DOC_VERSION,
    title: String(title || "지도"),
    basemap: "osm",
    center: [MAP_DEFAULT_CENTER[0], MAP_DEFAULT_CENTER[1]],
    zoom: MAP_DEFAULT_ZOOM,
    markers: [],
    shapes: [],
    backgroundImage: null
  };
}
function mapDocParse(text){
  const raw = JSON.parse(String(text || ""));
  if (!raw || typeof raw !== "object" || raw.type !== MAP_DOC_TYPE) throw new Error("not-a-map-doc");
  const center = Array.isArray(raw.center) && raw.center.length === 2
    ? [mapClampLat(raw.center[0]), mapClampLng(raw.center[1])]
    : [MAP_DEFAULT_CENTER[0], MAP_DEFAULT_CENTER[1]];
  const zoomRaw = Number(raw.zoom);
  const backgroundImage = mapNormalizeBackgroundImage(raw.backgroundImage);
  return {
    type: MAP_DOC_TYPE,
    version: MAP_DOC_VERSION,
    title: String(raw.title == null ? "" : raw.title),
    basemap: raw.basemap === "custom" && backgroundImage ? "custom" : (MAP_BASEMAPS[raw.basemap] ? raw.basemap : "osm"),
    center,
    zoom: Number.isFinite(zoomRaw) ? Math.min(19, Math.max(1, Math.round(zoomRaw))) : MAP_DEFAULT_ZOOM,
    markers: Array.isArray(raw.markers) ? raw.markers.map(mapNormalizeMarker) : [],
    shapes: Array.isArray(raw.shapes) ? raw.shapes.map(mapNormalizeShape).filter(shape => shape.points.length >= (shape.type === "area" ? 3 : 2)) : [],
    backgroundImage
  };
}
function mapDocSerialize(model){
  return JSON.stringify({
    type: MAP_DOC_TYPE,
    version: MAP_DOC_VERSION,
    title: model.title || "",
    basemap: model.basemap,
    center: [Number(model.center[0].toFixed(6)), Number(model.center[1].toFixed(6))],
    zoom: model.zoom,
    markers: model.markers,
    shapes: Array.isArray(model.shapes) ? model.shapes : [],
    backgroundImage: model.backgroundImage || null
  }, null, 2) + "\n";
}
/* 저장 안 됨(●) 판정에는 보기 위치를 넣지 않는다. 지도를 조금 움직였다는 이유로 문서가
   "고쳐진" 것으로 표시되면, 정작 표시를 지웠는지 아닌지가 묻혀 버린다. 대신 저장할 때는
   그 순간의 중심·확대를 함께 적어, 다시 열면 마지막으로 보던 자리에서 시작한다. */
function mapDocContentKey(model){
  const background = model.backgroundImage ? [
    model.backgroundImage.name,
    model.backgroundImage.bounds,
    model.backgroundImage.width,
    model.backgroundImage.height,
    model.backgroundImage.dataUrl.length,
    model.backgroundImage.dataUrl.slice(0, 80),
    model.backgroundImage.dataUrl.slice(-80)
  ] : null;
  return JSON.stringify([model.title || "", model.basemap, model.markers, model.shapes || [], background]);
}

const MAP_EARTH_RADIUS_M = 6371008.8;
function mapDistanceMeters(a, b){
  const p1 = mapNormalizePoint(a), p2 = mapNormalizePoint(b);
  if (!p1 || !p2) return 0;
  const rad = Math.PI / 180;
  const lat1 = p1[0] * rad, lat2 = p2[0] * rad;
  const dLat = (p2[0] - p1[0]) * rad, dLng = (p2[1] - p1[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return MAP_EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function mapLineLengthMeters(points){
  const list = Array.isArray(points) ? points : [];
  let total = 0;
  for (let i = 1; i < list.length; i++) total += mapDistanceMeters(list[i - 1], list[i]);
  return total;
}
function mapPolygonAreaSquareMeters(points){
  const list = (Array.isArray(points) ? points : []).map(mapNormalizePoint).filter(Boolean);
  if (list.length < 3) return 0;
  const rad = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < list.length; i++){
    const a = list[i], b = list[(i + 1) % list.length];
    let dLng = (b[1] - a[1]) * rad;
    if (dLng > Math.PI) dLng -= Math.PI * 2;
    if (dLng < -Math.PI) dLng += Math.PI * 2;
    sum += dLng * (2 + Math.sin(a[0] * rad) + Math.sin(b[0] * rad));
  }
  return Math.abs(sum) * MAP_EARTH_RADIUS_M * MAP_EARTH_RADIUS_M / 2;
}
function mapFormatDistance(meters){
  const value = Math.max(0, Number(meters) || 0);
  return value >= 1000 ? (value / 1000).toFixed(value >= 10000 ? 1 : 2) + " km" : Math.round(value) + " m";
}
function mapFormatArea(squareMeters){
  const value = Math.max(0, Number(squareMeters) || 0);
  return value >= 1000000 ? (value / 1000000).toFixed(value >= 10000000 ? 1 : 2) + " km²" : Math.round(value).toLocaleString() + " m²";
}
/* 이름표를 도형 한가운데가 아니라 위쪽 테두리에 두어야 하는 도형이면 그 자리를 돌려준다.
   지금은 '주변 시설'의 반경 원 — 그 한가운데가 정작 보려는 곳(기준점 둘레의 시설)이라 이름표가
   가려 버린다. 손으로 그린 영역은 한가운데가 자연스러우므로 그대로 둔다(null). */
function mapShapeLabelAnchor(shape){
  if (!shape || shape.type !== "area" || shape.source !== "nearby") return null;
  const points = Array.isArray(shape.points) ? shape.points : [];
  if (!points.length) return null;
  let north = points[0][0], west = points[0][1], east = points[0][1];
  for (const point of points){
    if (point[0] > north) north = point[0];
    if (point[1] < west) west = point[1];
    if (point[1] > east) east = point[1];
  }
  return [north, (west + east) / 2];
}
function mapShapeMeasureText(shape){
  return shape && shape.type === "area" ? mapFormatArea(mapPolygonAreaSquareMeters(shape.points)) : mapFormatDistance(mapLineLengthMeters(shape && shape.points));
}

function mapCsvRows(text){
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++){
    const ch = source[i];
    if (quoted){
      if (ch === '"' && source[i + 1] === '"'){ field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ","){ row.push(field); field = ""; }
    else if (ch === "\n"){
      row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length){ row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(values => values.some(value => String(value).trim()));
}
/* CSV → 표시.
   학교에서 만드는 표는 좌표가 아니라 주소만 있는 쪽이 훨씬 흔하다(답사지 목록·우리 동네 조사).
   그래서 위도·경도가 없어도 주소 열이 있으면 실패로 보지 않고, 찾아야 할 줄(pending)로 돌려준다 —
   실제 검색은 네트워크를 쓰므로 화면 쪽(mapResolvePendingMarkers)에서 진행 표시와 함께 돈다. */
function mapMarkersFromCsv(text){
  const rows = mapCsvRows(text);
  if (rows.length < 2) throw new Error("csv-empty");
  const headers = rows[0].map(value => String(value).trim().toLowerCase());
  const find = (aliases) => headers.findIndex(header => aliases.includes(header));
  const labelAt = find(["이름", "장소", "name", "label"]);
  const latAt = find(["위도", "lat", "latitude"]);
  const lngAt = find(["경도", "lng", "lon", "longitude"]);
  const noteAt = find(["메모", "설명", "note", "description"]);
  const colorAt = find(["색", "색상", "color"]);
  const addressAt = find(["주소", "도로명주소", "지번주소", "소재지", "address", "addr"]);
  const regionAt = find(["시도", "광역시도", "region"]);
  const districtAt = find(["시군구", "구", "district"]);
  if ((latAt < 0 || lngAt < 0) && addressAt < 0) throw new Error("csv-columns");
  const markers = [];
  const pending = [];
  let skipped = 0;
  for (const row of rows.slice(1, MAP_CSV_MAX_MARKERS + 1)){
    const colorRaw = colorAt >= 0 ? String(row[colorAt] || "").trim().toLowerCase() : "red";
    const colorMatch = MAP_MARKER_COLORS.find(item => item.id === colorRaw || item.label === colorRaw);
    const shared = {
      color: colorMatch ? colorMatch.id : "red",
      label: labelAt >= 0 ? String(row[labelAt] || "") : "",
      note: noteAt >= 0 ? String(row[noteAt] || "") : "",
      region: regionAt >= 0 ? String(row[regionAt] || "") : "",
      district: districtAt >= 0 ? String(row[districtAt] || "") : ""
    };
    /* 빈 칸을 숫자로 읽으면 Number("")는 0 이다 — 그대로 두면 좌표를 비워 둔 줄이 아프리카 앞바다
       (0, 0)에 표시로 찍힌다. 그래서 "좌표를 적었는가"를 먼저 보고 값을 읽는다. */
    const wroteCoords = latAt >= 0 && lngAt >= 0
      && String(row[latAt] || "").trim() !== "" && String(row[lngAt] || "").trim() !== "";
    const lat = wroteCoords ? Number(row[latAt]) : NaN;
    const lng = wroteCoords ? Number(row[lngAt]) : NaN;
    const usable = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180;
    if (usable){ markers.push(mapNormalizeMarker({ ...shared, lat, lng })); continue; }
    const address = addressAt >= 0 ? String(row[addressAt] || "").trim() : "";
    /* 좌표를 적기는 했는데 쓸 수 없는 값이면(999 같은 오타) 그건 자료 오류다 — 이름을 장소로
       착각해 검색을 부르지 않고 예전처럼 제외한다. 좌표 칸이 아예 비어 있을 때만 찾아 나선다. */
    const query = address || (wroteCoords ? "" : shared.label.trim());
    if (query && pending.length < MAP_GEOCODE_BATCH_MAX) pending.push({ ...shared, query });
    else skipped++;
  }
  if (!markers.length && !pending.length) throw new Error("csv-no-markers");
  return { markers, pending, skipped, truncated: Math.max(0, rows.length - 1 - MAP_CSV_MAX_MARKERS) };
}
function mapCsvEscape(value){
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function mapMarkersToCsv(markers){
  const rows = [["이름", "위도", "경도", "메모", "색상", "시도", "시군구"]];
  for (const marker of Array.isArray(markers) ? markers : []){
    rows.push([marker.label, Number(marker.lat).toFixed(6), Number(marker.lng).toFixed(6),
      marker.note, marker.color, marker.region || "", marker.district || ""]);
  }
  return "\uFEFF" + rows.map(row => row.map(mapCsvEscape).join(",")).join("\r\n") + "\r\n";
}
function mapDownloadText(text, name, mime){
  const blob = new Blob([text], { type:mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function mapSafeDownloadName(value){
  return String(value || "지도").replace(/[\\/:*?"<>|]+/g, "_").trim() || "지도";
}
/* 우클릭 메뉴에서 좌표·주소를 클립보드로 보낸다. 표·문서 편집기와 같은 방식으로, clipboard 를
   못 쓰는 자리(권한이 없거나 옛 웹뷰)에서는 숨긴 입력칸으로 되돌아간다. */
async function mapCopyText(text){
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch(_){ }
  const area = document.createElement("textarea");
  area.value = value; area.style.position = "fixed"; area.style.opacity = "0";
  document.body.appendChild(area); area.select();
  let copied = false;
  try { copied = !!document.execCommand("copy"); } catch(_){ }
  area.remove();
  return copied;
}
async function mapPrepareBackgroundImage(file){
  if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(String(file.type || ""))) throw new Error("image-type");
  if (file.size > 20 * 1024 * 1024) throw new Error("image-too-large");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("image-read")); img.src = url;
    });
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
    let dataUrl = canvas.toDataURL(file.type === "image/png" && scale === 1 ? "image/png" : "image/jpeg", 0.9);
    if (dataUrl.length > MAP_BACKGROUND_MAX_DATA_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.78);
    if (dataUrl.length > MAP_BACKGROUND_MAX_DATA_CHARS) throw new Error("image-output-too-large");
    return { name:String(file.name || "내 지도 이미지").slice(0, 180), dataUrl, width, height };
  } finally { URL.revokeObjectURL(url); }
}

/* ===== 타일 ===== */
/* 런처가 타일을 대신 받아 주는지 확인한다. 저장 가능 여부(/can-save-file)로 판단하면 안 된다 —
   Go 폴백 런처는 파일 저장은 못 해도 타일 프록시는 하기 때문에, 능력마다 프로브를 따로 둔다.
   옛 런처에는 이 엔드포인트가 없어 404(또는 HTML)가 오고, 그러면 타일 주소를 그대로 쓴다. */
let _mapProxyProbe = null;
async function mapTileProxyBase(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return "";
  if (_mapProxyProbe === null){
    _mapProxyProbe = (async () => {
      try {
        const response = await fetch("/can-proxy-tiles", { cache:"no-store" });
        return response.ok && (await response.text()).trim().toLowerCase() === "yes";
      } catch(_){ return false; }
    })();
  }
  return (await _mapProxyProbe) ? location.origin + "/tile-proxy?u=" : "";
}

/* ===== 장소 이름 검색 =====
   이름 검색은 런처의 /geocode 만 쓴다. 카카오를 고르면 주소 → 장소명 순서로 찾고, 키가 없거나
   결과가 없으면 OSM 으로 자동 재검색한다. API 키는 appSettings/localStorage 에 두지 않고 런처가
   Authorization 헤더를 붙인다. */
const _mapGeocodeCache = new Map();

function mapOsmPlaces(raw){
  return (Array.isArray(raw) ? raw : []).map((item) => ({
    name: String(item.display_name || "").trim(), lat:mapClampLat(item.lat), lng:mapClampLng(item.lon)
  })).filter(place => place.name);
}
function mapKakaoPlaces(raw){
  return (raw && Array.isArray(raw.documents) ? raw.documents : []).map((item) => {
    const placeName = String(item.place_name || "").trim();
    const road = String(item.road_address_name || (item.road_address && item.road_address.address_name) || "").trim();
    const address = String(item.address_name || (item.address && item.address.address_name) || "").trim();
    const detail = road || address;
    // 빈 문자열은 Number("")=0 이라 좌표처럼 통과한다 — 적혀 있는지부터 본다.
    if (String(item.y || "").trim() === "" || String(item.x || "").trim() === "") return null;
    const lat = Number(item.y), lng = Number(item.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { name:placeName && detail ? placeName + " · " + detail : (placeName || detail),
      lat:mapClampLat(lat), lng:mapClampLng(lng) };
  }).filter(place => place && place.name);
}
async function mapFetchGeocode(q, provider, spot){
  let url = "/geocode?provider=" + encodeURIComponent(provider) + "&q=" + encodeURIComponent(q);
  // 좌표·반경·갈래처럼 검색어가 아닌 값은 런처가 숫자·코드 꼴만 통과시킨다(launcher.cs ReadGeocodeSpot).
  for (const [key, value] of Object.entries(spot || {})){
    if (value == null || value === "") continue;
    url += "&" + key + "=" + encodeURIComponent(value);
  }
  const response = await fetch(url, { cache:"no-store" });
  if (!response.ok) throw new Error((await response.text()).trim() || "geocode-failed");
  return await response.json();
}
/* 지금 고른 검색 공급자가 카카오인지. 앱 모드가 별도 브라우저 프로필로 열렸을 때 런처에 저장된
   선택을 먼저 받아 와야 하므로 비동기다. */
async function mapProviderIsKakao(){
  try { if (window.__classDockMapSearchProviderReady) await window.__classDockMapSearchProviderReady; } catch(_){}
  return typeof appSettings === "object" && !!appSettings && appSettings.mapSearchProvider === "kakao";
}
async function mapGeocode(query){
  const q = String(query || "").trim();
  if (!q || q.length > 200) return [];
  const provider = await mapProviderIsKakao() ? "kakao" : "osm";
  const cacheKey = provider + "\n" + q;
  if (_mapGeocodeCache.has(cacheKey)) return _mapGeocodeCache.get(cacheKey);
  const proxyBase = await mapTileProxyBase();
  if (!proxyBase) throw new Error("geocode-launcher-required");
  let places = [], lastError = null, osmSucceeded = false;
  if (provider === "kakao"){
    try {
      places = mapKakaoPlaces(await mapFetchGeocode(q, "kakao-address"));
      if (!places.length) places = mapKakaoPlaces(await mapFetchGeocode(q, "kakao-keyword"));
    } catch(error){ lastError = error; }
  }
  if (!places.length){
    try { places = mapOsmPlaces(await mapFetchGeocode(q, "osm")); osmSucceeded = true; }
    catch(error){ if (!lastError) lastError = error; }
  }
  if (!places.length && lastError && !osmSucceeded) throw lastError;
  _mapGeocodeCache.set(cacheKey, places);
  return places;
}
/* ===== 좌표 → 주소·행정구역 =====
   찍은 자리가 어디인지 되묻는 길. 카카오를 켜면 도로명 주소와 행정동까지 오고, OSM 만 있으면
   Nominatim 의 /reverse 로 같은 자리를 묻는다(런처가 경로를 갈아 끼운다). 표시 하나마다 한 번씩
   부르게 되므로 좌표를 소수점 5자리로 끊어 캐시한다 — 같은 자리를 두 번 묻지 않는다. */
const _mapPlaceInfoCache = new Map();

function mapKakaoAddressInfo(raw){
  const doc = raw && Array.isArray(raw.documents) ? raw.documents[0] : null;
  if (!doc) return null;
  const road = doc.road_address ? String(doc.road_address.address_name || "").trim() : "";
  const lot = doc.address ? String(doc.address.address_name || "").trim() : "";
  const building = doc.road_address ? String(doc.road_address.building_name || "").trim() : "";
  const source = doc.road_address || doc.address || {};
  const name = building || road || lot;
  if (!name) return null;
  return {
    // building 은 이름이 붙은 자리에서만 온다 — 누른 곳이 '무엇'인지(주소가 아니라) 아는 유일한 값이다.
    name, building, road, address: lot,
    region: String(source.region_1depth_name || "").trim(),
    district: String(source.region_2depth_name || "").trim()
  };
}
function mapKakaoRegionInfo(raw){
  const list = raw && Array.isArray(raw.documents) ? raw.documents : [];
  // 행정동(H)이 있으면 그쪽이 수업에서 쓰는 이름이다. 없으면 법정동(B)으로 대신한다.
  const doc = list.find(item => item && item.region_type === "H") || list[0];
  if (!doc) return null;
  const region = String(doc.region_1depth_name || "").trim();
  const district = String(doc.region_2depth_name || "").trim();
  if (!region && !district) return null;
  return { region, district, town:String(doc.region_3depth_name || "").trim(),
    name:String(doc.address_name || "").trim() };
}
function mapOsmReverseInfo(raw){
  if (!raw || typeof raw !== "object") return null;
  const address = raw.address && typeof raw.address === "object" ? raw.address : {};
  const name = String(raw.name || "").trim() || String(raw.display_name || "").trim();
  if (!name) return null;
  const region = String(address.state || address.province || address.city || "").trim();
  let district = String(address.city || address.county || address.town || "").trim();
  // 시도와 시군구가 같은 이름으로 오면(특별시 등) 한 단계 아래를 시군구로 쓴다.
  if (district === region) district = String(address.borough || address.city_district || address.suburb || "").trim();
  /* OSM 도 이름이 붙은 자리에는 name 을 준다(건물·역·공원 …). display_name 으로 메운 이름은
     주소일 뿐이라 건물 이름 자리에 넣지 않는다 — 카카오의 building_name 과 뜻을 맞춘다. */
  return { name, building:String(raw.name || "").trim(), road:String(address.road || "").trim(),
    address:String(raw.display_name || "").trim(), region, district };
}
async function mapPlaceInfoAt(lat, lng, want){
  const y = Number(lat).toFixed(6), x = Number(lng).toFixed(6);
  const kakao = await mapProviderIsKakao();
  const cacheKey = (kakao ? "kakao" : "osm") + "\n" + want + "\n" + y + "," + x;
  if (_mapPlaceInfoCache.has(cacheKey)) return _mapPlaceInfoCache.get(cacheKey);
  const proxyBase = await mapTileProxyBase();
  if (!proxyBase) throw new Error("geocode-launcher-required");
  let info = null, lastError = null;
  if (kakao){
    const provider = want === "region" ? "kakao-coord2region" : "kakao-coord2address";
    const read = want === "region" ? mapKakaoRegionInfo : mapKakaoAddressInfo;
    try { info = read(await mapFetchGeocode("", provider, { x, y })); }
    catch(error){ lastError = error; }
  }
  if (!info){
    // OSM 의 역지오코딩 한 번에 주소와 행정구역이 함께 온다 — 카카오가 없어도 두 기능 다 돌아간다.
    try { info = mapOsmReverseInfo(await mapFetchGeocode("", "osm-reverse", { x, y })); }
    catch(error){ if (!lastError) lastError = error; }
  }
  if (!info && lastError) throw lastError;
  _mapPlaceInfoCache.set(cacheKey, info);
  return info;
}
function mapAddressAt(lat, lng){ return mapPlaceInfoAt(lat, lng, "address"); }
function mapRegionAt(lat, lng){ return mapPlaceInfoAt(lat, lng, "region"); }

/* ===== 반경 안 갈래별 장소(카카오 전용) =====
   OSM 에는 대응하는 길이 없어(Overpass 는 별개 서비스다) 카카오를 켰을 때만 화면에 내놓는다. */
const MAP_KAKAO_CATEGORIES = [
  { code:"SC4", label:"학교", color:"blue" },
  { code:"AC5", label:"학원", color:"blue" },
  { code:"PS3", label:"어린이집·유치원", color:"purple" },
  { code:"SW8", label:"지하철역", color:"slate" },
  { code:"HP8", label:"병원", color:"red" },
  { code:"PM9", label:"약국", color:"red" },
  { code:"CS2", label:"편의점", color:"green" },
  { code:"MT1", label:"대형마트", color:"green" },
  { code:"PO3", label:"공공기관", color:"amber" },
  { code:"BK9", label:"은행", color:"amber" },
  { code:"CT1", label:"문화시설", color:"purple" },
  { code:"AT4", label:"관광명소", color:"amber" },
  { code:"PK6", label:"주차장", color:"slate" }
];
const MAP_NEARBY_RADIUS_CHOICES = [500, 1000, 2000, 3000];
const MAP_NEARBY_MAX_PAGES = 3;      // 한 쪽 15개 — 한 번에 최대 45곳

function mapKakaoCategoryPlaces(raw){
  return (raw && Array.isArray(raw.documents) ? raw.documents : []).map((item) => {
    // 빈 문자열은 Number("")=0 이라 좌표처럼 통과한다 — 적혀 있는지부터 본다.
    if (String(item.y || "").trim() === "" || String(item.x || "").trim() === "") return null;
    const lat = Number(item.y), lng = Number(item.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const name = String(item.place_name || "").trim();
    if (!name) return null;
    return {
      name, lat:mapClampLat(lat), lng:mapClampLng(lng),
      address: String(item.road_address_name || item.address_name || "").trim(),
      distance: Number(item.distance) || 0
    };
  }).filter(Boolean);
}
const MAP_NEARBY_KEYWORD_MAX = 30;   // 검색어 길이 — 카카오 키워드 검색에 넣을 말

/* 반경 안의 한 갈래(target.code)나 사용자가 직접 적은 말(target.keyword)을 모아 온다. 갈래 목록에
   없는 것 — 로또 판매점·빵집처럼 — 은 카카오 키워드 검색을 같은 기준점·반경으로 부른다.
   카카오는 한 번에 15개씩 주므로 끝(meta.is_end)이 나오거나 상한에 닿을 때까지만 이어 부른다
   — 도심 한복판에서 수백 개를 긁어 오지 않게. */
async function mapNearbyPlaces(target, lat, lng, radius){
  const keyword = String((target && target.keyword) || "").trim().slice(0, MAP_NEARBY_KEYWORD_MAX);
  const code = keyword ? "" : String((target && target.code) || target || "");
  const proxyBase = await mapTileProxyBase();
  if (!proxyBase) throw new Error("geocode-launcher-required");
  if (!await mapProviderIsKakao()) throw new Error("kakao-required");
  const spot = { x:Number(lng).toFixed(6), y:Number(lat).toFixed(6), radius:String(Math.round(radius)) };
  if (!keyword) spot.category = code;
  const places = [];
  for (let page = 1; page <= MAP_NEARBY_MAX_PAGES; page++){
    const raw = await mapFetchGeocode(keyword, keyword ? "kakao-keyword" : "kakao-category",
      { ...spot, page:String(page) });
    places.push(...mapKakaoCategoryPlaces(raw));
    if (!raw || !raw.meta || raw.meta.is_end !== false) break;
  }
  return places;
}

/* ===== 누른 자리가 어디인지 =====
   카카오 지도에서 건물이나 역을 누르면 뜨는 그 안내를 흉내 낸다. 다만 배경지도가 OSM 타일 —
   건물이 그려진 그림 — 이라 눌린 건물을 지도에서 집어낼 수는 없다. 대신 누른 좌표를 되물어
   (좌표 → 주소) 건물 이름과 주소를 얻고, 카카오를 켰으면 그 이름으로 한 번 더 찾아 갈래와
   전화번호까지 채운다. 그래서 건물 한가운데를 눌러야 잘 맞는다.

   건물 이름이 없는 자리(역 출입구·공원 앞 …)에서는 지하철역만 한 번 더 물어본다. 갈래를 모두
   훑으면 클릭 한 번에 검색을 열세 번 부르게 되는데, 그렇게까지 해서 얻을 것 중 수업에서 실제로
   누르는 곳은 역이기 때문이다. */
const MAP_SPOT_MIN_ZOOM = 15;         // 이보다 멀리서 누른 자리는 건물 하나를 가리킨 것으로 볼 수 없다
const MAP_SPOT_NAME_RADIUS = 80;      // 건물 이름으로 그 자리를 되찾을 때의 반경
const MAP_SPOT_STATION_RADIUS = 150;  // 역은 출입구에서 조금 떨어진 곳이 눌리므로 넉넉히 본다

function mapKakaoCategoryTail(text){
  // "교통,수송 > 지하철,전철 > 수도권1호선" — 앞의 큰 갈래는 말풍선에서 군더더기다.
  const parts = String(text || "").split(">").map(part => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
/* 갈래·키워드 검색의 같은 응답에서 말풍선에 쓸 값까지 읽는다. mapKakaoCategoryPlaces 는 표시로
   넣을 최소한만 보는데, 그쪽은 수십 개를 한꺼번에 다루는 길이라 가볍게 두었다. */
function mapKakaoSpotPlaces(raw){
  return (raw && Array.isArray(raw.documents) ? raw.documents : []).map((item) => {
    // 빈 문자열은 Number("")=0 이라 좌표처럼 통과한다 — 적혀 있는지부터 본다.
    if (String(item.y || "").trim() === "" || String(item.x || "").trim() === "") return null;
    const lat = Number(item.y), lng = Number(item.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const name = String(item.place_name || "").trim();
    if (!name) return null;
    return {
      name, lat:mapClampLat(lat), lng:mapClampLng(lng),
      category: mapKakaoCategoryTail(item.category_name) || String(item.category_group_name || "").trim(),
      address: String(item.road_address_name || "").trim(),
      lot: String(item.address_name || "").trim(),
      phone: String(item.phone || "").trim(),
      distance: Number(item.distance) || 0
    };
  }).filter(Boolean);
}
/* 기준점을 준 검색은 카카오가 가까운 차례로 돌려주므로(런처가 sort=distance 를 붙인다) 첫 곳이
   그 자리다. 여러 쪽을 이어 받지 않는다 — 한 곳만 쓸 것이라 첫 쪽이면 넉넉하다. */
async function mapSpotSearch(target, lat, lng, radius){
  const keyword = String((target && target.keyword) || "").trim().slice(0, MAP_NEARBY_KEYWORD_MAX);
  const spot = { x:Number(lng).toFixed(6), y:Number(lat).toFixed(6), radius:String(Math.round(radius)) };
  if (!keyword) spot.category = String((target && target.code) || "");
  return mapKakaoSpotPlaces(await mapFetchGeocode(keyword, keyword ? "kakao-keyword" : "kakao-category", spot));
}
/* 돌려주는 값: { title, category, road, address, phone, distance, lat, lng } · 아무것도 못 찾으면 null.
   카카오를 꺼 두어도 OSM 역지오코딩으로 이름과 주소까지는 나온다(갈래·전화만 빈다). */
async function mapSpotAt(lat, lng){
  const proxyBase = await mapTileProxyBase();
  if (!proxyBase) throw new Error("geocode-launcher-required");
  const info = await mapPlaceInfoAt(lat, lng, "address");
  const spot = {
    title: info && info.building ? info.building : "",
    category: "", phone: "", distance: 0,
    road: info ? info.road : "", address: info ? info.address : "",
    lat: mapClampLat(lat), lng: mapClampLng(lng)
  };
  if (await mapProviderIsKakao()){
    let place = null;
    /* 갈래·전화는 곁들이는 값이다. 여기서 실패해도 주소만으로 말풍선을 연다 — 누를 때마다
       "찾지 못했어요"가 뜨면 카카오 지도처럼 가볍게 눌러 보는 맛이 사라진다. */
    try {
      if (spot.title) place = (await mapSpotSearch({ keyword:spot.title }, lat, lng, MAP_SPOT_NAME_RADIUS))[0] || null;
      if (!place) place = (await mapSpotSearch({ code:"SW8" }, lat, lng, MAP_SPOT_STATION_RADIUS))[0] || null;
    } catch(_){ }
    if (place){
      spot.title = place.name;
      spot.category = place.category;
      spot.phone = place.phone;
      spot.distance = place.distance;
      if (!spot.road) spot.road = place.address;
      if (!spot.address) spot.address = place.lot;
    }
  }
  return (spot.title || spot.road || spot.address) ? spot : null;
}
// 반경을 눈에 보이게 하는 원. 지도 모델에는 원이 없으므로 면적 영역(다각형)으로 만든다 —
// 이미 있는 넓이 계산·이름표·되돌리기를 그대로 타고, 반경 1km 원의 넓이까지 화면에 나온다.
/* 꼭짓점 수: 60개면 크게 확대했을 때 변이 눈에 띄어 원이 삐뚤삐뚤해 보인다. 120개면 반경 3km
   원도 화면에서 매끈하고, .map 에 늘어나는 무게는 몇 KB 수준이라 그냥 넉넉히 찍는다. */
function mapCirclePoints(lat, lng, radiusMeters, steps){
  const count = Math.max(12, Math.min(360, Math.round(steps || 120)));
  const latSpan = (radiusMeters / MAP_EARTH_RADIUS_M) * (180 / Math.PI);
  const lngSpan = latSpan / Math.max(0.01, Math.cos(lat * Math.PI / 180));
  const points = [];
  for (let i = 0; i < count; i++){
    const angle = (i / count) * Math.PI * 2;
    points.push([mapClampLat(lat + latSpan * Math.cos(angle)), mapClampLng(lng + lngSpan * Math.sin(angle))]);
  }
  return points;
}

/* ===== 주소 목록 → 표시 =====
   한 줄씩 차례로 찾는다. 동시에 던지면 공급자 쪽 초당 제한에 걸리고, OSM 은 런처가 1초 간격을
   지키느라 어차피 줄을 선다. 진행률을 그때그때 알려 주고(onProgress) 중간에 멈출 수 있다. */
async function mapResolvePendingMarkers(pending, onProgress, shouldStop, onMarker){
  const list = (Array.isArray(pending) ? pending : []).slice(0, MAP_GEOCODE_BATCH_MAX);
  const markers = [];
  const failed = [];
  let stopped = false;
  for (let index = 0; index < list.length; index++){
    if (shouldStop && shouldStop()){ stopped = true; break; }
    const row = list[index];
    let place = null;
    try {
      place = (await mapGeocode(row.query))[0] || null;
    } catch(error){
      // 런처가 없으면 다음 줄도 똑같이 실패한다 — 200번 헛돌지 않고 곧장 알린다.
      if (error && error.message === "geocode-launcher-required") throw error;
      place = null;
    }
    if (place){
      const marker = mapNormalizeMarker({
        ...row, lat:place.lat, lng:place.lng,
        label: String(row.label || "").trim() || place.name
      });
      markers.push(marker);
      if (onMarker) onMarker(marker);
    } else failed.push(row.query);
    if (onProgress) onProgress(index + 1, list.length, markers.length);
  }
  return { markers, failed, stopped };
}

// "37.5665, 126.978" 처럼 생겼으면 좌표로 본다(쉼표·공백 아무거나).
function mapParseCoords(text){
  const parts = String(text || "").split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return [mapClampLat(parts[0]), mapClampLng(parts[1])];
}
/* 배경지도 레이어를 만든다. proxyBase 가 있으면 완성된 타일 주소를 프록시로 감싼다 —
   템플릿째 인코딩하면 {z}/{x}/{y} 까지 인코딩돼 치환이 깨지므로, Leaflet 이 좌표를 다 채운
   뒤(getTileUrl 반환값)에 감싸는 것이 요점이다. */
function mapCreateTileLayer(basemapId, proxyBase, onProxyTrouble){
  const spec = MAP_BASEMAPS[basemapId] || MAP_BASEMAPS.osm;
  const layer = L.tileLayer(spec.url, {
    maxZoom: spec.maxZoom,
    attribution: spec.attribution,
    subdomains: spec.url.includes("{s}") ? ["a", "b", "c"] : "abc",
    crossOrigin: true
  });
  if (proxyBase){
    const direct = layer.getTileUrl.bind(layer);
    layer.getTileUrl = (coords) => proxyBase + encodeURIComponent(direct(coords));
    let failures = 0;
    layer.on("tileerror", () => {
      failures++;
      if (failures === MAP_PROXY_FAIL_LIMIT && typeof onProxyTrouble === "function") onProxyTrouble();
    });
  }
  return layer;
}

/* 검색 결과는 지도 이동만으로는 어느 점을 찾았는지 알기 어렵다. 저장되는 수업용 표시와 구분되는
   임시 빨간 점을 올리고, 칠판/그림 캡처에는 들어가지 않도록 전용 pane에 둔다. */
function mapSearchLocationMover(map){
  const paneName = "mapSearchLocationPane";
  const pane = map.getPane(paneName) || map.createPane(paneName);
  pane.classList.add("map-search-location-pane");
  pane.style.zIndex = "650";
  let marker = null;
  const move = (lat, lng, zoom, label) => {
    map.setView([lat, lng], Math.max(map.getZoom(), zoom));
    if (!marker){
      marker = L.circleMarker([lat, lng], {
        pane:paneName, radius:8, color:"#fff", weight:3,
        fillColor:"#e11d48", fillOpacity:1, interactive:false
      }).addTo(map);
    } else marker.setLatLng([lat, lng]);
    marker.unbindTooltip();
    /* permanent 가 아니면 Leaflet 이 지도 클릭(preclick)마다 말풍선을 스스로 닫는데, 점은 클릭을
       받지 않으므로(interactive:false) 한 번 닫히면 다시 열 방법이 없다. 찾은 곳 이름은 계속
       보이는 편이 쓸모 있으니 고정해 두고, 지우는 건 clear() — 화면에서는 Esc — 로만 한다. */
    if (label) marker.bindTooltip(String(label), { pane:paneName, permanent:true, direction:"top", offset:[0,-8], opacity:.96 }).openTooltip();
  };
  // 지운 게 있을 때만 true — 부르는 쪽이 Esc 를 먹었는지 판단할 수 있게.
  move.clear = () => {
    if (!marker) return false;
    map.removeLayer(marker);
    marker = null;
    return true;
  };
  return move;
}

/* 인터넷이 끊기면 지도 칸 위에 남는 안내. navigator.onLine 이 확실히 false 면 즉시 알리고,
   Windows가 연결됨으로 잘못 보고해도 타일이 반복 실패하면 인터넷 확인 문구를 보여 준다.
   이미 캐시된 타일은 그대로 볼 수 있으므로 지도를 막지는 않는다. */
function mapAttachNetworkNotice(stage, map, getTileLayer){
  const banner = document.createElement("div");
  banner.className = "map-network-notice";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.hidden = true;
  stage.appendChild(banner);

  let failures = 0;
  let successes = 0;
  const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
  const show = (message) => { banner.textContent = mapT(message); banner.hidden = false; };
  const hide = () => { banner.hidden = true; banner.textContent = ""; };
  const showOffline = () => show("인터넷 연결 없음 — 새 지역 지도는 표시할 수 없습니다. 이전에 저장된 지역만 볼 수 있습니다.");
  const showLoadFailure = () => show("배경지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  const onLoading = () => { failures = 0; successes = 0; };
  const onTileLoad = () => { successes++; };
  const onTileError = () => {
    failures++;
    if (!isOnline()) showOffline();
    else if (failures >= 3) showLoadFailure();
  };
  const onLoad = () => {
    if (!isOnline()) showOffline();
    else if (failures) showLoadFailure();
    else if (successes) hide();
  };
  const hasTileLayer = () => typeof getTileLayer === "function" && !!getTileLayer();
  const onOffline = () => { if (hasTileLayer()) showOffline(); };
  const onOnline = () => {
    failures = 0; successes = 0; hide();
    const layer = typeof getTileLayer === "function" ? getTileLayer() : null;
    if (layer && typeof layer.redraw === "function") layer.redraw();
  };

  map.on("loading", onLoading);
  map.on("tileload", onTileLoad);
  map.on("tileerror", onTileError);
  map.on("load", onLoad);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  if (!isOnline() && hasTileLayer()) showOffline();

  const cleanup = () => {
    map.off("loading", onLoading);
    map.off("tileload", onTileLoad);
    map.off("tileerror", onTileError);
    map.off("load", onLoad);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    banner.remove();
  };
  cleanup.refresh = () => {
    if (!hasTileLayer()) hide();
    else if (!isOnline()) showOffline();
  };
  cleanup.hide = hide;
  return cleanup;
}

/* ===== 마커 그림 ===== */
// 기본 마커는 vendor/images/*.png 를 찾는다 — 그 폴더를 같이 넣지 않았으므로(그리고 넣고 싶지도
// 않으므로) 핀은 인라인 SVG 로 그린다. 오프라인에서도 아무것도 요청하지 않는다.
function mapPinSvg(hex){
  return '<svg viewBox="0 0 24 34" width="24" height="34" aria-hidden="true">'
    + '<path d="M12 0C5.9 0 1 4.9 1 11c0 8 11 23 11 23s11-15 11-23c0-6.1-4.9-11-11-11z" fill="' + hex + '"/>'
    + '<circle cx="12" cy="11" r="4.4" fill="#ffffff" opacity="0.92"/></svg>';
}
function mapPinIcon(colorId){
  return L.divIcon({
    className: "map-pin",
    html: mapPinSvg(mapColorHex(colorId)),
    iconSize: [24, 34],
    iconAnchor: [12, 34],
    popupAnchor: [0, -30]
  });
}

/* ===== 칠판으로 보내기 ===== */
// 보드에서 확대해 봐도 타일이 뭉개지지 않게 화면의 두 배로 찍는다.
const MAP_BOARD_CAPTURE_SCALE = 2;

function mapLoadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("map-image-load-failed"));
    img.src = src;
  });
}
function mapAttributionText(model){
  if (model && model.basemap === "custom" && model.backgroundImage){
    const title = String(model.title || "").trim();
    return (title ? title + " · " : "") + mapT("사용자 지도") + ": " + model.backgroundImage.name;
  }
  const spec = MAP_BASEMAPS[model.basemap] || MAP_BASEMAPS.osm;
  const title = String(model.title || "").trim();
  return (title ? title + " · " : "") + spec.attribution;
}
/* 칠판에 열릴 이름. 같은 지도를 두 번 보내도 서로 다른 칠판이 되도록 번호를 붙인다 —
   이름이 겹치면 자동복원 칸(boardRecoveryKey)까지 함께 쓰게 돼 앞 판서를 덮어쓴다. */
function mapBoardName(model, prefix){
  const base = (prefix || "지도") + " – " + (String(model.title || "").trim() || "지도");
  const open = typeof docs !== "undefined" ? docs : [];
  const taken = new Set(open.filter(d => d.kind === "board").map(d => d.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++){
    const next = base + " " + n;
    if (!taken.has(next)) return next;
  }
  return base + " " + Date.now();
}
/* 캡처 뒤 그림에 글자를 새긴다.
   · 출처: 화면의 저작권 줄은 확대·이동 단추와 같은 칸에 있어 캡처 전에 함께 감추므로,
     칠판에 올라간 뒤에도 출처가 남으려면 그림 자체에 있어야 한다(OSM 계열 타일의 라이선스 조건).
   · 표시 이름: 화면에서는 말풍선으로 띄우지만 그건 마우스를 올려야 보인다. 칠판에 붙는 그림은
     정지 화면이라, 이름을 여기서 핀 위에 직접 그려 넣어야 무슨 자리인지 남는다.
   labels 의 좌표는 지도 칸의 CSS 픽셀이라 캡처 배율만큼 곱해 쓴다. */
async function mapStampCapture(pngUrl, attribution, labels){
  const img = await mapLoadImage(pngUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1;
  canvas.height = img.naturalHeight || 1;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const scale = MAP_BOARD_CAPTURE_SCALE;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labelSize = Math.round(15 * scale);
  ctx.font = "600 " + labelSize + "px 'Malgun Gothic', system-ui, sans-serif";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, Math.round(3 * scale));
  for (const label of labels || []){
    if (!label || !label.text) continue;
    const x = label.x * scale;
    const y = label.y * scale - (label.offsetY == null ? 38 : label.offsetY) * scale;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";      // 어떤 타일 위에서도 읽히게 흰 테두리를 두른다
    ctx.strokeText(label.text, x, y);
    ctx.fillStyle = "#1f2937";
    ctx.fillText(label.text, x, y);
  }

  const fontSize = Math.max(12, Math.round(canvas.height * 0.022));
  const pad = Math.round(fontSize * 0.6);
  const barHeight = fontSize + pad * 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = fontSize + "px 'Malgun Gothic', system-ui, sans-serif";
  const barWidth = Math.min(canvas.width, ctx.measureText(attribution).width + pad * 2);
  ctx.fillStyle = "rgba(255,255,255,0.84)";
  ctx.fillRect(0, canvas.height - barHeight, barWidth, barHeight);
  ctx.fillStyle = "#334155";
  ctx.fillText(attribution, pad, canvas.height - barHeight / 2);
  return canvas.toDataURL("image/png");
}
/* 캡처 동안 감출 칸.
   확대·이동 단추는 정지 그림에서 쓸모가 없고, 말풍선·이름표는 더 고약하다 — Leaflet 은 닫은
   말풍선을 페이드아웃으로 지워서 closePopup() 뒤에도 200ms 가량 DOM 에 남는다. 그대로 찍으면
   편집 서식이 지도 한복판에 박힌 그림이 나온다(실측 확인). display:none 이면 시점과 무관하다. */
const MAP_CAPTURE_HIDDEN_PANES = [".leaflet-control-container", ".leaflet-popup-pane", ".leaflet-tooltip-pane", ".map-search-location-pane", ".map-network-notice"];

/* 지금 보고 있는 지도를 PNG data URL 로 굳힌다. 노트북 PDF 가 folium 지도를 찍을 때 쓰는
   html-to-image(capture 묶음)를 그대로 쓴다 — Leaflet 지도에서 검증된 경로다. */
async function mapCaptureDataUrl(stage, attribution, labels){
  await MNLazy.need("capture");
  const hidden = [];
  for (const selector of MAP_CAPTURE_HIDDEN_PANES){
    const el = stage.querySelector(selector);
    if (!el) continue;
    hidden.push([el, el.style.display]);
    el.style.display = "none";
  }
  try {
    const png = await htmlToImage.toPng(stage, {
      backgroundColor: "#ffffff",
      pixelRatio: MAP_BOARD_CAPTURE_SCALE,
      cacheBust: false,
      // 런처 타일은 /tile-proxy?u=<원본 주소> 형식이다. html-to-image 기본 캐시는 쿼리를
      // 제외하므로 이 옵션이 없으면 모든 타일을 같은 주소로 보고 첫 타일을 격자처럼 반복한다.
      includeQueryParams: true
    });
    return await mapStampCapture(png, attribution, labels);
  } finally {
    for (const [el, previous] of hidden) el.style.display = previous;
  }
}

/* 캡처 결과(data URL)를 메모가 받는 Blob 으로 바꾼다. 메모의 그림 에셋은 IndexedDB 에
   Blob 으로 들어가므로, base64 문자열 그대로는 넣을 수 없다. */
async function mapDataUrlToBlob(dataUrl){
  const text = String(dataUrl || "");
  if (!text.startsWith("data:")) return null;
  try {
    const response = await fetch(text);
    const blob = await response.blob();
    return blob && blob.size ? blob : null;
  } catch(error){
    console.warn("map data url to blob failed:", error);
    return null;
  }
}

/* ===== 타일 캐시(런처 디스크) =====
   실제 저장은 런처가 한다(desktop/launcher.cs). exe 는 실행마다 포트가 달라 브라우저 origin 이
   바뀌므로 IndexedDB 에 담아 두면 다음 실행에서 못 읽는다 — 그래서 서버 쪽 파일이 유일한 방법이다. */
async function mapTileCacheStatus(){
  try {
    const response = await fetch("/tile-cache-status", { headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch(_){ return null; }
}
async function mapTileCacheClear(){
  try {
    const response = await fetch("/tile-cache-clear", { method:"POST", headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
    return response.ok;
  } catch(_){ return false; }
}
function mapFormatBytes(bytes){
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + "KB";
  return (value / (1024 * 1024)).toFixed(value < 100 * 1024 * 1024 ? 1 : 0) + "MB";
}
/* ===== "장소 이름 또는 좌표" 한 칸 =====
   지도 문서와 지도 고르기 창이 같은 것을 쓴다. 좌표처럼 생기면 곧장 옮기고(고를 후보가 없다),
   아니면 이름으로 찾아 결과를 목록으로 띄운다. setNote 로 진행·오류를 알리고, 목록에서 고른
   후보(또는 후보가 하나뿐이라 고를 것이 없는 자리)만 onMove(lat, lng, zoom, label) 로 옮겨 보여 준다. */
function mapAttachPlaceSearch(input, button, results, onMove, setNote){
  let items = [];
  let searching = false;
  // 바깥을 눌러 목록을 닫기로 예약해 둔 것 — 다시 포커스가 돌아오면 취소한다.
  let closeTimer = 0;
  const cancelPendingClose = () => { clearTimeout(closeTimer); closeTimer = 0; };
  /* 후보 목록과 최근 검색어가 같은 칸을 나눠 쓴다. 화살표 키가 훑을 줄을 그린 순서대로 모아 두고,
     지금 짚은 줄만 is-current 로 표시한다(포커스는 입력칸에 그대로 둬야 계속 칠 수 있다). */
  const options = [];
  let active = -1;
  // 목록을 다시 그릴 때마다 예약된 닫기를 취소한다 — 방금 그린 목록이 150ms 뒤에 사라지지 않게.
  const resetList = () => {
    cancelPendingClose();
    results.innerHTML = ""; options.length = 0; active = -1; items = [];
  };
  const closeResults = () => { resetList(); results.hidden = true; };
  const setActive = (index) => {
    active = index;
    options.forEach((option, i) => option.classList.toggle("is-current", i === index));
    const current = options[index];
    if (current && current.scrollIntoView) current.scrollIntoView({ block:"nearest" });
  };
  const moveActive = (step) => {
    if (!options.length) return;
    setActive(active < 0
      ? (step > 0 ? 0 : options.length - 1)
      : (active + step + options.length) % options.length);
  };
  const addOption = (label, className, onPick) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = className;
    option.textContent = label;
    option.title = label;
    option.addEventListener("click", onPick);
    options.push(option);
    return option;
  };
  /* 후보 하나를 고른 것으로 치고 그 자리로 옮긴다. 목록에서 누르든 후보가 하나뿐이든 같은
     길이라, 검색어 지우기·안내 걷기가 두 갈래로 갈라지지 않는다. */
  const pick = (place) => {
    closeResults();
    input.value = "";
    // 고르라는 안내는 여기서 걷는다 — onMove 가 곧바로 제 안내(빨간 점 지우는 법)를 쓴다.
    setNote("");
    onMove(place.lat, place.lng, 15, place.name);
  };
  // 곧장 옮겼으면 true — 부르는 쪽이 "고르세요" 안내를 띄울지 판단할 수 있게.
  const showResults = (places) => {
    resetList();
    items = places.slice(0, 5);
    for (const place of items){
      results.appendChild(addOption(place.name, "map-result", () => pick(place)));
    }
    results.hidden = !items.length;
    /* 여럿일 때는 찾자마자 옮기지 않는다 — 첫 결과가 엉뚱하면 지도가 먼저 튀어, 목록에서 제
       후보를 찾는 동안 보던 자리를 잃기 때문이다. 대신 첫 줄을 짚어 둔다: 검색한 Enter 에 이어
       Enter 를 한 번 더 누르면 첫 후보로 옮겨 간다. */
    if (items.length === 1){
      // 후보가 하나면 고를 것이 없다 — 한 줄짜리 목록을 펼쳐 한 번 더 누르게 하는 것은 군더더기다.
      pick(items[0]);
      return true;
    }
    if (items.length) setActive(0);
    return false;
  };

  /* 검색란을 누르면(또는 글자를 지우면) 최근 검색어를 같은 자리에 펼친다. 치는 중에는 그 글자가
     든 기록만 남겨, 다 지우지 않고도 예전에 찾던 말을 이어 쓸 수 있게 한다. */
  const showHistory = () => {
    const typed = input.value.trim().toLowerCase();
    const history = mapSearchHistory().filter(item => !typed || item.toLowerCase().includes(typed));
    resetList();
    if (!history.length){ results.hidden = true; return; }
    for (const query of history){
      const row = document.createElement("div");
      row.className = "map-result-row";
      const option = addOption(query, "map-result is-history", () => {
        input.value = query;
        search();
      });
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "map-result-x";
      forget.textContent = "×";
      forget.title = mapT("이 검색어 지우기");
      forget.setAttribute("aria-label", mapT("이 검색어 지우기"));
      // 한 줄만 지우는 것이므로 목록은 닫지 않고 그 자리에서 다시 그린다.
      forget.addEventListener("click", () => { mapForgetSearch(query); input.focus(); showHistory(); });
      row.append(option, forget);
      results.appendChild(row);
    }
    results.appendChild(addOption(mapT("검색 기록 지우기"), "map-result is-clear", () => {
      mapClearSearchHistory();
      closeResults();
      input.focus();
    }));
    results.hidden = false;
  };

  const search = async () => {
    if (searching) return;
    const text = input.value.trim();
    if (!text) return;
    const coords = mapParseCoords(text);
    if (coords){
      closeResults();
      input.value = "";
      setNote("");
      mapRememberSearch(text);
      onMove(coords[0], coords[1], 14, text);
      return;
    }
    searching = true;
    button.disabled = true;
    closeResults();
    setNote(mapT("찾는 중…"));
    try {
      const places = await mapGeocode(text);
      if (!places.length){ setNote(mapT("그런 이름의 장소를 찾지 못했어요.")); return; }
      // 찾아낸 말만 기록한다 — 오타로 헛친 말까지 남으면 목록이 금세 쓸모없어진다.
      mapRememberSearch(text);
      // 후보가 하나뿐이면 여기서 이미 옮겨 갔다 — 그때는 고르라고 하지 않는다.
      if (!showResults(places)) setNote(mapT("찾은 곳을 아래에서 고르면 그 자리로 갑니다."));
    } catch(error){
      setNote(mapT(error && error.message === "geocode-launcher-required"
        ? "장소 이름 검색은 ClassDock 런처에서 사용할 수 있어요. 좌표 이동은 그대로 쓸 수 있습니다."
        : "장소를 찾지 못했어요 — 인터넷 연결을 확인해 주세요."));
    } finally {
      searching = false;
      button.disabled = false;
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !results.hidden){
      /* 목록만 닫고 Esc 는 그대로 흘려보낸다. 검색을 마치면 후보 목록이 열린 채로 남고(다른
         후보를 고를 수 있게) 지도에는 빨간 표식이 찍히는데, 여기서 Esc 를 삼키면 그 한 번이
         눈에 띄는 일을 아무것도 하지 않는다 — 목록은 어차피 곧 닫히고 표식은 그대로 남아,
         화면에서는 "Esc 가 안 먹는다"로 보인다. 한 번에 목록도 닫고 표식도 지운다. */
      closeResults();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault(); e.stopPropagation();
      if (results.hidden) showHistory();   // 닫혀 있으면 ↓ 로 최근 검색어를 펼치는 것부터
      if (!results.hidden) moveActive(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault(); e.stopPropagation();
    // 화살표로 짚어 둔 줄이 있으면 그 줄을 고른 것으로 본다.
    if (active >= 0 && options[active]) options[active].click();
    else search();
  });
  button.addEventListener("click", () => {
    // 버튼을 누르며 입력칸이 blur 되어도 결과가 뜨자마자 닫히지 않게 검색 포커스를 돌려준다.
    input.focus();
    search();
  });
  /* 최근 검색어는 칸을 누르거나 글자를 고칠 때마다 다시 추린다. 검색 결과가 떠 있는 동안에는
     그 자리를 뺏지 않는다(고르려던 후보가 눈앞에서 사라지지 않게). */
  const openHistory = () => { cancelPendingClose(); if (results.hidden) showHistory(); };
  input.addEventListener("focus", openHistory);
  input.addEventListener("click", openHistory);
  input.addEventListener("input", () => { cancelPendingClose(); showHistory(); });
  // 바깥을 누르면 목록을 닫는다(지도를 조작하려던 클릭이 목록에 막히지 않게).
  input.addEventListener("blur", (e) => {
    // 입력칸 → 검색 버튼 이동은 바깥 클릭이 아니다. click 핸들러가 포커스를 되돌린다.
    if (e.relatedTarget === button) return;
    // 목록 안의 ✕ 를 누른 경우도 곧바로 포커스를 돌려주므로 그때는 이 예약을 취소한다.
    cancelPendingClose();
    closeTimer = setTimeout(closeResults, 150);
  });
  return closeResults;
}

/* ===== 오프라인 지도 현황 =====
   공개 타일 제공처는 사전 일괄 다운로드를 허용하지 않는다. 런처는 사용자가 실제로 본 타일만
   자동 캐시하며, 이 창은 그 현황 확인과 비우기만 제공한다. */
function openMapOfflineStatus(){
  const modal = document.createElement("div");
  modal.className = "modal map-prepare-modal";
  modal.innerHTML =
    '<div class="modal-card map-prepare-card">' +
      '<h3>오프라인 지도</h3>' +
      '<p class="sub">런처로 지도를 볼 때 화면에 표시된 배경은 자동으로 보관됩니다. 공개 지도 서버 정책에 따라 보지 않은 지역을 미리 내려받지는 않습니다.</p>' +
      '<p class="map-prepare-status" aria-live="polite"></p>' +
      '<div class="modal-actions">' +
        '<button class="btn map-prepare-clear" type="button">받아 둔 지도 비우기</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn map-prepare-close" type="button">닫기</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  mapTranslate(modal);

  const status = modal.querySelector(".map-prepare-status");
  const clearBtn = modal.querySelector(".map-prepare-clear");
  let busy = false;

  const refreshStatus = async () => {
    const info = await mapTileCacheStatus();
    status.textContent = info
      ? mapTf("지금 받아 둔 지도: {files}장 · {size} (최대 {max})",
          { files:info.files, size:mapFormatBytes(info.bytes), max:mapFormatBytes(info.maxBytes) })
      : "";
  };
  refreshStatus();

  const close = () => {
    if (busy) return;
    window.removeEventListener("keydown", onKey, true);
    modal.remove();
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopImmediatePropagation();
    close();
  };
  window.addEventListener("keydown", onKey, true);
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
  modal.querySelector(".map-prepare-close").addEventListener("click", close);

  clearBtn.addEventListener("click", async () => {
    if (busy) return;
    if (typeof confirmDialog === "function"){
      const ok = await confirmDialog(mapT("받아 둔 배경지도를 모두 지웁니다. 인터넷이 없으면 지도가 비어 보이게 됩니다."), mapT("비우기"), mapT("취소"));
      if (!ok) return;
    }
    status.textContent = mapT(await mapTileCacheClear() ? "받아 둔 지도를 비웠어요." : "비우지 못했어요.");
    await refreshStatus();
  });
}

/* ===== 지역별 개수 =====
   표시에 붙은 행정구역으로 세어 표를 만든다. 지도를 세는 것으로 끝내지 않고 그대로 칠판 차트로
   보내는 것이 요점이라, 세는 규칙은 화면과 떨어진 순수 함수로 둔다(테스트 대상). */
const MAP_REGION_UNKNOWN = "지역 없음";

function mapRegionNameOf(marker, level){
  const value = level === "region" ? (marker && marker.region) : (marker && marker.district);
  const text = String(value == null ? "" : value).trim();
  // 시군구 기준인데 시군구가 비었으면 시도라도 쓴다(세종·제주처럼 한 단계인 곳이 있다).
  if (text) return text;
  const fallback = String((marker && marker.region) || "").trim();
  return level === "region" ? "" : fallback;
}
function mapRegionTally(markers, level){
  const counts = new Map();
  for (const marker of Array.isArray(markers) ? markers : []){
    const name = mapRegionNameOf(marker, level) || MAP_REGION_UNKNOWN;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    // 많은 곳부터, 같으면 이름 순. '지역 없음'은 자료가 아니므로 언제나 맨 뒤로 보낸다.
    .sort((a, b) => {
      if (a.label === MAP_REGION_UNKNOWN) return 1;
      if (b.label === MAP_REGION_UNKNOWN) return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

/* ===== 지역 통계 창 =====
   hooks.touch  = 표시가 바뀌었음을 문서에 알린다
   hooks.toChart = 센 결과를 칠판 차트로 보낸다(성공하면 true) */
function openMapRegionStats(model, hooks){
  const modal = document.createElement("div");
  modal.className = "modal map-region-modal";
  modal.innerHTML =
    '<div class="modal-card map-region-card">' +
      '<h3>지역 통계</h3>' +
      '<p class="sub">표시마다 시도·시군구를 채우고, 지역별 개수를 세어 칠판 차트로 보냅니다.</p>' +
      '<div class="map-region-row">' +
        '<label class="map-nearby-field"><span>기준</span>' +
          '<select class="map-select map-region-level">' +
            '<option value="district">시군구</option><option value="region">시도</option>' +
          '</select></label>' +
        '<span class="map-region-note" aria-live="polite"></span>' +
      '</div>' +
      '<div class="map-region-list"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn map-region-fill" type="button">지역 채우기</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn map-region-close" type="button">닫기</button>' +
        '<button class="btn primary map-region-chart" type="button">칠판으로 차트</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  const levelSelect = modal.querySelector(".map-region-level");
  const note = modal.querySelector(".map-region-note");
  const list = modal.querySelector(".map-region-list");
  const fillBtn = modal.querySelector(".map-region-fill");
  const chartBtn = modal.querySelector(".map-region-chart");
  mapTranslate(modal);

  let busy = false;
  let stop = false;
  const level = () => (levelSelect.value === "region" ? "region" : "district");
  const missingMarkers = () => model.markers.filter(marker => !mapRegionNameOf(marker, level()));

  const render = () => {
    const rows = mapRegionTally(model.markers, level());
    list.innerHTML = "";
    for (const row of rows){
      const line = document.createElement("div");
      line.className = "map-region-item";
      const name = document.createElement("span");
      name.className = "map-region-name";
      name.textContent = row.label === MAP_REGION_UNKNOWN ? mapT(MAP_REGION_UNKNOWN) : row.label;
      const count = document.createElement("span");
      count.className = "map-region-count";
      count.textContent = mapTf("{count}곳", { count:row.count });
      line.append(name, count);
      list.appendChild(line);
    }
    const missing = missingMarkers().length;
    note.textContent = model.markers.length
      ? mapTf("표시 {total}개 · 지역 없음 {missing}개", { total:model.markers.length, missing })
      : mapT("아직 표시가 없습니다.");
    fillBtn.disabled = busy || !missing;
    chartBtn.disabled = busy || !model.markers.length;
    return rows;
  };
  render();

  const close = () => {
    if (busy) return;
    window.removeEventListener("keydown", onKey, true);
    modal.remove();
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (busy){ stop = true; return; }
    close();
  };
  window.addEventListener("keydown", onKey, true);
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
  modal.querySelector(".map-region-close").addEventListener("click", close);
  levelSelect.addEventListener("change", render);

  /* 표시 하나마다 한 번씩 물어야 해서 시간이 걸린다(OSM 은 1초 간격). 진행률을 적고
     같은 버튼으로 멈출 수 있게 한다 — CSV 좌표 찾기와 같은 방식이다. */
  fillBtn.addEventListener("click", async () => {
    if (busy){ stop = true; return; }
    const targets = missingMarkers();
    if (!targets.length) return;
    busy = true; stop = false;
    fillBtn.textContent = mapT("그만두기");
    fillBtn.disabled = false;
    chartBtn.disabled = true;
    let done = 0, filled = 0;
    try {
      for (const marker of targets){
        if (stop) break;
        let info = null;
        try { info = await mapRegionAt(marker.lat, marker.lng); }
        catch(error){
          if (error && error.message === "geocode-launcher-required") throw error;
          info = null;
        }
        if (info && (info.region || info.district)){
          marker.region = info.region || "";
          marker.district = info.district || "";
          filled++;
        }
        done++;
        note.textContent = mapTf("지역을 채우는 중… {done}/{total} · 채움 {filled}개", { done, total:targets.length, filled });
      }
      if (filled && hooks && typeof hooks.touch === "function") hooks.touch();
    } catch(error){
      note.textContent = mapT(error && error.message === "geocode-launcher-required"
        ? "지역 채우기는 ClassDock 런처에서 사용할 수 있어요."
        : "지역을 채우지 못했어요 — 인터넷 연결을 확인해 주세요.");
    } finally {
      busy = false; stop = false;
      fillBtn.textContent = mapT("지역 채우기");
      render();
    }
  });

  chartBtn.addEventListener("click", async () => {
    if (busy) return;
    const rows = mapRegionTally(model.markers, level()).filter(row => row.label !== MAP_REGION_UNKNOWN);
    if (!rows.length){
      note.textContent = mapT("셀 지역이 없습니다 — 먼저 지역 채우기를 눌러 주세요.");
      return;
    }
    chartBtn.disabled = true;
    const sent = hooks && typeof hooks.toChart === "function" ? await hooks.toChart(rows, level()) : false;
    if (sent) close();
    else { note.textContent = mapT("칠판에 차트를 넣지 못했어요."); chartBtn.disabled = false; }
  });
}

/* ===== 주변 시설 찾기 창 =====
   지도 가운데를 기준으로 반경 안의 한 갈래를 모아 온다. '우리 동네에 학교가 몇 곳인가'처럼
   사회과에서 바로 쓰는 물음이라, 찾은 개수를 창 안에서 먼저 보여 주고 넣을지 고르게 한다.
   돌려주는 값: { places, category, radius, circle } · 취소하면 null. */
function openMapNearby(center, opts = {}){
  return new Promise((resolve) => {
    /* 도구막대로 부르면 화면 가운데가, 우클릭 메뉴로 부르면 누른 자리가 기준이다. 어디를 중심으로
       찾는지 모르면 결과를 읽을 수 없으므로 설명 줄을 부른 쪽에 맞춘다. */
    const subText = opts.atPoint
      ? "지도에서 오른쪽 버튼으로 누른 자리를 기준으로 반경 안의 시설을 찾아 표시로 넣습니다."
      : "지금 보고 있는 지도 가운데를 기준으로 반경 안의 시설을 찾아 표시로 넣습니다.";
    const modal = document.createElement("div");
    modal.className = "modal map-nearby-modal";
    modal.innerHTML =
      '<div class="modal-card map-nearby-card">' +
        '<h3>주변 시설 찾기</h3>' +
        '<p class="sub">' + subText + '</p>' +
        '<div class="map-nearby-row">' +
          '<label class="map-nearby-field"><span>갈래</span><select class="map-select map-nearby-category"></select></label>' +
          '<label class="map-nearby-field"><span>반경</span><select class="map-select map-nearby-radius"></select></label>' +
          '<label class="map-nearby-check"><input type="checkbox" class="map-nearby-circle" checked><span>반경 원도 그리기</span></label>' +
        '</div>' +
        '<div class="map-nearby-row">' +
          '<label class="map-nearby-field map-nearby-wide"><span>직접 찾기</span>' +
            '<input type="text" class="map-input map-nearby-keyword" maxlength="30" ' +
              'placeholder="예: 로또 · 빵집 — 적으면 갈래 대신 이 말로 찾아요"></label>' +
        '</div>' +
        '<p class="map-nearby-note" aria-live="polite"></p>' +
        '<div class="modal-actions">' +
          '<span class="spacer"></span>' +
          '<button class="btn map-nearby-cancel" type="button">취소</button>' +
          '<button class="btn primary map-nearby-ok" type="button">찾아서 넣기</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    const categorySelect = modal.querySelector(".map-nearby-category");
    const radiusSelect = modal.querySelector(".map-nearby-radius");
    const keywordInput = modal.querySelector(".map-nearby-keyword");
    const circleCheck = modal.querySelector(".map-nearby-circle");
    const note = modal.querySelector(".map-nearby-note");
    const okBtn = modal.querySelector(".map-nearby-ok");
    for (const item of MAP_KAKAO_CATEGORIES){
      const option = document.createElement("option");
      option.value = item.code; option.textContent = item.label;
      categorySelect.appendChild(option);
    }
    for (const meters of MAP_NEARBY_RADIUS_CHOICES){
      const option = document.createElement("option");
      option.value = String(meters); option.textContent = mapFormatDistance(meters);
      radiusSelect.appendChild(option);
    }
    radiusSelect.value = "1000";
    // 직접 찾기에 무언가 적으면 그 말이 갈래를 대신한다 — 갈래 칸을 흐려 어느 쪽으로 찾는지 보인다.
    const syncKeywordMode = () => { categorySelect.disabled = !!keywordInput.value.trim(); };
    keywordInput.addEventListener("input", syncKeywordMode);
    keywordInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault(); e.stopPropagation();
      okBtn.click();
    });
    syncKeywordMode();
    mapTranslate(modal);

    let settled = false;
    let busy = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      modal.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key !== "Escape" || busy) return;
      e.preventDefault(); e.stopImmediatePropagation();
      finish(null);
    };
    window.addEventListener("keydown", onKey, true);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal && !busy) finish(null); });
    modal.querySelector(".map-nearby-cancel").addEventListener("click", () => { if (!busy) finish(null); });

    okBtn.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      okBtn.disabled = true;
      const keyword = keywordInput.value.trim().slice(0, MAP_NEARBY_KEYWORD_MAX);
      /* 직접 적은 말은 갈래가 아니므로 이름표·색을 그 말로 만든다. 아래(표시 넣기·반경 원 이름)는
         갈래든 직접 찾기든 같은 모양({label, color})을 받으므로 나머지 길은 그대로다. */
      const category = keyword
        ? { code:"", label:keyword, color:"purple" }
        : (MAP_KAKAO_CATEGORIES.find(item => item.code === categorySelect.value) || MAP_KAKAO_CATEGORIES[0]);
      const radius = Number(radiusSelect.value) || 1000;
      note.textContent = mapT("찾는 중…");
      try {
        const places = await mapNearbyPlaces(keyword ? { keyword } : { code:category.code }, center.lat, center.lng, radius);
        if (!places.length){
          note.textContent = mapTf("반경 {radius} 안에서 {label}을(를) 찾지 못했어요.",
            { radius:mapFormatDistance(radius), label:mapT(category.label) });
          busy = false; okBtn.disabled = false;
          return;
        }
        finish({ places, category, radius, circle:circleCheck.checked });
      } catch(error){
        note.textContent = mapT(error && error.message === "kakao-required"
          ? "주변 시설 찾기는 카카오 지도 검색을 켰을 때만 쓸 수 있어요(설정 → 지도 검색)."
          : error && error.message === "geocode-launcher-required"
            ? "주변 시설 찾기는 ClassDock 런처에서 사용할 수 있어요."
            : "주변 시설을 찾지 못했어요 — 인터넷 연결을 확인해 주세요.");
        busy = false; okBtn.disabled = false;
      }
    });
  });
}

/* ===== 지도 고르기 창(칠판에서 부른다) ===== */
const MAP_PICKER_VIEW_KEY = "mn.mapPickerView";

function mapPickerSavedView(){
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_PICKER_VIEW_KEY) || "null");
    if (!saved || !Array.isArray(saved.center)) return null;
    return {
      center: [mapClampLat(saved.center[0]), mapClampLng(saved.center[1])],
      zoom: Math.min(19, Math.max(1, Number(saved.zoom) || MAP_DEFAULT_ZOOM)),
      basemap: MAP_BASEMAPS[saved.basemap] ? saved.basemap : "osm"
    };
  } catch(_){ return null; }
}
function mapPickerRememberView(view){
  try { localStorage.setItem(MAP_PICKER_VIEW_KEY, JSON.stringify(view)); } catch(_){}
}

/* 칠판에서 "지도"를 누르면 뜨는 창. 위치를 잡고 '이 화면 넣기'를 누르면 캡처한 PNG data URL 을
   돌려주고, 취소하면 null 을 돌려준다. 지도 문서(.map)를 만들지 않고 그림만 가져가는 길이다. */
async function openMapPicker(){
  try { await MNLazy.need("leaflet"); }
  catch(_){
    if (typeof toast === "function") toast(mapT("지도 라이브러리를 불러오지 못했어요."), 2500);
    return null;
  }
  const start = mapPickerSavedView() || { center:[...MAP_DEFAULT_CENTER], zoom:MAP_DEFAULT_ZOOM, basemap:"osm" };

  const modal = document.createElement("div");
  modal.className = "modal map-picker-modal";
  modal.innerHTML =
    '<div class="modal-card map-picker-card">' +
      '<h3>지도 고르기</h3>' +
      '<p class="sub">보여 줄 자리를 잡고 이 화면 넣기를 누르면 칠판에 그림으로 들어갑니다. 넣은 뒤에는 그 위에 바로 판서할 수 있어요.</p>' +
      '<div class="map-picker-bar">' +
        '<select class="map-select map-picker-basemap" aria-label="배경지도"></select>' +
        '<div class="map-search">' +
          '<input type="text" class="map-goto map-picker-goto" placeholder="장소 이름 또는 좌표" aria-label="장소 이름 또는 좌표로 이동">' +
          '<button class="map-btn map-search-submit" type="button" title="장소 검색 (Enter)">검색</button>' +
          '<div class="map-results" hidden></div>' +
        '</div>' +
        '<span class="map-picker-note" aria-live="polite"></span>' +
      '</div>' +
      '<div class="map-picker-stage"></div>' +
      '<div class="modal-actions">' +
        '<span class="spacer"></span>' +
        '<button class="btn map-picker-cancel" type="button">취소</button>' +
        '<button class="btn primary map-picker-ok" type="button">이 화면 넣기</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  const stage = modal.querySelector(".map-picker-stage");
  const basemapSelect = modal.querySelector(".map-picker-basemap");
  const gotoInput = modal.querySelector(".map-picker-goto");
  const note = modal.querySelector(".map-picker-note");
  for (const [id, spec] of Object.entries(MAP_BASEMAPS)){
    const option = document.createElement("option");
    option.value = id; option.textContent = spec.label;
    basemapSelect.appendChild(option);
  }
  basemapSelect.value = start.basemap;
  mapTranslate(modal);

  const map = L.map(stage, { center:start.center, zoom:start.zoom, zoomControl:true });
  const moveToSearchLocation = mapSearchLocationMover(map);
  /* 프록시 확인을 기다리는 동안에도 창은 이미 보인다. 검색 이벤트를 먼저 붙여, 사용자가 창을
     열자마자 Enter 를 누르거나 버튼을 눌러도 입력이 사라지지 않게 한다. */
  mapAttachPlaceSearch(gotoInput, modal.querySelector(".map-search-submit"), modal.querySelector(".map-results"),
    moveToSearchLocation,
    (message) => { note.textContent = message; });
  let tiles = null;
  const cleanupNetworkNotice = mapAttachNetworkNotice(stage, map, () => tiles);
  const proxyBase = await mapTileProxyBase();
  let basemap = start.basemap;
  const applyBasemap = () => {
    if (tiles) map.removeLayer(tiles);
    tiles = mapCreateTileLayer(basemap, proxyBase, null);
    tiles.addTo(map);
    cleanupNetworkNotice.refresh();
  };
  applyBasemap();
  /* 창이 열리면서 칸 크기가 잡히므로 한 박자 뒤에 지도에게 다시 재라고 알린다.
     닫고 나서 이 타이머가 뒤늦게 터지면 이미 없어진 지도를 건드려 터진다
     (_leaflet_pos of undefined — 창을 빨리 여닫으면 실제로 난다). 닫을 때 반드시 끈다. */
  let settled = false;
  const sizeTimer = setTimeout(() => { if (!settled) map.invalidateSize(); }, 60);
  // 공용 모달은 사용자가 가장자리를 잡아 크기를 바꿀 수 있다. Leaflet은 컨테이너 크기 변화를
  // 스스로 감지하지 않으므로, 창만 늘고 타일 영역은 예전 크기에 남아 빈 공간이 생기지 않게 한다.
  let resizeFrame = 0;
  let pickerResizeObserver = null;
  if (typeof ResizeObserver !== "undefined"){
    pickerResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!settled) map.invalidateSize({ pan:false, debounceMoveend:true });
      });
    });
    pickerResizeObserver.observe(stage);
  }

  return new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(sizeTimer);
      cancelAnimationFrame(resizeFrame);
      if (pickerResizeObserver) pickerResizeObserver.disconnect();
      window.removeEventListener("keydown", onKey, true);
      cleanupNetworkNotice();
      try { map.remove(); } catch(_){}
      modal.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopImmediatePropagation();
      finish(null);
    };
    window.addEventListener("keydown", onKey, true);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) finish(null); });
    modal.querySelector(".map-picker-cancel").addEventListener("click", () => finish(null));

    basemapSelect.addEventListener("change", () => {
      basemap = MAP_BASEMAPS[basemapSelect.value] ? basemapSelect.value : "osm";
      const limit = MAP_BASEMAPS[basemap].maxZoom;
      if (map.getZoom() > limit) map.setZoom(limit);
      applyBasemap();
    });
    modal.querySelector(".map-picker-ok").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      note.textContent = mapT("그림으로 굳히는 중…");
      try {
        const center = map.getCenter();
        mapPickerRememberView({ center:[center.lat, center.lng], zoom:map.getZoom(), basemap });
        const spec = MAP_BASEMAPS[basemap] || MAP_BASEMAPS.osm;
        const png = await mapCaptureDataUrl(stage, spec.attribution, []);
        finish(png);
      } catch(error){
        console.warn("map picker capture failed:", error);
        note.textContent = mapT("그림으로 굳히지 못했어요 — 배경지도가 다 뜬 뒤에 다시 눌러 주세요.");
        button.disabled = false;
      }
    });
  });
}

/* ===== 열기 ===== */
async function loadMapDoc(file, opts = {}){
  let model, text = "";
  try {
    text = await file.text();
    model = mapDocParse(text);
  } catch(_){
    /* `.map` 은 자바스크립트 소스맵(app.js.map)도 쓰는 확장자다. 압축·폴더 안에서 그런 파일을
       만나면 지도가 아니라 그냥 텍스트로 열어야 하고, 지도가 깨진 것처럼 알리면 안 된다.
       그래서 "지도라고 주장하는" 파일일 때만 실패를 알린다. */
    if (text.indexOf(MAP_DOC_TYPE) >= 0 && typeof toast === "function"){
      toast(mapT("지도 문서(.map)를 읽지 못해 텍스트로 열었어요."), 3500);
    }
    return typeof loadText === "function" ? loadText(file, opts) : null;
  }
  if (!model.title) model.title = mapDocDefaultTitle(file.name);
  const doc = makeDoc("map", file.name, opts);
  doc.mapDoc = model;
  // 메모 그림 블록에서 되살린 지도 — "메모로"를 누르면 새 블록을 만들지 않고 그 블록을 바꾼다.
  doc.memoBlockId = String(opts.memoBlockId || "") || null;
  doc.sourceFile = file;
  doc.savedText = mapDocSerialize(model);
  doc.savedContentKey = mapDocContentKey(model);
  doc.render = async () => {
    if (doc._mapMounted) return;              // 지도 상태(확대·표시)를 잃지 않게 한 번만 마운트
    doc.el.innerHTML = "";
    doc._mapMounted = true;
    await mountMapEditor(doc);
  };
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

/* ===== 새 문서 만들기 ===== */
function mapScratchFileName(n){
  return n && n > 1 ? "지도 " + n + ".map" : "지도.map";
}
function newMapScratch(){
  _mapScratchCount++;
  const name = mapScratchFileName(_mapScratchCount);
  const starter = mapDocSerialize(mapDocEmpty(mapDocDefaultTitle(name)));
  if (typeof handleFiles === "function"){
    handleFiles([new File([starter], name, { type:"application/json" })], { isScratch:true });
  }
}
function newMapScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, mapScratchFileName,
    (name) => mapDocSerialize(mapDocEmpty(mapDocDefaultTitle(name))),
    "application/json", "지도");
}

/* 메모 그림과 같은 자리(중심·확대)를 보여 준다. 아직 그리지 않은 탭은 모델만 고쳐 두면
   마운트할 때 그 자리에서 뜬다(mountMapEditor 의 L.map({center, zoom})). 보던 자리는 저장 안 됨(●)
   판정에 들어가지 않으므로 이렇게 옮겨도 문서가 고쳐진 것으로 표시되지 않는다. */
function mapApplyMemoView(doc, snapshot){
  if (!doc || !snapshot) return;
  if (doc.mapDoc){
    doc.mapDoc.center = [snapshot.center[0], snapshot.center[1]];
    doc.mapDoc.zoom = snapshot.zoom;
  }
  const map = doc.mapInstance;
  if (map && typeof map.setView === "function"){
    try { map.setView(snapshot.center, snapshot.zoom); }
    catch(error){ console.warn("메모 그림의 자리로 옮기지 못했어요:", error); }
  }
}

/* 이 블록과 이미 이어져 있는 지도 탭을 만났을 때 — true 면 그 탭을 그대로 쓰고, false 면
   메모 그림의 스냅샷으로 새 탭을 연다.
   · 내용(제목·배경지도·표시·도형)이 같으면 그 탭으로 가서 보던 자리만 그림과 맞춘다. 탭을
     열어 둔 채 지도를 옮겨 놨거나 파일을 다시 열어 저장된 자리로 돌아온 뒤에도, 메모에서 누른
     사람이 기대하는 "그림 속 그 자리"가 보인다.
   · 내용이 다르면 묻는다. 열린 탭을 스냅샷으로 되돌리면 메모로 보낸 뒤의 편집이 사라지고,
     그렇다고 말없이 그 탭을 보여 주면 메모 그림과 딴판인 지도가 뜨기 때문이다. 새로 열기를
     고르면 부르는 쪽이 옛 탭의 고리를 끊는다(그 탭의 지도 자체는 그대로 남는다). */
async function mapKeepOpenedMemoTab(opened, snapshot){
  const same = !!(opened && opened.mapDoc) && mapDocContentKey(opened.mapDoc) === mapDocContentKey(snapshot);
  if (!same && typeof confirmDialog === "function"){
    const openNew = await confirmDialog(
      mapTf("이미 열려 있는 '{name}' 탭이 이 메모 그림과 이어져 있는데, 그 지도는 그림과 내용이 달라요. 메모 그림의 지도를 새 탭으로 열까요?",
        { name: String((opened && opened.name) || "지도") }),
      mapT("메모 그림으로 열기"), mapT("열린 탭 보기"));
    if (openNew) return false;
  }
  if (typeof setActiveDoc === "function") setActiveDoc(opened.id);
  if (same) mapApplyMemoView(opened, snapshot);
  if (typeof toast === "function"){
    toast(same
      ? mapT("이미 열려 있는 지도 탭으로 갔어요 — 메모 그림과 같은 자리로 옮겼어요.")
      : mapT("이미 열려 있는 지도 탭으로 갔어요 — 이 탭의 지도는 메모 그림과 내용이 다릅니다."), 3600);
  }
  opened.memoReusedTab = true;      // 메모창이 "지도로 열었어요" 안내를 겹쳐 띄우지 않게
  return true;
}

/* 메모 그림 블록의 "✏️ 지도로" — 그림과 함께 넣어 둔 지도 스냅샷을 새 탭으로 되살린다.
   options.state       — 메모 블록에 담긴 지도 객체(mapDocSerialize 형식)
   options.name        — 탭 이름(메모에 적힌 이름을 되살린다)
   options.memoBlockId — 돌아갈 메모 블록 id. 고친 뒤 "메모로"를 누르면 그 블록을 제자리에서 바꾼다. */
async function openMapFromMemo(options = {}){
  const blockId = String(options.memoBlockId || "");
  const pending = blockId ? _mapMemoOpenTasks.get(blockId) : null;
  if (pending){
    const pendingDoc = await pending;
    if (pendingDoc && typeof setActiveDoc === "function") setActiveDoc(pendingDoc.id);
    return pendingDoc;
  }
  const opening = (async () => {
    // 같은 블록을 두 탭으로 열면 둘 다 그 블록을 덮어써 나중 것이 앞의 편집을 지운다.
    const opened = (typeof docs !== "undefined" ? docs : []).find((item) =>
      item && item.kind === "map" && blockId && item.memoBlockId === blockId);
    let snapshot = null;
    try { snapshot = mapDocParse(JSON.stringify(options.state || {})); }
    catch(error){
      console.warn("메모의 지도 스냅샷을 읽지 못했어요:", error);
      // 스냅샷이 깨졌더라도 이 블록과 이어져 있던 탭은 그대로 보여 준다.
      if (opened){
        if (typeof setActiveDoc === "function") setActiveDoc(opened.id);
        return opened;
      }
      if (typeof toast === "function") toast(mapT("메모에 담긴 지도 정보를 읽지 못했어요."), 2800, { type:"error" });
      return null;
    }
    if (opened){
      if (await mapKeepOpenedMemoTab(opened, snapshot)) return opened;
      // "메모 그림으로 열기"를 골랐다 — 옛 탭의 고리를 먼저 끊어야 한 블록을 두 탭이 덮어쓰지 않는다.
      opened.memoBlockId = null;
      if (typeof persistTabState === "function") persistTabState();
    }
    if (typeof handleFiles !== "function") return null;
    const base = mapSafeDownloadName(String(options.name || "지도").replace(/\.map$/i, "").trim() || "지도");
    const made = await handleFiles([new File([mapDocSerialize(snapshot)], base + ".map", { type:"application/json" })],
      { isScratch:true, memoBlockId:blockId });
    if (made) made.memoReusedTab = false;
    return made;
  })();
  if (blockId) _mapMemoOpenTasks.set(blockId, opening);
  try { return await opening; }
  finally {
    if (blockId && _mapMemoOpenTasks.get(blockId) === opening) _mapMemoOpenTasks.delete(blockId);
  }
}

/* ===== 저장 ===== */
async function saveMapDoc(doc){
  if (!doc || !doc.mapDoc) return false;
  const json = mapDocSerialize(doc.mapDoc);
  const ok = (typeof saveTextDoc === "function") ? await saveTextDoc(json, doc, doc.name) : false;
  if (ok){
    doc.savedText = json;
    doc.savedContentKey = mapDocContentKey(doc.mapDoc);
    // saveTextDoc 은 디스크에만 쓴다. 작업공간 사본까지 같이 맞춰야 다음 실행에서 마지막
    // 편집분이 사라지지 않는다(.mnote 저장과 같은 이유).
    if (typeof markDocumentSavedSnapshot === "function"){
      await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json");
    } else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  }
  return ok;
}

/* ===== 저장 전 안전망 =====
   새로고침·창 닫기로 사라지지 않도록 지금 편집분을 작업공간 사본으로 남긴다. 다음 실행에서
   그 사본이 그대로 다시 열린다. 파이썬·노트북·표·이미지·메모(.mnote)가 이미 쓰는 길인데
   지도만 빠져 있어, 저장 전에 새로고침하면 되살릴 근거가 없었다.

   saveDocumentRecoverySnapshot 을 쓰지 않는 까닭: 그쪽은 workspacePath 가 있어야 하는데, 아직
   한 번도 저장하지 않은 새 지도에는 그 값이 없다(makeDoc 이 null 로 둔다) — 정작 가장 잃기
   쉬운 문서가 걸러진다. recoverySnapshotFile 이 이름으로 경로를 대신 세워 주므로 그것만 빌려
   쓰고 작업공간에는 직접 넣는다(파이썬 초안과 같은 방식). */
const MAP_RECOVERY_DELAY = 800;
async function mapSaveRecovery(doc){
  if (!doc || !doc.mapDoc) return false;
  /* 저장해 둔 지도는 고친 것이 있을 때만 남긴다. 아직 한 번도 저장하지 않은 새 지도(초안)는
     고친 것이 없어도 남긴다 — 표시를 찍기 전이라 ● 가 켜지지 않았을 뿐, 새로고침하면 탭째
     사라지기 때문이다. 한 번 저장하고 나면 _named 가 서고, 그때부터는 앞줄로 갈린다. */
  if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return false;
  if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
  let json;
  try { json = mapDocSerialize(doc.mapDoc); } catch(_){ return false; }
  const file = recoverySnapshotFile(doc, new TextEncoder().encode(json), "application/json");
  if (!file) return false;
  try {
    doc.savedInWorkspace = await rememberWorkspace([file], false, { silent:true });
    return !!doc.savedInWorkspace;
  } catch(error){
    console.warn("지도 복구본을 남기지 못했어요:", error);
    return false;
  }
}

/* ===== 편집기 ===== */
async function mountMapEditor(doc){
  const model = doc.mapDoc;

  const root = document.createElement("div");
  root.className = "map-doc";

  const bar = document.createElement("div");
  bar.className = "map-bar";

  const titleInput = document.createElement("input");
  titleInput.className = "map-title";
  titleInput.type = "text";
  titleInput.value = model.title || "";
  titleInput.placeholder = "지도 제목";
  titleInput.setAttribute("aria-label", "지도 제목");

  const basemapSelect = document.createElement("select");
  basemapSelect.className = "map-select";
  basemapSelect.title = "배경지도 바꾸기";
  basemapSelect.setAttribute("aria-label", "배경지도");
  for (const [id, spec] of Object.entries(MAP_BASEMAPS)){
    const option = document.createElement("option");
    option.value = id; option.textContent = spec.label;
    basemapSelect.appendChild(option);
  }
  if (model.backgroundImage){
    const option = document.createElement("option");
    option.value = "custom"; option.textContent = "내 지도 이미지";
    basemapSelect.appendChild(option);
  }
  basemapSelect.value = model.basemap;

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "map-btn map-add";
  addBtn.textContent = "📍 표시 추가";
  addBtn.title = "누른 뒤 지도를 클릭하면 그 자리에 표시가 생겨요";
  addBtn.setAttribute("aria-pressed", "false");

  const addressBtn = document.createElement("button");
  addressBtn.type = "button";
  addressBtn.className = "map-btn map-auto-address";
  addressBtn.textContent = "📮 주소 자동";
  addressBtn.title = "켜 두면 새로 찍은 표시의 이름에 그 자리의 주소를 채워 넣어요";
  addressBtn.setAttribute("aria-pressed", "false");

  const spotBtn = document.createElement("button");
  spotBtn.type = "button";
  spotBtn.className = "map-btn map-spot-info";
  spotBtn.textContent = "🔎 장소 정보";
  spotBtn.title = "켜 두면 지도를 클릭한 자리의 건물·시설 이름과 주소를 말풍선으로 보여 줘요";
  spotBtn.setAttribute("aria-pressed", "false");
  spotBtn.hidden = true;        // 좌표를 주소로 되묻는 길(런처)이 있을 때만 보인다

  const nearbyBtn = document.createElement("button");
  nearbyBtn.type = "button";
  nearbyBtn.className = "map-btn map-nearby";
  nearbyBtn.textContent = "🏫 주변 시설";
  nearbyBtn.title = "지도 가운데를 기준으로 반경 안의 학교·병원 같은 시설을 한 번에 표시";
  nearbyBtn.hidden = true;      // 카카오 검색을 켰을 때만 보인다

  const regionBtn = document.createElement("button");
  regionBtn.type = "button";
  regionBtn.className = "map-btn map-region-stats";
  regionBtn.textContent = "🧭 지역 통계";
  regionBtn.title = "표시마다 시도·시군구를 채우고 지역별 개수를 칠판 차트로 보내요";

  const boardBtn = document.createElement("button");
  boardBtn.type = "button";
  boardBtn.className = "map-btn map-to-board";
  boardBtn.textContent = "🖊️ 칠판으로";
  boardBtn.title = "지금 보이는 지도를 그림으로 굳혀 새 화이트보드에 올려요 — 그 위에 바로 판서할 수 있어요";

  const memoBtn = document.createElement("button");
  memoBtn.type = "button";
  memoBtn.className = "map-btn map-to-memo";
  memoBtn.textContent = "📋 메모로";
  memoBtn.title = "지금 보이는 지도를 메모창에 넣어요 — 메모에서 '✏️ 지도로'를 누르면 다시 편집할 수 있어요";

  // 자동 캐시 현황은 런처가 디스크에 남겨 주는 기능이라 exe 로 돌 때만 뜻이 있다(아래에서 표시 결정).
  const prepareBtn = document.createElement("button");
  prepareBtn.type = "button";
  prepareBtn.className = "map-btn map-prepare";
  prepareBtn.textContent = "🗂️ 오프라인 지도";
  prepareBtn.title = "실제로 본 지역은 자동으로 보관됩니다 — 현황을 확인하거나 비울 수 있어요";

  const imageBtn = document.createElement("button");
  imageBtn.type = "button"; imageBtn.className = "map-btn map-image-pick";
  imageBtn.textContent = "🖼️ 내 지도"; imageBtn.title = "학교 배치도·평면도 같은 이미지를 오프라인 지도 배경으로 사용";
  const imageClearBtn = document.createElement("button");
  imageClearBtn.type = "button"; imageClearBtn.className = "map-btn map-image-clear";
  imageClearBtn.textContent = "이미지 지우기"; imageClearBtn.hidden = !model.backgroundImage;
  const imageInput = document.createElement("input");
  imageInput.type = "file"; imageInput.accept = "image/png,image/jpeg,image/webp"; imageInput.hidden = true;

  const lineBtn = document.createElement("button");
  lineBtn.type = "button"; lineBtn.className = "map-btn map-draw-line";
  lineBtn.textContent = "📏 거리선"; lineBtn.title = "지도에 점을 찍어 경로와 전체 거리를 표시";
  lineBtn.setAttribute("aria-pressed", "false");
  const areaBtn = document.createElement("button");
  areaBtn.type = "button"; areaBtn.className = "map-btn map-draw-area";
  areaBtn.textContent = "▱ 면적 영역"; areaBtn.title = "지도에 점을 찍어 영역과 면적을 표시";
  areaBtn.setAttribute("aria-pressed", "false");

  const csvImportBtn = document.createElement("button");
  csvImportBtn.type = "button"; csvImportBtn.className = "map-btn map-csv-import";
  csvImportBtn.textContent = "CSV 들이기"; csvImportBtn.title = "이름·위도·경도 열의 CSV에서 표시 추가 — 좌표 없이 주소 열만 있어도 됩니다";
  const csvExportBtn = document.createElement("button");
  csvExportBtn.type = "button"; csvExportBtn.className = "map-btn map-csv-export";
  csvExportBtn.textContent = "CSV 내보내기"; csvExportBtn.title = "지도 표시를 Excel에서 열 수 있는 CSV로 저장";
  const csvInput = document.createElement("input");
  csvInput.type = "file"; csvInput.accept = ".csv,text/csv"; csvInput.hidden = true;

  const clearItemsBtn = document.createElement("button");
  clearItemsBtn.type = "button"; clearItemsBtn.className = "map-btn map-clear-items";
  clearItemsBtn.textContent = "🧹 지우기";
  clearItemsBtn.title = "표시·거리선·면적을 한꺼번에 지워요 — 주변 시설로 넣은 것만 골라 지울 수도 있어요";

  // 검색칸과 결과 목록은 한 덩어리로 묶는다(목록이 칸 바로 아래에 뜨도록).
  const searchWrap = document.createElement("div");
  searchWrap.className = "map-search";
  const gotoInput = document.createElement("input");
  gotoInput.className = "map-goto";
  gotoInput.type = "text";
  gotoInput.placeholder = "장소 이름 또는 좌표";
  gotoInput.title = "예: 경복궁 · 37.5665, 126.9780 — 적고 Enter";
  gotoInput.setAttribute("aria-label", "장소 이름 또는 좌표로 이동");
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "map-btn map-search-submit";
  searchBtn.textContent = "검색";
  searchBtn.title = "장소 검색 (Enter)";
  const searchResults = document.createElement("div");
  searchResults.className = "map-results";
  searchResults.hidden = true;
  searchWrap.append(gotoInput, searchBtn, searchResults);

  const undoBtn = document.createElement("button");
  undoBtn.type = "button"; undoBtn.className = "map-btn map-undo";
  undoBtn.textContent = "↶"; undoBtn.title = "되돌리기 (Ctrl+Z)"; undoBtn.disabled = true;
  const redoBtn = document.createElement("button");
  redoBtn.type = "button"; redoBtn.className = "map-btn map-redo";
  redoBtn.textContent = "↷"; redoBtn.title = "다시 실행 (Ctrl+Shift+Z)"; redoBtn.disabled = true;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "run-save map-save";     // .run-save → 전역 Ctrl+S 가 이 버튼을 클릭한다
  saveBtn.textContent = "💾 저장";
  saveBtn.title = "지도 저장 (Ctrl+S)";
  saveBtn.dataset.shortcutAction = "saveCurrent";

  const coord = document.createElement("span");
  coord.className = "map-coord";

  const status = document.createElement("span");
  status.className = "map-status";
  const setStatus = (msg) => { status.textContent = msg || ""; };

  bar.append(titleInput, basemapSelect, addBtn, addressBtn, spotBtn, lineBtn, areaBtn, nearbyBtn, regionBtn,
    imageBtn, imageClearBtn, csvImportBtn, csvExportBtn, clearItemsBtn, boardBtn, memoBtn, searchWrap,
    undoBtn, redoBtn, saveBtn, coord, status);

  const stage = document.createElement("div");
  stage.className = "map-stage";

  root.append(bar, stage, imageInput, csvInput);
  doc.el.appendChild(root);
  mapTranslate(bar);

  try { await MNLazy.need("leaflet"); }
  catch(_){
    stage.innerHTML = '<p class="map-fallback">' + mapT("지도 라이브러리를 불러오지 못했어요.") + '</p>';
    return;
  }

  const map = L.map(stage, {
    center: model.center,
    zoom: model.zoom,
    zoomControl: true
  });
  map.getContainer().setAttribute("aria-label", mapT("지도"));
  doc.mapInstance = map;
  // 사용자 지도 이미지는 거리선·면적 영역보다 항상 아래에 둔다. 기본 overlayPane에 넣으면
  // 이미지를 나중에 교체했을 때 SVG 도형 위를 덮을 수 있다.
  const imagePane = map.createPane("mapImagePane");
  imagePane.style.zIndex = "150";
  imagePane.style.pointerEvents = "none";

  const proxyBase = await mapTileProxyBase();
  let usingProxy = !!proxyBase;
  let tiles = null;
  let backgroundLayer = null;
  const cleanupNetworkNotice = mapAttachNetworkNotice(stage, map, () => tiles);

  // 프록시가 있어야(= exe) 받아 둔 타일이 디스크에 남아 다음 수업까지 간다. 브라우저로 연
  // 경우에는 아예 붙이지 않는다 — 눌러도 아무 데도 남지 않는 버튼을 보여 주지 않기 위해서다.
  if (proxyBase){
    prepareBtn.addEventListener("click", openMapOfflineStatus);
    bar.insertBefore(prepareBtn, searchWrap);
    mapTranslate(bar);
  }

  /* 캡처는 타일이 다 들어온 뒤에 찍어야 반쯤 빈 그림이 안 나온다. Leaflet 은 보이는 타일이
     전부 끝나면(실패한 것 포함) load 를 한 번 쏘므로 그것을 기다린다. */
  let tilesSettled = false;
  let tileWaiters = [];
  const settleTiles = () => { tilesSettled = true; tileWaiters.splice(0).forEach(fn => fn()); };
  const waitForTiles = (timeoutMs) => new Promise((resolve) => {
    if (tilesSettled) return resolve();
    const timer = setTimeout(resolve, timeoutMs);        // 인터넷이 없으면 기다리다 그냥 찍는다
    tileWaiters.push(() => { clearTimeout(timer); resolve(); });
  });

  const applyBasemap = () => {
    if (tiles) map.removeLayer(tiles);
    if (backgroundLayer) map.removeLayer(backgroundLayer);
    tiles = null;
    backgroundLayer = null;
    tilesSettled = false;
    if (model.basemap === "custom" && model.backgroundImage){
      backgroundLayer = L.imageOverlay(model.backgroundImage.dataUrl, model.backgroundImage.bounds, {
        opacity: 1,
        interactive: false,
        pane: "mapImagePane"
      });
      backgroundLayer.addTo(map);
      tilesSettled = true;
      cleanupNetworkNotice.hide();
      settleTiles();
      return;
    }
    tiles = mapCreateTileLayer(model.basemap, usingProxy ? proxyBase : "", () => {
      // 프록시가 계속 실패한다 — 이 exe 에는 /tile-proxy 가 없을 수 있으니 직접 주소로 갈아탄다.
      if (!usingProxy) return;
      usingProxy = false;
      applyBasemap();
      setStatus(mapT("배경지도를 직접 내려받는 방식으로 바꿨어요."));
    });
    tiles.on("load", settleTiles);
    tiles.addTo(map);
    cleanupNetworkNotice.refresh();
  };
  applyBasemap();

  /* ── 되돌리기 ──
     내용이 바뀌는 곳은 모두 touch() 를 부르므로, 되돌리기 기록도 거기 한 곳에 건다(빠뜨린 길이
     생기지 않게). 잇단 변경은 commitSoon 이 한 단계로 묶는다 — 이름을 타자할 때나 표시를 끌 때
     글자·픽셀마다 단계가 쌓이지 않는다. 기록 자체는 아래(레이어 함수가 다 갖춰진 뒤)에서 만든다. */
  let history = null;
  // 주소 CSV 좌표 찾기처럼 한 줄씩 몇 분에 걸쳐 들어오는 일은 줄마다가 아니라 통째로 한 단계다.
  let bulkDepth = 0;
  const recordSoon = () => { if (history && !bulkDepth) history.commitSoon(200); };
  /* 배경 이미지는 dataUrl 이 수 MB 라 단계마다 복제하면 안 된다. 실제 이미지는 버전 표에 한 번만
     두고 스냅샷에는 버전 번호만 넣는다(문서 서식 편집기가 document.xml 을 다루는 방식과 같다). */
  let imageVersion = 0;
  const imageVersions = new Map([[0, model.backgroundImage || null]]);
  const noteImageChange = () => {
    imageVersion++;
    imageVersions.set(imageVersion, model.backgroundImage || null);
  };

  /* ── 저장 전 안전망 ──
     고칠 때마다 곧바로 쓰지 않고 잠시 모아 둔다. 표시를 끌어 옮기는 동안에는 touch 가 연달아
     들어오는데, 그때마다 작업공간을 다시 쓰면 지도가 눈에 띄게 끊긴다. */
  let recoveryTimer = 0;
  const scheduleRecovery = () => {
    clearTimeout(recoveryTimer);
    // 설정의 '자동 저장·복원'을 따른다 — 꺼 둔 사람에게는 사본을 남기지 않는다(.mnote 와 같은 규칙).
    if (typeof appSettings !== "object" || !appSettings || !appSettings.pdfRecovery) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = 0;
      mapSaveRecovery(doc).catch(() => {});
    }, MAP_RECOVERY_DELAY);
  };
  const flushMapBackup = () => {
    clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    return mapSaveRecovery(doc);
  };
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.flushBackupRecovery = flushMapBackup;     // 백업 내보내기도 마지막 편집분까지 담는다
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    if (doc.flushBackupRecovery === flushMapBackup) delete doc.flushBackupRecovery;
  });
  /* 아직 저장하지 않은 새 지도는 손대기 전에도 한 번 남긴다 — 표시를 찍기 전에 새로고침해도
     빈 지도 탭이 그대로 돌아오게. 저장해 둔 지도는 고칠 때 남기면 되므로 여기서는 지나친다. */
  if (doc.isScratch && !doc._named) scheduleRecovery();

  /* ── 저장 안 됨(●) 표시 ── */
  const touch = () => {
    const dirty = mapDocContentKey(model) !== doc.savedContentKey;
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
    setStatus(dirty ? "● " + mapT("저장 안 됨") : "");
    recordSoon();
    scheduleRecovery();
  };

  /* ── 표시(마커) ── */
  const markerLayers = new Map();          // 마커 id → L.marker

  const removeMarker = (marker) => {
    const index = model.markers.findIndex(m => m.id === marker.id);
    if (index >= 0) model.markers.splice(index, 1);
    const layer = markerLayers.get(marker.id);
    if (layer){ map.removeLayer(layer); markerLayers.delete(marker.id); }
    touch();
  };

  /* ── 이 자리의 주소 ──
     이름을 손으로 치지 않고 지도에서 되받아 온다. 기다리는 사이 표시를 지웠을 수 있으므로
     돌아온 뒤에 아직 살아 있는 표시인지 확인하고 넣는다. */
  /* 되돌리기는 표시 객체를 새로 만들어 끼우므로, 기다렸다 돌아온 뒤에는 손에 든 객체가 이미
     모델에서 빠진 옛 것일 수 있다. 언제나 같은 id 로 지금 살아 있는 표시를 다시 찾는다. */
  const liveMarker = (marker) => model.markers.find(item => item.id === marker.id) || null;
  const applyMarkerLabel = (marker, text) => {
    const live = liveMarker(marker) || marker;
    live.label = String(text || "").slice(0, 120);
    const layer = markerLayers.get(live.id);
    if (layer){
      layer.setTooltipContent(live.label || mapT("이름 없는 표시"));
      const popup = typeof layer.getPopup === "function" ? layer.getPopup() : null;
      const form = popup && typeof popup.getContent === "function" ? popup.getContent() : null;
      if (form && form._labelInput) form._labelInput.value = live.label;
    }
    touch();
  };
  const fillMarkerAddress = async (marker, opts = {}) => {
    try {
      const info = await mapAddressAt(marker.lat, marker.lng);
      const live = liveMarker(marker);
      if (!live || !markerLayers.has(live.id)) return false;        // 기다리는 동안 지워진 표시
      if (!info){
        if (!opts.quiet) setStatus(mapT("이 자리의 주소를 찾지 못했어요."));
        return false;
      }
      // 자동 채우기는 사람이 적어 둔 이름을 덮지 않는다.
      if (opts.onlyEmpty && String(live.label || "").trim()) return false;
      applyMarkerLabel(live, info.name);
      if (info.region || info.district){
        live.region = info.region || "";
        live.district = info.district || "";
        touch();
      }
      return true;
    } catch(error){
      if (!opts.quiet){
        setStatus(mapT(error && error.message === "geocode-launcher-required"
          ? "주소 확인은 ClassDock 런처에서 사용할 수 있어요."
          : "주소를 확인하지 못했어요 — 인터넷 연결을 확인해 주세요."));
      }
      return false;
    }
  };

  // 팝업 안의 작은 편집 서식 — 이름·메모·색을 고치고 지울 수 있다.
  const buildPopup = (marker, layer) => {
    const form = document.createElement("div");
    form.className = "map-popup";

    const labelInput = document.createElement("input");
    labelInput.type = "text"; labelInput.className = "map-popup-label";
    labelInput.value = marker.label; labelInput.placeholder = "이름";
    labelInput.setAttribute("aria-label", "표시 이름");
    labelInput.addEventListener("input", () => {
      marker.label = labelInput.value.slice(0, 120);
      layer.setTooltipContent(marker.label || mapT("이름 없는 표시"));
      touch();
    });

    const noteInput = document.createElement("textarea");
    noteInput.className = "map-popup-note"; noteInput.rows = 3;
    noteInput.value = marker.note; noteInput.placeholder = "메모(수업 설명·관찰 기록)";
    noteInput.setAttribute("aria-label", "표시 메모");
    noteInput.addEventListener("input", () => {
      marker.note = noteInput.value.slice(0, 2000);
      touch();
    });

    const colorRow = document.createElement("div");
    colorRow.className = "map-popup-colors";
    for (const color of MAP_MARKER_COLORS){
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "map-swatch";
      swatch.style.background = color.hex;
      swatch.title = color.label;
      swatch.setAttribute("aria-label", color.label);
      swatch.setAttribute("aria-pressed", String(marker.color === color.id));
      swatch.addEventListener("click", () => {
        marker.color = color.id;
        layer.setIcon(mapPinIcon(color.id));
        colorRow.querySelectorAll(".map-swatch").forEach(el => el.setAttribute("aria-pressed", "false"));
        swatch.setAttribute("aria-pressed", "true");
        touch();
      });
      colorRow.appendChild(swatch);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "map-popup-remove";
    removeBtn.textContent = "표시 지우기";
    removeBtn.addEventListener("click", () => { map.closePopup(); removeMarker(marker); });

    const coordText = document.createElement("p");
    coordText.className = "map-popup-coord";
    const showCoord = () => {
      coordText.textContent = marker.lat.toFixed(5) + ", " + marker.lng.toFixed(5);
    };
    showCoord();
    form._showCoord = showCoord;
    form._labelInput = labelInput;

    // 이름 칸을 이 자리의 주소로 채운다(자동 채우기를 꺼 둬도 한 표시씩은 언제든 부를 수 있게).
    const addressFillBtn = document.createElement("button");
    addressFillBtn.type = "button";
    addressFillBtn.className = "map-popup-address";
    addressFillBtn.textContent = "이 자리 주소 넣기";
    addressFillBtn.addEventListener("click", async () => {
      addressFillBtn.disabled = true;
      addressFillBtn.textContent = mapT("찾는 중…");
      await fillMarkerAddress(marker);
      addressFillBtn.textContent = mapT("이 자리 주소 넣기");
      addressFillBtn.disabled = false;
    });

    form.append(labelInput, noteInput, colorRow, coordText, addressFillBtn, removeBtn);
    mapTranslate(form);
    return form;
  };

  const addMarkerLayer = (marker) => {
    const layer = L.marker([marker.lat, marker.lng], {
      icon: mapPinIcon(marker.color),
      draggable: true,
      title: marker.label || mapT("표시")
    });
    layer.bindTooltip(marker.label || mapT("이름 없는 표시"), { direction:"top", offset:[0, -32] });
    const popup = buildPopup(marker, layer);
    layer.bindPopup(popup, { minWidth: 210 });
    layer.on("dragend", () => {
      const position = layer.getLatLng();
      marker.lat = mapClampLat(position.lat);
      marker.lng = mapClampLng(position.lng);
      if (typeof popup._showCoord === "function") popup._showCoord();
      touch();
    });
    layer.addTo(map);
    markerLayers.set(marker.id, layer);
    return layer;
  };

  model.markers.forEach(addMarkerLayer);

  /* ── 거리선·면적 영역 ── */
  const shapeLayers = new Map();
  let selectedShape = null;
  const selectShape = (shape) => {
    selectedShape = shape || null;
    if (selectedShape){
      setStatus(mapT(selectedShape.type === "area"
        ? "면적 영역을 선택했어요. Esc 또는 Delete로 지울 수 있어요."
        : "거리선을 선택했어요. Esc 또는 Delete로 지울 수 있어요."));
    }
  };
  const shapeTooltip = (shape) => {
    const measure = mapShapeMeasureText(shape);
    return (shape.label ? shape.label + " · " : "") + measure;
  };
  const removeShape = (shape) => {
    const index = model.shapes.findIndex(item => item.id === shape.id);
    if (index >= 0) model.shapes.splice(index, 1);
    const layer = shapeLayers.get(shape.id);
    if (layer){ map.removeLayer(layer); shapeLayers.delete(shape.id); }
    if (selectedShape === shape) selectedShape = null;
    setStatus("");
    touch();
  };
  const buildShapePopup = (shape, layer) => {
    const form = document.createElement("div"); form.className = "map-shape-popup";
    const label = document.createElement("input");
    label.type = "text"; label.className = "map-popup-label"; label.value = shape.label;
    label.placeholder = shape.type === "area" ? "영역 이름" : "경로 이름";
    const measure = document.createElement("p"); measure.className = "map-popup-coord";
    measure.textContent = mapT(shape.type === "area" ? "면적" : "거리") + " " + mapShapeMeasureText(shape);
    const color = document.createElement("input");
    color.type = "color"; color.className = "map-shape-color"; color.value = shape.color;
    color.setAttribute("aria-label", "도형 색상");
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "map-popup-remove"; remove.textContent = "도형 지우기";
    label.addEventListener("input", () => {
      shape.label = label.value.slice(0, 120); layer.setTooltipContent(shapeTooltip(shape)); touch();
    });
    color.addEventListener("input", () => {
      shape.color = color.value; layer.setStyle({ color:shape.color, fillColor:shape.color }); touch();
    });
    remove.addEventListener("click", () => { map.closePopup(); removeShape(shape); });
    form.append(label, measure, color, remove); mapTranslate(form);
    return form;
  };
  const addShapeLayer = (shape) => {
    /* smoothFactor 를 끈다. Leaflet 은 기본값 1.0 으로 점을 화면 픽셀 기준으로 솎아 내는데,
       그러면 반경 원의 변 길이가 들쭉날쭉해져 삐뚤삐뚤해 보이고 손으로 찍은 꼭짓점도 조용히
       사라진다. 우리 도형은 점 수가 많아야 수백 개라 솎아 낼 이유가 없다. */
    const options = { color:shape.color, weight:4, opacity:0.9, smoothFactor:0 };
    const layer = shape.type === "area"
      ? L.polygon(shape.points, { ...options, fillColor:shape.color, fillOpacity:0.18 })
      : L.polyline(shape.points, options);
    const anchor = mapShapeLabelAnchor(shape);
    layer.bindTooltip(shapeTooltip(shape), {
      permanent:true,
      direction:(shape.type === "area" && !anchor) ? "center" : "top",
      className:"map-shape-label"
    });
    layer.bindPopup(buildShapePopup(shape, layer), { minWidth:190 });
    layer.on("click", () => selectShape(shape));
    layer.on("popupopen", () => selectShape(shape));
    layer.addTo(map); shapeLayers.set(shape.id, layer);
    // 반경 원은 한가운데가 정작 보려는 곳이라 이름표를 위쪽 테두리로 올린다(레이어에 붙은 뒤라야 뜬다).
    if (anchor) layer.openTooltip(anchor);
    return layer;
  };
  model.shapes.forEach(addShapeLayer);

  /* ── 표시·거리선·면적 영역 추가 모드 ── */
  let adding = false;
  let drawingMode = null;
  let draftPoints = [];
  let draftLayer = null;
  const syncInteractionKeyListener = () => {
    window.removeEventListener("keydown", onInteractionKey);
    if (adding || drawingMode) window.addEventListener("keydown", onInteractionKey);
  };
  const clearDraft = () => {
    if (draftLayer) map.removeLayer(draftLayer);
    draftLayer = null; draftPoints = [];
  };
  const updateDraft = () => {
    if (draftLayer) map.removeLayer(draftLayer);
    draftLayer = null;
    if (!draftPoints.length) return;
    // 그리는 중에도 점을 솎지 않는다(완성한 도형과 같은 모양으로 보이게).
    const options = { color:drawingMode === "area" ? "#16a34a" : "#2563eb", weight:4, dashArray:"7 6", fillOpacity:0.12, smoothFactor:0 };
    draftLayer = drawingMode === "area" && draftPoints.length >= 3
      ? L.polygon(draftPoints, options) : L.polyline(draftPoints, options);
    draftLayer.addTo(map);
  };
  function finishDrawing(save){
    if (!drawingMode) return false;
    const min = drawingMode === "area" ? 3 : 2;
    if (save && draftPoints.length < min){
      setStatus(mapT(drawingMode === "area" ? "면적 영역은 점을 3개 이상 찍어 주세요." : "거리선은 점을 2개 이상 찍어 주세요."));
      return false;
    }
    const mode = drawingMode;
    const points = draftPoints.map(point => [point[0], point[1]]);
    clearDraft(); drawingMode = null;
    lineBtn.classList.remove("is-on"); areaBtn.classList.remove("is-on");
    lineBtn.setAttribute("aria-pressed", "false"); areaBtn.setAttribute("aria-pressed", "false");
    stage.classList.remove("is-drawing"); syncInteractionKeyListener();
    if (save){
      const shape = mapNormalizeShape({ type:mode, points });
      model.shapes.push(shape); addShapeLayer(shape); selectShape(shape); touch();
    } else setStatus("");
    return true;
  }
  function setDrawing(mode){
    if (mode && drawingMode === mode){ finishDrawing(true); return; }
    if (drawingMode) finishDrawing(false);
    if (!mode) return;
    if (adding) setAdding(false);
    drawingMode = mode; draftPoints = [];
    lineBtn.classList.toggle("is-on", mode === "line"); areaBtn.classList.toggle("is-on", mode === "area");
    lineBtn.setAttribute("aria-pressed", String(mode === "line")); areaBtn.setAttribute("aria-pressed", String(mode === "area"));
    stage.classList.add("is-drawing");
    setStatus(mapT(mode === "area"
      ? "영역 꼭짓점을 차례로 찍고 Enter 또는 면적 영역 버튼을 다시 누르세요 (Esc 취소)"
      : "경로의 점을 차례로 찍고 Enter 또는 거리선 버튼을 다시 누르세요 (Esc 취소)"));
    syncInteractionKeyListener();
  }
  function setAdding(on){
    adding = !!on;
    if (adding && drawingMode) finishDrawing(false);
    addBtn.classList.toggle("is-on", adding);
    addBtn.setAttribute("aria-pressed", String(adding));
    stage.classList.toggle("is-adding", adding);
    setStatus(adding ? mapT("지도를 클릭하면 그 자리에 표시가 생겨요 (Esc 로 취소)") : "");
    syncInteractionKeyListener();
    if (!adding) touch();
  }
  function onInteractionKey(e){
    if (e.key === "Escape"){
      if (adding) setAdding(false);
      else if (drawingMode) finishDrawing(false);
    } else if (e.key === "Enter" && drawingMode){
      e.preventDefault(); finishDrawing(true);
    }
  }
  function onSelectedShapeKey(e){
    if (!selectedShape || adding || drawingMode || (doc.el && doc.el.hidden)) return;
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target;
    if (target && typeof target.matches === "function" &&
        (target.matches("input,textarea,select,[contenteditable]") || target.closest("[contenteditable]"))) return;
    if (e.key !== "Escape" && e.key !== "Delete" && e.key !== "Backspace") return;
    e.preventDefault();
    map.closePopup();
    removeShape(selectedShape);
  }
  window.addEventListener("keydown", onSelectedShapeKey);
  // 다른 곳을 누르면 선택을 풀어, 나중에 누른 Esc가 뜻밖에 오래된 영역을 지우지 않게 한다.
  stage.addEventListener("pointerdown", (e) => {
    const target = e.target;
    if (target && target.closest && target.closest(".leaflet-overlay-pane .leaflet-interactive")) return;
    selectedShape = null;
  });
  addBtn.addEventListener("click", () => setAdding(!adding));
  lineBtn.addEventListener("click", () => setDrawing("line"));
  areaBtn.addEventListener("click", () => setDrawing("area"));

  let autoAddress = mapAutoAddressOn();
  const syncAutoAddressButton = () => {
    addressBtn.classList.toggle("is-on", autoAddress);
    addressBtn.setAttribute("aria-pressed", String(autoAddress));
  };
  syncAutoAddressButton();
  addressBtn.addEventListener("click", () => {
    autoAddress = !autoAddress;
    mapRememberAutoAddress(autoAddress);
    syncAutoAddressButton();
    setStatus(mapT(autoAddress
      ? "새로 찍는 표시에 그 자리의 주소를 이름으로 채웁니다."
      : "주소 자동 채우기를 껐습니다."));
  });

  let spotInfo = mapSpotInfoOn();
  const syncSpotButton = () => {
    spotBtn.classList.toggle("is-on", spotInfo);
    spotBtn.setAttribute("aria-pressed", String(spotInfo));
  };
  syncSpotButton();
  spotBtn.addEventListener("click", () => {
    spotInfo = !spotInfo;
    mapRememberSpotInfo(spotInfo);
    syncSpotButton();
    if (!spotInfo) map.closePopup();
    setStatus(mapT(spotInfo
      ? "지도를 클릭하면 그 자리가 어디인지 말풍선으로 보여 줍니다."
      : "클릭한 자리 안내를 껐습니다."));
  });
  /* 주소를 되묻는 길은 런처의 /geocode 뿐이다 — 그 길이 없으면 눌러도 안 되는 단추라 감춘다
     (주변 시설을 카카오일 때만 내놓는 것과 같은 이유다). */
  mapTileProxyBase().then((base) => { spotBtn.hidden = !base; }).catch(() => {});

  /* 말풍선이 떠 있었다면 이번 클릭은 그것을 닫는 클릭이다. 닫자마자 새 말풍선을 열면 지도를
     눌러 닫을 방법이 없어진다. Leaflet 은 말풍선을 열 때 preclick 에 닫기를 매므로, 지도를 만들
     때 걸어 두는 이쪽이 언제나 먼저 불린다 — 닫히기 전의 상태를 볼 수 있다. */
  let popupOpen = false, popupWasOpen = false;
  map.on("popupopen", () => { popupOpen = true; });
  map.on("popupclose", (e) => {
    popupOpen = false;
    /* Leaflet 은 말풍선을 닫아도 map._popup 을 그대로 둔다(closePopup 이 비워 주지 않는다).
       그러면 키보드 처리기가 그 뒤의 Esc 마다 "닫을 말풍선이 아직 있다"고 보고 닫기를 한 번 더
       부른 뒤 이벤트를 삼켜 버려(preventDefault + stopPropagation), 검색 표식 지우기처럼 뒤에
       선 Esc 가 영영 오지 않는다. 한 번이라도 말풍선을 연 지도에서는 Esc 가 통째로 먹통이 되는
       셈이다. 닫힌 것은 닫힌 것으로 적어 둔다 — 다음 말풍선이 열리면 Leaflet 이 다시 채운다. */
    if (map._popup === e.popup) map._popup = null;
  });
  map.on("preclick", () => { popupWasOpen = popupOpen; });

  map.on("click", (e) => {
    if (drawingMode){
      draftPoints.push([mapClampLat(e.latlng.lat), mapClampLng(e.latlng.lng)]);
      updateDraft();
      const count = draftPoints.length;
      setStatus(mapTf("점 {count}개 — 계속 찍거나 Enter로 완료하세요", { count }));
      return;
    }
    if (!adding){
      /* 거리선·면적에서 올라온 클릭은 그 도형의 말풍선이 열릴 자리다(우클릭 메뉴와 같은 판정).
         여기서 걸러 내지 않으면 방금 열린 그 말풍선을 이 안내가 덮어 버린다. */
      if (spotInfo && !spotBtn.hidden && !popupWasOpen && !e.propagatedFrom) showSpotInfo(e.latlng);
      return;
    }
    const marker = mapNormalizeMarker({ lat:e.latlng.lat, lng:e.latlng.lng, label:"", color:"red" });
    model.markers.push(marker);
    const layer = addMarkerLayer(marker);
    setAdding(false);
    touch();
    layer.openPopup();
    // 주소는 네트워크를 기다리므로 표시부터 찍고 이름은 도착하는 대로 채운다.
    if (autoAddress) fillMarkerAddress(marker, { onlyEmpty:true, quiet:true });
  });

  /* ── 보기 위치는 조용히 따라간다(● 를 켜지 않는다) ── */
  const syncView = () => {
    const center = map.getCenter();
    model.center = [mapClampLat(center.lat), mapClampLng(center.lng)];
    model.zoom = map.getZoom();
    coord.textContent = mapTf("중심 {lat}, {lng} · 확대 {zoom}",
      { lat:model.center[0].toFixed(4), lng:model.center[1].toFixed(4), zoom:model.zoom });
  };
  map.on("moveend zoomend", syncView);
  syncView();

  /* ── 나머지 도구 ── */
  titleInput.addEventListener("input", () => { model.title = titleInput.value; touch(); });

  // 배경마다 더 들어갈 수 있는 확대가 다르다 — 배경을 바꿀 때도, 우클릭으로 확대할 때도 이 한계를 쓴다.
  const maxViewZoom = () => (model.basemap === "custom" ? 19 : MAP_BASEMAPS[model.basemap].maxZoom);

  basemapSelect.addEventListener("change", () => {
    model.basemap = basemapSelect.value === "custom" && model.backgroundImage
      ? "custom" : (MAP_BASEMAPS[basemapSelect.value] ? basemapSelect.value : "osm");
    // 배경마다 최대 확대가 달라, 더 얕은 지도로 바꿀 땐 확대를 먼저 낮춰야 빈 화면이 안 남는다.
    const limit = maxViewZoom();
    if (map.getZoom() > limit) map.setZoom(limit);
    applyBasemap();
    touch();
  });

  const ensureCustomOption = () => {
    let option = basemapSelect.querySelector('option[value="custom"]');
    if (model.backgroundImage && !option){
      option = document.createElement("option"); option.value = "custom"; option.textContent = "내 지도 이미지";
      basemapSelect.appendChild(option); mapTranslate(basemapSelect);
    }
    if (!model.backgroundImage && option) option.remove();
  };
  imageBtn.addEventListener("click", () => { imageInput.value = ""; imageInput.click(); });
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    imageBtn.disabled = true;
    setStatus(mapT("지도 이미지를 준비하는 중…"));
    try {
      const prepared = await mapPrepareBackgroundImage(file);
      const bounds = map.getBounds();
      model.backgroundImage = mapNormalizeBackgroundImage({
        ...prepared,
        bounds:[[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]]
      });
      if (!model.backgroundImage) throw new Error("image-output-too-large");
      model.basemap = "custom";
      noteImageChange();
      ensureCustomOption(); basemapSelect.value = "custom"; imageClearBtn.hidden = false;
      applyBasemap(); touch();
      if (typeof toast === "function") toast(mapT("현재 화면 범위에 내 지도 이미지를 넣었습니다. 인터넷 없이도 표시됩니다."), 3600);
    } catch(error){
      const message = error && error.message === "image-type"
        ? "PNG·JPG·WebP 지도 이미지를 골라 주세요."
        : error && error.message === "image-too-large"
          ? "지도 이미지는 20MB 이하로 골라 주세요."
          : "지도 이미지를 넣지 못했습니다. 더 작은 이미지를 사용해 주세요.";
      setStatus(mapT(message));
    } finally { imageBtn.disabled = false; }
  });
  imageClearBtn.addEventListener("click", async () => {
    let ok = true;
    if (typeof confirmDialog === "function") ok = await confirmDialog(mapT("이 지도 파일에 넣은 사용자 이미지를 지울까요?"));
    if (!ok) return;
    model.backgroundImage = null;
    if (model.basemap === "custom") model.basemap = "osm";
    noteImageChange();
    ensureCustomOption(); basemapSelect.value = model.basemap; imageClearBtn.hidden = true;
    applyBasemap(); touch();
  });

  /* 들여온 표시로 화면을 맞춘다. 한 곳이면 그 자리로, 여럿이면 전부 담기게. */
  const fitToMarkers = (markers) => {
    if (!markers.length) return;
    if (markers.length === 1) map.setView([markers[0].lat, markers[0].lng], Math.max(map.getZoom(), 14));
    else map.fitBounds(markers.map(marker => [marker.lat, marker.lng]), { padding:[24,24], maxZoom:15 });
  };
  /* 주소만 적힌 줄을 좌표로 바꾼다. 한 줄에 한 번씩 검색을 부르므로 시간이 걸린다 —
     진행률을 상태 줄에 적고, 그동안 'CSV 들이기' 버튼을 '그만두기'로 바꿔 멈출 수 있게 한다. */
  let geocodingStop = false;
  const runPendingGeocode = async (pending) => {
    const ok = typeof confirmDialog !== "function" || await confirmDialog(
      mapTf("주소만 있는 줄이 {count}개 있습니다. 인터넷 지도 검색으로 좌표를 찾을까요?", { count:pending.length }),
      mapT("좌표 찾기"), mapT("건너뛰기"));
    if (!ok) return null;
    geocodingStop = false;
    bulkDepth++;                       // 줄마다 되돌리기 단계를 만들지 않는다(끝난 뒤 한 단계)
    const previousLabel = csvImportBtn.textContent;
    csvImportBtn.textContent = mapT("그만두기");
    csvImportBtn.classList.add("is-on");
    csvInput.disabled = true;
    const found = [];
    try {
      const result = await mapResolvePendingMarkers(pending,
        (done, total, count) => setStatus(mapTf("주소를 좌표로 바꾸는 중… {done}/{total} · 찾음 {count}개", { done, total, count })),
        () => geocodingStop,
        (marker) => { model.markers.push(marker); addMarkerLayer(marker); touch(); });
      found.push(...result.markers);
      const parts = [mapTf("주소 {count}개를 지도에 올렸습니다", { count:result.markers.length })];
      if (result.failed.length) parts.push(mapTf("{count}개는 찾지 못했습니다", { count:result.failed.length }));
      if (result.stopped) parts.push(mapT("중간에 멈췄습니다"));
      setStatus("");
      if (typeof toast === "function") toast(parts.join(" · "), 4600);
    } catch(error){
      setStatus(mapT(error && error.message === "geocode-launcher-required"
        ? "주소를 좌표로 바꾸려면 ClassDock 런처에서 열어 주세요."
        : "주소를 좌표로 바꾸지 못했습니다 — 인터넷 연결을 확인해 주세요."));
    } finally {
      csvImportBtn.textContent = previousLabel;
      csvImportBtn.classList.remove("is-on");
      csvInput.disabled = false;
      geocodingStop = false;
      bulkDepth--;
      recordSoon();
    }
    return found;
  };

  csvImportBtn.addEventListener("click", () => {
    // 좌표를 찾는 동안에는 같은 버튼이 '그만두기'다.
    if (csvInput.disabled){ geocodingStop = true; return; }
    csvInput.value = ""; csvInput.click();
  });
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files && csvInput.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("csv-too-large");
      const imported = mapMarkersFromCsv(await file.text());
      imported.markers.forEach(marker => { model.markers.push(marker); addMarkerLayer(marker); });
      fitToMarkers(imported.markers);
      touch();
      if (imported.markers.length){
        const extra = imported.skipped || imported.truncated
          ? mapTf(" · 좌표 오류 {skipped}개 제외 · 상한 초과 {truncated}개 제외", imported) : "";
        if (typeof toast === "function") toast(mapTf("CSV에서 표시 {count}개를 추가했습니다", { count:imported.markers.length }) + extra, 4200);
      }
      if (imported.pending.length){
        const found = await runPendingGeocode(imported.pending);
        if (found && found.length && !imported.markers.length) fitToMarkers(found);
      }
    } catch(error){
      const message = error && error.message === "csv-too-large"
        ? "CSV 파일은 5MB 이하로 골라 주세요."
        : error && error.message === "csv-columns"
        ? "CSV 첫 줄에 위도·경도 열이나 주소 열이 필요합니다."
        : "CSV에서 사용할 수 있는 표시를 찾지 못했습니다.";
      setStatus(mapT(message));
    }
  });
  csvExportBtn.addEventListener("click", () => {
    if (!model.markers.length){ setStatus(mapT("내보낼 표시가 없습니다.")); return; }
    mapDownloadText(mapMarkersToCsv(model.markers), mapSafeDownloadName(model.title) + "_표시.csv", "text/csv;charset=utf-8");
    if (typeof toast === "function") toast(mapTf("표시 {count}개를 CSV로 내보냈습니다", { count:model.markers.length }), 2800);
  });

  /* ── 한꺼번에 지우기 ──
     '주변 시설'은 표시 수십 개와 반경 원을 한 번에 넣는다. 말풍선을 하나씩 열어 지우는 길밖에
     없으면 사실상 못 지우므로, 꼬리표(source·batch)로 묶음째 무는 길을 둔다. 손으로 찍은 표시는
     꼬리표가 비어 있어 '주변 시설로 넣은 것만' 에 휩쓸리지 않는다. */
  const removeTagged = (match) => {
    const markers = model.markers.filter(match);
    const shapes = (model.shapes || []).filter(match);
    for (const marker of markers) removeMarker(marker);
    for (const shape of shapes) removeShape(shape);
    return markers.length + shapes.length;
  };
  const isNearbyItem = (item) => item.source === "nearby";
  const countNearbyItems = () =>
    model.markers.filter(isNearbyItem).length + (model.shapes || []).filter(isNearbyItem).length;
  // 지운 뒤에는 touch() 가 상태줄을 '저장 안 됨' 으로 덮으므로 결과는 토스트로 알린다.
  const announceRemoved = (count) => {
    if (typeof toast === "function") toast(mapTf("{count}개를 지웠습니다", { count }), 2600);
  };

  clearItemsBtn.addEventListener("click", async () => {
    const markers = model.markers.length;
    const shapes = (model.shapes || []).length;
    if (!markers && !shapes){ setStatus(mapT("지울 표시나 도형이 없어요.")); return; }
    if (typeof confirmDialog !== "function"){ announceRemoved(removeTagged(() => true)); return; }
    const nearby = countNearbyItems();
    const message = mapTf("표시 {markers}개, 거리선·면적 {shapes}개가 있어요. 무엇을 지울까요?", { markers, shapes });
    const allText = mapTf("모두 지우기 ({count}개)", { count:markers + shapes });
    /* 주변 시설로 넣은 것이 있으면 그쪽을 기본(Enter·ok)으로 둔다 — Enter 한 번에 직접 찍은
       표시까지 날아가지 않게, 더 좁게 지우는 쪽이 언제나 기본이다. */
    if (nearby){
      const answer = await confirmDialog(message,
        mapTf("주변 시설로 넣은 것만 ({count}개)", { count:nearby }), mapT("취소"), { altText:allText });
      if (answer === "ok") announceRemoved(removeTagged(isNearbyItem));
      else if (answer === "alt") announceRemoved(removeTagged(() => true));
      return;
    }
    if (await confirmDialog(message, allText, mapT("취소"))) announceRemoved(removeTagged(() => true));
  });

  /* ── 주변 시설 ──
     카카오 카테고리 검색에만 있는 길이라(OSM 에 대응물이 없다) 카카오를 켰을 때만 내놓는다.
     꺼 둔 채로 버튼만 보이면 눌러도 안 되는 단추가 되기 때문이다. */
  mapProviderIsKakao().then((kakao) => { nearbyBtn.hidden = !kakao; }).catch(() => {});
  /* 도구막대는 화면 가운데를, 우클릭 메뉴는 누른 자리를 기준으로 부른다 — 기준점만 다르고 찾아
     넣는 길은 하나다(꼬리표·되돌리기·토스트가 두 갈래로 갈라지지 않게). */
  const runNearby = async (at, opts = {}) => {
    const center = { lat:mapClampLat(at.lat), lng:mapClampLng(at.lng) };
    const picked = await openMapNearby(center, opts);
    if (!picked) return;
    // 이번에 들어오는 것들을 한 묶음으로 묶는다 — 되돌리기가 딱 이 묶음만 도로 빼낼 수 있게.
    const batch = mapBatchId();
    const added = [];
    for (const place of picked.places){
      const marker = mapNormalizeMarker({
        lat:place.lat, lng:place.lng, color:picked.category.color,
        label:place.name,
        // 주소와 거리는 수업에서 그대로 읽는 값이라 메모에 남긴다.
        note:[place.address, place.distance ? mapTf("중심에서 {distance}", { distance:mapFormatDistance(place.distance) }) : ""]
          .filter(Boolean).join("\n"),
        source:"nearby", batch
      });
      model.markers.push(marker);
      addMarkerLayer(marker);
      added.push(marker);
    }
    if (picked.circle){
      const shape = mapNormalizeShape({
        type:"area",
        points:mapCirclePoints(center.lat, center.lng, picked.radius),
        label:mapT(picked.category.label) + " " + mapFormatDistance(picked.radius),
        color:"#2563eb",
        source:"nearby", batch
      });
      model.shapes.push(shape);
      addShapeLayer(shape);
    }
    touch();
    fitToMarkers(added);
    if (typeof toast === "function"){
      toast(mapTf("{label} {count}곳을 반경 {radius} 안에서 찾아 넣었습니다",
        { label:mapT(picked.category.label), count:added.length, radius:mapFormatDistance(picked.radius) }),
      6000, { action:{ label:mapT("되돌리기"), onClick:() => {
        removeTagged(item => item.batch === batch);
        if (typeof toast === "function") toast(mapT("방금 넣은 주변 시설을 도로 뺐습니다"), 2600);
      } } });
    }
  };
  nearbyBtn.addEventListener("click", () => runNearby(map.getCenter()));

  /* ── 클릭한 자리 안내 ──
     읽기만 하는 말풍선이라 문서를 건드리지 않는다. 남기고 싶을 때만 '표시로 넣기'로 지도에
     들어간다 — 그래야 눌러 본 자리마다 표시가 쌓이지 않는다. */
  let spotBusy = false;
  const spotLine = (className, text) => {
    if (!text) return null;
    const line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    return line;
  };
  function buildSpotPopup(spot){
    const box = document.createElement("div");
    box.className = "map-spot";
    const name = spot.title || spot.road || spot.address;
    const title = document.createElement("h4");
    title.className = "map-spot-title";
    title.textContent = name;
    box.appendChild(title);
    // 제목으로 이미 쓴 줄은 다시 적지 않는다(이름 없는 자리에서는 주소가 곧 제목이다).
    for (const line of [
      spotLine("map-spot-kind", spot.category),
      spotLine("map-spot-road", spot.road !== name ? spot.road : ""),
      spotLine("map-spot-lot", spot.address !== name ? spot.address : ""),
      spotLine("map-spot-phone", spot.phone ? "☎ " + spot.phone : "")
    ]) if (line) box.appendChild(line);

    const actions = document.createElement("div");
    actions.className = "map-spot-actions";
    const pinBtn = document.createElement("button");
    pinBtn.type = "button"; pinBtn.className = "map-spot-btn";
    pinBtn.textContent = "📍 표시로 넣기";
    pinBtn.title = "이 자리를 이름과 주소가 담긴 표시로 지도에 남겨요";
    pinBtn.addEventListener("click", () => {
      map.closePopup();
      const marker = mapNormalizeMarker({
        lat:spot.lat, lng:spot.lng, color:"red", label:name,
        // 수업에서 그대로 읽는 값들이라 메모에 담아 둔다(주소 자동 채우기와 같은 자리).
        note:[spot.category, spot.road, spot.address, spot.phone].filter(Boolean).join("\n")
      });
      model.markers.push(marker);
      addMarkerLayer(marker).openPopup();
      touch();
    });
    const copyBtn = document.createElement("button");
    copyBtn.type = "button"; copyBtn.className = "map-spot-btn";
    copyBtn.textContent = "📋 주소 복사";
    copyBtn.title = "이 자리의 주소를 클립보드로 복사";
    copyBtn.addEventListener("click", async () => {
      const text = spot.road || spot.address || name;
      const copied = await mapCopyText(text);
      if (typeof toast === "function"){
        toast(copied ? mapTf("주소를 복사했어요 — {text}", { text }) : mapT("주소를 복사하지 못했어요."), 3000);
      }
    });
    const nearBtn = document.createElement("button");
    nearBtn.type = "button"; nearBtn.className = "map-spot-btn";
    nearBtn.textContent = "🏫 주변 시설";
    nearBtn.title = "이 자리를 가운데로 삼아 반경 안의 시설을 찾아요";
    nearBtn.hidden = nearbyBtn.hidden;      // 도구막대와 같다 — 카카오를 껐으면 눌러도 안 되는 항목이다
    nearBtn.addEventListener("click", () => {
      map.closePopup();
      runNearby({ lat:spot.lat, lng:spot.lng }, { atPoint:true });
    });
    actions.append(pinBtn, copyBtn, nearBtn);
    box.appendChild(actions);
    mapTranslate(box);
    return box;
  }
  async function showSpotInfo(latlng){
    // 답을 기다리는 사이의 클릭은 흘린다 — 지도를 몇 번 누르는 동안 검색이 겹겹이 나가지 않게.
    if (spotBusy) return;
    /* 멀리서 누른 자리는 몇 백 미터를 가리킨다. 그 자리의 주소를 돌려줘도 누른 건물의 것이 아니라
       가르치는 자리에서 오히려 헷갈린다 — 찾지 않고 까닭을 알려 준다. */
    if (map.getZoom() < MAP_SPOT_MIN_ZOOM){
      // 얼마나 더 확대해야 하는지 숫자로 말해 준다 — 도구막대의 '확대 N' 과 같은 눈금이다.
      setStatus(mapTf("조금 더 확대하면 누른 자리가 어디인지 볼 수 있어요 — 지금 확대 {zoom}, {need}단계부터",
        { zoom:map.getZoom(), need:MAP_SPOT_MIN_ZOOM }));
      return;
    }
    spotBusy = true;
    setStatus(mapT("장소를 찾는 중…"));
    try {
      const spot = await mapSpotAt(latlng.lat, latlng.lng);
      if (!spot){ setStatus(mapT("이 자리가 어디인지 찾지 못했어요.")); return; }
      L.popup({ className:"map-spot-popup", minWidth:210, autoPan:false })
        .setLatLng([spot.lat, spot.lng])
        .setContent(buildSpotPopup(spot))
        .openOn(map);
      touch();      // 잠시 덮어 뒀던 '저장 안 됨' 표시를 제자리로 돌린다(문서는 건드리지 않는다)
    } catch(error){
      setStatus(mapT(error && error.message === "geocode-launcher-required"
        ? "클릭한 자리 안내는 ClassDock 런처에서 사용할 수 있어요."
        : "장소를 확인하지 못했어요 — 인터넷 연결을 확인해 주세요."));
    } finally { spotBusy = false; }
  }

  /* ── 지도 우클릭 빠른 메뉴 ──
     도구막대는 그대로 두고 통로만 하나 더 낸다. 여기서만 할 수 있는 일은 "누른 자리"를 아는
     것이다 — 도구막대의 표시 추가는 모드를 켜고 한 번 더 클릭해야 하고, 주변 시설은 언제나
     화면 가운데를 기준으로 삼는다. 실행은 도구막대와 같은 함수를 부르므로 되돌리기 기록과
     '저장 안 됨' 표시가 두 갈래로 갈라지지 않는다. */
  const contextMenu = document.createElement("div");
  contextMenu.className = "map-context-menu";
  contextMenu.hidden = true;
  contextMenu.setAttribute("role", "menu");
  contextMenu.setAttribute("aria-label", "지도 빠른 메뉴");
  const contextHead = document.createElement("div");
  contextHead.className = "map-context-head";
  contextMenu.appendChild(contextHead);
  let contextLatLng = null;

  function closeContextMenu(){
    if (contextMenu.hidden) return;
    // 키보드로 항목을 고르던 중이면 포커스를 지도로 돌려준다(감춘 버튼에 갇히지 않게).
    if (contextMenu.contains(document.activeElement)){
      const container = map.getContainer();
      if (container && typeof container.focus === "function") container.focus({ preventScroll:true });
    }
    contextMenu.hidden = true;
    contextLatLng = null;
    document.removeEventListener("pointerdown", onContextOutside, true);
    window.removeEventListener("keydown", onContextKey, true);
    map.off("movestart zoomstart", closeContextMenu);
  }
  function onContextOutside(e){
    if (contextMenu.contains(e.target)) return;
    closeContextMenu();
  }
  /* Esc 는 표시 추가 취소·도형 삭제·검색 표식 지우기가 이미 나눠 쓰고 있다. 메뉴가 떠 있는
     동안에는 메뉴 닫기가 먼저라, 잡아서 다른 곳으로 넘기지 않는다. */
  function onContextKey(e){
    if (e.key === "Escape"){
      e.preventDefault(); e.stopImmediatePropagation();
      closeContextMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...contextMenu.querySelectorAll("button")].filter(button => !button.hidden && !button.disabled);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : (Math.max(0, at) + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll:true });
  }

  const contextItem = (label, title, run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    if (title) button.title = title;
    // 자리를 먼저 손에 쥐고 메뉴를 닫는다 — 닫으면서 contextLatLng 을 비우기 때문이다.
    button.addEventListener("click", () => {
      const at = contextLatLng;
      closeContextMenu();
      if (at) run(at);
    });
    contextMenu.appendChild(button);
    return button;
  };
  const contextSep = () => {
    const sep = document.createElement("div");
    sep.className = "map-context-sep";
    sep.setAttribute("role", "separator");
    contextMenu.appendChild(sep);
  };

  contextItem("📍 여기에 표시 추가", "누른 자리에 표시를 바로 만들어요", (at) => {
    const marker = mapNormalizeMarker({ lat:at.lat, lng:at.lng, label:"", color:"red" });
    model.markers.push(marker);
    const layer = addMarkerLayer(marker);
    touch();
    layer.openPopup();
    // 지도를 눌러 찍을 때와 같다 — 표시부터 남기고 이름은 주소가 도착하는 대로 채운다.
    if (autoAddress) fillMarkerAddress(marker, { onlyEmpty:true, quiet:true });
  });
  const contextNearbyBtn = contextItem("🏫 여기를 중심으로 주변 시설",
    "누른 자리를 가운데로 삼아 반경 안의 학교·병원 같은 시설을 찾아요",
    (at) => runNearby(at, { atPoint:true }));

  contextSep();
  contextItem("📋 이 자리 좌표 복사", "위도, 경도를 클립보드로 복사", async (at) => {
    const text = at.lat.toFixed(6) + ", " + at.lng.toFixed(6);
    const copied = await mapCopyText(text);
    if (typeof toast === "function"){
      toast(copied ? mapTf("좌표를 복사했어요 — {text}", { text }) : mapT("좌표를 복사하지 못했어요."), 2600);
    }
  });
  contextItem("📮 이 자리 주소 복사", "이 지점의 주소를 찾아 클립보드로 복사", async (at) => {
    setStatus(mapT("주소를 찾는 중…"));
    try {
      const info = await mapAddressAt(at.lat, at.lng);
      if (!info || !info.name){ setStatus(mapT("이 자리의 주소를 찾지 못했어요.")); return; }
      const copied = await mapCopyText(info.name);
      touch();          // 잠시 덮어 뒀던 '저장 안 됨' 표시를 제자리로 돌린다
      if (typeof toast === "function"){
        toast(copied ? mapTf("주소를 복사했어요 — {text}", { text:info.name }) : mapT("주소를 복사하지 못했어요."), 3000);
      }
    } catch(error){
      setStatus(mapT(error && error.message === "geocode-launcher-required"
        ? "주소 확인은 ClassDock 런처에서 사용할 수 있어요."
        : "주소를 확인하지 못했어요 — 인터넷 연결을 확인해 주세요."));
    }
  });

  contextSep();
  contextItem("🎯 여기를 가운데로", "누른 자리를 지도 한가운데로 옮겨요", (at) => map.panTo(at));
  const contextZoomBtn = contextItem("🔍 여기로 확대", "누른 자리를 가운데에 두고 한 단계 확대해요",
    (at) => map.setView(at, Math.min(map.getZoom() + 1, maxViewZoom())));

  /* 도구막대 단추를 그대로 비추는 항목. 이름·설명·꺼짐·숨김·켜짐을 열 때마다 그 단추에서 읽어
     오고, 누르면 그 단추를 누른다. 메뉴가 상태를 따로 들지 않으니 어긋날 길이 없다 — 좌표를
     찾는 동안 'CSV 들이기'가 '그만두기'로 바뀌는 것도, 되돌릴 게 없어 꺼진 되돌리기도 저절로
     따라온다. 되돌리기 기록도 도구막대와 같은 함수를 타므로 한 갈래로 남는다. */
  const contextMirrors = [];
  const contextMirror = (button, label) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    // 화살표 하나뿐인 단추(↶ ↷)는 메뉴에서 읽히지 않으므로 이름을 따로 준다.
    if (label) item.textContent = label;
    item.addEventListener("click", () => { closeContextMenu(); button.click(); });
    contextMenu.appendChild(item);
    contextMirrors.push({ item, button, fixedLabel:!!label });
    return item;
  };
  const syncContextMirrors = () => {
    for (const mirror of contextMirrors){
      if (!mirror.fixedLabel) mirror.item.textContent = mirror.button.textContent;
      mirror.item.title = mirror.button.title || "";
      mirror.item.hidden = !!mirror.button.hidden;
      mirror.item.disabled = !!mirror.button.disabled;
      // 켜 둔 도구(주소 자동 등)는 도구막대처럼 눈에 띄게 — 메뉴에서는 체크로 보인다.
      mirror.item.classList.toggle("is-on", mirror.button.classList.contains("is-on"));
    }
  };

  contextSep();
  contextMirror(lineBtn);
  contextMirror(areaBtn);
  contextMirror(addressBtn);
  contextMirror(spotBtn);

  contextSep();
  contextMirror(clearItemsBtn);
  contextMirror(regionBtn);
  contextMirror(boardBtn);
  contextMirror(memoBtn);

  contextSep();
  contextMirror(undoBtn, "↶ 되돌리기 (Ctrl+Z)");
  contextMirror(redoBtn, "↷ 다시 실행 (Ctrl+Shift+Z)");
  contextMirror(saveBtn);

  map.on("contextmenu", (e) => {
    /* 마커·도형에서 올라온 우클릭은 각자의 메뉴가 붙을 자리라 여기서 가로채지 않는다. */
    if (e.propagatedFrom) return;
    /* 표시를 찍거나 선을 그리는 중에는 왼쪽 클릭이 하던 일이 이어져야 한다 — 메뉴로 끊지 않는다.
       (그리는 중 우클릭에 완료·마지막 점 취소를 붙이는 것은 다음 단계 몫이다.) */
    if (adding || drawingMode) return;
    const origin = e.originalEvent || {};
    contextLatLng = L.latLng(mapClampLat(e.latlng.lat), mapClampLng(e.latlng.lng));
    contextHead.textContent = contextLatLng.lat.toFixed(5) + ", " + contextLatLng.lng.toFixed(5);
    // 카카오 검색을 껐으면 주변 시설은 눌러도 안 되는 항목이다 — 도구막대와 똑같이 감춘다.
    contextNearbyBtn.hidden = nearbyBtn.hidden;
    contextZoomBtn.disabled = map.getZoom() >= maxViewZoom();
    syncContextMirrors();
    contextMenu.hidden = false;
    // 화면 밖으로 넘치지 않게 보정(탭 우클릭 메뉴와 같은 방식).
    const pad = 8;
    const width = contextMenu.offsetWidth, height = contextMenu.offsetHeight;
    const x = Number(origin.clientX) || 0, y = Number(origin.clientY) || 0;
    contextMenu.style.left = Math.max(pad, Math.min(x, window.innerWidth - width - pad)) + "px";
    contextMenu.style.top = Math.max(pad, Math.min(y, window.innerHeight - height - pad)) + "px";
    const first = contextMenu.querySelector("button:not([hidden])");
    if (first) first.focus({ preventScroll:true });
    document.addEventListener("pointerdown", onContextOutside, true);
    window.addEventListener("keydown", onContextKey, true);
    map.on("movestart zoomstart", closeContextMenu);
  });
  /* 확대·축소 버튼 위 우클릭은 브라우저 기본 메뉴만 막는다. Leaflet 이 컨트롤에서 전파를 끊어
     두므로 지도 메뉴는 어차피 열리지 않는데, 아무것도 안 하면 그 자리에서 크롬 메뉴가 튀어나와
     수업 중에 당황스럽다. 끊기는 것은 거슬러 오르는 길뿐이라 내려가는 길(캡처)에서 잡는다.
     오른쪽 아래 저작권 줄은 링크라서 그대로 둔다 — 거기서는 주소 복사가 쓸모 있다. */
  stage.addEventListener("contextmenu", (e) => {
    const target = e.target;
    if (target && typeof target.closest === "function" && target.closest(".leaflet-control-zoom")) e.preventDefault();
  }, true);
  document.body.appendChild(contextMenu);
  // 도구막대와 같이 한 번만 훑는다 — 언어를 바꾸면 i18n 이 매어 둔 문구를 알아서 다시 그린다.
  mapTranslate(contextMenu);

  const moveToSearchLocation = mapSearchLocationMover(map);
  mapAttachPlaceSearch(gotoInput, searchBtn, searchResults, (lat, lng, zoom, label) => {
    moveToSearchLocation(lat, lng, zoom, label);
    // 이제 표식이 계속 남으므로, 지우는 법을 한 줄로 알려 준다.
    if (label) setStatus(mapT("찾은 곳을 빨간 점으로 표시했어요 (Esc 로 지우기)"));
  }, setStatus);
  /* 검색 표식은 지도를 눌러도 남으므로 Esc 로 지운다. 표시 추가·그리기·영역 선택 중이면 Esc 는
     원래 하던 일(취소·삭제)이 먼저다 — onSelectedShapeKey 가 먼저 등록돼 있어 그쪽이 preventDefault
     한 Esc 는 여기서 건너뛴다. */
  function onSearchLocationKey(e){
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (adding || drawingMode || selectedShape) return;
    if (doc.el && doc.el.hidden) return;
    if (!moveToSearchLocation.clear()) return;
    e.preventDefault();
  }
  window.addEventListener("keydown", onSearchLocationKey);

  saveBtn.addEventListener("click", async () => { await saveMapDoc(doc); touch(); });

  /* ── 칠판으로 ──
     지도를 그림으로 굳혀 새 화이트보드에 올린다. 지도 문서 자체는 그대로 남으므로, 판서한
     칠판과 계속 고칠 수 있는 지도를 둘 다 갖게 된다. */
  /* 새 칠판을 하나 열고 그릴 준비가 될 때까지 기다린다(지도 그림·지역 차트가 같이 쓴다).
     빈 스냅샷을 "지금" 시각으로 넘겨, 같은 이름으로 쓰던 옛 판서가 되살아나지 않게 한다
     (chooseBoardSnapshot 은 savedAt 이 더 새 쪽을 고른다). */
  const createMapBoard = async (name) => {
    if (typeof newWhiteboard !== "function") return null;
    const boardDoc = newWhiteboard({
      name,
      state: {
        version: 1,
        savedAt: Date.now(),
        bg: typeof defaultBoardBg === "function" ? defaultBoardBg() : "#ffffff",
        items: []
      }
    });
    if (typeof setActiveDoc === "function") setActiveDoc(boardDoc.id);
    // 렌더가 끝나야 insertBoardImage·insertBoardChart 가 붙는다(훅은 renderWhiteboard 안에서 매단다).
    if (typeof ensureRendered === "function") await ensureRendered(boardDoc);
    return boardDoc;
  };

  /* 지금 보이는 지도를 PNG data URL 로 굳힌다(칠판·메모가 함께 쓴다).
     말풍선과 그리던 선을 먼저 정리하고 타일이 다 뜨기를 기다린 뒤, 표시·도형의 이름을 지도 칸
     좌표로 바꿔 넘긴다 — 화면 말풍선은 캡처에서 감추므로 그림에 직접 새겨야 남는다. */
  const captureMapPng = async () => {
    map.closePopup();
    setAdding(false);
    if (drawingMode) finishDrawing(false);
    await waitForTiles(8000);
    const labels = model.markers.filter(m => m.label).map((m) => {
      const point = map.latLngToContainerPoint([m.lat, m.lng]);
      return { x:point.x, y:point.y, text:m.label };
    });
    for (const shape of model.shapes){
      if (!shape.points.length) continue;
      const center = shape.points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0,0])
        .map(value => value / shape.points.length);
      const point = map.latLngToContainerPoint(center);
      labels.push({ x:point.x, y:point.y, text:shapeTooltip(shape), offsetY:0 });
    }
    return mapCaptureDataUrl(stage, mapAttributionText(model), labels);
  };

  /* ── 지역 통계 ── */
  regionBtn.addEventListener("click", () => {
    openMapRegionStats(model, {
      touch,
      toChart: async (rows, level) => {
        const boardDoc = await createMapBoard(mapBoardName(model, "지역 통계"));
        if (!boardDoc || typeof boardDoc.insertBoardChart !== "function") return false;
        const title = (String(model.title || "").trim() || mapT("지도")) + " · "
          + mapT(level === "region" ? "시도별 표시 수" : "시군구별 표시 수");
        return boardDoc.insertBoardChart({
          type: "bar",
          title,
          rows: rows.map(row => ({ label:row.label, values:[row.count] }))
        });
      }
    });
  });

  boardBtn.addEventListener("click", async () => {
    if (typeof newWhiteboard !== "function"){ setStatus(mapT("화이트보드를 열 수 없어요.")); return; }
    boardBtn.disabled = true;
    setStatus(mapT("지도를 칠판으로 옮기는 중…"));
    try {
      const png = await captureMapPng();
      const boardDoc = await createMapBoard(mapBoardName(model));
      const placed = boardDoc && typeof boardDoc.insertBoardImage === "function"
        ? await boardDoc.insertBoardImage(png) : false;
      if (placed){
        touch();
        if (typeof toast === "function") toast(mapT("지도를 칠판으로 옮겼어요 — 그 위에 바로 판서할 수 있어요."), 3200);
      } else setStatus(mapT("칠판에 지도를 넣지 못했어요."));
    } catch(error){
      console.warn("map board capture failed:", error);
      setStatus(mapT("지도를 그림으로 굳히지 못했어요 — 배경지도가 다 뜬 뒤에 다시 눌러 주세요."));
    } finally { boardBtn.disabled = false; }
  });

  /* ── 메모로 ──
     보이는 그림(PNG)과 편집용 스냅샷(.map 과 같은 JSON)을 메모 블록 하나에 묶어 보낸다.
     메모의 "✏️ 지도로"가 그 스냅샷으로 지도를 되살리고, 고친 뒤 다시 "메모로"를 누르면
     doc.memoBlockId 덕에 새 블록이 아니라 그 블록이 제자리에서 바뀐다(화이트보드와 같은 규약). */
  memoBtn.addEventListener("click", async () => {
    if (typeof window.addMapToScratchpad !== "function"){ setStatus(mapT("메모창을 열 수 없어요.")); return; }
    memoBtn.disabled = true;
    setStatus(mapT("지도를 메모로 보내는 중…"));
    try {
      const png = await captureMapPng();
      const blob = await mapDataUrlToBlob(png);
      if (!blob){ setStatus(mapT("메모에 지도를 넣지 못했어요.")); return; }
      const title = String(model.title || "").trim() || mapT("지도");
      const result = await window.addMapToScratchpad(blob, JSON.parse(mapDocSerialize(model)), {
        name: mapSafeDownloadName(title) + ".png",
        boardName: title,
        blockId: doc.memoBlockId          // 있으면 그 블록을 제자리에서 교체
      });
      if (result && result.blockId){
        doc.memoBlockId = result.blockId;
        // 이 고리는 탭 상태에 함께 저장된다 — 다시 실행한 뒤에도 같은 블록으로 돌아가게.
        if (typeof persistTabState === "function") persistTabState();
        touch();                          // 잠시 덮어 뒀던 '저장 안 됨' 표시를 제자리로 돌린다
        if (result.snapshotDropped && typeof toast === "function"){
          toast(mapT("지도가 너무 커서 그림만 넣었어요 — 메모에서 다시 지도로 열 수는 없어요."), 3800);
        } else if (typeof toast === "function"){
          toast(mapT("지도를 메모로 보냈어요 — 메모에서 '✏️ 지도로'를 누르면 다시 편집할 수 있어요."), 3200);
        }
      } else touch();                     // 메모창이 이미 구체적인 사유를 알렸다(용량·잠금 등)
    } catch(error){
      console.warn("map memo capture failed:", error);
      setStatus(mapT("지도를 그림으로 굳히지 못했어요 — 배경지도가 다 뜬 뒤에 다시 눌러 주세요."));
    } finally { memoBtn.disabled = false; }
  });

  /* ── 되돌리기 / 다시 실행 ──
     스냅샷은 "저장되는 내용"과 같은 범위다 — 제목·배경지도·표시·도형·배경 이미지(버전 번호).
     보고 있는 자리(중심·확대)는 일부러 뺐다. 지도를 조금 움직인 것이 되돌릴 '편집'으로 쌓이면
     정작 표시를 지운 단계가 뒤로 밀려나기 때문이다(저장 안 됨 판정과 같은 기준). */
  const syncHistoryButtons = () => {
    undoBtn.disabled = !history || !history.canUndo();
    redoBtn.disabled = !history || !history.canRedo();
  };
  if (typeof MNEditHistory === "object" && MNEditHistory && typeof MNEditHistory.create === "function"){
    history = MNEditHistory.create({
      limit: MNEditHistory.LIMITS.board,
      // CSV 로 표시 수천 개를 들여오면 한 단계가 1MB 를 넘는다. 단계 수와 별개로 총량도 막는다.
      sizeOf: (snapshot) => snapshot.length,
      maxBytes: 24 * 1024 * 1024,
      capture: () => JSON.stringify([model.title || "", model.basemap, model.markers, model.shapes || [], imageVersion]),
      apply: (snapshot) => {
        const saved = JSON.parse(snapshot);
        // 반쯤 찍던 선이나 열려 있던 말풍선은 되돌리기와 함께 정리한다.
        if (adding) setAdding(false);
        if (drawingMode) finishDrawing(false);
        map.closePopup();
        selectedShape = null;
        model.title = saved[0];
        model.basemap = saved[1];
        model.markers = saved[2].map(mapNormalizeMarker);
        model.shapes = saved[3].map(mapNormalizeShape);
        imageVersion = saved[4];
        model.backgroundImage = imageVersions.get(imageVersion) || null;
        for (const layer of markerLayers.values()) map.removeLayer(layer);
        markerLayers.clear();
        model.markers.forEach(addMarkerLayer);
        for (const layer of shapeLayers.values()) map.removeLayer(layer);
        shapeLayers.clear();
        model.shapes.forEach(addShapeLayer);
        titleInput.value = model.title;
        ensureCustomOption();
        basemapSelect.value = model.basemap;
        imageClearBtn.hidden = !model.backgroundImage;
        applyBasemap();
        touch();
      },
      isEqual: (a, b) => a === b,
      onChange: syncHistoryButtons
    });
    history.reset();
  }
  syncHistoryButtons();
  undoBtn.addEventListener("click", () => { if (history) history.undo(); });
  redoBtn.addEventListener("click", () => { if (history) history.redo(); });
  /* 이름 칸이나 말풍선 입력 안에서는 브라우저의 글자 되돌리기를 그대로 둔다 — 한 글자 고치려다
     지도 전체가 이전 단계로 돌아가면 놀란다. */
  function onHistoryKey(e){
    if (!history || e.defaultPrevented) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (doc.el && doc.el.hidden) return;
    const target = e.target;
    if (target && typeof target.closest === "function" &&
        target.closest("input,textarea,select,[contenteditable='true']")) return;
    const key = String(e.key || "").toLowerCase();
    if (key === "z"){
      e.preventDefault();
      if (e.shiftKey) history.redo(); else history.undo();
    } else if (key === "y"){
      e.preventDefault();
      history.redo();
    }
  }
  window.addEventListener("keydown", onHistoryKey);

  /* ── 탭을 다시 열었을 때 ──
     문서는 el.hidden 으로 감췄다 보여주는데, 숨은 동안 지도 칸은 0×0 이 된다. render() 는 처음
     한 번만 불리므로(ensureRendered) 크기 회복은 여기서 스스로 감지해야 한다. */
  let mapResizeObserver = null;
  if (typeof ResizeObserver !== "undefined"){
    mapResizeObserver = new ResizeObserver(() => {
      if (stage.clientWidth > 0 && stage.clientHeight > 0) map.invalidateSize();
      // 다른 탭으로 넘어가면 지도 칸이 0×0 이 된다 — 몸통 위에 떠 있는 메뉴만 남지 않게 접는다.
      else closeContextMenu();
    });
    mapResizeObserver.observe(stage);
  }

  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    window.removeEventListener("keydown", onInteractionKey);
    window.removeEventListener("keydown", onSelectedShapeKey);
    window.removeEventListener("keydown", onSearchLocationKey);
    window.removeEventListener("keydown", onHistoryKey);
    closeContextMenu();                 // 열려 있던 우클릭 메뉴의 document 리스너까지 함께 뗀다
    contextMenu.remove();
    if (history) history.cancel();      // 묶는 중이던 변경을 버린다(사라진 화면을 capture 하지 않게)
    cleanupNetworkNotice();
    if (mapResizeObserver) mapResizeObserver.disconnect();
    try { map.remove(); } catch(_){}
    doc.mapInstance = null;
  });

  touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    MAP_DOC_TYPE, MAP_DOC_VERSION, MAP_BASEMAPS, MAP_MARKER_COLORS,
    MAP_KAKAO_CATEGORIES, MAP_REGION_UNKNOWN, MAP_GEOCODE_BATCH_MAX,
    mapDocEmpty, mapDocParse, mapDocSerialize, mapDocContentKey,
    mapNormalizeMarker, mapNormalizeShape, mapNormalizeBackgroundImage,
    mapClampLat, mapClampLng, mapScratchFileName, mapDocDefaultTitle,
    mapDistanceMeters, mapLineLengthMeters, mapPolygonAreaSquareMeters,
    mapMarkersFromCsv, mapMarkersToCsv,
    mapKakaoAddressInfo, mapKakaoRegionInfo, mapOsmReverseInfo, mapKakaoCategoryPlaces,
    mapCirclePoints, mapShapeLabelAnchor, mapRegionNameOf, mapRegionTally
  };
}
