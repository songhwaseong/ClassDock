"use strict";

/* 자바 연습 코드를 EXE 런처의 로컬 JDK 로 실행한다.
   파이썬(Pyodide)·자바스크립트(Worker)와 달리 브라우저에는 쓸 만한 자바 런타임이 없어서,
   EXE 가 아니거나 JDK 가 없으면 실행 대신 안내를 띄운다.
   실행 흐름(세션 시작 → 증분 폴링 → 표준입력 → 중지)은 파이썬 대화형 실행과 같은 계약을 쓴다. */

const JAVA_POLL_INTERVAL_MS = 120;
const JAVA_FINAL_HEAD = 20000;      // 완료 후 표시 상한(앞)
const JAVA_FINAL_TAIL = 10000;      // 완료 후 표시 상한(뒤)
// 실행 중에는 마지막 부분만 그린다 — 거대한 <pre> 를 매 폴마다 재배치하면 메인 스레드가 막혀
// 중지 버튼 클릭이 늦게 처리된다(파이썬 대화형 실행에서 같은 이유로 쓰는 값).
const JAVA_LIVE_TAIL = 16000;
const JAVA_GRADE_TIMEOUT_MS = 30000;   // 채점 한 건이 이보다 오래 걸리면 끝나지 않는 반복으로 본다

function javaT(text){
  return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(text) : text;
}
function javaTf(template, vars){
  return (typeof window !== "undefined" && typeof window.tf === "function") ? window.tf(template, vars) :
    String(template).replace(/\{(\w+)\}/g, (_, key) => vars && vars[key] != null ? String(vars[key]) : _);
}

/* 실행 임시 폴더의 전체 경로가 컴파일 오류 메시지 앞에 붙는다
   (C:\...\moidajava_session_xxxx\Foo.java:3: error: ...). 학생에게는 잡음이라 파일 이름만 남긴다. */
