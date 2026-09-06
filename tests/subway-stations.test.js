const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* 수도권 전철 역 좌표·이웃 표(src/js/subway-stations.js)와 두 런처의 지하철 프록시.
 *
 * 표는 생성물이라 손으로 고칠 일이 없지만, 다시 만들 때 조용히 망가질 수 있다 —
 * OSM 관계가 바뀌거나(연장·개명) 관계 하나를 못 받아도 파일은 그럴듯하게 나온다.
 * 그래서 '표 스스로 앞뒤가 맞는가' 를 여기서 지킨다.
 *
 * 노선 목록은 세 곳(표·main.go·launcher.cs)에 같은 것이 있어야 한다. 한쪽만 늘리면
 * 새 노선이 한 런처에서만 열리고 다른 쪽에서는 400 으로 막힌다(타일 호스트와 같은 사정).
 */

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const table = require("../src/js/subway-stations.js");
const { SUBWAY_LINES, SUBWAY_PSEUDO_STATIONS, SUBWAY_TERMINAL_ALIAS } = table;

const go = read("desktop/main.go");
const csharp = read("desktop/launcher.cs");
const source = read("src/js/subway-stations.js");

const lineNames = Object.keys(SUBWAY_LINES);
const eachStation = function* () {
  for (const line of lineNames)
    for (const [name, at] of Object.entries(SUBWAY_LINES[line].s)) yield { line, name, at };
};

