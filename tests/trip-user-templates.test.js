"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
Object.assign(globalThis, require("../src/js/diary.js"));
const trip = require("../src/js/trip.js");

function storage(){
  const values = new Map();
  return { getItem:key => values.get(key) || null, setItem:(key, value) => values.set(key, value), values };
}
const custom = (id="user-one", name="가족 캠핑") => ({ id, name, checklist:["텐트", "물"], questions:["오늘의 캠핑장", "가족과 기억할 순간"] });

test("내 여행 양식은 저장 후 새 목록에서 다시 읽으며, 기본 양식과 다른 언어에서도 함께 제공된다", () => {
  const saved = storage();
  assert.equal(trip.tripWriteUserTemplates([custom()], saved), true);
  assert.deepEqual(trip.tripReadUserTemplates(saved), [custom()]);
  const catalog = trip.tripGetTemplates(saved);
  assert.equal(catalog.length, 4);
  assert.deepEqual(catalog.slice(0, 3), trip.TRIP_TEMPLATES);
  assert.deepEqual(catalog[3].name, ["가족 캠핑", "가족 캠핑"]);
  assert.deepEqual(catalog[3].questions[0], ["오늘의 캠핑장", "오늘의 캠핑장"]);
  saved.setItem(trip.TRIP_USER_TEMPLATES_KEY, "broken json");
  assert.deepEqual(trip.tripReadUserTemplates(saved), []);
  assert.equal(trip.tripGetTemplates(saved).length, 3);
  assert.equal(trip.tripWriteUserTemplates([custom()], { setItem:() => { throw new Error("quota"); } }), false);
});

test("내 양식은 빈 항목·중복·잘못된 식별자를 거르고, 줄 수·글자 수·양식 개수를 제한한다", () => {
  const normalized = trip.tripNormalizeUserTemplates([
    null, {}, { ...custom(), id:"daytrip" }, { ...custom(), name:" " },
    { ...custom(), checklist:[], questions:[] },
    { ...custom(), name:" 가족\n 캠핑 ", checklist:" 텐트 \r\n\n텐트\n 물 ", questions:["기억", "기억", 123] },
    custom()
  ]);
  assert.deepEqual(normalized, [{ id:"user-one", name:"가족 캠핑", checklist:["텐트", "물"], questions:["기억"] }]);
  const many = Array.from({ length:35 }, (_, i) => ({ ...custom("user-" + i), name:"이름".repeat(50),
    checklist:Array.from({ length:220 }, (_, j) => "준비" + j + "x".repeat(130)),
    questions:Array.from({ length:50 }, (_, j) => "질문" + j + "x".repeat(320)) }));
  const limited = trip.tripNormalizeUserTemplates(many);
  assert.equal(limited.length, 30);
  assert.equal(limited[0].name.length, 80);
  assert.equal(limited[0].checklist.length, 200);
  assert.equal(limited[0].checklist[0].length, 120);
  assert.equal(limited[0].questions.length, 40);
  assert.equal(limited[0].questions[0].length, 300);
});

test("내 템플릿은 기존 기록에 더하고, 반복·언어 전환 때 중복하지 않으며 여행 파일에 적용 내용을 저장한다", async () => {
  const saved = storage(); trip.tripWriteUserTemplates([custom()], saved);
  const model = trip.tripEmpty("캠핑");
  model.days.push(trip.tripNormalizeDay({ id:"dy-1", title:"첫날", text:"먼저 쓴 글" }));
  model.checklist.push({ id:"ck-one", text:"물", done:true });
  const options = { templates:trip.tripGetTemplates(saved) };
  const result = trip.tripApplyTemplate(model, "dy-1", "user-one", options);
  assert.equal(result.addedChecklist, 1);
  assert.equal(model.checklist[0].done, true);
  assert.ok(model.days[0].text.startsWith("먼저 쓴 글\n\n— 가족 캠핑 기록 —"));
  assert.equal(model.days[0].title, "첫날");
  const before = trip.tripContentKey(model);
  assert.equal(trip.tripApplyTemplate(model, "dy-1", "user-one", { ...options, en:true }).changed, false);
  trip.tripWriteUserTemplates([{ ...custom(), questions:["수정한 질문"] }], saved);
  assert.equal(trip.tripContentKey(model), before, "저장된 양식 수정은 이미 쓴 글을 바꾸지 않는다");
  trip.tripWriteUserTemplates([], saved);
  assert.equal(trip.tripContentKey(model), before, "양식 삭제도 문서 내용을 유지한다");
  const reopened = await trip.tripUnpack(trip.tripPack(model, new Map()));
  assert.equal(reopened.model.days[0].text, model.days[0].text);
  assert.deepEqual(reopened.model.checklist, model.checklist);
});

