// 1GB 넘는 영상도 앱 안에서 변환할 수 있게 만든 "경로 방식"의 회귀 방지.
// 예전에는 원본을 HTTP 본문으로 통째로 올려 런처가 byte[] 로 받았다. 그 길에는
// .NET 배열 상한(2GB)과 원본 크기만큼의 메모리 사용이 있어 1GB 에서 막아 두었다.
// 지금은 앱이 경로(원본 폴더 ID + 상대 경로)만 넘기고 ffmpeg 가 디스크에서 직접 읽고 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const viewer = fs.readFileSync(path.join(root, "src/js/video-viewer.js"), "utf8");
const loaders = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");
const { vvNativeRefOf, vvNativeOutputRel, vvConvertProgressText,
        vvConvertRemainingSec, vvFormatDuration, vvMissingVideoFrames } = require("../src/js/video-viewer.js");

test("런처가 경로를 아는 파일만 경로 방식 대상으로 고른다", () => {
  const ref = { rootId:"abc", relPath:"수업/1강.mkv" };
  const file = { name:"1강.mkv", __nativeSource:ref };
  assert.equal(vvNativeRefOf(file), ref);
  // 끌어다 놓은 파일은 원본 위치를 알 수 없다 → 예전 방식(본문 업로드)으로 남는다.
  assert.equal(vvNativeRefOf({ name:"1강.mkv" }), null);
  assert.equal(vvNativeRefOf(null), null);
  // 반쪽짜리 표식은 받지 않는다 — 경로가 없으면 런처가 열 파일을 못 정한다.
  assert.equal(vvNativeRefOf({ __nativeSource:{ rootId:"abc" } }), null);
  assert.equal(vvNativeRefOf({ __nativeSource:{ relPath:"a.mkv" } }), null);
});

test("변환본은 하위 폴더 안 원본 옆 제자리에 .mp4 로 만든다", () => {
  assert.equal(vvNativeOutputRel({ relPath:"수업/2학기/1강.mkv" }), "수업/2학기/1강.mp4");
  assert.equal(vvNativeOutputRel({ relPath:"1강.avi" }), "1강.mp4");
  // 폴더 이름에 점이 있어도 확장자로 오해하지 않는다.
  assert.equal(vvNativeOutputRel({ relPath:"3.학년/1강.wmv" }), "3.학년/1강.mp4");
  // 확장자가 없는 파일은 그대로 뒤에 붙인다.
  assert.equal(vvNativeOutputRel({ relPath:"영상/무제" }), "영상/무제.mp4");
});

test("진행률 문구는 단계를 구분하고 길이를 모르면 퍼센트를 감춘다", () => {
  assert.equal(vvConvertProgressText({ stage:"copy", percent:42 }), "소리만 변환 중 42%");
  // 2차(전체 재인코딩)로 넘어가면 훨씬 오래 걸리므로 그렇다고 알린다.
  assert.equal(vvConvertProgressText({ stage:"encode", percent:7 }), "영상까지 다시 인코딩 중 7%");
  // 길이를 못 알아낸 원본은 런처가 -1 을 보낸다.
  assert.equal(vvConvertProgressText({ stage:"copy", percent:-1 }), "소리만 변환 중…");
  assert.equal(vvConvertProgressText(null), "MP4로 변환 중…");
  assert.equal(vvConvertProgressText({ stage:"remux", percent:50 }), "영상·소리 그대로 MP4로 옮기는 중 50%");
  assert.equal(vvConvertProgressText({ stage:"hardware", percent:10 }), "GPU로 영상 변환 중 10%");
});

