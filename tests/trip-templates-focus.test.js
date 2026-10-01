"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const diary = require("../src/js/diary.js");
Object.assign(globalThis, diary);
const trip = require("../src/js/trip.js");
const source = fs.readFileSync(path.join(__dirname, "../src/js/trip.js"), "utf8");
const historySource = fs.readFileSync(path.join(__dirname, "../src/js/history.js"), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};

test("여행 템플릿 3종은 한국어·영어 준비물과 질문을 갖춘다", () => {
  assert.deepEqual(trip.TRIP_TEMPLATES.map(t => t.id), ["daytrip", "overnight", "fieldtrip"]);
  for (const template of trip.TRIP_TEMPLATES){
    assert.ok(template.checklist.length >= 6);
    assert.equal(template.questions.length, 4);
    for (const pair of [template.name, template.description, ...template.checklist, ...template.questions]){
      assert.equal(pair.length, 2);
      assert.ok(pair.every(text => typeof text === "string" && text.trim()));
    }
  }
});

test("템플릿은 기존 글·제목·사진·완료 체크를 유지하고, 답을 써도 중복 추가하지 않는다", () => {
  const model = trip.tripEmpty("기존 여행");
  const day = trip.tripNormalizeDay({ id:"dy-1", title:"바다", text:"원래 쓴 글\n", date:"2026-10-01",
    stickers:[{ id:"st-1", kind:"photo", asset:"assets/photo123.jpg", x:.2, y:1, w:.3, ar:.7 }] });
  model.days.push(day);
  model.checklist.push({ id:"ck-original", text:"  충전기  ", done:true });
  const stickers = JSON.stringify(day.stickers);
  const first = trip.tripApplyTemplate(model, day.id, "daytrip");
  assert.equal(first.addedChecklist, 5);
  assert.equal(first.addedQuestions, true);
  assert.equal(day.title, "바다");
  assert.equal(day.date, "2026-10-01");
  assert.ok(day.text.startsWith("원래 쓴 글\n"));
  assert.equal(JSON.stringify(day.stickers), stickers);
  assert.equal(model.checklist[0].done, true);
  day.text = day.text.replace("오늘의 여행지와 떠난 이유:\n", "오늘의 여행지와 떠난 이유:\n바다를 보고 싶었다.\n");
  const before = trip.tripContentKey(model);
  const repeated = trip.tripApplyTemplate(model, day.id, "daytrip", { en:true });
  assert.equal(repeated.changed, false, "언어를 바꾸거나 답을 써도 같은 양식을 다시 넣지 않는다");
  assert.equal(trip.tripContentKey(model), before);
});

test("준비물만 넣으면 날을 만들지 않고, 질문만 넣으면 현재 날이나 새 날에 기록한다", () => {
  const model = trip.tripEmpty("여행");
  const packing = trip.tripApplyTemplate(model, "", "overnight", { questions:false, en:true });
  assert.equal(packing.addedChecklist, 8);
  assert.equal(model.days.length, 0);
  assert.ok(model.checklist.some(item => item.text === "Toiletries"));
  const writing = trip.tripApplyTemplate(model, "", "fieldtrip", { checklist:false });
  assert.equal(writing.addedChecklist, 0);
  assert.equal(model.checklist.length, 8);
  assert.equal(model.days.length, 1);
  assert.equal(model.days[0].date, "", "처음 날에는 임의의 여행 날짜를 넣지 않는다");
  assert.match(model.days[0].text, /방문 목적/);
  model.days[0].date = "2026-10-01";
  trip.tripApplyTemplate(model, "missing", "overnight", { checklist:false });
  assert.equal(model.days[1].date, "2026-10-02");
});

test("서로 다른 양식의 공통 준비물은 한 번만 넣고 200개·400날 제한을 지킨다", () => {
  const model = trip.tripEmpty("여행");
  trip.tripApplyTemplate(model, "", "daytrip", { questions:false });
  trip.tripApplyTemplate(model, "", "overnight", { questions:false, en:true });
  assert.equal(model.checklist.filter(item => ["충전기", "Charger"].includes(item.text)).length, 1);
  model.checklist = Array.from({ length:199 }, (_, i) => ({ id:"ck-" + i, text:"내 준비물 " + i, done:false }));
  const limited = trip.tripApplyTemplate(model, "", "daytrip", { questions:false });
  assert.equal(model.checklist.length, 200);
  assert.equal(limited.addedChecklist, 1);
  assert.equal(limited.skippedChecklist, 5);
  model.days = Array.from({ length:400 }, (_, i) => trip.tripNormalizeDay({ id:"dy-" + i, text:"기록" }));
  const before = trip.tripContentKey(model);
  assert.equal(trip.tripApplyTemplate(model, "", "daytrip").reason, "full");
  assert.equal(trip.tripContentKey(model), before, "새 날을 만들 수 없으면 부분 적용하지 않는다");
  assert.equal(trip.tripApplyTemplate(model, "dy-0", "daytrip", { checklist:false }).addedQuestions, true);
});

