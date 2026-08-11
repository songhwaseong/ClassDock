(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PdfSignerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INTERNAL_DRAG_MIME = "application/x-manneung-internal-drag";

  function normalizeWorkspacePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  const WORKSPACE_FOLDER_MARKER = ".manneung-folder-keep-9f4d2a7b";
  const WORKSPACE_IMAGE_SKIP_MARKER = ".manneung-images-skipped-4e72c1b9";
  const WORKSPACE_ORIGINAL_SAVE_MARKER = ".manneung-original-save-6c87f41e";
  function workspaceFolderMarkerPath(value) {
    const path = normalizeWorkspacePath(value).replace(/\/+$/, "");
    return path ? path + "/" + WORKSPACE_FOLDER_MARKER : "";
  }
  function workspaceFolderPathFromMarker(value) {
    const path = normalizeWorkspacePath(value).replace(/\/+$/, "");
    const suffix = "/" + WORKSPACE_FOLDER_MARKER;
    return path.endsWith(suffix) ? path.slice(0, -suffix.length) : "";
  }
  function workspaceImageSkipMarkerPath(value) {
    const path = normalizeWorkspacePath(value).replace(/\/+$/, "");
    return path ? path + "/" + WORKSPACE_IMAGE_SKIP_MARKER : "";
  }
  function workspaceImageSkipFolderPath(value) {
    const path = normalizeWorkspacePath(value).replace(/\/+$/, "");
    const suffix = "/" + WORKSPACE_IMAGE_SKIP_MARKER;
    return path.endsWith(suffix) ? path.slice(0, -suffix.length) : "";
  }
  function workspaceOriginalSaveMarkerPath(value) {
    const path = normalizeWorkspacePath(value).replace(/\/+$/, "");
    return path ? path + "/" + WORKSPACE_ORIGINAL_SAVE_MARKER : "";
  }
  function workspaceOriginalSaveFolderPath(value) {
    const path = normalizeWorkspacePath(value).replace(/\/+$/, "");
    const suffix = "/" + WORKSPACE_ORIGINAL_SAVE_MARKER;
    return path.endsWith(suffix) ? path.slice(0, -suffix.length) : "";
  }

  // 텍스트 파일의 바이트 패턴으로 저장 인코딩을 판별한다.
  // ASCII만 있는 파일은 원래 코드페이지를 확정할 수 없으므로 "ASCII 호환"으로 표시한다.
  function detectTextEncoding(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const result = (encoding, label, shortLabel, extra={}) => ({
      encoding, label, shortLabel: shortLabel || label, bom: !!extra.bom,
      empty: !!extra.empty, uncertain: !!extra.uncertain, lossy: !!extra.lossy
    });
    if (!bytes.length) return result("utf-8", "빈 파일 (저장 시 UTF-8)", "빈 파일", { empty:true, uncertain:true });
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
      return result("utf-8", "UTF-8 (BOM 있음)", "UTF-8 BOM", { bom:true });
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
      return result("utf-16le", "UTF-16 LE (BOM 있음)", "UTF-16 LE", { bom:true });
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
      return result("utf-16be", "UTF-16 BE (BOM 있음)", "UTF-16 BE", { bom:true });

    // BOM 없는 UTF-16은 ASCII 영역 문자의 0x00 교차 패턴으로 보수적으로 추정한다.
    const pairs = Math.min(Math.floor(bytes.length / 2), 4096);
    if (pairs >= 4) {
      let evenZero = 0, oddZero = 0;
      for (let i = 0; i < pairs * 2; i += 2) {
        if (bytes[i] === 0) evenZero++;
        if (bytes[i + 1] === 0) oddZero++;
      }
      if (oddZero / pairs >= 0.6 && evenZero / pairs <= 0.1)
        return result("utf-16le", "UTF-16 LE (BOM 없음, 추정)", "UTF-16 LE", { uncertain:true });
      if (evenZero / pairs >= 0.6 && oddZero / pairs <= 0.1)
        return result("utf-16be", "UTF-16 BE (BOM 없음, 추정)", "UTF-16 BE", { uncertain:true });
    }

    let ascii = true;
    for (const byte of bytes) {
      if (byte === 0 || byte >= 0x80) { ascii = false; break; }
    }
    if (ascii) return result("utf-8", "ASCII 호환 (UTF-8/CP949 구분 불가)", "ASCII", { uncertain:true });

    try {
      new TextDecoder("utf-8", { fatal:true }).decode(bytes);
      return result("utf-8", "UTF-8", "UTF-8");
    } catch(_){}
    try {
      new TextDecoder("euc-kr", { fatal:true }).decode(bytes);
      return result("euc-kr", "CP949 / EUC-KR", "CP949");
    } catch(_){}

    // 오래된 ANSI 텍스트에는 파일 일부에만 잘못된 바이트가 섞인 경우가 있다.
    // strict 디코딩 하나만 실패해도 UTF-8로 되돌리면 정상 CP949 한글까지 전부 깨지므로,
    // 앞·중간·끝 표본을 관대한 모드로 디코딩해 대체 문자(�)가 적은 쪽을 고른다.
    const chunkSize = 64 * 1024;
    const starts = bytes.length <= chunkSize
      ? [0]
      : [0, Math.max(0, Math.floor((bytes.length - chunkSize) / 2)), Math.max(0, bytes.length - chunkSize)];
    const replacementScore = (encoding) => {
      let score = 0;
      const decoder = new TextDecoder(encoding);
      for (const start of [...new Set(starts)]) {
        const text = decoder.decode(bytes.subarray(start, Math.min(bytes.length, start + chunkSize)));
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xFFFD) score++;
      }
      return score;
    };
    try {
      const utf8Score = replacementScore("utf-8");
      const cp949Score = replacementScore("euc-kr");
      if (utf8Score < cp949Score)
        return result("utf-8", "UTF-8 (일부 오류 바이트 허용)", "UTF-8", { uncertain:true, lossy:true });
      return result("euc-kr", "CP949 / EUC-KR (일부 오류 바이트 허용)", "CP949", { uncertain:true, lossy:true });
    } catch(_){}
    return result(null, "알 수 없는 인코딩", "알 수 없음", { uncertain:true });
  }

  function resolveRuntimeOutputPath(ownerPath, outputPath, logicalRoot="", bundled=false) {
    const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
    const dirname = (value) => { const path = normalize(value), index = path.lastIndexOf("/"); return index >= 0 ? path.slice(0, index) : ""; };
    const startsWithPath = (path, root) => !root || path === root || path.indexOf(root + "/") === 0;
    let path = normalize(outputPath);
    const root = normalize(logicalRoot);
    const prefix = bundled ? root : dirname(ownerPath);
    if (prefix && !startsWithPath(path, prefix)) path = prefix + "/" + path;
    return path;
  }

  // Python 소스에 적힌 Windows 절대경로 리터럴을 비교 가능한 형태로 추린다.
  // 일반 문자열의 이스케이프 백슬래시("D:\\folder")와 raw 문자열(r"D:\folder"),
  // UNC 경로를 모두 같은 슬래시 형태로 정규화한다.
  function windowsAbsolutePathLiterals(source) {
    const matches = String(source || "").match(/(?:[A-Za-z]:[\\/]+|\\{2,})[^'"\r\n]*/g) || [];
    const seen = new Set(), paths = [];
    for (const value of matches) {
      const path = value.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
    return paths;
  }

  // File System Access 디렉터리 핸들은 실제 절대경로를 노출하지 않는다. 따라서 소스 경로에
  // 열린 루트 폴더명이 독립된 경로 세그먼트로 있으면 그 루트를 건드린 것으로 보수적으로 본다.
  function windowsAbsolutePathTouchesFolder(path, folderName) {
    const wanted = String(folderName || "").replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!wanted || wanted.includes("/")) return false;
    const parts = String(path || "").replace(/[\\/]+/g, "/").split("/").filter(Boolean);
    return parts.some((part) => part.toLowerCase() === wanted);
  }

  function evaluatePythonStringConcat(expression, variables) {
    const text = String(expression || "");
    let pos = 0, value = "", terms = 0;
    const skipSpace = () => { while (pos < text.length && /\s/.test(text[pos])) pos++; };
    for (;;) {
      skipSpace();
      if (pos >= text.length || text[pos] === "#") break;
      let term = null;
      const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(pos));
      if (ident && variables.has(ident[0])) {
        term = variables.get(ident[0]);
        pos += ident[0].length;
      } else {
        const start = pos;
        let prefix = "";
        while (pos < text.length && /[rRuUbBfF]/.test(text[pos]) && prefix.length < 2) prefix += text[pos++];
        const quote = text[pos];
        if (quote !== "'" && quote !== '"') { pos = start; return null; }
        if (/f/i.test(prefix)) return null;
        pos++;
        let out = "", closed = false;
        while (pos < text.length) {
          const ch = text[pos++];
          if (ch === quote) { closed = true; break; }
          if (ch === "\\" && !/r/i.test(prefix) && pos < text.length) {
            const next = text[pos++];
            out += ({ n:"\n", r:"\r", t:"\t", "\\":"\\", "'":"'", '"':'"' })[next] ?? ("\\" + next);
          } else out += ch;
        }
        if (!closed) return null;
        term = out;
      }
      value += term;
      terms++;
      if (value.length > 4096) return null;
      skipSpace();
      if (pos >= text.length || text[pos] === "#") break;
      if (text[pos] !== "+") return null;
      pos++;
    }
    return terms ? value : null;
  }

  function splitPythonAssignmentValues(expression) {
    const values = [];
    const text = String(expression || "");
    let start = 0, quote = "", escaped = false, depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth = Math.max(0, depth - 1); continue; }
      if (ch === "," && depth === 0) {
        values.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    values.push(text.slice(start).trim());
    return values;
  }

  function pythonConstantStringPaths(source) {
    const variables = new Map(), values = [];
    for (const line of String(source || "").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*=\s*(.+)$/.exec(line);
      if (match) {
        const names = match[1].split(",").map(name => name.trim());
        const expressions = names.length > 1 ? splitPythonAssignmentValues(match[2]) : [match[2]];
        if (expressions.length !== names.length) {
          names.forEach(name => variables.delete(name));
        } else {
          names.forEach((name, index) => {
            const value = evaluatePythonStringConcat(expressions[index], variables);
            if (value === null) variables.delete(name);
            else {
              variables.set(name, value);
              values.push(value);
            }
          });
        }
      }
      // open(filename=dataIn + "sample.txt")처럼 대입문 밖의 함수 인수에
      // 직접 쓴 상수 경로 결합도 실행 묶음에 포함한다. 실제 Python 실행은
      // 하지 않고, 앞에서 확인한 문자열 변수와 바로 뒤의 문자열만 추적한다.
      const concat = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([rRuUbB]{0,2})(["'])([^"'\r\n]*)\3/g;
      let concatMatch;
      while ((concatMatch = concat.exec(line))) {
        const base = variables.get(concatMatch[1]);
        if (base === undefined || /f/i.test(concatMatch[2])) continue;
        values.push(base + concatMatch[4]);
      }
    }
    return values;
  }

  function pythonRelativePathLiterals(source) {
    const refs = [];
    const seen = new Set();
    const add = (value) => {
      const ref = String(value || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/");
      if (!ref || ref.includes("{") || ref.includes("}") || /^(?:[A-Za-z]:|\/|https?:|data:|blob:)/i.test(ref)) return;
      const looksLikeFile = ref.includes("/") || /(?:^|\/)[^/]+\.[A-Za-z0-9_]{1,12}$/.test(ref);
      if (!looksLikeFile || seen.has(ref)) return;
      seen.add(ref);
      refs.push(ref);
    };
    pythonConstantStringPaths(source).forEach(add);
    const pattern = /(?:^|[^A-Za-z0-9_])(?:[rRuUbBfF]{0,2})(["'])([^"'\r\n]+)\1/g;
    let match;
    while ((match = pattern.exec(String(source || "")))) add(match[2]);
    return refs.filter(ref => !(ref.endsWith("/") && refs.some(other => other !== ref && other.startsWith(ref))));
  }

  function resolveProjectRelativePath(base, ref) {
    const parts = [];
    const joined = (base ? base + "/" : "") + String(ref || "").replace(/\\/g, "/");
    for (const raw of joined.split("/")) {
      const part = raw.trim();
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else parts.push(part);
    }
    return parts.join("/");
  }

  function safeArchivePath(value) {
    const raw = String(value == null ? "" : value).replace(/\\/g, "/").replace(/^\/+/, "");
    const parts = [];
    for (const segment of raw.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === ".." || segment.indexOf("\0") >= 0) return null;
      parts.push(segment);
    }
    return parts.length ? parts.join("/") : null;
  }

  function inferPythonProjectRunContext(targetPath, source, availablePaths, options={}) {
    const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
    const target = normalize(targetPath);
    const targetDir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
    const paths = [...new Set((availablePaths || []).map(normalize).filter(Boolean))];
    const pathSet = new Set(paths);
    const directories = new Set((options.availableDirs || []).map(normalize).filter(Boolean));
    for (const path of paths) {
      let dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      while (dir) {
        directories.add(dir);
        const index = dir.lastIndexOf("/");
        dir = index >= 0 ? dir.slice(0, index) : "";
      }
    }
    const refs = pythonRelativePathLiterals(source);
    const preferredCwd = normalize(options.preferredCwd);
    const preferred = !!(preferredCwd && (target === preferredCwd || target.indexOf(preferredCwd + "/") === 0));
    const cwd = preferred ? preferredCwd : targetDir;
    const matches = [], outputDirs = [];
    for (const ref of refs) {
      const resolved = resolveProjectRelativePath(cwd, ref);
      if (!resolved) continue;
      if (pathSet.has(resolved) || paths.some(path => path.startsWith(resolved + "/"))) {
        matches.push({ ref, path:resolved });
        continue;
      }
      const parent = resolved.includes("/") ? resolved.slice(0, resolved.lastIndexOf("/")) : "";
      if (parent && parent !== cwd && directories.has(parent)) outputDirs.push({ ref, path:resolved, directory:parent });
    }
    return { cwd, references:matches, outputDirectories:outputDirs, target, ...(preferred ? { preferred:true } : {}) };
  }

  function pythonImportedTopNames(source) {
    const names = new Set();
    const text = String(source || "");
    let match;
    const importRe = /^\s*import\s+([^\n#]+)/gm;
    while ((match = importRe.exec(text))) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/i)[0].split(".")[0];
        if (name) names.add(name);
      }
    }
    const fromRe = /^\s*from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+/gm;
    while ((match = fromRe.exec(text))) names.add(match[1].split(".")[0]);
    return [...names];
  }

  function inferPythonLocalImportRoots(targetPath, source, availablePaths, options={}) {
    const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
    const dirname = (path) => { const p = normalize(path), i = p.lastIndexOf("/"); return i >= 0 ? p.slice(0, i) : ""; };
    const startsWithPath = (path, root) => {
      const p = normalize(path), r = normalize(root);
      return !r || p === r || p.indexOf(r + "/") === 0;
    };
    const target = normalize(targetPath);
    const paths = [...new Set((availablePaths || []).map(normalize).filter(Boolean))];
    const pathSet = new Set(paths);
    const directories = new Set((options.availableDirs || []).map(normalize).filter(Boolean));
    for (const path of paths) {
      let dir = dirname(path);
      while (dir) {
        directories.add(dir);
        dir = dirname(dir);
      }
    }
    const cwd = normalize(options.cwd) ||
      inferPythonProjectRunContext(target, source, paths, { availableDirs:[...directories] }).cwd ||
      dirname(target);
    const bases = [];
    for (let dir = cwd; ; dir = dirname(dir)) {
      if (!bases.includes(dir)) bases.push(dir);
      if (!dir) break;
    }
    const roots = [];
    const add = (value) => {
      const path = normalize(value);
      if (path && !roots.includes(path)) roots.push(path);
    };
    for (const name of pythonImportedTopNames(source)) {
      for (const base of bases) {
        const prefix = base ? base + "/" : "";
        const modulePath = prefix + name + ".py";
        const packageDir = prefix + name;
        let found = false;
        if (pathSet.has(modulePath)) {
          add(modulePath);
          found = true;
        }
        if (directories.has(packageDir) || paths.some(path => startsWithPath(path, packageDir))) {
          add(packageDir);
          found = true;
        }
        if (found) break;
      }
    }
    return roots;
  }

  function pythonRunScopeIncludesPath(value, targetValue, referencedValues=[], packageDirs=[]) {
    const normalize = (path) => String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
    const dirname = (path) => { const p = normalize(path), i = p.lastIndexOf("/"); return i >= 0 ? p.slice(0, i) : ""; };
    const startsWithPath = (path, root) => {
      const p = normalize(path), r = normalize(root);
      return !r || p === r || p.indexOf(r + "/") === 0;
    };
    const path = normalize(value), target = normalize(targetValue), targetDir = dirname(target);
    if (!path) return false;
    if (path === target || dirname(path) === targetDir) return true;
    if (targetDir && startsWithPath(path, targetDir)) return true;
    // .env 계열은 dotenv 가 실행 파일 기준 상위 폴더로 올라가며 찾으므로, 상위 폴더의 것도 포함한다
    if (/^\.env(\.[^/]+)?$/i.test(path.split("/").pop() || "") && startsWithPath(targetDir, dirname(path))) return true;
    for (const ref of referencedValues || []) if (path === normalize(ref) || startsWithPath(path, ref)) return true;
    for (const dir of packageDirs || []) if (startsWithPath(path, dir)) return true;
    return false;
  }

  function indexCsvRows(value) {
    const text = String(value || "");
    if (!text.length) return [];
    const starts = [0];
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '"') {
        if (quoted && text[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && text[i] === "\n") starts.push(i + 1);
    }
    if (starts[starts.length - 1] === text.length) starts.pop();
    return starts;
  }

  function detectCsvDelimiter(record) {
    const candidates = [",", "\t", ";", "|"];
    const counts = new Map(candidates.map((delimiter) => [delimiter, 0]));
    let quoted = false;
    for (let i = 0; i < record.length; i++) {
      if (record[i] === '"') {
        if (quoted && record[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && counts.has(record[i])) counts.set(record[i], counts.get(record[i]) + 1);
    }
    return candidates.reduce((best, delimiter) => counts.get(delimiter) > counts.get(best) ? delimiter : best, ",");
  }

  function parseCsvRecord(value, delimiter) {
    const record = String(value || "").replace(/\r?\n$/, "");
    const fields = [];
    let field = "", quoted = false;
    for (let i = 0; i < record.length; i++) {
      const ch = record[i];
      if (ch === '"') {
        if (quoted && record[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && ch === delimiter) {
        fields.push(field); field = "";
      } else field += ch;
    }
    fields.push(field);
    return fields;
  }

  function fingerprintBytes(name, input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    let hash = 2166136261;
    const feed = (value) => { hash ^= value; hash = Math.imul(hash, 16777619) >>> 0; };
    const label = new TextEncoder().encode(String(name || "").toLowerCase());
    for (const value of label) feed(value);
    for (let shift = 0; shift < 32; shift += 8) feed((bytes.length >>> shift) & 255);
    const sample = Math.min(32768, bytes.length);
    for (let i = 0; i < sample; i++) feed(bytes[i]);
    for (let i = Math.max(sample, bytes.length - sample); i < bytes.length; i++) feed(bytes[i]);
    return bytes.length.toString(36) + "-" + hash.toString(16).padStart(8, "0");
  }

  function encodeWorkspace(entries, maxBytes) {
    const enc = new TextEncoder();
    const rows = [];
    let total = 4;
    for (const entry of entries || []) {
      const path = normalizeWorkspacePath(entry.path);
      if (!path) continue;
      const pathBytes = enc.encode(path);
      const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes || 0);
      total += 8 + pathBytes.length + data.length;
      if (maxBytes && total > maxBytes) throw new Error("workspace-too-large");
      rows.push({ pathBytes, data });
    }
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let pos = 0;
    view.setUint32(pos, rows.length, true); pos += 4;
    for (const row of rows) {
      view.setUint32(pos, row.pathBytes.length, true); pos += 4;
      out.set(row.pathBytes, pos); pos += row.pathBytes.length;
      view.setUint32(pos, row.data.length, true); pos += 4;
      out.set(row.data, pos); pos += row.data.length;
    }
    return out;
  }

  function decodeWorkspace(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
    if (!bytes.length) return [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder("utf-8");
    let pos = 0;
    const u32 = () => {
      if (pos + 4 > bytes.length) throw new Error("bad-workspace");
      const value = view.getUint32(pos, true); pos += 4;
      return value;
    };
    const count = u32();
    if (count > 10000) throw new Error("bad-workspace");
    const rows = [];
    for (let i = 0; i < count; i++) {
      const pathLength = u32();
      if (pos + pathLength > bytes.length) throw new Error("bad-workspace");
      const path = dec.decode(bytes.subarray(pos, pos + pathLength)); pos += pathLength;
      const dataLength = u32();
      if (pos + dataLength > bytes.length) throw new Error("bad-workspace");
      rows.push({ path, bytes: bytes.slice(pos, pos + dataLength) });
      pos += dataLength;
    }
    if (pos !== bytes.length) throw new Error("bad-workspace");
    return rows;
  }

  // 폴더별로 포함된 작업공간 경로를 한 번에 색인한다.
  // 하위 폴더를 만들 때마다 전체 파일 경로를 다시 훑는 O(폴더×파일) 작업을 피한다.
  function indexWorkspacePathsByFolder(paths) {
    const index = new Map();
    for (const value of paths || []) {
      const path = normalizeWorkspacePath(value);
      if (!path) continue;
      const parts = path.split("/");
      let key = parts[0] || "";
      for (let i = 1; i < parts.length - 1; i++) {
        key += "/" + parts[i];
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(path);
      }
    }
    return index;
  }

  function formatZipOpenSummary(values) {
    const row = values || {};
    const opened = Math.max(0, Number(row.opened) || 0);
    const extra = [];
    const unsupported = Math.max(0, Number(row.unsupported) || 0);
    const oversized = Math.max(0, Number(row.oversized) || 0);
    const failed = Math.max(0, Number(row.failed) || 0);
    const tf = typeof window !== "undefined" && typeof window.tf === "function"
      ? window.tf
      : (template, vars) => String(template).replace(/\{(\w+)\}/g, (_, key) => vars && vars[key] != null ? String(vars[key]) : _);
    if (unsupported) extra.push(tf("{n}개 형식 미지원", { n: unsupported }));
    if (oversized) extra.push(tf("{n}개 용량 제한 제외", { n: oversized }));
    if (failed) extra.push(tf("{n}개 열기 실패", { n: failed }));
    return tf("{n}개 열기", { n: opened }) + (extra.length ? " · " + extra.join(" · ") : "");
  }

  function isExternalRef(ref) {
    return !ref || /^(https?:|data:|blob:|mailto:|tel:|javascript:|about:|#|\/\/)/i.test(String(ref).trim());
  }

  function resolveSiblingPath(baseRel, ref) {
    try {
      return decodeURIComponent(new URL(String(ref).split("#")[0], "http://_/" + baseRel).pathname).replace(/^\/+/, "");
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function safeLink(url) {
    const trimmed = String(url || "").trim();
    return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : "";
  }

  const PYTHON_COMPLETION_WORDS = (
    "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield " +
    "abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __import__"
  ).split(/\s+/);

  // 비(非)파이썬 파일도 편집기에서 버퍼 단어 자동완성을 쓴다. 언어별 키워드를 함께 제안해
  // 파이썬 키워드가 JS·SQL 등에 섞여 드는 문제를 없앤다. 구문강조 프로파일(CODE_EXTS)을 그대로 쓴다.
  const JS_COMPLETION_WORDS = (
    "as async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof var void while with yield " +
    "console document window Array Object String Number Boolean Math JSON Promise require module exports"
  ).split(/\s+/);
  const TS_COMPLETION_WORDS = JS_COMPLETION_WORDS.concat("abstract any as assert asserts bigint declare enum implements infer interface is keyof namespace never private protected public readonly satisfies type undefined unknown".split(/\s+/));
  const C_COMPLETION_WORDS = "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local".split(/\s+/);
  const CPP_COMPLETION_WORDS = C_COMPLETION_WORDS.concat("alignas alignof and and_eq asm bitand bitor bool catch class compl concept constexpr const_cast continue co_await co_return co_yield decltype delete dynamic_cast explicit export false friend mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public reflexpr reinterpret_cast requires static_assert static_cast template this thread_local throw true try typeid typename using virtual wchar_t xor xor_eq".split(/\s+/));
  const JAVA_COMPLETION_WORDS = "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null".split(/\s+/);
  const CSHARP_COMPLETION_WORDS = "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await dynamic get set value var yield".split(/\s+/);
  const GO_COMPLETION_WORDS = "break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var true false iota nil".split(/\s+/);
  const RUST_COMPLETION_WORDS = "as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield".split(/\s+/);
  const SHELL_COMPLETION_WORDS = "case do done elif else esac fi for function if in select then time until while coproc break continue return export readonly local declare typeset unset shift source alias unalias true false test".split(/\s+/);
  const POWERSHELL_COMPLETION_WORDS = "begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return switch throw trap try until using var while workflow and as band bnot bor bxor case contains ccontains ceq cge cgt cle clike clt cmatch cne cnotcontains cnotlike cnotmatch cor creplace csharp csplit eq ge gt ilike imatch in is isnot le like lt match not notcontains notin notlike notmatch or replace shl shr split".split(/\s+/);
  const RUBY_COMPLETION_WORDS = "BEGIN END alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield".split(/\s+/);
  const SQL_COMPLETION_WORDS = (
    "SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE ALTER DROP TABLE VIEW INDEX JOIN INNER LEFT RIGHT OUTER FULL ON GROUP ORDER BY ASC DESC HAVING UNION ALL VALUES SET PRIMARY KEY FOREIGN REFERENCES NOT NULL DEFAULT DISTINCT AS AND OR LIKE BETWEEN IN EXISTS CASE WHEN THEN ELSE END COUNT SUM AVG MIN MAX LIMIT OFFSET BEGIN COMMIT ROLLBACK"
  ).split(/\s+/);
  const CSS_COMPLETION_WORDS = (
    "color background background-color border margin padding width height display position top left right bottom flex grid gap font font-size font-weight line-height text-align justify-content align-items float overflow opacity transform transition animation z-index box-shadow border-radius cursor content visibility inherit initial none auto absolute relative fixed sticky block inline flex grid"
  ).split(/\s+/);
  // 확장자별 완성 키워드. 구문강조 프로파일은 여러 언어를 함께 쓰므로, 편집기에서는 확장자를
  // 우선해 JS 키워드가 JSON에, Python 키워드가 YAML·PowerShell에 섞이지 않게 한다.
  // ext를 생략한 기존 호출은 프로파일 기본값을 유지한다.
  function completionWordsForProfile(profile, ext="") {
    const extension = String(ext || "").toLowerCase().replace(/^\./, "");
    if (extension){
      if (["js", "mjs", "cjs", "jsx", "vue", "svelte"].includes(extension)) return JS_COMPLETION_WORDS;
      if (["ts", "tsx"].includes(extension)) return TS_COMPLETION_WORDS;
      if (["c", "h"].includes(extension)) return C_COMPLETION_WORDS;
      if (["cpp", "cc", "hpp", "cxx"].includes(extension)) return CPP_COMPLETION_WORDS;
      if (extension === "java") return JAVA_COMPLETION_WORDS;
      if (extension === "cs") return CSHARP_COMPLETION_WORDS;
      if (extension === "go") return GO_COMPLETION_WORDS;
      if (extension === "rs") return RUST_COMPLETION_WORDS;
      if (["py", "pyi"].includes(extension)) return PYTHON_COMPLETION_WORDS;
      if (["sh", "bash", "zsh"].includes(extension)) return SHELL_COMPLETION_WORDS;
      if (extension === "ps1") return POWERSHELL_COMPLETION_WORDS;
      if (extension === "rb") return RUBY_COMPLETION_WORDS;
      // JSON/YAML/XML·설정 파일은 언어 키워드 대신 현재 버퍼의 단어만 제안한다.
      if (["json", "json5", "jsonc", "yaml", "yml", "xml", "xsl", "xslt", "xsd", "rss", "atom", "plist", "wsdl", "dbk", "docbook", "toml", "ini", "env", "properties", "conf"].includes(extension)) return [];
    }
    switch (String(profile || "")) {
      case "c": return JS_COMPLETION_WORDS;
      case "sql": return SQL_COMPLETION_WORDS;
      case "css": return CSS_COMPLETION_WORDS;
      case "python": return PYTHON_COMPLETION_WORDS;
      case "hash": return PYTHON_COMPLETION_WORDS;
      default: return [];                             // xml/text 등: 버퍼 단어만
    }
  }

  // Jedi cannot always infer the concrete type returned by inherited class loaders
  // such as Word2Vec.load(). Add an analysis-only annotation to earlier assignment
  // lines while keeping the user's source and the active cursor line unchanged.
  function pythonCompletionInferenceSource(source, cursorLine=1) {
    const lines = String(source == null ? "" : source).split("\n");
    const stop = Math.max(0, Math.min(lines.length, (parseInt(cursorLine, 10) || 1) - 1));
    const classLoadAssignment = /^(\s*)([A-Za-z_]\w*)(\s*)=(\s*)((?:[A-Za-z_]\w*\.)*[A-Z][A-Za-z0-9_]*)(\.load\s*\()/;
    for (let i = 0; i < stop; i++) {
      lines[i] = lines[i].replace(classLoadAssignment, "$1$2: $5$3=$4$5$6");
    }
    return lines.join("\n");
  }

  // 아직 코드에 import하지 않은 이름도 초보자가 바로 쓸 수 있게, 자주 쓰는
  // 표준/수업 라이브러리의 import 경로를 함께 제안한다. 외부 라이브러리는
  // 실행 시 기존 설치 안내가 그대로 동작한다.
  const PYTHON_IMPORT_COMPLETIONS = [
    ["Path", "class", "from pathlib import Path"],
    ["PurePath", "class", "from pathlib import PurePath"],
    ["datetime", "class", "from datetime import datetime"],
    ["date", "class", "from datetime import date"],
    ["time", "class", "from datetime import time"],
    ["timedelta", "class", "from datetime import timedelta"],
    ["timezone", "class", "from datetime import timezone"],
    ["Counter", "class", "from collections import Counter"],
    ["defaultdict", "class", "from collections import defaultdict"],
    ["deque", "class", "from collections import deque"],
    ["namedtuple", "function", "from collections import namedtuple"],
    ["itertools", "module", "import itertools"],
    ["functools", "module", "import functools"],
    ["Any", "class", "from typing import Any"],
    ["Optional", "class", "from typing import Optional"],
    ["List", "class", "from typing import List"],
    ["Dict", "class", "from typing import Dict"],
    ["Tuple", "class", "from typing import Tuple"],
    ["Set", "class", "from typing import Set"],
    ["Iterable", "class", "from typing import Iterable"],
    ["Iterator", "class", "from typing import Iterator"],
    ["Callable", "class", "from typing import Callable"],
    ["Literal", "class", "from typing import Literal"],
    ["json", "module", "import json"],
    ["csv", "module", "import csv"],
    ["re", "module", "import re"],
    ["os", "module", "import os"],
    ["sys", "module", "import sys"],
    ["math", "module", "import math"],
    ["random", "module", "import random"],
    ["statistics", "module", "import statistics"],
    ["sqlite3", "module", "import sqlite3"],
    ["requests", "module", "import requests"],
    ["pd", "module", "import pandas as pd"],
    ["np", "module", "import numpy as np"],
    ["plt", "module", "import matplotlib.pyplot as plt"],
    ["DataFrame", "class", "from pandas import DataFrame"],
    ["Series", "class", "from pandas import Series"],
    ["sns", "module", "import seaborn as sns"],
    ["Image", "class", "from PIL import Image"],
    ["cv2", "module", "import cv2"],
    ["BeautifulSoup", "class", "from bs4 import BeautifulSoup"]
    , ["scipy", "module", "import scipy"]
    , ["stats", "module", "from scipy import stats"]
    , ["train_test_split", "function", "from sklearn.model_selection import train_test_split"]
    , ["KFold", "class", "from sklearn.model_selection import KFold"]
    , ["StratifiedKFold", "class", "from sklearn.model_selection import StratifiedKFold"]
    , ["cross_val_score", "function", "from sklearn.model_selection import cross_val_score"]
    , ["GridSearchCV", "class", "from sklearn.model_selection import GridSearchCV"]
    , ["RandomizedSearchCV", "class", "from sklearn.model_selection import RandomizedSearchCV"]
    , ["StandardScaler", "class", "from sklearn.preprocessing import StandardScaler"]
    , ["MinMaxScaler", "class", "from sklearn.preprocessing import MinMaxScaler"]
    , ["RobustScaler", "class", "from sklearn.preprocessing import RobustScaler"]
    , ["LabelEncoder", "class", "from sklearn.preprocessing import LabelEncoder"]
    , ["OneHotEncoder", "class", "from sklearn.preprocessing import OneHotEncoder"]
    , ["PolynomialFeatures", "class", "from sklearn.preprocessing import PolynomialFeatures"]
    , ["SimpleImputer", "class", "from sklearn.impute import SimpleImputer"]
    , ["Pipeline", "class", "from sklearn.pipeline import Pipeline"]
    , ["ColumnTransformer", "class", "from sklearn.compose import ColumnTransformer"]
    , ["LinearRegression", "class", "from sklearn.linear_model import LinearRegression"]
    , ["LogisticRegression", "class", "from sklearn.linear_model import LogisticRegression"]
    , ["Ridge", "class", "from sklearn.linear_model import Ridge"]
    , ["Lasso", "class", "from sklearn.linear_model import Lasso"]
    , ["KNeighborsClassifier", "class", "from sklearn.neighbors import KNeighborsClassifier"]
    , ["KNeighborsRegressor", "class", "from sklearn.neighbors import KNeighborsRegressor"]
    , ["SVC", "class", "from sklearn.svm import SVC"]
    , ["SVR", "class", "from sklearn.svm import SVR"]
    , ["DecisionTreeClassifier", "class", "from sklearn.tree import DecisionTreeClassifier"]
    , ["DecisionTreeRegressor", "class", "from sklearn.tree import DecisionTreeRegressor"]
    , ["RandomForestClassifier", "class", "from sklearn.ensemble import RandomForestClassifier"]
    , ["RandomForestRegressor", "class", "from sklearn.ensemble import RandomForestRegressor"]
    , ["ExtraTreesClassifier", "class", "from sklearn.ensemble import ExtraTreesClassifier"]
    , ["GradientBoostingClassifier", "class", "from sklearn.ensemble import GradientBoostingClassifier"]
    , ["GradientBoostingRegressor", "class", "from sklearn.ensemble import GradientBoostingRegressor"]
    , ["AdaBoostClassifier", "class", "from sklearn.ensemble import AdaBoostClassifier"]
    , ["MLPClassifier", "class", "from sklearn.neural_network import MLPClassifier"]
    , ["MLPRegressor", "class", "from sklearn.neural_network import MLPRegressor"]
    , ["CountVectorizer", "class", "from sklearn.feature_extraction.text import CountVectorizer"]
    , ["TfidfVectorizer", "class", "from sklearn.feature_extraction.text import TfidfVectorizer"]
    , ["HashingVectorizer", "class", "from sklearn.feature_extraction.text import HashingVectorizer"]
    , ["KMeans", "class", "from sklearn.cluster import KMeans"]
    , ["DBSCAN", "class", "from sklearn.cluster import DBSCAN"]
    , ["PCA", "class", "from sklearn.decomposition import PCA"]
    , ["accuracy_score", "function", "from sklearn.metrics import accuracy_score"]
    , ["precision_score", "function", "from sklearn.metrics import precision_score"]
    , ["recall_score", "function", "from sklearn.metrics import recall_score"]
    , ["f1_score", "function", "from sklearn.metrics import f1_score"]
    , ["confusion_matrix", "function", "from sklearn.metrics import confusion_matrix"]
    , ["classification_report", "function", "from sklearn.metrics import classification_report"]
    , ["mean_squared_error", "function", "from sklearn.metrics import mean_squared_error"]
    , ["r2_score", "function", "from sklearn.metrics import r2_score"]
    , ["load_iris", "function", "from sklearn.datasets import load_iris"]
    , ["load_wine", "function", "from sklearn.datasets import load_wine"]
    , ["make_classification", "function", "from sklearn.datasets import make_classification"]
    , ["webdriver", "module", "from selenium import webdriver"]
    , ["By", "class", "from selenium.webdriver.common.by import By"]
    , ["WebDriverWait", "class", "from selenium.webdriver.support.ui import WebDriverWait"]
    , ["EC", "module", "from selenium.webdriver.support import expected_conditions as EC"]
    , ["Workbook", "class", "from openpyxl import Workbook"]
    , ["load_workbook", "function", "from openpyxl import load_workbook"]
    , ["Document", "class", "from docx import Document"]
    // PDF: PyMuPDF uses `pymupdf` in current releases and supports the legacy
    // `fitz` module name. Keep both so existing examples continue to work.
    , ["pymupdf", "module", "import pymupdf"]
    , ["fitz", "module", "import fitz"]
    , ["pypdf", "module", "import pypdf"]
    , ["PdfReader", "class", "from pypdf import PdfReader"]
    , ["PdfWriter", "class", "from pypdf import PdfWriter"]
    , ["PdfMerger", "class", "from pypdf import PdfMerger"]
    , ["Transformation", "class", "from pypdf import Transformation"]
    , ["PyMuPDFLoader", "class", "from langchain_community.document_loaders import PyMuPDFLoader"]
    , ["torch", "module", "import torch"]
    , ["nn", "module", "import torch.nn as nn"]
    , ["F", "module", "import torch.nn.functional as F"]
    , ["pipeline", "function", "from transformers import pipeline"]
    , ["glob", "module", "import glob"]
    , ["shutil", "module", "import shutil"]
    , ["subprocess", "module", "import subprocess"]
    , ["logging", "module", "import logging"]
    , ["argparse", "module", "import argparse"]
    , ["pickle", "module", "import pickle"]
    , ["zipfile", "module", "import zipfile"]
    , ["tempfile", "module", "import tempfile"]
    , ["threading", "module", "import threading"]
    , ["multiprocessing", "module", "import multiprocessing"]
    , ["Decimal", "class", "from decimal import Decimal"]
    , ["Fraction", "class", "from fractions import Fraction"]
    , ["dataclass", "function", "from dataclasses import dataclass"]
    , ["field", "function", "from dataclasses import field"]
    , ["Enum", "class", "from enum import Enum"]
    , ["OrderedDict", "class", "from collections import OrderedDict"]
    , ["lru_cache", "function", "from functools import lru_cache"]
    , ["partial", "function", "from functools import partial"]
    , ["product", "function", "from itertools import product"]
    , ["combinations", "function", "from itertools import combinations"]
    , ["permutations", "function", "from itertools import permutations"]
    , ["chain", "function", "from itertools import chain"]
    , ["array", "function", "from numpy import array"]
    , ["arange", "function", "from numpy import arange"]
    , ["linspace", "function", "from numpy import linspace"]
    , ["zeros", "function", "from numpy import zeros"]
    , ["ones", "function", "from numpy import ones"]
    , ["read_csv", "function", "from pandas import read_csv"]
    , ["read_excel", "function", "from pandas import read_excel"]
    , ["concat", "function", "from pandas import concat"]
    , ["merge", "function", "from pandas import merge"]
    , ["to_datetime", "function", "from pandas import to_datetime"]
    , ["Figure", "class", "from matplotlib.figure import Figure"]
    , ["ElasticNet", "class", "from sklearn.linear_model import ElasticNet"]
    , ["SGDClassifier", "class", "from sklearn.linear_model import SGDClassifier"]
    , ["SGDRegressor", "class", "from sklearn.linear_model import SGDRegressor"]
    , ["Perceptron", "class", "from sklearn.linear_model import Perceptron"]
    , ["GaussianNB", "class", "from sklearn.naive_bayes import GaussianNB"]
    , ["MultinomialNB", "class", "from sklearn.naive_bayes import MultinomialNB"]
    , ["BernoulliNB", "class", "from sklearn.naive_bayes import BernoulliNB"]
    , ["VotingClassifier", "class", "from sklearn.ensemble import VotingClassifier"]
    , ["VotingRegressor", "class", "from sklearn.ensemble import VotingRegressor"]
    , ["StackingClassifier", "class", "from sklearn.ensemble import StackingClassifier"]
    , ["StackingRegressor", "class", "from sklearn.ensemble import StackingRegressor"]
    , ["HistGradientBoostingClassifier", "class", "from sklearn.ensemble import HistGradientBoostingClassifier"]
    , ["BaggingClassifier", "class", "from sklearn.ensemble import BaggingClassifier"]
    , ["IsolationForest", "class", "from sklearn.ensemble import IsolationForest"]
    , ["AgglomerativeClustering", "class", "from sklearn.cluster import AgglomerativeClustering"]
    , ["SpectralClustering", "class", "from sklearn.cluster import SpectralClustering"]
    , ["MiniBatchKMeans", "class", "from sklearn.cluster import MiniBatchKMeans"]
    , ["TruncatedSVD", "class", "from sklearn.decomposition import TruncatedSVD"]
    , ["NMF", "class", "from sklearn.decomposition import NMF"]
    , ["LatentDirichletAllocation", "class", "from sklearn.decomposition import LatentDirichletAllocation"]
    , ["TSNE", "class", "from sklearn.manifold import TSNE"]
    , ["SelectKBest", "class", "from sklearn.feature_selection import SelectKBest"]
    , ["RFE", "class", "from sklearn.feature_selection import RFE"]
    , ["chi2", "function", "from sklearn.feature_selection import chi2"]
    , ["cosine_similarity", "function", "from sklearn.metrics.pairwise import cosine_similarity"]
    , ["roc_auc_score", "function", "from sklearn.metrics import roc_auc_score"]
    , ["roc_curve", "function", "from sklearn.metrics import roc_curve"]
    , ["mean_absolute_error", "function", "from sklearn.metrics import mean_absolute_error"]
    , ["mean_absolute_percentage_error", "function", "from sklearn.metrics import mean_absolute_percentage_error"]
    , ["silhouette_score", "function", "from sklearn.metrics import silhouette_score"]
    , ["make_regression", "function", "from sklearn.datasets import make_regression"]
    , ["fetch_20newsgroups", "function", "from sklearn.datasets import fetch_20newsgroups"]
    , ["word_tokenize", "function", "from nltk.tokenize import word_tokenize"]
    , ["sent_tokenize", "function", "from nltk.tokenize import sent_tokenize"]
    , ["stopwords", "module", "from nltk.corpus import stopwords"]
    , ["WordCloud", "class", "from wordcloud import WordCloud"]
    , ["Okt", "class", "from konlpy.tag import Okt"]
    , ["tf", "module", "import tensorflow as tf"]
    , ["Sequential", "class", "from tensorflow.keras.models import Sequential"]
    , ["Dense", "class", "from tensorflow.keras.layers import Dense"]
    , ["Dropout", "class", "from tensorflow.keras.layers import Dropout"]
    , ["Conv2D", "class", "from tensorflow.keras.layers import Conv2D"]
    , ["LSTM", "class", "from tensorflow.keras.layers import LSTM"]
    , ["Adam", "class", "from tensorflow.keras.optimizers import Adam"]
    , ["px", "module", "import plotly.express as px"]
    , ["go", "module", "import plotly.graph_objects as go"]
    , ["st", "module", "import streamlit as st"]
    , ["Flask", "class", "from flask import Flask"]
    , ["render_template", "function", "from flask import render_template"]
    , ["FastAPI", "class", "from fastapi import FastAPI"]
    , ["BaseModel", "class", "from pydantic import BaseModel"]
    , ["create_engine", "function", "from sqlalchemy import create_engine"]
    , ["QtWidgets", "module", "from PyQt5 import QtWidgets"]
    , ["tk", "module", "import tkinter as tk"]
    , ["pygame", "module", "import pygame"]
    // ===== LangChain (로컬 Python에 설치돼 있어야 실행됨 — 브라우저 Pyodide에는 미제공) =====
    // langchain: 현재 권장되는 모델·에이전트 시작점
    , ["init_chat_model", "function", "from langchain.chat_models import init_chat_model"]
    , ["create_agent", "function", "from langchain.agents import create_agent"]
    // langchain_core.messages
    , ["HumanMessage", "class", "from langchain_core.messages import HumanMessage"]
    , ["AIMessage", "class", "from langchain_core.messages import AIMessage"]
    , ["SystemMessage", "class", "from langchain_core.messages import SystemMessage"]
    , ["ToolMessage", "class", "from langchain_core.messages import ToolMessage"]
    , ["BaseMessage", "class", "from langchain_core.messages import BaseMessage"]
    , ["AIMessageChunk", "class", "from langchain_core.messages import AIMessageChunk"]
    , ["trim_messages", "function", "from langchain_core.messages import trim_messages"]
    // langchain_core.prompts
    , ["ChatPromptTemplate", "class", "from langchain_core.prompts import ChatPromptTemplate"]
    , ["PromptTemplate", "class", "from langchain_core.prompts import PromptTemplate"]
    , ["MessagesPlaceholder", "class", "from langchain_core.prompts import MessagesPlaceholder"]
    , ["FewShotPromptTemplate", "class", "from langchain_core.prompts import FewShotPromptTemplate"]
    , ["HumanMessagePromptTemplate", "class", "from langchain_core.prompts import HumanMessagePromptTemplate"]
    , ["SystemMessagePromptTemplate", "class", "from langchain_core.prompts import SystemMessagePromptTemplate"]
    // langchain_core.output_parsers
    , ["StrOutputParser", "class", "from langchain_core.output_parsers import StrOutputParser"]
    , ["JsonOutputParser", "class", "from langchain_core.output_parsers import JsonOutputParser"]
    , ["CommaSeparatedListOutputParser", "class", "from langchain_core.output_parsers import CommaSeparatedListOutputParser"]
    , ["PydanticOutputParser", "class", "from langchain_core.output_parsers import PydanticOutputParser"]
    , ["BaseOutputParser", "class", "from langchain_core.output_parsers import BaseOutputParser"]
    // langchain_core.runnables
    , ["RunnablePassthrough", "class", "from langchain_core.runnables import RunnablePassthrough"]
    , ["RunnableLambda", "class", "from langchain_core.runnables import RunnableLambda"]
    , ["RunnableParallel", "class", "from langchain_core.runnables import RunnableParallel"]
    , ["RunnableSequence", "class", "from langchain_core.runnables import RunnableSequence"]
    , ["RunnableBranch", "class", "from langchain_core.runnables import RunnableBranch"]
    , ["RunnableConfig", "class", "from langchain_core.runnables import RunnableConfig"]
    , ["chain", "function", "from langchain_core.runnables import chain"]
    // langchain_core.tools / documents / language_models / embeddings / callbacks / exceptions
    , ["tool", "function", "from langchain_core.tools import tool"]
    , ["Tool", "class", "from langchain_core.tools import Tool"]
    , ["BaseTool", "class", "from langchain_core.tools import BaseTool"]
    , ["StructuredTool", "class", "from langchain_core.tools import StructuredTool"]
    , ["Document", "class", "from langchain_core.documents import Document"]
    , ["BaseChatModel", "class", "from langchain_core.language_models import BaseChatModel"]
    , ["Embeddings", "class", "from langchain_core.embeddings import Embeddings"]
    , ["BaseCallbackHandler", "class", "from langchain_core.callbacks import BaseCallbackHandler"]
    , ["OutputParserException", "class", "from langchain_core.exceptions import OutputParserException"]
    // langchain_core.vectorstores
    , ["InMemoryVectorStore", "class", "from langchain_core.vectorstores import InMemoryVectorStore"]
    // langchain_openai
    , ["ChatOpenAI", "class", "from langchain_openai import ChatOpenAI"]
    , ["OpenAI", "class", "from langchain_openai import OpenAI"]
    , ["OpenAIEmbeddings", "class", "from langchain_openai import OpenAIEmbeddings"]
    , ["AzureChatOpenAI", "class", "from langchain_openai import AzureChatOpenAI"]
    , ["AzureOpenAI", "class", "from langchain_openai import AzureOpenAI"]
    , ["AzureOpenAIEmbeddings", "class", "from langchain_openai import AzureOpenAIEmbeddings"]
    // langchain_text_splitters
    , ["RecursiveCharacterTextSplitter", "class", "from langchain_text_splitters import RecursiveCharacterTextSplitter"]
    , ["CharacterTextSplitter", "class", "from langchain_text_splitters import CharacterTextSplitter"]
    // langchain_community: RAG에서 자주 쓰는 로더·로컬 벡터 저장소
    , ["DirectoryLoader", "class", "from langchain_community.document_loaders import DirectoryLoader"]
    , ["TextLoader", "class", "from langchain_community.document_loaders import TextLoader"]
    , ["PyPDFLoader", "class", "from langchain_community.document_loaders import PyPDFLoader"]
    , ["WebBaseLoader", "class", "from langchain_community.document_loaders import WebBaseLoader"]
    , ["CSVLoader", "class", "from langchain_community.document_loaders import CSVLoader"]
    , ["JSONLoader", "class", "from langchain_community.document_loaders import JSONLoader"]
    , ["FAISS", "class", "from langchain_community.vectorstores import FAISS"]
    // langchain_classic (구 langchain 체인·에이전트·메모리)
    , ["LLMChain", "class", "from langchain_classic.chains import LLMChain"]
    , ["RetrievalQA", "class", "from langchain_classic.chains import RetrievalQA"]
    , ["ConversationChain", "class", "from langchain_classic.chains import ConversationChain"]
    , ["ConversationalRetrievalChain", "class", "from langchain_classic.chains import ConversationalRetrievalChain"]
    , ["AgentExecutor", "class", "from langchain_classic.agents import AgentExecutor"]
    , ["initialize_agent", "function", "from langchain_classic.agents import initialize_agent"]
    , ["create_react_agent", "function", "from langchain_classic.agents import create_react_agent"]
    , ["AgentType", "class", "from langchain_classic.agents import AgentType"]
    , ["ConversationBufferMemory", "class", "from langchain_classic.memory import ConversationBufferMemory"]
    , ["ConversationBufferWindowMemory", "class", "from langchain_classic.memory import ConversationBufferWindowMemory"]
    , ["ConversationSummaryMemory", "class", "from langchain_classic.memory import ConversationSummaryMemory"]
    , ["hub", "module", "from langchain_classic import hub"]
    // langchain_chroma
    , ["Chroma", "class", "from langchain_chroma import Chroma"]
    // ===== LangGraph =====
    // Keep the public, user-facing imports from the core package and its
    // official checkpoint/store integrations available even without Jedi.
    , ["langgraph", "module", "import langgraph"]
    // Graph API
    , ["StateGraph", "class", "from langgraph.graph import StateGraph"]
    , ["MessagesState", "class", "from langgraph.graph import MessagesState"]
    , ["MessageGraph", "class", "from langgraph.graph import MessageGraph"]
    , ["START", "constant", "from langgraph.graph import START"]
    , ["END", "constant", "from langgraph.graph import END"]
    , ["add_messages", "function", "from langgraph.graph import add_messages"]
    // Graph UI messages
    , ["UIMessage", "class", "from langgraph.graph.ui import UIMessage"]
    , ["RemoveUIMessage", "class", "from langgraph.graph.ui import RemoveUIMessage"]
    , ["push_ui_message", "function", "from langgraph.graph.ui import push_ui_message"]
    , ["delete_ui_message", "function", "from langgraph.graph.ui import delete_ui_message"]
    , ["ui_message_reducer", "function", "from langgraph.graph.ui import ui_message_reducer"]
    // Control, streaming, retry, cache, and snapshot types
    , ["Command", "class", "from langgraph.types import Command"]
    , ["Send", "class", "from langgraph.types import Send"]
    , ["Interrupt", "class", "from langgraph.types import Interrupt"]
    , ["interrupt", "function", "from langgraph.types import interrupt"]
    , ["Overwrite", "class", "from langgraph.types import Overwrite"]
    , ["RetryPolicy", "class", "from langgraph.types import RetryPolicy"]
    , ["TimeoutPolicy", "class", "from langgraph.types import TimeoutPolicy"]
    , ["CachePolicy", "class", "from langgraph.types import CachePolicy"]
    , ["StateSnapshot", "class", "from langgraph.types import StateSnapshot"]
    , ["StateUpdate", "class", "from langgraph.types import StateUpdate"]
    , ["PregelTask", "class", "from langgraph.types import PregelTask"]
    , ["PregelExecutableTask", "class", "from langgraph.types import PregelExecutableTask"]
    , ["GraphOutput", "class", "from langgraph.types import GraphOutput"]
    , ["Checkpointer", "class", "from langgraph.types import Checkpointer"]
    , ["Durability", "class", "from langgraph.types import Durability"]
    , ["StreamMode", "class", "from langgraph.types import StreamMode"]
    , ["StreamWriter", "class", "from langgraph.types import StreamWriter"]
    , ["StreamPart", "class", "from langgraph.types import StreamPart"]
    , ["ValuesStreamPart", "class", "from langgraph.types import ValuesStreamPart"]
    , ["UpdatesStreamPart", "class", "from langgraph.types import UpdatesStreamPart"]
    , ["MessagesStreamPart", "class", "from langgraph.types import MessagesStreamPart"]
    , ["CustomStreamPart", "class", "from langgraph.types import CustomStreamPart"]
    , ["CheckpointStreamPart", "class", "from langgraph.types import CheckpointStreamPart"]
    , ["TasksStreamPart", "class", "from langgraph.types import TasksStreamPart"]
    , ["DebugStreamPart", "class", "from langgraph.types import DebugStreamPart"]
    , ["TaskPayload", "class", "from langgraph.types import TaskPayload"]
    , ["TaskResultPayload", "class", "from langgraph.types import TaskResultPayload"]
    , ["CheckpointTask", "class", "from langgraph.types import CheckpointTask"]
    , ["CheckpointPayload", "class", "from langgraph.types import CheckpointPayload"]
    , ["DebugPayload", "class", "from langgraph.types import DebugPayload"]
    , ["All", "class", "from langgraph.types import All"]
    , ["ensure_valid_checkpointer", "function", "from langgraph.types import ensure_valid_checkpointer"]
    // Functional API
    , ["entrypoint", "function", "from langgraph.func import entrypoint"]
    , ["task", "function", "from langgraph.func import task"]
    // Runtime and node configuration helpers
    , ["Runtime", "class", "from langgraph.runtime import Runtime"]
    , ["ExecutionInfo", "class", "from langgraph.runtime import ExecutionInfo"]
    , ["ServerInfo", "class", "from langgraph.runtime import ServerInfo"]
    , ["RunControl", "class", "from langgraph.runtime import RunControl"]
    , ["BaseUser", "class", "from langgraph.runtime import BaseUser"]
    , ["get_runtime", "function", "from langgraph.runtime import get_runtime"]
    , ["get_config", "function", "from langgraph.config import get_config"]
    , ["get_store", "function", "from langgraph.config import get_store"]
    , ["get_stream_writer", "function", "from langgraph.config import get_stream_writer"]
    // Graph lifecycle callbacks
    , ["GraphCallbackHandler", "class", "from langgraph.callbacks import GraphCallbackHandler"]
    , ["GraphInterruptEvent", "class", "from langgraph.callbacks import GraphInterruptEvent"]
    , ["GraphResumeEvent", "class", "from langgraph.callbacks import GraphResumeEvent"]
    , ["GraphLifecycleEvent", "class", "from langgraph.callbacks import GraphLifecycleEvent"]
    , ["GraphLifecycleStatus", "class", "from langgraph.callbacks import GraphLifecycleStatus"]
    , ["get_sync_graph_callback_manager_for_config", "function", "from langgraph.callbacks import get_sync_graph_callback_manager_for_config"]
    , ["get_async_graph_callback_manager_for_config", "function", "from langgraph.callbacks import get_async_graph_callback_manager_for_config"]
    // Prebuilt agents and tool execution
    , ["ToolNode", "class", "from langgraph.prebuilt import ToolNode"]
    , ["ToolRuntime", "class", "from langgraph.prebuilt import ToolRuntime"]
    , ["ToolCallTransformer", "class", "from langgraph.prebuilt import ToolCallTransformer"]
    , ["InjectedState", "class", "from langgraph.prebuilt import InjectedState"]
    , ["InjectedStore", "class", "from langgraph.prebuilt import InjectedStore"]
    , ["ValidationNode", "class", "from langgraph.prebuilt import ValidationNode"]
    , ["tools_condition", "function", "from langgraph.prebuilt import tools_condition"]
    , ["create_react_agent", "function", "from langgraph.prebuilt import create_react_agent"]
    // Checkpoint base types, in-memory saver, and serializers
    , ["BaseCheckpointSaver", "class", "from langgraph.checkpoint.base import BaseCheckpointSaver"]
    , ["Checkpoint", "class", "from langgraph.checkpoint.base import Checkpoint"]
    , ["CheckpointMetadata", "class", "from langgraph.checkpoint.base import CheckpointMetadata"]
    , ["CheckpointTuple", "class", "from langgraph.checkpoint.base import CheckpointTuple"]
    , ["DeltaChannelHistory", "class", "from langgraph.checkpoint.base import DeltaChannelHistory"]
    , ["ChannelVersions", "class", "from langgraph.checkpoint.base import ChannelVersions"]
    , ["PendingWrite", "class", "from langgraph.checkpoint.base import PendingWrite"]
    , ["create_checkpoint", "function", "from langgraph.checkpoint.base import create_checkpoint"]
    , ["copy_checkpoint", "function", "from langgraph.checkpoint.base import copy_checkpoint"]
    , ["empty_checkpoint", "function", "from langgraph.checkpoint.base import empty_checkpoint"]
    , ["get_checkpoint_id", "function", "from langgraph.checkpoint.base import get_checkpoint_id"]
    , ["get_checkpoint_metadata", "function", "from langgraph.checkpoint.base import get_checkpoint_metadata"]
    , ["InMemorySaver", "class", "from langgraph.checkpoint.memory import InMemorySaver"]
    , ["MemorySaver", "class", "from langgraph.checkpoint.memory import MemorySaver"]
    , ["PersistentDict", "class", "from langgraph.checkpoint.memory import PersistentDict"]
    , ["SerializerProtocol", "class", "from langgraph.checkpoint.serde.base import SerializerProtocol"]
    , ["CipherProtocol", "class", "from langgraph.checkpoint.serde.base import CipherProtocol"]
    , ["EncryptedSerializer", "class", "from langgraph.checkpoint.serde.encrypted import EncryptedSerializer"]
    , ["JsonPlusSerializer", "class", "from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer"]
    // Optional official SQLite and PostgreSQL checkpoint savers
    , ["SqliteSaver", "class", "from langgraph.checkpoint.sqlite import SqliteSaver"]
    , ["AsyncSqliteSaver", "class", "from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver"]
    , ["BasePostgresSaver", "class", "from langgraph.checkpoint.postgres.base import BasePostgresSaver"]
    , ["PostgresSaver", "class", "from langgraph.checkpoint.postgres import PostgresSaver"]
    , ["ShallowPostgresSaver", "class", "from langgraph.checkpoint.postgres.shallow import ShallowPostgresSaver"]
    , ["AsyncPostgresSaver", "class", "from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver"]
    , ["AsyncShallowPostgresSaver", "class", "from langgraph.checkpoint.postgres.aio import AsyncShallowPostgresSaver"]
    // Long-term memory stores and operation types
    , ["BaseStore", "class", "from langgraph.store.base import BaseStore"]
    , ["Item", "class", "from langgraph.store.base import Item"]
    , ["SearchItem", "class", "from langgraph.store.base import SearchItem"]
    , ["GetOp", "class", "from langgraph.store.base import GetOp"]
    , ["PutOp", "class", "from langgraph.store.base import PutOp"]
    , ["SearchOp", "class", "from langgraph.store.base import SearchOp"]
    , ["ListNamespacesOp", "class", "from langgraph.store.base import ListNamespacesOp"]
    , ["MatchCondition", "class", "from langgraph.store.base import MatchCondition"]
    , ["NamespacePath", "class", "from langgraph.store.base import NamespacePath"]
    , ["NamespaceMatchType", "class", "from langgraph.store.base import NamespaceMatchType"]
    , ["IndexConfig", "class", "from langgraph.store.base import IndexConfig"]
    , ["TTLConfig", "class", "from langgraph.store.base import TTLConfig"]
    , ["InvalidNamespaceError", "class", "from langgraph.store.base import InvalidNamespaceError"]
    , ["InMemoryStore", "class", "from langgraph.store.memory import InMemoryStore"]
    , ["PostgresStore", "class", "from langgraph.store.postgres import PostgresStore"]
    , ["AsyncPostgresStore", "class", "from langgraph.store.postgres.aio import AsyncPostgresStore"]
    , ["Migration", "class", "from langgraph.store.postgres.base import Migration"]
    , ["PoolConfig", "class", "from langgraph.store.postgres.base import PoolConfig"]
    , ["ANNIndexConfig", "class", "from langgraph.store.postgres.base import ANNIndexConfig"]
    , ["HNSWConfig", "class", "from langgraph.store.postgres.base import HNSWConfig"]
    , ["IVFFlatConfig", "class", "from langgraph.store.postgres.base import IVFFlatConfig"]
    , ["PostgresIndexConfig", "class", "from langgraph.store.postgres.base import PostgresIndexConfig"]
    , ["BasePostgresStore", "class", "from langgraph.store.postgres.base import BasePostgresStore"]
    , ["Row", "class", "from langgraph.store.postgres.base import Row"]
    // Node-result cache
    , ["BaseCache", "class", "from langgraph.cache.base import BaseCache"]
    , ["InMemoryCache", "class", "from langgraph.cache.memory import InMemoryCache"]
    // Low-level channels and Pregel API
    , ["BaseChannel", "class", "from langgraph.channels import BaseChannel"]
    , ["AnyValue", "class", "from langgraph.channels import AnyValue"]
    , ["LastValue", "class", "from langgraph.channels import LastValue"]
    , ["LastValueAfterFinish", "class", "from langgraph.channels import LastValueAfterFinish"]
    , ["UntrackedValue", "class", "from langgraph.channels import UntrackedValue"]
    , ["EphemeralValue", "class", "from langgraph.channels import EphemeralValue"]
    , ["BinaryOperatorAggregate", "class", "from langgraph.channels import BinaryOperatorAggregate"]
    , ["DeltaChannel", "class", "from langgraph.channels import DeltaChannel"]
    , ["NamedBarrierValue", "class", "from langgraph.channels import NamedBarrierValue"]
    , ["NamedBarrierValueAfterFinish", "class", "from langgraph.channels import NamedBarrierValueAfterFinish"]
    , ["Topic", "class", "from langgraph.channels import Topic"]
    , ["Pregel", "class", "from langgraph.pregel import Pregel"]
    , ["NodeBuilder", "class", "from langgraph.pregel import NodeBuilder"]
    , ["RemoteGraph", "class", "from langgraph.pregel.remote import RemoteGraph"]
    // Managed state values
    , ["IsLastStep", "class", "from langgraph.managed import IsLastStep"]
    , ["RemainingSteps", "class", "from langgraph.managed import RemainingSteps"]
    // Public errors (including deprecated NodeInterrupt for older projects)
    , ["EmptyChannelError", "class", "from langgraph.errors import EmptyChannelError"]
    , ["ErrorCode", "class", "from langgraph.errors import ErrorCode"]
    , ["GraphBubbleUp", "class", "from langgraph.errors import GraphBubbleUp"]
    , ["GraphDrained", "class", "from langgraph.errors import GraphDrained"]
    , ["GraphRecursionError", "class", "from langgraph.errors import GraphRecursionError"]
    , ["InvalidUpdateError", "class", "from langgraph.errors import InvalidUpdateError"]
    , ["GraphInterrupt", "class", "from langgraph.errors import GraphInterrupt"]
    , ["ParentCommand", "class", "from langgraph.errors import ParentCommand"]
    , ["EmptyInputError", "class", "from langgraph.errors import EmptyInputError"]
    , ["TaskNotFound", "class", "from langgraph.errors import TaskNotFound"]
    , ["NodeError", "class", "from langgraph.errors import NodeError"]
    , ["NodeCancelledError", "class", "from langgraph.errors import NodeCancelledError"]
    , ["NodeTimeoutError", "class", "from langgraph.errors import NodeTimeoutError"]
    , ["NodeInterrupt", "class", "from langgraph.errors import NodeInterrupt"]
  ].map(([name, type, importText]) => ({ name, type, importText }));

  function pythonCompletionCandidates(source, prefix, keywords) {
    const query = String(prefix || "");
    const ranked = new Map();
    const identifier = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
    let match;
    while ((match = identifier.exec(String(source || "")))) {
      const word = match[0];
      if (!ranked.has(word)) ranked.set(word, 0);
    }
    // keywords 를 넘기지 않으면 파이썬 편집기 기본 동작(파이썬 키워드)을 유지한다.
    const kw = keywords === undefined ? PYTHON_COMPLETION_WORDS : (keywords || []);
    for (const word of kw) if (!ranked.has(word)) ranked.set(word, 1);
    return [...ranked]
      .filter(([word]) => word !== query && (!query || word.startsWith(query)))
      .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .map(([word]) => word);
  }

  // Public DataFrame API catalog for the bundled pandas 2.2.3 runtime. Keep
  // attributes non-callable so accepting them does not append parentheses.
  const PYTHON_DATAFRAME_ATTRIBUTES = (
    "T at attrs axes columns dtypes empty flags iat iloc index loc ndim shape size sparse style values"
  ).split(/\s+/);
  const PYTHON_DATAFRAME_METHODS = (
    "abs add add_prefix add_suffix agg aggregate align all any apply applymap asfreq asof assign astype at_time " +
    "backfill between_time bfill bool boxplot clip combine combine_first compare convert_dtypes copy corr corrwith " +
    "count cov cummax cummin cumprod cumsum describe diff div dot drop drop_duplicates droplevel dropna duplicated " +
    "eq eval ewm expanding explode ffill fillna filter first first_valid_index floordiv from_dict from_records ge get " +
    "groupby gt head hist idxmax idxmin infer_objects info insert interpolate isin isna isnull items iterrows " +
    "itertuples join keys kurt kurtosis last last_valid_index le lt map mask max mean median melt memory_usage merge " +
    "min mod mode mul ne nlargest notna notnull nsmallest nunique pad pct_change pipe pivot pivot_table plot pop pow " +
    "prod product quantile query radd rank rdiv reindex reindex_like rename rename_axis reorder_levels replace " +
    "resample reset_index rfloordiv rmod rmul rolling round rpow rsub rtruediv sample select_dtypes sem set_axis " +
    "set_flags set_index shift skew sort_index sort_values squeeze stack std sub sum swapaxes swaplevel tail take " +
    "to_clipboard to_csv to_dict to_excel to_feather to_gbq to_hdf to_html to_json to_latex to_markdown to_numpy " +
    "to_orc to_parquet to_period to_pickle to_records to_sql to_stata to_string to_timestamp to_xarray to_xml " +
    "transform transpose truediv truncate tz_convert tz_localize unstack update value_counts var where xs"
  ).split(/\s+/);
  const PYTHON_DATAFRAME_SIGNATURES = {
    sort_values:"sort_values(by, ascending=True, inplace=False, na_position='last', ignore_index=False)",
    groupby:"groupby(by=None, ...)",
    dropna:"dropna(axis=0, how='any', ...)",
    reset_index:"reset_index(level=None, drop=False, ...)",
    merge:"merge(right, how='inner', ...)",
    to_csv:"to_csv(path_or_buf=None, ...)"
  };
  const PYTHON_DATAFRAME_MEMBER_COMPLETIONS = [
    ...PYTHON_DATAFRAME_ATTRIBUTES.map(name => ({ name, type:"property", signature:"" })),
    ...PYTHON_DATAFRAME_METHODS.map(name => ({
      name,
      type:"function",
      signature:PYTHON_DATAFRAME_SIGNATURES[name] || (name + "(...)")
    }))
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Provide semantic fallback when Jedi is unavailable. This keeps DataFrame
  // members discoverable without adding pandas-only names to every object.
  function pythonMemberCompletionCandidates(source, receiver, prefix) {
    const name = String(receiver || "");
    const query = String(prefix || "");
    if (!/^[A-Za-z_]\w*$/.test(name)) return [];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dataframeAssignment = new RegExp(
      "(?:^|\\n)\\s*" + escaped
      + "(?:\\s*:\\s*[^=\\n]+)?\\s*=\\s*(?:(?:pd|pandas)\\s*\\.\\s*)?DataFrame\\s*\\(",
      "m"
    );
    const dataframeReaderAssignment = new RegExp(
      "(?:^|\\n)\\s*" + escaped
      + "(?:\\s*:\\s*[^=\\n]+)?\\s*=\\s*(?:pd|pandas)\\s*\\.\\s*"
      + "(?:read_csv|read_excel|read_json|read_html|read_parquet|read_feather|read_pickle|read_sql(?:_query|_table)?)\\s*\\(",
      "m"
    );
    const text = String(source || "");
    if (!dataframeAssignment.test(text) && !dataframeReaderAssignment.test(text)) return [];
    return PYTHON_DATAFRAME_MEMBER_COMPLETIONS
      .filter(item => item.name !== query && (!query || item.name.startsWith(query)))
      .map(item => ({ ...item }));
  }

  // options.catalog=false 면 내장 카탈로그(설치 패키지·표준 라이브러리)를 빼고 넘겨받은 후보만 쓴다.
  // 자동 팝업은 작업공간(같은 프로젝트) 후보만 보여 주고, 카탈로그 전체는 Ctrl+Space 에서만 연다.
  function pythonImportCompletionCandidates(source, prefix, extraCandidates=[], options={}) {
    const catalog = !(options && options.catalog === false);
    const text = String(source || ""), query = String(prefix || "");
    const declared = new Set();
    const seen = new Set();
    const declaration = /(?:^|\n)\s*(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b|(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    let match;
    while ((match = declaration.exec(text))) declared.add(match[1] || match[2]);
    const extra = Array.isArray(extraCandidates) ? extraCandidates.filter((item) => item && typeof item === "object") : [];
    const preferredExtra = extra.filter((item) => Number(item.priority) < 0);
    const regularExtra = extra.filter((item) => !(Number(item.priority) < 0));
    // 작업공간의 같은 이름은 설치 패키지 후보보다 우선한다. 단, 기본 목록 안에서
    // import 경로가 다른 동명 후보는 아래 key 기준으로 함께 보여 준다.
    const preferredNames = new Set(preferredExtra.map((item) => String(item.name || "")));
    return [
      ...preferredExtra,
      ...(catalog ? PYTHON_IMPORT_COMPLETIONS.filter((item) => !preferredNames.has(String(item.name || ""))) : []),
      ...regularExtra.filter((item) => !preferredNames.has(String(item.name || "")))
    ]
      .filter((item) => !query || item.name.startsWith(query))
      .filter((item) => {
        // 같은 이름이라도 import 경로가 다르면 선택 목록에 함께 남긴다.
        // 예: docx.Document / langchain_core.documents.Document, itertools.chain / LCEL chain
        const key = String(item.name || "") + "\n" + normalizePythonImport(item.importText);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      })
      .filter((item) => !declared.has(item.name))
      .filter((item) => !hasPythonImport(text, item.importText))
      .map((item) => ({ ...item }));
  }

  const isPythonIdentifier = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));

  // Build a module tree from the Python files opened in the same workspace. The
  // shortest module path reachable from the current script's directory (or one of
  // its parents) mirrors the project runner's sys.path.
  // options.projectRoot: 실행 기준 폴더(sys.path 루트)를 알고 있으면 그 폴더를 가장 먼저 본다.
  // 없으면 지금까지처럼 가장 가까운 폴더부터 — 같은 폴더 형제만 쓰는 단일 파일 실행에 맞다.
  // 자동 import 후보(pythonWorkspaceImportRowsFromIndex)와 import 문 완성
  // (pythonWorkspaceModuleRowsFromIndex)이 같은 색인을 나눠 쓴다 — 파일을 두 번 훑지 않도록.
  function pythonWorkspaceModuleIndex(currentPath, entries, options={}) {
    const normalize = (value) => normalizeWorkspacePath(value).replace(/\/+$/, "");
    const dirname = (value) => {
      const path = normalize(value), index = path.lastIndexOf("/");
      return index >= 0 ? path.slice(0, index) : "";
    };
    const current = normalize(currentPath);
    const bases = [];
    for (let base = dirname(current); ; base = dirname(base)) {
      if (!bases.includes(base)) bases.push(base);
      if (!base) break;
    }
    const projectRoot = options && options.projectRoot != null ? normalize(options.projectRoot) : null;
    const rootIndex = projectRoot == null ? -1 : bases.indexOf(projectRoot);
    if (rootIndex > 0) bases.unshift(...bases.splice(rootIndex, 1));
    const modulePathsFor = (value) => {
      const path = normalize(value);
      if (!/\.(?:py|pyw|pyi)$/i.test(path)) return [];
      const rows = [];
      for (const base of bases) {
        if (base && path !== base && !path.startsWith(base + "/")) continue;
        let relative = base ? path.slice(base.length).replace(/^\/+/, "") : path;
        relative = relative.replace(/\.(?:py|pyw|pyi)$/i, "");
        let parts = relative.split("/").filter(Boolean);
        if (parts[parts.length - 1] === "__init__") parts = parts.slice(0, -1);
        if (parts.length && parts.every(isPythonIdentifier)) {
          const modulePath = parts.join("/");
          if (!rows.includes(modulePath)) rows.push(modulePath);
        }
      }
      return rows;
    };
    const symbolsOf = (source) => {
      const rows = [];
      const definition = /^(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;
      let match;
      while ((match = definition.exec(source))) {
        rows.push({ name:match[2], type:match[1] === "class" ? "class" : "function" });
      }
      return rows;
    };
    const files = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        path:normalize(entry && entry.path),
        source:String((entry && entry.source) == null ? "" : entry.source),
        unreadable:!!(entry && entry.unreadable)
      }))
      .filter((entry) => entry.path && entry.path !== current && /\.(?:py|pyw|pyi)$/i.test(entry.path))
      .map((entry) => {
        const bindings = pythonModuleBindings(entry.source);
        const modulePaths = modulePathsFor(entry.path);
        // import 검사(pythonWorkspaceImportProblems)가 쓰는 "이 모듈이 가진 이름" 목록.
        // hasSource 는 "내용을 안다"는 뜻이다 — 못 읽은 파일(unreadable)만 false 로 두고
        // 내용이 빈 __init__.py 는 '가진 이름이 없는 모듈'로 정확히 취급한다.
        return {
          path:entry.path, moduleParts:modulePaths.length ? modulePaths[0].split("/") : null,
          modulePaths, symbols:symbolsOf(entry.source),
          exports:bindings.names, wildcard:bindings.wildcard, hasSource:!entry.unreadable
        };
      })
      .filter((entry) => entry.moduleParts && entry.moduleParts.length)
      .sort((a, b) => a.moduleParts.length - b.moduleParts.length || a.path.localeCompare(b.path));
    return { currentPath:current, files };
  }

  // 색인 → 자동 import 후보(이름 + 넣어 줄 import 문).
  function pythonWorkspaceImportRowsFromIndex(index) {
    const files = (index && Array.isArray(index.files)) ? index.files : [];
    const rows = [];
    const seen = new Set();
    const add = (name, type, importText) => {
      if (!isPythonIdentifier(name) || name.startsWith("_") || !importText) return;
      const key = name + "\n" + importText;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ name, type, importText, priority:-1, workspace:true });
    };
    for (const file of files) {
      const parts = file.moduleParts;
      for (let i = 0; i < parts.length; i++) {
        const parent = parts.slice(0, i).join(".");
        add(parts[i], "module", parent ? ("from " + parent + " import " + parts[i]) : ("import " + parts[i]));
      }
      const moduleName = parts.join(".");
      for (const symbol of file.symbols) add(symbol.name, symbol.type, "from " + moduleName + " import " + symbol.name);
    }
    return rows;
  }

  function pythonWorkspaceImportCompletionCandidates(currentPath, entries, options={}) {
    return pythonWorkspaceImportRowsFromIndex(pythonWorkspaceModuleIndex(currentPath, entries, options));
  }

  // 커서가 import 문 안에 있는지 읽는다(현재 줄만 본다 — 괄호로 이어진 여러 줄은 각 줄이 심볼 자리다).
  // kind "module": from ⟨여기⟩ / import ⟨여기⟩ — 모듈 경로를 치는 중.
  // kind "symbol": from a.b import ⟨여기⟩ — 모듈 안의 이름을 치는 중.
  // module 은 지금까지 확정된 점 경로(마지막 조각은 아직 치는 중이라 빼고 prefix 로 돌려준다).
  function pythonImportContextAt(source, caretOffset) {
    const text = String(source || "");
    const caret = Math.max(0, Math.min(Number(caretOffset) || 0, text.length));
    const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
    const line = text.slice(lineStart, caret);
    if (line.indexOf("#") >= 0) return null;
    // import 목록에서 지금 치고 있는 이름 조각(쉼표 뒤 마지막 토막). 별칭(as) 자리면 null.
    const symbolPrefix = (tail) => {
      if (/\bas\b[^,]*$/.test(tail)) return null;
      const last = tail.split(",").pop().trim();
      return !last || isPythonIdentifier(last) ? last : null;
    };
    const symbolMatch = line.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.*)$/);
    if (symbolMatch) {
      const prefix = symbolPrefix(symbolMatch[2].replace(/^[(\s]+/, ""));
      return prefix == null ? null : { kind:"symbol", module:symbolMatch[1].replace(/\.+$/, ""), prefix };
    }
    const moduleMatch = line.match(/^\s*(from|import)\s+([A-Za-z_][\w.]*|)$/);
    if (moduleMatch) {
      const typed = moduleMatch[2];
      const cut = typed.lastIndexOf(".");
      return { kind:"module", module:cut < 0 ? "" : typed.slice(0, cut), prefix:cut < 0 ? typed : typed.slice(cut + 1) };
    }
    // from … import ( … ) 로 여러 줄에 걸친 목록 — 커서 줄이 이어진 줄이면 문을 연 줄까지 올라간다.
    let scan = lineStart;
    for (let step = 0; step < 50 && scan > 0; step++) {
      const start = text.lastIndexOf("\n", scan - 2) + 1;
      const previous = text.slice(start, scan);
      const opener = previous.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s*\(/);
      if (opener) {
        const segment = text.slice(start, caret);
        if ((segment.match(/\(/g) || []).length <= (segment.match(/\)/g) || []).length) return null;   // 이미 닫힌 목록
        const prefix = symbolPrefix(segment.slice(segment.lastIndexOf("(") + 1));
        return prefix == null ? null : { kind:"symbol", module:opener[1], prefix };
      }
      if (!/^[\w.,\s()]*$/.test(previous)) return null;      // import 목록으로 볼 수 없는 줄에서 멈춘다
      scan = start;
    }
    return null;
  }

  // 색인 + import 문맥 → 그 자리에 넣을 이름 후보(모듈·클래스·함수). import 문 안이라
  // importText 는 붙이지 않는다 — 이름만 그대로 채워 넣는다.
  function pythonWorkspaceModuleRowsFromIndex(index, context) {
    const files = (index && Array.isArray(index.files)) ? index.files : [];
    const ctx = context && typeof context === "object" ? context : null;
    if (!ctx || !files.length) return [];
    const base = String(ctx.module || "").split(".").filter(Boolean);
    const prefix = String(ctx.prefix || "");
    const rows = [];
    const seen = new Set();
    const add = (name, type) => {
      if (!isPythonIdentifier(name) || name.startsWith("_")) return;
      if (prefix && !name.startsWith(prefix)) return;
      if (seen.has(name)) return;
      seen.add(name);
      rows.push({ name, type, workspace:true });
    };
    for (const file of files) {
      const parts = file.moduleParts;
      if (parts.length <= base.length) {
        // from a.b import ⟨여기⟩ — a.b 자체가 모듈이면 그 안의 최상위 이름을 준다.
        if (ctx.kind === "symbol" && parts.length === base.length && parts.every((part, i) => part === base[i])) {
          for (const symbol of file.symbols) add(symbol.name, symbol.type);
        }
        continue;
      }
      if (!base.every((part, i) => parts[i] === part)) continue;
      add(parts[base.length], "module");                        // 다음 단계 하위 모듈·패키지
    }
    return rows;
  }

  // ── 작업공간 기준 import 검사 ───────────────────────────────────────────────
  // 모듈이 가진 이름(다른 파일이 from … import 로 가져갈 수 있는 이름)을 모은다.
  // 여기서는 "넉넉하게" 잡는 편이 옳다 — 못 찾은 이름을 오류라고 잘못 말하는 것보다,
  // 조건부 정의·들여쓰기 안의 정의까지 이름으로 인정해 조용히 넘어가는 쪽이 안전하다.
  function pythonModuleBindings(source) {
    const text = String(source == null ? "" : source);
    const names = new Set();
    let wildcard = false;
    const bind = (value) => { if (isPythonIdentifier(value)) names.add(value); };
    const bindList = (value) => String(value || "").split(",").forEach((part) => bind(part.trim()));
    let match;
    const scan = (re, handle) => { re.lastIndex = 0; while ((match = re.exec(text))) handle(match); };
    scan(/^[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+([A-Za-z_]\w*)/gm, (m) => bind(m[1]));
    scan(/^[ \t]*([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?::[^=\n]+)?=(?!=)/gm, (m) => bindList(m[1]));
    // a = b = value 같은 연쇄 대입은 왼쪽의 모든 이름을 모은다.
    scan(/^[ \t]*([A-Za-z_]\w*(?:[ \t]*=[ \t]*[A-Za-z_]\w*)+)[ \t]*=(?!=)/gm,
      (m) => m[1].split("=").forEach((name) => bind(name.trim())));
    scan(/^[ \t]*for[ \t]+([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]+in\b/gm, (m) => bindList(m[1]));
    scan(/^[ \t]*(?:with|except)\b[^\n#]*?\bas[ \t]+([A-Za-z_]\w*)/gm, (m) => bind(m[1]));
    // 실제 import 문 파서를 재사용해 괄호·역슬래시 여러 줄과 별칭을 같은 규칙으로 처리한다.
    for (const row of pythonImportStatements(text)) {
      if (row.kind === "import") {
        for (const item of row.names) bind(item.asname || item.name.split(".")[0]);
      } else {
        for (const item of row.names) {
          if (item.name === "*") wildcard = true;
          else bind(item.asname || item.name);
        }
      }
    }
    // 모듈 __getattr__(PEP 562)은 어떤 이름이든 만들어 낼 수 있으니 검사를 포기한다.
    if (names.has("__getattr__")) wildcard = true;
    return { names:[...names], wildcard };
  }

  // 소스의 import 문을 위치까지 함께 읽는다. 괄호로 이어진 여러 줄과 역슬래시 이어쓰기를 합치고,
  // 삼중 따옴표 문자열 안(문서의 예시 코드)은 건너뛴다 — 예시까지 검사하면 오탐이 된다.
  function pythonImportStatements(source) {
    const text = String(source == null ? "" : source);
    const lines = text.split("\n");
    const lineStarts = [];
    for (let i = 0, at = 0; i < lines.length; i++) { lineStarts.push(at); at += lines[i].length + 1; }
    const positionAt = (offset) => {
      let low = 0, high = lineStarts.length - 1;
      while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid] <= offset) low = mid; else high = mid - 1; }
      return { line:low + 1, column:offset - lineStarts[low] };
    };
    // 주석은 길이를 유지한 채 공백으로 지운다 — 문장 안 위치가 원본 오프셋과 계속 같도록.
    const blankComment = (line) => {
      const at = line.indexOf("#");
      return at < 0 ? line : line.slice(0, at) + " ".repeat(line.length - at);
    };
    const tripleAfter = (line, state) => {
      let mode = state;
      for (let i = 0; i < line.length; i++) {
        const three = line.slice(i, i + 3);
        if (three === '"""' || three === "'''") {
          if (!mode) { mode = three; i += 2; }
          else if (mode === three) { mode = null; i += 2; }
        }
      }
      return mode;
    };
    // 깊이 0의 쉼표로 자르되 각 조각의 원본 오프셋을 유지한다.
    const splitTop = (body, base) => {
      const parts = [];
      let depth = 0, start = 0;
      for (let i = 0; i <= body.length; i++) {
        const ch = body[i];
        if (i === body.length || (ch === "," && depth === 0)) {
          parts.push({ text:body.slice(start, i), offset:base + start });
          start = i + 1;
        } else if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
      }
      return parts;
    };
    const named = (piece) => {
      const item = /^(\s*)([A-Za-z_][\w.]*|\*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(piece.text.replace(/\\/g, " "));
      if (!item) return null;
      return { name:item[2], asname:item[3] || "", offset:piece.offset + item[1].length };
    };
    const rows = [];
    let triple = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const openState = triple;
      triple = tripleAfter(raw, triple);
      if (openState) continue;                                  // 문자열 안에서 시작한 줄은 코드가 아니다
      if (!/^[ \t]*(?:from|import)[ \t]/.test(raw)) continue;
      let stmt = blankComment(raw);
      let last = i;
      // 괄호가 닫히지 않았거나 역슬래시로 이어지면 다음 줄까지 읽는다(줄바꿈 포함, 오프셋 유지).
      const unbalanced = (value) => {
        let depth = 0;
        for (const ch of value) { if (ch === "(") depth++; else if (ch === ")") depth--; }
        return depth > 0;
      };
      while (last + 1 < lines.length && (unbalanced(stmt) || /\\[ \t]*$/.test(stmt))) {
        last++;
        stmt += "\n" + blankComment(lines[last]);
        triple = tripleAfter(lines[last], triple);
      }
      const base = lineStarts[i];
      const fromMatch = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]*(?:\\\s*)?\bimport\b/.exec(stmt.replace(/\n/g, " "));
      if (fromMatch) {
        const level = fromMatch[1].length;
        const moduleAt = stmt.indexOf(fromMatch[1] + fromMatch[2], stmt.indexOf("from") + 4);
        const importAt = stmt.indexOf("import", moduleAt + fromMatch[1].length + fromMatch[2].length);
        if (importAt < 0) { i = last; continue; }
        let bodyStart = importAt + "import".length, bodyEnd = stmt.length;
        let body = stmt.slice(bodyStart, bodyEnd);
        const open = body.indexOf("(");
        if (open >= 0) {
          const close = body.lastIndexOf(")");
          bodyStart += open + 1;
          bodyEnd = close > open ? bodyStart + (close - open - 1) : stmt.length;
          body = stmt.slice(bodyStart, bodyEnd);
        }
        rows.push({
          kind:"from", level, module:fromMatch[2],
          module_:positionAt(base + Math.max(0, moduleAt)),
          names:splitTop(body, bodyStart).map(named).filter(Boolean)
            .map((item) => ({ name:item.name, asname:item.asname, at:positionAt(base + item.offset) }))
        });
        i = last;
        continue;
      }
      const importAt = /^[ \t]*import[ \t]/.test(stmt) ? stmt.indexOf("import") : -1;
      if (importAt < 0) { i = last; continue; }
      const bodyStart = importAt + "import".length;
      rows.push({
        kind:"import",
        names:splitTop(stmt.slice(bodyStart), bodyStart).map(named).filter(Boolean)
          .map((item) => ({ name:item.name, asname:item.asname, at:positionAt(base + item.offset) }))
      });
      i = last;
    }
    return rows;
  }

  // import 문 → Jedi 에게 "여기 정의가 있느냐"고 물어볼 자리 목록.
  // 칸은 이름 바로 뒤(끝)를 가리킨다 — Jedi 의 goto 가 커서 위치 기준으로 이름을 잡기 때문.
  // key 는 줄이 밀려도 같은 대상을 가리키는 이름표다. 결과를 key 로 기억해 두면 위(다른 줄)에
  // 한 줄을 넣었다고 해서 파이썬 프로세스를 다시 띄우지 않아도 된다.
  function pythonImportCheckTargets(source) {
    const rows = [];
    const add = (key, kind, label, module, at, length) => {
      if (!at) return;
      rows.push({ key, kind, label, module, line:at.line, column:at.column + length });
    };
    for (const stmt of pythonImportStatements(source)) {
      if (stmt.kind === "import") {
        for (const item of stmt.names) {
          if (!item.name || item.name === "*") continue;
          add("module:" + item.name, "module", item.name, "", item.at, item.name.length);
        }
        continue;
      }
      const dotted = String(stmt.module || "");
      const shown = ".".repeat(stmt.level) + dotted;
      // 상대 import 의 모듈 자리는 점만 있을 수 있어 위치를 잡기 어렵다 — 이름 쪽만 확인한다.
      if (dotted && !stmt.level) add("module:" + dotted, "module", dotted, "", stmt.module_, dotted.length);
      for (const item of stmt.names) {
        if (!item.name || item.name === "*") continue;
        add("name:" + shown + "|" + item.name, "name", item.name, shown, item.at, item.name.length);
      }
    }
    return rows;
  }

  // Jedi 가 정의를 찾지 못한 자리 → 경고 진단. "없다"가 아니라 "찾지 못했다"고 적는다 —
  // 동적으로 만들어지는 이름은 실제로 있는데도 Jedi 가 못 찾을 수 있어서다.
  function pythonJediImportProblems(targets, unresolvedKeys, skipLines, skipKeys) {
    const bad = unresolvedKeys instanceof Set ? unresolvedKeys : new Set(unresolvedKeys || []);
    if (!bad.size) return [];
    const skip = skipLines instanceof Set ? skipLines : new Set(skipLines || []);
    const skipTarget = skipKeys instanceof Set ? skipKeys : new Set(skipKeys || []);
    const list = Array.isArray(targets) ? targets : [];
    // 모듈 자체를 못 찾았으면 그 모듈에서 가져오는 이름은 따로 말하지 않는다(같은 줄에 두 번 적히지 않도록).
    const failedModules = new Set(list.filter((item) => item.kind === "module" && bad.has(item.key))
      .map((item) => item.label));
    const rows = [];
    for (const item of list) {
      if (!bad.has(item.key) || skip.has(item.line) || skipTarget.has(item.key)) continue;
      if (item.kind === "name" && failedModules.has(item.module)) continue;
      rows.push(item.kind === "module" ? {
        severity:"warning", line:item.line, column:item.column, code:"PY-IMPORT-JEDI",
        message:"'" + item.label + "' 모듈의 정의를 찾지 못했어요.",
        hint:"설치되지 않은 패키지이거나 경로가 틀렸을 수 있어요. 철자와 pip 설치를 확인하세요."
      } : {
        severity:"warning", line:item.line, column:item.column, code:"PY-IMPORT-JEDI",
        message:"'" + item.module + "' 에서 '" + item.label + "' 의 정의를 찾지 못했어요.",
        hint:"그 모듈에 있는 이름인지 확인하세요. 실행할 때 만들어지는 이름이라면 실제로는 있을 수도 있어요."
      });
    }
    return rows;
  }

  // 열려 있는 작업공간의 .py 색인만 보고 import 경로/이름이 실제로 있는지 확인한다.
  // 설치 패키지·표준 라이브러리는 색인에 없으므로 아예 검사하지 않는다 — 최상위 이름이
  // 작업공간 모듈일 때만(=우리가 아는 프로젝트일 때만) 문제를 보고한다.
  function pythonWorkspaceImportAnalysis(source, index) {
    const files = (index && Array.isArray(index.files)) ? index.files : [];
    if (!files.length) return { problems:[], resolvedKeys:[] };
    const current = normalizeWorkspacePath((index && index.currentPath) || "");
    const currentDir = current.split("/").slice(0, -1);
    // 색인이 현재 파일부터 작업공간 루트까지 계산한 가능한 모듈 경로로 맞춘다.
    // 단순 파일 경로 suffix 로 맞추면 vendor/requests.py 때문에 외부 requests 패키지까지
    // 작업공간 모듈로 오인할 수 있다. exact=true 인 상대 import 만 실제 파일 경로로 계산한다.
    const wantsFor = (rel) => ["py", "pyw", "pyi"]
      .reduce((out, ext) => out.concat([rel + "." + ext, rel + "/__init__." + ext]), []);
    const hits = (rel, exact) => {
      const wants = wantsFor(rel);
      return files.filter((file) => exact
        ? wants.includes(file.path)
        : (Array.isArray(file.modulePaths) ? file.modulePaths.includes(rel) : file.moduleParts.join("/") === rel));
    };
    const isPackage = (rel, exact) => files.some((file) => exact
      ? file.path.startsWith(rel + "/")
      : (Array.isArray(file.modulePaths) ? file.modulePaths : [file.moduleParts.join("/")])
        .some((modulePath) => modulePath.startsWith(rel + "/")));
    const known = (rel, exact) => hits(rel, exact).length > 0 || isPackage(rel, exact);
    const problems = [];
    const resolvedKeys = new Set();
    const addModuleProblem = (shown, at) => {
      problems.push({
        severity:"error", line:at.line, column:at.column, code:"PY-IMPORT-MODULE",
        message:"'" + shown + "' 모듈을 작업공간에서 찾지 못했어요.",
        hint:"폴더·파일 이름과 철자를 확인하세요. 실행 기준 폴더에서 시작하는 경로여야 해요."
      });
    };
    const addNameProblem = (module, name, at) => {
      problems.push({
        severity:"error", line:at.line, column:at.column, code:"PY-IMPORT-NAME",
        message:"'" + module + "' 안에 '" + name + "' 이름이 없어요.",
        hint:"그 파일에 정의된 이름인지, 철자가 맞는지 확인하세요."
      });
    };
    const dottedToRel = (dotted) => String(dotted || "").split(".").filter(Boolean).join("/");
    for (const row of pythonImportStatements(source)) {
      if (row.kind === "import") {
        for (const item of row.names) {
          const dotted = String(item.name || "");
          if (!dotted || dotted === "*") continue;
          if (!known(dotted.split(".")[0], false)) continue;      // 작업공간 밖 패키지 — 건드리지 않는다
          if (!known(dottedToRel(dotted), false)) addModuleProblem(dotted, item.at);
          else resolvedKeys.add("module:" + dotted);
        }
        continue;
      }
      // from … import … — 먼저 모듈이 놓인 폴더 경로를 구한다.
      const shown = ".".repeat(row.level) + String(row.module || "");
      const parts = String(row.module || "").split(".").filter(Boolean);
      let rel = "", exact = false;
      if (row.level > 0) {
        // 상대 import 는 패키지 안에서만 쓸 수 있다 — 올라갈 폴더가 모자라면 판단하지 않는다.
        if (currentDir.length < row.level) continue;
        const base = currentDir.slice(0, currentDir.length - (row.level - 1));
        if (!isPackage(base.join("/"), true)) continue;           // 그 폴더를 색인이 모르면 판단 보류
        rel = base.concat(parts).join("/");
        exact = true;
      } else {
        if (!parts.length) continue;
        if (!known(parts[0], false)) continue;
        rel = parts.join("/");
      }
      if (!known(rel, exact)) { addModuleProblem(shown, row.module_); continue; }
      if (row.module && !row.level) resolvedKeys.add("module:" + row.module);
      const found = hits(rel, exact);
      if (found.length > 1) continue;                             // 같은 경로가 여럿 — 어느 파일인지 확정할 수 없다
      const file = found[0] || null;
      if (file && (!file.hasSource || file.wildcard)) continue;   // 못 읽었거나 import * 이면 이름 검사 포기
      const label = rel.split("/").join(".") || shown;
      for (const item of row.names) {
        const name = String(item.name || "");
        if (!name || name === "*") continue;
        const targetKey = "name:" + shown + "|" + name;
        if (known(rel + "/" + name, exact)) { resolvedKeys.add(targetKey); continue; } // 하위 모듈을 가져오는 형태
        if (file) {
          if (!file.exports.includes(name)) addNameProblem(label, name, item.at);
          else resolvedKeys.add(targetKey);
        }
        else addModuleProblem(label + "." + name, item.at);       // __init__.py 없는 패키지 → 하위 모듈만 가능
      }
    }
    return { problems, resolvedKeys:[...resolvedKeys] };
  }

  function pythonWorkspaceImportProblems(source, index) {
    return pythonWorkspaceImportAnalysis(source, index).problems;
  }

  function normalizePythonImport(importText) {
    return String(importText || "").trim().replace(/\s+/g, " ");
  }

  function normalizePythonImportSpec(spec) {
    return String(spec || "").trim().replace(/\s+/g, " ");
  }

  function parsePythonFromImport(importText) {
    const match = normalizePythonImport(importText).match(/^from\s+([.A-Za-z_][.\w]*)\s+import\s+(.+)$/);
    if (!match) return null;
    let body = match[2].trim();
    if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1);
    const specs = body.replace(/\\\s*/g, " ").split(",").map(normalizePythonImportSpec).filter(Boolean);
    return specs.length ? { module:match[1], specs } : null;
  }

  function pythonTopLevelFromImports(source) {
    const text = String(source || "");
    const rows = [];
    const re = /^from[ \t]+([.A-Za-z_][.\w]*)[ \t]+import[ \t]+([^\r\n]*)/gm;
    let match;
    while ((match = re.exec(text))) {
      const start = match.index;
      const firstRest = match[2].replace(/\s*#.*$/, "");
      const parenthesized = /^\s*\(/.test(firstRest);
      const continuation = /\\\s*$/.test(firstRest);
      let end = start + match[0].length;
      if (parenthesized) {
        let cursor = start, depth = 0, sawOpen = false;
        while (cursor < text.length) {
          const newlineAt = text.indexOf("\n", cursor);
          const rawEnd = newlineAt < 0 ? text.length : newlineAt;
          const contentEnd = rawEnd > cursor && text.charAt(rawEnd - 1) === "\r" ? rawEnd - 1 : rawEnd;
          const code = text.slice(cursor, contentEnd).replace(/\s*#.*$/, "");
          for (const ch of code) {
            if (ch === "(") { depth++; sawOpen = true; }
            else if (ch === ")") depth--;
          }
          end = contentEnd;
          if (sawOpen && depth <= 0) break;
          if (newlineAt < 0) break;
          cursor = newlineAt + 1;
        }
      }
      const statement = text.slice(start, end);
      const code = statement.split(/\r?\n/).map((line) => line.replace(/\s*#.*$/, "")).join(" ");
      const header = code.match(/^from\s+([.A-Za-z_][.\w]*)\s+import\s+([\s\S]+)$/);
      if (header) {
        let body = header[2].trim();
        if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1);
        const specs = body.replace(/\\\s*/g, " ").split(",").map(normalizePythonImportSpec).filter(Boolean);
        rows.push({
          start, end, statement, module:header[1], specs,
          parenthesized, continuation, hasStar:specs.includes("*")
        });
      }
      re.lastIndex = Math.max(re.lastIndex, end);
    }
    return rows;
  }

  function hasPythonImport(source, importText) {
    const target = normalizePythonImport(importText);
    if (!target) return true;
    if (String(source || "").split("\n").some((line) => normalizePythonImport(line.replace(/\s*#.*$/, "")) === target)) return true;
    const wanted = parsePythonFromImport(target);
    if (!wanted) return false;
    return pythonTopLevelFromImports(source).some((row) =>
      row.module === wanted.module
      && (row.hasStar || wanted.specs.every((spec) => row.specs.includes(spec)))
    );
  }

  function mergePythonFromImport(source, importText) {
    const text = String(source || "");
    const wanted = parsePythonFromImport(importText);
    if (!wanted || wanted.specs.length !== 1 || wanted.specs[0] === "*") return { value:text, merged:false };
    const spec = wanted.specs[0];
    for (const row of pythonTopLevelFromImports(text)) {
      if (row.module !== wanted.module) continue;
      if (row.hasStar || row.specs.includes(spec)) return { value:text, merged:true, start:row.start, oldLength:row.end - row.start, newLength:row.end - row.start };
      if (row.continuation) continue;
      let replacement = row.statement;
      if (!row.parenthesized) {
        const hashAt = replacement.indexOf("#");
        const codeEnd = hashAt >= 0 ? hashAt : replacement.length;
        const beforeComment = replacement.slice(0, codeEnd).replace(/\s+$/, "");
        const suffix = replacement.slice(beforeComment.length);
        replacement = beforeComment + ", " + spec + suffix;
      } else if (!replacement.includes("\n")) {
        const closeAt = replacement.lastIndexOf(")");
        if (closeAt < 0) continue;
        const beforeClose = replacement.slice(0, closeAt);
        const trimmed = beforeClose.replace(/\s+$/, "");
        const suffix = beforeClose.slice(trimmed.length);
        const addition = trimmed.endsWith("(")
          ? spec
          : (trimmed.endsWith(",") ? " " + spec + "," : ", " + spec);
        replacement = trimmed + addition + suffix + replacement.slice(closeAt);
      } else {
        const newline = replacement.includes("\r\n") ? "\r\n" : "\n";
        const closeAt = replacement.lastIndexOf(")");
        const closeLineStart = replacement.lastIndexOf("\n", closeAt - 1) + 1;
        if (closeAt < 0 || closeLineStart <= 0) continue;
        let prefix = replacement.slice(0, closeLineStart);
        const closing = replacement.slice(closeLineStart);
        let prefixBody = prefix.slice(0, -newline.length);
        const previousLineStart = prefixBody.lastIndexOf("\n") + 1;
        let previousLine = prefixBody.slice(previousLineStart);
        const previousCode = previousLine.replace(/\s*#.*$/, "").replace(/\s+$/, "");
        const closingIndent = (closing.match(/^([ \t]*)/) || ["", ""])[1];
        let itemIndent = (previousLine.match(/^([ \t]*)/) || ["", ""])[1];
        if (previousCode.endsWith("(")) itemIndent = closingIndent + "    ";
        else if (!previousCode.endsWith(",")) {
          const hashAt = previousLine.indexOf("#");
          const codeEnd = hashAt >= 0 ? hashAt : previousLine.length;
          const beforeComment = previousLine.slice(0, codeEnd).replace(/\s+$/, "");
          previousLine = beforeComment + "," + previousLine.slice(beforeComment.length);
          prefixBody = prefixBody.slice(0, previousLineStart) + previousLine;
        }
        prefix = prefixBody + newline + itemIndent + spec + "," + newline;
        replacement = prefix + closing;
      }
      const next = text.slice(0, row.start) + replacement + text.slice(row.end);
      return {
        value:next, merged:true, start:row.start,
        oldLength:row.end - row.start, newLength:replacement.length
      };
    }
    return { value:text, merged:false };
  }

  // 괄호로 감싼 여러 줄 import나 백슬래시로 이어진 줄까지 한 문장으로 보고 마지막 줄 번호를 돌려준다.
  function pythonLogicalLineEndIndex(lines, at) {
    let depth = 0, cursor = at;
    while (cursor < lines.length) {
      const code = String(lines[cursor] || "").replace(/\r$/, "").replace(/\s*#.*$/, "");
      for (const ch of code) {
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      }
      if (depth <= 0 && !/\\\s*$/.test(code)) return cursor;
      cursor++;
    }
    return lines.length - 1;
  }

  function pythonImportInsertOffset(source) {
    const text = String(source || "");
    const lines = text.split("\n");
    let index = 0;
    if (lines[0] && /^#!.*python/i.test(lines[0])) index = 1;
    if (index < 2 && /^#.*coding[:=]/i.test(lines[index] || "")) index++;
    // 간단한 모듈 docstring을 건너뛴다. __future__ import는 반드시 그 뒤에 와야 한다.
    const doc = (lines[index] || "").match(/^\s*([\"']{3})/);
    if (doc) {
      const quote = doc[1];
      if ((lines[index].match(new RegExp(quote.replace(/([\\"'])/g, "\\$1"), "g")) || []).length >= 2) index++;
      else {
        index++;
        while (index < lines.length && !lines[index].includes(quote)) index++;
        if (index < lines.length) index++;
      }
    }
    while (index < lines.length && /^\s*from\s+__future__\s+import\b/.test(lines[index])) {
      index = pythonLogicalLineEndIndex(lines, index) + 1;
    }
    // 기존 최상단 import 묶음 안에서는 마지막 import 다음에 둔다. 빈 줄과 주석은 묶음에 포함한다.
    let lastImport = -1, scan = index;
    while (scan < lines.length) {
      const line = lines[scan];
      if (/^\s*(?:import\s+|from\s+[.A-Za-z_][\w.]*\s+import\b)/.test(line)) {
        lastImport = pythonLogicalLineEndIndex(lines, scan);   // 괄호형 여러 줄 import는 닫는 줄까지 건너뛴다
        scan = lastImport + 1;
        continue;
      }
      if (/^\s*(?:#.*)?$/.test(line)) { scan++; continue; }
      break;
    }
    const insertLine = lastImport >= 0 ? lastImport + 1 : index;
    let offset = 0;
    for (let i = 0; i < insertLine; i++) offset += lines[i].length + 1;
    return offset;
  }

  function completionApplicationPlan(value, range, item) {
    const text = String(value || "");
    const insertion = completionInsertionPlan(text, range, item);
    const start = Math.max(0, Math.min(Number(range && range.start) || 0, text.length));
    const end = Math.max(start, Math.min(Number(range && range.end) || start, text.length));
    let next = text.slice(0, start) + insertion.text + text.slice(end);
    let caret = insertion.caret;
    const importText = item && typeof item === "object" ? normalizePythonImport(item.importText) : "";
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const linePrefix = text.slice(lineStart, start);
    // import 문을 작성하는 도중이거나 이미 import된 경우에는 본문만 완성한다.
    if (!importText || /^\s*(?:from|import)\b/.test(linePrefix) || hasPythonImport(next, importText)) return { value:next, caret };
    const mergedImport = mergePythonFromImport(next, importText);
    if (mergedImport.merged) {
      if (mergedImport.start + mergedImport.oldLength <= caret) {
        caret += mergedImport.newLength - mergedImport.oldLength;
      }
      return { value:mergedImport.value, caret };
    }
    const offset = pythonImportInsertOffset(next);
    const prefix = offset > 0 && next.charAt(offset - 1) !== "\n" ? "\n" : "";
    const suffix = offset < next.length ? "\n" : "";
    const added = prefix + importText + suffix;
    next = next.slice(0, offset) + added + next.slice(offset);
    if (offset <= caret) caret += added.length;
    return { value:next, caret };
  }

  function normalizeIdentifierSelection(value, selectionStart, selectionEnd) {
    const text = String(value || "");
    let start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    let end = Math.max(start, Math.min(Number(selectionEnd) || 0, text.length));
    const isIdentifierChar = (ch) => !!ch && (/[A-Za-z0-9_]/.test(ch) || (ch.charCodeAt(0) > 127 && !/\s/.test(ch)));
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start === end || !isIdentifierChar(text[start])) return { selectionStart: start, selectionEnd: end };
    while (start > 0 && isIdentifierChar(text[start - 1])) start--;
    end = start;
    while (end < text.length && isIdentifierChar(text[end])) end++;
    return { selectionStart: start, selectionEnd: end };
  }

  function pythonBracketContentSelection(value, caretOffset) {
    const text = String(value || "");
    const caret = Math.max(0, Math.min(Number(caretOffset) || 0, text.length));
    const openIndex = caret - 1;
    const pairs = { "(":")", "[":"]", "{":"}" };
    const open = text[openIndex];
    if (!pairs[open]) return null;

    let state = "code", quote = "", triple = false, escaped = false;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (state === "comment") {
        if (ch === "\n") state = "code";
        continue;
      }
      if (state === "string") {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (triple) {
          if (ch === quote && text[i + 1] === quote && text[i + 2] === quote) {
            i += 2;
            state = "code";
            quote = "";
            triple = false;
          }
        } else if (ch === quote) {
          state = "code";
          quote = "";
        }
        continue;
      }
      if (ch === "#") {
        state = "comment";
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        triple = text[i + 1] === ch && text[i + 2] === ch;
        if (triple) i += 2;
        state = "string";
        continue;
      }
      if (i < openIndex) continue;
      if (i === openIndex) {
        stack.push(open);
        continue;
      }
      if (pairs[ch]) {
        stack.push(ch);
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        if (!stack.length || pairs[stack[stack.length - 1]] !== ch) return null;
        stack.pop();
        if (!stack.length) {
          if (i === caret) return null;
          return { selectionStart:caret, selectionEnd:i };
        }
      }
    }
    return null;
  }

  function findNextIdentifierOccurrence(value, selectionStart, selectionEnd, reverse=false) {
    const text = String(value || "");
    let start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    let end = Math.max(start, Math.min(Number(selectionEnd) || 0, text.length));
    const selected = text.slice(start, end);
    const isIdentifierChar = (ch) => !!ch && (/[A-Za-z0-9_]/.test(ch) || (ch.charCodeAt(0) > 127 && !/\s/.test(ch)));
    if (!selected || selected.length > 80 || !/^[\w가-힣]+$/.test(selected)) return null;
    const isWhole = (index) => !isIdentifierChar(text[index - 1]) && !isIdentifierChar(text[index + selected.length]);
    const findForward = (from, limit=text.length) => {
      let pos = Math.max(0, from);
      while ((pos = text.indexOf(selected, pos)) !== -1 && pos < limit) {
        if (isWhole(pos)) return pos;
        pos += Math.max(1, selected.length);
      }
      return -1;
    };
    const findBackward = (from, min=0) => {
      let pos = Math.min(text.length, from);
      while ((pos = text.lastIndexOf(selected, pos - 1)) !== -1 && pos >= min) {
        if (isWhole(pos)) return pos;
      }
      return -1;
    };
    let next = reverse ? findBackward(start) : findForward(end);
    if (next < 0) next = reverse ? findBackward(text.length + 1, end) : findForward(0, start);
    if (next < 0 || next === start) return null;
    return { selectionStart: next, selectionEnd: next + selected.length };
  }

  function identifierOccurrences(value, selectionStart, selectionEnd, max=2000) {
    const text = String(value || "");
    const selected = normalizeIdentifierSelection(text, selectionStart, selectionEnd);
    const term = text.slice(selected.selectionStart, selected.selectionEnd);
    const isIdentifierChar = (ch) => !!ch && (/[A-Za-z0-9_]/.test(ch) || (ch.charCodeAt(0) > 127 && !/\s/.test(ch)));
    if (!term || term.length > 80 || [...term].some((ch) => !isIdentifierChar(ch))) return null;
    // 변수명 연결 편집이 문자열 내용·주석까지 바꾸지 않도록 간단한 Python 어휘 상태를 만든다.
    const code = new Uint8Array(text.length);
    let state = "code", quote = "", triple = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (state === "comment"){
        if (ch === "\n"){ state = "code"; code[i] = 1; }
        continue;
      }
      if (state === "string"){
        if (triple){
          if (ch === quote && text[i + 1] === quote && text[i + 2] === quote){ i += 2; state = "code"; quote = ""; triple = false; }
        } else if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote){ state = "code"; quote = ""; }
        continue;
      }
      if (ch === "#"){ state = "comment"; continue; }
      if (ch === "'" || ch === '"'){
        quote = ch; triple = text[i + 1] === ch && text[i + 2] === ch;
        if (triple) i += 2;
        state = "string";
        continue;
      }
      code[i] = 1;
    }
    if (!code[selected.selectionStart]) return null;
    const ranges = [];
    let pos = 0, primaryIndex = -1;
    while ((pos = text.indexOf(term, pos)) !== -1) {
      if (code[pos] && code[pos + term.length - 1] &&
          !isIdentifierChar(text[pos - 1]) && !isIdentifierChar(text[pos + term.length])) {
        if (pos === selected.selectionStart) primaryIndex = ranges.length;
        ranges.push({ start: pos, end: pos + term.length });
        if (ranges.length >= max) break;
      }
      pos += Math.max(1, term.length);
    }
    if (primaryIndex < 0 || ranges.length < 2) return null;
    return { term, ranges, primaryIndex };
  }

  function diffTextEdit(before, after) {
    const oldText = String(before || ""), newText = String(after || "");
    let start = 0;
    while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
    let oldEnd = oldText.length, newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) { oldEnd--; newEnd--; }
    return { start, end: oldEnd, inserted: newText.slice(start, newEnd) };
  }

  // 비동기 의미 분석 결과의 문자 범위를 한 번의 텍스트 편집 뒤 새 위치로 옮긴다.
  // 직접 건드린 범위는 오래된 판정을 표시하지 않도록 버리고, 앞/뒤의 안전한 범위만 유지한다.
  function remapTextRangesAfterEdit(ranges, before, after) {
    const oldText = String(before || ""), newText = String(after || "");
    const edit = diffTextEdit(oldText, newText);
    if (edit.start === edit.end && !edit.inserted) return Array.isArray(ranges) ? ranges.slice() : [];
    const delta = edit.inserted.length - (edit.end - edit.start);
    const isIdentifierChar = (ch) => !!ch && /[A-Za-z0-9_\u0080-\uFFFF]/.test(ch);
    const next = [];
    for (const raw of Array.isArray(ranges) ? ranges : []) {
      const start = Math.max(0, parseInt(raw && raw.start, 10) || 0);
      const end = Math.max(start, parseInt(raw && raw.end, 10) || 0);
      if (end <= start || end > oldText.length) continue;
      let mappedStart;
      if (end <= edit.start) mappedStart = start;
      else if (start >= edit.end) mappedStart = start + delta;
      else continue;
      const mappedEnd = mappedStart + (end - start);
      if (mappedStart < 0 || mappedEnd > newText.length) continue;
      const name = String((raw && raw.name) || oldText.slice(start, end));
      if (name && newText.slice(mappedStart, mappedEnd) !== name) continue;
      // 식별자 바로 옆에 식별자 문자가 붙으면 이전 이름의 일부만 흐려지는 오표시가 되므로 버린다.
      if (name && (isIdentifierChar(newText[mappedStart - 1]) || isIdentifierChar(newText[mappedEnd]))) continue;
      next.push({ ...raw, start:mappedStart, end:mappedEnd, name });
    }
    return next;
  }

  function editorHistoryCaretState(state, value, selectionStart, selectionEnd) {
    if (!state || state.value !== String(value || "")) return state;
    const length = state.value.length;
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || start, length));
    return { ...state, s:start, e:end };
  }

  function applyLinkedIdentifierEdit(value, ranges, primaryIndex, editStart, editEnd, inserted) {
    const text = String(value || ""), rows = Array.isArray(ranges) ? ranges : [];
    const primary = rows[primaryIndex];
    if (!primary || editStart < primary.start || editEnd > primary.end || editStart > editEnd) return null;
    const relStart = editStart - primary.start, relEnd = editEnd - primary.start;
    const replacement = String(inserted || "");
    let next = text;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row || row.start < 0 || row.end < row.start || row.end > text.length) return null;
      next = next.slice(0, row.start + relStart) + replacement + next.slice(row.start + relEnd);
    }
    const delta = replacement.length - (relEnd - relStart);
    const nextRanges = rows.map((row, index) => ({
      start: row.start + index * delta,
      end: row.end + (index + 1) * delta
    }));
    return { value: next, ranges: nextRanges, primaryIndex, relStart, relEnd, inserted: replacement };
  }

  function pythonLineOpensBlock(value) {
    const line = String(value || "");
    let quote = "", escaped = false, codeEnd = line.length;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === "\"" || char === "'") quote = char;
      else if (char === "#") { codeEnd = i; break; }
    }
    return /:\s*$/.test(line.slice(0, codeEnd));
  }

  // 경량 재들여쓰기(오프라인·구문 파서 없이 보수적으로 동작).
  //  1) 줄 앞 탭 → Python 해석과 같은 8칸 탭 스톱 기준 스페이스
  //  2) 블록·괄호·역슬래시 연속이 아닌데 갑자기 깊어진 명백한 unexpected indent만 현재 블록 깊이로 복원
  //  3) 줄 끝 공백 제거
  //  4) 빈 줄 3개 이상 → 2개로, 파일 끝 빈 줄 정리(마지막 개행 1개 보장)
  // 삼중따옴표 문자열 안(내용)은 절대 건드리지 않도록 문자열/주석 상태를 문자 단위로 추적한다.
  // 정상 블록의 들여쓰기 폭을 통일하거나 애매한 잘못된 dedent를 추측하지는 않는다.
  function lightReindentPython(source) {
    const text = String(source == null ? "" : source);
    if (!text.trim()) return "";
    const lines = text.split("\n");
    const startInTriple = new Array(lines.length);   // 각 줄 시작이 삼중따옴표 문자열 안인가
    const endInTriple = new Array(lines.length);      // 각 줄 끝(개행 직전)이 삼중따옴표 문자열 안인가
    let inTriple = false, tripleQuote = "";
    for (let li = 0; li < lines.length; li++) {
      startInTriple[li] = inTriple;
      const line = lines[li];
      let quote = "", escaped = false;                // 한 줄짜리 문자열은 물리 줄을 넘지 않는다(보수적)
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inTriple) {
          if (ch === "\\") { i++; continue; }          // 이스케이프: 다음 문자 무시(닫는 따옴표 오판 방지)
          if (ch === tripleQuote && line[i + 1] === tripleQuote && line[i + 2] === tripleQuote) {
            inTriple = false; tripleQuote = ""; i += 2;
          }
          continue;
        }
        if (quote) {
          if (escaped) { escaped = false; continue; }
          if (ch === "\\") { escaped = true; continue; }
          if (ch === quote) quote = "";
          continue;
        }
        if (ch === "#") break;                          // 나머지는 주석
        if (ch === "'" || ch === '"') {
          if (line[i + 1] === ch && line[i + 2] === ch) { inTriple = true; tripleQuote = ch; i += 2; }
          else quote = ch;
        }
      }
      endInTriple[li] = inTriple;
    }
    const blankCode = new Array(lines.length);
    const cleaned = lines.map((line, li) => {
      if (!startInTriple[li]) {                         // 줄 앞이 코드일 때만 Python 탭 스톱대로 확장
        const lead = (line.match(/^[ \t]*/) || [""])[0];
        if (lead.indexOf("\t") >= 0) {
          let expanded = "";
          for (const c of lead) {
            if (c === "\t") expanded += " ".repeat(8 - (expanded.length % 8));
            else expanded += " ";
          }
          line = expanded + line.slice(lead.length);
        }
      }
      if (!endInTriple[li]) line = line.replace(/[ \t]+$/, "");   // 줄 끝이 코드일 때만 후행 공백 제거
      const terminalSentinel = li === lines.length - 1 && line === "" && text.endsWith("\n");
      blankCode[li] = terminalSentinel || (line.trim() === "" && !startInTriple[li]);
      // split("\n")이 만든 마지막 빈 항목은 실제 문자열 내용이 아니다. 그 외 삼중문자열 안 빈 줄은 보존한다.
      return line;
    });

    // 문자열·주석을 제외한 괄호 깊이와 물리 줄 끝의 명시적 연속(\)만 추적한다.
    // 삼중문자열을 여는 줄은 그 지점부터 보수적으로 스캔을 멈추며, 문자열 내부 줄은 호출하지 않는다.
    const scanStructure = (line, initialDepth) => {
      let quote = "", escaped = false, depth = initialDepth, hasCode = false, lastCode = "", unbalanced = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          if (escaped) { escaped = false; continue; }
          if (ch === "\\") { escaped = true; continue; }
          if (ch === quote) quote = "";
          continue;
        }
        if (ch === "#") break;
        if (ch === "'" || ch === '"') {
          hasCode = true; lastCode = "string";
          if (line[i + 1] === ch && line[i + 2] === ch) break;
          quote = ch; continue;
        }
        if (/\s/.test(ch)) continue;
        hasCode = true; lastCode = ch;
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") {
          if (depth > 0) depth--;
          else unbalanced = true;
        }
      }
      return { depth, hasCode, lastCode, explicitContinuation:lastCode === "\\", unbalanced };
    };

    // Python은 블록을 연 논리 줄 다음에서만 새 들여쓰기 깊이를 허용한다. 현재 블록보다 깊지만
    // 앞 논리 줄이 ':'로 끝나지 않은 경우만 되돌리므로, 화면 예시의 최상위 오들여쓰기는 고치되
    // 함수 인수·자료구조·역슬래시 연속 줄은 그대로 둔다.
    const indentStack = [0];
    let pendingBlock = false, bracketDepth = 0, explicitContinuation = false, repairSafe = true;
    for (let li = 0; li < cleaned.length; li++) {
      if (startInTriple[li]) { explicitContinuation = false; continue; }
      let line = cleaned[li];
      const continuationAtStart = bracketDepth > 0 || explicitContinuation;
      const scan = scanStructure(line, bracketDepth);
      const logicalContinues = scan.depth > 0 || scan.explicitContinuation;

      if (!continuationAtStart && scan.hasCode) {
        const lead = (line.match(/^ */) || [""])[0].length;   // 탭은 위에서 이미 Python 열 기준으로 확장됨
        let poppedIndent = false;
        while (indentStack.length > 1 && lead < indentStack[indentStack.length - 1]) {
          indentStack.pop(); poppedIndent = true;
        }
        const currentIndent = indentStack[indentStack.length - 1];
        if (lead < currentIndent || (poppedIndent && lead !== currentIndent)) {
          repairSafe = false;                                // 일치하지 않는 dedent는 의미를 추측하지 않는다
        } else if (pendingBlock) {
          if (lead > currentIndent) indentStack.push(lead);
          else repairSafe = false;                           // 블록 본문이 빠진 별도 문법 오류
          pendingBlock = false;
        } else if (repairSafe && lead > currentIndent) {
          line = " ".repeat(currentIndent) + line.slice(lead);
          cleaned[li] = line;
        }
      }

      if (scan.unbalanced) repairSafe = false;
      bracketDepth = scan.depth;
      explicitContinuation = scan.explicitContinuation;
      if (scan.hasCode && !logicalContinues) pendingBlock = scan.lastCode === ":";
    }

    const out = [], outBlankCode = [];
    let run = 0;                                        // 연속 빈(코드) 줄 수
    for (let li = 0; li < cleaned.length; li++) {
      if (blankCode[li]) {
        run++;
        if (run <= 2) { out.push(cleaned[li]); outBlankCode.push(true); }
      } else {
        run = 0; out.push(cleaned[li]); outBlankCode.push(false);
      }
    }
    // 파일 끝의 코드 빈 줄만 제거한다. 닫히지 않은 삼중문자열 안 공백 줄은 편집 중인 실제 내용이다.
    while (out.length && outBlankCode[outBlankCode.length - 1]) { out.pop(); outBlankCode.pop(); }
    return out.length ? out.join("\n") + "\n" : "";
  }

  function pythonOpenClosePlan(value, selectionStart, selectionEnd) {
    const text = String(value || "");
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || start, text.length));
    if (start !== end) return null;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = text.indexOf("\n", start);
    if (lineEnd < 0) lineEnd = text.length;
    if (start !== lineEnd) return null;
    const line = text.slice(lineStart, lineEnd);
    const match = line.match(/^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*open\s*\(.*\)\s*(?:#.*)?$/);
    if (!match || /^\s*with\s+open\b/.test(line)) return null;
    const indent = match[1].replace(/\t/g, "    "), variable = match[2];
    const following = text.slice(lineEnd + (text[lineEnd] === "\n" ? 1 : 0));
    const closePattern = new RegExp("^" + indent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + variable + "\\.close\\(\\)\\s*$", "m");
    if (closePattern.test(following.slice(0, 500))) return null;
    const inserted = "\n" + indent + "\n" + indent + variable + ".close()";
    return { inserted, caret: start + 1 + indent.length, variable };
  }

  function parsePythonTracebackLocations(stderr, preferredFile, knownFiles=[]) {
    const text = String(stderr || "");
    const preferred = String(preferredFile || "").replace(/\\/g, "/").split("/").pop();
    const known = new Set((knownFiles || []).map((name) => String(name || "").replace(/\\/g, "/").split("/").pop()).filter(Boolean));
    if (preferred) known.add(preferred);
    const pseudo = new Set(["<exec>", "<string>", "<stdin>", "<notebook-cell>", "<셀>", "script.py"]);
    const frames = [];
    const re = /File "([^"]*)", line (\d+)/g;
    let match;
    while ((match = re.exec(text))) {
      const path = match[1].replace(/\\/g, "/");
      const file = path.split("/").pop() || path;
      frames.push({ path, file, line: parseInt(match[2], 10) || 0 });
    }
    return frames.map((frame) => ({
      ...frame,
      // A notebook cell has a virtual filename.  A normal file is current only
      // when it is the file the user started, not merely another project file.
      current: pseudo.has(frame.path) || pseudo.has(frame.file) || (known.has(frame.file) && (!preferred || frame.file === preferred))
    }));
  }

  function parsePythonTracebackLocation(stderr, preferredFile, knownFiles=[]) {
    const frames = parsePythonTracebackLocations(stderr, preferredFile, knownFiles);
    return frames.length ? frames[frames.length - 1] : null;
  }

  function completionReplacementRange(value, selectionStart, selectionEnd, completionStart, completionEnd, item) {
    const text = String(value || "");
    const fallbackStart = Math.max(0, Math.min(Number(completionStart) || 0, text.length));
    const fallbackEnd = Math.max(fallbackStart, Math.min(Number(completionEnd) || fallbackStart, text.length));
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || 0, text.length));
    if (start === end) {
      const match = text.slice(0, start).match(/[A-Za-z_][A-Za-z0-9_]*$/);
      const prefix = match ? match[0] : "";
      if (prefix && String(item || "").startsWith(prefix)) {
        return { start: start - prefix.length, end };
      }
    }
    return { start: fallbackStart, end: fallbackEnd };
  }

  function completionInsertionPlan(value, range, item) {
    const text = String(value || "");
    const safeRange = range && typeof range === "object" ? range : {};
    const start = Math.max(0, Math.min(Number(safeRange.start) || 0, text.length));
    const end = Math.max(start, Math.min(Number(safeRange.end) || start, text.length));
    const info = item && typeof item === "object"
      ? item
      : { name: String(item || ""), type: "" };
    const name = String(info.name || "");
    // import 줄에서는 함수형 후보라도 이름만 넣는다 — from math import sqrt() 는 문법 오류다.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const importLine = /^\s*(?:from|import)\b/.test(text.slice(lineStart, start));
    const callable = String(info.type || "").toLowerCase() === "function" && !importLine;
    const hasOpenParenthesis = callable && text.charAt(end) === "(";
    return {
      text: name + (callable && !hasOpenParenthesis ? "()" : ""),
      caret: start + name.length + (callable ? 1 : 0)
    };
  }

  function closingBracketTabPlan(value, selectionStart, selectionEnd) {
    const text = String(value || "");
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || 0, text.length));
    if (start !== end || ![")", "]", "}"].includes(text.charAt(start))) return null;
    return { caret:start + 1 };
  }

  function lineNumberAtOffset(value, offset) {
    const text = String(value || "");
    const end = Math.max(0, Math.min(Number(offset) || 0, text.length));
    let line = 1;
    for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  }

  function lineStartOffset(value, lineNumber) {
    const text = String(value || "");
    const target = Math.max(1, Math.floor(Number(lineNumber) || 1));
    if (target <= 1) return 0;
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) !== 10) continue;
      line++;
      if (line === target) return i + 1;
    }
    return text.length;
  }

  function findPythonLocalDefinition(value, name, referenceOffset, kinds) {
    const text = String(value || "");
    const word = String(name || "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) return null;
    const allowed = new Set((Array.isArray(kinds) && kinds.length ? kinds : ["def", "class"])
      .map((kind) => String(kind || "").toLowerCase()).filter((kind) => kind === "def" || kind === "class"));
    if (!allowed.size) return null;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const kindPart = [...allowed].join("|");
    const re = new RegExp("(^|\\n)([ \\t]*)(" + kindPart + ")\\s+" + escaped + "\\s*(?=\\(|:)", "g");
    const ref = Math.max(0, Math.min(Number(referenceOffset) || 0, text.length));
    const matches = [];
    let match;
    while ((match = re.exec(text))) {
      const start = match.index + (match[1] === "\n" ? 1 : 0);
      matches.push({ line: lineNumberAtOffset(text, start), kind: match[3], offset: start });
      if (match[0] === "") re.lastIndex++;
    }
    if (!matches.length) return null;
    let best = null;
    for (const item of matches) {
      if (item.offset <= ref && (!best || item.offset > best.offset)) best = item;
    }
    return best || matches[0];
  }

  // from package.module import name 형태에서, 현재 작업공간에 함께 열린 로컬 모듈 파일을 찾는다.
  // 브라우저 파일 API는 실제 절대경로를 주지 않으므로, 작업공간 상대경로의 끝부분을 기준으로 매칭한다.
  function resolvePythonImportedDefinition(source, name, currentPath, availablePaths) {
    const word = String(name || "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) return null;
    const normalize = (value) => normalizeWorkspacePath(value).replace(/\/+$/, "");
    const dirname = (value) => { const i = value.lastIndexOf("/"); return i >= 0 ? value.slice(0, i) : ""; };
    const paths = [...new Set((availablePaths || []).map(normalize).filter(path => /\.(?:py|pyw|pyi)$/i.test(path)))];
    const current = normalize(currentPath);
    const commonPrefix = (a, b) => {
      const aa = String(a || "").split("/").filter(Boolean), bb = String(b || "").split("/").filter(Boolean);
      let n = 0; while (n < aa.length && n < bb.length && aa[n] === bb[n]) n++;
      return n;
    };
    const findModule = (rawModule) => {
      const dots = /^(\.+)(.*)$/.exec(rawModule);
      const moduleName = String(dots ? dots[2] : rawModule).replace(/^\.+|\.+$/g, "");
      if (!moduleName) return null;
      const rel = moduleName.replace(/\./g, "/");
      const wants = [rel + ".py", rel + "/__init__.py"];
      if (dots){
        const base = dirname(current).split("/").filter(Boolean);
        const ascend = Math.max(0, dots[1].length - 1);
        base.splice(Math.max(0, base.length - ascend));
        const prefix = base.join("/");
        for (const want of wants){
          const exact = normalize(prefix ? prefix + "/" + want : want);
          const hit = paths.find(path => path === exact);
          if (hit) return hit;
        }
      }
      const candidates = paths.filter(path => wants.some(want => path === want || path.endsWith("/" + want)));
      if (!candidates.length) return null;
      candidates.sort((a, b) => commonPrefix(dirname(b), dirname(current)) - commonPrefix(dirname(a), dirname(current)) || a.localeCompare(b));
      return candidates[0];
    };
    const re = /^\s*from\s+([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+([^\n#]+)/gm;
    let match;
    while ((match = re.exec(String(source || "")))) {
      const modulePath = findModule(match[1]);
      if (!modulePath) continue;
      for (const part of match[2].replace(/[()]/g, "").split(",")) {
        const item = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part);
        if (item && (item[2] || item[1]) === word) return { path:modulePath, importedName:item[1] };
      }
    }
    return null;
  }

  function transformEditorLines(value, selectionStart, selectionEnd, action) {
    const text = String(value || "");
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || 0, text.length));
    const lines = text.split("\n");
    const lineAt = (offset) => {
      let line = 0;
      for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
      return line;
    };
    const lineOffset = (items, line) => {
      let offset = 0;
      for (let i = 0; i < line; i++) offset += items[i].length + 1;
      return offset;
    };

    const first = Math.min(lineAt(start), lines.length - 1);
    const rawLast = Math.min(lineAt(end), lines.length - 1);
    const last = end > start && text[end - 1] === "\n" ? Math.max(first, rawLast - 1) : rawLast;
    const count = last - first + 1;

    if (action === "indent" || action === "outdent") {
      const originalLines = lines.slice();
      const removed = new Map();
      for (let i = first; i <= last; i++) {
        if (action === "indent") lines[i] = "    " + lines[i];
        else {
          const match = lines[i].match(/^(?: {1,4}|\t)/);
          const countToRemove = match ? match[0].length : 0;
          if (countToRemove) lines[i] = lines[i].slice(countToRemove);
          removed.set(i, countToRemove);
        }
      }
      const mapPosition = (originalOffset) => {
        const line = Math.min(lineAt(originalOffset), lines.length - 1);
        let column = originalOffset - lineOffset(originalLines, line);
        if (line >= first && line <= last) {
          if (action === "indent") column += 4;
          else column = Math.max(0, column - (removed.get(line) || 0));
        }
        return lineOffset(lines, line) + Math.min(column, lines[line].length);
      };
      return { value: lines.join("\n"), selectionStart: mapPosition(start), selectionEnd: mapPosition(end) };
    }

    if (action === "toggle-comment") {
      const edits = new Map();
      const nonBlank = [];
      for (let i = first; i <= last; i++) if (lines[i].trim()) nonBlank.push(i);
      const uncomment = nonBlank.length > 0 && nonBlank.every((i) => /^[ \t]*#/.test(lines[i]));
      for (let i = first; i <= last; i++) {
        const line = lines[i];
        if (!line.trim() && (first !== last || uncomment)) continue;
        const indent = (line.match(/^[ \t]*/) || [""])[0].length;
        if (uncomment) {
          const match = line.slice(indent).match(/^# ?/);
          if (!match) continue;
          lines[i] = line.slice(0, indent) + line.slice(indent + match[0].length);
          edits.set(i, { column: indent, removed: match[0].length, added: 0 });
        } else {
          lines[i] = line.slice(0, indent) + "# " + line.slice(indent);
          edits.set(i, { column: indent, removed: 0, added: 2 });
        }
      }
      const mapPosition = (originalOffset) => {
        const line = Math.min(lineAt(originalOffset), lines.length - 1);
        const originalLines = text.split("\n");
        let column = originalOffset - lineOffset(originalLines, line);
        const edit = edits.get(line);
        if (edit && column >= edit.column) {
          if (column <= edit.column + edit.removed) column = edit.column + edit.added;
          else column += edit.added - edit.removed;
        }
        return lineOffset(lines, line) + Math.min(column, lines[line].length);
      };
      return { value: lines.join("\n"), selectionStart: mapPosition(start), selectionEnd: mapPosition(end) };
    }

    if (action === "delete") {
      const column = start - lineOffset(lines, first);
      lines.splice(first, count);
      if (!lines.length) lines.push("");
      const targetLine = Math.min(first, lines.length - 1);
      const caret = lineOffset(lines, targetLine) + Math.min(column, lines[targetLine].length);
      return { value: lines.join("\n"), selectionStart: caret, selectionEnd: caret };
    }

    if (action === "dedupe") {
      // Compare only the selected lines. Exact matches keep code/config formatting safe.
      const seen = new Set();
      const kept = [];
      for (let i = first; i <= last; i++) {
        if (seen.has(lines[i])) continue;
        seen.add(lines[i]);
        kept.push(lines[i]);
      }
      if (kept.length === count) return { value: text, selectionStart: start, selectionEnd: end };
      const originalLines = text.split("\n");
      const startColumn = start - lineOffset(originalLines, first);
      const endColumn = end - lineOffset(originalLines, last);
      lines.splice(first, count, ...kept);
      const endLine = first + kept.length - 1;
      return {
        value: lines.join("\n"),
        selectionStart: lineOffset(lines, first) + Math.min(startColumn, lines[first].length),
        selectionEnd: lineOffset(lines, endLine) + Math.min(endColumn, lines[endLine].length)
      };
    }

    if (action === "move-up") {
      if (first === 0) return { value: text, selectionStart: start, selectionEnd: end };
      const delta = -(lines[first - 1].length + 1);
      const block = lines.splice(first, count);
      lines.splice(first - 1, 0, ...block);
      return { value: lines.join("\n"), selectionStart: start + delta, selectionEnd: end + delta };
    }

    if (action === "move-down") {
      if (last >= lines.length - 1) return { value: text, selectionStart: start, selectionEnd: end };
      const delta = lines[last + 1].length + 1;
      const block = lines.splice(first, count);
      lines.splice(first + 1, 0, ...block);
      return { value: lines.join("\n"), selectionStart: start + delta, selectionEnd: end + delta };
    }

    if (action === "duplicate-down") {
      const block = lines.slice(first, last + 1);
      const delta = block.reduce((sum, line) => sum + line.length + 1, 0);
      lines.splice(last + 1, 0, ...block);
      return { value: lines.join("\n"), selectionStart: start + delta, selectionEnd: end + delta };
    }

    return { value: text, selectionStart: start, selectionEnd: end };
  }

  // 선택 영역만 대문자/소문자로 바꾼다. 편집기는 반환된 replacement를 setRangeText로
  // 적용해 네이티브 선택과 자체 Undo 이력을 모두 유지한다.
  function transformSelectedTextCase(value, selectionStart, selectionEnd, mode) {
    const text = String(value == null ? "" : value);
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || 0, text.length));
    if (start === end || (mode !== "upper" && mode !== "lower")) {
      return { value:text, replacement:"", selectionStart:start, selectionEnd:end, changed:false };
    }
    const selected = text.slice(start, end);
    const replacement = mode === "upper" ? selected.toUpperCase() : selected.toLowerCase();
    return {
      value:text.slice(0, start) + replacement + text.slice(end),
      replacement,
      selectionStart:start,
      selectionEnd:start + replacement.length,
      changed:replacement !== selected
    };
  }

  function inlineMarkdown(text, allowHtml) {
    const code = [];
    let out = String(text).replace(/`([^`]+)`/g, (_, value) => {
      code.push(`<code>${escapeHtml(value)}</code>`);
      return `\u0000${code.length - 1}\u0000`;
    });
    if (!allowHtml) out = escapeHtml(out);   // allowHtml 이면 날 HTML 을 통과시키고, 상위 markdownToHtml 이 sanitizeHtml 로 살균한다
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const href = safeLink(url);
      if (!href) return label;
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/_([^_]+)_/g, "<em>$1</em>");
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => code[Number(i)] || "");
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  // ── 안전한 HTML 살균(마크다운 셀에서 날 HTML 을 렌더할 때 사용) ───────────────
  // 마크다운 변환기가 만들어내는 태그 + 사용자가 직접 쓸 수 있는 안전한 서식 태그만 허용한다.
  const MD_ALLOWED_TAGS = new Set([
    "p","br","h1","h2","h3","h4","h5","h6","strong","em","code","pre","ul","ol","li",
    "blockquote","hr","table","thead","tbody","tr","th","td","a",
    "span","div","font","b","i","u","s","strike","del","ins","mark","small","sub","sup",
    "kbd","samp","abbr","big","tt","center","caption","colgroup","col","dl","dt","dd","img"
  ]);
  // 내용까지 통째로 제거하는 위험 태그(스크립트·삽입·폼 등).
  const MD_DANGER_TAGS = new Set([
    "script","style","iframe","object","embed","template","noscript","svg","math","form",
    "input","button","textarea","select","option","link","meta","base","title","frame","frameset","applet"
  ]);
  const MD_GLOBAL_ATTR = new Set(["class","id","title","align","dir","lang","style","valign","width","height"]);
  const MD_TAG_ATTR = {
    a:new Set(["href","target","rel"]), img:new Set(["src","alt"]), font:new Set(["color","face","size"]),
    td:new Set(["colspan","rowspan"]), th:new Set(["colspan","rowspan"]), ol:new Set(["start","type"]),
    col:new Set(["span"]), colgroup:new Set(["span"])
  };

  function htmlTagAllowed(tag){ return MD_ALLOWED_TAGS.has(String(tag || "").toLowerCase()); }
  function htmlAttrAllowed(tag, name){
    const n = String(name || "").toLowerCase();
    if (/^on/.test(n)) return false;                       // 이벤트 핸들러(onclick 등)는 항상 금지
    if (MD_GLOBAL_ATTR.has(n)) return true;
    const t = MD_TAG_ATTR[String(tag || "").toLowerCase()];
    return !!(t && t.has(n));
  }
  // href/src 값: http(s)·mailto·앵커·상대경로만 허용. javascript:/vbscript:/data:text 등은 거부(img 는 data:image 일부 허용).
  function htmlSanitizeUrl(value, opts){
    const v = String(value == null ? "" : value).trim();
    if (!v) return "";
    if (/^(https?:)?\/\//i.test(v) || /^mailto:/i.test(v)) return v;
    if (opts && opts.image && /^data:image\/(png|jpe?g|gif|webp);/i.test(v)) return v;
    if (/^[#./]/.test(v)) return v;                        // #앵커, ./ ../ / 상대경로
    const scheme = v.split(/[/?#]/)[0];
    if (!/:/.test(scheme)) return v;                       // 스킴 없는 상대경로(file.png 등)
    return "";
  }
  // style 값: 위험 패턴(expression·javascript:·url(·@import 등)이 있으면 통째로 버린다.
  function htmlSanitizeStyle(value){
    const v = String(value == null ? "" : value);
    if (/expression\s*\(|javascript:|vbscript:|@import|url\s*\(|behavior\s*:|<|>/i.test(v)) return "";
    return v.trim();
  }

  // 임의 HTML 문자열을 화이트리스트 기준으로 살균한다. DOM 이 없는 환경(노드 등)에서는 안전하게 이스케이프로 폴백.
  function sanitizeHtml(html){
    const input = String(html == null ? "" : html);
    if (typeof DOMParser === "undefined") return escapeHtml(input);
    let doc;
    try { doc = new DOMParser().parseFromString('<body><div id="__md_root">' + input + "</div></body>", "text/html"); }
    catch(_){ return escapeHtml(input); }
    const root = (doc && (doc.getElementById("__md_root") || doc.body)) || null;
    if (!root) return escapeHtml(input);
    const clean = (node) => {
      for (const child of Array.from(node.childNodes)){
        if (child.nodeType === 8){ child.remove(); continue; }   // 주석 제거
        if (child.nodeType !== 1) continue;                       // 텍스트 노드 등은 보존
        const tag = child.tagName.toLowerCase();
        if (MD_DANGER_TAGS.has(tag)){ child.remove(); continue; } // 위험 태그는 내용까지 삭제
        if (!MD_ALLOWED_TAGS.has(tag)){                           // 허용 외 태그는 벗겨내고 자식만 살림
          clean(child);
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          child.remove();
          continue;
        }
        for (const attr of Array.from(child.attributes)){
          const name = attr.name.toLowerCase();
          if (!htmlAttrAllowed(tag, name)){ child.removeAttribute(attr.name); continue; }
          if (name === "href"){ const s = htmlSanitizeUrl(attr.value); s ? child.setAttribute("href", s) : child.removeAttribute("href"); }
          else if (name === "src"){ const s = htmlSanitizeUrl(attr.value, { image:true }); s ? child.setAttribute("src", s) : child.removeAttribute("src"); }
          else if (name === "style"){ const s = htmlSanitizeStyle(attr.value); s ? child.setAttribute("style", s) : child.removeAttribute("style"); }
        }
        if (tag === "a" && child.getAttribute("href")){ child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); }
        clean(child);
      }
    };
    clean(root);
    return root.innerHTML;
  }

  // markdown → HTML. options.allowHtml 이면 날 HTML 을 허용하되 sanitizeHtml 로 살균한다(노트북 마크다운 셀용).
  // ── LaTeX 수식 → MathML ─────────────────────────────────────────────────────
  // 마크다운 셀의 $...$ / $$...$$ 수식을 MathML 로 그린다. 별도 폰트·라이브러리 없이
  // 최신 브라우저(Chromium 109+, Firefox, Safari)의 내장 MathML 로 렌더한다.
  // 학습용으로 흔히 쓰는 구성(위/아래 첨자, 분수, 근호, 그리스 문자, 합·적분, 흔한 기호)을 지원하고
  // 해석에 실패하면 원본 LaTeX 를 그대로 보여 준다(절대 깨지지 않게).
  const TEX_SYMBOLS = {
    // 그리스 소문자
    alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",varepsilon:"ε",zeta:"ζ",eta:"η",
    theta:"θ",vartheta:"ϑ",iota:"ι",kappa:"κ",lambda:"λ",mu:"μ",nu:"ν",xi:"ξ",pi:"π",varpi:"ϖ",
    rho:"ρ",varrho:"ϱ",sigma:"σ",varsigma:"ς",tau:"τ",upsilon:"υ",phi:"φ",varphi:"ϕ",chi:"χ",psi:"ψ",omega:"ω",
    // 그리스 대문자
    Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Xi:"Ξ",Pi:"Π",Sigma:"Σ",Upsilon:"Υ",Phi:"Φ",Psi:"Ψ",Omega:"Ω",
    // 흔한 기호
    infty:"∞",partial:"∂",nabla:"∇",forall:"∀",exists:"∃",neg:"¬",emptyset:"∅",varnothing:"∅",
    angle:"∠",prime:"′",ell:"ℓ",Re:"ℜ",Im:"ℑ",aleph:"ℵ",hbar:"ℏ",deg:"°","%":"%","#":"#","$":"$","_":"_","&":"&"
  };
  const TEX_OPS = {
    times:"×",div:"÷",cdot:"⋅",ast:"∗",star:"⋆",circ:"∘",bullet:"∙",pm:"±",mp:"∓",
    leq:"≤",le:"≤",geq:"≥",ge:"≥",neq:"≠",ne:"≠",equiv:"≡",approx:"≈",cong:"≅",sim:"∼",simeq:"≃",propto:"∝",
    ll:"≪",gg:"≫",to:"→",rightarrow:"→",gets:"←",leftarrow:"←",leftrightarrow:"↔",
    Rightarrow:"⇒",Leftarrow:"⇐",Leftrightarrow:"⇔",mapsto:"↦",uparrow:"↑",downarrow:"↓",
    in:"∈",notin:"∉",ni:"∋",subset:"⊂",subseteq:"⊆",supset:"⊃",supseteq:"⊇",cup:"∪",cap:"∩",
    setminus:"∖",perp:"⊥",parallel:"∥",mid:"∣",wedge:"∧",land:"∧",vee:"∨",lor:"∨",oplus:"⊕",otimes:"⊗",
    cdots:"⋯",ldots:"…",dots:"…",vdots:"⋮",ddots:"⋱",
    langle:"⟨",rangle:"⟩",lfloor:"⌊",rfloor:"⌋",lceil:"⌈",rceil:"⌉",backslash:"∖",
    lbrace:"{",rbrace:"}","{":"{","}":"}","|":"‖",Vert:"‖",vert:"|",
    quad:" ",qquad:"  "
  };
  // 위/아래 첨자를 아래/위로 붙이는 큰 연산자(디스플레이 수식에서 munder/mover 사용)
  const TEX_BIGOPS = { sum:"∑",prod:"∏",coprod:"∐",bigcup:"⋃",bigcap:"⋂",bigoplus:"⨁",bigotimes:"⨂",lim:"lim",limsup:"lim sup",liminf:"lim inf",max:"max",min:"min",sup:"sup",inf:"inf",gcd:"gcd" };
  // 위/아래 첨자를 옆에 붙이는 연산자(적분 등)
  const TEX_INTOPS = { int:"∫",iint:"∬",iiint:"∭",oint:"∮" };
  // 이름을 그대로 세워서(정체) 쓰는 함수
  const TEX_FUNCS = new Set(["sin","cos","tan","cot","sec","csc","sinh","cosh","tanh","arcsin","arccos","arctan","log","ln","exp","det","dim","ker","deg","arg","hom"]);
  const TEX_ACCENTS = { hat:"^",widehat:"^",tilde:"~",widetilde:"~",bar:"¯",overline:"¯",vec:"→",dot:"˙",ddot:"¨",check:"ˇ",breve:"˘",acute:"´",grave:"`" };
  const TEX_VARIANTS = { mathbf:"bold",boldsymbol:"bold",mathbb:"double-struck",mathcal:"script",mathscr:"script",mathfrak:"fraktur",mathrm:"normal",mathsf:"sans-serif",mathtt:"monospace",mathit:"italic" };

  function texMo(ch){ return "<mo>" + escapeHtml(ch) + "</mo>"; }
  function texTokenize(s){
    const toks = []; let i = 0;
    while (i < s.length){
      const c = s[i];
      const prev = i > 0 ? s[i - 1] : "";
      if (c === "'" && (i === 0 || /\s/.test(prev) || "=+-*/,:;([{ ".includes(prev))){
        let j = i + 1, value = "";
        while (j < s.length && s[j] !== "'"){
          if (s[j] === "\\" && s[j + 1] === "'"){ value += "'"; j += 2; }
          else value += s[j++];
        }
        if (value && s[j] === "'"){ toks.push({ t:"text", v:value }); i = j + 1; }
        else { toks.push({ t:"char", v:c }); i++; }
      } else if (c === "\\"){
        if (/[a-zA-Z]/.test(s[i + 1] || "")){
          let j = i + 1; while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
          toks.push({ t:"cmd", v:s.slice(i + 1, j) }); i = j;
        } else { toks.push({ t:"cmd", v:s[i + 1] || "" }); i += 2; }
      } else if (c === "{"){ toks.push({ t:"{" }); i++; }
      else if (c === "}"){ toks.push({ t:"}" }); i++; }
      else if (c === "^"){ toks.push({ t:"^" }); i++; }
      else if (c === "_"){ toks.push({ t:"_" }); i++; }
      else if (c === " " || c === "\t" || c === "\n"){ toks.push({ t:"sp", n:c === "\t" ? 4 : 1 }); i++; }
      else if (c === "&"){ i++; }
      else { toks.push({ t:"char", v:c }); i++; }
    }
    return toks;
  }
  // 필수 인자 하나(그룹 {…} 또는 원자 하나)를 MathML 문자열로 읽는다.
  function texArg(st){
    while (st.toks[st.pos] && st.toks[st.pos].t === "sp") st.pos++;
    const tk = st.toks[st.pos];
    if (!tk) return "<mrow></mrow>";
    if (tk.t === "{"){
      st.pos++;
      const nodes = texNodes(st, true);
      if (st.toks[st.pos] && st.toks[st.pos].t === "}") st.pos++;
      return "<mrow>" + nodes.join("") + "</mrow>";
    }
    const atom = texAtom(st);
    return atom ? atom.mml : "<mrow></mrow>";
  }
  // \text{…} 처럼 그룹 안 내용을 그대로 글자 문자열로 읽는다.
  function texRawGroup(st){
    let out = "";
    if (st.toks[st.pos] && st.toks[st.pos].t === "{"){
      st.pos++;
      while (st.pos < st.toks.length && st.toks[st.pos].t !== "}"){
        const tk = st.toks[st.pos++];
        out += tk.t === "char" ? tk.v : (tk.t === "cmd" ? tk.v : " ");
      }
      if (st.toks[st.pos] && st.toks[st.pos].t === "}") st.pos++;
    } else if (st.toks[st.pos]){
      const tk = st.toks[st.pos++]; out = tk.v || "";
    }
    return out;
  }
  function texScripts(st, base, big){
    let sub = null, sup = null;
    while (st.pos < st.toks.length && (st.toks[st.pos].t === "_" || st.toks[st.pos].t === "^")){
      const kind = st.toks[st.pos].t; st.pos++;
      const arg = texArg(st);
      if (kind === "_") sub = arg; else sup = arg;
    }
    if (sub == null && sup == null) return base;
    if (big && st.display){
      if (sub != null && sup != null) return "<munderover>" + base + sub + sup + "</munderover>";
      if (sub != null) return "<munder>" + base + sub + "</munder>";
      return "<mover>" + base + sup + "</mover>";
    }
    if (sub != null && sup != null) return "<msubsup>" + base + sub + sup + "</msubsup>";
    if (sub != null) return "<msub>" + base + sub + "</msub>";
    return "<msup>" + base + sup + "</msup>";
  }
  // 원자 하나를 파싱해 { mml, big } 를 돌려준다(big=위아래 첨자를 붙이는 큰 연산자 여부).
  function texAtom(st){
    while (st.toks[st.pos] && st.toks[st.pos].t === "sp") st.pos++;
    const tk = st.toks[st.pos];
    if (!tk) return null;
    if (tk.t === "}"){ st.pos++; return null; }
    if (tk.t === "{"){ return { mml:texArg(st), big:false }; }
    if (tk.t === "text"){
      st.pos++;
      return { mml:"<mtext>" + escapeHtml(tk.v) + "</mtext>", big:false };
    }
    if (tk.t === "char"){
      const c = tk.v;
      if (/[0-9.]/.test(c)){
        let num = ""; while (st.toks[st.pos] && st.toks[st.pos].t === "char" && /[0-9.]/.test(st.toks[st.pos].v)) num += st.toks[st.pos++].v;
        return { mml:"<mn>" + escapeHtml(num) + "</mn>", big:false };
      }
      st.pos++;
      if (/[a-zA-Z]/.test(c)) return { mml:"<mi>" + escapeHtml(c) + "</mi>", big:false };
      if (c === "'"){ let p = "′"; while (st.toks[st.pos] && st.toks[st.pos].t === "char" && st.toks[st.pos].v === "'"){ p += "′"; st.pos++; } return { mml:texMo(p), big:false }; }
      return { mml:texMo(c), big:false };
    }
    // cmd
    st.pos++;
    const name = tk.v;
    if (name === "frac" || name === "dfrac" || name === "tfrac"){
      const a = texArg(st), b = texArg(st);
      return { mml:"<mfrac>" + a + b + "</mfrac>", big:false };
    }
    if (name === "binom"){
      const a = texArg(st), b = texArg(st);
      return { mml:"<mrow>" + texMo("(") + "<mfrac linethickness=\"0\">" + a + b + "</mfrac>" + texMo(")") + "</mrow>", big:false };
    }
    if (name === "sqrt"){
      while (st.toks[st.pos] && st.toks[st.pos].t === "sp") st.pos++;
      if (st.toks[st.pos] && st.toks[st.pos].t === "char" && st.toks[st.pos].v === "["){
        st.pos++; const idx = [];
        while (st.toks[st.pos] && !(st.toks[st.pos].t === "char" && st.toks[st.pos].v === "]")) idx.push(st.toks[st.pos++]);
        if (st.toks[st.pos]) st.pos++;
        const sub = { toks:idx, pos:0, display:false };
        const index = "<mrow>" + texNodes(sub, false).join("") + "</mrow>";
        return { mml:"<mroot>" + texArg(st) + index + "</mroot>", big:false };
      }
      return { mml:"<msqrt>" + texArg(st) + "</msqrt>", big:false };
    }
    if (name === "text" || name === "textrm" || name === "textbf" || name === "textit" || name === "mbox" || name === "operatorname"){
      return { mml:"<mtext>" + escapeHtml(texRawGroup(st)) + "</mtext>", big:false };
    }
    if (TEX_VARIANTS[name]){
      return { mml:"<mstyle mathvariant=\"" + TEX_VARIANTS[name] + "\">" + texArg(st) + "</mstyle>", big:false };
    }
    if (TEX_ACCENTS[name]){
      return { mml:"<mover accent=\"true\">" + texArg(st) + texMo(TEX_ACCENTS[name]) + "</mover>", big:false };
    }
    if (name === "left" || name === "right"){
      const d = st.toks[st.pos];
      let ch = "";
      if (d && d.t === "char"){ ch = d.v === "." ? "" : d.v; st.pos++; }
      else if (d && d.t === "cmd"){ ch = TEX_OPS[d.v] || TEX_SYMBOLS[d.v] || ""; st.pos++; }
      return ch ? { mml:"<mo stretchy=\"true\">" + escapeHtml(ch) + "</mo>", big:false } : null;
    }
    if (name === "," || name === ":" || name === ";" || name === "!" || name === " " || name === "quad" || name === "qquad"){
      const w = name === "qquad" ? "2em" : name === "quad" ? "1em" : name === "!" ? "-0.17em" : "0.22em";
      return { mml:"<mspace width=\"" + w + "\"/>", big:false };
    }
    if (name === "\\") return { mml:"<mspace linebreak=\"newline\"/>", big:false };
    if (TEX_BIGOPS[name]){
      const label = TEX_BIGOPS[name];
      const isWord = /[a-z]/i.test(label);
      const node = isWord ? "<mo movablelimits=\"true\">" + escapeHtml(label) + "</mo>" : "<mo>" + escapeHtml(label) + "</mo>";
      return { mml:node, big:true, fn:isWord };
    }
    if (TEX_INTOPS[name]) return { mml:"<mo>" + escapeHtml(TEX_INTOPS[name]) + "</mo>", big:false };
    if (TEX_FUNCS.has(name)) return { mml:"<mi>" + escapeHtml(name) + "</mi>", big:false, fn:true };
    if (TEX_OPS[name]) return { mml:texMo(TEX_OPS[name]), big:false };
    if (TEX_SYMBOLS[name]){
      const sym = TEX_SYMBOLS[name];
      return { mml:/[a-zA-Z]/.test(sym) ? "<mi>" + escapeHtml(sym) + "</mi>" : texMo(sym), big:false };
    }
    // 알 수 없는 명령은 이름만 세워서 보여 준다.
    return { mml:"<mi>" + escapeHtml(name) + "</mi>", big:false };
  }
  // 함수 이름(\sin, \lim 등) 뒤에 인자가 이어지면 얇은 공백을 넣기 위해, 다음 토큰이 피연산자 시작인지 본다.
  // 이항 연산자(\cdot, +, = 등)나 닫는 괄호 앞에는 공백을 넣지 않는다(예: \sin + 1 은 그대로).
  function texNextIsOperand(st){
    let k = st.pos; while (st.toks[k] && st.toks[k].t === "sp") k++;
    const nt = st.toks[k];
    if (!nt) return false;
    if (nt.t === "{") return true;
    if (nt.t === "char") return /[A-Za-z0-9(\[|]/.test(nt.v);
    if (nt.t === "cmd") return !TEX_OPS[nt.v] && nt.v !== "right" && nt.v !== ")" && nt.v !== "]";
    return false;
  }
  function texNodes(st, stopAtBrace){
    const out = [];
    let guard = 0;
    while (st.pos < st.toks.length){
      if (++guard > 20000) break;
      const tk = st.toks[st.pos];
      if (stopAtBrace && tk.t === "}") break;
      if (tk.t === "sp"){
        let spaces = 0;
        while (st.toks[st.pos] && st.toks[st.pos].t === "sp") spaces += st.toks[st.pos++].n || 1;
        if (st.preserveSpaces) out.push('<mspace width="' + Math.min(40, spaces) * .28 + 'em"/>');
        continue;
      }
      const atom = texAtom(st);
      if (!atom) continue;
      const node = texScripts(st, atom.mml, atom.big);
      out.push(atom.fn && texNextIsOperand(st) ? node + "<mspace width=\"0.17em\"/>" : node);
    }
    return out;
  }
  function latexToMathML(tex, display, preserveLayout){
    const attrs = "xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"" + (display ? "block" : "inline") + "\"";
    try {
      const source = String(tex || "");
      if (preserveLayout){
        const lines = source.replace(/\r\n?/g, "\n").split("\n");
        const rows = lines.map(line => {
          const st = { toks:texTokenize(line), pos:0, display:!!display, preserveSpaces:true };
          const body = texNodes(st, false).join("") || '<mspace width="0.1em" height="1em"/>';
          return "<mtr><mtd columnalign=\"left\" style=\"text-align:left\"><mrow>" + body + "</mrow></mtd></mtr>";
        }).join("");
        return "<math " + attrs + "><mtable columnalign=\"left\" rowspacing=\"0.35em\">" + rows + "</mtable></math>";
      }
      const st = { toks:texTokenize(source), pos:0, display:!!display, preserveSpaces:false };
      const body = texNodes(st, false).join("");
      return "<math " + attrs + "><mrow>" + (body || "<mspace width=\"0.1em\"/>") + "</mrow></math>";
    } catch(_){
      return "<math " + attrs + "><mtext>" + escapeHtml(String(tex || "")) + "</mtext></math>";
    }
  }

  const MATH_TOKEN = /xMnMathZ(\d+)Zx/g;
  // 마크다운 처리 전에 수식 구간을 뽑아 플레이스홀더로 바꾼다(코드펜스·인라인코드 안의 $ 는 건드리지 않음).
  function protectMath(src, store){
    src = String(src || "");
    const n = src.length;
    let out = "", i = 0, lineStart = true;
    const push = (tex, display) => { const id = store.length; store.push(latexToMathML(tex, display)); return "xMnMathZ" + id + "Zx"; };
    while (i < n){
      if (lineStart){
        const fence = /^([ \t]*)(```|~~~)/.exec(src.slice(i, i + 8));
        if (fence){
          const marker = fence[2];
          let le = src.indexOf("\n", i); if (le < 0) le = n;
          out += src.slice(i, le); i = le;
          const closeRe = new RegExp("^[ \\t]*" + marker.replace(/[`~]/g, "\\$&"));
          while (i < n){
            out += "\n"; i++;
            let e = src.indexOf("\n", i); if (e < 0) e = n;
            const line = src.slice(i, e); out += line; i = e;
            if (closeRe.test(line)) break;
          }
          lineStart = true; continue;
        }
      }
      const c = src[i];
      if (c === "\n"){ out += c; i++; lineStart = true; continue; }
      lineStart = false;
      if (c === "`"){
        let run = 1; while (src[i + run] === "`") run++;
        const ticks = src.slice(i, i + run);
        const close = src.indexOf(ticks, i + run);
        if (close < 0){ out += src.slice(i); i = n; } else { out += src.slice(i, close + run); i = close + run; }
        continue;
      }
      if (c === "\\" && src[i + 1] === "$"){ out += "$"; i += 2; continue; }
      if (c === "$"){
        if (src[i + 1] === "$"){
          const close = src.indexOf("$$", i + 2);
          if (close >= 0){ out += push(src.slice(i + 2, close), true); i = close + 2; continue; }
        } else if (!/\s/.test(src[i + 1] || " ")){
          let j = i + 1, found = false;
          while (j < n){
            const ch = src[j];
            if (ch === "\\"){ j += 2; continue; }
            if (ch === "\n"){ if (src[j + 1] === "\n") break; j++; continue; }
            if (ch === "$"){
              if (src[j + 1] === "$") break;
              if (!/\s/.test(src[j - 1]) && !/\d/.test(src[j + 1] || "")) found = true;
              break;
            }
            j++;
          }
          if (found){ out += push(src.slice(i + 1, j), false); i = j + 1; continue; }
        }
        out += "$"; i++; continue;
      }
      out += c; i++;
    }
    return out;
  }
  function restoreMath(html, store){
    if (!store.length) return html;
    return String(html).replace(MATH_TOKEN, (_, d) => store[Number(d)] || "");
  }

  function markdownToHtml(markdown, options) {
    const allowHtml = !!(options && options.allowHtml);
    const math = [];
    const built = renderMarkdownBlocks(protectMath(markdown, math), allowHtml);
    return restoreMath(allowHtml ? sanitizeHtml(built) : built, math);
  }

  function renderMarkdownBlocks(markdown, allowHtml) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)\s*$/);
      if (fence) {
        const marker = fence[1];
        const lang = fence[2] ? ` class="language-${escapeAttr(fence[2])}"` : "";
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(marker)) buf.push(lines[i++]);
        if (i < lines.length) i++;
        html.push(`<pre><code${lang}>${escapeHtml(buf.join("\n"))}</code></pre>`);
        continue;
      }
      if (i + 1 < lines.length && line.includes("|") && isTableSeparator(lines[i + 1])) {
        const head = splitTableRow(line); i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
        html.push("<table><thead><tr>" + head.map((c) => `<th>${inlineMarkdown(c, allowHtml)}</th>`).join("") + "</tr></thead><tbody>" +
          rows.map((row) => "<tr>" + row.map((c) => `<td>${inlineMarkdown(c, allowHtml)}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>");
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2], allowHtml)}</h${level}>`); i++; continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { html.push("<hr>"); i++; continue; }
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        html.push(`<blockquote>${renderMarkdownBlocks(buf.join("\n"), allowHtml)}</blockquote>`); continue;
      }
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const tag = ordered ? "ol" : "ul";
        const items = [];
        const rx = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
        while (i < lines.length) {
          const item = lines[i].match(rx); if (!item) break;
          items.push(`<li>${inlineMarkdown(item[1], allowHtml)}</li>`); i++;
        }
        html.push(`<${tag}>${items.join("")}</${tag}>`); continue;
      }
      const paragraph = [line.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~)/.test(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) && !(i + 1 < lines.length && lines[i].includes("|") && isTableSeparator(lines[i + 1]))) {
        paragraph.push(lines[i++].trim());
      }
      html.push(`<p>${inlineMarkdown(paragraph.join(" "), allowHtml)}</p>`);
    }
    return html.join("\n") || "<p></p>";
  }

  function classifyPythonStderr(stderr, status) {
    const text = String(stderr || "");
    if (!text.trim()) return "none";
    const failed = status === false || (typeof status === "number" && status !== 0);
    if (failed) return "error";
    if (/\bTraceback\s+\(most recent call last\):/i.test(text)) return "error";
    if (/(^|\n)\s*(?:SyntaxError|IndentationError|TabError|NameError|TypeError|ValueError|ModuleNotFoundError|ImportError|FileNotFoundError|ZeroDivisionError|RuntimeError|AssertionError)\b/i.test(text))
      return "error";
    return "warning";
  }

  // 대화형 실행 중에는 아직 종료 코드를 모르므로 stderr를 경고나 오류로 단정하지 않는다.
  // 표시 여부는 실행 화면에서 결정하고, 종료 코드가 나온 뒤 최종 색상과 숨김 여부를 확정한다.
  function pythonStderrDisplayKind(stderr, status) {
    const text = String(stderr || "");
    if (!text.trim()) return "none";
    if (status == null) return "pending";
    return classifyPythonStderr(text, status);
  }

  function pythonStderrShouldBuffer(complete, showWarnings) {
    return complete !== true && showWarnings === false;
  }

  function explainPythonError(stderr) {
    const lines = String(stderr || "").trim().split(/\r?\n/).filter(Boolean);
    let type = "", message = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/^((?:[A-Za-z_][\w.]*(?:Error|Exception))|KeyboardInterrupt|SystemExit|StopIteration)(?:\:\s*(.*))?$/);
      if (match) { type = match[1].split(".").pop(); message = match[2] || ""; break; }
    }
    if (!type) return null;
    const specificGuides = {
      SyntaxError: [
        {
          pattern: /\bpositional argument follows keyword argument\b/,
          title: "함수에 넣은 값의 순서가 맞지 않아요",
          tip: "함수 호출에서 이름=값 형태의 인자 뒤에는 이름 없는 일반 값을 둘 수 없습니다. 일반 값은 앞에 두거나, 뒤의 값들도 모두 이름을 붙여 주세요."
        },
        {
          pattern: /\b(?:expected ':'|invalid syntax)\b/,
          title: "문법 기호를 확인해 보세요",
          tip: "if, for, while, def 문장 끝의 콜론(:), 괄호, 쉼표 위치가 맞는지 확인하세요."
        },
        {
          pattern: /\b(?:was never closed|unterminated string literal|EOL while scanning string literal)\b/,
          title: "괄호나 따옴표가 닫히지 않았어요",
          tip: "열린 괄호 (), [], {}나 따옴표 ', \"가 같은 줄 또는 문장 안에서 닫혔는지 확인하세요."
        }
      ],
      IndentationError: [
        {
          pattern: /\bexpected an indented block\b/,
          title: "들여쓴 코드 블록이 필요해요",
          tip: "if, for, while, def 다음 줄은 보통 공백 4칸만큼 들여써야 합니다."
        },
        {
          pattern: /\bunindent does not match\b|\bunexpected indent\b/,
          title: "들여쓰기 위치가 맞지 않아요",
          tip: "같은 블록의 줄들은 들여쓰기 칸 수를 맞추고, 불필요하게 앞에 들어간 공백을 지우세요."
        }
      ],
      NameError: [
        {
          pattern: /\bname ['"][^'"]+['"] is not defined\b/,
          title: "아직 만든 적 없는 이름이에요",
          tip: "변수·함수 이름의 철자와 대소문자를 확인하고, 사용하기 전에 먼저 값을 넣었는지 확인하세요."
        }
      ],
      UnboundLocalError: [
        {
          pattern: /\b(?:local variable ['"][^'"]+['"] referenced before assignment|cannot access local variable ['"][^'"]+['"] where it is not associated with a value)\b/,
          title: "함수 안에서 값을 넣기 전에 읽고 있어요",
          tip: "함수 안 변수는 사용하기 전에 먼저 값을 넣어야 합니다. 바깥 변수를 바꾸려는 코드라면 전달값이나 반환값 구조를 확인하세요."
        }
      ],
      ValueError: [
        {
          pattern: /\binvalid literal for int\(\) with base 10\b/,
          title: "정수로 바꿀 수 없는 값이에요",
          tip: "int()에는 숫자 모양의 문자열만 넣을 수 있습니다. 입력값에 글자, 빈칸, 소수점이 섞였는지 확인하세요."
        },
        {
          pattern: /\bcould not convert string to float\b/,
          title: "실수로 바꿀 수 없는 값이에요",
          tip: "float()에는 숫자 모양의 문자열만 넣을 수 있습니다. 쉼표, 단위, 빈 문자열이 들어왔는지 확인하세요."
        },
        {
          pattern: /\bmath domain error\b/,
          title: "수학 함수에 넣을 수 없는 값이에요",
          tip: "sqrt()에 음수, log()에 0 이하 값처럼 함수가 허용하지 않는 범위의 값인지 확인하세요."
        },
        {
          pattern: /\b(?:list\.remove\(x\): x not in list|substring not found)\b/,
          title: "찾으려는 값이 안에 없어요",
          tip: "remove(), index()를 쓰기 전에 그 값이 리스트나 문자열 안에 있는지 먼저 확인하세요."
        },
        {
          pattern: /\b(?:too many values to unpack|not enough values to unpack)\b/,
          title: "나눠 담을 변수 개수가 맞지 않아요",
          tip: "왼쪽 변수 개수와 오른쪽 값 개수가 같은지 확인하세요. split() 결과 개수도 함께 살펴보세요."
        }
      ],
      TypeError: [
        {
          pattern: /\b(?:missing \d+ required (?:positional|keyword-only) arguments?|takes (?:from \d+ to \d+|\d+) positional arguments? but \d+ (?:was|were) given|takes exactly \w+ arguments? \(\d+ given\)|got an unexpected keyword argument)\b/,
          title: "함수에 넣은 값 개수가 맞지 않아요",
          tip: "함수 정의의 매개변수와 호출할 때 넣은 인자 개수·이름이 맞는지 확인하세요."
        },
        {
          pattern: /\bcan only concatenate str\b|expected str instance|must be str, not\b/,
          title: "문자열과 다른 값은 바로 붙일 수 없어요",
          tip: "문자열에 숫자나 다른 값을 붙일 때는 str()로 바꾸거나, 계산과 출력 문자열을 분리하세요."
        },
        {
          pattern: /\bunsupported operand type\(s\) for\b|\bbad operand type for unary\b/,
          title: "서로 맞지 않는 값끼리 계산하고 있어요",
          tip: "연산자 양쪽 값의 자료형을 확인하고, 필요하면 int(), float(), str()로 바꾼 뒤 계산하세요."
        },
        {
          pattern: /\bobject is not callable\b/,
          title: "함수처럼 부를 수 없는 값이에요",
          tip: "괄호 () 앞에 있는 이름이 함수인지 확인하세요. 변수 이름이 print, list, sum 같은 함수 이름을 덮어쓴 경우도 살펴보세요."
        },
        {
          pattern: /\bobject is not subscriptable\b/,
          title: "대괄호로 꺼낼 수 없는 값이에요",
          tip: "대괄호 [] 앞의 값이 리스트·문자열·딕셔너리처럼 여러 값을 담는 자료형인지 확인하세요."
        },
        {
          pattern: /\bindices must be integers\b|\bslice indices must be integers\b|\bstring indices must be integers\b/,
          title: "순서 번호는 정수로 써야 해요",
          tip: "리스트나 문자열에서 값을 꺼낼 때 [] 안에는 0, 1, 2 같은 정수 인덱스를 넣으세요."
        },
        {
          pattern: /\bobject of type ['"][^'"]+['"] has no len\(\)/,
          title: "길이를 셀 수 없는 값이에요",
          tip: "len()에는 문자열, 리스트, 딕셔너리처럼 길이가 있는 값을 넣어야 합니다."
        },
        {
          pattern: /\bnot supported between instances of\b/,
          title: "서로 다른 종류의 값은 비교할 수 없어요",
          tip: "비교하는 두 값의 자료형을 맞추세요. 숫자 비교라면 int()나 float() 변환이 필요한지 확인하세요."
        },
        {
          pattern: /\b(?:argument of type ['"][^'"]+['"] is not iterable|cannot unpack non-iterable|object is not iterable)\b/,
          title: "여러 값처럼 다룰 수 없는 값이에요",
          tip: "in, for, 여러 변수에 나눠 담기에는 리스트·튜플·문자열처럼 반복 가능한 값이 필요합니다."
        }
      ],
      IndexError: [
        {
          pattern: /\b(?:list|string|tuple) index out of range\b|\bpop index out of range\b/,
          title: "없는 순서 번호를 꺼내고 있어요",
          tip: "인덱스는 0부터 시작합니다. len()으로 길이를 확인하고 마지막 인덱스가 길이보다 1 작다는 점을 확인하세요."
        }
      ],
      KeyError: [
        {
          pattern: /^.+$/,
          title: "딕셔너리에 없는 키를 찾고 있어요",
          tip: "대괄호 [] 안의 키가 실제 딕셔너리에 있는지 확인하세요. 없을 수도 있다면 get()이나 in 검사를 사용하세요."
        }
      ],
      AttributeError: [
        {
          pattern: /['"][^'"]+['"] object has no attribute ['"][^'"]+['"]/,
          title: "이 값에는 그런 기능이 없어요",
          tip: "점(.) 앞 값의 자료형에 맞는 메서드인지 확인하세요. 예를 들어 문자열에는 append()를 쓸 수 없습니다."
        },
        {
          pattern: /\bmodule ['"][^'"]+['"] has no attribute\b|\bpartially initialized module\b/,
          title: "모듈에서 해당 이름을 찾지 못했어요",
          tip: "모듈 이름과 파일 이름이 겹치지 않는지, import한 모듈에 실제로 그 함수나 값이 있는지 확인하세요."
        }
      ],
      ModuleNotFoundError: [
        {
          pattern: /\bNo module named ['"][^'"]+['"]/,
          title: "설치되지 않았거나 이름이 다른 모듈이에요",
          tip: "import 이름의 철자를 확인하세요. 로컬 실행이라면 필요한 패키지를 설치해야 할 수 있습니다."
        }
      ],
      ImportError: [
        {
          pattern: /\bcannot import name\b/,
          title: "모듈 안에서 가져올 이름을 찾지 못했어요",
          tip: "from ... import ...에서 import하려는 이름의 철자와 모듈 버전을 확인하세요."
        }
      ],
      FileNotFoundError: [
        {
          pattern: /\bNo such file or directory\b/,
          title: "지정한 파일 경로가 없어요",
          tip: "파일 이름, 확장자, 폴더 위치가 맞는지 확인하세요. 관련 파일은 코드와 함께 같은 폴더나 압축 묶음으로 열어야 합니다."
        }
      ],
      PermissionError: [
        {
          pattern: /^.*$/,
          title: "파일이나 폴더를 사용할 권한이 없어요",
          tip: "다른 프로그램이 파일을 사용 중인지, 읽기 전용 위치인지 확인하고 내 문서처럼 쓸 수 있는 폴더에서 다시 시도하세요."
        }
      ],
      IsADirectoryError: [
        {
          pattern: /^.*$/,
          title: "파일 대신 폴더 경로를 열고 있어요",
          tip: "open()에는 폴더가 아니라 실제 파일 이름까지 포함한 경로를 넣어야 합니다."
        }
      ],
      NotADirectoryError: [
        {
          pattern: /^.*$/,
          title: "폴더가 아닌 값을 폴더처럼 사용하고 있어요",
          tip: "경로 중간 부분이 실제 폴더인지 확인하고 파일 이름 뒤에 다른 경로를 이어 붙이지 않았는지 살펴보세요."
        }
      ],
      FileExistsError: [
        {
          pattern: /^.*$/,
          title: "같은 이름의 파일이나 폴더가 이미 있어요",
          tip: "새 이름을 사용하거나, 덮어써도 되는 작업이라면 기존 항목을 먼저 확인하세요."
        }
      ],
      UnicodeDecodeError: [
        {
          pattern: /^.*$/,
          title: "파일의 문자 인코딩을 해석하지 못했어요",
          tip: "open()의 encoding을 utf-8, cp949 등 실제 파일 인코딩과 맞추세요. 바이너리 파일은 'rb' 모드로 열어야 합니다."
        }
      ],
      UnicodeEncodeError: [
        {
          pattern: /^.*$/,
          title: "문자를 현재 인코딩으로 저장할 수 없어요",
          tip: "파일을 열 때 encoding='utf-8'을 지정하거나 출력 대상이 해당 문자를 지원하는지 확인하세요."
        }
      ],
      JSONDecodeError: [
        {
          pattern: /^.*$/,
          title: "JSON 문법이 올바르지 않아요",
          tip: "따옴표·쉼표·중괄호 위치를 확인하세요. JSON의 키와 문자열은 큰따옴표를 사용해야 합니다."
        }
      ],
      RecursionError: [
        {
          pattern: /^.*$/,
          title: "함수가 너무 깊게 반복 호출됐어요",
          tip: "재귀 함수가 끝나는 조건에 실제로 도달하는지, 같은 값을 계속 넘기고 있지 않은지 확인하세요."
        }
      ],
      MemoryError: [
        {
          pattern: /^.*$/,
          title: "작업에 필요한 메모리가 부족해요",
          tip: "한꺼번에 만드는 리스트·이미지·파일 크기를 줄이고 데이터를 작은 단위로 나눠 처리하세요."
        }
      ],
      OverflowError: [
        {
          pattern: /^.*$/,
          title: "계산 결과가 처리 가능한 범위를 넘었어요",
          tip: "지수·팩토리얼·실수 변환처럼 값이 급격히 커지는 계산의 입력 범위를 확인하세요."
        }
      ],
      AssertionError: [
        {
          pattern: /^.*$/,
          title: "assert로 확인한 조건이 맞지 않아요",
          tip: "assert 뒤 조건과 그 시점의 변수 값을 확인하세요. 오류 메시지를 함께 적으면 원인을 찾기 쉽습니다."
        }
      ],
      EOFError: [
        {
          pattern: /^.*$/,
          title: "입력받을 값이 더 이상 없어요",
          tip: "input() 호출 횟수만큼 입력이 제공되는지 확인하고, 빈 입력이 가능한 경우를 따로 처리하세요."
        }
      ],
      TimeoutError: [
        {
          pattern: /^.*$/,
          title: "작업이 제한 시간 안에 끝나지 않았어요",
          tip: "네트워크·파일 작업이 멈췄는지 확인하고 반복문이 종료되는지도 살펴보세요."
        }
      ],
      ConnectionError: [
        {
          pattern: /^.*$/,
          title: "네트워크 연결을 완료하지 못했어요",
          tip: "주소와 인터넷 연결을 확인하고, 서버가 요청을 받을 수 있는 상태인지 살펴보세요."
        }
      ],
      KeyboardInterrupt: [
        {
          pattern: /^.*$/,
          title: "사용자가 실행을 중단했어요",
          tip: "직접 중단한 경우 정상입니다. 의도하지 않았다면 오래 걸리는 반복문이나 입력 대기 상태를 확인하세요."
        }
      ],
      ZeroDivisionError: [
        {
          pattern: /\b(?:division|modulo).+zero\b/,
          title: "0으로 나누고 있어요",
          tip: "나누기나 나머지 계산 전에 분모가 0인지 조건문으로 먼저 확인하세요."
        }
      ]
    };
    const specificGuide = (specificGuides[type] || []).find((guide) => guide.pattern.test(message));
    if (specificGuide) return { type, title: specificGuide.title, tip: specificGuide.tip, message };
    const guides = {
      SyntaxError: ["문법을 확인해 보세요", "괄호·따옴표가 닫혔는지, if/for/def 문장 끝에 콜론(:)이 있는지 확인하세요."],
      IndentationError: ["들여쓰기를 확인해 보세요", "같은 코드 블록은 들여쓰기 칸 수를 맞추고 탭과 공백을 섞지 마세요."],
      TabError: ["탭과 공백이 섞여 있어요", "들여쓰기를 공백 4칸으로 통일해 보세요."],
      NameError: ["이름을 찾을 수 없어요", "변수·함수 이름의 철자와 대소문자를 확인하고, 사용하기 전에 값을 만들었는지 확인하세요."],
      TypeError: ["값의 종류가 맞지 않아요", "연산이나 함수가 요구하는 자료형인지 확인하세요. 필요하면 int(), float(), str()로 변환하세요."],
      ValueError: ["값의 형식이 올바르지 않아요", "숫자 변환이나 함수에 전달한 값의 실제 내용을 확인하세요."],
      IndexError: ["목록의 범위를 벗어났어요", "리스트 길이는 len()으로 확인하고 인덱스가 0부터 시작한다는 점을 확인하세요."],
      KeyError: ["딕셔너리에 해당 키가 없어요", "키의 철자와 대소문자를 확인하거나 dict.get()을 사용해 보세요."],
      ZeroDivisionError: ["0으로 나눌 수 없어요", "나누기 전에 나누는 값이 0인지 조건문으로 확인하세요."],
      FileNotFoundError: ["파일을 찾을 수 없어요", "파일 이름과 경로를 확인하고, 관련 파일을 폴더나 압축 묶음으로 함께 열었는지 확인하세요."],
      ModuleNotFoundError: ["모듈을 찾을 수 없어요", "모듈 이름을 확인하고 로컬 실행이라면 필요한 패키지를 설치하세요."],
      AttributeError: ["이 값에는 해당 기능이 없어요", "점(.) 앞 값의 자료형과 메서드 이름의 철자를 확인하세요."],
      PermissionError: ["사용 권한이 없어요", "파일·폴더 권한과 다른 프로그램의 사용 여부를 확인하세요."],
      UnicodeDecodeError: ["문자 인코딩을 읽지 못했어요", "파일 인코딩을 확인하고 open()의 encoding 값을 맞추세요."],
      UnicodeEncodeError: ["문자 인코딩으로 저장하지 못했어요", "UTF-8 같은 문자 지원 인코딩으로 저장하세요."],
      JSONDecodeError: ["JSON 문법을 확인해 보세요", "큰따옴표·쉼표·중괄호 위치를 확인하세요."],
      RecursionError: ["재귀 호출이 너무 깊어요", "재귀 함수의 종료 조건을 확인하세요."],
      MemoryError: ["메모리가 부족해요", "데이터를 더 작은 단위로 나눠 처리하세요."],
      AssertionError: ["assert 조건이 맞지 않아요", "조건식과 현재 변수 값을 확인하세요."],
      EOFError: ["입력값이 부족해요", "input() 횟수만큼 입력이 제공되는지 확인하세요."]
    };
    const guide = guides[type] || ["오류 내용을 확인해 보세요", "강조된 줄과 실행 결과의 마지막 오류 메시지를 차례로 확인하세요."];
    return { type, title: guide[0], tip: guide[1], message };
  }

  function contentMatchSnippet(text, query, maxLength=120, lowerText) {
    text = String(text || ""); query = String(query || "");
    if (!text || !query) return null;
    // 대용량 파일에서 매 검색마다 전체를 소문자 변환하지 않도록, 미리 만든 소문자본이 있으면 재사용한다.
    const hay = typeof lowerText === "string" ? lowerText : text.toLocaleLowerCase();
    const index = hay.indexOf(query.toLocaleLowerCase());
    if (index < 0) return null;
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    let lineEnd = text.indexOf("\n", index);
    if (lineEnd < 0) lineEnd = text.length;
    let value = text.slice(lineStart, lineEnd).replace(/\t/g, "  ").trim();
    const offset = Math.max(0, index - lineStart);
    if (value.length > maxLength) {
      const start = Math.max(0, Math.min(value.length - maxLength, offset - Math.floor(maxLength / 3)));
      value = (start > 0 ? "…" : "") + value.slice(start, start + maxLength) + (start + maxLength < value.length ? "…" : "");
    }
    const line = lineNumberAtOffset(text, index);   // slice+split 대신 오프셋까지 \n 개수만 세어 대용량에서도 가볍게
    return { line, text: value };
  }

  function suggestRegexPatterns(example) {
    const value = [...String(example || "")].slice(0, 120).join("");
    if (!value) return [];
    const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const charType = (ch) => {
      if (/[a-z]/.test(ch)) return "lower";
      if (/[A-Z]/.test(ch)) return "upper";
      if (/[0-9]/.test(ch)) return "digit";
      if (/[\uAC00-\uD7A3]/.test(ch)) return "hangul";
      if (/\s/.test(ch)) return "space";
      return "literal";
    };
    const tokens = [];
    for (const ch of value) {
      const type = charType(ch), last = tokens[tokens.length - 1];
      if (last && last.type === type) last.text += ch;
      else tokens.push({ type, text: ch });
    }
    const quantifier = (length) => length === 1 ? "" : "{" + length + "}";
    const sourceFor = (token, mode="exact") => {
      if (token.type === "literal") return escapeRegex(token.text);
      const source = {
        lower: "[a-z]", upper: "[A-Z]", letter: "[A-Za-z]",
        digit: "[0-9]", hangul: "[가-힣]", space: "\\s"
      }[token.type];
      const length = [...token.text].length;
      return source + (mode === "flexible" ? "+" : mode === "minimum" ? "{" + length + ",}" : quantifier(length));
    };
    const describe = (list, mode="exact") => list.map((token) => {
      if (token.type === "literal") return "'" + token.text + "'";
      const name = {
        lower: "소문자", upper: "대문자", letter: "영문자",
        digit: "숫자", hangul: "한글", space: "공백"
      }[token.type];
      const length = [...token.text].length;
      return name + (mode === "flexible" ? " 1개 이상" : mode === "minimum" ? " " + length + "개 이상" : " " + length + "개");
    }).join(" + ");
    const mergeLetters = (list) => {
      const merged = [];
      for (const token of list) {
        const type = token.type === "lower" || token.type === "upper" ? "letter" : token.type;
        const last = merged[merged.length - 1];
        if (last && last.type === type && type === "letter") last.text += token.text;
        else merged.push({ type, text: token.text });
      }
      return merged;
    };
    const results = [];
    const add = (label, pattern, description) => {
      if (!pattern || results.some((item) => item.pattern === pattern)) return;
      results.push({ label, pattern, description });
    };
    add("그대로 찾기", escapeRegex(value), "특수문자까지 입력한 값 그대로");
    const exact = tokens.map((token) => sourceFor(token)).join("");
    add("같은 모양", exact, describe(tokens));
    const caseFree = mergeLetters(tokens);
    if (tokens.some((token) => token.type === "lower" || token.type === "upper")) {
      add("대소문자 자유", caseFree.map((token) => sourceFor(token)).join(""), describe(caseFree));
    }
    const minimum = tokens.map((token) => sourceFor(token, token.type === "literal" ? "exact" : "minimum")).join("");
    add("최소 길이", minimum, describe(tokens, "minimum"));
    const flexible = tokens.map((token) => sourceFor(token, token.type === "literal" ? "exact" : "flexible")).join("");
    add("길이 자유", flexible, describe(tokens, "flexible"));
    if (tokens.filter((token) => token.type !== "literal").length >= 2) {
      const grouped = tokens.map((token) => token.type === "literal"
        ? sourceFor(token)
        : "(" + sourceFor(token, "flexible") + ")").join("");
      add("부분 묶기", grouped, "각 부분을 괄호 그룹으로 나눠 바꾸기에서 $1, $2로 사용");
    }
    return results.slice(0, 6);
  }

  function countRegexMatches(text, pattern, maxMatches=100000) {
    let regex;
    try { regex = new RegExp(String(pattern || ""), "g"); }
    catch (e) { return 0; }
    const value = String(text || "");
    let count = 0, match;
    while ((match = regex.exec(value)) !== null) {
      count++;
      if (!match[0].length) regex.lastIndex++;
      if (count >= maxMatches) break;
    }
    return count;
  }

  function normalizeShortcut(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const aliases = {
      control: "Ctrl", ctrl: "Ctrl", meta: "Meta", cmd: "Meta", command: "Meta", win: "Meta",
      alt: "Alt", option: "Alt", shift: "Shift",
      left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
      arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown",
      esc: "Escape", escape: "Escape", return: "Enter", spacebar: "Space", space: "Space",
      del: "Delete", delete: "Delete", backspace: "Backspace"
    };
    const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
    const modifiers = new Set();
    let key = "";
    for (const part of parts) {
      const normalized = aliases[part.toLowerCase()] || (/^f(?:[1-9]|1[0-2])$/i.test(part) ? part.toUpperCase() :
        (part.length === 1 ? part.toUpperCase() : part));
      if (["Ctrl","Meta","Alt","Shift"].includes(normalized)) modifiers.add(normalized);
      else key = normalized;
    }
    if (!key) return "";
    return ["Ctrl","Meta","Alt","Shift"].filter((modifier) => modifiers.has(modifier)).concat(key).join("+");
  }

  function shortcutFromEventLike(event) {
    if (!event || event.isComposing) return "";
    let key = String(event.key || "");
    if (!key || ["Control","Meta","Alt","Shift","AltGraph","Process","Unidentified","Dead"].includes(key)) return "";
    const aliases = {
      " ": "Space", Spacebar: "Space", Esc: "Escape",
      Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown"
    };
    key = aliases[key] || key;
    if (key.length === 1) key = key.toUpperCase();
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push("Meta");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(key);
    return normalizeShortcut(parts.join("+"));
  }

  function shortcutMatchesEvent(event, shortcut) {
    const actual = shortcutFromEventLike(event);
    return !!actual && actual === normalizeShortcut(shortcut);
  }

  function documentEdgeShortcutCommand(event) {
    if (!event || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return "";
    const key = String(event.key || "").toLowerCase();
    if (key === "home") return "start";
    if (key === "end") return "end";
    return "";
  }

  // Python 편집기 실행 결과 패널의 방향 단축키를 DOM과 분리해 판별한다.
  // Alt+Shift만 정확히 누른 경우에만 처리해 Ctrl/Win 조합과 편집기 기본 선택을 보존한다.
  function pythonOutputShortcutCommand(event) {
    if (!event || event.isComposing || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return "";
    return ({
      ArrowLeft: "show-right",
      ArrowUp: "show-below",
      ArrowRight: "hide-right",
      ArrowDown: "hide-below"
    })[String(event.key || "")] || "";
  }

  function normalizePythonVariables(items, maxItems=80, maxValueLength=600) {
    if (!Array.isArray(items)) return [];
    const result = [], seen = new Set();
    for (const item of items) {
      if (!item || result.length >= maxItems) break;
      const name = String(item.name == null ? "" : item.name).trim().slice(0, 120);
      if (!name || name.startsWith("_") || seen.has(name)) continue;
      seen.add(name);
      const type = String(item.type == null ? "" : item.type).trim().slice(0, 120) || "unknown";
      let value = String(item.value == null ? "None" : item.value);
      if (value.length > maxValueLength) value = value.slice(0, Math.max(0, maxValueLength - 1)) + "…";
      const row = { name, type, value };
      // DataFrame 등의 표 HTML·shape 는 있을 때만 통과시킨다(렌더 쪽에서 표로 그린다).
      if (item.html != null){ const html = String(item.html); if (html) row.html = html.slice(0, 200000); }
      if (item.shape != null){ const shape = String(item.shape).trim().slice(0, 40); if (shape) row.shape = shape; }
      if (item.tableNote != null){ const note = String(item.tableNote).trim().slice(0, 100); if (note) row.tableNote = note; }
      if (item.lazy != null) row.lazy = !!item.lazy;
      result.push(row);
    }
    return result;
  }

  function normalizeAssignmentTests(items, maxItems=20, maxTextLength=20000) {
    if (!Array.isArray(items)) return [];
    const result = [];
    for (const item of items) {
      if (!item || result.length >= maxItems) break;
      const name = String(item.name == null ? "" : item.name).trim().slice(0, 120) || ("테스트 " + (result.length + 1));
      const input = String(item.input == null ? "" : item.input).slice(0, maxTextLength).replace(/\r\n?/g, "\n");
      const expected = String(item.expected == null ? "" : item.expected).slice(0, maxTextLength).replace(/\r\n?/g, "\n");
      const row = { name, input, expected };
      if (item.hidden === true) row.hidden = true;   // 과제 패키지(.task)의 숨김 테스트 — 학생에겐 통과/실패만 표시
      result.push(row);
    }
    return result;
  }

  function normalizeGradingOutput(value) {
    const lines = String(value == null ? "" : value).replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.map(line => line.replace(/[ \t]+$/g, "")).join("\n");
  }

  // 숨김 테스트의 traceback·예외 메시지는 학생 화면의 공통 오류 안내에도 노출하지 않는다.
  function assignmentGradingErrorText(report, gradeTests, fallback="") {
    if (!report || !Array.isArray(report.results)) return String(fallback || "");
    return report.results
      .map((row, index) => (gradeTests && gradeTests[index] && gradeTests[index].hidden) ? "" : String((row && row.error) || ""))
      .filter(Boolean)
      .join("\n");
  }

  function normalizePythonDiagnostics(items, maxItems=100) {
    if (!Array.isArray(items)) return [];
    const severityRank = { error:0, warning:1, info:2 };
    return items.slice(0, maxItems).map((item) => {
      item = item || {};
      const severity = ["error","warning","info"].includes(item.severity) ? item.severity : "warning";
      return {
        severity,
        line: Math.max(1, parseInt(item.line, 10) || 1),
        column: Math.max(0, parseInt(item.column, 10) || 0),
        code: String(item.code == null ? "" : item.code).slice(0, 40),
        message: String(item.message == null ? "" : item.message).slice(0, 1000),
        hint: String(item.hint == null ? "" : item.hint).slice(0, 1000)
      };
    }).filter(item => item.message).sort((a, b) =>
      a.line - b.line || a.column - b.column ||
      (severityRank[a.severity] == null ? 9 : severityRank[a.severity]) -
      (severityRank[b.severity] == null ? 9 : severityRank[b.severity]));
  }

  function normalizePythonUnusedRanges(items, maxItems=500) {
    if (!Array.isArray(items)) return [];
    const kinds = new Set(["variable", "parameter", "import", "function", "class", "exception", "pattern"]);
    const seen = new Set(), out = [];
    for (const raw of items.slice(0, maxItems)){
      const item = raw || {};
      const line = Math.max(1, parseInt(item.line, 10) || 1);
      const column = Math.max(0, parseInt(item.column, 10) || 0);
      const rawLength = parseInt(item.length, 10) || 0;
      if (rawLength < 1 || rawLength > 200) continue;
      const length = rawLength;
      const name = String(item.name == null ? "" : item.name).slice(0, 200);
      const kind = kinds.has(item.kind) ? item.kind : "variable";
      if (!name || length !== name.length) continue;
      const key = line + ":" + column + ":" + length;
      if (seen.has(key)) continue;
      seen.add(key); out.push({ line, column, length, name, kind });
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column || a.length - b.length);
  }

  function normalizePythonTraceReport(report, maxSteps=300) {
    report = report && typeof report === "object" ? report : {};
    const steps = Array.isArray(report.steps) ? report.steps.slice(0, maxSteps).map((step, index) => {
      step = step || {};
      const changes = Array.isArray(step.changes) ? step.changes.slice(0, 40).map((change) => ({
        name: String(change && change.name != null ? change.name : "").slice(0, 120),
        before: String(change && change.before != null ? change.before : "").slice(0, 600),
        after: String(change && change.after != null ? change.after : "").slice(0, 600),
        type: String(change && change.type != null ? change.type : "").slice(0, 120),
        kind: ["added","changed","removed"].includes(change && change.kind) ? change.kind : "changed"
      })).filter(change => change.name) : [];
      return {
        index,
        line: Math.max(1, parseInt(step.line, 10) || 1),
        functionName: String(step.functionName == null ? "<module>" : step.functionName).slice(0, 160),
        depth: Math.max(0, Math.min(100, parseInt(step.depth, 10) || 0)),
        phase: step.phase === "return" ? "return" : "line",
        variables: normalizePythonVariables(step.variables, 40, 600),
        changes
      };
    }) : [];
    return {
      steps,
      truncated: !!report.truncated || (Array.isArray(report.steps) && report.steps.length > maxSteps),
      error: String(report.error == null ? "" : report.error).slice(0, 100000)
    };
  }

  // HWPX(OWPML zip) 압축 경로 목록에서 본문 섹션 XML만 골라 번호순으로 돌려준다.
  // (section10 이 section2 앞에 오는 문자열 정렬 문제를 피하려고 숫자로 비교)
  function orderHwpxSections(paths) {
    return (Array.isArray(paths) ? paths : [])
      .map((raw) => {
        const path = String(raw || "").replace(/\\/g, "/");
        const m = /^Contents\/section(\d+)\.xml$/i.exec(path);
        return m ? { path, n: parseInt(m[1], 10) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n)
      .map((x) => x.path);
  }

  // Office Open XML/HWPX 본문의 XML 엔티티를 텍스트로 되돌린다.
  function officeXmlDecodeText(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch (_) { return ""; }
      })
      .replace(/&#(\d+);/g, (_, digits) => {
        try { return String.fromCodePoint(parseInt(digits, 10)); } catch (_) { return ""; }
      })
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  // 접두사가 w:/a:/hp:가 아니어도 유효한 Office XML의 <*:t> 실행 텍스트를 읽는다.
  function officeXmlTextRuns(xml, separator="", maxChars=1500000) {
    const parts = [];
    let chars = 0, truncated = false;
    const runRe = /<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>/gi;
    let match;
    while ((match = runRe.exec(String(xml || "")))) {
      let text = officeXmlDecodeText(match[1]);
      const separatorCost = parts.length ? separator.length : 0;
      const remaining = Math.max(0, maxChars - chars - separatorCost);
      if (text.length > remaining){ text = text.slice(0, remaining); truncated = true; }
      if (parts.length && separator){ parts.push(separator); chars += separator.length; }
      parts.push(text); chars += text.length;
      if (chars >= maxChars){ truncated = true; break; }
    }
    return { text:parts.join(""), chars, truncated };
  }

  // DOCX/HWPX 문단을 한 줄씩 추출한다. split 대신 순차 정규식으로 읽어 큰 XML의 복제 배열을 만들지 않는다.
  function officeXmlParagraphLines(xml, maxChars=1500000) {
    const lines = [];
    let chars = 0, truncated = false;
    const paraRe = /<(?:[A-Za-z_][\w.-]*:)?p(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?p\s*>/gi;
    let match;
    const source = String(xml || "");
    while ((match = paraRe.exec(source))) {
      const remaining = Math.max(0, maxChars - chars);
      const run = officeXmlTextRuns(match[1], "", remaining);
      const line = run.text.replace(/\s+/g, " ").trim();
      lines.push(line); chars += line.length;
      if (run.truncated || chars >= maxChars){ truncated = true; break; }
    }
    return { lines, chars, truncated };
  }

  // 여러 DOM 텍스트 노드에 걸친 검색어가 어느 노드의 어느 구간과 겹치는지 계산한다.
  function renderedTextMatchSegments(chunks, query) {
    const values = (Array.isArray(chunks) ? chunks : []).map(value => String(value || ""));
    const needle = String(query || "");
    if (!needle) return [];
    const at = values.join("").toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
    if (at < 0) return [];
    const end = at + needle.length;
    const result = [];
    let offset = 0;
    values.forEach((value, index) => {
      const next = offset + value.length;
      const startInNode = Math.max(0, at - offset);
      const endInNode = Math.min(value.length, end - offset);
      if (startInNode < endInNode) result.push({ index, start:startInNode, end:endInNode });
      offset = next;
    });
    return result;
  }

  // JSON 트리 보기의 한 노드 표시 정보(표시 전용 · DOM과 분리해 단위 테스트 가능).
  // 객체·배열은 자식 수 요약을, 원시값은 코드처럼 보이는 문자열을 돌려준다(긴 문자열은 잘라서 길이 표시).
  function jsonTreeNodeInfo(value, maxString = 200) {
    if (value === null) return { kind: "null", container: false, text: "null" };
    if (Array.isArray(value)) return { kind: "array", container: true, count: value.length,
      summary: value.length ? "[ " + value.length.toLocaleString() + "개 ]" : "[ ]" };
    const type = typeof value;
    if (type === "object") {
      const count = Object.keys(value).length;
      return { kind: "object", container: true, count, summary: count ? "{ " + count.toLocaleString() + "개 }" : "{ }" };
    }
    if (type === "string") {
      const over = value.length > maxString;
      const text = JSON.stringify(over ? value.slice(0, maxString) : value);
      return { kind: "string", container: false,
        text: over ? text + " … (" + value.length.toLocaleString() + "자)" : text };
    }
    return { kind: type === "boolean" ? "boolean" : "number", container: false, text: String(value) };
  }

  // JSON 원문을 표시용으로 들여쓰기 정렬한다(2칸). 화면 표시 전용이라 파일 내용은 바뀌지 않으며,
  // JSON.parse 의 17자리 이상 정수 정밀도 변형도 저장에는 영향이 없다. 실패하면 이유를 돌려준다.
  function prettyPrintJsonText(raw) {
    const text = String(raw == null ? "" : raw);
    if (!text.trim()) return { ok: false, error: "내용이 비어 있어요." };
    try {
      return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // 분할 작업에서 문서를 골랐을 때 수행할 상태 전이를 DOM과 분리해 결정한다.
  // reference/work 역할과 실제 좌우(또는 상하) 배치는 별개이므로 역할 ID만 사용한다.
  function studyPaneSelectionAction(referenceId, workId, targetPane, selectedId) {
    const split = referenceId != null && workId != null && referenceId !== workId;
    if (!split) return "activate";
    const pane = targetPane === "reference" ? "reference" : "work";
    const targetId = pane === "reference" ? referenceId : workId;
    if (selectedId === referenceId || selectedId === workId)
      return selectedId === targetId ? "keep" : "swap";
    return pane === "reference" ? "replace-reference" : "replace-work";
  }

  // 분할바 가운데 종료 버튼 — 남길(마지막에 클릭한 타깃) 칸의 문서 id 를 돌려준다. 분할이 아니면 null.
  function studySplitEndKeepId(referenceId, workId, targetPane) {
    const split = referenceId != null && workId != null && referenceId !== workId;
    if (!split) return null;
    return targetPane === "reference" ? referenceId : workId;
  }

  // 화면에서 본 첫 칸(왼쪽/위쪽)이 어느 역할인지. 위치 바꾸기(swapped)면 자리가 뒤집힌다.
  function splitDropRoleForSide(side, swapped) {
    const first = side === "left" || side === "top";
    return first !== !!swapped ? "reference" : "work";
  }

  // 드롭 안내의 시각적 경계와 실제 판정이 같은 분할 비율을 사용하도록 순수 계산으로 분리한다.
  function splitDropSideAtPoint(clientX, clientY, rect, stacked, splitRatio=0.5) {
    const ratio = Number.isFinite(Number(splitRatio))
      ? Math.max(0, Math.min(1, Number(splitRatio)))
      : 0.5;
    if (stacked) return clientY < rect.top + rect.height * ratio ? "top" : "bottom";
    return clientX < rect.left + rect.width * ratio ? "left" : "right";
  }

  // 상단 탭을 본문 칸에 끌어다 놓았을 때 수행할 상태 전이를 DOM과 분리해 결정한다.
  // mateId 는 분할 진입 시 반대편에 세울 짝(직전에 보던 문서)이며, 없으면 null.
  function tabDropSplitAction(referenceId, workId, role, draggedId, mateId) {
    const split = referenceId != null && workId != null && referenceId !== workId;
    if (role === "reference") {
      if (draggedId === referenceId) return "keep";
      if (split) return draggedId === workId ? "swap" : "replace-reference";
      if (draggedId === workId) return mateId != null ? "pin-with-mate" : "pin-only";
      return "replace-reference";
    }
    if (split) {
      if (draggedId === workId) return "keep";
      if (draggedId === referenceId) return "swap";
      return "replace-work";
    }
    if (draggedId === workId) return mateId != null ? "mate-as-reference" : "keep";
    return "pin-current";
  }

  // 폴더 드롭에서는 브라우저가 DataTransfer.items만 채우고 files는 비워 둘 수 있다.
  function dataTransferHasFileItems(dataTransfer) {
    if (!dataTransfer) return false;
    if (dataTransfer.files && dataTransfer.files.length) return true;
    const items = dataTransfer.items;
    if (!items || !items.length) return false;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i] && items[i].kind === "file") return true;
    }
    return false;
  }

  function isInternalDragTransfer(dataTransfer, fallbackActive=false) {
    let types = [];
    try { types = dataTransfer && dataTransfer.types ? [...dataTransfer.types] : []; } catch (_) {}
    if (types.includes(INTERNAL_DRAG_MIME)) return true;
    // 외부 파일·폴더는 stale 된 내부 플래그보다 항상 우선한다.
    return !!fallbackActive && !types.includes("Files");
  }

  function droppedTransferNeedsFolderPicker(dataTransfer, files) {
    const batch = files ? [...files] : [];
    let fileItems = [];
    try {
      fileItems = dataTransfer && dataTransfer.items
        ? [...dataTransfer.items].filter(item => item && item.kind === "file")
        : [];
    } catch (_) {}
    if (!batch.length) return fileItems.length > 0;
    if (batch.length !== 1 || fileItems.length > 1) return false;
    const file = batch[0];
    return !!file && Number(file.size) === 0 && !String(file.type || "");
  }

  // 드롭 항목은 이벤트가 끝난 뒤 무효화될 수 있으므로 엔트리와 핸들 Promise를 즉시 확보한다.
  function captureDroppedFileItems(dataTransfer) {
    const files = dataTransfer && dataTransfer.files ? [...dataTransfer.files] : [];
    const items = dataTransfer && dataTransfer.items ? [...dataTransfer.items] : [];
    const entries = [];
    const handlePromises = [];
    for (const item of items) {
      if (!item || item.kind !== "file") continue;
      const getEntry = typeof item.getAsEntry === "function"
        ? item.getAsEntry
        : (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry : null);
      let entry = null;
      try { entry = getEntry ? getEntry.call(item) : null; } catch (_) {}
      if (entry) entries.push(entry);
      if (typeof item.getAsFileSystemHandle === "function") {
        try {
          handlePromises.push(Promise.resolve(item.getAsFileSystemHandle()).catch(() => null));
        } catch (_) {
          handlePromises.push(Promise.resolve(null));
        }
      }
    }
    return { files, entries, handlePromises };
  }

  // 참고 잠금 중 포인터 입력은 읽기·선택 표면만 통과시킨다.
  // 표는 한 번 클릭 선택까지만 허용하고, 편집 진입인 더블클릭·메뉴는 차단한다.
  function studyReadonlyPointerAllowed(surface, eventType) {
    if (surface === "content" || surface === "text-selection" || surface === "code-link") return true;
    if (surface === "sheet-selection") return eventType === "pointerdown" || eventType === "click";
    return false;
  }

  // 참고 잠금 중 텍스트 선택·복사와 문서 탐색에 필요한 키만 허용한다.
  function studyReadonlyKeyAllowed(eventLike={}) {
    const key = String(eventLike.key || "").toLowerCase();
    if ((eventLike.ctrlKey || eventLike.metaKey) && ["a", "c", "f", "g"].includes(key)) return true;
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "pageup", "pagedown", "home", "end", "escape", "tab", "f3"].includes(key)) return true;
    return key === " " && !eventLike.textEntry && !eventLike.activationControl;
  }

  return {
    decodeWorkspace, encodeWorkspace, escapeAttr, escapeHtml, inlineMarkdown, indexWorkspacePathsByFolder,
    detectCsvDelimiter, detectTextEncoding, indexCsvRows, parseCsvRecord,
    fingerprintBytes, formatZipOpenSummary, inferPythonLocalImportRoots, inferPythonProjectRunContext, isExternalRef, markdownToHtml, latexToMathML, sanitizeHtml, htmlTagAllowed, htmlAttrAllowed, htmlSanitizeUrl, htmlSanitizeStyle, normalizeWorkspacePath,
    pythonRelativePathLiterals, pythonRunScopeIncludesPath, resolveProjectRelativePath, resolveRuntimeOutputPath, resolveSiblingPath, safeArchivePath, safeLink,
    windowsAbsolutePathLiterals, windowsAbsolutePathTouchesFolder,
    workspaceFolderMarkerPath, workspaceFolderPathFromMarker, workspaceImageSkipMarkerPath, workspaceImageSkipFolderPath,
    workspaceOriginalSaveMarkerPath, workspaceOriginalSaveFolderPath,
    transformEditorLines, transformSelectedTextCase, pythonCompletionCandidates, pythonMemberCompletionCandidates, completionWordsForProfile, pythonImportCompletionCandidates, pythonWorkspaceImportCompletionCandidates, pythonWorkspaceModuleIndex, pythonWorkspaceImportRowsFromIndex, pythonWorkspaceModuleRowsFromIndex, pythonModuleBindings, pythonImportStatements, pythonWorkspaceImportAnalysis, pythonWorkspaceImportProblems, pythonImportCheckTargets, pythonJediImportProblems, pythonImportContextAt, pythonCompletionInferenceSource, normalizeIdentifierSelection, pythonBracketContentSelection, findNextIdentifierOccurrence, identifierOccurrences,
    diffTextEdit, remapTextRangesAfterEdit, editorHistoryCaretState, applyLinkedIdentifierEdit, pythonLineOpensBlock, lightReindentPython, pythonOpenClosePlan, completionReplacementRange, completionInsertionPlan, completionApplicationPlan, closingBracketTabPlan,
    lineNumberAtOffset, lineStartOffset, findPythonLocalDefinition, resolvePythonImportedDefinition, parsePythonTracebackLocations, parsePythonTracebackLocation, classifyPythonStderr, pythonStderrDisplayKind, pythonStderrShouldBuffer, explainPythonError, contentMatchSnippet,
    suggestRegexPatterns, countRegexMatches, normalizeShortcut, shortcutFromEventLike, shortcutMatchesEvent, documentEdgeShortcutCommand, pythonOutputShortcutCommand,
    normalizePythonVariables, normalizeAssignmentTests, normalizeGradingOutput, assignmentGradingErrorText,
    normalizePythonDiagnostics, normalizePythonUnusedRanges, normalizePythonTraceReport, prettyPrintJsonText, jsonTreeNodeInfo, orderHwpxSections,
    officeXmlDecodeText, officeXmlTextRuns, officeXmlParagraphLines, renderedTextMatchSegments,
    studyPaneSelectionAction, studyReadonlyPointerAllowed, studyReadonlyKeyAllowed, studySplitEndKeepId,
    splitDropRoleForSide, splitDropSideAtPoint, tabDropSplitAction, dataTransferHasFileItems, captureDroppedFileItems,
    INTERNAL_DRAG_MIME, isInternalDragTransfer, droppedTransferNeedsFolderPicker
  };
});
