const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { decodeWorkspace, fingerprintBytes } = require("../src/js/core.js");

function loadBrowserScript(file, extra={}){
  const context = vm.createContext({ console, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, ...extra });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8"), context, { filename:file });
  return context;
}

function pen(points=[{ x:1, y:2 }, { x:3, y:4 }]){
  return { type:"pen", color:"#111", width:2, points };
}

test(".lesson 입력은 정상 리플레이만 받아들이고 손상된 장면은 거부한다", () => {
  const { validateLessonPayload } = loadBrowserScript("lesson-replay.js");
  const valid = {
    format:"classdock-lesson", version:1, kind:"board", duration:120, W:1280, H:720,
    keyframes:[{ t:0, s:[] }, { t:120, a:pen() }]
  };
  assert.equal(validateLessonPayload(valid).ok, true);
  assert.equal(validateLessonPayload({ ...valid, version:2 }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:10, s:[] }, { t:5, a:pen() }] }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:0, s:[pen([{ x:1, y:"bad" }])] }] }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, keyframes:new Array(100001).fill({ t:0, s:[] }) }).ok, false);

  const group = { type:"group",x:20,y:30,w:240,h:190,sourceW:240,sourceH:190,items:[
    { type:"line",x1:0,y1:0,x2:100,y2:100,color:"#111",width:2 },
    { type:"polyline",color:"#111",width:2,points:[{x:0,y:10},{x:50,y:20}] },
    { type:"text",x:20,y:30,text:"벡터",fontSize:18,color:"#111" }
  ] };
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:0, s:[group] }] }).ok, true);
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:0, s:[{ ...group, items:new Array(1001).fill(group.items[0]) }] }] }).ok, false);

  const shapeReplay = {
    format:"classdock-lesson", version:1, kind:"pdf-ink", duration:50,
    pages:{ 0:{ w:800, h:1200 } },
    keyframes:[{ t:50, p:0, a:{ tool:"mosaic", color:"#999", width:3, points:[{ x:10, y:20 }, { x:80, y:60 }] } }]
  };
  assert.equal(validateLessonPayload(shapeReplay).ok, true);
});

test("폴더 안 .lesson은 재생 문서에 부모 폴더와 대량 열기 옵션을 전달한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/lesson-replay.js"), "utf8");
  assert.match(source, /function openLessonReplay\(lesson, name, options=\{\}\)/);
  assert.match(source, /makeDoc\("replay", name \|\| "수업 리플레이", options\)/);
  assert.match(source, /activateIfIdle\(doc, options\)/);
  assert.match(source, /async function loadLesson\(file, options=\{\}\)/);
  assert.match(source, /openLessonReplay\(lesson,[\s\S]*options\)/);
});

test("브라우저 작업공간은 새 경로를 병합하고 닫은 경로만 제거한다", () => {
  const store = loadBrowserScript("workspace-store.js", { WORKSPACE_CAP:256 * 1024 * 1024, decodeWorkspace });
  const before = store.encodeWorkspaceRows([
    { path:"class/a.py", bytes:Uint8Array.from([1]) },
    { path:"memo.txt", bytes:Uint8Array.from([2]) }
  ]);
  const incoming = store.encodeWorkspaceRows([
    { path:"class/a.py", bytes:Uint8Array.from([9]) },
    { path:"class/b.py", bytes:Uint8Array.from([3]) }
  ]);
  const merged = decodeWorkspace(store.mergeWorkspacePayloads(before, incoming));
  assert.deepEqual(merged.map(row => row.path), ["class/a.py", "memo.txt", "class/b.py"]);
  assert.deepEqual([...merged[0].bytes], [9]);
  const pruned = decodeWorkspace(store.removeWorkspacePayloadPaths(store.mergeWorkspacePayloads(before, incoming), ["memo.txt"]));
  assert.deepEqual(pruned.map(row => row.path), ["class/a.py", "class/b.py"]);
  assert.equal(store.removeWorkspacePayloadPaths(before, ["class/a.py", "memo.txt"]), null);
});

