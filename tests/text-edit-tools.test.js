"use strict";

// 텍스트 편집 화면에 붙인 편집 도구: 줄 정리 메뉴 · 문서 정보 · 줄바꿈 보기.
// 줄 자체를 바꾸는 규칙(정렬·번호 매기기 …)은 core.test.js 의 transformEditorLines 쪽에서 검증한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const viewer = read("src", "js", "code-viewer.js");
const editor = read("src", "js", "python-editor.js");
const styles = read("src", "styles.css");

test("문서 정보는 한 번의 순회로 줄·낱말·글자·공백 뺀 글자를 함께 센다", () => {
  const start = viewer.indexOf("function countTextStats");
  const end = viewer.indexOf("function attachTextStats", start);
  const sandbox = {};
  vm.runInNewContext(viewer.slice(start, end) + "; this.countTextStats = countTextStats;", sandbox);
  const { countTextStats } = sandbox;

  // vm 안에서 만든 객체는 프로토타입이 달라 deepEqual 이 걸린다 — 값만 하나씩 본다.
  const one = countTextStats("가나 다라\n마바");
  assert.equal(one.lines, 2);
  assert.equal(one.words, 3);
  assert.equal(one.chars, 8);
  assert.equal(one.nonSpace, 6);

  // 줄바꿈·탭도 낱말 구분자다. 연달아 나와도 빈 낱말이 생기지 않는다.
  const spaced = countTextStats("  a\t\tb \n\n c  ");
  assert.equal(spaced.words, 3);
  assert.equal(spaced.lines, 3);

  const empty = countTextStats("");
  assert.equal(empty.lines, 1);
  assert.equal(empty.words, 0);
  assert.equal(empty.chars, 0);
});

