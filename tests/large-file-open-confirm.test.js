// 큰 파일을 열기 전 확인.
// file.size 는 지금껏 "이미 열린 파일인가"를 가리는 키로만 쓰였다. 영상·백업에만 상한이 있고
// PDF·표·압축은 통째로 ArrayBuffer 에 올려서, 큰 파일 하나가 화면을 죽이면 그 파일이 아니라
// 열려 있던 다른 탭의 저장하지 않은 편집이 사라진다.
// 막지 않고 묻기만 하므로, "언제 묻고 언제 묻지 않는가"가 이 기능의 전부다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const loaders = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
const MB = 1024 * 1024;

// file-loaders.js 를 vm 에 올리고 확인 창 관련 함수만 꺼낸다(다른 테스트와 같은 방식).
function loadOpenConfirm(extra = {}){
  const asked = [];
  const context = vm.createContext(Object.assign({
    console, Blob, File, URL, TextDecoder, TextEncoder, DOMException,
    window:{}, localStorage:{ getItem:() => null, setItem(){} },
    VIDEO_EXTS:["mp4","mkv"], AUDIO_EXTS:["mp3","wav"], SQLITE_EXTS:["db","sqlite","sqlite3"],
    normalizedRunPath:(value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, ""),
  }, extra));
  new vm.Script(loaders, { filename:"file-loaders.js" }).runInContext(context);
  const api = new vm.Script(
    "({ limitBytes:openConfirmLimitBytes, sizeText:openSizeText, confirm:confirmLargeFileOpen, limits:OPEN_CONFIRM_LIMITS, fallbackMb:OPEN_CONFIRM_DEFAULT_MB })"
  ).runInContext(context);
  return { api, asked, context };
}

// 실제로 창을 띄우는 대신 무엇을 물었는지 기록하고 정해진 답을 준다.
function withDialog(answer, extra = {}){
  const asked = [];
  const loaded = loadOpenConfirm(Object.assign({
    confirmDialog:(message, okText, cancelText) => { asked.push({ message, okText, cancelText }); return Promise.resolve(answer); }
  }, extra));
  loaded.asked = asked;
  return loaded;
}

const bigFile = (name, mb) => ({ name, size:mb * MB });

test("상한은 '메모리에서 몇 배로 부푸는가'를 따른다", () => {
  const { api } = loadOpenConfirm();
  // 표가 가장 낮고 PDF 가 가장 여유롭다 — 셀 하나가 JS 객체가 되는 쪽이 가장 크게 부푼다.
  assert.ok(api.limitBytes("xlsx") < api.limitBytes("zip"));
  assert.ok(api.limitBytes("zip") < api.limitBytes("pdf"));
  assert.equal(api.limitBytes("xlsx"), api.limits.xlsx * MB);
  // 표에 없는 확장자는 공통 상한을 쓴다.
  assert.equal(api.limitBytes("txt"), api.fallbackMb * MB);
  assert.equal(api.limitBytes("hwp"), api.fallbackMb * MB);
});

test("스트리밍으로 읽거나 런처가 읽는 형식은 묻지 않는다", () => {
  const { api } = loadOpenConfirm();
  // 영상·오디오는 <video> 가 흘려 읽고 이미 1GB 상한이 따로 있다.
  for (const ext of ["mp4", "mkv", "mp3", "wav"]) assert.equal(api.limitBytes(ext), 0, ext);
  // sqlite 는 런처가 디스크에서 직접 읽어 브라우저 메모리에 올리지 않는다.
  for (const ext of ["db", "sqlite", "sqlite3"]) assert.equal(api.limitBytes(ext), 0, ext);
});

test("크기 표기는 GB 까지 읽히게 쓴다", () => {
  const { api } = loadOpenConfirm();
  assert.equal(api.sizeText(150 * MB), "150MB");
  assert.equal(api.sizeText(2048 * MB), "2.0GB");
  assert.equal(api.sizeText(0), "0MB");
});

test("상한을 넘으면 이름과 크기를 보여 주고 묻는다", async () => {
  const { api, asked } = withDialog(true);
  assert.equal(await api.confirm(bigFile("성적.xlsx", 60), "xlsx", {}), true);
  assert.equal(asked.length, 1);
  assert.match(asked[0].message, /성적\.xlsx/);
  assert.match(asked[0].message, /60MB/);
  // 무엇을 잃을 수 있는지까지 알려 준다 — 그게 이 창이 있는 이유다.
  assert.match(asked[0].message, /저장하지 않은/);
  assert.equal(asked[0].okText, "그래도 열기");
  assert.equal(asked[0].cancelText, "열지 않기");
});