test("남은 시간은 ffmpeg 배속으로 어림하고, 없으면 실제 경과로 대신한다", () => {
  // 10분짜리 원본의 2분을 처리했고 배속이 4× → 남은 8분을 4배로 → 120초.
  assert.equal(Math.round(vvConvertRemainingSec({
    durationUs:600000000, doneUs:120000000, speedMilli:4000, elapsedMs:30000
  })), 120);
  // 배속이 아직 안 왔으면(speed=N/A) 이 단계에서 흐른 시간으로 같은 계산을 한다.
  assert.equal(Math.round(vvConvertRemainingSec({
    durationUs:600000000, doneUs:120000000, speedMilli:0, elapsedMs:30000
  })), 120);
  // 원본 길이를 모르거나 아직 아무것도 처리하지 못했으면 알 수 없다.
  assert.equal(vvConvertRemainingSec({ durationUs:0, doneUs:0, speedMilli:0, elapsedMs:1000 }), -1);
  assert.equal(vvConvertRemainingSec({ durationUs:600000000, doneUs:0, speedMilli:2000 }), -1);
  assert.equal(vvConvertRemainingSec(null), -1);
});

test("남은 시간 표기는 시·분·초를 사람이 읽는 단위로 줄인다", () => {
  assert.equal(vvFormatDuration(45), "45초");
  assert.equal(vvFormatDuration(200), "3분 20초");
  assert.equal(vvFormatDuration(120), "2분");                     // 딱 떨어지면 "0초"를 붙이지 않는다
  // 시간 단위가 붙으면 초는 버린다 — 의미 없는 자리가 계속 튀는 게 더 불편하다.
  assert.equal(vvFormatDuration(3900), "1시간 5분");
  assert.equal(vvFormatDuration(-5), "0초");
});

test("진행률 문구에 남은 시간이 붙고, 못 잴 때는 흐른 시간을 대신 보여 준다", () => {
  assert.equal(
    vvConvertProgressText({ stage:"copy", percent:20, durationUs:600000000, doneUs:120000000, speedMilli:4000 }),
    "소리만 변환 중 20% · 약 2분 남음");
  // 남은 시간을 못 재는 동안에도 멈춘 게 아님을 알 수 있게 경과를 보여 준다(3초 이후부터).
  assert.equal(vvConvertProgressText({ stage:"copy", percent:-1, elapsedMs:65000 }),
    "소리만 변환 중… · 1분 5초 지남");
  assert.equal(vvConvertProgressText({ stage:"copy", percent:-1, elapsedMs:900 }), "소리만 변환 중…");
  // 변환은 한 번에 하나만 돈다 — 차례를 기다리는 중이라면 그렇다고 말해 준다.
  assert.equal(vvConvertProgressText({ state:"queued", stage:"", percent:-1 }),
    "앞선 변환이 끝나기를 기다리는 중…");
});

test("원본 폴더의 영상은 바이트를 받아오지 않는다", () => {
  // getFile() 이 수 GB 영상을 통째로 옮기면 런처(byte[] 2GB 상한)와 브라우저가 함께 무너진다.
  assert.match(loaders, /if \(typeof isMediaFileName === "function" && isMediaFileName\(this\.name\)\) return this\.nativeMediaFile\(meta\);/);
  const stub = loaders.slice(loaders.indexOf("nativeMediaFile(meta){"));
  assert.match(stub.slice(0, 700), /define\("size", Number\(meta && meta\.size\) \|\| 0\)/);
  assert.match(stub.slice(0, 700), /define\("__nativeSource", \{ rootId:this\.rootId, relPath:this\.relPath \}\)/);
});

test("경로 방식이 되면 크기 제한을 확인하지 않는다", () => {
  const convert = viewer.slice(viewer.indexOf("async function startConvert(){"));
  const body = convert.slice(0, 1600);
  const nativeAt = body.indexOf("if (nativeRef) return startConvertByPath(nativeRef);");
  const limitAt = body.indexOf("file.size > 1024 * 1024 * 1024");
  assert.ok(nativeAt > 0 && limitAt > nativeAt, "크기 제한 검사는 경로 방식 분기 뒤에 있어야 한다");
});

