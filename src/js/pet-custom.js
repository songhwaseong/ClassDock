"use strict";

/* ===== 픽셀 펫 사용자 설정 — 대사 편집 + 나만의 펫 조합 =====
   순수 데이터(localStorage)와 편집 UI만 담는다. 이동·물리는 pet.js 가 담당한다.
   pet.js 는 스폰할 때 petSayingsFor()·petCustomSpecies() 를 불러 이 설정을 반영한다.
   - 1단계: 모든 펫이 함께 쓰는 전역 대사 추가/삭제
   - 2단계: 특정 종족(친구)에게만 붙는 대사
   - 3단계: 기존 그림·움직임·색·대사를 골라 만드는 나만의 펫(켜면 함께 돌아다닌다) */

const PET_USER_SAYINGS_KEY   = "mn.petUserSayings";     // 전역: ["대사", …]
const PET_SPECIES_SAYINGS_KEY = "mn.petSpeciesSayings"; // 종족별: { speciesId: ["대사", …] }
const PET_CUSTOM_KEY         = "mn.petCustom";          // 나만의 펫: [{ id,name,art,kind,palette,sayings }]

const PET_SAY_MAX_LEN = 40;      // 대사 한 줄 길이 상한
const PET_SAY_MAX_N   = 30;      // 목록당 대사 개수 상한
const PET_NAME_MAX_LEN = 12;     // 펫 이름 길이 상한
const PET_CUSTOM_MAX_N = 24;     // 만들 수 있는 나만의 펫 개수 상한

// 움직임(kind) → 사람이 읽는 이름. pet.js 의 엔진 목록과 1:1로 맞춘다.
const PET_KIND_LABELS = {
  climber:"벽 타기 (게·개미)", walker:"뚜벅뚜벅 걷기 (로봇)", hopper:"콩콩 뛰기 (토끼)",
  bouncer:"통통 튀기 (슬라임)", roller:"데굴데굴 구르기 (별)", ghost:"둥실 떠다니기 (유령)",
  ufo:"날며 광선 쏘기 (UFO)", cat:"커서 사냥 (고양이)", fluffyCat:"대각선 비행+그루밍 (복실고양이)", dog:"신나게 질주 (강아지)",
  spider:"거미줄 타기 (거미)", mole:"땅 파고 뿅 (두더지)", frog:"폴짝 대점프 (개구리)",
  penguin:"뒤뚱+배 미끄럼 (펭귄)", balloon:"풍선처럼 두둥실", snail:"느릿느릿 기기 (달팽이)",
  ninja:"순간이동 대시 (닌자)", bird:"훨훨 날기 (새)", chameleon:"색 바꾸기 (카멜레온)",
  wizard:"마법 순간이동 (마법사)", magnet:"자석으로 끌기", cloud:"번개 구름",
  rocket:"발사·낙하산 (로켓)", flutter:"팔랑팔랑 날기 (나비)", fish:"비눗방울 타기 (물고기)",
  snake:"꿈틀꿈틀 기기 (뱀)", mouse:"쪼르르 도망 (생쥐)", human:"걷고 점프하고 벽 타고 만세 (사람)"
};

// ----- 저장소 도우미 -----
const PET_KIND_LABELS_EN = {
  climber:"Wall climber", walker:"Walker", hopper:"Hopper", bouncer:"Bouncer", roller:"Roller", ghost:"Floating ghost",
  ufo:"Flying UFO", cat:"Cursor hunter", fluffyCat:"Diagonal flight and grooming", dog:"Happy runner", spider:"Web climber", mole:"Burrower", frog:"Big jumper",
  penguin:"Waddle and slide", balloon:"Balloon floater", snail:"Slow crawler", ninja:"Teleport dash", bird:"Flying bird",
  chameleon:"Color changer", wizard:"Magic teleport", magnet:"Magnetic pull", cloud:"Thundercloud", rocket:"Launch and parachute",
  flutter:"Fluttering flyer", fish:"Bubble rider", snake:"Slithering snake", mouse:"Quick escape", human:"Walk, climb, cheer"
};

