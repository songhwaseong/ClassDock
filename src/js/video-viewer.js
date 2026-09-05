"use strict";

/* ===== 영상·오디오 보기 + 자막(SRT/VTT/SMI) =====
 * 수업 영상을 PDF·노트북과 같은 탭으로 열어 본다. 재생은 브라우저 <video> 그대로
 * (탐색·배속·전체화면은 기본 컨트롤), 자막과 작은 창(PiP)만 이 파일에서 처리한다.
 *  · ← → 는 10초씩 되감기·건너뛰기(기본 ±5초 대신, 영상을 클릭해 포커스를 주지 않아도 먹게).
 *  · 재생 속도는 도구바 선택칸과 [ ] 키. 값은 playbackRate 한 곳에만 두고 ratechange 로 칸을 맞춘다.
 *  · 작은 창(PiP)은 브라우저 기본 컨트롤에도 있지만 도구바 버튼·Alt+P 로도 켠다(교실에서 찾기 쉽게).
 *    창을 브라우저가 그리므로 ::cue 로 키운 자막 크기는 그 창에 적용되지 않는다.
 *  · 자막은 WebVTT 로 변환해 <track> 에 넣는다 — SRT 는 타임코드 치환, SMI(SAMI)는 간이 파서.
 *  · 인코딩은 smartDecodeText(UTF-8/CP949 자동 판별)를 그대로 써서 한글 자막이 깨지지 않는다.
 *  · 같은 이름 자막(강의1.mp4 ↔ 강의1.srt / 강의1.ko.srt)을 같은 폴더·열린 탭에서 자동 연결.
 *  · 원본 바이트는 메모리에 안 올린다(File 참조 + object URL). 작업공간 자동 저장에서는 제외
 *    (rememberWorkspace 가 isMediaFileName 으로 거른다 — 대용량이 256MB 제한을 막지 않게). */

const VIDEO_EXTS = ["mp4","m4v","webm","ogv","mov","mkv","avi","wmv","flv"];
const AUDIO_EXTS = ["mp3","wav","m4a","aac","ogg","oga","flac","weba"];
const SUBTITLE_EXTS = ["srt","vtt","smi"];

function mediaExtOf(name){
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : "";
}

// 작업공간 자동 저장 제외 판정(documents.js rememberWorkspace 에서 사용)
function isMediaFileName(name){
  const ext = mediaExtOf(name);
  return VIDEO_EXTS.includes(ext) || AUDIO_EXTS.includes(ext);
}

/* ---- 자막 변환(순수 함수 — 단위 테스트 대상) ---- */

function msToVttTime(ms){
  const t = Math.max(0, Math.round(Number(ms) || 0));
  const pad = (v, n) => String(v).padStart(n, "0");
  return pad(Math.floor(t / 3600000), 2) + ":" + pad(Math.floor(t / 60000) % 60, 2) + ":"
    + pad(Math.floor(t / 1000) % 60, 2) + "." + pad(t % 1000, 3);
}

// SRT → WebVTT: 타임코드 밀리초 구분자 , → . 치환 + WEBVTT 머리말.
// 숫자 순번 줄은 VTT 큐 식별자로 유효해 그대로 둔다. <font> 태그(색 자막)만 걷어낸다.
function srtToVtt(text){
  let body = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/-->/.test(body)) return "";
  body = body.replace(/(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g, (_, time, msPart) => time + "." + msPart.padEnd(3, "0"));
  body = body.replace(/<\/?font[^>]*>/gi, "");
  return "WEBVTT\n\n" + body.trim() + "\n";
}