test("준비물만 있는 내 양식은 빈 날·질문 머리를 만들지 않고 질문만 있는 양식은 준비물을 만들지 않는다", () => {
  const saved = storage();
  trip.tripWriteUserTemplates([{ ...custom("user-pack"), questions:[] }, { ...custom("user-note"), checklist:[] }], saved);
  const model = trip.tripEmpty("여행"), options = { templates:trip.tripGetTemplates(saved) };
  assert.equal(trip.tripApplyTemplate(model, "", "user-pack", { ...options, checklist:false }).reason, "empty");
  assert.equal(trip.tripApplyTemplate(model, "", "user-pack", options).addedQuestions, false);
  assert.equal(model.days.length, 0);
  assert.equal(model.checklist.length, 2);
  assert.equal(trip.tripApplyTemplate(model, "", "user-note", options).addedChecklist, 0);
  assert.equal(model.days.length, 1);
});

// 실제 패널 함수를 작은 DOM 대역으로 실행한다. 브라우저·화면 캡처 없이 입력과 저장 경로를 검증한다.
class Node {
  constructor(tag){ this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.className = ""; this.textContent = ""; }
  append(...nodes){ this.children.push(...nodes); }
  replaceChildren(...nodes){ this.children = nodes; }
  addEventListener(name, fn){ this.listeners[name] = fn; }
  setAttribute(name, value){ this.attributes[name] = value; }
  focus(){ this.focused = true; }
  all(){ return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector){
    const match = /^(?:\.([\w-]+)(?:\[data-template="([^"]+)"\])?|([\w-]+))$/.exec(selector);
    assert.ok(match, "지원하는 테스트 선택자: " + selector);
    return this.all().filter(node => (match[1] ? node.className.split(" ").includes(match[1]) : node.tagName === match[3])
      && (!match[2] || node.dataset.template === match[2]));
  }
  querySelector(selector){ return this.querySelectorAll(selector)[0] || null; }
  fire(name){ this.listeners[name]({ preventDefault:() => {} }); }
}
function panelHarness(saved=storage(), en=false){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/trip.js"), "utf8");
  const from = source.indexOf("  let templateChecklist = true"), to = source.indexOf("  function positionTemplatePanel()", from);
  assert.ok(from >= 0 && to > from);
  const panel = new Node("div"), applied = [], statuses = [];
  const ctx = vm.createContext({ ...trip, localStorage:saved, templatePanel:panel, tripIsEn:() => en,
    document:{ createElement:tag => new Node(tag) },
    diaryButton:(_, text, cls) => { const node = new Node("button"); node.className = cls; node.textContent = text; return node; },
    positionTemplatePanel:() => {}, setTemplateOpen:() => {}, templateBtn:new Node("button"),
    applyTemplate:id => applied.push(id), setStatus:text => statuses.push(text)
  });
  vm.runInContext(source.slice(from, to), ctx); ctx.renderTemplatePanel();
  return { ctx, panel, saved, applied, statuses,
    button:text => { const found = panel.all().find(node => node.tagName === "button" && node.textContent === text); assert.ok(found, text); return found; },
    fill:(name, value) => { const field = panel.querySelector(".trip-template-" + name); field.value = value; field.fire("input"); },
    submit:() => panel.querySelector("form").fire("submit")
  };
}

test("실제 패널에서 새 양식을 저장·선택·수정·삭제하고 새 편집창에서도 다시 사용한다", () => {
  const h = panelHarness();
  h.button("＋ 새 템플릿 만들기").fire("click");
  h.fill("name", "산책 기록"); h.fill("checklist", "물\n물\n카메라"); h.fill("questions", "걸은 길\n기억할 순간"); h.submit();
  const first = trip.tripReadUserTemplates(h.saved)[0];
  assert.equal(first.name, "산책 기록"); assert.deepEqual(first.checklist, ["물", "카메라"]);
  h.panel.querySelector('.trip-template-option[data-template="' + first.id + '"]').fire("click");
  assert.deepEqual(h.applied, [first.id]);
  const next = panelHarness(h.saved, true);
  assert.ok(next.panel.querySelector('.trip-template-option[data-template="' + first.id + '"]'));
  h.button("수정").fire("click");
  h.fill("questions", "새 질문"); h.submit();
  assert.equal(trip.tripReadUserTemplates(h.saved)[0].id, first.id);
  assert.deepEqual(trip.tripReadUserTemplates(h.saved)[0].questions, ["새 질문"]);
  h.button("삭제").fire("click");
  assert.equal(trip.tripReadUserTemplates(h.saved).length, 1, "첫 삭제 클릭은 확인 상태만 연다");
  h.button("삭제 확인").fire("click");
  assert.deepEqual(trip.tripReadUserTemplates(h.saved), []);
});

test("기본 양식 복사·수정은 원본을 유지하고, 빈 양식·같은 이름·저장 실패는 편집 내용을 보존한다", () => {
  const h = panelHarness();
  const original = JSON.stringify(trip.TRIP_TEMPLATES);
  h.button("복사·수정").fire("click");
  assert.equal(h.panel.querySelector(".trip-template-name").value, "당일치기 (내 양식)");
  h.fill("checklist", "나의 준비물"); h.submit();
  assert.equal(JSON.stringify(trip.TRIP_TEMPLATES), original);
  assert.deepEqual(trip.tripReadUserTemplates(h.saved)[0].checklist, ["나의 준비물"]);
  h.button("＋ 새 템플릿 만들기").fire("click"); h.submit();
  assert.match(h.panel.querySelector(".trip-template-error").textContent, /하나 이상/);
  h.fill("name", "당일치기"); h.fill("questions", "질문"); h.submit();
  assert.match(h.panel.querySelector(".trip-template-error").textContent, /같은 이름/);
  h.fill("name", "내 답사");
  const write = h.saved.setItem; h.saved.setItem = () => { throw new Error("quota"); };
  h.submit();
  assert.match(h.panel.querySelector(".trip-template-error").textContent, /저장하지 못/);
  assert.equal(h.panel.querySelector(".trip-template-questions").value, "질문");
  h.ctx.renderTemplatePanel();
  assert.equal(h.panel.querySelector(".trip-template-name").value, "내 답사", "다시 그려도 초안 유지");
  h.saved.setItem = write; h.submit();
  assert.equal(trip.tripReadUserTemplates(h.saved).length, 2);
});

test("내 양식의 준비물·질문 선택과 저장 한도·삭제 취소도 실제 패널에서 처리한다", () => {
  const saved = storage();
  trip.tripWriteUserTemplates([{ ...custom("user-pack"), questions:[] }], saved);
  const h = panelHarness(saved), option = h.panel.querySelector('.trip-template-option[data-template="user-pack"]');
  assert.equal(option.disabled, false);
  const checkboxes = h.panel.querySelectorAll("input");
  checkboxes[0].checked = false; checkboxes[0].fire("change");
  assert.equal(option.disabled, true, "준비물을 해제하면 준비물 전용 양식은 적용 불가");
  h.button("삭제").fire("click"); h.button("취소").fire("click");
  assert.equal(trip.tripReadUserTemplates(saved).length, 1);
  trip.tripWriteUserTemplates(Array.from({ length:30 }, (_, i) => custom("user-" + i, "이름" + i)), saved);
  h.ctx.openTemplateEditor(null); h.fill("name", "서른한 번째"); h.fill("questions", "질문"); h.submit();
  assert.match(h.panel.querySelector(".trip-template-error").textContent, /30개/);
  assert.equal(trip.tripReadUserTemplates(saved).length, 30);
});
