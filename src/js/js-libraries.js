"use strict";

// 자바스크립트 연습 실행기에서 쓸 수 있는 Worker 호환 라이브러리 카탈로그.
// 기본 카탈로그는 검증한 브라우저 전역형 배포본을 vendor/에 고정한다.
// 2단계 npm 패키지는 EXE가 별도 캐시에 설치·번들한 원문만 같은 Worker 주입 경로로 합친다.
const JS_LIBRARY_CATALOG = Object.freeze([
  Object.freeze({
    id:"lodash", label:"Lodash", version:"4.17.21", file:"lodash.min.js", global:"_",
    description:"배열·객체·문자열을 간단히 다루는 도구", example:"_.chunk([1, 2, 3, 4], 2)"
  }),
  Object.freeze({
    id:"dayjs", label:"Day.js", version:"1.11.13", file:"dayjs.min.js", global:"dayjs",
    description:"날짜 계산과 형식 변환", example:'dayjs().format("YYYY-MM-DD")'
  }),
  Object.freeze({
    id:"papaparse", label:"Papa Parse", version:"5.4.1", file:"papaparse.min.js", global:"Papa",
    description:"CSV 읽기와 만들기", example:'Papa.parse("name,score\\n민수,90", { header:true }).data'
  }),
  Object.freeze({
    id:"mathjs", label:"Math.js", version:"14.0.1", file:"math.min.js", global:"math",
    description:"수식·행렬·통계 계산", example:'math.evaluate("sqrt(16) + 2")'
  })
]);

const JS_LIBRARY_STORAGE_PREFIX = "pdf-signer-js-libraries:";
const JS_LIBRARY_MAX_CUSTOM = 8;
const JS_LIBRARY_MAX_CUSTOM_SOURCE = 512 * 1024;
const JS_LIBRARY_MAX_CUSTOM_TOTAL = 1024 * 1024;
const JS_LIBRARY_MAX_NPM = 20;
const _jsLibrarySourceCache = new Map();
const _jsNpmBundleCache = new Map();

const JS_LIBRARY_MEMBERS = Object.freeze({
  _: "map filter reduce find findIndex groupBy keyBy orderBy sortBy uniq uniqBy chunk flatten flattenDeep compact range sum sumBy min max cloneDeep merge get set has pick omit debounce throttle",
  dayjs: "extend locale isDayjs unix",
  Papa: "parse unparse",
  math: "evaluate compile parse simplify derivative sqrt pow abs round floor ceil min max mean median std variance sum prod range matrix multiply divide add subtract fraction bignumber unit format"
});

function jsLibraryCatalogItem(id){
  return JS_LIBRARY_CATALOG.find((item) => item.id === String(id || "")) || null;
}

function jsLibraryState(value){
  const input = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const builtins = [];
  for (const id of Array.isArray(input.builtins) ? input.builtins : []){
    const key = String(id || "");
    if (!seen.has(key) && jsLibraryCatalogItem(key)){ seen.add(key); builtins.push(key); }
  }
  const custom = [];
  let total = 0;
  for (const row of Array.isArray(input.custom) ? input.custom : []){
    if (!row || typeof row.source !== "string") continue;
    const source = row.source;
    if (!source || source.length > JS_LIBRARY_MAX_CUSTOM_SOURCE || total + source.length > JS_LIBRARY_MAX_CUSTOM_TOTAL) continue;
    const name = String(row.name || "library.js").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "library.js";
    let id = String(row.id || "");
    if (!/^custom:[a-z0-9:_-]+$/i.test(id)) id = "custom:" + jsLibraryHash(name + "\n" + source);
    if (custom.some((item) => item.id === id)) continue;
    custom.push({ id, name, source });
    total += source.length;
    if (custom.length >= JS_LIBRARY_MAX_CUSTOM) break;
  }
  const npm = [];
  for (const row of Array.isArray(input.npm) ? input.npm : []){
    if (!row || !/^[a-f0-9]{32}$/.test(String(row.id || ""))) continue;
    const id = String(row.id);
    if (npm.some((item) => item.id === id)) continue;
    const name = String(row.name || "").slice(0, 120);
    const version = String(row.version || "").slice(0, 80);
    const global = String(row.global || "").slice(0, 80);
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._+~-]*$/.test(version)) continue;
    if (!/^[A-Za-z_$][\w$]*$/.test(global)) continue;
    npm.push({ id, name, version, global, size:Math.max(0, Number(row.size) || 0) });
    if (npm.length >= JS_LIBRARY_MAX_NPM) break;
  }
  return { version:2, builtins, npm, custom };
}

