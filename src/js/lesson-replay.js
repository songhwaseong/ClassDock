"use strict";

/* ===== 수업 리플레이 =====
   화이트보드 판서를 "시간축 이벤트"로 기록(keyframe)하고, 타임라인으로 되감아 재생한다.
   영상이 아니라 벡터 이벤트라 파일이 작고(보통 수십 KB) 오프라인에서 동작한다.
   그리기는 board-render.js 공용 함수를 재사용해 재생 화면이 판서 화면과 일치한다.

   .lesson = JSON:
     { format:"classdock-lesson", version:1, kind:"board", createdAt, bg, bgPattern, bgImage, W, H, duration,
       keyframes:[ {t, s:[...items]} | {t, a:item} ] }
     - s: 그 시점의 전체 항목(초기 상태·지우기·되돌리기·이동처럼 배열이 통째로 바뀔 때)
     - a: 직전 상태에 항목 하나 추가(대부분의 판서). 파일 크기를 줄이고 획 성장 애니메이션의 단서가 된다.
     - audio(선택): { mime, src:"data:audio/...;base64,...", duration } — 녹화와 함께 받은 마이크 소리.
       소리의 0초가 타임라인 0초다. 판 번호는 그대로 1 — 옛 앱은 이 칸을 모르고 판서만 재생한다.
   확장 여지: PDF 잉크·파이썬 실행을 keyframe kind(track)로 추가하면 같은 타임라인에 얹을 수 있다. */

const LESSON_FORMAT = "classdock-lesson";
const LESSON_VERSION = 1;
// 외부 .lesson 은 JSON 파싱 전에 파일 크기를 제한하고, 파싱 뒤에는 배열/문자열의
// 상한을 확인한다. 영상이 아니라 이벤트 데이터이므로 이 정도면 충분히 넉넉하면서도
// 실수로 매우 큰 파일을 열어 브라우저가 멈추는 상황을 막을 수 있다.
const LESSON_MAX_FILE_BYTES = 128 * 1024 * 1024;
const LESSON_MAX_KEYFRAMES = 100000;
const LESSON_MAX_ITEMS_PER_SNAPSHOT = 50000;
const LESSON_MAX_STROKE_POINTS = 100000;
const LESSON_MAX_PAGES = 10000;
const LESSON_MAX_PY_EVENTS = 100000;
const LESSON_MAX_TEXT_CHARS = 8 * 1024 * 1024;
// 녹음은 말소리라 32kbps(1시간 ≈ 14MB, base64 로 ≈ 19MB)면 충분하다. 파일 상한(128MB) 안에 들어오게 글자 수도 막는다.
const LESSON_AUDIO_BITS = 32000;
const LESSON_MAX_AUDIO_CHARS = 120 * 1024 * 1024;

function lessonValidationError(message){ return { ok:false, message }; }
function lessonFinite(value){ return typeof value === "number" && Number.isFinite(value); }
function lessonShortText(value, limit=LESSON_MAX_TEXT_CHARS){ return typeof value === "string" && value.length <= limit; }
function lessonValidPoint(point){ return !!point && lessonFinite(point.x) && lessonFinite(point.y); }
function lessonValidStroke(stroke){
  if (!stroke || typeof stroke !== "object" || !Array.isArray(stroke.points) ||
      !stroke.points.length || stroke.points.length > LESSON_MAX_STROKE_POINTS) return false;
  return stroke.points.every(lessonValidPoint);
}
function lessonValidItem(item, depth=0){
  if (!item || typeof item !== "object" || typeof item.type !== "string") return false;
  if (["pen", "highlighter", "eraser"].includes(item.type)) return lessonValidStroke(item);
  if (item.type === "text") return lessonShortText(String(item.text || ""));
  if (item.type === "image") return !item.src || lessonShortText(item.src);
  if (item.type === "polyline") return lessonValidStroke(item);
  if (item.type === "group"){
    return depth < 8 && lessonFinite(item.x) && lessonFinite(item.y) && lessonFinite(item.w) && lessonFinite(item.h) &&
      item.w > 0 && item.h > 0 && Array.isArray(item.items) && item.items.length <= 1000 &&
      item.items.every((child) => lessonValidItem(child, depth + 1));
  }
  return ["line", "arrow", "rect", "ellipse"].includes(item.type);
}
function lessonValidKeyframeTime(frame, previous){
  return !!frame && typeof frame === "object" && lessonFinite(frame.t) && frame.t >= previous;
}

// 재생 화면에서 사용하는 최소 스키마를 검증한다. 화면 출력은 textContent/canvas로만
// 처리되지만, 잘못된 배열·좌표가 렌더링 루프를 망가뜨리지 않도록 불러오기 경계에서 막는다.
function validateLessonPayload(lesson){
  if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) return lessonValidationError("리플레이 내용이 올바른 JSON 객체가 아니에요.");
  if (lesson.format !== LESSON_FORMAT || lesson.version !== LESSON_VERSION) return lessonValidationError("지원하지 않는 리플레이 형식 또는 버전이에요.");
  if (!["board", "pdf-ink", "python"].includes(lesson.kind)) return lessonValidationError("알 수 없는 리플레이 종류예요.");
  if (!lessonFinite(lesson.duration) || lesson.duration < 0) return lessonValidationError("재생 시간이 올바르지 않아요.");
  if (!Array.isArray(lesson.keyframes) || lesson.keyframes.length > LESSON_MAX_KEYFRAMES) return lessonValidationError("리플레이 장면 수가 올바르지 않아요.");

  let lastTime = 0;
  for (const frame of lesson.keyframes){
    if (!lessonValidKeyframeTime(frame, lastTime) || frame.t > lesson.duration) return lessonValidationError("리플레이 시간 정보가 올바르지 않아요.");
    lastTime = frame.t;
    if (lesson.kind === "board"){
      if (Array.isArray(frame.s)){
        // every 에 함수를 그대로 넘기면 배열 번호가 depth 로 들어가, 9번째 뒤의 그룹(그래프·차트)이 '너무 깊다'로 걸린다.
        if (frame.s.length > LESSON_MAX_ITEMS_PER_SNAPSHOT || !frame.s.every((item) => lessonValidItem(item))) return lessonValidationError("화이트보드 장면 데이터가 올바르지 않아요.");
      } else if (!lessonValidItem(frame.a)) return lessonValidationError("화이트보드 장면 데이터가 올바르지 않아요.");
    } else if (lesson.kind === "pdf-ink"){
      if (!Number.isInteger(frame.p) || frame.p < 0 || frame.p >= LESSON_MAX_PAGES || (!frame.c && !lessonValidStroke(frame.a)))
        return lessonValidationError("PDF 필기 장면 데이터가 올바르지 않아요.");
    }
  }

  if (lesson.kind === "board"){
    if (!lessonFinite(lesson.W) || !lessonFinite(lesson.H) || lesson.W <= 0 || lesson.H <= 0 || lesson.W > 100000 || lesson.H > 100000)
      return lessonValidationError("화이트보드 크기가 올바르지 않아요.");
  }
  if (lesson.kind === "pdf-ink"){
    if (!lesson.pages || typeof lesson.pages !== "object" || Array.isArray(lesson.pages) || Object.keys(lesson.pages).length > LESSON_MAX_PAGES)
      return lessonValidationError("PDF 페이지 정보가 올바르지 않아요.");
  }
  if (lesson.audio != null){
    const audio = lesson.audio;
    if (!audio || typeof audio !== "object" || typeof audio.src !== "string" || audio.src.length > LESSON_MAX_AUDIO_CHARS ||
        !/^data:audio\/[\w.+-]+(;[^,]*)?;base64,/i.test(audio.src.slice(0, 200)) ||
        (audio.duration != null && (!lessonFinite(audio.duration) || audio.duration < 0)))
      return lessonValidationError("녹음된 소리 정보가 올바르지 않아요.");
  }
  if (lesson.python != null){
    if (!Array.isArray(lesson.python) || lesson.python.length > LESSON_MAX_PY_EVENTS) return lessonValidationError("파이썬 리플레이 장면 수가 올바르지 않아요.");
    let pyLastTime = 0;
    for (const event of lesson.python){
      if (!lessonValidKeyframeTime(event, pyLastTime) || event.t > lesson.duration) return lessonValidationError("파이썬 리플레이 시간 정보가 올바르지 않아요.");
      pyLastTime = event.t;
      if (event.code != null && !lessonShortText(event.code)) return lessonValidationError("파이썬 코드가 너무 길거나 올바르지 않아요.");
      if (event.f != null && !lessonShortText(event.f, 4096)) return lessonValidationError("파이썬 파일 이름이 올바르지 않아요.");
      if (event.out != null){
        const out = event.out;
        if (!out || typeof out !== "object" || !lessonShortText(String(out.o || "")) || !lessonShortText(String(out.e || "")) || !lessonShortText(String(out.x || "")))
          return lessonValidationError("파이썬 실행 결과가 올바르지 않아요.");
        if (out.img != null && (!Array.isArray(out.img) || out.img.length > 8 || !out.img.every(src => lessonShortText(src))))
          return lessonValidationError("파이썬 실행 이미지가 올바르지 않아요.");
      }
    }
  }
  return { ok:true, lesson };
}

