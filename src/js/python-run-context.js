"use strict";

// 브라우저에서 실행할 수 있는(=실행 버튼을 붙일) 확장자
const RUN_EXTS = new Set(["py"]);
let _pyBackend = null;          // null=미확인, true/false=캐시(로컬 python 백엔드 가용 여부)
let _localPyConfirmed = false;  // 로컬 실행 1회 동의(세션)
const PYODIDE_VER = "0.27.7";
const PY_LOCAL_BASE = "/pyodide/";   // exe 런처가 vendor/pyodide/ 를 로컬 서빙(오프라인). 없으면 CDN 폴백.
let _pyodidePromise = null;
const RUN_BUNDLE_CAP = 50 * 1024 * 1024;   // 옆 파일 포함 실행 시 합계 상한(초과하면 단일 파일 실행)

// 압축 안의 모든 파일을 {path, bytes}[] 로 다시 추출(실행 작업폴더 복원용). 디렉터리·맥 메타는 제외.
async function extractZipAll(file, password, keep){
  const out = [];
  const r = new zip.ZipReader(new zip.BlobReader(file), password ? { password } : undefined);
  try {
    const selected = [];
    let declaredTotal = 0;
    for (const e of await r.getEntries()){
      if (e.directory) continue;
      const p = safeArchivePath(e.filename);
      if (!p || p.indexOf("__MACOSX/") === 0 || (p.split("/").pop() || "") === ".DS_Store") continue;
      if (typeof keep === "function" && !keep(p)) continue;
      declaredTotal += Number(e.uncompressedSize) || 0;
      if (typeof keep === "function" && declaredTotal > RUN_BUNDLE_CAP) throw new Error("sibling-set-too-large");
      selected.push({ entry:e, path:p });
    }
    let actualTotal = 0;
    for (const item of selected){
      const bytes = await item.entry.getData(new zip.Uint8ArrayWriter());
      actualTotal += bytes.length;
      if (typeof keep === "function" && actualTotal > RUN_BUNDLE_CAP) throw new Error("sibling-set-too-large");
      out.push({ path:item.path, bytes });
    }
  } finally { try { await r.close(); } catch(_){} }
  return out;
}
function tarTreeAll(tarBytes){
  return parseTar(tarBytes)
    .map(en => ({ path: String(en.name || "").replace(/\\/g, "/").replace(/^\/+/, ""), bytes: en.data }))
    .filter(f => f.path && f.path.indexOf("__MACOSX/") < 0 && f.path.indexOf("PaxHeader") < 0 && (f.path.split("/").pop() || "") !== ".DS_Store");
}
// 폴더 열기·여러 파일 동시 업로드용 옆파일 컨텍스트: File 핸들 묶음을 실행 시점에 읽어 {path, bytes}[] 로 만든다.
// 합계 용량이 상한을 넘으면 읽지 않고 거부(→ 단일 파일 실행으로 폴백).
function runDirectoryPaths(paths, explicit=[]){
  const dirs = new Set((explicit || []).map(normalizedRunPath).filter(Boolean));
  for (const value of paths || []){
    let dir = runPathDir(value);
    while (dir){
      dirs.add(dir);
      const parent = runPathDir(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return [...dirs];
}
function makeFileSiblingCtx(pairs, name, directories=[]){
  const paths = pairs.map(p => normalizedRunPath(p.relPath));
  return {
    name,
    isFolderContext: true,
    paths,                                                  // 바이트를 읽기 전 경로만 노출(실행 대상 기준 범위 좁히기용)
    directories: runDirectoryPaths(paths, directories),
    extract: async (keep) => {
      // keep(path) 가 주어지면 해당 파일만 읽는다 → 무관한 폴더·대용량 데이터 제외(50MB 상한 회피).
      const sel = (typeof keep === "function") ? pairs.filter(p => keep(p.relPath)) : pairs;
      let total = 0;
      for (const p of sel) total += (p.file.size || 0);
      if (total > RUN_BUNDLE_CAP) throw new Error("sibling-set-too-large");
      const out = [];
      for (const p of sel) out.push({ path: p.relPath, bytes: new Uint8Array(await p.file.arrayBuffer()) });
      return out;
    }
  };
}
// 폴더/압축 묶음을 실행 대상과 관련된 범위로 좁힌다.
// 자동 실행 기준은 실제 .py 파일 폴더이며, 상위·형제 파일은 ../dataIn/shopList.xml처럼 명시한 경로로 찾는다.
function buildArchiveScopeFilter(targetRel, src, availablePaths, availableDirs=[], preferredCwd=""){
  const target = normalizedRunPath(targetRel);
  const parts = target.split("/").filter(Boolean);
  const targetDir = runPathDir(target);
  const directories = runDirectoryPaths(availablePaths || [], availableDirs);
  const project = inferPythonProjectRunContext(target, src, availablePaths || [], { preferredCwd, availableDirs:directories });
  const referenced = project.references.map(item => normalizedRunPath(item.path));
  const directorySet = new Set(directories);
  const referencedDirs = new Set();
  for (const ref of pythonRelativePathLiterals(src)){
    const resolved = resolveProjectRelativePath(project.cwd, ref);
    if (!resolved) continue;
    if (directorySet.has(resolved)) referencedDirs.add(resolved);
    const parent = runPathDir(resolved);
    if (parent && parent !== project.cwd && directorySet.has(parent)) referencedDirs.add(parent);
  }
  const pkgDirs = [];
  for (const name of targetImportedTopNames(src)){
    const idx = parts.indexOf(name);
    if (idx >= 0 && idx < parts.length - 1) pkgDirs.push(parts.slice(0, idx + 1).join("/"));
  }
  if (typeof inferPythonLocalImportRoots === "function"){
    for (const root of inferPythonLocalImportRoots(target, src, availablePaths || [], {
      cwd:project.cwd || targetDir,
      availableDirs:directories
    })){
      if (!pkgDirs.includes(root)) pkgDirs.push(root);
    }
  }
  const keep = (p) => {
    return pythonRunScopeIncludesPath(p, target, referenced, pkgDirs);
  };
  keep.cwd = project.cwd || targetDir;
  keep.references = project.references;
  keep.directories = [...referencedDirs];
  return keep;
}

function normalizedRunPath(path){
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
function runPathDir(path){
  const p = normalizedRunPath(path);
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}
function runPathStartsWith(path, root){
  const p = normalizedRunPath(path);
  const r = normalizedRunPath(root);
  return !r || p === r || p.indexOf(r + "/") === 0;
}
function stripRunRoot(path, root){
  const p = normalizedRunPath(path);
  const r = normalizedRunPath(root);
  return r && p.indexOf(r + "/") === 0 ? p.slice(r.length + 1) : p;
}
function pythonRunCwdStorageKey(runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  const path = normalizedRunPath(owner && (owner.workspacePath || owner.relPath || owner.name));
  return path ? "moidapy-run-cwd:v1:" + path : "";
}
function pythonPreferredRunCwd(runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  if (!owner) return "";
  if (!Object.prototype.hasOwnProperty.call(owner, "pythonRunCwd")){
    const key = pythonRunCwdStorageKey(runCtx);
    let saved = "";
    try { if (key) saved = normalizedRunPath(localStorage.getItem(key) || ""); } catch(_){}
    owner.pythonRunCwd = saved;
  }
  return normalizedRunPath(owner.pythonRunCwd || "");
}
function setPythonPreferredRunCwd(runCtx, cwd){
  const owner = runCtx && runCtx.ownerDoc;
  if (!owner) return;
  const value = normalizedRunPath(cwd);
  owner.pythonRunCwd = value;
  const key = pythonRunCwdStorageKey(runCtx);
  try {
    if (key && value) localStorage.setItem(key, value);
    else if (key) localStorage.removeItem(key);
  } catch(_){}
}
function pythonRunContextPaths(runCtx){
  const archive = runCtx && runCtx.archiveCtx;
  if (archive && Array.isArray(archive.paths)) return archive.paths.map(normalizedRunPath).filter(Boolean);
  return docs.map(doc => normalizedRunPath(doc.workspacePath || doc.relPath || doc.name)).filter(Boolean);
}
function pythonRunContextDirectories(runCtx){
  const archive = runCtx && runCtx.archiveCtx;
  return runDirectoryPaths(pythonRunContextPaths(runCtx), archive && archive.directories || []);
}
function pythonRunCwdCandidates(runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  const target = normalizedRunPath(owner && (owner.relPath || owner.workspacePath || owner.name));
  const directories = new Set(pythonRunContextDirectories(runCtx));
  const out = [];
  let dir = runPathDir(target);
  while (dir){
    if (directories.has(dir) || target.indexOf(dir + "/") === 0) out.push(dir);
    const parent = runPathDir(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return out;
}
// 압축 파일명에서 최상위 폴더로 쓸 이름을 뽑는다(somefolder.zip → somefolder).
function archiveRootName(name){
  return String(name || "").replace(/\\/g, "/").split("/").pop()
    .replace(/\.(zip|tgz|tar\.gz|tar)$/i, "").trim();
}
// 모든 경로가 같은 최상위 폴더 아래면 그 이름을, 루트에 흩어져 있으면(공통 최상위 폴더 없음) null 을 돌려준다.
function commonTopDir(paths){
  let top = null;
  for (const p of paths){
    const np = normalizedRunPath(p);
    if (np.indexOf("/") < 0) return null;          // 루트 직속 파일 존재 → 공통 최상위 폴더 없음
    const seg = np.split("/")[0];
    if (top === null) top = seg;
    else if (top !== seg) return null;
  }
  return top;
}
function targetImportedTopNames(src){
  const names = new Set();
  const text = String(src || "");
  let m;
  const importRe = /^\s*import\s+([^\n#]+)/gm;
  while ((m = importRe.exec(text))){
    for (const part of m[1].split(",")){
      const name = part.trim().split(/\s+as\s+/i)[0].split(".")[0];
      if (name) names.add(name);
    }
  }
  const fromRe = /^\s*from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+/gm;
  while ((m = fromRe.exec(text))) names.add(m[1].split(".")[0]);
  return names;
}
function inferOpenPythonProjectRoot(target, src, docPaths){
  const parts = normalizedRunPath(target).split("/").filter(Boolean);
  const imported = targetImportedTopNames(src);
  for (const name of imported){
    const idx = parts.indexOf(name);
    // import 한 최상위 패키지가 경로에 있으면 그 부모가 프로젝트 루트(idx 0 이면 묶음 루트 자체 = "").
    if (idx >= 0 && idx < parts.length - 1) return parts.slice(0, idx).join("/");
  }
  const pathSet = new Set((docPaths || []).map(normalizedRunPath));
  let dir = runPathDir(target);
  let topPackageDir = "";
  while (dir){
    if (pathSet.has(dir + "/__init__.py")) topPackageDir = dir;
    const parent = runPathDir(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return topPackageDir ? runPathDir(topPackageDir) : null;   // 못 찾으면 null(같은 폴더 형제만 묶기)
}
function isRunnablePythonPath(path){
  return /\.py$/i.test(String(path || "").split(/[\\/]/).pop() || "");
}
function runRuntimeFileStore(runCtx, create=false){
  const holder = runCtx && (runCtx.archiveCtx || runCtx.ownerDoc);
  if (!holder) return null;
  if (!holder.runtimeFiles && create) holder.runtimeFiles = new Map();
  return holder.runtimeFiles instanceof Map ? holder.runtimeFiles : null;
}
function runRuntimeFileHolder(runCtx){
  return runCtx && (runCtx.archiveCtx || runCtx.ownerDoc) || null;
}
function findOpenRunProjectDoc(path, runCtx){
  const wanted = normalizedRunPath(path);
  const owner = runCtx && runCtx.ownerDoc;
  const archiveCtx = runCtx && runCtx.archiveCtx;
  const candidates = docs.filter(doc => doc && !doc.closed && !doc.isRunProjectPreview);
  const docPath = (doc) => normalizedRunPath(doc.relPath || doc.workspacePath || doc.name || "");
  const exact = candidates.filter(doc => docPath(doc) === wanted);
  if (exact.length){
    return exact.find(doc => doc === owner) ||
      exact.find(doc => archiveCtx && doc.archiveCtx === archiveCtx) ||
      exact[0];
  }
  const suffix = candidates.filter(doc => {
    const current = docPath(doc);
    return current && (current.endsWith("/" + wanted) || wanted.endsWith("/" + current));
  });
  return suffix.find(doc => doc === owner) ||
    suffix.find(doc => archiveCtx && doc.archiveCtx === archiveCtx) ||
    suffix[0] || null;
}
async function openRunProjectFile(path, bundle, runCtx){
  const wanted = normalizedRunPath(path);
  const runtime = runRuntimeFileStore(runCtx, false);
  const runtimeBytes = runtime && runtime.get(wanted);
  if (!runtimeBytes){
    const openDoc = findOpenRunProjectDoc(wanted, runCtx);
    if (openDoc){
      setActiveDoc(openDoc.id);
      return;
    }
  }
  let bytes = runtimeBytes || null;
  if (!bytes && bundle && Array.isArray(bundle.files)){
    const entry = bundle.files.find(file => normalizedRunPath(file.path) === wanted);
    if (entry && entry.bytes) bytes = entry.bytes;
  }
  if (!bytes && runCtx && runCtx.archiveCtx && typeof runCtx.archiveCtx.extract === "function"){
    try {
      const extracted = await runCtx.archiveCtx.extract(p => normalizedRunPath(p) === wanted);
      const entry = extracted.find(file => normalizedRunPath(file.path) === wanted);
      if (entry && entry.bytes) bytes = entry.bytes;
    } catch(e){ console.warn("실행 작업폴더 파일 열기 실패:", e); }
  }
  if (!bytes){
    toast("이 파일의 내용을 불러오지 못했어요. 코드를 한 번 실행한 뒤 다시 눌러보세요.", 3200);
    return;
  }
  const owner = runCtx && runCtx.ownerDoc;
  const base = wanted.split("/").pop() || "output.txt";
  const previewKey = "run-project-preview:" + (owner ? owner.id : "shared") + ":" + wanted;
  const previous = docs.find(doc => doc && doc.sourceKey === previewKey);
  if (previous) closeDoc(previous.id, { skipConfirm:true });
  const preview = await handleFiles([new File([bytes], base)], {
    bulk: false,
    parentId: owner && owner.parentId ? owner.parentId : null,
    relPath: wanted,
    archiveCtx: runCtx && runCtx.archiveCtx ? runCtx.archiveCtx : null,
    sourceKey: previewKey,
    transient: true
  });
  if (preview){
    preview.isRunProjectPreview = true;
    preview.runProjectPath = wanted;
    preview.runGenerated = !!runtimeBytes;
    setActiveDoc(preview.id);
  }
}
function pythonPathGuideData(src, runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  const target = normalizedRunPath(owner && (owner.relPath || owner.workspacePath || owner.name) || "script.py");
  const paths = pythonRunContextPaths(runCtx);
  const directories = pythonRunContextDirectories(runCtx);
  const pathSet = new Set(paths), directorySet = new Set(directories);
  const preferredCwd = pythonPreferredRunCwd(runCtx);
  const context = inferPythonProjectRunContext(target, src, paths, { preferredCwd, availableDirs:directories });
  const cwd = context.cwd || runPathDir(target) || ".";
  const refs = pythonRelativePathLiterals(src).map(ref => {
    const resolved = resolveProjectRelativePath(cwd === "." ? "" : cwd, ref) || ref;
    const existsFile = pathSet.has(resolved);
    const existsDirectory = directorySet.has(resolved);
    const parent = runPathDir(resolved);
    const parentExists = !parent || directorySet.has(parent);
    const normalizedRef = normalizedRunPath(ref);
    const exactElsewhere = paths.find(path => path === normalizedRef || path.endsWith("/" + normalizedRef));
    const refDir = runPathDir(normalizedRef);
    const directoryElsewhere = refDir
      ? directories.find(dir => dir === refDir || dir.endsWith("/" + refDir))
      : "";
    let suggestedCwd = "";
    const matched = exactElsewhere || directoryElsewhere;
    if (matched){
      const suffix = exactElsewhere ? normalizedRef : refDir;
      if (suffix && matched.length > suffix.length)
        suggestedCwd = matched.slice(0, matched.length - suffix.length).replace(/\/+$/, "");
    }
    return {
      ref, resolved, existsFile, existsDirectory, parentExists,
      elsewhere: exactElsewhere || directoryElsewhere || "", suggestedCwd
    };
  });
  return { target, paths, directories, preferredCwd, cwd, refs };
}
async function copyPythonPathExample(text){
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch(_){}
  if (!copied){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { copied = document.execCommand("copy"); } catch(_){}
    ta.remove();
  }
  toast(copied ? "예제 코드를 복사했어요." : "복사하지 못했어요.", 1800);
}
function appendPythonPathExample(host, title, text){
  const wrap = document.createElement("section"); wrap.className = "py-path-example";
  const head = document.createElement("div"); head.className = "py-path-example-head";
  const label = document.createElement("strong"); label.textContent = title;
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "복사";
  copy.addEventListener("click", () => copyPythonPathExample(text));
  const pre = document.createElement("pre"); pre.textContent = text;
  head.append(label, copy); wrap.append(head, pre); host.appendChild(wrap);
}
function renderPythonPathHelper(panel, src, runCtx, ui){
  if (!panel) return;
  const guide = pythonPathGuideData(src, runCtx);
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "py-path-help-head";
  const heading = document.createElement("div");
  const title = document.createElement("strong"); title.textContent = "경로 도우미";
  const sub = document.createElement("span"); sub.textContent = "현재 코드와 열린 폴더를 기준으로 계산합니다.";
  heading.append(title, sub);
  const close = document.createElement("button"); close.type = "button"; close.textContent = "닫기";
  close.addEventListener("click", () => { panel.hidden = true; });
  head.append(heading, close);

  const summary = document.createElement("dl"); summary.className = "py-path-summary";
  const addSummary = (name, value) => {
    const dt = document.createElement("dt"); dt.textContent = name;
    const dd = document.createElement("dd"); dd.textContent = value; dd.title = value;
    summary.append(dt, dd);
  };
  addSummary("현재 파일", guide.target);
  addSummary("실행 기준", guide.cwd);

  const cwdRow = document.createElement("label"); cwdRow.className = "py-path-cwd";
  const cwdLabel = document.createElement("span"); cwdLabel.textContent = "실행 기준 폴더";
  const cwdSelect = document.createElement("select");
  const autoContext = inferPythonProjectRunContext(guide.target, src, guide.paths, { availableDirs:guide.directories });
  const auto = document.createElement("option"); auto.value = ""; auto.textContent = "자동 감지 (" + (autoContext.cwd || ".") + ")";
  cwdSelect.appendChild(auto);
  const candidates = pythonRunCwdCandidates(runCtx);
  if (guide.preferredCwd && !candidates.includes(guide.preferredCwd)) candidates.push(guide.preferredCwd);
  for (const cwd of candidates){
    const option = document.createElement("option"); option.value = cwd; option.textContent = cwd;
    cwdSelect.appendChild(option);
  }
  cwdSelect.value = guide.preferredCwd;
  cwdSelect.addEventListener("change", () => {
    setPythonPreferredRunCwd(runCtx, cwdSelect.value);
    updateRunProjectPanel(ui, null, runCtx);
    renderPythonPathHelper(panel, src, runCtx, ui);
  });
  cwdRow.append(cwdLabel, cwdSelect);

  const note = document.createElement("p"); note.className = "py-path-note";
  note.textContent = "화면의 경로는 논리 작업폴더입니다. 실제 실행이 Temp 폴더에서 이뤄지는 것은 정상이며, 상대경로 구조는 그대로 복원됩니다.";
  panel.append(head, summary, cwdRow, note);

  const refsTitle = document.createElement("h4"); refsTitle.textContent = "코드에서 찾은 파일 경로";
  panel.appendChild(refsTitle);
  const refs = document.createElement("div"); refs.className = "py-path-refs";
  if (!guide.refs.length){
    const empty = document.createElement("p"); empty.className = "py-path-empty"; empty.textContent = "코드에서 분석할 상대 파일 경로를 찾지 못했습니다.";
    refs.appendChild(empty);
  }
  for (const item of guide.refs){
    const row = document.createElement("div"); row.className = "py-path-ref";
    const main = document.createElement("div"); main.className = "py-path-ref-main";
    const code = document.createElement("code"); code.textContent = item.ref;
    const status = document.createElement("span");
    if (item.existsFile || item.existsDirectory){ status.className = "ok"; status.textContent = "찾음"; }
    else if (item.parentExists){ status.className = "new"; status.textContent = "새 파일 생성 가능"; }
    else if (item.elsewhere){ status.className = "warn"; status.textContent = "기준 폴더 불일치"; }
    else { status.className = "bad"; status.textContent = "찾지 못함"; }
    main.append(code, status);
    const resolved = document.createElement("div"); resolved.className = "py-path-resolved";
    resolved.textContent = "현재 찾는 위치: " + item.resolved;
    row.append(main, resolved);
    if (item.elsewhere){
      const actual = document.createElement("div"); actual.className = "py-path-actual";
      actual.textContent = "열린 폴더의 후보: " + item.elsewhere;
      row.appendChild(actual);
      if (item.suggestedCwd && candidates.includes(item.suggestedCwd)){
        const use = document.createElement("button"); use.type = "button"; use.textContent = "실행 기준을 " + item.suggestedCwd + "(으)로 변경";
        use.addEventListener("click", () => {
          setPythonPreferredRunCwd(runCtx, item.suggestedCwd);
          updateRunProjectPanel(ui, null, runCtx);
          renderPythonPathHelper(panel, src, runCtx, ui);
        });
        row.appendChild(use);
      }
    }
    refs.appendChild(row);
  }
  panel.appendChild(refs);

  const examplesTitle = document.createElement("h4"); examplesTitle.textContent = "안전한 경로 예제";
  panel.appendChild(examplesTitle);
  const examples = document.createElement("div"); examples.className = "py-path-examples";
  panel.appendChild(examples);
  const readable = guide.refs.find(item => item.existsFile);
  const writable = guide.refs.find(item => !item.existsFile && (item.parentExists || item.elsewhere));
  const inputRef = readable ? readable.ref : "dataIn/input.xml";
  const outputRef = writable ? writable.ref : "dataOut/output.xml";
  appendPythonPathExample(examples, "파일 읽기",
    "from pathlib import Path\n\ninput_path = Path(" + JSON.stringify(inputRef) + ")\nprint(input_path.resolve())\ntext = input_path.read_text(encoding=\"utf-8\")");
  appendPythonPathExample(examples, "파일 저장",
    "from pathlib import Path\n\noutput_path = Path(" + JSON.stringify(outputRef) + ")\noutput_path.parent.mkdir(parents=True, exist_ok=True)\n# 저장 함수에 output_path를 전달하세요.");
  const localPy = guide.paths.find(path => /^[A-Za-z_]\w*\.py$/i.test(path.split("/").pop() || "") &&
    path !== guide.target && runPathDir(path) === guide.cwd);
  const moduleName = localPy ? localPy.split("/").pop().replace(/\.py$/i, "") : "helper";
  appendPythonPathExample(examples, "같은 폴더 모듈 import",
    "from " + moduleName.replace(/[^\w]/g, "_") + " import 함수명\n\n# " + moduleName + ".py가 실행 기준 폴더에 있어야 합니다.");
}
function updateRunProjectPanel(ui, bundle, runCtx){
  if (!ui || !ui.projectSummary || !ui.projectBody) return;
  const owner = runCtx && runCtx.ownerDoc;
  const logicalTarget = normalizedRunPath((bundle && bundle.target) ||
    (owner && (owner.workspacePath || owner.relPath || owner.name)) || "script.py");
  const target = logicalTarget || "script.py";
  const cwd = normalizedRunPath(bundle && bundle.cwd) || pythonPreferredRunCwd(runCtx) || runPathDir(target) || ".";
  const paths = bundle && bundle.files && bundle.files.length
    ? bundle.files.map((file) => normalizedRunPath(file.path)).filter(Boolean)
    : [target];
  const runtime = runRuntimeFileStore(runCtx, false);
  if (runtime) for (const path of runtime.keys()) if (!paths.includes(path)) paths.push(path);
  ui.projectSummary.textContent = "실행 작업폴더 · " + cwd + " · " + paths.length + "개 파일";
  ui.projectBody.textContent = "";
  const note = document.createElement("p");
  note.textContent = "상대경로 기준: " + cwd + " · 파일명을 누르면 앱에서 내용을 볼 수 있습니다.";
  const files = document.createElement("div"); files.className = "run-project-files";
  files.setAttribute("role", "list");
  const shown = paths.slice(0, 80);
  for (const path of shown){
    const normalized = normalizedRunPath(path);
    const runtimeBytes = runtime && runtime.get(normalized);
    const bundleFile = bundle && bundle.files && bundle.files.find(file => normalizedRunPath(file.path) === normalized);
    const row = document.createElement("button"); row.type = "button"; row.className = "run-project-file";
    row.setAttribute("role", "listitem");
    row.title = normalized + " 열기";
    const name = document.createElement("span"); name.className = "run-project-file-name"; name.textContent = normalized;
    row.appendChild(name);
    if (runtimeBytes){
      const badge = document.createElement("span"); badge.className = "run-project-file-badge"; badge.textContent = "생성/변경";
      row.classList.add("is-runtime");
      row.appendChild(badge);
    }
    const byteLength = runtimeBytes ? runtimeBytes.length : (bundleFile && bundleFile.bytes ? bundleFile.bytes.length : 0);
    if (byteLength){
      const size = document.createElement("span"); size.className = "run-project-file-size"; size.textContent = humanSize(byteLength);
      row.appendChild(size);
    }
    row.addEventListener("click", async () => {
      if (row.disabled) return;
      row.disabled = true;
      try { await openRunProjectFile(normalized, bundle, runCtx); }
      catch(e){
        console.error(e);
        toast("파일을 열지 못했어요: " + ((e && e.message) || e), 3000);
      } finally { row.disabled = false; }
    });
    files.appendChild(row);
  }
  if (paths.length > shown.length){
    const more = document.createElement("div"); more.className = "run-project-more";
    more.textContent = "… 외 " + (paths.length - shown.length) + "개";
    files.appendChild(more);
  }
  const keep = document.createElement("p"); keep.className = "run-project-note";
  const runtimeHolder = runRuntimeFileHolder(runCtx);
  keep.textContent = runtime && runtime.size && runtimeHolder && runtimeHolder.runtimeFilesPersisted
    ? "초록색 생성·변경 파일 " + runtime.size + "개는 실제 저장 폴더와 최근 작업공간에 자동 저장되었습니다."
    : runtime && runtime.size
    ? "초록색 생성·변경 파일 " + runtime.size + "개는 이번 앱 세션 동안 열어보고 다음 실행에서도 사용할 수 있습니다."
    : "실행에서 만든 파일은 이번 앱 세션 동안 다음 실행 작업폴더로 이어집니다.";
  ui.projectBody.append(note, files, keep);
}
function mergeRuntimeFiles(runCtx, files, keep){
  const store = runRuntimeFileStore(runCtx, false);
  if (!store || !store.size) return files;
  const byPath = new Map((files || []).map((file) => [normalizedRunPath(file.path), file]));
  for (const [path, bytes] of store){
    if (typeof keep === "function" && !keep(path)) continue;
    byPath.set(normalizedRunPath(path), { path: normalizedRunPath(path), bytes });
  }
  return [...byPath.values()];
}
async function rememberRunOutputs(runCtx, bundle, outputs, sessionId){
  if (!outputs || !outputs.length) return { count:0, persisted:false };
  const store = runRuntimeFileStore(runCtx, true);
  if (!store) return { count:0, persisted:false };
  const ownerPath = normalizedRunPath(runCtx && runCtx.ownerDoc &&
    (runCtx.ownerDoc.workspacePath || runCtx.ownerDoc.relPath || runCtx.ownerDoc.name || ""));
  let remembered = 0, total = 0;
  const savedRows = [];
  for (const output of outputs){
    const size = Number(output.size) || (output.bytes && output.bytes.length) || 0;
    if (size > 20 * 1024 * 1024 || total + size > RUN_BUNDLE_CAP) continue;
    let bytes = output.bytes ? new Uint8Array(output.bytes) : null;
    if (!bytes && sessionId){
      try {
        const response = await fetch("/python-session-file?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(output.name));
        if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      } catch(_){}
    }
    if (!bytes) continue;
    const path = resolveRuntimeOutputPath(ownerPath, output.name, bundle && bundle.logicalRoot, !!bundle);
    store.set(path, bytes);
    savedRows.push({ path, bytes });
    total += bytes.length;
    remembered++;
  }
  let persisted = false;
  if (savedRows.length){
    persisted = await persistRunOutputFiles(savedRows);
    const holder = runRuntimeFileHolder(runCtx);
    if (holder && persisted) holder.runtimeFilesPersisted = true;
  }
  return { count:remembered, persisted };
}
async function persistRunOutputFiles(rows){
  if (!rows || !rows.length || (location.protocol !== "http:" && location.protocol !== "https:")) return false;
  const files = rows.map(row => {
    const path = normalizedRunPath(row.path);
    const name = path.split("/").pop() || "output.dat";
    const file = new File([row.bytes], name);
    if (path) Object.defineProperty(file, "webkitRelativePath", { value:path });
    return file;
  });
  let workspaceSaved = false;
  if (typeof rememberWorkspace === "function"){
    try { workspaceSaved = await rememberWorkspace(files, false, { silent:true }); }
    catch(e){ console.warn("실행 결과 작업공간 저장 실패:", e); }
  }
  let diskSaved = 0;
  if (await saveFileBackendAvailable()){
    for (const row of rows){
      try {
        const path = normalizedRunPath(row.path);
        const response = await fetch("/save-file", {
          method: "POST",
          headers: { "X-Save-Path": encodeURIComponent(path) },
          body: new Blob([row.bytes], { type:"application/octet-stream" })
        });
        if (response.ok) diskSaved++;
      } catch(e){ console.warn("실행 결과 파일 저장 실패:", e); }
    }
  }
  return workspaceSaved || diskSaved === rows.length;
}
async function openDocRunText(doc, fallback){
  if (fallback !== undefined) return String(fallback);
  if (doc && doc.codeEditor && typeof doc.codeEditor.getValue === "function") return doc.codeEditor.getValue();
  if (doc && typeof doc.savedText === "string") return doc.savedText;
  if (doc && doc.sourceFile && typeof doc.sourceFile.arrayBuffer === "function"){
    try {
      return smartDecodeText(await readDocSourceBytes(doc)).replace(/\r\n?/g, "\n");   // 스냅샷 만료 시 핸들로 재취득
    } catch(_){}
  }
  return null;
}

async function buildOpenPythonSiblingBundle(src, runCtx, scopeSource){
  const ownerDoc = runCtx && runCtx.ownerDoc;
  if (!ownerDoc || (runCtx && runCtx.archiveCtx)) return null;
  const target = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.name || "script.py");
  if (!isRunnablePythonPath(target)) return null;
  const dir = runPathDir(target);
  const enc = new TextEncoder();
  const byPath = new Map();
  const put = (path, text, priority) => {
    if (text === null) return;
    const prev = byPath.get(path);
    if (!prev || priority >= prev.priority) byPath.set(path, { path, bytes: enc.encode(text), priority });
  };
  const putBytes = (path, bytes, priority) => {
    if (!bytes) return;
    const prev = byPath.get(path);
    if (!prev || priority >= prev.priority) byPath.set(path, { path, bytes, priority });
  };
  // 비-PDF 문서 전체 수집(데이터 파일 참조 분석에도 사용). .py 후보는 별도 분리.
  const allDocs = [];
  const pyCandidates = [];
  for (const doc of docs){
    if (!doc || doc.kind === "pdf") continue;
    if (doc.sourceKey && String(doc.sourceKey).indexOf("definition:") === 0) continue;
    const path = normalizedRunPath(doc.workspacePath || doc.name || "");
    if (!path) continue;
    allDocs.push({ doc, path });
    if (isRunnablePythonPath(path)){
      const text = await openDocRunText(doc, doc === ownerDoc ? src : undefined);
      const priority = (doc === ownerDoc ? 100 : 0) + (doc.codeEditor ? 20 : 0) + (doc.id === activeId ? 5 : 0);
      pyCandidates.push({ doc, path, text, priority });
    }
  }
  // 데이터 파일 참조 분석 — 코드의 'dataIn/x.xml' 같은 상대경로를 실제 워크스페이스 파일과 매칭.
  const projCtx = (typeof inferPythonProjectRunContext === "function")
    ? inferPythonProjectRunContext(target, scopeSource == null ? src : scopeSource, allDocs.map(d => d.path), {
        preferredCwd:pythonPreferredRunCwd(runCtx),
        availableDirs:runDirectoryPaths(allDocs.map(d => d.path))
      })
    : { cwd: dir, references: [] };
  // 새 파일·복원 파일처럼 ownerDoc 의 폴더 컨텍스트가 끊겨 target 경로가 파일명만 남은 경우에도,
  // 코드의 dataIn/x.json 같은 상대경로를 열린 작업공간의 suffix 와 다시 맞춘다.
  const matchedReferences = [...(projCtx.references || [])];
  // 참조별 매칭된 데이터 파일들: { ref: 코드의 상대경로, actualPath: 워크스페이스 실제경로, items: [doc, ...] }
  const dataMatches = [];
  for (const r of matchedReferences){
    const refStr = String(r.ref || "").replace(/^\.?\/+/, "").replace(/\\/g, "/");
    const actualPath = normalizedRunPath(r.path);
    const items = [];
    for (const item of allDocs){
      if (isRunnablePythonPath(item.path)) continue;
      if (item.path === actualPath || runPathStartsWith(item.path, actualPath)) items.push(item);
    }
    if (items.length) dataMatches.push({ ref: refStr, actualPath, items });
  }
  // 프로젝트 루트(.py 묶음 기준)는 기존 로직 그대로 — 데이터 파일은 스크립트 dir 기준 상대경로로 따로 배치.
  const pyRoot = inferOpenPythonProjectRoot(target, scopeSource == null ? src : scopeSource, pyCandidates.map(c => c.path));
  const projectRoot = pyRoot;
  const runtimeFiles = runRuntimeFileStore(runCtx, false);
  for (const item of pyCandidates){
    if (projectRoot != null){
      if (!runPathStartsWith(item.path, projectRoot)) continue;
      put(item.path, item.text, item.priority);
    } else {
      if (runPathDir(item.path) !== dir) continue;
      put(item.path, item.text, item.priority);
    }
  }
  if (runtimeFiles){
    for (const [runtimePath, bytes] of runtimeFiles){
      const path = normalizedRunPath(runtimePath);
      if (projectRoot != null){
        if (!runPathStartsWith(path, projectRoot)) continue;
        byPath.set(path, { path, bytes, priority: 900 });
      } else {
        if (runPathDir(path) !== dir) continue;
        byPath.set(path, { path, bytes, priority: 900 });
      }
    }
  }
  put(target, src, 1000);
  // 참조된 데이터 파일도 실제 프로젝트 상대 위치에 둔다. cwd와 파일 트리를 함께 보존하므로
  // dataIn/x.csv와 ../dataIn/x.csv가 일반 Python의 상대경로 규칙 그대로 구분된다.
  const DATA_PER_FILE_CAP = 20 * 1024 * 1024;
  for (const m of dataMatches){
    for (const item of m.items){
      if (!item.doc || !item.doc.sourceFile) continue;
      try {
        // 폴더 스냅샷이 오래돼 읽기가 실패하면 원본 핸들로 다시 떠서 재시도(내용 검색 뒤 실행 시 누락 방지).
        const bytes = await readDocSourceBytes(item.doc);
        if (bytes.byteLength > DATA_PER_FILE_CAP) continue;
        putBytes(item.path, bytes, 500);
      } catch(e){ console.warn("data file bundle skipped:", item.path, e); }
    }
  }
  const files = [...byPath.values()].map(f => ({ path: f.path, bytes: f.bytes }));
  if (files.length <= 1) return null;
  const total = files.reduce((sum, f) => sum + (f.bytes ? f.bytes.length : 0), 0);
  if (total > RUN_BUNDLE_CAP) throw new Error("open-python-siblings-too-large");
  return {
    files,
    target,
    cwd:normalizedRunPath(projCtx.cwd) || dir,
    logicalRoot:commonTopDir(files.map(file => file.path)) || ""
  };
}

// exe 런처(로컬 서버)에서 실제 python 실행이 가능한지 — pptxBackendAvailable 과 동일 패턴
async function pythonBackendAvailable(){
  if (/[?&]py=wasm\b/.test(location.search)) return false;  // 테스트용: ?py=wasm 이면 로컬 파이썬 무시하고 브라우저 Pyodide 강제
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;  // file:// → 백엔드 없음
  if (_pyBackend !== null) return _pyBackend;
  try {
    const res = await fetch("/can-run-python", { method: "GET" });
    _pyBackend = res.ok && (await res.text()).trim().toLowerCase().startsWith("yes");
  } catch(e){ _pyBackend = false; }
  return _pyBackend;
}

async function pythonEnvironmentDetails(){
  const browserMode = {
    backend: false,
    mode: "Browser Pyodide",
    python: "Pyodide " + PYODIDE_VER,
    command: "",
    pip: "자동 패키지 로드",
    jedi: "기본 자동완성",
    saveRoot: ""
  };
  if (location.protocol !== "http:" && location.protocol !== "https:") return browserMode;
  try {
    const res = await fetch("/python-diagnostics", { method: "GET", cache: "no-store" });
    if (res.ok){
      const data = await res.json();
      return {
        backend: !!data.ok,
        mode: data.ok ? "Local Python" : "Browser Pyodide",
        python: data.version || (data.ok ? "확인됨" : ("Pyodide " + PYODIDE_VER)),
        command: data.command || "",
        pip: data.pip ? "사용 가능" : (data.ok ? "확인 필요" : "자동 패키지 로드"),
        jedi: data.jedi ? "사용 가능" : (data.ok ? "설치 필요" : "기본 자동완성"),
        saveRoot: data.saveRoot || ""
      };
    }
  } catch(e){}
  const backend = await pythonBackendAvailable();
  return backend ? {
    backend: true, mode: "Local Python", python: "확인됨", command: "", pip: "확인 필요", jedi: "확인 필요", saveRoot: ""
  } : browserMode;
}

function refreshPythonEnvButton(btn){
  if (!btn) return;
  pythonEnvironmentDetails().then(info => {
    btn.classList.toggle("is-ok", !!info.backend);
    btn.classList.toggle("is-warn", !info.backend);
    btn.title = info.backend ? "로컬 Python 실행 환경 진단" : "브라우저 Pyodide 실행 환경";
  }).catch(() => {});
}

// Py Env 버튼: 실행 환경 정보를 모달로 표시(편집기 아래 영역을 차지하지 않게).
function openPythonEnvModal(btn){
  const modal = document.createElement("div"); modal.className = "modal py-env-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const panel = document.createElement("div"); panel.className = "py-env-panel";
  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); close(); } };
  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  cancel.addEventListener("click", close);
  actions.append(spacer, cancel);
  card.append(panel, actions);
  modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });   // 바깥 클릭 닫기
  document.body.appendChild(modal);
  setTimeout(() => { try { cancel.focus(); } catch(e){} }, 0);
  window.addEventListener("keydown", onKey, true);
  refreshPythonEnvPanel(panel, btn);
}

function loadAssignmentTests(storageKey){
  try { return normalizeAssignmentTests(JSON.parse(localStorage.getItem(storageKey) || "[]")); }
  catch(_){ return []; }
}

function saveAssignmentTests(storageKey, tests){
  const rows = normalizeAssignmentTests(tests);
  try { localStorage.setItem(storageKey, JSON.stringify(rows)); } catch(_){}
  return rows;
}

function openAssignmentGradingModal(options){
  options = options || {};
  const modal = document.createElement("div"); modal.className = "modal py-grade-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const title = document.createElement("h3"); title.textContent = "과제 자동채점";
  const sub = document.createElement("p"); sub.className = "sub";
  sub.textContent = "각 테스트의 input() 입력과 기대 출력을 적으세요. 줄 끝 공백과 앞뒤 빈 줄은 채점에서 무시합니다.";
  const list = document.createElement("div"); list.className = "py-grade-test-list";
  let seed = loadAssignmentTests(options.storageKey);
  if (!seed.length) seed = [{ name:"테스트 1", input:"", expected:"" }];

  const collect = () => normalizeAssignmentTests([...list.querySelectorAll(".py-grade-test")].map(row => ({
    name: row.querySelector(".py-grade-name").value,
    input: row.querySelector(".py-grade-input").value,
    expected: row.querySelector(".py-grade-expected").value
  })));
  const renumber = () => {
    [...list.querySelectorAll(".py-grade-test")].forEach((row, index) => {
      const label = row.querySelector(".py-grade-index");
      if (label) label.textContent = "#" + (index + 1);
    });
  };
  const addRow = (test) => {
    if (list.children.length >= 20) { toast("테스트는 최대 20개까지 만들 수 있어요.", 2200); return; }
    const row = document.createElement("section"); row.className = "py-grade-test";
    const head = document.createElement("div"); head.className = "py-grade-test-head";
    const index = document.createElement("span"); index.className = "py-grade-index";
    const name = document.createElement("input"); name.type = "text"; name.className = "py-grade-name";
    name.maxLength = 120; name.value = test.name || ("테스트 " + (list.children.length + 1)); name.setAttribute("aria-label", "테스트 이름");
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "py-grade-remove"; remove.textContent = "삭제";
    remove.addEventListener("click", () => {
      row.remove();
      if (!list.children.length) addRow({ name:"테스트 1", input:"", expected:"" });
      renumber();
    });
    head.append(index, name, remove);
    const fields = document.createElement("div"); fields.className = "py-grade-fields";
    const makeField = (labelText, cls, value, placeholder) => {
      const label = document.createElement("label"); label.textContent = labelText;
      const area = document.createElement("textarea"); area.className = cls; area.value = value || "";
      area.placeholder = placeholder; area.spellcheck = false; area.maxLength = 20000;
      label.appendChild(area);
      return label;
    };
    fields.append(
      makeField("입력값 (input)", "py-grade-input", test.input, "예: 2↵3"),
      makeField("기대 출력", "py-grade-expected", test.expected, "예: 5")
    );
    row.append(head, fields); list.appendChild(row); renumber();
  };
  seed.forEach(addRow);

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const add = document.createElement("button"); add.className = "btn"; add.type = "button"; add.textContent = "+ 테스트 추가";
  add.addEventListener("click", () => addRow({ name:"테스트 " + (list.children.length + 1), input:"", expected:"" }));
  // 과제 패키지(.task) 내보내기 — 편집기에서 열었을 때만(taskExport 제공 시) 노출
  let exportTaskBtn = null;
  if (options.taskExport && typeof openTaskBuilderModal === "function"){
    exportTaskBtn = document.createElement("button"); exportTaskBtn.className = "btn"; exportTaskBtn.type = "button";
    exportTaskBtn.textContent = "📦 과제로 내보내기";
    exportTaskBtn.title = "현재 코드와 이 테스트로 배포용 과제 파일(.task) 만들기";
    exportTaskBtn.addEventListener("click", () => {
      const tests = saveAssignmentTests(options.storageKey, collect());
      if (!tests.length){ toast("테스트를 1개 이상 채워 주세요.", 2600); return; }
      close(false);
      openTaskBuilderModal({ ...options.taskExport, tests });
    });
  }
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  const run = document.createElement("button"); run.className = "btn primary"; run.type = "button"; run.textContent = "저장하고 채점";
  const close = (save) => {
    window.removeEventListener("keydown", onKey, true);
    modal.remove();
    if (save){
      try { saveAssignmentTests(options.storageKey, collect()); }
      catch(e){ console.warn("assignment tests save skipped:", e); }
    }
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation(); close(true);
  };
  cancel.addEventListener("click", () => close(true));
  run.addEventListener("click", () => {
    const tests = saveAssignmentTests(options.storageKey, collect());
    close(false);
    if (typeof options.onRun === "function") options.onRun(tests);
  });
  if (exportTaskBtn) actions.append(add, exportTaskBtn, spacer, cancel, run);
  else actions.append(add, spacer, cancel, run);
  card.append(title, sub, list, actions); modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(true); });
  document.body.appendChild(modal);
  window.addEventListener("keydown", onKey, true);
  setTimeout(() => { const first = list.querySelector(".py-grade-name"); if (first) first.focus(); }, 0);
}

const PY_GRADE_MARKER = "__MANNEUNG_GRADE__";
function utf8ToBase64(value){
  const bytes = new TextEncoder().encode(String(value == null ? "" : value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToUtf8(value){
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function buildPythonGradingHarness(source, tests, fileName){
  const source64 = utf8ToBase64(source);
  const tests64 = utf8ToBase64(JSON.stringify(normalizeAssignmentTests(tests)));
  const file64 = utf8ToBase64(fileName || "assignment.py");
  return [
    "import base64 as __mg_b64, contextlib as __mg_ctx, io as __mg_io, json as __mg_json, os as __mg_os, sys as __mg_sys, traceback as __mg_tb",
    "__mg_source = __mg_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__mg_cases = __mg_json.loads(__mg_b64.b64decode('" + tests64 + "').decode('utf-8'))",
    "__mg_file = str(globals().get('__file__') or __mg_b64.b64decode('" + file64 + "').decode('utf-8'))",
    "__mg_start_dir = __mg_os.getcwd()",
    "def __mg_norm(__mg_value):",
    "    __mg_lines = str(__mg_value).replace('\\r\\n', '\\n').replace('\\r', '\\n').split('\\n')",
    "    while __mg_lines and not __mg_lines[0].strip(): __mg_lines.pop(0)",
    "    while __mg_lines and not __mg_lines[-1].strip(): __mg_lines.pop()",
    "    return '\\n'.join(__mg_line.rstrip(' \\t') for __mg_line in __mg_lines)",
    "class __mg_Limited(__mg_io.StringIO):",
    "    def __init__(self, limit=200000):",
    "        super().__init__(); self.limit = limit; self.cut = False",
    "    def write(self, value):",
    "        text = str(value); remaining = max(0, self.limit - self.tell())",
    "        if remaining: super().write(text[:remaining])",
    "        if len(text) > remaining and not self.cut:",
    "            self.cut = True; super().write('\\n[채점 출력이 200KB를 넘어 일부 생략됨]\\n')",
    "        return len(text)",
    "__mg_results = []",
    "for __mg_index, __mg_case in enumerate(__mg_cases):",
    "    __mg_out, __mg_err = __mg_Limited(), __mg_Limited()",
    "    __mg_old_in = __mg_sys.stdin",
    "    __mg_error = ''",
    "    try:",
    "        __mg_sys.stdin = __mg_io.StringIO(str(__mg_case.get('input', '')))",
    "        __mg_scope = {'__name__': '__main__', '__file__': __mg_file}",
    "        with __mg_ctx.redirect_stdout(__mg_out), __mg_ctx.redirect_stderr(__mg_err):",
    "            exec(compile(__mg_source, __mg_file, 'exec'), __mg_scope, __mg_scope)",
    "    except BaseException:",
    "        __mg_error = __mg_tb.format_exc().strip()",
    "    finally:",
    "        __mg_sys.stdin = __mg_old_in",
    "        try: __mg_os.chdir(__mg_start_dir)",
    "        except BaseException: pass",
    "    __mg_actual = __mg_out.getvalue()",
    "    __mg_stderr = __mg_err.getvalue().strip()",
    "    if __mg_stderr and not __mg_error: __mg_error = __mg_stderr",
    "    __mg_expected = str(__mg_case.get('expected', ''))",
    "    __mg_results.append({'name': str(__mg_case.get('name') or ('테스트 ' + str(__mg_index + 1))), 'input': str(__mg_case.get('input', '')), 'expected': __mg_expected, 'actual': __mg_actual, 'error': __mg_error, 'passed': not __mg_error and __mg_norm(__mg_actual) == __mg_norm(__mg_expected)})",
    "__mg_payload = __mg_json.dumps({'results': __mg_results}, ensure_ascii=False).encode('utf-8')",
    "print('" + PY_GRADE_MARKER + "' + __mg_b64.b64encode(__mg_payload).decode('ascii'))"
  ].join("\n");
}

function parsePythonGradingReport(stdout){
  const text = String(stdout || "");
  const at = text.lastIndexOf(PY_GRADE_MARKER);
  if (at < 0) return null;
  const encoded = text.slice(at + PY_GRADE_MARKER.length).trim().split(/\s/)[0];
  try {
    const parsed = JSON.parse(base64ToUtf8(encoded));
    if (!parsed || !Array.isArray(parsed.results)) return null;
    parsed.results = parsed.results.slice(0, 20).map((row, index) => ({
      name: String(row && row.name || ("테스트 " + (index + 1))).slice(0, 120),
      input: String(row && row.input || ""),
      expected: String(row && row.expected || ""),
      actual: String(row && row.actual || ""),
      error: String(row && row.error || ""),
      passed: !!(row && row.passed)
    }));
    return parsed;
  } catch(_){ return null; }
}

function renderAssignmentGradingResult(panel, report, stderr, gradeTests){
  // gradeTests[i].hidden(과제 패키지의 숨김 테스트)이면 입력·기대·실제 출력을 가리고 통과/실패만 보여준다.
  const hiddenAt = (index) => !!(Array.isArray(gradeTests) && gradeTests[index] && gradeTests[index].hidden);
  panel.innerHTML = "";
  const results = report && Array.isArray(report.results) ? report.results : [];
  const passed = results.filter(row => row.passed).length;
  const head = document.createElement("div"); head.className = "out-head";
  head.textContent = results.length ? ("과제 자동채점 · " + passed + "/" + results.length + " 통과") : "과제 자동채점";
  panel.appendChild(head);
  if (!results.length){
    const pre = document.createElement("pre"); pre.className = "out-pre out-err";
    pre.textContent = stderr || "채점 결과를 읽지 못했습니다. 일반 실행으로 코드 오류를 먼저 확인해 주세요.";
    panel.appendChild(pre);
    return { passed:0, total:0 };
  }
  const summary = document.createElement("div"); summary.className = "py-grade-summary " + (passed === results.length ? "is-pass" : "is-fail");
  const score = document.createElement("strong"); score.textContent = passed + " / " + results.length;
  const label = document.createElement("span"); label.textContent = passed === results.length ? "모든 테스트 통과" : (results.length - passed) + "개 테스트를 다시 확인하세요";
  summary.append(score, label); panel.appendChild(summary);
  const list = document.createElement("div"); list.className = "py-grade-results";
  results.forEach((row, index) => {
    const item = document.createElement("details"); item.className = "py-grade-result " + (row.passed ? "is-pass" : "is-fail");
    if (!row.passed) item.open = true;
    const title = document.createElement("summary");
    const mark = document.createElement("span"); mark.className = "py-grade-result-mark"; mark.textContent = row.passed ? "통과" : "실패";
    const name = document.createElement("span"); name.textContent = (row.name || ("테스트 " + (index + 1))) + (hiddenAt(index) ? " 🔒" : "");
    title.append(mark, name); item.appendChild(title);
    const body = document.createElement("div"); body.className = "py-grade-result-body";
    const addValue = (caption, value, cls) => {
      const block = document.createElement("div"); block.className = "py-grade-result-value" + (cls ? " " + cls : "");
      const labelEl = document.createElement("b"); labelEl.textContent = caption;
      const pre = document.createElement("pre"); pre.textContent = value === "" ? "(없음)" : value;
      block.append(labelEl, pre); body.appendChild(block);
    };
    if (hiddenAt(index)){
      const note = document.createElement("p"); note.className = "py-grade-hidden-note";
      note.textContent = "숨김 테스트 — 입력·기대 출력·실제 출력은 표시되지 않아요.";
      body.appendChild(note);
    } else {
      if (row.input) addValue("입력", row.input);
      addValue("기대 출력", row.expected);
      addValue("실제 출력", row.actual);
      if (row.error) addValue("실행 오류", row.error, "is-error");
    }
    item.appendChild(body); list.appendChild(item);
  });
  panel.appendChild(list);
  return { passed, total:results.length };
}

const PY_DIAG_MARKER = "__MANNEUNG_DIAG__";
const PY_TRACE_MARKER = "__MANNEUNG_TRACE__";

function buildPythonDiagnosticHarness(source, fileName){
  const source64 = utf8ToBase64(source);
  const file64 = utf8ToBase64(fileName || "practice.py");
  return [
    "import ast as __md_ast, base64 as __md_b64, builtins as __md_builtins, json as __md_json, warnings as __md_warnings",
    "__md_source = __md_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__md_file = __md_b64.b64decode('" + file64 + "').decode('utf-8')",
    "__md_items = []",
    "def __md_add(severity, line, column, code, message, hint=''):",
    "    __md_items.append({'severity': severity, 'line': max(1, int(line or 1)), 'column': max(0, int(column or 0)), 'code': code, 'message': message, 'hint': hint})",
    "for __md_no, __md_line in enumerate(__md_source.splitlines(), 1):",
    "    __md_indent = __md_line[:len(__md_line) - len(__md_line.lstrip(' \\t'))]",
    "    if '\\t' in __md_indent:",
    "        __md_add('warning', __md_no, 0, 'PY-TAB', '들여쓰기에 탭 문자가 있어요.', '탭과 공백을 섞으면 실행 환경에 따라 들여쓰기가 달라질 수 있어요. 공백 4칸으로 맞춰 보세요.')",
    "__md_tree = None",
    "try:",
    "    with __md_warnings.catch_warnings(record=True) as __md_caught:",
    "        __md_warnings.simplefilter('always')",
    "        compile(__md_source, __md_file, 'exec')",
    "    for __md_warning in __md_caught:",
    "        __md_add('warning', getattr(__md_warning, 'lineno', 1), 0, 'PY-WARN', str(__md_warning.message), 'Python이 실행 전에 발견한 경고입니다.')",
    "    __md_tree = __md_ast.parse(__md_source, __md_file)",
    "except (SyntaxError, IndentationError, TabError) as __md_error:",
    "    __md_add('error', getattr(__md_error, 'lineno', 1), max(0, (getattr(__md_error, 'offset', 1) or 1) - 1), type(__md_error).__name__, getattr(__md_error, 'msg', str(__md_error)), '표시된 줄과 바로 위 줄의 괄호·콜론·따옴표·들여쓰기를 확인해 보세요.')",
    "if __md_tree is not None:",
    "    _md_defined = {'__name__': 1, '__file__': 1}",
    "    _md_loaded = {}",
    "    _md_wildcard = False",
    "    _md_ast = __md_ast",
    "    class __md_Names(__md_ast.NodeVisitor):",
    "        def visit_Name(self, node):",
    "            if isinstance(node.ctx, _md_ast.Store): _md_defined.setdefault(node.id, getattr(node, 'lineno', 1))",
    "            elif isinstance(node.ctx, _md_ast.Load): _md_loaded.setdefault(node.id, getattr(node, 'lineno', 1))",
    "        def visit_arg(self, node): _md_defined.setdefault(node.arg, getattr(node, 'lineno', 1))",
    "        def visit_FunctionDef(self, node):",
    "            _md_defined.setdefault(node.name, getattr(node, 'lineno', 1)); self.generic_visit(node)",
    "        visit_AsyncFunctionDef = visit_FunctionDef",
    "        def visit_ClassDef(self, node):",
    "            _md_defined.setdefault(node.name, getattr(node, 'lineno', 1)); self.generic_visit(node)",
    "        def visit_Import(self, node):",
    "            for alias in node.names: _md_defined.setdefault(alias.asname or alias.name.split('.')[0], getattr(node, 'lineno', 1))",
    "        def visit_ImportFrom(self, node):",
    "            global _md_wildcard",
    "            for alias in node.names:",
    "                if alias.name == '*': _md_wildcard = True",
    "                else: _md_defined.setdefault(alias.asname or alias.name, getattr(node, 'lineno', 1))",
    "        def visit_ExceptHandler(self, node):",
    "            if isinstance(node.name, str): _md_defined.setdefault(node.name, getattr(node, 'lineno', 1))",
    "            self.generic_visit(node)",
    "    __md_Names().visit(__md_tree)",
    "    __md_known = set(dir(__md_builtins)) | set(_md_defined)",
    "    if not _md_wildcard:",
    "        for __md_name, __md_line in _md_loaded.items():",
    "            if __md_name not in __md_known:",
    "                __md_add('warning', __md_line, 0, 'PY-NAME', \"'\" + __md_name + \"' 이름은 정의된 곳을 찾지 못했어요.\", '철자를 확인하거나, 사용하기 전에 값을 대입하거나 import했는지 확인하세요.')",
    "    for __md_node in __md_ast.walk(__md_tree):",
    "        __md_line = getattr(__md_node, 'lineno', 1); __md_col = getattr(__md_node, 'col_offset', 0)",
    "        if isinstance(__md_node, __md_ast.ExceptHandler) and __md_node.type is None:",
    "            __md_add('warning', __md_line, __md_col, 'PY-BARE-EXCEPT', '예외 종류가 없는 except는 모든 오류를 숨길 수 있어요.', 'except ValueError:처럼 예상한 예외 종류를 적어 주세요.')",
    "        if isinstance(__md_node, (__md_ast.FunctionDef, __md_ast.AsyncFunctionDef)):",
    "            for __md_default in list(__md_node.args.defaults) + [value for value in __md_node.args.kw_defaults if value is not None]:",
    "                if isinstance(__md_default, (__md_ast.List, __md_ast.Dict, __md_ast.Set)):",
    "                    __md_add('warning', getattr(__md_default, 'lineno', __md_line), getattr(__md_default, 'col_offset', __md_col), 'PY-MUTABLE-DEFAULT', '함수 기본값에 변경 가능한 자료형을 사용했어요.', '기본값은 None으로 두고 함수 안에서 새 리스트나 딕셔너리를 만드세요.')",
    "        if isinstance(__md_node, __md_ast.Compare) and any(isinstance(op, (__md_ast.Eq, __md_ast.NotEq)) for op in __md_node.ops):",
    "            __md_values = [__md_node.left] + list(__md_node.comparators)",
    "            if any(isinstance(value, __md_ast.Constant) and value.value is None for value in __md_values):",
    "                __md_add('info', __md_line, __md_col, 'PY-NONE', 'None 비교에는 is 또는 is not이 더 분명해요.', 'value is None 또는 value is not None 형태를 권장합니다.')",
    "        if isinstance(__md_node, __md_ast.Call) and isinstance(__md_node.func, __md_ast.Name) and __md_node.func.id in ('eval', 'exec'):",
    "            __md_add('warning', __md_line, __md_col, 'PY-DYNAMIC', __md_node.func.id + '()는 문자열을 코드로 실행해 예상하지 못한 동작을 만들 수 있어요.', '학습 목적이 아니라면 일반 조건문·함수 호출로 바꿀 수 있는지 확인하세요.')",
    "        if isinstance(__md_node, __md_ast.While) and isinstance(__md_node.test, __md_ast.Constant) and __md_node.test.value is True:",
    "            __md_add('info', __md_line, __md_col, 'PY-LOOP', '조건이 항상 참인 반복문입니다.', '반복문 안에 도달 가능한 break 또는 종료 조건이 있는지 확인하세요.')",
    "__md_items.sort(key=lambda item: (item['line'], item['column'], {'error': 0, 'warning': 1, 'info': 2}.get(item['severity'], 9)))",
    "__md_payload = __md_json.dumps({'diagnostics': __md_items[:100]}, ensure_ascii=False).encode('utf-8')",
    "print('" + PY_DIAG_MARKER + "' + __md_b64.b64encode(__md_payload).decode('ascii'))"
  ].join("\n");
}

// .ipynb 변환 문서를 "셀 단위"로 실행하는 하니스.
//  · '# … 코드 셀 N …' 주석을 경계로 잘라 각 셀을 같은 전역(globals)에서 차례로 실행
//  · 한 셀에서 에러가 나도 traceback만 보여주고 다음 셀을 계속 실행(주피터와 비슷)
//  · 각 셀을 원래 줄 위치에 맞춰 compile → traceback 줄 번호가 편집기와 정확히 일치
//  · 디스크의 임시 파일이 아닌 학생 코드를 linecache에 등록해 traceback 소스 줄도 올바르게 표시
function buildPythonCellHarness(source, fileName){
  const source64 = utf8ToBase64(String(source == null ? "" : source).replace(/\r\n?/g, "\n"));
  const file64 = utf8ToBase64(fileName || "notebook.py");
  // 역슬래시 이스케이프 혼선을 피하려고 줄바꿈은 chr(10), 셀 경계는 정규식 없이 문자열 검사로 처리한다.
  return [
    "import base64 as __nb_b64, sys as __nb_sys, traceback as __nb_tb, linecache as __nb_lc",
    "__nb_NL = chr(10)",
    "__nb_src = __nb_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__nb_file = __nb_b64.b64decode('" + file64 + "').decode('utf-8')",
    "__nb_lines = __nb_src.split(__nb_NL)",
    "__nb_lc.cache[__nb_file] = (len(__nb_src), None, [__nb_l + __nb_NL for __nb_l in __nb_lines], __nb_file)",
    "def __nb_is_head(__nb_l):",
    "    __nb_t = __nb_l.lstrip()",
    "    return __nb_t.startswith('#') and (__nb_t.lstrip('#').lstrip().startswith('%%') or '코드 셀' in __nb_t)",
    "__nb_marks = [__nb_i for __nb_i, __nb_l in enumerate(__nb_lines) if __nb_is_head(__nb_l)]",
    "__nb_points = sorted(set([0] + __nb_marks + [len(__nb_lines)]))",
    "__nb_glob = {'__name__': '__main__', '__file__': __nb_file}",
    "__nb_failed = 0",
    "__nb_seq = 0",
    "def __nb_label(__nb_text):",
    "    return ''.join(__nb_c for __nb_c in __nb_text if __nb_c.isdigit())",
    "for __nb_k in range(len(__nb_points) - 1):",
    "    __nb_s = __nb_points[__nb_k]",
    "    __nb_e = __nb_points[__nb_k + 1]",
    "    __nb_body = __nb_lines[__nb_s:__nb_e]",
    "    __nb_code = __nb_NL * __nb_s + __nb_NL.join(__nb_body)",
    "    if not __nb_code.strip():",
    "        continue",
    "    __nb_seq += 1",
    "    __nb_digit = __nb_label(__nb_body[0] if __nb_body else '')",
    "    __nb_cell = __nb_digit or str(__nb_seq)",
    "    try:",
    "        __nb_obj = compile(__nb_code, __nb_file, 'exec')",
    "    except SyntaxError as __nb_ex:",
    "        __nb_sys.stdout.flush()",
    "        __nb_sys.stderr.write(__nb_NL + '[코드 셀 ' + __nb_cell + ' 문법 오류]' + __nb_NL)",
    "        __nb_sys.stderr.write(''.join(__nb_tb.format_exception_only(type(__nb_ex), __nb_ex)))",
    "        __nb_failed += 1",
    "        continue",
    "    try:",
    "        exec(__nb_obj, __nb_glob)",
    "    except SystemExit:",
    "        raise",
    "    except KeyboardInterrupt:",
    "        raise",
    "    except BaseException as __nb_ex:",
    "        __nb_sys.stdout.flush()",
    "        __nb_sys.stderr.write(__nb_NL + '[코드 셀 ' + __nb_cell + ' 오류 — 다음 셀은 계속 실행됩니다]' + __nb_NL)",
    "        __nb_sys.stderr.write(''.join(__nb_tb.format_exception(type(__nb_ex), __nb_ex, __nb_ex.__traceback__.tb_next)))",
    "        __nb_failed += 1",
    "if __nb_failed:",
    "    __nb_sys.stderr.flush()",
    "    __nb_sys.exit(1)",
    ""
  ].join("\n");
}

function buildPythonTraceHarness(source, fileName, maxSteps=300){
  const source64 = utf8ToBase64(source);
  const file64 = utf8ToBase64(fileName || "practice.py");
  const limit = Math.max(20, Math.min(500, parseInt(maxSteps, 10) || 300));
  return [
    "import base64 as __mt_b64, json as __mt_json, sys as __mt_sys, traceback as __mt_tb, types as __mt_types",
    "__mt_source = __mt_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__mt_file = __mt_b64.b64decode('" + file64 + "').decode('utf-8')",
    "__mt_limit = " + limit,
    "__mt_steps, __mt_states, __mt_error, __mt_truncated = [], {}, '', False",
    "def __mt_repr(value):",
    "    try: text = repr(value)",
    "    except BaseException: text = '<값을 표시할 수 없음>'",
    "    return text if len(text) <= 240 else text[:239] + '…'",
    "def __mt_snapshot(frame):",
    "    result = {}",
    "    for name, value in sorted(frame.f_locals.items()):",
    "        if not name or name.startswith('__mt_') or name.startswith('__'): continue",
    "        if isinstance(value, (__mt_types.ModuleType, __mt_types.FunctionType, __mt_types.BuiltinFunctionType, type)) or callable(value): continue",
    "        result[name] = {'type': type(value).__name__[:120], 'value': __mt_repr(value)}",
    "        if len(result) >= 25: break",
    "    return result",
    "def __mt_depth(frame):",
    "    depth, current = 0, frame.f_back",
    "    while current is not None:",
    "        if current.f_code.co_filename == __mt_file: depth += 1",
    "        current = current.f_back",
    "    return depth",
    "def __mt_trace(frame, event, arg):",
    "    global __mt_truncated",
    "    if frame.f_code.co_filename != __mt_file: return __mt_trace",
    "    if event not in ('line', 'return'): return __mt_trace",
    "    if len(__mt_steps) >= __mt_limit:",
    "        __mt_truncated = True",
    "        return None",
    "    current = __mt_snapshot(frame)",
    "    key = id(frame); previous = __mt_states.get(key, {})",
    "    changes = []",
    "    for name in sorted(set(previous) | set(current)):",
    "        if name not in previous: changes.append({'name': name, 'before': '', 'after': current[name]['value'], 'type': current[name]['type'], 'kind': 'added'})",
    "        elif name not in current: changes.append({'name': name, 'before': previous[name]['value'], 'after': '', 'type': previous[name]['type'], 'kind': 'removed'})",
    "        elif previous[name] != current[name]: changes.append({'name': name, 'before': previous[name]['value'], 'after': current[name]['value'], 'type': current[name]['type'], 'kind': 'changed'})",
    "    if event == 'return' and arg is not None:",
    "        changes.append({'name': '↩ 반환값', 'before': '', 'after': __mt_repr(arg), 'type': type(arg).__name__[:120], 'kind': 'added'})",
    "    __mt_states[key] = current",
    "    variables = [{'name': name, 'type': value['type'], 'value': value['value']} for name, value in current.items()]",
    "    __mt_steps.append({'line': max(1, int(frame.f_lineno or 1)), 'functionName': frame.f_code.co_name, 'depth': __mt_depth(frame), 'phase': event, 'variables': variables, 'changes': changes[:25]})",
    "    if event == 'return': __mt_states.pop(key, None)",
    "    return __mt_trace",
    "__mt_scope = {'__name__': '__main__', '__file__': __mt_file}",
    "try:",
    "    __mt_code = compile(__mt_source, __mt_file, 'exec')",
    "    __mt_sys.settrace(__mt_trace)",
    "    exec(__mt_code, __mt_scope, __mt_scope)",
    "except BaseException:",
    "    __mt_error = __mt_tb.format_exc().strip()",
    "finally:",
    "    __mt_sys.settrace(None)",
    "__mt_payload = __mt_json.dumps({'steps': __mt_steps, 'truncated': __mt_truncated, 'error': __mt_error}, ensure_ascii=False).encode('utf-8')",
    "print('\\n" + PY_TRACE_MARKER + "' + __mt_b64.b64encode(__mt_payload).decode('ascii'))"
  ].join("\n");
}

function parsePythonMarkedReport(stdout, marker){
  const text = String(stdout || "");
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const encoded = text.slice(at + marker.length).trim().split(/\s/)[0];
  try {
    return {
      report: JSON.parse(base64ToUtf8(encoded)),
      output: text.slice(0, at).replace(/\r?\n$/, "")
    };
  } catch(_){ return null; }
}

function finishPythonDiagnostics(rawReport, ui){
  const diagnostics = rawReport ? normalizePythonDiagnostics(rawReport.diagnostics) : [];
  const errors = diagnostics.filter(item => item.severity === "error").length;
  const warnings = diagnostics.filter(item => item.severity === "warning").length;
  if (!rawReport){
    if (ui && ui.clearError) ui.clearError();
    toast("진단 결과를 읽지 못했습니다. 다시 시도해 주세요.", 3500, { type:"error" });
    return { errors:1, warnings:0, total:0, failed:true };
  }
  if (!diagnostics.length){
    if (ui && ui.clearError) ui.clearError();
    toast("발견된 문제가 없습니다.", 2600, { type:"success" });
    return { errors, warnings, total:0, failed:false };
  }

  const lines = diagnostics.map(item => item.line);
  if (ui && ui.markErrorLines) ui.markErrorLines(lines);
  else if (ui && ui.markError) ui.markError(lines[0]);
  return { errors, warnings, total:diagnostics.length, failed:false };
}

function renderPythonDiagnostics(panel, rawReport, ui){
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head"; head.textContent = "실행 전 코드 진단";
  panel.appendChild(head);
  if (!rawReport){
    const failed = document.createElement("div"); failed.className = "py-diagnostic-summary is-error";
    failed.textContent = "진단 결과를 읽지 못했습니다. 실행 환경을 확인한 뒤 다시 시도해 주세요.";
    panel.appendChild(failed);
    return { errors:1, warnings:0, total:0 };
  }
  const diagnostics = normalizePythonDiagnostics(rawReport.diagnostics);
  const errors = diagnostics.filter(item => item.severity === "error").length;
  const warnings = diagnostics.filter(item => item.severity === "warning").length;
  const summary = document.createElement("div");
  summary.className = "py-diagnostic-summary " + (errors ? "is-error" : warnings ? "is-warning" : "is-ok");
  summary.textContent = diagnostics.length
    ? ("오류 " + errors + "개 · 경고 " + warnings + "개 · 참고 " + (diagnostics.length - errors - warnings) + "개")
    : "발견된 문제가 없습니다. 그래도 실행 결과가 의도와 같은지는 직접 확인해 주세요.";
  panel.appendChild(summary);
  if (!diagnostics.length){
    if (ui && ui.clearError) ui.clearError();
    return { errors, warnings, total:0 };
  }
  const list = document.createElement("div"); list.className = "py-diagnostic-list";
  const severityLabel = { error:"오류", warning:"경고", info:"참고" };
  diagnostics.forEach(item => {
    const row = document.createElement("button"); row.type = "button"; row.className = "py-diagnostic-item is-" + item.severity;
    const mark = document.createElement("span"); mark.className = "py-diagnostic-mark"; mark.textContent = severityLabel[item.severity];
    const where = document.createElement("code"); where.textContent = item.line + "줄" + (item.column ? " " + (item.column + 1) + "칸" : "");
    const body = document.createElement("span"); body.className = "py-diagnostic-body";
    const message = document.createElement("strong"); message.textContent = item.message;
    body.appendChild(message);
    if (item.hint){ const hint = document.createElement("small"); hint.textContent = item.hint; body.appendChild(hint); }
    const code = document.createElement("code"); code.className = "py-diagnostic-code"; code.textContent = item.code;
    row.append(mark, where, body, code);
    row.addEventListener("click", () => { if (ui && ui.focusLine) ui.focusLine(item.line); });
    list.appendChild(row);
  });
  panel.appendChild(list);
  const firstError = diagnostics.find(item => item.severity === "error");
  if (firstError && ui && ui.markError) ui.markError(firstError.line);
  else if (ui && ui.clearError) ui.clearError();
  return { errors, warnings, total:diagnostics.length };
}

function renderPythonTrace(panel, parsed, source, ui){
  panel.innerHTML = "";
  const report = normalizePythonTraceReport(parsed && parsed.report);
  const steps = report.steps;
  const lines = String(source || "").split("\n");
  const head = document.createElement("div"); head.className = "out-head";
  head.textContent = "단계 실행 · " + steps.length + "단계";
  panel.appendChild(head);
  if (parsed && parsed.output){
    const output = document.createElement("details"); output.className = "py-trace-output";
    const summary = document.createElement("summary"); summary.textContent = "프로그램 출력";
    const pre = document.createElement("pre"); pre.textContent = parsed.output;
    output.append(summary, pre); panel.appendChild(output);
  }
  if (!steps.length){
    const empty = document.createElement("div"); empty.className = "py-trace-empty";
    empty.textContent = report.error || "기록된 실행 단계가 없습니다.";
    panel.appendChild(empty);
    if (ui && ui.clearTraceLine) ui.clearTraceLine();
    return { steps:0, error:report.error };
  }
  const controls = document.createElement("div"); controls.className = "py-trace-controls";
  const prev = document.createElement("button"); prev.type = "button"; prev.textContent = "← 이전";
  const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = String(steps.length - 1); slider.value = "0";
  const next = document.createElement("button"); next.type = "button"; next.textContent = "다음 →";
  const count = document.createElement("strong");
  controls.append(prev, slider, next, count); panel.appendChild(controls);
  const card = document.createElement("section"); card.className = "py-trace-card"; panel.appendChild(card);
  const renderTable = (title, rows, columns, cls) => {
    const block = document.createElement("div"); block.className = cls;
    const h = document.createElement("h4"); h.textContent = title; block.appendChild(h);
    if (!rows.length){ const empty = document.createElement("div"); empty.className = "py-trace-none"; empty.textContent = "변화 없음"; block.appendChild(empty); return block; }
    const table = document.createElement("table");
    const thead = document.createElement("thead"), hr = document.createElement("tr");
    columns.forEach(column => { const th = document.createElement("th"); th.textContent = column.label; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      columns.forEach(column => { const td = document.createElement("td"); const code = document.createElement("code"); code.textContent = column.value(row); td.appendChild(code); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); block.appendChild(table); return block;
  };
  const show = (index) => {
    index = Math.max(0, Math.min(steps.length - 1, parseInt(index, 10) || 0));
    slider.value = String(index); prev.disabled = index === 0; next.disabled = index === steps.length - 1;
    const step = steps[index];
    count.textContent = (index + 1) + " / " + steps.length;
    card.innerHTML = "";
    const meta = document.createElement("div"); meta.className = "py-trace-meta";
    const line = document.createElement("strong"); line.textContent = step.line + "줄";
    const fn = document.createElement("code"); fn.textContent = step.functionName + (step.phase === "return" ? " · 함수 종료" : "") + (step.depth ? " · 호출 깊이 " + step.depth : "");
    meta.append(line, fn);
    const codeLine = document.createElement("pre"); codeLine.className = "py-trace-source"; codeLine.textContent = lines[step.line - 1] || "";
    card.append(meta, codeLine);
    card.appendChild(renderTable("이 단계에서 관찰된 변수 변화", step.changes, [
      { label:"이름", value:row => row.name },
      { label:"이전", value:row => row.before || "(없음)" },
      { label:"현재", value:row => row.after || "(없음)" }
    ], "py-trace-changes"));
    card.appendChild(renderTable("현재 지역 변수", step.variables, [
      { label:"이름", value:row => row.name },
      { label:"자료형", value:row => row.type },
      { label:"값", value:row => row.value }
    ], "py-trace-vars"));
    if (ui && ui.showTraceLine) ui.showTraceLine(step.line);
  };
  prev.addEventListener("click", () => show(Number(slider.value) - 1));
  next.addEventListener("click", () => show(Number(slider.value) + 1));
  slider.addEventListener("input", () => show(slider.value));
  controls.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft"){ event.preventDefault(); show(Number(slider.value) - 1); }
    else if (event.key === "ArrowRight"){ event.preventDefault(); show(Number(slider.value) + 1); }
  });
  if (report.truncated){
    const note = document.createElement("div"); note.className = "py-trace-note";
    note.textContent = "기록이 300단계를 넘어 이후 단계는 생략했습니다. 반복 횟수를 줄여 다시 실행하면 전체 흐름을 보기 쉬워요.";
    panel.appendChild(note);
  }
  if (report.error){
    const error = document.createElement("pre"); error.className = "py-trace-error"; error.textContent = report.error; panel.appendChild(error);
  }
  show(0);
  return { steps:steps.length, error:report.error };
}

async function refreshPythonEnvPanel(panel, btn){
  if (!panel) return;
  panel.innerHTML = '<div class="py-env-head"><span>Python 실행 환경</span><span class="py-env-muted">확인 중...</span></div>';
  const info = await pythonEnvironmentDetails();
  if (btn){
    btn.classList.toggle("is-ok", !!info.backend);
    btn.classList.toggle("is-warn", !info.backend);
  }
  const statusCls = info.backend ? "py-env-ok" : "py-env-warn";
  const rows = [
    ["실행 방식", info.mode, statusCls],
    ["Python", info.python || "-", ""],
    ["명령", info.command || "-", ""],
    ["pip", info.pip || "-", info.pip === "사용 가능" || info.pip === "자동 패키지 로드" ? "py-env-ok" : "py-env-warn"],
    ["자동완성", info.jedi || "-", info.jedi === "사용 가능" ? "py-env-ok" : ""]
  ];
  if (info.saveRoot) rows.push(["저장 위치", info.saveRoot, ""]);
  const dl = document.createElement("dl"); dl.className = "py-env-grid";
  rows.forEach(([k, v, cls]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v; dd.title = v;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  });
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "py-env-head";
  const title = document.createElement("span"); title.textContent = "Python 실행 환경";
  const state = document.createElement("span"); state.className = statusCls; state.textContent = info.backend ? "로컬 실행" : "브라우저 실행";
  head.append(title, state);
  panel.append(head, dl);
}

