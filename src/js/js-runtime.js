"use strict";

// 자바스크립트 연습 코드를 브라우저 워커에서 실행한다.
// Pyodide 처럼 준비 비용이 큰 런타임이 없으므로 실행할 때마다 워커를 새로 만든다 —
// 전역이 매번 깨끗해지고, 중지·시간 초과는 worker.terminate() 하나로 끝난다.

const JS_USER_FILE = "practice.js";
const JS_RUN_TIMEOUT_MS = 10000;              // 이 시간을 넘기면 무한 루프로 보고 워커를 끊는다
const JS_PENDING_GRACE_MS = 3000;             // 본체가 끝난 뒤 남은 setTimeout·비동기를 기다리는 최대 시간
const JS_OUTPUT_HEAD_LIMIT = 1024 * 1024;     // 출력 앞 1MB 까지만 보관(그 뒤는 생략 안내)
const JS_SEGMENT_LIMIT = 4000;                // 색이 다른 출력 조각의 최대 개수
const JS_OUTPUT_FLUSH_MS = 80;                // 워커가 모아둔 출력을 화면으로 내보내는 간격
// 이만큼 쌓이면 시간과 무관하게 바로 내보낸다. while(true) 같은 동기 반복은 이벤트 루프를
// 놓지 않아 타이머 flush 가 영영 돌지 않는데, postMessage 는 그 안에서도 보낼 수 있다.
const JS_OUTPUT_FLUSH_CHARS = 8192;

// 사용자 코드를 감싸는 앞부분. top-level await 를 그대로 쓸 수 있게 async 즉시실행 함수로 감싼다.
const JS_WRAPPER_HEAD = '"use strict";\nreturn (async () => {\n';
const JS_WRAPPER_TAIL_HEAD = "\n})();\n//# sourceURL=";
// 스택의 줄 번호에서 이만큼 빼야 편집기 줄 번호와 맞는다.
//   - new Function 이 만드는 `function anonymous(` + `) {` 2줄
//   - JS_WRAPPER_HEAD 의 2줄
// (tests/js-runtime.test.js 가 실제 스택으로 이 값을 검증한다 — 손으로 세지 말 것)
const JS_WRAPPER_PREFIX_LINES = 2 + (JS_WRAPPER_HEAD.split("\n").length - 1);

// 실행 편집기의 자동완성 낱말. 공용 자바스크립트 목록 대신 이 목록을 쓰는 이유는,
// 공용 목록에 여기서 동작하지 않는 것(document·window·require·module·exports)이 들어 있고
// 여기서만 되는 것(input·prompt)이 빠져 있기 때문이다 — 되는 것만 제안해야 헛걸음이 없다.
// 실제 후보는 이 목록 + 지금 파일에 등장한 이름(버퍼 단어)을 합쳐 만든다.
const JS_RUN_COMPLETION_WORDS = (
  // 문법 낱말 (모듈 문법 export·import 는 이 실행 방식에서 쓸 수 없어 뺀다)
  "async await break case catch class const continue default delete do else extends false finally for function get " +
  "if in instanceof let new null of return set static super switch this throw true try typeof var void while yield " +
  // 워커에 있는 표준 전역
  "console Math JSON Object Array String Number Boolean Date RegExp Map Set Promise Symbol BigInt " +
  "Error TypeError RangeError parseInt parseFloat isNaN isFinite " +
  // 이 실행 환경이 따로 마련해 둔 것
  "input prompt setTimeout clearTimeout setInterval clearInterval"
).split(/\s+/);

// ── 점(.) 뒤 멤버 자동완성 ──────────────────────────────────────────────────
// 타입 추론기가 없으므로 "글에서 확실히 알 수 있는 것"만 제안한다:
//   1) 잘 알려진 전역(console·Math·JSON…)의 멤버 — 카탈로그
//   2) 그 이름에 마지막으로 준 값이 리터럴이면 그 종류의 멤버(배열·문자열·수·Map·Set)
//   3) 객체 리터럴이면 거기 적힌 키 그대로
// 알 수 없으면 아무것도 내지 않는다(틀린 후보를 보여주는 것보다 낫다).
const JS_MEMBER_CATALOG = (() => {
  // keepOrder=true 면 적은 순서를 지킨다 — console 처럼 압도적으로 많이 쓰는 것이 있는 경우,
  // 가나다순으로 늘어놓으면 'console.' 만 치고 Enter 를 눌렀을 때 assert 가 들어가 버린다.
  const build = (fns, props, keepOrder) => {
    const items = [
      ...String(fns || "").split(/\s+/).filter(Boolean).map((name) => ({ name, type:"function", signature:name + "()" })),
      ...String(props || "").split(/\s+/).filter(Boolean).map((name) => ({ name, type:"property", signature:"" }))
    ];
    return keepOrder ? items : items.sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    // 워커의 console 이 실제로 가진 것만 — 없는 걸 제안하면 조용히 아무 일도 안 일어난다.
    console: build("log info warn error debug dir table trace assert group groupCollapsed groupEnd clear time timeEnd count", "", true),
    Math: build("abs ceil floor round trunc sign sqrt cbrt pow exp log log2 log10 min max random hypot", "PI E"),
    JSON: build("parse stringify"),
    Object: build("keys values entries assign freeze fromEntries hasOwn create"),
    Array: build("isArray from of"),
    Number: build("isInteger isFinite isNaN parseFloat parseInt", "MAX_SAFE_INTEGER MIN_SAFE_INTEGER"),
    String: build("fromCharCode raw"),
    Promise: build("all allSettled race any resolve reject"),
    Date: build("now parse UTC")
  };
})();
const JS_INSTANCE_MEMBERS = (() => {
  const build = (fns, props) => [
    ...String(fns || "").split(/\s+/).filter(Boolean).map((name) => ({ name, type:"function", signature:name + "()" })),
    ...String(props || "").split(/\s+/).filter(Boolean).map((name) => ({ name, type:"property", signature:"" }))
  ].sort((a, b) => a.name.localeCompare(b.name));
  return {
    array: build("push pop shift unshift slice splice concat join indexOf lastIndexOf includes find findIndex " +
      "filter map forEach reduce reduceRight some every sort reverse flat flatMap at fill keys values entries", "length"),
    string: build("at charAt charCodeAt concat endsWith includes indexOf lastIndexOf padStart padEnd repeat " +
      "replace replaceAll slice split startsWith substring toLowerCase toUpperCase trim trimStart trimEnd", "length"),
    number: build("toFixed toPrecision toString"),
    map: build("get set has delete clear forEach keys values entries", "size"),
    set: build("add has delete clear forEach values keys entries", "size")
  };
})();

// 객체 리터럴 본문에서 맨 바깥 키만 뽑는다(중첩 객체의 키는 그 객체의 것이므로 제외).
// text 는 여는 중괄호 '{' 에서 시작해야 한다.
function jsObjectLiteralKeys(text){
  const keys = [];
  let i = 1, depth = 1, prev = "", prevWord = "", expectKey = true;
  while (i < text.length && depth > 0){
    const skip = jsSkipNonCode(text, i, jsRegexAllowed(prev, prevWord));
    if (skip){ i = skip.end; prev = "v"; prevWord = ""; continue; }
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{"){ depth++; i++; prev = ch; prevWord = ""; continue; }
    if (ch === ")" || ch === "]" || ch === "}"){ depth--; i++; prev = ch; prevWord = ""; if (depth === 1) expectKey = false; continue; }
    if (ch === ","){ if (depth === 1) expectKey = true; i++; prev = ch; prevWord = ""; continue; }
    if (/\s/.test(ch)){ i++; continue; }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(ch)){
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      const after = text.slice(j).match(/^\s*([:,(}])/);   // key: · key, · key} (단축) · key( (메서드)
      if (after){
        keys.push({ name:word, type:after[1] === "(" ? "function" : "property", signature:"" });
        expectKey = false;
      }
      i = j; prev = "w"; prevWord = word;
      continue;
    }
    i++; prev = ch; prevWord = "";
  }
  return keys;
}