test("OCR 캐시는 전체 SHA-256과 버전으로 동일 크기 PDF를 구분한다", async () => {
  const ocr = loadBrowserScript("pdf-ocr.js", { crypto:webcrypto, fingerprintBytes });
  const first = new Uint8Array(70000).fill(7);
  const second = new Uint8Array(first);
  second[35000] = 8; // 기존 앞/뒤 표본 밖의 내용 차이
  const firstKey = await ocr.pdfOcrCacheKey({ name:"scan.pdf", pdfBytes:first.buffer });
  const secondKey = await ocr.pdfOcrCacheKey({ name:"scan.pdf", pdfBytes:second.buffer });
  const renamedKey = await ocr.pdfOcrCacheKey({ name:"renamed.pdf", pdfBytes:first.buffer });
  assert.match(firstKey, /^ocr:v2:sha256:[0-9a-f]{64}$/);
  assert.notEqual(firstKey, secondKey);
  assert.equal(firstKey, renamedKey);
});

test(".lesson 의 녹음 소리는 data:audio base64 만 받고, 녹화기는 녹음 시작 시각을 0초로 쓴다", () => {
  const { validateLessonPayload, LessonRecorder } = loadBrowserScript("lesson-replay.js", { performance:{ now:() => 1500 } });
  const valid = {
    format:"classdock-lesson", version:1, kind:"board", duration:120, W:1280, H:720,
    keyframes:[{ t:0, s:[] }, { t:120, a:pen() }]
  };
  const audio = { mime:"audio/webm", src:"data:audio/webm;codecs=opus;base64,GkXfow==", duration:3000 };
  assert.equal(validateLessonPayload({ ...valid, duration:3000, audio }).ok, true);
  assert.equal(validateLessonPayload({ ...valid, audio:{ ...audio, src:"data:text/html;base64,PGI+" } }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, audio:{ ...audio, src:"https://example.com/a.webm" } }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, audio:{ ...audio, duration:-1 } }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, audio:"data:audio/webm;base64,GkXfow==" }).ok, false);

  const mic = { stop(){}, cancel(){} };
  const rec = LessonRecorder([], "#fff", { W:100, H:80 }, null, { t0:1000, audio:mic });
  assert.equal(rec.audio, mic);
  rec.capture([pen()], "#fff", { W:100, H:80 });
  const lesson = rec.stop([pen()], "#fff", { W:100, H:80 });
  assert.equal(lesson.keyframes[1].t, 500);   // 1500 - 1000: 녹음이 시작된 때부터 잰다
  assert.equal(LessonRecorder([], "#fff", { W:100, H:80 }).audio, null);
});

test("리플레이 MP4 는 화면이 바뀐 때(와 2초마다)만 장면을 굽고, 열쇠 장면은 10초마다 둔다", () => {
  const { lessonVideoSchedule, lessonVideoSize } = loadBrowserScript("lesson-replay.js");
  // 0~1초는 획이 자라며 매 장면 바뀌고, 그 뒤 25초는 설명만(화면 그대로).
  const key = (t) => (t < 1000 ? "grow:" + Math.floor(t / 100) : "still");
  const { frames, end } = lessonVideoSchedule(26000, key, 30);
  const times = Array.from(frames, (f) => f.t);
  assert.deepEqual(times.slice(0, 3), [0, 100, 200], "100ms 마다 바뀌면 그때마다");
  const still = times.filter((t) => t >= 1000);
  assert.ok(still.length >= 12 && still.length <= 14, "가만한 25초는 2초 간격으로만: " + still.length);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 2000 + 1000 / 30 + 1e-6, "2초(+ 한 칸)보다 벌어지지 않음");
  assert.equal(frames.length < 30, true, "초당 30장을 다 굽지 않는다");
  const keys = frames.filter((f) => f.key).map((f) => f.t);
  assert.equal(keys[0], 0);
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i] - keys[i - 1] >= 10000);
  assert.ok(end >= 26000);
  assert.deepEqual(Array.from(lessonVideoSchedule(0, () => "x", 30).frames, (f) => f.t), [0], "길이 0 이어도 한 장");

  assert.deepEqual({ ...lessonVideoSize(1600, 900) }, { width:1920, height:1080 });
  assert.deepEqual({ ...lessonVideoSize(1000, 1414) }, { width:762, height:1080 }, "세로 쪽은 높이에 맞추고 짝수로");
  const odd = lessonVideoSize(1333, 777);
  assert.equal(odd.width % 2, 0); assert.equal(odd.height % 2, 0);
});

