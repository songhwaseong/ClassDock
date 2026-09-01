"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/js/diagnostics.js"), "utf8");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function loadDiagnostics(options={}){
  const storage = new Map();
  const requests = [];
  const listeners = new Map();
  const intervals = [];
  const previous = options.previous || {};
  const serverEvents = options.serverEvents || [];
  const context = {
    console, Date, Math, JSON, Number, String, Object, Array, Map, Set, Error, Promise,
    Blob:class Blob {}, URL:{ createObjectURL:() => "blob:test", revokeObjectURL(){} },
    navigator:{ clipboard:{ writeText:async () => {} } },
    performance:{ memory:{ usedJSHeapSize:25 * 1048576, jsHeapSizeLimit:1000 * 1048576 } },
    document:{
      visibilityState:"visible", fullscreenElement:null,
      body:{ classList:{ contains:() => false }, appendChild(){} },
      querySelector:() => null, getElementById:() => null
    },
    localStorage:{
      get length(){ return storage.size; },
      key:(index) => [...storage.keys()][index] || null,
      getItem:(key) => storage.has(key) ? storage.get(key) : null,
      setItem:(key, value) => storage.set(String(key), String(value)),
      removeItem:(key) => storage.delete(String(key))
    },
    crypto:{ randomUUID:() => "session-test" },
    CustomEvent:class CustomEvent { constructor(type, init){ this.type = type; this.detail = init && init.detail; } },
    addEventListener:(type, fn) => listeners.set(type, fn),
    dispatchEvent:(event) => { const fn = listeners.get(event.type); if (fn) fn(event); },
    setInterval:(fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval:() => {},
    setTimeout:(fn) => { fn(); return 1; }, clearTimeout:() => {},
    fetch:async (url, init={}) => {
      requests.push({ url:String(url), init });
      if (String(url).startsWith("/diagnostics/session") && (!init.method || init.method === "GET")){
        return { ok:true, status:200, json:async () => previous };
      }
      if (String(url).startsWith("/diagnostics/events?") && (!init.method || init.method === "GET")){
        return { ok:true, status:200, json:async () => serverEvents };
      }
      return { ok:true, status:200, json:async () => ({}) };
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source + "\n;globalThis.__diagnostics = MNDiagnostics;", context, { filename:"diagnostics.js" });
  return { api:context.__diagnostics, storage, requests, listeners, intervals };
}

test("진단 정보는 문서 내용·키·개인 경로를 제거하고 길이를 제한한다", () => {
  const { api } = loadDiagnostics();
  const clean = api.sanitize({
    screen:"music", documentText:"악보 전체 내용", apiKey:"sk-very-secret-token-value",
    message:"실패 C:\\Users\\student\\Documents\\private.msheet?token=abcdef",
    nested:{ code:"print('secret')", safe:42 }
  });

  assert.equal(clean.documentText, "[제외]");
  assert.equal(clean.apiKey, "[제외]");
  assert.equal(clean.nested.code, "[제외]");
  assert.equal(clean.nested.safe, 42);
  assert.doesNotMatch(clean.message, /student|private\.msheet|abcdef/);
  assert.match(clean.message, /\[경로\]|\[제외\]/);
});

test("오류는 화면 공통 문맥과 함께 로컬 순환 기록·런처 전송에 남는다", async () => {
  const { api, storage, requests } = loadDiagnostics();
  api.error("test_failure", "화면 처리 실패", new Error("boom C:\\Users\\student\\secret.txt"), {
    screen:"pdf", source:"문서 원문", token:"private"
  });
  await Promise.resolve();

  const rows = JSON.parse(storage.get("classdock-diagnostics:events:v1"));
  const event = rows[rows.length - 1];
  assert.equal(event.level, "error");
  assert.equal(event.type, "test_failure");
  assert.equal(event.details.source, "[제외]");
  assert.equal(event.details.token, "[제외]");
  assert.doesNotMatch(JSON.stringify(event), /student|secret\.txt|private/);
  assert.ok(requests.some((request) => request.url === "/diagnostics/events" && request.init.method === "POST"));
});

test("오래 멈춘 활성 세션은 다음 실행에서 비정상 종료로 판정한다", async () => {
  const { api } = loadDiagnostics({
    previous:{ version:1, sessionId:"old-session", status:"active",
      at:new Date(Date.now() - 60000).toISOString(), context:{ screen:"music", musicAudio:{ measure:36 } } }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(api.previousAbnormal());
  const events = await api.loadEvents();
  assert.ok(events.some((event) => event.type === "previous_session_abnormal"));
});

test("설정에서 공통 진단 로그를 보고 내보내고 지우며 로컬 폴더를 열 수 있다", () => {
  const html = read("classdock.html");
  const app = read("src/js/app.js");
  const css = read("src/styles.css");
  const launcher = read("desktop/launcher.cs");
  const manifest = JSON.parse(read("scripts.manifest.json"));

  assert.ok(html.includes('data-settings-tab="diagnostics"'));
  assert.ok(html.includes('id="diagnosticLogList"'));
  for (const id of ["diagnosticCopy", "diagnosticSave", "diagnosticOpenFolder", "diagnosticClear"]){
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(css, /\.diagnostic-log-list/);
  assert.match(app, /MNDiagnostics\.wireSettings\(\)/);
  assert.equal(manifest.localScripts[1], "diagnostics.js", "상태 동기화 직후부터 오류를 수집해야 한다");
  assert.match(launcher, /%LOCALAPPDATA%|SpecialFolder\.LocalApplicationData/);
  assert.match(launcher, /"ClassDock", "logs"/);
  assert.match(launcher, /DiagnosticsLogMaxBytes = 4L \* 1024 \* 1024/);
  assert.match(launcher, /path == "\/diagnostics\/open-folder"/);
  assert.match(launcher, /RequiresLocalAuthToken[\s\S]*path\.StartsWith\("\/diagnostics\/"/);
});

test("진단 임시 기록은 사용자 백업으로 옮기거나 Git 작업 폴더에 만들지 않는다", () => {
  const backup = read("src/js/backup.js");
  const diagnostics = read("src/js/diagnostics.js");
  assert.match(backup, /"classdock-diagnostics:events:v1"/);
  assert.match(backup, /"classdock-diagnostics:session:v1"/);
  assert.doesNotMatch(diagnostics, /src\/logs|\.\/logs|D:\\/);
});
