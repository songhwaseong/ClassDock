"use strict";

const MNSpreadsheetFormula = (() => {
  function spreadsheetColumnName(index){
    let n = index + 1, s = "";
    while (n > 0){
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  const FORMULA_ERR = (code) => ({ __err: code });
  function isFormulaError(v){ return !!(v && typeof v === "object" && typeof v.__err === "string"); }
  function spreadsheetDateSerial(d){ return 25569 + (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000; }
  // 엑셀 직렬값 ↔ 달력 구성요소(spreadsheetDateSerial 과 동일 규약: 벽시계 기준)
  function spreadsheetDateToSerial(y, m, d, hh, mm, ss){ return 25569 + Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0) / 86400000; }
  function spreadsheetSerialToParts(serial){
    const dt = new Date(Math.round((serial - 25569) * 86400000));
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay(), hh: dt.getUTCHours(), mm: dt.getUTCMinutes(), ss: dt.getUTCSeconds() };
  }
  // 간단 숫자/날짜 서식(TEXT 함수용) — 자주 쓰는 패턴만 지원
  function spreadsheetFormatByPattern(value, pattern){
    const p = String(pattern);
    if (/[ymdhs]/i.test(p) && !/[#0]/.test(p)){          // 날짜 서식
      const n = Number(value); if (!isFinite(n)) return String(value);
      const t = spreadsheetSerialToParts(n), pad = (x, w) => String(x).padStart(w, "0");
      return p
        .replace(/yyyy/gi, t.y).replace(/yy/gi, pad(t.y % 100, 2))
        .replace(/mm/g, pad(t.mo, 2)).replace(/m(?![ap])/gi, t.mo)
        .replace(/dd/gi, pad(t.d, 2)).replace(/d/gi, t.d)
        .replace(/hh/gi, pad(t.hh, 2)).replace(/ss/gi, pad(t.ss, 2));
    }
    const n = Number(value); if (!isFinite(n)) return String(value);
    if (/%/.test(p)){ const dec = (p.split(".")[1] || "").length; return (n * 100).toFixed(dec) + "%"; }
    const dec = (p.split(".")[1] || "").replace(/[^0#]/g, "").length;
    let s = n.toFixed(dec);
    if (/,/.test(p)){ const [ip, fp] = s.split("."); s = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fp ? "." + fp : ""); }
    return s;
  }
  function formulaColumnIndex(letters){
    let n = 0;
    for (const ch of String(letters).toUpperCase()){ if (ch < "A" || ch > "Z") return -1; n = n * 26 + (ch.charCodeAt(0) - 64); }
    return n - 1;
  }
  function parseA1Ref(ref){
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
    if (!m) return null;
    return { c: formulaColumnIndex(m[1]), r: Number(m[2]) - 1 };
  }
  function tokenizeFormula(input){
    const specs = [
      ["ws", /^\s+/],
      ["num", /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/],
      ["str", /^"(?:[^"]|"")*"/],
      ["sheetq", /^'(?:[^']|'')*'/],                       // 따옴표로 감싼 시트 이름: 'My Sheet'
      ["err", /^#(?:REF!|DIV\/0!|NAME\?|VALUE!|NUM!|N\/A|NULL!|CYCLE!|ERROR!)/i],
      ["op", /^(?:<=|>=|<>|[-+*/^&<>=(),:%!])/],
      ["ref", /^\$?[A-Za-z]{1,3}\$?\d+/],
      ["name", /^[A-Za-z_ㄱ-ㆎ가-힣][A-Za-z0-9_.ㄱ-ㆎ가-힣]*/]
    ];
    const toks = []; let s = String(input);
    while (s.length){
      let matched = false;
      for (const [type, re] of specs){
        const m = re.exec(s); if (!m) continue;
        s = s.slice(m[0].length); matched = true;
        if (type !== "ws") toks.push({ type, text: m[0] });
        break;
      }
      if (!matched) throw new Error("수식 토큰 오류: " + s[0]);
    }
    return toks;
  }
  function parseFormula(input){
    const toks = tokenizeFormula(input);
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];
    const expect = (t) => { const tk = next(); if (!tk || tk.text !== t) throw new Error("수식 구문 오류: " + t + " 기대"); };
    const parseExpr = () => parseCompare();
    function parseCompare(){
      let node = parseConcat();
      while (peek() && peek().type === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().text)){
        const op = next().text; node = { t:"bin", op, a:node, b:parseConcat() };
      }
      return node;
    }
    function parseConcat(){
      let node = parseAdd();
      while (peek() && peek().text === "&"){ next(); node = { t:"bin", op:"&", a:node, b:parseAdd() }; }
      return node;
    }
    function parseAdd(){
      let node = parseMul();
      while (peek() && (peek().text === "+" || peek().text === "-")){ const op = next().text; node = { t:"bin", op, a:node, b:parseMul() }; }
      return node;
    }
    function parseMul(){
      let node = parsePow();
      while (peek() && (peek().text === "*" || peek().text === "/")){ const op = next().text; node = { t:"bin", op, a:node, b:parsePow() }; }
      return node;
    }
    function parsePow(){
      let node = parseUnary();
      if (peek() && peek().text === "^"){ next(); node = { t:"bin", op:"^", a:node, b:parsePow() }; }   // 우결합
      return node;
    }
    function parseUnary(){
      if (peek() && (peek().text === "-" || peek().text === "+")){ const op = next().text; return { t:"unary", op, x:parseUnary() }; }
      return parsePostfix();
    }
    function parsePostfix(){
      let node = parsePrimary();
      while (peek() && peek().text === "%"){ next(); node = { t:"unary", op:"%", x:node }; }
      return node;
    }
    function parsePrimary(){
      const tk = peek();
      if (!tk) throw new Error("수식이 갑자기 끝남");
      if (tk.type === "num"){ next(); return { t:"num", v:Number(tk.text) }; }
      if (tk.type === "str"){ next(); return { t:"str", v:tk.text.slice(1, -1).replace(/""/g, '"') }; }
      if (tk.type === "err"){ next(); return { t:"errlit", code:tk.text.toUpperCase() }; }
      if (tk.text === "("){ next(); const e = parseExpr(); expect(")"); return e; }
      // sheetName!Ref / 'sheet name'!Ref (시트 간 참조)
      const refWithSheet = (sheet) => {
        const rt = next();
        if (!rt || rt.type !== "ref") throw new Error("시트 참조 뒤에 셀이 와야 함");
        const a = parseA1Ref(rt.text); if (!a) throw new Error("셀 참조 오류");
        if (peek() && peek().text === ":" && toks[i + 1] && toks[i + 1].type === "ref"){
          next(); const b = parseA1Ref(next().text);
          return { t:"range", c1:a.c, r1:a.r, c2:b.c, r2:b.r, sheet };
        }
        return { t:"ref", c:a.c, r:a.r, sheet };
      };
      if (tk.type === "sheetq"){
        next(); expect("!");
        return refWithSheet(tk.text.slice(1, -1).replace(/''/g, "'"));
      }
      if (tk.type === "ref"){
        next(); const a = parseA1Ref(tk.text); if (!a) throw new Error("셀 참조 오류");
        if (peek() && peek().text === ":" && toks[i + 1] && toks[i + 1].type === "ref"){
          next(); const b = parseA1Ref(next().text);
          return { t:"range", c1:a.c, r1:a.r, c2:b.c, r2:b.r };
        }
        return { t:"ref", c:a.c, r:a.r };
      }
      if (tk.type === "name"){
        next(); const up = tk.text.toUpperCase();
        if (peek() && peek().text === "!") { next(); return refWithSheet(tk.text); }   // Sheet1!A1
        if (peek() && peek().text === "("){
          next(); const args = [];
          if (peek() && peek().text !== ")"){ args.push(parseExpr()); while (peek() && peek().text === ","){ next(); args.push(parseExpr()); } }
          expect(")");
          return { t:"call", name:up, args };
        }
        if (up === "TRUE") return { t:"bool", v:true };
        if (up === "FALSE") return { t:"bool", v:false };
        return { t:"nameref", name:up };
      }
      throw new Error("예상치 못한 토큰: " + tk.text);
    }
    const ast = parseExpr();
    if (i < toks.length) throw new Error("수식에 남는 토큰이 있음");
    return ast;
  }
  function formulaToNumber(v){
    if (isFormulaError(v)) return v;
    if (Array.isArray(v)) return v.length ? formulaToNumber(v[0]) : 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === "" || v == null) return 0;
    if (typeof v === "string"){ const t = v.trim(); if (t === "") return 0; const n = Number(t); return (!isNaN(n) && isFinite(n)) ? n : FORMULA_ERR("#VALUE!"); }
    return FORMULA_ERR("#VALUE!");
  }
  function formulaToString(v){
    if (isFormulaError(v)) return v;
    if (Array.isArray(v)) return v.length ? formulaToString(v[0]) : "";
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v);
  }
  function formulaToBool(v){
    if (isFormulaError(v)) return v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string"){ if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; return v !== ""; }
    return !!v;
  }
  function evaluateAst(ast, resolver){
    const res = resolver || (() => "");
    const scal = (v) => Array.isArray(v) ? (v.length ? v[0] : "") : v;
    const flat = (vals) => { const o = []; vals.forEach(v => Array.isArray(v) ? o.push(...v) : o.push(v)); return o; };
    const collectNumbers = (vals) => {
      let err = null; const ns = [];
      flat(vals).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (typeof v === "number") ns.push(v); });
      return { ns, err };
    };
    // 조회(VLOOKUP/MATCH)용 비교 — 숫자끼리는 수치, 그 외는 대소문자 무시 문자열
    const lookupEqual = (a, b) => (typeof a === "number" && typeof b === "number") ? a === b
      : formulaToString(a).toLowerCase() === formulaToString(b).toLowerCase();
    const lookupCompare = (a, b) => {
      if (typeof a === "number" && typeof b === "number") return a - b;
      const sa = formulaToString(a).toLowerCase(), sb = formulaToString(b).toLowerCase();
      return sa < sb ? -1 : (sa > sb ? 1 : 0);
    };
    const makeCriteria = (crit) => {
      if (isFormulaError(crit)) crit = "";
      if (typeof crit === "number") return (v) => (typeof v === "number" ? v === crit : Number(v) === crit);
      const s = String(crit); const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(s); const op = m[1] || "="; const rhs = m[2];
      const rn = Number(rhs.trim()); const rhsIsNum = rhs.trim() !== "" && !isNaN(rn) && isFinite(rn);
      return (v) => {
        if (rhsIsNum){
          const n = (typeof v === "number") ? v : Number(String(v).trim());
          if (isNaN(n) || !isFinite(n)) return op === "<>";
          switch (op){ case "=": return n === rn; case "<>": return n !== rn; case "<": return n < rn; case ">": return n > rn; case "<=": return n <= rn; case ">=": return n >= rn; }
        }
        const sv = formulaToString(v);
        switch (op){ case "=": return sv === rhs; case "<>": return sv !== rhs; case "<": return sv < rhs; case ">": return sv > rhs; case "<=": return sv <= rhs; case ">=": return sv >= rhs; }
        return false;
      };
    };
    const ev = (node) => {
      switch (node.t){
        case "num": return node.v;
        case "str": return node.v;
        case "bool": return node.v;
        case "errlit": return FORMULA_ERR(node.code);
        case "nameref": return FORMULA_ERR("#NAME?");
        case "ref": return res(node.c, node.r, node.sheet);
        case "range": {
          const out = []; const r1 = Math.min(node.r1, node.r2), r2 = Math.max(node.r1, node.r2), c1 = Math.min(node.c1, node.c2), c2 = Math.max(node.c1, node.c2);
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(res(c, r, node.sheet));
          out.__rows = r2 - r1 + 1; out.__cols = c2 - c1 + 1;   // VLOOKUP/INDEX/MATCH 용 2차원 형태 정보
          return out;
        }
        case "unary": {
          const x = formulaToNumber(scal(ev(node.x)));
          if (isFormulaError(x)) return x;
          if (node.op === "%") return x / 100;
          return node.op === "-" ? -x : x;
        }
        case "bin": return evBin(node);
        case "call": return evCall(node);
      }
      return FORMULA_ERR("#ERROR!");
    };
    const evBin = (node) => {
      const op = node.op;
      if (op === "&"){ const a = formulaToString(scal(ev(node.a))); if (isFormulaError(a)) return a; const b = formulaToString(scal(ev(node.b))); if (isFormulaError(b)) return b; return a + b; }
      if (["=", "<>", "<", ">", "<=", ">="].includes(op)){
        const a = scal(ev(node.a)), b = scal(ev(node.b));
        if (isFormulaError(a)) return a; if (isFormulaError(b)) return b;
        let cmp;
        if (typeof a === "number" && typeof b === "number") cmp = a - b;
        else cmp = String(a == null ? "" : a).localeCompare(String(b == null ? "" : b));
        switch (op){ case "=": return cmp === 0; case "<>": return cmp !== 0; case "<": return cmp < 0; case ">": return cmp > 0; case "<=": return cmp <= 0; case ">=": return cmp >= 0; }
      }
      const a = formulaToNumber(scal(ev(node.a))); if (isFormulaError(a)) return a;
      const b = formulaToNumber(scal(ev(node.b))); if (isFormulaError(b)) return b;
      switch (op){ case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return b === 0 ? FORMULA_ERR("#DIV/0!") : a / b; case "^": return Math.pow(a, b); }
      return FORMULA_ERR("#ERROR!");
    };
    const evCall = (node) => {
      const A = () => node.args.map(ev);
      const num1 = (args, k, dflt) => formulaToNumber(scal(args[k] !== undefined ? args[k] : dflt));
      switch (node.name){
        case "SUM": { const { ns, err } = collectNumbers(A()); return err || ns.reduce((s, n) => s + n, 0); }
        case "PRODUCT": { const { ns, err } = collectNumbers(A()); return err || ns.reduce((s, n) => s * n, 1); }
        case "AVERAGE": case "AVG": { const { ns, err } = collectNumbers(A()); return err || (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : FORMULA_ERR("#DIV/0!")); }
        case "MIN": { const { ns, err } = collectNumbers(A()); return err || (ns.length ? Math.min(...ns) : 0); }
        case "MAX": { const { ns, err } = collectNumbers(A()); return err || (ns.length ? Math.max(...ns) : 0); }
        case "COUNT": { const { ns, err } = collectNumbers(A()); return err || ns.length; }
        case "COUNTA": { let err = null, n = 0; flat(A()).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (!(v === "" || v == null)) n++; }); return err || n; }
        case "COUNTBLANK": { let n = 0; flat(A()).forEach(v => { if (v === "" || v == null) n++; }); return n; }
        case "IF": { const args = A(); const c = formulaToBool(scal(args[0])); if (isFormulaError(c)) return c; return c ? scal(args[1] !== undefined ? args[1] : true) : (args.length > 2 ? scal(args[2]) : false); }
        case "IFERROR": { const v = ev(node.args[0]); return isFormulaError(v) ? (node.args[1] !== undefined ? scal(ev(node.args[1])) : "") : scal(v); }
        case "AND": { let err = null, r = true; flat(A()).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (!formulaToBool(v)) r = false; }); return err || r; }
        case "OR": { let err = null, r = false; flat(A()).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (formulaToBool(v)) r = true; }); return err || r; }
        case "NOT": { const v = formulaToBool(scal(A()[0])); return isFormulaError(v) ? v : !v; }
        case "ROUND": { const args = A(); const x = num1(args, 0); if (isFormulaError(x)) return x; const d = num1(args, 1, 0); if (isFormulaError(d)) return d; const f = Math.pow(10, d); return Math.round(x * f) / f; }
        case "ROUNDUP": { const args = A(); const x = num1(args, 0); if (isFormulaError(x)) return x; const d = num1(args, 1, 0); const f = Math.pow(10, d); return (x < 0 ? -1 : 1) * Math.ceil(Math.abs(x) * f) / f; }
        case "ROUNDDOWN": { const args = A(); const x = num1(args, 0); if (isFormulaError(x)) return x; const d = num1(args, 1, 0); const f = Math.pow(10, d); return (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) * f) / f; }
        case "ABS": { const x = num1(A(), 0); return isFormulaError(x) ? x : Math.abs(x); }
        case "INT": { const x = num1(A(), 0); return isFormulaError(x) ? x : Math.floor(x); }
        case "SQRT": { const x = num1(A(), 0); if (isFormulaError(x)) return x; return x < 0 ? FORMULA_ERR("#NUM!") : Math.sqrt(x); }
        case "MOD": { const args = A(); const a = num1(args, 0); if (isFormulaError(a)) return a; const b = num1(args, 1); if (isFormulaError(b)) return b; return b === 0 ? FORMULA_ERR("#DIV/0!") : ((a % b) + b) % b; }
        case "POWER": { const args = A(); const a = num1(args, 0); if (isFormulaError(a)) return a; const b = num1(args, 1); if (isFormulaError(b)) return b; return Math.pow(a, b); }
        case "LEN": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.length; }
        case "LEFT": { const args = A(); const s = formulaToString(scal(args[0])); if (isFormulaError(s)) return s; const n = args[1] !== undefined ? num1(args, 1) : 1; return s.slice(0, Math.max(0, n)); }
        case "RIGHT": { const args = A(); const s = formulaToString(scal(args[0])); if (isFormulaError(s)) return s; const n = args[1] !== undefined ? num1(args, 1) : 1; return n <= 0 ? "" : s.slice(-n); }
        case "MID": { const args = A(); const s = formulaToString(scal(args[0])); if (isFormulaError(s)) return s; const st = num1(args, 1); const ln = num1(args, 2); return s.substr(Math.max(0, st - 1), Math.max(0, ln)); }
        case "TRIM": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.replace(/\s+/g, " ").trim(); }
        case "UPPER": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.toUpperCase(); }
        case "LOWER": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.toLowerCase(); }
        case "CONCAT": case "CONCATENATE": { let out = ""; for (const v of flat(A())){ if (isFormulaError(v)) return v; out += formulaToString(v); } return out; }
        case "COUNTIF": { if (node.args.length < 2) return FORMULA_ERR("#VALUE!"); const rng = flat([ev(node.args[0])]); const crit = makeCriteria(scal(ev(node.args[1]))); let n = 0; for (const v of rng){ if (isFormulaError(v)) continue; if (crit(v)) n++; } return n; }
        case "SUMIF": { if (node.args.length < 2) return FORMULA_ERR("#VALUE!"); const rng = flat([ev(node.args[0])]); const crit = makeCriteria(scal(ev(node.args[1]))); const sr = node.args[2] !== undefined ? flat([ev(node.args[2])]) : rng; let s = 0; for (let k = 0; k < rng.length; k++){ if (crit(rng[k])){ const n = sr[k]; if (typeof n === "number") s += n; } } return s; }
        case "AVERAGEIF": { const rng = flat([ev(node.args[0])]); const crit = makeCriteria(scal(ev(node.args[1]))); const ar = node.args[2] !== undefined ? flat([ev(node.args[2])]) : rng; let s = 0, cnt = 0; for (let k = 0; k < rng.length; k++){ if (crit(rng[k])){ const n = ar[k]; if (typeof n === "number"){ s += n; cnt++; } } } return cnt ? s / cnt : FORMULA_ERR("#DIV/0!"); }
        case "VLOOKUP": case "HLOOKUP": {
          const args = node.args; if (args.length < 3) return FORMULA_ERR("#VALUE!");
          const key = scal(ev(args[0])); if (isFormulaError(key)) return key;
          const table = ev(args[1]); if (!Array.isArray(table) || !table.__rows) return FORMULA_ERR("#VALUE!");
          const idx = formulaToNumber(scal(ev(args[2]))); if (isFormulaError(idx)) return idx;
          const approx = args[3] !== undefined ? formulaToBool(scal(ev(args[3]))) : true;
          const rows = table.__rows, cols = table.__cols, cell = (r, c) => table[r * cols + c];
          const isV = node.name === "VLOOKUP";
          const lanes = isV ? rows : cols;                 // 검색 방향 길이(세로: 행, 가로: 열)
          const otherMax = isV ? cols : rows;              // 반환 인덱스 최대
          if (idx < 1 || idx > otherMax) return FORMULA_ERR("#REF!");
          const keyAt = (i) => isV ? cell(i, 0) : cell(0, i);
          let found = -1;
          if (approx){ for (let i = 0; i < lanes; i++){ const v = keyAt(i); if (isFormulaError(v)) continue; if (lookupCompare(v, key) <= 0) found = i; else break; } }
          else { for (let i = 0; i < lanes; i++){ const v = keyAt(i); if (!isFormulaError(v) && lookupEqual(v, key)){ found = i; break; } } }
          if (found < 0) return FORMULA_ERR("#N/A");
          return isV ? cell(found, idx - 1) : cell(idx - 1, found);
        }
        case "MATCH": {
          const args = node.args; if (args.length < 2) return FORMULA_ERR("#VALUE!");
          const key = scal(ev(args[0])); if (isFormulaError(key)) return key;
          const arr = flat([ev(args[1])]);
          const type = args[2] !== undefined ? formulaToNumber(scal(ev(args[2]))) : 1;
          if (type === 0){ for (let i = 0; i < arr.length; i++){ if (!isFormulaError(arr[i]) && lookupEqual(arr[i], key)) return i + 1; } return FORMULA_ERR("#N/A"); }
          let pos = -1;
          for (let i = 0; i < arr.length; i++){ const v = arr[i]; if (isFormulaError(v)) continue; const cmp = lookupCompare(v, key); if (type >= 1 ? cmp <= 0 : cmp >= 0) pos = i; else break; }
          return pos < 0 ? FORMULA_ERR("#N/A") : pos + 1;
        }
        case "INDEX": {
          const args = node.args; const arr = ev(args[0]);
          if (!Array.isArray(arr)) return isFormulaError(arr) ? arr : arr;
          const rows = arr.__rows || 1, cols = arr.__cols || arr.length;
          const a1 = formulaToNumber(scal(ev(args[1]))); if (isFormulaError(a1)) return a1;
          if (args[2] !== undefined){                      // INDEX(범위, 행, 열)
            const a2 = formulaToNumber(scal(ev(args[2]))); if (isFormulaError(a2)) return a2;
            if (a1 < 1 || a1 > rows || a2 < 1 || a2 > cols) return FORMULA_ERR("#REF!");
            return arr[(a1 - 1) * cols + (a2 - 1)];
          }
          if (a1 < 1 || a1 > arr.length) return FORMULA_ERR("#REF!");   // 1차원(행/열 벡터)
          return arr[a1 - 1];
        }
        case "TODAY": return Math.floor(spreadsheetDateSerial(new Date()));
        case "NOW": return spreadsheetDateSerial(new Date());
        // ----- 날짜 -----
        case "DATE": { const a = A(); const y = num1(a, 0), m = num1(a, 1), d = num1(a, 2); if (isFormulaError(y)) return y; if (isFormulaError(m)) return m; if (isFormulaError(d)) return d; return spreadsheetDateToSerial(y, m, d); }
        case "YEAR": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).y; }
        case "MONTH": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).mo; }
        case "DAY": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).d; }
        case "HOUR": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).hh; }
        case "MINUTE": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).mm; }
        case "SECOND": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).ss; }
        case "WEEKDAY": { const a = A(); const x = num1(a, 0); if (isFormulaError(x)) return x; const type = a[1] !== undefined ? num1(a, 1) : 1; const wd = spreadsheetSerialToParts(x).wd; return type === 2 ? (wd === 0 ? 7 : wd) : (type === 3 ? (wd + 6) % 7 : wd + 1); }
        case "EDATE": { const a = A(); const x = num1(a, 0); if (isFormulaError(x)) return x; const mo = num1(a, 1); if (isFormulaError(mo)) return mo; const t = spreadsheetSerialToParts(x); return spreadsheetDateToSerial(t.y, t.mo + mo, t.d, t.hh, t.mm, t.ss); }
        case "DATEDIF": { const a = A(); const s1 = num1(a, 0), s2 = num1(a, 1); if (isFormulaError(s1)) return s1; if (isFormulaError(s2)) return s2; const p1 = spreadsheetSerialToParts(s1), p2 = spreadsheetSerialToParts(s2); const unit = formulaToString(scal(a[2])).toUpperCase(); if (unit === "D") return Math.floor(s2 - s1); if (unit === "M") return (p2.y - p1.y) * 12 + (p2.mo - p1.mo) - (p2.d < p1.d ? 1 : 0); if (unit === "Y") { let yr = p2.y - p1.y; if (p2.mo < p1.mo || (p2.mo === p1.mo && p2.d < p1.d)) yr--; return yr; } return FORMULA_ERR("#NUM!"); }
        // ----- 텍스트 -----
        case "TEXT": { const a = A(); const v = scal(a[0]); if (isFormulaError(v)) return v; return spreadsheetFormatByPattern(v, formulaToString(scal(a[1]))); }
        case "VALUE": { const s = formulaToString(scal(A()[0])); if (isFormulaError(s)) return s; const n = Number(String(s).replace(/[,\s₩$€£¥%]/g, "")); return isFinite(n) ? n : FORMULA_ERR("#VALUE!"); }
        case "SUBSTITUTE": { const a = A(); const s = formulaToString(scal(a[0])); if (isFormulaError(s)) return s; const oldT = formulaToString(scal(a[1])), newT = formulaToString(scal(a[2])); if (oldT === "") return s; if (a[3] !== undefined){ const inst = num1(a, 3); let k = 0; let idx = -1; let from = 0; while ((idx = s.indexOf(oldT, from)) >= 0){ k++; if (k === inst) return s.slice(0, idx) + newT + s.slice(idx + oldT.length); from = idx + oldT.length; } return s; } return s.split(oldT).join(newT); }
        case "REPLACE": { const a = A(); const s = formulaToString(scal(a[0])); if (isFormulaError(s)) return s; const start = num1(a, 1), len = num1(a, 2), newT = formulaToString(scal(a[3])); return s.slice(0, Math.max(0, start - 1)) + newT + s.slice(Math.max(0, start - 1) + Math.max(0, len)); }
        case "FIND": { const a = A(); const sub = formulaToString(scal(a[0])), s = formulaToString(scal(a[1])); if (isFormulaError(sub)) return sub; if (isFormulaError(s)) return s; const start = a[2] !== undefined ? num1(a, 2) : 1; const idx = s.indexOf(sub, Math.max(0, start - 1)); return idx < 0 ? FORMULA_ERR("#VALUE!") : idx + 1; }
        case "SEARCH": { const a = A(); const sub = formulaToString(scal(a[0])).toLowerCase(), s = formulaToString(scal(a[1])).toLowerCase(); const start = a[2] !== undefined ? num1(a, 2) : 1; const idx = s.indexOf(sub, Math.max(0, start - 1)); return idx < 0 ? FORMULA_ERR("#VALUE!") : idx + 1; }
        case "REPT": { const a = A(); const s = formulaToString(scal(a[0])); if (isFormulaError(s)) return s; const n = num1(a, 1); return n > 0 ? s.repeat(Math.min(10000, Math.floor(n))) : ""; }
        case "PROPER": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\B\w/g, ch => ch.toLowerCase()); }
        case "EXACT": { const a = A(); return formulaToString(scal(a[0])) === formulaToString(scal(a[1])); }
        case "TEXTJOIN": { const a = A(); const delim = formulaToString(scal(a[0])); const ignoreEmpty = a[1] !== undefined ? formulaToBool(scal(a[1])) : true; const parts = []; for (const v of flat(a.slice(2))){ if (isFormulaError(v)) return v; const sv = formulaToString(v); if (ignoreEmpty && sv === "") continue; parts.push(sv); } return parts.join(delim); }
        // ----- 통계 -----
        case "MEDIAN": { const { ns, err } = collectNumbers(A()); if (err) return err; if (!ns.length) return FORMULA_ERR("#NUM!"); const s = ns.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
        case "STDEV": case "STDEV.S": { const { ns, err } = collectNumbers(A()); if (err) return err; if (ns.length < 2) return FORMULA_ERR("#DIV/0!"); const mean = ns.reduce((s, n) => s + n, 0) / ns.length; return Math.sqrt(ns.reduce((s, n) => s + (n - mean) * (n - mean), 0) / (ns.length - 1)); }
        case "STDEVP": case "STDEV.P": { const { ns, err } = collectNumbers(A()); if (err) return err; if (!ns.length) return FORMULA_ERR("#DIV/0!"); const mean = ns.reduce((s, n) => s + n, 0) / ns.length; return Math.sqrt(ns.reduce((s, n) => s + (n - mean) * (n - mean), 0) / ns.length); }
        case "LARGE": case "SMALL": { const a = node.args; if (a.length < 2) return FORMULA_ERR("#VALUE!"); const { ns, err } = collectNumbers([ev(a[0])]); if (err) return err; const k = formulaToNumber(scal(ev(a[1]))); if (isFormulaError(k)) return k; const ki = Math.floor(k); if (ki < 1 || ki > ns.length) return FORMULA_ERR("#NUM!"); const sorted = ns.slice().sort((x, y) => node.name === "LARGE" ? y - x : x - y); return sorted[ki - 1]; }
        case "RANK": case "RANK.EQ": {   // order 생략/0=내림차순(1등이 최댓값) — 석차 계산용
          const a = node.args; if (a.length < 2) return FORMULA_ERR("#VALUE!");
          const x = formulaToNumber(scal(ev(a[0]))); if (isFormulaError(x)) return x;
          const { ns, err } = collectNumbers([ev(a[1])]); if (err) return err;
          const asc = a[2] !== undefined ? formulaToBool(scal(ev(a[2]))) : false;
          if (!ns.some(v => v === x)) return FORMULA_ERR("#N/A");
          let n = 0; ns.forEach(v => { if (asc ? v < x : v > x) n++; });
          return n + 1;
        }
        // ----- 다중 조건 집계 -----
        case "COUNTIFS": {
          const a = node.args; if (a.length < 2 || a.length % 2) return FORMULA_ERR("#VALUE!");
          const pairs = []; let len = -1;
          for (let k = 0; k < a.length; k += 2){
            const rng = flat([ev(a[k])]); const crit = makeCriteria(scal(ev(a[k + 1])));
            if (len < 0) len = rng.length; else if (rng.length !== len) return FORMULA_ERR("#VALUE!");
            pairs.push({ rng, crit });
          }
          let n = 0;
          for (let i = 0; i < len; i++){ if (pairs.every(p => !isFormulaError(p.rng[i]) && p.crit(p.rng[i]))) n++; }
          return n;
        }
        case "SUMIFS": case "AVERAGEIFS": {
          const a = node.args; if (a.length < 3 || a.length % 2 === 0) return FORMULA_ERR("#VALUE!");
          const vr = flat([ev(a[0])]);
          const pairs = [];
          for (let k = 1; k < a.length; k += 2){
            const rng = flat([ev(a[k])]); const crit = makeCriteria(scal(ev(a[k + 1])));
            if (rng.length !== vr.length) return FORMULA_ERR("#VALUE!");
            pairs.push({ rng, crit });
          }
          let s = 0, cnt = 0;
          for (let i = 0; i < vr.length; i++){
            if (!pairs.every(p => !isFormulaError(p.rng[i]) && p.crit(p.rng[i]))) continue;
            if (typeof vr[i] === "number"){ s += vr[i]; cnt++; }
          }
          return node.name === "SUMIFS" ? s : (cnt ? s / cnt : FORMULA_ERR("#DIV/0!"));
        }
        // ----- 논리·조회 -----
        case "IFS": {
          const a = node.args; if (a.length < 2 || a.length % 2) return FORMULA_ERR("#VALUE!");
          for (let k = 0; k < a.length; k += 2){
            const c = formulaToBool(scal(ev(a[k]))); if (isFormulaError(c)) return c;
            if (c) return scal(ev(a[k + 1]));
          }
          return FORMULA_ERR("#N/A");
        }
        case "CHOOSE": { const a = node.args; if (a.length < 2) return FORMULA_ERR("#VALUE!"); const i = formulaToNumber(scal(ev(a[0]))); if (isFormulaError(i)) return i; const k = Math.floor(i); if (k < 1 || k >= a.length) return FORMULA_ERR("#VALUE!"); return scal(ev(a[k])); }
        case "XLOOKUP": {
          const a = node.args; if (a.length < 3) return FORMULA_ERR("#VALUE!");
          const key = scal(ev(a[0])); if (isFormulaError(key)) return key;
          const la = flat([ev(a[1])]), ra = flat([ev(a[2])]);
          if (!la.length || ra.length !== la.length) return FORMULA_ERR("#VALUE!");
          for (let i = 0; i < la.length; i++){ if (!isFormulaError(la[i]) && lookupEqual(la[i], key)) return ra[i]; }
          return a[3] !== undefined ? scal(ev(a[3])) : FORMULA_ERR("#N/A");
        }
        case "ISBLANK": { if (!node.args.length) return FORMULA_ERR("#VALUE!"); const v = scal(ev(node.args[0])); return !isFormulaError(v) && (v === "" || v == null); }
        case "ISNUMBER": { if (!node.args.length) return FORMULA_ERR("#VALUE!"); const v = scal(ev(node.args[0])); return typeof v === "number"; }
        case "ISTEXT": { if (!node.args.length) return FORMULA_ERR("#VALUE!"); const v = scal(ev(node.args[0])); return typeof v === "string" && v !== ""; }
        case "ISERROR": { if (!node.args.length) return FORMULA_ERR("#VALUE!"); return isFormulaError(ev(node.args[0])); }
        default: return FORMULA_ERR("#NAME?");
      }
    };
    const out = ev(ast);
    return Array.isArray(out) ? (out.length ? out[0] : "") : out;
  }
  // 편의용(테스트/단발 평가): 오류는 "#..." 문자열, 불리언은 TRUE/FALSE 문자열로 반환
  function evaluateFormula(formula, resolver){
    const src = String(formula == null ? "" : formula).replace(/^\s*=/, "");   // 앞의 '=' 는 있어도 됨
    let ast; try { ast = parseFormula(src); } catch(e){ return "#ERROR!"; }
    let r; try { r = evaluateAst(ast, resolver); } catch(e){ return "#ERROR!"; }
    if (isFormulaError(r)) return r.__err;
    if (typeof r === "boolean") return r ? "TRUE" : "FALSE";
    return r;
  }
  // 수식 문자열의 셀 참조를 transform(col, row, {colAbs,rowAbs}) → {c,r}|null 로 재작성.
  // 행/열 삽입·삭제·정렬로 셀이 이동할 때 참조를 따라가게 한다($ 절대표기는 그대로 보존, null 이면 #REF!).
  function remapFormulaRefs(formula, transform, options={}){
    let toks;
    try { toks = tokenizeFormula(formula); } catch(_){ return formula; }
    let out = "", prev = "";
    for (const tk of toks){
      if (tk.type === "ref" && (prev !== "!" || options.includeSheetRefs)){
        const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(tk.text);
        if (m){
          const colAbs = m[1] === "$", rowAbs = m[3] === "$";
          const res = transform(formulaColumnIndex(m[2]), Number(m[4]) - 1, { colAbs, rowAbs });
          out += (!res || res.c < 0 || res.r < 0)
            ? "#REF!"
            : (colAbs ? "$" : "") + spreadsheetColumnName(res.c) + (rowAbs ? "$" : "") + (res.r + 1);
          prev = tk.text;
          continue;
        }
      }
      out += tk.text;
      prev = tk.text;
    }
    return out;
  }
  
  function spreadsheetFormulaSheetName(token){
    if (!token) return "";
    if (token.type === "sheetq") return token.text.slice(1, -1).replace(/''/g, "'");
    return token.type === "name" ? token.text : "";
  }
  
  function spreadsheetFormulaSheetToken(name){
    const text = String(name || "");
    return /[^A-Za-z0-9_ㄱ-ㆎ가-힣]/.test(text) || /^\d/.test(text)
      ? "'" + text.replace(/'/g, "''") + "'"
      : text;
  }
  
  function remapMovedFormulaRefs(formula, homeSheet, sourceSheet, destinationSheet, bounds, dr, dc){
    if (!bounds || !bounds.s || !bounds.e) return formula;
    let toks;
    try { toks = tokenizeFormula(formula); } catch(_){ return formula; }
    const sameSheet = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
    const movedRef = (token) => {
      const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(token && token.text || "");
      if (!m) return null;
      const c = formulaColumnIndex(m[2]), r = Number(m[4]) - 1;
      if (r < bounds.s.r || r > bounds.e.r || c < bounds.s.c || c > bounds.e.c) return null;
      return (m[1] || "") + spreadsheetColumnName(c + dc) + (m[3] || "") + (r + dr + 1);
    };
    let out = "";
    for (let i = 0; i < toks.length; i++){
      const tk = toks[i], bang = toks[i + 1], ref = toks[i + 2];
      if ((tk.type === "name" || tk.type === "sheetq") && bang && bang.text === "!" && ref && ref.type === "ref"){
        const shifted = sameSheet(spreadsheetFormulaSheetName(tk), sourceSheet) ? movedRef(ref) : null;
        if (shifted){
          out += spreadsheetFormulaSheetToken(destinationSheet) + "!" + shifted;
          i += 2;
          continue;
        }
      }
      if (tk.type === "ref" && sameSheet(homeSheet, sourceSheet)){
        const shifted = movedRef(tk);
        if (shifted){
          out += (sameSheet(homeSheet, destinationSheet) ? "" : spreadsheetFormulaSheetToken(destinationSheet) + "!") + shifted;
          continue;
        }
      }
      out += tk.text;
    }
    return out;
  }
  
  // 시트 이름이 바뀔 때 수식 속 시트 참조(Sheet2!A1, '내 시트'!A1)를 새 이름으로 재작성.
  function remapFormulaSheetName(formula, oldName, newName){
    let toks;
    try { toks = tokenizeFormula(formula); } catch(_){ return formula; }
    const target = String(oldName).toLowerCase();
    const needQuote = /[^A-Za-z0-9_ㄱ-ㆎ가-힣]/.test(newName) || /^\d/.test(newName);
    const replacement = needQuote ? "'" + String(newName).replace(/'/g, "''") + "'" : newName;
    let out = "";
    for (let i = 0; i < toks.length; i++){
      const tk = toks[i], nx = toks[i + 1];
      if (nx && nx.text === "!" && (tk.type === "name" || tk.type === "sheetq")){
        const nm = tk.type === "sheetq" ? tk.text.slice(1, -1).replace(/''/g, "'") : tk.text;
        if (nm.toLowerCase() === target){ out += replacement; continue; }
      }
      out += tk.text;
    }
    return out;
  }
  
  // 자동 채우기 텍스트 패턴: 요일·월·계절 순환 + "1반"/"학생1" 같은 접두어·숫자·접미어 증가.
  // 패턴이 아니면 null (호출부가 원본 순환 복사로 처리).
  const SPREADSHEET_FILL_CYCLES = [
    ["월", "화", "수", "목", "금", "토", "일"],
    ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"],
    ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
    ["봄", "여름", "가을", "겨울"],
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  ];
  function spreadsheetTextSeries(vals){
    const strs = vals.map(v => String(v == null ? "" : v).trim());
    if (!strs.length || strs.some(s => s === "")) return null;
    // 1) 순환 목록: 모든 값이 같은 목록 항목이고 간격이 일정하면 이어서 순환(거꾸로 드래그도 음수 간격으로 계속)
    for (const cycle of SPREADSHEET_FILL_CYCLES){
      const idxs = strs.map(s => cycle.indexOf(s));
      if (idxs.some(i => i < 0)) continue;
      const L = cycle.length;
      let step = 1;
      if (idxs.length >= 2){
        step = idxs[1] - idxs[0];
        const norm = ((step % L) + L) % L;
        if (norm === 0) return null;                        // 같은 값 반복 → 순환 복사에 맡김
        for (let k = 1; k < idxs.length; k++){
          if ((((idxs[k] - idxs[k - 1]) % L) + L) % L !== norm) return null;
        }
      }
      const last = idxs[idxs.length - 1];
      return (i) => cycle[(((last + step * (i + 1)) % L) + L) % L];
    }
    // 2) 접두어+숫자+접미어: "1반"→"2반", "학생1"→"학생2" ("01" 처럼 0채움도 유지)
    const parts = strs.map(s => /^(\D*?)(\d+)(\D*)$/.exec(s));
    if (parts.every(Boolean)){
      const pre = parts[0][1], suf = parts[0][3];
      if (!parts.every(p => p[1] === pre && p[3] === suf)) return null;
      const nums = parts.map(p => Number(p[2]));
      let step = 1;
      if (nums.length >= 2){
        step = nums[nums.length - 1] - nums[nums.length - 2];
        for (let k = 1; k < nums.length; k++){ if (nums[k] - nums[k - 1] !== step) return null; }
        if (step === 0) return null;
      }
      const lastDigits = parts[parts.length - 1][2];
      const padWidth = (lastDigits.length > 1 && lastDigits[0] === "0") ? lastDigits.length : 0;
      const base = nums[nums.length - 1];
      return (i) => {
        const n = base + step * (i + 1);
        if (n < 0) return pre + n + suf;
        let t = String(n);
        while (t.length < padWidth) t = "0" + t;
        return pre + t + suf;
      };
    }
    return null;
  }
  
  // 수식 자동완성용 함수 목록: [이름, 시그니처, 설명] — 수식 엔진(evCall)이 지원하는 함수만.
  const SPREADSHEET_FN_HELP = [
    ["SUM", "SUM(범위)", "합계"],
    ["AVERAGE", "AVERAGE(범위)", "평균"],
    ["COUNT", "COUNT(범위)", "숫자 개수"],
    ["COUNTA", "COUNTA(범위)", "빈칸 아닌 개수"],
    ["COUNTBLANK", "COUNTBLANK(범위)", "빈칸 개수"],
    ["MIN", "MIN(범위)", "최솟값"],
    ["MAX", "MAX(범위)", "최댓값"],
    ["MEDIAN", "MEDIAN(범위)", "중앙값"],
    ["STDEV", "STDEV(범위)", "표본 표준편차"],
    ["STDEVP", "STDEVP(범위)", "모 표준편차"],
    ["LARGE", "LARGE(범위, k)", "k번째 큰 값"],
    ["SMALL", "SMALL(범위, k)", "k번째 작은 값"],
    ["RANK", "RANK(값, 범위, [오름차순])", "석차(기본 내림차순)"],
    ["PRODUCT", "PRODUCT(범위)", "곱"],
    ["IF", "IF(조건, 참일때, [거짓일때])", "조건 분기"],
    ["IFS", "IFS(조건1, 값1, 조건2, 값2, …)", "여러 조건 중 첫 참"],
    ["IFERROR", "IFERROR(값, 오류일때)", "오류면 대체값"],
    ["AND", "AND(조건1, 조건2, …)", "모두 참인지"],
    ["OR", "OR(조건1, 조건2, …)", "하나라도 참인지"],
    ["NOT", "NOT(조건)", "참거짓 반전"],
    ["COUNTIF", "COUNTIF(범위, 조건)", "조건에 맞는 개수"],
    ["SUMIF", "SUMIF(범위, 조건, [합계범위])", "조건에 맞는 합계"],
    ["AVERAGEIF", "AVERAGEIF(범위, 조건, [평균범위])", "조건에 맞는 평균"],
    ["COUNTIFS", "COUNTIFS(범위1, 조건1, 범위2, 조건2, …)", "여러 조건 개수"],
    ["SUMIFS", "SUMIFS(합계범위, 범위1, 조건1, …)", "여러 조건 합계"],
    ["AVERAGEIFS", "AVERAGEIFS(평균범위, 범위1, 조건1, …)", "여러 조건 평균"],
    ["VLOOKUP", "VLOOKUP(찾을값, 표범위, 열번호, [유사일치])", "세로 방향 찾기"],
    ["HLOOKUP", "HLOOKUP(찾을값, 표범위, 행번호, [유사일치])", "가로 방향 찾기"],
    ["XLOOKUP", "XLOOKUP(찾을값, 찾을범위, 반환범위, [없을때])", "찾아서 짝 반환"],
    ["INDEX", "INDEX(범위, 행, [열])", "위치의 값"],
    ["MATCH", "MATCH(찾을값, 범위, [0=정확])", "위치 번호"],
    ["CHOOSE", "CHOOSE(번호, 값1, 값2, …)", "번호에 해당하는 값"],
    ["ROUND", "ROUND(수, 자릿수)", "반올림"],
    ["ROUNDUP", "ROUNDUP(수, 자릿수)", "올림"],
    ["ROUNDDOWN", "ROUNDDOWN(수, 자릿수)", "내림"],
    ["ABS", "ABS(수)", "절댓값"],
    ["INT", "INT(수)", "정수 내림"],
    ["SQRT", "SQRT(수)", "제곱근"],
    ["MOD", "MOD(수, 나눌수)", "나머지"],
    ["POWER", "POWER(밑, 지수)", "거듭제곱"],
    ["TODAY", "TODAY()", "오늘 날짜"],
    ["NOW", "NOW()", "지금 날짜·시각"],
    ["DATE", "DATE(년, 월, 일)", "날짜 만들기"],
    ["YEAR", "YEAR(날짜)", "연도"],
    ["MONTH", "MONTH(날짜)", "월"],
    ["DAY", "DAY(날짜)", "일"],
    ["HOUR", "HOUR(시각)", "시"],
    ["MINUTE", "MINUTE(시각)", "분"],
    ["SECOND", "SECOND(시각)", "초"],
    ["WEEKDAY", "WEEKDAY(날짜, [방식])", "요일 번호"],
    ["EDATE", "EDATE(날짜, 개월수)", "개월 더한 날짜"],
    ["DATEDIF", "DATEDIF(시작, 끝, \"D|M|Y\")", "기간 차이"],
    ["TEXT", "TEXT(값, \"서식\")", "서식 문자열로"],
    ["VALUE", "VALUE(문자)", "숫자로 변환"],
    ["LEN", "LEN(문자)", "글자 수"],
    ["LEFT", "LEFT(문자, [개수])", "왼쪽에서 자르기"],
    ["RIGHT", "RIGHT(문자, [개수])", "오른쪽에서 자르기"],
    ["MID", "MID(문자, 시작, 개수)", "가운데 자르기"],
    ["TRIM", "TRIM(문자)", "공백 정리"],
    ["UPPER", "UPPER(문자)", "대문자로"],
    ["LOWER", "LOWER(문자)", "소문자로"],
    ["PROPER", "PROPER(문자)", "단어 첫 글자 대문자"],
    ["CONCAT", "CONCAT(값1, 값2, …)", "이어 붙이기"],
    ["TEXTJOIN", "TEXTJOIN(구분자, 빈칸무시, 값들…)", "구분자로 이어 붙이기"],
    ["SUBSTITUTE", "SUBSTITUTE(문자, 찾을것, 바꿀것, [번째])", "바꾸기"],
    ["REPLACE", "REPLACE(문자, 시작, 개수, 새문자)", "위치로 바꾸기"],
    ["FIND", "FIND(찾을것, 문자, [시작])", "위치 찾기(대소문자 구분)"],
    ["SEARCH", "SEARCH(찾을것, 문자, [시작])", "위치 찾기"],
    ["REPT", "REPT(문자, 횟수)", "반복"],
    ["EXACT", "EXACT(문자1, 문자2)", "완전히 같은지"],
    ["ISBLANK", "ISBLANK(셀)", "빈칸인지"],
    ["ISNUMBER", "ISNUMBER(값)", "숫자인지"],
    ["ISTEXT", "ISTEXT(값)", "문자인지"],
    ["ISERROR", "ISERROR(값)", "오류인지"]
  ];
  
  // 수식 입력 중 캐럿 앞 상태 분석 → 자동완성 컨텍스트.
  //  · { type:"name", partial, start } : 함수 이름을 치는 중(start = 토큰 시작 위치)
  //  · { type:"args", name }           : 함수 괄호 안(인자 힌트 표시용, 가장 안쪽 함수)
  //  · null                            : 수식이 아니거나 완성할 것이 없음
  function formulaTypingContext(text, caret){
    const s = String(text == null ? "" : text);
    if (s[0] !== "=") return null;
    const upto = s.slice(0, Math.max(0, Math.min(caret, s.length)));
    const m = /[A-Za-z][A-Za-z.]*$/.exec(upto);
    if (m && m.index > 0){
      const before = upto[m.index - 1];
      if ("=+-*/^&<>,(%".includes(before)) return { type: "name", partial: m[0], start: m.index };
    }
    // 괄호 짝을 세며 뒤에서 앞으로 — 닫히지 않은 '(' 바로 앞의 단어가 현재 함수
    let depth = 0;
    for (let i = upto.length - 1; i > 0; i--){
      const ch = upto[i];
      if (ch === ")") depth++;
      else if (ch === "("){
        if (depth > 0){ depth--; continue; }
        const head = /[A-Za-z][A-Za-z.]*$/.exec(upto.slice(0, i));
        if (head) return { type: "args", name: head[0].toUpperCase() };
        return null;
      }
    }
    return null;
  }
  
  // 자동합계(Σ): 선택 범위를 보고 수식을 넣을 자리와 수식을 정한다. 반환 [{ r, c, f }]
  //  · 여러 행 선택 → 각 열의 아래 칸에 열 합계(숫자 있는 열만)
  //  · 한 행 여러 열 → 오른쪽 칸에 행 합계
  //  · 단일 셀 → 위로 이어진 숫자 범위(없으면 왼쪽)를 그 셀에 합계
  function spreadsheetAutoFormulaJobs(model, b, fnName){
    const isNum = (r, c) => !!(model[r] && model[r][c] && !model[r][c].f && typeof model[r][c].v === "number");
    const ref = (r, c) => spreadsheetColumnName(c) + (r + 1);
    const jobs = [];
    if (b.s.r === b.e.r && b.s.c === b.e.c){
      const { r, c } = b.s;
      let r1 = r;
      while (r1 - 1 >= 0 && isNum(r1 - 1, c)) r1--;
      if (r1 < r){ jobs.push({ r, c, f: fnName + "(" + ref(r1, c) + ":" + ref(r - 1, c) + ")" }); return jobs; }
      let c1 = c;
      while (c1 - 1 >= 0 && isNum(r, c1 - 1)) c1--;
      if (c1 < c) jobs.push({ r, c, f: fnName + "(" + ref(r, c1) + ":" + ref(r, c - 1) + ")" });
      return jobs;
    }
    if (b.s.r === b.e.r){
      const r = b.s.r;
      let any = false;
      for (let c = b.s.c; c <= b.e.c; c++) if (isNum(r, c)) any = true;
      if (any) jobs.push({ r, c: b.e.c + 1, f: fnName + "(" + ref(r, b.s.c) + ":" + ref(r, b.e.c) + ")" });
      return jobs;
    }
    for (let c = b.s.c; c <= b.e.c; c++){
      let any = false;
      for (let r = b.s.r; r <= b.e.r; r++) if (isNum(r, c)) any = true;
      if (any) jobs.push({ r: b.e.r + 1, c, f: fnName + "(" + ref(b.s.r, c) + ":" + ref(b.e.r, c) + ")" });
    }
    return jobs;
  }
  
  // 선택 데이터로 간단 차트(막대·선·원)를 SVG 문자열로 생성. 오프라인·무의존.

  return {
    spreadsheetColumnName, FORMULA_ERR, isFormulaError, spreadsheetDateSerial, spreadsheetDateToSerial, spreadsheetSerialToParts, spreadsheetFormatByPattern, formulaColumnIndex, parseA1Ref, tokenizeFormula, parseFormula, formulaToNumber, formulaToString, formulaToBool, evaluateAst, evaluateFormula, remapFormulaRefs, spreadsheetFormulaSheetName, spreadsheetFormulaSheetToken, remapMovedFormulaRefs, remapFormulaSheetName, SPREADSHEET_FILL_CYCLES, spreadsheetTextSeries, SPREADSHEET_FN_HELP, formulaTypingContext, spreadsheetAutoFormulaJobs
  };
})();

if (typeof module === "object" && module.exports) module.exports = MNSpreadsheetFormula;