// 이미지 항목을 저장 가능한 dataURL 로 직렬화(원본 Image → 오프스크린 캔버스). 한 번 계산하면 캐시.
function lessonSerializeItems(items){
  return items.map((it) => {
    // 묶은 그룹 안의 그림도 같은 규칙으로 — 그대로 두면 <img> 가 JSON 에서 빈 객체가 되어 재생에 안 보인다.
    if (it && it.type === "group" && Array.isArray(it.items)) return Object.assign({}, it, { items:lessonSerializeItems(it.items) });
    if (!it || it.type !== "image"){ return Object.assign({}, it); }
    if (!it._lessonSrc && it.img && it.img.complete){
      try {
        const c = document.createElement("canvas");
        c.width = it.img.naturalWidth || it.w; c.height = it.img.naturalHeight || it.h;
        c.getContext("2d").drawImage(it.img, 0, 0);
        it._lessonSrc = c.toDataURL("image/png");
      } catch(_){ it._lessonSrc = null; }
    }
    const out = { type: "image", x: it.x, y: it.y, w: it.w, h: it.h, src: it._lessonSrc || null, flipX:!!it.flipX, flipY:!!it.flipY };
    if (Number(it.rotation)) out.rotation = Number(it.rotation);   // 돌린 그림만 — 안 돌린 그림은 예전과 같은 모양
    return out;
  });
}

// 녹화기. 커밋(획/도형/텍스트/이미지/지우기/되돌리기)마다 capture() 로 스냅샷을 남긴다.
// 반환 객체를 doc.recorder 에 붙여 whiteboard.js 가 호출한다.
// layers = { pattern, image } — 배경색 밑에 깔리는 무늬·그림. 색과 함께 마지막 상태 하나만 들고 간다.
// opts.t0 = 타임라인 0초로 삼을 performance.now() 값 — 마이크 녹음이 시작된 순간에 맞추면 소리와 판서가 같은 시계를 쓴다.
// opts.audio = startLessonAudio() 가 돌려준 녹음기. 정지할 때 whiteboard.js 가 꺼내 소리를 붙인다.
function LessonRecorder(items, bg, dim, layers, opts){
  const t0 = (opts && lessonFinite(opts.t0)) ? opts.t0 : performance.now();
  const keyframes = [];
  let last = items.slice();                       // 마지막으로 기록한 항목 배열(참조 비교용)
  let maxW = (dim && dim.W) || 0, maxH = (dim && dim.H) || 0;
  const now = () => Math.round(performance.now() - t0);
  keyframes.push({ t: 0, s: lessonSerializeItems(items) });   // 초기 상태(보통 빈 배열)

  const isAppendOf = (prev, next) => {
    if (next.length !== prev.length + 1) return false;
    for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
    return true;
  };
  const isSameAs = (prev, next) => {
    if (next.length !== prev.length) return false;
    for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
    return true;
  };

  return {
    active: true,
    audio: (opts && opts.audio) || null,
    get bg(){ return bg; },
    // 녹화 도중 보드 배경색·무늬를 바꾸면 재생도 그 배경을 따라야 한다. 키프레임마다 배경을 담지는 않으므로
    // 마지막으로 고른 배경 하나로 전체를 재생한다(배경은 판서와 달리 도중에 자주 바뀌지 않는다).
    setBackground(next, nextLayers){ if (next) bg = next; if (nextLayers !== undefined) layers = nextLayers; },
    capture(its, b, d, l){
      if (!this.active) return;
      if (b) bg = b;
      if (l !== undefined) layers = l;
      if (d){ maxW = Math.max(maxW, d.W || 0); maxH = Math.max(maxH, d.H || 0); }
      if (isSameAs(last, its)) return;                 // 바뀐 게 없으면 스냅샷 생략(정지 시 중복 방지)
      if (isAppendOf(last, its)){
        keyframes.push({ t: now(), a: lessonSerializeItems([its[its.length - 1]])[0] });
      } else {
        keyframes.push({ t: now(), s: lessonSerializeItems(its) });
      }
      last = its.slice();
    },
    stop(its, b, d, l){
      if (this.active) this.capture(its, b, d, l);
      this.active = false;
      return {
        format: LESSON_FORMAT, version: LESSON_VERSION, kind: "board",
        createdAt: new Date().toISOString(),
        bg: bg || "#ffffff",
        bgPattern: (layers && layers.pattern) || null,
        // 배경 그림은 <img> 객체를 빼고 src 만 싣는다(그대로 두면 JSON 으로 못 만든다).
        bgImage: (layers && layers.image) ? { ...layers.image, img:undefined } : null,
        W: maxW || 1280, H: maxH || 720,
        duration: keyframes.length ? keyframes[keyframes.length - 1].t : 0,
        keyframes
      };
    }
  };
}

// ----- 마이크 녹음(녹화와 함께) -----
// 성공하면 { ok:true, startedAt, stop(), cancel() }, 못 쓰면 { ok:false, message } 를 돌려준다.
// startedAt 은 녹음이 실제로 시작된 performance.now() — LessonRecorder 의 t0 로 넘겨 두 시계를 맞춘다.
// stop() 은 { mime, src(dataURL), duration } 또는 소리가 없으면 null 로 풀린다.
async function startLessonAudio(){
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof MediaRecorder === "undefined")
    return { ok:false, message:"여기서는 마이크 녹음을 할 수 없어요." };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, channelCount:1 } }); }
  catch(e){
    const name = e && e.name;
    return { ok:false, message: name === "NotAllowedError" || name === "SecurityError" ? "마이크 권한이 없어요." :
      name === "NotFoundError" ? "연결된 마이크를 찾지 못했어요." : "마이크를 쓸 수 없어요." };
  }
  const stopTracks = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch(_){} };
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
    .find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type)) || "";
  let recorder;
  try { recorder = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond:LESSON_AUDIO_BITS }, mime ? { mimeType:mime } : {})); }
  catch(_){ stopTracks(); return { ok:false, message:"여기서는 마이크 녹음을 할 수 없어요." }; }
  const chunks = [];
  recorder.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
  // start 이벤트가 오는 순간을 0초로 삼는다(안 오는 환경을 위해 1초 뒤엔 그냥 간다).
  await new Promise((resolve) => {
    recorder.addEventListener("start", resolve, { once:true });
    setTimeout(resolve, 1000);
    try { recorder.start(1000); } catch(_){ resolve(); }
  });
  if (recorder.state === "inactive"){ stopTracks(); return { ok:false, message:"마이크 녹음을 시작하지 못했어요." }; }
  const startedAt = performance.now();
  let finished = null;
  const finish = (keep) => finished || (finished = new Promise((resolve) => {
    const endedAt = performance.now();
    const done = async () => {
      stopTracks();
      if (!keep) return resolve(null);
      const blob = new Blob(chunks, { type:(recorder.mimeType || mime || "audio/webm").split(";")[0] });
      if (!blob.size) return resolve(null);
      try {
        const src = await new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result || "")); fr.onerror = fail; fr.readAsDataURL(blob); });
        resolve({ mime:blob.type, src, duration:Math.max(0, Math.round(endedAt - startedAt)) });
      } catch(_){ resolve(null); }
    };
    if (recorder.state === "inactive") return void done();
    recorder.addEventListener("stop", done, { once:true });
    try { recorder.stop(); } catch(_){ done(); }
  }));
  return { ok:true, startedAt, stop:() => finish(true), cancel:() => { finish(false); } };
}

