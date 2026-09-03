"use strict";

/* 자바 연습 코드를 EXE 런처의 로컬 JDK 로 실행한다.
   파이썬(Pyodide)·자바스크립트(Worker)와 달리 브라우저에는 쓸 만한 자바 런타임이 없어서,
   EXE 가 아니거나 JDK 가 없으면 실행 대신 안내를 띄운다.
   실행 흐름(세션 시작 → 증분 폴링 → 표준입력 → 중지)은 파이썬 대화형 실행과 같은 계약을 쓴다. */

const JAVA_POLL_INTERVAL_MS = 120;
const JAVA_FINAL_HEAD = 20000;      // 완료 후 표시 상한(앞)
const JAVA_FINAL_TAIL = 10000;      // 완료 후 표시 상한(뒤)
// 실행 중에는 마지막 부분만 그린다 — 거대한 <pre> 를 매 폴마다 재배치하면 메인 스레드가 막혀
// 중지 버튼 클릭이 늦게 처리된다(파이썬 대화형 실행에서 같은 이유로 쓰는 값).
const JAVA_LIVE_TAIL = 16000;
const JAVA_GRADE_TIMEOUT_MS = 30000;   // 채점 한 건이 이보다 오래 걸리면 끝나지 않는 반복으로 본다

function javaT(text){
  return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(text) : text;
}
function javaTf(template, vars){
  return (typeof window !== "undefined" && typeof window.tf === "function") ? window.tf(template, vars) :
    String(template).replace(/\{(\w+)\}/g, (_, key) => vars && vars[key] != null ? String(vars[key]) : _);
}

/* 실행 임시 폴더의 전체 경로가 컴파일 오류 메시지 앞에 붙는다
   (C:\...\moidajava_session_xxxx\Foo.java:3: error: ...). 학생에게는 잡음이라 파일 이름만 남긴다. */
