const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 브라우저 없이 저장소 부분만 검증한다(드롭다운 DOM 은 e2e 쪽에서 확인).
function loadSearchHistory(settings){
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); }
  };
  const context = {
    localStorage,
    appSettings: settings || { searchHistory: true },
    window: { dispatchEvent: () => true, t: (text) => text },
    CustomEvent: class { constructor(type){ this.type = type; } }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/search-history.js"), "utf8");
  vm.runInContext(source + "\n;globalThis.__MNSearchHistory = MNSearchHistory;", context);
  return { api: context.__MNSearchHistory, store, context };
}

// vm 안에서 만든 배열은 realm 이 달라 deepEqual 이 실패한다 → 호스트 배열로 옮겨 비교한다.
const terms = (api, scope) => Array.from(api.list(scope), (row) => row.q);

test("최근 검색어는 최신이 맨 앞이고 같은 말은 하나만 남는다", () => {
  const { api } = loadSearchHistory();
  api.remember("files", "학생부");
  api.remember("files", "성적표");
  api.remember("files", "학생부");
  assert.deepEqual(terms(api, "files"), ["학생부", "성적표"]);
  assert.equal(api.last("files"), "학생부");
});

test("구획이 다르면 목록도 따로 쌓인다", () => {
  const { api } = loadSearchHistory();
  api.remember("files", "성적표");
  api.remember("text", "def main");
  assert.deepEqual(terms(api, "files"), ["성적표"]);
  assert.deepEqual(terms(api, "text"), ["def main"]);
  assert.equal(api.size(), 2);
});

test("구획당 12개까지만 남기고 오래된 것부터 버린다", () => {
  const { api } = loadSearchHistory();
  for (let i = 1; i <= 15; i++) api.remember("text", "검색" + i);
  const rows = terms(api, "text");
  assert.equal(rows.length, 12);
  assert.equal(rows[0], "검색15");
  assert.equal(rows.at(-1), "검색4");
});

test("빈 값·공백·줄바꿈만 있는 값·너무 긴 값은 기록하지 않는다", () => {
  const { api } = loadSearchHistory();
  api.remember("text", "");
  api.remember("text", "   ");
  api.remember("text", "\n\n");
  api.remember("text", "가".repeat(201));
  assert.deepEqual(terms(api, "text"), []);
  assert.equal(api.remember("text", "  여백 정리  "), "여백 정리");
  assert.deepEqual(terms(api, "text"), ["여백 정리"]);
});

test("찾기 옵션(대소문자·단어·정규식)도 함께 기억한다", () => {
  const { api } = loadSearchHistory();
  api.remember("text", "\\d{4}", { case: true, word: false, regex: true });
  assert.deepEqual({ ...api.list("text")[0].meta }, { case: true, word: false, regex: true });
});

test("하나만 지우기와 구획별·전체 지우기가 각각 동작한다", () => {
  const { api, store } = loadSearchHistory();
  api.remember("files", "성적표");
  api.remember("files", "학생부");
  api.remember("text", "def main");
  api.forget("files", "성적표");
  assert.deepEqual(terms(api, "files"), ["학생부"]);
  api.clear("files");
  assert.deepEqual(terms(api, "files"), []);
  assert.deepEqual(terms(api, "text"), ["def main"]);
  api.clear();
  assert.equal(api.size(), 0);
  assert.equal(store.has("mn.searchHistory"), false);   // 다 비우면 키 자체를 남기지 않는다
});

test("설정에서 끄면 읽지도 쓰지도 않는다(공용 컴퓨터 대비)", () => {
  const { api, context } = loadSearchHistory();
  api.remember("files", "성적표");
  context.appSettings.searchHistory = false;
  assert.equal(api.enabled(), false);
  assert.deepEqual(terms(api, "files"), []);          // 보여주지 않는다
  assert.equal(api.last("files"), "");
  api.remember("files", "학생부");                     // 쌓지도 않는다
  context.appSettings.searchHistory = true;
  assert.deepEqual(terms(api, "files"), ["성적표"]);
});

test("꺼져 있어도 남아 있는 기록은 개수를 세고 지울 수 있다", () => {
  const { api, context } = loadSearchHistory();
  api.remember("files", "성적표");
  context.appSettings.searchHistory = false;
  assert.equal(api.size(), 1);
  api.clear();
  assert.equal(api.size(), 0);
});

test("모르는 구획 이름은 무시한다", () => {
  const { api } = loadSearchHistory();
  api.remember("존재하지않음", "성적표");
  assert.deepEqual(terms(api, "존재하지않음"), []);
  assert.equal(api.size(), 0);
});

test("저장된 값이 깨져 있어도 빈 목록으로 되살아난다", () => {
  const { api, store } = loadSearchHistory();
  store.set("mn.searchHistory", "{망가진 JSON");
  assert.deepEqual(terms(api, "files"), []);
  api.remember("files", "성적표");
  assert.deepEqual(terms(api, "files"), ["성적표"]);
});

test("예전 형식(문자열 배열)도 읽을 수 있고 중복은 걸러진다", () => {
  const { api, store } = loadSearchHistory();
  store.set("mn.searchHistory", JSON.stringify({ files: ["성적표", "성적표", "학생부"] }));
  assert.deepEqual(terms(api, "files"), ["성적표", "학생부"]);
});