test("없는 양식·모두 해제는 문서를 바꾸지 않고, 적용한 양식은 기존 ZIP 형식으로 왕복한다", async () => {
  const model = trip.tripEmpty("여행");
  const before = trip.tripContentKey(model);
  assert.equal(trip.tripApplyTemplate(model, "", "unknown").changed, false);
  assert.equal(trip.tripApplyTemplate(model, "", "daytrip", { checklist:false, questions:false }).changed, false);
  assert.equal(trip.tripContentKey(model), before);
  trip.tripApplyTemplate(model, "", "fieldtrip");
  const opened = await trip.tripUnpack(trip.tripPack(model, new Map()));
  assert.equal(opened.model.version, trip.TRIP_VERSION);
  assert.deepEqual(opened.model.checklist, model.checklist);
  assert.equal(opened.model.days[0].text, model.days[0].text);
  assert.equal("purpose" in opened.model, false);
  assert.equal("prompts" in opened.model.days[0], false);
});

test("템플릿 버튼의 실제 적용 처리는 본문과 준비물을 한 번에 되돌리고 다시 적용한다", () => {
  const model = trip.tripEmpty("여행");
  const ctx = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(historySource + "\nglobalThis.historyApi = MNEditHistory;", ctx);
  const history = ctx.historyApi.create({ capture:() => JSON.stringify(model),
    apply:state => Object.assign(model, JSON.parse(state)), isEqual:(a, b) => a === b });
  history.reset();
  const layouts = [];
  Object.assign(ctx, { model, current:"", templateChecklist:true, templateQuestions:true, history, checkOpen:false,
    tripApplyTemplate:trip.tripApplyTemplate, tripGetTemplates:trip.tripGetTemplates, tripIsEn:() => false, dayOf:id => model.days.find(day => day.id === id),
    setDrawMode:() => {}, setTemplateOpen:() => {}, clearSelection:() => {}, setStatus:() => {},
    renderRail:() => {}, renderPage:() => {}, renderChecklist:() => {}, touch:() => history.commit(),
    localStorage:{ setItem:() => {} }, templateBtn:{ focus:() => {} }, els:{ area:{ focus:() => {} } }, layout:opts => layouts.push(opts.flow)
  });
  vm.runInContext(section("  function applyTemplate(id){", "  templateBtn.addEventListener"), ctx);
  const before = trip.tripContentKey(model);
  ctx.applyTemplate("daytrip");
  const after = trip.tripContentKey(model);
  assert.notEqual(after, before);
  assert.deepEqual(layouts, [true], "기존 본문 아래 사진은 추가한 질문에 맞춰 이동한다");
  assert.equal(history.size(), 2);
  assert.equal(history.undo(), true);
  assert.equal(trip.tripContentKey(model), before);
  assert.equal(history.redo(), true);
  assert.equal(trip.tripContentKey(model), after);
  ctx.applyTemplate("daytrip");
  assert.equal(history.size(), 2);
  history.cancel();
});

