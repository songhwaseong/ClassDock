const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 브라우저 없이 글자 목록과 최근 기록만 검증한다(문자표 DOM 은 화면에서 확인).
function loadSpecialChars(){
  const store = new Map();
  const context = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); }
    },
    window: {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/special-chars.js"), "utf8");
  vm.runInContext(source + "\n;globalThis.__MNSpecialChars = MNSpecialChars;", context);
  return { api: context.__MNSpecialChars, store };
}

const groups = (api) => Array.from(api.groups(), (g) => ({ id:g.id, name:g.name, key:g.key, chars:Array.from(g.chars) }));

test("한자키 습관대로 찾도록 묶음마다 자모 표시와 글자가 들어 있다", () => {
  const { api } = loadSpecialChars();
  const list = groups(api);
  assert.ok(list.length >= 10, "묶음이 너무 적다");
  for (const g of list){
    assert.ok(g.chars.length > 0, g.name + " 묶음이 비어 있다");
    assert.equal(new Set(g.chars).size, g.chars.length, g.name + " 묶음에 같은 글자가 두 번 들어 있다");
  }
  // 한자키에서 가장 많이 쓰던 ㅁ(일반기호)·ㄷ(수학)·ㄹ(단위)은 반드시 있어야 한다.
  const keys = list.map((g) => g.key).join(" ");
  for (const jamo of ["ㅁ", "ㄷ", "ㄹ", "ㄱ", "ㄴ"]) assert.ok(keys.includes(jamo), jamo + " 묶음이 없다");
});

test("한글에서 자주 쓰는 글자는 모두 문자표에 있다", () => {
  const { api } = loadSpecialChars();
  const all = new Set(groups(api).flatMap((g) => g.chars));
  for (const ch of ["※", "○", "●", "★", "①", "㎡", "→", "℃", "Ⅰ", "½", "√", "℡"]){
    assert.ok(all.has(ch), ch + " 가 문자표에 없다");
  }
});

test("이모지는 쪼개지지 않고 한 글자로 남는다", () => {
  const { api } = loadSpecialChars();
  const emoji = groups(api).find((g) => g.id === "emoji");
  assert.ok(emoji, "그림문자 묶음이 없다");
  // 변형 선택자(️)나 결합 문자만 남은 조각이 있으면 눌렀을 때 빈 글자가 들어간다.
  for (const ch of emoji.chars){
    assert.ok(ch.trim().length > 0, "빈 그림문자 조각이 있다");
    assert.notEqual(ch.codePointAt(0), 0xFE0F, "변형 선택자만 있는 조각이 있다");
  }
});

test("최근 쓴 글자는 최신이 앞이고 같은 글자는 하나만 남는다", () => {
  const { api } = loadSpecialChars();
  api.remember("※");
  api.remember("○");
  api.remember("※");
  assert.deepEqual(Array.from(api.recent()), ["※", "○"]);
  api.clearRecent();
  assert.deepEqual(Array.from(api.recent()), []);
});

// 표 셀은 contenteditable 이라 textarea 용 메뉴를 못 쓴다 — 전용 메뉴가 세 곳에 다 붙어 있어야 한다.
const src = (file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8");

test("표 셀에도 우클릭 편집 메뉴가 붙는다", () => {
  assert.match(src("python-editor.js"), /function attachEditableContextMenu\(/);
  for (const file of ["mnote.js", "scratchpad.js", "spreadsheet-viewer.js"]){
    assert.match(src(file), /attachEditableContextMenu\(/, file + " 표 셀에 메뉴가 없다");
  }
});

test("표 셀 메뉴는 줄바꿈을 공백으로 눕혀 한 줄을 지킨다", () => {
  for (const file of ["mnote.js", "scratchpad.js", "spreadsheet-viewer.js"]){
    assert.match(src(file), /sanitize:\(text\) => text\.replace\(\/\[\\t\\r\\n\]\+\/g, " "\)/, file + " 에 셀 정리가 없다");
  }
});

test("시트 셀은 메뉴가 떠 있는 동안 편집이 끝나지 않는다", () => {
  // 셀은 포커스를 잃으면 바로 커밋된다. 메뉴로 잠깐 포커스가 가도 편집이 살아 있어야 한다.
  assert.match(src("spreadsheet-viewer.js"), /const onBlur = \(\) => \{ if \(menuOpen\) return; finish\(true\); \};/);
  assert.match(src("spreadsheet-viewer.js"), /onMenuOpen:\(\) => \{ menuOpen = true; \}/);
});

test("잠근 스크래치패드 블록에는 메뉴를 붙이지 않는다", () => {
  // 메뉴의 넣기는 readOnly·contentEditable=false 를 그냥 통과해 버린다.
  const source = src("scratchpad.js");
  assert.match(source, /if \(!block\.locked && typeof attachTextCaseContextMenu === "function"\)/);
  const cellWiring = source.indexOf("attachEditableContextMenu(box");
  assert.ok(cellWiring > 0, "표 셀 배선이 없다");
  assert.ok(source.lastIndexOf("if (!block.locked){", cellWiring) > 0, "표 셀 배선이 잠금 검사 밖에 있다");
});

test("최근 쓴 글자는 20개까지만 쌓인다", () => {
  const { api } = loadSpecialChars();
  const chars = Array.from(groups(api).find((g) => g.id === "sign").chars).slice(0, 30);
  for (const ch of chars) api.remember(ch);
  const recent = Array.from(api.recent());
  assert.equal(recent.length, 20);
  assert.equal(recent[0], chars[chars.length - 1]);   // 가장 마지막에 쓴 글자가 맨 앞
});
