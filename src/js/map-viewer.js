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
const MAP_DOC_VERSION = 2;
const MAP_BACKGROUND_MAX_DATA_CHARS = 8 * 1024 * 1024;
const MAP_CSV_MAX_MARKERS = 5000;

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
    color: colorId
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
  if (latAt < 0 || lngAt < 0) throw new Error("csv-columns");
  const markers = [];
  let skipped = 0;
  for (const row of rows.slice(1, MAP_CSV_MAX_MARKERS + 1)){
    const lat = Number(row[latAt]), lng = Number(row[lngAt]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180){ skipped++; continue; }
    const colorRaw = colorAt >= 0 ? String(row[colorAt] || "").trim().toLowerCase() : "red";
    const colorMatch = MAP_MARKER_COLORS.find(item => item.id === colorRaw || item.label === colorRaw);
    const color = colorMatch ? colorMatch.id : "red";
    markers.push(mapNormalizeMarker({
      lat, lng, color,
      label: labelAt >= 0 ? row[labelAt] : "",
      note: noteAt >= 0 ? row[noteAt] : ""
    }));
  }
  if (!markers.length) throw new Error("csv-no-markers");
  return { markers, skipped, truncated: Math.max(0, rows.length - 1 - MAP_CSV_MAX_MARKERS) };
}
function mapCsvEscape(value){
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function mapMarkersToCsv(markers){
  const rows = [["이름", "위도", "경도", "메모", "색상"]];
  for (const marker of Array.isArray(markers) ? markers : []){
    rows.push([marker.label, Number(marker.lat).toFixed(6), Number(marker.lng).toFixed(6), marker.note, marker.color]);
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
   이름 검색은 런처의 /geocode 만 쓴다. file:// 페이지에서 공개 Nominatim 을 직접 부르면 브라우저가
   ClassDock 을 식별하는 User-Agent 를 붙일 수 없고 유효한 HTTP Referer 도 없기 때문이다. 런처는
   식별 UA·요청 간격·캐시를 한 곳에서 적용하며, 공급자 주소도 환경 설정으로 교체할 수 있다. */
const _mapGeocodeCache = new Map();

async function mapGeocode(query){
  const q = String(query || "").trim();
  if (!q || q.length > 200) return [];
  if (_mapGeocodeCache.has(q)) return _mapGeocodeCache.get(q);
  const proxyBase = await mapTileProxyBase();
  if (!proxyBase) throw new Error("geocode-launcher-required");
  const response = await fetch("/geocode?q=" + encodeURIComponent(q), { cache:"no-store" });
  if (!response.ok) throw new Error("geocode-failed");
  const raw = await response.json();
  const places = (Array.isArray(raw) ? raw : []).map((item) => ({
    name: String(item.display_name || "").trim(),
    lat: mapClampLat(item.lat),
    lng: mapClampLng(item.lon)
  })).filter(place => place.name);
  _mapGeocodeCache.set(q, places);
  return places;
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
function mapBoardName(model){
  const base = "지도 – " + (String(model.title || "").trim() || "지도");
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
const MAP_CAPTURE_HIDDEN_PANES = [".leaflet-control-container", ".leaflet-popup-pane", ".leaflet-tooltip-pane", ".map-network-notice"];

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
   결과를 목록으로 띄운다. setNote 로 진행·오류를 알리고, 고르면 onMove(lat, lng, zoom) 을 부른다. */
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
        onMove(place.lat, place.lng, 15);
      });
      results.appendChild(button);
    }
    results.hidden = !items.length;
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
      onMove(coords[0], coords[1], 14);
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
  /* 프록시 확인을 기다리는 동안에도 창은 이미 보인다. 검색 이벤트를 먼저 붙여, 사용자가 창을
     열자마자 Enter 를 누르거나 버튼을 눌러도 입력이 사라지지 않게 한다. */
  mapAttachPlaceSearch(gotoInput, modal.querySelector(".map-search-submit"), modal.querySelector(".map-results"),
    (lat, lng, zoom) => map.setView([lat, lng], Math.max(map.getZoom(), zoom)),
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
  csvImportBtn.textContent = "CSV 들이기"; csvImportBtn.title = "이름·위도·경도·메모·색상 열의 CSV에서 표시 추가";
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

  bar.append(titleInput, basemapSelect, addBtn, lineBtn, areaBtn, imageBtn, imageClearBtn,
    csvImportBtn, csvExportBtn, boardBtn, searchWrap, saveBtn, coord, status);

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

    form.append(labelInput, noteInput, colorRow, coordText, removeBtn);
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
  const shapeTooltip = (shape) => {
    const measure = mapShapeMeasureText(shape);
    return (shape.label ? shape.label + " · " : "") + measure;
  };
  const removeShape = (shape) => {
    const index = model.shapes.findIndex(item => item.id === shape.id);
    if (index >= 0) model.shapes.splice(index, 1);
    const layer = shapeLayers.get(shape.id);
    if (layer){ map.removeLayer(layer); shapeLayers.delete(shape.id); }
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
      model.shapes.push(shape); addShapeLayer(shape); touch();
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
  addBtn.addEventListener("click", () => setAdding(!adding));
  lineBtn.addEventListener("click", () => setDrawing("line"));
  areaBtn.addEventListener("click", () => setDrawing("area"));

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

  csvImportBtn.addEventListener("click", () => { csvInput.value = ""; csvInput.click(); });
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files && csvInput.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("csv-too-large");
      const imported = mapMarkersFromCsv(await file.text());
      imported.markers.forEach(marker => { model.markers.push(marker); addMarkerLayer(marker); });
      if (imported.markers.length === 1) map.setView([imported.markers[0].lat, imported.markers[0].lng], Math.max(map.getZoom(), 14));
      else map.fitBounds(imported.markers.map(marker => [marker.lat, marker.lng]), { padding:[24,24], maxZoom:15 });
      touch();
      const extra = imported.skipped || imported.truncated
        ? mapTf(" · 좌표 오류 {skipped}개 제외 · 상한 초과 {truncated}개 제외", imported) : "";
      if (typeof toast === "function") toast(mapTf("CSV에서 표시 {count}개를 추가했습니다", { count:imported.markers.length }) + extra, 4200);
    } catch(error){
      const message = error && error.message === "csv-too-large"
        ? "CSV 파일은 5MB 이하로 골라 주세요."
        : error && error.message === "csv-columns"
        ? "CSV 첫 줄에 위도·경도 열이 필요합니다."
        : "CSV에서 사용할 수 있는 표시를 찾지 못했습니다.";
      setStatus(mapT(message));
    }
  });
  csvExportBtn.addEventListener("click", () => {
    if (!model.markers.length){ setStatus(mapT("내보낼 표시가 없습니다.")); return; }
    mapDownloadText(mapMarkersToCsv(model.markers), mapSafeDownloadName(model.title) + "_표시.csv", "text/csv;charset=utf-8");
    if (typeof toast === "function") toast(mapTf("표시 {count}개를 CSV로 내보냈습니다", { count:model.markers.length }), 2800);
  });

  mapAttachPlaceSearch(gotoInput, searchBtn, searchResults,
    (lat, lng, zoom) => map.setView([lat, lng], Math.max(map.getZoom(), zoom)),
    setStatus);

  saveBtn.addEventListener("click", async () => { await saveMapDoc(doc); touch(); });

  /* ── 칠판으로 ──
     지도를 그림으로 굳혀 새 화이트보드에 올린다. 지도 문서 자체는 그대로 남으므로, 판서한
     칠판과 계속 고칠 수 있는 지도를 둘 다 갖게 된다. */
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
      const boardDoc = newWhiteboard({
        name: mapBoardName(model),
        // 빈 스냅샷을 "지금" 시각으로 넘겨, 같은 이름으로 쓰던 옛 판서가 되살아나지 않게 한다
        // (chooseBoardSnapshot 은 savedAt 이 더 새 쪽을 고른다).
        state: {
          version: 1,
          savedAt: Date.now(),
          bg: typeof defaultBoardBg === "function" ? defaultBoardBg() : "#ffffff",
          items: []
        }
      });
      if (typeof setActiveDoc === "function") setActiveDoc(boardDoc.id);
      // 렌더가 끝나야 insertBoardImage 가 붙는다(훅은 renderWhiteboard 안에서 문서에 매단다).
      if (typeof ensureRendered === "function") await ensureRendered(boardDoc);
      const placed = typeof boardDoc.insertBoardImage === "function"
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
    mapDocEmpty, mapDocParse, mapDocSerialize, mapDocContentKey,
    mapNormalizeMarker, mapNormalizeShape, mapNormalizeBackgroundImage,
    mapClampLat, mapClampLng, mapScratchFileName, mapDocDefaultTitle,
    mapDistanceMeters, mapLineLengthMeters, mapPolygonAreaSquareMeters,
    mapMarkersFromCsv, mapMarkersToCsv
  };
}