test("녹화로 만든 리플레이는 겹치지 않는 .lesson 이름으로 파일처럼 열어 자동 복원에 남긴다", () => {
  const context = loadBrowserScript("lesson-replay.js", { docs:[{ name:"칠판 리플레이 09-29 14.05.lesson" }] });
  const at = new Date(2026, 8, 29, 14, 5);
  assert.equal(context.lessonRecordingFileName("칠판.wbd", at), "칠판 리플레이 09-29 14.05 (2).lesson", "같은 이름이 열려 있으면 번호를 붙인다");
  assert.equal(context.lessonRecordingFileName("PDF 필기", new Date(2026, 0, 3, 9, 7)), "PDF 필기 리플레이 01-03 09.07.lesson");
  assert.equal(context.lessonRecordingFileName("", at), "리플레이 09-29 14.05.lesson");
  const opened = loadBrowserScript("lesson-replay.js", { docs:[{ name:"칠판 리플레이 09-29 14.05", workspacePath:"칠판 리플레이 09-29 14.05.lesson" }] });
  assert.equal(opened.lessonRecordingFileName("칠판", at), "칠판 리플레이 09-29 14.05 (2).lesson", "열린 리플레이는 이름에 .lesson 이 없어도 겹침으로 본다");
  const source = fs.readFileSync(path.join(__dirname, "../src/js/lesson-replay.js"), "utf8");
  const body = source.slice(source.indexOf("async function finishLessonRecording"), source.indexOf("// .lesson 파일 열기"));
  assert.match(body, /handleFiles\(\[file\], \{\}\)/, "파일 파이프라인으로 연다(작업공간 경로가 생긴다)");
  assert.match(body, /rememberWorkspace\(\[file\], false, \{ silent:true \}\)/, "자동 복원 저장소에 담는다");
});

test("PDF 필기 녹화도 마이크 설정이 켜져 있으면 소리를 붙이고, 녹음 시작을 0초로 쓴다", async () => {
  const store = new Map(), events = [];
  let clock = 1500;
  const context = loadBrowserScript("lesson-replay.js", {
    performance:{ now:() => clock },
    localStorage:{ getItem:(k) => (store.has(k) ? store.get(k) : null), setItem:(k, v) => store.set(k, String(v)) },
    document:{ dispatchEvent:(e) => events.push(e) },
    CustomEvent:class { constructor(type, init){ this.type = type; this.detail = init && init.detail; } },
    setInterval:() => 1, clearInterval:() => {}, toast:() => {}
  });
  let finished = null;
  context.finishLessonRecording = (lesson, name) => { finished = { lesson, name }; };
  context.startLessonAudio = async () => ({ ok:true, startedAt:1000, cancel(){},
    stop:async () => ({ mime:"audio/webm", src:"data:audio/webm;base64,GkXfow==", duration:9000 }) });

  assert.equal(context.lessonRecordMicWanted(), false, "처음엔 꺼져 있다");
  context.lessonSetRecordMicWanted(true);
  assert.equal(store.get("wbRecordMic"), "true", "화이트보드와 같은 설정 칸");
  assert.equal(events.at(-1).type, "lesson-mic-changed");

  assert.equal(await context.lessonPdfToggleRecord(), true);
  assert.equal(events.at(-1).detail.mic, true, "녹음 중임을 단추에 알린다");
  context.lessonPdfOnStroke({ pages:[{ cssW:800, cssH:1000 }] }, 0, { tool:"pen", color:"#e11d48", width:3, points:[{ x:1, y:2 }, { x:3, y:4 }] });
  clock = 2500;
  assert.equal(await context.lessonPdfToggleRecord(), false);
  assert.ok(finished, "리플레이를 만든다");
  assert.equal(finished.name, "PDF 필기");
  assert.equal(finished.lesson.kind, "pdf-ink");
  assert.equal(finished.lesson.keyframes[0].t, 500, "1500 - 1000: 녹음 시작부터 잰다");
  assert.equal(finished.lesson.audio.duration, 9000);
  assert.equal(finished.lesson.duration, 9000, "필기를 멈춘 뒤 말한 부분까지");
  assert.equal(context.validateLessonPayload(JSON.parse(JSON.stringify(finished.lesson))).ok, true);

  // 마이크를 못 쓰면 필기만 녹화한다
  context.startLessonAudio = async () => ({ ok:false, message:"마이크 권한이 없어요." });
  finished = null;
  assert.equal(await context.lessonPdfToggleRecord(), true);
  context.lessonPdfOnStroke({ pages:[{}] }, 0, { tool:"pen", points:[{ x:0, y:0 }] });
  await context.lessonPdfToggleRecord();
  assert.equal(finished.lesson.audio, undefined);
});

