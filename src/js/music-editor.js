"use strict";

/* ===== .msheet 악보 문서 — 화면·편집 (P1 보기 + P2 편집) =====
   - 열기·저장, VexFlow 조판, 도구상자로 음표 넣고 지우기, 음표 클릭 미리듣기,
     전체·부분 재생, WAV 저장, 되돌리기를 담당한다.
   - 조판은 VexFlow 에 맡기고(꼬리 잇기·간격 배분), 소리는 MNMusicAudio,
     음악 규칙(틱·음높이·오선 자리)은 music-model.js 가 갖는다. 여기는 화면과 조작만 안다.
   - VexFlow(약 710KB)는 시작할 때 싣지 않고 이 문서를 열 때 MNLazy 로 처음 불러온다.
   설계: docs/악보-설계.md */

const MUSIC_LINE_HEIGHT = 145;      // 오선 아래 계이름 전용 줄과 덧줄 음표가 다음 단과 겹치지 않을 간격
const MUSIC_SCORE_MIN_WIDTH = 480;
const MUSIC_REDRAW_DELAY = 180;     // 창 크기 변경 뒤 다시 그리기까지(매 픽셀마다 재조판하면 무겁다)
const MUSIC_ZOOM_MIN = 0.5;
const MUSIC_ZOOM_MAX = 2;
const MUSIC_ZOOM_STEP = 0.1;
const MUSIC_TIME_CHOICES = ["2/4", "3/4", "4/4", "6/8"];
const MUSIC_TYPING_DELAY = 600;     // 제목 타자를 한 단계로 묶는 시간
const MUSIC_HISTORY_LIMIT = 200;    // 악보 JSON 은 가벼워서 깊게 쌓아도 된다
const MUSIC_TOOL_VALUES = [
  { value:"whole",   label:"온" },
  { value:"half",    label:"2분" },
  { value:"quarter", label:"4분" },
  { value:"eighth",  label:"8분" },
  { value:"16th",    label:"16분" }
];
const MUSIC_SOLFEGE_LABELS = { C:"도", D:"레", E:"미", F:"파", G:"솔", A:"라", B:"시" };
let _musicScratchCount = 0;

/* ===== 열기 ===== */
async function loadMusicSheet(file, opts = {}){
  let sheet;
  try {
    sheet = musicParse(await file.text());
  } catch(error){
    if (typeof toast === "function") toast("악보(.msheet)를 읽지 못해 텍스트로 열었어요.", 3500);
    return typeof loadText === "function" ? loadText(file, opts) : null;
  }
  const doc = makeDoc("music", file.name, opts);
  doc.sheet = sheet;
  doc.sourceFile = file;
  doc.savedText = musicSerialize(sheet);
  doc.render = async () => {
    if (doc._musicMounted) return;              // 편집·재생 상태를 잃지 않도록 한 번만 마운트
    doc.el.innerHTML = "";
    await mountMusicEditor(doc);
    doc._musicMounted = true;
  };
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

/* ===== 새 문서 만들기 ===== */
function newMusicScratch(){
  _musicScratchCount++;
  const name = musicScratchFileName(_musicScratchCount);
  const starter = musicSerialize(musicEmpty(name.replace(/\.msheet$/i, "")));
  if (typeof handleFiles === "function"){
    handleFiles([new File([starter], name, { type:"application/json" })], { isScratch:true });
  }
}
function newMusicScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, musicScratchFileName,
    (name) => musicSerialize(musicEmpty(name.replace(/\.msheet$/i, ""))),
    "application/json", "새 악보를");
}

/* ===== 저장 ===== */
async function saveMusicSheet(doc){
  if (!doc || !doc.sheet) return false;
  const previousUpdatedAt = doc.sheet.updatedAt;
  doc.sheet.updatedAt = Date.now();
  const json = musicSerialize(doc.sheet);
  const ok = (typeof saveTextDoc === "function") ? await saveTextDoc(json, doc, doc.name) : false;
  if (ok){
    doc.savedText = json;
    // updatedAt 도 스냅샷에 들어가므로 저장 성공 시 현재 이력의 기준점도 같은 JSON 으로 맞춘다.
    // 그래야 저장 → 편집 → 되돌리기 뒤 사용자 내용이 저장본과 같으면 다시 깨끗한 상태가 된다.
    if (doc._musicHistory && typeof doc._musicHistory.replaceCurrent === "function"){
      doc._musicHistory.replaceCurrent(json);
    }
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  } else {
    // 취소·실패한 저장이 메타데이터만 몰래 바꾸지 않게 원래 시각을 복원한다.
    doc.sheet.updatedAt = previousUpdatedAt;
  }
  return ok;
}

function musicExportName(doc, ext){
  const base = String((doc && doc.name) || (doc && doc.sheet && doc.sheet.title) || "악보")
    .replace(/\.msheet$/i, "");
  return base + "." + ext;
}

function musicDownloadBlob(name, blob){
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch(_){
    if (typeof toast === "function") toast("저장에 실패했어요.", 2400, { type:"error" });
    return false;
  }
}

function musicButton(label, title, className){
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "music-btn";
  button.textContent = label;
  if (title) button.title = title;
  return button;
}

