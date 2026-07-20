"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function notificationHarness(count = 1){
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petSay");
  const end = source.indexOf("\n// ----- 수업 이벤트 반응", start);
  assert.ok(start >= 0 && end > start);

  const classes = new Set();
  const timeouts = [];
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
    noticeActive:false,
    noticeText:"",
    noticeQueue:[],
    noticeBubbleWidth:0,
    noticeBubbleHeight:0,
    bubbleVisible:false
  };
  const world = { pets:Array.from({ length:count }, (_, index) => index === 0 ? pet : {
    el:{ isConnected:true }, state:"idle", noticeQueue:[]
  }) };
  const context = {
    __world:world,
    document:{ hidden:false },
    setTimeout:(fn, delay) => { timeouts.push({ fn, delay }); return timeouts.length; },
    clearTimeout:() => {},
    Date,
    Math
  };
  vm.createContext(context);
  vm.runInContext(
    "let petWorld=globalThis.__world;\n" + source.slice(start, end)
      + "\n;globalThis.__petNoticeTest={notify:petNotify,say:petSay,duration:petNoticeDuration};",
    context
  );
  return { api:context.__petNoticeTest, pet, classes, timeouts, context };
}

test("픽셀 펫이 정확히 한 마리일 때 알림을 말풍선으로 맡는다", () => {
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

test("펫이 없거나 여러 마리거나 붙잡힌 중이면 기존 토스트로 되돌린다", () => {
  assert.equal(notificationHarness(2).api.notify("알림", 2200, {}), false);
  const single = notificationHarness(1);
  single.pet.state = "drag";
  assert.equal(single.api.notify("알림", 2200, {}), false);
  single.pet.state = "idle";
  single.context.document.hidden = true;
  assert.equal(single.api.notify("알림", 2200, {}), false);
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