const JAVA_TEMP_PATH_RE = /(?:[A-Za-z]:)?[\\/][^\r\n"']*?moidajava_session_[0-9a-f]+[\\/]/g;
// javac 진단 첫 줄: Foo.java:3: error: ...
const JAVA_COMPILE_ERROR_RE = /^([\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]*)\.java:(\d+):/mu;
// 실행 스택 한 칸: \tat Foo.main(Foo.java:5)
const JAVA_STACK_FRAME_RE = /\(([\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]*)\.java:(\d+)\)/gu;

// 표준입력을 읽는 코드인지 — 실행 직후 터미널 칸으로 포커스를 옮길지 판단한다.
function javaUsesInput(src){
  return /System\s*\.\s*in\b|new\s+Scanner\b|\breadLine\s*\(|\bBufferedReader\b|\bConsole\b/.test(String(src || ""));
}

// 화면에 보여줄 오류 텍스트로 다듬는다(임시 경로 제거 + 같은 말을 반복하는 마지막 줄 제거).
function cleanJavaStderr(text){
  return String(text || "")
    .replace(JAVA_TEMP_PATH_RE, "")
    .replace(/\n?error: compilation failed\s*$/, "")
    .replace(/\s+$/, "");
}

/* 오류가 가리키는 편집기 줄 번호. 컴파일 오류가 있으면 그 줄을, 없으면 스택에서
   학생 파일(mainClass)의 가장 깊은 프레임을 고른다 — JDK 안쪽 프레임(Scanner.java 등)은 건너뛴다.
   javac 진단은 줄 맨 앞이 파일 이름이어야 알아볼 수 있으므로 임시 경로를 먼저 지운다
   (원본 stderr 를 그대로 넘겨도 되도록 여기서 정리한다). */
function javaErrorLine(stderr, mainClass){
  const text = cleanJavaStderr(stderr);
  const compile = JAVA_COMPILE_ERROR_RE.exec(text);
  if (compile) return Number(compile[2]) || 0;
  JAVA_STACK_FRAME_RE.lastIndex = 0;
  let frame, fallback = 0;
  while ((frame = JAVA_STACK_FRAME_RE.exec(text))){
    const line = Number(frame[2]) || 0;
    if (!line) continue;
    if (mainClass && frame[1] === mainClass) return line;
    if (!fallback) fallback = line;
  }
  return fallback;
}

/* javac 진단 한 덩어리를 편집기 표시용으로 옮긴다. 임시 경로를 지운 뒤라 파일 이름으로 시작한다.
     Main.java:4: error: cannot find symbol
             undefinedCall();
             ^
       symbol:   method undefinedCall()
   첫 줄에서 줄 번호·심각도·설명을, ^ 자리에서 칸을, 그 뒤 들여쓴 줄에서 힌트를 얻는다.
   JDK 에는 한국어 메시지 자원이 없어 한글 Windows 에서도 영어로 나오지만, 번역본이 깔린
   환경까지 함께 받아 둔다(심각도 낱말이 로케일을 타는 유일한 자리다). */
const JAVAC_DIAG_HEAD_RE = /^(\S*)\.java:(\d+):\s*([A-Za-z가-힣]+)\s*:\s*(.*)$/;
// "3 errors" 같은 마무리 줄 — 진단이 아니라 개수 요약이라 목록에서 뺀다.
const JAVAC_SUMMARY_RE = /^\d+\s*(?:errors?|warnings?|(?:오류|경고)\s*\d*개?)\s*$/;
const JAVAC_SEVERITY = { error:"error", warning:"warning", note:"info", "오류":"error", "경고":"warning", "참고":"info" };

function javacDiagnostics(stderr, ownFile){
  const text = cleanJavaStderr(stderr);
  if (!text) return [];
  // 형제 .java 를 함께 컴파일하므로 진단이 남의 파일에서도 온다. 지금 편집 중인 파일 이름을
  // 알려 주면 own 으로 갈라, 편집기 줄 표시는 이 파일 것만 받게 한다.
  const own = String(ownFile || "");
  const items = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    // 캐럿(^) 줄이 칸을, 그 뒤 줄들이 힌트(symbol:·location:)를 준다.
    // 캐럿 앞 한 줄은 소스를 그대로 되비춘 것이라 편집기에 다시 보여 줄 이유가 없다.
    const caretAt = current.body.findIndex(line => /^\s*\^\s*$/.test(line));
    if (caretAt >= 0){
      current.column = current.body[caretAt].indexOf("^");
      current.hint = current.body.slice(caretAt + 1).map(line => line.trim()).filter(Boolean).join(" · ");
    }
    items.push({ line:current.line, column:current.column, severity:current.severity,
      message:current.message, hint:current.hint.slice(0, 300),
      file:current.file, own:!own || current.file === own });
    current = null;
  };
  for (const raw of text.split(/\r?\n/)){
    const head = JAVAC_DIAG_HEAD_RE.exec(raw);
    if (head){
      flush();
      const word = head[3];
      current = { file:head[1] + ".java", line:Number(head[2]) || 1, column:0, hint:"", body:[],
        severity:JAVAC_SEVERITY[word.toLowerCase()] || JAVAC_SEVERITY[word] || "error",
        message:head[4].trim() };
      continue;
    }
    if (!current) continue;
    if (JAVAC_SUMMARY_RE.test(raw.trim())){ flush(); continue; }
    current.body.push(raw);
  }
  flush();
  // 지금 편집 중인 파일을 먼저, 형제 파일은 그 뒤로. javac 는 참조를 따라가며 섞어 뱉는다.
  return items.filter(item => item.message).slice(0, 100).sort((a, b) =>
    (a.own === b.own ? 0 : a.own ? -1 : 1)
    || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
    || a.line - b.line || a.column - b.column);
}

/* ── 자동완성: 자바 표준 라이브러리 ────────────────────────────────────────
   키워드(core.js JAVA_COMPLETION_WORDS)만으로는 수업에서 쓰는 이름이 거의 안 나온다.
   여기서는 두 가지를 더한다.
     · 클래스 이름 목록(JAVA_TYPE_WORDS) — List·Scanner 처럼 첫 글자만 쳐도 나오게
     · 점 뒤 멤버(javaMemberCompletionCandidates) — sc.nextInt(), list.add() …
   자바는 변수를 선언할 때 타입을 적으므로, 자바스크립트처럼 값을 거슬러 추론할 필요 없이
   선언문 한 줄만 찾으면 된다(javaDeclaredType). 그래서 후보가 헛나올 일이 적다. */

/* 편집기 단어 후보에 얹는 표준 클래스 이름 — import 없이 바로 쓰는 java.lang 것들이다.
   java.util.List 처럼 import 가 필요한 이름은 여기 넣지 않는다. 그쪽은 import 를 함께 넣어 주는
   후보(javaImportCandidates)로 나오며, 두 곳에 다 있으면 목록에 같은 이름이 두 줄로 뜬다. */
const JAVA_TYPE_WORDS = (
  "String System Math Object Integer Double Long Float Short Byte Boolean Character Number " +
  "StringBuilder StringBuffer Exception RuntimeException IllegalArgumentException Thread Runnable Comparable Iterable " +
  "args main println print printf length size"
).split(/\s+/);

/* 멤버 목록을 짧게 적기 위한 도구.
   "이름(인자)" 로 적으면 메서드(수락하면 괄호가 붙는다), 이름만 적으면 필드다.
   적은 순서를 지킨다 — println 처럼 압도적으로 많이 쓰는 것이 맨 위에 와야 한다. */
function javaMembers(spec){
  const items = [];
  for (const raw of String(spec || "").split("|")){
    const token = raw.trim();
    if (!token) continue;
    const at = token.indexOf("(");
    if (at < 0){ items.push({ name:token, type:"property", signature:"" }); continue; }
    items.push({ name:token.slice(0, at), type:"function", signature:token });
  }
  return items;
}

// 클래스 이름으로 바로 부르는 것(정적 멤버·상수). System.out, Math.abs …
const JAVA_STATIC_MEMBERS = {
  System: javaMembers("out|err|in|currentTimeMillis()|nanoTime()|exit(status)|lineSeparator()|getProperty(key)"),
  Math: javaMembers("abs(x)|max(a, b)|min(a, b)|pow(a, b)|sqrt(x)|round(x)|floor(x)|ceil(x)|random()|PI|E"),
  Integer: javaMembers("parseInt(s)|valueOf(s)|toString(i)|toBinaryString(i)|compare(a, b)|MAX_VALUE|MIN_VALUE"),
  Double: javaMembers("parseDouble(s)|valueOf(s)|compare(a, b)|MAX_VALUE|MIN_VALUE"),
  Long: javaMembers("parseLong(s)|valueOf(s)|MAX_VALUE|MIN_VALUE"),
  Boolean: javaMembers("parseBoolean(s)|valueOf(s)|TRUE|FALSE"),
  Character: javaMembers("isDigit(c)|isLetter(c)|isLetterOrDigit(c)|isWhitespace(c)|isUpperCase(c)|isLowerCase(c)|toUpperCase(c)|toLowerCase(c)"),
  String: javaMembers("valueOf(value)|format(format, args)|join(sep, elements)"),
  Arrays: javaMembers("toString(a)|sort(a)|asList(a)|fill(a, value)|copyOf(a, length)|equals(a, b)|deepToString(a)|stream(a)|binarySearch(a, key)"),
  Collections: javaMembers("sort(list)|reverse(list)|shuffle(list)|max(coll)|min(coll)|swap(list, i, j)|emptyList()|unmodifiableList(list)"),
  Objects: javaMembers("equals(a, b)|hash(values)|toString(o)|requireNonNull(o)|isNull(o)|nonNull(o)"),
  List: javaMembers("of(elements)|copyOf(coll)"),
  Set: javaMembers("of(elements)|copyOf(coll)"),
  Map: javaMembers("of(k, v)|entry(k, v)|copyOf(map)"),
  Thread: javaMembers("sleep(millis)|currentThread()"),
  Optional: javaMembers("of(value)|ofNullable(value)|empty()"),
  LocalDate: javaMembers("now()|of(year, month, day)|parse(text)"),
  LocalDateTime: javaMembers("now()|parse(text)")
};

// 변수 뒤에 오는 것(인스턴스 멤버). 타입 갈래 → 멤버 목록.
const JAVA_INSTANCE_MEMBERS = {
  string: javaMembers("length()|charAt(index)|substring(begin, end)|indexOf(str)|lastIndexOf(str)|contains(s)|equals(other)|equalsIgnoreCase(other)"
    + "|compareTo(other)|toUpperCase()|toLowerCase()|trim()|strip()|split(regex)|replace(target, replacement)|replaceAll(regex, replacement)"
    + "|startsWith(prefix)|endsWith(suffix)|isEmpty()|isBlank()|toCharArray()|repeat(count)|concat(str)|matches(regex)"),
  list: javaMembers("add(item)|get(index)|set(index, item)|remove(index)|size()|isEmpty()|contains(item)|indexOf(item)|clear()"
    + "|addAll(coll)|sort(comparator)|forEach(action)|stream()|iterator()|toArray()|subList(from, to)"),
  map: javaMembers("put(key, value)|get(key)|getOrDefault(key, other)|containsKey(key)|containsValue(value)|remove(key)|size()|isEmpty()"
    + "|keySet()|values()|entrySet()|clear()|putIfAbsent(key, value)|forEach(action)|merge(key, value, fn)|computeIfAbsent(key, fn)"),
  set: javaMembers("add(item)|remove(item)|contains(item)|size()|isEmpty()|clear()|addAll(coll)|forEach(action)|stream()|iterator()"),
  scanner: javaMembers("nextInt()|nextLine()|next()|nextDouble()|nextLong()|nextBoolean()|hasNext()|hasNextInt()|hasNextLine()|close()"),
  builder: javaMembers("append(value)|toString()|length()|insert(offset, value)|delete(start, end)|deleteCharAt(index)|reverse()|charAt(index)|setCharAt(index, ch)|indexOf(str)"),
  printStream: javaMembers("println(value)|print(value)|printf(format, args)|format(format, args)|flush()"),
  random: javaMembers("nextInt(bound)|nextDouble()|nextBoolean()|nextLong()"),
  optional: javaMembers("get()|isPresent()|isEmpty()|orElse(other)|orElseGet(supplier)|ifPresent(action)|map(fn)|filter(predicate)"),
  iterator: javaMembers("hasNext()|next()|remove()"),
  // 배열은 메서드가 없고 길이 '필드' 하나뿐이다 — 이것만 알려 줘도 length() 오타가 줄어든다.
  array: javaMembers("length")
};

/* 고른 라이브러리의 멤버. 클래스 이름은 런처 카탈로그(JavaLibrary.Words)가 알려 주지만
   그 안에 무엇이 있는지는 알려 주지 않아, 이름만 나오고 점을 찍으면 아무것도 안 나왔다.
   기본 목록 다섯 개는 수업에서 쓰는 범위가 좁아 여기에 적어 둔다(자바스크립트 쪽 JS_LIBRARY_MEMBERS 와 같은 방식).
   직접 좌표로 받은 라이브러리는 알 길이 없으므로 클래스 이름만 제안한다 — 없는 메서드를 권하느니 비우는 쪽이다. */
const JAVA_LIBRARY_MEMBERS = {
  // Gson
  Gson: javaMembers("toJson(src)|fromJson(json, type)|toJsonTree(src)|newBuilder()"),
  GsonBuilder: javaMembers("setPrettyPrinting()|serializeNulls()|disableHtmlEscaping()|setDateFormat(pattern)|create()"),
  JsonObject: javaMembers("get(name)|addProperty(name, value)|add(name, element)|has(name)|remove(name)|keySet()|entrySet()"
    + "|getAsString()|getAsInt()|getAsJsonObject(name)|getAsJsonArray(name)"),
  JsonArray: javaMembers("get(index)|add(value)|size()|remove(index)|isEmpty()"),
  JsonElement: javaMembers("getAsString()|getAsInt()|getAsDouble()|getAsBoolean()|getAsJsonObject()|getAsJsonArray()|isJsonNull()"),
  JsonParser: javaMembers("parseString(json)|parseReader(reader)"),
  // Apache Commons Lang
  StringUtils: javaMembers("isEmpty(cs)|isNotEmpty(cs)|isBlank(cs)|isNotBlank(cs)|trim(str)|strip(str)|capitalize(str)|uncapitalize(str)"
    + "|join(array, separator)|split(str, separator)|substringBefore(str, separator)|substringAfter(str, separator)|repeat(str, count)"
    + "|reverse(str)|leftPad(str, size, pad)|rightPad(str, size, pad)|equalsIgnoreCase(a, b)|contains(seq, search)|countMatches(str, sub)"
    + "|defaultIfEmpty(str, other)"),
  NumberUtils: javaMembers("toInt(str)|toDouble(str)|toLong(str)|isDigits(str)|isCreatable(str)|max(array)|min(array)"),
  ArrayUtils: javaMembers("toString(array)|contains(array, value)|indexOf(array, value)|isEmpty(array)|add(array, element)|reverse(array)|subarray(array, start, end)"),
  RandomStringUtils: javaMembers("randomAlphabetic(count)|randomNumeric(count)|randomAlphanumeric(count)|random(count)"),
  // Apache Commons CSV
  CSVFormat: javaMembers("DEFAULT|EXCEL|RFC4180|TDF|parse(reader)|print(out)|withFirstRecordAsHeader()|withHeader(headers)|withDelimiter(delimiter)"),
  CSVParser: javaMembers("getRecords()|iterator()|getHeaderMap()|getHeaderNames()|close()"),
  CSVPrinter: javaMembers("printRecord(values)|printRecords(values)|flush()|close()"),
  CSVRecord: javaMembers("get(name)|size()|isSet(name)|toMap()|getRecordNumber()"),
  // jsoup
  Jsoup: javaMembers("connect(url)|parse(html)|clean(html, safelist)"),
  Document: javaMembers("title()|body()|select(query)|getElementById(id)|getElementsByClass(name)|text()|html()|outerHtml()"),
  Element: javaMembers("text()|html()|attr(key)|select(query)|children()|parent()|id()|className()|tagName()|ownText()|append(html)"),
  Elements: javaMembers("first()|last()|get(index)|size()|text()|attr(key)|select(query)|eachText()|isEmpty()"),
  // JUnit 5
  Assertions: javaMembers("assertEquals(expected, actual)|assertTrue(condition)|assertFalse(condition)|assertNull(actual)|assertNotNull(actual)"
    + "|assertArrayEquals(expected, actual)|assertThrows(type, executable)|fail(message)")
};

// 타입 이름 → 어떤 멤버 목록을 쓸지.
const JAVA_TYPE_MEMBER_KEY = (() => {
  const map = {};
  const put = (key, names) => { for (const name of names.split(/\s+/)) map[name] = key; };
  put("string", "String CharSequence");
  put("list", "List ArrayList LinkedList Collection Queue Deque ArrayDeque Stack Vector");
  put("map", "Map HashMap TreeMap LinkedHashMap Hashtable");
  put("set", "Set HashSet TreeSet LinkedHashSet");
  put("scanner", "Scanner");
  put("builder", "StringBuilder StringBuffer");
  put("printStream", "PrintStream PrintWriter");
  put("random", "Random");
  put("optional", "Optional");
  put("iterator", "Iterator ListIterator");
  return map;
})();

// 선언문 앞자리에 올 수 있지만 타입이 아닌 낱말 — 이것들이 잡히면 엉뚱한 후보가 나온다.
const JAVA_NOT_A_TYPE = ["return", "new", "case", "else", "throw", "yield", "assert"];

/* 변수가 어떤 타입으로 선언됐는지 찾는다(마지막 선언이 최신).
   맞히려는 모양: "Type name =", "Type name;", "Type name)", "Type name,", "for (Type name :"
   제네릭(<...>)은 건너뛰고 바탕 타입만, 배열([])이면 isArray 로 알린다. */
function javaDeclaredType(source, name){
  if (!/^[A-Za-z_$][\w$]*$/.test(String(name || ""))) return null;
  const text = String(source || "");
  const pattern = new RegExp(
    "(?:^|[\\n;{}(,])\\s*(?:final\\s+)?([A-Za-z_$][\\w$.]*)\\s*(?:<[^<>;{}=]*>)?\\s*((?:\\[\\s*\\]\\s*)*)"
    + name + "\\s*(?==[^=]|;|\\)|,|:)", "g");
  let found = null, match;
  while ((match = pattern.exec(text))){
    const qualified = String(match[1]);
    const type = qualified.split(".").pop();
    if (JAVA_NOT_A_TYPE.indexOf(type) >= 0) continue;
    found = { type, qualified, isArray: !!String(match[2] || "").trim() };
  }
  if (!found) return null;
  // var 는 오른쪽을 봐야 안다 — new Xxx() 와 문자열 리터럴만 짚는다(그 외는 후보를 내지 않는다).
  if (found.type === "var"){
    const tail = new RegExp("\\bvar\\s+" + name + "\\s*=\\s*([^;\\n]*)", "g");
    let last = null, hit;
    while ((hit = tail.exec(text))) last = hit[1];
    if (!last) return null;
    const created = /^\s*new\s+([A-Za-z_$][\w$.]*)/.exec(last);
    if (created) return { type:String(created[1]).split(".").pop(), qualified:String(created[1]), isArray:false };
    if (/^\s*"/.test(last)) return { type:"String", qualified:"String", isArray:false };
    return null;
  }
  return found;
}

/* javap 표에서 지금 코드가 뜻하는 클래스 하나를 고른다.
   서버는 패키지 전체 이름을 키로 보낸다. 명시 import → 현재 package → wildcard import →
   유일한 단순 이름 순서로 좁히며, 같은 단순 이름이 둘 이상인데 근거가 없으면 아무것도 권하지 않는다. */
function javaExtractedMemberSpec(source, declared, typeName, extracted){
  if (!extracted || typeof extracted !== "object") return "";
  const text = String(source || "");
  const simple = String(typeName || "");
  const keys = Object.keys(extracted).filter((key) => typeof extracted[key] === "string"
    && (key === simple || key.endsWith("." + simple)));
  if (!keys.length) return "";
  const qualified = declared && String(declared.qualified || "");
  if (qualified && typeof extracted[qualified] === "string") return extracted[qualified];

  const imports = [];
  const importRe = /^\s*import\s+(?!static\b)([\w.$*]+)\s*;/gm;
  let match;
  while ((match = importRe.exec(text))) imports.push(match[1]);
  for (const path of imports){
    if (!path.endsWith(".*") && path.endsWith("." + simple) && typeof extracted[path] === "string") return extracted[path];
  }

  const packageMatch = /^\s*package\s+([\w.$]+)\s*;/m.exec(text);
  if (packageMatch){
    const local = packageMatch[1] + "." + simple;
    if (typeof extracted[local] === "string") return extracted[local];
  }
  for (const path of imports){
    if (!path.endsWith(".*")) continue;
    const wanted = path.slice(0, -1) + simple;
    if (typeof extracted[wanted] === "string") return extracted[wanted];
  }

  // 이전 캐시 형식과 기본 패키지 클래스는 단순 이름 키 하나로 올 수 있다.
  if (typeof extracted[simple] === "string") return extracted[simple];
  return keys.length === 1 ? extracted[keys[0]] : "";
}

// v2 표의 S:/I: 표식을 보고 클래스 접근에는 static, 변수 접근에는 instance 멤버만 남긴다.
// 표식 없는 값은 이전 캐시와의 호환을 위해 양쪽에서 쓴다.
function javaExtractedMembers(spec, staticReceiver){
  const kept = [];
  for (const raw of String(spec || "").trim().split(/\s+/)){
    if (!raw) continue;
    const marked = /^([SI]):(.+)$/.exec(raw);
    if (!marked){ kept.push(raw); continue; }
    if ((staticReceiver && marked[1] === "S") || (!staticReceiver && marked[1] === "I")) kept.push(marked[2]);
  }
  return javaMembers(kept.join("|"));
}

/* 편집기가 'name.' 뒤에서 부른다. 후보가 없으면 빈 배열 — 그러면 버퍼 단어 완성으로 넘어간다.
   선언한 타입을 먼저 보고(같은 이름의 변수가 있으면 그것이 맞다), 없으면 클래스 이름으로 본다. */
function javaMemberCompletionCandidates(source, receiver, prefix, libraries){
  const name = String(receiver || "");
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const query = String(prefix || "");
  let items = null;
  const declared = javaDeclaredType(source, name);
  if (declared){
    items = declared.isArray
      ? JAVA_INSTANCE_MEMBERS.array
      : (JAVA_INSTANCE_MEMBERS[JAVA_TYPE_MEMBER_KEY[declared.type]] || null);
  }
  /* 고른 라이브러리의 클래스 — Gson gson = new Gson() 처럼 변수로 쓰기도 하고(선언 타입),
     Jsoup.connect() 처럼 클래스 이름으로 바로 쓰기도 한다(받는 이름 그대로). 둘 다 본다.
     libraries.words 는 손으로 적어 둔 기본 목록에서 온 이름, libraries.members 는 서버가 jar 에서
     javap 로 뽑아 온 표다. 적어 둔 쪽이 인자 안내까지 있어 먼저다.
     고르지 않은 라이브러리는 어느 쪽에도 들어오지 않는다 — 컴파일되지 않을 코드를 권하지 않기 위해서다. */
  if (!items && libraries){
    const allowed = Array.isArray(libraries.words) ? libraries.words : [];
    const extracted = libraries.members && typeof libraries.members === "object" ? libraries.members : null;
    const typeName = declared ? declared.type : name;
    if (allowed.indexOf(typeName) >= 0) items = JAVA_LIBRARY_MEMBERS[typeName] || null;
    if (!items && extracted){
      const spec = javaExtractedMemberSpec(source, declared, typeName, extracted);
      if (spec) items = javaExtractedMembers(spec, !declared);
    }
  }
  // System.out / System.err — 편집기는 점 바로 앞 낱말만 주므로 'out' 을 그대로 알아본다.
  if (!items && (name === "out" || name === "err")) items = JAVA_INSTANCE_MEMBERS.printStream;
  if (!items) items = JAVA_STATIC_MEMBERS[name] || null;
  if (!items || !items.length) return [];
  return items
    // 이미 다 친 이름은 뺀다. 단 메서드는 남겨 수락하면 "()" 가 붙는 편의를 유지한다.
    .filter((item) => (item.name !== query || item.type === "function") && (!query || item.name.startsWith(query)))
    .map((item) => ({ ...item }));
}

/* ── 자동완성으로 import 까지 ───────────────────────────────────────────────
   List 를 고르면 java.util.List 를 위에 적어 주는 자리. 자바 수업에서 첫 벽이 "import 를 안 적어서"
   나는 오류라, 이름을 아는 김에 import 도 같이 넣는다.
   파이썬 쪽에 이미 같은 장치가 있고(core.js completionApplicationPlan) 넣을 자리를 정하는 규칙만
   언어마다 다르므로, 자바 규칙을 여기서 주고 그 장치를 그대로 빌려 쓴다. */

// 이름 → 패키지. java.lang(String·System·Math…)은 import 가 필요 없어 넣지 않는다.
const JAVA_IMPORT_PACKAGES = {
  "java.util": "List ArrayList LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet LinkedHashSet"
    + " Collection Collections Arrays Objects Queue Deque ArrayDeque Stack Vector Iterator Comparator Optional Random Scanner",
  "java.util.stream": "Stream IntStream Collectors",
  "java.util.function": "Function Supplier Consumer Predicate BiFunction",
  "java.time": "LocalDate LocalDateTime LocalTime Duration Period",
  "java.time.format": "DateTimeFormatter",
  "java.math": "BigDecimal BigInteger",
  "java.text": "SimpleDateFormat DecimalFormat",
  "java.io": "IOException File FileReader FileWriter BufferedReader BufferedWriter InputStreamReader PrintWriter",
  "java.nio.file": "Files Paths Path",
  "java.util.regex": "Pattern Matcher",
  // 기본 라이브러리 다섯 개 — 고른 것만 제안한다(아래 javaImportCandidates 의 allowed 검사).
  "com.google.gson": "Gson GsonBuilder JsonObject JsonArray JsonElement JsonParser",
  "org.apache.commons.lang3": "StringUtils ArrayUtils RandomStringUtils",
  "org.apache.commons.lang3.math": "NumberUtils",
  "org.apache.commons.csv": "CSVFormat CSVParser CSVPrinter CSVRecord",
  "org.jsoup": "Jsoup",
  "org.jsoup.nodes": "Document Element",
  "org.jsoup.select": "Elements",
  "org.junit.jupiter.api": "Assertions Test BeforeEach DisplayName"
};

// 클래스 이름 → "import 패키지.이름;" 한 줄. 라이브러리에서 온 이름은 고른 뒤에만 쓴다.
const JAVA_IMPORTS = (() => {
  const map = {};
  for (const pkg of Object.keys(JAVA_IMPORT_PACKAGES)){
    const fromLibrary = pkg.indexOf("java.") !== 0;
    for (const name of JAVA_IMPORT_PACKAGES[pkg].split(/\s+/)){
      if (!name || map[name]) continue;     // 먼저 적은 쪽이 이긴다(표준 라이브러리를 위에 적어 둔 이유)
      map[name] = { text:"import " + pkg + "." + name + ";", library:fromLibrary };
    }
  }
  return map;
})();

// 이미 적혀 있는 import 인가. 같은 줄이 있거나, 그 패키지를 * 로 받아 왔으면 다시 적지 않는다.
function javaImportPath(line){
  const text = String(line || "").replace(/\/\/.*$/, "").trim().replace(/\s+/g, " ");
  // "import  java.util.List ;" 처럼 띄어쓰기가 제각각이어도 같은 것으로 본다.
  const match = /^import (static )?([\w.$*]+) ?;$/.exec(text);
  return match ? (match[1] ? "static " : "") + match[2] : null;
}
function javaHasImport(source, importText){
  const target = javaImportPath(importText);
  if (!target) return true;                       // 알아볼 수 없는 모양이면 건드리지 않는다
  for (const raw of String(source || "").split("\n")){
    const line = javaImportPath(raw);
    if (!line) continue;
    if (line === target) return true;
    if (!line.endsWith(".*")) continue;
    // java.util.* 는 java.util.List 를 덮지만 java.util.stream.Stream 은 덮지 않는다(한 칸만).
    const pkg = line.slice(0, -2);
    if (target.indexOf(pkg + ".") === 0 && target.lastIndexOf(".") === pkg.length) return true;
  }
  return false;
}

/* 직접 받은 jar 목록과 javap 표가 가진 패키지 전체 클래스 이름을 import 후보로 바꾼다.
   따라서 손으로 적어 둔 JAVA_IMPORTS 에 없는 클래스도
   선택 시 import 문까지 함께 들어가게 한다. 같은 단순 이름이 여러 패키지에 있으면
   후보를 모두 보여 주고 import 문으로 구분한다 — 근거 없이 하나를 고르는 것보다 안전하다. */
function javaJarImportCandidates(source, prefix, classes, extracted){
  const qualifiedNames = [];
  for (const qualified of Array.isArray(classes) ? classes : []){
    if (typeof qualified === "string" && qualifiedNames.indexOf(qualified) < 0) qualifiedNames.push(qualified);
  }
  if (extracted && typeof extracted === "object"){
    for (const qualified of Object.keys(extracted)){
      if (typeof extracted[qualified] === "string" && qualifiedNames.indexOf(qualified) < 0) qualifiedNames.push(qualified);
    }
  }
  if (!qualifiedNames.length) return [];
  const text = String(source || "");
  const query = String(prefix || "");
  const packageMatch = /^\s*package\s+([\w.$]+)\s*;/m.exec(text);
  const currentPackage = packageMatch ? packageMatch[1] : "";
  const rows = [];
  for (const qualified of qualifiedNames){
    if (qualified.indexOf(".") < 0) continue;
    const parts = qualified.split(".");
    if (!parts.every((part) => /^[A-Za-z_$][\w$]*$/.test(part))) continue;
    const name = parts[parts.length - 1];
    if (!name.startsWith(query)) continue;
    const pkg = parts.slice(0, -1).join(".");
    if (pkg === currentPackage) continue;
    const importText = "import " + qualified + ";";
    if (javaHasImport(text, importText)) continue;
    rows.push({ name, type:"class", importText });
  }
  return rows;
}

/* 새 import 를 넣을 자리(문자 위치).
   이미 import 가 있으면 마지막 import 다음 줄, 없으면 package 선언 다음(빈 줄 한 줄을 띄워),
   둘 다 없으면 맨 위 주석 묶음 다음이다. 클래스 선언 아래로는 절대 내려가지 않는다. */
function javaImportInsertOffset(source){
  const text = String(source || "");
  const lines = text.split("\n");
  const offsetOfLine = (index) => {
    let at = 0;
    for (let i = 0; i < index && i < lines.length; i++) at += lines[i].length + 1;
    return Math.min(at, text.length);
  };
  let lastImport = -1, packageLine = -1, firstCode = -1, inBlockComment = false;
  for (let i = 0; i < lines.length; i++){
    let line = lines[i].trim();
    if (inBlockComment){
      if (line.indexOf("*/") >= 0){ inBlockComment = false; line = line.slice(line.indexOf("*/") + 2).trim(); }
      else continue;
    }
    if (line.indexOf("/*") >= 0 && line.indexOf("*/") < 0){ inBlockComment = true; continue; }
    if (!line || line.indexOf("//") === 0) continue;
    if (/^package\b/.test(line)){ packageLine = i; continue; }
    if (/^import\b/.test(line)){ lastImport = i; continue; }
    if (firstCode < 0) firstCode = i;
  }
  if (lastImport >= 0) return offsetOfLine(lastImport + 1);
  if (packageLine >= 0) return offsetOfLine(packageLine + 1);
  if (firstCode >= 0) return offsetOfLine(firstCode);
  return text.length;
}

// 파이썬 자리에 끼워 쓰는 규칙 묶음(core.js completionApplicationPlan 이 받는 모양).
const JAVA_IMPORT_PLANNER = {
  has: javaHasImport,
  offset: javaImportInsertOffset,
  // import 줄을 치는 중이면 본문만 채운다(파이썬은 from/import, 자바는 import 뿐이다).
  linePrefix: /^\s*import\b/
};

/* 지금 친 글자로 시작하는 클래스 중 아직 import 하지 않은 것.
   이미 적어 둔 것은 뺀다 — 그때부터는 버퍼에 이름이 있어 평범한 단어 완성으로 나온다.
   라이브러리 클래스는 그 라이브러리를 골랐을 때만(allowed) 낸다. */
function javaImportCandidates(source, prefix, libraries){
  const query = String(prefix || "");
  if (!query) return [];
  const allowed = libraries && Array.isArray(libraries.words) ? libraries.words : [];
  const text = String(source || "");
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    const key = row.name + "\n" + row.importText;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  for (const name of Object.keys(JAVA_IMPORTS)){
    if (!name.startsWith(query)) continue;
    const entry = JAVA_IMPORTS[name];
    if (entry.library && allowed.indexOf(name) < 0) continue;
    if (javaHasImport(text, entry.text)) continue;
    add({ name, type:"class", importText:entry.text });
  }
  const classes = libraries && Array.isArray(libraries.classes) ? libraries.classes : [];
  const extracted = libraries && libraries.members && typeof libraries.members === "object"
    ? libraries.members : null;
  for (const row of javaJarImportCandidates(text, query, classes, extracted)) add(row);
  rows.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)
    || a.importText.localeCompare(b.importText));
  return rows;
}