function jsLibraryHash(text){
  let hash = 2166136261;
  const value = String(text || "");
  for (let i = 0; i < value.length; i++){
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function jsLibraryStorageKey(identity){
  return JS_LIBRARY_STORAGE_PREFIX + jsLibraryHash(String(identity || "javascript"));
}

function loadJsLibraryState(key){
  try { return jsLibraryState(JSON.parse(localStorage.getItem(String(key || "")) || "null")); }
  catch(_){ return jsLibraryState(null); }
}

function saveJsLibraryState(key, value){
  const normalized = jsLibraryState(value);
  try { localStorage.setItem(String(key || ""), JSON.stringify(normalized)); return true; }
  catch(_){ return false; }
}

function jsLibrarySelectionSignature(value){
  const state = jsLibraryState(value);
  return state.builtins.join(",") + "|" + state.npm.map((item) => item.id).join(",") + "|" + state.custom.map((item) => item.id).join(",");
}

function jsLibraryCompletionWords(value){
  const state = jsLibraryState(value);
  return [
    ...state.builtins.map((id) => jsLibraryCatalogItem(id)).filter(Boolean).map((item) => item.global),
    ...state.npm.map((item) => item.global)
  ];
}

function jsLibraryMemberCandidates(value, receiver, prefix){
  const globals = new Set(jsLibraryCompletionWords(value));
  const name = String(receiver || "");
  if (!globals.has(name) || !JS_LIBRARY_MEMBERS[name]) return [];
  const wanted = String(prefix || "").toLowerCase();
  return JS_LIBRARY_MEMBERS[name].split(/\s+/).filter((item) => !wanted || item.toLowerCase().startsWith(wanted))
    .map((item) => ({ name:item, type:"function", signature:item + "()" }));
}

async function jsLibraryVendorSource(file){
  const key = String(file || "");
  if (_jsLibrarySourceCache.has(key)) return _jsLibrarySourceCache.get(key);
  const task = (async () => {
    if (typeof MNLazy !== "undefined" && MNLazy && typeof MNLazy.source === "function") return MNLazy.source(key);
    const response = await fetch("vendor/" + key, { cache:"force-cache" });
    if (!response.ok) throw new Error("library-source-http:" + response.status);
    return response.text();
  })();
  _jsLibrarySourceCache.set(key, task);
  try { return await task; }
  catch(error){ _jsLibrarySourceCache.delete(key); throw error; }
}

async function prepareJsLibrarySources(value){
  const state = jsLibraryState(value);
  const rows = [];
  for (const id of state.builtins){
    const item = jsLibraryCatalogItem(id);
    if (!item) continue;
    let source;
    try { source = await jsLibraryVendorSource(item.file); }
    catch(error){ throw new Error(item.label + " 라이브러리를 불러오지 못했어요: " + ((error && error.message) || error)); }
    rows.push({
      id:item.id + "@" + item.version,
      name:item.label + " " + item.version,
      source:String(source || ""),
      global:item.global,
      sourceURL:"mn-library-" + item.id + ".js"
    });
  }
  for (const item of state.npm){
    let source;
    try { source = await jsNpmBundleSource(item.id); }
    catch(error){ throw new Error(item.name + " npm 패키지를 불러오지 못했어요: " + ((error && error.message) || error)); }
    rows.push({
      id:"npm:" + item.id,
      name:item.name + " " + item.version,
      source:String(source || ""),
      global:item.global,
      sourceURL:"mn-npm-" + item.id + ".js"
    });
  }
  for (const item of state.custom){
    rows.push({
      id:item.id,
      name:item.name,
      source:item.source,
      global:"",
      sourceURL:"mn-custom-" + item.id.slice(7).replace(/[^a-z0-9_-]/gi, "_") + ".js"
    });
  }
  return rows;
}

function jsNpmGlobalFromSpec(spec){
  let name = String(spec || "").trim();
  if (name.startsWith("@")){
    const slash = name.indexOf("/");
    const versionAt = slash >= 0 ? name.indexOf("@", slash + 1) : -1;
    if (versionAt >= 0) name = name.slice(0, versionAt);
  } else {
    const versionAt = name.indexOf("@");
    if (versionAt >= 0) name = name.slice(0, versionAt);
  }
  name = name.split("/").pop() || "library";
  name = name.replace(/[-_.]+([A-Za-z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9_$]/g, "");
  if (!/^[A-Za-z_$]/.test(name)) name = "pkg" + name;
  return name || "library";
}

function jsNpmErrorText(raw){
  const value = String(raw || "").trim().replace(/^npm-failed:\s*/, "");
  const messages = {
    "no-node":"Node.js를 찾지 못했어요. Node.js LTS를 설치한 뒤 EXE를 다시 열어 주세요.",
    "no-npm":"npm을 찾지 못했어요. npm이 포함된 Node.js LTS 설치 상태를 확인해 주세요.",
    "npm-busy":"다른 npm 패키지를 설치하는 중이에요.",
    "npm-package-exists":"같은 패키지와 전역 이름의 설치 캐시가 이미 있어요. 아래 목록에서 선택해 주세요.",
    "npm-package-limit":"설치 캐시는 최대 20개까지 보관할 수 있어요. 사용하지 않는 패키지를 삭제해 주세요.",
    "invalid-package-spec":"npm 패키지 이름을 확인해 주세요. 레지스트리 패키지 이름과 선택적 버전만 사용할 수 있어요.",
    "invalid-package-version":"버전은 정확한 버전이나 latest 같은 배포 태그로 입력해 주세요.",
    "invalid-global-name":"코드에서 사용할 전역 이름은 JavaScript 변수 이름 형식이어야 해요.",
    "npm-confirmation-required":"설치 확인 정보가 전달되지 않았어요. 다시 시도해 주세요."
  };
  return messages[value] || value || "npm 패키지 작업에 실패했어요.";
}

async function jsNpmStatus(){
  try {
    const response = await fetch("/js-npm-status", { cache:"no-store" });
    if (!response.ok) return { available:false, node:"", npm:"", reason:response.status === 404 ? "not-exe" : await response.text() };
    const result = await response.json();
    return { available:!!result.available, node:String(result.node || ""), npm:String(result.npm || "") };
  } catch(_){ return { available:false, node:"", npm:"", reason:"not-exe" }; }
}

async function jsNpmList(){
  const response = await fetch("/js-npm-list", { cache:"no-store" });
  if (!response.ok) throw new Error(jsNpmErrorText(await response.text()));
  const list = await response.json();
  return jsLibraryState({ npm:Array.isArray(list) ? list : [] }).npm;
}

async function jsNpmBundleSource(id){
  const key = String(id || "");
  if (_jsNpmBundleCache.has(key)) return _jsNpmBundleCache.get(key);
  const task = (async () => {
    const response = await fetch("/js-npm-bundle?id=" + encodeURIComponent(key), { cache:"no-store" });
    if (!response.ok) throw new Error(jsNpmErrorText(await response.text()));
    return response.text();
  })();
  _jsNpmBundleCache.set(key, task);
  try { return await task; }
  catch(error){ _jsNpmBundleCache.delete(key); throw error; }
}

function jsNpmInvalidateBundle(id){
  if (id) _jsNpmBundleCache.delete(String(id));
  else _jsNpmBundleCache.clear();
}

async function jsNpmInstallStream(spec, globalName, hooks){
  hooks = hooks || {};
  const emit = (value) => { if (typeof hooks.onLog === "function") hooks.onLog(String(value || "")); };
  const response = await fetch("/js-npm-install-start", {
    method:"POST",
    headers:{ "Content-Type":"text/plain; charset=utf-8", "X-Manneung-Npm-Confirm":"1" },
    body:String(spec || "").trim() + "\n" + String(globalName || "").trim()
  });
  if (!response.ok) throw new Error(jsNpmErrorText(await response.text()));
  let id = "";
  try { id = String((await response.json()).id || ""); } catch(_){ id = ""; }
  if (!id) throw new Error("npm 설치 작업 번호를 받지 못했어요.");
  let cancelSent = false;
  const cancel = async () => {
    if (cancelSent) return;
    cancelSent = true;
    try { await fetch("/js-npm-install-cancel?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_) {}
  };
  if (typeof hooks.onCancel === "function") hooks.onCancel(cancel);
  let known = -1, full = "", failures = 0;
  try {
    for (;;){
      let data;
      try {
        const poll = await fetch("/js-npm-install-poll?id=" + encodeURIComponent(id) + "&from=" + known, { cache:"no-store" });
        if (!poll.ok) throw new Error(jsNpmErrorText(await poll.text()));
        data = await poll.json();
        failures = 0;
      } catch(error){
        if (++failures < 3){ await new Promise((resolve) => setTimeout(resolve, failures * 700)); continue; }
        await cancel();
        throw error;
      }
      if (!data.unchanged){
        if (typeof data.logDelta === "string") full += data.logDelta;
        else if (typeof data.log === "string") full = data.log;
        known = full.length;
        emit(full);
        if (data.complete) return { ok:data.code === 0, code:data.code, output:full, cancelled:!!data.cancelled };
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  } finally {
    if (typeof hooks.onCancel === "function") hooks.onCancel(null);
  }
}

async function jsNpmDelete(id){
  const response = await fetch("/js-npm-delete?id=" + encodeURIComponent(String(id || "")), { method:"POST" });
  if (!response.ok) throw new Error(jsNpmErrorText(await response.text()));
  jsNpmInvalidateBundle(id);
  return true;
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    JS_LIBRARY_CATALOG,
    JS_LIBRARY_STORAGE_PREFIX,
    JS_LIBRARY_MAX_CUSTOM,
    JS_LIBRARY_MAX_CUSTOM_SOURCE,
    JS_LIBRARY_MAX_CUSTOM_TOTAL,
    JS_LIBRARY_MAX_NPM,
    jsLibraryState,
    jsLibraryStorageKey,
    jsLibrarySelectionSignature,
    jsLibraryCompletionWords,
    jsLibraryMemberCandidates,
    jsNpmGlobalFromSpec,
    jsNpmErrorText
  };
}
