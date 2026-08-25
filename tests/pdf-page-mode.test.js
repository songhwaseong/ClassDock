"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "../src/js/pdf-render.js"), "utf8");

/* 보기 방식(이어보기 ↔ 한 장씩) 조각만 떼어 실제로 돌려 본다. 나머지(렌더 큐·페이지 표시줄)는
   이 조각이 부르는 바깥 함수라 가짜로 세워 두고, 무엇을 몇 번 불렀는지로 동작을 확인한다. */
function loadPageMode(opts = {}){
  const start = SOURCE.indexOf("const PDF_PAGE_MODE_KEY");
  assert.ok(start >= 0, "보기 방식 조각을 찾을 수 있어야 한다");
  const calls = { render:[], released:[], text:[], zoom:[], indicator:0, lazy:0, toast:[] };
  const context = {
    calls,
    localStorage: { _v: opts.stored || null, getItem(){ return this._v; }, setItem(k, v){ this._v = v; } },
    window: { t: (s) => s },
    activeId: null,
    state: null,
    byId: () => null,
    toast: (m) => calls.toast.push(m),
    requestPageRender: (doc, p) => calls.render.push(p.pageNum),
    schedulePdfTextLinks: (doc, p) => calls.text.push(p.pageNum),
    releasePageCanvas: (p) => calls.released.push(p.pageNum),
    releasePdfTextLinks: () => {},
    pdfRenderQueue: () => ({ pending: new Set() }),
    updatePdfPageIndicator: () => { calls.indicator++; },
    refreshPdfSelHighlight: () => {},
    setPdfZoom: (z, doc) => { calls.zoom.push(z); doc.zoom = z; },
    currentPageIndex: (doc) => doc.__flowIndex || 0,
    goToPdfPage: (doc, n) => { doc.__wentTo = n; },
    startLazyRender: () => { calls.lazy++; },
    updatePdfPageModeButton: () => {},
    fullscreenPdfTarget: () => null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE.slice(start) + `
    ;globalThis.__mode = { pdfStoredPageMode, pdfIsSinglePage, pdfSingleIndex, pdfFitPageZoom,
      syncPdfSingleRender, showPdfSinglePage, stepPdfSinglePage, setPdfPageMode, applyStoredPdfPageMode,
      pdfFitPageIfPending };`, context);
  return { api: context.__mode, calls, context };
}

// 페이지 8장짜리 가짜 PDF 문서. 프레임은 클래스만 기억하면 되므로 최소한으로 세운다.
function fakePdfDoc(count = 8, size = {}){
  const classes = [];
  const pages = Array.from({ length: count }, (_, i) => ({
    pageNum: i + 1,
    cssW: size.cssW == null ? 900 : size.cssW,
    cssH: size.cssH == null ? 1270 : size.cssH,
    visible: false,
    frame: {
      classList: {
        toggle(name, on){ classes[i] = on ? name : ""; },
        remove(){ classes[i] = ""; }
      }
    }
  }));
  return {
    doc: { id: 1, kind: "pdf", pages, zoom: 1, el: { classList:{ toggle(){} }, scrollTop: 40, clientWidth: 1000, clientHeight: 800 } },
    classes
  };
}

test("한 장씩 보기는 현재 쪽만 남기고 앞뒤 한 장만 미리 그린다", () => {
  const { api, calls } = loadPageMode();
  const { doc, classes } = fakePdfDoc(8);
  doc.pageMode = "single";

  api.showPdfSinglePage(doc, 4);
  assert.equal(doc.singleIndex, 4);
  // 지금 쪽에만 표를 단다 — CSS 가 이 클래스로 나머지를 감춘다.
  assert.deepEqual(classes.map(Boolean), [false, false, false, true, false, false, false, false].map((v, i) => i === 4));
  // 4번 자리(5쪽)와 그 이웃만 그린다.
  assert.deepEqual(calls.render.sort((a, b) => a - b), [4, 5, 6]);
  // 나머지는 캔버스를 돌려준다 — 감춘 페이지의 캔버스를 들고 있을 까닭이 없다.
  assert.deepEqual(calls.released.sort((a, b) => a - b), [1, 2, 3, 7, 8]);
  // 글자 층은 실제로 보는 쪽에만 세운다.
  assert.deepEqual(calls.text, [5]);
  // 확대 재렌더(refreshVisibleQuality)가 보는 값도 지금 쪽만 참이어야 한다.
  assert.deepEqual(doc.pages.map(p => p.visible), doc.pages.map((_, i) => i === 4));
  // 새 쪽은 늘 맨 위에서 시작한다.
  assert.equal(doc.el.scrollTop, 0);
});

