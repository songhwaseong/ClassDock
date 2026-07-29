const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("문서의 수정 상태는 보이는 탭과 숨겨진 탭 표시에 함께 반영된다", () => {
  assert.match(source, /function markDocumentDirty[\s\S]*renderTabs\(\)/);
  assert.match(source, /if \(d\.hasUnsavedEdits\) tab\.classList\.add\("dirty"\)/);
  assert.match(source, /const hiddenDirtyCount = hiddenIds\.reduce/);
  assert.match(source, /moreDirty\.className = "tab-more-dirty"/);
  assert.match(source, /dirty\.className = "tab-overflow-dirty"/);
});

test("수정된 탭의 닫기 버튼은 키보드와 터치 환경에서도 접근 가능하다", () => {
  assert.match(source, /tail\.className = "tab-tail"; tail\.append\(dot, x\)/);
  assert.match(styles, /\.tab\.dirty \.tab-x\{opacity:0;pointer-events:none\}/);
  assert.match(styles, /\.tab\.dirty:focus-within \.tab-x\{opacity:1;pointer-events:auto\}/);
  assert.match(styles, /@media \(hover:none\)[\s\S]*\.tab\.dirty \.tab-x\{[^}]*opacity:1;pointer-events:auto/);
  assert.doesNotMatch(styles, /\.tab\.dirty \.tab-x\{display:none\}/);
});

test("숨겨진 탭 목록은 본문보다 높은 레이어에서 아래로 펼쳐진다", () => {
  assert.match(styles, /#tabBar\{position:relative;z-index:21/);
  assert.match(styles, /main\{position:relative;z-index:19/);
  assert.match(styles, /\.tab-overflow-menu\{position:absolute;right:0;top:calc\(100% \+ 7px\)/);
});