// 이름에 마지막으로 준 값을 보고 어떤 종류인지 짐작한다(리터럴과 잘 알려진 생성자만).
function jsInferredMembers(text, name){
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assign = new RegExp("(?:^|[\\n;{(,])\\s*(?:const|let|var)?\\s*" + escaped + "\\s*=\\s*", "g");
  let at = -1, match;
  while ((match = assign.exec(text))) at = match.index + match[0].length;   // 마지막 대입이 최신이다
  if (at < 0) return [];
  const rest = text.slice(at);
  const head = rest.slice(0, 60);
  if (/^\[/.test(rest)) return JS_INSTANCE_MEMBERS.array;
  if (/^["'`]/.test(rest)) return JS_INSTANCE_MEMBERS.string;
  if (/^-?\d/.test(rest)) return JS_INSTANCE_MEMBERS.number;
  if (/^new\s+Map\b/.test(head)) return JS_INSTANCE_MEMBERS.map;
  if (/^new\s+Set\b/.test(head)) return JS_INSTANCE_MEMBERS.set;
  if (/^(new\s+Array\b|Array\s*\.\s*from\b|Object\s*\.\s*(keys|values|entries)\b)/.test(head)) return JS_INSTANCE_MEMBERS.array;
  if (/^String\s*\(/.test(head)) return JS_INSTANCE_MEMBERS.string;
  if (/^(Number|parseInt|parseFloat)\s*\(/.test(head)) return JS_INSTANCE_MEMBERS.number;
  if (/^\{/.test(rest)) return jsObjectLiteralKeys(rest);
  return [];
}

// 편집기가 'obj.' 뒤에서 부른다. 후보가 없으면 빈 배열 — 그러면 버퍼 단어 완성으로 넘어간다.
function jsMemberCompletionCandidates(source, receiver, prefix, libraries){
  const name = String(receiver || "");
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const query = String(prefix || "");
  const libraryItems = typeof jsLibraryMemberCandidates === "function"
    ? jsLibraryMemberCandidates(libraries, name, query)
    : [];
  if (libraryItems.length) return libraryItems;
  const items = JS_MEMBER_CATALOG[name] || jsInferredMembers(String(source || ""), name);
  if (!items || !items.length) return [];
  return items
    // 이미 다 친 이름은 뺀다. 단 함수형은 남겨 수락하면 "()" 가 붙는 편의를 유지한다.
    .filter((item) => (item.name !== query || item.type === "function") && (!query || item.name.startsWith(query)))
    .map((item) => ({ ...item }));
}

// input()·prompt() 를 쓰는 코드에만 '입력값' 칸을 보여준다(파이썬 usesInput 과 같은 규칙).
function jsUsesInput(code){
  return /(^|[^.\w])(input|prompt)\s*\(/.test(code || "");
}

// 값 하나를 콘솔 표기 문자열로 바꾼다.
// 워커 안으로 통째로 주입되므로 바깥 이름을 참조하지 않는다(자기 재귀만 한다).
function formatJsValue(value, depth, seen){
  depth = depth | 0;
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (type === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (type === "boolean") return String(value);
  if (type === "bigint") return String(value) + "n";
  if (type === "symbol") return value.toString();
  if (type === "function") return "[Function: " + (value.name || "anonymous") + "]";
  // instanceof 는 realm(워커·메인)이 다르면 어긋난다 — 내부 표식을 보는 toString 으로 판별한다.
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Error]") return value.stack ? String(value.stack) : (value.name + ": " + value.message);
  if (tag === "[object Date]") return isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (tag === "[object RegExp]") return String(value);
  if (!seen) seen = [];
  if (seen.indexOf(value) >= 0) return "[순환 참조]";
  if (depth >= 4) return Array.isArray(value) ? "[Array]" : "[Object]";
  const nested = seen.concat([value]);
  const MAX = 100;
  const more = (total) => "… 그 외 " + (total - MAX) + "개";
  if (Array.isArray(value)){
    const items = [];
    for (let i = 0; i < value.length && i < MAX; i++) items.push(formatJsValue(value[i], depth + 1, nested));
    if (value.length > MAX) items.push(more(value.length));
    return "[" + items.join(", ") + "]";
  }
  if (tag === "[object Map]"){
    const items = [];
    for (const entry of value){
      if (items.length >= MAX){ items.push("…"); break; }
      items.push(formatJsValue(entry[0], depth + 1, nested) + " => " + formatJsValue(entry[1], depth + 1, nested));
    }
    return "Map(" + value.size + ") {" + (items.length ? " " + items.join(", ") + " " : "") + "}";
  }
  if (tag === "[object Set]"){
    const items = [];
    for (const item of value){
      if (items.length >= MAX){ items.push("…"); break; }
      items.push(formatJsValue(item, depth + 1, nested));
    }
    return "Set(" + value.size + ") {" + (items.length ? " " + items.join(", ") + " " : "") + "}";
  }
  let keys;
  try { keys = Object.keys(value); } catch(_){ return String(value); }
  const items = [];
  for (let i = 0; i < keys.length && i < MAX; i++){
    let child;
    try { child = formatJsValue(value[keys[i]], depth + 1, nested); } catch(_){ child = "[읽을 수 없음]"; }
    items.push(keys[i] + ": " + child);
  }
  if (keys.length > MAX) items.push(more(keys.length));
  let prefix = "";
  try {
    const name = value.constructor && value.constructor.name;
    if (name && name !== "Object") prefix = name + " ";
  } catch(_){}
  return prefix + "{" + (items.length ? " " + items.join(", ") + " " : "") + "}";
}

// 스택에서 사용자 코드의 줄·칸을 찾는다. 실행 파일 이름(//# sourceURL)이 붙은 첫 프레임이
// 오류가 난 자리다 — 파이썬 트레이스백과 달리 자바스크립트 스택은 안쪽 프레임이 먼저 나온다.
// V8("at f (practice.js:3:5)")과 SpiderMonkey("f@practice.js:3:5") 형식을 함께 본다.
function parseJsStackLocation(stack, userFile, prefixLines){
  const text = String(stack || "");
  if (!text) return null;
  const escaped = String(userFile || JS_USER_FILE).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + ":(\\d+):(\\d+)", "g");
  let match;
  while ((match = re.exec(text))){
    const line = Number(match[1]) - (prefixLines | 0);
    if (line >= 1) return { line, column: Number(match[2]) };
  }
  return null;
}

// text[i] 에서 시작하는 문자열·주석·정규식을 건너뛴다. 소스를 훑는 곳(문법 위치 추정·셀 변환)이
// 같은 규칙을 쓰도록 한 곳에 모아 둔다. 건너뛸 것이 아니면 null.
//   end    = 건너뛴 다음 글자 위치(닫히지 않았으면 text.length 까지)
//   closed = 짝이 닫혔는지
// 템플릿 문자열 안의 ${...} 에 또 백틱이 나오는 경우는 보지 않는다(연습 코드에서는 드물다).
function jsSkipNonCode(text, i, allowRegex){
  const ch = text[i];
  if (ch === "/" && text[i + 1] === "/"){
    let j = i + 2;
    while (j < text.length && text[j] !== "\n") j++;
    return { end:j, closed:true, kind:"line-comment" };
  }
  if (ch === "/" && text[i + 1] === "*"){
    let j = i + 2;
    while (j < text.length){
      if (text[j] === "*" && text[j + 1] === "/") return { end:j + 2, closed:true, kind:"block-comment" };
      j++;
    }
    return { end:text.length, closed:false, kind:"block-comment" };
  }
  if (ch === '"' || ch === "'" || ch === "`"){
    let j = i + 1;
    while (j < text.length){
      const c = text[j];
      if (c === "\\"){ j += 2; continue; }
      if (c === ch) return { end:j + 1, closed:true, kind:"string", quote:ch };
      if (c === "\n" && ch !== "`") break;              // 일반 따옴표는 줄을 넘지 못한다
      j++;
    }
    return { end:j, closed:false, kind:"string", quote:ch };
  }
  if (ch === "/" && allowRegex){
    let j = i + 1, inClass = false;
    while (j < text.length){
      const c = text[j];
      if (c === "\\"){ j += 2; continue; }
      if (c === "\n") break;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) return { end:j + 1, closed:true, kind:"regex" };
      j++;
    }
    return { end:j, closed:false, kind:"regex" };
  }
  return null;
}

// 슬래시가 정규식의 시작인지 나눗셈인지 가른다. 값이 끝난 자리(이름·숫자·닫는 괄호) 뒤면 나눗셈이다.
// prev 는 직전 의미 토큰의 갈래("w"=낱말, "v"=값, 그 밖에는 글자 그대로), prevWord 는 직전 낱말.
function jsRegexAllowed(prev, prevWord){
  if (!prev) return true;
  if (prev === ")" || prev === "]" || prev === "v") return false;
  if (prev === "w") return /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(prevWord);
  return true;
}

// 노트북 셀은 전역에서 실행해야 앞 셀에서 만든 값이 다음 셀로 이어진다. 그런데 eval 의
// let·const·class 는 그 eval 안에서만 살아 다음 셀로 넘어가지 않는다(var·function 만 전역에 남는다).
// 그래서 맨 바깥(괄호·중괄호 밖)의 선언만 바꾼다:
//   let·const → var          (구조분해 let {a,b} = … 도 var 로 바꾸기만 하면 그대로 동작한다)
//   class X   → var X = class X
// 이렇게 하면 같은 셀을 다시 실행해도 "이미 선언됨" 오류가 나지 않는다(노트북에서 가장 잦은 동작).
// 블록·함수 안의 let·const 는 원래대로 그 안에서만 살아야 하므로 건드리지 않는다.
function transformJsCellSource(source){
  const text = String(source == null ? "" : source);
  let out = "", i = 0, depth = 0, prev = "", prevWord = "", changed = false;
  const nextWordAt = (from) => {
    let j = from;
    while (j < text.length && /\s/.test(text[j])) j++;
    let k = j;
    while (k < text.length && /[\w$]/.test(text[k])) k++;
    return { start:j, end:k, word:text.slice(j, k) };
  };
  while (i < text.length){
    const skip = jsSkipNonCode(text, i, jsRegexAllowed(prev, prevWord));
    if (skip){
      out += text.slice(i, skip.end);
      if (skip.kind === "string" || skip.kind === "regex"){ prev = "v"; prevWord = ""; }
      i = skip.end;
      continue;
    }
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{"){ depth++; out += ch; prev = ch; prevWord = ""; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}"){ depth--; out += ch; prev = ch; prevWord = ""; i++; continue; }
    if (/[\w$]/.test(ch)){
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      const statementStart = prev === "" || prev === ";" || prev === "{" || prev === "}";
      if (depth === 0 && prev !== "." && (word === "let" || word === "const")){
        // 뒤에 이름이나 구조분해가 와야 선언이다(obj.let 같은 이름 사용과 구분).
        const after = text.slice(j).match(/^\s*([A-Za-z_$[{])/);
        if (after){ out += "var"; changed = true; }
        else out += word;
      } else if (depth === 0 && statementStart && word === "class"){
        const name = nextWordAt(j);
        if (name.word){ out += "var " + name.word + " = class"; changed = true; }
        else out += word;                                  // 이름 없는 class 는 선언문이 아니다
      } else out += word;
      prev = "w"; prevWord = word; i = j;
      continue;
    }
    out += ch;
    prev = /\s/.test(ch) ? prev : ch;
    if (!/\s/.test(ch)) prevWord = "";
    i++;
  }
  return { code:out, changed };
}

// 문법 오류의 자리를 짚는다. 엔진(V8·SpiderMonkey 모두)은 new Function 으로 컴파일한 코드의
// 문법 오류 위치를 스택에 남기지 않으므로, 소스를 직접 훑어 짝이 맞지 않는 괄호와 닫히지 않은
// 따옴표를 찾는다. 확실할 때만 위치를 돌려주고 애매하면 null 로 물러난다(틀린 줄을 짚는 것보다 낫다).
function locateJsSyntaxProblem(source){
  const text = String(source == null ? "" : source);
  const openerOf = { ")":"(", "]":"[", "}":"{" };
  const stack = [];
  let i = 0, line = 1, col = 1, prev = "", prevWord = "";
  const advance = () => {
    if (text[i] === "\n"){ line++; col = 1; } else col++;
    i++;
  };

  while (i < text.length){
    const skip = jsSkipNonCode(text, i, jsRegexAllowed(prev, prevWord));
    if (skip){
      const start = { line, column:col };
      while (i < skip.end) advance();                        // 건너뛴 만큼 줄·칸을 함께 옮긴다
      if (!skip.closed){
        if (skip.kind === "block-comment") return { line:start.line, column:start.column, reason:"블록 주석 /* 가 닫히지 않았어요." };
        if (skip.kind === "string") return { line:start.line, column:start.column,
          reason:(skip.quote === "`" ? "백틱(`)" : "따옴표(" + skip.quote + ")") + "으로 연 문자열이 닫히지 않았어요." };
        return null;                                         // 닫히지 않은 정규식 — 나눗셈이었을 수도 있어 말하지 않는다
      }
      if (skip.kind === "string" || skip.kind === "regex"){ prev = "v"; prevWord = ""; }
      continue;
    }
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{"){
      stack.push({ ch, line, column:col });
      prev = ch; prevWord = "";
      advance();
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}"){
      const top = stack.pop();
      if (!top || top.ch !== openerOf[ch])
        return { line, column:col, reason:"여는 짝 없이 " + ch + " 가 닫혔어요." };
      prev = ch; prevWord = "";
      advance();
      continue;
    }
    if (/\s/.test(ch)){ advance(); continue; }
    if (/[\w$]/.test(ch)){                                   // 낱말 — 정규식 판정에 쓴다
      let word = "";
      while (i < text.length && /[\w$]/.test(text[i])){ word += text[i]; advance(); }
      prev = "w"; prevWord = word;
      continue;
    }
    prev = ch; prevWord = "";
    advance();
  }
  if (stack.length){
    const open = stack[stack.length - 1];
    return { line:open.line, column:open.column, reason:open.ch + " 를 열고 닫지 않았어요." };
  }
  return null;
}

// 실행 전에 문법만 확인한다. new Function 은 본문을 컴파일만 하고 실행하지 않는다.
function checkJsSyntax(source){
  const text = String(source == null ? "" : source);
  try {
    new Function(JS_WRAPPER_HEAD + text + "\n})();");
    return null;
  } catch(error){
    if (!(error instanceof SyntaxError)) return null;
    const message = String((error && error.message) || "문법 오류");
    const spot = locateJsSyntaxProblem(text);
    return spot
      ? { message: message + " — " + spot.reason, line: spot.line, column: spot.column }
      : { message, line: 0, column: 0 };
  }
}

// 자주 나는 오류에 "무엇을 고치면 되는지"를 한국어로 붙인다(파이썬 explainPythonError 와 같은 역할).
// 위에서부터 처음 맞는 항목 하나만 쓴다 — 좁은 조건을 먼저 둔다.
const JS_ERROR_GUIDES = [
  { name:"ReferenceError", pattern:/Cannot access '([^']+)' before initialization/,
    title:"만들기 전에 먼저 썼어요",
    tip:(m) => "‘" + m[1] + "’ 은(는) let·const 로 만든 이름이라 만든 줄보다 위에서는 쓸 수 없어요. 쓰는 곳보다 위에서 먼저 만들어 주세요." },
  { name:"ReferenceError", pattern:/([A-Za-z_$][\w$]*) is not defined/,
    title:"이름을 찾지 못했어요",
    tip:(m) => "‘" + m[1] + "’ 이라는 이름이 없어요. 철자를 확인하거나 let·const 로 먼저 만들어 주세요." },
  { name:"TypeError", pattern:/Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']+)'\))?/,
    title:"값이 없는데 그 안을 꺼내려 했어요",
    tip:(m) => "값이 " + m[1] + " 인데 " + (m[2] ? "‘" + m[2] + "’ 을(를) " : "") + "꺼내려고 했어요. 그 값이 제대로 만들어졌는지, 배열이라면 없는 번호를 찾은 건 아닌지 확인해 주세요." },
  { name:"TypeError", pattern:/([A-Za-z_$][\w$.]*) is not a function/,
    title:"함수가 아닌 것을 불렀어요",
    tip:(m) => "‘" + m[1] + "’ 은(는) 함수가 아니에요. 이름 철자와, 그 값이 정말 함수인지 확인해 주세요." },
  { name:"TypeError", pattern:/Assignment to constant variable/,
    title:"const 로 만든 값은 바꿀 수 없어요",
    tip:"값을 나중에 바꿔야 하면 const 대신 let 으로 만들어 주세요." },
  { name:"TypeError", pattern:/([A-Za-z_$][\w$.]*) is not iterable/,
    title:"하나씩 꺼낼 수 없는 값이에요",
    tip:(m) => "for…of 나 [...펼치기] 는 배열·문자열처럼 차례가 있는 값에만 쓸 수 있어요. ‘" + m[1] + "’ 이 배열이 맞는지 확인해 주세요. 객체라면 Object.keys() 를 써 보세요." },
  { name:"RangeError", pattern:/Maximum call stack size exceeded/,
    title:"함수가 자기 자신을 끝없이 불렀어요",
    tip:"재귀 함수에 멈추는 조건이 있는지, 그 조건에 정말 닿는지 확인해 주세요." },
  { name:"SyntaxError", pattern:/Unexpected end of input/,
    title:"닫는 기호가 모자라요",
    tip:"( ) { } [ ] 와 따옴표는 연 개수만큼 닫아야 해요. 코드 끝에서 닫히지 않은 짝을 찾아 주세요." },
  { name:"SyntaxError", pattern:/Unexpected token/,
    title:"문법 기호를 확인해 보세요",
    tip:"괄호·쉼표·세미콜론의 자리가 맞는지, 닫는 기호가 하나 더 있지는 않은지 확인해 주세요." },
  { name:"SyntaxError", pattern:/Identifier '([^']+)' has already been declared/,
    title:"같은 이름을 두 번 만들었어요",
    tip:(m) => "‘" + m[1] + "’ 은(는) 이미 만든 이름이에요. 값만 바꾸려면 let·const 없이 이름만 쓰면 돼요." }
];

