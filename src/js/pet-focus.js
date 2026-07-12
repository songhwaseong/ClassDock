"use strict";

/* ===== 픽셀 펫 집중 모드·생활 리듬 =====
   집중 세션은 localStorage 에 저장해 앱을 다시 열어도 이어지고, 집중이 끝나면 자동으로 휴식으로 넘어간다.
   실제 글 입력 중에는 별도 타이머를 시작하지 않고 펫만 잠시 화면 가장자리에서 조용히 기다린다. */
const PET_FOCUS_SESSION_KEY = "mn.petFocusSession";
const PET_FOCUS_STATS_KEY = "mn.petFocusStats";
let petFocusState = { phase:"idle", running:false, endAt:0, remainingMs:0, totalMs:0 };
let petFocusTimer = 0;
let petFocusWired = false;

function petFocusEl(id){ return document.getElementById(id); }
function petFocusSettings(){
  return typeof normalizePetFocus === "function"
    ? normalizePetFocus(appSettings && appSettings.petFocus)
    : { enabled:true, focusMin:25, breakMin:5, quietTyping:true };
}
function petFocusDayKey(date){
  const d = date || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function petFocusStatsLoad(){
  const today = petFocusDayKey();
  try {
    const value = JSON.parse(localStorage.getItem(PET_FOCUS_STATS_KEY) || "null");
    if (value && value.date === today) return { date:today, cycles:Math.max(0, Number(value.cycles) || 0) };
  } catch(_){}
  return { date:today, cycles:0 };
}
function petFocusStatsIncrement(){
  const stats = petFocusStatsLoad();
  stats.cycles++;
  try { localStorage.setItem(PET_FOCUS_STATS_KEY, JSON.stringify(stats)); } catch(_){}
  return stats;
}
function petFocusSave(){
  try { localStorage.setItem(PET_FOCUS_SESSION_KEY, JSON.stringify(petFocusState)); } catch(_){}
}
function petFocusRemaining(){
  if (petFocusState.phase === "idle") return petFocusSettings().focusMin * 60000;
  return petFocusState.running ? Math.max(0, petFocusState.endAt - Date.now()) : Math.max(0, petFocusState.remainingMs);
}
function petFocusFormat(ms){
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}
function petFocusLoad(){
  try {
    const value = JSON.parse(localStorage.getItem(PET_FOCUS_SESSION_KEY) || "null");
    if (!value || !["idle", "focus", "break"].includes(value.phase)) return;
    petFocusState = {
      phase:value.phase,
      running:!!value.running,
      endAt:Math.max(0, Number(value.endAt) || 0),
      remainingMs:Math.max(0, Number(value.remainingMs) || 0),
      totalMs:Math.max(0, Number(value.totalMs) || 0)
    };
  } catch(_){}
}
function petFocusSetIdle(){
  petFocusState = { phase:"idle", running:false, endAt:0, remainingMs:0, totalMs:0 };
  petFocusSave();
  if (typeof petSetRhythm === "function") petSetRhythm("normal");
}
function petFocusRestoreElapsed(){
  if (!petFocusState.running || !petFocusState.endAt || petFocusState.endAt > Date.now()) return;
  const settings = petFocusSettings(), now = Date.now();
  if (petFocusState.phase === "focus"){
    petFocusStatsIncrement();
    const breakMs = settings.breakMin * 60000, breakEnd = petFocusState.endAt + breakMs;
    if (now < breakEnd){
      petFocusState = { phase:"break", running:true, endAt:breakEnd, remainingMs:breakEnd - now, totalMs:breakMs };
      petFocusSave();
    } else petFocusSetIdle();
  } else petFocusSetIdle();
}
function petFocusRenderEnglish(settings, phase, progress, time, open, openText, phaseEl, timeEl, message, bar, progressEl, start, pause, stop){
  const running = !!petFocusState.running;
  openText.textContent = phase === "focus" ? (running ? "Focus " + time : "Focus paused")
    : phase === "break" ? (running ? "Break " + time : "Break paused") : "Focus";
  open.setAttribute("aria-label", phase === "idle" ? "Open pixel pet focus mode" : openText.textContent);
  phaseEl.textContent = phase === "focus" ? (running ? "Focusing" : "Focus paused")
    : phase === "break" ? (running ? "On break" : "Break paused") : "Ready to focus";
  timeEl.textContent = time;
  bar.style.width = progress + "%";
  progressEl.setAttribute("aria-valuenow", String(Math.round(progress)));
  progressEl.setAttribute("aria-label", phase === "break" ? "Break progress" : "Focus progress");
  message.textContent = phase === "focus" ? (running
    ? "Your pets are resting quietly at the edge while you focus."
    : "The timer and pets are paused. Continue when you're ready.")
    : phase === "break" ? (running
      ? "Stand up and gently stretch your shoulders and wrists."
      : "Your break is paused for a moment.")
      : "Focus for " + settings.focusMin + " min, then take a " + settings.breakMin + " min break.";
  start.hidden = running;
  start.textContent = phase === "idle" ? "Start focus" : "Resume";
  pause.hidden = !running;
  stop.hidden = phase === "idle";
  stop.textContent = phase === "break" ? "End break" : "Stop";
  const stats = petFocusStatsLoad();
  petFocusEl("petFocusStats").textContent = "Focus cycles today: " + stats.cycles;
}

function petFocusUpdateUi(){
  const settings = petFocusSettings(), phase = petFocusState.phase;
  const remaining = petFocusRemaining();
  const total = phase === "idle" ? settings.focusMin * 60000 : Math.max(1, petFocusState.totalMs || remaining);
  const progress = phase === "idle" ? 0 : Math.max(0, Math.min(100, (1 - remaining / total) * 100));
  const time = petFocusFormat(remaining);
  const open = petFocusEl("petFocusOpen"), openText = petFocusEl("petFocusOpenText"), panel = petFocusEl("petFocusPanel");
  const phaseEl = petFocusEl("petFocusPhase"), timeEl = petFocusEl("petFocusTime"), message = petFocusEl("petFocusMessage");
  const bar = petFocusEl("petFocusProgressBar"), progressEl = petFocusEl("petFocusProgress");
  const start = petFocusEl("petFocusStart"), pause = petFocusEl("petFocusPause"), stop = petFocusEl("petFocusStop");
  if (!open || !panel) return;

  open.classList.toggle("active", phase === "focus" && petFocusState.running);
  open.classList.toggle("break", phase === "break" && petFocusState.running);
  open.classList.toggle("paused", phase !== "idle" && !petFocusState.running);
  panel.classList.toggle("break", phase === "break");
  if (typeof petUsesEnglish === "function" && petUsesEnglish()){
    petFocusRenderEnglish(settings, phase, progress, time, open, openText, phaseEl, timeEl, message, bar, progressEl, start, pause, stop);
    return;
  }
  openText.textContent = phase === "focus" ? (petFocusState.running ? "집중 " + time : "집중 일시정지")
    : phase === "break" ? (petFocusState.running ? "휴식 " + time : "휴식 일시정지") : "집중";
  open.setAttribute("aria-label", phase === "idle" ? "픽셀 펫 집중 모드 열기" : openText.textContent);
  phaseEl.textContent = phase === "focus" ? (petFocusState.running ? "집중 중" : "집중 일시정지")
    : phase === "break" ? (petFocusState.running ? "휴식 중" : "휴식 일시정지") : "집중 준비";
  timeEl.textContent = time;
  bar.style.width = progress + "%";
  progressEl.setAttribute("aria-valuenow", String(Math.round(progress)));
  progressEl.setAttribute("aria-label", phase === "break" ? "휴식 시간 진행률" : "집중 시간 진행률");
  message.textContent = phase === "focus" ? (petFocusState.running
    ? "펫들이 가장자리에서 조용히 쉬며 함께 집중하고 있어요."
    : "타이머와 펫이 잠시 멈췄어요. 준비되면 계속하세요.")
    : phase === "break" ? (petFocusState.running
      ? "자리에서 일어나 어깨와 손목을 가볍게 풀어 보세요."
      : "휴식 시간이 잠시 멈춰 있어요.")
      : settings.focusMin + "분 집중 후 " + settings.breakMin + "분 쉬는 리듬입니다.";
  start.hidden = petFocusState.running;
  start.textContent = phase === "idle" ? "집중 시작" : "계속";
  pause.hidden = !petFocusState.running;
  stop.hidden = phase === "idle";
  stop.textContent = phase === "break" ? "휴식 끝내기" : "종료";
  const stats = petFocusStatsLoad();
  petFocusEl("petFocusStats").textContent = "오늘 집중 완료 " + stats.cycles + "회";
}
function petFocusStartOrResume(){
  const settings = petFocusSettings();
  if (petFocusState.phase === "idle"){
    const total = settings.focusMin * 60000;
    petFocusState = { phase:"focus", running:true, endAt:Date.now() + total, remainingMs:total, totalMs:total };
  } else {
    const remaining = Math.max(1000, petFocusState.remainingMs || petFocusRemaining());
    petFocusState.running = true; petFocusState.endAt = Date.now() + remaining; petFocusState.remainingMs = remaining;
  }
  petFocusSave();
  if (typeof petSetRhythm === "function") petSetRhythm(petFocusState.phase);
  petFocusUpdateUi();
}
function petFocusPause(){
  if (!petFocusState.running || petFocusState.phase === "idle") return;
  petFocusState.remainingMs = petFocusRemaining();
  petFocusState.running = false; petFocusState.endAt = 0;
  petFocusSave();
  if (typeof petSetRhythm === "function") petSetRhythm("normal");
  petFocusUpdateUi();
}
function petFocusStop(showMessage){
  const wasActive = petFocusState.phase !== "idle";
  petFocusSetIdle(); petFocusUpdateUi();
  if (showMessage !== false && wasActive && typeof petUsesEnglish === "function" && petUsesEnglish() && typeof toast === "function"){ toast("Ended focus mode.", 1800); return; }
  if (showMessage !== false && wasActive && typeof toast === "function") toast("집중 모드를 종료했어요.", 1800);
}
function petFocusFinishFocus(){
  const settings = petFocusSettings(), total = settings.breakMin * 60000;
  petFocusStatsIncrement();
  petFocusState = { phase:"break", running:true, endAt:Date.now() + total, remainingMs:total, totalMs:total };
  petFocusSave();
  if (typeof petSetRhythm === "function") petSetRhythm("break");
  if (typeof petUsesEnglish === "function" && petUsesEnglish() && typeof toast === "function"){ toast("Focus complete! Take a " + settings.breakMin + " min break and stretch.", 5200, { type:"success" }); return; }
  if (typeof toast === "function") toast("집중 완료! 이제 " + settings.breakMin + "분 동안 몸을 풀어 보세요.", 5200, { type:"success" });
}
function petFocusFinishBreak(){
  petFocusSetIdle();
  if (typeof petUsesEnglish === "function" && petUsesEnglish() && typeof toast === "function"){ toast("Break's over. Start your next focus when ready.", 4800); return; }
  if (typeof toast === "function") toast("휴식이 끝났어요. 준비되면 다음 집중을 시작하세요.", 4800);
}
function petFocusTick(){
  if (petFocusState.running && petFocusState.endAt <= Date.now()){
    if (petFocusState.phase === "focus") petFocusFinishFocus();
    else if (petFocusState.phase === "break") petFocusFinishBreak();
  }
  petFocusUpdateUi();
}
function petFocusIsTypingTarget(target){
  if (!target || !target.closest) return false;
  const el = target.closest("textarea,[contenteditable='true'],input");
  if (!el || el.disabled || el.readOnly) return false;
  if (el.tagName !== "INPUT") return true;
  return !["button", "checkbox", "radio", "range", "file", "color", "date", "time"].includes(String(el.type || "text").toLowerCase());
}
function petFocusTypingInput(event){
  const settings = petFocusSettings();
  if (!settings.quietTyping || petFocusState.phase === "break" || !petFocusIsTypingTarget(event.target)) return;
  if (typeof petTypingPulse === "function") petTypingPulse();
}
function petFocusSetPanel(open){
  const panel = petFocusEl("petFocusPanel"), button = petFocusEl("petFocusOpen");
  if (!panel || !button) return;
  panel.hidden = !open; button.setAttribute("aria-expanded", String(open));
  if (open) petFocusUpdateUi();
}
function applyPetFocusSettings(){
  const settings = petFocusSettings();
  const available = !!(appSettings && appSettings.petEnabled && settings.enabled);
  const wrap = petFocusEl("petFocusWrap");
  if (wrap) wrap.hidden = !available;
  if (!available){
    petFocusSetPanel(false);
    if (petFocusState.phase !== "idle") petFocusStop(false);
    else if (typeof petSetRhythm === "function") petSetRhythm("normal");
  } else if (typeof petSetRhythm === "function"){
    petSetRhythm(petFocusState.running ? petFocusState.phase : "normal");
  }
  petFocusUpdateUi();
}
function initPetFocus(){
  if (petFocusWired) return;
  petFocusWired = true;
  window.addEventListener("mni18nchange", () => petFocusUpdateUi());
  petFocusLoad(); petFocusRestoreElapsed();
  const open = petFocusEl("petFocusOpen"), panel = petFocusEl("petFocusPanel");
  if (!open || !panel) return;
  open.addEventListener("click", (event) => { event.stopPropagation(); petFocusSetPanel(panel.hidden); });
  panel.addEventListener("click", (event) => event.stopPropagation());
  petFocusEl("petFocusClose").addEventListener("click", () => petFocusSetPanel(false));
  petFocusEl("petFocusStart").addEventListener("click", petFocusStartOrResume);
  petFocusEl("petFocusPause").addEventListener("click", petFocusPause);
  petFocusEl("petFocusStop").addEventListener("click", () => petFocusStop(true));
  document.addEventListener("click", () => petFocusSetPanel(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) petFocusSetPanel(false); });
  document.addEventListener("beforeinput", petFocusTypingInput, true);
  document.addEventListener("visibilitychange", petFocusTick);
  petFocusTimer = setInterval(petFocusTick, 500);
  applyPetFocusSettings();
}
