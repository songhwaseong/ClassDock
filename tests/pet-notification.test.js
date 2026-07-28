"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function makePet(index){
  const classes = new Set();
  const bubbleText = { textContent:"" };
  const bubble = {
    offsetWidth:240,
    offsetHeight:52,
    classList:{
      add:name => classes.add(name),
      remove:name => classes.delete(name),
      toggle:(name, on) => on ? classes.add(name) : classes.delete(name)
    }
  };
  const pet = {
    bubble,
    bubbleText,
    bubbleTimer:0,
    el:{ isConnected:true },
    state:"idle",
    petEvent:null,
    x:100 + index * 60, y:400, w:36, h:36,
    noticeActive:false,
    noticeText:"",
    noticeItem:null,
    noticeQueue:[],
    noticeBubbleWidth:0,
    noticeBubbleHeight:0,
    bubbleVisible:false
  };
  return { pet, classes };
}

// randoms: Math.random() 이 돌려줄 값을 순서대로 지정해 화자 선택을 고정한다(비면 0).
function notificationHarness(count = 1, randoms = []){
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petSay");
  const end = source.indexOf("\n// ----- 수업 이벤트 반응", start);
  assert.ok(start >= 0 && end > start);

  const timeouts = [];
  const entries = Array.from({ length:count }, (_, index) => makePet(index));
  const world = { pets:entries.map(entry => entry.pet), lastNoticePet:null };
  const queue = randoms.slice();
  const math = Object.create(Math);
  math.random = () => queue.length ? queue.shift() : 0;
  const context = {
    __world:world,
    document:{ hidden:false },
    window:{ innerWidth:1280, innerHeight:800 },
    PET_W:36, PET_H:36,
    setTimeout:(fn, delay) => { timeouts.push({ fn, delay }); return timeouts.length; },
    clearTimeout:() => {},
    Date,
    Math:math
  };
  vm.createContext(context);
  vm.runInContext(
    "let petWorld=globalThis.__world;\n" + source.slice(start, end)
      + "\n;globalThis.__petNoticeTest={notify:petNotify,say:petSay,duration:petNoticeDuration"
      + ",canNotice:petCanNotice,pick:petPickNoticePet,rescue:petRescueNotices};",
    context
  );
  // 대기 중인 타이머를 순서대로 실행해 말풍선이 사라지고 다음 알림이 이어지게 한다.
  const flush = () => { while (timeouts.length) timeouts.shift().fn(); };
  return {
    api:context.__petNoticeTest,
    pet:entries.length ? entries[0].pet : null,
    classes:entries.length ? entries[0].classes : new Set(),
    pets:entries.map(entry => entry.pet), all:entries,
    world, timeouts, flush, context
  };
}

test("픽셀 펫이 한 마리일 때 알림을 말풍선으로 맡는다", () => {
  const { api, pet, classes, timeouts } = notificationHarness(1);
  assert.equal(api.notify("저장했어요.", 2200, { type:"success" }), true);
  assert.equal(pet.bubbleText.textContent, "저장했어요.");
  assert.equal(pet.noticeActive, true);
  assert.equal(pet.bubbleVisible, true);
  assert.equal(pet.noticeBubbleWidth, 240);
  assert.equal(pet.noticeBubbleHeight, 52);
  assert.equal(classes.has("show"), true);
  assert.equal(classes.has("pet-notice"), true);
  assert.equal(classes.has("success"), true);
  assert.ok(timeouts[0].delay >= 2200);
});

test("알림 표시 중에는 일반 펫 대사가 내용을 덮어쓰지 않는다", () => {
  const { api, pet } = notificationHarness(1);
  api.notify("파일을 저장했어요.", 2200, {});
  assert.equal(api.say(pet, "안녕하세요!", false), false);
  assert.equal(pet.bubbleText.textContent, "파일을 저장했어요.");
});

test("여러 마리일 때는 무작위로 뽑힌 한 마리만 알림을 말한다", () => {
  const { api, pets, all } = notificationHarness(3, [0.9]);
  assert.equal(api.notify("저장했어요.", 2200, {}), true);
  assert.equal(pets[2].noticeActive, true);                       // floor(0.9 * 3) = 2
  assert.equal(pets[2].bubbleText.textContent, "저장했어요.");
  assert.equal(pets[0].noticeActive, false);
  assert.equal(pets[1].noticeActive, false);
  assert.equal(all.filter(entry => entry.classes.has("show")).length, 1);
});