function explainJsError(name, message){
  const type = String(name || ""), text = String(message || "");
  for (const guide of JS_ERROR_GUIDES){
    if (guide.name && guide.name !== type) continue;
    const match = guide.pattern.exec(text);
    if (!match) continue;
    return { title:guide.title, tip:(typeof guide.tip === "function" ? guide.tip(match) : guide.tip) };
  }
  return null;
}

// Blob 워커 안에서 독립 실행되므로 바깥 변수를 참조하지 않는다.
// 값 표기 함수(formatJsValue)는 메인 스레드에서 통째로 주입받아 표기가 어긋나지 않게 한다.
function jsWorkerMain(formatValue){
  // 사용자 코드가 바꿔치기하기 전에 진짜 타이머를 딱 한 번 붙잡아 둔다.
  // (커널 모드에서는 셀마다 감싸므로, 여기서 잡지 않으면 두 번째 셀이 첫 셀의 껍데기를 잡는다.)
  const realSetTimeout = self.setTimeout.bind(self);
  const realClearTimeout = self.clearTimeout.bind(self);
  const realSetInterval = self.setInterval.bind(self);
  const realClearInterval = self.clearInterval.bind(self);
  const geval = self.eval;                    // 간접 eval — 전역에서 실행되어 var·function 이 남는다
  // 처리되지 않은 거부는 워커에 한 번만 등록하고, 지금 돌고 있는 실행으로 넘긴다.
  // (셀마다 등록하면 리스너가 쌓이고 이미 끝난 셀로 오류가 흘러간다.)
  let activeFail = null;
  const loadedLibraries = new Set();             // 노트북 커널에서는 같은 라이브러리를 셀마다 다시 실행하지 않는다
  self.addEventListener("unhandledrejection", (event) => {
    try { event.preventDefault(); } catch(_){}
    if (activeFail) activeFail(event && event.reason);
  });

  self.onmessage = (event) => {
    const job = event.data || {};
    if (job.type === "run"){
      self.onmessage = null;                  // 한 번 실행하고 끝(실행마다 워커를 새로 만든다)
      runOnce(job);
      return;
    }
    // 커널(노트북 셀): 워커를 살려 두고 셀을 차례로 받는다 — 앞 셀의 값이 그대로 남는다.
    if (job.type === "cell") runOnce(job);
  };

  function runOnce(job){
    // 사용자 코드도 Worker 전역의 postMessage 를 부를 수 있다. 실행 프로토콜은 미리 붙잡은
    // 전송 함수와 작업마다 다른 토큰을 써서 사용자 메시지와 섞이지 않게 한다.
    const sendMessage = self.postMessage.bind(self);
    const headLimit = job.headLimit | 0;
    const segmentLimit = job.segmentLimit | 0;
    const graceMs = job.graceMs | 0;
    const flushMs = job.flushMs | 0;
    const undoers = new Map();                   // setTimeout id → 대기 수를 되돌리는 함수
    const intervals = new Set();                 // 끝날 때 정리할 setInterval id
    // 출력은 모아 두지 않고 조금씩 내보낸다 — 끝나지 않는 반복이나 중지에서도
    // 그때까지 찍힌 내용이 화면에 남는다(워커가 통째로 끊겨도 이미 보낸 건 살아 있다).
    const flushChars = job.flushChars | 0;
    let outbox = [];
    let outboxChars = 0;
    let sentSegments = 0, totalChars = 0, truncated = false, indent = "", flushTimer = 0;

    const flush = () => {
      if (flushTimer){ realClearTimeout(flushTimer); flushTimer = 0; }
      if (!outbox.length) return;
      const chunk = outbox;
      outbox = [];
      outboxChars = 0;
      sendMessage({ type:"chunk", id:job.id, token:job.token, segments:chunk });
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = realSetTimeout(() => { flushTimer = 0; flush(); }, flushMs);
    };

    // 스트림이 같으면 앞 조각에 이어 붙인다 — 조각 수를 아껴 렌더도 가벼워진다.
    const emit = (stream, text) => {
      if (truncated) return;
      let value = String(text == null ? "" : text);
      if (!value) return;
      if (totalChars + value.length > headLimit){
        value = value.slice(0, Math.max(0, headLimit - totalChars));
        truncated = true;
        if (!value) return;
      }
      const last = outbox[outbox.length - 1];
      if (last && last.s === stream) last.t += value;
      else {
        if (sentSegments + outbox.length >= segmentLimit){ truncated = true; return; }
        outbox.push({ s:stream, t:value });
        sentSegments++;
      }
      totalChars += value.length;
      outboxChars += value.length;
      // 동기 반복 안에서도 화면이 따라오도록, 일정량이 쌓이면 타이머를 기다리지 않고 바로 보낸다.
      if (outboxChars >= flushChars) flush();
      else scheduleFlush();
    };
    const writeLine = (stream, args) => {
      const parts = [];
      for (let i = 0; i < args.length; i++) parts.push(formatValue(args[i], 0));
      emit(stream, indent + parts.join(" ") + "\n");
    };

    self.console = {
      log:(...a) => writeLine("out", a),
      info:(...a) => writeLine("out", a),
      debug:(...a) => writeLine("out", a),
      dir:(...a) => writeLine("out", a),
      table:(...a) => writeLine("out", a),
      warn:(...a) => writeLine("warn", a),
      trace:(...a) => writeLine("warn", a),
      error:(...a) => writeLine("err", a),
      assert:(ok, ...a) => { if (!ok) writeLine("err", a.length ? a : ["Assertion failed"]); },
      group:(...a) => { if (a.length) writeLine("out", a); indent += "  "; },
      groupCollapsed:(...a) => { if (a.length) writeLine("out", a); indent += "  "; },
      groupEnd:() => { indent = indent.slice(0, -2); },
      clear:() => {
        if (flushTimer){ realClearTimeout(flushTimer); flushTimer = 0; }
        outbox = [];
        outboxChars = 0;
        sentSegments = 0;
        totalChars = 0;
        truncated = false;
        sendMessage({ type:"clear", id:job.id, token:job.token });
      },
      time:() => {}, timeEnd:() => {}, count:() => {}
    };

    // 입력값 칸의 내용을 줄 단위로 준다. 파이썬 input() 과 화면에 남는 모양을 맞춘다.
    const stdinLines = String(job.stdin || "").split("\n");
    if (stdinLines.length && stdinLines[stdinLines.length - 1] === "") stdinLines.pop();
    let stdinAt = 0;
    self.input = (promptText) => {
      if (promptText !== undefined) emit("out", formatValue(promptText, 0));
      if (stdinAt >= stdinLines.length)
        throw new Error("입력값이 모자랍니다 — 편집기 위 ‘입력값’ 칸에 한 줄에 하나씩 적어 주세요.");
      const value = stdinLines[stdinAt++];
      emit("out", value + "\n");
      return value;
    };
    self.prompt = self.input;

    // 워커에는 화면이 없다. 그냥 ReferenceError 가 나면 초보자가 원인을 못 찾으므로 이유를 알려준다.
    ["document", "window", "alert", "confirm", "localStorage"].forEach((name) => {
      if (name in self) return;
      try {
        Object.defineProperty(self, name, { configurable:true, get(){
          throw new Error(name + " 은(는) 코드 연습 화면에서 쓸 수 없어요 — 화면을 다루는 연습은 HTML 미리보기에서 해요.");
        } });
      } catch(_){}
    });

    let finished = false, failure = null, pending = 0, hasInterval = false, drain = null;
    let asyncWrapped = false;                    // 셀을 async 함수로 감싸 실행했는가(변수가 이어지지 않음)
    const describe = (error) => {
      if (error instanceof Error)
        return { name:String(error.name || "Error"), message:String(error.message || ""), stack:String(error.stack || "") };
      return { name:"Error", message:formatValue(error, 1), stack:"" };
    };
    const finish = (pendingNote, value) => {
      if (finished) return;
      finished = true;
      activeFail = null;
      // 브라우저에서는 곧 terminate 되지만, 남은 반복이 결과 뒤에도 계속 도는 일이 없게 여기서 끊는다.
      intervals.forEach((id) => { try { realClearInterval(id); } catch(_){} });
      intervals.clear();
      // 단일 실행 워커는 곧 terminate 되지만, 노트북 커널은 계속 살아 있다. 유예 시간이 지난
      // setTimeout 이 다음 셀의 전역 상태를 뒤늦게 바꾸지 못하도록 남은 예약도 함께 걷는다.
      for (const id of undoers.keys()){ try { realClearTimeout(id); } catch(_){} }
      undoers.clear();
      pending = 0;
      drain = null;
      flush();                                   // 남은 출력을 먼저 보내 순서가 뒤집히지 않게 한다
      sendMessage({ type:"result", id:job.id, token:job.token, result:{
        truncated,
        error:failure,
        pendingNote:pendingNote || "",
        // 노트북 관례: 셀 마지막 식의 값을 결과로 보여준다(값이 없으면 빈 문자열).
        value:(failure || value === undefined) ? "" : formatValue(value, 1),
        asyncWrapped
      } });
    };
    const fail = (error) => {
      if (!failure) failure = describe(error);
      finish();
    };
    activeFail = fail;
    const settle = () => {
      if (pending > 0 || !drain) return;
      const fn = drain; drain = null; fn();
    };

    // 예약된 작업을 세어 둔다 — 본체가 끝나도 setTimeout 이 남아 있으면 그 결과까지 보여줘야 한다.
    self.setTimeout = function(fn, ms){
      if (typeof fn !== "function") return realSetTimeout(fn, ms);
      const args = Array.prototype.slice.call(arguments, 2);
      pending++;
      let settled = false;
      const done = () => { if (settled) return; settled = true; pending--; settle(); };
      const id = realSetTimeout(() => {
        undoers.delete(id);
        try { fn.apply(null, args); } catch(error){ fail(error); } finally { done(); }
      }, ms);
      undoers.set(id, done);
      return id;
    };
    self.clearTimeout = function(id){
      const done = undoers.get(id);
      if (done){ undoers.delete(id); done(); }
      return realClearTimeout(id);
    };
    self.setInterval = function(fn, ms){
      hasInterval = true;                     // 반복은 스스로 끝나지 않으므로 유예 시간까지만 돌린다
      const args = Array.prototype.slice.call(arguments, 2);
      const id = typeof fn === "function"
        ? realSetInterval(() => { try { fn.apply(null, args); } catch(error){ fail(error); } }, ms)
        : realSetInterval(fn, ms);
      intervals.add(id);
      return id;
    };
    self.clearInterval = function(id){
      intervals.delete(id);
      return realClearInterval(id);
    };

    // 라이브러리는 사용자 코드와 별도 eval 로 실행한다. 사용자 코드 앞에 문자열로 붙이지 않으므로
    // practice.js·cell.js 오류 줄 번호가 라이브러리 크기만큼 밀리지 않는다.
    for (const library of Array.isArray(job.libraries) ? job.libraries : []){
      const libraryId = String((library && library.id) || "");
      if (!libraryId || loadedLibraries.has(libraryId)) continue;
      const libraryName = String(library.name || libraryId);
      try {
        const sourceURL = String(library.sourceURL || "mn-library.js").replace(/[\r\n]/g, "");
        geval(String(library.source || "") + "\n//# sourceURL=" + sourceURL + "\n");
        if (library.global && typeof self[String(library.global)] === "undefined")
          throw new Error("전역 이름 ‘" + library.global + "’을 만들지 않았어요.");
        loadedLibraries.add(libraryId);
      } catch(error){
        const detail = describe(error);
        failure = { name:detail.name, message:libraryName + " 불러오기 실패: " + detail.message, stack:detail.stack };
        finish();
        return;
      }
    }

    let started;
    if (job.type === "cell"){
      // 노트북 셀: 전역에서 실행해야 앞 셀의 값이 이어진다. 간접 eval 은 마지막 식의 값도 돌려준다.
      // //# sourceURL 덕에 스택의 줄 번호가 셀의 줄 번호와 그대로 맞는다(보정 필요 없음).
      const tail = "\n//# sourceURL=" + (job.userFile || "cell.js") + "\n";
      try {
        started = geval(job.code + tail);
      } catch(error){
        const message = String((error && error.message) || "");
        if (error instanceof SyntaxError && /await/i.test(message)){
          // 전역에서는 top-level await 를 쓸 수 없다. 문법 오류라 아무것도 실행되지 않았으니
          // 원본 그대로 async 함수로 감싸 다시 실행해도 안전하다(대신 이 셀의 변수는 이어지지 않는다).
          asyncWrapped = true;
          try { started = geval("(async () => {\n" + job.source + "\n})()" + tail); }
          catch(retryError){ failure = describe(retryError); finish(); return; }
        } else if (error instanceof SyntaxError){ failure = describe(error); finish(); return; }
        else { fail(error); return; }
      }
    } else {
      let body;
      try { body = new Function(job.head + job.source + job.tail); }
      catch(error){ failure = describe(error); finish(); return; }
      try { started = body(); } catch(error){ fail(error); return; }
    }
    Promise.resolve(started).then((value) => {
      if (finished) return;
      if (pending <= 0 && !hasInterval){ finish("", value); return; }
      const seconds = Math.round(graceMs / 100) / 10;
      const note = hasInterval
        ? "setInterval 로 예약한 반복이 남아 " + seconds + "초 뒤에 멈췄어요. clearInterval 로 직접 멈출 수 있어요."
        : "예약한 작업이 " + seconds + "초 안에 끝나지 않아 여기서 멈췄어요.";
      const timer = realSetTimeout(() => finish(note, value), graceMs);
      if (!hasInterval) drain = () => { realClearTimeout(timer); finish("", value); };
    }, (error) => fail(error));
  }
}

