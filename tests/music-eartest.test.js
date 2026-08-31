"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// DOM·소리는 최소한의 모형으로 대체하고, 브라우저 없이 진행 로직을 검증한다.
function loadEarTest(){
  const elements = [];
  const timers = new Map();
  const played = [];
  const summaries = [];
  let timerId = 0;
  function createElement(){
    const element = {
      children:[], dataset:{}, listeners:{}, textContent:"", disabled:false,
      append(...children){ this.children.push(...children); },
      appendChild(child){ this.children.push(child); },
      replaceChildren(...children){ this.children = children; },
      setAttribute(){}, focus(){},
      addEventListener(name, fn){ this.listeners[name] = fn; },
      click(){ if (!this.disabled && this.listeners.click) this.listeners.click(); }
    };
    elements.push(element);
    return element;
  }
  const context = vm.createContext({
    document:{ createElement },
    setTimeout(fn){ const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id){ timers.delete(id); },
    MNMusicAudio:{
      previewNote(note, timbre, options){
        played.push(note);
        if (options.onScheduled) options.onScheduled();
        return true;
      },
      stop(){}, cancelPreview(){}
    }
  });
  for (const file of ["music-model.js", "music-eartest.js"]){
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8"), context);
  }
  const api = vm.runInContext("MNMusicEarTest", context);
  const ear = api.create({ onFinish:summary => summaries.push(summary) });
  return {
    api, ear, played, summaries,
    replayButton:elements.find(el => el.className === "music-btn music-ear-replay"),
    againButton:elements.find(el => el.textContent === "↻ 한 번 더"),
    nextTimer(){
      const next = timers.entries().next().value;
      assert.ok(next, "다음 진행 타이머가 있어야 한다");
      timers.delete(next[0]);
      next[1]();
    }
  };
}

test("다시 듣기 선택지는 1~10회와 무제한이고 기본값은 1회다", () => {
  const { api } = loadEarTest();
  assert.deepEqual(Array.from(api.REPLAY_LIMITS), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "unlimited"]);
  assert.equal(api.REPLAY_LIMIT, 1);
});

for (let limit = 1; limit <= 10; limit++){
  test(`문제마다 다시 듣기 ${limit}회: 버튼과 직접 호출이 같은 제한을 따른다`, () => {
    const h = loadEarTest();
    assert.equal(h.ear.start({ level:1, count:5, replayLimit:String(limit) }), true);
    assert.equal(h.replayButton.disabled, true);
    h.ear.replay();
    assert.equal(h.played.length, 0, "첫 소리 전에는 다시 듣지 않는다");
    h.nextTimer();
    assert.equal(h.played.length, 1, "첫 소리는 다시 듣기 횟수에 포함하지 않는다");
    for (let used = 0; used < limit; used++){
      assert.equal(h.replayButton.disabled, false);
      assert.match(h.replayButton.textContent, new RegExp(`${limit - used}번 남음`));
      if (used % 2) h.ear.replay();
      else h.replayButton.click();
    }
    assert.equal(h.played.length, limit + 1);
    assert.equal(h.replayButton.disabled, true);
    assert.match(h.replayButton.textContent, /다 썼어요/);
    h.ear.replay();
    h.replayButton.click();
    assert.equal(h.played.length, limit + 1);
    h.ear.press(0);
    const afterAnswer = h.played.length;
    h.ear.replay();
    assert.equal(h.played.length, afterAnswer, "정답 표시 중에는 다시 듣지 않는다");
    h.nextTimer();
    h.nextTimer();
    assert.equal(h.ear.phase(), "ask");
    assert.equal(h.replayButton.disabled, false);
    assert.match(h.replayButton.textContent, new RegExp(`${limit}번 남음`));
    h.ear.stop();
  });
}

test("무제한은 여러 번 들어도 잠기지 않고 사용 횟수는 결과에 남는다", () => {
  const h = loadEarTest();
  h.ear.start({ level:1, count:5, replayLimit:"unlimited" });
  h.nextTimer();
  for (let i = 0; i < 100; i++) h.replayButton.click();
  assert.equal(h.played.length, 101);
  assert.equal(h.replayButton.disabled, false);
  assert.match(h.replayButton.textContent, /무제한/);
  h.ear.press(0);
  const summary = h.ear.stop();
  assert.equal(summary.replays, 100);
  const afterStop = h.played.length;
  h.ear.replay();
  assert.equal(h.played.length, afterStop);
});

for (const limit of [3, "unlimited"]){
  test(`한 번 더에서도 다시 듣기 설정(${limit})을 유지하고 사용 횟수는 초기화한다`, () => {
    const h = loadEarTest();
    h.ear.start({ level:1, count:5, replayLimit:limit });
    h.nextTimer();
    while (!h.ear.finished()){
      h.ear.replay();
      h.ear.press(0);
      h.nextTimer();
      if (!h.ear.finished()) h.nextTimer();
    }
    assert.equal(h.summaries[0].replays, 5);
    h.againButton.click();
    h.nextTimer();
    assert.equal(h.replayButton.disabled, false);
    assert.match(h.replayButton.textContent, limit === "unlimited" ? /무제한/ : /3번 남음/);
    h.ear.press(0);
    assert.equal(h.ear.stop().replays, 0);
  });
}

test("없는 설정이나 잘못된 값은 기존 기본값 1회로 돌아간다", () => {
  const h = loadEarTest();
  for (const value of [undefined, null, "", "wrong", 0, -1, 1.5, 11, Infinity]){
    h.ear.start({ level:1, count:5, replayLimit:value });
    h.nextTimer();
    assert.match(h.replayButton.textContent, /1번 남음/);
    h.ear.replay();
    assert.equal(h.replayButton.disabled, true);
    h.ear.stop();
  }
});

test("무제한 테스트를 종료하고 1회로 시작하면 새 제한을 적용한다", () => {
  const h = loadEarTest();
  h.ear.start({ level:1, count:5, replayLimit:"unlimited" });
  h.ear.stop();
  h.ear.start({ level:1, count:5, replayLimit:1 });
  h.nextTimer();
  assert.match(h.replayButton.textContent, /1번 남음/);
  h.ear.replay();
  assert.equal(h.replayButton.disabled, true);
  h.ear.destroy();
});
