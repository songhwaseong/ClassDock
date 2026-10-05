"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Leaflet 캔버스 렌더러는 지도 전체를 덮는 <canvas> 한 장이 마우스를 다 받아 아래 층의 표시를 가린다.
// 점을 다 지워도 렌더러는 남아 계속 막는다(2026-10-05 장날 층 → 주변 교통 지하철 말풍선이 안 뜸).
// 지도 층은 SVG(빈 바탕이 마우스를 통과)로 그리거나, 캔버스를 쓰면 그 층을 pointer-events:none 으로 둔다.
test("지도 층은 마우스를 가로채는 캔버스 렌더러를 쓰지 않는다", () => {
  const dir = path.join(__dirname, "..", "src", "js");
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".js"))){
    const source = fs.readFileSync(path.join(dir, name), "utf8");
    if (/\bL\.canvas\s*\(|preferCanvas\s*:\s*true/.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});