// ── 세션 호출 ──────────────────────────────────────────────────────────────
/* 실행 봉투([길이][소스][길이][표준입력]) 뒤에 같은 폴더의 형제 .java 본문을 [개수]([길이][소스])* 로 잇는다.
   경로는 보내지 않는다 — 어디에 둘지는 소스가 스스로 적은 package·public 클래스로 런처가 정한다.
   형제가 없으면 바이트가 예전과 완전히 같다(옛 런처와 섞여도 실행이 깨지지 않는다). */
function buildJavaRunPayload(source, stdinText, extras){
  const base = buildRunPayload(String(source == null ? "" : source), stdinText || "");
  const rows = (Array.isArray(extras) ? extras : []).filter(text => typeof text === "string" && text.trim());
  if (!rows.length) return base;
  const enc = new TextEncoder();
  const bodies = rows.map(text => enc.encode(text));
  let size = base.length + 4;
  for (const body of bodies) size += 4 + body.length;
  const out = new Uint8Array(size), view = new DataView(out.buffer);
  out.set(base, 0);
  let at = base.length;
  view.setUint32(at, bodies.length, true); at += 4;
  for (const body of bodies){
    view.setUint32(at, body.length, true); at += 4;
    out.set(body, at); at += body.length;
  }
  return out;
}

