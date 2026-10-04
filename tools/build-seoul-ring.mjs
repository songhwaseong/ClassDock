// 서울 경계 고리(jeju-bus-api.js 의 SEOUL_RING)를 다시 뽑는다: node tools/build-seoul-ring.mjs
// vendor/korea-regions.js 의 서울특별시(시도 0번) 바깥 고리를 200m 허용 더글러스–포이커로 줄여 [위도, 경도, …]로 찍는다.
// 근처 버스 정류장을 서울 API·TAGO 중 어디에 물을지 가르는 데만 쓴다(800m 여유를 두므로 200m 오차는 괜찮다).
import fs from "node:fs";
import vm from "node:vm";

const TOLERANCE_M = 200;
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../vendor/korea-regions.js", import.meta.url), "utf8") + ";globalThis.R=MN_KOREA_REGIONS", context);
const data = context.R;
const seoul = data.vintages["2026-07"].sido.find(([name]) => name === "서울특별시")[1];

function decode(code, scale){
  const points = [];
  let index = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, byte;
    do { byte = code.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < code.length);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (index < code.length){ lat += next(); if (index >= code.length) break; lng += next(); points.push([lat / scale, lng / scale]); }
  return points;
}
const rings = String(data.geoms[seoul]).split(";").map(polygon => decode(polygon.split(",")[0], data.scale));
const outer = rings.sort((a, b) => b.length - a.length)[0];

const k = Math.cos(37.55 * Math.PI / 180);
const xy = p => [p[1] * 111320 * k, p[0] * 110950];
function segmentDistance(p, a, b){
  const [px, py] = xy(p), [ax, ay] = xy(a), [bx, by] = xy(b);
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, length ? ((px - ax) * dx + (py - ay) * dy) / length : 0));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function simplify(points){
  if (points.length < 3) return points;
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++){
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > worst){ worst = d; at = i; }
  }
  if (worst <= TOLERANCE_M) return [points[0], points[points.length - 1]];
  return simplify(points.slice(0, at + 1)).slice(0, -1).concat(simplify(points.slice(at)));
}
const ring = simplify(outer).slice(0, -1);
console.log("// " + ring.length + " points");
console.log(JSON.stringify(ring.flatMap(p => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))])));