/* ===== 편집기 ===== */
async function mountMusicEditor(doc){
  const sheet = doc.sheet;
  const root = document.createElement("div");
  root.className = "music-doc";
  doc.el.appendChild(root);

  const noteEls = new Map();        // 음표 id → SVG 요소(강조·클릭용)
  const solfegeEls = new Map();     // 음표 id → 오선 밖 계이름 SVG 글자
  const noteHorizontalLimits = new Map(); // 음표 id → 현재 조판에서 이웃·마디를 넘지 않는 xOffset 범위
  let staveBoxes = [];              // 마디별 조판 좌표 — 오선 클릭을 마디·음높이로 옮길 때 쓴다
  let selection = null;             // { measure:0부터, id }
  let redrawTimer = 0;
  let vexReady = false;
  let history = null;
  let scoreZoom = 1;                // 보기 상태라 .msheet·되돌리기에는 넣지 않는다
  let scorePan = null;              // 확대된 악보 여백을 손바닥으로 끌 때의 시작 좌표·스크롤
  let suppressScoreClick = false;   // 드래그를 끝낼 때 생기는 click 이 음표를 넣지 못하게 막는다
  let pitchGuideEl = null;          // 오선 위·아래의 보이지 않는 음높이를 보여주는 가상 덧줄
  let noteDrag = null;              // 좌우 위치 또는 위아래 음높이 조정 중인 음표와 드래그 시작 좌표
  let contextLayers = [];           // 악보 우클릭 메뉴와 열린 하위 메뉴
  let contextOutside = null;
  let contextKeydown = null;
  let contextResize = null;
  let contextSubTimer = null;

  // 도구상자 상태. accidental 은 "다음에 넣을 음표 하나"에만 붙는다(임시표는 일회성이 자연스럽다).
  // null 은 임시표 미선택, 0 은 사용자가 고른 제자리표다. 둘을 나눠야 새 음표가 현재 조표를 따른다.
  const tool = { value:"quarter", dots:0, rest:false, accidental:null, eraser:false, position:false };

  const touch = () => {
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, musicSerialize(sheet) !== doc.savedText);
  };

  /* ----- 상단 바 ----- */
  const bar = document.createElement("div");
  bar.className = "music-bar";

  const titleInput = document.createElement("input");
  titleInput.className = "music-title";
  titleInput.type = "text";
  titleInput.value = sheet.title || "";
  titleInput.placeholder = "악보 제목";
  titleInput.setAttribute("aria-label", "악보 제목");
  titleInput.addEventListener("input", () => {
    sheet.title = titleInput.value;
    touch();
    if (history) history.commitSoon(MUSIC_TYPING_DELAY);
  });

  const tempoWrap = document.createElement("label");
  tempoWrap.className = "music-field";
  tempoWrap.append("♩=");
  const tempoInput = document.createElement("input");
  tempoInput.type = "number";
  tempoInput.className = "music-tempo";
  tempoInput.min = String(MUSIC_TEMPO_MIN);
  tempoInput.max = String(MUSIC_TEMPO_MAX);
  tempoInput.value = String(sheet.tempo);
  tempoInput.addEventListener("change", () => {
    sheet.tempo = Math.max(MUSIC_TEMPO_MIN, Math.min(MUSIC_TEMPO_MAX, Number(tempoInput.value) || MUSIC_DEFAULT_TEMPO));
    tempoInput.value = String(sheet.tempo);
    touch();
    updateStatus();
    if (history) history.commit();
  });
  tempoWrap.appendChild(tempoInput);

  const timbreWrap = document.createElement("label");
  timbreWrap.className = "music-field";
  timbreWrap.append("음색");
  const timbreSelect = document.createElement("select");
  timbreSelect.className = "music-timbre";
  const TIMBRE_LABELS = {
    piano:"피아노(추천)", guitar:"기타(나일론)",
    triangle:"삼각파", sine:"사인파(부드럽게)", square:"사각파(또렷하게)"
  };
  for (const name of MUSIC_TIMBRES){
    const option = document.createElement("option");
    option.value = name;
    option.textContent = TIMBRE_LABELS[name] || name;
    if (sheet.timbre === name) option.selected = true;
    timbreSelect.appendChild(option);
  }
  timbreSelect.addEventListener("change", () => {
    sheet.timbre = timbreSelect.value;
    touch();
    if (history) history.commit();
  });
  timbreWrap.appendChild(timbreSelect);

  // 박자표 — 마디 용량이 바뀌므로 넘치는 마디가 생길 수 있다(막지 않고 경고만; 되돌리기로 취소 가능).
  const timeWrap = document.createElement("label");
  timeWrap.className = "music-field";
  timeWrap.append("박자");
  const timeSelect = document.createElement("select");
  timeSelect.className = "music-timbre";
  for (const spec of MUSIC_TIME_CHOICES){
    const option = document.createElement("option");
    option.value = spec;
    option.textContent = spec;
    if (`${sheet.time.beats}/${sheet.time.beatValue}` === spec) option.selected = true;
    timeSelect.appendChild(option);
  }
  timeSelect.addEventListener("change", () => {
    const [beats, beatValue] = timeSelect.value.split("/").map(Number);
    sheet.time = { beats, beatValue };
    afterEdit();
    const check = musicValidate(sheet);
    if (!check.ok && typeof toast === "function"){
      toast(`박자를 ${timeSelect.value} 로 바꿨어요. 박자와 맞지 않는 마디는 아래에 표시했어요.`, 3400);
    }
  });
  timeWrap.appendChild(timeSelect);

  // 조표 — 임시표 없이 적혀 있던 음은 새 조표를 따라간다(musicRetuneForKey).
  const keyWrap = document.createElement("label");
  keyWrap.className = "music-field";
  keyWrap.append("조표");
  const keySelect = document.createElement("select");
  keySelect.className = "music-timbre";
  for (const name of Object.keys(MUSIC_KEYS)){
    const option = document.createElement("option");
    option.value = name;
    option.textContent = MUSIC_KEYS[name].label;
    if (sheet.key === name) option.selected = true;
    keySelect.appendChild(option);
  }
  keySelect.addEventListener("change", () => {
    const changed = musicRetuneForKey(sheet, keySelect.value);
    afterEdit();
    if (changed && typeof toast === "function"){
      toast(`${MUSIC_KEYS[sheet.key].label}로 바꿨어요. 임시표 없던 음 ${changed}개가 새 조표를 따라갑니다.`, 3400);
    }
  });
  keyWrap.appendChild(keySelect);

  const undoBtn = musicButton("↶", "되돌리기 (Ctrl+Z)");
  const redoBtn = musicButton("↷", "다시 실행 (Ctrl+Y)");
  const historyWrap = document.createElement("span");
  historyWrap.className = "music-history";
  historyWrap.append(undoBtn, redoBtn);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "run-save music-save";      // .run-save → 전역 Ctrl+S 가 이 버튼을 클릭한다
  saveBtn.textContent = "💾 저장";
  saveBtn.addEventListener("click", () => { saveMusicSheet(doc); });

  bar.append(titleInput, tempoWrap, timeWrap, keyWrap, timbreWrap, historyWrap, saveBtn);

  /* ----- 도구상자 ----- */
  const tools = document.createElement("div");
  tools.className = "music-tools";

  const valueButtons = new Map();
  const valueGroup = document.createElement("span");
  valueGroup.className = "music-group";
  MUSIC_TOOL_VALUES.forEach((item, index) => {
    const button = musicButton(item.label, `${item.label}음표 (${index + 1})`);
    button.addEventListener("click", () => setToolValue(item.value));
    valueButtons.set(item.value, button);
    valueGroup.appendChild(button);
  });

  const dotBtn = musicButton("·점", "점음표 (마침표 키로 0 → 점 → 겹점)");
  dotBtn.addEventListener("click", () => setToolDots((tool.dots + 1) % (MUSIC_MAX_DOTS + 1)));

  const restBtn = musicButton("쉼표", "쉼표로 넣기 (R)");
  restBtn.addEventListener("click", () => setToolRest(!tool.rest));

  const accidentalGroup = document.createElement("span");
  accidentalGroup.className = "music-group";
  const accidentalButtons = new Map();
  for (const [alter, label, title] of [[1, "♯", "올림표"], [-1, "♭", "내림표"], [0, "♮", "제자리표"]]){
    const button = musicButton(label, title + " — 고른 음표에 바로, 없으면 다음에 넣을 음표에");
    button.addEventListener("click", () => applyAccidental(alter));
    accidentalButtons.set(alter, button);
    accidentalGroup.appendChild(button);
  }

  const eraserBtn = musicButton("지우개", "켜면 누른 음표를 지웁니다 (Delete 로도 지울 수 있어요)");
  eraserBtn.addEventListener("click", () => setToolEraser(!tool.eraser));

  const positionBtn = musicButton("위치 조정", "켜고 음표를 좌우로 드래그합니다 (Alt+드래그도 가능)");
  positionBtn.addEventListener("click", () => setPositionTool(!tool.position));

  const solfegeBtn = musicButton("계이름", "음표 아래 계이름 표시 켜기/끄기");
  solfegeBtn.setAttribute("aria-pressed", sheet.showSolfege !== false ? "true" : "false");
  solfegeBtn.addEventListener("click", toggleSolfege);

  const addBarBtn = musicButton("＋마디", "마지막에 빈 마디 추가");
  addBarBtn.addEventListener("click", () => addMeasure());
  const addStaffBtn = musicButton("＋오선", "마지막에 빈 오선 한 단 추가");
  addStaffBtn.addEventListener("click", () => addStaffLine());
  const removeStaffBtn = musicButton("－오선", "마지막에 추가한 오선 한 단 삭제");
  removeStaffBtn.addEventListener("click", () => removeStaffLine());
  const removeBarBtn = musicButton("－마디", "고른 마디(없으면 마지막 마디) 삭제");
  removeBarBtn.addEventListener("click", () => removeMeasure());

  const hint = document.createElement("span");
  hint.className = "music-hint music-hover-readout";
  hint.setAttribute("aria-label", "악보 입력 위치 안내");
  hint.textContent = "오선 위에 마우스를 올리면 넣을 음을 보여줘요";

  tools.append(valueGroup, dotBtn, restBtn, accidentalGroup, solfegeBtn, eraserBtn, positionBtn,
    addBarBtn, removeBarBtn, addStaffBtn, removeStaffBtn, hint);

  /* ----- 재생 바 ----- */
  const playBar = document.createElement("div");
  playBar.className = "music-play";

  const playAllBtn = musicButton("▶ 전체 재생");
  const rangeWrap = document.createElement("span");
  rangeWrap.className = "music-field";
  const fromInput = document.createElement("input");
  const toInput = document.createElement("input");
  for (const input of [fromInput, toInput]){
    input.type = "number";
    input.className = "music-range";
    input.min = "1";
    input.value = "1";
  }
  toInput.value = String(sheet.measures.length);
  rangeWrap.append("마디 ", fromInput, " ~ ", toInput);

  const playPartBtn = musicButton("▶ 이 구간만");
  const stopBtn = musicButton("■ 정지");
  stopBtn.disabled = true;
  const musicXmlBtn = musicButton("⬇ MusicXML", "다른 악보 프로그램에서 열 수 있는 .musicxml 파일로 저장");
  const wavBtn = musicButton("⬇ WAV 저장");
  const printBtn = musicButton("🖨 인쇄", "인쇄 대화상자에서 'PDF로 저장'을 고르면 PDF가 됩니다");
  const zoomWrap = document.createElement("span");
  zoomWrap.className = "music-zoom";
  const zoomOutBtn = musicButton("−", "악보 축소 (Ctrl+휠 아래, Ctrl+-)");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "music-zoom-label";
  zoomLabel.setAttribute("aria-live", "polite");
  const zoomInBtn = musicButton("＋", "악보 확대 (Ctrl+휠 위, Ctrl++)");
  const zoomFitBtn = musicButton("맞춤", "악보 배율을 100%로 되돌리기 (Ctrl+0)");
  zoomWrap.append(zoomOutBtn, zoomLabel, zoomInBtn, zoomFitBtn);
  const status = document.createElement("span");
  status.className = "music-status";

  playBar.append(playAllBtn, rangeWrap, playPartBtn, stopBtn, musicXmlBtn, wavBtn, printBtn, zoomWrap, status);

  /* ----- 악보 ----- */
  const scoreHost = document.createElement("div");
  scoreHost.className = "music-score";
  scoreHost.tabIndex = 0;
  scoreHost.setAttribute("aria-label", "악보 편집 영역. 마우스 오른쪽 버튼으로 편집 메뉴를 열 수 있습니다.");
  const notice = document.createElement("div");
  notice.className = "music-notice";
  notice.hidden = true;

  root.append(bar, tools, playBar, notice, scoreHost);

  /* ----- 도구·상태 표시 ----- */
  function setToolValue(value){
    if (MUSIC_TOOL_VALUES.some((item) => item.value === value)) tool.value = value;
    syncTools();
  }

  function setToolDots(dots){
    tool.dots = Math.max(0, Math.min(MUSIC_MAX_DOTS, Math.round(Number(dots) || 0)));
    syncTools();
  }

  function setToolRest(rest){ tool.rest = !!rest; syncTools(); }
  function setToolEraser(eraser){
    tool.eraser = !!eraser;
    if (tool.eraser) tool.position = false;
    syncTools();
  }
  function setPositionTool(position){
    tool.position = !!position;
    if (tool.position) tool.eraser = false;
    syncTools();
  }
  function setToolAccidental(alter){ tool.accidental = alter === null ? null : musicClampAlter(alter); syncTools(); }

  function toggleSolfege(){
    sheet.showSolfege = sheet.showSolfege === false;
    syncTools();
    afterEdit();
  }

  function resetHoverReadout(){
    hint.textContent = tool.eraser
      ? "지우개: 지울 음표 위로 마우스를 옮겨 보세요"
      : tool.position
        ? "위치 조정: 음표를 좌우로 드래그하세요"
        : "오선 위에 마우스를 올리면 넣을 음을 보여줘요";
    scoreHost.classList.remove("is-invalid-entry");
    hidePitchGuide();
  }

  function syncTools(){
    for (const [value, button] of valueButtons) button.classList.toggle("is-on", tool.value === value);
    dotBtn.classList.toggle("is-on", tool.dots > 0);
    dotBtn.textContent = tool.dots === 2 ? "··겹점" : "·점";
    restBtn.classList.toggle("is-on", tool.rest);
    eraserBtn.classList.toggle("is-on", tool.eraser);
    positionBtn.classList.toggle("is-on", tool.position);
    solfegeBtn.classList.toggle("is-on", sheet.showSolfege !== false);
    solfegeBtn.setAttribute("aria-pressed", sheet.showSolfege !== false ? "true" : "false");
    for (const [alter, button] of accidentalButtons) button.classList.toggle("is-on", !selection && tool.accidental === alter);
    scoreHost.classList.toggle("is-erasing", tool.eraser);
    scoreHost.classList.toggle("is-position-tool", tool.position);
    scoreHost.classList.toggle("is-note-entry", !tool.eraser && !tool.position);
    resetHoverReadout();
  }

  function updateHistoryButtons(){
    undoBtn.disabled = !history || !history.canUndo();
    redoBtn.disabled = !history || !history.canRedo();
  }

  function updateStatus(){
    const total = musicTimeline(sheet).totalSeconds;
    status.textContent = `${sheet.measures.length}마디 · ${total.toFixed(1)}초`;
    const check = musicValidate(sheet);
    if (check.ok){
      notice.hidden = true;
    } else {
      const first = check.issues[0];
      const beats = (ticks) => (ticks / MUSIC_TICKS_PER_QUARTER).toFixed(2).replace(/\.?0+$/, "");
      notice.hidden = false;
      notice.textContent = `⚠ ${first.measure}마디가 박자와 맞지 않아요(${beats(first.actual)}박 / ${beats(first.expected)}박)`
        + (check.issues.length > 1 ? ` 외 ${check.issues.length - 1}곳` : "");
    }
  }

  /* ----- VexFlow 조판 ----- */
  function clampRange(){
    const last = Math.max(1, sheet.measures.length);
    let from = Math.max(1, Math.min(last, Math.round(Number(fromInput.value) || 1)));
    let to = Math.max(1, Math.min(last, Math.round(Number(toInput.value) || last)));
    if (to < from) to = from;
    fromInput.value = String(from);
    toInput.value = String(to);
    fromInput.max = toInput.max = String(last);
    return { from, to };
  }

  /* ----- 보기 배율 -----
     SVG의 transform만 바꾸면 스크롤 영역이 원래 크기로 남는다. 실제 표시 너비·높이를 바꿔
     스크롤바와 클릭 좌표를 함께 맞춘다(scorePoint가 화면 좌표를 SVG 좌표로 다시 환산한다). */
  function clampScoreZoom(value){
    const next = Number(value);
    return Math.max(MUSIC_ZOOM_MIN, Math.min(MUSIC_ZOOM_MAX, Number.isFinite(next) ? next : 1));
  }

  function updateZoomControls(){
    zoomLabel.textContent = Math.round(scoreZoom * 100) + "%";
    zoomOutBtn.disabled = scoreZoom <= MUSIC_ZOOM_MIN + 0.001;
    zoomInBtn.disabled = scoreZoom >= MUSIC_ZOOM_MAX - 0.001;
    zoomFitBtn.disabled = Math.abs(scoreZoom - 1) < 0.001;
  }

  function applyScoreZoom(anchor){
    updateZoomControls();
    const svg = scoreHost.querySelector("svg");
    if (!svg) return;
    const baseWidth = Number(svg.dataset.musicBaseWidth) ||
      ((svg.width && svg.width.baseVal) ? svg.width.baseVal.value : 0);
    const baseHeight = Number(svg.dataset.musicBaseHeight) ||
      ((svg.height && svg.height.baseVal) ? svg.height.baseVal.value : 0);
    if (!(baseWidth > 0) || !(baseHeight > 0)) return;

    const hasAnchor = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
    const before = hasAnchor ? svg.getBoundingClientRect() : null;
    const ratioX = before && before.width ? (anchor.x - before.left) / before.width : 0.5;
    const ratioY = before && before.height ? (anchor.y - before.top) / before.height : 0.5;

    svg.style.width = Math.max(1, Math.round(baseWidth * scoreZoom)) + "px";
    svg.style.height = Math.max(1, Math.round(baseHeight * scoreZoom)) + "px";
    svg.style.maxWidth = "none";

    // 휠을 돌린 곳의 악보 지점이 화면에서 움직이지 않도록 새 크기만큼 스크롤을 보정한다.
    if (hasAnchor){
      const after = svg.getBoundingClientRect();
      scoreHost.scrollLeft += after.left + ratioX * after.width - anchor.x;
      scoreHost.scrollTop += after.top + ratioY * after.height - anchor.y;
    }
  }

  function setScoreZoom(value, clientX, clientY){
    scoreZoom = Math.round(clampScoreZoom(value) * 10) / 10;
    const box = scoreHost.getBoundingClientRect();
    const anchor = {
      x:Number.isFinite(clientX) ? clientX : box.left + box.width / 2,
      y:Number.isFinite(clientY) ? clientY : box.top + box.height / 2
    };
    applyScoreZoom(anchor);
  }

  function stepScoreZoom(direction, clientX, clientY){
    setScoreZoom(scoreZoom + (direction > 0 ? MUSIC_ZOOM_STEP : -MUSIC_ZOOM_STEP), clientX, clientY);
  }

  function drawScore(){
    const VF = (typeof window !== "undefined") ? window.VexFlow : null;
    noteEls.clear();
    solfegeEls.clear();
    noteHorizontalLimits.clear();
    staveBoxes = [];
    pitchGuideEl = null;
    scoreHost.replaceChildren();
    if (!VF){
      scoreHost.textContent = "악보 그리기 라이브러리를 불러오지 못했어요.";
      return;
    }
    try {
      const width = Math.max(MUSIC_SCORE_MIN_WIDTH, Math.floor(scoreHost.clientWidth || MUSIC_SCORE_MIN_WIDTH) - 8);
      // 한 줄에 몇 마디를 놓을지는 화면 폭과 마디마다 든 음표 수로 정한다(music-model.js).
      const layout = musicPackLines(sheet.measures, width - 20);
      const renderer = new VF.Renderer(scoreHost, VF.Renderer.Backends.SVG);
      const scoreHeight = layout.length * MUSIC_LINE_HEIGHT + 30;
      renderer.resize(width, scoreHeight);
      const context = renderer.getContext();
      const scoreSvg = scoreHost.querySelector("svg");
      const keySpec = (MUSIC_KEYS[sheet.key] || MUSIC_KEYS.C).vex;

      const places = [];
      const solfegePlaces = [];
      layout.forEach((line, lineIndex) => {
        let x = 10;
        line.indexes.forEach((index, columnIndex) => {
          places.push({ index, x, y:10 + lineIndex * MUSIC_LINE_HEIGHT, width:line.widths[columnIndex], head:columnIndex === 0 });
          x += line.widths[columnIndex];
        });
      });

      places.forEach(({ index, x, y, width:staveWidth, head }) => {
        const measure = sheet.measures[index];
        const stave = new VF.Stave(x, y, staveWidth);
        // 음자리표·조표는 줄마다 다시 그린다(악보 관례). 박자표는 맨 처음 한 번만.
        if (head){
          stave.addClef("treble");
          if (sheet.key !== "C") stave.addKeySignature(keySpec);
        }
        if (index === 0) stave.addTimeSignature(sheet.time.beats + "/" + sheet.time.beatValue);
        stave.setContext(context).draw();

        // 클릭한 자리를 마디·음높이로 옮기려면 조판 좌표가 필요하다.
        const topY = stave.getYForLine(0);
        const bottomY = stave.getYForLine(4);
        staveBoxes.push({
          index, x, width:staveWidth, topY, bottomY,
          spacing:(bottomY - topY) / 4,
          hitTop:topY - MUSIC_LINE_HEIGHT / 3,
          hitBottom:bottomY + MUSIC_LINE_HEIGHT / 3
        });

        const notes = Array.isArray(measure.notes) ? measure.notes : [];
        if (!notes.length) return;                       // 빈 마디는 오선만 그린다(작성 전)

        const drawn = notes.map((note) => {
          const spec = musicVexNote(note, sheet.key);
          const staveNote = new VF.StaveNote({ keys:spec.keys, duration:spec.duration });
          if (spec.accidental) staveNote.addModifier(new VF.Accidental(spec.accidental), 0);
          for (let dot = 0; dot < spec.dots; dot++) VF.Dot.buildAndAttach([staveNote], { all:true });
          return { note, staveNote };
        });
        // FormatAndDraw는 조판과 그리기를 한 번에 끝낸다. 위치 미세 조정은 그 사이에 xShift를
        // 넣어야 머리·기둥·꼬리 잇기가 함께 이동하므로 같은 내부 순서를 명시적으로 펼친다.
        const tickables = drawn.map((item) => item.staveNote);
        const voice = new VF.Voice(VF.TIME4_4).setMode(VF.Voice.Mode.SOFT).addTickables(tickables);
        const beams = VF.Beam.applyAndGetBeams(voice);
        new VF.Formatter().joinVoices([voice]).formatToStave([voice], stave, { alignRests:true, stave });

        const baseXs = tickables.map((item) => item.getAbsoluteX());
        const noteStartX = stave.getNoteStartX();
        const noteEndX = stave.getNoteEndX();
        drawn.forEach((item, at) => {
          const baseX = baseXs[at];
          const leftRoom = at > 0 ? (baseX - baseXs[at - 1]) / 2 - 6 : baseX - noteStartX - 6;
          const rightRoom = at + 1 < baseXs.length ? (baseXs[at + 1] - baseX) / 2 - 6 : noteEndX - baseX - 6;
          const min = Math.max(-MUSIC_X_OFFSET_MAX, -Math.max(0, Math.floor(leftRoom)));
          const max = Math.min(MUSIC_X_OFFSET_MAX, Math.max(0, Math.floor(rightRoom)));
          const applied = Math.max(min, Math.min(max, musicClampXOffset(item.note.xOffset)));
          noteHorizontalLimits.set(item.note.id, { min, max, applied });
          item.staveNote.setXShift(applied);
        });
        voice.setContext(context).setStave(stave).drawWithStyle();
        beams.forEach((beam) => beam.setContext(context).drawWithStyle());

        // 그린 뒤에야 SVG 요소가 생긴다 — 여기서 클릭·강조용 표시를 붙인다.
        for (const { note, staveNote } of drawn){
          const el = (typeof staveNote.getSVGElement === "function") ? staveNote.getSVGElement() : null;
          if (!el) continue;
          el.classList.add("music-note");
          if (note.rest) el.classList.add("is-rest");
          el.dataset.noteId = note.id;
          el.dataset.measure = String(index + 1);
          noteEls.set(note.id, el);
          if (sheet.showSolfege !== false && !note.rest && scoreSvg){
            solfegePlaces.push({ note, index,
              x:staveNote.getAbsoluteX() + staveNote.getXShift(), y:bottomY + 42 });
          }
        }
      });
      // VexFlow가 모든 마디를 그린 뒤 붙여야 뒤쪽 오선이 계이름을 덮지 않는다.
      for (const place of solfegePlaces){
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const alter = musicClampAlter(place.note.alter);
        const mark = alter > 0 ? "♯".repeat(alter) : alter < 0 ? "♭".repeat(-alter) : "";
        label.textContent = (MUSIC_SOLFEGE_LABELS[place.note.step] || place.note.step) + mark;
        label.classList.add("music-solfege");
        label.dataset.noteId = place.note.id;
        label.dataset.measure = String(place.index + 1);
        label.setAttribute("x", String(place.x));
        label.setAttribute("y", String(place.y));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("aria-label", label.textContent + " 계이름");
        scoreSvg.appendChild(label);
        solfegeEls.set(place.note.id, label);
      }
      const svg = scoreHost.querySelector("svg");
      if (svg){
        svg.dataset.musicBaseWidth = String(width);
        svg.dataset.musicBaseHeight = String(scoreHeight);
        const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
        guide.classList.add("music-pitch-guide");
        guide.setAttribute("visibility", "hidden");
        guide.setAttribute("aria-hidden", "true");
        svg.appendChild(guide);
        pitchGuideEl = guide;
      }
      vexReady = true;
      applyScoreZoom();
      paintSelection();
    } catch(error){
      console.warn("악보를 그리지 못했습니다:", error);
      scoreHost.textContent = "악보를 그리지 못했어요. 파일이 손상되었을 수 있어요.";
    }
  }

  function scheduleRedraw(){
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => { if (vexReady) drawScore(); }, MUSIC_REDRAW_DELAY);
  }

  /* ----- 선택 ----- */
  function selectedNote(){
    if (!selection) return null;
    const measure = sheet.measures[selection.measure];
    if (!measure) return null;
    return (measure.notes || []).find((item) => item.id === selection.id) || null;
  }

  function paintSelection(){
    for (const el of noteEls.values()) el.classList.remove("is-selected");
    for (const el of solfegeEls.values()) el.classList.remove("is-selected");
    if (!selection) return;
    const el = noteEls.get(selection.id);
    if (el) el.classList.add("is-selected");
    const label = solfegeEls.get(selection.id);
    if (label) label.classList.add("is-selected");
  }

  function select(measureIndex, noteId, options){
    selection = (noteId == null) ? null : { measure:measureIndex, id:noteId };
    paintSelection();
    syncTools();
    if (selection && (!options || options.scroll !== false)){
      const el = noteEls.get(selection.id);
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block:"nearest", inline:"nearest" });
    }
  }

  /* ----- 편집 ----- */
  function afterEdit(){
    touch();
    updateStatus();
    clampRange();
    drawScore();
    if (history && !history.isApplying()) history.commit();
  }

  function toolAlterForPitch(pitch){
    const keyAlter = musicKeyAlterations(sheet.key)[pitch.step] || 0;
    return tool.accidental === null ? keyAlter : tool.accidental;
  }

  function toolNote(pitch){
    if (tool.rest) return musicRest(tool.value, tool.dots);
    return musicNote(pitch.step, pitch.octave, {
      alter:toolAlterForPitch(pitch), value:tool.value, dots:tool.dots
    });
  }

  function musicDurationLabel(note){
    const item = MUSIC_TOOL_VALUES.find((entry) => entry.value === (note && note.value));
    const base = item ? item.label : "4분";
    const prefix = note && note.dots === 2 ? "겹점" : note && note.dots === 1 ? "점" : "";
    return prefix + base + (note && note.rest ? "쉼표" : "음표");
  }

  function musicSolfegeLabel(note){
    if (!note || note.rest) return musicDurationLabel(note);
    const alter = musicClampAlter(note.alter);
    const mark = alter > 0 ? "♯".repeat(alter) : alter < 0 ? "♭".repeat(-alter) : "";
    const korean = (MUSIC_SOLFEGE_LABELS[note.step] || note.step) + mark + note.octave;
    return `${korean} (${musicNoteName(note)}) · ${musicDurationLabel(note)}`;
  }

  function insertNote(measureIndex, pitch){
    const measure = sheet.measures[measureIndex];
    if (!measure) return;
    const note = toolNote(pitch);
    if (!musicCanFit(sheet, measureIndex, note)){
      if (typeof toast === "function") toast(`${measureIndex + 1}마디가 이미 가득 찼어요. 마디를 더하거나 짧은 음표를 골라 보세요.`, 3000);
      return;
    }
    // 고른 음표가 이 마디에 있으면 그 뒤에, 아니면 마디 끝에 넣는다.
    const notes = measure.notes;
    const current = selectedNote();
    const at = (current && selection.measure === measureIndex)
      ? notes.indexOf(current) + 1 : notes.length;
    notes.splice(at, 0, note);
    tool.accidental = null;                    // 임시표는 한 번 쓰면 풀리고 다시 조표를 따른다
    afterEdit();
    select(measureIndex, note.id);
    if (!note.rest) MNMusicAudio.previewNote(note, sheet.timbre);
  }

  function deleteNote(measureIndex, noteId){
    const measure = sheet.measures[measureIndex];
    if (!measure) return;
    const at = (measure.notes || []).findIndex((item) => item.id === noteId);
    if (at < 0) return;
    measure.notes.splice(at, 1);
    const next = measure.notes[at] || measure.notes[at - 1] || null;
    afterEdit();
    select(measureIndex, next ? next.id : null);
  }

  function shiftSelected(steps){
    const note = selectedNote();
    if (!note || note.rest) return;
    const moved = musicShiftPitch(note, steps);
    if (!moved){
      if (typeof toast === "function") toast("이 악보에서 쓸 수 있는 음역을 벗어나요.", 2200);
      return;
    }
    note.step = moved.step;
    note.octave = moved.octave;
    afterEdit();
    select(selection.measure, note.id);
    MNMusicAudio.previewNote(note, sheet.timbre);
  }

  function resetSelectedHorizontalPosition(){
    const note = selectedNote();
    if (!note || !musicClampXOffset(note.xOffset)) return;
    delete note.xOffset;
    const measureIndex = selection.measure;
    afterEdit();
    select(measureIndex, note.id);
  }

  function applyAccidental(alter){
    const note = selectedNote();
    if (note && !note.rest){
      // 같은 임시표를 다시 누르면 제자리로 돌린다.
      note.alter = (note.alter === alter) ? 0 : alter;
      afterEdit();
      select(selection.measure, note.id);
      MNMusicAudio.previewNote(note, sheet.timbre);
      return;
    }
    tool.accidental = (tool.accidental === alter) ? null : alter;
    syncTools();
  }

  function moveSelection(delta){
    const flat = [];
    sheet.measures.forEach((measure, index) => {
      for (const note of (measure.notes || [])) flat.push({ measure:index, id:note.id });
    });
    if (!flat.length) return;
    let at = selection ? flat.findIndex((item) => item.id === selection.id) : -1;
    at = (at < 0) ? (delta > 0 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, at + delta));
    select(flat[at].measure, flat[at].id);
  }

  function addMeasure(){
    sheet.measures.push(musicMeasure());
    afterEdit();
    toInput.value = String(sheet.measures.length);
    clampRange();
  }

  function addStaffLine(){
    // 새 단은 줄바꿈 표시를 가진 빈 마디로 시작한다. 뒤의 ＋마디는 이 단에 이어 붙는다.
    sheet.measures.push(musicMeasure([], { lineBreakBefore:true }));
    afterEdit();
    toInput.value = String(sheet.measures.length);
    clampRange();
  }

  function removeStaffLine(){
    // ＋오선으로 만든 마지막 줄바꿈부터 끝까지가 마지막으로 추가한 오선 한 단이다.
    let at = -1;
    for (let index = sheet.measures.length - 1; index > 0; index--){
      if (sheet.measures[index] && sheet.measures[index].lineBreakBefore){ at = index; break; }
    }
    if (at < 0){
      if (typeof toast === "function") toast("추가한 오선이 없어요.", 2200);
      return;
    }
    const removed = sheet.measures.slice(at);
    const noteCount = removed.reduce((sum, measure) => sum + ((measure && measure.notes) || []).length, 0);
    if (noteCount > 0 && typeof confirm === "function" &&
        !confirm(`마지막 오선에 음표 또는 쉼표 ${noteCount}개가 있어요. 오선 전체를 지울까요?`)) return;
    sheet.measures.splice(at);
    selection = null;
    afterEdit();
    toInput.value = String(sheet.measures.length);
    clampRange();
  }

  function removeMeasure(measureIndex){
    if (sheet.measures.length <= 1){
      if (typeof toast === "function") toast("마디는 하나 이상 있어야 해요.", 2200);
      return;
    }
    const requested = Number(measureIndex);
    const at = Number.isInteger(requested) && requested >= 0 && requested < sheet.measures.length
      ? requested : (selection ? selection.measure : sheet.measures.length - 1);
    const removed = sheet.measures.splice(at, 1)[0];
    // 새 단의 첫 마디를 지우면 다음 마디가 그 줄바꿈을 이어받는다.
    if (at > 0 && removed && removed.lineBreakBefore && sheet.measures[at]){
      sheet.measures[at].lineBreakBefore = true;
    }
    if (sheet.measures[0]) sheet.measures[0].lineBreakBefore = false;
    selection = null;
    afterEdit();
  }

  /* ----- 오선 클릭 ----- */
  function scorePoint(event){
    const svg = scoreHost.querySelector("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // CSS 로 크기가 달라졌을 수 있으므로 SVG 좌표계로 되돌린다.
    const userWidth = (svg.width && svg.width.baseVal) ? svg.width.baseVal.value : rect.width;
    const userHeight = (svg.height && svg.height.baseVal) ? svg.height.baseVal.value : rect.height;
    return {
      x:(event.clientX - rect.left) * (userWidth / rect.width),
      y:(event.clientY - rect.top) * (userHeight / rect.height)
    };
  }

  function staveBoxAtPoint(point){
    if (!point) return null;
    return staveBoxes.find((item) =>
      point.x >= item.x && point.x <= item.x + item.width && point.y >= item.hitTop && point.y <= item.hitBottom) || null;
  }

  function scoreHasOverflow(){
    return scoreHost.scrollWidth > scoreHost.clientWidth + 1 ||
      scoreHost.scrollHeight > scoreHost.clientHeight + 1;
  }

  function scorePanAreaAt(event){
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    return !target && !staveBoxAtPoint(scorePoint(event));
  }

  function updateScorePanCursor(event){
    const ready = !scorePan && scoreHasOverflow() && scorePanAreaAt(event);
    scoreHost.classList.toggle("is-pan-ready", ready);
    if (ready) hidePitchGuide();
    return ready;
  }

  function staveLineAtScorePoint(point, box){
    if (!point || !box || !box.spacing) return null;
    return Math.round(((point.y - box.topY) / box.spacing) * 2) / 2;
  }

  function pitchAtScorePoint(point, box){
    const lineValue = staveLineAtScorePoint(point, box);
    if (lineValue === null) return null;
    // 줄 값(0=맨 윗줄)으로 바꾼 뒤 0.5 칸(줄·칸)에 붙인다.
    return musicPitchFromStaveLine(lineValue);
  }

  function hidePitchGuide(){
    if (pitchGuideEl) pitchGuideEl.setAttribute("visibility", "hidden");
  }

  function updatePitchGuide(point, box, invalid){
    const lineValue = staveLineAtScorePoint(point, box);
    // 실제 오선 5줄 안은 이미 위치가 보인다. 그 위·아래의 보이지 않는 음높이만 안내한다.
    if (!pitchGuideEl || lineValue === null || (lineValue >= 0 && lineValue <= 4)){
      hidePitchGuide();
      return;
    }
    const y = box.topY + lineValue * box.spacing;
    pitchGuideEl.setAttribute("x1", String(box.x + 5));
    pitchGuideEl.setAttribute("x2", String(box.x + box.width - 5));
    pitchGuideEl.setAttribute("y1", String(y));
    pitchGuideEl.setAttribute("y2", String(y));
    pitchGuideEl.classList.toggle("is-invalid", !!invalid);
    pitchGuideEl.removeAttribute("visibility");
  }

  function noteByElement(target){
    if (!target) return null;
    const measureIndex = (Number(target.dataset.measure) || 1) - 1;
    const measure = sheet.measures[measureIndex];
    const note = measure && (measure.notes || []).find((item) => item.id === target.dataset.noteId);
    return note ? { note, measureIndex } : null;
  }

  /* ----- 악보 우클릭 편집 메뉴 -----
     도구막대와 별도 편집 로직을 만들지 않고 위의 공용 동작을 그대로 부른다. 음표를 누른
     경우에는 그 음표용 명령을 먼저, 빈 오선에서는 다음 입력 도구를 먼저 보여 준다. */
  function cancelContextSubClose(){
    if (contextSubTimer){ clearTimeout(contextSubTimer); contextSubTimer = null; }
  }

  function closeContextLayers(depth){
    while (contextLayers.length > depth){
      const layer = contextLayers.pop();
      if (layer.__parentButton) layer.__parentButton.classList.remove("is-open");
      layer.remove();
    }
  }

  function closeMusicContextMenu(){
    cancelContextSubClose();
    closeContextLayers(0);
    if (contextOutside){ document.removeEventListener("pointerdown", contextOutside, true); contextOutside = null; }
    if (contextKeydown){ document.removeEventListener("keydown", contextKeydown, true); contextKeydown = null; }
    if (contextResize){ window.removeEventListener("resize", contextResize); contextResize = null; }
  }

  function placeContextSub(menu, button){
    const anchor = button.getBoundingClientRect();
    const margin = 6, width = menu.offsetWidth, height = menu.offsetHeight;
    let left = anchor.right - 4;
    if (left + width > window.innerWidth - margin) left = anchor.left - width + 4;
    menu.style.left = Math.max(margin, left) + "px";
    menu.style.top = Math.max(margin, Math.min(window.innerHeight - height - margin, anchor.top - 5)) + "px";
  }

  function renderMusicContextLayer(items, depth){
    const menu = document.createElement("div");
    menu.className = depth ? "music-context-menu music-context-sub" : "music-context-menu";
    menu.setAttribute("role", "menu");
    menu.addEventListener("pointerenter", cancelContextSubClose);
    for (const item of items){
      if (item.separator){
        const separator = document.createElement("div");
        separator.className = "music-context-sep";
        separator.setAttribute("role", "separator");
        menu.appendChild(separator);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", item.active === undefined ? "menuitem" : "menuitemcheckbox");
      if (item.active !== undefined) button.setAttribute("aria-checked", item.active ? "true" : "false");
      button.textContent = item.label;
      button.disabled = !!item.disabled;
      button.classList.toggle("is-active", !!item.active);
      const children = Array.isArray(item.children) ? item.children : [];
      if (children.length){
        button.classList.add("music-context-parent");
        const openChildren = () => {
          if (button.disabled) return;
          const opened = contextLayers[depth + 1];
          if (opened && opened.__parentButton === button) return;
          closeContextLayers(depth + 1);
          const sub = renderMusicContextLayer(children, depth + 1);
          sub.__parentButton = button;
          document.body.appendChild(sub);
          contextLayers.push(sub);
          button.classList.add("is-open");
          placeContextSub(sub, button);
        };
        button.addEventListener("pointerenter", () => { cancelContextSubClose(); openChildren(); });
        button.addEventListener("click", openChildren);
      } else {
        button.addEventListener("pointerenter", () => {
          if (contextLayers.length <= depth + 1) return;
          cancelContextSubClose();
          contextSubTimer = setTimeout(() => closeContextLayers(depth + 1), 220);
        });
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          if (button.disabled) return;
          closeMusicContextMenu();
          if (typeof item.action === "function") item.action();
        });
      }
      menu.appendChild(button);
    }
    return menu;
  }

  function openMusicContextMenu(x, y, items){
    closeMusicContextMenu();
    const menu = renderMusicContextLayer(items, 0);
    document.body.appendChild(menu);
    contextLayers.push(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, x)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, y)) + "px";
    contextOutside = (event) => {
      if (!contextLayers.some((layer) => layer.contains(event.target))) closeMusicContextMenu();
    };
    contextKeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (contextLayers.length > 1) closeContextLayers(contextLayers.length - 1);
      else closeMusicContextMenu();
    };
    contextResize = closeMusicContextMenu;
    setTimeout(() => {
      if (!contextLayers.length) return;
      document.addEventListener("pointerdown", contextOutside, true);
      document.addEventListener("keydown", contextKeydown, true);
      window.addEventListener("resize", contextResize);
    }, 0);
    const first = menu.querySelector("button:not(:disabled)");
    if (first) first.focus({ preventScroll:true });
  }

  function nextInputContextItems(){
    return [
      { label:"음표 길이", children:MUSIC_TOOL_VALUES.map((item) => ({
        label:item.label + "음표", active:tool.value === item.value, action:() => setToolValue(item.value)
      })) },
      { label:"점", children:[
        { label:"점 없음", active:tool.dots === 0, action:() => setToolDots(0) },
        { label:"점음표", active:tool.dots === 1, action:() => setToolDots(1) },
        { label:"겹점음표", active:tool.dots === 2, action:() => setToolDots(2) }
      ] },
      { label:"입력 종류", children:[
        { label:"음표", active:!tool.rest, action:() => setToolRest(false) },
        { label:"쉼표", active:tool.rest, action:() => setToolRest(true) }
      ] },
      { label:"다음 임시표", children:[
        { label:"조표 따름", active:tool.accidental === null, action:() => setToolAccidental(null) },
        { label:"♯ 올림표", active:tool.accidental === 1, action:() => setToolAccidental(1) },
        { label:"♭ 내림표", active:tool.accidental === -1, action:() => setToolAccidental(-1) },
        { label:"♮ 제자리표", active:tool.accidental === 0, action:() => setToolAccidental(0) }
      ] },
      { separator:true },
      { label:"지우개 모드", active:tool.eraser, action:() => setToolEraser(!tool.eraser) }
    ];
  }

  function scoreContextItems(noteInfo, measureIndex){
    const note = noteInfo && noteInfo.note;
    const targetMeasure = Math.max(0, Math.min(sheet.measures.length - 1,
      Number.isInteger(measureIndex) ? measureIndex : (selection ? selection.measure : sheet.measures.length - 1)));
    const canRemoveStaff = sheet.measures.some((measure, index) => index > 0 && measure && measure.lineBreakBefore);
    const items = [];
    if (note){
      items.push(
        { label:"이 음표 미리 듣기", action:() => MNMusicAudio.previewNote(note, sheet.timbre), disabled:note.rest },
        { label:"임시표", children:[
          { label:"♯ 올림표", active:note.alter === 1, action:() => applyAccidental(1), disabled:note.rest },
          { label:"♭ 내림표", active:note.alter === -1, action:() => applyAccidental(-1), disabled:note.rest },
          { label:"♮ 제자리표", active:note.alter === 0, action:() => applyAccidental(0), disabled:note.rest }
        ] },
        { label:"음높이", children:[
          { label:"한 음 올리기 (↑)", action:() => shiftSelected(1), disabled:note.rest },
          { label:"한 음 내리기 (↓)", action:() => shiftSelected(-1), disabled:note.rest },
          { separator:true },
          { label:"한 옥타브 올리기 (Shift+↑)", action:() => shiftSelected(7), disabled:note.rest },
          { label:"한 옥타브 내리기 (Shift+↓)", action:() => shiftSelected(-7), disabled:note.rest }
        ] },
        { label:"좌우 위치 원래대로", action:resetSelectedHorizontalPosition,
          disabled:!musicClampXOffset(note.xOffset) },
        { label:"이 음표 삭제 (Delete)", action:() => deleteNote(noteInfo.measureIndex, note.id) },
        { separator:true }
      );
    }
    items.push(
      { label:"다음 입력 도구", children:nextInputContextItems() },
      { label:"위치 조정 모드", active:tool.position, action:() => setPositionTool(!tool.position) },
      { label:"악보 구조", children:[
        { label:"마지막에 마디 추가", action:addMeasure },
        { label:`${targetMeasure + 1}마디 삭제`, action:() => removeMeasure(targetMeasure), disabled:sheet.measures.length <= 1 },
        { separator:true },
        { label:"마지막에 오선 추가", action:addStaffLine },
        { label:"마지막 오선 삭제", action:removeStaffLine, disabled:!canRemoveStaff }
      ] },
      { separator:true },
      { label:"계이름 표시", active:sheet.showSolfege !== false, action:toggleSolfege },
      { label:"보기 배율", children:[
        { label:"확대 (Ctrl++)", action:() => stepScoreZoom(1), disabled:scoreZoom >= MUSIC_ZOOM_MAX - 0.001 },
        { label:"축소 (Ctrl+-)", action:() => stepScoreZoom(-1), disabled:scoreZoom <= MUSIC_ZOOM_MIN + 0.001 },
        { label:"100% 맞춤 (Ctrl+0)", active:Math.abs(scoreZoom - 1) < 0.001, action:() => setScoreZoom(1) }
      ] },
      { separator:true },
      { label:"되돌리기 (Ctrl+Z)", action:() => history && history.undo(), disabled:!history || !history.canUndo() },
      { label:"다시 실행 (Ctrl+Y)", action:() => history && history.redo(), disabled:!history || !history.canRedo() }
    );
    return items;
  }

  function openScoreContextAt(clientX, clientY, target){
    const noteTarget = target && target.closest ? target.closest("[data-note-id]") : null;
    const noteInfo = noteByElement(noteTarget);
    if (noteInfo) select(noteInfo.measureIndex, noteInfo.note.id, { scroll:false });
    const box = staveBoxAtPoint(scorePoint({ clientX, clientY }));
    const measureIndex = noteInfo ? noteInfo.measureIndex : (box ? box.index : null);
    openMusicContextMenu(clientX, clientY, scoreContextItems(noteInfo, measureIndex));
  }

  function onScoreContextMenu(event){
    event.preventDefault();
    event.stopPropagation();
    openScoreContextAt(event.clientX, event.clientY, event.target);
  }

  function openKeyboardScoreContextMenu(){
    const target = selection ? noteEls.get(selection.id) : null;
    const rect = (target || scoreHost).getBoundingClientRect();
    openScoreContextAt(rect.left + Math.min(24, rect.width / 2), rect.top + Math.min(24, rect.height / 2), target || scoreHost);
  }

  function setHoverReadout(text, invalid){
    if (hint.textContent !== text) hint.textContent = text;
    scoreHost.classList.toggle("is-invalid-entry", !!invalid);
  }

  scoreHost.addEventListener("contextmenu", onScoreContextMenu);
  scoreHost.addEventListener("scroll", closeMusicContextMenu);

  scoreHost.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    const existing = noteByElement(target);
    const horizontalDrag = existing && (tool.position || (event.pointerType !== "touch" && event.altKey));
    const pitchDrag = existing && !existing.note.rest && !tool.eraser && !tool.position && !event.altKey
      && event.pointerType !== "touch";
    if (horizontalDrag || pitchDrag){
      const point = scorePoint(event);
      const limits = noteHorizontalLimits.get(existing.note.id) ||
        { min:-MUSIC_X_OFFSET_MAX, max:MUSIC_X_OFFSET_MAX, applied:musicClampXOffset(existing.note.xOffset) };
      const box = staveBoxes.find((item) => item.index === existing.measureIndex);
      if (!point) return;
      select(existing.measureIndex, existing.note.id, { scroll:false });
      noteDrag = {
        pointerId:event.pointerId,
        kind:horizontalDrag ? "horizontal" : "pitch",
        note:existing.note,
        measureIndex:existing.measureIndex,
        startX:point.x,
        startY:point.y,
        startPitch:{ step:existing.note.step, octave:existing.note.octave, alter:existing.note.alter },
        spacing:box && box.spacing,
        startOffset:limits.applied,
        min:limits.min,
        max:limits.max,
        appliedSteps:0,
        moved:false
      };
      closeMusicContextMenu();
      scoreHost.classList.add(horizontalDrag ? "is-positioning" : "is-pitching");
      if (scoreHost.setPointerCapture) scoreHost.setPointerCapture(event.pointerId);
      // 일반 클릭의 미리듣기는 뒤의 click 경로가 맡는다. 실제 이동이 시작된 뒤에만 기본 동작을 막는다.
      if (horizontalDrag) event.preventDefault();
      return;
    }
    if (event.pointerType === "touch" || !updateScorePanCursor(event)) return;
    scorePan = {
      pointerId:event.pointerId,
      x:event.clientX,
      y:event.clientY,
      left:scoreHost.scrollLeft,
      top:scoreHost.scrollTop,
      moved:false
    };
    if (scoreHost.setPointerCapture) scoreHost.setPointerCapture(event.pointerId);
  });

  scoreHost.addEventListener("pointermove", (event) => {
    if (noteDrag && noteDrag.pointerId === event.pointerId){
      const point = scorePoint(event);
      if (!point) return;
      if (noteDrag.kind === "pitch"){
        const dy = point.y - noteDrag.startY;
        if (!noteDrag.moved && Math.abs(dy) < 3) return;
        noteDrag.moved = true;
        const steps = -Math.round(dy / Math.max(1, (noteDrag.spacing || 10) / 2));
        const moved = musicShiftPitch(noteDrag.startPitch, steps);
        if (!moved){
          hidePitchGuide();
          setHoverReadout("음높이 이동 불가: 사용할 수 있는 음역을 벗어났어요", true);
          event.preventDefault();
          return;
        }
        if (steps !== noteDrag.appliedSteps){
          noteDrag.appliedSteps = steps;
          noteDrag.note.step = moved.step;
          noteDrag.note.octave = moved.octave;
          touch();
          drawScore();
        }
        const dragBox = staveBoxes.find((item) => item.index === noteDrag.measureIndex);
        updatePitchGuide(point, dragBox, false);
        scoreHost.classList.add("is-pitching");
        setHoverReadout("음높이 이동: " + musicSolfegeLabel(noteDrag.note), false);
        event.preventDefault();
        return;
      }
      const next = Math.max(noteDrag.min, Math.min(noteDrag.max,
        Math.round(noteDrag.startOffset + point.x - noteDrag.startX)));
      if (!noteDrag.moved && Math.abs(point.x - noteDrag.startX) < 2) return;
      noteDrag.moved = true;
      if (next) noteDrag.note.xOffset = next;
      else delete noteDrag.note.xOffset;
      touch();
      drawScore();
      scoreHost.classList.add("is-positioning");
      setHoverReadout(`위치 조정: ${next > 0 ? "+" : ""}${next}`, false);
      event.preventDefault();
      return;
    }
    // 손가락은 hover가 없고 움직임이 스크롤이므로 마우스·펜의 공중 이동만 안내한다.
    if (event.pointerType === "touch") return;
    if (scorePan && scorePan.pointerId === event.pointerId){
      const dx = event.clientX - scorePan.x;
      const dy = event.clientY - scorePan.y;
      if (!scorePan.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      scorePan.moved = true;
      scoreHost.classList.remove("is-pan-ready");
      scoreHost.classList.add("is-panning");
      scoreHost.scrollLeft = scorePan.left - dx;
      scoreHost.scrollTop = scorePan.top - dy;
      event.preventDefault();
      return;
    }
    updateScorePanCursor(event);
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    const existing = noteByElement(target);
    if (existing){
      hidePitchGuide();
      setHoverReadout((tool.eraser ? "지우기: " : tool.position ? "위치 조정: " : existing.note.rest ? "현재 쉼표: " : "위아래로 드래그: ")
        + musicSolfegeLabel(existing.note), false);
      return;
    }
    if (tool.eraser || tool.position){ resetHoverReadout(); return; }

    const point = scorePoint(event);
    const box = staveBoxAtPoint(point);
    const pitch = pitchAtScorePoint(point, box);
    if (!box || !pitch){ resetHoverReadout(); return; }

    const preview = tool.rest
      ? { rest:true, value:tool.value, dots:tool.dots }
      : { rest:false, step:pitch.step, octave:pitch.octave,
          alter:toolAlterForPitch(pitch), value:tool.value, dots:tool.dots };
    const midi = musicMidiNumber(preview);
    if (!tool.rest && !musicMidiInRange(midi)){
      updatePitchGuide(point, box, true);
      setHoverReadout("입력 불가: 사용할 수 있는 음역을 벗어났어요", true);
      return;
    }
    if (!musicCanFit(sheet, box.index, preview)){
      if (!tool.rest) updatePitchGuide(point, box, true);
      setHoverReadout(`입력 불가: ${box.index + 1}마디가 가득 찼어요`, true);
      return;
    }
    if (tool.rest) hidePitchGuide();
    else updatePitchGuide(point, box, false);
    setHoverReadout("입력 위치: " + musicSolfegeLabel(preview), false);
  });

  function finishNoteDrag(event){
    if (!noteDrag || noteDrag.pointerId !== event.pointerId) return;
    const moved = noteDrag.moved;
    const pitchChanged = noteDrag.kind === "pitch" && noteDrag.appliedSteps !== 0;
    const draggedNote = noteDrag.note;
    noteDrag = null;
    scoreHost.classList.remove("is-positioning", "is-pitching");
    hidePitchGuide();
    if (scoreHost.hasPointerCapture && scoreHost.hasPointerCapture(event.pointerId)){
      scoreHost.releasePointerCapture(event.pointerId);
    }
    if (moved){
      if (history && !history.isApplying()) history.commit();
      if (pitchChanged) MNMusicAudio.previewNote(draggedNote, sheet.timbre);
      suppressScoreClick = true;
      setTimeout(() => { suppressScoreClick = false; }, 0);
      event.preventDefault();
    }
    resetHoverReadout();
  }

  function finishScorePan(event){
    if (!scorePan || scorePan.pointerId !== event.pointerId) return;
    const moved = scorePan.moved;
    scorePan = null;
    scoreHost.classList.remove("is-panning");
    if (scoreHost.hasPointerCapture && scoreHost.hasPointerCapture(event.pointerId)){
      scoreHost.releasePointerCapture(event.pointerId);
    }
    if (moved){
      suppressScoreClick = true;
      setTimeout(() => { suppressScoreClick = false; }, 0);
      event.preventDefault();
    }
    if (event.type !== "pointercancel") updateScorePanCursor(event);
  }
  function finishScorePointer(event){
    finishNoteDrag(event);
    finishScorePan(event);
  }
  scoreHost.addEventListener("pointerup", finishScorePointer);
  scoreHost.addEventListener("pointercancel", finishScorePointer);
  scoreHost.addEventListener("pointerleave", () => {
    if (!noteDrag) resetHoverReadout();
    if (!scorePan) scoreHost.classList.remove("is-pan-ready");
  });

  scoreHost.addEventListener("click", (event) => {
    hidePitchGuide();
    if (suppressScoreClick){
      suppressScoreClick = false;
      event.preventDefault();
      return;
    }
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    if (target){
      const measureIndex = (Number(target.dataset.measure) || 1) - 1;
      if (tool.eraser){ deleteNote(measureIndex, target.dataset.noteId); return; }
      select(measureIndex, target.dataset.noteId, { scroll:false });
      fromInput.value = String(measureIndex + 1);
      if (Number(toInput.value) < measureIndex + 1) toInput.value = String(measureIndex + 1);
      const note = selectedNote();
      if (note && !note.rest) MNMusicAudio.previewNote(note, sheet.timbre);
      return;
    }
    if (tool.eraser || tool.position) return;
    const point = scorePoint(event);
    if (!point) return;
    const box = staveBoxAtPoint(point);
    const pitch = pitchAtScorePoint(point, box);
    if (!box || !pitch) return;
    const midi = musicMidiNumber({ step:pitch.step, octave:pitch.octave, alter:toolAlterForPitch(pitch) });
    if (!tool.rest && !musicMidiInRange(midi)){
      if (typeof toast === "function") toast("이 악보에서 쓸 수 있는 음역을 벗어나요.", 2200);
      return;
    }
    insertNote(box.index, pitch);
  });

  // 긴 악보는 일반 휠로 위아래 움직여야 하므로 Ctrl(맥은 Command)+휠일 때만 배율을 바꾼다.
  scoreHost.addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    stepScoreZoom(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
  }, { passive:false });

  /* ----- 자판 ----- */
  function editableTarget(target){
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  function onKeyDown(event){
    if (doc.el.hidden) return;                       // 다른 문서를 보고 있으면 관여하지 않는다
    if (editableTarget(event.target)) return;
    if (contextLayers.length) return;                 // 메뉴가 열려 있으면 버튼 탐색·Esc 닫기를 메뉴에 맡긴다
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")){
      event.preventDefault();
      openKeyboardScoreContextMenu();
      return;
    }
    if (event.ctrlKey || event.metaKey){
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey){ event.preventDefault(); history.undo(); return; }
      if (key === "y" || (key === "z" && event.shiftKey)){ event.preventDefault(); history.redo(); return; }
      if (key === "=" || key === "+"){ event.preventDefault(); stepScoreZoom(1); return; }
      if (key === "-"){ event.preventDefault(); stepScoreZoom(-1); return; }
      if (key === "0"){ event.preventDefault(); setScoreZoom(1); return; }
      return;
    }
    if (event.altKey) return;

    const index = ["1", "2", "3", "4", "5"].indexOf(event.key);
    if (index >= 0){ setToolValue(MUSIC_TOOL_VALUES[index].value); event.preventDefault(); return; }
    switch (event.key){
      case "r": case "R":
        setToolRest(!tool.rest); event.preventDefault(); break;
      case ".":
        setToolDots((tool.dots + 1) % (MUSIC_MAX_DOTS + 1)); event.preventDefault(); break;
      case "ArrowUp":
        shiftSelected(event.shiftKey ? 7 : 1); event.preventDefault(); break;
      case "ArrowDown":
        shiftSelected(event.shiftKey ? -7 : -1); event.preventDefault(); break;
      case "ArrowLeft":
        moveSelection(-1); event.preventDefault(); break;
      case "ArrowRight":
        moveSelection(1); event.preventDefault(); break;
      case "Delete": case "Backspace":
        if (selection){ deleteNote(selection.measure, selection.id); event.preventDefault(); }
        break;
      case "Escape":
        select(0, null); break;
      default: break;
    }
  }

  /* ----- 재생 ----- */
  function highlight(event){
    for (const el of noteEls.values()) el.classList.remove("is-playing");
    for (const el of solfegeEls.values()) el.classList.remove("is-playing");
    if (!event) return;
    const el = noteEls.get(event.id);
    if (!el) return;
    el.classList.add("is-playing");
    const label = solfegeEls.get(event.id);
    if (label) label.classList.add("is-playing");
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block:"nearest", inline:"nearest" });
  }

  function setPlaying(on){
    stopBtn.disabled = !on;
    playAllBtn.disabled = on;
    playPartBtn.disabled = on;
    // 재생 중에는 대기 화면이 뜨지 않아야 한다. screensaverBusy() 가 이미 .is-running 을
    // "실행 중"으로 보고 있어서(파이썬·노트북과 같은 규칙) 이 클래스만 붙였다 떼면 된다.
    root.classList.toggle("is-running", on);
  }

  async function startPlay(range){
    setPlaying(true);
    if (sheet.timbre === "piano" || sheet.timbre === "guitar"){
      status.textContent = (sheet.timbre === "guitar" ? "기타" : "피아노") + " 음원 준비 중…";
    }
    try {
      const handle = await MNMusicAudio.play(sheet, Object.assign({
        onNote:highlight,
        onEnd:() => { highlight(null); setPlaying(false); updateStatus(); },
        onError:(error, timbre) => {
          const label = timbre === "guitar" ? "기타" : "피아노";
          if (typeof toast === "function") toast(label + " 음원을 읽지 못해 삼각파로 재생해요.", 3200);
          console.warn(label + " 음원을 읽지 못했습니다:", error);
        }
      }, range || {}));
      if (!handle){
        setPlaying(false);
        updateStatus();
        if (!MNMusicAudio.supported() && typeof toast === "function"){
          toast("소리를 낼 수 없어요(브라우저가 Web Audio 를 지원하지 않아요).", 3000);
        }
        return;
      }
      updateStatus();
    } catch(error){
      setPlaying(false);
      updateStatus();
      if (typeof toast === "function") toast(error && error.message ? error.message : "재생하지 못했어요.", 3000);
    }
  }

  playAllBtn.addEventListener("click", () => startPlay(null));
  playPartBtn.addEventListener("click", () => startPlay(clampRange()));
  stopBtn.addEventListener("click", () => MNMusicAudio.stop());
  undoBtn.addEventListener("click", () => history.undo());
  redoBtn.addEventListener("click", () => history.redo());
  zoomOutBtn.addEventListener("click", () => stepScoreZoom(-1));
  zoomInBtn.addEventListener("click", () => stepScoreZoom(1));
  zoomFitBtn.addEventListener("click", () => setScoreZoom(1));

  musicXmlBtn.addEventListener("click", () => {
    try {
      const xml = musicSerializeXml(sheet);
      musicDownloadBlob(musicExportName(doc, "musicxml"),
        new Blob([xml], { type:"application/vnd.recordare.musicxml+xml;charset=utf-8" }));
      const hasFinePosition = sheet.measures.some((measure) => measure.notes.some((note) => musicClampXOffset(note.xOffset)));
      if (typeof toast === "function"){
        toast(hasFinePosition
          ? "MusicXML로 저장했어요. 좌우 미세 위치는 다른 프로그램의 자동 조판에 따라 달라질 수 있어요."
          : "다른 악보 프로그램에서 열 수 있는 MusicXML로 저장했어요.", hasFinePosition ? 4200 : 2600);
      }
    } catch(error){
      if (typeof toast === "function") toast(error && error.message ? error.message : "MusicXML 저장에 실패했어요.", 3000, { type:"error" });
    }
  });

  wavBtn.addEventListener("click", async () => {
    const previous = wavBtn.textContent;
    wavBtn.disabled = true;
    wavBtn.textContent = "만드는 중…";
    try {
      const blob = await MNMusicAudio.renderWav(sheet, {
        onError:(error, timbre) => {
          const label = timbre === "guitar" ? "기타" : "피아노";
          if (typeof toast === "function") toast(label + " 음원을 읽지 못해 삼각파 WAV로 저장해요.", 3200);
          console.warn(label + " WAV 음원을 읽지 못했습니다:", error);
        }
      });
      musicDownloadBlob(musicExportName(doc, "wav"), blob);
      if (typeof toast === "function") toast("WAV 파일로 저장했어요.", 2400);
    } catch(error){
      if (typeof toast === "function"){
        toast(error && error.message ? error.message : "WAV 저장에 실패했어요.", 3000, { type:"error" });
      }
    } finally {
      wavBtn.disabled = false;
      wavBtn.textContent = previous;
    }
  });

  for (const input of [fromInput, toInput]) input.addEventListener("change", clampRange);

  /* ----- 인쇄 -----
     VexFlow 5 는 음표를 Bravura 글꼴의 글자로 그린다. 그래서 새 창·iframe 으로 SVG 만 옮기면
     그 문서에는 글꼴이 없어 악보가 깨진다. 화이트보드(printBoard)와 같은 방식으로
     이 문서 안에 인쇄용 층을 만들고 나머지를 숨긴다 — 글꼴이 그대로 살아 있다.
     PDF 는 인쇄 대화상자의 'PDF로 저장'으로 만든다(별도 내보내기를 두지 않는 이유). */
  function printScore(){
    const svg = scoreHost.querySelector("svg");
    if (!svg){
      if (typeof toast === "function") toast("인쇄할 악보가 아직 그려지지 않았어요.", 2400);
      return;
    }
    const old = document.getElementById("musicPrintLayer");
    if (old) old.remove();
    const layer = document.createElement("div");
    layer.id = "musicPrintLayer";
    layer.className = "music-print";
    const heading = document.createElement("h1");
    heading.textContent = sheet.title || "악보";
    const sub = document.createElement("div");
    sub.className = "music-print-sub";
    sub.textContent = `♩=${sheet.tempo} · ${sheet.time.beats}/${sheet.time.beatValue} · ${(MUSIC_KEYS[sheet.key] || MUSIC_KEYS.C).label}`;
    const copy = svg.cloneNode(true);
    // 화면 확대는 보기 상태일 뿐이다. 인쇄본은 VexFlow의 원래 크기로 되돌려 종이에 맞춘다.
    copy.style.removeProperty("width");
    copy.style.removeProperty("height");
    copy.style.removeProperty("max-width");
    // 화면에서 고르거나 재생 중이던 표시는 종이에 남기지 않는다.
    copy.querySelectorAll(".is-selected,.is-playing").forEach((el) => el.classList.remove("is-selected", "is-playing"));
    layer.append(heading, sub, copy);
    document.body.appendChild(layer);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", cleanup);
      document.body.classList.remove("music-printing");
      layer.remove();
    };
    try {
      window.addEventListener("afterprint", cleanup);
      document.body.classList.add("music-printing");
      window.print();          // 크로미움에서는 인쇄창이 닫힐 때까지 여기서 멈춘다
    } catch(e){ console.error(e); }
    finally { cleanup(); }
  }
  printBtn.addEventListener("click", printScore);
  doc.printScore = printScore;      // 머리말 🖨 버튼(app.js)도 같은 경로를 쓴다

  /* ----- 되돌리기 -----
     스냅샷은 악보 JSON 문자열 하나다(가볍고 비교가 정확하다). */
  history = MNEditHistory.create({
    capture:() => musicSerialize(sheet),
    isEqual:(a, b) => a === b,
    apply:(state) => {
      const restored = musicParse(state);
      sheet.title = restored.title;
      sheet.tempo = restored.tempo;
      sheet.time = restored.time;
      sheet.key = restored.key;
      sheet.timbre = restored.timbre;
      sheet.showSolfege = restored.showSolfege;
      sheet.measures = restored.measures;
      titleInput.value = sheet.title;
      tempoInput.value = String(sheet.tempo);
      timeSelect.value = `${sheet.time.beats}/${sheet.time.beatValue}`;
      keySelect.value = sheet.key;
      timbreSelect.value = sheet.timbre;
      selection = null;
      syncTools();
      afterEdit();
    },
    onChange:updateHistoryButtons,
    limit:MUSIC_HISTORY_LIMIT
  });
  doc._musicHistory = history;
  history.reset();

  /* ----- 정리 ----- */
  document.addEventListener("keydown", onKeyDown, true);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(redrawTimer);
    noteDrag = null;
    scorePan = null;
    closeMusicContextMenu();
    scoreHost.removeEventListener("contextmenu", onScoreContextMenu);
    scoreHost.removeEventListener("scroll", closeMusicContextMenu);
    document.removeEventListener("keydown", onKeyDown, true);
    if (history) history.cancel();
    doc._musicHistory = null;
    MNMusicAudio.stop();
  });
  if (typeof ResizeObserver === "function"){
    const observer = new ResizeObserver(scheduleRedraw);
    observer.observe(scoreHost);
    doc.cleanupFns.push(() => observer.disconnect());
  }

  clampRange();
  updateStatus();
  syncTools();
  updateHistoryButtons();
  updateZoomControls();

  scoreHost.textContent = "악보를 준비하는 중…";
  const ready = await MNLazy.tryNeed("vexflow");
  if (!ready){
    scoreHost.textContent = "악보 그리기 라이브러리를 불러오지 못했어요. 재생과 저장은 그대로 쓸 수 있어요.";
    return;
  }
  drawScore();
}