/* 두 지점 사이 거리(m). 역 사이가 터무니없이 벌어졌으면 관계를 잘못 받은 것이다. */
function metres(a, b) {
  const R = 6371000;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

test("노선마다 역과 이웃이 짝을 이룬다", () => {
  assert.ok(lineNames.length >= 16, "노선이 너무 적다 — 관계를 못 받았을 수 있다");
  for (const line of lineNames) {
    const { s, n } = SUBWAY_LINES[line];
    assert.ok(Object.keys(s).length >= 5, `${line} 의 역이 너무 적다`);
    assert.deepEqual(Object.keys(s).sort(), Object.keys(n).sort(),
      `${line} 의 좌표 목록과 이웃 목록이 다르다`);
  }
});

test("모든 역에 좌표가 있고 한반도 범위 안이다", () => {
  let count = 0;
  for (const { line, name, at } of eachStation()) {
    count++;
    assert.equal(at.length, 2, `${line} ${name} 좌표 모양이 이상하다`);
    assert.ok(at[0] > 33 && at[0] < 39, `${line} ${name} 위도가 범위 밖: ${at[0]}`);
    assert.ok(at[1] > 124 && at[1] < 132, `${line} ${name} 경도가 범위 밖: ${at[1]}`);
  }
  assert.ok(count > 600, `역이 ${count}개뿐이다 — 관계 하나를 못 받았을 수 있다`);
});

test("이웃 관계는 서로를 가리키고, 외톨이 역이 없다", () => {
  for (const line of lineNames) {
    const { s, n } = SUBWAY_LINES[line];
    for (const [name, near] of Object.entries(n)) {
      assert.ok(near.length > 0, `${line} ${name} 에 이웃이 없다`);
      assert.ok(!near.includes(name), `${line} ${name} 이 자기 자신을 이웃으로 둔다`);
      assert.equal(new Set(near).size, near.length, `${line} ${name} 의 이웃이 겹친다`);
      for (const other of near) {
        assert.ok(s[other], `${line} ${name} 의 이웃 ${other} 가 좌표 목록에 없다`);
        assert.ok(n[other].includes(name),
          `${line} 의 ${name}↔${other} 가 한쪽에서만 이어져 있다`);
      }
    }
  }
});

test("노선은 하나로 이어져 있다(끊긴 조각이 없다)", () => {
  for (const line of lineNames) {
    const { s, n } = SUBWAY_LINES[line];
    const names = Object.keys(s);
    const seen = new Set([names[0]]);
    const queue = [names[0]];
    while (queue.length) {
      for (const other of n[queue.shift()]) if (!seen.has(other)) { seen.add(other); queue.push(other); }
    }
    assert.equal(seen.size, names.length,
      `${line} 이 ${names.length}개 중 ${seen.size}개만 이어져 있다 — 지선 관계가 빠졌을 수 있다`);
  }
});

test("이웃한 역 사이 거리가 그럴듯하다", () => {
  for (const line of lineNames) {
    const { s, n } = SUBWAY_LINES[line];
    for (const [name, near] of Object.entries(n)) {
      for (const other of near) {
        if (name > other) continue;
        const gap = metres(s[name], s[other]);
        assert.ok(gap > 100, `${line} ${name}–${other} 가 ${Math.round(gap)}m 뿐이다`);
        assert.ok(gap < 15000, `${line} ${name}–${other} 가 ${Math.round(gap / 1000)}km 다 — 역이 빠진 듯하다`);
      }
    }
  }
});

test("역 이름은 이미 정규화된 꼴이다", () => {
  // 실시간 API 의 statnNm 을 같은 규칙으로 다듬어 이 키와 맞춘다.
  // 표 쪽에 괄호나 공백이 남아 있으면 그 역만 조용히 안 붙는다.
  for (const { line, name } of eachStation()) {
    assert.doesNotMatch(name, /[\s()·‧]/, `${line} 의 "${name}" 에 다듬어야 할 글자가 남아 있다`);
    assert.ok(!(name.length > 1 && name.endsWith("역")), `${line} 의 "${name}" 이 '역' 으로 끝난다`);
  }
});

test("가상 정거장은 표에 없고, 종착역 별칭은 실재하는 역을 가리킨다", () => {
  const all = new Set([...eachStation()].map((x) => x.name));
  for (const pseudo of SUBWAY_PSEUDO_STATIONS) {
    assert.ok(!all.has(pseudo), `가상 정거장 ${pseudo} 가 표에 들어 있다`);
  }
  for (const [from, to] of Object.entries(SUBWAY_TERMINAL_ALIAS)) {
    assert.ok(!all.has(from), `${from} 은 별칭인데 표에도 있다`);
    assert.ok(all.has(to), `별칭 ${from} → ${to} 인데 ${to} 가 표에 없다`);
  }
});

/* OSM 이 부역명으로 올린 곳은 생성기에서 실시간 API 이름으로 바꿔 넣는다.
   이 치환이 빠지면 그 역만 조용히 조인에 실패한다. */
test("뚝섬유원지는 부역명이 아닌 실시간 API 이름으로 들어 있다", () => {
  assert.ok(SUBWAY_LINES["7호선"].s["뚝섬유원지"], "7호선에 뚝섬유원지가 없다");
  assert.ok(!SUBWAY_LINES["7호선"].s["자양"], "7호선에 부역명 '자양' 이 남아 있다");
});

test("노선 목록이 표·main.go·launcher.cs 세 곳에서 같다", () => {
  const pick = (text, re) => {
    const block = re.exec(text);
    assert.ok(block, "노선 목록을 찾지 못했다: " + re);
    return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  };
  const fromGo = pick(go, /var subwayLines = \[\]string\{([\s\S]*?)\n\}/);
  const fromCs = pick(csharp, /static readonly string\[\] SubwayLines = \{([\s\S]*?)\};/);
  assert.deepEqual(fromGo, lineNames.slice().sort(), "main.go 의 노선 목록이 표와 다르다");
  assert.deepEqual(fromCs, lineNames.slice().sort(), "launcher.cs 의 노선 목록이 표와 다르다");
});

/* 이 API 는 오류도 HTTP 200 으로 준다. 본문 code 를 보지 않으면 "인증키가 틀렸습니다" 라는
   JSON 을 열차 목록인 줄 알고 화면에 넘기게 된다(수출입은행 환율에서 겪은 것과 같은 함정). */
test("두 런처 모두 본문 code 로 성공·실패를 가른다", () => {
  for (const [name, text] of [["main.go", go], ["launcher.cs", csharp]]) {
    assert.match(text, /INFO-000/, `${name} 이 정상 코드를 보지 않는다`);
    assert.match(text, /INFO-100/, `${name} 이 인증키 오류 코드를 보지 않는다`);
    assert.match(text, /INFO-200/, `${name} 이 '자료 없음' 을 오류와 구분하지 않는다`);
  }
});

test("두 런처 모두 노선 이름을 허용 목록으로 거른다", () => {
  // 노선 이름이 그대로 URL 경로에 들어가므로, 검사 없이 붙이면 바깥으로 요청을 흘릴 수 있다.
  assert.match(go, /func validSubwayLine\(/);
  assert.match(go, /if !validSubwayLine\(line\) \{/);
  assert.match(csharp, /static bool ValidSubwayLine\(/);
  assert.match(csharp, /if \(!ValidSubwayLine\(line\)\)/);
});

test("두 런처의 지하철 엔드포인트가 같은 이름으로 갖춰져 있다", () => {
  for (const [name, text] of [["main.go", go], ["launcher.cs", csharp]]) {
    for (const route of ["/can-proxy-subway", "/subway-position", "/subway-key-status", "/subway-key"]) {
      assert.ok(text.includes(route), `${name} 에 ${route} 가 없다`);
    }
  }
  // 키를 다루는 자리는 로컬 조작 헤더를 요구한다(환율 키와 같은 규칙).
  assert.match(go, /"\/subway-key-status", func[\s\S]{0,200}X-ClassDock-Action/);
  assert.match(csharp, /path == "\/subway-key-status"[\s\S]{0,200}HasLocalActionHeader/);
});

test("표는 생성물이라고 밝히고 출처를 함께 적어 둔다", () => {
  // ODbL 은 출처 표기를 요구한다. 화면 표기는 map-viewer.js 의 타일 표기와 같은 조건이다.
  assert.match(source, /OpenStreetMap/);
  assert.match(source, /ODbL/);
  assert.match(source, /tools\/build-subway-stations\.mjs/);
  // statnId 로 순서를 짐작하면 안 된다는 경고가 남아 있어야 한다(실제로 틀리는 자리다).
  assert.match(source, /statnId/);
});
