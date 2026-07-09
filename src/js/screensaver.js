"use strict";

/* ===== 화면보호기(대기 화면) =====
   옵션에서 켤 때만 동작한다(기본 꺼짐). 일정 시간 입력이 없으면 전체 화면 오버레이로,
   사용자가 고른 영상(브라우저 저장소에 보관 — exe/HTML 배포 용량과 무관)을 재생하거나,
   영상이 없으면 내장 애니메이션(떠다니는 입자 + 시계)을 보여준다.
   작업 중(파이썬·노트북 실행, 미디어 재생, 처리 중, 모달, iframe 사용)에는 뜨지 않는다.
   아무 입력(마우스·키·터치)이면 즉시 사라지며, 그 첫 입력은 아래 UI 로 새지 않게 삼킨다. */

const SS_DB = "mnScreensaver", SS_STORE = "media", SS_KEY = "video";
const SS_NAME_KEY = "mnScreensaverVideoName";     // 구버전(단일 영상) 이름 키 — 읽기 호환용
const SS_NAMES_KEY = "mnScreensaverVideoNames";   // 영상 이름 목록(JSON 배열)

// ----- 영상 저장(IndexedDB; exe 에 박히지 않음) — 키 video-0…N 에 순서대로, 구버전 단일 키(video)도 읽는다 -----
function ssOpenDb(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(SS_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(SS_STORE)) req.result.createObjectStore(SS_STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function ssPutVideos(blobs){
  const db = await ssOpenDb();
  await new Promise((res, rej) => {
    const tx = db.transaction(SS_STORE, "readwrite");
    const store = tx.objectStore(SS_STORE);
    store.clear();                                          // 새 선택은 기존 목록 전체 교체
    blobs.forEach((blob, i) => store.put(blob, SS_KEY + "-" + i));
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function ssGetVideoKeys(){
  try {
    const db = await ssOpenDb();
    const keys = await new Promise((res, rej) => { const r = db.transaction(SS_STORE, "readonly").objectStore(SS_STORE).getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
    const vids = keys.filter(k => typeof k === "string" && k.indexOf(SS_KEY + "-") === 0)
      .sort((a, b) => Number(a.slice(SS_KEY.length + 1)) - Number(b.slice(SS_KEY.length + 1)));
    if (vids.length) return vids;
    return keys.indexOf(SS_KEY) >= 0 ? [SS_KEY] : [];       // 구버전 단일 저장 호환
  } catch(_){ return []; }
}
async function ssGetVideoByKey(key){
  try { const db = await ssOpenDb(); return await new Promise((res, rej) => { const r = db.transaction(SS_STORE, "readonly").objectStore(SS_STORE).get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }
  catch(_){ return null; }
}
async function ssClearVideos(){
  try { const db = await ssOpenDb(); await new Promise((res) => { const tx = db.transaction(SS_STORE, "readwrite"); tx.objectStore(SS_STORE).clear(); tx.oncomplete = res; tx.onerror = res; }); }
  catch(_){}
}
function screensaverVideoNames(){
  try {
    const raw = localStorage.getItem(SS_NAMES_KEY);
    if (raw){ const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map(String); }
  } catch(_){}
  try { const one = localStorage.getItem(SS_NAME_KEY); if (one) return [one]; } catch(_){}   // 구버전 호환
  return [];
}

// 확장자 → MIME 보정(파일 type 이 비어 있을 때). 재생 가능성 판정에 쓴다.
const SS_EXT_MIME = { mp4:"video/mp4", m4v:"video/mp4", webm:"video/webm", ogv:"video/ogg", ogg:"video/ogg", mov:"video/quicktime", mkv:"video/x-matroska", avi:"video/x-msvideo", wmv:"video/x-ms-wmv", flv:"video/x-flv" };
// 이 브라우저가 재생할 수 있는 형식인지 1차 점검(<video>.canPlayType). ok=false 면 실제 재생 검사로 넘어간다.
function screensaverPlayability(file){
  const ext = ((file.name || "").split(".").pop() || "").toLowerCase();
  const mime = file.type || SS_EXT_MIME[ext] || "";
  let can = "";
  try { can = document.createElement("video").canPlayType(mime); } catch(_){}
  return { ext, mime, ok: can !== "" };
}
// 실제 재생 검사: 숨김 <video> 에 넣어 첫 프레임이 디코딩되는지 확인한다.
// canPlayType 은 MKV 같은 컨테이너에 보수적으로 "" 를 돌려주지만, 크로미움은 H.264/AAC MKV 를
// 실제로는 재생한다. 반대로 코덱이 안 되면(H.265 등) 여기서 error 가 나 정확히 걸러진다.
function probeVideoPlayback(file, timeoutMs=7000){
  return new Promise((resolve) => {
    let url = "";
    const v = document.createElement("video");
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try { v.removeAttribute("src"); v.load(); } catch(_){}
      if (url) URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    v.muted = true; v.preload = "auto";
    v.addEventListener("loadeddata", () => { clearTimeout(timer); done(true); }, { once:true });
    v.addEventListener("error", () => { clearTimeout(timer); done(false); }, { once:true });
    try { url = URL.createObjectURL(file); v.src = url; v.load(); }
    catch(_){ clearTimeout(timer); done(false); }
  });
}

// 설정 UI 에서 호출 — 즉시 저장/삭제(켜짐 여부·시간은 설정 저장 버튼을 따른다).
// 여러 개를 고르면 실제 재생 검사를 통과한 영상만 고른 순서대로 저장하고, 대기 화면에서 차례로 반복 재생한다.
// 새로 고르면 기존 목록은 전체 교체된다.
async function setScreensaverVideos(files){
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) return false;
  const videos = [], excluded = [];
  for (const file of list){
    const ext = ((file.name || "").split(".").pop() || "").toLowerCase();
    const looksVideo = /^video\//.test(file.type || "") || Object.prototype.hasOwnProperty.call(SS_EXT_MIME, ext);
    if (!looksVideo){ excluded.push(file.name || "이름 없는 파일"); continue; }
    const quick = screensaverPlayability(file);
    const playable = quick.ok || await probeVideoPlayback(file);   // MKV 등 컨테이너 라벨로 못 가린 형식은 실제 재생으로 판정
    if (playable) videos.push(file);
    else excluded.push(file.name || ext.toUpperCase());
  }
  if (!videos.length){
    if (typeof toast === "function") toast("재생할 수 있는 영상이 없어요. MP4(H.264)·WebM 를 권장합니다."
      + (excluded.length ? " (제외: " + excluded.join(", ") + ")" : ""), 4200);
    return false;
  }
  try {
    await ssPutVideos(videos);
    try {
      localStorage.setItem(SS_NAMES_KEY, JSON.stringify(videos.map(f => f.name || "영상")));
      localStorage.removeItem(SS_NAME_KEY);
    } catch(_){}
    if (typeof toast === "function"){
      const saved = videos.length > 1 ? ("대기 화면 영상 " + videos.length + "개를 저장했어요. 차례대로 반복 재생합니다.") : "대기 화면 영상을 저장했어요.";
      toast(excluded.length ? saved + " 재생이 안 되는 " + excluded.length + "개는 제외했어요: " + excluded.join(", ") : saved,
        excluded.length ? 4600 : 2400);
    }
    return true;
  } catch(e){
    if (typeof toast === "function") toast("영상을 저장하지 못했어요. 용량이 너무 크면 짧은 영상으로 바꿔 주세요.", 3600);
    return false;
  }
}
async function clearScreensaverVideo(){
  await ssClearVideos();
  try { localStorage.removeItem(SS_NAME_KEY); localStorage.removeItem(SS_NAMES_KEY); } catch(_){}
  if (typeof toast === "function") toast("대기 화면 영상을 지웠어요. 기본 애니메이션을 사용합니다.", 2600);
}

// ----- 유휴 감지 -----
let ssTimer = 0, ssActive = false, ssOverlay = null, ssRaf = 0, ssObjUrl = null, ssKeyHandler = null;
let ssManualFullscreen = false;   // '지금 시작'으로 우리가 올린 전체화면이면 해제할 때 함께 내린다
function ssSettings(){ return (typeof appSettings !== "undefined" && appSettings.screensaver) || { enabled: false, idleMin: 5 }; }

// 작업 중이면 대기화면 금지(무입력이어도 바쁠 수 있는 상황).
function screensaverBusy(){
  try {
    const loading = document.getElementById("loading");
    if (loading && !loading.hidden) return true;                        // 처리 중 로더
    if (document.querySelector(".modal:not([hidden])")) return true;    // 설정·확인 등 모달
    if (document.querySelector(".is-running")) return true;             // 파이썬/노트북 실행 중
    const ae = document.activeElement;
    if (ae && ae.tagName === "IFRAME") return true;                     // 노트북 출력·HTML 미리보기 iframe 사용 중일 수 있음
    for (const m of document.querySelectorAll("video,audio")){ if (!m.paused && !m.ended && m.currentTime > 0) return true; }  // 미디어 재생 중
  } catch(_){}
  return false;
}

function armScreensaver(){
  clearTimeout(ssTimer); ssTimer = 0;
  const s = ssSettings();
  if (!s.enabled) return;
  const ms = Math.max(1, Number(s.idleMin) || 5) * 60 * 1000;
  ssTimer = setTimeout(tryShowScreensaver, ms);
}
function resetIdle(){
  if (ssActive) return;   // 활성 중 입력 처리는 showScreensaver 가 건 전용 리스너가 담당
  armScreensaver();
}
function tryShowScreensaver(){
  const s = ssSettings();
  if (!s.enabled || ssActive) return;
  if (document.hidden || screensaverBusy()){ armScreensaver(); return; }   // 바쁘면 한 주기 뒤로 미룸
  showScreensaver();
}

// ----- 오버레이 -----
async function showScreensaver(opts){
  if (ssActive) return;
  ssActive = true;
  const sound = !!(opts && opts.sound);   // '지금 시작'(사용자 제스처)일 때만 허용 — 유휴 자동 표시는 항상 무음
  const shownAt = Date.now();             // 표시 직후 잔여 마우스 움직임·키 반복으로 곧장 꺼지지 않게 잠깐 유예
  const ov = document.createElement("div"); ov.className = "screensaver"; ov.id = "screensaver";
  ssOverlay = ov;

  const keys = await ssGetVideoKeys();
  if (!ssActive){ return; }   // 로드 도중 해제됐으면 중단
  let usedVideo = false;
  if (keys.length){
    try {
      const v = document.createElement("video");
      v.className = "ss-video"; v.muted = !sound; v.defaultMuted = !sound;
      v.autoplay = true; v.setAttribute("playsinline", ""); v.playsInline = true;
      v.loop = keys.length === 1;               // 1개면 기존처럼 loop(재로딩 공백 없음), 여러 개면 ended 로 이어 붙임
      let idx = 0, failed = 0;
      const playAt = async (i) => {
        const blob = await ssGetVideoByKey(keys[i]);
        if (!ssActive || v.parentNode !== ov) return;
        if (!blob){ onFail(); return; }
        const prev = ssObjUrl;
        ssObjUrl = URL.createObjectURL(blob);   // 영상당 그때그때 URL 생성 → 메모리는 항상 1개분
        v.src = ssObjUrl;
        if (prev){ try { URL.revokeObjectURL(prev); } catch(_){} }
        v.play().catch(() => {
          // 소리 켠 재생이 자동재생 정책에 막히면 무음으로라도 재생한다
          if (!v.muted){ v.muted = true; v.play().catch(() => {}); }
        });
      };
      const onFail = () => {
        failed++;
        if (failed >= keys.length){             // 전부 실패 → 시계 애니메이션 폴백
          if (v.parentNode === ov){ ov.removeChild(v); startScreensaverAnimation(ov); }
          return;
        }
        idx = (idx + 1) % keys.length; playAt(idx);
      };
      v.addEventListener("ended", () => { if (keys.length > 1){ failed = 0; idx = (idx + 1) % keys.length; playAt(idx); } });
      v.addEventListener("error", onFail);
      ov.appendChild(v);
      playAt(0);
      usedVideo = true;
    } catch(_){ usedVideo = false; }
  }
  if (!usedVideo) startScreensaverAnimation(ov);

  const hint = document.createElement("div"); hint.className = "ss-hint";
  hint.textContent = "아무 키나 누르거나 화면을 클릭하면 돌아갑니다";
  ov.appendChild(hint);
  // ⛶ 문서 전체화면(특정 요소만 최상단 레이어) 중에는 body 에 붙이면 가려져 안 보이므로
  // 그 요소 안에 붙인다 → 전체화면 수업 중 유휴 대기 화면도 모니터 전체를 덮는다.
  const hostEl = (document.fullscreenElement && document.fullscreenElement !== document.documentElement)
    ? document.fullscreenElement : document.body;
  hostEl.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("show"));

  // 입력으로 해제(오버레이가 최상단이라 포인터는 오버레이가 받아 아래 UI 로 새지 않음). 키보드만 문서에서 가로챈다.
  // 마우스 이동·키 반복은 표시 직후 1.2초 동안 무시 — '지금 시작' 클릭의 잔여 움직임으로 바로 꺼지는 것 방지.
  // (클릭·휠·터치는 명백한 의도라 즉시 해제)
  const pastGrace = () => Date.now() - shownAt >= 1200;
  ov.addEventListener("pointerdown", (e) => dismissScreensaver(e, "pointer"), true);
  ov.addEventListener("pointermove", () => { if (pastGrace()) dismissScreensaver(null, "move"); }, true);
  ov.addEventListener("wheel", (e) => dismissScreensaver(e, "pointer"), { capture: true, passive: false });
  ov.addEventListener("touchstart", (e) => dismissScreensaver(e, "pointer"), { capture: true, passive: false });
  ssKeyHandler = (e) => { if (pastGrace()) dismissScreensaver(e, "key"); };
  document.addEventListener("keydown", ssKeyHandler, true);
}

function dismissScreensaver(e, source){
  if (!ssActive) return;
  if (e){ try { e.preventDefault(); } catch(_){} e.stopPropagation(); }
  if (source === "pointer"){
    // 해제 직후 브라우저가 만드는 click 이 아래 버튼을 누르지 않게 잠깐 삼킨다.
    const guard = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener("click", guard, true);
    setTimeout(() => document.removeEventListener("click", guard, true), 500);
  }
  hideScreensaver();
}

// 설정의 '지금 시작' — 클릭(사용자 제스처)이 있는 순간이라 전체화면 요청이 허용된다.
// 유휴 자동 표시는 브라우저 보안상 전체화면을 올릴 수 없어 창 안 오버레이로만 뜬다.
async function startScreensaverNow(){
  if (ssActive) return;
  const cancel = document.getElementById("settingsCancel");
  if (cancel) cancel.click();                             // 설정 모달을 정리하며 닫기(저장 여부와 무관하게 동작)
  if (!document.fullscreenElement){
    try { await document.documentElement.requestFullscreen(); ssManualFullscreen = true; }
    catch(_){ ssManualFullscreen = false; }               // 거부돼도 창 안 오버레이로 진행
  }
  // 클릭 직후 남은 마우스 움직임으로 뜨자마자 꺼지지 않게 1초 뒤에 표시한다.
  // 소리 재생은 수동 시작(사용자 제스처)일 때만 설정을 따른다 — 유휴 자동 표시는 항상 무음.
  const sound = !!ssSettings().sound;
  setTimeout(() => { showScreensaver({ sound }); }, 1000);
}

function hideScreensaver(){
  if (!ssActive) return;
  ssActive = false;
  if (ssManualFullscreen){
    ssManualFullscreen = false;
    if (document.fullscreenElement === document.documentElement){
      try { document.exitFullscreen().catch(() => {}); } catch(_){}
    }
  }
  if (ssRaf){ cancelAnimationFrame(ssRaf); ssRaf = 0; }
  if (ssKeyHandler){ document.removeEventListener("keydown", ssKeyHandler, true); ssKeyHandler = null; }
  if (ssOverlay){
    const ov = ssOverlay; ssOverlay = null;
    ov.classList.remove("show");
    const v = ov.querySelector("video"); if (v){ try { v.pause(); v.removeAttribute("src"); v.load(); } catch(_){} }
    const url = ssObjUrl; ssObjUrl = null;
    setTimeout(() => { try { ov.remove(); } catch(_){} if (url){ try { URL.revokeObjectURL(url); } catch(_){} } }, 280);
  }
  armScreensaver();   // 다시 유휴 대기
}

// ----- 내장 애니메이션(떠다니는 입자 + 시계) -----
function startScreensaverAnimation(ov){
  const c = document.createElement("canvas"); c.className = "ss-canvas"; ov.insertBefore(c, ov.firstChild);
  const ctx = c.getContext("2d");
  const size = () => { c.width = ov.clientWidth || window.innerWidth; c.height = ov.clientHeight || window.innerHeight; };
  size();
  const particles = [];
  const N = 70;
  for (let i = 0; i < N; i++) particles.push({ x: Math.random() * c.width, y: Math.random() * c.height, r: 1 + Math.random() * 2.4, vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28, a: 0.15 + Math.random() * 0.5 });
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const draw = () => {
    if (!ssActive){ return; }
    if (c.width !== (ov.clientWidth || window.innerWidth) || c.height !== (ov.clientHeight || window.innerHeight)) size();
    const W = c.width, H = c.height, m = Math.min(W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    for (const p of particles){
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x += W; else if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H; else if (p.y > H) p.y -= H;
      ctx.globalAlpha = p.a; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
    const cx = W / 2, cy = H / 2;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#f8fafc"; ctx.font = Math.round(m * 0.16) + 'px system-ui,"Malgun Gothic",sans-serif';
    ctx.fillText(hh + ":" + mm, cx, cy - H * 0.02);
    ctx.fillStyle = "rgba(226,232,240,.72)"; ctx.font = Math.round(m * 0.036) + 'px system-ui,"Malgun Gothic",sans-serif';
    ctx.fillText(now.getFullYear() + ". " + (now.getMonth() + 1) + ". " + now.getDate() + ". (" + days[now.getDay()] + ")", cx, cy + H * 0.10);
    ctx.fillStyle = "rgba(148,163,184,.55)"; ctx.font = Math.round(m * 0.028) + 'px system-ui,"Malgun Gothic",sans-serif';
    ctx.fillText("만능파일교실", cx, cy + H * 0.16);
    ssRaf = requestAnimationFrame(draw);
  };
  draw();
}

// 설정 변경 시 재적용(app.js 에서 호출).
function applyScreensaverSettings(){
  if (ssActive) hideScreensaver();
  else armScreensaver();
}

// 초기화(app.js init 에서 1회).
function initScreensaver(){
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "mousedown"].forEach((ev) =>
    window.addEventListener(ev, resetIdle, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (document.hidden){ if (ssActive) hideScreensaver(); } else armScreensaver(); });
  armScreensaver();
}