test("넘기기는 양 끝에서 멈추고 범위 밖 값은 눌러 담는다", () => {
  const { api } = loadPageMode();
  const { doc } = fakePdfDoc(3);
  doc.pageMode = "single";

  api.showPdfSinglePage(doc, 0);
  api.stepPdfSinglePage(doc, -1);
  assert.equal(doc.singleIndex, 0, "첫 쪽에서 뒤로 가도 그대로");
  api.stepPdfSinglePage(doc, 1);
  assert.equal(doc.singleIndex, 1);
  api.showPdfSinglePage(doc, 99);
  assert.equal(doc.singleIndex, 2, "마지막 쪽으로 눌러 담는다");
  assert.equal(api.pdfSingleIndex(doc), 2);
});

/* 페이지 크기는 가로 폭에만 맞춰 잡히므로(createPagePlaceholder) A4 는 세로가 화면보다 크다.
   그대로 두면 한 장씩 넘겨도 그 안에서 또 스크롤해야 해서 넘기는 뜻이 없다. */
test("페이지 맞춤 배율은 세로·가로 가운데 더 빡빡한 쪽에 맞춘다", () => {
  const { api } = loadPageMode();
  // 세로가 모자란 경우: (800-30)/1270 = 0.606…
  const tall = fakePdfDoc(2, { cssW: 900, cssH: 1270 }).doc;
  tall.pageMode = "single";
  assert.equal(api.pdfFitPageZoom(tall), 0.60);
  // 가로가 더 모자란 경우: (1000-24)/2000 = 0.488 < (800-30)/900
  const wide = fakePdfDoc(2, { cssW: 2000, cssH: 900 }).doc;
  wide.pageMode = "single";
  assert.equal(api.pdfFitPageZoom(wide), 0.48);
  // 크기를 아직 모르는 문서에서는 손대지 않는다(배율을 0 으로 만들지 않게).
  const empty = fakePdfDoc(1, { cssW: 0, cssH: 0 }).doc;
  empty.pageMode = "single";
  assert.equal(api.pdfFitPageZoom(empty), null);
});

test("페이지 맞춤은 스크롤바 경계의 두 높이에서 같은 안전 배율로 수렴한다", () => {
  const { api } = loadPageMode();
  const doc = fakePdfDoc(1, { cssW: 1200, cssH: 675 }).doc;
  doc.pageMode = "single";
  doc.el.clientWidth = 1208;

  // 스크롤바가 없을 때 반올림하면 0.99가 되어 1188px + 좌우 여유 24px가
  // 1208px을 넘는다. 가로 스크롤바가 생겨 높이가 15px 줄면 0.98로 바뀌고,
  // 스크롤바가 사라진 뒤 다시 0.99가 되는 것이 실제 흔들림의 피드백 고리였다.
  doc.el.clientHeight = 709;
  const withoutScrollbar = api.pdfFitPageZoom(doc);
  doc.el.clientHeight = 694;
  const withScrollbar = api.pdfFitPageZoom(doc);

  assert.equal(withoutScrollbar, 0.98);
  assert.equal(withScrollbar, 0.98);
  assert.ok(doc.pages[0].cssW * withoutScrollbar + 24 <= doc.el.clientWidth);
});

test("한 장씩 보기로 들어가면 페이지 맞춤으로 맞추고 나올 때 들어가기 전 배율로 되돌린다", () => {
  const { api, calls } = loadPageMode();
  const { doc } = fakePdfDoc(6);
  doc.zoom = 1.25;
  doc.__flowIndex = 2;                 // 이어보기에서 3쪽을 보고 있었다

  api.setPdfPageMode(doc, "single");
  assert.equal(doc.pageMode, "single");
  assert.equal(doc.singleIndex, 2, "보고 있던 쪽에서 이어서 넘긴다");
  assert.equal(doc.zoomBeforeSingle, 1.25);
  assert.equal(calls.zoom[0], 0.60, "들어갈 때 한 번 페이지 맞춤");

  doc.zoom = 2;                        // 한 장씩 보는 동안 사용자가 확대했다
  api.setPdfPageMode(doc, "flow");
  assert.equal(doc.pageMode, "flow");
  assert.equal(calls.zoom[calls.zoom.length - 1], 1.25, "나올 때 들어가기 전 배율로");
  assert.equal(doc.zoomBeforeSingle, null);
  assert.equal(doc.__wentTo, 3, "보던 쪽 자리로 스크롤해 준다");
  assert.equal(calls.lazy, 1, "이어보기로 돌아가면 교차 관찰을 다시 건다");
});