// 재생기에서 쓸 <audio>. data URL 을 그대로 src 로 두면 긴 녹음에서 되감기가 느려 Blob URL 로 바꾼다.
// MediaRecorder 로 만든 webm 은 길이가 Infinity 로 와서 되감기가 안 먹는 일이 있어, 처음에 끝으로 한 번 건너뛰어 길이를 알아 둔다.
// lesson.audio 의 data URL → 바이트.
function lessonAudioBytes(audio){
  const comma = audio.src.indexOf(",");
  const bin = atob(audio.src.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function lessonAudioPlayer(audio, onReady){
  const el = new Audio(); el.preload = "auto";
  let url = "";
  try { url = URL.createObjectURL(new Blob([lessonAudioBytes(audio)], { type:audio.mime || "audio/webm" })); }
  catch(_){ url = ""; }
  let ready = false;
  const markReady = () => { if (ready) return; ready = true; if (typeof onReady === "function") onReady(); };
  el.addEventListener("loadedmetadata", () => {
    if (el.duration !== Infinity) return markReady();
    const back = () => { if (!Number.isFinite(el.duration)) return; el.removeEventListener("durationchange", back); el.currentTime = 0; markReady(); };
    el.addEventListener("durationchange", back);
    try { el.currentTime = 1e7; } catch(_){ markReady(); }
  }, { once:true });
  el.addEventListener("error", markReady, { once:true });
  el.src = url || audio.src;
  return {
    el,
    get ready(){ return ready; },
    dispose(){ try { el.pause(); el.removeAttribute("src"); el.load(); } catch(_){} if (url) URL.revokeObjectURL(url); }
  };
}

// ----- MP4 로 내보내기 -----
// 재생 화면을 그리는 함수(draw)로 장면을 한 장씩 그려 H.264 로 굽고, 녹음이 있으면 AAC 로 바꿔 mp4-writer.js 로 묶는다.
// 판서는 대부분 가만히 있으므로 초당 30번 '화면이 바뀌었나(frameKey)'만 보고 바뀐 때만 장면을 굽는다(길이가 제각각인 장면).
// 그래서 설명만 하는 구간은 거의 공짜이고, 만드는 데 걸리는 시간은 판서량에 비례한다.
const LESSON_VIDEO_FPS = 30;
const LESSON_VIDEO_MAX_GAP = 2000;      // 화면이 그대로여도 이 간격(ms)마다 장면을 하나 둔다 — 플레이어 탐색이 부드럽게
const LESSON_VIDEO_KEY_GAP = 10000;     // 열쇠 장면 간격(ms) — 되감기 때 여기부터 다시 푼다
const LESSON_VIDEO_CODECS = ["avc1.42E028", "avc1.4D0028", "avc1.640028", "avc1.42E01F"];

// 가로·세로 비율(aw:ah)을 maxW×maxH 안에 넣은 짝수 크기(H.264 는 짝수여야 한다).
function lessonVideoSize(aw, ah, maxW=1920, maxH=1080){
  const w0 = lessonFinite(aw) && aw > 0 ? aw : 16, h0 = lessonFinite(ah) && ah > 0 ? ah : 9;
  const scale = Math.min(maxW / w0, maxH / h0);
  const even = (v) => Math.max(2, Math.floor(v * scale / 2) * 2);
  return { width:even(w0), height:even(h0) };
}

// 초당 fps 번 화면 열쇠를 보고, 바뀌었거나 오래 그대로였던 순간만 고른다. { t, key } 목록(ms)과 영상 끝 시각을 돌려준다.
function lessonVideoSchedule(duration, frameKey, fps=LESSON_VIDEO_FPS){
  const step = 1000 / fps, total = Math.max(0, Math.ceil(duration / step));
  const frames = [];
  let lastKey, lastT = -Infinity, lastKeyT = -Infinity;
  for (let i = 0; i <= total; i++){
    const t = Math.min(duration, i * step), key = frameKey(t);
    if (frames.length && key === lastKey && t - lastT < LESSON_VIDEO_MAX_GAP) continue;
    const isKey = !frames.length || t - lastKeyT >= LESSON_VIDEO_KEY_GAP;
    frames.push({ t, key:isKey });
    lastKey = key; lastT = t; if (isKey) lastKeyT = t;
  }
  return { frames, end:Math.max(duration, (frames.length ? frames[frames.length - 1].t : 0) + step) };
}

// 녹음(webm/opus) → AAC 조각. 음성이라 24kHz 로 풀어 메모리를 아끼고(한 시간 ≈ 350MB), 부호기가 받는 48kHz 로 늘려 넣는다.
async function lessonEncodeAudioAac(audio, isCancelled){
  if (!audio || !audio.src || typeof AudioEncoder === "undefined" || typeof AudioData === "undefined" || typeof OfflineAudioContext === "undefined") return null;
  const rate = 48000;
  let config = null;
  for (const candidate of [{ codec:"mp4a.40.2", sampleRate:rate, numberOfChannels:1, bitrate:64000 }, { codec:"mp4a.40.2", sampleRate:rate, numberOfChannels:2, bitrate:96000 }]){
    try { if ((await AudioEncoder.isConfigSupported(candidate)).supported){ config = candidate; break; } } catch(_){}
  }
  if (!config) return null;
  const decoded = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(lessonAudioBytes(audio).buffer);
  const src = decoded.getChannelData(0), ratio = rate / decoded.sampleRate, length = Math.floor(src.length * ratio);
  const channels = config.numberOfChannels, samples = [];
  let asc = null, failure = null;
  const encoder = new AudioEncoder({
    output:(chunk, meta) => {
      const description = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (description && !asc) asc = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); samples.push({ data });
    },
    error:(error) => { failure = error; }
  });
  try {
    encoder.configure(config);
    const block = 4800;
    for (let at = 0, n = 0; at < length && !failure; at += block, n++){
      if (isCancelled && isCancelled()) return null;
      const frames = Math.min(block, length - at), planes = new Float32Array(frames * channels);
      for (let j = 0; j < frames; j++){
        const pos = (at + j) / ratio, i = Math.floor(pos), frac = pos - i;
        const v = src[i] + (src[Math.min(src.length - 1, i + 1)] - src[i]) * frac;   // 곧은 보간
        for (let c = 0; c < channels; c++) planes[c * frames + j] = v;
      }
      const data = new AudioData({ format:"f32-planar", sampleRate:rate, numberOfFrames:frames, numberOfChannels:channels, timestamp:Math.round(at * 1e6 / rate), data:planes });
      encoder.encode(data); data.close();
      while (encoder.encodeQueueSize > 8 && !failure) await new Promise((resolve) => setTimeout(resolve, 2));
      if (n % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await encoder.flush();
  } finally { if (encoder.state !== "closed") try { encoder.close(); } catch(_){} }
  if (failure) throw failure;
  return asc && samples.length ? { samples, asc, sampleRate:rate, channels } : null;
}

// opts = { duration, width, height, draw(ctx,W,H,dpr,t), frameKey(t), images:[Image], audio, onProgress(0~1, 단계), isCancelled() }
// 돌려주는 값: { bytes, seconds, width, height, withAudio, audioFailed } · 취소면 null.
async function exportLessonVideo(opts){
  if (typeof MNMp4Writer === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined")
    throw Object.assign(new Error("no-encoder"), { userMessage:"이 브라우저는 영상 만들기를 지원하지 않아요. 크롬이나 엣지에서 해 주세요." });
  const { width, height } = opts;
  const cancelled = () => !!(opts.isCancelled && opts.isCancelled());
  const progress = (value, stage) => { if (typeof opts.onProgress === "function") opts.onProgress(value, stage); };
  let config = null;
  for (const codec of LESSON_VIDEO_CODECS){
    // 판서는 가만한 장면이 많아 비트 예산을 넉넉히 잡아도 파일은 작다 — 글씨가 뭉개지지 않는 쪽으로.
    const candidate = { codec, width, height, framerate:LESSON_VIDEO_FPS, bitrate:Math.round(Math.min(8e6, Math.max(2e6, width * height * 3))), latencyMode:"quality", avc:{ format:"avc" } };
    try { if ((await VideoEncoder.isConfigSupported(candidate)).supported){ config = candidate; break; } } catch(_){}
  }
  if (!config) throw Object.assign(new Error("no-h264"), { userMessage:"이 컴퓨터에서 MP4(H.264) 영상을 만들 수 없어요." });

  // 판서 속 그림·배경·PDF 쪽 그림이 다 불러와진 뒤에 굽는다(안 그러면 첫 장면들에 그림이 빠진다).
  await Promise.all((opts.images || []).filter(Boolean).map((img) => (img.complete ? null : new Promise((resolve) => {
    img.addEventListener("load", resolve, { once:true }); img.addEventListener("error", resolve, { once:true }); setTimeout(resolve, 10000);
  }))));

  const { frames, end } = lessonVideoSchedule(opts.duration, opts.frameKey);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const samples = []; let avcC = null, failure = null;
  const encoder = new VideoEncoder({
    output:(chunk, meta) => {
      const description = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (description && !avcC) avcC = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      samples.push({ data, key:chunk.type === "key", timestamp:chunk.timestamp });
    },
    error:(error) => { failure = error; }
  });
  try {
    encoder.configure(config);
    let lastYield = performance.now();
    for (let i = 0; i < frames.length && !failure; i++){
      if (cancelled()) return null;
      const frame = frames[i];
      // 재생 화면과 같은 차례로 — 투명하게 비우고 그린 뒤, 남은 빈 곳(판 둘레 여백)만 검게 밑에 깐다.
      // 먼저 검게 칠하면 판 배경이 '빈 곳에만 밑에 까는'(destination-over) 방식이라 깔릴 자리가 없어 판 전체가 검게 나온다.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      opts.draw(ctx, width, height, 1, frame.t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      const next = i + 1 < frames.length ? frames[i + 1].t : end;
      const video = new VideoFrame(canvas, { timestamp:Math.round(frame.t * 1000), duration:Math.max(1, Math.round((next - frame.t) * 1000)) });
      encoder.encode(video, { keyFrame:frame.key }); video.close();
      while (encoder.encodeQueueSize > 6 && !failure) await new Promise((resolve) => setTimeout(resolve, 4));
      if (performance.now() - lastYield > 60){ progress(frame.t / Math.max(1, end), "video"); await new Promise((resolve) => setTimeout(resolve, 0)); lastYield = performance.now(); }
    }
    if (failure) throw failure;
    await encoder.flush();
    if (failure) throw failure;
  } finally { if (encoder.state !== "closed") try { encoder.close(); } catch(_){} }
  if (cancelled()) return null;

  // 조각의 길이 = 다음 장면까지. 마지막 장면은 영상 끝까지 늘인다(mp4-writer 가 duration 을 보고 길이가 제각각인 영상으로 적는다).
  // 길이가 제각각인 영상은 B 프레임(표시 순서가 뒤바뀐 장면)을 담을 수 없다. Baseline 부터 고르므로 보통 없지만, 섞여 나오면 깨진 파일 대신 알린다.
  if (samples.some((sample, i) => i && sample.timestamp <= samples[i - 1].timestamp))
    throw Object.assign(new Error("reordered-frames"), { userMessage:"이 컴퓨터의 영상 부호기와 맞지 않아 MP4 를 만들 수 없어요." });
  samples.forEach((sample, i) => { sample.duration = Math.max(1, (i + 1 < samples.length ? samples[i + 1].timestamp : Math.round(end * 1000)) - sample.timestamp); });

  let audio = null, audioFailed = false;
  if (opts.audio && opts.audio.src){
    progress(1, "audio");
    try { audio = await lessonEncodeAudioAac(opts.audio, cancelled); } catch(error){ console.warn("녹음을 영상에 넣지 못했어요:", error); }
    if (cancelled()) return null;
    audioFailed = !audio;
  }
  progress(1, "mux");
  const bytes = MNMp4Writer.mux({ width, height, fps:LESSON_VIDEO_FPS, samples, avcC, audio });
  return { bytes, seconds:end / 1000, width, height, withAudio:!!audio, audioFailed };
}

// keyframes → 재생 상태(메모리 O(N)). 프레임을 미리 전부 펼치지 않고(옛 방식은 O(N²)),
// 재생 위치가 바뀔 때마다 그 시점의 items 만 증분 복원한다:
//   전방 이동 = 다음 keyframe 만 이어 붙임(O(delta)), 후방 이동 = 직전 set 부터 다시 쌓기.
// 이렇게 하면 획이 수천 개인 장시간 수업도 재생 메모리가 판서 개수에 선형이다.
function prepareLessonPlayback(lesson){
  const kfs = (lesson.keyframes || []).slice();
  if (!kfs.length) kfs.push({ t: 0, s: [] });
  const n = kfs.length;
  const times = new Array(n), append = new Array(n), lastSet = new Array(n);
  let ls = -1;
  for (let i = 0; i < n; i++){
    times[i] = kfs[i].t || 0;
    append[i] = !!kfs[i].a;
    if (kfs[i].s) ls = i;      // 전체 교체 지점(초기·지우기·되돌리기·이동) — 후방 복원 시작점
    lastSet[i] = ls;
  }
  return { kfs, times, append, lastSet, n, curItems: [], curIdx: -1 };
}

// state.curItems 를 keyframe idx 시점 상태로 만들어 돌려준다(반환 배열은 그리기 전용, 변형 금지).
function lessonItemsAt(state, idx){
  const applyTo = (from) => {
    for (let i = from; i <= idx; i++){
      const kf = state.kfs[i];
      if (kf.s) state.curItems = kf.s.slice();
      else if (kf.a) state.curItems.push(kf.a);
    }
  };
  if (idx === state.curIdx) return state.curItems;
  if (idx > state.curIdx){ applyTo(state.curIdx + 1); state.curIdx = idx; return state.curItems; }
  const setIdx = state.lastSet[idx];      // 후방: 가장 가까운 set 부터 다시 쌓는다
  if (setIdx >= 0){ state.curItems = state.kfs[setIdx].s.slice(); state.curIdx = setIdx; }
  else { state.curItems = []; state.curIdx = -1; }
  applyTo(state.curIdx + 1); state.curIdx = idx; return state.curItems;
}

// keyframe 들의 이미지(dataURL)를 Image 로 미리 로드해 항목에 붙인다. 같은 src 는 한 번만.
function preloadLessonImages(kfs, onReady){
  const cache = new Map();
  const attach = (it) => {
    if (it && it.type === "group" && Array.isArray(it.items)){ it.items.forEach(attach); return; }
    if (!it || it.type !== "image" || !it.src) return;
    let img = cache.get(it.src);
    if (!img){ img = new Image(); img.src = it.src; cache.set(it.src, img); }
    it.img = img;
  };
  for (const kf of kfs){ if (kf.s) kf.s.forEach(attach); if (kf.a) attach(kf.a); }
  if (typeof onReady === "function") cache.forEach((img) => { img.onload = onReady; });
  return [...cache.values()];
}

// t 이하인 마지막 keyframe 인덱스(이진 탐색). times = 오름차순 시각 배열.
function lessonIndexAt(times, t){
  let lo = 0, hi = times.length - 1, idx = 0;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (times[m] <= t){ idx = m; lo = m + 1; } else hi = m - 1; }
  return idx;
}

const lessonFmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

// ----- 재생 화면(새 문서 종류 "replay") -----
function openLessonReplay(lesson, name, options={}){
  const doc = makeDoc("replay", name || "수업 리플레이", options);
  doc.lesson = lesson;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    if (lesson.kind === "pdf-ink") renderPdfInkReplay(doc, host, lesson);
    else if (lesson.kind === "python") renderPythonReplay(doc, host, lesson);
    else renderReplay(doc, host, lesson);
  };
  if (typeof refreshChrome === "function") refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

// ----- PDF 위 필기 + 파이썬 녹화 (전역 훅; pdf-editor.js·python-runtime.js 가 호출, 녹화 중이 아니면 무동작) -----
let _lessonPdfRec = null;
function lessonPdfRecording(){ return !!(_lessonPdfRec && _lessonPdfRec.active); }
function lessonPdfOnStroke(pdfDoc, pageIndex, stroke){ if (lessonPdfRecording()) _lessonPdfRec.onStroke(pdfDoc, pageIndex, stroke); }
function lessonPdfOnClear(pdfDoc, pageIndex){ if (lessonPdfRecording()) _lessonPdfRec.onClear(pdfDoc, pageIndex); }
// 파이썬 트랙 훅 — 실행 시작(코드 확정), 대화형 스트림 출력, 최종 결과
function lessonPyOnRun(code, file){ if (lessonPdfRecording()) _lessonPdfRec.onPyRun(code, file); }
function lessonPyOnLiveOutput(stdout, stderr){ if (lessonPdfRecording()) _lessonPdfRec.onPyLive(stdout, stderr); }
function lessonPyOnResult(res){ if (lessonPdfRecording()) _lessonPdfRec.onPyResult(res); }
function lessonPdfCloneStroke(s){ return { tool: s.tool, color: s.color, width: s.width, points: (s.points || []).map((p) => ({ x: p.x, y: p.y })) }; }
function lessonPdfCaptureBackdrop(pdfDoc, pageIndex){
  const p = pdfDoc && pdfDoc.pages && pdfDoc.pages[pageIndex]; if (!p) return null;
  let src = null; try { if (p.canvas) src = p.canvas.toDataURL("image/png"); } catch(_){}
  return { src, w: p.cssW || 1000, h: p.cssH || 1400 };
}
// opts = { t0, audio } — LessonRecorder 와 같다(마이크 녹음이 시작된 순간을 0초로, 정지 때 소리를 붙인다).
function LessonPdfInkRecorder(opts){
  const t0 = (opts && lessonFinite(opts.t0)) ? opts.t0 : performance.now();
  const keyframes = []; const pages = {};
  const py = [];                                  // 파이썬 트랙: {t,f,code} 코드 스냅샷 | {t,run:1} 실행 시작 | {t,out:{o,e,x,img}} 출력
  let lastCode = null, lastLiveAt = -1;
  const now = () => Math.round(performance.now() - t0);
  // 1초마다 활성 파이썬 편집기의 코드를 샘플링(바뀐 때만 기록) — 타자 과정이 타임라인에 남는다.
  const sampleCode = () => {
    try {
      if (typeof docs === "undefined" || typeof activeId === "undefined") return;
      const d = docs.find((x) => x && x.id === activeId);
      if (!d || !d.codeEditor || typeof d.codeEditor.getValue !== "function") return;
      const name = String(d.name || "");
      if (!/\.py$/i.test(name)) return;
      const code = d.codeEditor.getValue();
      if (code === lastCode) return;
      lastCode = code;
      py.push({ t: now(), f: name, code });
    } catch(_){}
  };
  const timer = setInterval(sampleCode, 1000);
  sampleCode();                                   // 시작 시점 코드(초기 상태)
  return {
    active: true,
    audio: (opts && opts.audio) || null,
    onStroke(pdfDoc, pageIndex, stroke){
      if (!this.active || !stroke) return;
      if (!pages[pageIndex]){ const b = lessonPdfCaptureBackdrop(pdfDoc, pageIndex); if (b) pages[pageIndex] = b; }
      keyframes.push({ t: now(), p: pageIndex, a: lessonPdfCloneStroke(stroke) });
    },
    onClear(pdfDoc, pageIndex){ if (this.active) keyframes.push({ t: now(), p: pageIndex, c: 1 }); },
    onPyRun(code, file){
      if (!this.active) return;
      const src = String(code == null ? "" : code);
      if (src !== lastCode){ lastCode = src; py.push({ t: now(), f: String(file || ""), code: src }); }   // 실행 시점 코드 확정
      py.push({ t: now(), run: 1 });
    },
    onPyLive(stdout, stderr){
      if (!this.active) return;
      const t = now();
      if (t - lastLiveAt < 700) return;           // 폴링 스트림은 0.7초 간격으로만 기록(파일 크기 보호)
      lastLiveAt = t;
      py.push({ t, out: { o: String(stdout || ""), e: String(stderr || "") } });
    },
    onPyResult(res){
      if (!this.active || !res) return;
      const out = { o: String(res.stdout || ""), e: String(res.stderr || "") };
      if (res.fatal) out.x = String(res.fatal);
      if (Array.isArray(res.images) && res.images.length) out.img = res.images.slice(0, 8);
      py.push({ t: now(), out });
    },
    stop(){
      this.active = false;
      clearInterval(timer);
      sampleCode();                               // 마지막 편집분 반영
      const hasInk = keyframes.length && Object.keys(pages).length;
      const lastT = (arr) => arr.length ? (arr[arr.length - 1].t || 0) : 0;
      const lesson = {
        format: LESSON_FORMAT, version: LESSON_VERSION, kind: hasInk ? "pdf-ink" : "python",
        createdAt: new Date().toISOString(),
        duration: Math.max(lastT(keyframes), lastT(py)),
        pages, keyframes
      };
      if (py.length) lesson.python = py;
      return lesson;
    }
  };
}
// 파이썬 트랙에 "내용"이 있는지 — 실행/출력이 있거나 코드가 초기 스냅샷 이후 바뀐 적이 있으면 참.
function lessonPyHasContent(py){
  if (!Array.isArray(py) || !py.length) return false;
  return py.some((ev, i) => ev.run || ev.out || (i > 0 && ev.code != null));
}
// ----- '녹화할 때 마이크도 함께' 설정 — 화이트보드·PDF 필기·파이썬 녹화가 하나를 같이 쓴다 -----
// 처음엔 꺼 둔다(묻지 않고 마이크를 켜지 않게). 바뀌면 "lesson-mic-changed" 로 모든 🎤 단추를 맞춘다.
const LESSON_MIC_KEY = "wbRecordMic";
function lessonRecordMicWanted(){ try { return localStorage.getItem(LESSON_MIC_KEY) === "true"; } catch(_){ return false; } }
function lessonSetRecordMicWanted(on){
  try { localStorage.setItem(LESSON_MIC_KEY, String(!!on)); } catch(_){}
  try { document.dispatchEvent(new CustomEvent("lesson-mic-changed", { detail:{ on:!!on } })); } catch(_){}
}

// PDF 필기바·파이썬 실행바의 ● 녹화 버튼이 호출. 끝나면 녹화 중인지(true/false)로 풀린다.
// 마이크 권한을 묻는 동안·소리를 정리하는 동안은 busy 로 알린다. 어느 쪽 버튼으로 시작/정지하든
// 상태가 맞도록 document 에 "lesson-rec-changed"({on, busy, mic}) 이벤트를 쏜다.
let _lessonPdfBusy = false;
function lessonRecNotify(on){
  const mic = !!(on && _lessonPdfRec && _lessonPdfRec.audio);
  try { document.dispatchEvent(new CustomEvent("lesson-rec-changed", { detail: { on: !!on, busy:_lessonPdfBusy, mic } })); } catch(_){}
}
async function lessonPdfToggleRecord(){
  if (_lessonPdfBusy) return lessonPdfRecording();
  if (lessonPdfRecording()){
    const rec = _lessonPdfRec, lesson = rec.stop(); _lessonPdfRec = null;
    let audio = null;
    if (rec.audio){
      _lessonPdfBusy = true; lessonRecNotify(false);
      try { audio = await rec.audio.stop(); } catch(_){ audio = null; } finally { _lessonPdfBusy = false; }
    }
    if (audio){
      lesson.audio = audio;
      lesson.duration = Math.max(lesson.duration || 0, audio.duration || 0);   // 필기를 멈춘 뒤 말한 부분까지 재생되게
    }
    const hasInk = lesson.keyframes.length && Object.keys(lesson.pages).length;
    const hasPy = lessonPyHasContent(lesson.python);
    if (!hasPy) delete lesson.python;
    if ((hasInk || hasPy || audio) && typeof finishLessonRecording === "function"){
      finishLessonRecording(lesson, hasInk && hasPy ? "수업" : hasInk ? "PDF 필기" : hasPy ? "파이썬" : "수업");
    }
    else if (typeof toast === "function") toast("녹화된 내용이 없어요.", 2000);
    lessonRecNotify(false);
    return false;
  }
  let audioRec = null;
  const wantMic = lessonRecordMicWanted();
  if (wantMic && typeof startLessonAudio === "function"){
    _lessonPdfBusy = true; lessonRecNotify(false);
    let started = null;
    try { started = await startLessonAudio(); } finally { _lessonPdfBusy = false; }
    if (started && started.ok) audioRec = started;
    else if (typeof toast === "function") toast(((started && started.message) || "마이크를 쓸 수 없어요.") + " 필기만 녹화할게요.", 3400);
  }
  _lessonPdfRec = LessonPdfInkRecorder(audioRec ? { t0:audioRec.startedAt, audio:audioRec } : undefined);
  if (typeof toast === "function" && (audioRec || !wantMic)) toast(audioRec
    ? "수업 녹화를 시작했어요. PDF 필기·파이썬 코드와 마이크 소리가 함께 기록됩니다. ■ 정지로 끝내세요."
    : "수업 녹화를 시작했어요. PDF 필기와 파이썬 코드·실행이 기록됩니다. ■ 정지로 끝내세요.", 3400);
  lessonRecNotify(true);
  return true;
}

// 재생기 공용 타임라인/컨트롤(보드·PDF잉크·파이썬이 공유). opts.draw(ctx,CW,CH,dpr,playT) 가 한 프레임을 그린다.
// opts.side = 캔버스 옆에 붙일 DOM 패널(파이썬 트랙), opts.hideStage = 캔버스 없이 패널만(파이썬 전용 리플레이),
// opts.onTime(playT) = 프레임마다 DOM 패널을 갱신할 콜백. 반환 { redraw } 로 이미지 로드 완료 등에서 다시 그릴 수 있다.
// opts.video = { width, height, frameKey(t), images() } — 있으면 MP4 내보내기 단추를 단다(frameKey 가 같으면 화면도 같다).
// opts.audio = 함께 녹음한 소리(lesson.audio). 소리가 나오는 동안에는 소리의 재생 위치가 시계가 된다 —
// 따로 흐르는 두 시계를 맞추려 들면 소리가 튀므로, 판서가 소리를 따라가게 한다.
function mountReplayPlayer(doc, host, opts){
  host.classList.add("lr-doc");
  const duration = opts.duration || 0;

  const wrap = document.createElement("div"); wrap.className = "lr-wrap";
  const stage = document.createElement("div"); stage.className = "lr-stage";
  const canvas = document.createElement("canvas"); canvas.className = "lr-canvas";
  stage.appendChild(canvas);
  const bar = document.createElement("div"); bar.className = "lr-bar";
  if (opts.side){
    const main = document.createElement("div"); main.className = "lr-main";
    if (opts.hideStage) stage.classList.add("lr-stage-hidden");
    main.append(stage, opts.side);
    wrap.append(main, bar);
  } else {
    wrap.append(stage, bar);
  }
  host.appendChild(wrap);

  const ctx = canvas.getContext("2d");
  let dpr = 1, CW = 0, CH = 0;
  let playT = 0, playing = false, speed = 1, lastTick = 0, raf = 0;

  const mk = (label, title, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); return b; };
  const playBtn = mk("▶", "재생 (스페이스)", "lr-btn lr-play");
  const restartBtn = mk("⟲", "처음부터", "lr-btn");
  const seek = document.createElement("input");
  seek.type = "range"; seek.className = "lr-seek"; seek.min = "0"; seek.max = String(duration || 0); seek.step = "10"; seek.value = "0";
  seek.setAttribute("aria-label", "재생 위치");
  const timeLabel = document.createElement("span"); timeLabel.className = "lr-time"; timeLabel.textContent = "0:00 / " + lessonFmtTime(duration);
  const speedSel = document.createElement("select"); speedSel.className = "lr-speed"; speedSel.title = "재생 속도";
  [["0.5", "0.5×"], ["1", "1×"], ["1.5", "1.5×"], ["2", "2×"], ["4", "4×"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === "1") o.selected = true; speedSel.appendChild(o); });
  const saveBtn = mk("저장", ".lesson 파일로 저장", "lr-btn lr-save");
  // 앱 UI 는 색 이모지를 지운다(icons.js) — 그림은 같은 단색 SVG 아이콘으로 단다.
  const setIcon = (button, icon, label) => {
    if (typeof setUiIconLabel === "function" && label) setUiIconLabel(button, icon, label);
    else if (typeof setUiIcon === "function") setUiIcon(button, icon, button.title);
  };
  setIcon(saveBtn, "save", "저장");
  bar.append(playBtn, restartBtn, seek, timeLabel, speedSel);
  let sound = null, soundBtn = null;
  const soundEnd = () => (opts.audio && lessonFinite(opts.audio.duration) && opts.audio.duration > 0) ? opts.audio.duration
    : (sound && Number.isFinite(sound.el.duration) ? sound.el.duration * 1000 : Infinity);
  if (opts.audio && opts.audio.src){
    sound = lessonAudioPlayer(opts.audio, () => { if (playing) syncSound(); });
    soundBtn = mk("", "소리 끄기", "lr-btn lr-sound");
    const paintSound = () => {
      const muted = sound.el.muted;
      soundBtn.title = muted ? "소리 켜기" : "소리 끄기";
      setIcon(soundBtn, muted ? "mute" : "volume");
      soundBtn.setAttribute("aria-label", soundBtn.title);
      soundBtn.setAttribute("aria-pressed", String(muted));
    };
    soundBtn.addEventListener("click", () => { sound.el.muted = !sound.el.muted; paintSound(); });
    paintSound();
    bar.appendChild(soundBtn);
  }
  // MP4 내보내기 — 만드는 동안 단추가 진행률이 되고, 다시 누르면 취소한다.
  let videoBtn = null, exporting = null;
  const paintVideoBtn = (text) => {
    if (text){ videoBtn.textContent = text; videoBtn.title = "누르면 영상 만들기를 멈춰요"; videoBtn.setAttribute("aria-label", videoBtn.title); return; }
    videoBtn.title = "MP4 영상으로 저장 — 판서" + (opts.audio ? "와 녹음한 목소리" : "") + "를 영상 파일로 만들어요";
    setIcon(videoBtn, "video", "MP4");
    videoBtn.setAttribute("aria-label", videoBtn.title);
  };
  const runVideoExport = async () => {
    if (exporting){ exporting.cancelled = true; paintVideoBtn("멈추는 중…"); return; }
    if (typeof exportLessonVideo !== "function") return;
    pause();
    const job = exporting = { cancelled:false };
    videoBtn.classList.add("busy");
    paintVideoBtn("영상 0%");
    try {
      const result = await exportLessonVideo({
        duration, width:opts.video.width, height:opts.video.height,
        draw:opts.draw, frameKey:opts.video.frameKey,
        images:typeof opts.video.images === "function" ? opts.video.images() : [],
        audio:opts.audio,
        isCancelled:() => job.cancelled,
        onProgress:(value, stage) => {
          if (job.cancelled) return;
          paintVideoBtn(stage === "audio" ? "소리 넣는 중…" : stage === "mux" ? "파일 묶는 중…" : "영상 " + Math.min(99, Math.round(value * 100)) + "%");
        }
      });
      if (!result){ if (typeof toast === "function") toast("영상 만들기를 멈췄어요.", 1800); return; }
      const fileName = String(doc.name || "수업").replace(/\.lesson$/i, "") + ".mp4";
      MNDownload.saveBlob(new Blob([result.bytes], { type:"video/mp4" }), fileName);
      const mb = Math.max(0.1, Math.round(result.bytes.length / 1048576 * 10) / 10);
      if (typeof toast === "function") toast("MP4 영상을 저장했어요 (" + lessonFmtTime(result.seconds * 1000) + ", " + result.width + "×" + result.height + ", " + mb + "MB" +
        (result.withAudio ? ", 목소리 포함" : "") + ")." + (result.audioFailed ? " 이 컴퓨터에서는 소리를 넣지 못해 소리 없이 저장했어요." : ""), 4200);
    } catch(error){
      console.error(error);
      if (typeof toast === "function") toast((error && error.userMessage) || "MP4 영상을 만들지 못했어요.", 3400, { type:"error" });
    } finally {
      if (exporting === job) exporting = null;
      videoBtn.classList.remove("busy");
      paintVideoBtn();
    }
  };
  if (opts.video){
    videoBtn = mk("", "", "lr-btn lr-video", "");
    videoBtn.addEventListener("click", runVideoExport);
    paintVideoBtn();
    bar.appendChild(videoBtn);
  }
  bar.appendChild(saveBtn);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, CW, CH);
    opts.draw(ctx, CW, CH, dpr, playT);
    if (typeof opts.onTime === "function") opts.onTime(playT);
  };
  const resize = () => {
    const r = stage.getBoundingClientRect();
    CW = Math.max(1, Math.round(r.width)); CH = Math.max(1, Math.round(r.height));
    dpr = screenPixelRatio(stage);             // 화면 픽셀과 1:1 — 큰 화면·고배율·UI 크기에서도 선명하게
    canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
    canvas.style.width = CW + "px"; canvas.style.height = CH + "px";
    draw();
  };
  const syncUI = () => { seek.value = String(Math.round(playT)); timeLabel.textContent = lessonFmtTime(playT) + " / " + lessonFmtTime(duration); };
  const setPlayIcon = () => { playBtn.textContent = playing ? "⏸" : "▶"; playBtn.title = playing ? "일시정지 (스페이스)" : "재생 (스페이스)"; };
  // 소리를 지금 재생 위치로 옮겨 틀거나(녹음 길이 안) 멈춘다(녹음이 끝난 뒤).
  const syncSound = () => {
    if (!sound || !sound.ready) return;
    const el = sound.el;
    el.playbackRate = speed;
    if (!playing || playT >= soundEnd()){ el.pause(); return; }
    try { el.currentTime = playT / 1000; } catch(_){}
    const started = el.play(); if (started && typeof started.catch === "function") started.catch(() => {});
  };
  const soundRunning = () => !!(sound && sound.ready && !sound.el.paused && !sound.el.ended);
  const tick = (ts) => {
    if (!playing){ return; }
    if (typeof activeId !== "undefined" && activeId !== doc.id){ pause(); return; }   // 다른 탭으로 가면 멈춤
    if (!lastTick) lastTick = ts;
    const dt = ts - lastTick; lastTick = ts;
    if (soundRunning()) playT = sound.el.currentTime * 1000;   // 소리가 나오는 동안은 소리가 시계
    else playT += dt * speed;                                   // 소리가 없거나 끝난 뒤엔 화면 시계
    if (playT >= duration){ playT = duration; playing = false; setPlayIcon(); if (sound) sound.el.pause(); }
    syncUI(); draw();
    if (playing) raf = requestAnimationFrame(tick);
  };
  const play = () => { if (playing) return; if (playT >= duration) playT = 0; playing = true; lastTick = 0; setPlayIcon(); syncSound(); raf = requestAnimationFrame(tick); };
  const pause = () => { playing = false; setPlayIcon(); if (sound) sound.el.pause(); };
  const toggle = () => { playing ? pause() : play(); };

  playBtn.addEventListener("click", toggle);
  restartBtn.addEventListener("click", () => { playT = 0; syncSound(); syncUI(); draw(); });
  seek.addEventListener("input", () => { pause(); playT = Number(seek.value) || 0; syncUI(); draw(); });
  speedSel.addEventListener("change", () => { speed = Number(speedSel.value) || 1; if (sound) sound.el.playbackRate = speed; });
  saveBtn.addEventListener("click", () => { if (typeof opts.onSave === "function") opts.onSave(); });

  // 이 재생 화면이 활성일 때 스페이스로 재생/정지
  const onKey = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.tagName === "TEXTAREA")) return;
    if (e.key === " " || e.code === "Space"){ e.preventDefault(); toggle(); }
  };
  document.addEventListener("keydown", onKey);

  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  const offScreenRatio = onScreenPixelRatioChange(resize);
  requestAnimationFrame(resize);
  setPlayIcon(); syncUI();

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { playing = false; if (exporting) exporting.cancelled = true; if (raf) cancelAnimationFrame(raf); if (sound) sound.dispose(); if (ro) ro.disconnect(); offScreenRatio(); document.removeEventListener("keydown", onKey); });

  return { redraw: draw };
}

