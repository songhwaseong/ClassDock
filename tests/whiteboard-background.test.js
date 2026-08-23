"use strict";

// 화이트보드 배경색: 보드마다 고른 색이 스냅샷에 남아 되살아나고, 배경을 바꿨을 때 같이 움직여야 하는
// 것들(무대·텍스트 입력칸·펜 색·리플레이 배경)이 흰색에 묶여 있지 않은지 고정한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { boardStateFromSnapshot, boardSnapshotBg } = require("../src/js/whiteboard.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("스냅샷의 배경색은 그대로 되살아난다", () => {
  const state = boardStateFromSnapshot({ version:1, bg:"#0f5132", items:[] });
  assert.equal(state.bg, "#0f5132");
});

test("배경색이 없던 옛 스냅샷은 흰 종이로 되살린다", () => {
  // 그때 쓴 펜은 검정이다 — 지금 설정한 기본 배경(칠판 등)을 씌우면 판서가 통째로 사라져 보인다.
  assert.equal(boardStateFromSnapshot({ version:1, items:[] }).bg, "#ffffff");
  assert.equal(boardSnapshotBg(""), "#ffffff");
  assert.equal(boardSnapshotBg("초록"), "#ffffff");
  assert.equal(boardSnapshotBg("#0F5132"), "#0f5132");
});