class Element {
  constructor(){
    const classes = new Set();
    this.classList = { toggle:(name, on) => on ? classes.add(name) : classes.delete(name), contains:name => classes.has(name) };
    this.attributes = {}; this.listeners = {}; this.hidden = true; this.isConnected = true;
  }
  setAttribute(key, value){ this.attributes[key] = value; }
  querySelector(){ return this.label || null; }
  addEventListener(name, fn){ this.listeners[name] = fn; }
  focus(){ this.focused = true; }
  contains(){ return true; }
  closest(){ return this.editing ? {} : null; }
}
function focusHarness(existingDay=true){
  const model = trip.tripEmpty("여행"), root = new Element(), focusBtn = new Element(), main = new Element();
  if (existingDay) model.days.push(trip.tripNormalizeDay({ id:"dy-1" }));
  focusBtn.label = {}; main.scrollTop = 123;
  const panels = { panel:new Element(), artPanel:new Element(),
    setPanelOpen:on => { panels.panel.hidden = !on; }, setArtPanelOpen:on => { panels.artPanel.hidden = !on; } };
  const callbacks = new Map(), counts = { layout:0, map:0, picking:0, area:0 };
  let frameId = 0;
  const ctx = vm.createContext({
    model, root, focusBtn, main, panels, tripIsEn:() => false,
    current:existingDay ? "dy-1" : "", dayOf:id => model.days.find(day => day.id === id), addDayBtn:new Element(), setStatus:() => {},
    els:{ area:{ disabled:!existingDay, focus:() => { counts.area++; } }, drawBar:{ hidden:true } },
    setTemplateOpen:on => { ctx.templatePanel.hidden = !on; },
    setMobileMapOpen:open => { ctx.mobileMapOpen = open; main.inert = open; }, cancelPicking:() => { counts.picking++; },
    requestAnimationFrame:fn => { callbacks.set(++frameId, fn); return frameId; }, cancelAnimationFrame:id => callbacks.delete(id),
    layout:() => { counts.layout++; }, redrawDrawing:() => {}, tripMapWidth:350,
    applyTripMapWidth:width => { assert.equal(width, 350); counts.map++; }, window:{ addEventListener:() => {} },
    touch:() => assert.fail("몰입 보기는 파일을 수정하면 안 된다"),
    templatePanel:new Element(), templateBtn:new Element(), styleBtn:new Element(), stickerBtn:new Element(),
    mobileMapOpen:false, pickingFor:"", doc:{ id:"doc-1", el:root }, activeId:"doc-1", mapPane:new Element(), mapMobileBtn:new Element(),
    history:{}, document:{ activeElement:main }
  });
  vm.runInContext("let focusMode = false;\n" + section("  /* 몰입은 보는 상태다.", "  mapDivider.addEventListener(\"pointerdown\""), ctx);
  vm.runInContext(section("  const onKey = (e) => {\n    if (!root.isConnected", "  document.addEventListener(\"keydown\", onKey, true);"), ctx);
  ctx.addDayBtn.focus = () => { ctx.addDayBtn.focused = true; ctx.document.activeElement = ctx.addDayBtn; };
  return { ctx, root, focusBtn, panels, main, model, counts,
    runFrames:() => { for (const fn of callbacks.values()) fn(); callbacks.clear(); },
    escape:(target=main, composing=false) => {
      const event = { key:"Escape", target, isComposing:composing, preventDefault:() => {}, stopPropagation:() => {} };
      vm.runInContext("onKey", ctx)(event);
    } };
}

function usePageRenderer(h){
  Object.assign(h.ctx, { deleteBtn:new Element(), dayTitle:new Element(), dayDate:new Element(), dayDateDisplay:new Element(), dayDateField:new Element(),
    tripWord:trip.tripWord, applyStyle:() => {}, renderStickers:() => {}, syncDrawBar:() => {}, renderSpots:() => {}, renderMap:() => {}, syncWeather:() => {} });
  vm.runInContext(section("  function renderPage(){", "  addDayBtn.addEventListener"), h.ctx);
  return h.ctx.renderPage;
}