// SMI(SAMI) → WebVTT: <SYNC Start=밀리초> 블록에서 시각·문장을 추출한다.
// 각 큐의 끝은 다음 SYNC 시각(빈 블록 = 자막 지우기 포함), 마지막은 +5초.
function smiToVtt(text){
  const src = String(text || "").replace(/^\uFEFF/, "");
  const syncs = [...src.matchAll(/<sync[^>]*\bstart\s*=\s*["']?(\d+)/gi)];
  if (!syncs.length) return "";
  const entries = syncs.map((m, i) => {
    const chunkEnd = i + 1 < syncs.length ? syncs[i + 1].index : src.length;
    const chunk = src.slice(m.index + m[0].length, chunkEnd)
      .replace(/^[^>]*>/, "")                       // sync 태그의 나머지 속성과 닫는 > 제거
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")                       // <P Class=KRCC> 등 나머지 태그 제거
      .replace(/&nbsp;?/gi, " ")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, "&");
    const textOut = chunk.split("\n").map(line => line.trim()).filter(Boolean).join("\n");
    return { start: parseInt(m[1], 10), text: textOut };
  });
  const cues = [];
  for (let i = 0; i < entries.length; i++){
    const entry = entries[i];
    if (!entry.text) continue;
    let end = i + 1 < entries.length ? entries[i + 1].start : entry.start + 5000;
    if (end <= entry.start) end = entry.start + 1000;
    cues.push(msToVttTime(entry.start) + " --> " + msToVttTime(end) + "\n" + entry.text);
  }
  return cues.length ? "WEBVTT\n\n" + cues.join("\n\n") + "\n" : "";
}

// 자막 텍스트 → WebVTT. 확장자 우선, 모르면 내용으로 추정(<sync → SMI, --> → SRT).
function subtitleToVtt(name, text){
  const src = String(text || "").replace(/^\uFEFF/, "");
  const ext = mediaExtOf(name);
  if (ext === "vtt") return /^WEBVTT/.test(src.trim()) ? src : "WEBVTT\n\n" + src.trim() + "\n";
  if (ext === "smi" || ext === "sami") return smiToVtt(src);
  if (ext === "srt") return srtToVtt(src);
  if (/<sync[^>]*\bstart/i.test(src)) return smiToVtt(src);
  return srtToVtt(src);
}

// 영상 파일과 자막 파일이 같은 제목인지 — 강의1.mp4 ↔ 강의1.srt / 강의1.ko.srt (대소문자 무시)
function subtitleMatchesMedia(mediaName, subtitleName){
  const subExt = mediaExtOf(subtitleName);
  if (!SUBTITLE_EXTS.includes(subExt)) return false;
  const base = String(mediaName || "").replace(/\.[^.]+$/, "").toLowerCase();
  const subBase = String(subtitleName || "").slice(0, -(subExt.length + 1)).toLowerCase();
  if (!base || !subBase) return false;
  return subBase === base || subBase.startsWith(base + ".");
}

/* ---- 변환 백엔드(exe + ffmpeg) ---- */

// launcher 가 ffmpeg 를 찾았는지(exe 옆 또는 PATH). file:// 단독 실행이면 백엔드 없음.
let _vvMediaBackend = null;
async function vvMediaBackendAvailable(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;
  if (_vvMediaBackend === true) return true;   // 성공만 캐시 — ffmpeg 를 나중에 놓아도 다시 확인
  try {
    const res = await fetch("/can-convert-media");
    _vvMediaBackend = res.ok && (await res.text()).trim() === "yes";
  } catch(_){ _vvMediaBackend = false; }
  return _vvMediaBackend;
}

/* ---- 런처가 아는 파일(경로 방식) ----
 * 원본이 exe 로 연 폴더 안에 있으면 앱은 바이트 대신 (폴더 ID + 상대 경로)만 들고 있다.
 * 재생도 변환도 그 경로로 처리하므로 파일 크기에 제한이 없다 — 끌어다 놓아 연 파일은
 * 경로를 알 수 없어 예전처럼 본문으로 주고받는다(1GB 제한은 그쪽에만 남는다). */

function vvNativeRefOf(file){
  const ref = file && file.__nativeSource;
  return ref && ref.rootId && ref.relPath ? ref : null;
}

// 같은 자리에 놓을 변환본(.mp4)의 상대 경로 — 하위 폴더에 있던 영상은 그 자리에 그대로 만든다.
function vvNativeOutputRel(ref, forceVideo = false){
  const input = String(ref.relPath);
  const suffix = forceVideo || /\.mp4$/i.test(input) ? ".호환.mp4" : ".mp4";
  return input.replace(/\.[^./]+$/, "") + suffix;
}

// 이름만 있는 재생용 파일. 변환본으로 갈아탈 때처럼 바이트 없이 경로만 아는 경우에 쓴다.
function vvNativeMediaFile(name, ref){
  const file = new File([], name);
  try { Object.defineProperty(file, "__nativeSource", { value: ref, configurable: true }); } catch(_){}
  return file;
}

// <video> 요청에는 X-ClassDock-Token 헤더를 붙일 수 없다 → 파일 하나에만 쓰는 표를 먼저 받아
// 주소에 담는다. 런처는 그 표로 Range 스트리밍을 열어 준다.
async function vvMediaStreamUrl(ref){
  if (!ref || (location.protocol !== "http:" && location.protocol !== "https:")) return "";
  try {
    const res = await fetch("/media-ticket?id=" + encodeURIComponent(ref.rootId)
      + "&path=" + encodeURIComponent(ref.relPath), { method: "POST" });
    if (!res.ok) return "";
    const data = await res.json();
    return data && data.ticket ? "/media-stream?t=" + encodeURIComponent(data.ticket) : "";
  } catch(_){ return ""; }
}

// 경로 방식 변환 시작 → 작업 번호. ffmpeg 가 디스크에서 직접 읽고 쓴다.
async function vvStartConvertJob(ref, forceVideo = false){
  const res = await fetch("/convert-media-path?id=" + encodeURIComponent(ref.rootId)
    + "&in=" + encodeURIComponent(ref.relPath)
    + "&out=" + encodeURIComponent(vvNativeOutputRel(ref, forceVideo))
    + "&reencode=" + (forceVideo ? "1" : "0"), { method: "POST" });
  if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
  const data = await res.json();
  if (!data || !data.job) throw new Error("no-job-id");
  return data.job;
}

async function vvCancelConvertJob(job){
  if (!job) return;
  try { await fetch("/convert-media-cancel?job=" + encodeURIComponent(job), { method: "POST" }); } catch(_){}
}

/* 남은 시간 어림. ffmpeg 가 알려 주는 배속(원본 1초를 몇 초 만에 처리하는지)을 우선 쓴다 —
 * ffmpeg 자신의 ETA 와 같은 누적 평균이라 숫자가 잘 안 흔들린다. 아직 배속이 안 왔으면
 * 이 단계에서 실제로 흐른 시간으로 같은 계산을 한다. 알 수 없으면 -1. */
function vvConvertRemainingSec(info){
  const duration = Number(info && info.durationUs) || 0;
  const done = Number(info && info.doneUs) || 0;
  if (duration <= 0 || done <= 0 || done >= duration) return -1;
  const leftSec = (duration - done) / 1000000;
  const speed = (Number(info.speedMilli) || 0) / 1000;
  if (speed > 0) return leftSec / speed;
  const elapsedSec = (Number(info.elapsedMs) || 0) / 1000;
  if (elapsedSec <= 0) return -1;
  return leftSec / ((done / 1000000) / elapsedSec);
}

// "1시간 5분" · "3분 20초" · "40초". 시간 단위가 붙으면 초는 버린다(의미 없는 자리가 계속 튄다).
function vvFormatDuration(sec){
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return hours + "시간 " + minutes + "분";
  if (minutes > 0) return total % 60 ? minutes + "분 " + (total % 60) + "초" : minutes + "분";
  return total + "초";
}

function vvMissingVideoFrames(media){
  if (!media || media.paused || media.seeking || media.readyState < 2 || media.currentTime < 3) return false;
  if (!media.videoWidth || !media.videoHeight) return true;
  if (typeof media.getVideoPlaybackQuality === "function"){
    try { return media.getVideoPlaybackQuality().totalVideoFrames === 0; } catch(_){}
  }
  return typeof media.webkitDecodedFrameCount === "number" && media.webkitDecodedFrameCount === 0;
}

function vvConvertProgressText(info){
  // 변환은 한 번에 하나만 돈다 — 다른 영상이 먼저 잡고 있으면 그 사실을 알린다(멈춘 게 아니다).
  if (info && info.state === "queued") return "앞선 변환이 끝나기를 기다리는 중…";
  // 복사·소리 변환·GPU·CPU 단계를 구분한다.
  const labels = { remux:"영상·소리 그대로 MP4로 옮기는 중", copy:"소리만 변환 중",
    hardware:"GPU로 영상 변환 중", encode:"영상까지 다시 인코딩 중" };
  const stage = (info && labels[info.stage]) || "MP4로 변환 중";
  const percent = info ? Number(info.percent) : NaN;   // Number(null) 은 0 이라 정보가 없을 때 0% 로 보인다
  const head = stage + (Number.isFinite(percent) && percent >= 0 ? " " + percent + "%" : "…");
  const remaining = vvConvertRemainingSec(info);
  if (remaining >= 0) return head + " · 약 " + vvFormatDuration(remaining) + " 남음";
  // 남은 시간을 아직 못 재는 동안(원본 길이를 모르거나 막 시작했을 때)에는 흐른 시간이라도 보여 준다.
  const elapsed = Number(info && info.elapsedMs) || 0;
  return elapsed >= 3000 ? head + " · " + vvFormatDuration(elapsed / 1000) + " 지남" : head;
}

// 끝날 때까지 진행률을 물어본다. 잠깐의 통신 오류로 변환을 포기하지는 않되,
// 런처가 사라진 경우까지 무한정 기다리지 않도록 연속 실패에는 한계를 둔다.
async function vvWaitConvertJob(job, onProgress){
  const POLL_MS = 700, MAX_MISSES = 60;
  for (let misses = 0; ; ){
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    let info = null;
    try {
      const res = await fetch("/convert-media-job?job=" + encodeURIComponent(job));
      if (res.ok) info = await res.json();
    } catch(_){}
    if (!info){
      if (++misses >= MAX_MISSES) throw new Error("변환 상태를 확인할 수 없어요");
      continue;
    }
    misses = 0;
    if (info.state === "done" || info.state === "error" || info.state === "cancelled") return info;
    if (typeof onProgress === "function") onProgress(info);
  }
}

// 같은 폴더에 그 이름의 파일이 이미 있는지 — 일괄 변환에서 두 번 돌리지 않기 위해.
async function vvNativeFileExists(ref, rel){
  try {
    const res = await fetch("/source-folder-entry?id=" + encodeURIComponent(ref.rootId)
      + "&path=" + encodeURIComponent(rel), { cache: "no-store" });
    return res.ok;
  } catch(_){ return false; }
}

function vvDownloadFile(file){
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = file.name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---- 폴더 영상 일괄 변환 ----
 * 매번 열 때마다 변환하지 않도록, 폴더의 문제 형식 영상을 한꺼번에 MP4 로 변환해
 * 원본 폴더(권한 요청)나 사용자가 고른 폴더에 저장한다. 같은 이름 .mp4 가 이미 있으면 건너뜀
 * — 한 번 돌려두면 그다음부터는 mp4 를 바로 열면 된다. */

// 일괄 변환 대상: 브라우저 재생이 자주 막히는 컨테이너만(잘 재생되는 mp4·webm 등은 제외)
// MOV는 크롬·엣지에서는 대개 재생되지만 Firefox가 컨테이너 자체를 못 읽어 포함
const VV_BATCH_EXTS = ["mkv","avi","wmv","flv","mov"];

// 문서가 속한 최상위 폴더 그룹(폴더 새로고침 루트) — 일괄 변환의 기준 폴더
function vvDocFolderRoot(doc){
  if (typeof navNodes === "undefined" || !doc) return null;
  const byId = new Map(navNodes.map(node => [node.nodeId, node]));
  let root = null;
  for (let pid = doc.parentId; pid; ){
    const node = byId.get(pid);
    if (!node) break;
    if (node.folderRefreshRootId) root = node;
    pid = node.parentId;
  }
  return root;
}

// 루트 폴더 아래(하위 폴더 포함)의 일괄 변환 대상 영상 문서 목록
function vvFolderVideoTargets(rootId){
  if (typeof navNodes === "undefined" || typeof docs === "undefined" || !rootId) return [];
  const groupIds = new Set([rootId]);
  for (let grew = true; grew; ){
    grew = false;
    for (const node of navNodes){
      if (node.type === "group" && node.parentId && groupIds.has(node.parentId) && !groupIds.has(node.nodeId)){
        groupIds.add(node.nodeId);
        grew = true;
      }
    }
  }
  return docs.filter(d => d.kind === "video" && d.media !== "audio" && d.sourceFile
    && groupIds.has(d.parentId) && VV_BATCH_EXTS.includes(mediaExtOf(d.name)));
}

async function vvEnsureWritable(handle){
  try {
    if (typeof handle.queryPermission === "function"
      && (await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
    if (typeof handle.requestPermission === "function")
      return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch(_){}
  return false;
}

function vvCreateBatchProgress(){
  const overlay = document.createElement("div");
  overlay.className = "vv-batch";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const card = document.createElement("div"); card.className = "vv-batch-card";
  const title = document.createElement("div"); title.className = "vv-batch-title";
  title.textContent = "영상 일괄 MP4 변환";
  const note = document.createElement("p"); note.className = "vv-batch-note";
  note.textContent = "영상 하나씩 차례로 변환해 폴더에 저장해요. 개수와 길이에 따라 오래 걸릴 수 있어요 — 창을 닫지 마세요.";
  const meter = document.createElement("progress"); meter.className = "vv-batch-meter";
  meter.max = 1; meter.value = 0;
  const detail = document.createElement("div"); detail.className = "vv-batch-detail";
  detail.setAttribute("role", "status"); detail.setAttribute("aria-live", "polite");
  const actions = document.createElement("div"); actions.className = "vv-batch-actions";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "vv-batch-cancel"; cancel.textContent = "중지";
  actions.appendChild(cancel);
  card.append(title, note, meter, detail, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  let cancelled = false;
  let ctrl = null;
  const requestCancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancel.disabled = true;
    cancel.textContent = "중지 요청됨";
    if (ctrl) { try { ctrl.abort(); } catch(_){} }
  };
  cancel.addEventListener("click", requestCancel);
  const onKeydown = (event) => {
    if (event.key !== "Escape" || cancelled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestCancel();
  };
  document.addEventListener("keydown", onKeydown, true);
  return {
    // done 에는 진행 중인 파일의 몫을 소수로 담을 수 있다(막대가 파일마다 뚝뚝 뛰지 않게).
    // 개수 표시는 그와 상관없이 정수로 센다.
    update(done, total, name){
      meter.max = Math.max(1, total);
      meter.value = Math.min(done, total);
      detail.textContent = name + " (" + Math.min(Math.floor(done) + 1, total) + "/" + total + ")";
    },
    signal(){ ctrl = new AbortController(); return ctrl.signal; },
    isCancelled(){ return cancelled; },
    close(){
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
    }
  };
}

async function vvBatchConvertFolder(rootId){
  const root = (typeof navNodes !== "undefined") ? navNodes.find(n => n.nodeId === rootId) : null;
  const targets = vvFolderVideoTargets(rootId);
  if (!targets.length){
    if (typeof toast === "function") toast("이 폴더에 일괄 변환할 영상(MKV·AVI·WMV·FLV·MOV)이 없어요.", 3200);
    return;
  }
  if (!(await vvMediaBackendAvailable())){
    if (typeof toast === "function") toast("무료 변환 도구(ffmpeg)가 아직 없어요. 영상을 하나 열어 안내 바의 설치 버튼을 먼저 눌러주세요.", 5000);
    return;
  }
  // 런처가 경로를 아는 영상(exe 의 '폴더 열기')은 결과를 원본 옆 제자리에 바로 만든다.
  // 파일을 주고받지 않으므로 저장 폴더를 고를 필요도, 크기 제한도 없다.
  const byPath = targets.some(target => vvNativeRefOf(target.sourceFile));
  // 변환본 저장 위치: 원본 폴더(쓰기 권한 요청) → 안 되면(드래그로 연 폴더 등) 사용자가 폴더 선택.
  // 경로를 모르는 영상이 하나라도 있을 때만 물어본다.
  let outDir = null;
  if (targets.some(target => !vvNativeRefOf(target.sourceFile))){
    outDir = root && root.folderHandle ? root.folderHandle : null;
    if (outDir && !(await vvEnsureWritable(outDir))) outDir = null;
    if (!outDir){
      if (typeof window.showDirectoryPicker !== "function"){
        if (typeof toast === "function") toast("이 브라우저에서는 저장 폴더를 고를 수 없어요. 영상을 하나씩 변환해 주세요.", 4000);
        return;
      }
      try { outDir = await window.showDirectoryPicker({ mode: "readwrite" }); }
      catch(_){ return; }   // 폴더 선택 취소
    }
  }
  const progress = vvCreateBatchProgress();
  let processed = 0, converted = 0, existed = 0, oversized = 0, failed = 0;
  try {
    for (const target of targets){
      if (progress.isCancelled()) break;
      const outName = String(target.name || "video").replace(/\.[^.]+$/, "") + ".mp4";
      progress.update(processed, targets.length, target.name + " 변환 중…");
      processed++;
      try {
        const nativeRef = vvNativeRefOf(target.sourceFile);
        if (nativeRef){
          const outRel = vvNativeOutputRel(nativeRef);
          if (await vvNativeFileExists(nativeRef, outRel)){ existed++; continue; }   // 이전에 변환해 둔 것
          const job = await vvStartConvertJob(nativeRef);
          const info = await vvWaitConvertJob(job, p => {
            if (progress.isCancelled()){ vvCancelConvertJob(job); return; }
            const share = Math.max(0, Math.min(100, Number(p.percent) || 0)) / 100;
            progress.update(processed - 1 + share, targets.length,
              target.name + " — " + vvConvertProgressText(p));
          });
          if (info.state === "cancelled") break;
          if (info.state !== "done") throw new Error(info.error || "변환 실패");
          converted++;
          continue;
        }
        let already = false;
        try { await outDir.getFileHandle(outName); already = true; } catch(_){}
        if (already){ existed++; continue; }                     // 이전에 변환해 둔 것 — 재변환 안 함
        if (!target.sourceFile || target.sourceFile.size > 1024 * 1024 * 1024){ oversized++; continue; }
        const res = await fetch("/convert-media", {
          method: "POST", headers: { "Content-Type": "application/octet-stream" },
          body: target.sourceFile, signal: progress.signal()
        });
        if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
        const blob = await res.blob();
        const fileHandle = await outDir.getFileHandle(outName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        converted++;
      } catch(e){
        if (progress.isCancelled()) break;
        console.warn("일괄 변환 실패:", target.name, e);
        failed++;
      }
    }
  } finally {
    progress.close();
  }
  const parts = [];
  if (converted) parts.push("변환 " + converted + "개");
  if (existed) parts.push("이미 있어 건너뜀 " + existed + "개");
  if (oversized) parts.push("1GB 초과 제외 " + oversized + "개");
  if (failed) parts.push("실패 " + failed + "개");
  if (typeof toast === "function"){
    toast((progress.isCancelled() ? "일괄 변환 중지 — " : "일괄 변환 완료 — ") + (parts.join(" · ") || "대상 없음"), 6000);
  }
  // 새 mp4 가 폴더 목록에 보이도록 새로고침(원본 폴더에 저장했을 때)
  if (converted && root && root.folderRefreshRootId && (byPath || root.folderHandle === outDir)
    && typeof requestFolderRefresh === "function") requestFolderRefresh(root.folderRefreshRootId);
}

/* ---- 뷰어 ---- */

async function loadVideo(file, options={}){
  const doc = makeDoc("video", file.name, options);
  doc.sourceFile = file;
  doc.media = AUDIO_EXTS.includes(mediaExtOf(file.name)) ? "audio" : "video";
  doc.render = async () => {
    doc.el.innerHTML = ""; doc.el.scrollTop = 0;
    renderVideoPlayer(doc.sourceFile || file, doc);
  };
  refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

function renderVideoPlayer(file, doc){
  const ext = mediaExtOf(file.name);
  const wrap = document.createElement("div");
  wrap.className = "vv-host" + (doc.media === "audio" ? " vv-audio" : "");
  const stage = document.createElement("div"); stage.className = "vv-stage";
  const media = document.createElement("video");
  media.className = "vv-media"; media.controls = true; media.preload = "metadata"; media.playsInline = true;
  // 재생 원본을 건다. 런처가 아는 파일(수 GB 수업 영상)은 바이트가 없으므로 스트림 주소로 튼다
  // — 표를 받아오는 동안만 잠깐 src 가 비어 있고, 표를 못 받으면 재생 실패로 처리해 안내가 뜬다.
  let srcUrl = "", currentFile = file;
  function setMediaSource(target){
    currentFile = target;
    doc.sourceFile = target;
    if (srcUrl){ try { URL.revokeObjectURL(srcUrl); } catch(_){} srcUrl = ""; }
    const ref = vvNativeRefOf(target);
    if (!ref){
      srcUrl = URL.createObjectURL(target);
      media.src = srcUrl;
      return;
    }
    media.removeAttribute("src");
    vvMediaStreamUrl(ref).then(url => {
      if (!media.isConnected) return;
      if (url) media.src = url;
      else media.dispatchEvent(new Event("error"));
    });
  }
  setMediaSource(file);
  stage.appendChild(media);

  const state = { trackEl: null, trackUrl: null, sizeIndex: 0, failed: false };
  (doc.cleanupFns || (doc.cleanupFns = [])).push(() => {
    try { media.pause(); } catch(_){}
    try { media.removeAttribute("src"); media.load(); } catch(_){}
    URL.revokeObjectURL(srcUrl);
    if (state.trackUrl) URL.revokeObjectURL(state.trackUrl);
  });

  /* ← → 10초씩 되감기·건너뛰기 / [ ] 재생 속도 한 칸씩(영상·오디오 공통).
   * 브라우저 기본 화살표는 ±5초인데다 영상을 한 번 클릭해 포커스를 준 뒤에만 먹는다 — 수업 중에는
   * 그 클릭이 재생/일시정지를 건드려 버린다. 이 탭이 활성이면 클릭 없이 바로 듣게 한다.
   * capture 로 먼저 받아 preventDefault: 안 그러면 기본 ±5초가 더해져 한 번에 15초씩 튄다
   * (PDF 페이지 넘기기(app.js)도 defaultPrevented 를 보고 비켜 준다). */
  const SEEK_STEP = 10;
  function seekBy(delta){
    const duration = Number(media.duration);
    const limit = (Number.isFinite(duration) && duration > 0) ? duration : Infinity;
    const next = Math.min(limit, Math.max(0, (Number(media.currentTime) || 0) + delta));
    try { media.currentTime = next; } catch(_){}
  }

  /* 재생 속도 — 어학 듣기·시범 동작은 느리게, 복습은 빠르게.
   * 값의 원본은 media.playbackRate 하나로 두고 ratechange 로 도구바 칸을 맞춘다. 그래야 브라우저
   * 기본 컨트롤(⋮ 재생 속도)로 바꿔도 칸이 따라오고, 두 자리가 서로 다른 값을 말하지 않는다.
   * 변환본(MP4)으로 갈아탈 때 load() 가 속도를 1× 로 돌려놓으므로 loadedmetadata 에서 되건다. */
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const speedLabel = (rate) => (rate === 1 ? "1×(보통)" : rate + "×");
  let speedPick = null;                                    // 도구바 선택칸(영상에서만 만든다)
  let chosenRate = 1;
  const syncSpeedUI = () => {
    const rate = String(Number(media.playbackRate) || 1);
    if (!speedPick) return;
    if (![...speedPick.options].some(o => o.value === rate)){
      const extra = document.createElement("option");     // 기본 메뉴로 고른 값(0.25× 등)도 칸에 보이게
      extra.value = rate; extra.textContent = rate + "×";
      speedPick.appendChild(extra);
    }
    speedPick.value = rate;
  };
  function setSpeed(rate, announce){
    const next = Number(rate);
    if (!Number.isFinite(next) || next <= 0) return;
    try { media.playbackRate = next; } catch(_){ return; }
    if (announce && typeof toast === "function") toast("재생 속도 " + speedLabel(next), 1400);
  }
  function stepSpeed(dir){
    const current = Number(media.playbackRate) || 1;
    let index = 0;                                         // 목록에 없는 값이면 가장 가까운 칸에서 출발
    SPEEDS.forEach((v, i) => { if (Math.abs(v - current) < Math.abs(SPEEDS[index] - current)) index = i; });
    if (Math.abs(SPEEDS[index] - current) < 1e-6) index += dir;
    else if (dir < 0 && SPEEDS[index] > current) index -= 1;
    else if (dir > 0 && SPEEDS[index] < current) index += 1;
    setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, index))], true);
  }
  media.addEventListener("ratechange", () => { chosenRate = Number(media.playbackRate) || 1; syncSpeedUI(); });
  media.addEventListener("loadedmetadata", () => {
    if (Math.abs((Number(media.playbackRate) || 1) - chosenRate) > 1e-6) media.playbackRate = chosenRate;
  });

  const onMediaKey = (e) => {
    if (!media.isConnected){ document.removeEventListener("keydown", onMediaKey, true); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const seek = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    const speed = (e.code === "BracketLeft" || e.key === "[") ? -1
      : (e.code === "BracketRight" || e.key === "]") ? 1 : 0;
    if (!seek && !speed) return;
    if (activeId !== doc.id) return;                       // 분할·다른 탭에서 누른 키는 그 문서 몫
    const ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    if (seek && media.readyState < 1) return;              // 길이를 모르면 건너뛸 자리도 없다
    e.preventDefault();
    if (seek) seekBy(seek * SEEK_STEP); else stepSpeed(speed);
  };
  document.addEventListener("keydown", onMediaKey, true);
  doc.cleanupFns.push(() => document.removeEventListener("keydown", onMediaKey, true));

  // 같은 탭에서 재생 원본만 바꾼다(자막·크기 설정 유지) — 변환본(MP4)으로 전환할 때 사용
  function vvPlayFile(newFile){
    state.noticeClosed = false;
    state.videoWarningShown = false;
    state.failed = false;
    state.forceVideo = false;
    state.converted = null;
    state.playSibling = null;
    if (noticeEl) noticeEl.remove();
    noticeEl = null;
    stage.querySelectorAll(".vv-error").forEach(el => el.remove());
    const resumeAt = media.currentTime;
    const wasPlaying = !media.paused && !media.ended;
    const seekOnce = () => {
      media.removeEventListener("loadedmetadata", seekOnce);
      try { if (resumeAt > 0 && resumeAt < (media.duration || Infinity)) media.currentTime = resumeAt; } catch(_){}
      if (wasPlaying){ const p = media.play(); if (p && p.catch) p.catch(() => {}); }
    };
    media.addEventListener("loadedmetadata", seekOnce);
    setMediaSource(newFile);
  }

  // ---- 재생 불가·무음 안내 + ffmpeg(있을 때만) MP4 변환 ----
  let noticeEl = null, noticeText = null, noticeBtn = null, noticeMeter = null;
  const setNotice = (message) => { if (noticeText) noticeText.textContent = message; };
  // 변환 진행 막대. 퍼센트를 모르는 동안(원본 길이 미상)에는 값을 비워 불확정 막대로 둔다.
  const setNoticeMeter = (percent) => {
    if (!noticeMeter) return;
    noticeMeter.hidden = percent == null;
    if (percent == null) return;
    if (percent >= 0) noticeMeter.value = Math.min(100, Math.max(0, percent));
    else noticeMeter.removeAttribute("value");
  };
  function showConvertNotice(message){
    if (state.noticeClosed) return;
    if (!noticeEl || !noticeEl.isConnected){
      noticeEl = document.createElement("div"); noticeEl.className = "vv-notice";
      noticeText = document.createElement("span"); noticeText.className = "vv-notice-text";
      noticeBtn = document.createElement("button"); noticeBtn.type = "button"; noticeBtn.textContent = "MP4로 변환";
      noticeBtn.title = "필요한 영상·소리만 호환 형식으로 변환해요";
      noticeBtn.addEventListener("click", () => {
        if (state.converting) return;                    // 변환 중에는 이 버튼이 '중지'로 바뀐다(따로 처리)
        if (state.converted) vvDownloadFile(state.converted);
        else if (state.playSibling){
          const sibling = state.playSibling;
          state.playSibling = null;
          state.noticeClosed = true;
          noticeEl.remove();
          vvPlayFile(sibling);
          if (typeof toast === "function") toast("변환본(" + sibling.name + ")으로 재생해요.", 2600);
        }
        else if (state.installMode) installFfmpeg();
        else startConvert();
      });
      const close = document.createElement("button"); close.type = "button"; close.className = "vv-notice-close";
      close.textContent = "×"; close.title = "닫기";
      close.addEventListener("click", () => { state.noticeClosed = true; noticeEl.remove(); });
      noticeMeter = document.createElement("progress"); noticeMeter.className = "vv-notice-meter";
      noticeMeter.max = 100; noticeMeter.value = 0; noticeMeter.hidden = true;
      noticeEl.append(noticeText, noticeMeter, noticeBtn);
      // 폴더로 열었고 변환 대상 영상이 더 있으면 일괄 변환도 바로 제안
      const rootNode = vvDocFolderRoot(doc);
      if (rootNode && vvFolderVideoTargets(rootNode.nodeId).length > 1){
        const batchBtn = document.createElement("button");
        batchBtn.type = "button"; batchBtn.textContent = "폴더 전체 변환";
        batchBtn.title = "이 폴더의 MKV·AVI·WMV·FLV·MOV 영상을 한꺼번에 MP4로 변환해 폴더에 저장해요 (한 번만 하면 됨)";
        batchBtn.addEventListener("click", () => vvBatchConvertFolder(rootNode.nodeId));
        noticeEl.appendChild(batchBtn);
      }
      noticeEl.appendChild(close);
      wrap.insertBefore(noticeEl, stage);
    }
    setNotice(message);
  }
  // ffmpeg 원클릭 설치: exe가 다운로드→압축 해제→배치를 전부 처리하고, 여기서는 진행률만 보여준다.
  // 끝나면 바로 변환을 이어간다(사용자는 버튼 한 번이면 됨).
  async function installFfmpeg(){
    noticeBtn.disabled = true;
    try {
      const start = await fetch("/install-ffmpeg", { method: "POST" });
      if (!start.ok) throw new Error((await start.text()) || ("HTTP " + start.status));
      const MAX_POLLS = 1200;   // 800ms × 1200 = 최대 16분(느린 인터넷 여유)
      for (let i = 0; i < MAX_POLLS; i++){
        await new Promise(resolve => setTimeout(resolve, 800));
        const res = await fetch("/ffmpeg-install-status");
        if (!res.ok) continue;
        const info = await res.json();
        if (info.state === "done") break;
        if (info.state === "error") throw new Error(info.error || "설치 실패");
        if (i === MAX_POLLS - 1) throw new Error("시간 초과 — 인터넷 상태를 확인해 주세요");
        if (info.state === "extracting") setNotice("설치 중… (압축에서 꺼내 배치하는 중)");
        else if (info.total > 0) setNotice("무료 변환 도구 내려받는 중… " + Math.round(info.received / 1048576) + " / " + Math.round(info.total / 1048576) + " MB");
        else setNotice("무료 변환 도구 내려받는 중…");
      }
      _vvMediaBackend = null;               // 설치됐으니 가용성 다시 확인
      state.installMode = false;
      noticeBtn.disabled = false;
      noticeBtn.textContent = "MP4로 변환";
      noticeBtn.title = "필요한 영상·소리만 호환 형식으로 변환해요";
      setNotice("설치 완료! 이어서 변환을 시작해요.");
      startConvert();                        // 설치 직후 바로 변환까지
    } catch(e){
      noticeBtn.disabled = false;
      setNotice("자동 설치에 실패했어요 (" + ((e && e.message) || e) + "). 인터넷 연결을 확인하고 다시 눌러주세요. 인터넷이 안 되는 컴퓨터라면 다른 곳에서 ffmpeg.exe 를 받아 ClassDock.exe 옆에 복사해 두면 돼요.");
    }
  }

  /* 경로 방식 변환. 원본도 결과도 디스크에 그대로 두고 ffmpeg 만 돌리므로 크기 제한이 없다.
   * 변환 중에는 안내 바의 버튼이 '변환 중지'가 되고, 끝나면 이 탭이 바로 변환본으로 갈아탄다. */
  async function startConvertByPath(ref){
    const outRel = vvNativeOutputRel(ref, !!state.forceVideo);
    const outName = outRel.split("/").pop();
    let job = "";
    const onCancel = () => { noticeBtn.disabled = true; noticeBtn.textContent = "중지하는 중…"; vvCancelConvertJob(job); };
    state.converting = true;
    noticeBtn.textContent = "변환 중지";
    noticeBtn.title = "변환을 멈춰요. 만들다 만 파일은 남기지 않아요";
    noticeBtn.addEventListener("click", onCancel);
    setNotice("MP4로 변환 준비 중…");
    setNoticeMeter(-1);
    try {
      job = await vvStartConvertJob(ref, !!state.forceVideo);
      const info = await vvWaitConvertJob(job, progress => {
        setNotice(vvConvertProgressText(progress) + " — 이 탭을 닫지 마세요. 다 되면 자동으로 바뀌어요.");
        setNoticeMeter(Number(progress.percent));
      });
      if (info.state === "cancelled"){ setNotice("변환을 중지했어요."); return; }
      if (info.state !== "done") throw new Error(info.error || "변환 실패");
      state.noticeClosed = true;
      if (noticeEl) noticeEl.remove();
      vvPlayFile(vvNativeMediaFile(outName, { rootId: ref.rootId, relPath: outRel }));
      if (typeof toast === "function")
        toast("변환 완료 — '" + outName + "' 를 원본 옆에 저장했어요. 다음부터는 이 파일을 열면 돼요.", 5200);
      // 새로 생긴 mp4 가 폴더 목록에도 보이게 한다.
      const root = vvDocFolderRoot(doc);
      if (root && root.folderRefreshRootId && typeof requestFolderRefresh === "function")
        requestFolderRefresh(root.folderRefreshRootId);
    } catch(e){
      const msg = String((e && e.message) || e);
      setNotice(msg.indexOf("no-ffmpeg") >= 0
        ? "ffmpeg를 찾지 못했어요. ffmpeg.exe 를 ClassDock.exe 옆에 놓고 다시 시도해 주세요."
        : "변환에 실패했어요: " + msg);
    } finally {
      state.converting = false;
      setNoticeMeter(null);
      noticeBtn.removeEventListener("click", onCancel);
      noticeBtn.disabled = false;
      noticeBtn.textContent = "MP4로 변환";
      noticeBtn.title = "필요한 영상·소리만 호환 형식으로 변환해요";
    }
  }

  async function startConvert(){
    const file = currentFile;
    if (location.protocol !== "http:" && location.protocol !== "https:"){
      setNotice("영상 변환은 ClassDock.exe 로 실행할 때만 쓸 수 있어요.");
      return;
    }
    if (!(await vvMediaBackendAvailable())){
      // ffmpeg 가 아직 없음 → 버튼을 원클릭 설치로 전환(다운로드·압축 해제·배치는 exe가 알아서)
      state.installMode = true;
      noticeBtn.textContent = "무료 변환 도구 설치";
      noticeBtn.title = "공식 배포처에서 ffmpeg를 내려받아 자동으로 설치해요 (컴퓨터당 1회)";
      setNotice("변환에는 무료 변환 도구(ffmpeg)가 필요해요. 버튼을 누르면 인터넷에서 약 90MB를 한 번만 내려받아 자동 설치됩니다.");
      return;
    }
    // 런처가 경로를 아는 파일이면 크기와 상관없이 경로 방식으로 처리한다.
    const nativeRef = vvNativeRefOf(doc.sourceFile || file);
    if (nativeRef) return startConvertByPath(nativeRef);
    // 끌어다 놓아 연 파일은 경로를 알 수 없어 본문으로 주고받는다 — 그쪽만 크기 제한이 남는다.
    if (file.size > 1024 * 1024 * 1024){
      setNotice("이 파일은 1GB가 넘어요. 폴더째 열면(파일 → 폴더 열기) 크기 제한 없이 변환할 수 있어요."
        + " 끌어다 놓은 파일은 앱이 원본 위치를 알 수 없어 통째로 주고받아야 하거든요.");
      return;
    }
    noticeBtn.disabled = true;
    state.converting = true;
    setNotice("MP4로 변환 중… 영상 길이에 따라 몇 분 걸릴 수 있어요. 이 탭을 닫지 마세요.");
    try {
      const res = await fetch("/convert-media", {
        method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Media-Reencode": state.forceVideo ? "1" : "0" }, body: file
      });
      if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
      const blob = await res.blob();
      const mp4Name = vvNativeOutputRel({ relPath:file.name }, !!state.forceVideo);
      state.converted = new File([blob], mp4Name, { type: "video/mp4" });
      if (typeof handleFiles === "function") await handleFiles([state.converted], { transient: true });
      noticeBtn.textContent = "변환본 저장"; noticeBtn.disabled = false;
      noticeBtn.title = "변환된 MP4를 파일로 내려받아 다음부터 바로 재생";
      setNotice("변환 완료 — '" + mp4Name + "' 새 탭에서 소리와 함께 재생돼요. 다음부터 바로 쓰려면 파일로 저장해 두세요.");
    } catch(e){
      noticeBtn.disabled = false;
      const msg = String((e && e.message) || e);
      setNotice(msg.indexOf("no-ffmpeg") >= 0
        ? "ffmpeg를 찾지 못했어요. ffmpeg.exe 를 ClassDock.exe 옆에 놓고 다시 시도해 주세요."
        : "변환에 실패했어요: " + msg);
    } finally {
      state.converting = false;
    }
  }

  function offerVideoReencode(message){
    if (state.converting) return;
    state.noticeClosed = false;
    state.forceVideo = true;
    state.playSibling = null;
    state.converted = null;
    showConvertNotice(message);
    if (noticeBtn){
      noticeBtn.textContent = "영상 다시 인코딩";
      noticeBtn.title = "영상을 H.264 호환 형식으로 다시 인코딩해 별도 파일로 저장해요";
    }
  }

  media.addEventListener("error", () => {
    if (state.failed) return;
    state.failed = true;
    const box = document.createElement("div"); box.className = "vv-error";
    box.textContent = "이 파일을 브라우저에서 재생하지 못했어요."
      + (["avi","wmv","flv"].includes(ext) ? " AVI·WMV·FLV 형식은 대부분 지원되지 않아요." : " 파일 안의 코덱에 따라 재생이 안 될 수 있어요.")
      + " MP4(H.264)·WebM 변환을 권장합니다.";
    stage.appendChild(box);
    if (doc.media !== "audio") offerVideoReencode("재생할 수 없는 형식이에요. 영상을 호환 형식으로 다시 인코딩할 수 있어요.");
  });

  // 소리 코덱 미지원(MKV 의 AC-3/DTS 등) 감지: 몇 초 재생했는데 오디오 디코딩량이 0이면 안내.
  // webkitAudioDecodedByteCount 는 Chromium 계열 전용 — 없으면 감지를 건너뛴다(안내만 못 할 뿐 재생은 정상).
  if (doc.media !== "audio"){
    const missingVideoCheck = () => {
      if (state.converting || state.noticeClosed || state.videoWarningShown || !vvMissingVideoFrames(media)) return;
      state.videoWarningShown = true;
      offerVideoReencode("재생은 진행되지만 영상 화면이 감지되지 않아요. 영상이 있는 파일이라면 다시 인코딩해 보세요.");
    };
    media.addEventListener("timeupdate", missingVideoCheck);
    doc.cleanupFns.push(() => media.removeEventListener("timeupdate", missingVideoCheck));
    const silentCheck = () => {
      if (typeof media.webkitAudioDecodedByteCount !== "number"){ media.removeEventListener("timeupdate", silentCheck); return; }
      if (media.currentTime < 3) return;
      media.removeEventListener("timeupdate", silentCheck);
      if (!state.forceVideo && media.webkitAudioDecodedByteCount === 0 && !media.muted && media.volume > 0 && !state.playSibling){
        showConvertNotice("영상은 나오지만 소리 코덱(AC-3·DTS 등)을 브라우저가 지원하지 않아 소리가 안 나요. MP4로 변환하면 소리가 복구됩니다.");
      }
    };
    media.addEventListener("timeupdate", silentCheck);
  }

  // 변환본(같은 이름 .mp4)이 이미 있으면 열자마자 안내 — 일괄 변환 뒤 원본(MKV)을 눌러도
  // 한 클릭으로 소리 나는 변환본으로 넘어가게 한다. ① 같은 폴더 그룹의 열린 문서 ② 같은 폴더(핸들) 순.
  if (doc.media !== "audio" && VV_BATCH_EXTS.includes(ext)){
    (async () => {
      const mp4Name = vvNativeOutputRel({ relPath:file.name }, !!state.forceVideo);
      let sibling = null;
      if (typeof docs !== "undefined"){
        const open = docs.find(d => d !== doc && d.kind === "video" && d.parentId === doc.parentId
          && String(d.name).toLowerCase() === mp4Name.toLowerCase() && d.sourceFile);
        if (open) sibling = open.sourceFile;
      }
      if (!sibling){
        const dir = file.__fsDirHandle || doc.fsDirHandle || null;
        if (dir && typeof dir.getFileHandle === "function"){
          try { sibling = await (await dir.getFileHandle(mp4Name)).getFile(); } catch(_){}
        }
      }
      if (!sibling || state.noticeClosed || state.converted || state.forceVideo) return;
      state.playSibling = sibling;
      showConvertNotice("이 영상의 변환본(" + mp4Name + ")이 이미 있어요 — 소리까지 정상인 변환본으로 재생하세요.");
      if (noticeBtn){ noticeBtn.textContent = "변환본으로 재생"; noticeBtn.title = "같은 장면부터 변환본(MP4)으로 이어서 재생해요"; }
    })();
  }

  // ---- 자막 도구(영상만 — 오디오는 자막 표시 영역이 없다) ----
  if (doc.media !== "audio"){
    const bar = document.createElement("div"); bar.className = "vv-bar";

    // 프레임 캡처: 현재 장면을 이미지로 떠서 일반 메모에 넣는다(체육 자세·실험 장면 기록용).
    // 메모를 못 쓰는 환경이면 PNG 다운로드로 폴백.
    const btnCapture = document.createElement("button");
    btnCapture.type = "button"; btnCapture.textContent = "📷 장면 캡처";
    btnCapture.title = "현재 화면(프레임)을 이미지로 캡처해 메모에 넣어요";
    btnCapture.addEventListener("click", () => {
      if (!media.videoWidth || !media.videoHeight){
        if (typeof toast === "function") toast("영상을 먼저 재생하거나 원하는 장면으로 이동해 주세요.", 2600);
        return;
      }
      const cv = document.createElement("canvas");
      cv.width = media.videoWidth; cv.height = media.videoHeight;
      try { cv.getContext("2d").drawImage(media, 0, 0); }
      catch(e){ if (typeof toast === "function") toast("이 영상에서는 화면을 캡처할 수 없어요.", 2600, { type: "error" }); return; }
      const t = Math.max(0, Math.floor(media.currentTime || 0));
      const stamp = (t >= 3600 ? Math.floor(t / 3600) + "h" : "")
        + String(Math.floor(t / 60) % 60).padStart(2, "0") + "m" + String(t % 60).padStart(2, "0") + "s";
      const base = String(file.name || "video").replace(/\.[^.]+$/, "");
      const name = base + "_" + stamp + ".png";
      cv.toBlob((blob) => {
        if (!blob){ if (typeof toast === "function") toast("캡처 이미지를 만들지 못했어요.", 2400, { type: "error" }); return; }
        const png = new File([blob], name, { type: "image/png" });
        if (typeof window.addImagesToScratchpad === "function"){
          Promise.resolve(window.addImagesToScratchpad([png], { name: base + " " + stamp + " 장면" }))
            .then(() => { if (typeof toast === "function") toast("현재 장면을 메모에 넣었어요. (" + name + ")", 2200, { type: "success" }); })
            .catch(() => vvDownloadFile(png));                     // 메모 실패 → 파일 다운로드 폴백
        } else vvDownloadFile(png);
      }, "image/png");
    });

    /* 작은 창(PiP): 영상만 떼어 화면 맨 위에 띄우고 교과서·문제지를 함께 본다.
     * 창은 브라우저가 그리므로 아래 '자막 크기'(::cue)는 이 창에 적용되지 않는다 — 키워 둔 상태면 한 번 알린다.
     * 미지원 브라우저(파이어폭스 등)에서는 버튼을 감춰 눌러도 안 되는 자리를 만들지 않는다. */
    const btnPip = document.createElement("button");
    btnPip.type = "button"; btnPip.textContent = "작은 창";
    btnPip.title = "영상만 작은 창으로 떼어 화면 위에 띄워요 — 다른 자료를 보면서 재생 (Alt+P)";
    const pipUsable = () => !!(document.pictureInPictureEnabled && !media.disablePictureInPicture
      && typeof media.requestPictureInPicture === "function");
    if (!pipUsable()) btnPip.hidden = true;
    const syncPipBtn = () => {
      const on = document.pictureInPictureElement === media;
      btnPip.textContent = on ? "작은 창 끄기" : "작은 창";
      btnPip.disabled = !on && media.readyState < 1;      // 메타데이터 전에는 요청 자체가 실패한다
    };
    async function togglePip(){
      if (btnPip.hidden || !pipUsable()) return;
      try {
        if (document.pictureInPictureElement === media){ await document.exitPictureInPicture(); return; }
        if (media.readyState < 1){
          if (typeof toast === "function") toast("영상을 잠깐 재생한 뒤 작은 창으로 띄워 주세요.", 2600);
          return;
        }
        await media.requestPictureInPicture();
        const shown = currentTrack();
        if (state.sizeIndex > 0 && !state.pipCueWarned && shown && shown.mode === "showing"){
          state.pipCueWarned = true;
          if (typeof toast === "function") toast("작은 창에서는 자막 크기 설정이 적용되지 않아요.", 3000);
        }
      } catch(e){
        if (typeof toast === "function") toast("작은 창으로 띄우지 못했어요.", 2600, { type: "error" });
      }
    }
    btnPip.addEventListener("click", togglePip);
    media.addEventListener("loadedmetadata", syncPipBtn);
    media.addEventListener("enterpictureinpicture", syncPipBtn);
    media.addEventListener("leavepictureinpicture", syncPipBtn);
    syncPipBtn();

    // Alt+P — 이 영상 탭이 활성일 때만. 입력칸에 있을 때는 글자 입력이 우선이다.
    const onPipKey = (e) => {
      if (!media.isConnected){ document.removeEventListener("keydown", onPipKey, true); return; }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if (e.code !== "KeyP" && String(e.key).toLowerCase() !== "p") return;
      if (activeId !== doc.id) return;
      const ae = document.activeElement;
      if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
      e.preventDefault();
      togglePip();
    };
    document.addEventListener("keydown", onPipKey, true);
    doc.cleanupFns.push(() => {
      document.removeEventListener("keydown", onPipKey, true);
      try { if (document.pictureInPictureElement === media) document.exitPictureInPicture(); } catch(_){}
    });

    speedPick = document.createElement("select");
    speedPick.className = "vv-speed";
    speedPick.title = "재생 속도 — 느리게 들려주거나 빠르게 복습해요 ( [ 와 ] 키 )";
    speedPick.setAttribute("aria-label", "재생 속도");
    SPEEDS.forEach((rate) => {
      const option = document.createElement("option");
      option.value = String(rate); option.textContent = speedLabel(rate);
      speedPick.appendChild(option);
    });
    speedPick.addEventListener("change", () => setSpeed(speedPick.value, false));
    syncSpeedUI();

    const btnOpen = document.createElement("button");
    btnOpen.type = "button"; btnOpen.textContent = "자막 열기";
    btnOpen.title = "SRT · VTT · SMI 자막 파일을 이 영상에 연결 (한글 인코딩 자동 인식)";
    const btnToggle = document.createElement("button");
    btnToggle.type = "button"; btnToggle.textContent = "자막 숨기기"; btnToggle.disabled = true;
    const btnSize = document.createElement("button");
    btnSize.type = "button"; btnSize.disabled = true;
    btnSize.title = "교실 뒷자리에서도 보이게 자막 글자 크기를 키워요";
    const status = document.createElement("span"); status.className = "vv-status";
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = ".srt,.vtt,.smi"; picker.hidden = true;

    const CUE_SIZES = [["", "보통"], ["vv-cue-l", "크게"], ["vv-cue-xl", "최대"]];
    const applyCueSize = () => {
      CUE_SIZES.forEach(([cls]) => { if (cls) media.classList.remove(cls); });
      const [cls, label] = CUE_SIZES[state.sizeIndex];
      if (cls) media.classList.add(cls);
      btnSize.textContent = "자막 크기: " + label;
    };
    applyCueSize();

    const currentTrack = () => (state.trackEl && state.trackEl.track) || null;
    const refreshToggle = () => {
      const track = currentTrack();
      btnToggle.disabled = btnSize.disabled = !track;
      btnToggle.textContent = track && track.mode === "showing" ? "자막 숨기기" : "자막 보이기";
    };

    async function attachSubtitleFile(subFile, auto){
      let vtt = "";
      try {
        const bytes = new Uint8Array(await subFile.arrayBuffer());
        vtt = subtitleToVtt(subFile.name, (typeof smartDecodeText === "function") ? smartDecodeText(bytes) : new TextDecoder().decode(bytes));
      } catch(_){}
      if (!vtt){
        if (!auto && typeof toast === "function") toast("자막을 읽지 못했어요: " + subFile.name, 3200);
        return false;
      }
      if (state.trackEl) state.trackEl.remove();
      if (state.trackUrl) URL.revokeObjectURL(state.trackUrl);
      state.trackUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
      const track = document.createElement("track");
      track.kind = "subtitles"; track.label = subFile.name; track.srclang = "ko"; track.default = true;
      track.src = state.trackUrl;
      media.appendChild(track);
      state.trackEl = track;
      try { track.track.mode = "showing"; } catch(_){}
      track.addEventListener("load", () => { try { track.track.mode = "showing"; } catch(_){} refreshToggle(); });
      status.textContent = "자막: " + subFile.name + (auto ? " (자동 연결)" : "");
      refreshToggle();
      return true;
    }

    // 같은 제목 자막 자동 연결: ① 함께 열린 탭 → ② 같은 폴더(폴더로 열었을 때)
    async function findAutoSubtitle(){
      if (typeof docs !== "undefined"){
        const open = docs.find(d => d.sourceFile && subtitleMatchesMedia(file.name, d.name));
        if (open) return open.sourceFile;
      }
      const dir = file.__fsDirHandle || doc.fsDirHandle || null;
      if (dir && typeof dir.getFileHandle === "function"){
        const base = file.name.replace(/\.[^.]+$/, "");
        for (const subExt of SUBTITLE_EXTS){
          try { return await (await dir.getFileHandle(base + "." + subExt)).getFile(); } catch(_){}
        }
      }
      return null;
    }
    async function tryAutoSubtitle(){
      if (state.trackEl) return;
      const found = await findAutoSubtitle();
      if (found && !state.trackEl) await attachSubtitleFile(found, true);
    }
    tryAutoSubtitle();
    // 여러 파일 동시 드래그에서 자막 탭이 이 영상보다 늦게 열리는 경우 — 첫 재생 때 한 번 더 찾는다.
    media.addEventListener("play", tryAutoSubtitle, { once: true });

    btnOpen.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      const subFile = picker.files && picker.files[0];
      if (subFile) attachSubtitleFile(subFile, false);
      picker.value = "";
    });
    btnToggle.addEventListener("click", () => {
      const track = currentTrack();
      if (!track) return;
      track.mode = track.mode === "showing" ? "hidden" : "showing";
      refreshToggle();
    });
    btnSize.addEventListener("click", () => {
      state.sizeIndex = (state.sizeIndex + 1) % CUE_SIZES.length;
      applyCueSize();
    });

    const btnReencode = document.createElement("button");
    btnReencode.type = "button"; btnReencode.textContent = "영상 다시 변환";
    btnReencode.title = "화면이 안 나오거나 깨질 때 호환 형식으로 다시 인코딩";
    btnReencode.addEventListener("click", () => offerVideoReencode("영상을 H.264 호환 형식으로 다시 인코딩해 별도 파일로 저장해요. 영상 길이에 따라 시간이 걸릴 수 있어요."));
    bar.append(btnCapture, btnPip, speedPick, btnReencode, btnOpen, btnToggle, btnSize, status, picker);
    wrap.appendChild(bar);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);
  }

  wrap.appendChild(stage);
  doc.el.appendChild(wrap);
}

// 테스트용(브라우저 없는 node 환경) — 자막 변환 순수 함수만 내보낸다.
if (typeof module !== "undefined" && module.exports){
  module.exports = {
    srtToVtt,
    smiToVtt,
    subtitleToVtt,
    subtitleMatchesMedia,
    msToVttTime,
    isMediaFileName,
    vvNativeRefOf,
    vvNativeOutputRel,
    vvMissingVideoFrames,
    vvConvertProgressText,
    vvConvertRemainingSec,
    vvFormatDuration
  };
}
