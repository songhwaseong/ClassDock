(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PdfSignerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeWorkspacePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  const WORKSPACE_FOLDER_MARKER = ".manneung-folder-keep-9f4d2a7b";
  const WORKSPACE_IMAGE_SKIP_MARKER = ".manneung-images-skipped-4e72c1b9";
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

  // 텍스트 파일의 바이트 패턴으로 저장 인코딩을 판별한다.
  // ASCII만 있는 파일은 원래 코드페이지를 확정할 수 없으므로 "ASCII 호환"으로 표시한다.
  function detectTextEncoding(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const result = (encoding, label, shortLabel, extra={}) => ({
      encoding, label, shortLabel: shortLabel || label, bom: !!extra.bom,
      empty: !!extra.empty, uncertain: !!extra.uncertain
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

  function pythonCompletionCandidates(source, prefix) {
    const query = String(prefix || "");
    const ranked = new Map();
    const identifier = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
    let match;
    while ((match = identifier.exec(String(source || "")))) {
      const word = match[0];
      if (!ranked.has(word)) ranked.set(word, 0);
    }
    for (const word of PYTHON_COMPLETION_WORDS) if (!ranked.has(word)) ranked.set(word, 1);
    return [...ranked]
      .filter(([word]) => word !== query && (!query || word.startsWith(query)))
      .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .map(([word]) => word);
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

  function parsePythonTracebackLocation(stderr, preferredFile, knownFiles=[]) {
    const text = String(stderr || "");
    const preferred = String(preferredFile || "").replace(/\\/g, "/").split("/").pop();
    const known = new Set((knownFiles || []).map((name) => String(name || "").replace(/\\/g, "/").split("/").pop()).filter(Boolean));
    if (preferred) known.add(preferred);
    const pseudo = new Set(["<exec>", "<string>", "<stdin>", "script.py"]);
    const frames = [];
    const re = /File "([^"]*)", line (\d+)/g;
    let match;
    while ((match = re.exec(text))) {
      const path = match[1].replace(/\\/g, "/");
      const file = path.split("/").pop() || path;
      frames.push({ path, file, line: parseInt(match[2], 10) || 0 });
    }
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i];
      if (pseudo.has(frame.path) || pseudo.has(frame.file)) return { ...frame, current: true };
      if (known.has(frame.file)) return { ...frame, current: !preferred || frame.file === preferred };
    }
    return null;
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
    const callable = String(info.type || "").toLowerCase() === "function";
    const hasOpenParenthesis = callable && text.charAt(end) === "(";
    return {
      text: name + (callable && !hasOpenParenthesis ? "()" : ""),
      caret: start + name.length + (callable ? 1 : 0)
    };
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
      if (c === "\\"){
        if (/[a-zA-Z]/.test(s[i + 1] || "")){
          let j = i + 1; while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
          toks.push({ t:"cmd", v:s.slice(i + 1, j) }); i = j;
        } else { toks.push({ t:"cmd", v:s[i + 1] || "" }); i += 2; }
      } else if (c === "{"){ toks.push({ t:"{" }); i++; }
      else if (c === "}"){ toks.push({ t:"}" }); i++; }
      else if (c === "^"){ toks.push({ t:"^" }); i++; }
      else if (c === "_"){ toks.push({ t:"_" }); i++; }
      else if (c === " " || c === "\t" || c === "\n"){ toks.push({ t:"sp" }); i++; }
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
      if (tk.t === "sp"){ st.pos++; continue; }
      const atom = texAtom(st);
      if (!atom) continue;
      const node = texScripts(st, atom.mml, atom.big);
      out.push(atom.fn && texNextIsOperand(st) ? node + "<mspace width=\"0.17em\"/>" : node);
    }
    return out;
  }
  function latexToMathML(tex, display){
    const attrs = "xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"" + (display ? "block" : "inline") + "\"";
    try {
      const st = { toks:texTokenize(String(tex || "")), pos:0, display:!!display };
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
    workspaceFolderMarkerPath, workspaceFolderPathFromMarker, workspaceImageSkipMarkerPath, workspaceImageSkipFolderPath,
    transformEditorLines, pythonCompletionCandidates, normalizeIdentifierSelection, findNextIdentifierOccurrence, identifierOccurrences,
    diffTextEdit, applyLinkedIdentifierEdit, pythonOpenClosePlan, completionReplacementRange, completionInsertionPlan,
    lineNumberAtOffset, lineStartOffset, findPythonLocalDefinition, parsePythonTracebackLocation, classifyPythonStderr, explainPythonError, contentMatchSnippet,
    suggestRegexPatterns, countRegexMatches, normalizeShortcut, shortcutFromEventLike, shortcutMatchesEvent,
    normalizePythonVariables, normalizeAssignmentTests, normalizeGradingOutput, assignmentGradingErrorText,
    normalizePythonDiagnostics, normalizePythonTraceReport, prettyPrintJsonText, jsonTreeNodeInfo, orderHwpxSections,
    studyPaneSelectionAction, studyReadonlyPointerAllowed, studyReadonlyKeyAllowed
  };
});