function editingHarness(existingDay=true){
  const h = focusHarness(false), ctx = h.ctx, model = h.model;
  if (existingDay) model.days.push(trip.tripNormalizeDay({ id:"dy-1", text:"원래 글", title:"첫 날" }));
  const area = new Element();
  area.tagName = "TEXTAREA";
  area.selectionStart = area.selectionEnd = 3;
  area.selectionDirection = "none";
  area.focus = () => { ctx.document.activeElement = area; };
  area.setSelectionRange = (start, end, direction) => {
    area.selectionStart = start; area.selectionEnd = end; area.selectionDirection = direction;
  };
  ctx.els.area = area;
  ctx.templateBtn.tagName = "BUTTON";
  ctx.templateBtn.focus = () => { ctx.document.activeElement = ctx.templateBtn; };
  ctx.current = existingDay ? "dy-1" : "";
  const renderPage = usePageRenderer(h);
  renderPage();
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;
  vm.runInContext(historySource + "\nglobalThis.historyApi = MNEditHistory;", ctx);
  ctx.history = ctx.historyApi.create({ capture:() => JSON.stringify(model), isEqual:(a, b) => a === b,
    apply:state => {
      Object.assign(model, JSON.parse(state));
      if (!model.days.some(day => day.id === ctx.current)) ctx.current = model.days[0]?.id || "";
      renderPage();
    } });
  ctx.history.reset();
  Object.assign(ctx, { templateChecklist:true, templateQuestions:true, checkOpen:false,
    tripApplyTemplate:trip.tripApplyTemplate, tripGetTemplates:trip.tripGetTemplates, dayOf:id => model.days.find(day => day.id === id),
    setDrawMode:() => {}, clearSelection:() => {}, setStatus:() => {},
    renderRail:() => {}, renderPage, renderChecklist:() => {}, touch:() => ctx.history.commit(),
    localStorage:{ setItem:() => {} }
  });
  vm.runInContext(section("  function applyTemplate(id){", "  templateBtn.addEventListener"), ctx);
  const key = (keyName, overrides={}) => {
    const event = { key:keyName, ctrlKey:true, target:ctx.document.activeElement,
      preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; }, ...overrides };
    vm.runInContext("onKey", ctx)(event);
    return event;
  };
  return { ...h, area, key, type:text => {
    area.value = model.days.find(day => day.id === ctx.current).text = text;
    ctx.history.commitSoon(400);
  } };
}

test("본문에 커서가 있어도 Ctrl+Z는 입력 다음 템플릿을 되돌리고 Ctrl+Y·Ctrl+Shift+Z로 복원한다", () => {
  const h = editingHarness();
  try {
    const before = trip.tripContentKey(h.model);
    h.ctx.applyTemplate("daytrip");
    assert.equal(h.ctx.document.activeElement, h.area);
    const template = trip.tripContentKey(h.model);
    const templateText = h.area.value;
    h.type(templateText + "\n여행에서 쓴 답");
    const typed = trip.tripContentKey(h.model);
    assert.equal(h.key("z").defaultPrevented, true);
    assert.equal(trip.tripContentKey(h.model), template, "아직 지연 기록 중인 입력부터 되돌린다");
    assert.equal(h.area.value, templateText);
    assert.equal(h.area.selectionStart, 3);
    assert.equal(h.main.scrollTop, 123);
    assert.equal(h.key("z").stopped, true);
    assert.equal(trip.tripContentKey(h.model), before, "준비물과 질문을 함께 되돌린다");
    h.key("y");
    assert.equal(trip.tripContentKey(h.model), template);
    h.key("Z", { shiftKey:true });
    assert.equal(trip.tripContentKey(h.model), typed);
    h.key("z", { ctrlKey:false, metaKey:true });
    assert.equal(trip.tripContentKey(h.model), template);
    h.type(templateText + "\n새 답");
    const edited = trip.tripContentKey(h.model);
    h.key("y");
    assert.equal(trip.tripContentKey(h.model), edited, "새 입력 후 다시 실행하면 이전 답으로 덮지 않는다");
    h.key("z");
    assert.equal(trip.tripContentKey(h.model), template);
  } finally { h.ctx.history.cancel(); }
});

test("템플릿이 처음 만든 날을 Ctrl+Z로 없앤 뒤에도 ＋ 날에서 다시 실행할 수 있다", () => {
  const h = editingHarness(false);
  try {
    const before = trip.tripContentKey(h.model);
    h.ctx.applyTemplate("overnight");
    const after = trip.tripContentKey(h.model);
    h.key("z");
    assert.equal(trip.tripContentKey(h.model), before);
    assert.equal(h.area.disabled, true);
    assert.equal(h.ctx.document.activeElement, h.ctx.addDayBtn);
    h.key("y");
    assert.equal(trip.tripContentKey(h.model), after);
    assert.equal(h.area.disabled, false);
  } finally { h.ctx.history.cancel(); }
});

test("저장한 내 템플릿도 실제 적용 버튼과 본문 Ctrl+Z·Ctrl+Y 기록을 함께 사용한다", () => {
  const h = editingHarness();
  h.ctx.localStorage.getItem = () => JSON.stringify([{ id:"user-camp", name:"캠핑", checklist:["텐트"], questions:["캠핑 기록"] }]);
  try {
    const before = trip.tripContentKey(h.model);
    h.ctx.applyTemplate("user-camp");
    const after = trip.tripContentKey(h.model);
    assert.notEqual(after, before);
    assert.equal(h.model.checklist[0].text, "텐트");
    assert.match(h.area.value, /캠핑 기록/);
    h.key("z");
    assert.equal(trip.tripContentKey(h.model), before);
    h.key("y");
    assert.equal(trip.tripContentKey(h.model), after);
    h.ctx.applyTemplate("user-camp");
    assert.equal(h.ctx.history.size(), 2);
  } finally { h.ctx.history.cancel(); }
});