const JAVA_TEMP_PATH_RE = /(?:[A-Za-z]:)?[\\/][^\r\n"']*?moidajava_session_[0-9a-f]+[\\/]/g;
// javac 진단 첫 줄: Foo.java:3: error: ...
const JAVA_COMPILE_ERROR_RE = /^([\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]*)\.java:(\d+):/mu;
// 실행 스택 한 칸: \tat Foo.main(Foo.java:5)
const JAVA_STACK_FRAME_RE = /\(([\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]*)\.java:(\d+)\)/gu;

// 표준입력을 읽는 코드인지 — 실행 직후 터미널 칸으로 포커스를 옮길지 판단한다.
function javaUsesInput(src){
  return /System\s*\.\s*in\b|new\s+Scanner\b|\breadLine\s*\(|\bBufferedReader\b|\bConsole\b/.test(String(src || ""));
}

// 화면에 보여줄 오류 텍스트로 다듬는다(임시 경로 제거 + 같은 말을 반복하는 마지막 줄 제거).
function cleanJavaStderr(text){
  return String(text || "")
    .replace(JAVA_TEMP_PATH_RE, "")
    .replace(/\n?error: compilation failed\s*$/, "")
    .replace(/\s+$/, "");
}

/* 오류가 가리키는 편집기 줄 번호. 컴파일 오류가 있으면 그 줄을, 없으면 스택에서
   학생 파일(mainClass)의 가장 깊은 프레임을 고른다 — JDK 안쪽 프레임(Scanner.java 등)은 건너뛴다.
   javac 진단은 줄 맨 앞이 파일 이름이어야 알아볼 수 있으므로 임시 경로를 먼저 지운다
   (원본 stderr 를 그대로 넘겨도 되도록 여기서 정리한다). */
function javaErrorLine(stderr, mainClass){
  const text = cleanJavaStderr(stderr);
  const compile = JAVA_COMPILE_ERROR_RE.exec(text);
  if (compile) return Number(compile[2]) || 0;
  JAVA_STACK_FRAME_RE.lastIndex = 0;
  let frame, fallback = 0;
  while ((frame = JAVA_STACK_FRAME_RE.exec(text))){
    const line = Number(frame[2]) || 0;
    if (!line) continue;
    if (mainClass && frame[1] === mainClass) return line;
    if (!fallback) fallback = line;
  }
  return fallback;
}

// ── 세션 호출 ──────────────────────────────────────────────────────────────
async function startJavaSession(source, stdinText, piped, libs){
  // 페이로드 봉투는 파이썬 실행과 같은 것을 쓴다([길이][소스][길이][표준입력]).
  const body = buildRunPayload(String(source == null ? "" : source), stdinText || "");
  // 라이브러리는 '이름'만 보낸다 — 어느 jar 를 어디서 찾을지는 런처가 자기 카탈로그로 정한다.
  const query = [];
  if (piped) query.push("piped=1");
  if (libs) query.push("libs=" + encodeURIComponent(String(libs)));
  const res = await fetch("/java-session-start" + (query.length ? "?" + query.join("&") : ""), {
    method:"POST", headers:{ "Content-Type":"application/octet-stream" }, body
  });
  if (!res.ok){
    const text = (await res.text()) || ("HTTP " + res.status);
    const error = new Error(text);
    if (text.indexOf("no-java") >= 0) error.noJava = true;
    throw error;
  }
  return (await res.json()).id;
}

async function stopJavaSession(id){
  try { await fetch("/java-session-stop?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
}

/* 완료까지 증분 폴링. so/se 는 이미 받은 출력 길이 — 그대로면 서버가 "unchanged" 로 짧게 답하고,
   자랐으면 그 뒤 새 내용만 보낸다(누적 출력을 매 폴마다 새로 만들지 않기 위한 계약). */
async function pollJavaSessionToEnd(id, options){
  options = options || {};
  const started = Date.now();
  const limit = options.timeoutMs || JAVA_GRADE_TIMEOUT_MS;
  let out = "", err = "", so = -1, se = -1, mainClass = "";
  for (;;){
    const res = await fetch("/java-session-poll?id=" + encodeURIComponent(id) + "&so=" + so + "&se=" + se, { cache:"no-store" });
    if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
    const data = await res.json();
    if (!data.unchanged){
      if (typeof data.stdoutDelta === "string" || typeof data.stderrDelta === "string"){
        out += data.stdoutDelta || "";
        err += data.stderrDelta || "";
      } else {
        out = data.stdout || "";
        err = data.stderr || "";
      }
      so = out.length; se = err.length;
      if (data.mainClass) mainClass = data.mainClass;
      if (data.complete) return { stdout:out, stderr:err, code:data.code, mainClass };
    }
    if (typeof options.isCancelled === "function" && options.isCancelled()){
      return { stdout:out, stderr:err, code:-1, cancelled:true, mainClass };
    }
    if (Date.now() - started > limit) return { stdout:out, stderr:err, code:-1, timedOut:true, mainClass };
    await new Promise(resolve => setTimeout(resolve, JAVA_POLL_INTERVAL_MS));
  }
}

// 채점용 1회 실행 — 입력을 파이프로 한 번에 넣고(에코 없음) 끝까지 기다린다.
async function runJavaHeadless(source, stdinText, options){
  options = options || {};
  const id = await startJavaSession(source, stdinText, true, options.libs);
  try { return await pollJavaSessionToEnd(id, options); }
  finally { await stopJavaSession(id); }
}

// ── JDK 가 없을 때의 안내와 원클릭 설치 ─────────────────────────────────────
const JAVA_INSTALL_MAX_POLLS = 2250;      // 800ms × 2250 = 최대 30분(느린 교실 인터넷 여유)
const JAVA_INSTALL_POLL_MS = 800;
// 안내 문구에만 쓴다. 실제로 받는 판은 런처의 JdkFeatureVersion 이 정하므로 둘을 함께 고쳐야 한다.
const JAVA_INSTALL_FEATURE_VERSION = 21;

// 설치 진행 상태를 사람이 읽는 한 줄로. 200MB 를 받는 동안 화면이 멈춘 것처럼 보이면 안 된다.
function javaInstallProgressText(info){
  const mb = (bytes) => Math.round(Number(bytes || 0) / 1048576);
  if (info.state === "metadata") return javaT("설치할 자바를 확인하는 중…");
  if (info.state === "downloading"){
    return info.total > 0
      ? javaTf("자바 내려받는 중… {received} / {total} MB", { received:mb(info.received), total:mb(info.total) })
      : javaT("자바 내려받는 중…");
  }
  if (info.state === "verifying") return javaT("받은 파일 확인 중…");
  if (info.state === "extracting"){
    return info.entries > 0
      ? javaTf("설치 중… {percent}%", { percent:Math.round((Number(info.extracted) / Number(info.entries)) * 100) })
      : javaT("설치 중…");
  }
  return javaT("설치 준비 중…");
}

/* 한 문장으로 끝내면 "그래서 뭘 하라는 거냐"에서 막힌다. 자동 설치와 '다시 검사'를 함께 둔다
   (DB 접속 화면의 파이썬 안내와 같은 구성 — 런처가 '못 찾았다'는 사실까지 캐시하므로
   직접 설치한 뒤에는 '다시 검사'로 캐시를 비워 줘야 exe 를 껐다 켜지 않고 이어갈 수 있다). */
function renderJavaInstallGuide(outPanel, onReady){
  let disposed = false;
  outPanel.innerHTML = "";
  const wrap = document.createElement("section");
  wrap.className = "java-install-help";

  const title = document.createElement("strong");
  title.textContent = "이 컴퓨터에서 자바(JDK)를 찾지 못했습니다";
  const intro = document.createElement("p");
  intro.textContent = "자바 실행에는 PC에 설치된 JDK가 필요합니다. 아래 버튼을 누르면 이 컴퓨터에 한 번만 자동으로 설치합니다.";
  wrap.append(title, intro);

  const steps = document.createElement("ol");
  steps.className = "java-help-steps";
  [
    "'자바 자동 설치'를 누르면 Eclipse Adoptium 공식 배포처에서 약 200MB를 내려받습니다(컴퓨터당 1회, 관리자 권한 불필요).",
    "받은 파일은 배포처가 알려준 검증값과 대조한 뒤 설치하고, 끝나면 하던 실행을 이어갑니다.",
    "이미 JDK를 직접 설치했다면 '다시 검사'만 누르면 됩니다. JRE만 있으면 동작하지 않습니다."
  ].forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    steps.appendChild(li);
  });
  wrap.appendChild(steps);

  const actions = document.createElement("div");
  actions.className = "java-help-actions";
  const install = document.createElement("button");
  install.type = "button"; install.className = "java-help-btn is-primary"; install.textContent = "자바 자동 설치";
  install.title = "Eclipse Adoptium 공식 배포처에서 JDK를 내려받아 자동으로 설치해요 (컴퓨터당 1회)";
  const rescan = document.createElement("button");
  rescan.type = "button"; rescan.className = "java-help-btn"; rescan.textContent = "다시 검사";
  rescan.title = "이미 직접 설치했다면 이것만 누르면 됩니다";
  const note = document.createElement("span");
  note.className = "java-help-note";
  actions.append(install, rescan, note);
  wrap.appendChild(actions);
  outPanel.appendChild(wrap);
  if (typeof window !== "undefined" && window.MNI18N && typeof window.MNI18N.translateTree === "function"){
    window.MNI18N.translateTree(wrap);
  }

  const succeed = (version) => {
    if (disposed) return;
    if (typeof resetJavaBackendProbe === "function") resetJavaBackendProbe();
    note.textContent = version
      ? javaTf("{version} · 준비됐습니다. 이어서 실행합니다…", { version })
      : javaT("준비됐습니다. 이어서 실행합니다…");
    // 찾았으면 한 번 더 누르게 하지 않는다 — 학생이 실행을 누른 그 흐름을 여기서 이어 준다.
    if (typeof onReady === "function") onReady();
  };

  rescan.addEventListener("click", async () => {
    if (disposed) return;
    rescan.disabled = true;
    rescan.textContent = javaT("검사 중…");
    note.textContent = "";
    let info = null;
    try {
      const res = await fetch("/java-rescan", { method:"POST", cache:"no-store" });
      if (res.ok) info = await res.json();
    } catch(_){}
    if (disposed) return;
    rescan.disabled = false;
    rescan.textContent = javaT("다시 검사");
    if (!info || !info.ok){
      if (typeof resetJavaBackendProbe === "function") resetJavaBackendProbe();
      note.textContent = javaT("아직 찾지 못했습니다. JDK(JRE 아님) 설치를 마쳤는지 확인해 주세요.");
      return;
    }
    succeed(info.version);
  });

  install.addEventListener("click", async () => {
    if (disposed) return;
    // 인터넷으로 200MB 를 받는 동작이라 누르기 전에 한 번 확인한다.
    if (typeof confirmDialog === "function"){
      const yes = await confirmDialog(
        javaTf("Eclipse Adoptium 공식 배포처에서 자바(JDK {version})를 약 200MB 내려받아 설치합니다.\n이 컴퓨터에서 한 번만 하면 되고, 관리자 권한은 필요하지 않습니다.",
          { version:JAVA_INSTALL_FEATURE_VERSION }),
        javaT("설치"), javaT("취소"));
      if (!yes) return;
    }
    install.disabled = true; rescan.disabled = true;
    note.textContent = javaT("설치 준비 중…");
    try {
      const start = await fetch("/java-install", { method:"POST" });
      if (!start.ok) throw new Error((await start.text()) || ("HTTP " + start.status));
      if ((await start.text()).trim() === "already"){ succeed(""); return; }
      for (let i = 0; i < JAVA_INSTALL_MAX_POLLS; i++){
        await new Promise(resolve => setTimeout(resolve, JAVA_INSTALL_POLL_MS));
        if (disposed) return;
        const res = await fetch("/java-install-status", { cache:"no-store" });
        if (!res.ok) continue;
        const info = await res.json();
        if (info.state === "done"){ succeed(info.version); return; }
        if (info.state === "error") throw new Error(info.error || javaT("설치에 실패했습니다."));
        note.textContent = javaInstallProgressText(info);
      }
      throw new Error(javaT("시간이 너무 오래 걸립니다 — 인터넷 상태를 확인해 주세요."));
    } catch(error){
      if (disposed) return;
      install.disabled = false; rescan.disabled = false;
      note.textContent = javaTf("자동 설치에 실패했어요 ({message}). 인터넷이 안 되는 컴퓨터라면 다른 곳에서 JDK를 받아 풀어 두고 '다시 검사'를 눌러도 됩니다.",
        { message:(error && error.message) || error });
    }
  });
  wrap.dispose = () => { disposed = true; };
  return wrap;
}

// ── 대화형 실행 화면 ───────────────────────────────────────────────────────
async function runJavaInteractive(source, ui, hooks){
  hooks = hooks || {};
  const { outPanel } = ui;
  const sessionId = await startJavaSession(source, "", false, hooks.libs);
  if (typeof hooks.isCancelled === "function" && hooks.isCancelled()){
    await stopJavaSession(sessionId);
    return { code:-1, stdout:"", stderr:"", mainClass:"", cancelled:true, sessionId };
  }

  outPanel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head";
  const headLabel = document.createElement("span"); headLabel.textContent = "실행 결과 · 대화형 터미널";
  head.appendChild(headLabel);
  const pre = document.createElement("pre"); pre.className = "out-pre";
  const stdoutEl = document.createElement("span");
  const stderrEl = document.createElement("span");
  pre.append(stdoutEl, stderrEl);
  const row = document.createElement("div"); row.className = "terminal-input-row";
  const mark = document.createElement("span"); mark.className = "terminal-mark"; mark.textContent = "›";
  const input = document.createElement("input"); input.className = "terminal-input"; input.type = "text";
  input.placeholder = "값을 입력하고 Enter"; input.autocomplete = "off"; input.spellcheck = false;
  const eof = document.createElement("button"); eof.className = "terminal-eof"; eof.type = "button"; eof.textContent = "입력 끝";
  eof.title = "표준입력을 닫습니다. hasNext() 로 끝까지 읽는 코드를 멈출 때 쓰세요";
  const stop = document.createElement("button"); stop.className = "terminal-stop"; stop.type = "button"; stop.textContent = "중지";
  const rerun = document.createElement("button"); rerun.className = "terminal-rerun"; rerun.type = "button";
  rerun.textContent = "↻ 재실행"; rerun.title = "이 코드를 다시 실행";
  row.append(mark, input, eof, stop, rerun);
  outPanel.append(head, pre, row);
  if (typeof window !== "undefined" && window.MNI18N && typeof window.MNI18N.translateTree === "function"){
    window.MNI18N.translateTree(outPanel);
  }

  let stopping = false;
  const finish = async () => {
    if (stopping) return;
    stopping = true; input.disabled = true; eof.disabled = true; stop.disabled = true;
    await stopJavaSession(sessionId);
  };
  if (typeof hooks.bindCancel === "function") hooks.bindCancel(finish);
  stop.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else finish();
  });
  eof.addEventListener("click", async () => {
    eof.disabled = true;
    try { await fetch("/java-session-eof?id=" + encodeURIComponent(sessionId), { method:"POST" }); } catch(_){}
  });
  // 재실행: 진행 중이면 먼저 멈추고, 현재 실행 정리가 끝나면 다시 실행(파이썬 터미널과 같은 동작)
  rerun.addEventListener("click", async () => {
    if (rerun.disabled) return;
    rerun.disabled = true;
    await finish();
    await new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!ui.running || Date.now() - started > 3000){ clearInterval(timer); resolve(); }
      }, 30);
    });
    if (typeof ui.rerun === "function") ui.rerun();
  });
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const value = input.value; input.value = ""; input.disabled = true;
    try {
      const res = await fetch("/java-session-input?id=" + encodeURIComponent(sessionId), {
        method:"POST", headers:{ "Content-Type":"text/plain; charset=utf-8" }, body:value
      });
      if (!res.ok) throw new Error(await res.text());
    } catch(err){
      if (typeof toast === "function") toast(javaTf("입력을 전달하지 못했어요: {message}", { message:(err && err.message) || err }), 3000);
    } finally {
      if (!stopping){ input.disabled = false; input.focus(); }
    }
  });
  // 입력을 읽는 코드는 바로 값을 칠 수 있게 터미널로, 아니면 편집을 이어가게 편집기로 포커스를 둔다.
  const needsInput = javaUsesInput(source);
  setTimeout(() => {
    if (ui.keepEditorFocus && ui.editorTa && !needsInput) ui.editorTa.focus();
    else input.focus();
  }, 0);

  // 표시 텍스트는 상한까지만 자른다. seg.src 는 조각이 원본 어디서 왔는지(음수면 생략 안내 문구) —
  // 입력 에코 구간만 다른 색으로 칠하려면 잘린 화면 조각의 원본 오프셋을 알아야 한다.
  const displaySegs = (text) => text.length > JAVA_FINAL_HEAD + JAVA_FINAL_TAIL + 200
    ? [{ text: text.slice(0, JAVA_FINAL_HEAD), src: 0 },
       { text: "\n\n" + javaTf("…(출력이 {length}자로 길어 중간을 생략했어요)…", { length:text.length.toLocaleString() }) + "\n\n", src: -1 },
       { text: text.slice(-JAVA_FINAL_TAIL), src: text.length - JAVA_FINAL_TAIL }]
    : [{ text, src: 0 }];
  const liveSegs = (text) => text.length > JAVA_LIVE_TAIL
    ? [{ text: javaT("…(출력이 길어 마지막 부분만 표시 중 — 전체는 실행이 끝나면 표시)") + "\n", src: -1 },
       { text: text.slice(-JAVA_LIVE_TAIL), src: text.length - JAVA_LIVE_TAIL }]
    : [{ text, src: 0 }];

  let shownOut = null, shownErr = null;
  let fullOut = "", fullErr = "";
  let knownOutLen = -1, knownErrLen = -1;
  let echoRanges = [];
  let mainClass = "";
  let result = { code: -1, stdout: "", stderr: "", mainClass: "" };
  try {
    for (;;){
      const res = await fetch("/java-session-poll?id=" + encodeURIComponent(sessionId)
        + "&so=" + knownOutLen + "&se=" + knownErrLen, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
      const data = await res.json();
      if (!data.unchanged){
        if (typeof data.stdoutDelta === "string" || typeof data.stderrDelta === "string"){
          fullOut += data.stdoutDelta || "";
          fullErr += data.stderrDelta || "";
        } else {
          fullOut = data.stdout || "";
          fullErr = data.stderr || "";
        }
        knownOutLen = fullOut.length;
        knownErrLen = fullErr.length;
        if (Array.isArray(data.echoes)) echoRanges = data.echoes;
        if (data.mainClass) mainClass = data.mainClass;
        const outSegs = (data.complete ? displaySegs : liveSegs)(fullOut);
        const nextOut = outSegs.map(seg => seg.text).join("");
        const shownStderr = cleanJavaStderr(fullErr);
        const errSegs = (data.complete ? displaySegs : liveSegs)(shownStderr);
        const nextErr = shownStderr ? ((fullOut ? "\n" : "") + errSegs.map(seg => seg.text).join("")) : "";
        if (nextOut !== shownOut || nextErr !== shownErr){
          // 사용자가 위로 스크롤해 둔 동안에는 자동 스크롤을 멈추고, 바닥 근처일 때만 따라 내려간다
          const nearBottom = outPanel.scrollHeight - outPanel.scrollTop - outPanel.clientHeight < 40;
          if (nextOut !== shownOut){
            shownOut = nextOut;
            if (typeof renderPythonStdoutSegs === "function") renderPythonStdoutSegs(stdoutEl, outSegs, echoRanges);
            else stdoutEl.textContent = nextOut;
          }
          if (nextErr !== shownErr){ shownErr = nextErr; stderrEl.textContent = nextErr; }
          // 자바는 stderr 에 경고를 흘리는 일이 드물다 — 내용이 있으면 오류로 보고 붉게 표시한다.
          stderrEl.className = shownStderr ? "out-err" : "";
          if (nearBottom) outPanel.scrollTop = outPanel.scrollHeight;
        }
        if (data.complete){
          result = { code: data.code, stdout: fullOut, stderr: fullErr, mainClass };
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, JAVA_POLL_INTERVAL_MS));
    }
  } finally {
    if (typeof hooks.bindCancel === "function") hooks.bindCancel(null);
    stopping = true;
    input.disabled = true; input.placeholder = javaT("실행 종료");
    eof.disabled = true; stop.disabled = true;
    await stopJavaSession(sessionId);
  }
  if (!result.stdout && !cleanJavaStderr(result.stderr)){
    pre.classList.add("out-muted");
    pre.textContent = javaT("(출력 없음)");
  }
  headLabel.textContent = javaTf("실행 결과 · 종료 코드 {code}", { code:result.code });
  result.sessionId = sessionId;
  return result;
}