test("읽는 중인 펫이 있으면 다음 알림도 같은 펫이 이어 읽는다", () => {
  const { api, pets, all } = notificationHarness(3, [0.4, 0.9]);
  api.notify("첫 번째 알림", 2200, {});
  api.notify("두 번째 알림", 2200, {});
  assert.equal(pets[1].noticeActive, true);                       // floor(0.4 * 3) = 1
  assert.equal(pets[1].noticeQueue.length, 1);
  assert.equal(pets[1].noticeQueue[0].text, "두 번째 알림");
  assert.equal(all.filter(entry => entry.classes.has("show")).length, 1);
});

test("알림이 끝난 뒤 다음 알림은 직전에 말한 펫을 피해 간다", () => {
  const { api, pets, world, flush } = notificationHarness(2, [0]);
  api.notify("첫 번째 알림", 2200, {});
  assert.equal(world.lastNoticePet, pets[0]);
  flush();                                                        // 말풍선 종료 → 대기열 비움
  assert.equal(pets[0].noticeActive, false);
  api.notify("두 번째 알림", 2200, {});
  assert.equal(pets[1].noticeActive, true);
  assert.equal(pets[0].noticeActive, false);
});

test("같은 문구는 다른 펫에게 중복으로 배정되지 않는다", () => {
  const { api, pets } = notificationHarness(3, [0]);
  api.notify("저장했어요.", 2200, {});
  assert.equal(api.notify("저장했어요.", 2200, {}), true);
  const queued = pets.reduce((sum, p) => sum + p.noticeQueue.length, 0);
  assert.equal(queued, 0);
  assert.equal(pets.filter(p => p.noticeActive).length, 1);
});

test("붙잡혔거나 연출 중이거나 화면 밖인 펫은 알림을 맡지 않는다", () => {
  const { api, pets } = notificationHarness(3, [0]);
  pets[0].state = "drag";
  pets[1].petEvent = {};
  assert.equal(api.canNotice(pets[0]), false);
  assert.equal(api.canNotice(pets[1]), false);
  assert.equal(api.notify("알림", 2200, {}), true);
  assert.equal(pets[2].noticeActive, true);                       // 남은 한 마리가 맡는다

  const off = notificationHarness(2, [0]);
  off.pets[0].x = 2000;                                           // 화면 오른쪽 밖
  off.pets[1].y = -400;                                           // 화면 위쪽 밖
  assert.equal(off.api.notify("알림", 2200, {}), false);
});

test("펫이 없거나 탭이 숨겨져 있으면 기존 토스트로 되돌린다", () => {
  assert.equal(notificationHarness(0).api.notify("알림", 2200, {}), false);
  const single = notificationHarness(1);
  single.context.document.hidden = true;
  assert.equal(single.api.notify("알림", 2200, {}), false);
});

test("알림을 맡은 펫이 사라지면 남은 펫이 이어받는다", () => {
  const { api, pets, world } = notificationHarness(2, [0, 0]);
  api.notify("저장했어요.", 2200, { type:"success" });
  assert.equal(pets[0].noticeActive, true);
  world.pets.splice(0, 1);                                        // 마릿수 감축으로 제거된 상황
  api.rescue(pets[0], world);
  assert.equal(pets[0].noticeActive, false);
  assert.equal(pets[0].noticeItem, null);
  assert.equal(pets[1].noticeActive, true);
  assert.equal(pets[1].bubbleText.textContent, "저장했어요.");
  assert.equal(world.lastNoticePet, pets[1]);
});

test("마릿수를 줄일 때 사라지는 펫의 알림을 넘겨준다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  assert.match(source, /function petTrimTo[\s\S]*petRescueNotices\(p, w\)/);
});

test("공용 토스트는 일반 알림만 펫에게 넘기고 행동 버튼은 화면에도 유지한다", () => {
  const state = fs.readFileSync(path.join(root, "src/js/state.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(state, /const petHandled = typeof petNotify === "function" && petNotify\(msg, ms, opts\)/);
  assert.match(state, /if \(petHandled && !hasAction\)/);
  assert.match(state, /className = "toast-announcement"/);
  assert.match(styles, /\.pixel-pet-bubble\.pet-notice/);
  assert.match(styles, /\.pixel-pet-bubble::before,\s*\.pixel-pet-bubble::after/);
  assert.match(styles, /\.pixel-pet-bubble-text::before,\s*\.pixel-pet-bubble-text::after/);
  assert.match(styles, /clip-path:inset\(0 0 52% 0\)/);
  assert.match(styles, /calc\(50% - var\(--pet-bubble-shift,0px\)\)/);
  assert.match(styles, /\.toast-announcement/);
});
