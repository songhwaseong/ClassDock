"use strict";

/* ===== 암기 카드·오답 복습(.study) ===== */
const STUDY_DOC_TYPE = "classdock-study";
const STUDY_DOC_VERSION = 1;
const STUDY_MAX_CARDS = 1000;
const STUDY_HISTORY_LIMIT = 45;
const STUDY_RECOVERY_DELAY = 700;
let _studyScratchCount = 0;

function studyId(){ return "sc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function studyText(value, max){ return String(value == null ? "" : value).slice(0, max); }
function studyNormalizeImage(raw){
  const value = raw && typeof raw === "object" ? raw : null, dataUrl = value ? String(value.dataUrl || "") : "";
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl) || dataUrl.length > 900 * 1024) return null;
  return { name:studyText(value.name || "사진", 120), dataUrl, width:Math.max(1, Math.min(10000, Number(value.width) || 1)), height:Math.max(1, Math.min(10000, Number(value.height) || 1)) };
}
function studyNormalizeCard(raw){
  const value = raw && typeof raw === "object" ? raw : {}, result = ["again", "hard", "good"].includes(value.result) ? value.result : "new";
  return { id:studyText(value.id, 80) || studyId(), type:value.type === "cloze" ? "cloze" : "qa", front:studyText(value.front, 3000), back:studyText(value.back, 3000),
    note:studyText(value.note, 3000), tags:studyText(value.tags, 300).trim(), image:studyNormalizeImage(value.image), result,
    reviews:Math.max(0, Math.min(100000, Math.floor(Number(value.reviews) || 0))), streak:Math.max(0, Math.min(1000, Math.floor(Number(value.streak) || 0))),
    due:/^\d{4}-\d{2}-\d{2}$/.test(String(value.due || "")) ? String(value.due) : "", lastReviewed:/^\d{4}-\d{2}-\d{2}$/.test(String(value.lastReviewed || "")) ? String(value.lastReviewed) : "" };
}
function studyDocEmpty(title){ return { type:STUDY_DOC_TYPE, version:STUDY_DOC_VERSION, title:studyText(title || "암기 카드", 160), cards:[] }; }
function studyDocParse(text){
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!raw || raw.type !== STUDY_DOC_TYPE || !Array.isArray(raw.cards)) throw new Error("study-format");
  if (raw.cards.length > STUDY_MAX_CARDS) throw new Error("study-limit");
  const model = studyDocEmpty(raw.title), ids = new Set(); model.cards = raw.cards.map(studyNormalizeCard).filter(card => card.front && !ids.has(card.id) && ids.add(card.id)); return model;
}
function studyDocSerialize(model){ return JSON.stringify(studyDocParse({ ...model, type:STUDY_DOC_TYPE, version:STUDY_DOC_VERSION }), null, 2); }
function studyClozeParts(card){
  const source = String(card && card.front || ""), answers = []; const question = source.replace(/\{\{([^{}]+)\}\}/g, (_all, answer) => { answers.push(answer.trim()); return "＿＿＿＿"; });
  return { question, answer:answers.length ? answers.join(" · ") : String(card && card.back || ""), hasCloze:answers.length > 0 };
}
function studyToday(now){ const date = now instanceof Date ? now : new Date(now == null ? Date.now() : now); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }
function studyAddDays(day, count){ const parts = String(day).split("-").map(Number), date = new Date(parts[0], parts[1] - 1, parts[2]); date.setDate(date.getDate() + count); return studyToday(date); }
function studyRateCard(card, rating, now){
  const target = card, today = studyToday(now); target.reviews = (Number(target.reviews) || 0) + 1; target.lastReviewed = today;
  if (rating === "again"){ target.result = "again"; target.streak = 0; target.due = today; }
  else if (rating === "hard"){ target.result = "hard"; target.streak = Math.max(0, Number(target.streak) || 0); target.due = studyAddDays(today, 1); }
  else { target.result = "good"; target.streak = (Number(target.streak) || 0) + 1; const intervals = [3, 7, 14, 30, 60, 90]; target.due = studyAddDays(today, intervals[Math.min(intervals.length - 1, target.streak - 1)]); }
  return target;
}
function studyFilterCards(cards, filter, now){
  const today = studyToday(now), list = cards || [];
  if (filter === "wrong") return list.filter(card => card.result === "again");
  if (filter === "hard") return list.filter(card => card.result === "hard");
  if (filter === "due") return list.filter(card => !card.due || card.due <= today);
  if (filter === "new") return list.filter(card => card.result === "new");
  return [...list];
}
function studyShuffle(items, random=Math.random){ const list = [...items]; for (let i = list.length - 1; i > 0; i--){ const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; }
function studyCsvEscape(value){ const text = String(value == null ? "" : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
function studyCardsToCsv(cards){ return ["질문,정답,설명,태그,유형", ...(cards || []).map(card => [card.front, card.back, card.note, card.tags, card.type === "cloze" ? "빈칸" : "문답"].map(studyCsvEscape).join(","))].join("\r\n"); }
function studyCsvRows(text){
  const rows = [], row = []; let field = "", quoted = false; const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i <= source.length; i++){
    const ch = source[i]; if (quoted){ if (ch === '"' && source[i + 1] === '"'){ field += '"'; i++; } else if (ch === '"') quoted = false; else if (ch == null) break; else field += ch; }
    else if (ch === '"') quoted = true; else if (ch === ","){ row.push(field); field = ""; } else if (ch === "\n" || ch == null){ row.push(field.replace(/\r$/, "")); rows.push(row.splice(0)); field = ""; } else field += ch;
  }
  return rows.filter(values => values.some(value => value.trim()));
}
function studyCardsFromCsv(text){
  const rows = studyCsvRows(text); if (!rows.length) return [];
  const head = rows.shift().map(value => value.trim().toLowerCase()), index = names => head.findIndex(value => names.includes(value));
  const q = index(["질문", "앞면", "단어", "question", "front"]), a = index(["정답", "뒷면", "뜻", "answer", "back"]), n = index(["설명", "해설", "note"]), t = index(["태그", "tags"]), y = index(["유형", "type"]);
  if (q < 0 || a < 0) throw new Error("csv-columns");
  return rows.map(values => studyNormalizeCard({ front:values[q], back:values[a], note:n >= 0 ? values[n] : "", tags:t >= 0 ? values[t] : "", type:y >= 0 && /빈칸|cloze/i.test(values[y]) ? "cloze" : "qa" })).filter(card => card.front);
}
function studySearchText(model){ return [model.title, ...(model.cards || []).flatMap(card => [card.front, card.back, card.note, card.tags])].filter(Boolean).join("\n"); }
function studyDefaultTitle(name){ return String(name || "").replace(/\.study$/i, "") || "암기 카드"; }
function studyScratchFileName(number){ return number > 1 ? "암기 카드 " + number + ".study" : "암기 카드.study"; }

async function loadStudyDoc(file, opts = {}){
  let model; try { model = studyDocParse(await file.text()); }
  catch(_){ if (typeof toast === "function") toast("암기 카드(.study)를 읽지 못해 텍스트로 열었어요.", 3600); return typeof loadText === "function" ? loadText(file, opts) : null; }
  if (!model.title) model.title = studyDefaultTitle(file.name);
  const doc = makeDoc("study", file.name, opts); doc.studyDoc = model; doc.sourceFile = file; doc.savedText = studyDocSerialize(model); doc._studySavedSnapshot = JSON.stringify(model);
  doc.contentSearchFocus = query => { const needle = String(query || "").trim().toLowerCase(), found = model.cards.find(card => [card.front, card.back, card.note, card.tags].join(" ").toLowerCase().includes(needle)); if (!found || typeof doc.studySelectCard !== "function") return false; doc.studySelectCard(found.id); return true; };
  doc.render = async () => { if (doc._studyMounted) return; doc._studyMounted = true; doc.el.innerHTML = ""; mountStudyEditor(doc); };
  if (typeof refreshChrome === "function") refreshChrome(); if (typeof activateIfIdle === "function") activateIfIdle(doc, opts); return doc;
}
function newStudyScratch(){
  _studyScratchCount++; const name = studyScratchFileName(_studyScratchCount); if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([studyDocSerialize(studyDocEmpty(studyDefaultTitle(name)))], name, { type:"application/json" })], { isScratch:true }));
}
function newStudyScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, studyScratchFileName, name => studyDocSerialize(studyDocEmpty(studyDefaultTitle(name))), "application/json", "암기 카드");
}
async function saveStudyDoc(doc){
  if (!doc || !doc.studyDoc) return false; const json = studyDocSerialize(doc.studyDoc), ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false; if (!ok) return false;
  doc.savedText = json; doc._studySavedSnapshot = JSON.stringify(doc.studyDoc); if (doc._studyHistory) doc._studyHistory.replaceCurrent(doc._studySavedSnapshot);
  if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json"); else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false); return true;
}
function studyButton(label, title, className){ const button = document.createElement("button"); button.type = "button"; button.className = className || "study-btn"; button.textContent = label; if (title) button.title = title; return button; }
function studyModal(titleText, body){
  const modal = document.createElement("div"); modal.className = "study-modal"; const card = document.createElement("div"); card.className = "study-modal-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
  const head = document.createElement("header"), h = document.createElement("h2"), close = studyButton("×", "닫기", "study-modal-x"); h.textContent = titleText; head.append(h, close); card.append(head, body); modal.appendChild(card); document.body.appendChild(modal);
  const dispose = () => modal.remove(); close.onclick = dispose; modal.addEventListener("pointerdown", event => { if (event.target === modal) dispose(); }); modal.addEventListener("keydown", event => { if (event.key === "Escape"){ event.preventDefault(); dispose(); } }); return { modal, dispose };
}
function studyDownload(name, blob){ MNDownload.saveBlob(blob, name); }

