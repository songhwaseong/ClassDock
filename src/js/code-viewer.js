"use strict";

/* ===== 코드/설정 파일 미리보기 (자체 구문 강조 + 줄번호, 외부 의존성 없음) ===== */
// 앞머리의 대문자 낱말은 파이썬 상수(None·True·False 등) — 강조 정규식이 대소문자를 구분하므로
// 소문자 none|true|false 와 별개로 적어야 색이 붙는다.
const CODE_KW = "Ellipsis|False|None|NotImplemented|True|abstract|and|arguments|as|assert|async|await|base|bool|boolean|break|byte|case|catch|chan|char|class|const|continue|debugger|def|default|defer|del|delete|do|double|elif|else|elsif|end|enum|except|export|extends|extern|false|final|finally|float|fn|for|foreach|from|func|function|global|go|goto|if|impl|implements|import|in|instanceof|int|interface|is|lambda|let|long|loop|match|mod|module|mut|namespace|new|nil|none|nonlocal|not|null|object|or|out|override|package|pass|private|protected|public|pub|raise|readonly|ref|return|select|self|short|sizeof|static|struct|super|switch|synchronized|template|this|throw|throws|trait|true|try|typedef|typeof|union|unsafe|use|using|var|virtual|void|volatile|when|where|while|with|yield";
// 파이썬 내장 함수·형(tk-b)과 내장 예외·경고 클래스(tk-t). 키워드 목록과 겹치는 int·float·bool·
// object·super 는 Python 프로필에서 이쪽이 먼저 매칭돼 내장색으로 통일된다.
const PY_BUILTIN_FN = "__import__|abs|aiter|all|anext|any|ascii|bin|bool|breakpoint|bytearray|bytes|callable|chr|classmethod|compile|complex|delattr|dict|dir|divmod|enumerate|eval|exec|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|locals|map|max|memoryview|min|next|object|oct|open|ord|pow|print|property|range|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|vars|zip";
const PY_BUILTIN_EXC = "ArithmeticError|AssertionError|AttributeError|BaseException|BlockingIOError|BrokenPipeError|BufferError|BytesWarning|ChildProcessError|ConnectionAbortedError|ConnectionError|ConnectionRefusedError|ConnectionResetError|DeprecationWarning|EOFError|EncodingWarning|Exception|FileExistsError|FileNotFoundError|FloatingPointError|FutureWarning|GeneratorExit|ImportError|ImportWarning|IndentationError|IndexError|InterruptedError|IsADirectoryError|KeyError|KeyboardInterrupt|LookupError|MemoryError|ModuleNotFoundError|NameError|NotADirectoryError|NotImplementedError|OSError|OverflowError|PendingDeprecationWarning|PermissionError|ProcessLookupError|RecursionError|ReferenceError|ResourceWarning|RuntimeError|RuntimeWarning|StopAsyncIteration|StopIteration|SyntaxError|SyntaxWarning|SystemError|SystemExit|TabError|TimeoutError|TypeError|UnboundLocalError|UnicodeDecodeError|UnicodeEncodeError|UnicodeError|UnicodeTranslateError|UnicodeWarning|UserWarning|ValueError|Warning|ZeroDivisionError";
const SQL_KW = "select|from|where|insert|into|update|delete|create|alter|drop|table|view|index|join|inner|left|right|outer|full|cross|on|group|order|by|asc|desc|having|union|all|values|set|primary|key|foreign|references|not|null|default|distinct|as|and|or|like|between|in|exists|case|when|then|else|count|sum|avg|min|max|limit|offset|begin|commit|rollback";
window.__lastCodeLinkDocId = window.__lastCodeLinkDocId || null;

function isDefinitionSourceDoc(doc){
  return !!(doc && String(doc.sourceKey || "").startsWith("definition:"));
}

// Ctrl+클릭에서 현재 작업공간의 from ... import ... 를 먼저 해석한다.
// Jedi에는 브라우저가 가진 폴더 상대경로를 넘길 수 없어, 함께 열린 문서 경로로 직접 연결해야 한다.
async function openWorkspacePythonImportDefinition(ownerDoc, source, wordInfo){
  if (!ownerDoc || !wordInfo || !wordInfo.word || typeof resolvePythonImportedDefinition !== "function") return false;
  const docPath = (doc) => String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const hit = resolvePythonImportedDefinition(source, wordInfo.word, docPath(ownerDoc), docs.map(docPath));
  if (!hit) return false;
  const target = docs.find(doc => docPath(doc) === hit.path);
  if (!target) return false;
  let targetSource = "";
  try { targetSource = await openDocRunText(target); } catch(_){}
  const definition = findPythonLocalDefinition(targetSource, hit.importedName, 0);
  const targetLine = definition ? definition.line : 1;
  const targetFocus = { column:0, length:Math.max(1, hit.importedName.length) };
  target.pendingFocusLine = targetLine;
  target.pendingFocusOptions = targetFocus;
  setActiveDoc(target.id);
  const navigator = target.codeEditor || target.codeViewer;
  if (navigator && navigator.focusLine) navigator.focusLine(targetLine, targetFocus);
  toast(definition ? "작업공간의 함수 정의로 이동했습니다." : "작업공간의 모듈 파일을 열었습니다.", 1600);
  return true;
}

// 열린 작업공간의 최신 Python 문서만 읽어 로컬 자동 import 후보를 만든다.
// 서로 다른 폴더/압축 묶음은 import 루트가 모호해지므로 같은 archiveCtx만 포함한다.
function workspacePythonImportCandidates(ownerDoc){
  if (!ownerDoc || typeof pythonWorkspaceImportCompletionCandidates !== "function") return [];
  const docPath = (doc) => String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "")
    .replace(/\\/g, "/").replace(/^\/+/, "");
  const currentPath = docPath(ownerDoc);
  const context = ownerDoc.archiveCtx || null;
  const entries = [];
  for (const doc of docs){
    if (!doc || doc === ownerDoc || doc.kind === "pdf") continue;
    if (doc.sourceKey && String(doc.sourceKey).startsWith("definition:")) continue;
    if ((doc.archiveCtx || null) !== context) continue;
    const path = docPath(doc);
    if (!/\.(?:py|pyw|pyi)$/i.test(path)) continue;
    let source = null;
    if (doc.codeEditor && typeof doc.codeEditor.getValue === "function"){
      try { source = doc.codeEditor.getValue(); } catch(_){}
    }
    if (source == null && typeof doc.savedText === "string") source = doc.savedText;
    if (source != null) entries.push({ path, source });
  }
  return pythonWorkspaceImportCompletionCandidates(currentPath, entries);
}

