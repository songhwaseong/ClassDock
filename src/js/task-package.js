"use strict";

/* ===== 과제 패키지 (.task / .taskdone) =====
   문제 설명(마크다운) + 시작 코드 + 자동채점 테스트(+ 데이터 파일)를 .task 한 파일로 묶어 배포한다.
   학생은 더블클릭으로 열어(문제=참고 화면, 코드=편집기) 풀고, 과제 바의 채점을 거쳐
   제출본(.taskdone: 이름·최종 코드·채점 결과)을 내보낸다. .lesson 과 같은 JSON 파일 패턴.

   .task = { format:"classdock-task", version:1, id, meta:{title,author,createdAt},
             problem:{md}, starter:{name,code}, files:[{path,b64}], tests:[{name,input,expected,hidden?}], options:{} }
   .taskdone = { format:"classdock-task-result", version:1, taskId, taskTitle, taskHash,
                 student, code, grade:{passed,total,results:[{name,passed,actual,error}]},
                 gradedWith, submittedAt, seal }

   보안 참고(정직한 한계): 브라우저 단독 도구라 숨김 테스트·seal 은 마음먹은 학생의 열람·수정을
   막지 못한다. 제출 검증의 기준은 선생님이 원본 .task 의 테스트로 다시 채점하는 것이고(Phase 2),
   seal 은 파일 손상·단순 수기 수정을 감지하는 보조 수단이다. */

const TASK_FORMAT = "classdock-task";
const TASK_RESULT_FORMAT = "classdock-task-result";
const TASK_VERSION = 1;
const TASK_MAX_FILE_BYTES = 32 * 1024 * 1024;      // .task 파일 전체 상한
const TASK_MAX_ATTACH_TOTAL = 8 * 1024 * 1024;     // 첨부(데이터 파일) 원본 합계 상한
const TASK_MAX_ATTACH_COUNT = 20;
const TASK_MAX_TEXT_CHARS = 512 * 1024;            // 문제 설명·시작 코드 글자 상한

function taskValidationError(message){ return { ok:false, message }; }

function taskHasControlChars(value){
  const s = String(value || "");
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return true;
  return false;
}

