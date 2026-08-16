"use strict";

/* ===== 화이트보드 수학·과학 도구(계산 전용) =====
   ① 함수 그래프 ② 자료 차트 ③ 손그림 도형 정리 ④ 교구(자·각도기·컴퍼스) 기하.
   DOM 을 만들지 않고 board-render.js 가 그대로 그리는 벡터 항목(group)만 돌려주므로
   저장·되돌리기·PNG/PDF 내보내기·수업 리플레이가 전부 그대로 따라온다.
   화면 조작(패널·드래그)은 whiteboard.js 가 맡고, 여기서는 순수 계산만 한다. */

const MNBoardTools = (() => {
  const PX_PER_CM = 37.8;                       // 96dpi 기준 1cm — 자·컴퍼스 눈금 환산에 쓴다
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value)));
  const num = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
  // 사용자가 고칠 수 있는 잘못(수식 오타 등)은 그대로 화면에 보여 줄 한국어 메시지를 달아 던진다.
  const toolError = (message) => { const error = new Error(message); error.boardTool = true; return error; };

  const CHART_PALETTE = ["#2563eb", "#e11d48", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
  const CURVE_COLORS = ["#2563eb", "#e11d48", "#16a34a"];

  /* ---------- 1. 수식 파서 (eval 없이 토큰 → 구문나무 → 계산) ---------- */

  const CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  const FUNCTIONS = {
    sin:{ arity:1, fn:Math.sin }, cos:{ arity:1, fn:Math.cos }, tan:{ arity:1, fn:Math.tan },
    asin:{ arity:1, fn:Math.asin }, acos:{ arity:1, fn:Math.acos }, atan:{ arity:1, fn:Math.atan },
    sinh:{ arity:1, fn:Math.sinh }, cosh:{ arity:1, fn:Math.cosh }, tanh:{ arity:1, fn:Math.tanh },
    sqrt:{ arity:1, fn:Math.sqrt }, abs:{ arity:1, fn:Math.abs }, exp:{ arity:1, fn:Math.exp },
    // 학교에서 log 는 상용로그, ln 은 자연로그다.
    log:{ arity:1, fn:Math.log10 }, log10:{ arity:1, fn:Math.log10 }, log2:{ arity:1, fn:Math.log2 }, ln:{ arity:1, fn:Math.log },
    floor:{ arity:1, fn:Math.floor }, ceil:{ arity:1, fn:Math.ceil }, round:{ arity:1, fn:Math.round }, sign:{ arity:1, fn:Math.sign },
    pow:{ arity:2, fn:Math.pow }, atan2:{ arity:2, fn:Math.atan2 },
    mod:{ arity:2, fn:(a, b) => (b ? a - b * Math.floor(a / b) : NaN) },
    min:{ arity:-1, fn:(...args) => Math.min(...args) }, max:{ arity:-1, fn:(...args) => Math.max(...args) }
  };

  function tokenizeExpression(source){
    const text = String(source == null ? "" : source)
      .replace(/[×·]/g, "*").replace(/[÷]/g, "/").replace(/[−–—]/g, "-")
      .replace(/\^\{([^{}]*)\}/g, "^($1)")
      .replace(/[{}]/g, "");
    const tokens = [];
    let i = 0;
    while (i < text.length){
      const ch = text[i];
      if (/\s/.test(ch)){ i++; continue; }
      // 기호를 문자열로 먼저 치환하면 πx→pix, √x→sqrtx 로 붙어 버린다. 여기서
      // 독립 이름 토큰으로 만들면 바로 뒤의 값과 암시적 곱셈·함수 적용 규칙이 작동한다.
      if (ch === "π"){ tokens.push({ type:"name", value:"pi" }); i++; continue; }
      if (ch === "√"){ tokens.push({ type:"name", value:"sqrt" }); i++; continue; }
      if (/[0-9.]/.test(ch)){
        let j = i;
        while (j < text.length && /[0-9.]/.test(text[j])) j++;
        const raw = text.slice(i, j), value = Number(raw);
        if (!Number.isFinite(value)) throw toolError(`숫자를 읽을 수 없어요: ${raw}`);
        tokens.push({ type:"num", value }); i = j; continue;
      }
      if (/[a-zA-Z]/.test(ch)){
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        tokens.push({ type:"name", value:text.slice(i, j) }); i = j; continue;
      }
      if ("+-*/^%(),".includes(ch)){ tokens.push({ type:ch }); i++; continue; }
      throw toolError(`이해할 수 없는 문자예요: ${ch}`);
    }
    return tokens;
  }

  // y = …, f(x) = … 처럼 앞에 붙는 이름은 그래프에서 의미가 없으므로 떼어 낸다.
  function stripEquationPrefix(source){
    const text = String(source == null ? "" : source).trim();
    const match = text.match(/^(?:y|f\s*\(\s*[a-zA-Z]\s*\)|g\s*\(\s*[a-zA-Z]\s*\)|h\s*\(\s*[a-zA-Z]\s*\))\s*=\s*([\s\S]+)$/);
    return match ? match[1].trim() : text;
  }

  function parseExpression(source){
    const body = stripEquationPrefix(source);
    if (!body) throw toolError("수식을 입력하세요.");
    const tokens = tokenizeExpression(body);
    if (!tokens.length) throw toolError("수식을 입력하세요.");
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (type) => { if (tokens[pos] && tokens[pos].type === type){ pos++; return true; } return false; };
    // 2x, 3(x+1), x(x-1) 처럼 곱셈 기호를 생략한 자리
    const impliesProduct = () => {
      const token = peek();
      return !!token && (token.type === "num" || token.type === "name" || token.type === "(");
    };

    function parseExpr(){
      let node = parseTerm();
      for (;;){
        if (eat("+")) node = { op:"+", left:node, right:parseTerm() };
        else if (eat("-")) node = { op:"-", left:node, right:parseTerm() };
        else return node;
      }
    }
    function parseTerm(){
      let node = parseUnary();
      for (;;){
        if (eat("*")) node = { op:"*", left:node, right:parseUnary() };
        else if (eat("/")) node = { op:"/", left:node, right:parseUnary() };
        else if (eat("%")) node = { op:"%", left:node, right:parseUnary() };
        else if (impliesProduct()) node = { op:"*", left:node, right:parseUnary() };
        else return node;
      }
    }
    function parseUnary(){
      if (eat("-")) return { op:"neg", value:parseUnary() };
      if (eat("+")) return parseUnary();
      return parsePower();
    }
    function parsePower(){
      const base = parseAtom();
      if (eat("^")) return { op:"^", left:base, right:parseUnary() };   // 2^3^2 = 2^(3^2)
      return base;
    }
    function parseAtom(){
      const token = peek();
      if (!token) throw toolError("수식이 끝나지 않았어요.");
      if (token.type === "num"){ pos++; return { op:"num", value:token.value }; }
      if (token.type === "("){
        pos++;
        const inner = parseExpr();
        if (!eat(")")) throw toolError("괄호가 닫히지 않았어요.");
        return inner;
      }
      if (token.type === "name"){
        pos++;
        const name = token.value, lower = name.toLowerCase();
        const fn = FUNCTIONS[lower];
        if (fn){
          const args = [];
          if (eat("(")){
            if (!eat(")")){
              args.push(parseExpr());
              while (eat(",")) args.push(parseExpr());
              if (!eat(")")) throw toolError("괄호가 닫히지 않았어요.");
            }
          } else args.push(parsePower());                 // sin x 처럼 괄호를 생략한 표기
          if (fn.arity > 0 && args.length !== fn.arity) throw toolError(`${lower} 에는 값 ${fn.arity}개가 필요해요.`);
          if (fn.arity < 0 && !args.length) throw toolError(`${lower} 에 넣을 값이 없어요.`);
          return { op:"call", name:lower, args };
        }
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, lower)) return { op:"num", value:CONSTANTS[lower] };
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw toolError(`모르는 문자예요: ${name}`);
        return { op:"var", name };
      }
      throw toolError("수식을 이해하지 못했어요.");
    }

    const ast = parseExpr();
    if (pos < tokens.length) throw toolError("수식에 남는 부분이 있어요. 괄호와 연산자를 확인하세요.");

    const variables = [];
    (function walk(node){
      if (!node) return;
      if (node.op === "var"){ if (!variables.includes(node.name)) variables.push(node.name); return; }
      if (node.op === "call"){ node.args.forEach(walk); return; }
      walk(node.left); walk(node.right); walk(node.value);
    })(ast);

    const evaluate = (scope) => {
      const values = scope || {};
      const run = (node) => {
        switch (node.op){
          case "num": return node.value;
          case "var": {
            const value = Number(values[node.name]);
            return Number.isFinite(value) ? value : NaN;
          }
          case "neg": return -run(node.value);
          case "+": return run(node.left) + run(node.right);
          case "-": return run(node.left) - run(node.right);
          case "*": return run(node.left) * run(node.right);
          case "/": return run(node.left) / run(node.right);
          case "%": return run(node.left) % run(node.right);
          case "^": return Math.pow(run(node.left), run(node.right));
          case "call": return FUNCTIONS[node.name].fn(...node.args.map(run));
          default: return NaN;
        }
      };
      return run(ast);
    };
    return { source:String(source == null ? "" : source), body, variables, evaluate };
  }

  /* ---------- 2. 함수 그래프 ---------- */

  // 축 눈금은 1·2·5 계열의 "보기 좋은" 간격으로 맞춘다.
  function niceStep(span, targetCount){
    const raw = Math.abs(span) / Math.max(1, targetCount || 8);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / magnitude;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * magnitude;
  }

  function formatNumber(value, step){
    if (!Number.isFinite(value)) return "";
    const decimals = step ? clamp(Math.ceil(-Math.log10(Math.abs(step)) + 0.0001), 0, 4) : 2;
    let text = value.toFixed(decimals);
    if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
    if (text === "-0") text = "0";
    return text;
  }

  // 선분을 그림 영역 안으로 자른다(Liang-Barsky). 자르지 않으면 급한 곡선이 보드 전체를 가로지른다.
  function clipSegment(a, b, rect){
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const tests = [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.h - a.y]];
    for (const [p, q] of tests){
      if (p === 0){ if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0){ if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return {
      a:{ x:a.x + t0 * dx, y:a.y + t0 * dy },
      b:{ x:a.x + t1 * dx, y:a.y + t1 * dy },
      startClipped:t0 > 0, endClipped:t1 < 1
    };
  }

  function normalizeCurves(spec){
    const raw = Array.isArray(spec.curves) ? spec.curves : [];
    const curves = [];
    raw.forEach((entry, index) => {
      const source = String((entry && typeof entry === "object" ? entry.source : entry) || "").trim();
      if (!source) return;
      const color = entry && typeof entry === "object" && /^#[0-9a-f]{6}$/i.test(String(entry.color || ""))
        ? String(entry.color).toLowerCase() : CURVE_COLORS[curves.length % CURVE_COLORS.length];
      curves.push({ source, color, parsed:parseExpression(source), index });
    });
    if (!curves.length) throw toolError("그래프로 그릴 식을 입력하세요.");
    return curves;
  }

  /* spec = { curves:[{source,color}], xMin,xMax, yMin,yMax(없으면 자동), params:{a:1},
             width,height, axisColor, showGrid, title, variable:"x" } */
  function plotGroup(spec){
    const options = spec || {};
    const width = Math.round(clamp(num(options.width, 560), 220, 2400));
    const height = Math.round(clamp(num(options.height, 400), 180, 2400));
    const variable = String(options.variable || "x");
    const params = options.params && typeof options.params === "object" ? options.params : {};
    const curves = normalizeCurves(options);
    const axisColor = /^#[0-9a-f]{6}$/i.test(String(options.axisColor || "")) ? String(options.axisColor).toLowerCase() : "#111111";

    let xMin = num(options.xMin, -10), xMax = num(options.xMax, 10);
    if (!(xMax > xMin)){ xMin = -10; xMax = 10; }
    const margin = { left:46, right:18, top:options.title ? 34 : 20, bottom:32 };
    const area = { x:margin.left, y:margin.top, w:width - margin.left - margin.right, h:height - margin.top - margin.bottom };
    if (area.w < 40 || area.h < 40) throw toolError("그래프를 그리기에 크기가 너무 작아요.");

    // 표본 추출 — 화면 가로 픽셀당 한 점이면 충분하고, 값이 없는 구간(정의역 밖)은 그대로 비운다.
    const sampleCount = Math.max(160, Math.min(1200, Math.round(area.w * 1.5)));
    const dx = (xMax - xMin) / sampleCount;
    const scope = Object.assign({}, params);
    const samples = curves.map((curve) => {
      const values = [];
      for (let i = 0; i <= sampleCount; i++){
        const x = xMin + dx * i;
        scope[variable] = x;
        let y;
        try { y = Number(curve.parsed.evaluate(scope)); } catch(_){ y = NaN; }
        values.push({ x, y:Number.isFinite(y) ? y : NaN });
      }
      return values;
    });

    let yMin = Number(options.yMin), yMax = Number(options.yMax);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || !(yMax > yMin)){
      // 점근선 하나에 세로 범위를 통째로 빼앗기지 않도록 가운데 96% 구간만 본다.
      const finite = [];
      for (const values of samples) for (const point of values) if (Number.isFinite(point.y)) finite.push(point.y);
      if (!finite.length) throw toolError("이 범위에서는 값이 없어요. x 범위를 바꿔 보세요.");
      finite.sort((a, b) => a - b);
      const at = (ratio) => finite[clamp(Math.round((finite.length - 1) * ratio), 0, finite.length - 1)];
      let low = at(0.02), high = at(0.98);
      if (!(high > low)){ low -= 1; high += 1; }
      const pad = (high - low) * 0.12;
      low -= pad; high += pad;
      if (low > 0 && low < (high - low) * 0.6) low = 0;                 // 0 이 가까우면 축을 보이게 붙인다
      if (high < 0 && -high < (high - low) * 0.6) high = 0;
      yMin = low; yMax = high;
    }
    if (!(yMax > yMin)){ yMin -= 1; yMax += 1; }

    const sx = (x) => area.x + (x - xMin) / (xMax - xMin) * area.w;
    const sy = (y) => area.y + (yMax - y) / (yMax - yMin) * area.h;
    const items = [];
    const line = (x1, y1, x2, y2, extra) => Object.assign({ type:"line", x1, y1, x2, y2, color:axisColor, width:1.6 }, extra || {});
    const label = (x, y, text, size, extra) => Object.assign({ type:"text", x, y, text:String(text), fontSize:size || 12, color:axisColor }, extra || {});

    const xStep = niceStep(xMax - xMin, Math.max(4, Math.round(area.w / 78)));
    const yStep = niceStep(yMax - yMin, Math.max(4, Math.round(area.h / 56)));
    const showGrid = options.showGrid !== false;
    const gridTicks = (min, max, step) => {
      const ticks = [];
      const first = Math.ceil(min / step) * step;
      for (let value = first; value <= max + step * 0.001; value += step){
        const rounded = Math.abs(value) < step * 0.001 ? 0 : value;
        ticks.push(rounded);
        if (ticks.length > 400) break;
      }
      return ticks;
    };
    const xTicks = gridTicks(xMin, xMax, xStep), yTicks = gridTicks(yMin, yMax, yStep);

    if (showGrid){
      for (const x of xTicks) items.push(line(sx(x), area.y, sx(x), area.y + area.h, { width:1, alpha:0.16 }));
      for (const y of yTicks) items.push(line(area.x, sy(y), area.x + area.w, sy(y), { width:1, alpha:0.16 }));
    }
    items.push(Object.assign({ type:"rect", x1:area.x, y1:area.y, x2:area.x + area.w, y2:area.y + area.h, color:axisColor, width:1.2, alpha:0.5 }));

    // 축은 0 이 화면 안에 있으면 그 자리에, 벗어나면 그림 영역 가장자리에 붙인다.
    const axisY = clamp(sy(0), area.y, area.y + area.h);
    const axisX = clamp(sx(0), area.x, area.x + area.w);
    items.push(Object.assign({ type:"arrow", x1:area.x, y1:axisY, x2:area.x + area.w + 6, y2:axisY, color:axisColor, width:1.8 }));
    items.push(Object.assign({ type:"arrow", x1:axisX, y1:area.y + area.h, x2:axisX, y2:area.y - 6, color:axisColor, width:1.8 }));
    items.push(label(area.x + area.w - 2, axisY + 7, variable, 13));
    items.push(label(axisX + 7, area.y - 4, "y", 13));

    for (const x of xTicks){
      if (Math.abs(x) < xStep * 0.001 && axisX > area.x + 2 && axisX < area.x + area.w - 2) continue;
      const px = sx(x);
      items.push(line(px, axisY - 4, px, axisY + 4, { width:1.4 }));
      items.push(label(px - 10, axisY + 7, formatNumber(x, xStep), 11));
    }
    for (const y of yTicks){
      if (Math.abs(y) < yStep * 0.001) continue;
      const py = sy(y);
      items.push(line(axisX - 4, py, axisX + 4, py, { width:1.4 }));
      items.push(label(Math.max(2, axisX - 40), py - 6, formatNumber(y, yStep), 11));
    }
    items.push(label(axisX - 13, axisY + 6, "O", 12));

    // 곡선 — 그림 영역 밖으로 나가는 부분은 잘라 내고, 값이 끊기거나 점근선을 만나면 획을 나눈다.
    const ySpan = yMax - yMin;
    curves.forEach((curve, index) => {
      const values = samples[index];
      const points = values.map((point) => (Number.isFinite(point.y)
        ? { ok:true, x:sx(point.x), y:sy(point.y), value:point.y }
        : { ok:false }));
      let run = [];
      const flush = () => { if (run.length > 1) items.push({ type:"polyline", points:run, color:curve.color, width:2.4 }); run = []; };
      for (let i = 0; i < points.length - 1; i++){
        const a = points[i], b = points[i + 1];
        if (!a.ok || !b.ok){ flush(); continue; }
        // tan 처럼 부호가 뒤집히며 폭발하는 자리는 이어 그리지 않는다.
        if (Math.abs(a.value - b.value) > ySpan * 4 && (a.value - b.value) * (a.value - b.value) > 0 && Math.sign(a.value) !== Math.sign(b.value)){ flush(); continue; }
        const clipped = clipSegment(a, b, area);
        if (!clipped){ flush(); continue; }
        const last = run.length ? run[run.length - 1] : null;
        if (last && Math.abs(last.x - clipped.a.x) < 0.01 && Math.abs(last.y - clipped.a.y) < 0.01) run.push(clipped.b);
        else { flush(); run = [clipped.a, clipped.b]; }
        if (clipped.endClipped) flush();
      }
      flush();
      const legendY = area.y + 6 + index * 17;
      items.push(Object.assign({ type:"line", x1:area.x + 8, y1:legendY + 7, x2:area.x + 28, y2:legendY + 7, color:curve.color, width:2.4 }));
      items.push(label(area.x + 33, legendY, "y = " + curve.parsed.body, 13, { color:curve.color }));
    });

    if (options.title) items.push(label(margin.left, 6, String(options.title), 15));

    return {
      type:"group", role:"education-plot", x:0, y:0, w:width, h:height, sourceW:width, sourceH:height,
      items, educationLabel:"함수 그래프", educationColor:axisColor,
      plotSpec:{
        curves:curves.map((curve) => ({ source:curve.source, color:curve.color })),
        xMin, xMax,
        yMin:Number.isFinite(Number(options.yMin)) && Number.isFinite(Number(options.yMax)) ? num(options.yMin) : null,
        yMax:Number.isFinite(Number(options.yMin)) && Number.isFinite(Number(options.yMax)) ? num(options.yMax) : null,
        params:Object.assign({}, params), variable, showGrid, title:String(options.title || ""), width, height
      }
    };
  }

  /* ---------- 3. 자료 차트 ---------- */

  const chartNumber = (part) => {
    const value = Number(String(part).replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  };

  /* "국어, 30" · "국어\t30" · "국어 30" · 숫자만 나열 — 교실에서 실제로 칠 법한 형태를 모두 받는다.
     값을 여러 열 적으면 자료 묶음(계열)이 여러 개인 표가 된다.
       과목, 1반, 2반      ← 첫 줄의 둘째 칸부터가 전부 숫자가 아니면 이름 줄
       국어, 7, 9
     결과: { series:["1반","2반"], rows:[{ label:"국어", values:[7, 9] }] } */
  function parseChartTable(text){
    const lines = String(text == null ? "" : text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rows = [];
    let series = [];
    lines.forEach((line, index) => {
      const parts = line.split(/\s*[,\t;]\s*|\s{2,}|\s+/).filter((part) => part !== "");
      if (!parts.length) return;
      if (index === 0 && parts.length > 1 && parts.slice(1).every((part) => chartNumber(part) === null)){
        series = parts.slice(1); return;
      }
      if (parts.length === 1){
        const only = chartNumber(parts[0]);
        if (only !== null) rows.push({ label:"", values:[only] });
        return;
      }
      // 뒤에서부터 숫자만 값으로 걷되 첫 칸은 언제나 이름으로 남긴다("1, 3" 은 산점도의 x,y다).
      let start = parts.length;
      while (start > 1 && chartNumber(parts[start - 1]) !== null) start--;
      if (start >= parts.length) return;                       // 값이 하나도 없는 줄은 건너뛴다
      rows.push({ label:parts.slice(0, start).join(" "), values:parts.slice(start).map(chartNumber) });
    });
    if (!rows.length) throw toolError("자료를 읽지 못했어요. 한 줄에 ‘이름, 값’ 형식으로 적어 주세요.");
    // 이름이 하나도 없으면 1,2,3… 을 붙여 준다(숫자만 붙여넣은 경우).
    if (rows.every((row) => !row.label)) rows.forEach((row, index) => { row.label = String(index + 1); });
    // 줄마다 열 개수가 다르면 짧은 줄은 빈칸으로 채워 계열 수를 맞춘다.
    const width = rows.reduce((most, row) => Math.max(most, row.values.length), 0);
    for (const row of rows) while (row.values.length < width) row.values.push(null);
    return { series:series.slice(0, width), rows };
  }

  // 계열이 하나뿐인 옛 형태({label, value})가 필요한 곳을 위한 얇은 껍데기.
  function parseChartData(text){
    return parseChartTable(text).rows.map((row) => ({ label:row.label, value:row.values[0] }));
  }

  // 호출자가 rows 를 직접 넘긴 경우({label,value} 도 받아 준다) 표 형태로 맞춘다.
  function normalizeChartTable(rows, series){
    const normalized = rows.map((row) => {
      const values = Array.isArray(row && row.values) ? row.values.map((value) => (value == null ? null : num(value)))
        : [num(row && row.value)];
      return { label:String((row && row.label) || ""), values };
    });
    const width = normalized.reduce((most, row) => Math.max(most, row.values.length), 0);
    for (const row of normalized) while (row.values.length < width) row.values.push(null);
    return { series:(Array.isArray(series) ? series : []).slice(0, width), rows:normalized };
  }

  function histogramBins(values, binCount){
    const numbers = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!numbers.length) throw toolError("히스토그램에 쓸 숫자가 없어요.");
    const min = numbers[0], max = numbers[numbers.length - 1];
    const count = Math.round(clamp(binCount || Math.ceil(Math.sqrt(numbers.length)), 2, 20));
    const span = max - min || 1;
    const step = span / count;
    const bins = [];
    for (let i = 0; i < count; i++){
      const from = min + step * i, to = i === count - 1 ? max : min + step * (i + 1);
      bins.push({ from, to, count:0 });
    }
    for (const value of numbers){
      let index = Math.floor((value - min) / step);
      if (index >= count) index = count - 1;
      if (index < 0) index = 0;
      bins[index].count++;
    }
    return bins.map((bin) => ({ label:`${formatNumber(bin.from, step)}~${formatNumber(bin.to, step)}`, value:bin.count }));
  }

  function arcPoints(cx, cy, radius, fromAngle, toAngle, segments){
    const count = Math.max(2, Math.round(segments || Math.max(6, Math.abs(toAngle - fromAngle) / (Math.PI / 18))));
    const points = [];
    for (let i = 0; i <= count; i++){
      const angle = fromAngle + (toAngle - fromAngle) * (i / count);
      points.push({ x:cx + radius * Math.cos(angle), y:cy + radius * Math.sin(angle) });
    }
    return points;
  }

  /* spec = { type:"bar"|"line"|"pie"|"histogram"|"scatter", data:"…"(또는 rows), title, width,height, axisColor, palette } */
  function chartGroup(spec){
    const options = spec || {};
    const type = ["bar", "line", "pie", "histogram", "scatter"].includes(options.type) ? options.type : "bar";
    const width = Math.round(clamp(num(options.width, 560), 220, 2400));
    const height = Math.round(clamp(num(options.height, 400), 180, 2400));
    const axisColor = /^#[0-9a-f]{6}$/i.test(String(options.axisColor || "")) ? String(options.axisColor).toLowerCase() : "#111111";
    // 색은 고른 것만 받아 쓰되, 문서에서 되살린 값이 망가져 있으면 기본 색으로 대신한다.
    const chosen = Array.isArray(options.palette) ? options.palette : [];
    const palette = chosen.length
      ? chosen.map((color, index) => (/^#[0-9a-f]{6}$/i.test(String(color)) ? String(color).toLowerCase() : CHART_PALETTE[index % CHART_PALETTE.length]))
      : CHART_PALETTE;
    const table = Array.isArray(options.rows) && options.rows.length
      ? normalizeChartTable(options.rows, options.series)
      : parseChartTable(options.data);
    const rows = table.rows;
    const title = String(options.title || "").trim();
    // 원그래프·히스토그램은 한 묶음만 그린다(부채꼴을 겹칠 수 없고, 도수분포는 값 목록 자체가 자료다).
    const seriesCount = type === "pie" || type === "histogram"
      ? 1
      : Math.max(1, rows.reduce((most, row) => Math.max(most, row.values.length), 1));
    const seriesName = (index) => String(table.series[index] || `자료 ${index + 1}`);
    const valueAt = (row, index) => {
      const value = row.values[index];
      return value == null || !Number.isFinite(Number(value)) ? null : num(value);
    };

    const items = [];
    const line = (x1, y1, x2, y2, extra) => Object.assign({ type:"line", x1, y1, x2, y2, color:axisColor, width:1.6 }, extra || {});
    const label = (x, y, text, size, extra) => Object.assign({ type:"text", x, y, text:String(text), fontSize:size || 12, color:axisColor }, extra || {});
    if (title) items.push(label(16, 8, title, 16));
    const top = title ? 34 : 16;

    if (type === "pie"){
      const total = rows.reduce((sum, row) => sum + Math.max(0, num(valueAt(row, 0))), 0);
      if (total <= 0) throw toolError("원그래프는 0보다 큰 값이 필요해요.");
      const radius = Math.max(30, Math.min(width * 0.3, (height - top - 24) / 2));
      const cx = radius + 24, cy = top + radius + 6;
      let angle = -Math.PI / 2;
      rows.forEach((row, index) => {
        const value = Math.max(0, num(valueAt(row, 0)));
        const sweep = (value / total) * Math.PI * 2;
        const color = palette[index % palette.length];
        const points = [{ x:cx, y:cy }, ...arcPoints(cx, cy, radius, angle, angle + sweep), { x:cx, y:cy }];
        items.push({ type:"polyline", points, color, width:1.5, closed:true, fill:true, alpha:0.78 });
        items.push({ type:"polyline", points, color:axisColor, width:1.4, closed:true });
        const legendY = top + index * 21;
        items.push(Object.assign({ type:"rect", x1:cx + radius + 26, y1:legendY, x2:cx + radius + 40, y2:legendY + 14, color, width:1, fill:true, alpha:0.78 }));
        items.push(label(cx + radius + 46, legendY, `${row.label} ${formatNumber(value, 0.01)} (${Math.round(value / total * 100)}%)`, 13));
        angle += sweep;
      });
      return { type:"group", role:"education-chart", x:0, y:0, w:width, h:height, sourceW:width, sourceH:height, items, educationLabel:"원그래프", educationColor:axisColor, chartSpec:{ type, rows, series:table.series, palette, title, width, height } };
    }

    const plotRows = type === "histogram"
      ? histogramBins(rows.map((row) => num(valueAt(row, 0))), options.bins).map((bin) => ({ label:bin.label, values:[bin.value] }))
      : rows;
    // 계열이 여럿이면 맨 아래 한 줄을 범례 자리로 비워 둔다(가로축 이름과 겹치지 않게).
    const legendHeight = seriesCount > 1 ? 24 : 0;
    const area = { x:52, y:top + 8, w:width - 52 - 20, h:height - top - 8 - 44 - legendHeight };
    if (area.w < 40 || area.h < 40) throw toolError("차트를 그리기에 크기가 너무 작아요.");

    // 범례는 가로축 이름 아래 한 줄로 깐다. 어느 색이 어느 묶음인지 보여 준다.
    const drawSeriesLegend = () => {
      if (seriesCount < 2) return;
      let x = area.x;
      const y = area.y + area.h + 30;
      for (let series = 0; series < seriesCount; series++){
        const name = seriesName(series), color = palette[series % palette.length];
        items.push({ type:"rect", x1:x, y1:y, x2:x + 14, y2:y + 12, color, width:1, fill:true, alpha:0.78 });
        items.push(label(x + 19, y - 1, name, 12));
        x += 19 + Math.max(24, name.length * 9) + 12;
        if (x > area.x + area.w - 40) break;                 // 넘치면 자른다(색 순서는 표 순서와 같다)
      }
    };

    const values = [];
    for (const row of plotRows){
      for (let index = 0; index < seriesCount; index++){
        const value = valueAt(row, index);
        if (value !== null) values.push(value);
      }
    }
    let maxValue = Math.max(...values, 0), minValue = Math.min(...values, 0);
    if (maxValue === minValue) maxValue = minValue + 1;
    const step = niceStep(maxValue - minValue, Math.max(3, Math.round(area.h / 46)));
    const axisTop = Math.ceil(maxValue / step) * step, axisBottom = Math.floor(minValue / step) * step;
    const vy = (value) => area.y + area.h - (value - axisBottom) / (axisTop - axisBottom || 1) * area.h;

    for (let value = axisBottom; value <= axisTop + step * 0.001; value += step){
      const py = vy(value);
      items.push(line(area.x, py, area.x + area.w, py, { width:1, alpha:0.16 }));
      items.push(label(6, py - 6, formatNumber(value, step), 11));
    }
    items.push(line(area.x, area.y, area.x, area.y + area.h, { width:1.8 }));
    items.push(line(area.x, vy(0), area.x + area.w, vy(0), { width:1.8 }));

    if (type === "scatter"){
      // 산점도만 가로축도 숫자다("3, 5" 처럼 두 값을 적은 자료).
      const xs = plotRows.map((row) => { const value = Number(String(row.label).replace(/,/g, "")); return Number.isFinite(value) ? value : NaN; });
      const usable = xs.every((value) => Number.isFinite(value)) ? xs : plotRows.map((_, index) => index + 1);
      let xMin = Math.min(...usable), xMax = Math.max(...usable);
      if (xMax === xMin){ xMin -= 1; xMax += 1; }
      const xStep = niceStep(xMax - xMin, Math.max(3, Math.round(area.w / 74)));
      const px = (value) => area.x + (value - xMin) / (xMax - xMin) * area.w;
      for (let value = Math.ceil(xMin / xStep) * xStep; value <= xMax + xStep * 0.001; value += xStep){
        items.push(line(px(value), area.y + area.h, px(value), area.y + area.h + 4, { width:1.4 }));
        items.push(label(px(value) - 10, area.y + area.h + 8, formatNumber(value, xStep), 11));
      }
      for (let series = 0; series < seriesCount; series++){
        const color = palette[series % palette.length];
        usable.forEach((x, index) => {
          const value = valueAt(plotRows[index], series);
          if (value === null) return;
          const cx = px(x), cy = vy(value), r = 4.5;
          items.push({ type:"ellipse", x1:cx - r, y1:cy - r, x2:cx + r, y2:cy + r, color, width:1.6, fill:true, alpha:0.85 });
        });
      }
      drawSeriesLegend();
      return { type:"group", role:"education-chart", x:0, y:0, w:width, h:height, sourceW:width, sourceH:height, items, educationLabel:"산점도", educationColor:axisColor, chartSpec:{ type, rows, series:table.series, palette, title, width, height } };
    }

    const slot = area.w / plotRows.length;
    if (type === "line"){
      for (let series = 0; series < seriesCount; series++){
        const color = palette[series % palette.length];
        const points = [];
        plotRows.forEach((row, index) => {
          const value = valueAt(row, series);
          if (value !== null) points.push({ x:area.x + slot * (index + 0.5), y:vy(value) });
        });
        if (points.length > 1) items.push({ type:"polyline", points, color, width:2.6 });
        points.forEach((point) => {
          items.push({ type:"ellipse", x1:point.x - 4, y1:point.y - 4, x2:point.x + 4, y2:point.y + 4, color, width:1.5, fill:true });
        });
      }
    } else {
      // 계열이 여럿이면 한 칸 안에 묶음 막대로 나란히 세운다.
      const groupWidth = slot * (type === "histogram" ? 0.94 : 0.62);
      const barWidth = Math.max(seriesCount > 1 ? 3 : 6, groupWidth / seriesCount);
      const showValues = plotRows.length * seriesCount <= 12;
      plotRows.forEach((row, index) => {
        const center = area.x + slot * (index + 0.5);
        for (let series = 0; series < seriesCount; series++){
          const value = valueAt(row, series);
          if (value === null) continue;
          // 한 묶음(막대 하나면 예전과 같은 자리)의 왼쪽 끝에서 계열 순서만큼 옮겨 세운다.
          const barCenter = center - groupWidth / 2 + barWidth * (series + 0.5);
          const color = type === "histogram" ? palette[0]
            : seriesCount > 1 ? palette[series % palette.length] : palette[index % palette.length];
          const y1 = vy(0), y2 = vy(value);
          items.push({ type:"rect", x1:barCenter - barWidth / 2, y1:Math.min(y1, y2), x2:barCenter + barWidth / 2, y2:Math.max(y1, y2), color, width:1.4, fill:true, alpha:0.78 });
          items.push({ type:"rect", x1:barCenter - barWidth / 2, y1:Math.min(y1, y2), x2:barCenter + barWidth / 2, y2:Math.max(y1, y2), color:axisColor, width:1.2 });
          if (showValues) items.push(label(barCenter - String(formatNumber(value, step)).length * 3.2, Math.min(y1, y2) - 15, formatNumber(value, step), 12));
        }
      });
    }
    plotRows.forEach((row, index) => {
      const center = area.x + slot * (index + 0.5);
      const text = String(row.label || "");
      items.push(label(center - Math.min(text.length * 3.4, slot / 2), area.y + area.h + 8, text, plotRows.length > 9 ? 10 : 12));
    });
    drawSeriesLegend();

    const labels = { bar:"막대그래프", line:"꺾은선그래프", histogram:"히스토그램" };
    return {
      type:"group", role:"education-chart", x:0, y:0, w:width, h:height, sourceW:width, sourceH:height, items,
      educationLabel:labels[type] || "차트", educationColor:axisColor,
      chartSpec:{ type, rows, series:table.series, palette, title, width, height, bins:options.bins || null }
    };
  }

  /* ---------- 4. 손그림 도형 정리 ---------- */

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function pointLineDistance(point, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return distance(point, a);
    return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / Math.hypot(dx, dy);
  }
  // Douglas-Peucker — 꼭짓점만 남겨 삼각형·사각형인지 센다.
  function simplifyPath(points, tolerance){
    if (points.length < 3) return points.slice();
    let index = 0, maxDistance = 0;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++){
      const d = pointLineDistance(points[i], first, last);
      if (d > maxDistance){ maxDistance = d; index = i; }
    }
    if (maxDistance <= tolerance) return [first, last];
    const left = simplifyPath(points.slice(0, index + 1), tolerance);
    const right = simplifyPath(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }

  /* 펜 획 하나를 반듯한 도형으로 바꾼다. 자신이 없으면 null 을 돌려주고 원래 획을 그대로 둔다
     (글씨를 도형으로 잘못 고치는 쪽이 훨씬 나쁘다). */
  function recognizeStroke(stroke, settings){
    const options = settings || {};
    const points = (stroke && Array.isArray(stroke.points) ? stroke.points : []).filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 6) return null;
    const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
    const box = { x:Math.min(...xs), y:Math.min(...ys) };
    box.w = Math.max(...xs) - box.x; box.h = Math.max(...ys) - box.y;
    const diagonal = Math.hypot(box.w, box.h);
    const minSize = num(options.minSize, 46);
    if (diagonal < minSize) return null;                     // 글씨 크기의 획은 건드리지 않는다

    let pathLength = 0;
    for (let i = 1; i < points.length; i++) pathLength += distance(points[i - 1], points[i]);
    if (pathLength < diagonal * 0.9) return null;

    const base = { color:stroke.color || "#111111", width:Math.max(1, num(stroke.width, 3)) };
    const start = points[0], end = points[points.length - 1];
    const gap = distance(start, end);
    const closed = gap < Math.max(18, diagonal * 0.26) && pathLength > diagonal * 1.6;

    if (!closed){
      const chord = distance(start, end);
      if (chord < minSize) return null;
      let maxOffset = 0;
      for (const point of points) maxOffset = Math.max(maxOffset, pointLineDistance(point, start, end));
      if (maxOffset / chord < 0.055 && pathLength / chord < 1.12){
        return Object.assign({ type:"line", x1:start.x, y1:start.y, x2:end.x, y2:end.y }, base);
      }
      return null;
    }

    // 닫힌 획: 중심에서 잰 반지름이 고르면 원, 아니면 꼭짓점을 세어 다각형으로 본다.
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const radii = points.map((point) => Math.hypot(point.x - cx, point.y - cy));
    const meanRadius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    const deviation = radii.reduce((sum, value) => sum + Math.abs(value - meanRadius), 0) / radii.length / (meanRadius || 1);
    const aspect = box.w && box.h ? Math.min(box.w, box.h) / Math.max(box.w, box.h) : 0;
    if (deviation < 0.11 && aspect > 0.45){
      return Object.assign({ type:"ellipse", x1:box.x, y1:box.y, x2:box.x + box.w, y2:box.y + box.h }, base);
    }

    const loop = points.concat([start]);
    let corners = simplifyPath(loop, Math.max(6, diagonal * 0.055));
    if (corners.length > 2 && distance(corners[0], corners[corners.length - 1]) < diagonal * 0.12) corners = corners.slice(0, -1);
    if (corners.length < 3 || corners.length > 6) return null;

    if (corners.length === 4){
      // 네 변이 가로·세로에 가까우면 반듯한 직사각형으로 맞춘다.
      const angles = corners.map((point, index) => {
        const next = corners[(index + 1) % corners.length];
        return Math.abs(Math.atan2(next.y - point.y, next.x - point.x) * 180 / Math.PI) % 90;
      });
      const axisAligned = angles.every((angle) => Math.min(angle, 90 - angle) < 12);
      if (axisAligned) return Object.assign({ type:"rect", x1:box.x, y1:box.y, x2:box.x + box.w, y2:box.y + box.h }, base);
    }
    return Object.assign({ type:"polyline", points:corners.map((point) => ({ x:point.x, y:point.y })), closed:true }, base);
  }

  const SHAPE_NAMES = { line:"직선", rect:"직사각형", ellipse:"원", polyline:"다각형" };
  function recognizedShapeName(item){
    if (!item) return "";
    if (item.type === "polyline") return (item.points || []).length === 3 ? "삼각형" : (item.points || []).length === 4 ? "사각형" : "다각형";
    return SHAPE_NAMES[item.type] || "도형";
  }

  /* ---------- 5. 교구(자·각도기·컴퍼스) 기하 ---------- */

  const toDegrees = (radians) => radians * 180 / Math.PI;
  const toRadians = (degrees) => degrees * Math.PI / 180;

  // 자의 "그리는 모서리"(눈금이 있는 위쪽 변). x,y 는 왼쪽 끝, angle 은 라디안.
  function rulerEdge(ruler){
    const angle = num(ruler && ruler.angle, 0), length = Math.max(60, num(ruler && ruler.length, 420));
    const a = { x:num(ruler && ruler.x, 0), y:num(ruler && ruler.y, 0) };
    return { a, b:{ x:a.x + Math.cos(angle) * length, y:a.y + Math.sin(angle) * length }, angle, length };
  }

  // 점을 선분 위로 내린 발. t 는 0~1 로 잘라 자 밖으로 새지 않게 한다.
  function projectOnSegment(point, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return { x:a.x, y:a.y, t:0, distance:distance(point, a) };
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
    const projected = { x:a.x + dx * t, y:a.y + dy * t };
    return { x:projected.x, y:projected.y, t, distance:distance(point, projected) };
  }

  // 자에 닿은 점만 모서리에 붙인다(band 밖이면 그대로 자유롭게 그린다).
  function snapToRuler(point, ruler, band){
    if (!ruler || ruler.active === false) return null;
    const edge = rulerEdge(ruler);
    const hit = projectOnSegment(point, edge.a, edge.b);
    return hit.distance <= Math.max(6, num(band, 30)) ? { x:hit.x, y:hit.y, t:hit.t } : null;
  }

  // 15°(또는 지정한 각) 단위로 방향을 맞춘 끝점.
  function snapAngle(from, to, stepDegrees){
    const step = Math.max(1, num(stepDegrees, 15));
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) return { x:to.x, y:to.y, angle:0 };
    const snapped = toRadians(Math.round(toDegrees(Math.atan2(dy, dx)) / step) * step);
    return { x:from.x + Math.cos(snapped) * length, y:from.y + Math.sin(snapped) * length, angle:snapped };
  }

  // 각도기 읽기: 화면 좌표는 y 가 아래로 자라므로 부호를 뒤집어 사람이 읽는 각으로 만든다.
  function measureAngle(center, point, baseAngle){
    // 도구 angle 은 화면 좌표의 시계 방향이고 raw 는 y축을 뒤집은 수학 좌표의 반시계 방향이다.
    // 따라서 회전한 기준선을 0°로 되돌릴 때는 화면 각도를 더해야 한다.
    const raw = Math.atan2(-(point.y - center.y), point.x - center.x) + num(baseAngle, 0);
    let degrees = toDegrees(raw) % 360;
    if (degrees < 0) degrees += 360;
    return degrees;
  }

  function lengthInCm(pixels, pxPerCm){
    return num(pixels, 0) / Math.max(1, num(pxPerCm, PX_PER_CM));
  }

  // 컴퍼스가 그린 호(또는 원)를 벡터 항목으로. 350° 넘게 돌면 원으로 닫는다.
  function compassArcItem(compass, color, width){
    const cx = num(compass && compass.cx, 0), cy = num(compass && compass.cy, 0);
    const radius = Math.max(4, num(compass && compass.radius, 60));
    const from = num(compass && compass.from, 0), to = num(compass && compass.to, 0);
    const sweep = Math.abs(to - from);
    if (sweep >= toRadians(350)){
      return { type:"ellipse", x1:cx - radius, y1:cy - radius, x2:cx + radius, y2:cy + radius, color:color || "#111111", width:num(width, 3) };
    }
    if (sweep < toRadians(3)) return null;
    const segments = Math.max(12, Math.round(sweep / (Math.PI / 60)));
    return { type:"polyline", points:arcPoints(cx, cy, radius, from, to, segments), color:color || "#111111", width:num(width, 3) };
  }

  /* ---------- 6. 변환 기하(대칭·평행이동·회전·닮음) ---------- */

  /* spec 예: {kind:"translate",dx,dy} {kind:"rotate",cx,cy,degrees}
              {kind:"reflect",ax,ay,bx,by}(직선 대칭) {kind:"point",cx,cy}(점대칭) {kind:"scale",cx,cy,factor} */
  function makeTransform(spec){
    const kind = spec && spec.kind;
    if (kind === "translate"){
      const dx = num(spec.dx), dy = num(spec.dy);
      return { kind, map:(p) => ({ x:p.x + dx, y:p.y + dy }), scale:1, mirrored:false, rotation:0 };
    }
    if (kind === "rotate" || kind === "point"){
      const radians = kind === "point" ? Math.PI : toRadians(num(spec.degrees, 90));
      const cx = num(spec.cx), cy = num(spec.cy), cos = Math.cos(radians), sin = Math.sin(radians);
      return {
        map:(p) => ({ x:cx + (p.x - cx) * cos - (p.y - cy) * sin, y:cy + (p.x - cx) * sin + (p.y - cy) * cos }),
        kind, scale:1, mirrored:false, rotation:radians
      };
    }
    if (kind === "scale"){
      const cx = num(spec.cx), cy = num(spec.cy), factor = num(spec.factor, 1);
      if (!factor) throw toolError("닮음비는 0이 될 수 없어요.");
      return { kind, map:(p) => ({ x:cx + (p.x - cx) * factor, y:cy + (p.y - cy) * factor }), scale:Math.abs(factor), mirrored:factor < 0, rotation:0 };
    }
    if (kind === "reflect"){
      const a = { x:num(spec.ax), y:num(spec.ay) }, b = { x:num(spec.bx), y:num(spec.by) };
      const dx = b.x - a.x, dy = b.y - a.y;
      if (!dx && !dy) throw toolError("대칭축으로 쓸 직선이 없어요.");
      const angle = Math.atan2(dy, dx), cos = Math.cos(2 * angle), sin = Math.sin(2 * angle);
      return {
        // 점을 축 위로 옮겨 각도 2φ 만큼 되비추는 표준 반사 공식
        map:(p) => {
          const px = p.x - a.x, py = p.y - a.y;
          return { x:a.x + px * cos + py * sin, y:a.y + px * sin - py * cos };
        },
        kind, scale:1, mirrored:true, rotation:2 * angle
      };
    }
    throw toolError("모르는 변환이에요.");
  }

  function canTransformItem(item, transformOrSpec){
    if (!item || typeof item !== "object") return false;
    const kind = transformOrSpec && transformOrSpec.kind;
    if (item.type === "image") return kind === "translate" || kind === "scale";
    return ["line", "arrow", "rect", "ellipse", "polyline", "text", "group", "pen", "highlighter", "eraser"].includes(item.type);
  }

  function transformedItem(item, transform, measureText){
    if (!item || typeof item !== "object") return null;
    if (!canTransformItem(item, transform)) return null;
    // 삼각함수를 거치면 190 이 189.99999… 로 남는다 — 저장본이 지저분해지지 않게 소수점에서 끊는다.
    const round = (value) => Math.round(value * 1e4) / 1e4;
    const map = (point) => { const mapped = transform.map(point); return { x:round(mapped.x), y:round(mapped.y) }; };
    const factor = transform.scale;
    const scaleWidth = (value) => Math.max(.5, num(value, 3) * factor);
    if (item.type === "line" || item.type === "arrow"){
      const a = map({ x:item.x1, y:item.y1 }), b = map({ x:item.x2, y:item.y2 });
      return Object.assign({}, item, { x1:a.x, y1:a.y, x2:b.x, y2:b.y, width:scaleWidth(item.width) });
    }
    if (item.type === "polyline"){
      return Object.assign({}, item, { points:(item.points || []).map(map), width:scaleWidth(item.width) });
    }
    if (item.type === "rect"){
      const corners = [{ x:item.x1, y:item.y1 }, { x:item.x2, y:item.y1 }, { x:item.x2, y:item.y2 }, { x:item.x1, y:item.y2 }].map(map);
      // 90°의 배수로 돌리거나 뒤집은 사각형은 여전히 반듯하다 — 그때는 rect 로 남긴다.
      const axisAligned = (Math.abs(corners[0].y - corners[1].y) < .01 && Math.abs(corners[1].x - corners[2].x) < .01)
        || (Math.abs(corners[0].x - corners[1].x) < .01 && Math.abs(corners[1].y - corners[2].y) < .01);
      if (axisAligned){
        const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
        return Object.assign({}, item, { x1:Math.min(...xs), y1:Math.min(...ys), x2:Math.max(...xs), y2:Math.max(...ys), width:scaleWidth(item.width) });
      }
      // 기울어진 사각형은 rect 로 표현할 수 없으므로 닫힌 다각형으로 바꾼다.
      return Object.assign({}, item, { type:"polyline", points:corners, closed:true, width:scaleWidth(item.width) });
    }
    if (item.type === "ellipse"){
      const center = map({ x:(item.x1 + item.x2) / 2, y:(item.y1 + item.y2) / 2 });
      const rx = Math.abs(item.x2 - item.x1) / 2 * factor, ry = Math.abs(item.y2 - item.y1) / 2 * factor;
      const base = num(item.rotation, 0);
      const rotation = transform.mirrored ? transform.rotation - base : base + transform.rotation;
      return Object.assign({}, item, {
        x1:center.x - rx, y1:center.y - ry, x2:center.x + rx, y2:center.y + ry,
        rotation, width:scaleWidth(item.width)
      });
    }
    if (item.type === "text"){
      // 글자는 뒤집거나 눕히지 않는다 — 읽을 수 없는 판서가 되기 때문이다. 자리와 크기만 옮긴다.
      const box = itemBoundsSafe(item, measureText);
      const center = map({ x:box.x + box.w / 2, y:box.y + box.h / 2 });
      const fontSize = Math.max(6, num(item.fontSize, 16) * factor);
      const width = box.w * factor, height = box.h * factor;
      return Object.assign({}, item, { x:center.x - width / 2, y:center.y - height / 2, fontSize, textBaseFontSize:fontSize });
    }
    if (item.type === "image"){
      const center = map({ x:item.x + item.w / 2, y:item.y + item.h / 2 });
      const w = item.w * factor, h = item.h * factor;
      return Object.assign({}, item, { x:center.x - w / 2, y:center.y - h / 2, w, h });
    }
    if (item.type === "group"){
      // 그룹은 자식 좌표가 지역 좌표라 회전을 담을 수 없다 — 보드 좌표로 풀어서 옮기고 다시 묶는다.
      const children = ungroupToBoard(item, measureText).map((child) => transformedItem(child, transform, measureText)).filter(Boolean);
      if (!children.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const child of children){
        const box = itemBoundsSafe(child, measureText);
        minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w); maxY = Math.max(maxY, box.y + box.h);
      }
      const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
      const local = children.map((child) => shiftItem(child, -minX, -minY));
      const next = Object.assign({}, item, {
        x:minX, y:minY, w:width, h:height, sourceW:width, sourceH:height, items:local, flipX:false, flipY:false
      });
      // 그래프·차트는 원본 입력을 들고 있는데, 변환한 사본은 더 이상 그 식의 그림이 아니다.
      delete next.plotSpec; delete next.chartSpec;
      return next;
    }
    if (item.type === "pen" || item.type === "highlighter" || item.type === "eraser"){
      return Object.assign({}, item, { points:(item.points || []).map(map), width:scaleWidth(item.width) });
    }
    return null;
  }

  function shiftItem(item, dx, dy){
    if (item.type === "image" || item.type === "text" || item.type === "group") return Object.assign({}, item, { x:item.x + dx, y:item.y + dy });
    if (item.points) return Object.assign({}, item, { points:item.points.map((p) => ({ x:p.x + dx, y:p.y + dy })) });
    return Object.assign({}, item, { x1:item.x1 + dx, y1:item.y1 + dy, x2:item.x2 + dx, y2:item.y2 + dy });
  }

  // board-render.js 가 있으면 그 계산을 쓰고(화면과 정확히 일치), 없으면 같은 규칙으로 대신 잰다.
  function itemBoundsSafe(item, measureText){
    if (typeof MNBoardRenderer !== "undefined" && MNBoardRenderer && typeof MNBoardRenderer.itemBounds === "function"){
      const bounds = MNBoardRenderer.itemBounds(item, measureText);
      if (bounds) return bounds;
    }
    if (item.type === "image" || item.type === "group") return { x:item.x, y:item.y, w:item.w, h:item.h };
    if (item.type === "text"){
      const size = Math.max(1, num(item.fontSize, 16));
      const lines = String(item.text || "").split("\n");
      const width = Math.max(1, ...lines.map((line) => (typeof measureText === "function" ? num(measureText(line, size), line.length * size * .6) : line.length * size * .6)));
      return { x:item.x, y:item.y, w:width, h:Math.max(size, lines.length * size * 1.25) };
    }
    const points = item.points || [{ x:item.x1, y:item.y1 }, { x:item.x2, y:item.y2 }];
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs) - Math.min(...xs), h:Math.max(...ys) - Math.min(...ys) };
  }

  function ungroupToBoard(group, measureText){
    if (typeof MNBoardRenderer !== "undefined" && MNBoardRenderer && typeof MNBoardRenderer.ungroupItem === "function"){
      return MNBoardRenderer.ungroupItem(group, measureText);
    }
    return Array.isArray(group.items) ? group.items.map((child) => shiftItem(child, num(group.x), num(group.y))) : [];
  }

  const TRANSFORM_NAMES = { translate:"평행이동", rotate:"회전", point:"점대칭", reflect:"선대칭", scale:"닮음" };
  function transformName(spec){ return TRANSFORM_NAMES[spec && spec.kind] || "변환"; }

  /* ---------- 7. 동적 측정(길이·각도·넓이) ---------- */

  function polygonArea(points){
    const list = Array.isArray(points) ? points : [];
    if (list.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < list.length; i++){
      const a = list[i], b = list[(i + 1) % list.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  const cmText = (pixels) => (pixels / PX_PER_CM).toFixed(1) + "cm";
  const areaText = (squarePixels) => (squarePixels / (PX_PER_CM * PX_PER_CM)).toFixed(1) + "cm²";

  // 그림에 붙일 측정값. 항목을 옮기거나 크기를 바꾸면 이 함수를 다시 불러 갱신한다.
  function measureLabel(item, measureText){
    if (!item || typeof item !== "object") return null;
    if (item.type === "line" || item.type === "arrow"){
      const dx = item.x2 - item.x1, dy = item.y2 - item.y1;
      const length = Math.hypot(dx, dy);
      const normal = length ? { x:-dy / length, y:dx / length } : { x:0, y:-1 };
      return {
        kind:"length", text:cmText(length),
        x:(item.x1 + item.x2) / 2 + normal.x * 16 - 20, y:(item.y1 + item.y2) / 2 + normal.y * 16 - 9
      };
    }
    if (item.type === "rect"){
      const w = Math.abs(item.x2 - item.x1), h = Math.abs(item.y2 - item.y1);
      return {
        kind:"area", text:`${cmText(w)} × ${cmText(h)} = ${areaText(w * h)}`,
        x:(item.x1 + item.x2) / 2 - 60, y:(item.y1 + item.y2) / 2 - 9
      };
    }
    if (item.type === "ellipse"){
      const rx = Math.abs(item.x2 - item.x1) / 2, ry = Math.abs(item.y2 - item.y1) / 2;
      const round = Math.abs(rx - ry) < Math.max(rx, ry) * .04;
      const text = round ? `반지름 ${cmText(rx)} · ${areaText(Math.PI * rx * ry)}` : `${cmText(rx * 2)} × ${cmText(ry * 2)} · ${areaText(Math.PI * rx * ry)}`;
      return { kind:"area", text, x:(item.x1 + item.x2) / 2 - 62, y:(item.y1 + item.y2) / 2 - 9 };
    }
    if (item.type === "polyline"){
      const points = Array.isArray(item.points) ? item.points : [];
      if (points.length === 3 && !item.closed){
        // 꺾인 점이 하나면 그 자리의 각을 잰다(각도 학습용).
        const [a, b, c] = points;
        const first = Math.atan2(a.y - b.y, a.x - b.x), second = Math.atan2(c.y - b.y, c.x - b.x);
        let degrees = Math.abs(toDegrees(first - second)) % 360;
        if (degrees > 180) degrees = 360 - degrees;
        const bisector = (first + second) / 2;
        return { kind:"angle", text:`${degrees.toFixed(degrees % 1 ? 1 : 0)}°`, x:b.x + Math.cos(bisector) * 34 - 14, y:b.y + Math.sin(bisector) * 34 - 9 };
      }
      if (item.closed && points.length >= 3){
        const area = polygonArea(points);
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        return { kind:"area", text:areaText(area), x:cx - 26, y:cy - 9 };
      }
      if (!item.closed && points.length >= 2){
        let length = 0;
        for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
        const middle = points[Math.floor(points.length / 2)];
        return { kind:"length", text:cmText(length), x:middle.x - 20, y:middle.y - 20 };
      }
      return null;
    }
    if (item.type === "group"){
      const box = itemBoundsSafe(item, measureText);
      return { kind:"area", text:`${cmText(box.w)} × ${cmText(box.h)}`, x:box.x + box.w / 2 - 44, y:box.y - 24 };
    }
    return null;
  }

  /* ---------- 8. 화학(주기율표·반응식 균형) ---------- */

  // 번호,기호,이름,원자량,족(0=란타넘·악티늄족),주기,분류
  const PERIODIC_SOURCE = [
    "1,H,수소,1.008,1,1,비금속", "2,He,헬륨,4.003,18,1,비활성기체",
    "3,Li,리튬,6.94,1,2,알칼리금속", "4,Be,베릴륨,9.012,2,2,알칼리토금속", "5,B,붕소,10.81,13,2,준금속", "6,C,탄소,12.011,14,2,비금속",
    "7,N,질소,14.007,15,2,비금속", "8,O,산소,15.999,16,2,비금속", "9,F,플루오린,18.998,17,2,할로젠", "10,Ne,네온,20.180,18,2,비활성기체",
    "11,Na,나트륨,22.990,1,3,알칼리금속", "12,Mg,마그네슘,24.305,2,3,알칼리토금속", "13,Al,알루미늄,26.982,13,3,전이후금속", "14,Si,규소,28.085,14,3,준금속",
    "15,P,인,30.974,15,3,비금속", "16,S,황,32.06,16,3,비금속", "17,Cl,염소,35.45,17,3,할로젠", "18,Ar,아르곤,39.95,18,3,비활성기체",
    "19,K,칼륨,39.098,1,4,알칼리금속", "20,Ca,칼슘,40.078,2,4,알칼리토금속", "21,Sc,스칸듐,44.956,3,4,전이금속", "22,Ti,타이타늄,47.867,4,4,전이금속",
    "23,V,바나듐,50.942,5,4,전이금속", "24,Cr,크로뮴,51.996,6,4,전이금속", "25,Mn,망가니즈,54.938,7,4,전이금속", "26,Fe,철,55.845,8,4,전이금속",
    "27,Co,코발트,58.933,9,4,전이금속", "28,Ni,니켈,58.693,10,4,전이금속", "29,Cu,구리,63.546,11,4,전이금속", "30,Zn,아연,65.38,12,4,전이금속",
    "31,Ga,갈륨,69.723,13,4,전이후금속", "32,Ge,저마늄,72.630,14,4,준금속", "33,As,비소,74.922,15,4,준금속", "34,Se,셀레늄,78.971,16,4,비금속",
    "35,Br,브로민,79.904,17,4,할로젠", "36,Kr,크립톤,83.798,18,4,비활성기체",
    "37,Rb,루비듐,85.468,1,5,알칼리금속", "38,Sr,스트론튬,87.62,2,5,알칼리토금속", "39,Y,이트륨,88.906,3,5,전이금속", "40,Zr,지르코늄,91.224,4,5,전이금속",
    "41,Nb,나이오븀,92.906,5,5,전이금속", "42,Mo,몰리브데넘,95.95,6,5,전이금속", "43,Tc,테크네튬,98,7,5,전이금속", "44,Ru,루테늄,101.07,8,5,전이금속",
    "45,Rh,로듐,102.906,9,5,전이금속", "46,Pd,팔라듐,106.42,10,5,전이금속", "47,Ag,은,107.868,11,5,전이금속", "48,Cd,카드뮴,112.414,12,5,전이금속",
    "49,In,인듐,114.818,13,5,전이후금속", "50,Sn,주석,118.710,14,5,전이후금속", "51,Sb,안티모니,121.760,15,5,준금속", "52,Te,텔루륨,127.60,16,5,준금속",
    "53,I,아이오딘,126.904,17,5,할로젠", "54,Xe,제논,131.293,18,5,비활성기체",
    "55,Cs,세슘,132.905,1,6,알칼리금속", "56,Ba,바륨,137.327,2,6,알칼리토금속",
    "57,La,란타넘,138.905,0,6,란타넘족", "58,Ce,세륨,140.116,0,6,란타넘족", "59,Pr,프라세오디뮴,140.908,0,6,란타넘족", "60,Nd,네오디뮴,144.242,0,6,란타넘족",
    "61,Pm,프로메튬,145,0,6,란타넘족", "62,Sm,사마륨,150.36,0,6,란타넘족", "63,Eu,유로퓸,151.964,0,6,란타넘족", "64,Gd,가돌리늄,157.25,0,6,란타넘족",
    "65,Tb,터븀,158.925,0,6,란타넘족", "66,Dy,디스프로슘,162.500,0,6,란타넘족", "67,Ho,홀뮴,164.930,0,6,란타넘족", "68,Er,어븀,167.259,0,6,란타넘족",
    "69,Tm,툴륨,168.934,0,6,란타넘족", "70,Yb,이터븀,173.045,0,6,란타넘족", "71,Lu,루테튬,174.967,0,6,란타넘족",
    "72,Hf,하프늄,178.486,4,6,전이금속", "73,Ta,탄탈럼,180.948,5,6,전이금속", "74,W,텅스텐,183.84,6,6,전이금속", "75,Re,레늄,186.207,7,6,전이금속",
    "76,Os,오스뮴,190.23,8,6,전이금속", "77,Ir,이리듐,192.217,9,6,전이금속", "78,Pt,백금,195.084,10,6,전이금속", "79,Au,금,196.967,11,6,전이금속",
    "80,Hg,수은,200.592,12,6,전이금속", "81,Tl,탈륨,204.38,13,6,전이후금속", "82,Pb,납,207.2,14,6,전이후금속", "83,Bi,비스무트,208.980,15,6,전이후금속",
    "84,Po,폴로늄,209,16,6,준금속", "85,At,아스타틴,210,17,6,할로젠", "86,Rn,라돈,222,18,6,비활성기체",
    "87,Fr,프랑슘,223,1,7,알칼리금속", "88,Ra,라듐,226,2,7,알칼리토금속",
    "89,Ac,악티늄,227,0,7,악티늄족", "90,Th,토륨,232.038,0,7,악티늄족", "91,Pa,프로트악티늄,231.036,0,7,악티늄족", "92,U,우라늄,238.029,0,7,악티늄족",
    "93,Np,넵투늄,237,0,7,악티늄족", "94,Pu,플루토늄,244,0,7,악티늄족", "95,Am,아메리슘,243,0,7,악티늄족", "96,Cm,퀴륨,247,0,7,악티늄족",
    "97,Bk,버클륨,247,0,7,악티늄족", "98,Cf,캘리포늄,251,0,7,악티늄족", "99,Es,아인슈타이늄,252,0,7,악티늄족", "100,Fm,페르뮴,257,0,7,악티늄족",
    "101,Md,멘델레븀,258,0,7,악티늄족", "102,No,노벨륨,259,0,7,악티늄족", "103,Lr,로렌슘,266,0,7,악티늄족",
    "104,Rf,러더포듐,267,4,7,전이금속", "105,Db,더브늄,268,5,7,전이금속", "106,Sg,시보귬,269,6,7,전이금속", "107,Bh,보륨,270,7,7,전이금속",
    "108,Hs,하슘,269,8,7,전이금속", "109,Mt,마이트너륨,278,9,7,전이금속", "110,Ds,다름슈타튬,281,10,7,전이금속", "111,Rg,뢴트게늄,282,11,7,전이금속",
    "112,Cn,코페르니슘,285,12,7,전이금속", "113,Nh,니호늄,286,13,7,전이후금속", "114,Fl,플레로븀,289,14,7,전이후금속", "115,Mc,모스코븀,290,15,7,전이후금속",
    "116,Lv,리버모륨,293,16,7,전이후금속", "117,Ts,테네신,294,17,7,할로젠", "118,Og,오가네손,294,18,7,비활성기체"
  ];
  const PERIODIC_TABLE = PERIODIC_SOURCE.map((row) => {
    const [number, symbol, name, mass, group, period, category] = row.split(",");
    return { number:Number(number), symbol, name, mass:Number(mass), group:Number(group), period:Number(period), category };
  });
  const ELEMENT_BY_SYMBOL = new Map(PERIODIC_TABLE.map((element) => [element.symbol, element]));
  const ELEMENT_CATEGORY_COLORS = {
    "비금속":"#16a34a", "비활성기체":"#0891b2", "알칼리금속":"#e11d48", "알칼리토금속":"#f59e0b",
    "전이금속":"#2563eb", "전이후금속":"#64748b", "준금속":"#7c3aed", "할로젠":"#db2777",
    "란타넘족":"#0d9488", "악티늄족":"#a16207"
  };
  function findElements(query){
    const term = String(query || "").trim().toLowerCase();
    if (!term) return PERIODIC_TABLE.slice();
    return PERIODIC_TABLE.filter((element) => element.symbol.toLowerCase() === term
      || element.symbol.toLowerCase().startsWith(term)
      || element.name.includes(term) || String(element.number) === term || element.category.includes(term));
  }
  // 원소 카드(번호·기호·이름·원자량) — 보드에 놓고 크기를 키울 수 있는 벡터 묶음.
  function elementCardGroup(element, color){
    const source = typeof element === "string" || typeof element === "number" ? findElements(element)[0] : element;
    if (!source) throw toolError("그런 원소를 찾지 못했어요.");
    const ink = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? String(color).toLowerCase() : (ELEMENT_CATEGORY_COLORS[source.category] || "#111111");
    const width = 170, height = 190;
    const items = [
      { type:"rect", x1:6, y1:6, x2:width - 6, y2:height - 6, color:ink, width:2.4 },
      { type:"text", x:16, y:16, text:String(source.number), fontSize:20, color:ink },
      { type:"text", x:width / 2 - source.symbol.length * 18, y:height / 2 - 44, text:source.symbol, fontSize:62, color:ink },
      { type:"text", x:width / 2 - source.name.length * 8, y:height - 62, text:source.name, fontSize:18, color:ink },
      { type:"text", x:width / 2 - 24, y:height - 36, text:String(source.mass), fontSize:15, color:ink },
      { type:"text", x:width - 12 - source.category.length * 10, y:16, text:source.category, fontSize:11, color:ink, alpha:.7 }
    ];
    return {
      type:"group", role:"education-element", x:0, y:0, w:width, h:height, sourceW:width, sourceH:height, items,
      educationLabel:`${source.name}(${source.symbol})`, educationColor:ink, elementNumber:source.number
    };
  }

  const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
  const toSubscript = (digits) => String(digits).replace(/[0-9]/g, (digit) => SUBSCRIPTS[Number(digit)]);
  function formulaWithSubscripts(formula){
    return String(formula || "").replace(/([A-Za-z\)\]])(\d+)/g, (_, head, digits) => head + toSubscript(digits));
  }

  // H2O · Ca(OH)2 처럼 괄호가 있는 화학식을 원소별 개수로 편다.
  function parseChemicalFormula(formula){
    const text = String(formula || "").replace(/\s+/g, "");
    if (!text) throw toolError("화학식을 입력하세요.");
    let index = 0;
    const readCount = () => {
      let digits = "";
      while (index < text.length && /[0-9]/.test(text[index])) digits += text[index++];
      return digits ? Number(digits) : 1;
    };
    const parseGroup = (depth) => {
      const counts = {};
      const add = (symbol, amount) => { counts[symbol] = (counts[symbol] || 0) + amount; };
      while (index < text.length){
        const ch = text[index];
        if (ch === "(" || ch === "["){
          index++;
          const inner = parseGroup(depth + 1);
          const closing = text[index];
          if (closing !== ")" && closing !== "]") throw toolError("괄호가 닫히지 않았어요: " + formula);
          index++;
          const multiplier = readCount();
          for (const symbol in inner) add(symbol, inner[symbol] * multiplier);
          continue;
        }
        if (ch === ")" || ch === "]"){
          if (!depth) throw toolError("여는 괄호가 없어요: " + formula);
          return counts;
        }
        if (/[A-Z]/.test(ch)){
          let symbol = text[index++];
          if (index < text.length && /[a-z]/.test(text[index])) symbol += text[index++];
          if (!ELEMENT_BY_SYMBOL.has(symbol)) throw toolError(`모르는 원소 기호예요: ${symbol}`);
          add(symbol, readCount());
          continue;
        }
        throw toolError(`화학식에 쓸 수 없는 글자예요: ${ch}`);
      }
      if (depth) throw toolError("괄호가 닫히지 않았어요: " + formula);
      return counts;
    };
    const counts = parseGroup(0);
    if (!Object.keys(counts).length) throw toolError("화학식을 읽지 못했어요: " + formula);
    return counts;
  }

  // 정수 분수 계산 — 소수 오차 없이 계수를 구하려면 유리수 그대로 다뤄야 한다.
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b){ const t = a % b; a = b; b = t; } return a || 1; };
  const fraction = (numerator, denominator = 1) => {
    if (!denominator) throw toolError("계수를 구하지 못했어요.");
    if (denominator < 0){ numerator = -numerator; denominator = -denominator; }
    const divisor = gcd(numerator, denominator);
    return { n:numerator / divisor, d:denominator / divisor };
  };
  const fractionSub = (a, b) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
  const fractionMul = (a, b) => fraction(a.n * b.n, a.d * b.d);
  const fractionDiv = (a, b) => { if (!b.n) throw toolError("계수를 구하지 못했어요."); return fraction(a.n * b.d, a.d * b.n); };

  /* "H2 + O2 -> H2O" → {coefficients:[2,1,2], text:"2H₂ + O₂ → 2H₂O"} */
  function balanceEquation(equation){
    const raw = String(equation || "").replace(/[⟶→⇒=]+>?/g, ">").replace(/-+>/g, ">");
    const sides = raw.split(">");
    if (sides.length !== 2) throw toolError("‘반응물 -> 생성물’ 처럼 화살표로 나눠 적어 주세요.");
    const splitSide = (side) => String(side).split("+").map((part) => part.trim()).filter(Boolean)
      .map((part) => part.replace(/^\d+\s*/, ""));                       // 이미 적은 계수는 새로 구한다
    const left = splitSide(sides[0]), right = splitSide(sides[1]);
    if (!left.length || !right.length) throw toolError("반응물과 생성물을 모두 적어 주세요.");
    const species = left.concat(right);
    if (species.length > 12) throw toolError("물질이 너무 많아요. 12개 이하로 적어 주세요.");
    const parsed = species.map(parseChemicalFormula);
    const elements = [];
    for (const counts of parsed) for (const symbol in counts) if (!elements.includes(symbol)) elements.push(symbol);

    // 원소별 보존식을 세워 A·x = 0 의 해를 구한다(왼쪽 +, 오른쪽 −).
    const rows = elements.map((symbol) => parsed.map((counts, index) => {
      const amount = counts[symbol] || 0;
      return fraction(index < left.length ? amount : -amount);
    }));
    const columns = species.length;
    const pivots = [];
    let row = 0;
    for (let column = 0; column < columns && row < rows.length; column++){
      let pivot = -1;
      for (let r = row; r < rows.length; r++) if (rows[r][column].n !== 0){ pivot = r; break; }
      if (pivot < 0) continue;
      [rows[row], rows[pivot]] = [rows[pivot], rows[row]];
      const head = rows[row][column];
      rows[row] = rows[row].map((value) => fractionDiv(value, head));
      for (let r = 0; r < rows.length; r++){
        if (r === row || rows[r][column].n === 0) continue;
        const factor = rows[r][column];
        rows[r] = rows[r].map((value, index) => fractionSub(value, fractionMul(factor, rows[row][index])));
      }
      pivots.push(column); row++;
    }
    const free = [];
    for (let column = 0; column < columns; column++) if (!pivots.includes(column)) free.push(column);
    if (free.length !== 1) throw toolError(free.length ? "이 식은 계수가 하나로 정해지지 않아요." : "균형을 맞출 수 없는 식이에요. 화학식을 확인하세요.");

    const solution = new Array(columns).fill(null).map(() => fraction(0));
    solution[free[0]] = fraction(1);
    pivots.forEach((column, index) => { solution[column] = fraction(-rows[index][free[0]].n, rows[index][free[0]].d); });
    let multiplier = 1;
    for (const value of solution) multiplier = multiplier * value.d / gcd(multiplier, value.d);
    const integers = solution.map((value) => Math.round(value.n * multiplier / value.d));
    const divisor = integers.reduce((acc, value) => gcd(acc, value), 0) || 1;
    const coefficients = integers.map((value) => value / divisor);
    if (coefficients.some((value) => value <= 0)) throw toolError("균형을 맞출 수 없는 식이에요. 반응물과 생성물을 확인하세요.");

    const render = (list, offset) => list.map((formula, index) => {
      const coefficient = coefficients[offset + index];
      return (coefficient === 1 ? "" : String(coefficient)) + formulaWithSubscripts(formula);
    }).join(" + ");
    return {
      coefficients, species, left, right,
      text:`${render(left, 0)} → ${render(right, left.length)}`
    };
  }

  /* ---------- 9. 확률 실험(동전·주사위·무작위 수) ---------- */

  const SIMULATIONS = {
    coin:{ label:"동전", labels:["앞", "뒤"], roll:(random) => (random() < .5 ? "앞" : "뒤") },
    dice:{ label:"주사위", labels:["1", "2", "3", "4", "5", "6"], roll:(random) => String(Math.floor(random() * 6) + 1) },
    dice2:{ label:"주사위 2개의 합", labels:["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
      roll:(random) => String(Math.floor(random() * 6) + 1 + Math.floor(random() * 6) + 1) }
  };
  /* kind: coin|dice|dice2|number. number 는 options.min~options.max 정수를 뽑는다.
     options.random 을 주면 그 난수를 쓴다(시험에서 결과를 고정하기 위함). */
  function simulateTrials(kind, count, options){
    const settings = options || {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const trials = Math.round(clamp(num(count, 100), 1, 100000));
    let labels, roll;
    if (kind === "number"){
      const min = Math.round(num(settings.min, 1)), max = Math.round(num(settings.max, 10));
      if (max <= min) throw toolError("최댓값은 최솟값보다 커야 해요.");
      if (max - min > 60) throw toolError("뽑을 수 있는 값이 너무 많아요. 60가지 이하로 정해 주세요.");
      labels = []; for (let value = min; value <= max; value++) labels.push(String(value));
      roll = () => String(min + Math.floor(random() * (max - min + 1)));
    } else {
      const simulation = SIMULATIONS[kind];
      if (!simulation) throw toolError("모르는 실험이에요.");
      labels = simulation.labels; roll = () => simulation.roll(random);
    }
    const counts = new Map(labels.map((label) => [label, 0]));
    let sum = 0, numeric = true;
    for (let i = 0; i < trials; i++){
      const outcome = roll();
      counts.set(outcome, (counts.get(outcome) || 0) + 1);
      const value = Number(outcome);
      if (Number.isFinite(value)) sum += value; else numeric = false;
    }
    const rows = labels.map((label) => ({ label, value:counts.get(label) || 0 }));
    const best = rows.reduce((top, row) => (row.value > top.value ? row : top), rows[0]);
    const title = (kind === "number" ? "무작위 수" : SIMULATIONS[kind].label) + ` ${trials}회`;
    const summary = numeric
      ? `평균 ${(sum / trials).toFixed(2)} · 가장 많이 나온 값 ${best.label}(${best.value}회, ${(best.value / trials * 100).toFixed(1)}%)`
      : `${best.label} ${best.value}회(${(best.value / trials * 100).toFixed(1)}%)`;
    return { rows, title, summary, trials, data:rows.map((row) => `${row.label}, ${row.value}`).join("\n") };
  }

  return Object.freeze({
    PX_PER_CM, CHART_PALETTE, CURVE_COLORS, PERIODIC_TABLE, ELEMENT_CATEGORY_COLORS,
    parseExpression, stripEquationPrefix, plotGroup, niceStep, formatNumber, clipSegment,
    parseChartData, parseChartTable, chartGroup, histogramBins, arcPoints,
    recognizeStroke, recognizedShapeName, simplifyPath,
    rulerEdge, projectOnSegment, snapToRuler, snapAngle, measureAngle, lengthInCm, compassArcItem,
    makeTransform, canTransformItem, transformedItem, transformName, itemBoundsSafe,
    measureLabel, polygonArea,
    findElements, elementCardGroup, parseChemicalFormula, balanceEquation, formulaWithSubscripts,
    simulateTrials
  });
})();

if (typeof module !== "undefined" && module.exports){
  module.exports = MNBoardTools;
}