async function startJavaSession(source, stdinText, piped, libs, extras){
  // 페이로드 봉투는 파이썬 실행과 같은 것을 쓴다([길이][소스][길이][표준입력]) + 형제 .java.
  const body = buildJavaRunPayload(source, stdinText, extras);
  // 라이브러리는 '이름'만 보낸다 — 어느 jar 를 어디서 찾을지는 런처가 자기 카탈로그로 정한다.
  const query = [];
  if (piped) query.push("piped=1");
  if (libs) query.push("libs=" + encodeURIComponent(String(libs)));
  const res = await fetch("/java-session-start" + (query.length ? "?" + query.join("&") : ""), {
    method:"POST", headers:{ "Content-Type":"application/octet-stream" }, body
  });
  if (!res.ok){
    const text = (await res.text()) || ("HTTP " + res.status);
    const error = new Error(text);
    if (text.indexOf("no-java") >= 0) error.noJava = true;
    throw error;
  }
  return (await res.json()).id;
}

async function stopJavaSession(id){
  try { await fetch("/java-session-stop?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
}

/* 완료까지 증분 폴링. so/se 는 이미 받은 출력 길이 — 그대로면 서버가 "unchanged" 로 짧게 답하고,
   자랐으면 그 뒤 새 내용만 보낸다(누적 출력을 매 폴마다 새로 만들지 않기 위한 계약). */
async function pollJavaSessionToEnd(id, options){
  options = options || {};
  const started = Date.now();
  const limit = options.timeoutMs || JAVA_GRADE_TIMEOUT_MS;
  let out = "", err = "", so = -1, se = -1, mainClass = "";
  for (;;){
    const res = await fetch("/java-session-poll?id=" + encodeURIComponent(id) + "&so=" + so + "&se=" + se, { cache:"no-store" });
    if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
    const data = await res.json();
    if (!data.unchanged){
      if (typeof data.stdoutDelta === "string" || typeof data.stderrDelta === "string"){
        out += data.stdoutDelta || "";
        err += data.stderrDelta || "";
      } else {
        out = data.stdout || "";
        err = data.stderr || "";
      }
      so = out.length; se = err.length;
      if (data.mainClass) mainClass = data.mainClass;
      if (data.complete) return { stdout:out, stderr:err, code:data.code, mainClass };
    }
    if (typeof options.isCancelled === "function" && options.isCancelled()){
      return { stdout:out, stderr:err, code:-1, cancelled:true, mainClass };
    }
    if (Date.now() - started > limit) return { stdout:out, stderr:err, code:-1, timedOut:true, mainClass };
    await new Promise(resolve => setTimeout(resolve, JAVA_POLL_INTERVAL_MS));
  }
}

// 채점용 1회 실행 — 입력을 파이프로 한 번에 넣고(에코 없음) 끝까지 기다린다.
async function runJavaHeadless(source, stdinText, options){
  options = options || {};
  const id = await startJavaSession(source, stdinText, true, options.libs, options.extras);
  try { return await pollJavaSessionToEnd(id, options); }
  finally { await stopJavaSession(id); }
}

// ── JDK 가 없을 때의 안내와 원클릭 설치 ─────────────────────────────────────
const JAVA_INSTALL_MAX_POLLS = 2250;      // 800ms × 2250 = 최대 30분(느린 교실 인터넷 여유)
const JAVA_INSTALL_POLL_MS = 800;
// 안내 문구에만 쓴다. 실제로 받는 판은 런처의 JdkFeatureVersion 이 정하므로 둘을 함께 고쳐야 한다.
const JAVA_INSTALL_FEATURE_VERSION = 21;

// 설치 진행 상태를 사람이 읽는 한 줄로. 200MB 를 받는 동안 화면이 멈춘 것처럼 보이면 안 된다.
function javaInstallProgressText(info){
  const mb = (bytes) => Math.round(Number(bytes || 0) / 1048576);
  if (info.state === "metadata") return javaT("설치할 자바를 확인하는 중…");
  if (info.state === "downloading"){
    return info.total > 0
      ? javaTf("자바 내려받는 중… {received} / {total} MB", { received:mb(info.received), total:mb(info.total) })
      : javaT("자바 내려받는 중…");
  }
  if (info.state === "verifying") return javaT("받은 파일 확인 중…");
  if (info.state === "extracting"){
    return info.entries > 0
      ? javaTf("설치 중… {percent}%", { percent:Math.round((Number(info.extracted) / Number(info.entries)) * 100) })
      : javaT("설치 중…");
  }
  return javaT("설치 준비 중…");
}

/* 한 문장으로 끝내면 "그래서 뭘 하라는 거냐"에서 막힌다. 자동 설치와 '다시 검사'를 함께 둔다
   (DB 접속 화면의 파이썬 안내와 같은 구성 — 런처가 '못 찾았다'는 사실까지 캐시하므로
   직접 설치한 뒤에는 '다시 검사'로 캐시를 비워 줘야 exe 를 껐다 켜지 않고 이어갈 수 있다). */
function renderJavaInstallGuide(outPanel, onReady){
  let disposed = false;
  outPanel.innerHTML = "";
  const wrap = document.createElement("section");
  wrap.className = "java-install-help";

  const title = document.createElement("strong");
  title.textContent = "이 컴퓨터에서 자바(JDK)를 찾지 못했습니다";
  const intro = document.createElement("p");
  intro.textContent = "자바 실행에는 PC에 설치된 JDK가 필요합니다. 아래 버튼을 누르면 이 컴퓨터에 한 번만 자동으로 설치합니다.";
  wrap.append(title, intro);

  const steps = document.createElement("ol");
  steps.className = "java-help-steps";
  [
    "'자바 자동 설치'를 누르면 Eclipse Adoptium 공식 배포처에서 약 200MB를 내려받습니다(컴퓨터당 1회, 관리자 권한 불필요).",
    "받은 파일은 배포처가 알려준 검증값과 대조한 뒤 설치하고, 끝나면 하던 실행을 이어갑니다.",
    "이미 JDK를 직접 설치했다면 '다시 검사'만 누르면 됩니다. JRE만 있으면 동작하지 않습니다."
  ].forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    steps.appendChild(li);
  });
  wrap.appendChild(steps);

  const actions = document.createElement("div");
  actions.className = "java-help-actions";
  const install = document.createElement("button");
  install.type = "button"; install.className = "java-help-btn is-primary"; install.textContent = "자바 자동 설치";
  install.title = "Eclipse Adoptium 공식 배포처에서 JDK를 내려받아 자동으로 설치해요 (컴퓨터당 1회)";
  const rescan = document.createElement("button");
  rescan.type = "button"; rescan.className = "java-help-btn"; rescan.textContent = "다시 검사";
  rescan.title = "이미 직접 설치했다면 이것만 누르면 됩니다";
  const note = document.createElement("span");
  note.className = "java-help-note";
  actions.append(install, rescan, note);
  wrap.appendChild(actions);
  outPanel.appendChild(wrap);
  if (typeof window !== "undefined" && window.MNI18N && typeof window.MNI18N.translateTree === "function"){
    window.MNI18N.translateTree(wrap);
  }

  const succeed = (version) => {
    if (disposed) return;
    if (typeof resetJavaBackendProbe === "function") resetJavaBackendProbe();
    note.textContent = version
      ? javaTf("{version} · 준비됐습니다. 이어서 실행합니다…", { version })
      : javaT("준비됐습니다. 이어서 실행합니다…");
    // 찾았으면 한 번 더 누르게 하지 않는다 — 학생이 실행을 누른 그 흐름을 여기서 이어 준다.
    if (typeof onReady === "function") onReady();
  };

  rescan.addEventListener("click", async () => {
    if (disposed) return;
    rescan.disabled = true;
    rescan.textContent = javaT("검사 중…");
    note.textContent = "";
    let info = null;
    try {
      const res = await fetch("/java-rescan", { method:"POST", cache:"no-store" });
      if (res.ok) info = await res.json();
    } catch(_){}
    if (disposed) return;
    rescan.disabled = false;
    rescan.textContent = javaT("다시 검사");
    if (!info || !info.ok){
      if (typeof resetJavaBackendProbe === "function") resetJavaBackendProbe();
      note.textContent = javaT("아직 찾지 못했습니다. JDK(JRE 아님) 설치를 마쳤는지 확인해 주세요.");
      return;
    }
    succeed(info.version);
  });

  install.addEventListener("click", async () => {
    if (disposed) return;
    // 인터넷으로 200MB 를 받는 동작이라 누르기 전에 한 번 확인한다.
    if (typeof confirmDialog === "function"){
      const yes = await confirmDialog(
        javaTf("Eclipse Adoptium 공식 배포처에서 자바(JDK {version})를 약 200MB 내려받아 설치합니다.\n이 컴퓨터에서 한 번만 하면 되고, 관리자 권한은 필요하지 않습니다.",
          { version:JAVA_INSTALL_FEATURE_VERSION }),
        javaT("설치"), javaT("취소"));
      if (!yes) return;
    }
    install.disabled = true; rescan.disabled = true;
    note.textContent = javaT("설치 준비 중…");
    try {
      const start = await fetch("/java-install", { method:"POST" });
      if (!start.ok) throw new Error((await start.text()) || ("HTTP " + start.status));
      if ((await start.text()).trim() === "already"){ succeed(""); return; }
      for (let i = 0; i < JAVA_INSTALL_MAX_POLLS; i++){
        await new Promise(resolve => setTimeout(resolve, JAVA_INSTALL_POLL_MS));
        if (disposed) return;
        const res = await fetch("/java-install-status", { cache:"no-store" });
        if (!res.ok) continue;
        const info = await res.json();
        if (info.state === "done"){ succeed(info.version); return; }
        if (info.state === "error") throw new Error(info.error || javaT("설치에 실패했습니다."));
        note.textContent = javaInstallProgressText(info);
      }
      throw new Error(javaT("시간이 너무 오래 걸립니다 — 인터넷 상태를 확인해 주세요."));
    } catch(error){
      if (disposed) return;
      install.disabled = false; rescan.disabled = false;
      note.textContent = javaTf("자동 설치에 실패했어요 ({message}). 인터넷이 안 되는 컴퓨터라면 다른 곳에서 JDK를 받아 풀어 두고 '다시 검사'를 눌러도 됩니다.",
        { message:(error && error.message) || error });
    }
  });
  wrap.dispose = () => { disposed = true; };
  return wrap;
}