// 화이트보드 리플레이(벡터 판서).
function renderReplay(doc, host, lesson){
  const pb = prepareLessonPlayback(lesson);
  const boardBg = lesson.bg || "#ffffff";
  // 배경 그림도 항목 이미지처럼 src → <img> 로 되살려야 그려진다(다 불러오면 preload 가 다시 그린다).
  const boardImage = (lesson.bgImage && typeof lesson.bgImage === "object" && /^data:image\//i.test(String(lesson.bgImage.src || "")))
    ? { ...lesson.bgImage } : null;
  const duration = lesson.duration || pb.times[pb.n - 1] || 0;
  // 다음 keyframe 이 "획 추가"면, 그 획을 진행도만큼 성장시켜 별도로 덧그린다(공용 렌더러 재사용).
  const growAt = (idx, playT) => {
    const ni = idx + 1;
    if (ni < pb.n && pb.append[ni]){
      const cand = pb.kfs[ni].a;
      if (cand && cand.points && cand.points.length){
        const span = Math.max(1, pb.times[ni] - pb.times[idx]);
        const prog = Math.min(1, Math.max(0, (playT - pb.times[idx]) / span));
        return { grow:cand, growLimit:Math.max(1, Math.round(cand.points.length * prog)) };
      }
    }
    return { grow:null, growLimit:0 };
  };
  const draw = (ctx, CW, CH, dpr, playT) => {
    const idx = lessonIndexAt(pb.times, playT);
    const baseItems = lessonItemsAt(pb, idx);         // idx 시점까지 커밋된 판서
    const { grow, growLimit } = growAt(idx, playT);
    const scale = Math.min(CW / lesson.W, CH / lesson.H) || 1;
    const dw = lesson.W * scale, dh = lesson.H * scale, ox = (CW - dw) / 2, oy = (CH - dh) / 2;
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.rect(0, 0, lesson.W, lesson.H); ctx.clip();
    // 판서 화면(whiteboard.js redraw)과 같은 순서 — 배경은 맨 나중에 밑으로 깐다.
    // 지우개가 destination-out 이라, 배경을 먼저 칠하면 지운 자리가 배경까지 뚫린다.
    MNBoardRenderer.drawItems(ctx, baseItems, { bg: boardBg });
    if (grow) MNBoardRenderer.drawItem(ctx, grow, boardBg, growLimit);
    MNBoardRenderer.paintBackground(ctx, { x:0, y:0, w:lesson.W, h:lesson.H }, { bg:boardBg, pattern:lesson.bgPattern, image:boardImage });
    ctx.restore();
  };
  let images = [];
  const video = Object.assign(lessonVideoSize(lesson.W, lesson.H), {
    frameKey:(t) => { const idx = lessonIndexAt(pb.times, t); return idx + ":" + growAt(idx, t).growLimit; },
    images:() => images
  });
  const player = mountReplayPlayer(doc, host, { duration, draw, video, audio:lesson.audio, onSave: () => saveLessonFile(lesson, doc.name) });
  images = preloadLessonImages(pb.kfs, player.redraw);
  if (boardImage){
    const img = new Image();
    img.onload = () => { boardImage.img = img; player.redraw(); };
    img.src = boardImage.src;
    images.push(img);
  }
}

// ----- PDF 위 필기(잉크) 리플레이 -----
// 부분 스트로크 그리기(성장 애니메이션). 기존 잉크 렌더러(applyInkStyle)를 재사용해 지우개(destination-out)도 재현.
function lessonDrawInk(ctx, st, limit){
  const p = st.points; if (!p || !p.length) return;
  // 도형(화살표·사각형·모자이크)은 성장 애니메이션 없이 한 번에(PDF 편집 화면과 같은 렌더러로) 그린다.
  if (typeof INK_SHAPE_TOOLS !== "undefined" && INK_SHAPE_TOOLS.has(st.tool) && typeof drawInkShape === "function"){
    drawInkShape(ctx, st); return;
  }
  const n = (limit == null) ? p.length : Math.max(1, Math.min(p.length, limit));
  ctx.save();
  if (typeof applyInkStyle === "function") applyInkStyle(ctx, st);
  else { ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = st.width; ctx.strokeStyle = st.color; ctx.globalAlpha = (st.tool === "highlighter") ? 0.3 : 1; }
  ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(p[i].x, p[i].y);
  if (n === 1) ctx.lineTo(p[0].x + 0.01, p[0].y + 0.01);
  ctx.stroke(); ctx.restore();
}

// t 시점의 활성 페이지 + 그 페이지의 커밋 스트로크(마지막 지우기 이후) + 성장 중 스트로크.
function pdfInkStateAt(kfs, times, t, firstPage){
  const idx = lessonIndexAt(times, t);
  const page = (idx >= 0 && kfs[idx]) ? kfs[idx].p : firstPage;
  const strokes = [];
  for (let i = 0; i <= idx; i++){
    const kf = kfs[i]; if (!kf || kf.p !== page) continue;
    if (kf.c) strokes.length = 0; else if (kf.a) strokes.push(kf.a);
  }
  let grow = null, growLimit = 0;
  const ni = idx + 1;
  if (ni < kfs.length && kfs[ni].a && kfs[ni].p === page){
    const cand = kfs[ni].a;
    if (cand.points && cand.points.length){
      const span = Math.max(1, times[ni] - times[idx]);
      const prog = Math.min(1, Math.max(0, (t - times[idx]) / span));
      grow = cand; growLimit = Math.max(1, Math.round(cand.points.length * prog));
    }
  }
  return { page, strokes, grow, growLimit };
}

// ----- 파이썬 트랙 재생 -----
// t 시점의 파이썬 상태: 마지막 코드 스냅샷 + (실행 중이면 running, 결과가 나왔으면 out).
// 이벤트 수가 작아(수백~수천) idx 가 바뀔 때만 앞에서부터 다시 쌓는다.
function lessonPyStateAt(py, times, t, cache){
  const idx = lessonIndexAt(times, t) - (times.length && times[0] > t ? 1 : 0);   // 첫 이벤트 전이면 -1
  if (cache && cache.idx === idx) return cache.state;
  let code = null, file = "", out = null, running = false;
  for (let i = 0; i <= idx; i++){
    const ev = py[i];
    if (ev.code != null){ code = ev.code; if (ev.f) file = ev.f; }
    if (ev.run){ running = true; out = null; }           // 실행 시작 → 이전 결과를 지우고 '실행 중…' 표시
    if (ev.out){ out = ev.out; running = false; }
  }
  const state = { code, file, out, running };
  if (cache){ cache.idx = idx; cache.state = state; }
  return state;
}

// 파이썬 트랙 사이드 패널(코드 + 실행 결과). update(state) 는 내용이 바뀐 때만 DOM 을 갱신한다.
function buildLessonPyPanel(){
  const side = document.createElement("div"); side.className = "lr-side";
  const head = document.createElement("div"); head.className = "lr-side-head";
  const fileEl = document.createElement("span"); fileEl.className = "lr-side-file"; fileEl.textContent = "파이썬";
  const stateEl = document.createElement("span"); stateEl.className = "lr-side-state";
  head.append(fileEl, stateEl);
  const codePre = document.createElement("pre"); codePre.className = "lr-py-code"; codePre.textContent = "";
  const outWrap = document.createElement("div"); outWrap.className = "lr-py-out"; outWrap.hidden = true;
  const outHead = document.createElement("div"); outHead.className = "lr-py-outhead"; outHead.textContent = "실행 결과";
  const outPre = document.createElement("pre"); outPre.className = "lr-py-outpre";
  const outStdout = document.createElement("span");
  const outStderr = document.createElement("span"); outStderr.className = "lr-py-err";
  outPre.append(outStdout, outStderr);
  const outImgs = document.createElement("div"); outImgs.className = "lr-py-imgs";
  outWrap.append(outHead, outPre, outImgs);
  side.append(head, codePre, outWrap);

  let lastCode = null, lastOut = null, lastRunning = null, lastFile = null;
  const update = (state) => {
    if (state.file !== lastFile){ lastFile = state.file; fileEl.textContent = state.file || "파이썬"; }
    if (state.code !== lastCode){
      lastCode = state.code;
      codePre.textContent = state.code == null ? "(아직 코드가 없어요)" : state.code;
      codePre.classList.toggle("lr-py-empty", state.code == null);
    }
    if (state.running !== lastRunning){
      lastRunning = state.running;
      stateEl.textContent = state.running ? "▶ 실행 중…" : "";
      stateEl.classList.toggle("running", !!state.running);
    }
    if (state.out !== lastOut){
      lastOut = state.out;
      const out = state.out;
      outWrap.hidden = !out;
      if (out){
        outStdout.textContent = out.o || "";
        outStderr.textContent = (out.e ? ((out.o ? "\n" : "") + out.e) : "") + (out.x ? (((out.o || out.e) ? "\n" : "") + "⚠ " + out.x) : "");
        outPre.classList.toggle("lr-py-muted", !out.o && !out.e && !out.x);
        if (!out.o && !out.e && !out.x) outStdout.textContent = "(출력 없음)";
        outImgs.innerHTML = "";
        // mn-zoomable = 클릭하면 크게 보기(image-lightbox.js). 여기 그림은 폭이 좁아 특히 필요하다
        if (Array.isArray(out.img)) for (const src of out.img){ const im = document.createElement("img"); im.className = "mn-zoomable"; im.src = src; im.alt = "그래프"; im.title = "클릭하면 크게 보기"; im.tabIndex = 0; outImgs.appendChild(im); }
        outWrap.scrollTop = 0;
      }
    }
  };
  return { side, update };
}

// 파이썬 트랙이 있는 lesson 에 사이드 패널을 만들어 { side, onTime } 을 돌려준다(없으면 null).
function lessonPySideFor(lesson){
  const py = Array.isArray(lesson.python) ? lesson.python : null;
  if (!py || !py.length) return null;
  const panel = buildLessonPyPanel();
  const times = py.map((ev) => ev.t || 0);
  const cache = { idx: null, state: null };
  return { side: panel.side, onTime: (t) => panel.update(lessonPyStateAt(py, times, t, cache)) };
}

// 파이썬 전용 리플레이(kind:"python") — 캔버스 없이 코드·실행 결과 패널만 재생.
function renderPythonReplay(doc, host, lesson){
  const pySide = lessonPySideFor(lesson);
  const py = Array.isArray(lesson.python) ? lesson.python : [];
  const duration = lesson.duration || (py.length ? (py[py.length - 1].t || 0) : 0);
  mountReplayPlayer(doc, host, {
    duration,
    draw: () => {},
    side: pySide ? pySide.side : null,
    hideStage: true,
    onTime: pySide ? pySide.onTime : undefined,
    audio: lesson.audio,
    onSave: () => saveLessonFile(lesson, doc.name)
  });
}

function renderPdfInkReplay(doc, host, lesson){
  const kfs = lesson.keyframes || [];
  const times = kfs.map((k) => k.t || 0);
  const pages = lesson.pages || {};
  const duration = lesson.duration || (times.length ? times[times.length - 1] : 0);
  const firstPage = kfs.length ? kfs[0].p : Number(Object.keys(pages)[0] || 0);

  const imgs = {};                                    // 페이지 배경(dataURL → Image)
  const off = document.createElement("canvas"); const offctx = off.getContext("2d");

  const draw = (ctx, CW, CH, dpr, playT) => {
    const st = pdfInkStateAt(kfs, times, playT, firstPage);
    const pg = pages[st.page] || { w: 1000, h: 1400 };
    const pw = pg.w || 1000, ph = pg.h || 1400;
    const scale = Math.min(CW / pw, CH / ph) || 1;
    const dw = pw * scale, dh = ph * scale, ox = (CW - dw) / 2, oy = (CH - dh) / 2;
    // 잉크는 별도 투명 캔버스에 그린다 — 지우개 destination-out 이 아래 배경 이미지를 지우지 않게.
    const os = Math.max(1, Math.min(3, dpr * scale));
    off.width = Math.max(1, Math.round(pw * os)); off.height = Math.max(1, Math.round(ph * os));
    offctx.setTransform(os, 0, 0, os, 0, 0);
    offctx.globalCompositeOperation = "source-over"; offctx.clearRect(0, 0, pw, ph);
    for (const s of st.strokes) lessonDrawInk(offctx, s, null);
    if (st.grow) lessonDrawInk(offctx, st.grow, st.growLimit);
    ctx.save();
    ctx.translate(ox, oy);
    const im = imgs[st.page];
    if (im && im.complete && im.naturalWidth){ ctx.drawImage(im, 0, 0, dw, dh); }
    else { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, dw, dh); }
    ctx.drawImage(off, 0, 0, dw, dh);
    ctx.restore();
    // 현재 페이지 표시
    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,.72)"; ctx.fillRect(ox + 8, oy + 8, 76, 22);
    ctx.fillStyle = "#fff"; ctx.font = '12px system-ui,"Malgun Gothic",sans-serif'; ctx.textBaseline = "middle";
    ctx.fillText("페이지 " + (st.page + 1), ox + 16, oy + 20);
    ctx.restore();
  };

  // 화면이 같은지: 지금 장면 번호 + 자라는 획의 길이. pdfInkStateAt 은 처음부터 훑어 느리므로 여기서는 번호만 본다.
  const frameKey = (t) => {
    const idx = lessonIndexAt(times, t), ni = idx + 1, page = kfs[idx] ? kfs[idx].p : firstPage;
    let growLimit = 0;
    if (ni < kfs.length && kfs[ni].a && kfs[ni].p === page && kfs[ni].a.points && kfs[ni].a.points.length){
      const span = Math.max(1, times[ni] - times[idx]);
      growLimit = Math.max(1, Math.round(kfs[ni].a.points.length * Math.min(1, Math.max(0, (t - times[idx]) / span))));
    }
    return idx + ":" + growLimit;
  };
  // 영상 크기는 첫 쪽 비율로 — 다른 크기의 쪽은 그 안에 맞춰 그린다(재생 화면과 같다).
  const firstPg = pages[firstPage] || { w:1000, h:1400 };
  const video = Object.assign(lessonVideoSize(firstPg.w, firstPg.h), { frameKey, images:() => Object.values(imgs) });
  const pySide = lessonPySideFor(lesson);            // 파이썬 트랙이 함께 녹화됐으면 오른쪽 패널로 재생
  const player = mountReplayPlayer(doc, host, {
    duration, draw, video,
    side: pySide ? pySide.side : null,
    onTime: pySide ? pySide.onTime : undefined,
    audio: lesson.audio,
    onSave: () => saveLessonFile(lesson, doc.name)
  });
  for (const k in pages){ if (pages[k] && pages[k].src){ const im = new Image(); im.onload = () => player.redraw(); im.src = pages[k].src; imgs[k] = im; } }
}