// ── 채점 ───────────────────────────────────────────────────────────────────
async function runJavaGrading(source, tests, hooks){
  hooks = hooks || {};
  const cases = normalizeAssignmentTests(tests);
  const results = [];
  for (let index = 0; index < cases.length; index++){
    if (typeof hooks.isCancelled === "function" && hooks.isCancelled()) break;
    if (typeof hooks.onProgress === "function") hooks.onProgress(index, cases.length);
    let raw;
    try {
      // 채점도 실행과 같은 라이브러리로 돌려야 한다 — 여기서 빠지면 편집기에서만 되는 코드가 된다.
      raw = await runJavaHeadless(source, javaGradingStdin(cases[index].input), {
        isCancelled: hooks.isCancelled,
        libs: hooks.libs
      });
    } catch(error){
      raw = { stdout:"", stderr:String((error && error.message) || error), code:-1 };
    }
    results.push(javaGradingRow(cases[index], index, raw));
  }
  return { results };
}

// 파이프로 넣을 표준입력 — 마지막 줄에도 개행이 있어야 Scanner 의 nextLine() 이 값을 받는다.
function javaGradingStdin(input){
  const text = String(input == null ? "" : input).replace(/\r\n?/g, "\n");
  if (!text) return "";
  return text.endsWith("\n") ? text : text + "\n";
}