// 첨부 경로: 구분자는 '/', 빈 조각·현재(.)·상위(..) 조각과 특수문자를 막는다(압축 해제와 같은 원칙).
function taskSafeRelPath(path){
  const p = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.length > 240 || taskHasControlChars(p) || /[<>:"|?*]/.test(p)) return null;
  const parts = p.split("/");
  for (const seg of parts){ if (!seg || seg === "." || seg === "..") return null; }
  return parts.join("/");
}

function taskB64ToBytes(b64){
  const binary = atob(String(b64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function taskBytesToB64(bytes){
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// 키를 정렬한 안정 직렬화 — 파일의 공백·키 순서와 무관하게 같은 내용이면 같은 해시.
function taskCanonicalStringify(value){
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map(taskCanonicalStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + taskCanonicalStringify(value[k])).join(",") + "}";
}

async function taskSha256Hex(text){
  try {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch(_){ return ""; }   // 비보안 컨텍스트 등 — 해시 없이도 나머지 기능은 동작
}

function taskRandomId(){
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch(_){}
  return "task-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// 파일명에 쓸 수 있게 특수문자를 치운 짧은 토큰
function taskSafeFileToken(value, fallback){
  let source = String(value || "");
  let cleaned = "";
  for (let i = 0; i < source.length; i++){
    const ch = source[i];
    cleaned += (source.charCodeAt(i) < 32 || '\\/:*?"<>|'.includes(ch)) ? " " : ch;
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return (cleaned || fallback || "과제").slice(0, 60);
}

/* ===== 지도 문제(kind:"map") =====
   같은 .task 봉투에 파이썬 과제 대신 "여기가 어디?" 위치 찾기 문제를 담는다. 배포·제출·검수
   배관(파일 형식·seal·일괄 검수·성적 CSV)을 그대로 쓰고, 채점만 코드 실행이 아니라 거리 계산이다.

   task.kind === "map" 이면 tests·starter 대신 map 이 있다:
     map: { basemap, center:[lat,lng], zoom, grid, backgroundImage, questions:[{id,prompt,lat,lng,toleranceM}] }
   정답 좌표가 파일 안에 있다는 것은 숨김 테스트와 같은 정직한 한계다(파일을 열면 보인다).
   기준은 선생님이 원본 .task 로 다시 채점하는 것. */
const TASK_MAP_MAX_QUESTIONS = 30;
const TASK_MAP_MIN_TOLERANCE = 10;          // 10m 보다 좁으면 지도에서 손으로 찍을 수 없다
const TASK_MAP_MAX_TOLERANCE = 200000;      // 200km — 대륙·나라 찾기 문제까지
const TASK_MAP_DEFAULT_TOLERANCE = 500;

function taskMapNumber(value, fallback){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
// 문제 하나. 좌표·허용 오차를 눌러 담아 손으로 고친 파일이 들어와도 채점이 깨지지 않게 한다.
function normalizeMapQuestion(raw, index){
  const value = raw && typeof raw === "object" ? raw : {};
  const prompt = String(value.prompt == null ? "" : value.prompt).trim().slice(0, 200);
  const lat = Math.min(85, Math.max(-85, taskMapNumber(value.lat, NaN)));
  const lng = Math.min(180, Math.max(-180, taskMapNumber(value.lng, NaN)));
  if (!prompt || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tolerance = Math.round(Math.min(TASK_MAP_MAX_TOLERANCE, Math.max(TASK_MAP_MIN_TOLERANCE,
    taskMapNumber(value.toleranceM, TASK_MAP_DEFAULT_TOLERANCE))));
  const id = String(value.id || "").trim().slice(0, 40) || ("q" + (index + 1));
  if (taskHasControlChars(id)) return null;
  return { id, prompt, lat, lng, toleranceM: tolerance };
}
function normalizeMapTaskSpec(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const questions = [];
  const usedIds = new Set();
  const list = Array.isArray(value.questions) ? value.questions.slice(0, TASK_MAP_MAX_QUESTIONS) : [];
  list.forEach((item, index) => {
    const question = normalizeMapQuestion(item, index);
    if (!question || usedIds.has(question.id)) return;
    usedIds.add(question.id);
    questions.push(question);
  });
  if (!questions.length) return null;
  const center = Array.isArray(value.center) && value.center.length === 2
    ? [taskMapNumber(value.center[0], 36.35), taskMapNumber(value.center[1], 127.85)] : [36.35, 127.85];
  const zoom = Math.min(19, Math.max(1, Math.round(taskMapNumber(value.zoom, 7))));
  // 배경 이미지는 지도 쪽 검증기가 있으면 그것으로 거른다(data URL 만·크기 상한). 없으면 버린다.
  const backgroundImage = (typeof mapNormalizeBackgroundImage === "function")
    ? mapNormalizeBackgroundImage(value.backgroundImage) : null;
  return {
    basemap: String(value.basemap || "osm").slice(0, 20),
    center, zoom,
    grid: value.grid === true,
    backgroundImage,
    questions
  };
}

/* 채점 = 거리 재기. 코드 실행이 없으므로 학생 화면·단독 검수·일괄 검수가 모두 이 한 함수를 쓴다
   (제출본이 신고한 점수와 선생님이 다시 낸 점수가 어긋날 여지를 만들지 않기 위해서다). */
function mapTaskGrade(task, answers){
  const questions = (task && task.map && Array.isArray(task.map.questions)) ? task.map.questions : [];
  const byId = new Map();
  for (const answer of Array.isArray(answers) ? answers : []){
    if (answer && answer.id != null) byId.set(String(answer.id), answer);
  }
  const results = questions.map((question) => {
    const answer = byId.get(String(question.id));
    if (!answer || !Number.isFinite(Number(answer.lat)) || !Number.isFinite(Number(answer.lng))){
      return { name: question.prompt, passed: false, actual: "답하지 않음", error: "" };
    }
    const meters = (typeof mapDistanceMeters === "function")
      ? mapDistanceMeters([Number(answer.lat), Number(answer.lng)], [question.lat, question.lng]) : Infinity;
    const passed = meters <= question.toleranceM;
    const near = (typeof mapFormatDistance === "function") ? mapFormatDistance(meters) : Math.round(meters) + " m";
    const allow = (typeof mapFormatDistance === "function") ? mapFormatDistance(question.toleranceM) : question.toleranceM + " m";
    return { name: question.prompt, passed, actual: near + " (허용 " + allow + ")", error: "" };
  });
  return { passed: results.filter(row => row.passed).length, total: results.length, results, answers: [...byId.values()] };
}

// ----- 검증 -----
function validateTaskPayload(task){
  if (!task || typeof task !== "object" || Array.isArray(task)) return taskValidationError("올바른 JSON 객체가 아니에요.");
  if (task.format !== TASK_FORMAT || task.version !== TASK_VERSION) return taskValidationError("지원하지 않는 과제 형식 또는 버전이에요.");
  const id = String(task.id || "").trim();
  if (!id || id.length > 64 || taskHasControlChars(id)) return taskValidationError("과제 id가 올바르지 않아요.");
  const meta = (task.meta && typeof task.meta === "object") ? task.meta : null;
  const title = meta ? String(meta.title || "").trim().slice(0, 120) : "";
  if (!title || taskHasControlChars(title)) return taskValidationError("과제 제목이 없어요.");
  const md = String((task.problem && task.problem.md) || "");
  if (md.length > TASK_MAX_TEXT_CHARS) return taskValidationError("문제 설명이 너무 길어요.");
  /* 지도 문제는 시작 코드도 채점 테스트도 없다 — 여기서 갈라 내지 않으면 "채점 테스트가 없어요"
     로 막힌다. 나머지(제목·id·설명·seal)는 파이썬 과제와 똑같이 다룬다. */
  if (task.kind === "map"){
    const spec = normalizeMapTaskSpec(task.map);
    if (!spec) return taskValidationError("지도 문제에 풀 문제가 없어요.");
    return { ok:true, task: {
      format: TASK_FORMAT, version: TASK_VERSION, id, kind: "map",
      meta: { title, author: String((meta && meta.author) || "").trim().slice(0, 60), createdAt: String((meta && meta.createdAt) || "") },
      problem: { md }, map: spec,
      options: (task.options && typeof task.options === "object") ? { ...task.options } : {}
    } };
  }
  const starter = (task.starter && typeof task.starter === "object") ? task.starter : {};
  const rawName = String(starter.name || "main.py").replace(/\\/g, "/").split("/").pop();
  const starterName = (taskSafeRelPath(rawName) && /\.py$/i.test(rawName) && rawName.length <= 120) ? rawName : "main.py";
  const code = String(starter.code || "");
  if (code.length > TASK_MAX_TEXT_CHARS) return taskValidationError("시작 코드가 너무 길어요.");
  const tests = normalizeAssignmentTests(task.tests);
  if (!tests.length) return taskValidationError("채점 테스트가 없어요.");
  const files = [];
  if (task.files != null){
    if (!Array.isArray(task.files) || task.files.length > TASK_MAX_ATTACH_COUNT) return taskValidationError("첨부 파일 목록이 올바르지 않아요.");
    let total = 0;
    const usedPaths = new Set([starterName.toLocaleLowerCase("en-US")]);
    for (const item of task.files){
      const path = taskSafeRelPath(item && item.path);
      const b64 = (item && typeof item.b64 === "string") ? item.b64 : null;
      if (!path || b64 == null) return taskValidationError("첨부 파일 항목이 올바르지 않아요.");
      const pathKey = path.toLocaleLowerCase("en-US");
      if (usedPaths.has(pathKey)) return taskValidationError("시작 코드 또는 다른 첨부와 파일 경로가 겹쳐요: " + path);
      usedPaths.add(pathKey);
      total += Math.floor(b64.length * 3 / 4);
      if (total > TASK_MAX_ATTACH_TOTAL) return taskValidationError("첨부 파일 합계가 8MB를 넘어요.");
      files.push({ path, b64 });
    }
  }
  return { ok:true, task: {
    format: TASK_FORMAT, version: TASK_VERSION, id, kind: "python",
    meta: { title, author: String((meta && meta.author) || "").trim().slice(0, 60), createdAt: String((meta && meta.createdAt) || "") },
    problem: { md }, starter: { name: starterName, code }, files, tests,
    options: (task.options && typeof task.options === "object") ? { ...task.options } : {}
  } };
}

// ----- 열기 (.task → 문제 참고 화면 + 시작 코드 편집기) -----
// 파일 오픈 파이프라인(file-loaders.js handleFiles)이 확장자 task 로 호출한다.
async function loadTask(file, opts){
  if (!file || Number(file.size) > TASK_MAX_FILE_BYTES){
    toast("과제 파일은 32MB 이하만 열 수 있어요.", 3000);
    return null;
  }
  let parsed = null;
  try { parsed = JSON.parse(await file.text()); } catch(_){}
  const checked = validateTaskPayload(parsed);
  if (!checked.ok){ toast("과제(.task) 파일을 읽지 못했어요: " + checked.message, 3600); return null; }
  return openTaskDoc(checked.task, opts || {});
}

// 시작 코드 + 첨부 데이터 파일을 같은 가상 폴더의 옆 파일 묶음으로 만든다 → 실행 시 open('data.csv') 같은 참조가 동작.
// 학생 열기(openTaskDoc)와 선생님 재채점(검수 뷰)이 같은 묶음을 쓴다.
function taskSiblingPairs(task){
  const safeTitle = taskSafeFileToken(task.meta.title, "과제");
  const root = "과제_" + safeTitle;
  const pyRel = root + "/" + task.starter.name;
  const starterFile = new File([task.starter.code], task.starter.name, { type: "text/x-python" });
  const pairs = [{ file: starterFile, relPath: pyRel }];
  for (const item of task.files || []){
    let bytes = null;
    try { bytes = taskB64ToBytes(item.b64); } catch(_){}
    if (!bytes){ toast("첨부 파일을 읽지 못했어요: " + item.path, 3000); continue; }
    pairs.push({ file: new File([bytes], item.path.split("/").pop()), relPath: root + "/" + item.path });
  }
  return { safeTitle, root, pyRel, starterFile, pairs };
}

async function openTaskDoc(task, opts){
  opts = opts || {};
  const hash = await taskSha256Hex(taskCanonicalStringify(task));
  /* 지도 문제는 코드 편집기가 아니라 지도 화면으로 연다. 문제 바·답 찍기는 지도 편집기가 맡고
     (map-viewer.js), 여기서는 문제 파일과 해시만 넘긴다. */
  if (task.kind === "map"){
    if (typeof openMapTaskDoc !== "function"){
      toast("이 버전에서는 지도 문제를 열 수 없어요.", 3200);
      return null;
    }
    const mapDoc = openMapTaskDoc(task, hash, opts);
    if (mapDoc && !opts.bulk && typeof setActiveDoc === "function") setActiveDoc(mapDoc.id);
    toast('지도 문제 "' + task.meta.title + '"를 열었어요. 지도를 눌러 답하고 [✓ 채점] → [📤 제출본 내보내기]를 누르세요.', 4600);
    return mapDoc;
  }
  const { safeTitle, root, pyRel, starterFile, pairs } = taskSiblingPairs(task);
  const archiveCtx = (typeof makeFileSiblingCtx === "function") ? makeFileSiblingCtx(pairs, root) : null;

  // 문제 설명(.md)을 먼저 열어 두고(시작 코드가 마지막 활성 문서가 되도록) 아래에서 참고 화면으로 고정한다.
  let mdDoc = null;
  if (String(task.problem.md || "").trim()){
    try {
      const mdFile = new File([task.problem.md], safeTitle + " 문제.md", { type: "text/markdown" });
      mdDoc = await loadOffice(mdFile, "md", {});
    } catch(e){ console.warn("task problem open failed:", e); }
  }

  // 저장 경로는 .task 원본이 아니라 과제 폴더/시작파일로 — 학생 저장이 과제 파일을 덮어쓰지 않게 한다.
  const pyOpts = {
    ...opts, fsHandle: null, fsDirHandle: null, textEncoding: null, originalSaveMode: false,
    workspacePath: pyRel, relPath: pyRel, archiveCtx,
    taskCtx: { task, hash, mdDocId: mdDoc ? mdDoc.id : null }
  };
  const pyDoc = await loadOffice(starterFile, "py", pyOpts);
  if (!pyDoc) return mdDoc;
  if (!opts.bulk){
    if (typeof setActiveDoc === "function") setActiveDoc(pyDoc.id);
    if (mdDoc && typeof startStudyModeWithDoc === "function") startStudyModeWithDoc(mdDoc, { silent: true });
  }
  toast('과제 "' + task.meta.title + '"를 열었어요. 코드를 완성하고 [✓ 채점] → [📤 제출본 내보내기]를 누르세요.', 4600);
  return pyDoc;
}

// 문제 설명을 다시 보여준다(닫았으면 과제 데이터에서 다시 만든다).
function showTaskProblem(ownerDoc){
  const ctx = ownerDoc && ownerDoc.taskCtx;
  if (!ctx) return;
  const existing = ctx.mdDocId ? docs.find(d => d.id === ctx.mdDocId) : null;
  if (existing){
    if (typeof startStudyModeWithDoc === "function" && startStudyModeWithDoc(existing, { silent: true })) return;
    if (typeof setActiveDoc === "function") setActiveDoc(existing.id);
    return;
  }
  const md = String(ctx.task.problem.md || "").trim();
  if (!md){ toast("이 과제에는 문제 설명이 없어요.", 2400); return; }
  const safeTitle = taskSafeFileToken(ctx.task.meta.title, "과제");
  const mdFile = new File([ctx.task.problem.md], safeTitle + " 문제.md", { type: "text/markdown" });
  loadOffice(mdFile, "md", {}).then((doc) => {
    if (!doc) return;
    ctx.mdDocId = doc.id;
    if (typeof startStudyModeWithDoc === "function") startStudyModeWithDoc(doc, { silent: true });
    if (typeof setActiveDoc === "function" && ownerDoc) setActiveDoc(ownerDoc.id);
  }).catch((e) => console.warn("task problem reopen failed:", e));
}

// ----- 과제 바 (편집기 툴바 아래: 제목 · 점수 · 문제 보기 · 채점 · 제출) -----
// code-viewer.js 가 과제 문서(ownerDoc.taskCtx)를 렌더할 때 호출한다.
function mountTaskBanner(ownerDoc, ui, runCtx, hooks){
  const ctx = ownerDoc && ownerDoc.taskCtx;
  if (!ctx || !hooks || !hooks.bar || typeof hooks.getCode !== "function") return;
  const task = ctx.task;
  if (ui && ui.gradeBtn) ui.gradeBtn.hidden = true;   // 테스트 편집(선생님용 채점 창)은 숨긴다 — 채점은 과제 바가 담당

  const banner = document.createElement("div"); banner.className = "task-banner";
  const icon = document.createElement("span"); icon.className = "task-banner-icon"; icon.textContent = "📦";
  const titleEl = document.createElement("strong"); titleEl.className = "task-banner-title";
  titleEl.textContent = task.meta.title;
  if (task.meta.author) titleEl.title = "출제: " + task.meta.author;
  const score = document.createElement("span"); score.className = "task-banner-score";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const problemBtn = document.createElement("button"); problemBtn.type = "button"; problemBtn.className = "btn task-banner-btn";
  problemBtn.textContent = "문제 보기"; problemBtn.title = "문제 설명을 참고 화면에 다시 띄우기";
  problemBtn.hidden = !String(task.problem.md || "").trim();
  problemBtn.addEventListener("click", () => showTaskProblem(ownerDoc));
  const gradeBtn = document.createElement("button"); gradeBtn.type = "button"; gradeBtn.className = "btn task-banner-btn";
  gradeBtn.textContent = "✓ 채점"; gradeBtn.title = "과제의 테스트로 현재 코드를 자동 채점";
  const submitBtn = document.createElement("button"); submitBtn.type = "button"; submitBtn.className = "btn primary task-banner-btn";
  submitBtn.textContent = "📤 제출본 내보내기"; submitBtn.title = "이름과 채점 결과를 담은 제출 파일(.taskdone) 만들기";

  const stateKey = "mn.task." + task.id;
  const applyScore = (passed, total) => {
    if (total > 0){
      score.textContent = "통과 " + passed + "/" + total;
      score.classList.toggle("is-pass", passed === total);
      score.classList.toggle("is-fail", passed !== total);
    } else {
      score.textContent = "미채점";
      score.classList.remove("is-pass", "is-fail");
    }
  };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(stateKey) || "null"); } catch(_){}
  applyScore(saved ? Number(saved.passed) || 0 : 0, saved ? Number(saved.total) || 0 : 0);

  const runGrade = () => runPythonSource(hooks.getCode(), ui, runCtx, false, {
    gradeTests: task.tests,
    onGradeResult: (res) => {
      if (!res || !res.report) return;   // 채점 결과를 읽지 못한 실행은 기록하지 않는다
      ctx.lastGrade = {
        passed: res.passed, total: res.total, results: res.report.results,
        backend: res.backend, code: hooks.getCode(), at: Date.now()
      };
      applyScore(res.passed, res.total);
      try { localStorage.setItem(stateKey, JSON.stringify({ passed: res.passed, total: res.total, at: Date.now() })); } catch(_){}
    }
  });
  gradeBtn.addEventListener("click", () => { if (!ui.running) runGrade(); });
  submitBtn.addEventListener("click", async () => {
    if (ui.running){ toast("실행이 끝난 뒤 다시 시도하세요.", 2200); return; }
    // 제출본은 항상 '지금 코드'의 채점 결과로 만든다 — 채점 전이거나 채점 후 코드를 고쳤으면 먼저 다시 채점.
    if (!ctx.lastGrade || ctx.lastGrade.code !== hooks.getCode()){
      toast("현재 코드로 먼저 채점할게요…", 2000);
      await runGrade();
    }
    const grade = ctx.lastGrade;
    if (!grade || grade.code !== hooks.getCode()){
      toast("채점 결과를 만들지 못해 제출본을 내보낼 수 없어요. 먼저 코드 오류를 확인하세요.", 3800, { type: "error" });
      return;
    }
    let studentName = "";
    try { studentName = localStorage.getItem("mn.studentName") || ""; } catch(_){}
    const entered = await askText({
      title: "제출본 내보내기", message: "학생 이름(번호+이름 권장)을 입력하세요.",
      placeholder: "예: 12 홍길동", value: studentName, okText: "내보내기"
    });
    if (entered === null) return;
    const student = String(entered).trim().slice(0, 60);
    if (!student){ toast("이름을 입력해야 제출본을 만들 수 있어요.", 2600); return; }
    try { localStorage.setItem("mn.studentName", student); } catch(_){}
    await exportTaskSubmission(ctx, student, grade);
  });

  banner.append(icon, titleEl, score, spacer, problemBtn, gradeBtn, submitBtn);
  hooks.bar.insertAdjacentElement("afterend", banner);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(banner);
}

// ----- 제출본(.taskdone) 내보내기 -----
async function exportTaskSubmission(ctx, student, grade){
  const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
  const submission = {
    format: TASK_RESULT_FORMAT, version: TASK_VERSION,
    taskId: ctx.task.id, taskTitle: ctx.task.meta.title, taskHash: ctx.hash || "",
    student,
    code: clip(grade.code, TASK_MAX_TEXT_CHARS),
    grade: {
      passed: Number(grade.passed) || 0, total: Number(grade.total) || 0,
      results: (grade.results || []).slice(0, 20).map(row => ({
        name: clip(row.name, 120), passed: !!row.passed, actual: clip(row.actual, 2000), error: clip(row.error, 2000)
      }))
    },
    gradedWith: clip(grade.backend, 30),
    submittedAt: new Date().toISOString()
  };
  // seal 은 위·변조 '방지'가 아니라 파일 손상·단순 수기 수정 '감지'용 — 진짜 검증은 선생님 쪽 재채점.
  submission.seal = await taskSha256Hex(taskCanonicalStringify(submission));
  const outName = taskSafeFileToken(ctx.task.meta.title, "과제") + "_" + taskSafeFileToken(student, "학생") + ".taskdone";
  await saveTaskJsonUnified(JSON.stringify(submission, null, 1), outName, "제출본");
}

/* 지도 문제 제출본. 파이썬 제출본과 같은 봉투를 쓰되 코드 대신 학생이 찍은 좌표가 들어간다 —
   결과 줄(results)의 모양이 같아서 단독·일괄 검수 화면이 그대로 읽는다. */
async function exportMapTaskSubmission(ctx, grade){
  if (!ctx || !ctx.task) return;
  let studentName = "";
  try { studentName = localStorage.getItem("mn.studentName") || ""; } catch(_){}
  const entered = await askText({
    title: "제출본 내보내기", message: "학생 이름(번호+이름 권장)을 입력하세요.",
    placeholder: "예: 12 홍길동", value: studentName, okText: "내보내기"
  });
  if (entered === null) return;
  const student = String(entered).trim().slice(0, 60);
  if (!student){ toast("이름을 입력해야 제출본을 만들 수 있어요.", 2600); return; }
  try { localStorage.setItem("mn.studentName", student); } catch(_){}

  const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
  const submission = {
    format: TASK_RESULT_FORMAT, version: TASK_VERSION, kind: "map",
    taskId: ctx.task.id, taskTitle: ctx.task.meta.title, taskHash: ctx.hash || "",
    student,
    code: "",
    answers: (grade.answers || []).slice(0, TASK_MAP_MAX_QUESTIONS).map(answer => ({
      id: clip(answer.id, 40), lat: Number(Number(answer.lat).toFixed(6)), lng: Number(Number(answer.lng).toFixed(6))
    })),
    grade: {
      passed: Number(grade.passed) || 0, total: Number(grade.total) || 0,
      results: (grade.results || []).slice(0, TASK_MAP_MAX_QUESTIONS).map(row => ({
        name: clip(row.name, 120), passed: !!row.passed, actual: clip(row.actual, 2000), error: clip(row.error, 2000)
      }))
    },
    gradedWith: "map-distance",
    submittedAt: new Date().toISOString()
  };
  submission.seal = await taskSha256Hex(taskCanonicalStringify(submission));
  const outName = taskSafeFileToken(ctx.task.meta.title, "지도문제") + "_" + taskSafeFileToken(student, "학생") + ".taskdone";
  await saveTaskJsonUnified(JSON.stringify(submission, null, 1), outName, "제출본");
}

// EXE 로컬 서버가 있으면 저장 폴더(내 문서\ClassDock 저장)에 권한 팝업 없이 쓰고 [폴더 열기] 토스트,
// 아니면 다운로드로 폴백 — 이미지 저장(saveImageBlobUnified)과 같은 동선.
async function saveTaskJsonUnified(text, outName, label, mime){
  try {
    if (typeof saveFileBackendAvailable === "function" && await saveFileBackendAvailable()){
      const path = await saveViaServer(text, { workspacePath: outName }, outName);
      if (path){
        toast(label + " 저장 완료 · " + path, 3600, {
          type: "success",
          action: (typeof window.__mnOpenLastSavedFolder === "function")
            ? { label: "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
        });
        return;
      }
    }
  } catch(_){ /* 서버 저장 실패 → 다운로드 폴백 */ }
  const blob = new Blob([text], { type: mime || "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = outName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(label + " 파일을 내려받았어요: " + outName, 3000, { type: "success" });
}

// ----- 과제 빌더 (선생님: 채점 창의 '📦 과제로 내보내기'에서 진입) -----
// seed: { getSource, suggestedTitle, tests, draft? } — draft 는 미리보기 뒤 '이어서 만들기' 복원용.
function openTaskBuilderModal(seed){
  seed = seed || {};
  const tests = normalizeAssignmentTests(seed.tests);
  if (!tests.length){ toast("먼저 채점 창에서 테스트를 1개 이상 만들어 주세요.", 3200); return; }
  const draft = seed.draft || null;
  const taskId = (draft && draft.taskId) || taskRandomId();   // 미리보기·내보내기가 같은 id 를 쓰도록 모달당 1회 생성

  const modal = document.createElement("div"); modal.className = "modal task-builder-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const title = document.createElement("h3"); title.textContent = "과제 파일 만들기 (.task)";
  const sub = document.createElement("p"); sub.className = "sub";
  sub.textContent = "문제 설명·시작 코드·채점 테스트를 한 파일로 묶어 배포합니다. 학생은 더블클릭으로 열어 풀고 제출본(.taskdone)을 내보냅니다. 테스트 내용 수정은 채점 창에서 하세요.";

  const body = document.createElement("div"); body.className = "task-builder-body";
  const field = (labelText, el) => {
    const wrap = document.createElement("label"); wrap.className = "task-builder-field";
    const cap = document.createElement("span"); cap.textContent = labelText;
    wrap.append(cap, el); return wrap;
  };
  const titleInput = document.createElement("input"); titleInput.type = "text"; titleInput.maxLength = 120;
  titleInput.placeholder = "예: 3단원 두 수의 합";
  titleInput.value = (draft && draft.title) || String(seed.suggestedTitle || "").trim();
  const authorInput = document.createElement("input"); authorInput.type = "text"; authorInput.maxLength = 60;
  authorInput.placeholder = "예: 김선생";
  authorInput.value = (draft && draft.author) || (() => { try { return localStorage.getItem("mn.taskAuthor") || ""; } catch(_){ return ""; } })();

  const mdArea = document.createElement("textarea"); mdArea.rows = 8; mdArea.spellcheck = false;
  mdArea.placeholder = "문제 설명 — 마크다운 지원: ## 제목, - 목록, `코드` …";
  mdArea.value = (draft && draft.md) || "";
  const mdTools = document.createElement("div"); mdTools.className = "task-builder-md-tools";
  const previewBtn = document.createElement("button"); previewBtn.type = "button"; previewBtn.className = "btn"; previewBtn.textContent = "미리보기";
  const previewBox = document.createElement("div"); previewBox.className = "task-builder-md-preview"; previewBox.hidden = true;
  previewBtn.addEventListener("click", () => {
    if (previewBox.hidden){
      try { previewBox.innerHTML = markdownToHtml(mdArea.value, {}); }
      catch(e){ previewBox.textContent = "미리보기를 만들지 못했어요."; }
      previewBox.hidden = false; previewBtn.textContent = "편집으로";
      mdArea.hidden = true;
    } else {
      previewBox.hidden = true; previewBtn.textContent = "미리보기";
      mdArea.hidden = false; mdArea.focus();
    }
  });
  mdTools.appendChild(previewBtn);

  const codeArea = document.createElement("textarea"); codeArea.rows = 10; codeArea.spellcheck = false;
  codeArea.className = "task-builder-code";
  codeArea.placeholder = "# 학생에게 처음 보여줄 시작 코드";
  codeArea.value = (draft && draft.code != null) ? draft.code : (typeof seed.getSource === "function" ? seed.getSource() : "");

  // 테스트 요약 + 테스트별 '숨김' 체크(숨김이면 학생에게 통과/실패만 보인다)
  const testsBox = document.createElement("div"); testsBox.className = "task-builder-tests";
  const hiddenChecks = tests.map((t, i) => {
    const row = document.createElement("label"); row.className = "task-builder-test-row";
    const check = document.createElement("input"); check.type = "checkbox";
    check.checked = draft ? !!(draft.hidden && draft.hidden[i]) : t.hidden === true;
    const tag = document.createElement("span"); tag.className = "task-builder-test-tag"; tag.textContent = "숨김";
    const name = document.createElement("span"); name.className = "task-builder-test-name";
    name.textContent = "#" + (i + 1) + " " + t.name;
    row.append(check, tag, name); testsBox.appendChild(row);
    return check;
  });

  // 첨부 데이터 파일(선택) — 시작 코드와 같은 폴더에 놓인 것처럼 open('파일명') 으로 읽을 수 있다.
  const attachments = (draft && draft.attachments) ? [...draft.attachments] : [];
  const attachBox = document.createElement("div"); attachBox.className = "task-builder-attach";
  const attachList = document.createElement("div"); attachList.className = "task-builder-attach-list";
  const attachInput = document.createElement("input"); attachInput.type = "file"; attachInput.multiple = true; attachInput.hidden = true;
  const attachBtn = document.createElement("button"); attachBtn.type = "button"; attachBtn.className = "btn"; attachBtn.textContent = "+ 데이터 파일 첨부";
  attachBtn.title = "학생 코드가 읽을 데이터 파일(csv·txt 등)을 과제에 포함 (합계 8MB)";
  const attachTotal = () => attachments.reduce((sum, a) => sum + (a.size || 0), 0);
  const renderAttachList = () => {
    attachList.innerHTML = "";
    attachments.forEach((a, i) => {
      const row = document.createElement("div"); row.className = "task-builder-attach-row";
      const name = document.createElement("span"); name.textContent = a.path + " (" + Math.max(1, Math.round((a.size || 0) / 1024)) + "KB)";
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "py-grade-remove"; remove.textContent = "삭제";
      remove.addEventListener("click", () => { attachments.splice(i, 1); renderAttachList(); });
      row.append(name, remove); attachList.appendChild(row);
    });
  };
  attachBtn.addEventListener("click", () => attachInput.click());
  attachInput.addEventListener("change", async () => {
    for (const f of [...(attachInput.files || [])]){
      if (attachments.length >= TASK_MAX_ATTACH_COUNT){ toast("첨부는 최대 " + TASK_MAX_ATTACH_COUNT + "개까지예요.", 2600); break; }
      if (attachTotal() + f.size > TASK_MAX_ATTACH_TOTAL){ toast("첨부 파일 합계가 8MB를 넘어 '" + f.name + "'을 뺐어요.", 3200); continue; }
      const path = taskSafeRelPath(f.name);
      if (!path){ toast("파일 이름을 쓸 수 없어요: " + f.name, 2600); continue; }
      if (attachments.some(a => a.path === path)){ toast("같은 이름의 첨부가 이미 있어요: " + path, 2600); continue; }
      try { attachments.push({ path, b64: taskBytesToB64(new Uint8Array(await f.arrayBuffer())), size: f.size }); }
      catch(_){ toast("파일을 읽지 못했어요: " + f.name, 2600); }
    }
    attachInput.value = "";
    renderAttachList();
  });
  renderAttachList();
  attachBox.append(attachBtn, attachInput, attachList);

  body.append(
    field("과제 제목", titleInput),
    field("출제자(선택)", authorInput),
    field("문제 설명(마크다운, 선택)", mdArea)
  );
  body.appendChild(mdTools); body.appendChild(previewBox);
  body.appendChild(field("시작 코드", codeArea));
  const testsCap = document.createElement("div"); testsCap.className = "task-builder-field";
  const testsLabel = document.createElement("span"); testsLabel.textContent = "채점 테스트 " + tests.length + "개 — 숨김으로 표시하면 학생에게 통과/실패만 보여요";
  testsCap.append(testsLabel, testsBox); body.appendChild(testsCap);
  const attachCap = document.createElement("div"); attachCap.className = "task-builder-field";
  const attachLabel = document.createElement("span"); attachLabel.textContent = "데이터 파일(선택)";
  attachCap.append(attachLabel, attachBox); body.appendChild(attachCap);

  const collectDraft = () => ({
    taskId, title: titleInput.value, author: authorInput.value, md: mdArea.value, code: codeArea.value,
    hidden: hiddenChecks.map(c => c.checked), attachments: [...attachments]
  });
  const buildTask = () => {
    const titleValue = titleInput.value.trim().slice(0, 120);
    if (!titleValue){ toast("과제 제목을 입력하세요.", 2400); titleInput.focus(); return null; }
    const author = authorInput.value.trim().slice(0, 60);
    try { localStorage.setItem("mn.taskAuthor", author); } catch(_){}
    const built = {
      format: TASK_FORMAT, version: TASK_VERSION, id: taskId,
      meta: { title: titleValue, author, createdAt: new Date().toISOString() },
      problem: { md: mdArea.value.slice(0, TASK_MAX_TEXT_CHARS) },
      starter: { name: "main.py", code: codeArea.value.slice(0, TASK_MAX_TEXT_CHARS) },
      files: attachments.map(a => ({ path: a.path, b64: a.b64 })),
      tests: tests.map((t, i) => hiddenChecks[i].checked ? { ...t, hidden: true } : { name: t.name, input: t.input, expected: t.expected }),
      options: {}
    };
    const checked = validateTaskPayload(built);
    if (!checked.ok){ toast("과제를 만들지 못했어요: " + checked.message, 3400); return null; }
    return checked.task;
  };

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const previewTaskBtn = document.createElement("button"); previewTaskBtn.type = "button"; previewTaskBtn.className = "btn";
  previewTaskBtn.textContent = "👀 학생 화면 미리보기";
  previewTaskBtn.title = "만든 과제를 학생이 여는 그대로 열어보기(만들던 내용은 알림의 [이어서 만들기]로 복원)";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "닫기";
  const exportBtn = document.createElement("button"); exportBtn.type = "button"; exportBtn.className = "btn primary"; exportBtn.textContent = "📦 .task 내보내기";

  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation(); close();
  };
  cancel.addEventListener("click", close);
  previewTaskBtn.addEventListener("click", async () => {
    const task = buildTask(); if (!task) return;
    const restore = { ...seed, draft: collectDraft() };
    close();
    await openTaskDoc(task, {});
    toast("학생 화면 미리보기예요. 만들던 과제로 돌아가려면 [이어서 만들기]를 누르세요.", 6000, {
      action: { label: "이어서 만들기", onClick: () => openTaskBuilderModal(restore) }
    });
  });
  exportBtn.addEventListener("click", async () => {
    const task = buildTask(); if (!task) return;
    exportBtn.disabled = true;
    try { await saveTaskJsonUnified(JSON.stringify(task, null, 1), taskSafeFileToken(task.meta.title, "과제") + ".task", "과제"); }
    finally { exportBtn.disabled = false; }
    close();
  });

  actions.append(previewTaskBtn, spacer, cancel, exportBtn);
  card.append(title, sub, body, actions); modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
  window.addEventListener("keydown", onKey, true);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(card);
  setTimeout(() => { try { titleInput.focus(); } catch(_){} }, 0);
}

/* ----- 지도 문제 만들기 (선생님: 지도 도구막대의 '🎯 지도 문제') -----
   지금 지도의 표시가 곧 문제 목록이 된다 — 답사 지도를 만들어 두면 그 자리에서 문제지가 나온다.
   문제 글은 표시 이름을 기본값으로 두되 고칠 수 있게 한다("경복궁" → "조선의 법궁은 어디일까요?"). */
const TASK_MAP_TOLERANCE_CHOICES = [100, 300, 500, 1000, 2000, 5000];

function openMapTaskBuilder(model){
  const markers = (model && Array.isArray(model.markers) ? model.markers : []).filter(m => String(m.label || "").trim());
  if (!markers.length){
    toast("먼저 이름이 있는 표시를 찍어 주세요 — 표시 하나가 문제 하나가 됩니다.", 3600);
    return;
  }
  const taskId = taskRandomId();
  const modal = document.createElement("div"); modal.className = "modal task-builder-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const title = document.createElement("h3"); title.textContent = "지도 문제 만들기 (.task)";
  const sub = document.createElement("p"); sub.className = "sub";
  sub.textContent = "표시 하나가 '여기가 어디?' 문제 하나가 됩니다. 학생은 지도를 눌러 답하고, 정답 자리에서 허용 오차 안이면 맞은 것으로 채점합니다. 학생 화면에는 표시가 보이지 않습니다.";

  const body = document.createElement("div"); body.className = "task-builder-body";
  const field = (labelText, el) => {
    const wrap = document.createElement("label"); wrap.className = "task-builder-field";
    const cap = document.createElement("span"); cap.textContent = labelText;
    wrap.append(cap, el); return wrap;
  };
  const titleInput = document.createElement("input"); titleInput.type = "text"; titleInput.maxLength = 120;
  titleInput.placeholder = "예: 우리 지역 문화재 찾기";
  titleInput.value = String((model && model.title) || "").trim();
  const authorInput = document.createElement("input"); authorInput.type = "text"; authorInput.maxLength = 60;
  authorInput.placeholder = "예: 김선생";
  try { authorInput.value = localStorage.getItem("mn.taskAuthor") || ""; } catch(_){}
  const introArea = document.createElement("textarea"); introArea.rows = 3; introArea.spellcheck = false;
  introArea.placeholder = "학생에게 보여 줄 안내(선택) — 문제를 열 때 알림으로 뜹니다.";

  const toleranceSelect = document.createElement("select");
  for (const meters of TASK_MAP_TOLERANCE_CHOICES){
    const option = document.createElement("option");
    option.value = String(meters);
    option.textContent = (typeof mapFormatDistance === "function") ? mapFormatDistance(meters) : meters + " m";
    toleranceSelect.appendChild(option);
  }
  toleranceSelect.value = String(TASK_MAP_DEFAULT_TOLERANCE);

  // 문제 목록 — 체크로 고르고, 글은 그 자리에서 고친다.
  const listBox = document.createElement("div"); listBox.className = "task-builder-tests";
  const rows = markers.map((marker, index) => {
    const row = document.createElement("div"); row.className = "task-builder-test-row";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = true;
    const number = document.createElement("span"); number.className = "task-builder-test-tag"; number.textContent = String(index + 1);
    const prompt = document.createElement("input"); prompt.type = "text"; prompt.maxLength = 200;
    prompt.className = "task-builder-test-name"; prompt.value = String(marker.label || "").slice(0, 200);
    row.append(check, number, prompt); listBox.appendChild(row);
    return { marker, check, prompt };
  });

  const includeImage = document.createElement("input"); includeImage.type = "checkbox"; includeImage.checked = true;
  const imageField = field("내 지도 이미지도 함께 담기(학교 배치도 등)", includeImage);
  imageField.classList.add("task-builder-inline");
  imageField.hidden = !(model && model.backgroundImage);

  body.append(
    field("문제 제목", titleInput),
    field("출제자(선택)", authorInput),
    field("안내(선택)", introArea),
    field("허용 오차 — 정답 자리에서 이만큼 안이면 정답", toleranceSelect)
  );
  const listCap = document.createElement("div"); listCap.className = "task-builder-field";
  const listLabel = document.createElement("span");
  listLabel.textContent = "문제로 낼 표시 " + markers.length + "개 — 체크를 풀면 빠지고, 글은 고칠 수 있어요 (최대 " + TASK_MAP_MAX_QUESTIONS + "개)";
  listCap.append(listLabel, listBox); body.appendChild(listCap);
  body.appendChild(imageField);

  const buildTask = () => {
    const titleValue = titleInput.value.trim().slice(0, 120);
    if (!titleValue){ toast("문제 제목을 입력하세요.", 2400); titleInput.focus(); return null; }
    const author = authorInput.value.trim().slice(0, 60);
    try { localStorage.setItem("mn.taskAuthor", author); } catch(_){}
    const tolerance = Number(toleranceSelect.value) || TASK_MAP_DEFAULT_TOLERANCE;
    const questions = rows.filter(row => row.check.checked).slice(0, TASK_MAP_MAX_QUESTIONS).map((row, index) => ({
      id: "q" + (index + 1),
      prompt: row.prompt.value.trim().slice(0, 200) || row.marker.label,
      lat: row.marker.lat, lng: row.marker.lng, toleranceM: tolerance
    }));
    if (!questions.length){ toast("문제로 낼 표시를 하나 이상 골라 주세요.", 2600); return null; }
    const built = {
      format: TASK_FORMAT, version: TASK_VERSION, id: taskId, kind: "map",
      meta: { title: titleValue, author, createdAt: new Date().toISOString() },
      problem: { md: introArea.value.slice(0, TASK_MAX_TEXT_CHARS) },
      map: {
        basemap: model.basemap, center: model.center, zoom: model.zoom, grid: !!model.grid,
        // 배경 이미지는 문제 파일이 그만큼 커진다 — 학교 배치도처럼 꼭 필요할 때만 담는다.
        backgroundImage: (includeImage.checked && model.backgroundImage) ? model.backgroundImage : null,
        questions
      },
      options: {}
    };
    const checked = validateTaskPayload(built);
    if (!checked.ok){ toast("지도 문제를 만들지 못했어요: " + checked.message, 3400); return null; }
    return checked.task;
  };

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const previewBtn = document.createElement("button"); previewBtn.type = "button"; previewBtn.className = "btn";
  previewBtn.textContent = "👀 학생 화면 미리보기";
  previewBtn.title = "만든 문제를 학생이 여는 그대로 새 탭에서 열어보기";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "닫기";
  const exportBtn = document.createElement("button"); exportBtn.type = "button"; exportBtn.className = "btn primary";
  exportBtn.textContent = "📦 .task 내보내기";

  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation(); close();
  };
  cancel.addEventListener("click", close);
  previewBtn.addEventListener("click", async () => {
    const task = buildTask(); if (!task) return;
    close();
    await openTaskDoc(task, {});
  });
  exportBtn.addEventListener("click", async () => {
    const task = buildTask(); if (!task) return;
    exportBtn.disabled = true;
    try { await saveTaskJsonUnified(JSON.stringify(task, null, 1), taskSafeFileToken(task.meta.title, "지도문제") + ".task", "지도 문제"); }
    finally { exportBtn.disabled = false; }
    close();
  });

  actions.append(previewBtn, spacer, cancel, exportBtn);
  card.append(title, sub, body, actions); modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
  window.addEventListener("keydown", onKey, true);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(card);
  setTimeout(() => { try { titleInput.focus(); } catch(_){} }, 0);
}

/* ===== Phase 2: 제출본(.taskdone) 검수 — 열기 · seal 검사 · 원본 과제로 재채점 ===== */

function validateTaskSubmissionPayload(sub){
  if (!sub || typeof sub !== "object" || Array.isArray(sub)) return taskValidationError("올바른 JSON 객체가 아니에요.");
  if (sub.format !== TASK_RESULT_FORMAT || sub.version !== TASK_VERSION) return taskValidationError("지원하지 않는 제출본 형식 또는 버전이에요.");
  const student = String(sub.student || "").trim().slice(0, 60);
  if (!student || taskHasControlChars(student)) return taskValidationError("학생 이름이 없어요.");
  const code = String(sub.code || "");
  if (code.length > TASK_MAX_TEXT_CHARS) return taskValidationError("제출 코드가 너무 길어요.");
  const grade = (sub.grade && typeof sub.grade === "object") ? sub.grade : {};
  const passed = Math.max(0, Math.min(1000, Number(grade.passed) || 0));
  const total = Math.max(0, Math.min(1000, Number(grade.total) || 0));
  const results = Array.isArray(grade.results) ? grade.results.slice(0, 20).map((row, index) => ({
    name: String((row && row.name) || ("테스트 " + (index + 1))).slice(0, 120),
    passed: !!(row && row.passed),
    actual: String((row && row.actual) || "").slice(0, 2000),
    error: String((row && row.error) || "").slice(0, 2000)
  })) : [];
  /* 지도 문제 제출본은 코드 대신 좌표를 들고 온다. 여기서 함께 정규화하지 않으면 검수 화면이
     학생이 어디를 찍었는지 알 수 없고, 재채점도 할 수 없다(정답은 원본 .task 에만 있다). */
  const kind = sub.kind === "map" ? "map" : "python";
  const answers = Array.isArray(sub.answers) ? sub.answers.slice(0, TASK_MAP_MAX_QUESTIONS).map((row) => ({
    id: String((row && row.id) || "").slice(0, 40),
    lat: Number(row && row.lat), lng: Number(row && row.lng)
  })).filter(row => row.id && Number.isFinite(row.lat) && Number.isFinite(row.lng)) : [];
  return { ok:true, submission: {
    format: TASK_RESULT_FORMAT, version: TASK_VERSION, kind, answers,
    taskId: String(sub.taskId || "").slice(0, 64), taskTitle: String(sub.taskTitle || "").slice(0, 120),
    taskHash: String(sub.taskHash || "").slice(0, 64),
    student, code,
    grade: { passed, total, results },
    gradedWith: String(sub.gradedWith || "").slice(0, 30),
    submittedAt: String(sub.submittedAt || "").slice(0, 40),
    seal: String(sub.seal || "").slice(0, 64)
  } };
}

// 제출본 파일을 읽어 {submission, sealState} 로 만든다. 단일 검수와 일괄 검수가 함께 쓴다.
// silent=true 면 실패 토스트 대신 null 만 돌려준다(일괄 추가에서 파일별 메시지를 직접 띄움).
async function parseTaskSubmissionFile(file, silent){
  const say = (msg) => { if (!silent) toast(msg, 3600); };
  if (!file || Number(file.size) > TASK_MAX_FILE_BYTES){
    say("제출본 파일은 32MB 이하만 열 수 있어요.");
    return null;
  }
  let parsed = null;
  try { parsed = JSON.parse(await file.text()); } catch(_){}
  const checked = validateTaskSubmissionPayload(parsed);
  if (!checked.ok){ say("제출본(.taskdone) 파일을 읽지 못했어요: " + checked.message); return null; }
  // seal 검사는 정규화 전 원본 객체로 — 내보낼 때 캐노니컬 해시와 그대로 비교돼야 한다.
  let sealState = "none";   // ok | mismatch | none(봉인 없음·해시 계산 불가)
  if (parsed.seal){
    const raw = { ...parsed }; delete raw.seal;
    const recomputed = await taskSha256Hex(taskCanonicalStringify(raw));
    sealState = !recomputed ? "none" : (recomputed === parsed.seal ? "ok" : "mismatch");
  }
  return { submission: checked.submission, sealState };
}

function openTaskSubmissionDoc(submission, sealState, name, opts){
  const doc = makeDoc("office", name || (submission.student + ".taskdone"), opts || {});
  doc.taskSubmission = submission;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    renderTaskSubmissionView(doc, host, submission, sealState);
  };
  refreshChrome();
  activateIfIdle(doc, opts || {});
  return doc;
}

// 파일 오픈 파이프라인이 확장자 taskdone 으로 호출한다.
async function loadTaskSubmission(file, opts){
  const parsed = await parseTaskSubmissionFile(file, false);
  if (!parsed) return null;
  return openTaskSubmissionDoc(parsed.submission, parsed.sealState, file.name, opts || {});
}

// 열려 있는 문서 중 같은 과제(id)의 .task 컨텍스트를 찾는다(재채점 기준).
function findOpenTaskCtx(taskId, taskHash){
  if (!taskId) return null;
  const matches = docs
    .filter(d => d && d.taskCtx && d.taskCtx.task && d.taskCtx.task.id === taskId)
    .map(d => d.taskCtx);
  if (taskHash){
    const exact = matches.find(ctx => ctx.hash && ctx.hash === taskHash);
    if (exact) return exact;
  }
  // 같은 id의 여러 버전이 열려 있는데 제출 당시 해시와 맞는 항목이 없으면 임의 버전으로 채점하지 않는다.
  return matches.length === 1 ? matches[0] : null;
}

function countOpenTaskVersions(taskId){
  if (!taskId) return 0;
  return docs.filter(d => d && d.taskCtx && d.taskCtx.task && d.taskCtx.task.id === taskId).length;
}

function renderTaskSubmissionView(doc, host, sub, sealState){
  const wrap = document.createElement("section"); wrap.className = "task-review";

  // 머리글
  const head = document.createElement("div"); head.className = "task-review-head";
  const headIcon = document.createElement("span"); headIcon.textContent = "📥";
  const headTitle = document.createElement("strong"); headTitle.textContent = "제출본 검수";
  const headTask = document.createElement("span"); headTask.className = "task-review-head-task";
  headTask.textContent = sub.taskTitle || "(과제 제목 없음)";
  head.append(headIcon, headTitle, headTask);
  wrap.appendChild(head);

  // 요약 정보
  const grid = document.createElement("div"); grid.className = "task-review-grid";
  const cell = (caption, node) => {
    const box = document.createElement("div"); box.className = "task-review-cell";
    const cap = document.createElement("b"); cap.textContent = caption;
    box.append(cap, node); grid.appendChild(box);
  };
  const studentEl = document.createElement("span"); studentEl.textContent = sub.student;
  cell("학생", studentEl);
  const timeEl = document.createElement("span");
  timeEl.textContent = (() => {
    const at = new Date(sub.submittedAt);
    return isNaN(at.getTime()) ? (sub.submittedAt || "알 수 없음") : at.toLocaleString();
  })();
  cell("제출 시각", timeEl);
  const reported = document.createElement("span");
  reported.className = "task-banner-score " + (sub.grade.total > 0 && sub.grade.passed === sub.grade.total ? "is-pass" : "is-fail");
  reported.textContent = sub.grade.total > 0 ? ("통과 " + sub.grade.passed + "/" + sub.grade.total) : "기록 없음";
  cell("제출본이 신고한 점수", reported);
  const backendEl = document.createElement("span");
  backendEl.textContent = sub.gradedWith === "local-python" ? "로컬 파이썬" : sub.gradedWith === "pyodide" ? "브라우저(Pyodide)" : (sub.gradedWith || "알 수 없음");
  cell("채점 환경", backendEl);
  const sealEl = document.createElement("span");
  sealEl.className = "task-review-seal " + (sealState === "ok" ? "is-pass" : sealState === "mismatch" ? "is-fail" : "");
  sealEl.textContent = sealState === "ok" ? "✓ 이상 없음" : sealState === "mismatch" ? "⚠ 파일이 수정되었거나 손상됨" : "검사할 수 없음";
  sealEl.title = "봉인(seal) 검사는 단순 수정·손상을 감지하는 보조 수단이에요. 확실한 검증은 아래 재채점으로 하세요.";
  cell("파일 검사", sealEl);
  wrap.appendChild(grid);

  // 재채점 영역 — 같은 과제(.task)가 열려 있어야 활성화된다
  const matchBox = document.createElement("div"); matchBox.className = "task-review-match";
  const matchMsg = document.createElement("span"); matchMsg.className = "task-review-match-msg";
  const openTaskBtn = document.createElement("button"); openTaskBtn.type = "button"; openTaskBtn.className = "btn";
  openTaskBtn.textContent = "원본 .task 열기";
  const refreshBtn = document.createElement("button"); refreshBtn.type = "button"; refreshBtn.className = "btn";
  refreshBtn.textContent = "↻"; refreshBtn.title = "열린 과제 다시 확인";
  const regradeBtn = document.createElement("button"); regradeBtn.type = "button"; regradeBtn.className = "btn primary";
  regradeBtn.textContent = "🔁 재채점"; regradeBtn.title = "제출 코드를 원본 과제의 테스트로 이 컴퓨터에서 다시 채점";
  const diffBtn = document.createElement("button"); diffBtn.type = "button"; diffBtn.className = "btn";
  diffBtn.textContent = "🔀 시작 코드와 비교"; diffBtn.title = "학생이 과제 시작 코드에서 무엇을 바꿨는지 나란히 비교해 보기";
  diffBtn.hidden = sub.kind === "map";      // 지도 문제에는 견줄 시작 코드가 없다
  if (sub.kind === "map") regradeBtn.title = "제출한 좌표를 원본 문제의 정답·허용 오차로 다시 채점";
  const compareEl = document.createElement("div"); compareEl.className = "task-review-compare"; compareEl.hidden = true;
  matchBox.append(matchMsg, openTaskBtn, refreshBtn, diffBtn, regradeBtn);
  wrap.appendChild(matchBox);
  wrap.appendChild(compareEl);

  const refreshMatch = () => {
    const ctx = findOpenTaskCtx(sub.taskId, sub.taskHash);
    regradeBtn.disabled = !ctx;
    diffBtn.disabled = !ctx || typeof openCompareResult !== "function";
    openTaskBtn.hidden = !!ctx;
    if (!ctx){
      const ambiguous = countOpenTaskVersions(sub.taskId) > 1;
      matchMsg.textContent = ambiguous
        ? "⚠ 같은 과제 ID의 여러 버전이 열려 있지만 제출 당시 파일과 일치하는 버전을 찾지 못했어요. 원본 .task를 다시 여세요."
        : "재채점하려면 이 제출본의 원본 과제(.task)를 먼저 여세요.";
      matchMsg.classList.toggle("is-warn", ambiguous);
      return null;
    }
    if (ctx.hash && sub.taskHash && ctx.hash !== sub.taskHash){
      matchMsg.textContent = "⚠ 열린 과제가 제출 당시 파일과 버전이 달라요(테스트가 수정되었을 수 있음). 재채점 결과가 다를 수 있어요.";
      matchMsg.classList.add("is-warn");
    } else {
      matchMsg.textContent = '원본 과제 "' + ctx.task.meta.title + '" 열림 ✓';
      matchMsg.classList.remove("is-warn");
    }
    return ctx;
  };
  openTaskBtn.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".task,application/json"; inp.hidden = true;
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      await loadTask(f, {});
      if (typeof setActiveDoc === "function") setActiveDoc(doc.id);   // 검수 화면으로 복귀
      refreshMatch();
    });
    document.body.appendChild(inp); inp.click();
  });
  refreshBtn.addEventListener("click", refreshMatch);
  // 시작 코드 ↔ 제출 코드 비교 — 학생이 무엇을 고쳤는지 채점 전에 한눈에 본다.
  diffBtn.addEventListener("click", () => {
    const ctx = refreshMatch();
    if (!ctx || typeof openCompareResult !== "function") return;
    openCompareResult(
      { name: (ctx.task.starter.name || "main.py") + " (시작 코드)", text: String(ctx.task.starter.code || "") },
      { name: (sub.student || "학생") + " 제출 코드", text: String(sub.code || "") }
    );
  });

  // 재채점 실행/결과 패널 — 파이썬 실행기(runPythonSource)가 요구하는 최소 ui 객체를 만든다.
  const regradeSection = document.createElement("div"); regradeSection.className = "task-review-out";
  const statusEl = document.createElement("div"); statusEl.className = "task-review-status"; statusEl.textContent = "";
  const outPanel = document.createElement("div"); outPanel.className = "task-review-outpanel"; outPanel.hidden = true;
  regradeSection.append(statusEl, outPanel);
  wrap.appendChild(regradeSection);
  const fakeBtn = document.createElement("button"); fakeBtn.type = "button"; fakeBtn.hidden = true;
  regradeSection.appendChild(fakeBtn);
  const ui = { btn: fakeBtn, status: statusEl, outPanel, split: regradeSection, fileBase: "main.py" };

  // 지도 문제 재채점은 거리 계산이라 실행기가 필요 없다 — 결과 줄까지 그 자리에서 그린다.
  const mapAnswerBox = document.createElement("div"); mapAnswerBox.className = "task-review-mapanswers";
  mapAnswerBox.hidden = sub.kind !== "map";
  wrap.appendChild(mapAnswerBox);
  const renderMapAnswers = (ctx, grade) => {
    mapAnswerBox.innerHTML = "";
    if (sub.kind !== "map") return;
    const questions = (ctx && ctx.task && ctx.task.map && ctx.task.map.questions) || [];
    const answerById = new Map(sub.answers.map(answer => [answer.id, answer]));
    const head = document.createElement("h4"); head.textContent = "학생이 찍은 답";
    mapAnswerBox.appendChild(head);
    const rows = questions.length
      ? questions.map((question, index) => ({
          label: (index + 1) + ". " + question.prompt,
          answer: answerById.get(question.id) || null,
          result: grade ? grade.results[index] : null
        }))
      // 원본 문제가 열려 있지 않으면 문제 글은 알 수 없다 — 좌표와 제출본이 신고한 줄만 보여 준다.
      : sub.answers.map((answer, index) => ({
          label: (index + 1) + ". " + (sub.grade.results[index] ? sub.grade.results[index].name : answer.id),
          answer, result: sub.grade.results[index] || null
        }));
    for (const row of rows){
      const item = document.createElement("div");
      item.className = "task-review-reported-row " + (row.result ? (row.result.passed ? "is-pass" : "is-fail") : "");
      const mark = document.createElement("span"); mark.className = "py-grade-result-mark";
      mark.textContent = row.result ? (row.result.passed ? "정답" : "오답") : "—";
      const name = document.createElement("span"); name.textContent = row.label;
      const where = document.createElement("code"); where.className = "task-review-reported-err";
      where.textContent = row.answer
        ? row.answer.lat.toFixed(5) + ", " + row.answer.lng.toFixed(5) + (row.result ? " · " + row.result.actual : "")
        : "답하지 않음";
      item.append(mark, name, where);
      mapAnswerBox.appendChild(item);
    }
  };
  renderMapAnswers(null, null);

  regradeBtn.addEventListener("click", async () => {
    const ctx = refreshMatch();
    if (!ctx || ui.running) return;
    if (sub.kind === "map" || ctx.task.kind === "map"){
      if (ctx.task.kind !== "map" || sub.kind !== "map"){
        statusEl.textContent = "제출본과 과제의 종류가 서로 달라요(지도 문제 ↔ 파이썬 과제).";
        return;
      }
      const res = mapTaskGrade(ctx.task, sub.answers);
      const same = res.passed === sub.grade.passed && res.total === sub.grade.total;
      compareEl.hidden = false;
      compareEl.classList.toggle("is-pass", same);
      compareEl.classList.toggle("is-fail", !same);
      compareEl.textContent = same
        ? "✓ 재채점 결과가 제출본의 점수와 일치해요 (" + res.passed + "/" + res.total + ")"
        : "⚠ 점수 불일치 — 제출본 " + sub.grade.passed + "/" + sub.grade.total + " · 재채점 " + res.passed + "/" + res.total + " (제출본 수정 또는 문제 버전 차이 가능)";
      statusEl.textContent = "재채점 완료 · 거리로 채점했어요.";
      renderMapAnswers(ctx, res);
      return;
    }
    const parts = taskSiblingPairs(ctx.task);
    ui.fileBase = ctx.task.starter.name;
    outPanel.hidden = false;
    compareEl.hidden = true;
    regradeBtn.disabled = true;
    try {
      // 실행 대상 파일은 번들에서 채점 하네스로 교체되므로, 제출 코드를 소스로 넘기면 된다.
      // 선생님 검수이므로 숨김 표시는 걷어내고 모든 테스트의 입력·기대·실제 출력을 그대로 보여준다.
      const visibleTests = ctx.task.tests.map(t => ({ name: t.name, input: t.input, expected: t.expected }));
      const runCtx = (typeof makeFileSiblingCtx === "function")
        ? { archiveCtx: makeFileSiblingCtx(parts.pairs, parts.root), relPath: parts.pyRel }
        : null;
      await runPythonSource(sub.code, ui, runCtx, false, {
        gradeTests: visibleTests,
        onGradeResult: (res) => {
          if (!res || !res.report) return;
          const same = res.passed === sub.grade.passed && res.total === sub.grade.total;
          compareEl.hidden = false;
          compareEl.classList.toggle("is-pass", same);
          compareEl.classList.toggle("is-fail", !same);
          compareEl.textContent = same
            ? "✓ 재채점 결과가 제출본의 점수와 일치해요 (" + res.passed + "/" + res.total + ")"
            : "⚠ 점수 불일치 — 제출본 " + sub.grade.passed + "/" + sub.grade.total + " · 재채점 " + res.passed + "/" + res.total + " (코드 수정 또는 과제 버전 차이 가능)";
        }
      });
    } finally {
      regradeBtn.disabled = !findOpenTaskCtx(sub.taskId, sub.taskHash);
    }
  });

  // 제출 코드(읽기 전용) + 새 탭으로 열기 — 지도 문제에는 코드가 없다(위의 답 목록이 그 자리다).
  const codeBox = document.createElement("details"); codeBox.className = "task-review-code"; codeBox.open = true;
  codeBox.hidden = sub.kind === "map";
  const codeSummary = document.createElement("summary");
  const lineCount = sub.code ? sub.code.split("\n").length : 0;
  codeSummary.textContent = "제출 코드 (" + lineCount + "줄)";
  const codeTools = document.createElement("div"); codeTools.className = "task-review-code-tools";
  const openCodeBtn = document.createElement("button"); openCodeBtn.type = "button"; openCodeBtn.className = "btn";
  openCodeBtn.textContent = "새 탭에서 편집기로 열기";
  openCodeBtn.title = "제출 코드를 Python 편집기 탭으로 열어 실행·단계 실행으로 살펴보기";
  openCodeBtn.addEventListener("click", () => {
    const pyName = taskSafeFileToken(sub.student, "학생") + "_main.py";
    loadOffice(new File([sub.code], pyName, { type: "text/x-python" }), "py", {})
      .catch((e) => console.warn("submission code open failed:", e));
  });
  codeTools.appendChild(openCodeBtn);
  const codePre = document.createElement("pre"); codePre.className = "task-review-pre";
  codePre.textContent = sub.code || "(코드 없음)";
  codeBox.append(codeSummary, codeTools, codePre);
  wrap.appendChild(codeBox);

  // 제출본이 신고한 테스트별 결과(참고용 — 확실한 값은 재채점)
  if (sub.grade.results.length){
    const reportBox = document.createElement("details"); reportBox.className = "task-review-code";
    const reportSummary = document.createElement("summary");
    reportSummary.textContent = "제출본이 신고한 테스트별 결과 (참고용)";
    reportBox.appendChild(reportSummary);
    const list = document.createElement("div"); list.className = "task-review-reported";
    sub.grade.results.forEach((row) => {
      const item = document.createElement("div"); item.className = "task-review-reported-row " + (row.passed ? "is-pass" : "is-fail");
      const mark = document.createElement("span"); mark.className = "py-grade-result-mark"; mark.textContent = row.passed ? "통과" : "실패";
      const name = document.createElement("span"); name.textContent = row.name;
      item.append(mark, name);
      if (row.error){
        const err = document.createElement("code"); err.className = "task-review-reported-err";
        err.textContent = row.error.split("\n").pop().slice(0, 160);
        item.appendChild(err);
      }
      list.appendChild(item);
    });
    reportBox.appendChild(list);
    wrap.appendChild(reportBox);
  }

  refreshMatch();
  host.appendChild(wrap);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(wrap);
}

/* ===== Phase 3: 제출본 일괄 검수 — 여러 .taskdone 을 표로 모아 전체 재채점 + 성적 CSV ===== */

// 메뉴·명령 팔레트에서 연다. 반 전체 제출본을 추가해 한 번에 재채점하고 성적표(CSV)로 내보낸다.
function openTaskBatchReview(){
  const doc = makeDoc("office", "제출본 일괄 검수", {});
  doc.taskBatch = { rows: [] };
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    renderTaskBatchView(doc, host);
  };
  refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

function renderTaskBatchView(doc, host){
  const state = doc.taskBatch || (doc.taskBatch = { rows: [] });
  const wrap = document.createElement("section"); wrap.className = "task-review task-batch";

  const head = document.createElement("div"); head.className = "task-review-head";
  const headIcon = document.createElement("span"); headIcon.textContent = "🗂️";
  const headTitle = document.createElement("strong"); headTitle.textContent = "제출본 일괄 검수";
  head.append(headIcon, headTitle);
  wrap.appendChild(head);

  const hint = document.createElement("p"); hint.className = "task-batch-hint";
  hint.textContent = "반 전체의 제출본(.taskdone)을 추가하고, 원본 과제(.task)를 연 상태에서 전체 재채점을 누르세요. 결과는 성적 CSV로 내보낼 수 있어요.";
  wrap.appendChild(hint);

  // 도구줄
  const bar = document.createElement("div"); bar.className = "task-review-match";
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.className = "btn";
  addBtn.textContent = "+ 제출본 추가"; addBtn.title = "여러 .taskdone 파일을 한 번에 선택할 수 있어요";
  const openTaskBtn = document.createElement("button"); openTaskBtn.type = "button"; openTaskBtn.className = "btn";
  openTaskBtn.textContent = "원본 .task 열기";
  const barSpacer = document.createElement("div"); barSpacer.className = "spacer";
  const runAllBtn = document.createElement("button"); runAllBtn.type = "button"; runAllBtn.className = "btn primary";
  runAllBtn.textContent = "▶ 전체 재채점";
  runAllBtn.title = "모든 제출 코드를 원본 과제의 테스트로 이 컴퓨터에서 다시 채점";
  const csvBtn = document.createElement("button"); csvBtn.type = "button"; csvBtn.className = "btn";
  csvBtn.textContent = "⬇ 성적 CSV"; csvBtn.title = "표의 내용을 엑셀에서 열 수 있는 CSV 파일로 내보내기";
  bar.append(addBtn, openTaskBtn, barSpacer, runAllBtn, csvBtn);
  wrap.appendChild(bar);

  const statusLine = document.createElement("div"); statusLine.className = "task-review-status";
  wrap.appendChild(statusLine);

  // 표
  const tableWrap = document.createElement("div"); tableWrap.className = "task-batch-table-wrap";
  const table = document.createElement("table"); table.className = "task-batch-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["#", "학생", "제출 시각", "신고 점수", "파일 검사", "재채점", "일치", ""].forEach((label) => {
    const th = document.createElement("th"); th.textContent = label; headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  const empty = document.createElement("div"); empty.className = "task-batch-empty";
  empty.textContent = "아직 추가한 제출본이 없어요. [+ 제출본 추가]로 .taskdone 파일들을 선택하세요.";
  wrap.appendChild(empty);

  const scoreChip = (passed, total, extraClass) => {
    const chip = document.createElement("span");
    chip.className = "task-banner-score " + (extraClass || (total > 0 && passed === total ? "is-pass" : "is-fail"));
    chip.textContent = total > 0 ? (passed + "/" + total) : "—";
    return chip;
  };
  const renderRows = () => {
    tbody.innerHTML = "";
    empty.hidden = state.rows.length > 0;
    state.rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      const td = (node) => { const cell = document.createElement("td"); if (node != null) cell.append(node); tr.appendChild(cell); return cell; };
      td(String(index + 1));
      td(row.sub.student).classList.add("task-batch-student");
      const at = new Date(row.sub.submittedAt);
      td(isNaN(at.getTime()) ? (row.sub.submittedAt || "—") : at.toLocaleString());
      td(scoreChip(row.sub.grade.passed, row.sub.grade.total));
      const seal = document.createElement("span");
      seal.className = "task-review-seal " + (row.sealState === "ok" ? "is-pass" : row.sealState === "mismatch" ? "is-fail" : "");
      seal.textContent = row.sealState === "ok" ? "✓" : row.sealState === "mismatch" ? "⚠ 수정됨" : "?";
      td(seal);
      td(row.regrade ? scoreChip(row.regrade.passed, row.regrade.total) : (row.note || "—"));
      if (row.regrade){
        const same = row.regrade.passed === row.sub.grade.passed && row.regrade.total === row.sub.grade.total;
        const match = document.createElement("span");
        match.className = "task-review-seal " + (same ? "is-pass" : "is-fail");
        match.textContent = (same ? "✓ 일치" : "⚠ 불일치") + (row.hashWarn ? " · 버전 다름" : "");
        td(match);
      } else td("—");
      const detailBtn = document.createElement("button"); detailBtn.type = "button"; detailBtn.className = "btn task-batch-detail";
      detailBtn.textContent = "자세히"; detailBtn.title = "이 제출본을 단독 검수 화면으로 열기";
      detailBtn.addEventListener("click", () => openTaskSubmissionDoc(row.sub, row.sealState, row.fileName || (row.sub.student + ".taskdone"), {}));
      td(detailBtn);
      tbody.appendChild(tr);
    });
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(tbody);
  };

  // 제출본 추가(여러 개)
  addBtn.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".taskdone,application/json"; inp.multiple = true; inp.hidden = true;
    inp.addEventListener("change", async () => {
      const files = [...(inp.files || [])];
      inp.remove();
      let added = 0, skipped = 0;
      for (const f of files){
        const parsed = await parseTaskSubmissionFile(f, true);
        if (!parsed){ skipped++; continue; }
        const sub = parsed.submission;
        const dup = state.rows.some(r => r.sub.student === sub.student && r.sub.submittedAt === sub.submittedAt && r.sub.taskId === sub.taskId);
        if (dup){ skipped++; continue; }
        state.rows.push({ sub, sealState: parsed.sealState, fileName: f.name, regrade: null, note: "", hashWarn: false });
        added++;
      }
      state.rows.sort((a, b) => a.sub.student.localeCompare(b.sub.student, "ko"));
      renderRows();
      if (added || skipped) toast("제출본 " + added + "개 추가" + (skipped ? " · " + skipped + "개 제외(중복·형식 오류)" : ""), 2800);
    });
    document.body.appendChild(inp); inp.click();
  });

  openTaskBtn.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".task,application/json"; inp.hidden = true;
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      await loadTask(f, {});
      if (typeof setActiveDoc === "function") setActiveDoc(doc.id);   // 일괄 검수 화면으로 복귀
    });
    document.body.appendChild(inp); inp.click();
  });

  // 재채점 실행용 최소 ui(결과 패널은 숨김 — 표의 점수만 갱신)
  const hiddenOut = document.createElement("div"); hiddenOut.hidden = true;
  const hiddenSplit = document.createElement("div"); hiddenSplit.hidden = true;
  const fakeBtn = document.createElement("button"); fakeBtn.type = "button"; fakeBtn.hidden = true;
  const fakeStatus = document.createElement("span"); fakeStatus.hidden = true;
  wrap.append(hiddenOut, hiddenSplit, fakeBtn, fakeStatus);
  const ui = { btn: fakeBtn, status: fakeStatus, outPanel: hiddenOut, split: hiddenSplit, fileBase: "main.py" };

  runAllBtn.addEventListener("click", async () => {
    if (ui.running) return;
    if (!state.rows.length){ toast("먼저 [+ 제출본 추가]로 .taskdone 파일을 넣어 주세요.", 2800); return; }
    if (!state.rows.some(row => findOpenTaskCtx(row.sub.taskId, row.sub.taskHash))){
      toast("제출본과 같은 과제의 원본 .task 를 먼저 열어 주세요.", 3200);
      return;
    }
    runAllBtn.disabled = true; addBtn.disabled = true;
    try {
      for (let i = 0; i < state.rows.length; i++){
        const row = state.rows[i];
        const ctx = findOpenTaskCtx(row.sub.taskId, row.sub.taskHash);
        if (!ctx){ row.regrade = null; row.note = "과제 안 열림"; renderRows(); continue; }
        statusLine.textContent = (i + 1) + "/" + state.rows.length + " 재채점 중: " + row.sub.student;
        /* 지도 문제는 거리 계산이라 실행기를 돌리지 않는다 — 반 전체를 한 번에 다시 채점해도
           파이썬 과제처럼 오래 걸리지 않는다. */
        if (ctx.task.kind === "map"){
          if (row.sub.kind !== "map"){ row.regrade = null; row.note = "종류 불일치"; renderRows(); continue; }
          const res = mapTaskGrade(ctx.task, row.sub.answers);
          row.regrade = { passed: res.passed, total: res.total };
          row.note = "";
          row.hashWarn = !!(ctx.hash && row.sub.taskHash && ctx.hash !== row.sub.taskHash);
          renderRows();
          continue;
        }
        const parts = taskSiblingPairs(ctx.task);
        ui.fileBase = ctx.task.starter.name;
        const visibleTests = ctx.task.tests.map(t => ({ name: t.name, input: t.input, expected: t.expected }));
        const runCtx = (typeof makeFileSiblingCtx === "function")
          ? { archiveCtx: makeFileSiblingCtx(parts.pairs, parts.root), relPath: parts.pyRel }
          : null;
        let got = null;
        try {
          await runPythonSource(row.sub.code, ui, runCtx, false, {
            gradeTests: visibleTests,
            onGradeResult: (res) => { if (res && res.report) got = res; }
          });
        } catch(e){ console.warn("batch regrade failed:", e); }
        if (got){ row.regrade = { passed: got.passed, total: got.total }; row.note = ""; }
        else { row.regrade = null; row.note = "채점 실패"; }
        row.hashWarn = !!(ctx.hash && row.sub.taskHash && ctx.hash !== row.sub.taskHash);
        renderRows();
      }
      statusLine.textContent = "재채점 완료 · " + state.rows.length + "명";
    } finally {
      runAllBtn.disabled = false; addBtn.disabled = false;
    }
  });

  // 성적 CSV — 엑셀 한글 호환을 위해 BOM 을 붙인다.
  csvBtn.addEventListener("click", () => {
    if (!state.rows.length){ toast("내보낼 제출본이 없어요.", 2400); return; }
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [["과제", "학생", "제출 시각", "신고 통과", "신고 전체", "재채점 통과", "재채점 전체", "점수 일치", "파일 검사", "채점 환경", "비고"].map(cell).join(",")];
    for (const row of state.rows){
      const same = row.regrade ? (row.regrade.passed === row.sub.grade.passed && row.regrade.total === row.sub.grade.total ? "일치" : "불일치") : "";
      lines.push([
        row.sub.taskTitle, row.sub.student, row.sub.submittedAt,
        row.sub.grade.passed, row.sub.grade.total,
        row.regrade ? row.regrade.passed : "", row.regrade ? row.regrade.total : "",
        same,
        row.sealState === "ok" ? "이상 없음" : row.sealState === "mismatch" ? "수정됨" : "검사 불가",
        row.sub.gradedWith,
        (row.note || "") + (row.hashWarn ? (row.note ? " · " : "") + "과제 버전 다름" : "")
      ].map(cell).join(","));
    }
    const stamp = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const outName = "성적_" + stamp.getFullYear() + pad2(stamp.getMonth() + 1) + pad2(stamp.getDate()) + "_" + pad2(stamp.getHours()) + pad2(stamp.getMinutes()) + ".csv";
    saveTaskJsonUnified(String.fromCharCode(0xFEFF) + lines.join("\r\n"), outName, "성적표", "text/csv");
  });

  renderRows();
  host.appendChild(wrap);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(wrap);
}

// 명령 팔레트 '과제 파일 만들기' — 활성 문서가 파이썬 편집기면 채점 창을 열어 기존 흐름으로 안내한다.
function openTaskBuilderFromActive(){
  const active = (typeof state !== "undefined" && state) ? state : null;
  const gradeButton = active && active.el ? active.el.querySelector(".run-grade") : null;
  if (gradeButton){
    gradeButton.click();
    toast("테스트를 만들고 [📦 과제로 내보내기]를 누르면 과제 파일이 됩니다.", 3600);
    return;
  }
  toast("파이썬(.py) 파일을 연 뒤, 실행 바의 채점에서 과제 파일을 만들 수 있어요.", 3600);
}