// 워커를 하나 띄워 코드를 실행한다. { promise, cancel } 을 돌려주며 promise 는 항상 결과로 resolve 된다.
function startJsWorkerRun(source, options){
  options = options || {};
  const timeoutMs = options.timeoutMs || JS_RUN_TIMEOUT_MS;
  const userFile = options.userFile || JS_USER_FILE;
  let worker = null;
  try {
    const code = "(" + jsWorkerMain.toString() + ")(" + formatJsValue.toString() + ");";
    const url = URL.createObjectURL(new Blob([code], { type:"text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch(error){
    const message = "자바스크립트 실행기를 만들지 못했어요: " + ((error && error.message) || error);
    return { promise: Promise.resolve({ segments:[], error:{ name:"Error", message, stack:"" } }), cancel(){} };
  }

  // 워커가 보내온 출력을 여기 모은다. 중지·시간 초과로 워커를 끊어도 이미 받은 건 그대로 남는다.
  const segments = [];
  const token = (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : Date.now().toString(36) + ":" + Math.random().toString(36).slice(2);
  const absorb = (chunk) => {
    if (!Array.isArray(chunk)) return;
    for (const piece of chunk){
      if (!piece || !piece.t) continue;
      const last = segments[segments.length - 1];
      if (last && last.s === piece.s) last.t += piece.t;
      else segments.push({ s:piece.s, t:piece.t });
    }
  };

  let settled = false, timer = 0, done = null;
  const stop = () => {
    clearTimeout(timer); timer = 0;
    if (worker){ try { worker.terminate(); } catch(_){} worker = null; }
  };
  const promise = new Promise((resolve) => {
    done = (extra) => {
      if (settled) return;
      settled = true;
      stop();
      resolve(Object.assign({ segments }, extra || {}));
    };
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.token !== token) return;           // 사용자 코드가 보낸 postMessage 는 실행 프로토콜이 아니다
      if (data.type === "clear"){
        segments.length = 0;
        if (typeof options.onClear === "function") options.onClear();
        return;
      }
      if (data.type === "chunk"){
        absorb(data.segments);
        if (typeof options.onChunk === "function") options.onChunk(data.segments);
        return;
      }
      if (data.type === "result") done(data.result || {});
    };
    worker.onerror = (event) => {
      try { event.preventDefault(); } catch(_){}
      done({ error:{ name:"Error", message:String((event && event.message) || "실행 중 오류가 났어요."), stack:"" } });
    };
    timer = setTimeout(() => done({ timedOut:true }), timeoutMs);
    worker.postMessage({
      type:"run",
      token,
      source: String(source == null ? "" : source),
      stdin: String(options.stdin || ""),
      libraries: Array.isArray(options.libraries) ? options.libraries : [],
      head: JS_WRAPPER_HEAD,
      tail: JS_WRAPPER_TAIL_HEAD + userFile + "\n",
      headLimit: JS_OUTPUT_HEAD_LIMIT,
      segmentLimit: JS_SEGMENT_LIMIT,
      graceMs: options.graceMs || JS_PENDING_GRACE_MS,
      flushMs: options.flushMs || JS_OUTPUT_FLUSH_MS,
      flushChars: options.flushChars || JS_OUTPUT_FLUSH_CHARS
    });
  });
  return { promise, cancel(){ done({ cancelled:true }); } };
}

// ── 과제 자동채점 ───────────────────────────────────────────────────────────
// 테스트마다 코드를 처음부터 다시 실행한다. 실행마다 워커를 새로 만들므로 테스트끼리
// 변수가 섞이지 않는다(파이썬 채점이 테스트마다 새 스코프를 쓰는 것과 같은 성질).
// 결과는 파이썬 채점 보고서와 같은 모양이라 renderAssignmentGradingResult 를 그대로 쓴다.
async function runJsGrading(source, tests, hooks){
  hooks = hooks || {};
  const cases = normalizeAssignmentTests(tests);
  // 문법이 틀리면 어느 테스트도 돌 수 없다. 워커를 20번 띄우는 대신 같은 사유를 모든 줄에 적는다
  // (파이썬 채점도 테스트마다 같은 SyntaxError 를 담는다 — 여기서는 줄 번호까지 붙는다).
  const syntax = checkJsSyntax(source);
  if (syntax){
    return { results:cases.map((test, index) => jsGradingRow(test, index, {
      error:{ name:"SyntaxError", message:syntax.message, stack:"" }
    })) };
  }
  const results = [];
  for (let index = 0; index < cases.length; index++){
    if (typeof hooks.isCancelled === "function" && hooks.isCancelled()) break;
    if (typeof hooks.onProgress === "function") hooks.onProgress(index, cases.length);
    const handle = startJsWorkerRun(source, { stdin:cases[index].input, libraries:hooks.libraries });
    if (typeof hooks.onHandle === "function") hooks.onHandle(handle);
    results.push(jsGradingRow(cases[index], index, await handle.promise));
  }
  return { results };
}

// 실행 결과 하나를 채점 보고서의 한 줄로 바꾼다.
function jsGradingRow(test, index, raw){
  raw = raw || {};
  const pick = (streams) => (raw.segments || [])
    .filter((segment) => streams.indexOf(segment.s) >= 0)
    .map((segment) => segment.t)
    .join("");
  const actual = pick(["out"]);
  // 파이썬 채점과 같은 순서: 예외가 있으면 그것을, 없을 때만 stderr 출력을 오류로 본다.
  let error = "";
  if (raw.error) error = (raw.error.name || "Error") + ": " + (raw.error.message || "");
  else if (raw.timedOut) error = "⏱ " + Math.round(JS_RUN_TIMEOUT_MS / 1000) + "초가 넘도록 끝나지 않았어요. 끝나지 않는 반복이 없는지 확인해 주세요.";
  else if (raw.cancelled) error = "채점을 중지했습니다.";
  else error = pick(["warn", "err"]).trim();
  const expected = String(test.expected || "");
  return {
    name: test.name || ("테스트 " + (index + 1)),
    input: String(test.input || ""),
    expected,
    actual,
    error,
    passed: !error && normalizeGradingOutput(actual) === normalizeGradingOutput(expected)
  };
}

// ── 노트북 커널 ─────────────────────────────────────────────────────────────
// 문서마다 워커를 하나 살려 두고 셀을 차례로 보낸다(= 커널). 워커를 끊으면 변수도 사라지는데,
// 이는 파이썬 커널 재시작과 같은 동작이다.
const _jsKernels = new Map();                 // kernelId → { worker, seq, jobs }

function jsKernelWorkerSource(){
  return "(" + jsWorkerMain.toString() + ")(" + formatJsValue.toString() + ");";
}

function ensureJsKernel(kernelId){
  const key = String(kernelId || "default");
  const alive = _jsKernels.get(key);
  if (alive) return alive;
  const url = URL.createObjectURL(new Blob([jsKernelWorkerSource()], { type:"text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  const kernel = { worker, seq:0, jobs:new Map() };
  worker.onmessage = (event) => {
    const data = event.data || {};
    const job = kernel.jobs.get(data.id);
    if (!job || data.token !== job.token) return;
    if (data.type === "clear"){
      job.clear();
      if (typeof job.onClear === "function") job.onClear();
      return;
    }
    if (data.type === "chunk"){
      job.absorb(data.segments);
      if (typeof job.onChunk === "function") job.onChunk(data.segments);
      return;
    }
    if (data.type === "result"){
      kernel.jobs.delete(data.id);
      job.settle(data.result || {});
    }
  };
  worker.onerror = (event) => {
    try { event.preventDefault(); } catch(_){}
    const message = String((event && event.message) || "커널에서 오류가 났어요.");
    for (const [id, job] of kernel.jobs){
      kernel.jobs.delete(id);
      job.settle({ error:{ name:"Error", message, stack:"" } });
    }
  };
  _jsKernels.set(key, kernel);
  return kernel;
}

// 커널을 끊는다(= 재시작). 다음 셀 실행에서 깨끗한 워커가 새로 만들어진다.
function resetJsKernel(kernelId){
  const key = String(kernelId || "default");
  const kernel = _jsKernels.get(key);
  if (!kernel) return;
  _jsKernels.delete(key);
  for (const [, job] of kernel.jobs) job.settle({ cancelled:true });
  kernel.jobs.clear();
  try { kernel.worker.terminate(); } catch(_){}
}

// 노트북 셀 하나를 커널에서 실행한다.
// 결과 모양은 Pyodide 커널(startPyodideKernelRun)과 같게 맞춰 노트북 화면이 그대로 쓰도록 한다.
function startJsKernelRun(opts){
  opts = opts || {};
  const kernelId = String(opts.kernelId || "default");
  if (opts.reset) resetJsKernel(kernelId);
  if (opts.reset && !opts.source){
    return { promise:Promise.resolve({ ok:true, stdout:"", stderr:"", code:0, images:[], outputs:[], variables:[], richOutputs:[], reset:true }), cancel(){} };
  }
  const source = String(opts.source == null ? "" : opts.source);
  const transformed = transformJsCellSource(source);
  const kernel = ensureJsKernel(kernelId);
  const id = ++kernel.seq;
  const token = (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : Date.now().toString(36) + ":" + Math.random().toString(36).slice(2);
  const segments = [];
  const absorb = (chunk) => {
    for (const piece of chunk || []){
      if (!piece || !piece.t) continue;
      const last = segments[segments.length - 1];
      if (last && last.s === piece.s) last.t += piece.t;
      else segments.push({ s:piece.s, t:piece.t });
    }
  };

  let settled = false, settle = null, timer = 0;
  const promise = new Promise((resolve) => {
    settle = (raw) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); timer = 0;
      kernel.jobs.delete(id);
      resolve(jsKernelResult(segments, raw));
    };
    kernel.jobs.set(id, { absorb, clear:() => { segments.length = 0; }, onChunk:opts.onChunk, onClear:opts.onClear, settle, token });
    timer = setTimeout(() => {
      settle({ timedOut:true });
      resetJsKernel(kernelId);                 // 응답이 없는 커널은 끊는다(= 무한 루프)
    }, opts.timeoutMs || JS_RUN_TIMEOUT_MS);
    kernel.worker.postMessage({
      type:"cell", id, token,
      source,
      code: transformed.code,
      userFile: opts.userFile || "cell.js",
      stdin: String(opts.stdin || ""),
      libraries: Array.isArray(opts.libraries) ? opts.libraries : [],
      headLimit: JS_OUTPUT_HEAD_LIMIT,
      segmentLimit: JS_SEGMENT_LIMIT,
      graceMs: opts.graceMs || JS_PENDING_GRACE_MS,
      flushMs: opts.flushMs || JS_OUTPUT_FLUSH_MS,
      flushChars: opts.flushChars || JS_OUTPUT_FLUSH_CHARS
    });
  });
  // 중지: 커널을 끊는다. 파이썬 커널 중지와 마찬가지로 변수도 함께 사라진다.
  return { promise, cancel(){ settle({ cancelled:true }); resetJsKernel(kernelId); } };
}

// 워커가 준 조각·상태를 노트북이 아는 결과 모양으로 바꾼다.
function jsKernelResult(segments, raw){
  raw = raw || {};
  const pick = (streams) => segments.filter((s) => streams.indexOf(s.s) >= 0).map((s) => s.t).join("");
  const notes = [];
  if (raw.truncated) notes.push("[출력이 1MB를 넘어 이후 내용은 생략했습니다.]");
  if (raw.timedOut) notes.push("⏱ " + Math.round(JS_RUN_TIMEOUT_MS / 1000) + "초가 넘도록 끝나지 않아 커널을 멈췄어요. 끝나지 않는 반복이 없는지 확인해 주세요. (변수는 초기화됩니다)");
  if (raw.cancelled) notes.push("실행을 중지했습니다. (커널이 멈춰 변수는 초기화됩니다)");
  if (raw.asyncWrapped) notes.push("이 셀은 await 를 써서 함수로 감싸 실행했어요 — 여기서 let·const 로 만든 값은 다음 셀로 이어지지 않아요.");
  if (raw.pendingNote) notes.push(raw.pendingNote);
  const errorText = raw.error
    ? (raw.error.name || "Error") + ": " + (raw.error.message || "")
    : "";
  const stderr = [pick(["warn", "err"]), errorText, notes.join("\n")].filter(Boolean).join("\n");
  // 마지막 식의 값은 노트북 관례대로 실행 결과(execute_result)로 넘긴다 — .ipynb 에도 그대로 저장된다.
  const richOutputs = raw.value
    ? [{ output_type:"execute_result", data:{ "text/plain":raw.value }, metadata:{} }]
    : [];
  return {
    ok: !raw.error && !raw.timedOut && !raw.cancelled,
    stdout: pick(["out"]),
    stderr,
    code: raw.error ? 1 : 0,
    images: [], outputs: [], variables: [],
    richOutputs,
    error: raw.error || null
  };
}

// 출력 패널의 뼈대를 만들고 글자가 들어갈 <pre> 를 돌려준다.
// 실행이 끝나기 전에도 여기에 이어 붙이므로, 만드는 일과 채우는 일을 나눠 둔다.
// 파이썬 결과 패널과 같은 클래스를 써서 모양·글자 크기가 같다.
function beginJsOutput(panel, placeholder){
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head";
  const headLabel = document.createElement("span"); headLabel.textContent = "실행 결과";
  head.appendChild(headLabel);
  const pre = document.createElement("pre"); pre.className = "out-pre";
  // 첫 출력이 오기 전까지 빈 칸으로 두지 않는다. 실제 출력이 오면 곧바로 치운다.
  if (placeholder){
    const hint = document.createElement("span");
    hint.className = "out-muted"; hint.dataset.jsPlaceholder = "1"; hint.textContent = placeholder;
    pre.appendChild(hint);
  }
  panel.append(head, pre);
  return pre;
}

// 실행 중 안내(‘실행 중…’)를 치운다. 실제 출력·결과가 들어오기 직전에 부른다.
function clearJsPlaceholder(pre){
  const first = pre && pre.firstChild;
  if (first && first.nodeType === 1 && first.dataset && first.dataset.jsPlaceholder) first.remove();
}

// 새로 들어온 출력 조각만 이어 붙인다(전체를 다시 그리지 않는다).
// 앞 조각과 색이 같으면 같은 span 에 붙여 노드 수를 아낀다.
function appendJsSegments(pre, segments){
  if (!pre || !Array.isArray(segments)) return;
  if (segments.length) clearJsPlaceholder(pre);
  const classOf = (stream) => (stream === "err" ? "out-err" : stream === "warn" ? "out-warn" : "");
  for (const segment of segments){
    if (!segment || !segment.t) continue;
    const className = classOf(segment.s);
    const last = pre.lastChild;
    if (last && last.nodeType === 1 && last.className === className && !last.dataset.jsNotice){
      last.textContent += segment.t;
      continue;
    }
    const span = document.createElement("span");
    if (className) span.className = className;
    span.textContent = segment.t;
    pre.appendChild(span);
  }
}

// console.clear() 가 오면 이미 화면에 보낸 조각까지 비운다.
function clearJsOutput(pre){
  if (!pre) return;
  pre.replaceChildren();
  pre.classList.remove("out-muted");
}

// 실행이 끝난 뒤의 안내(잘림·중지·시간 초과·오류·남은 작업)를 덧붙인다.
function finishJsOutput(pre, result, location){
  clearJsPlaceholder(pre);
  // 안내 문구는 항상 새 줄에서 시작해 한 줄로 끝난다 — 출력 끝에 줄바꿈이 없을 때만 하나 넣는다.
  const add = (text, className) => {
    if (!text) return;
    const span = document.createElement("span");
    if (className) span.className = className;
    span.dataset.jsNotice = "1";                 // 뒤따르는 출력이 이 span 에 섞이지 않게 표시해 둔다
    const current = pre.textContent;
    span.textContent = (current && !/\n$/.test(current) ? "\n" : "") + text + "\n";
    pre.appendChild(span);
  };
  if (result && result.truncated) add("[출력이 1MB를 넘어 이후 내용은 생략했습니다.]", "out-warn");
  if (result && result.cancelled) add("실행을 중지했습니다.", "out-muted");
  if (result && result.timedOut)
    add("⏱ " + Math.round(JS_RUN_TIMEOUT_MS / 1000) + "초가 넘도록 끝나지 않아 멈췄어요. 끝나지 않는 반복(while·for)이 없는지 확인해 보세요.", "out-err");
  if (result && result.error){
    const error = result.error;
    const where = location && location.line ? " (" + location.line + "번째 줄)" : "";
    add("⚠ " + (error.name || "Error") + ": " + (error.message || "") + where, "out-err");
  }
  if (result && result.pendingNote) add(result.pendingNote, "out-warn");
  if (!pre.childNodes.length){ pre.classList.add("out-muted"); pre.textContent = "(출력 없음)"; }
  // 자주 겪는 오류는 무엇을 고쳐야 하는지 한국어로 덧붙인다(파이썬 오류 도움말과 같은 카드).
  const help = result && result.error ? explainJsError(result.error.name, result.error.message) : null;
  if (help && pre.parentNode) pre.parentNode.appendChild(buildJsErrorHelp(help));
}

// 실행 결과 전체를 한 번에 그린다(스트리밍 없이 끝난 경우 — 문법 오류 등).
function renderJsResult(panel, result, location){
  const pre = beginJsOutput(panel);
  appendJsSegments(pre, (result && result.segments) || []);
  finishJsOutput(pre, result, location);
}

function buildJsErrorHelp(help){
  const card = document.createElement("section"); card.className = "py-error-help";
  const title = document.createElement("strong"); title.textContent = help.title;
  const head = document.createElement("div"); head.className = "py-error-help-head";
  head.appendChild(title);
  const tip = document.createElement("p"); tip.textContent = help.tip;
  card.append(head, tip);
  return card;
}

// 실행 진입점 — 파이썬의 runPythonSource 에 해당한다.
async function runJsSource(src, ui, options){
  options = options || {};
  if (ui.running) return;
  const { btn, status, outPanel, split } = ui;
  const source = String(src == null ? "" : src);
  const gradeTests = normalizeAssignmentTests(options.gradeTests);
  const grading = gradeTests.length > 0;
  ui.running = true;
  let cancelled = false, handle = null;
  const idleTitle = btn.title;
  const setStatus = (message) => { if (status) status.textContent = message; };
  ui.cancelRun = () => {
    if (cancelled) return;
    cancelled = true;
    setStatus("중지하는 중…");
    if (handle) handle.cancel();
  };
  btn.textContent = "■";
  btn.title = "현재 실행 중지";
  btn.setAttribute("aria-label", btn.title);
  btn.classList.add("is-running");
  if (ui.gradeBtn) ui.gradeBtn.disabled = true;
  split.classList.add("show-out");
  if (ui.clearError) ui.clearError();
  setStatus(grading ? "채점 중…" : "실행 중…");
  try {
    if (grading){
      outPanel.innerHTML = '<div class="out-head">과제 자동채점</div><pre class="out-pre out-muted">테스트 실행 중…</pre>';
      let libraries = [];
      if (!checkJsSyntax(source) && typeof prepareJsLibrarySources === "function" && typeof ui.libraryState === "function"){
        setStatus("라이브러리 준비 중…");
        libraries = await prepareJsLibrarySources(ui.libraryState());
      }
      const report = await runJsGrading(source, gradeTests, {
        libraries,
        isCancelled: () => cancelled,
        onHandle: (running) => { handle = running; },
        onProgress: (index, total) => setStatus("채점 중… " + (index + 1) + "/" + total)
      });
      renderAssignmentGradingResult(outPanel, report, assignmentGradingErrorText(report, gradeTests), gradeTests);
      return;
    }
    // 문법이 틀리면 워커를 띄울 것도 없이 여기서 끝난다.
    const syntax = checkJsSyntax(source);
    if (syntax){
      renderJsResult(outPanel, {
        segments:[],
        error:{ name:"SyntaxError", message:syntax.message, stack:"" }
      }, syntax.line ? { line:syntax.line, column:syntax.column } : null);
      if (syntax.line && ui.markError) ui.markError(syntax.line);
      return;
    }
    // 실행하는 동안 들어오는 출력을 바로 이어 붙인다 — 오래 걸리는 코드도 진행이 보이고,
    // 중지하거나 시간이 넘어 워커를 끊어도 그때까지 찍힌 내용이 남는다.
    const pre = beginJsOutput(outPanel, "실행 중…");
    let libraries = [];
    if (typeof prepareJsLibrarySources === "function" && typeof ui.libraryState === "function"){
      setStatus("라이브러리 준비 중…");
      libraries = await prepareJsLibrarySources(ui.libraryState());
      setStatus("실행 중…");
    }
    handle = startJsWorkerRun(source, {
      stdin: ui.stdin ? ui.stdin.value : "",
      libraries,
      onChunk: (chunk) => appendJsSegments(pre, chunk),
      onClear: () => clearJsOutput(pre)
    });
    const result = await handle.promise;
    const location = result.error
      ? parseJsStackLocation(result.error.stack, JS_USER_FILE, JS_WRAPPER_PREFIX_LINES)
      : null;
    finishJsOutput(pre, result, location);
    if (location && location.line && ui.markError) ui.markError(location.line);
  } catch(error){
    renderJsResult(outPanel, { segments:[], error:{ name:"Error", message:String((error && error.message) || error), stack:"" } }, null);
  } finally {
    ui.running = false;
    ui.cancelRun = null;
    handle = null;
    btn.textContent = "▶";
    btn.title = idleTitle;
    btn.setAttribute("aria-label", idleTitle);
    btn.classList.remove("is-running");
    if (ui.gradeBtn) ui.gradeBtn.disabled = false;
    setStatus("");
    if (options.keepEditorFocus === true && ui.editorTa) ui.editorTa.focus({ preventScroll:true });
  }
}
