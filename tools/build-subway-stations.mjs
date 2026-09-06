/*
 * src/js/subway-stations.js 생성기 — 수도권 전철 역 좌표·이웃 표.
 *
 *   node tools/build-subway-stations.mjs           # 표 다시 만들기(인터넷 필요)
 *   node tools/build-subway-stations.mjs --check   # 생성 결과와 다르면 실패
 *
 * 왜 손으로 안 적는가: 역이 664개고 지선·순환·연장까지 있어서 손으로는 못 맞춘다.
 * 왜 OSM 인가: 좌표와 '역 순서' 를 한꺼번에, 인증키 없이 주는 곳이 여기뿐이다.
 * 서울 열린데이터광장의 subwayStationMaster 에도 좌표가 있지만 순서가 없고 키가 필요하다.
 *
 * 관계(relation) 는 노선 한 방향의 운행 계통이라 한 노선에 수십 개씩 있다.
 * 그중 '가장 길게 도는 것' 을 노선·지선마다 하나씩 골라 아래에 못박아 두었다 —
 * 자동으로 고르게 하면 급행·구간운행 계통이 뽑혀 역이 빠진다.
 * 새 노선이 열리거나 연장되면 여기에 관계 번호를 더하면 된다(overpass-turbo 로 찾는다).
 *
 * 검증은 tests/subway-stations.test.js 가 한다. 실시간 API 와의 이름 대조는
 * 인터넷이 필요해 테스트에 넣지 않았다 — 관측 312건으로 확인한 결과는 파일 머리말에 적어 두었다.
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const OUT = path.join(root, "src", "js", "subway-stations.js");
/* 공용 Overpass 서버. 앞의 것이 붐비면 뒤로 넘어간다(하나에만 기대면 표를 못 만드는 날이 생긴다). */
/* 이 쿼리들은 잘 돌 때 2~3초면 끝난다. 넉넉히 잡으면 될 것 같지만 그 반대다 —
   Overpass 는 한도를 넘긴 요청을 거절하는 대신 응답 없이 붙들어 두기 때문에,
   길게 기다릴수록 살아 있는 미러로 넘어가는 것만 늦어진다. */
const OVERPASS_TIMEOUT_MS = 60000;
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

/* 노선 → 그 노선을 이루는 OSM 관계 번호. 본선 하나 + 지선·연장. */
const RELATIONS = {
  "1호선": [8692707, 15044498, 10700979, 8692928, 4748705, 16851102],
  "2호선": [4729409, 4729406, 4729408],
  "3호선": [443803],
  "4호선": [2718884, 13675922],
  "5호선": [19427675, 12497486],
  "6호선": [12080315],
  "7호선": [12746493],
  "8호선": [2718901],
  "9호선": [2718888],
  "수인분당선": [11634612],
  "신분당선": [6060963],
  "경의중앙선": [5993212, 8667956],
  "공항철도": [2911378],
  "우이신설선": [7533582],
  "경춘선": [8656364, 8656357],
  "서해선": [16244688, 8725315],
};

/* OSM 이 부역명을 표제로 올린 곳 → 실시간 API 가 쓰는 이름.
   이렇게 바꿔 두면 화면에서 별칭을 들고 있지 않아도 된다. */
const RENAME = { "7호선": { "자양": "뚝섬유원지" } };

const LINE_ORDER = Object.keys(RELATIONS);

/* 실시간 API 가 역 이름 자리에 보내는 '역이 아닌 이름'. */
const PSEUDO = ["성수지선", "신정지선", "신도림지선"];
/* 종착역 자리에서만 뜻이 통하는 이름 → 그 갈래의 끝 역. */
const TERMINAL_ALIAS = {
  "성수지선": "성수", "신도림지선": "신도림", "신정지선": "까치산", "응암순환": "응암",
};

/* 실시간 API 의 statnNm 과 맞추기 위한 정규화. 이 규칙만으로 관측 312건이 전부 붙었다. */
function normalize(name) {
  let s = String(name || "").trim().replace(/\s+/g, "");
  s = s.replace(/\(.*?\)/g, "").replace(/[·‧]/g, "");
  if (s.length > 1 && s.endsWith("역")) s = s.slice(0, -1);
  return s;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* fetch 를 쓰지 않고 node:https 로 직접 부른다. Overpass 는 붐빌 때 연결 수립 자체가 느린데,
   fetch(undici)의 연결 타임아웃은 10초 고정이라 AbortSignal 로도 못 늘린다 —
   그 벽에 걸려 표를 못 만드는 일이 실제로 있었다. 여기서는 우리가 시간을 정한다. */
function postOverpass(endpoint, query, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ data: query }).toString();
    const target = new URL(endpoint);
    const request = https.request({
      hostname: target.hostname,
      path: target.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Accept": "application/json",
        "User-Agent": "ClassDock-subway-table/1.0 (https://github.com/songhwaseong/ClassDock)",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400 && response.statusCode < 500) {
          reject(new Error("거부: HTTP " + response.statusCode));
        } else if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode));
        } else {
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error("JSON 이 아닌 응답")); }
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("시간 초과")));
    request.on("error", reject);
    request.end(body);
  });
}