function petJSONLoad(key, fallback){
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
  catch(_){ return fallback; }
}
function petJSONSave(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(_){}
}
// 대사 목록 정리: 문자열만·앞뒤 공백 제거·빈 줄·중복 제거·개수 상한
function petCleanSayings(list){
  const out = [], seen = new Set();
  if (!Array.isArray(list)) return out;
  for (let s of list){
    if (typeof s !== "string") continue;
    s = s.trim().slice(0, PET_SAY_MAX_LEN);
    if (!s || seen.has(s)) continue;
    seen.add(s); out.push(s);
    if (out.length >= PET_SAY_MAX_N) break;
  }
  return out;
}

// ----- 전역 대사 -----
function petUserSayingsLoad(){ return petCleanSayings(petJSONLoad(PET_USER_SAYINGS_KEY, [])); }
function petUserSayingsSave(list){ petJSONSave(PET_USER_SAYINGS_KEY, petCleanSayings(list)); }

// ----- 종족별 대사 -----
function petSpeciesSayingsLoad(){
  const raw = petJSONLoad(PET_SPECIES_SAYINGS_KEY, {});
  const out = {};
  if (raw && typeof raw === "object"){
    for (const id in raw){ const c = petCleanSayings(raw[id]); if (c.length) out[id] = c; }
  }
  return out;
}
function petSpeciesSayingsSaveFor(id, list){
  const all = petSpeciesSayingsLoad();
  const c = petCleanSayings(list);
  if (c.length) all[id] = c; else delete all[id];
  petJSONSave(PET_SPECIES_SAYINGS_KEY, all);
}

// 기본 대사 + 전역 + 종족별을 합친다. pet.js 의 petSpawn 이 종족별로 호출한다.
function petSayingsFor(speciesId, baseSayings){
  const merged = petCleanSayings([
    ...(Array.isArray(baseSayings) ? baseSayings : []),
    ...petUserSayingsLoad(),
    ...(petSpeciesSayingsLoad()[speciesId] || [])
  ]);
  return merged.length ? merged : ["안녕하세요!"];
}

// ----- 나만의 펫 -----
function petCustomLoad(){
  const list = petJSONLoad(PET_CUSTOM_KEY, []);
  return Array.isArray(list)
    ? list.slice(0, PET_CUSTOM_MAX_N)
      .filter(item => item && typeof item === "object")
      .map(item => ({ ...item, priority:item.priority === true }))
    : [];
}
function petCustomSave(list){ petJSONSave(PET_CUSTOM_KEY, (list || []).slice(0, PET_CUSTOM_MAX_N)); }

// 저장된 나만의 펫 → pet.js 가 이해하는 종족 형식으로 변환(그림·움직임은 기존 자산을 재사용).
function petCustomSpecies(){
  if (typeof PET_ART !== "object") return [];
  return petCustomLoad().map((c, index) => {
    const art = PET_ART[c.art];
    if (!art || !PET_KIND_LABELS[c.kind] || !c.palette) return null;
    const base = typeof PET_SPECIES === "object" ? PET_SPECIES.find(s => s.art === art) : null;
    const baseSpeciesId = base ? Object.keys(PET_ART).find(id => PET_ART[id] === base.art) || null : null;
    return {
      id: c.id, name: c.name || "내 펫", custom: true,
      baseSpeciesId,
      kind: c.kind, art: art, cheerArt: (base && base.cheerArt) || null,
      motionArt: (base && c.kind === base.kind && base.motionArt) || null,
      spriteSheet: (base && c.kind === base.kind && base.spriteSheet) || null,
      width: (base && c.kind === base.kind && base.width) || null,
      height: (base && c.kind === base.kind && base.height) || null,
      gridW: (base && c.kind === base.kind && base.gridW) || null,
      gridH: (base && c.kind === base.kind && base.gridH) || null,
      pixelScale: (base && c.kind === base.kind && base.pixelScale) || null, palettes: [c.palette],
      sayings: petCleanSayings(c.sayings), trail: c.trail || null,
      priority: c.priority === true, priorityIndex: index
    };
  }).filter(Boolean);
}

// 종족의 표시 이름(나만의 펫은 사용자가 붙인 이름, 그 외엔 도감 이름표).
function petSpeciesName(sp){
  if (!sp) return "";
  if (sp.custom) return sp.name || "내 펫";
  const id = typeof petSpeciesId === "function" ? petSpeciesId(sp) : sp._id;
  return typeof petSpeciesLabel === "function" ? petSpeciesLabel(id) : ((typeof PET_NAMES === "object" && PET_NAMES[id]) || id);
}