test("다른 입력칸의 기본 되돌리기·한글 조합·다른 탭·Alt 조합은 여행 기록 단축키가 가로채지 않는다", () => {
  const h = editingHarness();
  try {
    h.ctx.applyTemplate("daytrip");
    const after = trip.tripContentKey(h.model);
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "DIV"]){
      const field = new Element(); field.tagName = tagName; field.isContentEditable = tagName === "DIV";
      h.ctx.document.activeElement = field;
      assert.equal(h.key("z").defaultPrevented, undefined);
      assert.equal(h.key("y").defaultPrevented, undefined);
    }
    h.area.focus();
    assert.equal(h.key("z", { isComposing:true }).defaultPrevented, undefined);
    assert.equal(h.key("z", { altKey:true }).defaultPrevented, undefined);
    assert.equal(h.key("z", { defaultPrevented:true }).stopped, undefined);
    h.ctx.activeId = "another-doc";
    assert.equal(h.key("z").defaultPrevented, undefined);
    h.ctx.activeId = h.ctx.doc.id; h.root.isConnected = false;
    assert.equal(h.key("z").defaultPrevented, undefined);
    assert.equal(trip.tripContentKey(h.model), after);
  } finally { h.ctx.history.cancel(); }
});

test("몰입은 여정·지도 보기를 감추고 종료하며 문서 내용·스크롤 위치를 유지한다", () => {
  const h = focusHarness(), before = trip.tripContentKey(h.model);
  h.ctx.mobileMapOpen = true; h.main.inert = true;
  h.ctx.setFocusMode(true); h.runFrames();
  assert.equal(h.root.classList.contains("is-trip-focus"), true);
  assert.equal(h.focusBtn.attributes["aria-pressed"], "true");
  assert.equal(h.ctx.mobileMapOpen, false);
  assert.equal(h.main.inert, false);
  assert.equal(h.main.scrollTop, 123);
  h.escape(); h.runFrames();
  assert.equal(h.root.classList.contains("is-trip-focus"), false);
  assert.equal(h.focusBtn.attributes["aria-pressed"], "false");
  assert.equal(h.counts.map, 1);
  assert.equal(trip.tripContentKey(h.model), before);
});

test("글을 쓸 날이 없으면 몰입 버튼과 직접 실행을 막고 ＋ 날을 안내한다", () => {
  const h = editingHarness(false);
  try {
    const before = trip.tripContentKey(h.model);
    assert.equal(h.focusBtn.disabled, true);
    assert.match(h.focusBtn.title, /＋ 날/);
    h.ctx.setFocusMode(true); h.runFrames();
    assert.equal(h.root.classList.contains("is-trip-focus"), false);
    assert.equal(h.focusBtn.attributes["aria-pressed"], "false");
    assert.equal(h.ctx.document.activeElement, h.ctx.addDayBtn);
    assert.equal(trip.tripContentKey(h.model), before);
    h.ctx.tripIsEn = () => true; h.ctx.syncFocusButton();
    assert.match(h.focusBtn.attributes["aria-label"], /Add a day/);
  } finally { h.ctx.history.cancel(); }
});

test("＋ 날로 빈 날을 만들면 바로 몰입할 수 있고 커서는 본문에 놓인다", () => {
  const h = editingHarness(false);
  try {
    Object.assign(h.ctx, { tripNormalizeDay:trip.tripNormalizeDay, tripNextDayDate:trip.tripNextDayDate,
      autoDated:new Set(), requestSpecialMonths:() => {} });
    vm.runInContext(section('  addDayBtn.addEventListener("click", () => {', '  deleteBtn.addEventListener("click", () => {'), h.ctx);
    h.ctx.addDayBtn.listeners.click();
    assert.equal(h.model.days.length, 1);
    assert.equal(h.area.value, "", "글을 아직 쓰지 않은 빈 날도 편집 가능한 날이다");
    assert.equal(h.focusBtn.disabled, false);
    h.focusBtn.listeners.click(); h.runFrames();
    assert.equal(h.root.classList.contains("is-trip-focus"), true);
    assert.equal(h.ctx.document.activeElement, h.area);
  } finally { h.ctx.history.cancel(); }
});