// ── 대화형 실행 화면 ───────────────────────────────────────────────────────
async function runJavaInteractive(source, ui, hooks){
  hooks = hooks || {};
  const { outPanel } = ui;
  const sessionId = await startJavaSession(source, "", false, hooks.libs, hooks.extras);
  if (typeof hooks.isCancelled === "function" && hooks.isCancelled()){
    await stopJavaSession(sessionId);
    return { code:-1, stdout:"", stderr:"", mainClass:"", cancelled:true, sessionId };
  }

  outPanel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head";
  const headLabel = document.createElement("span"); headLabel.textContent = "실행 결과 · 대화형 터미널";
  head.appendChild(headLabel);
  const pre = document.createElement("pre"); pre.className = "out-pre";
  const stdoutEl = document.createElement("span");
  const stderrEl = document.createElement("span");
  pre.append(stdoutEl, stderrEl);
  const row = document.createElement("div"); row.className = "terminal-input-row";
  const mark = document.createElement("span"); mark.className = "terminal-mark"; mark.textContent = "›";
  const input = document.createElement("input"); input.className = "terminal-input"; input.type = "text";
  input.placeholder = "값을 입력하고 Enter"; input.autocomplete = "off"; input.spellcheck = false;
  const eof = document.createElement("button"); eof.className = "terminal-eof"; eof.type = "button"; eof.textContent = "입력 끝";
  eof.title = "표준입력을 닫습니다. hasNext() 로 끝까지 읽는 코드를 멈출 때 쓰세요";
  const stop = document.createElement("button"); stop.className = "terminal-stop"; stop.type = "button"; stop.textContent = "중지";
  const rerun = document.createElement("button"); rerun.className = "terminal-rerun"; rerun.type = "button";
  rerun.textContent = "↻ 재실행"; rerun.title = "이 코드를 다시 실행";
  row.append(mark, input, eof, stop, rerun);
  outPanel.append(head, pre, row);
  if (typeof window !== "undefined" && window.MNI18N && typeof window.MNI18N.translateTree === "function"){
    window.MNI18N.translateTree(outPanel);
  }

  let stopping = false;
  const finish = async () => {
    if (stopping) return;
    stopping = true; input.disabled = true; eof.disabled = true; stop.disabled = true;
    await stopJavaSession(sessionId);
  };
  if (typeof hooks.bindCancel === "function") hooks.bindCancel(finish);
  stop.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else finish();
  });
  eof.addEventListener("click", async () => {
    eof.disabled = true;
    try { await fetch("/java-session-eof?id=" + encodeURIComponent(sessionId), { method:"POST" }); } catch(_){}
  });
  // 재실행: 진행 중이면 먼저 멈추고, 현재 실행 정리가 끝나면 다시 실행(파이썬 터미널과 같은 동작)
  rerun.addEventListener("click", async () => {
    if (rerun.disabled) return;
    rerun.disabled = true;
    await finish();
    await new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!ui.running || Date.now() - started > 3000){ clearInterval(timer); resolve(); }
      }, 30);
    });
    if (typeof ui.rerun === "function") ui.rerun();
  });
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const value = input.value; input.value = ""; input.disabled = true;
    try {
      const res = await fetch("/java-session-input?id=" + encodeURIComponent(sessionId), {
        method:"POST", headers:{ "Content-Type":"text/plain; charset=utf-8" }, body:value
      });
      if (!res.ok) throw new Error(await res.text());
    } catch(err){
      if (typeof toast === "function") toast(javaTf("입력을 전달하지 못했어요: {message}", { message:(err && err.message) || err }), 3000);
    } finally {
      if (!stopping){ input.disabled = false; input.focus(); }
    }
  });
  // 입력을 읽는 코드는 바로 값을 칠 수 있게 터미널로, 아니면 편집을 이어가게 편집기로 포커스를 둔다.
  const needsInput = javaUsesInput(source);
  setTimeout(() => {
    if (ui.keepEditorFocus && ui.editorTa && !needsInput) ui.editorTa.focus();
    else input.focus();
  }, 0);

  // 표시 텍스트는 상한까지만 자른다. seg.src 는 조각이 원본 어디서 왔는지(음수면 생략 안내 문구) —
  // 입력 에코 구간만 다른 색으로 칠하려면 잘린 화면 조각의 원본 오프셋을 알아야 한다.
  const displaySegs = (text) => text.length > JAVA_FINAL_HEAD + JAVA_FINAL_TAIL + 200
    ? [{ text: text.slice(0, JAVA_FINAL_HEAD), src: 0 },
       { text: "\n\n" + javaTf("…(출력이 {length}자로 길어 중간을 생략했어요)…", { length:text.length.toLocaleString() }) + "\n\n", src: -1 },
       { text: text.slice(-JAVA_FINAL_TAIL), src: text.length - JAVA_FINAL_TAIL }]
    : [{ text, src: 0 }];
  const liveSegs = (text) => text.length > JAVA_LIVE_TAIL
    ? [{ text: javaT("…(출력이 길어 마지막 부분만 표시 중 — 전체는 실행이 끝나면 표시)") + "\n", src: -1 },
       { text: text.slice(-JAVA_LIVE_TAIL), src: text.length - JAVA_LIVE_TAIL }]
    : [{ text, src: 0 }];

  let shownOut = null, shownErr = null;
  let fullOut = "", fullErr = "";
  let knownOutLen = -1, knownErrLen = -1;
  let echoRanges = [];
  let mainClass = "";
  let result = { code: -1, stdout: "", stderr: "", mainClass: "" };
  try {
    for (;;){
      const res = await fetch("/java-session-poll?id=" + encodeURIComponent(sessionId)
        + "&so=" + knownOutLen + "&se=" + knownErrLen, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
      const data = await res.json();
      if (!data.unchanged){
        if (typeof data.stdoutDelta === "string" || typeof data.stderrDelta === "string"){
          fullOut += data.stdoutDelta || "";
          fullErr += data.stderrDelta || "";
        } else {
          fullOut = data.stdout || "";
          fullErr = data.stderr || "";
        }
        knownOutLen = fullOut.length;
        knownErrLen = fullErr.length;
        if (Array.isArray(data.echoes)) echoRanges = data.echoes;
        if (data.mainClass) mainClass = data.mainClass;
        const outSegs = (data.complete ? displaySegs : liveSegs)(fullOut);
        const nextOut = outSegs.map(seg => seg.text).join("");
        const shownStderr = cleanJavaStderr(fullErr);
        const errSegs = (data.complete ? displaySegs : liveSegs)(shownStderr);
        const nextErr = shownStderr ? ((fullOut ? "\n" : "") + errSegs.map(seg => seg.text).join("")) : "";
        if (nextOut !== shownOut || nextErr !== shownErr){
          // 사용자가 위로 스크롤해 둔 동안에는 자동 스크롤을 멈추고, 바닥 근처일 때만 따라 내려간다
          const nearBottom = outPanel.scrollHeight - outPanel.scrollTop - outPanel.clientHeight < 40;
          if (nextOut !== shownOut){
            shownOut = nextOut;
            if (typeof renderPythonStdoutSegs === "function") renderPythonStdoutSegs(stdoutEl, outSegs, echoRanges);
            else stdoutEl.textContent = nextOut;
          }
          if (nextErr !== shownErr){ shownErr = nextErr; stderrEl.textContent = nextErr; }
          // 자바는 stderr 에 경고를 흘리는 일이 드물다 — 내용이 있으면 오류로 보고 붉게 표시한다.
          stderrEl.className = shownStderr ? "out-err" : "";
          if (nearBottom) outPanel.scrollTop = outPanel.scrollHeight;
        }
        if (data.complete){
          result = { code: data.code, stdout: fullOut, stderr: fullErr, mainClass };
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, JAVA_POLL_INTERVAL_MS));
    }
  } finally {
    if (typeof hooks.bindCancel === "function") hooks.bindCancel(null);
    stopping = true;
    input.disabled = true; input.placeholder = javaT("실행 종료");
    eof.disabled = true; stop.disabled = true;
    await stopJavaSession(sessionId);
  }
  if (!result.stdout && !cleanJavaStderr(result.stderr)){
    pre.classList.add("out-muted");
    pre.textContent = javaT("(출력 없음)");
  }
  headLabel.textContent = javaTf("실행 결과 · 종료 코드 {code}", { code:result.code });
  result.sessionId = sessionId;
  return result;
}