test("런처는 경로 방식 변환을 작업표로 돌리고 결과 확장자를 못박는다", () => {
  assert.match(launcher, /path\.StartsWith\("\/convert-media-path\?", StringComparison\.Ordinal\)/);
  assert.match(launcher, /path\.StartsWith\("\/convert-media-job\?", StringComparison\.Ordinal\)/);
  assert.match(launcher, /path\.StartsWith\("\/convert-media-cancel\?", StringComparison\.Ordinal\)/);
  const start = launcher.slice(launcher.indexOf("static string StartMediaConvertJob"));
  // 원본 폴더 밖은 열 수 없고, 결과는 언제나 .mp4 이며, 원본을 덮어쓰지 않는다.
  assert.match(start.slice(0, 1600), /TryResolveSourceFolderPath\(id, inRel, false, out root, out inFull\)/);
  assert.match(start.slice(0, 1600), /output-must-be-mp4/);
  assert.match(start.slice(0, 1600), /output-same-as-input/);
  // 임시 출력은 .part 라 컨테이너를 짐작할 수 없다 → -f mp4 가 필요하다.
  assert.match(launcher, /-movflags \+faststart -f mp4/);
});

test("재생 표는 토큰을 못 붙이는 <video> 전용이고 그 발급은 토큰이 필요하다", () => {
  const auth = launcher.slice(launcher.indexOf("static bool RequiresLocalAuthToken"));
  const rules = auth.slice(0, auth.indexOf("static bool IsImageMemoExtension"));
  assert.match(rules, /path\.StartsWith\("\/media-ticket", StringComparison\.Ordinal\)\) return true;/);
  assert.match(rules, /path\.StartsWith\("\/convert-media-path", StringComparison\.Ordinal\)/);
  assert.match(rules, /path\.StartsWith\("\/convert-media-job", StringComparison\.Ordinal\)\) return true;/);
  // 스트리밍 자체는 표가 열쇠다 — 여기까지 토큰을 요구하면 <video> 가 아예 못 읽는다.
  assert.doesNotMatch(rules, /"\/media-stream"/);
  // 표는 실제 경로가 아니라 폴더 ID + 상대 경로를 들고 있어야 폴더 밖으로 새지 않는다.
  const ticket = launcher.slice(launcher.indexOf("sealed class MediaTicket"));
  assert.match(ticket.slice(0, 300), /public string RootId;[\s\S]*public string RelPath;[\s\S]*public DateTime ExpiresUtc;/);
});

test("영상 프레임 없는 재생만 안내하고 일시정지·탐색·로딩은 제외한다", () => {
  const playing = { paused:false, seeking:false, readyState:3, currentTime:5, videoWidth:0, videoHeight:0 };
  assert.equal(vvMissingVideoFrames(playing), true);
  for (const change of [{ paused:true }, { seeking:true }, { readyState:1 }, { currentTime:1 }]){
    assert.equal(vvMissingVideoFrames({ ...playing, ...change }), false);
  }
  const visible = { ...playing, videoWidth:1920, videoHeight:1080 };
  assert.equal(vvMissingVideoFrames(visible), false);
  assert.equal(vvMissingVideoFrames({ ...visible, getVideoPlaybackQuality:() => ({ totalVideoFrames:0 }) }), true);
  assert.equal(vvMissingVideoFrames({ ...visible, getVideoPlaybackQuality:() => ({ totalVideoFrames:24 }) }), false);
});

test("MP4 재변환과 강제 재인코딩은 원본과 다른 파일명으로 저장한다", () => {
  assert.equal(vvNativeOutputRel({ relPath:"수업/영상.mp4" }), "수업/영상.호환.mp4");
  assert.equal(vvNativeOutputRel({ relPath:"수업/영상.MP4" }), "수업/영상.호환.mp4");
  assert.equal(vvNativeOutputRel({ relPath:"수업/영상.mkv" }, true), "수업/영상.호환.mp4");
  assert.equal(vvNativeOutputRel({ relPath:"수업/영상.호환.mp4" }, true), "수업/영상.호환.호환.mp4");
});