test("줄 정리 메뉴는 도구막대에 접혀 들어가고 모든 항목이 편집기의 applyLineTidy 를 탄다", () => {
  const start = viewer.indexOf("const LINE_TIDY_ITEMS");
  const end = viewer.indexOf("function buildLineTidyMenu", start);
  const sandbox = {};
  vm.runInNewContext(viewer.slice(start, end) + "; this.LINE_TIDY_ITEMS = LINE_TIDY_ITEMS;", sandbox);
  const items = sandbox.LINE_TIDY_ITEMS.filter(item => !item.separator);

  // core 의 LINE_TIDY_ACTIONS 에 실제로 있는 동작만 메뉴에 걸려 있어야 한다(오타 난 항목은 눌러도 아무 일이 없다).
  const core = read("src", "js", "core.js");
  const table = core.slice(core.indexOf("const LINE_TIDY_ACTIONS"), core.indexOf("function transformEditorLines"));
  for (const item of items){
    assert.ok(item.label && item.title && item.done, "메뉴 항목에는 이름·설명·완료 문구가 다 있어야 한다: " + item.action);
    assert.ok(table.includes('"' + item.action + '"'), "core 에 없는 줄 정리 동작: " + item.action);
  }
  assert.ok(items.length >= 10);

  // 도구막대에는 버튼 하나(줄 정리)로만 나오고, 예전 '중복 줄 삭제' 단독 버튼은 그 안으로 들어갔다.
  assert.match(viewer, /const tidyMenu = buildLineTidyMenu\(\(\) => editor\);/);
  assert.match(viewer, /bar\.append\(saveBtn, viewBtn, tidyMenu, wrapBtn, fontDown, fontUp, status\);/);
  assert.ok(!/dedupeBtn/.test(viewer.slice(viewer.indexOf("const showEdit"), viewer.indexOf("const showPreview"))),
    "편집 도구막대에 중복 줄 삭제 단독 버튼이 남아 있으면 안 된다");

  // 따라치기 중에는 적용하지 않고(채점 위치가 어긋난다) 사용자에게 알린다.
  assert.match(viewer, /if \(!result\)\{ toast\("따라치기 중에는 줄 정리를 쓸 수 없어요\./);
  assert.match(editor, /const applyLineTidy = \(action\) => \{\s*if \(practice\.active\) return null;/);
});

test("두 편집기 모두 줄 정리와 줄바꿈을 같은 이름으로 내놓는다", () => {
  // 큰 파일은 가벼운 편집기로 열리므로, 도구막대가 부르는 이름이 양쪽에 다 있어야 한다.
  assert.equal(editor.match(/applyLineTidy,/g).length, 2);
  assert.match(editor, /setWrap: \(on\) => \{ if \(on\) exitCol\(\); return setEditorWrap\(host, ta, on\); \}/);
  assert.match(editor, /setWrap: \(on\) => setEditorWrap\(host, ta, on\)/);

  // 가벼운 편집기는 자체 되돌리기 이력이 없다 — ta.value 직접 대입은 브라우저 undo 까지 지워 버린다.
  const light = editor.slice(editor.indexOf("function buildLightTextEditor"));
  assert.match(light, /ta\.setRangeText\(next\.value, 0, before\.length, "end"\)/);
  assert.ok(!/ta\.value = next\.value/.test(light));
});

test("줄바꿈은 줄 높이로 자리를 잡는 겹침 층을 내리고 편집·읽기 화면이 설정을 공유한다", () => {
  assert.match(editor, /function setEditorWrap\(host, ta, on\)\{/);
  assert.match(editor, /ta\.wrap = wrapped \? "soft" : "off";/);

  // 강조 pre·줄번호·찾기 상자 등은 "줄 번호 × 줄높이"로 그려서, 줄이 접히면 글자와 어긋난다.
  const wrapCss = styles.slice(styles.indexOf(".code-host-edit.is-wrapped .code-input"),
                               styles.indexOf(".code-host-edit.is-wrapped .lite-hit-layer"));
  for (const layer of [".code-pre", ".code-gutter", ".code-indent-layer", ".word-hi-layer",
                       ".find-hi-layer", ".col-overlay", ".cell-div-layer", ".err-lines"]){
    assert.ok(wrapCss.includes(".code-host-edit.is-wrapped " + layer), "줄바꿈 중 내려야 할 층이 빠졌다: " + layer);
  }
  // pre 가 내려가므로 textarea 글자를 직접 보여 줘야 한다(평소엔 투명).
  assert.match(styles, /\.code-host-edit\.is-wrapped \.code-input\{white-space:pre-wrap;[^}]*color:var\(--code-text\)/);

  // 설정은 한 곳(localStorage)에 두고 편집 화면과 읽기 화면이 함께 쓴다.
  assert.match(viewer, /localStorage\.getItem\("mn\.textWrap"\) === "1"/);
  assert.match(viewer, /if \(editor\.setWrap\) editor\.setWrap\(textWrapEnabled\(\)\);/);
  assert.match(viewer, /const longLine = \/\[\^\\n\]\{2000\}\/\.test\(viewText\) \|\| textWrapEnabled\(\);/);
  assert.match(viewer, /if \(!treeMode\) bar\.appendChild\(buildWrapButton\(\(\) => showView\(\)\)\);/);
});

test("문서 정보는 document 리스너를 남기지 않는다", () => {
  const start = viewer.indexOf("function attachTextStats");
  const block = viewer.slice(start, viewer.indexOf("let _textWrapOn", start));
  // selectionchange 는 document 에만 오므로, 쓰면 편집기를 닫아도 남아 샌다. textarea 위 이벤트로 대신한다.
  assert.ok(!/document\.addEventListener/.test(block));
  assert.match(block, /for \(const type of \["input", "keyup", "mouseup", "focus", "select"\]\) ta\.addEventListener/);
  // 편집 도구막대 왼쪽 묶음(저장 상태 다음)에 붙는다 — 구조 진단은 도구막대를 떠나 편집기 위 띠로 갔다.
  assert.match(viewer, /attachTextStats\(editor, bar, null\);/);
});