function mountStudyEditor(doc){
  const model = doc.studyDoc, root = document.createElement("div"); root.className = "study-doc"; doc.el.appendChild(root);
  const bar = document.createElement("div"); bar.className = "study-bar"; const titleInput = document.createElement("input"); titleInput.className = "study-title"; titleInput.value = model.title; titleInput.maxLength = 160; titleInput.placeholder = "암기장 제목";
  const addBtn = studyButton("＋ 카드", "새 암기 카드 추가", "study-btn study-primary"), undoBtn = studyButton("↶", "실행 취소"), redoBtn = studyButton("↷", "다시 실행");
  const search = document.createElement("input"); search.type = "search"; search.className = "study-search"; search.placeholder = "질문·정답·태그 검색";
  const filter = document.createElement("select"); filter.className = "study-filter"; [["all","전체"],["due","오늘 복습"],["wrong","틀린 카드"],["hard","헷갈린 카드"],["new","새 카드"]].forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; filter.appendChild(option); });
  const shuffleCheck = document.createElement("label"); shuffleCheck.className = "study-shuffle"; shuffleCheck.innerHTML = '<input type="checkbox"> 순서 섞기';
  const learnBtn = studyButton("▶ 학습 시작", "고른 카드로 암기 학습 시작", "study-btn study-primary"), csvInBtn = studyButton("CSV 들이기", "질문·정답 표 가져오기"), csvOutBtn = studyButton("CSV 내보내기", "카드 목록을 CSV로 저장"), saveBtn = studyButton("저장", "암기 카드 저장 (Ctrl+S)", "study-btn study-primary run-save");
  bar.append(titleInput, addBtn, undoBtn, redoBtn, search, filter, shuffleCheck, learnBtn, csvInBtn, csvOutBtn, saveBtn);
  const summary = document.createElement("div"); summary.className = "study-summary"; const list = document.createElement("div"); list.className = "study-list";
  const csvInput = document.createElement("input"); csvInput.type = "file"; csvInput.accept = ".csv,text/csv"; csvInput.hidden = true; root.append(bar, summary, list, csvInput);
  let selectedId = "", history = null, recoveryTimer = 0;
  const snapshot = () => JSON.stringify(model);
  const flushRecovery = async () => { clearTimeout(recoveryTimer); recoveryTimer = 0; if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true; if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try { const file = recoverySnapshotFile(doc, new TextEncoder().encode(studyDocSerialize(model)), "application/json"); doc.savedInWorkspace = file ? await rememberWorkspace([file], false, { silent:true }) : false; return !!doc.savedInWorkspace; } catch(error){ console.warn("암기 카드 복구본 저장 실패:", error); return false; } };
  const touch = () => { if (typeof markDocumentDirty === "function") markDocumentDirty(doc, snapshot() !== doc._studySavedSnapshot); clearTimeout(recoveryTimer); recoveryTimer = setTimeout(flushRecovery, STUDY_RECOVERY_DELAY); };
  doc.flushBackupRecovery = flushRecovery;
  const replaceModel = value => { const restored = studyDocParse(value); model.title = restored.title; model.cards = restored.cards; titleInput.value = model.title; if (selectedId && !model.cards.some(card => card.id === selectedId)) selectedId = ""; render(); touch(); };
  history = MNEditHistory.create({ capture:snapshot, isEqual:(a, b) => a === b, apply:replaceModel, onChange:() => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); }, limit:STUDY_HISTORY_LIMIT }); history.reset(); doc._studyHistory = history;

  function render(){
    const query = search.value.trim().toLowerCase(), visible = model.cards.filter(card => !query || [card.front, card.back, card.note, card.tags].join(" ").toLowerCase().includes(query));
    const counts = { again:model.cards.filter(card => card.result === "again").length, hard:model.cards.filter(card => card.result === "hard").length, due:studyFilterCards(model.cards, "due").length };
    summary.innerHTML = `<strong>${model.cards.length}장</strong><span>오늘 복습 ${counts.due}</span><span>틀림 ${counts.again}</span><span>헷갈림 ${counts.hard}</span>`; list.innerHTML = "";
    visible.forEach((card, index) => {
      const item = document.createElement("article"); item.className = "study-list-card" + (selectedId === card.id ? " is-selected" : ""); item.dataset.cardId = card.id;
      const stateLabel = card.result === "again" ? "틀림" : card.result === "hard" ? "헷갈림" : card.result === "good" ? "알아요" : "새 카드";
      item.innerHTML = `<div class="study-list-num">${index + 1}</div><div class="study-list-content"><div><span class="study-type">${card.type === "cloze" ? "빈칸" : "문답"}</span><span class="study-state is-${card.result}">${stateLabel}</span>${card.tags ? `<span class="study-tags"></span>` : ""}</div><h3></h3><p></p><small>${card.due ? "다음 복습 " + card.due : "아직 학습하지 않음"}</small></div><button type="button" class="study-card-edit">수정</button>`;
      item.querySelector("h3").textContent = card.type === "cloze" ? studyClozeParts(card).question : card.front; item.querySelector("p").textContent = card.back || (card.type === "cloze" ? studyClozeParts(card).answer : "정답 없음"); if (card.tags) item.querySelector(".study-tags").textContent = card.tags;
      item.title = "클릭하면 이 카드부터 학습 화면으로 봅니다";
      item.onclick = event => { selectedId = card.id; if (event.target.closest(".study-card-edit")) openCardDialog(card.id); else startSession(visible.slice(index)); }; list.appendChild(item);
    });
    if (!visible.length){ const empty = studyButton(query ? "검색 결과가 없습니다" : "＋ 첫 암기 카드를 만드세요", "카드 추가", "study-empty"); if (!query) empty.onclick = () => openCardDialog(); list.appendChild(empty); }
  }
  doc.studySelectCard = id => { const card = model.cards.find(item => item.id === id); if (!card) return false; selectedId = id; search.value = ""; render(); const el = list.querySelector(`[data-card-id="${CSS.escape(id)}"]`); if (el) el.scrollIntoView({ behavior:"smooth", block:"center" }); return true; };

  function openCardDialog(id){
    const current = model.cards.find(card => card.id === id) || null, body = document.createElement("div"); body.className = "study-form";
    body.innerHTML = '<label><span>카드 유형</span><select class="sc-type"><option value="qa">문답</option><option value="cloze">빈칸</option></select></label><label><span>태그</span><input class="sc-tags" maxlength="300" placeholder="예: 한국사 조선"></label><label class="wide"><span class="sc-front-label">질문</span><textarea class="sc-front" rows="5" maxlength="3000"></textarea><small class="sc-cloze-hint">빈칸으로 가릴 말은 {{정답}}처럼 감싸세요.</small></label><label class="wide"><span>정답</span><textarea class="sc-back" rows="4" maxlength="3000"></textarea></label><label class="wide"><span>해설·메모</span><textarea class="sc-note" rows="4" maxlength="3000"></textarea></label><div class="study-photo wide"><span>사진</span><div class="sc-photo-preview"></div><button type="button" class="sc-photo-pick">사진 넣기</button><button type="button" class="sc-photo-remove">지우기</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden></div><p class="study-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="sc-delete danger">삭제</button><span></span><button type="button" class="sc-cancel">취소</button><button type="button" class="sc-save primary">저장</button></footer>';
    const ui = studyModal(current ? "카드 수정" : "새 암기 카드", body), type = body.querySelector(".sc-type"), front = body.querySelector(".sc-front"), back = body.querySelector(".sc-back"), note = body.querySelector(".sc-note"), tags = body.querySelector(".sc-tags"); let image = current && current.image ? current.image : null;
    type.value = current ? current.type : "qa"; front.value = current ? current.front : ""; back.value = current ? current.back : ""; note.value = current ? current.note : ""; tags.value = current ? current.tags : "";
    const syncType = () => { body.querySelector(".sc-front-label").textContent = type.value === "cloze" ? "빈칸 문장" : "질문"; body.querySelector(".sc-cloze-hint").hidden = type.value !== "cloze"; }; type.onchange = syncType; syncType();
    const preview = body.querySelector(".sc-photo-preview"), photoInput = body.querySelector("input[type=file]"), showPhoto = () => { preview.innerHTML = ""; if (image){ const img = document.createElement("img"); img.src = image.dataUrl; img.alt = "선택한 사진"; preview.appendChild(img); } else preview.textContent = "사진 없음"; }; showPhoto();
    body.querySelector(".sc-photo-pick").onclick = () => photoInput.click(); body.querySelector(".sc-photo-remove").onclick = () => { image = null; showPhoto(); }; photoInput.onchange = async () => { const file = photoInput.files && photoInput.files[0]; if (!file) return; try { if (typeof timelinePreparePhoto !== "function") throw new Error("photo-runtime"); image = await timelinePreparePhoto(file); showPhoto(); } catch(_){ body.querySelector(".study-form-error").textContent = "사진을 넣지 못했어요."; } };
    body.querySelector(".sc-cancel").onclick = ui.dispose; const del = body.querySelector(".sc-delete"); del.hidden = !current; del.onclick = async () => { if (await deleteCard(current.id)) ui.dispose(); };
    body.querySelector(".sc-save").onclick = () => { if (!front.value.trim()){ body.querySelector(".study-form-error").textContent = "질문이나 빈칸 문장을 입력하세요."; front.focus(); return; } if (type.value === "cloze" && !studyClozeParts({ front:front.value }).hasCloze){ body.querySelector(".study-form-error").textContent = "가릴 정답을 {{정답}}처럼 하나 이상 표시하세요."; return; }
      if (current) Object.assign(current, { type:type.value, front:front.value.trim(), back:back.value.trim(), note:note.value, tags:tags.value.trim(), image }); else { if (model.cards.length >= STUDY_MAX_CARDS) return; const card = studyNormalizeCard({ type:type.value, front:front.value.trim(), back:back.value.trim(), note:note.value, tags:tags.value.trim(), image }); model.cards.push(card); selectedId = card.id; } ui.dispose(); history.commit(); touch(); render(); };
    setTimeout(() => front.focus(), 0);
  }

  async function deleteCard(id){
    const card = model.cards.find(item => item.id === id); if (!card || typeof confirmDialog !== "function"
      || !await confirmDialog("이 카드를 삭제할까요?", "삭제", "취소")) return false;
    model.cards = model.cards.filter(item => item.id !== id); if (selectedId === id) selectedId = ""; history.commit(); touch(); render();
    if (typeof toast === "function") toast("카드를 삭제했어요. 되돌리려면 Ctrl+Z", 2600); return true;
  }

  function startSession(preset){
    let deck = Array.isArray(preset) ? preset.slice() : studyFilterCards(model.cards, filter.value); if (!preset && shuffleCheck.querySelector("input").checked) deck = studyShuffle(deck); if (!deck.length){ if (typeof toast === "function") toast("고른 조건에 학습할 카드가 없어요.", 2600); return; }
    let index = 0, revealed = false, rated = 0; const overlay = document.createElement("div"); overlay.className = "study-session";
    overlay.innerHTML = '<div class="study-session-top"><span class="study-session-count"></span><div class="study-session-progress"><i></i></div><button type="button" class="study-session-close">끝내기</button></div><article class="study-session-card"><small></small><div class="study-session-image"></div><h2></h2><div class="study-session-answer" hidden><strong>정답</strong><p></p><aside></aside></div><button type="button" class="study-reveal">정답 보기</button><div class="study-ratings" hidden><button type="button" data-rate="again">몰라요</button><button type="button" data-rate="hard">헷갈려요</button><button type="button" data-rate="good">알아요</button></div></article><div class="study-session-done" hidden><h2>복습 완료</h2><p></p><button type="button">목록으로 돌아가기</button></div>';
    root.appendChild(overlay); const close = () => { window.removeEventListener("keydown", keys); overlay.remove(); render(); };
    const show = () => { if (index >= deck.length){ overlay.querySelector(".study-session-card").hidden = true; const done = overlay.querySelector(".study-session-done"); done.hidden = false; done.querySelector("p").textContent = `${deck.length}장 중 ${rated}장을 평가했습니다.`; return; }
      const card = deck[index], cloze = studyClozeParts(card), question = card.type === "cloze" ? cloze.question : card.front, answer = card.type === "cloze" ? (cloze.answer + (card.back ? "\n" + card.back : "")) : card.back;
      revealed = false; overlay.querySelector(".study-session-count").textContent = `${index + 1} / ${deck.length}`; overlay.querySelector(".study-session-progress i").style.width = ((index / deck.length) * 100) + "%"; overlay.querySelector("small").textContent = card.tags || (card.type === "cloze" ? "빈칸 카드" : "문답 카드"); overlay.querySelector("h2").textContent = question;
      const image = overlay.querySelector(".study-session-image"); image.innerHTML = ""; image.hidden = !card.image; if (card.image){ const img = document.createElement("img"); img.src = card.image.dataUrl; img.alt = ""; image.appendChild(img); }
      overlay.querySelector(".study-session-answer p").textContent = answer || "정답이 입력되지 않았습니다."; overlay.querySelector(".study-session-answer aside").textContent = card.note; overlay.querySelector(".study-session-answer").hidden = true; overlay.querySelector(".study-reveal").hidden = false; overlay.querySelector(".study-ratings").hidden = true; };
    const reveal = () => { if (revealed) return; revealed = true; overlay.querySelector(".study-session-answer").hidden = false; overlay.querySelector(".study-reveal").hidden = true; overlay.querySelector(".study-ratings").hidden = false; };
    const rate = rating => { if (!revealed) return; studyRateCard(deck[index], rating); rated++; history.commit(); touch(); index++; show(); };
    const keys = event => { if (event.key === "Escape") close(); else if ((event.key === " " || event.key === "Enter") && !revealed){ event.preventDefault(); reveal(); } else if (revealed && ["1","2","3"].includes(event.key)){ event.preventDefault(); rate({ "1":"again", "2":"hard", "3":"good" }[event.key]); } };
    overlay.querySelector(".study-session-close").onclick = close; overlay.querySelector(".study-reveal").onclick = reveal; overlay.querySelectorAll("[data-rate]").forEach(button => button.onclick = () => rate(button.dataset.rate)); overlay.querySelector(".study-session-done button").onclick = close; window.addEventListener("keydown", keys); show();
  }
  addBtn.onclick = () => openCardDialog(); undoBtn.onclick = () => history.undo(); redoBtn.onclick = () => history.redo(); search.oninput = render; filter.onchange = render; learnBtn.onclick = () => startSession();
  titleInput.oninput = () => { model.title = titleInput.value; history.commitSoon(500); touch(); }; csvInBtn.onclick = () => csvInput.click(); csvInput.onchange = async () => { const file = csvInput.files && csvInput.files[0]; csvInput.value = ""; if (!file) return; try { const cards = studyCardsFromCsv(await file.text()); if (model.cards.length + cards.length > STUDY_MAX_CARDS) throw new Error("study-limit"); model.cards.push(...cards); history.commit(); touch(); render(); if (typeof toast === "function") toast(`카드 ${cards.length}장을 가져왔어요.`, 2800); } catch(error){ if (typeof toast === "function") toast(error.message === "csv-columns" ? "CSV에 ‘질문’과 ‘정답’ 열이 필요해요." : "CSV를 읽지 못했어요.", 3500, { type:"error" }); } };
  csvOutBtn.onclick = () => studyDownload((model.title || "암기 카드").replace(/[\\/:*?"<>|]+/g, "_") + ".csv", new Blob(["\uFEFF" + studyCardsToCsv(model.cards)], { type:"text/csv;charset=utf-8" })); saveBtn.onclick = () => saveStudyDoc(doc);
  const keydown = event => { if (doc.el.hidden || (event.target.closest && event.target.closest("input,textarea,select,[contenteditable=true]"))) return; const key = String(event.key || "").toLowerCase(); if ((event.ctrlKey || event.metaKey) && key === "z"){ event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); } else if ((event.ctrlKey || event.metaKey) && key === "y"){ event.preventDefault(); history.redo(); } else if (event.key === "Delete" && selectedId && !document.querySelector(".study-modal") && !root.querySelector(".study-session")) deleteCard(selectedId); };
  window.addEventListener("keydown", keydown); if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => { clearTimeout(recoveryTimer); if (history) history.cancel(); window.removeEventListener("keydown", keydown); if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; if (doc.studySelectCard) delete doc.studySelectCard; });
  render(); touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { STUDY_DOC_TYPE, STUDY_DOC_VERSION, studyNormalizeCard, studyDocEmpty, studyDocParse, studyDocSerialize,
    studyClozeParts, studyToday, studyAddDays, studyRateCard, studyFilterCards, studyShuffle, studyCardsToCsv, studyCardsFromCsv,
    studySearchText, studyDefaultTitle, studyScratchFileName };
}