test("장면에 항목이 8개를 넘어도 뒤쪽 그룹(그래프)이 검사에 걸리지 않는다", () => {
  // every(lessonValidItem) 이 배열 번호를 depth 로 넘겨 9번째 뒤의 그룹이 '너무 깊다'로 거절됐다
  // → 녹화한 리플레이가 파일로 안 열려 자동 복원에서 빠지고, 저장한 .lesson 도 다시 못 열었다.
  const { validateLessonPayload } = loadBrowserScript("lesson-replay.js");
  const graph = { type:"group", role:"education-plot", x:590, y:350, w:400, h:290, items:[
    { type:"line", x1:0, y1:0, x2:10, y2:10 }, { type:"polyline", points:[{ x:0, y:1 }, { x:2, y:3 }] }
  ] };
  const texts = Array.from({ length:12 }, (_, i) => ({ type:"text", x:i, y:i, text:"줄 " + i }));
  const snapshot = [...texts, graph, { ...graph, x:1020 }];
  const lesson = { format:"classdock-lesson", version:1, kind:"board", duration:500, W:1600, H:900,
    keyframes:[{ t:0, s:texts }, { t:200, s:snapshot }, { t:500, a:graph }] };
  assert.equal(validateLessonPayload(lesson).ok, true, validateLessonPayload(lesson).message);
});

test("MP4 장면은 투명하게 그린 뒤 빈 곳만 검게 밑에 깐다(먼저 칠하면 판 배경이 안 깔려 화면이 검다)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/lesson-replay.js"), "utf8");
  const body = source.slice(source.indexOf("async function exportLessonVideo"), source.indexOf("// keyframes → 재생 상태"));
  assert.match(body, /ctx\.clearRect\(0, 0, width, height\);\s*opts\.draw\(ctx, width, height, 1, frame\.t\);[\s\S]{0,120}ctx\.globalCompositeOperation = "destination-over";\s*ctx\.fillStyle = "#000"; ctx\.fillRect\(0, 0, width, height\);/);
  assert.doesNotMatch(body.slice(0, body.indexOf("opts.draw(")), /fillRect/, "그리기 전에 칠하지 않는다");
});

test("리플레이 재생 바는 색 이모지 대신 단색 아이콘을 쓴다(앱 UI 는 이모지를 지운다)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/lesson-replay.js"), "utf8");
  assert.doesNotMatch(source, /mk\("[^"]*[\u{1F000}-\u{1FAFF}]/u, "단추 글자에 이모지가 없어야 한다");
  assert.match(source, /setIcon\(soundBtn, muted \? "mute" : "volume"\)/);
  assert.match(source, /setIcon\(saveBtn, "save"\)/);
  assert.match(source, /setIcon\(videoBtn, "video", "MP4"\)/);
});