// ----- 저장/열기 -----
function saveLessonFile(lesson, name){
  try {
    MNDownload.saveText(JSON.stringify(lesson), (name || "수업").replace(/\.lesson$/i, "") + ".lesson", "application/json");
  } catch(e){ if (typeof toast === "function") toast("리플레이를 저장하지 못했어요.", 2400, { type: "error" }); }
}

// 녹화마다 겹치지 않는 파일 이름 — 같은 이름이면 '이미 열린 파일'로 보고 새로 열지 않고, 자동 복원 저장도 덮어쓴다.
function lessonRecordingFileName(name, now=new Date()){
  const base = String(name || "").replace(/\.[^./\\]+$/, "").trim();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  const stem = (base ? base + " " : "") + "리플레이 " + stamp;
  // 열린 리플레이는 이름에서 .lesson 을 떼므로 이름·작업공간 경로를 모두 본다.
  const taken = new Set();
  (typeof docs !== "undefined" && Array.isArray(docs) ? docs : []).forEach((d) => {
    if (!d) return;
    const docName = String(d.name || "");
    taken.add(docName); taken.add(docName + ".lesson");
    if (d.workspacePath) taken.add(String(d.workspacePath).split("/").pop());
  });
  let fileName = stem + ".lesson";
  for (let n = 2; taken.has(fileName); n++) fileName = `${stem} (${n}).lesson`;
  return fileName;
}