/* ==================== 대사 편집 UI ==================== */
let petSayCurrentId = "crab";   // 종족별 탭에서 마지막으로 고른 친구

function petSayRow(text, onDelete){
  const row = document.createElement("div");
  row.className = "pet-say-item";
  const span = document.createElement("span");
  span.textContent = text;
  const del = document.createElement("button");
  del.type = "button"; del.className = "pet-say-del"; del.title = "삭제";
  del.setAttribute("aria-label", "대사 삭제: " + text);
  del.textContent = "✕";
  del.onclick = onDelete;
  row.appendChild(span); row.appendChild(del);
  return row;
}
function petSayRenderList(container, list, onChange, emptyText){
  container.textContent = "";
  if (!list.length){
    const e = document.createElement("p");
    e.className = "pet-say-empty"; e.textContent = emptyText || "아직 없어요. 아래에서 추가해 보세요.";
    container.appendChild(e);
    return;
  }
  list.forEach((text, i) => container.appendChild(petSayRow(text, () => {
    list.splice(i, 1); onChange();
  })));
}
function petSayRenderGlobal(){
  const box = document.getElementById("petSayGlobalList");
  if (!box) return;
  const list = petUserSayingsLoad();
  petSayRenderList(box, list, () => { petUserSayingsSave(list); petSayRenderGlobal(); petLiveRefresh(); },
    "아직 공통 대사가 없어요. 모든 펫이 함께 말할 문장을 추가해 보세요.");
}
function petSayRenderSpecies(){
  const box = document.getElementById("petSaySpeciesList");
  const base = document.getElementById("petSaySpeciesBase");
  if (!box) return;
  const id = petSayCurrentId;
  const map = petSpeciesSayingsLoad();
  const list = map[id] || [];
  petSayRenderList(box, list, () => {
    petSpeciesSayingsSaveFor(id, list); petSayRenderSpecies(); petSayFillSpeciesPicker(); petLiveRefresh();
  }, "이 친구만의 대사가 아직 없어요.");
  if (base){
    const sp = typeof petSpeciesById === "function" ? petSpeciesById(id) : null;
    const defs = sp && sp.sayings ? sp.sayings.slice(0, 4).join(" · ") : "";
    base.textContent = defs ? "기본 대사: " + defs + (sp.sayings.length > 4 ? " …" : "") : "";
  }
}
// 친구 고르기: 이름 드롭다운 대신 캐릭터 그림을 눌러 고른다(도감처럼 스프라이트를 그려 보여준다).
function petSayFillSpeciesPicker(){
  const box = document.getElementById("petSaySpecies");
  if (!box || typeof PET_SPECIES !== "object") return;
  if (!(typeof petSpeciesById === "function" && petSpeciesById(petSayCurrentId)))
    petSayCurrentId = petSpeciesId(PET_SPECIES[0]);
  const sayMap = petSpeciesSayingsLoad();
  box.textContent = "";
  for (const sp of PET_SPECIES){
    const id = petSpeciesId(sp);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "pet-say-pick" + (id === petSayCurrentId ? " active" : "");
    cell.setAttribute("role", "option");
    cell.setAttribute("aria-selected", String(id === petSayCurrentId));
    const cv = document.createElement("canvas");
    if (typeof petDexDrawMini === "function") petDexDrawMini(cv, sp.art, sp.palettes[0], false, 2);
    const nm = document.createElement("span");
    nm.textContent = petSpeciesName(sp);
    cell.appendChild(cv); cell.appendChild(nm);
    cell.title = petSpeciesName(sp);
    if (sayMap[id] && sayMap[id].length){        // 이미 대사를 넣은 친구는 점으로 표시
      const dot = document.createElement("b"); dot.className = "pet-say-pick-dot"; dot.textContent = "●";
      dot.title = "대사 " + sayMap[id].length + "개"; cell.appendChild(dot);
    }
    cell.onclick = () => { petSayCurrentId = id; petSayFillSpeciesPicker(); petSayRenderSpecies(); };
    box.appendChild(cell);
  }
  const nameEl = document.getElementById("petSayPickName");
  if (nameEl){ const cur = petSpeciesById(petSayCurrentId); nameEl.textContent = cur ? petSpeciesName(cur) : ""; }
}
function openPetSayings(){
  const modal = document.getElementById("petSayModal");
  if (!modal) return;
  petSayFillSpeciesPicker();
  petSayRenderGlobal();
  petSayRenderSpecies();
  modal.hidden = false;
  const close = document.getElementById("petSayClose");
  if (close) close.focus();
}
function initPetSayModal(){
  const gForm = document.getElementById("petSayGlobalForm");
  if (gForm) gForm.onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById("petSayGlobalInput");
    const list = petUserSayingsLoad(); list.push(input.value);
    petUserSayingsSave(list); input.value = ""; petSayRenderGlobal(); petLiveRefresh();
  };
  const sForm = document.getElementById("petSaySpeciesForm");
  if (sForm) sForm.onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById("petSaySpeciesInput");
    const map = petSpeciesSayingsLoad();
    const list = map[petSayCurrentId] || [];
    list.push(input.value);
    petSpeciesSayingsSaveFor(petSayCurrentId, list);
    input.value = ""; petSayRenderSpecies(); petSayFillSpeciesPicker(); petLiveRefresh();
  };
}