test("열지 않기를 고르면 그 파일은 열지 않는다", async () => {
  const { api, asked } = withDialog(false);
  assert.equal(await api.confirm(bigFile("자료.zip", 300), "zip", {}), false);
  assert.equal(asked.length, 1);
});

test("상한 아래면 묻지 않는다", async () => {
  const { api, asked } = withDialog(true);
  assert.equal(await api.confirm(bigFile("성적.xlsx", 39), "xlsx", {}), true);
  assert.equal(await api.confirm(bigFile("보고서.pdf", 300), "pdf", {}), true);   // PDF 는 400MB 까지 여유
  assert.equal(await api.confirm(bigFile("영화.mp4", 3000), "mp4", {}), true);    // 영상은 상한 없음
  assert.equal(asked.length, 0);
});

test("사용자가 그 자리에 없는 열기에는 묻지 않는다", async () => {
  const { api, asked } = withDialog(true);
  const huge = bigFile("성적.xlsx", 900);
  // 복원은 시작할 때 저절로 일어난다 — 창을 띄우면 복원이 멈춘다.
  assert.equal(await api.confirm(huge, "xlsx", { restoreFromWorkspace:true }), true);
  // 앱이 만든 문서(새 코드 파일 등)와 임시 문서.
  assert.equal(await api.confirm(huge, "xlsx", { isScratch:true }), true);
  assert.equal(await api.confirm(huge, "xlsx", { transient:true }), true);
  // 폴더·압축 안의 파일 — 파일마다 창을 띄우면 진행이 막힌다.
  assert.equal(await api.confirm(huge, "xlsx", { parentId:"g1" }), true);
  assert.equal(await api.confirm(huge, "xlsx", { archiveCtx:{} }), true);
  assert.equal(asked.length, 0, "이 경로들에서는 한 번도 묻지 않아야 한다");
});

test("확인 창을 쓸 수 없으면 예전처럼 그냥 연다", async () => {
  // confirmDialog 는 file-loaders 보다 나중에 로드되는 파일에 있다. 없다고 열기를 막으면 안 된다.
  const { api } = loadOpenConfirm();
  assert.equal(await api.confirm(bigFile("성적.xlsx", 900), "xlsx", {}), true);
});

test("영어로 쓰는 중이면 문구도 단추도 영어로 묻는다", async () => {
  const { api, asked } = withDialog(true, {
    MNI18N:{ t:(ko) => ({ "그래도 열기":"Open anyway", "열지 않기":"Don't open" }[ko] || ko),
      tf:(tmpl, vars) => "'" + vars.name + "' is large (" + vars.size + ")." }
  });
  await api.confirm(bigFile("grades.xlsx", 60), "xlsx", {});
  assert.equal(asked[0].message, "'grades.xlsx' is large (60MB).");
  assert.equal(asked[0].okText, "Open anyway");
  assert.equal(asked[0].cancelText, "Don't open");
});

test("영어 사전에 이 창의 문구가 모두 들어 있다", () => {
  // confirmDialog 는 받은 글을 그대로 DOM 에 써서 번역 스캔을 거치지 않는다 — 사전에 없으면 한국어로 남는다.
  const i18n = fs.readFileSync(path.join(root, "src/js/i18n.js"), "utf8");
  assert.match(i18n, /"'\{name\}'은\(는\) \{size\}로 큽니다\./);
  assert.match(i18n, /"그래도 열기": "Open anyway"/);
  assert.match(i18n, /"열지 않기": "Don't open"/);
});

test("이미 열린 파일을 가려낸 뒤에 묻는다", () => {
  // 다시 누른 것뿐인데 경고를 보면 안 된다. 중복 판정(workspaceFindOpenDocument)이 먼저다.
  const duplicateAt = loaders.indexOf("const duplicate = await workspaceFindOpenDocument");
  const confirmAt = loaders.indexOf("if (!await confirmLargeFileOpen(file, ext, opts)) continue;");
  assert.ok(duplicateAt > 0 && confirmAt > 0);
  assert.ok(duplicateAt < confirmAt, "중복 판정이 확인 창보다 먼저여야 한다");
  // 그리고 실제 읽기(arrayBuffer)보다는 앞이어야 한다 — 물어보기 전에 이미 올려 버리면 의미가 없다.
  assert.ok(confirmAt < loaders.indexOf('if (ext === "pdf") await loadPdf(await file.arrayBuffer()'));
});