// ── 채점 ───────────────────────────────────────────────────────────────────
async function runJavaGrading(source, tests, hooks){
  hooks = hooks || {};
  const cases = normalizeAssignmentTests(tests);
  const results = [];
  for (let index = 0; index < cases.length; index++){
    if (typeof hooks.isCancelled === "function" && hooks.isCancelled()) break;
    if (typeof hooks.onProgress === "function") hooks.onProgress(index, cases.length);
    let raw;
    try {
      // 채점도 실행과 같은 라이브러리로 돌려야 한다 — 여기서 빠지면 편집기에서만 되는 코드가 된다.
      raw = await runJavaHeadless(source, javaGradingStdin(cases[index].input), {
        isCancelled: hooks.isCancelled,
        libs: hooks.libs,
        extras: hooks.extras
      });
    } catch(error){
      raw = { stdout:"", stderr:String((error && error.message) || error), code:-1 };
    }
    results.push(javaGradingRow(cases[index], index, raw));
  }
  return { results };
}

// 파이프로 넣을 표준입력 — 마지막 줄에도 개행이 있어야 Scanner 의 nextLine() 이 값을 받는다.
function javaGradingStdin(input){
  const text = String(input == null ? "" : input).replace(/\r\n?/g, "\n");
  if (!text) return "";
  return text.endsWith("\n") ? text : text + "\n";
}