// 문자열 토큰이 f-string 인가? (접두사에 f/F 포함) — 바깥 정규식이 이미 잘라낸 토큰만 검사.
function isFStringToken(token){
  const q = token.search(/["'`]/);
  return q > 0 && /[fF]/.test(token.slice(0, q));
}
// f-string 한 토큰(m[0])만 받아 HTML 을 돌려주는 격리 함수 — 바깥 경계는 이미 확정돼 있어
// 문서의 다른 부분에 영향을 줄 수 없고, 모든 원본 글자를 escapeHtml 로 한 번씩만 방출해
// 편집 오버레이의 글자 정렬도 깨지지 않는다. { … } 안(보간식)은 기본 글자색(tk-fi), 나머지
// 리터럴은 문자열색(tk-s). {{·}} 는 리터럴 중괄호라 문자열색을 유지한다.
function highlightFString(token){
  const open = token.match(/^[A-Za-z]*(?:'''|"""|'|"|`)/);
  if (!open) return '<span class="tk-s">' + escapeHtml(token) + '</span>';
  const opener = open[0];
  const quote = opener.match(/(?:'''|"""|'|"|`)$/)[0];
  const bodyEnd = token.length - quote.length;
  // 닫는 따옴표가 온전할 때만 분리한다(미완성 문자열은 통째로 문자열색으로 안전 폴백).
  if (bodyEnd < opener.length || token.slice(bodyEnd) !== quote){
    return '<span class="tk-s">' + escapeHtml(token) + '</span>';
  }
  const body = token.slice(opener.length, bodyEnd);
  let html = '<span class="tk-s">' + escapeHtml(opener) + '</span>';
  let buf = "";
  const flush = () => { if (buf){ html += '<span class="tk-s">' + escapeHtml(buf) + '</span>'; buf = ""; } };
  for (let i = 0; i < body.length; ){
    const c = body[i];
    if (c === '{' && body[i+1] === '{'){ buf += '{{'; i += 2; continue; }   // 리터럴 {
    if (c === '}' && body[i+1] === '}'){ buf += '}}'; i += 2; continue; }   // 리터럴 }
    if (c === '{'){
      flush();
      let depth = 1, j = i + 1;
      while (j < body.length && depth > 0){
        const cj = body[j];
        if (cj === '{') depth++;
        else if (cj === '}'){ depth--; if (depth === 0) break; }
        j++;
      }
      const end = (j < body.length && depth === 0) ? j : body.length - 1;   // 짝 없는 { 는 남은 전부를 보간식으로
      html += '<span class="tk-fi">' + escapeHtml(body.slice(i, end + 1)) + '</span>';
      i = end + 1;
      continue;
    }
    buf += c; i++;
  }
  flush();
  html += '<span class="tk-s">' + escapeHtml(quote) + '</span>';
  return html;
}
function highlightCodeBase(src, profile){
  if (profile === "text") return escapeHtml(src);   // 강조 없이 텍스트만(rst/adoc/org/tex 등 경량 마크업)
  const isPython = profile === "python";
  let com;
  if (isPython || profile==="hash") com="#[^\\n]*";
  else if (profile==="sql") com="--[^\\n]*|/\\*[\\s\\S]*?\\*/";
  else if (profile==="xml") com="<!--[\\s\\S]*?-->";
  else if (profile==="css") com="/\\*[\\s\\S]*?\\*/";
  else com="//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  // 문자열 접두사(f·r·b·u 및 조합)를 따옴표 바로 앞에서만 함께 잡는다. 접두사가 있을 때만 \b 로
  // 식별자 꼬리를 배제하고, 없을 때는 일반 문자열이 그대로 매칭되도록 그룹 전체를 선택적으로 둔다.
  const strPre = '(?:\\b(?:[rR][bBfF]|[bBfF][rR]|[rRbBuUfF]))?';
  const str = strPre + '(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')' + (profile==="c" ? '|`(?:\\\\.|[^`\\\\])*`' : "");
  const num = "\\b0[xX][0-9a-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b";
  const kwList = profile==="sql" ? SQL_KW : CODE_KW;
  let alts;
  if (profile==="xml") alts = ["(?<com>"+com+")", "(?<s>"+str+")", "(?<t></?[A-Za-z][\\w:.-]*|/?>)"];
  else {
    alts = ["(?<com>"+com+")", "(?<s>"+str+")", "(?<n>"+num+")"];
    // 파이썬(# 주석 프로필)에서만 내장 이름을 따로 칠한다 — 키워드 대안보다 앞에 둬야
    // int·float·bool 처럼 양쪽 목록에 다 있는 이름이 내장색으로 잡힌다. xml 전용인 t 그룹은
    // 이 프로필에서 비어 있으므로 내장 예외 색으로 그대로 재사용한다(전용 CSS가 이미 있음).
    if (isPython){
      // 문자열·주석보다 뒤에 두어 그 안의 @decorator / def name 은 건드리지 않는다.
      // 의미 분석용 PUA 표식이 함수명에 감싸져도 함수명 색을 유지한다.
      const semanticMarker = "[\\uE000-\\uF8FF]*";
      alts.push("(?<d>@[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)");
      alts.push("(?<f>\\b(?:async\\s+)?def\\s+" + semanticMarker + "[A-Za-z_]\\w*" + semanticMarker + ")");
      alts.push("(?<b>\\b(?:"+PY_BUILTIN_FN+")\\b)");
      alts.push("(?<t>\\b(?:"+PY_BUILTIN_EXC+")\\b)");
    }
    alts.push("(?<k>\\b(?:"+kwList+")\\b)");
  }
  let re;
  try { re = new RegExp(alts.join("|"), profile==="sql" ? "gi" : "g"); }
  catch(e){ return escapeHtml(src); }                 // 정규식 미지원 환경 → 일반 텍스트로 폴백
  let out="", last=0, m;
  while ((m = re.exec(src))){
    if (m[0] === ""){ re.lastIndex++; continue; }
    out += escapeHtml(src.slice(last, m.index));
    const g = m.groups;
    if (g.s && isFStringToken(m[0])) out += highlightFString(m[0]);
    else if (g.f){
      const fn = m[0].match(/^((?:async\s+)?def)(\s+)([\uE000-\uF8FF]*)([A-Za-z_]\w*)([\uE000-\uF8FF]*)$/);
      if (fn){
        out += '<span class="tk-k">' + escapeHtml(fn[1]) + '</span>' + escapeHtml(fn[2] + fn[3])
          + '<span class="tk-f">' + escapeHtml(fn[4]) + '</span>' + escapeHtml(fn[5]);
      } else out += '<span class="tk-f">' + escapeHtml(m[0]) + '</span>';
    }
    else {
      const cls = g.com?"c":g.s?"s":g.n?"n":g.d?"d":g.b?"b":g.k?"k":g.t?"t":"";
      out += '<span class="tk-'+cls+'">' + escapeHtml(m[0]) + '</span>';
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

// 구문 강조 결과의 문자 배치를 바꾸지 않으면서 의미 분석 범위만 흐리게 표시한다.
// 먼저 원문에 사용자가 입력할 가능성이 매우 낮은 PUA 표식을 끼운 뒤 기존 렉서를 통과시키면,
// 문자열·주석 같은 여러 줄 토큰의 상태를 깨뜨리지 않고 정확한 식별자 위치에 span을 넣을 수 있다.
// semanticRanges: [{start, end, cls}] — cls는 "tk-unused"(기본, 미사용 흐림) 또는 "tk-param"(함수 매개변수·
// 키워드 인자 이름). 서로 다른 부류가 같은 글자를 겹쳐 칠하지 않도록 정렬 후 겹치는 범위는 앞선 것만 남긴다
// (미사용 흐림을 먼저 넣으면 흐림이 매개변수색을 이긴다). 각 부류는 전용 PUA 마커 쌍으로 감싼 뒤 span 으로 치환.
const SEMANTIC_HL_CLASSES = ["tk-unused", "tk-param"];
function highlightCode(src, profile, semanticRanges=[]){
  const text = String(src == null ? "" : src);
  const candidates = (Array.isArray(semanticRanges) ? semanticRanges : [])
    .map((item) => ({
      start:Math.max(0, Math.min(text.length, parseInt(item && item.start, 10) || 0)),
      end:Math.max(0, Math.min(text.length, parseInt(item && item.end, 10) || 0)),
      cls:(item && item.cls === "tk-param") ? "tk-param" : "tk-unused"
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const ranges = [];
  for (const item of candidates) if (!ranges.length || item.start >= ranges[ranges.length - 1].end) ranges.push(item);
  if (!ranges.length) return highlightCodeBase(text, profile);

  // 부류마다 별도의 open/close 문자가 필요하므로(2쌍=4글자) 본문에 없는 연속 PUA 블록을 찾는다.
  const free = (code) => !text.includes(String.fromCharCode(code));
  let markerCode = 0xE000;
  while (markerCode < 0xF8FA && !(free(markerCode) && free(markerCode + 1) && free(markerCode + 2) && free(markerCode + 3))) markerCode += 4;
  if (markerCode >= 0xF8FA) return highlightCodeBase(text, profile);
  const marks = {};
  SEMANTIC_HL_CLASSES.forEach((cls, i) => { marks[cls] = { open:String.fromCharCode(markerCode + i * 2), close:String.fromCharCode(markerCode + i * 2 + 1) }; });
  let marked = text;
  for (let i = ranges.length - 1; i >= 0; i--){
    const range = ranges[i], mk = marks[range.cls];
    marked = marked.slice(0, range.start) + mk.open + marked.slice(range.start, range.end) + mk.close + marked.slice(range.end);
  }
  let html = highlightCodeBase(marked, profile);
  for (const cls of SEMANTIC_HL_CLASSES){
    html = html.split(marks[cls].open).join('<span class="' + cls + '">').split(marks[cls].close).join('</span>');
  }
  return html;
}

// 주피터 노트북(.ipynb) JSON → 실행 가능한 파이썬 소스로 변환
//  · 코드 셀은 그대로, 마크다운/설명 셀은 주석(#)으로 옮긴다
//  · 파이썬이 아닌 노트북 명령(%matplotlib, !pip install …)은 주석 처리해 실행이 멈추지 않게 한다
function ipynbToPython(jsonText, fileName){
  let nb;
  try { nb = JSON.parse(jsonText); }
  catch(e){ throw new Error("올바른 노트북(.ipynb) 파일이 아닙니다."); }
  const cells = Array.isArray(nb.cells) ? nb.cells
    : (nb.worksheets && nb.worksheets[0] && Array.isArray(nb.worksheets[0].cells) ? nb.worksheets[0].cells : []);  // nbformat 3 호환
  if (!cells.length) throw new Error("노트북에 셀이 없습니다.");
  const srcOf = (c) => {
    const s = (c.source != null) ? c.source : c.input;     // nbformat 3은 input
    return (Array.isArray(s) ? s.join("") : (s || "")).replace(/\r\n?/g, "\n");
  };
  const out = [];
  out.push("# " + (fileName || "notebook") + " — 주피터 노트북(.ipynb)을 파이썬 코드로 변환했습니다.");
  out.push("# 셀 구분자는 # %% (VSCode·Jupyter 표준). 설명(마크다운) 셀은 주석으로 옮겼습니다.");
  out.push("");
  for (const c of cells){
    const type = c.cell_type || "code";
    const raw = srcOf(c);
    if (type === "code"){
      const body = raw.split("\n")
        .map(line => /^\s*[%!]/.test(line) ? "# (노트북 명령) " + line : line)   // 매직·셸 명령 주석 처리
        .join("\n").replace(/\s+$/, "");
      out.push("# %%");
      if (body.trim()) out.push(body);
      out.push("");
    } else {
      if (!raw.trim()) continue;                            // 빈 설명 셀은 건너뜀
      const lines = raw.replace(/\s+$/, "").split("\n").map(l => l.length ? "# " + l : "#");
      out.push("# %% [markdown]");
      out.push(lines.join("\n"));
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// 편집기 내용을 '코드 셀' 주석 경계로 잘라 셀 목록을 만든다(파이썬 셀 하버스트의 경계 판정과 동일 규칙).
function splitNotebookCells(text){
  const lines = String(text == null ? "" : text).split("\n");
  // 셀 경계: 표준 # %% (VSCode·Jupyter) 또는 이 앱의 옛 '# … 코드 셀 …' 헤더 둘 다 인식.
  const isHead = (l) => { const t = l.replace(/^\s+/, ""); return /^#+\s*%%/.test(t) || (t.startsWith("#") && t.indexOf("코드 셀") >= 0); };
  const heads = [];
  for (let i = 0; i < lines.length; i++) if (isHead(lines[i])) heads.push(i);
  if (!heads.length) return [{ index:1, startLine:0, endLine:lines.length - 1, label:"1", code:text }];
  // 중간 경계만 있는 기존 코드도 첫 경계 이전 내용을 첫 셀로 보존한다.
  const starts = heads[0] === 0 ? heads : [0].concat(heads);
  const bounds = starts.concat([lines.length]);
  const cells = [];
  for (let k = 0; k < starts.length; k++){
    const s = starts[k], e = bounds[k + 1];
    const label = (lines[s].match(/코드 셀\s*(\d+)/) || [])[1] || String(k + 1);
    cells.push({ index:k + 1, startLine:s, endLine:e - 1, label, code:lines.slice(s, e).join("\n") });
  }
  return cells;
}

function ensureFirstNotebookCellMarker(text){
  const value = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  const firstLine = value.split("\n", 1)[0];
  if (/^\s*#+\s*%%/.test(firstLine) || (firstLine.trim().startsWith("#") && firstLine.indexOf("코드 셀") >= 0)){
    return value;
  }
  return "# %%\n" + value;
}

// .py 편집기 내용 → 노트북 모델(.ipynb 직렬화 대상). 셀 경계는 splitNotebookCells 와 동일하게 # %% / 레거시 마커.
// 각 셀의 첫 줄이 마커면 떼어내고, # %% [markdown](또는 레거시 '설명')은 마크다운 셀로 복원한다.
function pyTextToNotebookModel(text){
  const segs = splitNotebookCells(String(text == null ? "" : text));
  const cells = [];
  for (const seg of segs){
    const lines = seg.code.split("\n");
    const head = (lines[0] || "").replace(/^\s+/, "");
    const isMarker = /^#+\s*%%/.test(head) || head.indexOf("코드 셀") >= 0 || /^#.*설명/.test(head);
    const markdown = isMarker && (/\[\s*markdown\s*\]/i.test(head) || head.indexOf("설명") >= 0);
    let body = lines.slice(isMarker ? 1 : 0);
    while (body.length && !body[0].trim()) body.shift();          // 마커 뒤 앞쪽 빈 줄 제거
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const source = markdown
      ? body.map(l => l.replace(/^#[ ]?/, "")).join("\n")          // 주석 접두 제거 → 마크다운 원문 복원
      : body.map(l => l.replace(/^# \(노트북 명령\) /, "")).join("\n");   // %매직·!셸 명령 복원
    if (!source.trim()) continue;                                 // 빈 셀은 건너뜀
    cells.push({ id: nbNewId(), type: markdown ? "markdown" : "code", source, execCount: null, outputs: [], rawOutputs: [], metadata: {} });
  }
  if (!cells.length) cells.push({ id: nbNewId(), type: "code", source: "", execCount: null, outputs: [], rawOutputs: [], metadata: {} });
  return { cells, metadata: {}, nbformat: 4, nbformat_minor: 5 };
}
// 현재 .py 편집기 내용을 .ipynb 로 변환해 새 노트북 문서로 연다(셀 단위 실행·저장은 노트북 뷰에서).
function convertPyEditorToNotebook(text, ownerDoc){
  if (typeof modelToIpynb !== "function" || typeof handleFiles !== "function"){
    if (typeof toast === "function") toast("노트북 변환을 사용할 수 없어요.", 3000);
    return;
  }
  const ipynbText = modelToIpynb(pyTextToNotebookModel(text));
  const base = String((ownerDoc && ownerDoc.name) || "script.py").replace(/\.[^.]+$/, "") || "notebook";
  let file = new File([ipynbText], base + ".ipynb", { type: "application/x-ipynb+json" });
  const opts = { isScratch: true };
  // 원본 .py 가 사이드바 폴더 안에 있으면 변환 노트북도 같은 폴더에 묶는다.
  if (ownerDoc && ownerDoc.parentId) opts.parentId = ownerDoc.parentId;
  // 원본 .py 가 폴더(아카이브)에서 열렸다면 그 폴더 컨텍스트(archiveCtx)를 물려준다. 그래야 노트북을
  // 실행할 때도 옆·상위 파일(예: dataIn/auto-mpg.csv)을 커널에 마운트하고, 작업폴더(cwd)를 원본 .py
  // 와 같은 규칙으로 추론한다(buildNotebookWorkspaceBundle 은 archiveCtx 가 있어야 동작). 없으면
  // 커널 파일시스템이 비어 상대경로 데이터 로드가 FileNotFoundError 로 실패한다.
  // relPath 는 같은 폴더의 .ipynb 로 둬서 원본 .py 문서와 sourceKey 가 충돌하지 않게 한다.
  if (ownerDoc && ownerDoc.archiveCtx){
    opts.archiveCtx = ownerDoc.archiveCtx;
    const srcRel = ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name;
    if (srcRel) opts.relPath = String(srcRel).replace(/\.[^./]+$/, "") + ".ipynb";
  }
  // 원본 .py 를 '폴더로 열었다면'(디렉터리 핸들 보유) 그 폴더 핸들을 새 파일에 물려, 저장 때 같은
  // 폴더에 만들어지게 한다(saveViaFileHandle 의 fsDirHandle 경로). 파일 단독으로 연 경우엔 부모
  // 폴더를 알 수 없어(File System Access API 에 getParent 없음) 저장 때 위치를 고르게 된다.
  if (ownerDoc && ownerDoc.fsDirHandle && typeof withDirHandle === "function"){
    file = withDirHandle(file, ownerDoc.fsDirHandle);
  }
  handleFiles([file], opts);
  if (typeof toast === "function") toast("노트북으로 변환해 열었어요. 셀 단위로 실행·저장할 수 있어요.", 3200);
}

// .ipynb(노트북) 문서에만 붙는 커널 툴바: 셀 하나씩 실행하면서 상태가 누적되는 브라우저 커널(Pyodide).
// 일반 ▶ 실행(전체)·다른 파이썬 실행과 완전히 분리됨 — 전용 네임스페이스(__mn_kernels[kid])를 쓴다.
function setupNotebookKernelBar(ownerDoc, editor, ui, outer, split){
  const kid = "nbkernel:" + (ownerDoc && ownerDoc.id != null ? ownerDoc.id : Math.random().toString(36).slice(2));
  const outPanel = ui.outPanel;
  const bar = document.createElement("div"); bar.className = "nb-kernel-bar";
  const mk = (label, title, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; return b; };
  const tag = document.createElement("span"); tag.className = "nb-kernel-tag"; tag.textContent = "노트북 커널"; tag.title = "셀을 하나씩 실행하면 변수가 다음 셀로 이어집니다(브라우저 Python). 전체 ▶ 실행과는 별개예요.\n단축키 — Ctrl+Enter: 이 셀 실행 · Shift+Enter: 실행 후 다음 셀 · Ctrl+↑/↓: 셀 이동(실행 안 함)";
  const runCellBtn = mk("이 셀", "커서가 있는 셀을 실행 (상태 유지)", "nb-kernel-run");
  const nextBtn = mk("다음 셀", "마지막 실행한 셀의 다음 셀을 실행", "nb-kernel-next");
  const restartBtn = mk("커널 재시작", "누적된 변수·상태를 모두 비웁니다", "nb-kernel-restart");
  const nbViewBtn = mk("셀 노트북", "주피터식 셀 편집기로 보기(실험 · 앱 새로고침)", "nb-kernel-nbview");
  nbViewBtn.addEventListener("click", () => { if (typeof window !== "undefined" && window.mnNotebookMode) window.mnNotebookMode(true); });
  const kstatus = document.createElement("span"); kstatus.className = "nb-kernel-status"; kstatus.textContent = "셀에 커서를 두고 [이 셀] 실행";
  bar.append(tag, runCellBtn, nextBtn, restartBtn, nbViewBtn, kstatus);
  outer.insertBefore(bar, split);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  let busy = false, lastRunIndex = 0, activeTask = null, cancelRequested = false;
  const setBusy = (b) => {
    busy = b;
    runCellBtn.disabled = false;
    runCellBtn.textContent = b ? "■" : "이 셀";
    runCellBtn.title = b ? "현재 셀 실행 중지(커널 상태 초기화)" : "커서가 있는 셀을 실행 (상태 유지)";
    runCellBtn.classList.toggle("is-running", b);
    nextBtn.disabled = restartBtn.disabled = b;
  };
  const setStatus = (t) => { kstatus.textContent = t; };
  const stopRun = () => {
    if (!busy || cancelRequested) return;
    cancelRequested = true;
    runCellBtn.disabled = true;
    setStatus("중지 요청 중…");
    if (activeTask && typeof activeTask.cancel === "function") activeTask.cancel();
  };

  const caretCell = (cells) => {
    const ta = editor.ta;
    const line = ta.value.slice(0, ta.selectionStart || 0).split("\n").length - 1;
    let found = cells[0];
    for (const c of cells){ if (line >= c.startLine) found = c; else break; }
    return found || cells[0];
  };

  const ensureLog = () => {
    let log = outPanel.querySelector(".nb-kernel-log");
    if (!log){ outPanel.innerHTML = ""; log = document.createElement("div"); log.className = "nb-kernel-log"; outPanel.appendChild(log); }
    return log;
  };
  const renderResult = (label, result) => {
    const log = ensureLog();
    const block = document.createElement("div"); block.className = "nb-cell-out" + (result.ok === false ? " has-err" : "");
    block.dataset.cell = String(label);
    const head = document.createElement("div"); head.className = "nb-cell-out-head"; head.textContent = "셀 " + label;
    block.appendChild(head);
    if (result.stdout || result.stderr || (!result.images || !result.images.length)){
      const pre = document.createElement("pre"); pre.className = "out-pre";
      const so = document.createElement("span"); so.textContent = result.stdout || "";
      const se = document.createElement("span"); applyPythonStderrClass(se, result.stderr || "", result.ok === false ? 1 : 0); se.textContent = result.stderr || "";
      pre.append(so, se); block.appendChild(pre);
    }
    for (const src of result.images || []){ const im = document.createElement("img"); im.className = "nb-cell-img"; im.src = src; block.appendChild(im); }
    if (result.variables && result.variables.length){
      const vt = document.createElement("div"); vt.className = "nb-var-list";
      const vh = document.createElement("div"); vh.className = "nb-var-title"; vh.textContent = "변수 " + result.variables.length + "개";
      vt.appendChild(vh);
      for (const v of result.variables.slice(0, 40)){
        const row = document.createElement("div"); row.className = "nb-var-row";
        const n = document.createElement("span"); n.className = "nb-var-name"; n.textContent = v.name;
        const ty = document.createElement("span"); ty.className = "nb-var-type"; ty.textContent = v.type;
        const val = document.createElement("span"); val.className = "nb-var-val"; val.textContent = v.value;
        row.append(n, ty, val); vt.appendChild(row);
      }
      block.appendChild(vt);
    }
    // 같은 셀을 다시 실행하면 옛 출력 블록을 그 자리에서 교체(누적 X) — 셀 번호 순서가 유지된다.
    const prev = log.querySelector('.nb-cell-out[data-cell="' + String(label).replace(/"/g, '\\"') + '"]');
    if (prev) prev.replaceWith(block); else log.appendChild(block);
    block.scrollIntoView({ block:"nearest" });
  };

  const runCell = async (cell) => {
    if (!cell || busy) return;
    cancelRequested = false;
    setBusy(true);
    if (editor.highlightCellRange) editor.highlightCellRange(cell.startLine + 1, cell.endLine + 1);
    split.classList.add("show-out");
    if (ui.layoutBtn) ui.layoutBtn.hidden = false;
    setStatus("셀 " + cell.label + " 실행 준비…");
    try {
      let packages = { urls:[], names:[] };
      try { packages = await preparePyodideWorkerPackages(cell.code, setStatus); }
      catch(e){ setStatus(e && e.message ? e.message : "패키지 설치를 취소했어요."); setBusy(false); return; }
      if (cancelRequested) throw Object.assign(new Error("실행을 중지했습니다."), { code:"worker-cancel" });
      await ensurePyodideWorker(setStatus);
      if (cancelRequested) throw Object.assign(new Error("실행을 중지했습니다."), { code:"worker-cancel" });
      activeTask = startPyodideKernelRun({ kernelId:kid, source:cell.code, stdin:(ui.stdin ? ui.stdin.value : ""), packages, onMsg:setStatus });
      if (cancelRequested) activeTask.cancel();
      const result = await activeTask.promise;
      renderResult(cell.label, result);
      lastRunIndex = cell.index;
      setStatus("셀 " + cell.label + (result.ok === false
        ? " 오류 · 커널 유지"
        : (result.stderr ? " 완료(경고 있음) · 커널 활성" : " 완료 · 커널 활성")));
    } catch(e){
      setStatus(cancelRequested || (e && e.code === "worker-cancel")
        ? "중지됨 · 브라우저 커널 초기화됨"
        : "실행 오류: " + (e && e.message ? e.message : e));
    } finally {
      activeTask = null;
      cancelRequested = false;
      setBusy(false);
    }
  };

  // 커서가 놓인 셀을 옅게 강조 — 커서 이동·스크롤·내용 변경 때마다 갱신(rAF로 한 번만).
  let hiRaf = 0;
  const highlightCurrent = () => {
    cancelAnimationFrame(hiRaf);
    hiRaf = requestAnimationFrame(() => {
      if (!editor.highlightCellRange) return;
      const cells = splitNotebookCells(editor.getValue());
      const cur = caretCell(cells);
      if (cur) editor.highlightCellRange(cur.startLine + 1, cur.endLine + 1);
    });
  };
  ["keyup", "mouseup", "focus", "input"].forEach(ev => editor.ta.addEventListener(ev, highlightCurrent));
  highlightCurrent();

  // 단축키 진입점(에디터 keydown에서 호출): Ctrl/⌘+Enter = 이 셀만, Shift+Enter(advance=true) = 이 셀 + 다음 셀로 이동
  ui.runCurrentCell = (advance) => {
    const cells = splitNotebookCells(editor.getValue());
    const cur = caretCell(cells);
    if (advance){
      const next = cells.find(c => c.index > cur.index);
      if (next && ui.focusLine){ ui.focusLine(next.startLine + 1); highlightCurrent(); }
    }
    runCell(cur);
  };

  // 셀 이동(실행 없이 커서만): Ctrl/⌘+↑·↓ 로 이전/다음 셀 헤더로 이동. 처음/끝에서는 멈춘다(랩어라운드 없음).
  ui.moveCell = (dir) => {
    const cells = splitNotebookCells(editor.getValue());
    if (cells.length <= 1) return false;
    const cur = caretCell(cells);
    const target = dir < 0 ? cells[cur.index - 2] : cells[cur.index];   // index 는 1-based → 배열은 index-1
    if (!target || !ui.focusLine) return false;
    ui.focusLine(target.startLine + 1);
    highlightCurrent();
    return true;
  };

  runCellBtn.addEventListener("click", () => {
    if (busy) stopRun();
    else runCell(caretCell(splitNotebookCells(editor.getValue())));
  });
  nextBtn.addEventListener("click", () => {
    const cells = splitNotebookCells(editor.getValue());
    const next = cells.find(c => c.index > lastRunIndex) || cells[0];
    if (next && ui.focusLine) ui.focusLine(next.startLine + 1);
    runCell(next);
  });
  restartBtn.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startPyodideKernelRun({ kernelId:kid, reset:true, onMsg:setStatus }).promise;
      lastRunIndex = 0;
      outPanel.innerHTML = "";
      setStatus("커널 재시작됨 · 상태 초기화");
    } catch(e){
      setStatus("커널 재시작 실패: " + ((e && e.message) ? e.message : e));
    } finally {
      setBusy(false);
    }
  });

  // 문서를 닫으면 커널 네임스페이스를 비워 메모리를 돌려준다(워커가 이미 없으면 조용히 무시).
  if (ownerDoc && Array.isArray(ownerDoc.cleanupFns)){
    ownerDoc.cleanupFns.push(() => {
      if (activeTask && typeof activeTask.cancel === "function"){ try { activeTask.cancel(); } catch(_){} }
      try { startPyodideKernelRun({ kernelId:kid, reset:true }).promise.catch(() => {}); } catch(_){}
    });
  }
}

/* ===== JSON 트리 보기 (표시 전용) =====
 * 파싱된 JSON 값을 접고 펼치는 트리 DOM으로 만든다. 큰 파일에서도 멈추지 않도록
 *  · 자식 DOM은 처음 펼칠 때 만들고(지연 생성),
 *  · 자식이 많은 컨테이너는 300개씩 끊어 "나머지 N개 보기"로 이어 붙인다. */
function buildJsonTreeView(rootValue){
  const CHUNK = 300;
  const EXPAND_ALL_CAP = 10000;   // 모두 펼치기가 새로 만들 수 있는 노드 상한 — 초대형 JSON에서 DOM 폭발로 멈추는 것 방지
  let nodeCount = 0;
  const buildNode = (key, value, depth) => {
    nodeCount++;
    const info = jsonTreeNodeInfo(value);
    const li = document.createElement("li");
    li.className = "jt-node" + (info.container && info.count ? " jt-branch" : "");
    const row = document.createElement("div"); row.className = "jt-row";
    let toggle = null;
    if (info.container && info.count){
      toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "jt-toggle";
      toggle.textContent = "▸"; toggle.setAttribute("aria-label", "펼치기/접기"); toggle.setAttribute("aria-expanded", "false");
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement("span"); spacer.className = "jt-toggle jt-leaf"; row.appendChild(spacer);
    }
    if (key !== null){
      const keyEl = document.createElement("span");
      keyEl.className = "jt-key" + (typeof key === "number" ? " jt-index" : "");
      keyEl.textContent = typeof key === "number" ? String(key) : JSON.stringify(key);
      const colon = document.createElement("span"); colon.className = "jt-colon"; colon.textContent = ": ";
      row.append(keyEl, colon);
    }
    if (info.container){
      const summary = document.createElement("span"); summary.className = "jt-summary"; summary.textContent = info.summary;
      row.appendChild(summary);
    } else {
      const val = document.createElement("span");
      val.className = "jt-val " + (info.kind === "string" ? "tk-s" : info.kind === "number" ? "tk-n" : "tk-k");
      val.textContent = info.text;
      row.appendChild(val);
    }
    li.appendChild(row);
    if (info.container && info.count){
      const objKeys = Array.isArray(value) ? null : Object.keys(value);
      let kidsEl = null, rendered = 0, open = false;
      const appendChunk = () => {
        const moreLi = kidsEl.querySelector(":scope > .jt-more");
        if (moreLi) moreLi.remove();
        const end = Math.min(info.count, rendered + CHUNK);
        for (; rendered < end; rendered++){
          const childKey = objKeys ? objKeys[rendered] : rendered;
          kidsEl.appendChild(buildNode(childKey, objKeys ? value[childKey] : value[rendered], depth + 1));
        }
        if (rendered < info.count){
          const more = document.createElement("li"); more.className = "jt-more";
          const btn = document.createElement("button"); btn.type = "button"; btn.className = "jt-more-btn";
          btn.textContent = "나머지 " + (info.count - rendered).toLocaleString() + "개 보기";
          btn.addEventListener("click", appendChunk);
          more.appendChild(btn); kidsEl.appendChild(more);
        }
      };
      const setOpen = (next) => {
        open = next;
        if (open && !kidsEl){
          kidsEl = document.createElement("ul"); kidsEl.className = "jt-children";
          appendChunk(); li.appendChild(kidsEl);
        }
        if (kidsEl) kidsEl.hidden = !open;
        li.classList.toggle("jt-open", open);
        toggle.textContent = open ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      };
      row.addEventListener("click", (e) => {
        if (e.target.closest(".jt-more-btn")) return;
        setOpen(!open);
      });
      li.__jtSetOpen = setOpen;         // 모두 펼치기/접기의 일괄 제어용
      if (depth === 0) setOpen(true);   // 최상위는 펼친 상태로 시작(자식들은 접힌 채 나열)
    }
    return li;
  };
  const wrap = document.createElement("div"); wrap.className = "json-tree"; wrap.tabIndex = -1;
  const rootUl = document.createElement("ul"); rootUl.className = "jt-children jt-root";
  rootUl.appendChild(buildNode(null, rootValue, 0));
  wrap.appendChild(rootUl);
  // 모두 펼치기: 펼치면서 새로 생기는 자식까지 반복 처리하되, 상한을 넘으면 멈추고 false 반환.
  // 300개 청크("나머지 N개 보기")는 자동으로 누르지 않는다 — 폭 넓은 배열은 사용자가 필요한 만큼만.
  wrap.jtExpandAll = () => {
    const start = nodeCount;
    for (;;){
      const closed = wrap.querySelectorAll(".jt-branch:not(.jt-open)");
      if (!closed.length) return true;
      for (const li of closed){
        if (nodeCount - start >= EXPAND_ALL_CAP) return false;
        if (li.__jtSetOpen) li.__jtSetOpen(true);
      }
    }
  };
  // 모두 접기: 초기 상태(최상위만 펼침)로 되돌린다.
  wrap.jtCollapseAll = () => {
    for (const li of wrap.querySelectorAll(".jt-branch.jt-open")){ if (li.__jtSetOpen) li.__jtSetOpen(false); }
    const rootLi = rootUl.firstElementChild;
    if (rootLi && rootLi.__jtSetOpen) rootLi.__jtSetOpen(true);
  };
  return wrap;
}

// 원본 텍스트의 주된 개행 문자를 판별한다(CRLF/CR/LF). 저장 시 이 개행으로 되돌린다.
function detectDominantEol(raw){
  const s = String(raw || "");
  const crlf = (s.match(/\r\n/g) || []).length;
  const totalLf = (s.match(/\n/g) || []).length;
  const totalCr = (s.match(/\r/g) || []).length;
  const lfOnly = totalLf - crlf;              // \r 없이 홀로 있는 \n
  const crOnly = totalCr - crlf;              // \n 없이 홀로 있는 \r (구형 Mac)
  if (crlf > 0 && crlf >= lfOnly && crlf >= crOnly) return "crlf";
  if (crOnly > 0 && crOnly > lfOnly) return "cr";
  return "lf";
}

// 저장 직전, 편집기의 LF 텍스트를 원본 개행·BOM 으로 되돌린다(문자 인코딩은 UTF-8 로 고정).
function applyDocEncodingOnSave(value, ownerDoc){
  let out = String(value == null ? "" : value);
  const eol = ownerDoc && ownerDoc.textEol;
  if (eol === "crlf") out = out.replace(/\n/g, "\r\n");
  else if (eol === "cr") out = out.replace(/\n/g, "\r");
  if (ownerDoc && ownerDoc.textBom && out.charCodeAt(0) !== 0xFEFF) out = String.fromCharCode(0xFEFF) + out;
  return out;
}

// 구조화 파일(JSON·XML·YAML) 편집 중 유효성 진단. 편집기 상단에 "✓ 유효" 또는 오류 위치를 보여준다.
// 반환: { level:"ok"|"warn"|"error", text } 또는 null(진단 대상 아님).
function structuredEditDiagnostic(ext, prof, text){
  const src = String(text == null ? "" : text);
  const lineAt = (pos) => { const p = Math.max(0, Math.min(pos, src.length)); return (src.slice(0, p).match(/\n/g) || []).length + 1; };
  if (ext === "json"){
    if (!src.trim()) return { level:"warn", text:"빈 파일" };
    try { JSON.parse(src); return { level:"ok", text:"✓ 유효한 JSON" }; }
    catch(e){
      const msg = String((e && e.message) || e);
      const m = msg.match(/position (\d+)/i);
      const lm = msg.match(/line (\d+)/i);
      const where = lm ? ("" + lm[1] + "번째 줄") : (m ? (lineAt(+m[1]) + "번째 줄") : "");
      return { level:"error", text:"⚠ JSON 오류" + (where ? " · " + where : "") + " · " + msg.replace(/^JSON\.parse:\s*/i, "").replace(/ in JSON at position \d+/i, "") };
    }
  }
  if (prof === "xml"){
    if (!src.trim()) return { level:"warn", text:"빈 파일" };
    try {
      const doc = new DOMParser().parseFromString(src, "application/xml");
      const err = doc.querySelector("parsererror");
      if (!err) return { level:"ok", text:"✓ 잘 짜인 XML" };
      const detail = (err.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
      return { level:"error", text:"⚠ XML 오류 · " + detail };
    } catch(e){ return { level:"error", text:"⚠ XML 오류 · " + String((e && e.message) || e) }; }
  }
  if (ext === "yaml" || ext === "yml"){
    // YAML 정식 파서는 번들하지 않았다. 확실히 판단할 수 있는 들여쓰기 탭만 오류로 표시하고,
    // 나머지는 성공(초록색)으로 오인되지 않도록 간이 검사 경고로 분리한다.
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++){
      if (/^ *\t/.test(lines[i])) return { level:"error", text:"⚠ YAML: " + (i + 1) + "번째 줄 들여쓰기에 탭 문자 — 공백으로 바꾸세요" };
    }
    return { level:"warn", text:"YAML 간이 검사 · 탭 들여쓰기 없음(전체 문법 검증 아님)" };
  }
  return null;
}

async function renderCode(file, host, ext, profile, runCtx){
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const rawText = smartDecodeText(sourceBytes);
  const text = rawText.replace(/\r\n?/g, "\n");
  // 대용량/초장문 파일은 구문 강조(수십만 span 생성)를 생략하고 일반 텍스트로 → 렌더·전환 부담 감소
  const longSingleLine = /[^\n]{20000}/.test(text);
  const heavy = text.length > 300000 || longSingleLine;          // 이 이상: 구문 강조 생략
  // 1MB 초과(또는 초장문 단일 라인)는 편집을 '가벼운 편집기'로 연다 — 강조 오버레이를 통째로 빼서,
  // 글자 하나 칠 때마다 문서 전체를 다시 그리던(highlightCode→innerHTML) 프리징을 없앤다(B안).
  // 20MB 초과는 투명 오버레이 편집기(또는 textarea) 자체가 버거우므로 편집을 잠그고 읽기 전용으로 남긴다.
  const lightEdit = text.length > 1048576 || longSingleLine;
  const tooBigToEdit = text.length > 20 * 1048576;
  const prof = heavy ? "text" : (profile || CODE_EXTS[ext] || "c");
  const lineCount = text.split("\n").length;
  const ownerDoc = docs.find(d => d.el === host) || null;
  const definitionSource = isDefinitionSourceDoc(ownerDoc);
  const runnable = RUN_EXTS.has(ext) && !definitionSource;
  const spellModeForExt = () => {
    if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
    if (!ext || ["txt","text","log","srt","vtt","smi","rst","adoc","asciidoc","org","textile","wiki","mediawiki"].includes(ext)) return "plain";
    return "code";
  };
  const attachSpellcheck = (editor, buttonHost, label) => {
    if (!editor || !editor.ta || typeof MNKoreanSpellcheck === "undefined") return null;
    return MNKoreanSpellcheck.attach({
      textarea:editor.ta,
      buttonHost,
      mode:spellModeForExt(),
      fileExt:ext,
      label:label || ((ownerDoc && ownerDoc.name) || file.name || "맞춤법 검사")
    });
  };
  // 저장 시 원본 개행(CRLF/CR)·BOM 을 보존하기 위해 로드 시 1회 감지해 문서에 기억한다.
  // (화면·편집은 항상 LF 로 정규화하고, 저장할 때만 되돌린다 → Windows .bat/.ps1 등의 개행이 바뀌지 않음.)
  if (ownerDoc && ownerDoc.textEol == null){
    ownerDoc.textEol = detectDominantEol(rawText);
    ownerDoc.textBom = !!(ownerDoc.textEncoding && ownerDoc.textEncoding.bom);
  }
  // 라이트 모드 배경 프리셋은 Python 실행·편집 화면에만 별도 적용한다.
  if (runnable) host.classList.add("python-editor-doc");
  else host.classList.remove("python-editor-doc");
  const effectiveRunCtx = {
    ...(ownerDoc && ownerDoc.archiveCtx ? { archiveCtx: ownerDoc.archiveCtx } : {}),
    ...(ownerDoc && ownerDoc.relPath ? { relPath: ownerDoc.relPath } : {}),
    ...(runCtx || {})
  };
  // 지난 실행에서 저장한 파일이면, 보관해 둔 저장 위치(핸들)를 복원 → 저장 시 위치 재선택 없이 같은 파일로
  if (runnable && ownerDoc && !ownerDoc.fsHandle && ownerDoc.workspacePath){
    loadFsHandle(ownerDoc.workspacePath).then(h => { if (h && !ownerDoc.fsHandle) ownerDoc.fsHandle = h; });
  }
  const outer = runnable ? document.createElement("div") : host;
  if (runnable) outer.className = "run-wrap";
  if (heavy){
    const note = document.createElement("div");
    note.className = "code-note";
    note.textContent = "큰 파일이라 구문 강조를 생략했어요 (" + (text.length/1048576).toFixed(1) + "MB · " + lineCount.toLocaleString() + "줄)";
    outer.appendChild(note);
  }

  if (!runnable){
    // 텍스트/코드: 기본은 읽기 전용, [✎ 편집] 토글로 편집기 전환 후 저장(원래 확장자 유지).
    // ~1MB는 일반 편집기, 1~20MB는 가벼운 편집기(lightEdit), 20MB 초과만 읽기 전용 고정.
    const canEdit = !definitionSource && !tooBigToEdit;
    const saveName = (ownerDoc && ownerDoc.name) || (file && file.name) || ("문서." + (ext || "txt"));
    const jsonPretty = ext === "json";           // jsonc/json5 는 주석 때문에 JSON.parse 가 실패하므로 제외
    const isHtml = ext === "html" || ext === "htm" || ext === "xhtml";   // 소스 보기 ↔ 미리보기(렌더) 토글 대상
    const isMd = ext === "md" || ext === "markdown" || ext === "mdx";    // 마크다운: 미리보기 우선 + 편집·저장 지원
    let currentText = text;
    // 저장하지 않은 편집 초안 자동복구 — 파이썬·PDF처럼 비파이썬 텍스트/코드도 복구한다.
    // 키는 파일 경로, 유효성은 원본 바이트 지문으로 확인(파일이 바뀌면 초안 폐기).
    const textDraftKey = canEdit ? pythonDraftKey(file, ownerDoc, effectiveRunCtx) : null;
    const textDraftFingerprint = fingerprintBytes((file && file.name) || saveName, sourceBytes);
    let restoredTextDraft = null;
    if (textDraftKey){
      const saved = loadPythonDraft(textDraftKey, textDraftFingerprint);
      if (saved !== null && saved !== text){ restoredTextDraft = saved; currentText = saved; }
    }
    let textDraftTimer = 0;
    const persistTextDraft = () => {
      clearTimeout(textDraftTimer); textDraftTimer = 0;
      if (!textDraftKey) return;
      const savedRef = (ownerDoc && typeof ownerDoc.savedText === "string") ? ownerDoc.savedText : text;
      if (currentText === savedRef) clearPythonDraft(textDraftKey);
      else savePythonDraft(textDraftKey, textDraftFingerprint, currentText);
    };
    const scheduleTextDraft = () => { clearTimeout(textDraftTimer); textDraftTimer = setTimeout(persistTextDraft, 500); };
    let prettyText = null;                        // null=원본 표시, 문자열=정렬본 표시(화면 전용 — 편집·저장은 항상 원본)
    let treeMode = false;                         // JSON 트리 보기(화면 전용). 편집·저장은 항상 원본 텍스트 기준
    let treeData = null, treeDataFor = null;      // JSON.parse 결과 캐시(같은 원문이면 재파싱 생략)
    let treeEl = null;                            // 현재 표시 중인 트리 요소(모두 펼치기/접기 버튼이 제어)
    let activeEditor = null, viewJumpTimer = 0;
    let findOnlyEdit = false;                     // Ctrl+H(찾기)로 편집 모드에 들어온 경우 — 찾기를 닫으면 보기로 복귀
    let viewMode = "";                            // "view"/"edit"/"preview" — 현재 표시 모드
    let openReadonlyFind = null;                  // 읽기 전용(대용량·편집 잠금) 찾기 바 열기 — showView 가 채운다

    const teardownActive = () => {
      clearTimeout(viewJumpTimer);
      const ed = activeEditor;
      if (ed){ try { ed.destroy(); } catch(_){} unregisterEditorFont(ed.host); activeEditor = null; }
      if (ownerDoc){ ownerDoc.codeViewer = null; if (ownerDoc.codeEditor && ownerDoc.codeEditor === ed) ownerDoc.codeEditor = null; }
    };

    const showView = () => {
      teardownActive(); host.innerHTML = ""; if (ownerDoc) ownerDoc.codeEditor = null;
      viewMode = "view"; openReadonlyFind = null;
      // 내용 검색 등에서 줄 이동이 예약돼 있으면 줄번호가 있는 코드 보기로 받는다.
      if (treeMode && ownerDoc && ownerDoc.pendingFocusLine) treeMode = false;
      if (canEdit || jsonPretty || isHtml || isMd){
        const bar = document.createElement("div"); bar.className = "text-view-bar";
        const name = document.createElement("span"); name.className = "text-view-name"; name.textContent = (ownerDoc && ownerDoc.name) || saveName;
        bar.appendChild(name);
        if (isHtml || isMd){
          const previewBtn = document.createElement("button"); previewBtn.type = "button"; previewBtn.className = "text-edit-btn";
          previewBtn.textContent = "미리보기";
          previewBtn.title = isMd ? "마크다운을 문서 모양으로 렌더링해 보기" : "HTML을 실제 페이지로 렌더링해 보기";
          previewBtn.addEventListener("click", () => showPreview());
          bar.appendChild(previewBtn);
        }
        if (jsonPretty && !treeMode){
          const prettyBtn = document.createElement("button"); prettyBtn.type = "button"; prettyBtn.className = "text-edit-btn";
          prettyBtn.textContent = prettyText != null ? "원본대로" : "pretty";
          prettyBtn.title = prettyText != null ? "저장된 원본 그대로 보기"
            : "JSON을 들여쓰기로 정렬해 보기 (화면 표시만 바뀌고 파일은 그대로예요)";
          prettyBtn.addEventListener("click", () => {
            if (prettyText != null){ prettyText = null; showView(); return; }
            const result = prettyPrintJsonText(currentText);
            if (!result.ok){ toast("JSON을 정렬하지 못했어요: " + result.error, 4000); return; }
            prettyText = result.text; showView();
          });
          bar.appendChild(prettyBtn);
        }
        if (jsonPretty){
          const treeBtn = document.createElement("button"); treeBtn.type = "button"; treeBtn.className = "text-edit-btn";
          treeBtn.textContent = treeMode ? "코드 보기" : "트리 보기";
          treeBtn.title = treeMode ? "줄번호가 있는 코드 보기로 돌아가기"
            : "접고 펼치는 트리로 JSON 구조 살펴보기 (화면 표시만 바뀌고 파일은 그대로예요)";
          treeBtn.addEventListener("click", () => {
            if (treeMode){ treeMode = false; showView(); return; }
            if (treeDataFor !== currentText){
              try { treeData = JSON.parse(currentText); treeDataFor = currentText; }
              catch(e){ toast("JSON을 트리로 보지 못했어요: " + ((e && e.message) || e), 4000); return; }
            }
            treeMode = true; showView();
          });
          bar.appendChild(treeBtn);
          if (treeMode){
            const expandBtn = document.createElement("button"); expandBtn.type = "button"; expandBtn.className = "text-edit-btn";
            expandBtn.textContent = "모두 펼치기";
            expandBtn.title = "트리 전체를 펼쳐 보기 (구조가 아주 크면 일부까지만 펼쳐요)";
            expandBtn.addEventListener("click", () => {
              if (!treeEl || !treeEl.jtExpandAll) return;
              if (!treeEl.jtExpandAll()) toast("구조가 커서 10,000개까지만 펼쳤어요. 필요한 가지를 눌러 이어서 보세요.", 3500);
            });
            const collapseBtn = document.createElement("button"); collapseBtn.type = "button"; collapseBtn.className = "text-edit-btn";
            collapseBtn.textContent = "모두 접기";
            collapseBtn.title = "처음처럼 최상위만 남기고 모두 접기";
            collapseBtn.addEventListener("click", () => { if (treeEl && treeEl.jtCollapseAll) treeEl.jtCollapseAll(); });
            bar.append(expandBtn, collapseBtn);
          }
        }
        if (canEdit){
          const editBtn = document.createElement("button"); editBtn.type = "button"; editBtn.className = "text-edit-btn"; editBtn.textContent = "✎ 편집";
          editBtn.title = "이 파일을 편집하고 저장 — 본문을 더블클릭하거나 클릭 후 바로 입력해도 켜져요";
          editBtn.addEventListener("click", showEdit);
          bar.appendChild(editBtn);
        }
        host.appendChild(bar);
      }
      if (treeMode){
        treeEl = buildJsonTreeView(treeData);
        host.appendChild(treeEl);
        if (ownerDoc){
          // 트리에는 줄 개념이 없으므로, 줄 이동 요청이 오면 코드 보기로 전환한 뒤 넘긴다.
          ownerDoc.codeViewer = { focusLine: (line, opts) => { treeMode = false; showView();
            if (ownerDoc.codeViewer && ownerDoc.codeViewer.focusLine) ownerDoc.codeViewer.focusLine(line, opts); } };
        }
        return;
      }
      const viewText = prettyText != null ? prettyText : currentText;
      const allLines = viewText.split("\n");
      const lineN = allLines.length;
      const lineOffsets = [];
      let sourceOffset = 0;
      for (let i = 0; i < allLines.length; i++){
        lineOffsets.push(sourceOffset);
        sourceOffset += allLines[i].length + 1;
      }
      const longLine = /[^\n]{2000}/.test(viewText);            // 초장문 단일 라인 → 줄바꿈으로 가로 레이아웃 폭발 회피
      const big = definitionSource || heavy || lineN > 6000;   // 외부 정의/다줄 파일은 청크 가상 렌더(보이는 부분만 레이아웃)
      const LINE_H = 19;                                       // 가상 스크롤 높이 추정용 대략 줄높이
      const wrap = document.createElement("div");
      wrap.className = "code-host code-host-readonly" + (longLine ? " is-wrapped" : "") + (big ? " code-chunked" : "");
      wrap.tabIndex = -1;
      let preRef = null;                                       // 비청크 모드의 pre(focusLine 정밀 계산용)
      const CHUNK = 500;
      const chunkStarts = [];                                  // 각 청크 첫 글자의 viewText 내 offset(단어 하이라이트용)
      const fillCode = (codeEl, txt) => { if (prof === "text") codeEl.textContent = txt; else codeEl.innerHTML = highlightCode(txt, prof); };
      if (big){
        let acc = 0;
        for (let s = 0; s < lineN; s += CHUNK){
          chunkStarts.push(acc);
          const slice = allLines.slice(s, s + CHUNK);
          const chunkText = slice.join("\n");
          const chunk = document.createElement("div"); chunk.className = "code-chunk";
          chunk.style.containIntrinsicSize = "auto " + (slice.length * LINE_H) + "px";   // 오프스크린이어도 스크롤 높이 유지
          const g = document.createElement("div"); g.className = "code-gutter";
          let nums = ""; for (let i = 0; i < slice.length; i++) nums += (s + i + 1) + "\n"; g.textContent = nums;
          const pre = document.createElement("pre"); pre.className = "code-pre";
          const code = document.createElement("code"); fillCode(code, chunkText); pre.appendChild(code);
          chunk.append(g, pre); wrap.appendChild(chunk);
          acc += chunkText.length + 1;                         // +1 = 청크 사이를 잇는 줄바꿈
        }
      } else {
        const gutter = document.createElement("div"); gutter.className = "code-gutter";
        let nums = ""; for (let i = 1; i <= lineN; i++) nums += i + "\n"; gutter.textContent = nums;
        const pre = document.createElement("pre"); pre.className = "code-pre"; preRef = pre;
        const code = document.createElement("code"); fillCode(code, viewText); pre.appendChild(code);
        wrap.append(gutter, pre);
      }
      const jump = document.createElement("div"); jump.className = "readonly-jump-line"; jump.hidden = true; jump.setAttribute("aria-hidden", "true");
      const jumpWord = document.createElement("div"); jumpWord.className = "readonly-jump-word"; jumpWord.hidden = true; jumpWord.setAttribute("aria-hidden", "true");
      wrap.append(jump, jumpWord);
      host.appendChild(wrap);
      // 청크(가상 렌더) 모드에서 대상 줄의 실제 top 을 실측한다. 추정 줄높이(LINE_H)와 청크별 pre 패딩 때문에
      // 줄이 내려갈수록 누적 오차가 생겨 노란 바가 실제 줄과 어긋나던 문제를 없앤다. 비청크 모드는 null 반환(아래 추정식이 이미 정확).
      let focusForcedChunk = null;
      const measureLineTop = (line) => {
        if (!chunkStarts.length) return null;
        const ci = Math.floor((line - 1) / CHUNK), li = (line - 1) % CHUNK;
        const chunkEl = wrap.querySelectorAll(".code-chunk")[ci];
        if (!chunkEl) return null;
        // 오프스크린 청크는 content-visibility:auto 라 실제 레이아웃이 없다 → 대상 청크만 강제로 레이아웃해 실측
        if (focusForcedChunk && focusForcedChunk !== chunkEl) focusForcedChunk.style.contentVisibility = "";
        chunkEl.style.contentVisibility = "visible"; focusForcedChunk = chunkEl;
        const pre = chunkEl.querySelector("pre"), cs = pre && getComputedStyle(pre);
        const lh = (cs && parseFloat(cs.lineHeight)) || LINE_H;
        const padTop = (cs && parseFloat(cs.paddingTop)) || 16;
        const wr = wrap.getBoundingClientRect(), cr = chunkEl.getBoundingClientRect();
        return { top: (cr.top - wr.top + wrap.scrollTop) + padTop + li * lh, lh };   // 청크 top(실측) + 청크 안 상대 위치
      };
      const textRangeAt = (root, start, end) => {
        if (!root || start < 0 || end <= start) return null;
        let offset = 0, startNode = null, endNode = null, startAt = 0, endAt = 0;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())){
          const next = offset + (node.nodeValue || "").length;
          if (!startNode && start >= offset && start <= next){ startNode = node; startAt = start - offset; }
          if (!endNode && end >= offset && end <= next){ endNode = node; endAt = end - offset; }
          if (startNode && endNode) break;
          offset = next;
        }
        if (!startNode || !endNode) return null;
        const range = document.createRange();
        try { range.setStart(startNode, startAt); range.setEnd(endNode, endAt); return range; }
        catch(_){ return null; }
      };
      const codeRangeForLine = (line, column, length) => {
        const text = allLines[line - 1] || "";
        if (column < 0 || !length || column >= text.length) return null;
        let code = preRef && preRef.querySelector("code"), start = lineOffsets[line - 1] + column;
        if (!code && chunkStarts.length){
          const ci = Math.floor((line - 1) / CHUNK);
          const chunk = wrap.querySelectorAll(".code-chunk")[ci];
          if (chunk) code = chunk.querySelector("code");
          start -= chunkStarts[ci] || 0;
        }
        return textRangeAt(code, start, Math.min(start + length, start + text.length - column));
      };
      const measureRenderedLine = (line) => {
        const text = allLines[line - 1] || "";
        const range = codeRangeForLine(line, 0, Math.max(1, text.length));
        if (!range) return null;
        const rect = range.getClientRects()[0] || range.getBoundingClientRect(), hostRect = wrap.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return { top:rect.top - hostRect.top + wrap.scrollTop, lh:rect.height };
      };
      const measureJumpWord = (line, opts) => {
        const column = Math.max(0, Math.floor(Number(opts && opts.column) || 0));
        const length = Math.max(0, Math.floor(Number(opts && opts.length) || 0));
        const range = codeRangeForLine(line, column, length);
        if (!range) return null;
        const rect = range.getBoundingClientRect(), hostRect = wrap.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return { left:rect.left - hostRect.left + wrap.scrollLeft, top:rect.top - hostRect.top + wrap.scrollTop,
          width:rect.width, height:rect.height };
      };
      const focusLine = (line, opts) => {
        line = Math.max(1, Math.min(lineN, parseInt(line, 10) || 1));
        let lineHeight = LINE_H, paddingTop = 16;
        if (preRef){ const cs = getComputedStyle(preRef); lineHeight = parseFloat(cs.lineHeight) || lineHeight; paddingTop = parseFloat(cs.paddingTop) || paddingTop; }
        const estTop = paddingTop + (line - 1) * lineHeight;
        // 찾기 바에서 호출할 땐 포커스를 뺏지 않는다 → 입력창에서 Enter 로 계속 다음 이동 가능
        if (!(opts && opts.noWrapFocus)){ try { wrap.focus({ preventScroll:true }); } catch(_) { wrap.focus(); } }
        // 찾기(noBar)는 placeRoHit 이 실제 단어에 상자를 씌워 정밀 배치하므로, 여기선 기존 추정 스크롤만 하고 줄 전체 노란 바는 생략.
        if (opts && opts.noBar){
          wrap.scrollTop = Math.max(0, estTop - wrap.clientHeight * 0.35);
          jump.style.top = estTop + "px"; jump.style.height = lineHeight + "px"; jump.hidden = true; jumpWord.hidden = true;
          return;
        }
        // 내용검색 클릭 등 일반 점프: 청크 모드는 실측 위치로 정확히 배치. 스크롤 후 이웃 청크 재렌더로 밀리면 다음 프레임에 보정.
        const place = () => {
          const fallback = measureLineTop(line);
          const m = measureRenderedLine(line) || fallback;
          const top = m ? m.top : estTop, lh = m ? m.lh : lineHeight;
          wrap.scrollTop = Math.max(0, top - wrap.clientHeight * 0.35);
          jump.style.top = top + "px"; jump.style.height = lh + "px";
        };
        const placeWord = () => {
          const word = measureJumpWord(line, opts);
          if (!word){ jumpWord.hidden = true; return; }
          jumpWord.style.left = word.left + "px"; jumpWord.style.top = word.top + "px";
          jumpWord.style.width = word.width + "px"; jumpWord.style.height = word.height + "px";
          jumpWord.hidden = false;
        };
        place();
        placeWord();
        if (chunkStarts.length) requestAnimationFrame(() => { place(); placeWord(); });
        jump.hidden = false; clearTimeout(viewJumpTimer); viewJumpTimer = setTimeout(() => { jump.hidden = true; jumpWord.hidden = true; }, 2400);
      };
      const flashJumpBar = () => { jump.hidden = false; clearTimeout(viewJumpTimer); viewJumpTimer = setTimeout(() => { jump.hidden = true; }, 2400); };
      if (ownerDoc){
        ownerDoc.codeViewer = { focusLine };
        if (ownerDoc.pendingFocusLine){
          const line = ownerDoc.pendingFocusLine, opts = ownerDoc.pendingFocusOptions;
          ownerDoc.pendingFocusLine = 0; ownerDoc.pendingFocusOptions = null;
          requestAnimationFrame(() => { if (ownerDoc.codeViewer) ownerDoc.codeViewer.focusLine(line, opts); });
        }
      }
      // ── 보기에서 바로 편집 진입 — 본문을 더블클릭하거나 클릭해 두고 글자를 입력하면
      // ✎ 편집 버튼 없이 그 자리로 편집 모드가 켜진다. pretty(정렬본)는 원본과 글자 위치가
      // 어긋나므로 제외(트리 보기는 위에서 이미 early return). keydown 에서 preventDefault 없이
      // 포커스만 편집기 textarea 로 옮기면, 지금 누른 키(한글 IME 조합 포함)가 그대로 입력된다.
      if (canEdit && prettyText == null){
        // 보기 DOM(강조 span·청크 분할)의 텍스트 노드 위치 → currentText 안의 글자 offset
        const viewOffsetAt = (node, nodeOffset) => {
          if (!node) return null;
          const el = node.nodeType === 1 ? node : node.parentElement;
          const codeEl = el && el.closest ? el.closest(".code-pre code") : null;
          if (!codeEl || !wrap.contains(codeEl)) return null;
          let base = 0;
          if (chunkStarts.length){
            const chunkEl = codeEl.closest(".code-chunk");
            const ci = Array.prototype.indexOf.call(wrap.querySelectorAll(".code-chunk"), chunkEl);
            if (ci < 0) return null;
            base = chunkStarts[ci] || 0;
          }
          if (node === codeEl) return base;            // 앵커가 code 요소 자체면 그 블록 시작으로
          let off = 0;
          const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())){
            if (n === node) return base + off + Math.min(nodeOffset, (n.nodeValue || "").length);
            off += (n.nodeValue || "").length;
          }
          return null;
        };
        // 현재 선택(클릭 캐럿·더블클릭 단어)을 편집기 selection 범위로 변환. 실패 시 화면 첫 줄 근처로.
        const selectionRangeForEdit = () => {
          try {
            const s = window.getSelection();
            if (s && s.rangeCount && wrap.contains(s.anchorNode)){
              const a = viewOffsetAt(s.anchorNode, s.anchorOffset);
              const f = s.isCollapsed ? a : viewOffsetAt(s.focusNode, s.focusOffset);
              if (a != null && f != null) return { start: Math.min(a, f), end: Math.max(a, f) };
            }
          } catch(_){}
          const line = Math.max(1, Math.min(lineN, Math.round(wrap.scrollTop / LINE_H) + 1));
          const off = lineOffsets[line - 1] || 0;
          return { start: off, end: off };
        };
        const enterEditHere = () => {
          const range = selectionRangeForEdit();
          const scrollTop = wrap.scrollTop, scrollLeft = wrap.scrollLeft;   // showEdit 이 wrap 을 없애기 전에 붙잡는다
          showEdit();
          const ed = activeEditor;
          if (!ed || !ed.ta) return;
          try { ed.ta.focus(); } catch(_){}                                 // 동기 포커스 → 이번 키 입력이 편집기로 들어감
          const len = ed.ta.value.length;
          try { ed.ta.setSelectionRange(Math.min(range.start, len), Math.min(range.end, len)); } catch(_){}
          ed.ta.scrollTop = scrollTop; ed.ta.scrollLeft = scrollLeft;       // 보던 위치 그대로 이어서 편집
        };
        wrap.addEventListener("dblclick", (e) => {
          if (e.target && e.target.closest && e.target.closest(".code-gutter")) return;   // 줄번호는 제외
          enterEditHere();
        });
        wrap.addEventListener("keydown", (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;                   // 단축키(복사·찾기 등)는 그대로
          const printable = e.key && e.key.length === 1 && e.key !== " ";   // 스페이스는 스크롤 용도로 남긴다
          const ime = e.key === "Process" || e.keyCode === 229;             // 한글 등 IME 첫 키
          if (!printable && !ime && e.key !== "Enter") return;
          enterEditHere();   // preventDefault 하지 않음 → 이 키 입력이 편집기 textarea 에 그대로 들어간다
        });
      }
      // 편집 잠금(대용량) 파일용 읽기 전용 찾기 바 — 문자열에서 찾아 해당 줄로 점프·강조(Ctrl+H 로 연다).
      if (!canEdit){
        const roFind = document.createElement("div"); roFind.className = "ro-find"; roFind.hidden = true;
        const roInput = document.createElement("input"); roInput.type = "text"; roInput.className = "ro-find-input";
        roInput.placeholder = "찾기 (대용량 문서)"; roInput.setAttribute("aria-label", "문서에서 찾기");
        const roCount = document.createElement("span"); roCount.className = "ro-find-count";
        const roPrev = document.createElement("button"); roPrev.type = "button"; roPrev.className = "text-edit-btn"; roPrev.textContent = "↑"; roPrev.title = "이전 (Shift+Enter)";
        const roNext = document.createElement("button"); roNext.type = "button"; roNext.className = "text-edit-btn"; roNext.textContent = "↓"; roNext.title = "다음 (Enter)";
        const roClose = document.createElement("button"); roClose.type = "button"; roClose.className = "text-edit-btn"; roClose.textContent = "✕"; roClose.title = "닫기 (Esc)";
        roFind.append(roInput, roCount, roPrev, roNext, roClose);
        host.insertBefore(roFind, host.firstChild);
        let roMatches = [], roIdx = -1, roHay = null;
        const roHit = document.createElement("div"); roHit.className = "ro-find-hit"; roHit.hidden = true; wrap.appendChild(roHit);
        const roCompute = () => {
          roMatches = []; roIdx = -1; roHit.hidden = true;
          const q = roInput.value;
          if (q){
            if (roHay === null) roHay = viewText.toLowerCase();   // 통째 소문자 변환은 이 보기에서 1회만
            const hay = roHay, needle = q.toLowerCase();
            let idx = 0, from = 0, line = 1, scan = 0;
            while ((idx = hay.indexOf(needle, from)) !== -1){
              for (; scan < idx; scan++) if (viewText.charCodeAt(scan) === 10) line++;
              // 구문 강조는 code 안을 여러 text node로 나눌 수 있으므로, 실제 Range를
              // 만들 때 사용할 줄 안의 위치도 함께 저장한다.
              const lineStart = lineOffsets[line - 1] || 0;
              roMatches.push({ line, idx, column: idx - lineStart });
              from = idx + Math.max(1, needle.length);
              if (roMatches.length >= 5000) break;   // 초대용량 보호
            }
          }
          roCount.textContent = roInput.value ? (roMatches.length ? (roMatches.length + "개") : "없음") : "";
        };
        // 점프한 줄에서 실제 일치한 '단어'에 상자를 씌우고, 그 실측 위치로 정확히 스크롤한다.
        // 추정 줄높이(LINE_H)로 스크롤하면 아래쪽 줄일수록 누적 오차로 단어가 화면 밖에 놓여 안 보였다.
        // → 대상 청크를 강제로 레이아웃(content-visibility) 후 Range 로 실측해 배치·스크롤한다.
        let roForcedChunk = null;
        const placeRoHit = (m, len) => {
          roHit.hidden = true;
          if (!chunkStarts.length || len <= 0) return false;
          const ci = Math.floor((m.line - 1) / CHUNK);
          const chunkEl = wrap.querySelectorAll(".code-chunk")[ci];
          if (!chunkEl) return false;
          // 가상 렌더(content-visibility:auto) 청크는 오프스크린이면 측정 불가 → 이 청크만 강제로 레이아웃
          if (roForcedChunk && roForcedChunk !== chunkEl) roForcedChunk.style.contentVisibility = "";
          chunkEl.style.contentVisibility = "visible"; roForcedChunk = chunkEl;
          try {
            // 첫 text node만 쓰면 구문 강조 span으로 쪼개진 코드에서는 좌표를 찾지
            // 못한다. 모든 text node 기준으로 Range를 만드는 함수를 사용한다.
            const range = codeRangeForLine(m.line, m.column, len);
            if (!range) return false;
            const r = range.getBoundingClientRect();
            const wr = wrap.getBoundingClientRect();
            if ((!r.width && !r.height)) return false;
            const cTop = r.top - wr.top + wrap.scrollTop;          // 스크롤과 무관한 콘텐츠 좌표(정확)
            const cLeft = r.left - wr.left + wrap.scrollLeft;
            roHit.style.left = cLeft + "px"; roHit.style.top = cTop + "px";
            roHit.style.width = r.width + "px"; roHit.style.height = r.height + "px";
            roHit.hidden = false;
            wrap.scrollTop = Math.max(0, cTop - wrap.clientHeight * 0.4);   // 실측 위치로 스크롤 → 항상 화면에
            // 가로도 실측 위치로 보정 — 긴 줄에서 검색어가 오른쪽 화면 밖으로 잘려 안 보이던 문제.
            // 줄바꿈(is-wrapped) 모드는 가로 스크롤 자체가 없어 건너뛰고, 이미 보이는 단어는 가만 둔다.
            if (!wrap.classList.contains("is-wrapped")){
              const view = wrap.clientWidth, pad = Math.min(80, view * 0.25);   // 왼쪽 pad ≈ 고정 거터 + 여유
              if (cLeft < wrap.scrollLeft + pad || cLeft + r.width > wrap.scrollLeft + view - pad)
                wrap.scrollLeft = Math.max(0, cLeft - view * 0.4);
            }
            return true;
          } catch(_){ return false; }
        };
        const roGo = (delta) => {
          if (!roMatches.length) return;
          roIdx = (roIdx + delta + roMatches.length) % roMatches.length;
          roCount.textContent = (roIdx + 1) + "/" + roMatches.length;
          const m = roMatches[roIdx], len = roInput.value.length;
          focusLine(m.line, { noWrapFocus: true, noBar: true }); // 포커스 유지 + 줄 전체 노란 바 생략(단어 상자로 대체)
          // 스크롤/레이아웃 반영 후 실측·배치. 이웃 청크가 실제 높이로 재렌더되며 밀릴 수 있어 한 번 더 보정.
          requestAnimationFrame(() => {
            if (!placeRoHit(m, len)){ flashJumpBar(); return; }
            requestAnimationFrame(() => placeRoHit(m, len));
          });
        };
        roInput.addEventListener("input", () => { roCompute(); if (roMatches.length){ roIdx = -1; roGo(1); } });
        roInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter"){ e.preventDefault(); roGo(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape"){ e.preventDefault(); roClose.click(); }
        });
        roPrev.addEventListener("click", () => { roGo(-1); roInput.focus(); });
        roNext.addEventListener("click", () => { roGo(1); roInput.focus(); });
        roClose.addEventListener("click", () => { roFind.hidden = true; roHit.hidden = true;
          if (roForcedChunk){ roForcedChunk.style.contentVisibility = ""; roForcedChunk = null; }   // 강제 레이아웃 원복
          try { wrap.focus(); } catch(_){} });
        openReadonlyFind = (seedText) => {
          roFind.hidden = false;
          if (seedText && seedText !== roInput.value){ roInput.value = seedText; roCompute(); if (roMatches.length){ roIdx = -1; roGo(1); } }
          roInput.focus(); roInput.select();
          if (roInput.value && !roMatches.length) roCompute();
        };
      }
    };

    const showEdit = () => {
      teardownActive(); host.innerHTML = "";
      viewMode = "edit"; openReadonlyFind = null;
      prettyText = null; treeMode = false;   // 편집·저장은 항상 원본 텍스트 기준 — 표시 전용 정렬·트리 상태는 해제
      const startedForFind = findOnlyEdit; findOnlyEdit = false;
      // 찾기(Ctrl+H)만 하러 들어온 편집 모드면, 찾기를 닫을 때 아직 수정 전이면 보기로 되돌린다.
      const editorOpts = { plain: true, fileExt: ext };      // 일반 텍스트/코드: 파이썬 전용 지능 없이 확장자별 버퍼 단어 완성만
      if (startedForFind) editorOpts.onFindClose = () => {
        if (ownerDoc && ownerDoc.hasUnsavedEdits) return;   // 편집을 시작했으면 그대로 편집 유지
        currentText = editor.getValue(); showView();
      };
      // 대용량(1MB+·초장문)은 강조 오버레이가 없는 가벼운 편집기로 — 프리징 방지(B안).
      const editor = lightEdit ? buildLightTextEditor(currentText, editorOpts)
                               : buildCodeEditor(currentText, prof, editorOpts);
      activeEditor = editor;
      if (ownerDoc) ownerDoc.codeEditor = editor;
      const bar = document.createElement("div"); bar.className = "run-bar text-edit-bar";
      const saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = "run-save"; saveBtn.textContent = "저장";
      saveBtn.dataset.shortcutAction = "saveCurrent"; saveBtn.dataset.shortcutTitle = "파일 저장";
      const viewBtn = document.createElement("button"); viewBtn.type = "button"; viewBtn.className = "run-revert"; viewBtn.textContent = "보기로"; viewBtn.disabled = false;
      const fontDown = document.createElement("button"); fontDown.type = "button"; fontDown.className = "run-font"; fontDown.textContent = "A−"; fontDown.title = "글자 작게 (Ctrl+−)";
      const fontUp = document.createElement("button"); fontUp.type = "button"; fontUp.className = "run-font"; fontUp.textContent = "A+"; fontUp.title = "글자 크게 (Ctrl++)";
      fontDown.addEventListener("click", () => bumpCodeFont(-1)); fontUp.addEventListener("click", () => bumpCodeFont(1));
      const status = document.createElement("span"); status.className = "run-status";
      const diag = document.createElement("span"); diag.className = "text-edit-diag"; diag.hidden = true;   // JSON·XML·YAML 유효성
      bar.append(saveBtn, viewBtn, fontDown, fontUp, status, diag);
      attachSpellcheck(editor, bar, saveName);
      // 대용량 가벼운 편집 모드 안내 — 왜 강조·완성이 없는지 사용자에게 알린다(저장은 정상).
      if (lightEdit){
        const liteNote = document.createElement("span"); liteNote.className = "text-edit-encnote";
        liteNote.textContent = "가벼운 편집 (대용량 · 강조·자동완성 없음)";
        liteNote.title = "1MB가 넘거나 아주 긴 줄이 있는 파일이라, 편집이 멈추지 않도록 구문 강조와 코드 지능을 끈 채로 열었어요. 저장은 그대로 됩니다.";
        bar.appendChild(liteNote);
      }
      // 원본이 UTF-8 이 아니면 저장 시 UTF-8 로 바뀜을 알린다(개행·BOM 은 원본 유지).
      const enc0 = ownerDoc && ownerDoc.textEncoding;
      if (enc0 && enc0.encoding && enc0.encoding !== "utf-8" && !enc0.empty){
        const encNote = document.createElement("span"); encNote.className = "text-edit-encnote";
        encNote.textContent = "원본 " + (enc0.shortLabel || enc0.label) + " → 저장 시 UTF-8";
        encNote.title = "이 파일은 " + enc0.label + " 인코딩이에요. 저장하면 UTF-8 로 바뀝니다(개행 문자는 원본 유지).";
        bar.appendChild(encNote);
      }
      host.appendChild(bar); host.appendChild(editor.host);
      if (typeof syncShortcutHints === "function") syncShortcutHints(bar);
      registerEditorFont(editor.host);
      let diagTimer = 0;
      const runDiagnostic = () => {
        const d = structuredEditDiagnostic(ext, prof, editor.getValue());
        if (!d){ diag.hidden = true; return; }
        diag.hidden = false; diag.textContent = d.text; diag.dataset.level = d.level;
        diag.title = d.level === "ok" ? "구조 검사를 통과했어요." : d.text;
      };
      const scheduleDiagnostic = () => { clearTimeout(diagTimer); diagTimer = setTimeout(runDiagnostic, 300); };

      /* 자동 저장 — 예전에는 Python 편집기에만 있어서, 같은 편집기를 쓰는 .txt·.md 는
         "알아서 저장되는 파일"과 "안 되는 파일"이 뒤섞여 예측이 안 됐다. 같은 설정으로 묶는다.
         이미 디스크에 있는 파일에만 조용히 되쓰고(existingOnly), 새 파일 저장 위치를 묻는
         대화상자는 절대 띄우지 않는다 — 타이핑 도중 창이 뜨면 안 되기 때문. */
      let textAutosaveTimer = 0, textAutosaveBusy = false, textAutosaveAgain = false;
      const setTextAutosaveState = (next) => {
        if (!ownerDoc) return;
        ownerDoc._pyAutosaveState = next || "";
        updateDocumentStatus(ownerDoc);
      };
      const runTextAutosave = async () => {
        if (!ownerDoc || !ownerDoc.hasUnsavedEdits || !appSettings.autoSave) return;
        if (textAutosaveBusy){ textAutosaveAgain = true; return; }
        textAutosaveBusy = true;
        const value = editor.getValue();
        let retryChangedValue = false;
        setTextAutosaveState("saving");
        try {
          const ok = await saveTextDoc(value, ownerDoc, saveName, { silent:true, existingOnly:true });
          if (ok === true){
            const latest = editor.getValue();
            const dirty = latest !== value;
            currentText = latest;
            status.textContent = dirty ? "저장 안 됨" : "저장됨";
            markDocumentDirty(ownerDoc, dirty);
            persistTextDraft();
            setTextAutosaveState("");
            ownerDoc._textAutosaveFailureNotified = false;
            retryChangedValue = dirty;
          } else if (ok === "skipped"){
            setTextAutosaveState("");     // 저장할 위치가 아직 없는 문서 — 조용히 넘어가고 수동 저장을 기다린다
          } else {
            setTextAutosaveState("failed");
            if (!ownerDoc._textAutosaveFailureNotified){
              ownerDoc._textAutosaveFailureNotified = true;
              toast("자동 저장에 실패했어요. 편집 내용은 남아 있어요.", 6000, { type:"error",
                action:{ label:"지금 저장", onClick:() => saveBtn.click() } });
            }
          }
        } catch(error){
          console.warn("text autosave failed:", error);
          setTextAutosaveState("failed");
          if (!ownerDoc._textAutosaveFailureNotified){
            ownerDoc._textAutosaveFailureNotified = true;
            toast("자동 저장에 실패했어요. 편집 내용은 남아 있어요.", 6000, { type:"error",
              action:{ label:"지금 저장", onClick:() => saveBtn.click() } });
          }
        } finally {
          textAutosaveBusy = false;
          if (textAutosaveAgain || retryChangedValue){ textAutosaveAgain = false; scheduleTextAutosave(); }
        }
      };
      const scheduleTextAutosave = () => {
        clearTimeout(textAutosaveTimer); textAutosaveTimer = 0;
        if (!ownerDoc || !appSettings.autoSave){ setTextAutosaveState(""); return; }
        if (!ownerDoc.hasUnsavedEdits) return;
        textAutosaveTimer = setTimeout(runTextAutosave, TEXT_AUTOSAVE_DELAY);
      };
      if (ownerDoc){
        if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
        ownerDoc.cleanupFns.push(() => { clearTimeout(textAutosaveTimer); textAutosaveTimer = 0; });
      }

      const markDirty = () => { currentText = editor.getValue(); const dirty = currentText !== (ownerDoc && typeof ownerDoc.savedText === "string" ? ownerDoc.savedText : text); status.textContent = dirty ? "저장 안 됨" : ""; markDocumentDirty(ownerDoc, dirty); if (textAutosaveBusy) textAutosaveAgain = true; scheduleTextDraft(); scheduleDiagnostic(); scheduleTextAutosave(); };
      editor.ta.addEventListener("input", markDirty);
      runDiagnostic();                                        // 편집 진입 시 1회 즉시 진단
      editor.ta.addEventListener("keydown", (e) => {
        if (shortcutMatches(e, "saveCurrent")){ e.preventDefault(); saveBtn.click(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); }
        else if ((e.ctrlKey || e.metaKey) && e.key === "-"){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); }
      });
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        try {
          const value = editor.getValue();
          const ok = await saveTextDoc(value, ownerDoc, saveName);
          if (ok === true){
            const latest = editor.getValue();
            const dirty = latest !== value;
            currentText = latest;
            status.textContent = dirty ? "저장 안 됨" : "저장됨";
            markDocumentDirty(ownerDoc, dirty);
            ownerDoc._textAutosaveFailureNotified = false;
            persistTextDraft();
            if (dirty) scheduleTextAutosave();
          }
        }
        finally { saveBtn.disabled = false; }
      });
      viewBtn.addEventListener("click", () => { currentText = editor.getValue(); (isMd ? showPreview : showView)(); });   // 마크다운은 편집 → 미리보기로 복귀
      requestAnimationFrame(() => editor.ta.focus());
    };

    // HTML/마크다운 미리보기: 소스 대신 렌더된 화면을 보여준다.
    //  - HTML: 기존 렌더러(샌드박스 iframe + 옆 리소스 인라인 + 링크 이동)
    //  - 마크다운: markdownToHtml 로 문서 모양 렌더(저장 전 편집 내용도 반영)
    const showPreview = () => {
      teardownActive(); host.innerHTML = "";
      viewMode = "preview"; openReadonlyFind = null;
      if (ownerDoc){ ownerDoc.codeViewer = null; ownerDoc.codeEditor = null; }
      const bar = document.createElement("div"); bar.className = "text-view-bar";
      const name = document.createElement("span"); name.className = "text-view-name"; name.textContent = (ownerDoc && ownerDoc.name) || saveName;
      const srcBtn = document.createElement("button"); srcBtn.type = "button"; srcBtn.className = "text-edit-btn";
      srcBtn.textContent = "소스코드"; srcBtn.title = isMd ? "마크다운 원문(소스) 보기" : "HTML 원문(소스) 보기";
      srcBtn.addEventListener("click", () => showView());
      bar.append(name, srcBtn);
      if (isMd && canEdit){
        const editBtn = document.createElement("button"); editBtn.type = "button"; editBtn.className = "text-edit-btn"; editBtn.textContent = "✎ 편집";
        editBtn.title = "이 파일을 편집하고 저장";
        editBtn.addEventListener("click", showEdit);
        bar.appendChild(editBtn);
      }
      host.appendChild(bar);
      if (isMd){
        const wrap = document.createElement("article");
        wrap.className = "md-host";
        wrap.innerHTML = markdownToHtml(currentText, { allowHtml: true });
        host.appendChild(wrap);
      } else {
        renderHtmlFile(file, host, effectiveRunCtx);
      }
    };
    // 사이드바 본문 검색 결과 클릭 → 미리보기 화면에서 일치 글자로 스크롤+하이라이트
    if (isMd && ownerDoc) ownerDoc.contentSearchFocus = (query) => {
      if (viewMode !== "preview") showPreview();
      return focusRenderedTextMatch(host, query);
    };

    // 보기에서 마우스로 선택한 텍스트를 검색어 시드로 가져온다(이 문서 안의 선택일 때만, 한 줄·200자 이내).
    const getDocFindSeed = () => {
      try {
        const s = window.getSelection && window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) return "";
        if (!host.contains(s.anchorNode) || !host.contains(s.focusNode)) return "";
        const t = String(s).replace(/\s+/g, " ").trim();
        return (t && t.length <= 200) ? t : "";
      } catch(_){ return ""; }
    };
    // Ctrl+H(문서 안에서 찾기): 이미 편집 중이면 바로 찾기, 읽기 전용 보기면 편집 모드로 전환 후 찾기(닫으면 보기 복귀).
    const openDocFind = () => {
      const seed = getDocFindSeed();                  // 편집/DOM 전환 전에 선택어를 먼저 붙잡는다
      if (activeEditor && typeof activeEditor.openFind === "function"){ activeEditor.openFind(seed); return; }
      if (canEdit){                                   // 편집 가능한 파일: 에디터 찾기(글자 단위 하이라이트)
        findOnlyEdit = true;
        showEdit();
        requestAnimationFrame(() => { if (activeEditor && typeof activeEditor.openFind === "function") activeEditor.openFind(seed); });
        return;
      }
      // 편집 잠금(대용량) 파일: 읽기 전용 찾기 바(문자열 검색 + 줄 점프)
      if (viewMode === "view" && typeof openReadonlyFind === "function"){ openReadonlyFind(seed); return; }
      showView();   // 미리보기 등 다른 모드였으면 읽기 전용 보기로 전환 후 연다
      requestAnimationFrame(() => { if (typeof openReadonlyFind === "function") openReadonlyFind(seed); });
    };
    if (ownerDoc) ownerDoc.openDocFind = openDocFind;

    if (ownerDoc){ if (!ownerDoc.cleanupFns) ownerDoc.cleanupFns = []; ownerDoc.cleanupFns.push(teardownActive); }
    if (restoredTextDraft !== null){              // 저장하지 않은 편집 초안 복구 → 편집 화면으로 열어 바로 보이게
      markDocumentDirty(ownerDoc);
      showEdit();
      toast("저장하지 않은 편집 내용을 복구했어요.", 2600);
    }
    else if (canEdit && ownerDoc && ownerDoc.isScratch) showEdit();
    else if (isMd) showPreview();                 // 마크다운은 문서 모양(미리보기)이 기본
    else showView();
    return;
  }

  // ── 실행 가능한 코드(.py): 편집 가능한 에디터 + 실행 바 + 좌(에디터)·우(출력) 분할 ──
  const draftKey = pythonDraftKey(file, ownerDoc, effectiveRunCtx);
  const sourceFingerprint = fingerprintBytes((file && file.name) || "code.py", sourceBytes);
  const restoredDraft = loadPythonDraft(draftKey, sourceFingerprint);
  const editor = buildCodeEditor(restoredDraft === null ? text : restoredDraft, prof, {
    resolveWorkspaceDefinition: ({ source, wordInfo }) => openWorkspacePythonImportDefinition(ownerDoc, source, wordInfo),
    workspaceImportCandidates: () => workspacePythonImportCandidates(ownerDoc)
  });
  let savedValue = text;
  if (ownerDoc && typeof ownerDoc.savedText !== "string") ownerDoc.savedText = text;

  const bar = document.createElement("div"); bar.className = "run-bar";
  const runBtn = document.createElement("button"); runBtn.className = "run-go"; runBtn.type = "button"; runBtn.textContent = "▶";
  runBtn.dataset.shortcutAction = "runCode"; runBtn.dataset.shortcutTitle = "실행"; runBtn.dataset.shortcutAria = "true";
  const traceBtn = document.createElement("button"); traceBtn.className = "run-trace"; traceBtn.type = "button"; traceBtn.textContent = "단계 실행";
  traceBtn.title = "코드를 실행하며 줄별 변수 변화를 최대 300단계까지 기록";
  const analyzeBtn = document.createElement("button"); analyzeBtn.className = "run-analyze"; analyzeBtn.type = "button"; analyzeBtn.textContent = "진단";
  analyzeBtn.title = "코드를 실행하지 않고 문법과 자주 생기는 실수를 검사";
  const gradeBtn = document.createElement("button"); gradeBtn.className = "run-grade"; gradeBtn.type = "button"; gradeBtn.textContent = "채점";
  gradeBtn.title = "입력값과 기대 출력을 기준으로 현재 코드를 자동 채점";
  const saveBtn = document.createElement("button"); saveBtn.className = "run-save"; saveBtn.type = "button"; saveBtn.textContent = ".py 저장";
  saveBtn.dataset.shortcutAction = "saveCurrent"; saveBtn.dataset.shortcutTitle = "Python 파일 저장";
  // 일반 텍스트 편집기의 '보기로'도 run-revert 스타일을 공유하므로, 설정에서 숨길 Python 전용 표식은 따로 둔다.
  const revertBtn = document.createElement("button"); revertBtn.className = "run-revert run-py-revert"; revertBtn.type = "button"; revertBtn.textContent = "↩ 원본"; revertBtn.title = "편집 전 원본 코드로 되돌리기"; revertBtn.disabled = true;
  const pkgBtn = document.createElement("button"); pkgBtn.className = "run-pkg"; pkgBtn.type = "button"; pkgBtn.textContent = "라이브러리"; pkgBtn.hidden = true;
  const diagBtn = document.createElement("button"); diagBtn.className = "run-diag"; diagBtn.type = "button"; diagBtn.textContent = "Py Env"; diagBtn.title = "Python 실행 환경 진단";
  const outputTabs = document.createElement("span"); outputTabs.className = "run-output-tabs";
  // 터미널은 실행 결과와 분리된 모달 창으로 연다.
  const terminalTabBtn = document.createElement("button"); terminalTabBtn.className = "run-output-tab"; terminalTabBtn.type = "button"; terminalTabBtn.textContent = "터미널";
  terminalTabBtn.title = "명령 터미널 열기"; terminalTabBtn.setAttribute("aria-pressed", "false");
  outputTabs.append(terminalTabBtn);
  const nbConvertBtn = document.createElement("button"); nbConvertBtn.className = "run-nbconvert"; nbConvertBtn.type = "button"; nbConvertBtn.textContent = "노트북으로";
  nbConvertBtn.title = "현재 코드를 주피터 노트북(.ipynb)으로 변환해 새 탭으로 열기 (# %% 를 셀 경계로)";
  // 줄번호(거터)를 클릭해 셀 경계(# %%)를 넣고, 다시 눌러 노트북으로 변환하는 모드 토글
  const cellSplitBtn = document.createElement("button"); cellSplitBtn.className = "run-cellsplit"; cellSplitBtn.type = "button"; cellSplitBtn.textContent = "✂ 셀 나누기";
  cellSplitBtn.title = "줄번호(왼쪽)를 클릭해 셀 경계(# %%)를 넣/빼고, 다시 눌러 노트북으로 변환";
  const autoSplitBtn = document.createElement("button"); autoSplitBtn.className = "run-autosplit"; autoSplitBtn.type = "button"; autoSplitBtn.textContent = "자동분할";
  autoSplitBtn.title = "빈 줄 뒤 최상위 문장마다 셀 경계(# %%)를 자동으로 넣기";
  const nbConvertMore = document.createElement("button");
  nbConvertMore.className = "run-nbconvert-more"; nbConvertMore.type = "button"; nbConvertMore.textContent = "▾";
  nbConvertMore.title = "노트북 변환 방법"; nbConvertMore.setAttribute("aria-label", nbConvertMore.title);
  nbConvertMore.setAttribute("aria-haspopup", "menu"); nbConvertMore.setAttribute("aria-expanded", "false");
  const nbConvertMenu = document.createElement("span");
  nbConvertMenu.className = "run-nbconvert-menu"; nbConvertMenu.hidden = true; nbConvertMenu.setAttribute("role", "menu");
  cellSplitBtn.setAttribute("role", "menuitem"); autoSplitBtn.setAttribute("role", "menuitem");
  nbConvertMenu.append(cellSplitBtn, autoSplitBtn);
  const nbConvertGroup = document.createElement("span");
  nbConvertGroup.className = "run-nbconvert-group";
  nbConvertGroup.append(nbConvertBtn, nbConvertMore, nbConvertMenu);
  const linkBtn = document.createElement("button"); linkBtn.className = "run-link"; linkBtn.type = "button"; linkBtn.textContent = "PDF에 핀";
  linkBtn.title = "현재 코드 줄을 PDF에 핀으로 연결";
  // 필기 버튼 — 누르면 편집 잠금 + 캔버스 오버레이가 한 번에 켜짐. 다시 누르면 둘 다 해제.
  const inkBtn = document.createElement("button"); inkBtn.className = "run-ink"; inkBtn.type = "button"; inkBtn.title = "코드 위에 필기 — 켜는 동안 편집 잠금";
  if (typeof window.setUiIconLabel === "function") window.setUiIconLabel(inkBtn, "pen", "필기");
  else inkBtn.textContent = "필기";
  // 수업 리플레이 녹화 — 코드 편집·실행 결과(학습 화면이면 PDF 필기도)를 시간순으로 기록.
  // PDF 필기바의 ● 녹화와 같은 녹화기를 공유하므로 어느 쪽에서 시작/정지해도 상태가 맞는다.
  const recBtn = document.createElement("button"); recBtn.className = "run-rec"; recBtn.type = "button";
  const _T = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const _TF = (tmpl, vars) => (typeof window.tf === "function" ? window.tf(tmpl, vars) : String(tmpl).replace(/\{(\w+)\}/g, (_, key) => vars && vars[key] != null ? String(vars[key]) : _));
  const syncRecBtn = (on) => {
    recBtn.classList.toggle("recording", on);
    recBtn.textContent = _T(on ? "■ 정지" : "● 녹화");
    recBtn.title = _T(on ? "녹화 정지 — 지금까지 기록을 리플레이로 만들기"
      : "수업 리플레이 녹화 — 코드 편집·실행 결과(학습 화면이면 PDF 필기도)를 시간순으로 기록");
  };
  syncRecBtn(typeof lessonPdfRecording === "function" && lessonPdfRecording());
  recBtn.addEventListener("click", () => {
    if (typeof lessonPdfToggleRecord !== "function"){ toast("리플레이 기능을 불러오지 못했어요.", 2400); return; }
    syncRecBtn(lessonPdfToggleRecord());
  });
  const onRecChanged = (e) => syncRecBtn(!!(e.detail && e.detail.on));
  document.addEventListener("lesson-rec-changed", onRecChanged);
  if (ownerDoc){ if (!ownerDoc.cleanupFns) ownerDoc.cleanupFns = []; ownerDoc.cleanupFns.push(() => document.removeEventListener("lesson-rec-changed", onRecChanged)); }
  const status = document.createElement("span"); status.className = "run-status";
  const fontGroup = document.createElement("span"); fontGroup.className = "run-font-group";
  const fontDown = document.createElement("button"); fontDown.className = "run-font"; fontDown.type = "button"; fontDown.textContent = "A−"; fontDown.title = "코드·결과 글자 작게 (Ctrl+−)";
  const fontUp = document.createElement("button"); fontUp.className = "run-font"; fontUp.type = "button"; fontUp.textContent = "A+"; fontUp.title = "코드·결과 글자 크게 (Ctrl++)";
  fontDown.addEventListener("click", () => bumpCodeFont(-1));
  fontUp.addEventListener("click", () => bumpCodeFont(1));
  const fontPick = document.createElement("select"); fontPick.className = "run-font run-fontpick";
  fontPick.title = "코드 글꼴 (시스템에 설치된 글꼴만 · 고정폭/가변폭으로 나눠 표시)";
  fontPick.setAttribute("aria-label", fontPick.title);
  const fontGroups = groupedCodeFontChoices();
  const installed = [...fontGroups.mono, ...fontGroups.prop];
  // 저장된 폰트가 시스템에서 빠졌으면 기본으로 자동 폴백(드롭다운에 안 나타나는 옵션이 선택돼 보이는 혼란 방지).
  if (_codeFontFamily && !installed.some(c => c.value === _codeFontFamily)) setCodeFontFamily("");
  // 고정폭/가변폭을 묶어서 보여준다 — 코드 정렬이 맞는 글꼴을 한눈에 고를 수 있게.
  const addFontGroup = (label, list) => {
    if (!list.length) return;
    const g = document.createElement("optgroup"); g.label = label;
    for (const c of list){
      const o = document.createElement("option"); o.value = c.value; o.textContent = c.label;
      if (c.value === _codeFontFamily) o.selected = true;
      g.appendChild(o);
    }
    fontPick.appendChild(g);
  };
  addFontGroup("고정폭 (코딩용)", fontGroups.mono);
  addFontGroup("가변폭 (읽기용)", fontGroups.prop);
  fontPick.addEventListener("change", () => setCodeFontFamily(fontPick.value));
  // 후보가 기본 하나뿐이면(설치된 게 없으면) 드롭다운 자체를 숨겨 자리만 차지하지 않게 한다.
  if (installed.length <= 1) fontPick.hidden = true;
  fontGroup.append(fontDown, fontUp, fontPick);
  // 편집 흐름상 "고치다가 새로 열기"가 잦아서, 글자 크기 옆에 새 파이썬 코드 버튼을 둔다(사이드바 버튼은 그대로).
  const inFolder = !!(ownerDoc && ownerDoc.archiveCtx && runPathDir(normalizedRunPath(ownerDoc.relPath || ownerDoc.workspacePath || "")));
  const newPyTitle = inFolder ? "이 폴더에 새 파이썬 파일 · 같은 폴더 모듈 import 가능" : "새 파이썬 코드";
  const newPyBtn = document.createElement("button"); newPyBtn.className = "run-newpy"; newPyBtn.type = "button"; newPyBtn.textContent = "+Py";
  newPyBtn.dataset.shortcutAction = "newPython"; newPyBtn.dataset.shortcutTitle = newPyTitle; newPyBtn.dataset.shortcutAria = "true";
  newPyBtn.addEventListener("click", () => { if (typeof newPythonScratch === "function") newPythonScratch(); });
  // 정상 종료된 stderr 경고만 결과에서 숨기는 표시 설정. 실행 중 stderr는 보류하고 실제 오류는 완료 뒤 표시한다.
  const warningToggle = document.createElement("label"); warningToggle.className = "run-warning-toggle";
  const warningCheckbox = document.createElement("input"); warningCheckbox.type = "checkbox";
  const warningText = document.createElement("span"); warningText.textContent = "경고 표시";
  let showPythonWarnings = true;
  try { showPythonWarnings = localStorage.getItem("pythonShowWarnings") !== "0"; } catch(_){}
  warningCheckbox.checked = showPythonWarnings;
  warningToggle.title = "정상 실행 뒤 발생한 Python 경고를 실행 결과에 표시";
  warningToggle.append(warningCheckbox, warningText);
  // 실행 결과 위치 토글(편집기 옆 ↔ 아래) — 결과가 보일 때만 노출. 동작 연결은 split 생성 후(applyOutputLayout).
  const layoutBtn = document.createElement("button"); layoutBtn.className = "run-layout"; layoutBtn.type = "button"; layoutBtn.hidden = true;
  bar.appendChild(runBtn); bar.appendChild(traceBtn); bar.appendChild(analyzeBtn); bar.appendChild(gradeBtn); bar.appendChild(saveBtn); bar.appendChild(revertBtn); bar.appendChild(linkBtn); bar.appendChild(nbConvertGroup); bar.appendChild(inkBtn); bar.appendChild(recBtn); bar.appendChild(pkgBtn); bar.appendChild(diagBtn); bar.appendChild(outputTabs); bar.appendChild(fontGroup); bar.appendChild(newPyBtn); bar.appendChild(warningToggle); bar.appendChild(layoutBtn);   // 실행 상태(status) 문구는 화면에 표시하지 않음(노드는 setStatus 호환용으로만 유지)
  attachSpellcheck(editor, bar, (ownerDoc && ownerDoc.name) || file.name || "Python 맞춤법 검사");
  syncShortcutHints(bar);

  // 편집기 바로 위: 마지막으로 저장한 파일의 절대경로 표시. 저장 전엔 회색 안내문.
  const pathBar = document.createElement("div"); pathBar.className = "run-path";
  const pathText = document.createElement("span"); pathText.className = "run-path-text is-empty"; pathText.textContent = "저장하면 경로가 여기 표시됩니다";
  pathBar.append(pathText);
  const projectInfo = document.createElement("details"); projectInfo.className = "run-project-info";
  const projectSummary = document.createElement("summary"); projectSummary.textContent = "실행 작업폴더 · 실행 전";
  const projectBody = document.createElement("div"); projectBody.className = "run-project-body";
  projectInfo.append(projectSummary, projectBody);
  const projectRow = document.createElement("div"); projectRow.className = "run-project-row";
  const pathHelpBtn = document.createElement("button"); pathHelpBtn.type = "button"; pathHelpBtn.className = "run-path-help";
  pathHelpBtn.textContent = "경로 도우미"; pathHelpBtn.title = "파일 읽기·저장·import 경로를 현재 작업폴더 기준으로 확인";
  projectRow.append(projectInfo, pathHelpBtn);
  // 경로 도우미·작업폴더 패널은 편집기를 밀지 않고 그 위로 겹쳐 펼쳐진다(CSS 오버레이). 앵커는 projectRow.
  const pathHelpPanel = document.createElement("section"); pathHelpPanel.className = "py-path-help"; pathHelpPanel.hidden = true;
  projectRow.appendChild(pathHelpPanel);
  // 경로 도우미도 작업폴더 패널처럼 팝오버식으로: 바깥 클릭·Esc 로 닫는다. 리스너는 열릴 때만 단다.
  let pathHelpOutsideClose = null;
  const detachPathHelpOutside = () => {
    if (!pathHelpOutsideClose) return;
    document.removeEventListener("pointerdown", pathHelpOutsideClose, true);
    pathHelpOutsideClose = null;
  };
  const closePathHelp = () => { pathHelpPanel.hidden = true; detachPathHelpOutside(); };
  // 라이브러리 패널도 실행 바를 밀지 않는 팝오버로 연다. 닫힐 때 전역 리스너도 함께 정리한다.
  let pkgOutsideClose = null;
  const detachPkgOutside = () => {
    if (!pkgOutsideClose) return;
    document.removeEventListener("pointerdown", pkgOutsideClose, true);
    pkgOutsideClose = null;
  };
  const closePkg = () => { pkgWrap.hidden = true; detachPkgOutside(); };
  outer.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!pathHelpPanel.hidden){
      const focusWasInPanel = pathHelpPanel.contains(document.activeElement);
      e.preventDefault();
      e.stopPropagation();
      closePathHelp();
      if (focusWasInPanel){
        try { pathHelpBtn.focus({ preventScroll:true }); } catch(_) { pathHelpBtn.focus(); }
      }
      return;
    }
    if (!pkgWrap.hidden){
      const focusWasInPanel = pkgWrap.contains(document.activeElement);
      e.preventDefault();
      e.stopPropagation();
      closePkg();
      if (focusWasInPanel){
        try { pkgBtn.focus({ preventScroll:true }); } catch(_) { pkgBtn.focus(); }
      }
      return;
    }
    if (!projectInfo.open) return;
    const focusWasInList = projectBody.contains(document.activeElement);
    e.preventDefault();
    e.stopPropagation();
    projectInfo.open = false;
    if (focusWasInList){
      try { projectSummary.focus({ preventScroll:true }); } catch(_) { projectSummary.focus(); }
    }
  }, true);
  // 작업폴더 패널이 열려 있을 때 바깥을 클릭하면 접는다(팝오버식). 열릴 때만 리스너를 달아 부담을 없앤다.
  // 드래그 복사 경로(pathText)는 이 패널 위쪽 pathBar 에 있어 접혀도 안 밀리므로 복사가 깨지지 않는다.
  let projectOutsideClose = null;
  projectInfo.addEventListener("toggle", () => {
    if (projectInfo.open){
      if (projectOutsideClose) return;
      projectOutsideClose = (e) => {
        if (!document.contains(projectInfo)){   // 뷰어가 교체돼 패널이 사라졌으면 리스너 정리(누수 방지)
          document.removeEventListener("pointerdown", projectOutsideClose, true); projectOutsideClose = null; return;
        }
        if (!projectInfo.contains(e.target)) projectInfo.open = false;
      };
      document.addEventListener("pointerdown", projectOutsideClose, true);
    } else if (projectOutsideClose){
      document.removeEventListener("pointerdown", projectOutsideClose, true); projectOutsideClose = null;
    }
  });
  const setSavedPath = (p, options={}) => {
    const savedAbsPath = p || "";
    if (savedAbsPath){
      pathText.textContent = options.pending ? ("저장 예정 · " + savedAbsPath) : savedAbsPath;
      pathText.title = options.original
        ? "선택한 원본 폴더 기준 경로입니다. 브라우저 보안상 드라이브를 포함한 절대경로는 표시되지 않을 수 있습니다."
        : "드래그해서 복사할 수 있습니다";
      pathText.classList.remove("is-empty");
    } else {
      pathText.textContent = "저장하면 경로가 여기 표시됩니다"; pathText.removeAttribute("title");
      pathText.classList.add("is-empty");
    }
  };
  const initialDocPath = ownerDoc && (ownerDoc.workspacePath || ownerDoc.relPath);
  if (ownerDoc && ownerDoc.nativeAbsolutePath){
    setSavedPath(ownerDoc.nativeAbsolutePath);
  } else if (initialDocPath && ownerDoc.originalSaveMode){
    // 폴더 열기로 받은 File System Access 핸들은 브라우저 보안상 절대경로를 공개하지 않는다.
    // 대신 실제 원본 폴더 안에서 사용할 상대경로를 표시해 파일명만 경로처럼 보이는 혼란을 막는다.
    setSavedPath(initialDocPath, { original:true, pending:!!(ownerDoc.isScratch && !ownerDoc._named) });
  } else if (initialDocPath && !(ownerDoc && ownerDoc.isScratch && !ownerDoc._named)){
    setSavedPath(initialDocPath);
    displayPathForWorkspace(initialDocPath).then(p => {
      if (p && ownerDoc && (ownerDoc.workspacePath || ownerDoc.relPath)) setSavedPath(p);
    });
  }
  // 라이브러리 설치 패널(설치된 로컬 파이썬에서만 노출) — 세트 설치 + 직접 입력
  const pkgWrap = document.createElement("div"); pkgWrap.className = "run-pkg-wrap"; pkgWrap.hidden = true;
  const mkSet = (label, pkgs) => { const b = document.createElement("button"); b.type = "button"; b.className = "pkg-set"; b.textContent = label; b.addEventListener("click", () => runPipInstall(pkgs, ui)); return b; };
  const pkgCustom = document.createElement("input"); pkgCustom.className = "pkg-custom"; pkgCustom.type = "text"; pkgCustom.placeholder = "직접 입력: requests, pandas==2.2.2"; pkgCustom.title = "버전 지정 예: requests==2.31.0, pandas>=2.0\n버전은 패키지명 뒤에 붙여 입력하세요. (requests 2.31.0은 지원하지 않음)";
  const pkgVersionHint = document.createElement("span"); pkgVersionHint.className = "pkg-version-hint"; pkgVersionHint.textContent = "버전 지정: 패키지명==버전 (예: requests==2.31.0) · 여러 개는 공백 또는 쉼표로 구분";
  const pkgGo = document.createElement("button"); pkgGo.type = "button"; pkgGo.className = "pkg-go"; pkgGo.textContent = "설치";
  const doCustom = () => { const v = pkgCustom.value.trim(); if (v) runPipInstall(v.split(/[\s,]+/).filter(Boolean), ui); };
  pkgGo.addEventListener("click", doCustom);
  pkgCustom.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); doCustom(); } });
  const pkgList = document.createElement("button"); pkgList.type = "button"; pkgList.className = "pkg-set pkg-list"; pkgList.textContent = "설치된 목록"; pkgList.addEventListener("click", () => runPipList(ui));
  // requirements.txt 파일을 골라 적힌 라이브러리를 한 번에 설치
  const pkgFile = document.createElement("input"); pkgFile.type = "file"; pkgFile.accept = ".txt,.text,text/plain"; pkgFile.hidden = true;
  const pkgFileBtn = document.createElement("button"); pkgFileBtn.type = "button"; pkgFileBtn.className = "pkg-set pkg-file"; pkgFileBtn.textContent = "txt로 설치"; pkgFileBtn.title = "requirements.txt 등 라이브러리 목록 파일을 골라 한 번에 설치";
  pkgFileBtn.addEventListener("click", () => pkgFile.click());
  pkgFile.addEventListener("change", async () => {
    const f = pkgFile.files && pkgFile.files[0]; if (!f) return;
    let txt = "";
    try { txt = await f.text(); } catch(_){ toast("파일을 읽지 못했어요.", 3000); pkgFile.value = ""; return; }
    pkgFile.value = "";   // 같은 파일을 다시 고를 수 있게 초기화
    const pkgs = parseRequirements(txt);
    if (!pkgs.length){ toast("설치할 라이브러리를 찾지 못했어요. (빈 줄·주석만 있는 파일인가요?)", 4000); return; }
    if (pkgs.length > 40) toast("라이브러리가 " + pkgs.length + "개라 한 번에 40개까지만 설치돼요. 나머지는 파일을 나눠 설치해 주세요.", 6000);
    runPipInstall(pkgs.slice(0, 40), ui);
  });
  pkgWrap.append(mkSet("데이터 분석", ["matplotlib","openpyxl","seaborn","scipy"]), mkSet("크롤링", ["requests","beautifulsoup4","lxml"]), mkSet("DB(MySQL)", ["pymysql"]), pkgCustom, pkgGo, pkgVersionHint, pkgFileBtn, pkgFile, pkgList);
  // 설치 중에는 설치 관련 조작을 모두 잠근다 — pip 프로세스가 겹쳐 뜨거나 진행 표시가 지워지는 것을 막는다.
  const setPkgBusy = (busy) => {
    pkgWrap.querySelectorAll("button, input").forEach(el => { el.disabled = !!busy; });
    pkgBtn.disabled = !!busy;
    if (busy){ pkgBtn.setAttribute("aria-busy", "true"); pkgBtn.title = "라이브러리 설치가 끝나면 다시 열 수 있어요"; }
    else { pkgBtn.removeAttribute("aria-busy"); pkgBtn.removeAttribute("title"); }
  };
  // 패널은 실행 바의 자식으로 두고 절대 위치로 띄운다. 그래서 열어도 편집기 높이가 줄지 않는다.
  bar.appendChild(pkgWrap);
  pkgBtn.addEventListener("click", () => {
    if (!pkgWrap.hidden){ closePkg(); return; }
    closePathHelp();
    pkgWrap.hidden = false;
    if (pkgOutsideClose) return;
    pkgOutsideClose = (e) => {
      if (!document.contains(pkgWrap) || pkgWrap.hidden){ detachPkgOutside(); return; }
      if (pkgWrap.contains(e.target) || pkgBtn.contains(e.target)) return;
      closePkg();
    };
    document.addEventListener("pointerdown", pkgOutsideClose, true);
  });
  pythonBackendAvailable().then(ok => { if (ok) pkgBtn.hidden = false; });   // 로컬 파이썬일 때만

  diagBtn.addEventListener("click", () => openPythonEnvModal(diagBtn));
  refreshPythonEnvButton(diagBtn);

  const inputWrap = document.createElement("div"); inputWrap.className = "run-input-wrap";
  inputWrap.hidden = !usesInput(text);                  // input() 안 쓰면 숨김
  const inputLabel = document.createElement("label"); inputLabel.className = "run-input-label"; inputLabel.textContent = "입력값 (프로그램이 물어볼 값)";
  const inputFields = document.createElement("div"); inputFields.className = "run-input-fields"; inputFields.hidden = true;
  const inputHint = document.createElement("div"); inputHint.className = "run-input-hint"; inputHint.hidden = true;
  const stdin = document.createElement("textarea"); stdin.className = "run-stdin";
  stdin.placeholder = "input() 호출 순서대로 한 줄에 하나씩 적으세요. 예: 홍길동↵27↵1";
  inputWrap.append(inputLabel, inputFields, inputHint, stdin);

  const split = document.createElement("div"); split.className = "run-split";
  const applyWarningVisibility = (syncOpenEditors) => {
    showPythonWarnings = warningCheckbox.checked;
    split.classList.toggle("hide-python-warnings", !showPythonWarnings);
    if (syncOpenEditors){
      document.querySelectorAll(".run-warning-toggle input[type=checkbox]").forEach((input) => { input.checked = showPythonWarnings; });
      document.querySelectorAll(".run-split").forEach((runSplit) => runSplit.classList.toggle("hide-python-warnings", !showPythonWarnings));
    }
  };
  applyWarningVisibility();
  warningCheckbox.addEventListener("change", () => {
    applyWarningVisibility(true);
    try { localStorage.setItem("pythonShowWarnings", showPythonWarnings ? "1" : "0"); } catch(_){}
  });
  const divider = document.createElement("div"); divider.className = "run-divider";
  divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.tabIndex = 0;
  const outPanel = document.createElement("div"); outPanel.className = "code-output";
  outPanel.tabIndex = 0;
  outPanel.setAttribute("aria-label", _T("실행 결과"));
  const outHideBtn = document.createElement("button"); outHideBtn.className = "out-hide"; outHideBtn.type = "button";
  const outFindBtn = document.createElement("button"); outFindBtn.className = "out-find-open"; outFindBtn.type = "button";
  outFindBtn.setAttribute("aria-haspopup", "true"); outFindBtn.setAttribute("aria-expanded", "false");
  const outFindIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  outFindIcon.setAttribute("viewBox", "0 0 24 24"); outFindIcon.setAttribute("aria-hidden", "true");
  const outFindCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  outFindCircle.setAttribute("cx", "10.5"); outFindCircle.setAttribute("cy", "10.5"); outFindCircle.setAttribute("r", "6");
  const outFindPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outFindPath.setAttribute("d", "m15 15 5 5");
  outFindIcon.append(outFindCircle, outFindPath); outFindBtn.appendChild(outFindIcon);
  const outHeadActions = document.createElement("span"); outHeadActions.className = "out-head-actions out-chrome";
  outHeadActions.append(outFindBtn, outHideBtn);

  const outFindBar = document.createElement("div"); outFindBar.className = "out-find-bar out-chrome"; outFindBar.hidden = true;
  const outFindInput = document.createElement("input"); outFindInput.className = "out-find-input"; outFindInput.type = "search";
  outFindInput.autocomplete = "off"; outFindInput.spellcheck = false;
  const outFindCount = document.createElement("span"); outFindCount.className = "out-find-count";
  const outFindPrev = document.createElement("button"); outFindPrev.className = "out-find-nav"; outFindPrev.type = "button"; outFindPrev.textContent = "↑";
  const outFindNext = document.createElement("button"); outFindNext.className = "out-find-nav"; outFindNext.type = "button"; outFindNext.textContent = "↓";
  const outFindClose = document.createElement("button"); outFindClose.className = "out-find-close"; outFindClose.type = "button"; outFindClose.textContent = "✕";
  outFindBar.append(outFindInput, outFindCount, outFindPrev, outFindNext, outFindClose);
  const outFindLayer = document.createElement("div"); outFindLayer.className = "out-find-layer out-chrome";
  outFindLayer.setAttribute("aria-hidden", "true");

  let outputFindOpen = false, outputFindMatches = [], outputFindIndex = -1, outputFindTruncated = false;
  let outputFindTimer = 0, outputFindRaf = 0;
  const OUTPUT_FIND_LIMIT = 2000;
  const syncOutputFindLabels = () => {
    const label = _T("실행 결과에서 찾기");
    outFindBtn.title = label + " (Ctrl+H)"; outFindBtn.setAttribute("aria-label", outFindBtn.title);
    outFindInput.placeholder = label; outFindInput.setAttribute("aria-label", label);
    outFindPrev.title = _T("이전 결과") + " (Shift+Enter)"; outFindPrev.setAttribute("aria-label", outFindPrev.title);
    outFindNext.title = _T("다음 결과") + " (Enter)"; outFindNext.setAttribute("aria-label", outFindNext.title);
    outFindClose.title = _T("닫기 (Esc)"); outFindClose.setAttribute("aria-label", outFindClose.title);
  };
  const syncOutputHideLabel = () => {
    const label = _T("실행 결과 숨기기");
    outHideBtn.title = label; outHideBtn.setAttribute("aria-label", label);
  };
  const syncOutputHideIcon = (stacked) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", stacked ? "M7 9l5 5 5-5" : "M9 7l5 5-5 5");
    svg.appendChild(path); outHideBtn.replaceChildren(svg);
  };
  syncOutputHideLabel(); syncOutputFindLabels();
  const isOutputChromeNode = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && (el.classList.contains("out-chrome") || el.closest(".out-chrome")));
  };
  // 실행 결과 렌더러들이 panel.innerHTML 을 교체해도 검색·숨기기 도구는 현재 헤더에 다시 붙인다.
  const attachOutputChrome = () => {
    const head = outPanel.querySelector(".out-head");
    if (head){
      if (outHeadActions.parentNode !== head) head.appendChild(outHeadActions);
      // 일반 실행 결과의 헤더는 outPanel 직계 자식이지만 터미널 헤더는 .py-terminal 안에 있다.
      // 부모를 무조건 outPanel 로 검사하면 MutationObserver가 같은 검색 바를 안팎으로 계속 옮겨
      // 메인 스레드가 멈춘다. 실제 헤더 부모를 기준으로 한 번만 붙인다.
      const headParent = head.parentNode || outPanel;
      if (outFindBar.parentNode !== headParent || outFindBar.previousElementSibling !== head) head.insertAdjacentElement("afterend", outFindBar);
    } else {
      if (outHeadActions.parentNode !== outPanel) outPanel.insertBefore(outHeadActions, outPanel.firstChild);
      if (outFindBar.parentNode !== outPanel) outPanel.insertBefore(outFindBar, outHeadActions.nextSibling);
    }
    if (outFindLayer.parentNode !== outPanel) outPanel.appendChild(outFindLayer);
  };
  const clearOutputFindHighlights = () => {
    outFindLayer.replaceChildren();
  };
  const renderOutputFindHighlights = () => {
    cancelAnimationFrame(outputFindRaf);
    outputFindRaf = requestAnimationFrame(() => {
      outputFindRaf = 0; clearOutputFindHighlights();
      if (!outputFindOpen || !outputFindMatches.length) return;
      const panelRect = outPanel.getBoundingClientRect();
      const head = outPanel.querySelector(".out-head");
      const visibleTop = Math.max(panelRect.top, !outFindBar.hidden
        ? outFindBar.getBoundingClientRect().bottom
        : (head ? head.getBoundingClientRect().bottom : panelRect.top));
      const visibleBottom = panelRect.bottom;
      const frag = document.createDocumentFragment();
      outputFindMatches.forEach((match, matchIndex) => {
        Array.from(match.range.getClientRects()).forEach((rect) => {
          // 스크롤 영역 밖의 Range rect를 절대 좌표로 그리면 일부 브라우저에서 패널 안쪽에
          // 빈 강조 박스처럼 나타난다. 현재 실제로 보이는 글자 조각만 그리고 스크롤 때 다시 계산한다.
          if (!rect.width || !rect.height || rect.bottom <= visibleTop || rect.top >= visibleBottom ||
              rect.right <= panelRect.left || rect.left >= panelRect.right) return;
          const clippedLeft = Math.max(rect.left, panelRect.left);
          const clippedRight = Math.min(rect.right, panelRect.right);
          const clippedTop = Math.max(rect.top, visibleTop);
          const clippedBottom = Math.min(rect.bottom, visibleBottom);
          const box = document.createElement("span");
          box.className = "out-find-hit" + (matchIndex === outputFindIndex ? " active" : "");
          box.style.left = (clippedLeft - panelRect.left + outPanel.scrollLeft) + "px";
          box.style.top = (clippedTop - panelRect.top + outPanel.scrollTop) + "px";
          box.style.width = (clippedRight - clippedLeft) + "px";
          box.style.height = (clippedBottom - clippedTop) + "px";
          frag.appendChild(box);
        });
      });
      outFindLayer.appendChild(frag);
    });
  };
  const updateOutputFindCount = () => {
    if (!outFindInput.value){ outFindCount.textContent = ""; return; }
    if (!outputFindMatches.length){ outFindCount.textContent = "0/0"; return; }
    outFindCount.textContent = (outputFindIndex + 1) + "/" + outputFindMatches.length + (outputFindTruncated ? "+" : "");
  };
  const outputFindTextNodeAllowed = (node) => {
    const el = node && node.parentElement;
    if (!el || isOutputChromeNode(el)) return false;
    if (el.closest(".out-head,.out-vars,.code-pen-overlay,button,input,textarea,select,script,style,svg,[hidden]")) return false;
    // 접힌 변수·채점·진단 details 내부는 화면에 보이지 않으므로 검색 개수와 이동 대상에서 제외한다.
    // summary 자체는 접힌 상태에서도 보이므로 계속 검색할 수 있다.
    const closedDetails = el.closest("details:not([open])");
    if (closedDetails && !el.closest("summary")) return false;
    if (!el.getClientRects().length) return false;
    if (split.classList.contains("hide-python-warnings") && el.closest(".out-warn")) return false;
    return true;
  };
  const recomputeOutputFind = (resetIndex) => {
    clearTimeout(outputFindTimer); outputFindTimer = 0;
    outputFindMatches = []; outputFindTruncated = false;
    const query = outFindInput.value;
    if (outputFindOpen && query){
      const needle = query.toLocaleLowerCase();
      const walker = document.createTreeWalker(outPanel, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => outputFindTextNodeAllowed(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      let node;
      outer: while ((node = walker.nextNode())){
        const hay = String(node.nodeValue || "").toLocaleLowerCase();
        let from = 0, at;
        while ((at = hay.indexOf(needle, from)) !== -1){
          const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + query.length);
          outputFindMatches.push({ range });
          if (outputFindMatches.length >= OUTPUT_FIND_LIMIT){ outputFindTruncated = true; break outer; }
          from = at + Math.max(1, query.length);
        }
      }
    }
    if (resetIndex) outputFindIndex = outputFindMatches.length ? 0 : -1;
    else outputFindIndex = outputFindMatches.length ? Math.max(0, Math.min(outputFindIndex, outputFindMatches.length - 1)) : -1;
    updateOutputFindCount(); renderOutputFindHighlights();
  };
  const scheduleOutputFind = (resetIndex, delay=90) => {
    clearTimeout(outputFindTimer);
    outputFindTimer = setTimeout(() => recomputeOutputFind(resetIndex), delay);
  };
  const scrollToOutputFindMatch = () => {
    const match = outputFindMatches[outputFindIndex]; if (!match) return;
    const rect = match.range.getBoundingClientRect(), panelRect = outPanel.getBoundingClientRect();
    const head = outPanel.querySelector(".out-head");
    const chromeBottom = !outFindBar.hidden ? outFindBar.getBoundingClientRect().bottom
      : (head ? head.getBoundingClientRect().bottom : panelRect.top);
    // 화면 밖일 때만, 찾기 바 아래 가시 영역의 위쪽 40% 지점으로 올린다(가장자리에 붙지 않게).
    if (rect.top < chromeBottom + 6 || rect.bottom > panelRect.bottom - 8){
      const visibleH = Math.max(0, panelRect.bottom - chromeBottom);
      const want = chromeBottom + Math.max(8, (visibleH - rect.height) * 0.4);
      outPanel.scrollTop += rect.top - want;
    }
  };
  const goOutputFindMatch = (delta) => {
    if (!outputFindMatches.length){ updateOutputFindCount(); return; }
    outputFindIndex = (outputFindIndex + delta + outputFindMatches.length) % outputFindMatches.length;
    updateOutputFindCount(); renderOutputFindHighlights();
    requestAnimationFrame(scrollToOutputFindMatch);
  };
  const outputFindSelectionSeed = () => {
    try {
      const selection = window.getSelection && window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount ||
          !outPanel.contains(selection.anchorNode) || !outPanel.contains(selection.focusNode)) return "";
      const value = String(selection).trim();
      return value && !value.includes("\n") && value.length <= 200 ? value : "";
    } catch(_){ return ""; }
  };
  const openOutputFind = (seed) => {
    attachOutputChrome(); outputFindOpen = true; outFindBar.hidden = false; outFindBtn.setAttribute("aria-expanded", "true");
    const selected = typeof seed === "string" ? seed : outputFindSelectionSeed();
    if (selected && selected !== outFindInput.value) outFindInput.value = selected;
    recomputeOutputFind(true);
    outFindInput.focus(); outFindInput.select();
  };
  const closeOutputFind = (restoreFocus=true) => {
    outputFindOpen = false; outFindBar.hidden = true; outFindBtn.setAttribute("aria-expanded", "false");
    outputFindMatches = []; outputFindIndex = -1; outputFindTruncated = false;
    clearOutputFindHighlights(); updateOutputFindCount();
    if (restoreFocus) outFindBtn.focus({ preventScroll:true });
  };
  const outputChromeObserver = new MutationObserver((records) => {
    attachOutputChrome();
    if (!outputFindOpen) return;
    const contentChanged = records.some((record) => {
      if (isOutputChromeNode(record.target)) return false;
      const changed = Array.from(record.addedNodes).concat(Array.from(record.removedNodes));
      return !changed.length || !changed.every(isOutputChromeNode);
    });
    if (contentChanged) scheduleOutputFind(false, 120);
  });
  const outputFindResizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => { if (outputFindOpen) renderOutputFindHighlights(); })
    : null;
  if (outputFindResizeObserver) outputFindResizeObserver.observe(outPanel);
  const onOutputFindScroll = () => { if (outputFindOpen) renderOutputFindHighlights(); };
  const onOutputDetailsToggle = (e) => {
    if (outputFindOpen && e.target && e.target.matches && e.target.matches("details")) scheduleOutputFind(false, 0);
  };
  outPanel.addEventListener("scroll", onOutputFindScroll, { passive:true });
  outPanel.addEventListener("toggle", onOutputDetailsToggle, true);
  outPanel.append(outHeadActions, outFindBar, outFindLayer);
  outputChromeObserver.observe(outPanel, { childList:true, subtree:true });
  outFindBtn.addEventListener("click", () => outputFindOpen ? closeOutputFind(false) : openOutputFind());
  outFindInput.addEventListener("input", (e) => { if (!e.isComposing) scheduleOutputFind(true); });
  outFindInput.addEventListener("compositionend", () => scheduleOutputFind(true, 0));
  outFindInput.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter"){ e.preventDefault(); goOutputFindMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape"){ e.preventDefault(); closeOutputFind(); }
  });
  outFindPrev.addEventListener("click", () => { goOutputFindMatch(-1); outFindInput.focus(); });
  outFindNext.addEventListener("click", () => { goOutputFindMatch(1); outFindInput.focus(); });
  outFindClose.addEventListener("click", () => closeOutputFind());
  outHideBtn.addEventListener("click", () => {
    if (outputFindOpen) closeOutputFind(false);
    split.classList.remove("show-out");
    layoutBtn.hidden = false;
    editor.ta.focus({ preventScroll:true });
  });
  split.append(editor.host, divider, outPanel);
  attachRunSplitter(split, divider);
  outer.appendChild(bar); outer.appendChild(inputWrap); outer.appendChild(pathBar); outer.appendChild(projectRow); outer.appendChild(split);
  // 동적 툴바(실행 바·라이브러리·경로 안내)를 현재 UI 언어로 번역 — 코드 편집기 본문(split)은 제외.
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") {
    [bar, inputWrap, pathBar, projectRow].forEach((el) => window.MNI18N.translateTree(el));
  }
  host.appendChild(outer);

  const ui = { btn: runBtn, traceBtn, analyzeBtn, gradeBtn, status, outPanel, split, stdin, inputWrap, editorTa: editor.ta,
    projectInfo, projectSummary, projectBody, pathHelpBtn, pathHelpPanel };
  ui.openOutputFind = openOutputFind;
  ui.closeOutputFind = closeOutputFind;
  ui.closePathHelp = closePathHelp;
  ui.openPathHelp = () => {
    closePkg();
    pathHelpPanel.hidden = false;
    renderPythonPathHelper(pathHelpPanel, editor.getValue(), runCtxWithDoc, ui);   // 오버레이라 스크롤 보정 불필요
    if (pathHelpOutsideClose) return;
    pathHelpOutsideClose = (e) => {
      if (!document.contains(pathHelpPanel) || pathHelpPanel.hidden){ detachPathHelpOutside(); return; }  // 뷰어 교체·다른 경로로 닫힘 → 리스너 정리(누수 방지)
      if (pathHelpPanel.contains(e.target)) return;
      if (pathHelpBtn.contains(e.target)) return;   // 토글 버튼 클릭은 click 핸들러가 처리(여기서 닫으면 다시 열려버림)
      closePathHelp();
    };
    document.addEventListener("pointerdown", pathHelpOutsideClose, true);
  };
  pathHelpBtn.addEventListener("click", () => {
    if (pathHelpPanel.hidden) ui.openPathHelp();
    else closePathHelp();
  });
  ui.markError = (n) => editor.markError(n);                    // 실행 에러 줄 강조 / 해제(수정 시 자동 해제)
  ui.markErrorLines = (lines) => editor.markErrorLines(lines);
  ui.setDiagnosticItems = (items) => editor.setDiagnosticItems(items); // 진단 심각도·설명까지 보존해 줄 색상과 호버에 반영
  ui.focusError = (n) => { editor.markError(n); editor.ta.focus(); };
  ui.focusLine = (n) => editor.focusLine(n);
  ui.showTraceLine = (n) => editor.showTraceLine(n);
  ui.clearTraceLine = () => editor.clearTraceLine();
  ui.focusErrorLocation = (fileBase, line) => {
    const target = docs.find((doc) => {
      const base = String(doc.workspacePath || doc.relPath || doc.name || "").replace(/\\/g, "/").split("/").pop();
      return base === fileBase && (doc.codeEditor || doc.codeViewer);
    });
    if (!target) return false;
    if (typeof setActiveDoc === "function") setActiveDoc(target.id);
    const navigator = target.codeEditor || target.codeViewer;
    if (navigator && navigator.focusLine) navigator.focusLine(line);
    else target.pendingFocusLine = line;
    return true;
  };
  ui.clearError = () => editor.clearError();
  // 에러 줄 매칭에 쓸 파일명(로컬 단일 실행은 script.py, 번들은 대상 파일 basename)
  ui.fileBase = String((effectiveRunCtx && effectiveRunCtx.relPath) || (file && file.name) || (ownerDoc && ownerDoc.name) || "").replace(/\\/g, "/").split("/").pop();
  // archiveCtx 는 '진짜 압축(zip/tar)'과 '폴더로 연 파일'이 모두 갖는다. 폴더 컨텍스트는 isFolderContext 로 구분된다.
  // 저장 대상·안내 문구가 다르므로(zip 은 원본을 못 쓰고 별도 파일, 폴더는 원본 파일에 되쓰기) 여기서 나눠 둔다.
  const runArchiveCtx = effectiveRunCtx && effectiveRunCtx.archiveCtx;
  const fromArchive = !!(runArchiveCtx && effectiveRunCtx.relPath);
  const fromZip = fromArchive && !runArchiveCtx.isFolderContext;   // 원본 압축을 다시 못 쓰는 진짜 zip/tar
  const fromFolder = fromArchive && !fromZip;                       // 원본 파일에 되쓸 수 있는 폴더 열기
  const makeIdleMessage = () => "";
  let idleMsg = makeIdleMessage();
  status.textContent = restoredDraft === null ? idleMsg : "자동 복구된 편집본 · 저장하거나 원본으로 되돌리세요";
  const onStatusLanguageChange = () => {
    syncOutputHideLabel(); syncOutputFindLabels();
    outPanel.setAttribute("aria-label", _T("실행 결과"));
    if (status.textContent !== idleMsg) return;
    idleMsg = makeIdleMessage();
    status.textContent = idleMsg;
  };
  window.addEventListener("mni18nchange", onStatusLanguageChange);
  if (ownerDoc){
    if (!ownerDoc.cleanupFns) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      window.removeEventListener("mni18nchange", onStatusLanguageChange);
      outputChromeObserver.disconnect();
      if (outputFindResizeObserver) outputFindResizeObserver.disconnect();
      outPanel.removeEventListener("scroll", onOutputFindScroll);
      outPanel.removeEventListener("toggle", onOutputDetailsToggle, true);
      clearTimeout(outputFindTimer); cancelAnimationFrame(outputFindRaf);
    });
  }
  // 실행 결과를 편집기 옆(가로) ↔ 아래(세로)로 토글. 선택은 저장되어 다음에 열 때도 유지.
  ui.layoutBtn = layoutBtn;
  // 패키지 설치(runPipInstall)가 진행 표시를 가리는 팝오버를 닫고 설치 조작을 잠글 수 있게 넘겨준다.
  ui.closePkg = closePkg;
  ui.setPkgBusy = setPkgBusy;
  let outputStacked = false;
  try { outputStacked = localStorage.getItem("pythonSplitDir") === "col"; } catch(e){}
  const applyOutputLayout = () => {
    split.classList.toggle("stack-v", outputStacked);
    divider.setAttribute("aria-orientation", outputStacked ? "horizontal" : "vertical");
    layoutBtn.textContent = outputStacked ? "Side" : "Below";
    layoutBtn.title = outputStacked ? "실행 결과를 편집기 오른쪽 옆으로" : "실행 결과를 편집기 아래로";
    layoutBtn.setAttribute("aria-label", layoutBtn.title);
    syncOutputHideIcon(outputStacked);
  };
  const saveOutputLayout = () => {
    try { localStorage.setItem("pythonSplitDir", outputStacked ? "col" : "row"); } catch(e){}
  };
  const hasOutputContent = () => Array.from(outPanel.children).some((child) =>
    !(child.classList && (child.classList.contains("out-chrome") || child.classList.contains("code-pen-overlay")))
  );
  const handleOutputDirectionShortcut = (e) => {
    const command = typeof pythonOutputShortcutCommand === "function" ? pythonOutputShortcutCommand(e) : "";
    if (!command) return false;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return true;
    if (command === "show-right" || command === "show-below") {
      outputStacked = command === "show-below";
      saveOutputLayout();
      applyOutputLayout();
      if (hasOutputContent()) {
        split.classList.add("show-out");
        layoutBtn.hidden = false;
      } else {
        split.classList.remove("show-out");
        toast(_T(outputStacked
          ? "실행하면 결과를 아래에 표시합니다."
          : "실행하면 결과를 오른쪽에 표시합니다."), 2600);
      }
      return true;
    }
    const hidingMatchingLayout = split.classList.contains("show-out") &&
      ((command === "hide-right" && !outputStacked) || (command === "hide-below" && outputStacked));
    if (hidingMatchingLayout) split.classList.remove("show-out");
    return true;
  };
  const outputOwnsFindShortcut = (e) => outPanel.contains(e.target) || !!outputFindSelectionSeed();
  // 코드 입력뿐 아니라 실행 버튼·대화형 결과에 포커스가 있어도 같은 패널 안에서는 동작한다.
  outer.addEventListener("keydown", (e) => {
    if (typeof shortcutMatches === "function" && shortcutMatches(e, "findInDocument") && outputOwnsFindShortcut(e)){
      e.preventDefault(); e.stopPropagation(); openOutputFind(); return;
    }
    if (outputFindOpen && e.key === "F3"){
      e.preventDefault(); e.stopPropagation(); goOutputFindMatch(e.shiftKey ? -1 : 1); return;
    }
    if (outputFindOpen && e.key === "Escape" && outPanel.contains(e.target)){
      e.preventDefault(); e.stopPropagation(); closeOutputFind(); return;
    }
    handleOutputDirectionShortcut(e);
  });
  layoutBtn.addEventListener("click", () => {
    outputStacked = !outputStacked;
    saveOutputLayout();
    applyOutputLayout();
    split.classList.add("show-out");
  });
  applyOutputLayout();
  // keepEditorFocus: Ctrl+Enter 로 실행하면 편집을 이어가도록 에디터에 커서를 유지(▶ 버튼 클릭은 평소대로 터미널로 포커스)
  const runCtxWithDoc = { ...(effectiveRunCtx || {}), ownerDoc };
  updateRunProjectPanel(ui, null, runCtxWithDoc);
  const isNotebook = !!(ownerDoc && ownerDoc.notebook);   // .ipynb 변환 문서는 셀 단위로 실행
  let pythonTerminal = null;
  if (isNotebook){
    outputTabs.hidden = true;
    setupNotebookKernelBar(ownerDoc, editor, ui, outer, split);   // 셀 하나씩 실행하는 브라우저 커널 툴바
    // 이미 노트북 문서면 셀 나누기·자동분할은 의미 없으므로 감춘다(커널 바에서 셀을 직접 다룸).
    cellSplitBtn.hidden = true; autoSplitBtn.hidden = true; nbConvertMore.hidden = true;
    // 보조 버튼은 접지 않고 그대로 노출한다. 노출/숨김은 설정 '도구' 탭에서 사용자가 직접 고른다.
  } else {
    if (typeof createPythonTerminal === "function"){
      pythonTerminal = createPythonTerminal({
        ui,
        runCtx:runCtxWithDoc,
        ownerDoc,
        toggleButton:terminalTabBtn
      });
      ui.showResultTab = () => pythonTerminal.showResults();
    } else {
      terminalTabBtn.disabled = true;
      terminalTabBtn.title = "터미널 기능을 불러오지 못했습니다";
    }
  }
  const run = (keepEditorFocus) => runPythonSource(editor.getValue(), ui, runCtxWithDoc, keepEditorFocus === true, isNotebook ? { notebookCells: true } : undefined);
  ui.rerun = () => run(false);                 // 대화형 터미널의 ↻ 재실행 버튼이 호출(▶ 버튼과 동일)
  runBtn.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else run(false);
  });
  traceBtn.addEventListener("click", () => runPythonSource(editor.getValue(), ui, runCtxWithDoc, false, { traceMode:true }));
  analyzeBtn.addEventListener("click", () => runPythonSource(editor.getValue(), ui, runCtxWithDoc, false, { diagnoseMode:true }));
  gradeBtn.addEventListener("click", () => openAssignmentGradingModal({
    storageKey: "pdf-signer-python-grade:" + draftKey.slice(PY_DRAFT_PREFIX.length),
    onRun: (tests) => runPythonSource(editor.getValue(), ui, runCtxWithDoc, false, { gradeTests:tests }),
    // 과제 패키지(.task) 내보내기 — 현재 코드를 시작 코드로 넘긴다
    taskExport: {
      getSource: () => editor.getValue(),
      suggestedTitle: String((ownerDoc && ownerDoc.name) || "과제").replace(/\.(py|pyw|ipynb)$/i, "")
    }
  }));
  // 과제 패키지(.task)로 연 문서면 편집기 위에 과제 바(제목·점수·채점·제출)를 붙인다.
  if (ownerDoc && ownerDoc.taskCtx && typeof mountTaskBanner === "function"){
    mountTaskBanner(ownerDoc, ui, runCtxWithDoc, { bar, getCode: () => editor.getValue() });
  }
  linkBtn.addEventListener("click", () => {
    if (typeof createCodeLinkFromCodeDoc === "function") createCodeLinkFromCodeDoc(ownerDoc);
  });
  const closeNbConvertMenu = () => {
    nbConvertMenu.hidden = true;
    nbConvertMore.setAttribute("aria-expanded", "false");
  };
  nbConvertMore.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = nbConvertMenu.hidden;
    nbConvertMenu.hidden = !open;
    nbConvertMore.setAttribute("aria-expanded", String(open));
  });
  const onNbConvertOutside = (event) => {
    if (!nbConvertGroup.contains(event.target)) closeNbConvertMenu();
  };
  const onNbConvertEscape = (event) => {
    if (event.key !== "Escape") return;
    if (editor.isCellSplitMode && editor.isCellSplitMode()){
      event.preventDefault(); event.stopPropagation();
      cancelCellSplit();
      editor.ta.focus();
      return;
    }
    if (!nbConvertMenu.hidden){
      event.preventDefault(); closeNbConvertMenu(); nbConvertMore.focus();
    }
  };
  document.addEventListener("click", onNbConvertOutside);
  document.addEventListener("keydown", onNbConvertEscape, true);
  if (ownerDoc && Array.isArray(ownerDoc.cleanupFns)){
    ownerDoc.cleanupFns.push(() => {
      document.removeEventListener("click", onNbConvertOutside);
      document.removeEventListener("keydown", onNbConvertEscape, true);
    });
  }
  // 셀 나누기 모드에서는 진입 직전 코드를 보관한다. 취소하면 # %% 추가를 포함한 편집을 원본으로 되돌린다.
  let cellSplitSnapshot = null;
  const exitCellSplit = (restore) => {
    if (restore && cellSplitSnapshot !== null && editor.getValue() !== cellSplitSnapshot){
      editor.setValue(cellSplitSnapshot);
    }
    editor.setCellSplitMode(false);
    cellSplitBtn.classList.remove("is-active");
    cellSplitBtn.textContent = "✂ 셀 나누기";
    cellSplitBtn.title = "줄번호(왼쪽)를 클릭해 셀 경계(# %%)를 넣/빼고, 분할 완료로 노트북 변환";
    nbConvertBtn.textContent = "노트북으로";
    nbConvertBtn.classList.remove("is-active");
    nbConvertBtn.title = "현재 코드를 주피터 노트북(.ipynb)으로 변환해 새 탭으로 열기 (# %% 를 셀 경계로)";
    cellSplitSnapshot = null;
  };
  const cancelCellSplit = () => {
    if (!(editor.isCellSplitMode && editor.isCellSplitMode())) return;
    exitCellSplit(true);
    if (typeof toast === "function") toast("셀 나누기를 취소하고 시작 전 코드로 되돌렸어요.", 2600);
  };
  nbConvertBtn.addEventListener("click", () => {
    if (editor.isCellSplitMode && editor.isCellSplitMode()) exitCellSplit(false);
    convertPyEditorToNotebook(editor.getValue(), ownerDoc);
  });
  cellSplitBtn.addEventListener("click", () => {
    closeNbConvertMenu();
    if (editor.isCellSplitMode && editor.isCellSplitMode()){
      cancelCellSplit();
      return;
    }
    cellSplitSnapshot = editor.getValue();
    const splitReadyValue = ensureFirstNotebookCellMarker(cellSplitSnapshot);
    if (splitReadyValue !== cellSplitSnapshot) editor.setValue(splitReadyValue);
    editor.setCellSplitMode(true);
    cellSplitBtn.classList.add("is-active");
    cellSplitBtn.textContent = "× 셀 나누기 취소";
    cellSplitBtn.title = "셀 나누기를 취소하고 시작 전 코드로 복원";
    nbConvertBtn.textContent = "✓ 분할 완료";
    nbConvertBtn.classList.add("is-active");
    nbConvertBtn.title = "셀 경계 편집을 마치고 노트북으로 변환";
    if (typeof toast === "function") toast("줄번호를 클릭해 셀 경계를 조정하세요. '분할 완료'는 변환, Esc는 취소입니다.", 4600);
  });
  autoSplitBtn.addEventListener("click", () => {
    closeNbConvertMenu();
    const changed = editor.autoSplitCells && editor.autoSplitCells();
    if (typeof toast === "function") toast(changed
      ? "빈 줄 기준으로 셀 경계(# %%)를 넣었어요. 필요하면 거터 클릭으로 조정하세요."
      : "추가할 경계가 없어요(이미 나뉘었거나 빈 줄 구분이 없음).", 3600);
  });
  let pyAutosaveTimer = 0;
  let pyAutosaveSaving = null;
  let pyAutosaveAgain = false;
  let pyAutosaveDisposed = false;
  let pyManualSaveActive = false;
  saveBtn.addEventListener("click", async () => {
    pyManualSaveActive = true;
    clearTimeout(pyAutosaveTimer); pyAutosaveTimer = 0;
    saveBtn.disabled = true;
    if (ownerDoc){ ownerDoc._pyAutosaveState = ""; updateDocumentStatus(ownerDoc); }
    if (pyAutosaveSaving) await pyAutosaveSaving;
    // 저장 시 자동 정렬 — 명시적 저장(Ctrl+S·.py 저장)에서만. 백그라운드 자동 저장에는 적용하지 않아
    // 타이핑 도중 커서가 튀지 않게 한다. 로컬 파이썬이면 black, 아니면 경량 재들여쓰기로 정리 후 저장.
    if (appSettings.pyFormatOnSave && typeof editor.formatDocument === "function"){
      try { await editor.formatDocument({ backend: true, silent: true }); } catch(_){}
    }
    const value = editor.getValue();
    let name = (ownerDoc && ownerDoc.name) || (file && file.name) || "practice.py";
    let persisted = false;
    // 폴더로 연 파일이 원본 파일 핸들(File System Access)을 들고 있으면, 서버 사본(SaveRoot) 대신
    // 그 핸들로 원본 파일에 바로 되쓴다 → 폴더에서 연 파일은 '원본 자리'에 저장된다.
    const hasFolderOriginalHandle = !!(fromFolder && ownerDoc && ownerDoc.fsHandle
      && typeof ownerDoc.fsHandle.createWritable === "function");
    const saveToOriginal = !!(ownerDoc && ownerDoc.originalSaveMode) || hasFolderOriginalHandle;
    try {
      const canSaveViaServer = !saveToOriginal && await saveFileBackendAvailable();
      // EXE 자동 저장과 원본 폴더의 새 파일 생성은 별도 파일 선택 창이 없으므로 첫 저장 전에 이름을 정한다.
      if ((saveToOriginal || canSaveViaServer) && ownerDoc && ownerDoc.isScratch && !ownerDoc._named){
        const base = String(ownerDoc.name || name).replace(/\.py$/i, "");
        const typed = await askText({ title: "새 파일 저장", message: "저장할 파일 이름을 정하세요.",
          placeholder: "예: 연습", value: base, okText: "저장" });
        if (typed === null) return;                            // 취소 → 저장 안 함
        let fname = String(typed).trim().replace(/[\\/:*?"<>|]/g, "").trim();
        if (!fname) fname = base || "새 코드";
        if (!/\.[A-Za-z0-9]+$/.test(fname)) fname += ".py";
        const currentPath = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.relPath || "");
        const currentDir = runPathDir(currentPath);
        const nextPath = currentDir ? currentDir + "/" + fname : fname;
        ownerDoc.name = fname; ownerDoc.workspacePath = nextPath;
        if (ownerDoc.relPath || ownerDoc.archiveCtx) ownerDoc.relPath = nextPath;
        ownerDoc._named = true;
        name = fname;
        if (typeof state !== "undefined" && state === ownerDoc){
          const hdr = byId("activeFileName");
          if (hdr){ hdr.textContent = fname; const c = extCategory(ownerDoc.kind, fname); if (c) hdr.dataset.cat = c; }
        }
        if (typeof renderTabs === "function") renderTabs();
        renderSidebar();
        if (saveToOriginal) setSavedPath(nextPath, { original:true, pending:true });
      }
      // 0) exe 로컬 서버가 있으면 브라우저 권한 팝업 없이 서버로 바로 저장(내 문서\만능교실 저장).
      if (canSaveViaServer){
        const savedPath = await saveViaServer(value, ownerDoc, name);
        if (savedPath){
          if (ownerDoc){
            const effName = ownerDoc.name || name;
            let path = String(ownerDoc.workspacePath || effName).replace(/\\/g, "/").replace(/^\/+/, "");
            const updated = new File([value], effName, { type: "text/x-python;charset=utf-8" });
            if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value: path });
            ownerDoc.workspacePath = path;
            ownerDoc.size = updated.size;
            ownerDoc.savedText = value;
            markDocumentSavedAsUtf8(ownerDoc, false);
            persisted = await rememberWorkspace([updated], false, { silent:true });     // 자동 복원용 작업공간 사본도 조용히 갱신
            ownerDoc.savedInWorkspace = persisted;
          }
          savedValue = value;
          clearPythonDraft(draftKey);
          markDocumentDirty(ownerDoc, editor.getValue() !== savedValue);
          renderSidebar();                         // 저장으로 ✓ 표시·이름도 바뀌므로 dirty 변화와 무관하게 갱신
          setSavedPath(savedPath);                 // 편집기 위 경로 줄에 절대경로 고정 표시
          const originalUnavailableNotice = "이 폴더는 원본 쓰기 권한 없이 열려 자동 저장 폴더에 저장했어요. 원본에 저장하려면 사이드바 [열기 → 폴더 열기]로 다시 여세요.";
          const savedNotice = fromFolder && !saveToOriginal
            ? ((typeof window.t === "function" ? window.t(originalUnavailableNotice) : originalUnavailableNotice) + " · " + savedPath)
            : "저장 완료 · " + savedPath;
          toast(savedNotice, fromFolder && !saveToOriginal ? 5600 : 3400, {
            type: "success",
            // 문구가 '사이드바 폴더 열기'(원본 권한 재획득)를 가리키므로, 자동 저장 폴더만 여는 이 버튼은
            // 라벨을 '저장 폴더 열기'로 구분해 사용자가 두 동작을 혼동하지 않게 한다.
            action: (typeof window !== "undefined" && typeof window.__mnOpenLastSavedFolder === "function")
              ? { label: fromFolder && !saveToOriginal ? "저장 폴더 열기" : "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
          });
          return;
        }
        // 서버 저장 실패 → 아래 기존 방식으로 폴백
      }
      // A) File System Access API 로 원본 파일에 바로 저장. 첫 저장에 위치를 한 번 고르고 핸들을 보관 → 이후엔 대화상자 없이 덮어쓰기.
      const wrote = await saveViaFileHandle(value, name, ownerDoc, { existingOnly: saveToOriginal });
      if (wrote === "cancelled") return;                  // 사용자가 위치 선택을 취소 → 아무 것도 안 함
      if (saveToOriginal && wrote !== "saved"){
        // 여기서 끝내면 편집 내용이 갈 곳이 없다 — 사본으로 내려받는 길을 바로 준다.
        toast("원본 파일 쓰기 권한이 없어 저장하지 못했어요.", 6000, { type: "error",
          action:{ label:"사본으로 내려받기", onClick:() => downloadTextFile(value, name) } });
        return;
      }
      if (wrote === "unsupported") downloadTextFile(value, name);   // 미지원 브라우저/file:// → 기존 다운로드 폴백
      // 다른 이름으로 저장(파일 선택 창에서 새 이름 지정)했으면 사이드바·탭·헤더 이름을 새 파일명으로 갱신
      let renamedFrom = null;
      if (wrote === "saved" && ownerDoc && ownerDoc.fsHandle && ownerDoc.fsHandle.name && ownerDoc.fsHandle.name !== ownerDoc.name){
        renamedFrom = ownerDoc.name;
        ownerDoc.name = ownerDoc.fsHandle.name;
        if (typeof state !== "undefined" && state === ownerDoc){
          const hdr = byId("activeFileName"); if (hdr) hdr.textContent = ownerDoc.name;
        }
        if (typeof renderTabs === "function") renderTabs();
      }
      if (ownerDoc){
        const effName = ownerDoc.name || name;
        let path = String(ownerDoc.workspacePath || effName).replace(/\\/g, "/").replace(/^\/+/, "");
        if (renamedFrom){ const slash = path.lastIndexOf("/"); path = slash >= 0 ? path.slice(0, slash + 1) + effName : effName; }  // 폴더 경로면 마지막 이름만 교체
        const updated = new File([value], effName, { type: "text/x-python;charset=utf-8" });
        if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value: path });
        const oldPath = ownerDoc.workspacePath;
        ownerDoc.workspacePath = path;
        if (wrote === "saved" && ownerDoc.isScratch) ownerDoc._named = true;
        ownerDoc.size = updated.size;
        ownerDoc.savedText = value;
        markDocumentSavedAsUtf8(ownerDoc, false);
        persisted = await rememberWorkspace([updated], false, { silent:true });
        ownerDoc.savedInWorkspace = persisted;
        if (renamedFrom && oldPath && oldPath !== path && typeof forgetWorkspacePaths === "function") forgetWorkspacePaths([oldPath]);  // 작업공간에 옛 이름이 중복으로 남지 않게
        // 저장 위치(핸들)를 경로 키로 보관 → 다음 실행 때 복원(위치 재선택 불필요). 이름이 바뀌었으면 옛 경로 핸들은 제거.
        if (wrote === "saved" && ownerDoc.fsHandle) saveFsHandle(path, ownerDoc.fsHandle);
        if (renamedFrom && oldPath && oldPath !== path) forgetFsHandle(oldPath);
      }
      savedValue = value;
      clearPythonDraft(draftKey);
      markDocumentDirty(ownerDoc, editor.getValue() !== savedValue);
      renderSidebar();                         // 저장으로 ✓ 표시·이름도 바뀌므로 dirty 변화와 무관하게 갱신
      // 폴백 환경(브라우저)은 보안상 절대경로를 알 수 없어 파일명만 표시
      if (wrote === "saved" && saveToOriginal && ownerDoc){
        setSavedPath(ownerDoc.workspacePath || ownerDoc.relPath || ownerDoc.name || name, { original:true });
      } else {
        setSavedPath(wrote === "saved" && ownerDoc && ownerDoc.fsHandle && ownerDoc.fsHandle.name
          ? ownerDoc.fsHandle.name : ((ownerDoc && ownerDoc.name) || name));
      }
      if (fromZip){
        // 진짜 압축(zip/tar) 안의 파일은 원본 압축을 다시 쓰지 않고 별도 파일로만 저장된다 — 혼동 없게 안내.
        toast(wrote === "saved"
          ? "압축 안의 파일이라 원본 zip이 아닌 별도 파일로 저장했어요."
          : "압축 안의 파일이라 원본 zip이 아닌 별도 .py로 저장했어요.", 3400, { type: "success" });
      } else if (fromFolder && !saveToOriginal){
        toast(wrote === "saved"
          ? "이 폴더는 원본 쓰기 권한 없이 열려 선택한 위치에 별도 파일로 저장했어요. 원본에 저장하려면 사이드바 [열기 → 폴더 열기]로 다시 여세요."
          : "이 폴더는 원본 쓰기 권한 없이 열려 다운로드 사본으로 저장했어요. 원본에 저장하려면 사이드바 [열기 → 폴더 열기]로 다시 여세요.",
          5200, { type: "success" });
      } else if (saveToOriginal){
        // 폴더로 연 파일 → 원본 파일에 되썼다(여기 도달하면 wrote === "saved").
        toast(persisted ? "원본 파일에 저장하고 작업공간도 갱신했어요." : "원본 파일에 저장했어요.", 2600, { type: "success" });
      } else {
        toast((wrote === "saved")
          ? (persisted ? "원본 파일에 저장하고 작업공간도 갱신했어요." : "원본 파일에 바로 저장했어요.")
          : (persisted ? "다운로드하고 왼쪽 작업공간에도 저장했어요." : "다운로드 사본을 저장했어요."), 2600, { type: "success" });
      }
    } finally {
      pyManualSaveActive = false;
      saveBtn.disabled = false;
      if (ownerDoc && !ownerDoc.hasUnsavedEdits) ownerDoc._pyAutosaveFailureNotified = false;
      if (ownerDoc && ownerDoc.hasUnsavedEdits) schedulePythonAutosave();
    }
  });
  // input() 프롬프트를 순서대로 읽어 라벨 붙은 입력칸을 만든다(브라우저 실행 전용, 초급자용).
  // 순서가 고정된 호출이면 프롬프트 문구를 라벨로 단 개별 칸을 보여 주고, 반복문·조건문 안처럼
  // 호출 횟수가 달라질 수 있으면 기존 자유 입력 textarea 로 폴백한다. stdin(textarea)은 값 저장소를
  // 겸하므로 실행 경로(ui.stdin.value)는 그대로 동작한다.
  let inputFieldSig = "";
  const syncStdinFromFields = () => {
    stdin.value = Array.from(inputFields.querySelectorAll("input")).map(el => el.value).join("\n");
  };
  const renderInputFields = () => {
    const plan = (typeof notebookInputPlan === "function") ? notebookInputPlan(editor.getValue()) : { calls: [], predictable: false };
    if (!plan.calls.length){ inputFields.hidden = true; inputHint.hidden = true; stdin.hidden = false; inputFieldSig = ""; return; }
    if (!plan.predictable){
      inputFields.hidden = true; inputFields.innerHTML = ""; inputFieldSig = "";
      stdin.hidden = false;
      inputHint.hidden = false;
      inputHint.textContent = "반복문·조건문 안의 input() 이 있어 값 개수가 달라질 수 있어요. 필요한 값을 한 줄에 하나씩 적어 주세요.";
      return;
    }
    const labels = plan.calls.map((c, i) => (c.prompt && c.prompt.trim()) ? c.prompt.trim() : ((i + 1) + "번째 입력값"));
    const sig = JSON.stringify(labels);
    stdin.hidden = true;
    inputHint.hidden = false;
    inputHint.textContent = "각 칸은 코드의 input() 순서예요. 값을 채우고 " + shortcutDisplay(shortcutValue("runCode")) + " 또는 ▶ 실행을 누르세요.";
    if (sig === inputFieldSig){ inputFields.hidden = false; return; }   // 프롬프트 구성이 그대로면 값·포커스 유지
    const prev = Array.from(inputFields.querySelectorAll("input")).map(el => el.value);
    inputFieldSig = sig;
    inputFields.innerHTML = "";
    labels.forEach((labelText, i) => {
      const row = document.createElement("label"); row.className = "run-input-row";
      const cap = document.createElement("span"); cap.className = "run-input-cap"; cap.textContent = labelText;
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "run-input-one";
      inp.autocomplete = "off"; inp.spellcheck = false;
      if (prev[i] != null) inp.value = prev[i];
      row.append(cap, inp); inputFields.appendChild(row);
      inp.addEventListener("input", syncStdinFromFields);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){
          e.preventDefault();
          const all = Array.from(inputFields.querySelectorAll("input"));
          const idx = all.indexOf(inp);
          if (idx >= 0 && idx + 1 < all.length) all[idx + 1].focus();
          else if (ui.btn && !ui.btn.disabled) ui.btn.click();          // 마지막 칸에서 Enter → 실행
        }
      });
    });
    inputFields.hidden = false;
    syncStdinFromFields();
  };
  ui.renderInputFields = renderInputFields;
  // 편집 상태 반영: 되돌리기 활성화 + input() 미리입력 칸(로컬 파이썬이면 대화형이라 숨김)
  let draftTimer = 0;
  const liveDiagnosticsEnabled = !isNotebook && typeof runPythonLiveDiagnostics === "function";
  let liveDiagTimer = 0, liveDiagVersion = 0, liveDiagRunning = false;
  let liveDiagPending = false, liveDiagPaused = false, liveDiagDestroyed = false;
  const runLiveDiagnostics = async (version, source) => {
    if (!liveDiagnosticsEnabled || liveDiagDestroyed || liveDiagPaused || ui.running) { liveDiagPending = true; return; }
    if (liveDiagRunning){ liveDiagPending = true; return; }
    liveDiagRunning = true;
    try {
      const analysis = await runPythonLiveDiagnostics(source, ui.fileBase);
      if (!liveDiagDestroyed && !liveDiagPaused && !ui.running && version === liveDiagVersion && source === editor.getValue()){
        editor.setDiagnosticItems(analysis.diagnostics);
        // 문법이 완성돼 AST가 만들어졌을 때만 미사용 판정을 교체한다.
        // `a.`처럼 입력 중인 SyntaxError에서는 위치 보정한 이전 표시를 유지해 흰색으로 깜빡이지 않게 한다.
        if (analysis.unusedReady){ editor.setUnusedRanges(analysis.unused); editor.setParamRanges(analysis.params); }
      }
    } catch(_){
      // 자동 진단 실패는 편집을 방해하거나 상태 메시지를 띄우지 않는다.
      if (!liveDiagDestroyed && !liveDiagPaused && version === liveDiagVersion && source === editor.getValue()){
        editor.clearError();
      }
    } finally {
      liveDiagRunning = false;
      if (liveDiagPending && !liveDiagPaused && !liveDiagDestroyed){
        liveDiagPending = false;
        scheduleLiveDiagnostics(120);
      }
    }
  };
  const scheduleLiveDiagnostics = (delay=700) => {
    liveDiagVersion++;
    clearTimeout(liveDiagTimer);
    if (!liveDiagnosticsEnabled || liveDiagDestroyed) return;
    const source = editor.getValue();
    if (!source.trim()){ liveDiagPending = false; editor.clearError(); editor.clearUnusedRanges(); return; }
    if (liveDiagPaused || ui.running){ liveDiagPending = true; return; }
    const version = liveDiagVersion;
    liveDiagTimer = setTimeout(() => runLiveDiagnostics(version, source), delay);
  };
  ui.pauseLiveDiagnostics = () => {
    liveDiagPaused = true;
    liveDiagVersion++;
    liveDiagPending = false;
    clearTimeout(liveDiagTimer);
  };
  ui.resumeLiveDiagnostics = () => {
    liveDiagPaused = false;
    if (liveDiagPending){ liveDiagPending = false; scheduleLiveDiagnostics(); }
  };
  ui.destroyLiveDiagnostics = () => {
    liveDiagDestroyed = true;
    liveDiagVersion++;
    liveDiagPending = false;
    clearTimeout(liveDiagTimer);
  };
  const persistDraft = () => {
    clearTimeout(draftTimer); draftTimer = 0;
    const value = editor.getValue();
    if (value === savedValue) clearPythonDraft(draftKey);
    else savePythonDraft(draftKey, sourceFingerprint, value);
  };
  const setPythonAutosaveState = (next) => {
    if (!ownerDoc) return;
    ownerDoc._pyAutosaveState = next || "";
    updateDocumentStatus(ownerDoc);
  };
  function schedulePythonAutosave(){
    clearTimeout(pyAutosaveTimer); pyAutosaveTimer = 0;
    if (pyAutosaveDisposed || !ownerDoc || !ownerDoc.hasUnsavedEdits || !appSettings.autoSave){
      if (!appSettings.autoSave) setPythonAutosaveState("");
      return;
    }
    setPythonAutosaveState("");
    if (pyAutosaveSaving || pyManualSaveActive){ pyAutosaveAgain = true; return; }
    pyAutosaveTimer = setTimeout(() => {
      pyAutosaveTimer = 0;
      runPythonAutosave();
    }, PYTHON_AUTOSAVE_DELAY);
  }
  async function runPythonAutosave(){
    if (pyAutosaveDisposed || !ownerDoc || !ownerDoc.hasUnsavedEdits || !appSettings.autoSave) return false;
    if (pyAutosaveSaving){ pyAutosaveAgain = true; return pyAutosaveSaving; }
    if (pyManualSaveActive){ pyAutosaveAgain = true; return false; }
    pyAutosaveAgain = false;
    const saving = (async () => {
      const serverAvailable = !ownerDoc.originalSaveMode && await saveFileBackendAvailable();
      const target = pythonAutosaveTarget(ownerDoc, serverAvailable, fromZip);
      if (!target) return false;
      const value = editor.getValue();
      const name = ownerDoc.name || (file && file.name) || "practice.py";
      setPythonAutosaveState("saving");
      const result = await writePythonAutosave(value, ownerDoc, name, target);
      if (!result.ok) throw new Error("python-autosave-write-failed");

      const effectiveName = ownerDoc.name || name;
      const path = String(ownerDoc.workspacePath || effectiveName).replace(/\\/g, "/").replace(/^\/+/, "");
      const updated = new File([value], effectiveName, { type:"text/x-python;charset=utf-8" });
      if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value:path });
      ownerDoc.workspacePath = path;
      ownerDoc.size = updated.size;
      ownerDoc.savedText = value;
      markDocumentSavedAsUtf8(ownerDoc, false);
      try { ownerDoc.savedInWorkspace = await rememberWorkspace([updated], false, { silent:true }); }
      catch(error){ console.warn("python autosave workspace refresh skipped:", error); }
      savedValue = value;
      clearPythonDraft(draftKey);
      markDocumentDirty(ownerDoc, editor.getValue() !== savedValue);
      renderSidebar();
      setSavedPath(target === "server" ? result.path : (ownerDoc.workspacePath || ownerDoc.name || name),
        { original:target === "file-handle" && (ownerDoc.originalSaveMode || fromFolder) });
      setPythonAutosaveState("");
      return true;
    })().catch(error => {
      console.warn("python autosave skipped:", error);
      setPythonAutosaveState("failed");
      if (!ownerDoc._pyAutosaveFailureNotified){
        ownerDoc._pyAutosaveFailureNotified = true;
        toast("자동 저장에 실패했어요. 편집 내용은 남아 있어요.", 6000, { type:"error",
          action:{ label:"지금 저장", onClick:() => saveBtn.click() } });
      }
      return false;
    }).finally(() => {
      pyAutosaveSaving = null;
      if (ownerDoc && !ownerDoc.hasUnsavedEdits) ownerDoc._pyAutosaveFailureNotified = false;
      if (pyAutosaveAgain) schedulePythonAutosave();
    });
    pyAutosaveSaving = saving;
    return saving;
  }
  const refreshEditState = () => {
    revertBtn.disabled = (editor.getValue() === text);
    markDocumentDirty(ownerDoc, editor.getValue() !== savedValue);
    inputWrap.hidden = (_pyBackend === true) ? true : !usesInput(editor.getValue());
    if (!inputWrap.hidden) renderInputFields();
    clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 500);
    schedulePythonAutosave();
    scheduleLiveDiagnostics();
  };
  editor.ta.addEventListener("input", refreshEditState);
  editor.ta.addEventListener("focus", () => { if (ownerDoc) window.__lastCodeLinkDocId = ownerDoc.id; });
  if (ownerDoc){                                   // 저장하지 않고 닫은 스크래치 초안은 고유 키라 다시 안 쓰이니 정리(localStorage 찌꺼기 방지)
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.schedulePythonAutosave = schedulePythonAutosave;
    ownerDoc.cleanupFns.push(() => {
      pyAutosaveDisposed = true;
      clearTimeout(pyAutosaveTimer); pyAutosaveTimer = 0;
      if (ownerDoc.schedulePythonAutosave === schedulePythonAutosave) delete ownerDoc.schedulePythonAutosave;
      if (ownerDoc.isScratch && !ownerDoc._named) clearPythonDraft(draftKey);
    });
  }
  pythonBackendAvailable().then(refreshEditState);
  prewarmBrowserPython();                        // 실행 전에 브라우저 파이썬 런타임을 미리 데운다(로컬 파이썬이면 자동 skip)
  revertBtn.addEventListener("click", async () => {
    if (editor.getValue() === text) return;
    if (await confirmDialog("편집한 내용을 버리고 원본 코드로 되돌릴까요?", "되돌리기", "취소")){ editor.setValue(text); clearPythonDraft(draftKey); refreshEditState(); }
  });
  editor.ta.addEventListener("keydown", (e) => {
    // 노트북: Shift+Enter(설정 재지정 가능) = 이 셀 실행 후 다음 셀로, Ctrl/⌘+Enter = 이 셀만(상태 유지). 일반 코드는 기존대로 전체 실행.
    if (ui.runCurrentCell && shortcutMatches(e, "runCellAdvance")){
      e.preventDefault(); ui.runCurrentCell(true); return;
    }
    // 노트북: Ctrl/⌘+↑·↓ = 실행 없이 이전/다음 셀로 커서 이동
    if (ui.moveCell && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){
      if (ui.moveCell(e.key === "ArrowDown" ? 1 : -1)){ e.preventDefault(); return; }
    }
    if (shortcutMatches(e, "runCode")){
      e.preventDefault();
      if (ui.runCurrentCell) ui.runCurrentCell(false); else run(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "-"){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); }
  });
  registerEditorFont(editor.host);                                                    // 저장된 글자 크기 적용
  outPanel.__refreshFontMetrics = () => { if (outputFindOpen) renderOutputFindHighlights(); };
  registerEditorFont(outPanel);                                                       // 실행 결과 문자에도 같은 크기 적용
  if (ownerDoc){
    const openPythonDocFind = () => {
      if (outPanel.contains(document.activeElement) || outputFindSelectionSeed()) openOutputFind();
      else editor.openFind();
    };
    ownerDoc.openDocFind = openPythonDocFind;
    ownerDoc.codeEditor = editor;
    ownerDoc.codeEditorFileBase = ui.fileBase;
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      if (typeof ui.destroyLiveDiagnostics === "function") ui.destroyLiveDiagnostics();
      if (typeof ui.cancelRun === "function") ui.cancelRun();
      if (pythonTerminal) pythonTerminal.destroy();
    });
    // 이 코드 문서를 가리키는 PDF 핀들을 거터 마커로 표시(코드→PDF 역방향 이동).
    if (editor.setPinProvider) editor.setPinProvider(() => (typeof codeLinksTargetingDoc === "function" ? codeLinksTargetingDoc(ownerDoc) : []));
    window.__lastCodeLinkDocId = ownerDoc.id;
    if (ownerDoc.pendingFocusLine){                    // 정의 이동·코드 링크가 렌더 전에 예약해 둔 줄로 이동
      const ln = ownerDoc.pendingFocusLine, opts = ownerDoc.pendingFocusOptions;
      ownerDoc.pendingFocusLine = 0; ownerDoc.pendingFocusOptions = null;
      requestAnimationFrame(() => { if (ownerDoc.codeEditor === editor && editor.focusLine) editor.focusLine(ln, opts); });
    }
    if (!ownerDoc.cleanupFns) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      persistDraft();
      if (ownerDoc.codeEditor === editor) ownerDoc.codeEditor = null;
      if (ownerDoc.openDocFind === openPythonDocFind) delete ownerDoc.openDocFind;
      editor.destroy();
      unregisterEditorFont(editor.host);
      unregisterEditorFont(outPanel);
      delete outPanel.__refreshFontMetrics;
    });
    // 필기 모드 — 켜면 편집이 자동 잠금되고 캔버스 오버레이가 뜸. 다시 누르면 둘 다 해제.
    // 보드(문서) 닫을 때 자동 정리 → 필기는 세션 한정.
    inkBtn.addEventListener("click", () => {
      const active = !!(ownerDoc.codePenOverlay && ownerDoc.codePenOverlay.active);
      setCodePenMode(ownerDoc, !active);
    });
    ownerDoc.cleanupFns.push(() => { setCodePenMode(ownerDoc, false); if (ownerDoc.codePenOverlay){ try { ownerDoc.codePenOverlay.cleanup(); } catch(_){} ownerDoc.codePenOverlay = null; } });
    ownerDoc.__inkBtn = inkBtn;   // 외부에서 필기 활성 상태 토글 시 버튼 강조용
  }
  refreshEditState();
  // 다른 파일과 동일하게, 열어도 포커스는 사이드바에 둔다(편집기는 클릭/Tab 으로 진입).
}

const PY_DRAFT_PREFIX = "pdf-signer-python-draft:";
const PY_DRAFT_MAX = 768 * 1024;
const PYTHON_AUTOSAVE_DELAY = 3000;
const TEXT_AUTOSAVE_DELAY = 3000;   // 텍스트·마크다운 편집기도 같은 간격으로 자동 저장(입력이 멈춘 뒤)
function pythonAutosaveTarget(ownerDoc, serverAvailable, fromZip=false){
  if (!ownerDoc || !ownerDoc.hasUnsavedEdits || fromZip) return "";
  if (ownerDoc.isScratch && !ownerDoc._named) return "";
  const handle = ownerDoc.fsHandle;
  const canWriteHandle = !!(handle && typeof handle.createWritable === "function");
  if (ownerDoc.originalSaveMode) return canWriteHandle ? "file-handle" : "";
  if (canWriteHandle) return "file-handle";
  return serverAvailable && (ownerDoc.workspacePath || ownerDoc.name) ? "server" : "";
}
async function writePythonAutosave(value, ownerDoc, name, target){
  if (target === "server"){
    const path = await saveViaServer(value, ownerDoc, name);
    return { ok:!!path, path:path || "" };
  }
  if (target !== "file-handle") return { ok:false, path:"" };
  const handle = ownerDoc && ownerDoc.fsHandle;
  if (!handle || typeof handle.createWritable !== "function") return { ok:false, path:"" };
  const permission = typeof handle.queryPermission === "function"
    ? await handle.queryPermission({ mode:"readwrite" }) : "granted";
  // 자동저장 중에는 브라우저 권한창을 띄우지 않는다. Ctrl+S로 권한을 다시 받은 뒤 다음 편집부터 재시도한다.
  if (permission !== "granted") return { ok:false, path:"" };
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([value], { type:"text/x-python;charset=utf-8" }));
    await writable.close();
  } catch(error){
    try { if (typeof writable.abort === "function") await writable.abort(); } catch(_){}
    throw error;
  }
  return { ok:true, path:ownerDoc.workspacePath || ownerDoc.name || name || "" };
}
function pythonDraftKey(file, ownerDoc, runCtx){
  // 새로 만든(아직 이름을 정해 저장하지 않은) 스크래치는 기본 이름("새 코드.py")과 스타터 내용이
  // 늘 똑같아서, 경로 기준 초안 키가 서로 겹치고 sourceFingerprint 무효화도 걸리지 않는다.
  // → 이전 스크래치의 초안이 새 스크래치로 되살아나므로, 문서마다 1회성 고유 토큰으로 키를 만든다.
  //   (doc id 는 새로고침하면 0부터 다시 매겨져 세션 간 충돌하므로, 시각+난수로 세션 간에도 유일하게 한다.)
  if (ownerDoc && ownerDoc.isScratch && !ownerDoc._named){
    if (!ownerDoc.__scratchDraftId) ownerDoc.__scratchDraftId = "scratch:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 8);
    const uid = ownerDoc.__scratchDraftId;
    return PY_DRAFT_PREFIX + fingerprintBytes(uid, new TextEncoder().encode(uid));
  }
  const identity = String(
    (ownerDoc && ownerDoc.workspacePath) ||
    (runCtx && runCtx.archiveCtx && (runCtx.archiveCtx.name + "/" + (runCtx.relPath || ""))) ||
    (runCtx && runCtx.relPath) || (file && file.name) || (ownerDoc && ownerDoc.name) || "code.py"
  ).replace(/\\/g, "/");
  return PY_DRAFT_PREFIX + fingerprintBytes(identity, new TextEncoder().encode(identity));
}
function loadPythonDraft(key, sourceFingerprint){
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && saved.source === sourceFingerprint && typeof saved.value === "string") return saved.value;
    if (saved) localStorage.removeItem(key);
    return null;
  } catch(e){ return null; }
}

function isLocalAbsolutePath(path){
  return /^[A-Za-z]:[\\/]/.test(String(path || "")) || /^\\\\/.test(String(path || ""));
}
function joinLocalPath(root, rel){
  root = String(root || "").replace(/[\\/]+$/, "");
  rel = String(rel || "").replace(/^[\\/]+/, "").replace(/\//g, "\\");
  return root && rel ? root + "\\" + rel : (root || rel);
}
async function displayPathForWorkspace(path){
  path = String(path || "");
  if (!path) return "";
  if (isLocalAbsolutePath(path)) return path;
  try {
    const info = await pythonEnvironmentDetails();
    if (info && info.saveRoot) return joinLocalPath(info.saveRoot, path);
  } catch(e){}
  return path;
}
function savePythonDraft(key, sourceFingerprint, value){
  if (!key || typeof value !== "string" || value.length > PY_DRAFT_MAX) return false;
  try { localStorage.setItem(key, JSON.stringify({ source: sourceFingerprint, value, updatedAt: Date.now() })); return true; }
  catch(e){ return false; }
}
function clearPythonDraft(key){ try { localStorage.removeItem(key); } catch(e){} }

function attachRunSplitter(split, divider){
  let ratio = 50;
  try {
    const saved = Number(localStorage.getItem("pythonSplitRatio"));
    if (saved >= 20 && saved <= 80) ratio = saved;
  } catch(e){}
  const apply = (next) => {
    ratio = Math.max(20, Math.min(80, next));
    split.style.setProperty("--run-editor-width", ratio + "%");
    divider.setAttribute("aria-valuemin", "20");
    divider.setAttribute("aria-valuemax", "80");
    divider.setAttribute("aria-valuenow", String(Math.round(ratio)));
  };
  const save = () => { try { localStorage.setItem("pythonSplitRatio", String(ratio)); } catch(e){} };
  apply(ratio);
  divider.addEventListener("pointerdown", (e) => {
    if (matchMedia("(max-width: 900px)").matches) return;
    e.preventDefault(); divider.setPointerCapture(e.pointerId); divider.classList.add("dragging");
    const rect = split.getBoundingClientRect();
    const vert = split.classList.contains("stack-v");           // 세로 배치면 Y축 기준으로 크기 조절
    const move = (ev) => apply(vert
      ? ((ev.clientY - rect.top) / rect.height) * 100
      : ((ev.clientX - rect.left) / rect.width) * 100);
    const up = () => {
      divider.classList.remove("dragging");
      divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up); save();
    };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up); divider.addEventListener("pointercancel", up);
  });
  divider.addEventListener("dblclick", () => { apply(50); save(); });
  divider.addEventListener("keydown", (e) => {
    const vert = split.classList.contains("stack-v");
    const dec = vert ? "ArrowUp" : "ArrowLeft", inc = vert ? "ArrowDown" : "ArrowRight";
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault(); apply(ratio + (e.key === dec ? -2 : 2)); save();
  });
}

function downloadTextFile(text, name){
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = /\.py$/i.test(name) ? name : name + ".py";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 텍스트/코드 파일 저장(.py 외 — 노트북 .ipynb 포함): EXE면 서버에 원래 확장자로 저장,
// 아니면 .py 저장과 동일하게 위치를 한 번 고르고 핸들을 보관해 같은 파일에 덮어쓰기, 마지막 폴백이 다운로드.
// 스크래치 첫 저장은 이름을 받는다.
// options.silent: 성공·실패 토스트를 띄우지 않는다(여러 파일 일괄 바꾸기가 자체 요약을 보여줌).
// options.existingOnly: 이미 저장 위치가 있는 파일만 조용히 덮어쓰고, 위치를 물어야 하면 "skipped" 를 돌려준다
//   (일괄 저장이 파일마다 저장 대화상자·다운로드를 띄우지 않게 한다).
async function saveTextDoc(value, ownerDoc, name, options={}){
  const silent = !!options.silent, existingOnly = !!options.existingOnly;
  // 화면·편집은 LF·UTF-8 로 다루지만, 디스크에는 원본 개행·BOM 을 되살려 쓴다(문자 인코딩은 UTF-8).
  // savedText·dirty 비교는 편집기와 같은 LF 값(value)을 그대로 쓴다.
  const outValue = applyDocEncodingOnSave(value, ownerDoc);
  try {
    // 폴더로 연 파일이 원본 파일 핸들을 들고 있으면 서버 사본이 아닌 원본 파일에 되쓴다(.py 저장과 동일 원칙).
    const wantOriginal = !!(ownerDoc && ownerDoc.originalSaveMode);
    const fromFolderOriginal = !!(ownerDoc && ownerDoc.archiveCtx && ownerDoc.archiveCtx.isFolderContext
      && ownerDoc.fsHandle && typeof ownerDoc.fsHandle.createWritable === "function");
    if (wantOriginal || fromFolderOriginal){
      const wrote = await saveViaFileHandle(outValue, name, ownerDoc, {
        existingOnly: true,
        noPermissionPrompt: silent && existingOnly,
        mime: "text/plain;charset=utf-8"
      });
      if (wrote === "saved"){
        ownerDoc.size = new Blob([value]).size;
        ownerDoc.savedText = value;
        markDocumentSavedAsUtf8(ownerDoc);
        if (!silent) toast("원본 파일에 바로 저장했어요.", 2200, { type: "success" });
        return true;
      }
      if (wrote === "cancelled") return false;
      // 명시적 원본 모드는 실패를 알리고 끝내지만, 폴더 핸들만으로 시도한 경우엔 아래 일반 저장 경로로 폴백한다.
      // 원본에 못 쓰면 편집 내용이 갈 곳이 없다 — 사본으로 내려받는 길을 함께 준다.
      if (wantOriginal){
        if (!silent) toast("원본 파일 쓰기 권한이 없어 저장하지 못했어요.", 6000, { type: "error",
          action:{ label:"사본으로 내려받기", onClick:() => downloadTextFile(value, name) } });
        return false;
      }
    }
    if (await saveFileBackendAvailable()){
      // 조용한 일괄 저장: 아직 이름 없는 새 문서는 이름을 물어야 하므로 건너뛴다.
      if (existingOnly && ownerDoc && ownerDoc.isScratch && !ownerDoc._named) return "skipped";
      if (ownerDoc && ownerDoc.isScratch && !ownerDoc._named){
        const m = String(name).match(/\.[^.\\/]+$/); const ext0 = m ? m[0] : ".txt";
        const base = String(ownerDoc.name || name).replace(/\.[^.\\/]+$/, "");
        const typed = await askText({ title: "새 파일 저장", message: "저장할 파일 이름을 정하세요.", placeholder: "예: 메모", value: base, okText: "저장" });
        if (typed === null) return false;
        let fname = String(typed).trim().replace(/[\\/:*?"<>|]/g, "").trim() || base || "새 파일";
        if (!/\.[A-Za-z0-9]+$/.test(fname)) fname += ext0;
        const currentPath = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.relPath || "");
        const currentDir = runPathDir(currentPath);
        const nextPath = currentDir ? currentDir + "/" + fname : fname;
        ownerDoc.name = fname; ownerDoc.workspacePath = nextPath; ownerDoc._named = true; name = fname;
        if (ownerDoc.relPath || ownerDoc.archiveCtx) ownerDoc.relPath = nextPath;
        if (typeof renderTabs === "function") renderTabs();
        if (typeof renderSidebar === "function") renderSidebar();
        const hdr = byId("activeFileName"); if (hdr && typeof state !== "undefined" && state === ownerDoc) hdr.textContent = fname;
      }
      const path = await saveViaServer(outValue, ownerDoc, name);
      if (path){
        if (ownerDoc){ ownerDoc.size = new Blob([value]).size; ownerDoc.savedText = value; markDocumentSavedAsUtf8(ownerDoc); }
        if (silent) return true;
        toast("저장 완료 · " + path, 3400, {
          type: "success",
          action: (typeof window !== "undefined" && typeof window.__mnOpenLastSavedFolder === "function")
            ? { label: "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
        });
        return true;
      }
      if (existingOnly) return false;       // 저장 대상은 확정됐지만 EXE 쓰기가 실패함 — 건너뜀과 구분
    }
    // A) 서버가 없으면(.py 저장과 동일) 첫 저장에 위치를 한 번 고르고 핸들을 보관 → 이후엔 대화상자 없이
    //    같은 파일에 조용히 덮어쓰기. 노트북 Ctrl+S 가 매번 다운로드 폴더로 떨어지지 않게 한다.
    //    변환된 노트북처럼 폴더 핸들(fsDirHandle)만 있으면 그 폴더 안에 새 파일로 만들어진다.
    if (ownerDoc && !ownerDoc.fsHandle && ownerDoc.workspacePath && typeof loadFsHandle === "function"){
      try { const restored = await loadFsHandle(ownerDoc.workspacePath); if (restored) ownerDoc.fsHandle = restored; } catch(_){}
    }
    const hadHandle = !!(ownerDoc && (ownerDoc.fsHandle || ownerDoc.fsDirHandle));
    const extMatch = String(name).match(/\.[A-Za-z0-9]+$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : "";
    const mime = ext === ".ipynb" ? "application/x-ipynb+json" : "text/plain";
    const wrote = await saveViaFileHandle(outValue, name, ownerDoc, {
      existingOnly,
      noPermissionPrompt: silent && existingOnly,
      mime: mime + ";charset=utf-8",
      pickerTypes: ext ? [{ description: ext === ".ipynb" ? "Jupyter Notebook" : ext.slice(1).toUpperCase() + " 파일",
        accept: { [mime]: [ext] } }] : null
    });
    if (wrote === "cancelled") return false;                 // 사용자가 위치 선택을 닫음 → 저장 안 함(다운로드도 없음)
    if (existingOnly && wrote !== "saved") return hadHandle ? false : "skipped";
    if (wrote === "saved"){
      if (ownerDoc){
        const oldPath = String(ownerDoc.workspacePath || ownerDoc.name || name).replace(/\\/g, "/").replace(/^\/+/, "");
        // 파일 선택 창에서 다른 이름을 골랐으면 탭·사이드바·헤더 이름을 새 이름으로 맞춘다(.py 저장과 동일)
        if (ownerDoc.fsHandle && ownerDoc.fsHandle.name && ownerDoc.fsHandle.name !== ownerDoc.name){
          ownerDoc.name = ownerDoc.fsHandle.name;
          if (typeof state !== "undefined" && state === ownerDoc){
            const hdr = byId("activeFileName"); if (hdr) hdr.textContent = ownerDoc.name;
          }
          if (typeof renderTabs === "function") renderTabs();
        }
        const slash = oldPath.lastIndexOf("/");
        const path = slash >= 0 ? oldPath.slice(0, slash + 1) + (ownerDoc.name || name) : (ownerDoc.name || oldPath);
        ownerDoc.workspacePath = path;
        if (ownerDoc.isScratch) ownerDoc._named = true;      // 자동 저장이 같은 핸들로 이어지도록
        ownerDoc.size = new Blob([value]).size;
        ownerDoc.savedText = value;
        markDocumentSavedAsUtf8(ownerDoc);
        if (ownerDoc.fsHandle){                              // 저장 위치를 경로 키로 보관 → 다음 실행에도 재선택 불필요
          saveFsHandle(path, ownerDoc.fsHandle);
          if (oldPath && oldPath !== path) forgetFsHandle(oldPath);
        }
        if (typeof renderSidebar === "function") renderSidebar();
      }
      if (!silent) toast(hadHandle ? "저장한 위치의 파일에 바로 저장했어요."
        : "선택한 위치에 저장했어요. 다음부터는 묻지 않고 같은 파일에 저장돼요.", 2600, { type: "success" });
      return true;
    }
    const blob = new Blob([outValue], { type: "text/plain;charset=utf-8" });   // 미지원 브라우저/file:// → 다운로드(확장자 유지)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (ownerDoc){ ownerDoc.size = blob.size; ownerDoc.savedText = value; markDocumentSavedAsUtf8(ownerDoc); }
    if (!silent) toast("파일을 내려받았어요.", 1800, { type: "success" });
    return true;
  } catch(e){
    console.error(e);
    if (!silent) toast("저장하지 못했어요.", 6000, { type: "error",
      action:{ label:"사본으로 내려받기", onClick:() => downloadTextFile(value, name) } });
    return false;
  }
}

// 새 빈 텍스트 파일(.txt) — renderCode 의 편집 토글로 열려 바로 편집·저장.
let _textScratchCount = 0;
function newTextScratch(){
  _textScratchCount++;
  const name = _textScratchCount > 1 ? ("새 메모 " + _textScratchCount + ".txt") : "새 메모.txt";
  if (typeof handleFiles === "function") handleFiles([new File([""], name, { type: "text/plain" })], { isScratch: true });
}

// ===== 저장 위치(파일 핸들)를 IndexedDB 에 보관 → 프로그램 재실행 후에도 같은 파일에 저장(위치 재선택 불필요) =====
// FileSystemFileHandle 은 구조화 복제로 IndexedDB 에 저장 가능. 단, 새 세션의 첫 저장 때 브라우저가
// 쓰기 권한을 1회 다시 묻는다(보안상 세션 간 자동 유지 안 됨) — 그래도 파일은 기억하므로 클릭 한 번이면 된다.
const FS_HANDLE_DB = "pdf-signer-fs-handles";
const FS_HANDLE_STORE = "handles";
let _fsHandleDbPromise = null;
function openFsHandleDb(){
  if (!window.indexedDB) return Promise.reject(new Error("indexeddb-unavailable"));
  if (_fsHandleDbPromise) return _fsHandleDbPromise;
  _fsHandleDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_HANDLE_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(FS_HANDLE_STORE)) req.result.createObjectStore(FS_HANDLE_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexeddb-open-failed"));
  });
  return _fsHandleDbPromise;
}
function fsHandleKey(path){ return String(path || "").replace(/\\/g, "/").replace(/^\/+/, ""); }
async function saveFsHandle(path, handle){
  const key = fsHandleKey(path); if (!key || !handle || handle.__manneungNativeHandle) return;
  try { const db = await openFsHandleDb(); await new Promise((res, rej) => { const tx = db.transaction(FS_HANDLE_STORE, "readwrite"); tx.objectStore(FS_HANDLE_STORE).put(handle, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  catch(e){ console.warn("fs handle save skipped:", e); }
}
async function loadFsHandle(path){
  const key = fsHandleKey(path); if (!key) return null;
  try { const db = await openFsHandleDb(); return await new Promise((res, rej) => { const tx = db.transaction(FS_HANDLE_STORE, "readonly"); const r = tx.objectStore(FS_HANDLE_STORE).get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }
  catch(e){ return null; }
}
async function forgetFsHandle(path){
  const key = fsHandleKey(path); if (!key) return;
  try { const db = await openFsHandleDb(); await new Promise((res) => { const tx = db.transaction(FS_HANDLE_STORE, "readwrite"); tx.objectStore(FS_HANDLE_STORE).delete(key); tx.oncomplete = res; tx.onerror = res; }); }
  catch(e){}
}

// File System Access API 로 원본 파일에 직접 쓰기. 반환: "saved" | "cancelled" | "denied" | "unsupported"
//   - 첫 저장: showSaveFilePicker 로 위치를 한 번 고르고(suggestedName=원본 이름), 핸들을 문서(ownerDoc.fsHandle)에 보관
//   - 이후 저장: 보관한 핸들로 대화상자 없이 조용히 덮어쓰기
//   - 미지원(구형 브라우저·file://)·권한 거부 → "unsupported"(호출부에서 다운로드로 폴백)
function originalSaveRootForDoc(ownerDoc){
  let parentId = ownerDoc && ownerDoc.parentId;
  while (parentId){
    const group = navNodes.find(node => node.nodeId === parentId && node.type === "group");
    if (!group) return null;
    if (group.folderRefreshRootId === group.nodeId) return group;
    parentId = group.parentId;
  }
  return null;
}

async function restoreFolderOriginalFileHandle(ownerDoc, name, existingOnly, noPermissionPrompt=false){
  if (!ownerDoc || !ownerDoc.originalSaveMode) return null;
  const root = originalSaveRootForDoc(ownerDoc);
  if (!root) return null;
  let rootHandle = root.folderHandle || null;
  if (!rootHandle && typeof loadRememberedFolderHandle === "function"){
    rootHandle = await loadRememberedFolderHandle(root.name);
    if (rootHandle) root.folderHandle = rootHandle;
  }
  if (!rootHandle || typeof rootHandle.getDirectoryHandle !== "function") return null;
  let permission = typeof rootHandle.queryPermission === "function"
    ? await rootHandle.queryPermission({ mode:"readwrite" })
    : "granted";
  if (permission !== "granted" && noPermissionPrompt) return null;
  if (permission !== "granted" && typeof rootHandle.requestPermission === "function")
    permission = await rootHandle.requestPermission({ mode:"readwrite" });
  if (permission !== "granted") return null;

  const path = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.relPath || ownerDoc.name || name);
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1 && parts[0] !== root.name) return null;
  if (parts[0] === root.name) parts.shift();
  if (parts.some(part => part === "." || part === "..")) return null;
  const fileName = parts.pop() || ownerDoc.name || name;
  let dirHandle = rootHandle;
  for (const part of parts) dirHandle = await dirHandle.getDirectoryHandle(part);
  const handle = await dirHandle.getFileHandle(fileName, { create:!existingOnly });
  ownerDoc.fsDirHandle = dirHandle;
  ownerDoc.fsHandle = handle;
  if (ownerDoc.workspacePath && typeof saveFsHandle === "function") saveFsHandle(ownerDoc.workspacePath, handle);
  return handle;
}

async function saveViaFileHandle(text, name, ownerDoc, options={}){
  try {
    let handle = ownerDoc && ownerDoc.fsHandle;
    if (handle && handle.queryPermission){              // 보관한 핸들의 쓰기 권한 재확인(회수됐을 수 있음)
      let perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted" && options.noPermissionPrompt) return "denied";
      if (perm !== "granted" && handle.requestPermission) perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted"){
        if (options.existingOnly) return "denied";
        handle = null;                                   // 거부 → 새로 위치 선택
      }
    }
    // 파일 핸들은 없지만 폴더 핸들이 있으면(변환된 노트북 등) 원본을 건드리지 않고 같은 폴더에 새 파일을 만든다.
    if (!handle && ownerDoc && ownerDoc.fsDirHandle && typeof ownerDoc.fsDirHandle.getFileHandle === "function"){
      let dperm = "granted";
      if (ownerDoc.fsDirHandle.queryPermission) dperm = await ownerDoc.fsDirHandle.queryPermission({ mode: "readwrite" });
      if (dperm !== "granted" && options.noPermissionPrompt) return "denied";
      if (dperm !== "granted" && ownerDoc.fsDirHandle.requestPermission) dperm = await ownerDoc.fsDirHandle.requestPermission({ mode: "readwrite" });
      if (dperm === "granted"){
        handle = await ownerDoc.fsDirHandle.getFileHandle(ownerDoc.name || name, { create: !options.existingOnly });
        ownerDoc.fsHandle = handle;            // 이후 저장은 이 .py 파일을 그대로 덮어쓴다
      } else if (options.existingOnly){
        return "denied";
      }
    }
    // 원본 저장 폴더에서 만든 새 문서는 아직 파일이 없으므로 create:true 로 연다.
    // 기존 원본 파일은 기존대로 create:false 를 유지해 잘못된 위치에 새 파일이 생기지 않게 한다.
    const createInOriginalFolder = !!(ownerDoc && ownerDoc.isScratch && ownerDoc.originalSaveMode);
    if (!handle) handle = await restoreFolderOriginalFileHandle(ownerDoc, name,
      !!options.existingOnly && !createInOriginalFolder, !!options.noPermissionPrompt);
    if (!handle){
      if (options.existingOnly) return "denied";
      if (typeof window.showSaveFilePicker !== "function") return "unsupported";
      handle = await window.showSaveFilePicker({
        suggestedName: /\.[A-Za-z0-9]+$/.test(name) ? name : name + ".py",
        types: options.pickerTypes || [{ description: "Python", accept: { "text/x-python": [".py", ".pyw"] } }]
      });
      if (ownerDoc) ownerDoc.fsHandle = handle;
    }
    const writable = await handle.createWritable();
    await writable.write(new Blob([text], { type: options.mime || "text/x-python;charset=utf-8" }));
    await writable.close();
    return "saved";
  } catch(e){
    if (e && e.name === "AbortError") return "cancelled";   // 사용자가 위치 선택 대화상자를 닫음
    console.warn("file-handle save failed:", e);
    return options.existingOnly ? "denied" : "unsupported"; // 원본 모드에서는 다른 위치로 조용히 폴백하지 않음
  }
}

// exe 런처(로컬 서버)가 디스크 저장을 지원하는지 — pythonBackendAvailable 과 동일 패턴(한 번만 확인 후 캐시)
let _saveBackend = null;
async function saveFileBackendAvailable(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;   // file:// → 서버 없음
  if (_saveBackend !== null) return _saveBackend;
  try {
    const res = await fetch("/can-save-file", { method: "GET" });
    _saveBackend = res.ok && (await res.text()).trim().toLowerCase() === "yes";        // Go 폴백은 HTML을 돌려주므로 "yes" 일 때만
  } catch(e){ _saveBackend = false; }
  return _saveBackend;
}
// exe 로컬 서버에 바로 저장(브라우저 권한 팝업 없음). 반환: 저장된 절대경로 | null(실패 → 호출부가 기존 방식으로 폴백)
async function saveViaServer(text, ownerDoc, name){
  const rel = String((ownerDoc && (ownerDoc.workspacePath || ownerDoc.name)) || name || "practice.py")
    .replace(/\\/g, "/").replace(/^\/+/, "");
  try {
    const res = await fetch("/save-file", {
      method: "POST",
      headers: { "X-Save-Path": encodeURIComponent(rel) },
      body: new Blob([text], { type: "application/octet-stream" })
    });
    if (!res.ok) return null;
    try { window.__mnLastSaveRel = rel; } catch(_){}   // 헤더 '저장 폴더'가 직전 저장 파일 폴더를 열 수 있게 기록
    return (await res.text()).trim() || rel;
  } catch(e){ return null; }
}

// ===== 에디터 편의: 코드 글자 크기·폰트(모든 에디터 공유·저장) =====
let _codeFontSize = (() => { const v = Number(localStorage.getItem("pyCodeFontSize")); return (v >= 11 && v <= 30) ? v : 13; })();
// 시스템에 설치된 폰트만 후보로 둔다(웹폰트는 비동기 로드라 첫 렌더에서 겹침이 어긋날 수 있음).
// value 가 ""이면 기본(Consolas) 사용. 각 stack 끝에 폴백을 두어 미설치 폰트도 안전하게 다음 후보로 넘어간다.
// 고정폭/가변폭은 실제 설치된 글꼴을 측정해 자동으로 나눈다(isMonospaceFont) → 후보를 추가할 때 따로 표시할 필요 없음.
const CODE_FONT_CHOICES = [
  { value: "", label: "기본 (Consolas)", stack: "" },
  { value: "Cascadia Mono", label: "Cascadia Mono", stack: '"Cascadia Mono","Cascadia Code",Consolas,monospace' },
  { value: "Cascadia Code", label: "Cascadia Code", stack: '"Cascadia Code","Cascadia Mono",Consolas,monospace' },
  { value: "D2Coding", label: "D2Coding", stack: '"D2Coding","나눔고딕코딩","NanumGothicCoding",Consolas,monospace' },
  { value: "NanumGothicCoding", label: "나눔고딕코딩", stack: '"나눔고딕코딩","NanumGothicCoding","D2Coding",Consolas,monospace' },
  { value: "Courier New", label: "Courier New", stack: '"Courier New",Consolas,monospace' },
  // 아래는 가변폭(자동 분류돼 '가변폭' 묶음에 들어간다). 코드 정렬보다 읽기 편한 글꼴을 원하는 경우용.
  { value: "Malgun Gothic", label: "맑은 고딕", stack: '"Malgun Gothic","맑은 고딕",sans-serif' },
  { value: "NanumGothic", label: "나눔고딕", stack: '"NanumGothic","나눔고딕",sans-serif' },
  { value: "Gulim", label: "굴림", stack: '"Gulim","굴림",sans-serif' },
  { value: "Batang", label: "바탕", stack: '"Batang","바탕",serif' },
  { value: "Segoe UI", label: "Segoe UI", stack: '"Segoe UI",sans-serif' }
];
// 시스템에 폰트가 실제로 설치돼 있는지 — 폴백 글꼴과 텍스트 너비를 비교(canvas).
// 미설치면 브라우저가 폴백을 그대로 쓰므로 폭이 같게 떨어진다.
// serif 하나만 비교하면 '바탕'처럼 한글 serif 폴백과 같은 글꼴이 미설치로 오판되므로,
// serif·sans-serif 두 기준과 비교해 하나라도 다르면 설치된 것으로 본다.
const _fontAvailCache = new Map();
function isCodeFontInstalled(family){
  if (!family) return true;
  if (_fontAvailCache.has(family)) return _fontAvailCache.get(family);
  let ok = true;                                     // 측정 실패하면 일단 보이게(안전한 폴백)
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    const text = "mmmmmmmmlliiwwwwwwwww가나다라0123456789";
    const differsFrom = (generic) => {
      ctx.font = "72px " + generic;
      const base = ctx.measureText(text).width;
      ctx.font = '72px "' + family + '", ' + generic;
      return Math.abs(ctx.measureText(text).width - base) > 0.5;
    };
    ok = differsFrom("serif") || differsFrom("sans-serif");
    _fontAvailCache.set(family, ok);
  } catch(_){}
  return ok;
}
function availableCodeFontChoices(){
  return CODE_FONT_CHOICES.filter(c => isCodeFontInstalled(c.value));
}
// 고정폭(monospace)인지 — 좁은 글자(i)와 넓은 글자(M)를 같은 개수만큼 재서 폭이 같으면 고정폭.
// stack 전체로 재기 때문에 폰트가 없어 폴백된 경우에도 '실제로 그려지는 글꼴' 기준으로 판정된다.
const _fontMonoCache = new Map();
function isMonospaceFont(stack){
  const ff = stack || 'Consolas,monospace';
  if (_fontMonoCache.has(ff)) return _fontMonoCache.get(ff);
  let mono = true;                                   // 측정 실패 시엔 고정폭으로 간주(기존 동작 유지)
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "72px " + ff;
    const narrow = ctx.measureText("iiiiiiiiii").width;
    const wide = ctx.measureText("MMMMMMMMMM").width;
    mono = Math.abs(narrow - wide) < 1;
  } catch(_){}
  _fontMonoCache.set(ff, mono);
  return mono;
}
// 드롭다운용 — 설치된 후보를 고정폭/가변폭으로 나눠 돌려준다.
function groupedCodeFontChoices(){
  const mono = [], prop = [];
  for (const c of availableCodeFontChoices()) (isMonospaceFont(c.stack) ? mono : prop).push(c);
  return { mono, prop };
}
let _codeFontFamily = (() => {
  const v = String(localStorage.getItem("pyCodeFontFamily") || "");
  return CODE_FONT_CHOICES.some(c => c.value === v) ? v : "";
})();
function codeFontStack(value){
  const found = CODE_FONT_CHOICES.find(c => c.value === value);
  return found ? found.stack : "";
}
const _editorHosts = new Set();
function applyEditorFontMetrics(host){
  host.style.setProperty("--code-fs", _codeFontSize + "px");
  host.style.setProperty("--code-lh", Math.round(_codeFontSize * 1.6) + "px");
  const stack = codeFontStack(_codeFontFamily);
  if (stack) host.style.setProperty("--code-ff", stack);
  else host.style.removeProperty("--code-ff");
  // 폰트/크기 바뀌면 4칸 폭이 바뀌므로 들여쓰기 가이드도 다시 그린다(buildCodeEditor 가 등록한 콜백).
  if (typeof host.__refreshIndent === "function") host.__refreshIndent();
  if (typeof host.__refreshPins === "function") host.__refreshPins();        // 줄 높이 변화 → 핀 마커도 재배치
  if (typeof host.__refreshFontMetrics === "function") host.__refreshFontMetrics();
}
function registerEditorFont(host){ _editorHosts.add(host); applyEditorFontMetrics(host); }
function unregisterEditorFont(host){ _editorHosts.delete(host); }
function reapplyAllEditorFonts(){
  for (const h of [..._editorHosts]){ if (h.isConnected) applyEditorFontMetrics(h); else _editorHosts.delete(h); }
}
function bumpCodeFont(delta){
  _codeFontSize = Math.max(11, Math.min(30, _codeFontSize + delta));
  reapplyAllEditorFonts();
  try { localStorage.setItem("pyCodeFontSize", String(_codeFontSize)); } catch(_){}
}
function setCodeFontFamily(value){
  if (!CODE_FONT_CHOICES.some(c => c.value === value)) value = "";
  _codeFontFamily = value;
  reapplyAllEditorFonts();
  try { localStorage.setItem("pyCodeFontFamily", value); } catch(_){}
}
// 빈 파이썬 코드로 바로 시작(파일 없이 라이브 코딩)
let _scratchCount = 0;
// 지금 보고 있는 파일이 '업로드한 폴더 안 파이썬'이면 그 폴더 컨텍스트를 돌려준다.
// → 새 파일을 같은 폴더 옆자리에 만들어, 그 폴더의 모듈을 바로 import 할 수 있게 한다.
function activeFolderContextForNewFile(){
  const cur = (typeof activeId !== "undefined") ? docs.find(d => d.id === activeId) : null;
  if (!cur || cur.kind === "pdf" || !cur.archiveCtx || !cur.parentId) return null;
  const dir = runPathDir(normalizedRunPath(cur.relPath || cur.workspacePath || ""));
  if (!dir) return null;                          // 묶음 루트 직속 파일이면 폴더 없음
  return { parentId: cur.parentId, dir, archiveCtx: cur.archiveCtx };
}
function pythonScratchStarter(){
  const prompt = typeof t === "function" ? t("여기에 파이썬 코드를 작성하고 ▶ 실행") : "여기에 파이썬 코드를 작성하고 ▶ 실행";
  return "# " + prompt + " (" + shortcutDisplay(shortcutValue("runCode")) + ")\nprint(\"Hello, Python!\")\n";
}
function pythonScratchFileName(number=1){
  const base = typeof window.t === "function" ? window.t("새 코드") : "새 코드";
  return base + (number > 1 ? " " + number : "") + ".py";
}
function createPythonScratchInFolder(folder){
  if (!folder || !folder.parentId || !folder.archiveCtx || !folder.dir) return false;
  const starter = pythonScratchStarter();
  const dir = normalizedRunPath(folder.dir);
  if (!dir) return false;
  // 같은 폴더 안에서 이름이 겹치지 않게 정한다.
  const taken = new Set(docs.map(d => normalizedRunPath(d.workspacePath || d.relPath || "")));
  let name = pythonScratchFileName();
  for (let n = 2; taken.has(normalizedRunPath(dir + "/" + name)); n++) name = pythonScratchFileName(n);
  const relPath = dir + "/" + name;
  const originalRoot = typeof originalSaveRootForDoc === "function"
    ? originalSaveRootForDoc({ parentId:folder.parentId }) : null;
  handleFiles([new File([starter], name, { type: "text/x-python" })],
    { isScratch: true, parentId: folder.parentId, archiveCtx: folder.archiveCtx, relPath, workspacePath: relPath,
      originalSaveMode:!!(originalRoot && originalRoot.originalSaveMode) });
  if (typeof toast === "function") toast("'" + (folder.label || dir.split("/").pop() || dir) + "' 폴더 안에 새 Python 파일을 만들었어요.", 3000);
  return true;
}
function newPythonScratchInFolder(folder){
  _scratchCount++;
  createPythonScratchInFolder(folder);
}
function newPythonScratch(){
  _scratchCount++;
  const starter = pythonScratchStarter();
  const folder = activeFolderContextForNewFile();
  if (folder && createPythonScratchInFolder(folder)) return;
  const name = pythonScratchFileName(_scratchCount);
  handleFiles([new File([starter], name, { type: "text/x-python" })], { isScratch: true });
}
