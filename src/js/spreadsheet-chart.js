"use strict";
/*
 * 스프레드시트 선택 영역 → 차트 (완전 오프라인, 의존성 0)
 * - 선택한 2차원 표(문자열 matrix)를 받아 라벨/계열을 추정하고 인라인 SVG 로 그린다.
 * - 종류: 막대 · 꺾은선 · 원 · 산점도 (버튼으로 즉시 전환).
 * - 저장: PNG 파일(EXE 저장폴더/브라우저 다운로드) · 현재 메모로 보내기 — 기존 이미지 파이프라인 재사용.
 * 공개 API: window.openSpreadsheetChart({ matrix, label })
 */
(function(){
  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#3b6fe0","#e2673b","#2ea56d","#a855d6","#e0a400","#e15a8e","#1aa5b8","#8a6d3b","#7a869a","#4c9f4c"];
  const W = 780, H = 480;

  function svgEl(name, attrs, text){
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  // 셀 텍스트 → 숫자 (천단위 콤마·통화·%·회계식 음수 (123) 허용). 숫자가 아니면 null.
  function parseNum(s){
    let t = String(s == null ? "" : s).trim();
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1).trim(); }
    t = t.replace(/[,\s₩$€£¥%]/g, "");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    const n = parseFloat(t);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }
  function colLetter(i){
    let s = ""; i = Number(i);
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
    return s;
  }
  const fmtNum = (n) => isFinite(n) ? (Math.round(n * 1e6) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "-";

  // ── 선택 표에서 라벨(카테고리)과 숫자 계열을 추정 ─────────────────────────
  function extract(matrix){
    let rows = (matrix || []).map(r => Array.isArray(r) ? r.slice() : []);
    // 완전히 빈 뒤쪽 행 제거
    while (rows.length && rows[rows.length - 1].every(v => String(v == null ? "" : v).trim() === "")) rows.pop();
    const R = rows.length;
    let C = 0; rows.forEach(r => { C = Math.max(C, r.length); });
    if (!R || !C) return { categories: [], series: [] };
    rows = rows.map(r => { const rr = r.slice(); while (rr.length < C) rr.push(""); return rr; });
    const numOf = rows.map(r => r.map(v => parseNum(v)));

    const rowMostlyText = (r) => {
      let txt = 0, num = 0;
      for (let c = 0; c < C; c++){ if (String(rows[r][c]).trim() === "") continue; if (numOf[r][c] != null) num++; else txt++; }
      return txt > num;
    };
    const colMostlyText = (c) => {
      let txt = 0, num = 0;
      for (let r = 0; r < R; r++){ if (String(rows[r][c]).trim() === "") continue; if (numOf[r][c] != null) num++; else txt++; }
      return txt > num;
    };

    const headerRow = R > 1 && rowMostlyText(0);
    const labelCol  = C > 1 && colMostlyText(0);
    const dr0 = headerRow ? 1 : 0;
    const dc0 = labelCol ? 1 : 0;

    const dataRows = []; for (let r = dr0; r < R; r++) dataRows.push(r);
    const dataCols = []; for (let c = dc0; c < C; c++) dataCols.push(c);

    let categories = labelCol
      ? dataRows.map(r => String(rows[r][0]).trim() || ("행 " + (r + 1)))
      : dataRows.map((_, i) => String(i + 1));

    let series = dataCols.map(c => ({
      name: headerRow ? (String(rows[0][c]).trim() || colLetter(c)) : ("값 " + colLetter(c)),
      values: dataRows.map(r => numOf[r][c])
    })).filter(s => s.values.some(v => v != null));

    // 데이터 행이 하나뿐인데 숫자 열이 여럿이면 가로로 뒤집어 열 이름을 카테고리로 쓴다.
    if (dataRows.length === 1 && series.length > 1){
      const single = { name: labelCol ? (String(rows[dataRows[0]][0]).trim() || "값") : "값", values: series.map(s => s.values[0]) };
      categories = series.map(s => s.name);
      series = [single];
    }
    return { categories, series, headerRow, labelCol };
  }

  function applicable(data){
    const cats = data.categories.length, ser = data.series.length;
    const anyNum = data.series.some(s => s.values.some(v => v != null));
    const first = data.series[0];
    const pieVals = first ? first.values.filter(v => v != null) : [];
    const pieOk = ser >= 1 && cats >= 2 && pieVals.length >= 2 && pieVals.every(v => v >= 0) && pieVals.reduce((a, b) => a + b, 0) > 0;
    return {
      bar: anyNum && cats >= 1,
      line: anyNum && cats >= 2,
      pie: pieOk,
      scatter: ser >= 2 && data.series[0].values.some((v, i) => v != null && data.series[1].values[i] != null)
    };
  }
  // 카테고리가 연도·월·회차·분기처럼 순서형이면 꺾은선을 기본으로 추천.
  function looksTemporal(categories){
    if (categories.length < 3) return false;
    return categories.every(c => /^\s*(\d{4}|\d{1,2}\s*(월|일|주|회|차|분기)|q[1-4]|[1-4]\s*분기|\d{4}[-/.]\d{1,2})/i.test(String(c)));
  }

  // ── 좌표축 도우미 ─────────────────────────────────────────────
  function niceStep(raw){
    raw = Math.abs(raw) || 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * p;
  }
  function valueBounds(series, baselineZero){
    let min = Infinity, max = -Infinity;
    series.forEach(s => s.values.forEach(v => { if (v == null) return; if (v < min) min = v; if (v > max) max = v; }));
    if (!isFinite(min)){ min = 0; max = 1; }
    let lo = baselineZero ? Math.min(0, min) : min;
    let hi = baselineZero ? Math.max(0, max) : max;
    if (lo === hi){ hi = lo + 1; }
    const step = niceStep((hi - lo) / 5);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    return { lo, hi, step };
  }

  const AXIS = "#c9ced8", GRID = "#eef1f6", TXT = "#3a4252", TXT_DIM = "#6b7280";

  function baseSvg(){
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, xmlns: NS,
      "font-family": "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif" });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));
    return svg;
  }
  function titleText(svg, title){
    if (title) svg.appendChild(svgEl("text", { x: W / 2, y: 26, "text-anchor": "middle", "font-size": 17, "font-weight": 700, fill: TXT }, title));
  }
  function legend(svg, items, y){
    // 가운데 정렬 가로 범례
    const gap = 18, sw = 12;
    const widths = items.map(it => sw + 6 + Math.max(12, String(it.name).length * 7.4));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    let x = Math.max(12, (W - total) / 2);
    items.forEach((it, i) => {
      svg.appendChild(svgEl("rect", { x, y: y - sw + 2, width: sw, height: sw, rx: 2, fill: it.color }));
      svg.appendChild(svgEl("text", { x: x + sw + 5, y: y + 2, "font-size": 12.5, fill: TXT }, it.name));
      x += widths[i] + gap;
    });
  }
  function xCategoryLabels(svg, categories, px0, band, py1){
    const rotate = categories.length > 8 || categories.some(c => String(c).length > 6);
    categories.forEach((cat, i) => {
      const cx = px0 + band * (i + 0.5);
      let s = String(cat);
      if (!rotate && s.length > 10) s = s.slice(0, 9) + "…";
      const t = svgEl("text", { x: cx, y: py1 + (rotate ? 12 : 16), "font-size": 12, fill: TXT_DIM,
        "text-anchor": rotate ? "end" : "middle" }, rotate && s.length > 12 ? s.slice(0, 11) + "…" : s);
      if (rotate) t.setAttribute("transform", "rotate(-35 " + cx + " " + (py1 + 12) + ")");
      svg.appendChild(t);
    });
  }
  function yAxis(svg, lo, hi, step, px0, px1, py0, py1){
    for (let v = lo; v <= hi + step / 2; v += step){
      const y = py1 - (v - lo) / (hi - lo) * (py1 - py0);
      svg.appendChild(svgEl("line", { x1: px0, y1: y, x2: px1, y2: y, stroke: v === 0 ? AXIS : GRID, "stroke-width": v === 0 ? 1.4 : 1 }));
      svg.appendChild(svgEl("text", { x: px0 - 8, y: y + 4, "text-anchor": "end", "font-size": 11.5, fill: TXT_DIM }, fmtNum(v)));
    }
  }

  function renderBar(data, title){
    const svg = baseSvg(); titleText(svg, title);
    const multi = data.series.length > 1;
    const px0 = 66, px1 = W - 24, py0 = 44, py1 = H - (multi ? 78 : 58);
    const { lo, hi, step } = valueBounds(data.series, true);
    yAxis(svg, lo, hi, step, px0, px1, py0, py1);
    const n = data.categories.length, band = (px1 - px0) / n;
    const k = data.series.length, inner = band * 0.72, bw = inner / k;
    const y0 = py1 - (0 - lo) / (hi - lo) * (py1 - py0);
    const showVals = n * k <= 24;
    data.categories.forEach((_, i) => {
      data.series.forEach((s, j) => {
        const v = s.values[i]; if (v == null) return;
        const x = px0 + band * i + (band - inner) / 2 + bw * j;
        const y = py1 - (v - lo) / (hi - lo) * (py1 - py0);
        const top = Math.min(y, y0), hgt = Math.max(1, Math.abs(y - y0));
        svg.appendChild(svgEl("rect", { x: x + bw * 0.08, y: top, width: bw * 0.84, height: hgt, rx: 2, fill: PALETTE[j % PALETTE.length] }));
        if (showVals) svg.appendChild(svgEl("text", { x: x + bw / 2, y: (v >= 0 ? top - 4 : top + hgt + 12), "text-anchor": "middle", "font-size": 11, fill: TXT_DIM }, fmtNum(v)));
      });
    });
    svg.appendChild(svgEl("line", { x1: px0, y1: py0, x2: px0, y2: py1, stroke: AXIS, "stroke-width": 1.2 }));
    xCategoryLabels(svg, data.categories, px0, band, py1);
    if (multi) legend(svg, data.series.map((s, j) => ({ name: s.name, color: PALETTE[j % PALETTE.length] })), H - 20);
    return svg;
  }

  function renderLine(data, title){
    const svg = baseSvg(); titleText(svg, title);
    const multi = data.series.length > 1;
    const px0 = 66, px1 = W - 24, py0 = 44, py1 = H - (multi ? 78 : 58);
    const { lo, hi, step } = valueBounds(data.series, false);
    yAxis(svg, lo, hi, step, px0, px1, py0, py1);
    const n = data.categories.length, band = (px1 - px0) / n;
    const xc = (i) => px0 + band * (i + 0.5);
    const yc = (v) => py1 - (v - lo) / (hi - lo) * (py1 - py0);
    data.series.forEach((s, j) => {
      const color = PALETTE[j % PALETTE.length];
      let d = "", started = false;
      s.values.forEach((v, i) => { if (v == null){ started = false; return; } d += (started ? " L" : " M") + xc(i) + " " + yc(v); started = true; });
      if (d) svg.appendChild(svgEl("path", { d: d.trim(), fill: "none", stroke: color, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      s.values.forEach((v, i) => { if (v != null) svg.appendChild(svgEl("circle", { cx: xc(i), cy: yc(v), r: 3.2, fill: color })); });
    });
    svg.appendChild(svgEl("line", { x1: px0, y1: py0, x2: px0, y2: py1, stroke: AXIS, "stroke-width": 1.2 }));
    svg.appendChild(svgEl("line", { x1: px0, y1: py1, x2: px1, y2: py1, stroke: AXIS, "stroke-width": 1.2 }));
    xCategoryLabels(svg, data.categories, px0, band, py1);
    if (multi) legend(svg, data.series.map((s, j) => ({ name: s.name, color: PALETTE[j % PALETTE.length] })), H - 20);
    return svg;
  }

  function renderPie(data, title){
    const svg = baseSvg(); titleText(svg, title);
    const s = data.series[0];
    const items = data.categories.map((c, i) => ({ name: c, v: s.values[i] })).filter(it => it.v != null && it.v > 0);
    const total = items.reduce((a, it) => a + it.v, 0);
    const cx = W / 2 - 90, cy = H / 2 + 8, R = Math.min(150, (H - 130) / 2);
    let a0 = -Math.PI / 2;
    items.forEach((it, i) => {
      const frac = it.v / total, a1 = a0 + frac * Math.PI * 2;
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const color = PALETTE[i % PALETTE.length];
      if (frac >= 0.999){                                   // 항목이 하나면 원 전체
        svg.appendChild(svgEl("circle", { cx, cy, r: R, fill: color }));
      } else {
        svg.appendChild(svgEl("path", { d: "M" + cx + " " + cy + " L" + x0 + " " + y0 + " A" + R + " " + R + " 0 " + large + " 1 " + x1 + " " + y1 + " Z", fill: color }));
      }
      if (frac >= 0.05){
        const am = (a0 + a1) / 2, lr = R * 0.62;
        svg.appendChild(svgEl("text", { x: cx + lr * Math.cos(am), y: cy + lr * Math.sin(am) + 4, "text-anchor": "middle", "font-size": 12.5, "font-weight": 600, fill: "#fff" }, Math.round(frac * 100) + "%"));
      }
      a0 = a1;
    });
    // 오른쪽 세로 범례 (값·비율)
    let ly = cy - Math.min(items.length, 12) * 11;
    items.slice(0, 14).forEach((it, i) => {
      const color = PALETTE[i % PALETTE.length];
      svg.appendChild(svgEl("rect", { x: W - 210, y: ly - 10, width: 12, height: 12, rx: 2, fill: color }));
      const pct = Math.round(it.v / total * 100);
      let nm = String(it.name); if (nm.length > 12) nm = nm.slice(0, 11) + "…";
      svg.appendChild(svgEl("text", { x: W - 193, y: ly, "font-size": 12.5, fill: TXT }, nm + " · " + fmtNum(it.v) + " (" + pct + "%)"));
      ly += 22;
    });
    return svg;
  }

  function renderScatter(data, title){
    const svg = baseSvg(); titleText(svg, title);
    const sx = data.series[0], sy = data.series[1];
    const pts = [];
    for (let i = 0; i < sx.values.length; i++){ if (sx.values[i] != null && sy.values[i] != null) pts.push({ x: sx.values[i], y: sy.values[i] }); }
    const px0 = 66, px1 = W - 24, py0 = 44, py1 = H - 58;
    const xb = valueBounds([{ values: pts.map(p => p.x) }], false);
    const yb = valueBounds([{ values: pts.map(p => p.y) }], false);
    yAxis(svg, yb.lo, yb.hi, yb.step, px0, px1, py0, py1);
    // x축 눈금
    for (let v = xb.lo; v <= xb.hi + xb.step / 2; v += xb.step){
      const x = px0 + (v - xb.lo) / (xb.hi - xb.lo) * (px1 - px0);
      svg.appendChild(svgEl("line", { x1: x, y1: py0, x2: x, y2: py1, stroke: GRID, "stroke-width": 1 }));
      svg.appendChild(svgEl("text", { x, y: py1 + 16, "text-anchor": "middle", "font-size": 11.5, fill: TXT_DIM }, fmtNum(v)));
    }
    const xc = (v) => px0 + (v - xb.lo) / (xb.hi - xb.lo) * (px1 - px0);
    const yc = (v) => py1 - (v - yb.lo) / (yb.hi - yb.lo) * (py1 - py0);
    pts.forEach(p => svg.appendChild(svgEl("circle", { cx: xc(p.x), cy: yc(p.y), r: 4, fill: PALETTE[0], "fill-opacity": 0.72 })));
    svg.appendChild(svgEl("line", { x1: px0, y1: py0, x2: px0, y2: py1, stroke: AXIS, "stroke-width": 1.2 }));
    svg.appendChild(svgEl("line", { x1: px0, y1: py1, x2: px1, y2: py1, stroke: AXIS, "stroke-width": 1.2 }));
    // 축 이름 (계열명)
    svg.appendChild(svgEl("text", { x: (px0 + px1) / 2, y: H - 16, "text-anchor": "middle", "font-size": 12.5, fill: TXT_DIM }, "가로: " + sx.name + "  ·  세로: " + sy.name));
    return svg;
  }

  const RENDER = { bar: renderBar, line: renderLine, pie: renderPie, scatter: renderScatter };
  const TYPE_LABEL = { bar: "막대", line: "꺾은선", pie: "원", scatter: "산점도" };
  const TYPE_HINT = {
    bar: "항목별 값을 막대 길이로 비교",
    line: "순서·시간에 따른 값의 추이",
    pie: "전체 대비 각 항목의 비율(음수·합계 0 제외)",
    scatter: "두 숫자 열의 관계 (숫자 열 2개 필요)"
  };

  // SVG → PNG Blob (선명하게 2배). 배경은 항상 흰색이라 인쇄·붙여넣기에 안전.
  function svgToPngBlob(svg, scale){
    scale = scale || 2;
    return new Promise((resolve, reject) => {
      const xml = new XMLSerializer().serializeToString(svg);
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = W * scale; cv.height = H * scale;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(b => b ? resolve(b) : reject(new Error("no blob")), "image/png");
      };
      img.onerror = () => reject(new Error("svg load failed"));
      img.src = url;
    });
  }
  function sanitize(name){ return String(name || "차트").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40) || "차트"; }

  // ── 모달 (동적 생성 · 자체 ESC/백드롭 처리) ─────────────────────────
  let modal = null, els = null;
  function buildModal(){
    modal = document.createElement("div");
    modal.className = "modal chart-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="modal-card chart-card">' +
        '<div class="chart-head">' +
          '<h3 id="chartTitle">차트</h3>' +
          '<div class="chart-type-tabs" id="chartTypeTabs" role="tablist" aria-label="차트 종류"></div>' +
          '<button class="chart-x" id="chartClose" type="button" aria-label="닫기">×</button>' +
        '</div>' +
        '<div class="chart-stage" id="chartStage"></div>' +
        '<div class="chart-note" id="chartNote" aria-live="polite"></div>' +
        '<div class="modal-actions chart-actions">' +
          '<button class="btn" id="chartSavePng" type="button">PNG 저장</button>' +
          '<button class="btn" id="chartToMemo" type="button">메모로 보내기</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn primary" id="chartDone" type="button">닫기</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    els = {
      title: modal.querySelector("#chartTitle"),
      tabs: modal.querySelector("#chartTypeTabs"),
      stage: modal.querySelector("#chartStage"),
      note: modal.querySelector("#chartNote"),
      savePng: modal.querySelector("#chartSavePng"),
      toMemo: modal.querySelector("#chartToMemo"),
      close: modal.querySelector("#chartClose"),
      done: modal.querySelector("#chartDone")
    };
    els.close.addEventListener("click", closeModal);
    els.done.addEventListener("click", closeModal);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) closeModal(); });
  }
  function onKeydown(e){
    if (e.key === "Escape" && modal && !modal.hidden){ e.preventDefault(); e.stopImmediatePropagation(); closeModal(); }
  }
  function closeModal(){
    if (!modal) return;
    modal.hidden = true;
    window.removeEventListener("keydown", onKeydown, true);
  }

  let current = { data: null, type: "bar", label: "차트" };
  function drawType(type){
    current.type = type;
    [...els.tabs.children].forEach(b => {
      const on = b.dataset.type === type;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    els.stage.innerHTML = "";
    const svg = RENDER[type](current.data, current.label);
    svg.classList.add("chart-svg");
    els.stage.appendChild(svg);
    els.note.textContent = TYPE_HINT[type] || "";
  }
  async function exportBlob(){
    const svg = els.stage.querySelector("svg");
    if (!svg) return null;
    return svgToPngBlob(svg, 2);
  }

  function open(input){
    const matrix = input && input.matrix;
    const label = sanitize(input && input.label);
    const data = extract(matrix);
    if (!data.series.length || !data.series.some(s => s.values.some(v => v != null))){
      if (typeof toast === "function") toast("이 선택으로는 차트를 만들 수 없어요. 숫자가 있는 범위를 선택해 주세요.", 2800, { type: "error" });
      return;
    }
    if (!modal) buildModal();
    current = { data, type: "bar", label };
    els.title.textContent = (label || "차트");

    const avail = applicable(data);
    els.tabs.innerHTML = "";
    let firstEnabled = null;
    ["bar", "line", "pie", "scatter"].forEach(type => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chart-type-tab"; b.dataset.type = type;
      b.setAttribute("role", "tab");
      b.textContent = TYPE_LABEL[type];
      b.title = TYPE_HINT[type];
      if (!avail[type]){ b.disabled = true; b.title = TYPE_HINT[type] + " — 지금 선택엔 맞지 않아요"; }
      else if (!firstEnabled) firstEnabled = type;
      b.addEventListener("click", () => { if (!b.disabled) drawType(type); });
      els.tabs.appendChild(b);
    });
    // 기본 종류: 순서형 라벨이면 꺾은선, 아니면 막대 → 안 되면 사용 가능한 첫 종류
    let def = (looksTemporal(data.categories) && avail.line) ? "line" : "bar";
    if (!avail[def]) def = firstEnabled || "bar";

    modal.hidden = false;
    window.addEventListener("keydown", onKeydown, true);
    drawType(def);

    els.savePng.onclick = async () => {
      try {
        const blob = await exportBlob();
        if (!blob) return;
        const name = label + "_" + current.type + ".png";
        if (typeof saveImageBlobUnified === "function") await saveImageBlobUnified(blob, { name }, name);
        else downloadFallback(blob, name);
      } catch(e){ if (typeof toast === "function") toast("차트를 저장하지 못했어요.", 2400, { type: "error" }); }
    };
    els.toMemo.onclick = async () => {
      try {
        const blob = await exportBlob();
        if (!blob) return;
        const name = label + "_" + current.type + ".png";
        if (typeof window.addImagesToScratchpad === "function"){
          await window.addImagesToScratchpad([new File([blob], name, { type: "image/png" })], { name: label + " 차트" });
          if (typeof toast === "function") toast("차트를 메모에 넣었어요.", 1900, { type: "success" });
        } else if (typeof saveImageBlobUnified === "function"){
          await saveImageBlobUnified(blob, { name }, name);
        } else downloadFallback(blob, name);
      } catch(e){ if (typeof toast === "function") toast("메모로 보내지 못했어요.", 2400, { type: "error" }); }
    };
  }
  function downloadFallback(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.openSpreadsheetChart = open;
})();