// 실행 결과 하나를 채점 보고서의 한 줄로 바꾼다(파이썬·자바스크립트 채점과 같은 판정 순서).
function javaGradingRow(test, index, raw){
  raw = raw || {};
  const actual = String(raw.stdout || "");
  const stderr = cleanJavaStderr(raw.stderr);
  let error = "";
  if (raw.timedOut) error = javaTf("⏱ {seconds}초가 넘도록 끝나지 않았어요. 끝나지 않는 반복이 없는지 확인해 주세요.",
    { seconds:Math.round(JAVA_GRADE_TIMEOUT_MS / 1000) });
  else if (raw.cancelled) error = javaT("채점을 중지했습니다.");
  else if (stderr) error = stderr;
  else if (Number(raw.code) !== 0) error = javaTf("프로그램이 비정상 종료되었습니다 (종료 코드 {code}).", { code:Number(raw.code) });
  const expected = String(test.expected || "");
  return {
    name: test.name || javaTf("테스트 {index}", { index:index + 1 }),
    input: String(test.input || ""),
    expected,
    actual,
    error,
    passed: !error && normalizeGradingOutput(actual) === normalizeGradingOutput(expected)
  };
}

// ── 진입점 ─────────────────────────────────────────────────────────────────
async function runJavaSource(src, ui, options){
  options = options || {};
  if (ui.running) return;
  const { btn, status, outPanel, split } = ui;
  const source = String(src == null ? "" : src);
  const gradeTests = normalizeAssignmentTests(options.gradeTests);
  const grading = gradeTests.length > 0;
  const libs = String(options.libs || "");   // 실행·채점 두 길에 같은 목록이 들어간다
  // 같은 폴더의 형제 .java. 저장 검사와 같은 묶음을 줘야 "검사는 통과했는데 실행은 안 되는" 짝이 안 생긴다.
  // 모으는 데 파일 읽기가 낄 수 있어 실행 표시(■·"실행 중…")를 세운 뒤에 채운다.
  let extras = [];
  ui.running = true;
  let cancelled = false, cancelSession = null;
  const idleTitle = btn.title;
  const setStatus = (message) => { if (status) status.textContent = javaT(message); };
  if (typeof ui.disposeInstallGuide === "function") ui.disposeInstallGuide();
  ui.disposeInstallGuide = null;
  ui.cancelRun = () => {
    if (cancelled) return;
    cancelled = true;
    setStatus("중지하는 중…");
    if (cancelSession) cancelSession();
  };
  btn.textContent = "■";
  btn.title = javaT("현재 실행 중지");
  btn.setAttribute("aria-label", btn.title);
  btn.classList.add("is-running");
  if (ui.gradeBtn) ui.gradeBtn.disabled = true;
  split.classList.add("show-out");
  if (ui.clearError) ui.clearError();
  // 저장 검사 목록 자리를 실행 결과가 넘겨받는다 — 표시를 지워 두지 않으면 다음 검사가 남의 화면을 고친다.
  if (outPanel) delete outPanel.dataset.javaCheck;
  setStatus(grading ? "채점 중…" : "실행 중…");
  try {
    if (!(await javaBackendAvailable())){
      // 여기서 끝내지 않고, 안내 화면의 '다시 검사'가 성공하면 방금 누른 실행을 그대로 이어 준다.
      const guide = renderJavaInstallGuide(outPanel, () => {
        if ((!ui.isDisposed || !ui.isDisposed()) && typeof ui.rerun === "function") ui.rerun();
      });
      ui.disposeInstallGuide = () => guide.dispose();
      setStatus("자바(JDK) 설치 필요");
      return;
    }
    if (typeof ui.siblingSources === "function"){
      try { extras = (await ui.siblingSources()) || []; } catch(_){ extras = []; }
    }
    if (grading){
      outPanel.innerHTML = '<div class="out-head">' + javaT("과제 자동채점")
        + '</div><pre class="out-pre out-muted">' + javaT("테스트 실행 중…") + '</pre>';
      const report = await runJavaGrading(source, gradeTests, {
        isCancelled: () => cancelled,
        libs, extras,
        onProgress: (index, total) => { if (status) status.textContent = javaTf("채점 중… {index}/{total}", { index:index + 1, total }); }
      });
      renderAssignmentGradingResult(outPanel, report, assignmentGradingErrorText(report, gradeTests), gradeTests);
      return;
    }
    const result = await runJavaInteractive(source, ui, {
      bindCancel: (fn) => { cancelSession = fn; },
      isCancelled: () => cancelled,
      libs, extras
    });
    const line = javaErrorLine(result.stderr, result.mainClass);
    if (line && ui.markError) ui.markError(line);
  } catch(error){
    if (error && error.noJava){
      const guide = renderJavaInstallGuide(outPanel, () => {
        if ((!ui.isDisposed || !ui.isDisposed()) && typeof ui.rerun === "function") ui.rerun();
      });
      ui.disposeInstallGuide = () => guide.dispose();
      setStatus("자바(JDK) 설치 필요");
      return;
    }
    outPanel.innerHTML = "";
    const head = document.createElement("div"); head.className = "out-head"; head.textContent = javaT("실행 실패");
    const pre = document.createElement("pre"); pre.className = "out-pre out-err";
    pre.textContent = String((error && error.message) || error);
    outPanel.append(head, pre);
  } finally {
    ui.running = false;
    ui.cancelRun = null;
    cancelSession = null;
    btn.textContent = "▶";
    btn.title = idleTitle;
    btn.setAttribute("aria-label", idleTitle);
    btn.classList.remove("is-running");
    if (ui.gradeBtn) ui.gradeBtn.disabled = false;
    setStatus("");
    if (options.keepEditorFocus === true && ui.editorTa && !javaUsesInput(source)){
      ui.editorTa.focus({ preventScroll:true });
    }
  }
}
/* ── 저장 검사 ──────────────────────────────────────────────────────────────
   실행하지 않고 javac 만 돌려 오류를 미리 짚는다. 부르는 자리는 '수동 저장'(.java 저장·Ctrl+S)
   하나뿐이다 — 자동 저장(입력이 멈추고 3초)에 걸면 문장을 치는 도중의 코드가 계속 컴파일되고,
   javac 는 문법 오류에서 첫 하나만 뱉으므로 "';' expected" 한 줄이 3초마다 깜빡이게 된다.
   실패해도 저장을 되돌리거나 알림을 띄우지 않는다. 검사는 덤이지 저장의 조건이 아니다. */