/* Overpass 는 공용 무료 서버라 두 가지를 지켜야 한다.
   - User-Agent 가 없으면 406 으로 끊는다(node 의 기본값도 거부당한다).
   - 쉬지 않고 몰아치면 연결을 받아 주지 않는다 — 요청 사이를 띄우고 넉넉히 기다린다.
   4xx 는 다시 걸어도 같은 답이므로 재시도는 5xx·연결 실패에만 한다. 한 서버가 계속 안 되면 미러로 넘어간다. */
let lastCall = 0;
async function overpass(query) {
  let lastError = null;
  for (const endpoint of OVERPASS_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = lastCall + 1500 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try {
        return await postOverpass(endpoint, query, OVERPASS_TIMEOUT_MS);
      } catch (err) {
        lastError = err;
        if (/^거부/.test(err.message)) throw err;
        process.stderr.write(`  (다시 시도 ${attempt + 1}/3 · ${new URL(endpoint).hostname}: ${err.message})\n`);
        await sleep(4000 * (attempt + 1));
      }
    }
  }
  throw lastError || new Error("Overpass 에 닿지 못했습니다");
}

/* 관계 하나의 정차역을 순서대로. role 이 stop 으로 시작하는 노드만 센다
   (platform 은 승강장이라 한 역에 여러 개 붙는다). */
async function relationStops(id) {
  const data = await overpass(`[out:json][timeout:120];rel(id:${id});out body;node(r);out body;`);
  const nodes = new Map();
  let relation = null;
  for (const el of data.elements) {
    if (el.type === "node") nodes.set(el.id, el);
    else if (el.type === "relation" && el.id === id) relation = el;
  }
  if (!relation) throw new Error("관계 " + id + " 를 찾지 못했습니다");
  const stops = [];
  for (const member of relation.members || []) {
    if (member.type !== "node" || !String(member.role || "").startsWith("stop")) continue;
    const node = nodes.get(member.ref);
    if (!node) continue;
    const tags = node.tags || {};
    stops.push({ name: tags["name:ko"] || tags.name || "", lat: node.lat, lon: node.lon });
  }
  return { name: (relation.tags || {})["name:ko"] || (relation.tags || {}).name, stops };
}

/* 이름 태그가 없는 정차 노드가 있다(공항철도의 홍대입구·디지털미디어시티).
   좌표는 멀쩡하므로 가까운 역 요소에서 이름만 끌어온다. */
async function fillBlankName(stop) {
  const around = `(around:250,${stop.lat},${stop.lon})`;
  const data = await overpass(`[out:json][timeout:30];(`
    + `node${around}["railway"="station"];way${around}["railway"="station"];`
    + `node${around}["public_transport"="station"];);out tags center 5;`);
  for (const el of data.elements) {
    const name = (el.tags || {})["name:ko"] || (el.tags || {}).name;
    if (name) return name;
  }
  return "";
}

async function build() {
  const lines = {};
  for (const line of LINE_ORDER) {
    const stations = new Map();      // 정규화 이름 → [위도, 경도]
    const next = new Map();          // 정규화 이름 → Set(이웃)
    for (const id of RELATIONS[line]) {
      const relation = await relationStops(id);
      const sequence = [];
      for (const stop of relation.stops) {
        if (!stop.name) stop.name = await fillBlankName(stop);
        const key = normalize(stop.name);
        if (!key) continue;
        if (!stations.has(key)) stations.set(key, [round5(stop.lat), round5(stop.lon)]);
        sequence.push(key);
      }
      for (let i = 1; i < sequence.length; i++) {
        const a = sequence[i - 1], b = sequence[i];
        if (a === b) continue;       // 순환선은 첫 역이 끝에 다시 나온다
        if (!next.has(a)) next.set(a, new Set());
        if (!next.has(b)) next.set(b, new Set());
        next.get(a).add(b);
        next.get(b).add(a);
      }
      process.stderr.write(`  ${line} ${id} ${relation.name} — ${relation.stops.length}역\n`);
    }
    for (const [from, to] of Object.entries(RENAME[line] || {})) {
      if (!stations.has(from)) continue;
      stations.set(to, stations.get(from));
      stations.delete(from);
      next.set(to, next.get(from));
      next.delete(from);
      for (const set of next.values()) if (set.delete(from)) set.add(to);
    }
    lines[line] = { stations, next };
  }
  return lines;
}