test("준비물 전용 템플릿은 몰입을 열지 않고, 기록 질문으로 날을 만들면 몰입이 활성화된다", () => {
  const h = editingHarness(false);
  try {
    h.ctx.templateQuestions = false; h.ctx.applyTemplate("daytrip");
    assert.equal(h.model.days.length, 0);
    assert.equal(h.focusBtn.disabled, true);
    h.ctx.templateQuestions = true; h.ctx.applyTemplate("daytrip");
    assert.equal(h.model.days.length, 1);
    assert.equal(h.focusBtn.disabled, false);
    assert.equal(h.root.classList.contains("is-trip-focus"), false, "날 생성은 몰입을 자동 실행하지 않는다");
    h.focusBtn.listeners.click();
    assert.equal(h.ctx.document.activeElement, h.area);
  } finally { h.ctx.history.cancel(); }
});

test("몰입 중 마지막 날 삭제·복원·다시 삭제는 몰입 상태와 버튼을 갱신한다", () => {
  const h = editingHarness();
  try {
    h.ctx.tripT = text => text;
    vm.runInContext(section('  deleteBtn.addEventListener("click", () => {', '  dayTitle.addEventListener("input",'), h.ctx);
    h.ctx.setFocusMode(true);
    h.ctx.deleteBtn.listeners.click(); h.runFrames();
    assert.equal(h.model.days.length, 0);
    assert.equal(h.root.classList.contains("is-trip-focus"), false);
    assert.equal(h.focusBtn.disabled, true);
    assert.equal(h.ctx.document.activeElement, h.ctx.addDayBtn);
    h.ctx.history.undo();
    assert.equal(h.model.days.length, 1);
    assert.equal(h.focusBtn.disabled, false);
    assert.equal(h.root.classList.contains("is-trip-focus"), false);
    h.ctx.setFocusMode(true); h.ctx.history.redo(); h.runFrames();
    assert.equal(h.model.days.length, 0);
    assert.equal(h.root.classList.contains("is-trip-focus"), false);
    assert.equal(h.focusBtn.disabled, true);
  } finally { h.ctx.history.cancel(); }
});

test("몰입 중 첫 템플릿을 Ctrl+Z로 되돌려 날이 없어지면 일반 화면으로 나오고 Ctrl+Y도 유지한다", () => {
  const h = editingHarness(false);
  try {
    h.ctx.applyTemplate("daytrip"); h.ctx.setFocusMode(true);
    h.key("z"); h.runFrames();
    assert.equal(h.model.days.length, 0);
    assert.equal(h.root.classList.contains("is-trip-focus"), false);
    assert.equal(h.focusBtn.disabled, true);
    assert.equal(h.ctx.document.activeElement, h.ctx.addDayBtn);
    h.key("y");
    assert.equal(h.model.days.length, 1);
    assert.equal(h.focusBtn.disabled, false);
    assert.equal(h.root.classList.contains("is-trip-focus"), false);
  } finally { h.ctx.history.cancel(); }
});

test("몰입 중 Esc는 글상자 편집·그리기·한글 조합을 방해하지 않고 열린 창부터 닫는다", () => {
  const h = focusHarness();
  h.ctx.setFocusMode(true);
  h.escape(h.main, true);
  assert.equal(h.root.classList.contains("is-trip-focus"), true);
  const edit = new Element(); edit.editing = true; edit.tagName = "textarea";
  h.escape(edit);
  assert.equal(h.root.classList.contains("is-trip-focus"), true);
  h.ctx.els.drawBar.hidden = false; h.escape();
  assert.equal(h.root.classList.contains("is-trip-focus"), true);
  h.ctx.els.drawBar.hidden = true;
  h.ctx.templatePanel.hidden = false; h.escape();
  assert.equal(h.ctx.templatePanel.hidden, true);
  assert.equal(h.root.classList.contains("is-trip-focus"), true);
  h.panels.panel.hidden = false; h.escape();
  assert.equal(h.panels.panel.hidden, true);
  assert.equal(h.root.classList.contains("is-trip-focus"), true);
  h.escape();
  assert.equal(h.root.classList.contains("is-trip-focus"), false);
});