/* 파일을 여럿 한꺼번에 열면 배경 문서의 칸은 0×0 이라 맞출 크기가 없다. 그때 그냥 넘기면
   그 PDF 만 폭 기준 배율로 남아, 한 장씩 넘겨도 한 장이 화면에 안 들어온다. */
test("배경에서 열려 못 맞춘 페이지 맞춤은 화면에 놓인 뒤에 한 번 해 준다", () => {
  const { api, calls } = loadPageMode();
  const { doc } = fakePdfDoc(4);
  doc.el.clientHeight = 0;                     // 아직 화면에 놓이지 않은 문서
  doc.el.clientWidth = 0;

  api.setPdfPageMode(doc, "single");
  assert.equal(calls.zoom.length, 0, "맞출 크기가 없으면 배율을 건드리지 않는다");
  assert.equal(doc.needsPageFit, true);

  doc.el.clientHeight = 800; doc.el.clientWidth = 1000;
  api.pdfFitPageIfPending(doc);
  assert.deepEqual(calls.zoom, [0.60]);
  assert.equal(doc.needsPageFit, false);
  api.pdfFitPageIfPending(doc);
  assert.equal(calls.zoom.length, 1, "한 번 맞춘 뒤에는 다시 손대지 않는다(사용자 확대를 덮지 않게)");
});

test("보기 방식은 문서가 아니라 화면 환경설정으로 모든 PDF 가 이어 쓴다", () => {
  const plain = loadPageMode();
  assert.equal(plain.api.pdfStoredPageMode(), "flow", "기본은 이어보기");
  const saved = loadPageMode({ stored: "single" });
  assert.equal(saved.api.pdfStoredPageMode(), "single");
  const { doc } = fakePdfDoc(4);
  saved.api.applyStoredPdfPageMode(doc);
  assert.equal(doc.pageMode, "single", "새로 연 PDF 도 지난번에 고른 방식으로 시작한다");
  // 페이지가 아직 없는 문서에는 걸지 않는다(맞출 크기가 없다).
  const bare = { kind:"pdf", pages:[] };
  saved.api.applyStoredPdfPageMode(bare);
  assert.equal(bare.pageMode, undefined);
});

/* 감춘 페이지로는 스크롤할 수 없다. 페이지로 뛰는 길이 여럿인데(페이지 입력·썸네일·목차·검색·
   코드 핀) 한 군데라도 스크롤만 하면 그 길은 한 장씩 보기에서 조용히 먹통이 된다. */
test("페이지로 뛰는 길은 모두 한 장씩 보기를 거친다", () => {
  const editor = fs.readFileSync(path.join(__dirname, "../src/js/pdf-editor.js"), "utf8");
  const pages = fs.readFileSync(path.join(__dirname, "../src/js/pdf-pages.js"), "utf8");
  // 페이지 번호 입력·책갈피가 함께 쓰는 문(goToPdfPage)
  assert.match(editor, /pdfIsSinglePage\(doc\)\)\{ showPdfSinglePage\(doc, idx\); return; \}/);
  // 현재 쪽 판정도 기하가 아니라 고른 값으로
  assert.match(editor, /if \(typeof pdfIsSinglePage === "function" && pdfIsSinglePage\(doc\)\) return pdfSingleIndex\(doc\)/);
  // 찾기 결과 · 코드 링크 핀
  assert.match(editor, /const at = doc\.pages\.indexOf\(mt\.p\);[\s\S]{0,120}?showPdfSinglePage\(doc, at\)/);
  assert.match(editor, /pdfIsSinglePage\(pdfDoc\)\)\{[\s\S]{0,220}?showPdfSinglePage\(pdfDoc, at\)/);
  // 썸네일 · 목차
  assert.equal((pages.match(/showPdfSinglePage\(/g) || []).length, 2);
  // 이어보기의 부드러운 스크롤은 그대로 남는다(기존 동작을 바꾸지 않는다).
  assert.equal((pages.match(/scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/g) || []).length, 2);
});