test("설정에 새 보드 기본 배경이 있고, 새 보드만 그 색으로 연다", () => {
  const state = read("src/js/state.js");
  assert.match(state, /boardBg: BOARD_BG_DEFAULT/);
  assert.match(state, /function normalizeBoardBg\(value\)\{ return normalizeHexColor\(value\) \|\| BOARD_BG_DEFAULT; \}/);
  // 저장·불러오기 양쪽에서 정규화해야 손상된 값이 그대로 살아남지 않는다.
  assert.match(state, /const loaded = \{[^\n]*boardBg:normalizeBoardBg\(saved\.boardBg\)/);
  assert.match(state, /appSettings = \{[^\n]*boardBg:normalizeBoardBg\(merged\.boardBg\)/);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /function defaultBoardBg\(\)/);
  assert.match(wb, /doc\.boardState = \{[^\n]*bg: defaultBoardBg\(\)/);
});

test("배경색을 바꾸면 무대·텍스트 입력칸까지 함께 따라간다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const applyBoardBackground = \(\) => \{[\s\S]{0,320}setProperty\("--wb-bg", wb\.bg\)/);
  assert.match(wb, /setProperty\("--wb-textbg"/);
  assert.match(wb, /const setBackground = \(value, options=\{\}\) => \{[\s\S]{0,200}applyBoardBackground\(\);/);

  const css = read("src/styles.css");
  assert.match(css, /\.wb-stage\{[^}]*background:var\(--wb-bg,#fff\)\}/);
  assert.match(css, /\.wb-canvas\{[^}]*background:var\(--wb-bg,#fff\)\}/);
  assert.match(css, /\.wb-textinput\{[^}]*background:var\(--wb-textbg,rgba\(255,255,255,\.9\)\)/);
});

test("배경색은 복구 스냅샷에 바로 남는다 — 되돌리기(Ctrl+Z) 대상은 아니다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const setBackground = \(value, options=\{\}\) => \{[\s\S]{0,420}scheduleBoardRecovery\(\);/);
  // history.commit 을 부르면 배경 변경이 판서 되돌리기 단계에 끼어든다.
  const body = wb.slice(wb.indexOf("const setBackground = (value, options"));
  assert.doesNotMatch(body.slice(0, 900), /history\.commit\(\)/);
  assert.match(wb, /bg:wb\.bg,/);   // boardSnapshot 이 배경색을 담는다
});

test("어두운 배경으로 바꾸면 펜 색을 읽히는 색으로 맞춘다", () => {
  const state = read("src/js/state.js");
  assert.match(state, /function boardInkForBackground\(bg, ink\)/);
  assert.match(state, /colorContrastRatio\(current, background\) >= 2\.2/);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /boardInkForBackground\(next, wb\.color\)/);
  // 저장해 둔 칠판 보드를 다시 열 때도 검정 펜으로 시작하지 않는다.
  assert.match(wb, /boardInkForBackground\(wb\.bg, "#111111"\)/);
});

test("녹화 중 배경을 바꾸면 리플레이도 그 배경으로 재생된다", () => {
  const replay = read("src/js/lesson-replay.js");
  assert.match(replay, /setBackground\(next, nextLayers\)\{ if \(next\) bg = next;/);
  assert.match(replay, /capture\(its, b, d, l\)\{[\s\S]{0,160}if \(b\) bg = b;/);
  // 색뿐 아니라 배경 밑에 깔리는 무늬·그림도 재생본에 실린다.
  assert.match(replay, /bgPattern: \(layers && layers\.pattern\) \|\| null,/);
  assert.match(replay, /bgImage: \(layers && layers\.image\) \? \{ \.\.\.layers\.image, img:undefined \} : null,/);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /doc\.recorder\.setBackground\(next\)/);
  assert.match(wb, /doc\.recorder\.setBackground\(wb\.bg, \{ pattern:wb\.bgPattern, image:wb\.bgImage \}\)/);
});

test("내보내기는 화면에 보이는 배경을 그대로 담는다", () => {
  const wb = read("src/js/whiteboard.js");
  // 인쇄·PDF만 흰 배경으로 바꾸면 칠판에 흰 펜으로 쓴 판서가 흰 종이에서 사라진다.
  const exportBlock = wb.slice(wb.indexOf("const withBoardExport"), wb.indexOf("const exportPng"));
  assert.doesNotMatch(exportBlock, /#ffffff/);
});

test("설정 › 문서에 새 보드 기본 배경 칸이 있고 저장 목록에 실린다", () => {
  const html = read("classdock.html");
  assert.match(html, /data-settings-panel="document"[\s\S]{0,2600}id="settingBoardBg"/);

  const app = read("src/js/app.js");
  // 팔레트는 BOARD_BG_PRESETS 한 곳에서만 관리한다(설정 화면·보드 도구막대 이중 관리 방지).
  assert.match(app, /for \(const preset of BOARD_BG_PRESETS\)/);
  assert.match(app, /boardBgDraft = normalizeBoardBg\(appSettings\.boardBg\)/);
  assert.match(app, /boardBg: boardBgDraft,/);
});

test("보드 도구막대에 배경색 버튼이 있고 Esc·바깥 클릭으로 닫힌다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /tools\.append\([^)]*colorGroup, bgGroup,/);
  assert.match(wb, /function toggleBackgroundPanel\(force\)/);
  assert.match(wb, /e\.key === "Escape" && !bgPanel\.hidden/);
  assert.match(wb, /document\.addEventListener\("pointerdown", onPointerDownOutside, true\)/);
  // 탭을 닫을 때 문서 전역 리스너를 반드시 걷어낸다.
  assert.match(wb, /removeEventListener\("pointerdown", onPointerDownOutside, true\)/);
});

// ── 배경 무늬(모눈·오선 등) ────────────────────────────────────────────
// state.js 는 ClassDockCore 구조분해로 시작해 통째로는 못 돌린다 — 색·배경 구획만 떼어 실행한다.
const { normalizeBoardPattern, boardPatternPreset, boardPatternAutoColor, BOARD_PATTERNS,
        normalizeBoardImage, boardImageBox, BOARD_IMAGE_MAX_EDGE, BOARD_IMAGE_MAX_CHARS, BOARD_IMAGE_FITS } = (() => {
  const vm = require("node:vm");
  const source = read("src/js/state.js");
  const start = source.indexOf("function normalizeHexColor(value){");
  const end = source.indexOf("const DEFAULT_APP_SETTINGS");
  assert.ok(start > 0 && end > start, "state.js 에서 배경 구획을 찾지 못했습니다");
  const context = {};
  vm.runInNewContext(source.slice(start, end) + `
    this.out = { normalizeBoardPattern, boardPatternPreset, boardPatternAutoColor, BOARD_PATTERNS,
                 normalizeBoardImage, boardImageBox, BOARD_IMAGE_MAX_EDGE, BOARD_IMAGE_MAX_CHARS, BOARD_IMAGE_FITS };`,
    context, { filename:"state.js" });
  return context.out;
})();

test("무늬 설정은 이름·간격·진하기를 늘 같은 모양으로 맞춘다", () => {
  const grid = normalizeBoardPattern({ id:"grid" });
  assert.equal(grid.id, "grid");
  assert.equal(grid.size, boardPatternPreset("grid").size);   // 무늬마다 알맞은 기본 간격
  assert.equal(grid.color, "");                               // "" = 배경색에 맞춰 자동
  assert.ok(grid.opacity > 0 && grid.opacity <= 1);
  // 간격은 읽을 수 있는 범위로 조인다(0에 가까우면 새까맣게 뭉치고, 너무 크면 칸이 안 보인다).
  assert.equal(normalizeBoardPattern({ id:"grid", size:0 }).size, 12);
  assert.equal(normalizeBoardPattern({ id:"grid", size:9999 }).size, 160);
  assert.equal(normalizeBoardPattern({ id:"staff", size:"" }).size, boardPatternPreset("staff").size);
});

test("무늬 없음·모르는 이름·손상된 값은 모두 무늬 없음(null)이다", () => {
  // 무늬가 없던 시절의 스냅샷이 그리기 코드까지 흘러가면 안 된다.
  assert.equal(normalizeBoardPattern(null), null);
  assert.equal(normalizeBoardPattern({ id:"none" }), null);
  assert.equal(normalizeBoardPattern({ id:"모눈" }), null);
  assert.equal(normalizeBoardPattern("grid").id, "grid");     // 이름만 준 옛 형태도 받아 준다
});

test("무늬 색 자동은 배경과 대비가 큰 쪽을 고른다", () => {
  assert.equal(boardPatternAutoColor("#ffffff"), "#1f2937");  // 흰 종이엔 짙은 선
  assert.equal(boardPatternAutoColor("#0f5132"), "#ffffff");  // 칠판엔 밝은 선
});

test("무늬는 보드 스냅샷에 담겨 되살아난다", () => {
  const state = boardStateFromSnapshot({ version:1, bg:"#ffffff", bgPattern:{ id:"graph", size:40, originX:100, originY:80 }, items:[] });
  assert.equal(state.bgPattern.id, "graph");
  assert.deepEqual([state.bgPattern.originX, state.bgPattern.originY], [100, 80]);
  // 무늬가 없던 옛 스냅샷은 그대로 무늬 없음.
  assert.equal(boardStateFromSnapshot({ version:1, bg:"#ffffff", items:[] }).bgPattern, null);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /bgPattern:wb\.bgPattern,/);              // boardSnapshot 이 무늬를 담는다
  // 배경색과 마찬가지로 되돌리기 단계가 아니라 복구 스냅샷에 바로 남는다.
  const commit = wb.slice(wb.indexOf("const commitPattern = (next)"));
  assert.match(commit.slice(0, 420), /scheduleBoardRecovery\(\);/);
  assert.doesNotMatch(commit.slice(0, 420), /history\.commit\(\)/);
});

test("지우개는 배경색 덧칠이 아니라 진짜 지우기다", () => {
  // 배경이 무늬면 배경색으로 덧칠한 지우개가 모눈 위에 단색 얼룩을 남긴다.
  const render = read("src/js/board-render.js");
  assert.match(render, /it\.type === "eraser"\)\{[\s\S]{0,160}globalCompositeOperation = "destination-out"/);
  assert.doesNotMatch(render, /ctx\.strokeStyle = bg/);
  // 뚫어 놓은 합성 모드를 되돌리지 않으면 다음 항목이 화면을 갉아먹는다.
  assert.match(render, /ctx\.globalCompositeOperation = "source-over";\s*\}/);
});

test("배경은 판서를 다 그린 뒤 맨 밑에 깐다", () => {
  // 먼저 칠하면 지우개(destination-out)가 배경까지 뚫어 내보낸 PNG 에 구멍이 남는다.
  const render = read("src/js/board-render.js");
  assert.match(render, /function paintBackground\(ctx, area, opts\)\{[\s\S]{0,400}globalCompositeOperation = "destination-over"/);

  const wb = read("src/js/whiteboard.js");
  const redraw = wb.slice(wb.indexOf("const redraw = () => {"), wb.indexOf("const restoreBoardImages"));
  assert.match(redraw, /clearRect\(0, 0, W, H\)/);
  assert.doesNotMatch(redraw, /fillStyle = wb\.bg/);
  assert.ok(redraw.indexOf("paintBoardBackground()") > redraw.indexOf("drawGear()"), "배경은 판서·교구보다 나중에 깔려야 한다");

  // 재생 화면도 같은 순서여야 판서 화면과 픽셀이 맞는다.
  const replay = read("src/js/lesson-replay.js");
  const board = replay.slice(replay.indexOf("function renderReplay"));
  assert.ok(board.indexOf("paintBackground") > board.indexOf("MNBoardRenderer.drawItems"));
});

test("문지르는 중인 지우개도 뚫린 자리에 배경을 바로 다시 깐다", () => {
  // 안 그러면 지우는 동안 모눈이 사라졌다가 손을 뗄 때 돌아오는 깜빡임이 보인다.
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /if \(cur\.type === "eraser"\) paintBoardBackground\(\);/);
});

test("무늬 고르기 칸이 배경 판에 있고 새 보드 기본값은 설정에 실린다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /class = "wb-bg-patterns"|className = "wb-bg-patterns"/);
  assert.match(wb, /function setPatternId\(id\)/);
  // 좌표평면 축은 고른 순간 화면 가운데에 보드 좌표로 붙박는다(창 크기를 바꿔도 판서와 함께 있다).
  assert.match(wb, /next\.originX = Math\.round\(center\.x\)/);

  const app = read("src/js/app.js");
  assert.match(app, /boardPattern: boardPatternDraft,/);
  assert.match(app, /boardPatternDraft = normalizeBoardPattern\(appSettings\.boardPattern\)/);

  const state = read("src/js/state.js");
  assert.match(state, /boardPattern:normalizeBoardPattern\(saved\.boardPattern\)/);
  assert.match(state, /boardPattern:normalizeBoardPattern\(merged\.boardPattern\)/);

  // 무늬 이름은 한 곳(BOARD_PATTERNS)에서만 정의하고 UI 는 그 목록을 읽어 만든다.
  assert.ok(BOARD_PATTERNS.length >= 6);
  assert.match(wb, /typeof BOARD_PATTERNS !== "undefined" \? BOARD_PATTERNS : \[\]/);
});

// ── 배경 그림(사진·학습지 스캔) ────────────────────────────────────────
test("배경 그림은 data URL 만 받는다", () => {
  // 바깥 주소를 그대로 두면 자동복원 스냅샷이 그 주소에 매여, 인터넷 없는 다음 수업에 빈 칸이 된다.
  assert.equal(normalizeBoardImage({ src:"https://example.com/a.png", w:10, h:10 }), null);
  assert.equal(normalizeBoardImage({ src:"javascript:alert(1)" }), null);
  assert.equal(normalizeBoardImage(null), null);
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,AAAA", w:800, h:600 }).src, "data:image/png;base64,AAAA");
});

test("배경 그림 설정은 맞춤 방식·흐리기·상자를 늘 같은 모양으로 맞춘다", () => {
  const image = normalizeBoardImage({ src:"data:image/png;base64,AAAA" });
  assert.equal(image.fit, "cover");                 // 모르는 방식은 채움으로
  assert.equal(image.opacity, 1);
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", fit:"엉뚱" }).fit, "cover");
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", opacity:0 }).opacity, .05);
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", opacity:9 }).opacity, 1);
  // Number("")===0 함정: 빈 값은 "안 정함"이지 0 이 아니다.
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", opacity:"" }).opacity, 1);
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", w:"" }).w, 1);
});

test("맞춤 방식은 그림이 놓일 상자를 정한다 — 채움은 화면 그대로, 맞춤은 비율 유지", () => {
  const area = { x:0, y:0, w:1000, h:500 };
  // vm 안에서 만든 객체는 프로토타입이 달라 deepEqual 이 그대로는 안 맞는다 — 펼쳐서 이쪽 객체로 옮긴다.
  const box = (...args) => ({ ...boardImageBox(...args) });
  assert.deepEqual(box("cover", area, 800, 800), { x:0, y:0, w:1000, h:500 });
  // 맞춤: 정사각형 그림은 짧은 변(500)에 맞춰 들어가고 가운데 온다.
  assert.deepEqual(box("contain", area, 800, 800), { x:250, y:0, w:500, h:500 });
  // 원본: 원래 크기 그대로 가운데.
  assert.deepEqual(box("actual", area, 400, 200), { x:300, y:150, w:400, h:200 });
});

test("배경 그림은 넣을 때 다시 인코딩해 자동복원 용량을 지킨다", () => {
  // 요즘 사진 한 장(5~10MB)을 그대로 실으면 localStorage 자동복원본이 그 한 장으로 꽉 찬다.
  assert.ok(BOARD_IMAGE_MAX_EDGE <= 1600);
  assert.ok(BOARD_IMAGE_MAX_CHARS <= 2 * 1000 * 1000);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const encodeBoardBackgroundImage = \(img, sourceType\) =>/);
  assert.match(wb, /if \(src\.length <= boardImageMaxChars\(\)\) break;/);
  // JPEG 는 투명한 자리를 검게 칠한다 — 뚫린 그림은 PNG 로 남겨야 배경색이 비친다.
  assert.match(wb, /transparent \? canvasEl\.toDataURL\("image\/png"\) : canvasEl\.toDataURL\("image\/jpeg"/);
  // 그래도 못 담으면 조용히 넘기지 말고 알린다(자동복원이 소리 없이 끊기는 걸 막는다).
  assert.match(wb, /boardRecoveryWarned = true;[\s\S]{0,220}자동복원본을 남기지 못했어요/);
});

test("배경 그림 상자는 넣을 때 정해 보드 좌표에 붙박는다", () => {
  const wb = read("src/js/whiteboard.js");
  // 창 크기(W·H)를 따라 매번 다시 계산하면 창을 줄일 때 그림만 움직여 그 위에 쓴 판서와 어긋난다.
  const redraw = wb.slice(wb.indexOf("const redraw = () => {"), wb.indexOf("const restoreBoardImages"));
  assert.doesNotMatch(redraw, /boardImageBox/);
  assert.match(wb, /function setBackgroundImageFit\(fit, options=\{\}\)/);   // 다시 맞추기는 손으로
  assert.match(wb, /bgImage:wb\.bgImage \? \{ \.\.\.wb\.bgImage, img:undefined \} : null,/);   // <img> 는 빼고 저장
  assert.match(wb, /restoreBoardBackgroundImage\(\)/);                          // 열 때 다시 불러온다
});

test("배경 그림은 색과 무늬 사이에 깔린다", () => {
  // 화면에서 보이는 위아래는 색 → 그림 → 무늬 → 판서. destination-over 는 그리는 차례가 아래로
  // 쌓이는 차례라 코드 순서가 반대여야 한다.
  const render = read("src/js/board-render.js");
  const paint = render.slice(render.indexOf("function paintBackground(ctx, area, opts)"));
  const body = paint.slice(0, paint.indexOf("ctx.restore();"));
  assert.ok(body.indexOf("drawPattern") < body.indexOf("drawBackgroundImage"), "무늬가 그림 위에 있어야 한다");
  assert.ok(body.indexOf("drawBackgroundImage") < body.indexOf("ctx.fillRect"), "그림이 배경색 위에 있어야 한다");
});

test("타일 배경은 칸 크기를 따로 담고 보드 원점에 맞춰 반복된다", () => {
  assert.ok(BOARD_IMAGE_FITS.some((fit) => fit.id === "tile"));
  const tiled = normalizeBoardImage({ src:"data:image/png;base64,A", fit:"tile" });
  assert.equal(tiled.tile, 50);                       // 기본 칸 크기(원본 대비 %)
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", fit:"tile", tile:999 }).tile, 200);
  assert.equal(normalizeBoardImage({ src:"data:image/png;base64,A", fit:"tile", tile:"" }).tile, 50);
  // 타일이 아닌 배치에는 칸 크기가 붙지 않는다(뜻이 없는 값이 스냅샷에 남지 않게).
  assert.equal("tile" in normalizeBoardImage({ src:"data:image/png;base64,A", fit:"cover" }), false);
  // 상자는 원본 크기 그대로 — 타일은 "어디에"가 아니라 "얼마나 촘촘히"의 문제다.
  assert.deepEqual({ ...boardImageBox("tile", { x:0, y:0, w:1000, h:500 }, 400, 200) }, { x:300, y:150, w:400, h:200 });

  const render = read("src/js/board-render.js");
  assert.match(render, /createPattern\(img, "repeat"\)/);
  // 칸을 줄이는 건 pattern.setTransform — 없는 환경(옛 브라우저)에서도 원본 크기로 깔리게 감싼다.
  assert.match(render, /typeof DOMMatrix === "function" && typeof pattern\.setTransform === "function"/);
});

test("선택한 그림을 배경으로 내리면 항목에서 빠지고 그 자리에 그대로 깔린다", () => {
  const wb = read("src/js/whiteboard.js");
  const body = wb.slice(wb.indexOf("const sendSelectedToBackground"), wb.indexOf("const pickBackgroundImage"));
  // 복사가 아니라 옮기기 — 같은 그림이 배경과 항목으로 겹치면 어느 쪽을 잡는지 알 수 없다.
  assert.match(body, /wb\.items = wb\.items\.filter\(\(other\) => other !== item\)/);
  // 항목이 사라지는 건 삭제와 같은 편집이라 되돌리기 단계로 남긴다.
  assert.match(body, /history\.commit\(\);/);
  // 놓일 자리는 그림이 있던 자리 그대로 — 배경으로 내려가며 위치가 튀지 않는다.
  assert.match(body, /x:Math\.round\(item\.x\), y:Math\.round\(item\.y\), w:Math\.round\(item\.w\), h:Math\.round\(item\.h\)/);
  // 붙여넣은 그림은 원본 그대로라 클 수 있다 — 배경으로 갈 때도 같은 상한을 태운다.
  assert.match(body, /encodeBoardBackgroundImage\(img, ""\)/);
  // 그림에만 보여 준다.
  assert.match(wb, /contextToBackgroundBtn\.hidden=!\(selected&&selected\.type==="image"&&selected\.src\)/);
});