// 녹화 종료 후 재생 화면을 열고 안내한다. whiteboard.js·PDF/파이썬 녹화가 호출.
// 파일을 연 것처럼 .lesson 을 거쳐 열어야 작업공간 경로가 생기고, 다음 실행 때 자동 복원된다
// (예전엔 메모리에서 바로 열어 앱을 껐다 켜면 사라졌다).
async function finishLessonRecording(lesson, name){
  const fileName = lessonRecordingFileName(name);
  const started = performance.now();
  // 자동 복원이 되는지는 화면으로 안 보여 로그(logs/events.jsonl)에 단계마다 남긴다.
  const trace = { file:fileName, route:"direct", bytes:0, saved:null, reason:"", ms:0 };
  const report = () => {
    trace.ms = Math.round(performance.now() - started);
    if (typeof MNDiagnostics === "undefined") return;
    if (trace.saved === true) MNDiagnostics.info("lesson_recording_kept", "녹화 리플레이를 자동 복원에 저장했습니다.", trace);
    else MNDiagnostics.warn("lesson_recording_kept", "녹화 리플레이를 자동 복원에 저장하지 못했습니다.", trace);
  };
  let doc = null, file = null;
  if (typeof File !== "undefined" && typeof handleFiles === "function"){
    try {
      const text = JSON.stringify(lesson);
      trace.bytes = text.length;
      // 다시 열 때(자동 복원 포함) 거치는 검사를 미리 해 본다 — 여기서 걸리면 복원도 안 되니 까닭을 남긴다.
      const checked = validateLessonPayload(JSON.parse(text));
      if (text.length > LESSON_MAX_FILE_BYTES) trace.reason = "too-large";
      else if (!checked.ok) trace.reason = "invalid: " + checked.message;
      else {
        file = new File([text], fileName, { type:"application/json" });
        doc = await handleFiles([file], {});
        if (doc && doc.kind === "replay"){
          trace.route = "file";
          if (typeof setActiveDoc === "function" && typeof activeId !== "undefined" && activeId !== doc.id) setActiveDoc(doc.id);
        } else { trace.reason = doc ? "opened-as-" + doc.kind : "not-opened"; doc = null; }
      }
    } catch(error){ trace.reason = "open-error: " + String(error && error.message || error); doc = null; }
  } else trace.reason = "no-file-pipeline";
  // 파일 파이프라인을 못 쓰면(너무 크거나 오류) 예전처럼 바로 연다 — 이때는 자동 복원되지 않으니 저장을 권한다.
  if (!doc) doc = openLessonReplay(lesson, fileName.replace(/\.lesson$/i, ""));
  if (trace.route === "file"){
    if (typeof toast === "function") toast("수업 리플레이가 만들어졌어요. ▶ 재생하거나 저장 버튼으로 .lesson 파일을 남기세요.", 3400);
    // 자동 복원 저장을 끝까지 기다려 결과를 확인한다 — 실패하면 앱을 다시 켤 때 사라지므로 알린다.
    try {
      trace.saved = typeof rememberWorkspace === "function" ? !!(await rememberWorkspace([file], false, { silent:true })) : false;
      if (!trace.saved) trace.reason = "remember-returned-false";
    } catch(error){ trace.saved = false; trace.reason = "remember-error: " + String(error && error.message || error); }
    doc.savedInWorkspace = trace.saved;
    if (!trace.saved && typeof toast === "function") toast("리플레이를 자동 복원 목록에 저장하지 못했어요. 앱을 다시 켜기 전에 저장 버튼으로 .lesson 파일을 남겨 두세요.", 5000, { type:"error" });
  } else {
    trace.saved = false;
    if (typeof toast === "function") toast("수업 리플레이가 만들어졌어요. 앱을 다시 켜면 사라지니 저장 버튼으로 .lesson 파일을 남겨 두세요. (" + trace.reason + ")", 6000);
  }
  report();
  return doc;
}

// .lesson 파일 열기(파일 오픈 파이프라인 + 메뉴 공용).
async function loadLesson(file, options={}){
  let lesson = null;
  if (!file || (Number(file.size) > LESSON_MAX_FILE_BYTES)){
    if (typeof toast === "function") toast("리플레이 파일은 128MB 이하만 열 수 있어요.", 3000);
    return null;
  }
  try { lesson = JSON.parse(await file.text()); } catch(_){}
  const checked = validateLessonPayload(lesson);
  if (!checked.ok){ if (typeof toast === "function") toast("리플레이(.lesson) 파일을 읽지 못했어요: " + checked.message, 3600); return null; }
  return openLessonReplay(lesson, (file.name || "수업 리플레이").replace(/\.lesson$/i, ""), options);
}

// 메뉴 '리플레이 열기' — 숨은 파일 입력으로 .lesson 을 직접 고른다.
function openLessonFilePicker(){
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".lesson,application/json"; inp.hidden = true;
  inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; if (f) loadLesson(f, {}); inp.remove(); });
  document.body.appendChild(inp); inp.click();
}