test("한 장씩 보기에서는 교차 관찰 대신 직접 그릴 쪽을 고른다", () => {
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  // 감춘 페이지는 영원히 '안 보임'이라 관찰로는 아무것도 알 수 없다.
  const lazy = /function startLazyRender\(doc\)\{([\s\S]*?)\n\}/.exec(SOURCE);
  assert.ok(lazy);
  assert.match(lazy[1], /if \(pdfIsSinglePage\(doc\)\)\{\s*\n\s*syncPdfSingleRender\(doc\);/);
  // 감춘 쪽은 자리째 빠져야 "한 장"이 된다(스크롤 높이에 남으면 빈 여백이 생긴다).
  assert.match(styles, /\.viewer\.pdf-single-page \.page-frame\{display:none\}/);
  assert.match(styles, /\.viewer\.pdf-single-page \.page-frame\.is-current-page\{display:block\}/);
  // 컨트롤은 머리글과 전체화면 양쪽에 있어야 한다 — 발표 중에는 전체화면 쪽이 유일한 길이다.
  for (const id of ["btnPdfPageMode", "pagePrev", "pageNext", "fsPagePrev", "fsPageNext"])
    assert.ok(html.includes('id="' + id + '"'), id + " 컨트롤이 없다");
  // 넘기기 단추는 한 장씩 볼 때만 내놓는다.
  assert.match(SOURCE, /prev\.hidden = !single; prev\.disabled = index <= 0/);
  assert.match(SOURCE, /next\.hidden = !single; next\.disabled = index >= last/);
  /* 아이콘은 인라인 SVG 여야 한다 — 이모지는 글꼴에 따라 빈 네모로 나오거나 그려지지 않아
     무슨 단추인지 알 수 없게 된다(실제로 그렇게 보였다). */
  const mode = /<button id="btnPdfPageMode"[\s\S]*?<\/button>/.exec(html);
  assert.ok(mode, "보기 방식 단추를 찾지 못했다");
  assert.equal((mode[0].match(/<svg /g) || []).length, 2, "누르기 전·후 아이콘 두 벌");
  assert.doesNotMatch(html, /id="(btnPdfPageMode|pagePrev|pageNext|fsPagePrev|fsPageNext)"[^>]*>\s*[^<\s]/,
    "단추 안에 글자·이모지를 직접 넣지 않는다");
  // 두 벌 가운데 하나만 보이게 하는 규칙(전체화면 단추와 같은 '누르면 이렇게 된다' 아이콘).
  assert.match(styles, /\.page-mode-btn \.page-mode-flow\{display:none\}/);
  assert.match(styles, /\.page-mode-btn\.is-on \.page-mode-single\{display:none\}/);
  assert.match(styles, /\.page-mode-btn svg,\.page-step-btn svg\{display:block/);
  for (const label of ["한 장씩 보기 — 페이지를 한 장씩 넘겨 봅니다", "이어보기로 — 페이지를 스크롤해서 봅니다", "이전 페이지 (PageUp)"])
    assert.ok(i18n.includes('"' + label + '"'), "사전에 없다: " + label);
});

/* 분할 작업에서는 두 칸이 저마다 PDF 일 수 있고 한쪽만 한 장씩 볼 수도 있다. 칸마다 제 알약을
   갖고, 그 알약은 반드시 제 칸의 문서만 조작해야 한다 — 남의 칸을 건드리면 조용히 엉뚱한
   문서가 넘어간다. 참고 칸은 .study-page-ctl, 작업 칸은 .view-page-ctl 이 맡는다. */
test("분할 작업은 두 칸 모두 제 알약으로 보기 방식·넘기기를 다룬다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  const docsSrc = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "../src/js/pdf-editor.js"), "utf8");

  // 참고 칸 알약에도 같은 단추 세 개가 있어야 한다.
  const pill = /<div class="study-page-ctl"[\s\S]*?<\/div>/.exec(html);
  assert.ok(pill, "참고 칸 알약을 찾지 못했다");
  for (const id of ["btnStudyPageMode", "studyPagePrev", "studyPageNext"])
    assert.ok(pill[0].includes('id="' + id + '"'), id + " 단추가 참고 칸 알약에 없다");
  assert.match(styles, /non-pdf-ref #btnStudyPageMode/);   // 참고가 PDF 가 아니면 함께 감춘다

  /* 작업 칸 알약은 분할 중 감춰져 있었다(display:none). 작업 칸이 PDF 면 그 칸 위에 되살리고,
     참고 칸 알약과 반대편 모서리에 놓아 겹치지 않게 한다(위치 교체·상하 분할까지). */
  assert.match(styles, /#content\.study-mode \.view-page-ctl\{display:none\}/);
  assert.match(styles, /#content\.study-mode\.pdf-active \.view-page-ctl\{display:inline-flex;right:10px\}/);
  assert.match(styles, /#content\.study-mode\.study-swapped\.pdf-active \.view-page-ctl\{right:calc\(100% - var\(--study-split,50%\) \+ 10px\)\}/);
  assert.match(styles, /#content\.study-mode\.study-stacked\.pdf-active \.view-page-ctl\{right:10px;top:calc\(var\(--study-split,50%\) \+ 10px\)\}/);
  assert.match(styles, /#content\.study-mode\.study-stacked\.study-swapped\.pdf-active \.view-page-ctl\{right:10px;top:10px\}/);
  // 전체화면은 여전히 fs 컨트롤만 쓴다 — 위 규칙보다 세므로 !important 로 못 박는다.
  assert.match(styles, /body\.viewer-fullscreen #content \.view-page-ctl\{display:none!important\}/);
  // 두 알약은 함께 흐려졌다 함께 돌아온다.
  assert.match(styles, /study-idle \.view-page-ctl\{opacity:0;pointer-events:none\}/);

  // 알약마다 보는 문서가 다르다: 작업 칸=viewPdfTarget, 참고 칸=studyReferencePdf.
  assert.match(editor, /function viewPdfTarget\(\)/);
  assert.match(editor, /function studyReferencePdf\(\)/);
  assert.match(SOURCE, /\["btnPdfPageMode", fallback\], \["btnStudyPageMode", ref \|\| fallback\]/);
  assert.match(SOURCE, /\["pagePrev", "pageNext", view\]/);
  assert.match(SOURCE, /\["studyPagePrev", "studyPageNext", ref \|\| view\]/);
  // 아직 화면에 오르지 않은 문서(doc 인자)로 분할 칸 단추를 물들이지 않는다.
  assert.match(SOURCE, /const fallback = pdfViewTarget\(\) \|\| \(ref \? null : \(doc \|\| null\)\)/);

  // 단추 배선도 칸별로.
  assert.match(app, /byId\("btnPdfPageMode"\)\.onclick = \(\) => switchPdfPageMode\(viewPdfTarget\(\)\)/);
  assert.match(app, /byId\("btnStudyPageMode"\)\.onclick = \(\) => switchPdfPageMode\(studyReferencePdf\(\)\)/);
  assert.match(app, /stepPdfSinglePage\(studyReferencePdf\(\), delta\)/);
  assert.match(app, /const pick = prevId === "pagePrev" \? viewPdfTarget : fullscreenPdfTarget/);
  // 찾기도 제 칸에서 — 분할 중 작업 칸 찾기가 참고 PDF 로 새면 안 된다.
  assert.match(app, /openPdfFind\(viewPdfTarget\(\)\)/);
  assert.match(app, /openPdfFind\(studyReferencePdf\(\)\)/);
  // 자판은 마지막에 누른 칸을 따라간다.
  assert.match(app, /studyTargetPane === "reference" \? studyReferencePdf\(\) : viewPdfTarget\(\)/);

  // 참고 칸이 바뀔 때(진입·역할 교체) 단추 상태도 다시 맞춘다.
  assert.match(docsSrc, /updatePdfPageStepButtons === "function"\) updatePdfPageStepButtons\(\)/);
  /* 폭 맞춤은 한 장씩 보기를 망친다 — A4 는 폭에 맞추면 세로가 칸보다 길어 한 장 안에서 또
     스크롤하게 된다. 참고 칸 자동 맞춤도 그 모드에서는 페이지 맞춤을 써야 한다. */
  const fit = /function fitStudyPdf\(doc\)\{([\s\S]*?)\n\}/.exec(docsSrc);
  assert.ok(fit);
  assert.match(fit[1], /pdfIsSinglePage\(doc\)\)\{\s*\n\s*refitSinglePagePdf\(doc\)/);
  assert.match(docsSrc, /function refitSinglePagePdf\(doc\)\{[\s\S]*?pdfFitPageZoom\(doc\)/);
  /* 칸 크기가 바뀌면(분할 드래그) 두 칸을 다시 맞춘다. 작업 칸은 한 장씩일 때만 — 이어보기
     중인 작업 PDF 의 배율은 사용자가 고른 값이라 덮으면 안 된다. */
  assert.match(docsSrc, /observeStudyPaneFit\(ref\);\s*\n\s*observeStudyPaneFit\(work\);/);
  const pane = /function fitStudyPanePdf\(doc\)\{([\s\S]*?)\n\}/.exec(docsSrc);
  assert.ok(pane);
  assert.match(pane[1], /doc\.id === studyPdfId\)\{ fitStudyPdf\(doc\); return; \}/);
  assert.match(pane[1], /doc\.id === activeId\) refitSinglePagePdf\(doc\)/);
  // 분할 진입 시 단독 뷰용 유휴 숨김(pdf-ctl-idle)이 남아 알약이 투명한 채로 굳지 않게 한다.
  assert.match(docsSrc, /if \(split\)\{ showStudyControls\(\); stopPdfControlsAutoHide\(\); \}/);
});
