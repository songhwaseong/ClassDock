"use strict";

const test = require("node:test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// 브라우저와 사용자 저장 파일을 열지 않는다. 별도 Node 프로세스의 메모리
// sessionStorage를 복원 대상으로 써서 Storage의 특수한 속성 대입까지 검증한다.
function withNativeStorage(scenario){
  execFileSync(process.execPath, ["--experimental-webstorage", "--no-warnings", "-"], {
    cwd:path.join(__dirname, ".."),
    encoding:"utf8",
    timeout:10000,
    input:`
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const vm = require("node:vm");
      const storage = globalThis.sessionStorage;
      const prototype = Object.getPrototypeOf(storage);
      const methods = ["setItem", "removeItem", "clear"];
      const descriptors = Object.fromEntries(methods.map(key =>
        [key, Object.getOwnPropertyDescriptor(prototype, key)]));
      const timers = [];
      let mutations = 0, reloads = 0, hidden = 0;
      const context = vm.createContext({
        localStorage:storage,
        console:{ warn(){}, error(){} },
        confirmDialog:async () => true,
        toast(){}, showLoading(){}, hideLoading(){ hidden++; },
        setTimeout:fn => { timers.push(fn); },
        location:{ reload(){ reloads++; } }
      });
      vm.runInContext(fs.readFileSync("src/js/backup.js", "utf8"), context);
      const backup = vm.runInContext("({ pause:mnBackupPauseLocalStorage, replace:mnBackupReplaceLocalStorage, api:MNBackup })", context);
      // ZIP/DB I/O는 대체하고 실제 복원 제어 흐름과 Storage 교체를 실행한다.
      context.mnBackupParseRestore = async () => ({
        manifest:{ openBoards:["화이트보드"] },
        localStorageData:{ "classdock-tabs:v1":"BACKUP" },
        indexedDbData:{ databases:[] }, workspace:new Uint8Array(0)
      });
      context.mnBackupValidateDbDump = () => {};
      context.mnBackupEnsureDbs = async () => { mutations++; };
      context.mnBackupRestoreWorkspace = async () => { mutations++; };
      context.mnBackupPushAppState = async () => {};
      (async () => { ${scenario} })().catch(error => { console.error(error); process.exitCode = 1; });
    `
  });
}

test("실제 Storage에서 자동 저장은 차단하고 복원 쓰기와 읽기는 허용한다", () => {
  withNativeStorage(`
    storage.setItem("classdock-tabs:v1", "CURRENT");
    storage.setItem("mnScreensaverVideoNames", "LOCAL-VIDEOS");
    const io = backup.pause();
    assert.equal(io.paused(), true);
    assert.equal(storage.getItem("classdock-tabs:v1"), "CURRENT");
    storage.setItem("classdock-tabs:v1", "AUTOSAVE");
    storage.removeItem("mnScreensaverVideoNames");
    storage.clear();
    assert.equal(storage.getItem("classdock-tabs:v1"), "CURRENT");
    assert.equal(storage.getItem("mnScreensaverVideoNames"), "LOCAL-VIDEOS");

    backup.replace({ "classdock-tabs:v1":"BACKUP" }, ["화이트보드"], io);
    // 타이머와 beforeunload가 이전 탭 구성을 다시 저장하는 상황.
    storage.setItem("classdock-tabs:v1", "BEFORE-UNLOAD");
    storage.removeItem("classdock-tabs:v1");
    storage.clear();
    assert.equal(storage.getItem("classdock-tabs:v1"), "BACKUP");
    assert.equal(storage.getItem("mnScreensaverVideoNames"), "LOCAL-VIDEOS");
    assert.deepEqual(JSON.parse(storage.getItem("classdock-backup:pending-restore:v1")).boards, ["화이트보드"]);
    for (const key of methods) assert.equal(storage.getItem(key), null, "메서드 이름의 저장 키를 만들지 않는다");
    io.write.setItem("temporary", "value");
    io.write.removeItem("temporary");
    assert.equal(storage.getItem("temporary"), null);

    io.resume();
    io.resume();
    assert.equal(io.paused(), false);
    for (const key of methods) assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, key), descriptors[key]);
    storage.setItem("classdock-tabs:v1", "RESUMED");
    assert.equal(storage.getItem("classdock-tabs:v1"), "RESUMED");
    storage.removeItem("classdock-tabs:v1");
    assert.equal(storage.getItem("classdock-tabs:v1"), null);
    storage.clear();
    assert.equal(storage.length, 0);
  `);
});

test("저장 차단은 다른 수신자의 호출과 기존 메서드 래퍼를 보존한다", () => {
  withNativeStorage(`
    const otherStorage = {};
    const calls = [];
    for (const key of methods) {
      const original = descriptors[key].value;
      Object.defineProperty(prototype, key, { ...descriptors[key], value:function(...args){
        if (this === otherStorage) { calls.push([key, ...args]); return "delegated"; }
        return original.apply(this, args);
      } });
    }
    const wrappers = Object.fromEntries(methods.map(key => [key, prototype[key]]));
    const io = backup.pause();
    for (const key of methods) assert.equal(prototype[key].call(otherStorage, "key", "value"), "delegated");
    assert.deepEqual(calls.map(call => call[0]), methods);
    io.write.setItem("test", "value");
    assert.equal(storage.getItem("test"), "value");
    io.resume();
    for (const key of methods) assert.equal(prototype[key], wrappers[key]);
  `);
});

test("차단 설치가 중간에 실패하면 메서드를 되돌리고 데이터 교체 전에 중단한다", () => {
  withNativeStorage(`
    storage.setItem("classdock-tabs:v1", "CURRENT");
    Object.defineProperty(prototype, "removeItem", { ...descriptors.removeItem, writable:false, configurable:false });
    assert.equal(await backup.api.restoreBackup({}), false);
    assert.equal(mutations, 0);
    assert.equal(reloads, 0);
    assert.equal(timers.length, 0);
    assert.equal(backup.api.isRestoring(), false);
    assert.equal(storage.getItem("classdock-tabs:v1"), "CURRENT");
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "setItem"), descriptors.setItem);
    storage.setItem("after-failure", "saved");
    assert.equal(storage.getItem("after-failure"), "saved");
    assert.equal(hidden, 2, "실패 후에도 로딩을 닫는다");
  `);
});

test("복원 도중 오류가 나면 일반 저장과 종료 경고를 다시 허용한다", () => {
  withNativeStorage(`
    context.mnBackupRestoreWorkspace = async () => { throw new Error("workspace-write-failed"); };
    assert.equal(await backup.api.restoreBackup({}), false);
    assert.equal(backup.api.isRestoring(), false);
    assert.equal(timers.length, 0);
    storage.setItem("after-failure", "saved");
    assert.equal(storage.getItem("after-failure"), "saved");
    for (const key of methods) assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, key), descriptors[key]);
  `);
});

test("복원 성공 후 재로딩까지 쓰기를 막고 승인된 복원을 종료 경고로 취소하지 않는다", () => {
  withNativeStorage(`
    let prevented = 0, saved = 0;
    context.docs = [];
    context.hasUnsavedEdits = () => true;
    context.suppressUnloadWarn = false;
    context.persistTabStateNow = () => { saved++; };
    context.pendingEntries = () => [{ drafted:false }];
    const handlers = ["src/js/app.js", "src/js/image-memo.js"].map(file => {
      const source = fs.readFileSync(file, "utf8");
      const start = source.indexOf('window.addEventListener("beforeunload", (');
      const end = source.indexOf("\\n  });", start);
      assert.ok(start >= 0 && end > start);
      context.window = { addEventListener(type, fn){ handlersForFile.push(fn); } };
      const handlersForFile = [];
      vm.runInContext(source.slice(start, end + "\\n  });".length), context);
      return handlersForFile[0];
    });
    const event = { preventDefault(){ prevented++; } };
    handlers.forEach(fn => fn(event));
    assert.equal(prevented, 2, "평상시에는 문서와 이미지 메모의 미저장 경고를 유지한다");
    assert.equal(saved, 1);
    prevented = 0; saved = 0;

    assert.equal(await backup.api.restoreBackup({}), true);
    assert.equal(backup.api.isRestoring(), true);
    assert.equal(await backup.api.restoreBackup({}), false, "재로딩 대기 중 중복 복원을 막는다");
    handlers.forEach(fn => fn(event));
    assert.equal(prevented, 0);
    assert.equal(saved, 0);
    storage.setItem("classdock-tabs:v1", "OLD-AUTOSAVE");
    assert.equal(storage.getItem("classdock-tabs:v1"), "BACKUP");
    assert.equal(timers.length, 1);
    timers[0]();
    assert.equal(reloads, 1);
  `);
});