/* ==================== 나만의 펫 만들기 UI ==================== */
let petBuilderDraft = null;   // { art, kind, paletteIndex, sayings:[] }

// 그림(art id) 이 가진 색 팔레트 목록 — 그 그림을 쓰는 기본 종족에서 가져온다.
function petPalettesForArt(artId){
  if (typeof PET_SPECIES !== "object" || typeof PET_ART !== "object") return [{}];
  const art = PET_ART[artId];
  const sp = PET_SPECIES.find(s => s.art === art);
  return sp && sp.palettes && sp.palettes.length ? sp.palettes : [{}];
}
function petBuilderNewDraft(artId){
  const id = artId || (typeof PET_NAMES === "object" ? Object.keys(PET_NAMES)[0] : "crab");
  const sp = (typeof PET_SPECIES === "object" && typeof PET_ART === "object")
    ? PET_SPECIES.find(s => s.art === PET_ART[id]) : null;
  return { art: id, kind: sp ? sp.kind : "walker", paletteIndex: 0, sayings: [] };
}
function petBuilderFillSelects(){
  const kindSel = document.getElementById("petBuilderKind");
  if (kindSel){
    kindSel.textContent = "";
    for (const k in PET_KIND_LABELS){
      const opt = document.createElement("option");
      opt.value = k; opt.textContent = typeof petUsesEnglish === "function" && petUsesEnglish() ? (PET_KIND_LABELS_EN[k] || k) : PET_KIND_LABELS[k];
      kindSel.appendChild(opt);
    }
  }
}
// 그림 고르기: 드롭다운 대신 캐릭터 그림 그리드에서 선택(친구 고르기와 같은 방식).
function petBuilderRenderArtPicker(){
  const box = document.getElementById("petBuilderArt");
  if (!box || typeof PET_SPECIES !== "object") return;
  box.textContent = "";
  for (const sp of PET_SPECIES){
    const id = petSpeciesId(sp);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "pet-say-pick" + (id === petBuilderDraft.art ? " active" : "");
    cell.setAttribute("role", "option");
    cell.setAttribute("aria-selected", String(id === petBuilderDraft.art));
    cell.title = petSpeciesName(sp);
    const cv = document.createElement("canvas");
    if (typeof petDexDrawMini === "function") petDexDrawMini(cv, sp.art, sp.palettes[0], false, 2);
    const nm = document.createElement("span");
    nm.textContent = petSpeciesName(sp);
    cell.appendChild(cv); cell.appendChild(nm);
    cell.onclick = () => {
      petBuilderDraft.art = id;
      petBuilderDraft.paletteIndex = 0;
      if (sp.kind) petBuilderDraft.kind = sp.kind;   // 그림을 바꾸면 그 그림 본래 움직임을 기본값으로
      petBuilderSyncForm();
    };
    box.appendChild(cell);
  }
}
function petBuilderDrawPreview(){
  const cv = document.getElementById("petBuilderPreview");
  if (!cv || typeof petDexDrawMini !== "function") return;
  const pals = petPalettesForArt(petBuilderDraft.art);
  const pal = pals[Math.min(petBuilderDraft.paletteIndex, pals.length - 1)] || pals[0];
  petDexDrawMini(cv, PET_ART[petBuilderDraft.art], pal, false, 6);
}
function petBuilderRenderPalettes(){
  const box = document.getElementById("petBuilderPalettes");
  if (!box || typeof petDexDrawMini !== "function") return;
  box.textContent = "";
  const pals = petPalettesForArt(petBuilderDraft.art);
  pals.forEach((pal, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pet-swatch" + (i === petBuilderDraft.paletteIndex ? " active" : "");
    btn.setAttribute("aria-label", "색 " + (i + 1));
    const cv = document.createElement("canvas");
    petDexDrawMini(cv, PET_ART[petBuilderDraft.art], pal, false, 2);
    btn.appendChild(cv);
    btn.onclick = () => { petBuilderDraft.paletteIndex = i; petBuilderRenderPalettes(); petBuilderDrawPreview(); };
    box.appendChild(btn);
  });
}
function petBuilderRenderSayings(){
  const box = document.getElementById("petBuilderSayList");
  if (!box) return;
  petSayRenderList(box, petBuilderDraft.sayings, petBuilderRenderSayings,
    "대사가 없어도 돼요(기본 인사를 해요). 넣고 싶으면 아래에서 추가하세요.");
}
function petBuilderSyncForm(){
  const kindSel = document.getElementById("petBuilderKind");
  if (kindSel) kindSel.value = petBuilderDraft.kind;
  petBuilderRenderArtPicker();
  petBuilderRenderPalettes();
  petBuilderRenderSayings();
  petBuilderDrawPreview();
}
function petBuilderRenderSaved(){
  const box = document.getElementById("petBuilderList");
  if (!box) return;
  const list = petCustomLoad();
  box.textContent = "";
  if (!list.length){
    const e = document.createElement("p");
    e.className = "pet-say-empty"; e.textContent = "아직 만든 펫이 없어요. 위에서 골라 저장해 보세요.";
    box.appendChild(e);
    return;
  }
  list.forEach((c, i) => {
    const cell = document.createElement("div");
    cell.className = "pet-dex-cell" + (c.priority ? " priority" : "");
    if (typeof petDexDrawMini === "function" && PET_ART[c.art]){
      const cv = document.createElement("canvas");
      petDexDrawMini(cv, PET_ART[c.art], c.palette, false, PET_SCALE);
      cell.appendChild(cv);
    }
    const nm = document.createElement("span");
    nm.textContent = c.name || "내 펫";
    cell.appendChild(nm);
    cell.title = (PET_KIND_LABELS[c.kind] || c.kind) + (c.sayings && c.sayings.length ? " · 대사 " + c.sayings.length + "개" : "");
    const priority = document.createElement("label");
    priority.className = "pet-builder-priority-toggle";
    priority.title = "체크하면 펫을 켤 때 먼저 등장합니다";
    const priorityInput = document.createElement("input");
    priorityInput.type = "checkbox";
    priorityInput.checked = c.priority === true;
    priorityInput.setAttribute("aria-label", (c.name || "custom pet") + " 우선 등장");
    priorityInput.onchange = () => {
      const all = petCustomLoad();
      if (!all[i]) return;
      all[i].priority = priorityInput.checked;
      petCustomSave(all);
      petBuilderRenderSaved();
      petLiveRefresh();
    };
    const priorityText = document.createElement("span");
    priorityText.textContent = "우선";
    priority.append(priorityInput, priorityText);
    cell.appendChild(priority);
    const del = document.createElement("button");
    del.type = "button"; del.className = "pet-dex-del"; del.textContent = "✕";
    del.title = "이 펫 지우기"; del.setAttribute("aria-label", (c.name || "내 펫") + " 지우기");
    del.onclick = () => {
      const all = petCustomLoad(); all.splice(i, 1); petCustomSave(all);
      petBuilderRenderSaved(); petLiveRefresh();
    };
    cell.appendChild(del);
    box.appendChild(cell);
  });
}
function openPetBuilder(){
  const modal = document.getElementById("petBuilderModal");
  if (!modal) return;
  petBuilderFillSelects();
  if (!petBuilderDraft) petBuilderDraft = petBuilderNewDraft();
  const nameEl = document.getElementById("petBuilderName");
  if (nameEl) nameEl.value = "";
  const priorityEl = document.getElementById("petBuilderPriority");
  if (priorityEl) priorityEl.checked = false;
  petBuilderSyncForm();
  petBuilderRenderSaved();
  modal.hidden = false;
  if (nameEl) nameEl.focus();
}
function initPetBuilderModal(){
  const kindSel = document.getElementById("petBuilderKind");
  if (kindSel) kindSel.onchange = () => { petBuilderDraft.kind = kindSel.value; };
  const sForm = document.getElementById("petBuilderSayForm");
  if (sForm) sForm.onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById("petBuilderSayInput");
    const v = (input.value || "").trim();
    if (v && petBuilderDraft.sayings.length < PET_SAY_MAX_N) petBuilderDraft.sayings.push(v);
    input.value = ""; petBuilderRenderSayings();
  };
  const shuffle = document.getElementById("petBuilderShuffle");
  if (shuffle) shuffle.onclick = () => {
    const pals = petPalettesForArt(petBuilderDraft.art);
    petBuilderDraft.paletteIndex = Math.floor(Math.random() * pals.length);
    petBuilderRenderPalettes(); petBuilderDrawPreview();
  };
  const reset = document.getElementById("petBuilderReset");
  if (reset) reset.onclick = () => {
    petBuilderDraft = petBuilderNewDraft();
    const nameEl = document.getElementById("petBuilderName"); if (nameEl) nameEl.value = "";
    const priorityEl = document.getElementById("petBuilderPriority"); if (priorityEl) priorityEl.checked = false;
    petBuilderSyncForm();
  };
  const save = document.getElementById("petBuilderSave");
  if (save) save.onclick = () => {
    const nameEl = document.getElementById("petBuilderName");
    const priorityEl = document.getElementById("petBuilderPriority");
    const name = ((nameEl && nameEl.value) || "").trim().slice(0, PET_NAME_MAX_LEN) || "내 펫";
    const pals = petPalettesForArt(petBuilderDraft.art);
    const palette = pals[Math.min(petBuilderDraft.paletteIndex, pals.length - 1)] || pals[0];
    const all = petCustomLoad();
    if (all.length >= PET_CUSTOM_MAX_N){
      if (typeof toast === "function") toast("펫은 최대 " + PET_CUSTOM_MAX_N + "개까지 만들 수 있어요.", 3000);
      return;
    }
    all.push({
      id: "custom:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, art: petBuilderDraft.art, kind: petBuilderDraft.kind,
      palette: palette, sayings: petCleanSayings(petBuilderDraft.sayings),
      priority: !!(priorityEl && priorityEl.checked)
    });
    petCustomSave(all);
    petBuilderRenderSaved();
    petLiveRefresh();
    if (typeof toast === "function") toast("「" + name + "」 저장! 펫을 켜면 함께 돌아다녀요.", 3200);
    // 다음 펫을 바로 만들 수 있게 이름만 비운다(그림·색 설정은 유지).
    if (nameEl){ nameEl.value = ""; nameEl.focus(); }
    if (priorityEl) priorityEl.checked = false;
    petBuilderDraft.sayings = [];
    petBuilderRenderSayings();
  };
}

// 대사·펫이 바뀌면, 이미 돌아다니는 펫들에게 즉시 반영되도록 다시 켠다(꺼져 있으면 아무 일 없음).
function petLiveRefresh(){ if (typeof petRefreshAll === "function") petRefreshAll(); }

function initPetCustom(){
  initPetSayModal(); initPetBuilderModal();
  window.addEventListener("mni18nchange", () => {
    const sayings = document.getElementById("petSayModal");
    if (sayings && !sayings.hidden) openPetSayings();
    const builder = document.getElementById("petBuilderModal");
    if (builder && !builder.hidden){ petBuilderFillSelects(); petBuilderSyncForm(); petBuilderRenderSaved(); }
  });
}
