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

// 프록시로 받던 타일이 계속 실패하면(옛 exe 등) 조용히 직접 주소로 되돌린다.
const MAP_PROXY_FAIL_LIMIT = 6;
// 남한 전체가 한 화면에 들어오는 자리 — 새 지도의 기본값.
const MAP_DEFAULT_CENTER = [36.35, 127.85];
const MAP_DEFAULT_ZOOM = 7;

let _mapScratchCount = 0;

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
    district: String(value.district == null ? "" : value.district).slice(0, 40)
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
    color: /^#[0-9a-f]{6}$/i.test(String(value.color || "")) ? String(value.color).toLowerCase() : (type === "area" ? "#16a34a" : "#2563eb")
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
    name, road, address: lot,
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
  return { name, road:String(address.road || "").trim(), address:String(raw.display_name || "").trim(), region, district };
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
/* 반경 안의 한 갈래를 모아 온다. 카카오는 한 번에 15개씩 주므로 끝(meta.is_end)이 나오거나
   상한에 닿을 때까지만 이어서 부른다 — 도심 한복판에서 수백 개를 긁어 오지 않게. */
async function mapNearbyPlaces(code, lat, lng, radius){
  const proxyBase = await mapTileProxyBase();
  if (!proxyBase) throw new Error("geocode-launcher-required");
  if (!await mapProviderIsKakao()) throw new Error("kakao-required");
  const spot = { x:Number(lng).toFixed(6), y:Number(lat).toFixed(6), radius:String(Math.round(radius)), category:code };
  const places = [];
  for (let page = 1; page <= MAP_NEARBY_MAX_PAGES; page++){
    const raw = await mapFetchGeocode("", "kakao-category", { ...spot, page:String(page) });
    places.push(...mapKakaoCategoryPlaces(raw));
    if (!raw || !raw.meta || raw.meta.is_end !== false) break;
  }
  return places;
}
// 반경을 눈에 보이게 하는 원. 지도 모델에는 원이 없으므로 면적 영역(다각형)으로 만든다 —
// 이미 있는 넓이 계산·이름표·되돌리기를 그대로 타고, 반경 1km 원의 넓이까지 화면에 나온다.
function mapCirclePoints(lat, lng, radiusMeters, steps){
  const count = Math.max(12, Math.min(180, Math.round(steps || 60)));
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
  return (lat, lng, zoom, label) => {
    map.setView([lat, lng], Math.max(map.getZoom(), zoom));
    if (!marker){
      marker = L.circleMarker([lat, lng], {
        pane:paneName, radius:8, color:"#fff", weight:3,
        fillColor:"#e11d48", fillOpacity:1, interactive:false
      }).addTo(map);
    } else marker.setLatLng([lat, lng]);
    marker.unbindTooltip();
    if (label) marker.bindTooltip(String(label), { pane:paneName, direction:"top", offset:[0,-8], opacity:.96 }).openTooltip();
  };
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
   지도 문서와 지도 고르기 창이 같은 것을 쓴다. 좌표처럼 생기면 곧장 옮기고, 아니면 이름으로 찾아
   결과를 목록으로 띄운다. setNote 로 진행·오류를 알리고, 찾은 첫 결과와 고른 후보는
   onMove(lat, lng, zoom, label) 로 위치를 바로 보여 준다. */
function mapAttachPlaceSearch(input, button, results, onMove, setNote){
  let items = [];
  let searching = false;
  const closeResults = () => { results.innerHTML = ""; results.hidden = true; items = []; };
  const showResults = (places) => {
    results.innerHTML = "";
    items = places.slice(0, 5);
    for (const place of items){
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-result";
      button.textContent = place.name;
      button.title = place.name;
      button.addEventListener("click", () => {
        closeResults();
        input.value = "";
        onMove(place.lat, place.lng, 15, place.name);
      });
      results.appendChild(button);
    }
    results.hidden = !items.length;
    // 정확한 주소처럼 후보가 하나뿐인 검색뿐 아니라 여러 후보가 있을 때도 첫 결과를 즉시 보여 준다.
    // 목록은 그대로 남겨 사용자가 다른 후보를 고를 수 있게 한다.
    if (items.length) onMove(items[0].lat, items[0].lng, 15, items[0].name);
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
      setNote("");
      showResults(places);
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
      e.preventDefault(); e.stopPropagation();
      closeResults();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault(); e.stopPropagation();
    search();
  });
  button.addEventListener("click", () => {
    // 버튼을 누르며 입력칸이 blur 되어도 결과가 뜨자마자 닫히지 않게 검색 포커스를 돌려준다.
    input.focus();
    search();
  });
  // 바깥을 누르면 목록을 닫는다(지도를 조작하려던 클릭이 목록에 막히지 않게).
  input.addEventListener("blur", (e) => {
    // 입력칸 → 검색 버튼 이동은 바깥 클릭이 아니다. click 핸들러가 포커스를 되돌린다.
    if (e.relatedTarget === button) return;
    setTimeout(closeResults, 150);
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
function openMapNearby(center){
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal map-nearby-modal";
    modal.innerHTML =
      '<div class="modal-card map-nearby-card">' +
        '<h3>주변 시설 찾기</h3>' +
        '<p class="sub">지금 보고 있는 지도 가운데를 기준으로 반경 안의 시설을 찾아 표시로 넣습니다.</p>' +
        '<div class="map-nearby-row">' +
          '<label class="map-nearby-field"><span>갈래</span><select class="map-select map-nearby-category"></select></label>' +
          '<label class="map-nearby-field"><span>반경</span><select class="map-select map-nearby-radius"></select></label>' +
          '<label class="map-nearby-check"><input type="checkbox" class="map-nearby-circle" checked><span>반경 원도 그리기</span></label>' +
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
      const category = MAP_KAKAO_CATEGORIES.find(item => item.code === categorySelect.value) || MAP_KAKAO_CATEGORIES[0];
      const radius = Number(radiusSelect.value) || 1000;
      note.textContent = mapT("찾는 중…");
      try {
        const places = await mapNearbyPlaces(category.code, center.lat, center.lng, radius);
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

  bar.append(titleInput, basemapSelect, addBtn, addressBtn, lineBtn, areaBtn, nearbyBtn, regionBtn,
    imageBtn, imageClearBtn, csvImportBtn, csvExportBtn, boardBtn, searchWrap, saveBtn, coord, status);

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

  /* ── 저장 안 됨(●) 표시 ── */
  const touch = () => {
    const dirty = mapDocContentKey(model) !== doc.savedContentKey;
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
    setStatus(dirty ? "● " + mapT("저장 안 됨") : "");
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
  const applyMarkerLabel = (marker, text) => {
    marker.label = String(text || "").slice(0, 120);
    const layer = markerLayers.get(marker.id);
    if (layer){
      layer.setTooltipContent(marker.label || mapT("이름 없는 표시"));
      const popup = typeof layer.getPopup === "function" ? layer.getPopup() : null;
      const form = popup && typeof popup.getContent === "function" ? popup.getContent() : null;
      if (form && form._labelInput) form._labelInput.value = marker.label;
    }
    touch();
  };
  const fillMarkerAddress = async (marker, opts = {}) => {
    try {
      const info = await mapAddressAt(marker.lat, marker.lng);
      if (!markerLayers.has(marker.id)) return false;              // 기다리는 동안 지워진 표시
      if (!info){
        if (!opts.quiet) setStatus(mapT("이 자리의 주소를 찾지 못했어요."));
        return false;
      }
      // 자동 채우기는 사람이 적어 둔 이름을 덮지 않는다.
      if (opts.onlyEmpty && String(marker.label || "").trim()) return false;
      applyMarkerLabel(marker, info.name);
      if (info.region || info.district){
        marker.region = info.region || "";
        marker.district = info.district || "";
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
    const options = { color:shape.color, weight:4, opacity:0.9 };
    const layer = shape.type === "area"
      ? L.polygon(shape.points, { ...options, fillColor:shape.color, fillOpacity:0.18 })
      : L.polyline(shape.points, options);
    layer.bindTooltip(shapeTooltip(shape), {
      permanent:true,
      direction:shape.type === "area" ? "center" : "top",
      className:"map-shape-label"
    });
    layer.bindPopup(buildShapePopup(shape, layer), { minWidth:190 });
    layer.on("click", () => selectShape(shape));
    layer.on("popupopen", () => selectShape(shape));
    layer.addTo(map); shapeLayers.set(shape.id, layer);
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
    const options = { color:drawingMode === "area" ? "#16a34a" : "#2563eb", weight:4, dashArray:"7 6", fillOpacity:0.12 };
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

  map.on("click", (e) => {
    if (drawingMode){
      draftPoints.push([mapClampLat(e.latlng.lat), mapClampLng(e.latlng.lng)]);
      updateDraft();
      const count = draftPoints.length;
      setStatus(mapTf("점 {count}개 — 계속 찍거나 Enter로 완료하세요", { count }));
      return;
    }
    if (!adding) return;
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

  basemapSelect.addEventListener("change", () => {
    model.basemap = basemapSelect.value === "custom" && model.backgroundImage
      ? "custom" : (MAP_BASEMAPS[basemapSelect.value] ? basemapSelect.value : "osm");
    // 배경마다 최대 확대가 달라, 더 얕은 지도로 바꿀 땐 확대를 먼저 낮춰야 빈 화면이 안 남는다.
    const limit = model.basemap === "custom" ? 19 : MAP_BASEMAPS[model.basemap].maxZoom;
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

  /* ── 주변 시설 ──
     카카오 카테고리 검색에만 있는 길이라(OSM 에 대응물이 없다) 카카오를 켰을 때만 내놓는다.
     꺼 둔 채로 버튼만 보이면 눌러도 안 되는 단추가 되기 때문이다. */
  mapProviderIsKakao().then((kakao) => { nearbyBtn.hidden = !kakao; }).catch(() => {});
  nearbyBtn.addEventListener("click", async () => {
    const center = map.getCenter();
    const picked = await openMapNearby({ lat:center.lat, lng:center.lng });
    if (!picked) return;
    const added = [];
    for (const place of picked.places){
      const marker = mapNormalizeMarker({
        lat:place.lat, lng:place.lng, color:picked.category.color,
        label:place.name,
        // 주소와 거리는 수업에서 그대로 읽는 값이라 메모에 남긴다.
        note:[place.address, place.distance ? mapTf("중심에서 {distance}", { distance:mapFormatDistance(place.distance) }) : ""]
          .filter(Boolean).join("\n")
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
        color:"#2563eb"
      });
      model.shapes.push(shape);
      addShapeLayer(shape);
    }
    touch();
    fitToMarkers(added);
    if (typeof toast === "function"){
      toast(mapTf("{label} {count}곳을 반경 {radius} 안에서 찾아 넣었습니다",
        { label:mapT(picked.category.label), count:added.length, radius:mapFormatDistance(picked.radius) }), 4200);
    }
  });

  const moveToSearchLocation = mapSearchLocationMover(map);
  mapAttachPlaceSearch(gotoInput, searchBtn, searchResults, moveToSearchLocation, setStatus);

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
      map.closePopup();
      setAdding(false);
      if (drawingMode) finishDrawing(false);
      await waitForTiles(8000);
      // 이름표는 지도 칸 좌표로 바꿔 캡처 뒤에 그려 넣는다(화면 말풍선은 캡처에서 감춘다).
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
      const png = await mapCaptureDataUrl(stage, mapAttributionText(model), labels);
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

  /* ── 탭을 다시 열었을 때 ──
     문서는 el.hidden 으로 감췄다 보여주는데, 숨은 동안 지도 칸은 0×0 이 된다. render() 는 처음
     한 번만 불리므로(ensureRendered) 크기 회복은 여기서 스스로 감지해야 한다. */
  let mapResizeObserver = null;
  if (typeof ResizeObserver !== "undefined"){
    mapResizeObserver = new ResizeObserver(() => {
      if (stage.clientWidth > 0 && stage.clientHeight > 0) map.invalidateSize();
    });
    mapResizeObserver.observe(stage);
  }

  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    window.removeEventListener("keydown", onInteractionKey);
    window.removeEventListener("keydown", onSelectedShapeKey);
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
    mapCirclePoints, mapRegionNameOf, mapRegionTally
  };
}