const round5 = (value) => Math.round(value * 1e5) / 1e5;

function render(lines) {
  const out = [];
  out.push('"use strict";', "");
  out.push("/* ===== 수도권 전철 역 좌표·이웃 표(실시간 열차 위치 표시용) =====", "");
  out.push("   이 파일은 생성물이다 — 손으로 고치지 말고 tools/build-subway-stations.mjs 를 돌릴 것.", "");
  out.push("   자료: OpenStreetMap 노선 관계의 정차역 순서와 좌표. © OpenStreetMap 기여자, ODbL.");
  out.push("         화면에 띄울 때 출처를 함께 보여야 한다(map-viewer.js 의 타일 표기와 같은 조건).", "");
  out.push("   키는 실시간 API(realtimePosition)가 보내는 statnNm 을 정규화한 이름이다.");
  out.push("   정규화 = 공백 제거 · 괄호 부역명 제거 · 끝의 '역' 제거.");
  out.push("   그 규칙만으로 실제 관측 312건이 모두 붙었다(2026-09-06 확인).", "");
  out.push("   ▲ statnId 로 순서를 짐작하지 말 것.");
  out.push("     뒤 6자리가 역 순서처럼 보이지만 아니다 — 신분당선은 자리수가 늘어 689 다음이 6810 이고,");
  out.push("     공항철도는 나중에 끼워 넣은 역이 앞 역 번호 + 가지번호를 받는다(마곡나루 65042).");
  out.push("     순서는 반드시 n(이웃)으로 볼 것.", "");
  out.push("   ▲ 이웃은 방향이 없다. 진행 방향은 '직전에 있던 역이 아닌 쪽' 으로 정한다.");
  out.push("     종착역(statnTnm)까지의 최단경로로 정하면 두 군데서 틀린다 —");
  out.push("     순환선(2호선)을 먼 쪽으로 도는 열차, 회차 직전이라 종착역이 이미 바뀐 열차.");
  out.push("     갈래가 둘 이상인 분기역에서만 종착역으로 고른다. */", "");
  out.push("/* 실시간 API 가 역 이름 자리에 보내는 '역이 아닌 이름'(전부 2호선 지선). 위치를 못 정하므로 감춘다. */");
  out.push("const SUBWAY_PSEUDO_STATIONS = " + JSON.stringify(PSEUDO) + ";", "");
  out.push("/* 종착역 자리에서만 뜻이 통하는 이름 → 그 갈래의 끝 역. */");
  out.push("const SUBWAY_TERMINAL_ALIAS = {");
  for (const [from, to] of Object.entries(TERMINAL_ALIAS)) out.push(`  "${from}": "${to}",`);
  out.push("};", "");
  out.push("/* 노선 → { s: 역 이름 → [위도, 경도], n: 역 이름 → 이웃 역 이름들 } */");
  out.push("const SUBWAY_LINES = {");
  for (const line of LINE_ORDER) {
    const { stations, next } = lines[line];
    const names = [...stations.keys()].sort();
    out.push(`  "${line}": {`, "    s: {");
    for (const name of names) out.push(`      "${name}": [${stations.get(name).join(", ")}],`);
    out.push("    },", "    n: {");
    for (const name of names) {
      const near = [...(next.get(name) || [])].sort().map((x) => `"${x}"`).join(", ");
      out.push(`      "${name}": [${near}],`);
    }
    out.push("    }", "  },");
  }
  out.push("};", "");
  out.push('if (typeof module !== "undefined" && module.exports) {');
  out.push("  module.exports = { SUBWAY_LINES, SUBWAY_PSEUDO_STATIONS, SUBWAY_TERMINAL_ALIAS };");
  out.push("}");
  return out.join("\n") + "\n";
}

export { render, normalize, LINE_ORDER, OUT };

// 다른 스크립트가 import 할 때는 여기서 멈춘다(그때는 render 만 빌려 쓴다).
const runningAsScript = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (!runningAsScript) { /* import 전용 */ } else {
const check = process.argv.includes("--check");
const text = render(await build());
if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== text) {
    console.error("subway-stations.js 가 생성 결과와 다릅니다. node tools/build-subway-stations.mjs 를 돌리세요.");
    process.exit(1);
  }
  console.log("subway-stations.js 최신 상태입니다.");
} else {
  fs.writeFileSync(OUT, text);
  console.log("생성:", path.relative(root, OUT));
}
}
