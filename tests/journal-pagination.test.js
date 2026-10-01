"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const diary = require("../src/js/diary.js");
const trip = require("../src/js/trip.js");

// 실제 렌더 함수를 최소 DOM 대역에서 실행한다. 브라우저를 띄우지 않는다.
class Element {
  constructor(){ this.children = []; this.listeners = {}; this.dataset = {}; this.className = ""; }
  append(...nodes){ this.children.push(...nodes); }
  replaceChildren(...nodes){ this.children = nodes; }
  addEventListener(name, listener){ this.listeners[name] = listener; }
  setAttribute(){}
  focus(){ this.focused = true; }
  click(){ this.listeners.click(); }
  get lastElementChild(){ return this.children.at(-1); }
  querySelector(selector){ return this.all(selector).at(0) || null; }
  all(selector){
    const matches = [];
    const visit = node => {
      if (node.className.split(" ").some(name => selector === "." + name)) matches.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }
}
const documentStub = { createElement:() => new Element() };
const button = (text, _title, className) => Object.assign(new Element(), { textContent:text, className });
function runSection(file, start, end, env){
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "js", file), "utf8");
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  const context = vm.createContext({ document:documentStub, ...env });
  vm.runInContext(source.slice(from, to), context);
  return context;
}

test("일기 더 보기는 모든 결과에 도달하고 검색 조건을 바꾸면 초기화한다", () => {
  const model = { entries:Array.from({ length:205 }, (_, i) => ({
    date:diary.diaryAddDays("2025-01-01", i), text:i < 5 ? "특별한 날" : "기록"
  })) };
  const monthList = new Element(), searchInput = { value:"" }, searchFilter = { value:"all" };
  const ctx = runSection("diary.js", "  let searchVisible = 100, searchCriteria", "  /* 사진만 모아 보기", {
    model, monthList, searchInput, searchFilter, searchTag:{ value:"" }, searchMood:{ value:"" },
    searchResults:new Element(), diaryCleanEntries:m => m.entries.slice(), syncSearchDetailOptions:() => {},
    diaryFilterEntries:diary.diaryFilterEntries, diaryIsEn:() => false, diaryButton:button,
    renderEntryCards:rows => monthList.replaceChildren(...rows.map(row => Object.assign(new Element(), { date:row.date })))
  });
  ctx.renderSearchResults();
  assert.equal(monthList.children.filter(n => n.date).length, 100);
  monthList.querySelector(".diary-search-more").click();
  assert.equal(monthList.children.filter(n => n.date).length, 200);
  // 날짜 이동·내용 갱신으로 다시 그려도 더 본 범위는 유지한다.
  ctx.renderSearchResults();
  assert.equal(monthList.children.filter(n => n.date).length, 200);
  monthList.querySelector(".diary-search-more").click();
  assert.equal(new Set(monthList.children.map(n => n.date)).size, 205);
  assert.equal(monthList.querySelector(".diary-search-more"), null);
  searchInput.value = "특별한"; ctx.renderSearchResults();
  assert.equal(monthList.children.length, 5);
  searchInput.value = ""; ctx.renderSearchResults();
  assert.equal(monthList.children.filter(n => n.date).length, 100);
});

test("사진 더 보기는 300장 이후도 중복 없이 마지막 사진까지 표시한다", () => {
  const photoPane = new Element();
  const model = { entries:[{ date:"2026-10-01", stickers:Array.from({ length:601 }, (_, i) => ({
    id:"st-" + i, kind:"photo", asset:"assets/photo" + i + ".jpg"
  })) }] };
  const ctx = runSection("diary.js", "  const DIARY_PHOTO_WALL_MAX = 300;", "  // 그 스티커를 골라 주고", {
    model, photoPane, current:"2026-10-01", diaryCleanEntries:m => m.entries, diaryStickerKind:diary.diaryStickerKind,
    assetUrl:name => name, diaryIsEn:() => false, diaryButton:button, diaryUiShortDate:d => d, diaryUiDateLabel:d => d,
    goTo:() => {}, revealSticker:() => {}, openPhotoViewer:() => {}
  });
  ctx.renderPhotoWall();
  assert.equal(photoPane.all(".diary-photo-cell").length, 300);
  photoPane.querySelector(".diary-photo-more").click();
  assert.equal(photoPane.all(".diary-photo-cell").length, 600);
  photoPane.querySelector(".diary-photo-more").click();
  const cells = photoPane.all(".diary-photo-cell");
  assert.equal(cells.length, 601);
  assert.equal(new Set(cells.map(cell => cell.children[0].src)).size, 601);
  assert.equal(photoPane.querySelector(".diary-photo-more"), null);
});

test("여행 검색 더 보기는 전체 결과를 표시하고 새 검색어에서 초기화한다", () => {
  const model = { days:Array.from({ length:205 }, (_, i) => ({ id:"dy-" + i, title:"여행 " + i, spots:[] })) };
  const searchResults = new Element(), searchInput = { value:"여행" };
  const ctx = runSection("trip.js", "  let searchVisible = 100, lastSearchQuery", "  searchInput.addEventListener(\"input\"", {
    model, searchInput, searchResults, railList:new Element(), addDayBtn:new Element(), checkBox:new Element(),
    tripSearchRows:trip.tripSearchRows, tripIsEn:() => false, dayOf:id => model.days.find(d => d.id === id),
    tripDayLabel:(_m, day) => day.id, tripStickerText:() => "", goTo:() => {}, spotList:new Element(),
    paperApi:{}, els:{}
  });
  ctx.renderTripSearchResults();
  assert.equal(searchResults.all(".trip-search-result").length, 100);
  searchResults.querySelector(".trip-search-more").click();
  assert.equal(searchResults.all(".trip-search-result").length, 200);
  searchResults.querySelector(".trip-search-more").click();
  assert.equal(searchResults.all(".trip-search-result").length, 205);
  assert.equal(searchResults.querySelector(".trip-search-more"), null);
  searchInput.value = "없는 기록"; ctx.renderTripSearchResults();
  assert.equal(searchResults.all(".trip-search-result").length, 0);
  searchInput.value = "여행"; ctx.renderTripSearchResults();
  assert.equal(searchResults.all(".trip-search-result").length, 100);
});
