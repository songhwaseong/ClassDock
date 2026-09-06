// 파일 내려받기 공용(MNDownload).
// "Blob 을 만들어 파일로 준다"가 20여 개 파일에서 25번 되풀이됐고, 그 여섯 줄 중 하나(해제)를
// 빠뜨린 자리가 실제로 있었다. 한 곳에 모았으니 그 한 곳이 여섯 줄을 다 지키는지 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/js/download.js"), "utf8");

// 브라우저 대신 무슨 일이 일어났는지 기록하는 최소한의 그릇.
function browser(){
  const log = { created:[], revoked:[], clicked:[], appended:[], removed:[], timers:[] };
  let seq = 0;
  const body = {
    appendChild(el){ log.appended.push(el); el.__inDocument = true; return el; },
  };
  const context = {
    URL:{
      createObjectURL(blob){ const url = "blob:test/" + (++seq); log.created.push({ url, blob }); return url; },
      revokeObjectURL(url){ log.revoked.push(url); },
    },
    Blob: class { constructor(parts, opts){ this.parts = parts; this.type = (opts || {}).type || ""; } },
    document:{
      body,
      createElement(){
        const el = { href:"", download:"", __inDocument:false,
          click(){ log.clicked.push({ href:this.href, download:this.download, inDocument:this.__inDocument }); },
          remove(){ log.removed.push(this); this.__inDocument = false; } };
        return el;
      },
    },
    setTimeout(fn, ms){ log.timers.push({ fn, ms }); return log.timers.length; },
    module:{ exports:{} },
  };
  vm.createContext(context);
  new vm.Script(source, { filename:"download.js" }).runInContext(context);
  // 최상위 const 는 컨텍스트 객체가 아니라 전역 렉시컬 스코프로 가므로 module.exports 로 받는다.
  return { api:context.module.exports, log, context };
}

const runTimers = (log) => log.timers.forEach((timer) => timer.fn());

test("주소를 만들고, 붙였다 떼고, 그리고 반드시 놓아 준다", () => {
  const { api, log } = browser();
  const blob = { size:10 };
  assert.equal(api.saveBlob(blob, "성적.xlsx"), true);

  assert.equal(log.created.length, 1);
  assert.equal(log.created[0].blob, blob);
  assert.equal(log.clicked.length, 1);
  assert.equal(log.clicked[0].download, "성적.xlsx");
  // 붙지 않은 <a> 의 click() 을 무시하는 브라우저가 있어 문서에 붙인 상태로 눌러야 한다.
  assert.equal(log.clicked[0].inDocument, true);
  assert.equal(log.removed.length, 1, "누른 뒤에는 다시 떼야 화면에 남지 않는다");

  // 누르자마자가 아니라 잠시 뒤에 놓는다 — 바로 놓으면 큰 파일을 다 읽기 전에 주소가 사라진다.
  assert.equal(log.revoked.length, 0, "누른 직후에는 아직 놓지 않는다");
  runTimers(log);
  assert.deepEqual(log.revoked, [log.created[0].url]);
});

test("큰 파일은 놓기까지의 틈을 늘릴 수 있다", () => {
  const { api, log } = browser();
  api.saveBlob({ size:1 }, "영화.mp4", { revokeAfterMs:60000 });
  assert.equal(log.timers[0].ms, 60000);

  const plain = browser();
  plain.api.saveBlob({ size:1 }, "메모.txt");
  assert.equal(plain.log.timers[0].ms, plain.api.DEFAULT_REVOKE_MS);

  // 이상한 값이 와도 기본값으로 돌아간다(0·음수·NaN 이면 주소가 너무 일찍 사라진다).
  for (const bad of [0, -5, NaN, "곧", null, undefined]){
    const one = browser();
    one.api.saveBlob({ size:1 }, "x", { revokeAfterMs:bad });
    assert.equal(one.log.timers[0].ms, one.api.DEFAULT_REVOKE_MS, String(bad));
  }
});

test("글자를 파일로 줄 때 기본은 UTF-8 텍스트다", () => {
  const { api, log } = browser();
  assert.equal(api.saveText("이름,점수\n", "표.csv", "text/csv"), true);
  assert.equal(log.created[0].blob.type, "text/csv");
  // vm 안에서 만든 배열이라 deepEqual 은 realm 이 달라 실패한다 — 값만 본다.
  assert.equal(log.created[0].blob.parts.length, 1);
  assert.equal(log.created[0].blob.parts[0], "이름,점수\n");

  api.saveText("메모", "메모.txt");
  assert.match(log.created[1].blob.type, /^text\/plain;charset=utf-8$/);
});

test("실패하면 false 를 돌려주고 예외를 밖으로 던지지 않는다", () => {
  // 부르는 쪽이 저마다의 안내를 띄운다 — 여기서 toast 를 띄우면 두 번 뜬다.
  const { api, context, log } = browser();
  context.URL.createObjectURL = () => { throw new Error("no blob url"); };
  assert.equal(api.saveBlob({ size:1 }, "x.txt"), false);
  assert.equal(log.clicked.length, 0);

  // 줄 것이 없으면 아무 일도 하지 않는다.
  const empty = browser();
  assert.equal(empty.api.saveBlob(null, "x.txt"), false);
  assert.equal(empty.log.created.length, 0);
});

test("해제가 실패해도 내려받기는 성공으로 남는다", () => {
  // 이미 놓인 주소를 다시 놓는 등의 사정으로 예외가 나도, 파일은 이미 사용자에게 갔다.
  const { api, context, log } = browser();
  context.URL.revokeObjectURL = () => { throw new Error("already revoked"); };
  assert.equal(api.saveBlob({ size:1 }, "x.txt"), true);
  runTimers(log);
});

test("공개 API 는 셋뿐이고 바꿔 끼울 수 없다", () => {
  const { api } = browser();
  assert.deepEqual(Object.keys(api).sort(), ["DEFAULT_REVOKE_MS", "saveBlob", "saveText"]);
  assert.ok(Object.isFrozen(api));
});

test("화면에 계속 걸어 두는 주소는 이 길로 오지 않는다", () => {
  // pdf.js 워커의 workerSrc 는 앱이 살아 있는 동안 살아 있어야 해서 해제하면 안 된다.
  // 내려받기 공용화를 하면서 '해제 안 하는 자리'를 싸잡아 고치지 않도록 이유를 남겨 둔다.
  const state = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
  assert.match(state, /GlobalWorkerOptions\.workerSrc = URL\.createObjectURL/);
  assert.ok(!/MNDownload/.test(state), "워커 주소는 내려받기가 아니다");
  assert.match(source, /workerSrc 처럼 앱이 살아 있는 동안 살아 있어야 하는 것/);
});
