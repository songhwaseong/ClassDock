const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "src", "js", name), "utf8");
read.css = (name) => fs.readFileSync(path.join(root, "src", name), "utf8");

test("공용 아이콘 모듈은 필기 도구 SVG와 라벨 도우미를 제공한다", () => {
  const source = read("icons.js");
  for (const name of ["select", "pen", "highlighter", "eraser", "undo", "redo", "move", "rect", "mosaic"]){
    assert.match(source, new RegExp("\\b" + name + ":\\s*'<"), name);
  }
  assert.match(source, /window\.setUiIconLabel\s*=/);
});

test("필기·표시 도구막대는 삭제될 수 있는 이모지 대신 공용 SVG를 직접 사용한다", () => {
  const files = ["pdf-editor.js", "python-runtime.js", "notebook-tools.js", "image-viewer.js", "code-viewer.js"];
  for (const file of files){
    const source = read(file);
    assert.match(source, /setUiIcon|setLabeledIcon/, file);
    assert.doesNotMatch(source, /🖱|🖍|🧽|✏️/, file);
  }
});

test("화이트보드 도구막대도 이모지 라벨 대신 자기 SVG를 쓴다", () => {
  /* icons.js 는 앱 UI 의 색상 이모지를 걷어내는데, 짝이 되는 단색 SVG 가 없으면 글자만 사라져
     그림 없는 빈 버튼이 남는다 — 지도(🗺️)·환율(💱) 버튼이 실제로 그렇게 비어 보였다.
     화이트보드는 공용 icons.js 가 아니라 자기 WB_ICONS 를 쓰므로 여기서 따로 지킨다. */
  const source = read("whiteboard.js");
  assert.doesNotMatch(source, /mkBtn\("[^"]*[\u{1F000}-\u{1FAFF}]/u);
  for (const name of ["map", "exchange"]) assert.match(source, new RegExp("\\n\\s*" + name + ":\\s*'<"), name);
});

