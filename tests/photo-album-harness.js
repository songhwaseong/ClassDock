"use strict";

// 사진첩(photo-album.js) 안쪽 함수와 상태를 시험에서 쓰기 위한 도우미.
// 파일 끝의 `return { mount, cleanup };` 한 곳에만 기대어, 모듈 안에서 이름으로 값을 읽고(get) 바꾸는(set) 통로를 덧붙인다.
// 화면이 없는 시험에서는 root 를 빈 흉내로 두면 그리기 함수들이 조용히 넘어간다.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const ALBUM_SOURCE = path.join(ROOT, "src", "js", "photo-album.js");
const RETURN_ANCHOR = "return { mount, cleanup };";

function memoryStorage(initial = {}){
  const data = { ...initial };
  return {
    getItem:key => Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null,
    setItem:(key, value) => { data[key] = String(value); },
    removeItem:key => { delete data[key]; },
    data
  };
}

// 화면 없는 root: 찾으면 늘 없음, 여럿 찾으면 빈 목록.
const emptyRoot = () => ({
  querySelector:() => null, querySelectorAll:() => [], closest:() => null, contains:() => false, appendChild(){},
  classList:{ add(){}, remove(){}, toggle(){}, contains:() => false }, isConnected:true
});

// 가짜 앱 저장소(EXE 런처 흉내). 요청을 기록하고 사진첩 원본·메타 저장 요청에 성공으로 답한다.
function fakeLauncher(){
  const requests = [];
  const fetch = async (route, options = {}) => {
    requests.push({ route, method:options.method || "GET" });
    return { ok:true, status:200, json:async () => [], blob:async () => new Blob(["stored:" + route], { type:"application/octet-stream" }) };
  };
  const deleted = () => requests.filter(request => request.route.startsWith("/photo-album-delete?id=")).map(request => decodeURIComponent(request.route.split("id=")[1]));
  return { fetch, requests, deleted };
}

// options.context: 샌드박스에 더할 전역(가짜 Audio·performance 등). 저장은 가짜 런처(EXE 흉내)로 간다.
function loadAlbum(options = {}){
  const source = fs.readFileSync(ALBUM_SOURCE, "utf8");
  if (!source.includes(RETURN_ANCHOR)) throw new Error("photo-album.js 끝의 `" + RETURN_ANCHOR + "` 를 찾지 못했습니다.");
  const injected = source.replace(RETURN_ANCHOR,
    "return { mount, cleanup, __get:(name) => eval(name), __set:(name, value) => { eval(name + ' = value'); } };");
  let ids = 0;
  const launcher = fakeLauncher();
  const sandbox = {
    crypto:{ randomUUID:() => "id" + (++ids), subtle:webcrypto.subtle },
    Blob,
    localStorage:memoryStorage(),
    Intl, setTimeout, clearTimeout, setInterval, clearInterval,
    performance:{ now:() => 0 },
    fetch:launcher.fetch,
    console:{ log(){}, warn(){}, error(){} },
    ...(options.context || {})
  };
  vm.runInNewContext(injected + "\nthis.__album = PhotoAlbum;", sandbox, { filename:"photo-album.js" });
  const album = sandbox.__album;
  album.__set("root", emptyRoot());
  album.__set("nativeStorage", true);
  const api = {
    get:name => album.__get(name),
    set:(name, value) => { album.__set(name, value); return api; },
    // 흔히 쓰는 준비: 사진 목록과 고른 사진, 고른 장식.
    useRecords:(records, selectedId = records[0] && records[0].id) => { album.__set("records", records); album.__set("selectedId", selectedId); return api; },
    pick:ids => { album.__set("picked", new Set(ids)); return api; },
    picked:() => [...album.__get("picked")],
    storage:sandbox.localStorage,
    launcher,
    sandbox
  };
  return new Proxy(api, { get:(target, name) => name in target ? target[name] : album.__get(name) });
}

// 모듈 하나(전역 이름 하나)를 샌드박스에서 불러온다. gif-encoder.js → MNGifEncoder 처럼.
function loadModule(file, globalName, context = {}){
  const sandbox = { setTimeout, ...context };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src", "js", file), "utf8") + "\nthis.__module = " + globalName + ";", sandbox, { filename:file });
  return sandbox.__module;
}

// data:image/svg+xml 주소를 SVG 글로.
const svgText = url => decodeURIComponent(String(url).split(",").slice(1).join(","));

// 샌드박스 값끼리 비교할 때(다른 realm 의 배열·객체는 deepStrictEqual 이 원형 차이로 실패한다).
const plain = value => JSON.parse(JSON.stringify(value));

// 간단한 XML 모양 검사: 태그가 올바르게 열리고 닫히는지, 속성 값이 따옴표로 묶였는지, & 가 올바른 참조인지.
const BAD_AMPERSAND = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i;
function assertWellFormedXml(text){
  const stack = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  let at = 0;
  while (at < text.length){
    const open = text.indexOf("<", at);
    const between = text.slice(at, open < 0 ? text.length : open);
    if (BAD_AMPERSAND.test(between)) throw new Error("잘못된 & 참조: " + between.slice(0, 40));
    if (open < 0) break;
    tag.lastIndex = open;
    const match = tag.exec(text);
    if (!match) throw new Error("태그 모양이 잘못됨: " + text.slice(open, open + 60));
    const [whole, closing, name, attributes, selfClosing] = match;
    if (BAD_AMPERSAND.test(attributes)) throw new Error("속성의 잘못된 & 참조: " + attributes.slice(0, 60));
    if (closing){
      const last = stack.pop();
      if (last !== name) throw new Error(`닫는 태그가 맞지 않음: <${last}> … </${name}>`);
    } else if (!selfClosing) stack.push(name);
    at = open + whole.length;
  }
  if (stack.length) throw new Error("닫히지 않은 태그: " + stack.join(", "));
}

module.exports = { loadAlbum, loadModule, svgText, plain, assertWellFormedXml, memoryStorage, ROOT };