// 오류 목록. 파이썬 '코드 진단'과 같은 모양·같은 CSS(py-diagnostic-*)를 쓴다.
// 목록이 따로 필요한 이유는 편집기 줄 표시가 글자 하나만 고쳐도 지워지기 때문이다 —
// 오류 셋을 보고 첫 줄을 고치는 순간 나머지 둘의 표시까지 사라지면 다시 저장해야 알 수 있다.
function renderJavaCheckResult(panel, diagnostics, ui, rawOutput){
  if (!panel) return;
  panel.innerHTML = "";
  panel.dataset.javaCheck = "1";        // 이 칸이 지금 검사 결과를 들고 있다는 표시(다음 검사가 갱신 여부를 판단한다)
  const head = document.createElement("div"); head.className = "out-head";
  head.textContent = javaT("저장 검사");
  panel.appendChild(head);
  const errors = diagnostics.filter(item => item.severity === "error").length;
  const warnings = diagnostics.filter(item => item.severity === "warning").length;
  const summary = document.createElement("div");
  summary.className = "py-diagnostic-summary " + (errors ? "is-error" : warnings ? "is-warning" : "is-ok");
  if (!diagnostics.length){
    // 컴파일은 실패했는데 줄 번호가 없는 경우(시간 초과·메모리 제한 등) — 받은 말을 그대로 보여 준다.
    const failed = String(rawOutput || "").trim();
    summary.className = "py-diagnostic-summary " + (failed ? "is-error" : "is-ok");
    summary.textContent = failed ? javaT("컴파일하지 못했습니다.") : javaT("문법 오류가 없습니다.");
    panel.appendChild(summary);
    if (failed){
      const pre = document.createElement("pre"); pre.className = "out-pre out-err"; pre.textContent = failed;
      panel.appendChild(pre);
    }
    return;
  }
  summary.textContent = javaTf("오류 {errors}개 · 경고 {warnings}개 · 참고 {notes}개",
    { errors, warnings, notes:diagnostics.length - errors - warnings });
  panel.appendChild(summary);
  const list = document.createElement("div"); list.className = "py-diagnostic-list";
  const severityLabel = { error:javaT("오류"), warning:javaT("경고"), info:javaT("참고") };
  diagnostics.forEach((item) => {
    const row = document.createElement("button"); row.type = "button";
    row.className = "py-diagnostic-item is-" + item.severity;
    const mark = document.createElement("span"); mark.className = "py-diagnostic-mark";
    mark.textContent = severityLabel[item.severity] || item.severity;
    const where = document.createElement("code");
    // 형제 파일의 오류에는 파일 이름을 붙인다 — 줄 번호만 있으면 지금 파일의 그 줄로 오해한다.
    where.textContent = (item.own ? "" : item.file + " ")
      + javaTf("{line}줄", { line:item.line }) + (item.column ? " " + (item.column + 1) + javaT("칸") : "");
    const body = document.createElement("span"); body.className = "py-diagnostic-body";
    const message = document.createElement("strong"); message.textContent = item.message;
    body.appendChild(message);
    if (item.hint){ const hint = document.createElement("small"); hint.textContent = item.hint; body.appendChild(hint); }
    row.append(mark, where, body);
    row.addEventListener("click", () => {
      if (!ui) return;
      if (item.own){ if (typeof ui.focusLine === "function") ui.focusLine(item.line); }
      else if (typeof ui.openSiblingLine === "function") ui.openSiblingLine(item.file, item.line);
    });
    list.appendChild(row);
  });
  panel.appendChild(list);
}

/* 저장한 내용 그대로 javac 를 돌린다. 돌려주는 값은 저장 쪽이 상태 줄에 쓸 요약이고,
   백엔드가 없거나(브라우저) JDK 가 없으면 null 을 돌려 조용히 넘어간다 — 저장할 때마다
   "자바를 설치하세요"가 뜨면 자바 없이 코드만 적어 두는 수업을 막게 된다. */
async function checkJavaSource(src, ui, options){
  options = options || {};
  const source = String(src == null ? "" : src);
  const outPanel = ui && ui.outPanel;
  if (!source.trim()){
    if (ui && ui.clearError) ui.clearError();
    return null;
  }
  if (!(await javaBackendAvailable())) return null;
  let data = null;
  try {
    const query = options.libs ? "?libs=" + encodeURIComponent(String(options.libs)) : "";
    const res = await fetch("/java-check" + query, {
      method:"POST", headers:{ "Content-Type":"application/octet-stream" },
      // 실행과 같은 봉투·같은 형제 목록을 보낸다 — 여기서만 형제를 알면 검사와 실행의 답이 갈린다.
      body:buildJavaRunPayload(source, "", options.extras)
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch(_){ return null; }
  // 기다리는 동안 실행이 시작됐거나 화면이 닫혔으면 결과 칸을 건드리지 않는다.
  if (!ui || ui.running || (ui.isDisposed && ui.isDisposed())) return null;
  if (data.skipped === "libs") return null;      // 고른 라이브러리를 못 찾은 경우 — 검사 자체를 건너뛴다
  const output = String(data.output || "");
  // 런처가 이 소스를 어떤 파일 이름으로 저장했는지 알려 준다 — 형제 파일의 진단과 가르는 기준이다.
  const diagnostics = javacDiagnostics(output, data.mainClass ? data.mainClass + ".java" : "");
  const failed = data.ok === false;
  if (!diagnostics.length && !failed){
    if (ui.clearError) ui.clearError();
    // 지난 검사 목록이 남아 있으면 '이제 깨끗하다'로 바꿔 준다. 그 밖에는 실행 결과를 덮지 않는다.
    if (outPanel && outPanel.dataset.javaCheck === "1") renderJavaCheckResult(outPanel, [], ui, "");
    return { errors:0, warnings:0, total:0, ok:true };
  }
  // 편집기 줄 표시는 이 파일 것만 받는다. 형제 파일의 5줄을 여기 5줄에 칠하면 없는 오류를 만든다.
  const mine = diagnostics.filter(item => item.own);
  if (mine.length){
    if (ui.setDiagnosticItems) ui.setDiagnosticItems(mine);
    else if (ui.markError) ui.markError(mine[0].line);
  } else if (ui.clearError) ui.clearError();
  renderJavaCheckResult(outPanel, diagnostics, ui, failed ? output : "");
  if (ui.split) ui.split.classList.add("show-out");
  return {
    errors:diagnostics.filter(item => item.severity === "error").length,
    warnings:diagnostics.filter(item => item.severity === "warning").length,
    total:diagnostics.length, ok:!failed
  };
}