test("이미지 편집 도구막대는 아이콘 버튼을 쓰고 저장 글자칸을 따로 둔다", () => {
  /* documents.js 는 원본/사본 배지에 맞춰 .run-save 의 글자를 갈아 끼우는데, textContent 로 통째로
     쓰면 아이콘 SVG 까지 지워진다 — 탭을 옮겼다 오면 저장 버튼만 빈 칸이 된다. 그래서 글자는
     .run-save-label 안에만 담고, documents.js 는 그 칸이 있으면 거기만 고친다. */
  const image = read("image-viewer.js");
  const documents = read("documents.js");
  assert.match(image, /"save", "저장", "run-save-label"/);
  assert.match(documents, /querySelector\("\.run-save-label"\)/);
  assert.match(documents, /if \(labelSlot\) labelSlot\.textContent = actionLabel;/);

  // 도구막대에 새로 쓰는 아이콘은 icons.js 에 실제로 있어야 빈 버튼이 되지 않는다.
  const icons = read("icons.js");
  for (const name of ["rotateLeft", "rotateRight", "flipH", "flipV", "crop", "pdf", "camera", "ocr", "sliders", "reset", "more"]){
    assert.match(icons, new RegExp("\\b" + name + ":\\s*'<"), name);
    assert.match(image, new RegExp('"' + name + '"'), name + " (image-viewer)");
  }
  // 회전 버튼의 ↶ ↷ 는 짝이 되는 SVG 가 없어 글자로 남던 자리였다 — 되돌아가지 않게 막는다.
  assert.doesNotMatch(image, /mkBtn\("[↶↷]"/);
});

test("아이콘이 붙은 저장 단추는 그림만 보이고 설명 풍선을 잃지 않는다", () => {
  for (const [file, pattern] of [
    ["study-doc.js", /saveBtn\.classList\.add\("study-ico", "save-ico"\)/],
    ["tier-list.js", /"tier-btn tier-primary run-save tier-ico save-ico"/],
    ["pick.js", /"tier-btn tier-primary run-save tier-ico save-ico"/],
    ["bracket.js", /"tier-btn tier-primary run-save tier-ico save-ico"/],
    ["image-viewer.js", /saveBtn\.classList\.add\("img-ico", "save-ico"\)/],
    ["lesson-replay.js", /setIcon\(saveBtn, "save"\);/],
    ["code-viewer.js", /setBarIcon\(saveBtn, "save", "\.py 저장", "run-save-label"\);[\s\S]{0,200}saveBtn\.classList\.add\("save-ico"\)/]
  ]) assert.match(read(file), pattern, file);
  assert.match(read.css("styles.css"), /\.run-save\.save-ico \.run-save-label\{display:none\}/);
  // 글자만 있던 저장 단추는 공용 setSaveIcon 으로 같은 모양(그림 + 감춘 글자 칸)을 만든다.
  assert.match(read("icons.js"), /window\.setSaveIcon = function/);
  for (const [file, target] of [["code-viewer.js", "saveBtn"], ["docx-editor.js", "saveBtn"], ["concept-doc.js", "saveBtn"], ["timeline.js", "saveBtn"],
    ["db-client.js", "saveButton"], ["java-editor.js", "saveBtn"], ["js-editor.js", "saveBtn"], ["mnote.js", "saveBtn"], ["map-viewer.js", "saveBtn"], ["music-editor.js", "saveBtn"]]){
    const source = read(file);
    assert.match(source, new RegExp("window\\.setSaveIcon\\(" + target + "\\)"), file);
    assert.doesNotMatch(source, /textContent = "💾 저장"/, file);
  }
  // documents.js 가 원본/사본 표시를 고칠 때 title 을 "" 로 비우면 그림만 있는 단추는 이름이 사라진다.
  assert.match(read("documents.js"), /button\.title = target\.mode \? _t\(target\.title\) : button\.dataset\.saveTitle;/);
});

test("파이썬 실행 바 단추는 그림만 보이고 이름은 aria-label·title 로 남긴다", () => {
  const code = read("code-viewer.js"), css = read.css("styles.css");
  assert.match(css, /\.run-bar-icons \.run-bar-label\{display:none\}/);
  assert.match(code, /btn\.setAttribute\("aria-label", label\);\s*\n\s*if \(!btn\.title\) btn\.title = label;/);
  // 되돌리기 설명이 주석 안에 들어가 풍선이 비어 있던 자리.
  assert.match(code, /\n\s*revertBtn\.title = "편집 전 원본 코드로 되돌리기";/);
  assert.doesNotMatch(code, /pkgBtn\.removeAttribute\("title"\)/);
  // 글자 크기·새 파이썬도 글자 대신 그림(아이콘은 icons.js 에 있어야 빈 단추가 되지 않는다).
  for (const [target, icon] of [["fontDown", "textSmaller"], ["fontUp", "textLarger"], ["newPyBtn", "filePlus"]]){
    assert.match(code, new RegExp("setBarIcon\\(" + target + ", \"" + icon + "\""), target);
    assert.match(read("icons.js"), new RegExp("\\b" + icon + ":\\s*'<"), icon);
  }
  assert.doesNotMatch(code, /newPyBtn\.textContent = "\+Py"/);
});

test("자바·JS 실행 바도 파이썬처럼 그림만 보이는 단추를 쓴다", () => {
  const icons = read("icons.js"), java = read("java-editor.js"), js = read("js-editor.js"), css = read.css("styles.css");
  assert.match(icons, /window\.setRunBarIcon = function/);
  assert.match(java, /bar\.className = "run-bar run-bar-icons java-run-bar"/);
  assert.match(js, /bar\.className = "run-bar run-bar-icons"/);
  for (const [target, icon] of [["gradeBtn", "check"], ["libBtn", "layers"], ["envBtn", "javaCup"], ["configBtn", "sliders"], ["junitBtn", "flask"],
    ["formatBtn", "indent"], ["importsBtn", "importIn"], ["fontDown", "textSmaller"], ["fontUp", "textLarger"], ["newJavaBtn", "filePlus"], ["examplesBtn", "notebook"]]){
    assert.match(java, new RegExp("barIcon\\(" + target + ", \"" + icon + "\""), target);
    assert.match(icons, new RegExp("\\b" + icon + ":\\s*'<"), icon);
  }
  // 글자를 바꾸던 곳(따라치기·Side/Below·라이브러리 개수)은 textContent 대신 글자 칸째 갈아 끼운다.
  for (const source of [java, js]){
    assert.doesNotMatch(source, /layoutBtn\.textContent =|practiceBtn\.textContent =|button\.textContent = count/);
    assert.match(source, /button\.dataset\.count = count \? String\(count\) : ""/);
  }
  assert.match(css, /\.run-bar-icons \.java-run-more-menu :not\(\.run-font\)>\.run-bar-label\{display:inline\}/);
  // JS 노트북도 같은 라이브러리 고르개를 쓰므로 그 단추도 그림만 보인다.
  const notebook = read("notebook-run.js");
  assert.match(notebook, /nbToolIcon\(jsLibraryBtn, "layers"\)/);
  // 노트북 도구 줄의 다른 단추도 그림만(▾ 드롭다운 항목은 글자 그대로).
  for (const [target, icon] of [["saveBtn", "save"], ["undoBtn", "undo"], ["redoBtn", "redo"], ["runAllBtn", "stepForward"], ["clearBtn", "eraser"],
    ["inkBtn", "pen"], ["tocBtn", "list"], ["findBtn", "search"], ["dedupeBtn", "delete"], ["fontDown", "textSmaller"], ["fontUp", "textLarger"],
    ["exportBtn", "export"], ["helpBtn", "keyboard"]]){
    assert.match(notebook, new RegExp("nbToolIcon\\(" + target + ", \"" + icon + "\""), target);
    assert.match(read("icons.js"), new RegExp("\\b" + icon + ":\\s*'<"), icon);
  }
  assert.match(css, /\.nbv-bar \.nbv-ico \.run-bar-label\{display:none\}/);
  // 저장 상태(저장 *·저장 중…)와 실행 중 ■ 전환은 글자 칸째 갈아 끼워 그림이 지워지지 않는다.
  assert.match(read("notebook-cells.js"), /if \(slot\) slot\.textContent = nbT\(label\); else btn\.textContent = nbT\(label\);/);
  assert.match(notebook, /window\.setRunBarIcon\(btn, running \? "stop" : "stepForward"/);
  // ▾ 메뉴 항목은 [그림 + 글자] — 바뀌는 글자(최신 상태로 실행 (N)·로컬 Python …)도 칸째 갈아 끼운다.
  const tools = read("notebook-tools.js");
  assert.match(tools, /function nbSetMenuItem\(btn, icon, label\)/);
  for (const target of ["restartRunBtn", "restartBtn", "localKernelBtn", "localRunBtn", "collapseOutputsBtn", "expandOutputsBtn", "pdfBtn", "toPyBtn"])
    assert.match(notebook, new RegExp("nbSetMenuItem\\(" + target + ", \""), target);
  assert.doesNotMatch(tools, /_nbLocal(Kernel|Run)Btn\.textContent =/);
  assert.doesNotMatch(notebook, /btn\.textContent = staleCount > 0/);
  assert.match(css, /\.nbv-bar \.nbv-run-menu \.nbv-run-menu-item\{display:flex;align-items:center;gap:8px;/);
});

test("암기장 도구막대도 아이콘을 쓰고 저장 글자칸을 따로 둔다", () => {
  const study = read("study-doc.js");
  // 저장 버튼은 이미지 편집기와 같은 규칙을 따른다(.run-save-label 칸만 갈아 끼운다).
  assert.match(study, /"study-btn study-primary run-save", "save", "run-save-label"/);
  // ↶ ↷ 는 짝이 되는 SVG 가 없어 얇은 글자로 남던 자리였다.
  assert.doesNotMatch(study, /studyButton\("[↶↷＋▶]/);
  for (const name of ["plus", "undo", "redo", "play", "save", "more", "close", "pen"]){
    assert.match(study, new RegExp('"' + name + '"'), name);
  }
  // CSV·순서 섞기는 ⋯ 로 접되, 메뉴는 공용 모듈에 맡겨 두 번째 드롭다운을 만들지 않는다.
  assert.match(study, /MNContextMenu\.open\(/);
  assert.match(study, /base:"text-context"/);
});

test("공용 우클릭 메뉴는 아이콘 항목과 켜짐 표시를 지원한다", () => {
  const menu = read("context-menu.js");
  assert.match(menu, /if \(item\.icon && typeof window\.uiIcon === "function"\)/);
  const css = read.css("styles.css");
  // 켜짐 표시는 CSS content 라 icons.js 의 이모지 청소가 건드리지 않는다(음악 메뉴와 같은 방식).
  assert.match(css, /\.text-context-menu button\.is-active::before\{content:"✓"/);
});

test("관계도·암기장 화면은 정의되지 않은 --text 대신 --ink 를 쓴다", () => {
  /* --text 는 어디에도 정의된 적이 없어 color:var(--text) 가 통째로 무효였고, 상속으로 우연히
     맞는 색이 나오고 있었다. 모달 제목이 전역 header{color:#fff} 를 물려받아 흰 판에 흰 글자가
     된 것이 그 우연이 깨진 자리다. */
  const css = read.css("styles.css");
  assert.doesNotMatch(css, /var\(--text\)/);
  assert.match(css, /\.concept-modal-card header,\.study-modal-card header\{[^}]*color:var\(--ink\)\}/);
});

test("이미지 도구막대의 구분선·⋯ 는 딸린 도구가 모두 꺼지면 함께 사라진다", () => {
  // 버튼만 숨기면 세로선과 빈 ⋯ 메뉴가 남는다. 숨김 알림과 첫 렌더 양쪽에서 다시 셈해야 한다.
  const image = read("image-viewer.js");
  assert.match(image, /const syncGroups = \(\) => \{/);
  assert.match(image, /groupWatch\.push\(\{ el: moreWrap, ids: \["imgAltFormat", "imgMemo", "imgOcr", "imgReset"\] \}\)/);
  assert.match(image, /setMoreOpen\(false\);\s*\n\s*syncGroups\(\);/);
  const css = read.css("styles.css");
  assert.match(css, /\.img-sep\[hidden\]\{display:none\}/);
  assert.match(css, /\.img-more\[hidden\]\{display:none\}/);
});