// 실행 결과 하나를 채점 보고서의 한 줄로 바꾼다(파이썬·자바스크립트 채점과 같은 판정 순서).
function javaGradingRow(test, index, raw){
  raw = raw || {};
  const actual = String(raw.stdout || "");
  const stderr = cleanJavaStderr(raw.stderr);
  let error = "";
  if (raw.timedOut) error = javaTf("⏱ {seconds}초가 넘도록 끝나지 않았어요. 끝나지 않는 반복이 없는지 확인해 주세요.",
    { seconds:Math.round(JAVA_GRADE_TIMEOUT_MS / 1000) });
  else if (raw.cancelled) error = javaT("채점을 중지했습니다.");
  else if (stderr) error = stderr;
  else if (Number(raw.code) !== 0) error = javaTf("프로그램이 비정상 종료되었습니다 (종료 코드 {code}).", { code:Number(raw.code) });
  const expected = String(test.expected || "");
  return {
    name: test.name || javaTf("테스트 {index}", { index:index + 1 }),
    input: String(test.input || ""),
    expected,
    actual,
    error,
    passed: !error && normalizeGradingOutput(actual) === normalizeGradingOutput(expected)
  };
}

// ── 진입점 ─────────────────────────────────────────────────────────────────
async function runJavaSource(src, ui, options){
  options = options || {};
  if (ui.running) return;
  const { btn, status, outPanel, split } = ui;
  const source = String(src == null ? "" : src);
  const gradeTests = normalizeAssignmentTests(options.gradeTests);
  const grading = gradeTests.length > 0;
  const libs = String(options.libs || "");   // 실행·채점 두 길에 같은 목록이 들어간다
  ui.running = true;
  let cancelled = false, cancelSession = null;
  const idleTitle = btn.title;
  const setStatus = (message) => { if (status) status.textContent = javaT(message); };
  if (typeof ui.disposeInstallGuide === "function") ui.disposeInstallGuide();
  ui.disposeInstallGuide = null;
  ui.cancelRun = () => {
    if (cancelled) return;
    cancelled = true;
    setStatus("중지하는 중…");
    if (cancelSession) cancelSession();
  };
  btn.textContent = "■";
  btn.title = javaT("현재 실행 중지");
  btn.setAttribute("aria-label", btn.title);
  btn.classList.add("is-running");
  if (ui.gradeBtn) ui.gradeBtn.disabled = true;
  split.classList.add("show-out");
  if (ui.clearError) ui.clearError();
  setStatus(grading ? "채점 중…" : "실행 중…");
  try {
    if (!(await javaBackendAvailable())){
      // 여기서 끝내지 않고, 안내 화면의 '다시 검사'가 성공하면 방금 누른 실행을 그대로 이어 준다.
      const guide = renderJavaInstallGuide(outPanel, () => {
        if ((!ui.isDisposed || !ui.isDisposed()) && typeof ui.rerun === "function") ui.rerun();
      });
      ui.disposeInstallGuide = () => guide.dispose();
      setStatus("자바(JDK) 설치 필요");
      return;
    }
    if (grading){
      outPanel.innerHTML = '<div class="out-head">' + javaT("과제 자동채점")
        + '</div><pre class="out-pre out-muted">' + javaT("테스트 실행 중…") + '</pre>';
      const report = await runJavaGrading(source, gradeTests, {
        isCancelled: () => cancelled,
        libs,
        onProgress: (index, total) => { if (status) status.textContent = javaTf("채점 중… {index}/{total}", { index:index + 1, total }); }
      });
      renderAssignmentGradingResult(outPanel, report, assignmentGradingErrorText(report, gradeTests), gradeTests);
      return;
    }
    const result = await runJavaInteractive(source, ui, {
      bindCancel: (fn) => { cancelSession = fn; },
      isCancelled: () => cancelled,
      libs
    });
    const line = javaErrorLine(result.stderr, result.mainClass);
    if (line && ui.markError) ui.markError(line);
  } catch(error){
    if (error && error.noJava){
      const guide = renderJavaInstallGuide(outPanel, () => {
        if ((!ui.isDisposed || !ui.isDisposed()) && typeof ui.rerun === "function") ui.rerun();
      });
      ui.disposeInstallGuide = () => guide.dispose();
      setStatus("자바(JDK) 설치 필요");
      return;
    }
    outPanel.innerHTML = "";
    const head = document.createElement("div"); head.className = "out-head"; head.textContent = javaT("실행 실패");
    const pre = document.createElement("pre"); pre.className = "out-pre out-err";
    pre.textContent = String((error && error.message) || error);
    outPanel.append(head, pre);
  } finally {
    ui.running = false;
    ui.cancelRun = null;
    cancelSession = null;
    btn.textContent = "▶";
    btn.title = idleTitle;
    btn.setAttribute("aria-label", idleTitle);
    btn.classList.remove("is-running");
    if (ui.gradeBtn) ui.gradeBtn.disabled = false;
    setStatus("");
    if (options.keepEditorFocus === true && ui.editorTa && !javaUsesInput(source)){
      ui.editorTa.focus({ preventScroll:true });
    }
  }
}
