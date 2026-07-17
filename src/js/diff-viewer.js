"use strict";

/* ===== 파일 비교(diff) — 새 문서 종류 "diff" =====
   두 텍스트/코드 문서의 차이를 나란히(또는 한 줄로) 보여준다.
   외부 라이브러리 없이 patience diff 를 자체 구현하고, 텍스트 확보는
   파이썬 실행과 같은 경로(openDocRunText)를 재사용한다(편집 중 내용 우선).
   비교 결과 문서는 원본에서 언제든 다시 만들 수 있는 파생 화면이라
   저장·작업공간 자동복원 대상이 아니다. */

const DIFF_MAX_BYTES = 5 * 1024 * 1024;  // 파일 하나의 UTF-8 바이트 상한
const DIFF_MAX_LINES = 50000;            // 짧은 줄 수백만 개가 행 모델을 폭증시키지 않게 제한
const DIFF_RENDER_LIMIT = 10000;         // 한 번에 DOM 으로 만드는 최대 행 수
const DIFF_DP_LIMIT = 250000;            // 앵커 없는 구간의 O(n·m) LCS 허용 상한
const DIFF_FOLD_MIN = 25;                // 같은 줄이 이 개수 이상 이어지면 접는다
const DIFF_FOLD_CONTEXT = 3;             // 접을 때 위아래로 남기는 문맥 줄 수

/* ---------- diff 코어 ---------- */

// 양쪽 범위에서 유일한 줄끼리 짝을 만들고, b 인덱스의 최장 증가 부분열(LIS)만 남긴다.
// 순서가 유지되는 "확실한 같은 줄"만 앵커로 쓰는 patience diff 의 핵심.
function diffPatienceAnchors(aKey, bKey, aLo, aHi, bLo, bHi){
  const seenA = new Map(), seenB = new Map();          // key -> index(유일) 또는 -2(중복)
  for (let i = aLo; i < aHi; i++){ const k = aKey[i]; seenA.set(k, seenA.has(k) ? -2 : i); }
  for (let j = bLo; j < bHi; j++){ const k = bKey[j]; seenB.set(k, seenB.has(k) ? -2 : j); }
  const pairs = [];
  for (let i = aLo; i < aHi; i++){
    const k = aKey[i];
    if (seenA.get(k) !== i) continue;
    const j = seenB.get(k);
    if (j != null && j >= 0) pairs.push([i, j]);
  }
  if (!pairs.length) return pairs;
  const tails = [];                                    // tails[len] = pairs 인덱스
  const prev = new Array(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++){
    const v = pairs[p][1];
    let lo = 0, hi = tails.length;
    while (lo < hi){ const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < v) lo = mid + 1; else hi = mid; }
    prev[p] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = p;
  }
  const lis = [];
  for (let p = tails.length ? tails[tails.length - 1] : -1; p >= 0; p = prev[p]) lis.push(pairs[p]);
  return lis.reverse();
}

// 앵커가 없는 작은 구간은 고전 LCS(DP)로 정확히 푼다. 역추적 결과를 앞 순서로 push.
function diffLcsRecords(aKey, bKey, aLo, aHi, bLo, bHi, push){
  const n = aHi - aLo, m = bHi - bLo, w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = 1; i <= n; i++){
    for (let j = 1; j <= m; j++){
      dp[i * w + j] = aKey[aLo + i - 1] === bKey[bLo + j - 1]
        ? dp[(i - 1) * w + j - 1] + 1
        : Math.max(dp[(i - 1) * w + j], dp[i * w + j - 1]);
    }
  }
  const recs = [];
  let i = n, j = m;
  while (i > 0 && j > 0){
    if (aKey[aLo + i - 1] === bKey[bLo + j - 1]){ recs.push(["eq", aLo + i - 1, bLo + j - 1]); i--; j--; }
    else if (dp[(i - 1) * w + j] >= dp[i * w + j - 1]){ recs.push(["del", aLo + i - 1, -1]); i--; }
    else { recs.push(["ins", -1, bLo + j - 1]); j--; }
  }
  while (i > 0){ recs.push(["del", aLo + i - 1, -1]); i--; }
  while (j > 0){ recs.push(["ins", -1, bLo + j - 1]); j--; }
  for (let k = recs.length - 1; k >= 0; k--) push(recs[k][0], recs[k][1], recs[k][2]);
}

// 두 줄 배열의 차이 → [{t:"eq"|"del"|"ins", ai, bi}] (원문 줄 인덱스, 없는 쪽 -1)
function diffLineRecords(aLines, bLines, keyOf){
  const out = [];
  const push = (t, ai, bi) => out.push({ t, ai, bi });
  const aKey = keyOf ? aLines.map(keyOf) : aLines;
  const bKey = keyOf ? bLines.map(keyOf) : bLines;
  (function chunk(aLo, aHi, bLo, bHi){
    while (aLo < aHi && bLo < bHi && aKey[aLo] === bKey[bLo]) push("eq", aLo++, bLo++);
    const tail = [];
    while (aHi > aLo && bHi > bLo && aKey[aHi - 1] === bKey[bHi - 1]){ aHi--; bHi--; tail.push([aHi, bHi]); }
    if (aLo >= aHi){ for (let j = bLo; j < bHi; j++) push("ins", -1, j); }
    else if (bLo >= bHi){ for (let i = aLo; i < aHi; i++) push("del", i, -1); }
    else {
      const anchors = diffPatienceAnchors(aKey, bKey, aLo, aHi, bLo, bHi);
      if (anchors.length){
        let pa = aLo, pb = bLo;
        for (const [ai, bi] of anchors){ chunk(pa, ai, pb, bi); push("eq", ai, bi); pa = ai + 1; pb = bi + 1; }
        chunk(pa, aHi, pb, bHi);
      } else if ((aHi - aLo) * (bHi - bLo) <= DIFF_DP_LIMIT){
        diffLcsRecords(aKey, bKey, aLo, aHi, bLo, bHi, push);
      } else {
        // 유일 줄 앵커도 없는 초대형 구간 — 통째 교체로 처리(품질보다 안전 우선)
        for (let i = aLo; i < aHi; i++) push("del", i, -1);
        for (let j = bLo; j < bHi; j++) push("ins", -1, j);
      }
    }
    for (let k = tail.length - 1; k >= 0; k--) push("eq", tail[k][0], tail[k][1]);
  })(0, aLines.length, 0, bLines.length);
  return out;
}

// 삭제/추가가 이웃한 구간을 짝지어 "바뀐 줄(chg)"로 묶는다 → 화면 행 모델.
function diffRowsFromRecords(recs){
  const rows = [];
  let i = 0;
  while (i < recs.length){
    if (recs[i].t === "eq"){ rows.push({ t:"eq", ai:recs[i].ai, bi:recs[i].bi }); i++; continue; }
    const dels = [], inss = [];
    while (i < recs.length && recs[i].t !== "eq"){ (recs[i].t === "del" ? dels : inss).push(recs[i]); i++; }
    const paired = Math.min(dels.length, inss.length);
    for (let p = 0; p < paired; p++) rows.push({ t:"chg", ai:dels[p].ai, bi:inss[p].bi });
    for (let p = paired; p < dels.length; p++) rows.push({ t:"del", ai:dels[p].ai, bi:-1 });
    for (let p = paired; p < inss.length; p++) rows.push({ t:"ins", ai:-1, bi:inss[p].bi });
  }
  return rows;
}

// 브라우저 API에 기대지 않고 UTF-8 바이트 수를 센다. 5MB 제한이 한글·이모지에서도 실제 바이트 기준이 되게 한다.
function diffUtf8Bytes(text){
  const value = String(text || "");
  let bytes = 0;
  for (let i = 0; i < value.length; i++){
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length){
      const low = value.charCodeAt(i + 1);
      if (low >= 0xDC00 && low <= 0xDFFF){ bytes += 4; i++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

// 빈 파일은 0줄, 마지막 개행은 별도 상태로 센다. "\n"은 빈 줄 하나가 끝 개행으로 닫힌 파일이다.
function diffTextParts(text){
  const value = String(text || "");
  const finalNewline = value.endsWith("\n");
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return { lines, finalNewline };
}

function diffTextLineCount(text){
  const value = String(text || "");
  if (!value) return 0;
  let count = 1;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) count++;
  return value.endsWith("\n") ? count - 1 : count;
}

function diffNormalizeText(text){
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
}

function diffLimitMessage(aText, bText){
  if (diffUtf8Bytes(aText) > DIFF_MAX_BYTES || diffUtf8Bytes(bText) > DIFF_MAX_BYTES){
    return "파일이 너무 커서 비교할 수 없어요 (5MB 초과).";
  }
  if (diffTextLineCount(aText) > DIFF_MAX_LINES || diffTextLineCount(bText) > DIFF_MAX_LINES){
    return "줄이 너무 많아 비교할 수 없어요 (파일당 50,000줄 초과).";
  }
  return "";
}

// 바뀐 줄 짝: 공통 앞·뒤를 제외한 가운데만 강조한 HTML 쌍을 돌려준다.
function diffInlineHtml(aStr, bStr){
  const aChars = Array.from(aStr), bChars = Array.from(bStr);
  const max = Math.min(aChars.length, bChars.length);
  let p = 0;
  while (p < max && aChars[p] === bChars[p]) p++;
  let s = 0;
  while (s < max - p && aChars[aChars.length - 1 - s] === bChars[bChars.length - 1 - s]) s++;
  if (p === 0 && s === 0) return [escapeHtml(aStr), escapeHtml(bStr)];   // 전부 다르면 줄 배경색만으로 충분
  const mark = (chars) => escapeHtml(chars.slice(0, p).join("")) +
    '<span class="diff-mark">' + escapeHtml(chars.slice(p, chars.length - s).join("")) + "</span>" +
    escapeHtml(chars.slice(chars.length - s).join(""));
  return [mark(aChars), mark(bChars)];
}

/* ---------- 화면 렌더 ---------- */

// 같은 줄이 길게 이어지는 구간을 접는다. folds 배열에 접힌 행을 보관하고 자리에 fold 행을 남긴다.
function diffFoldRows(rows, folds){
  const out = [];
  let i = 0;
  while (i < rows.length){
    if (rows[i].t !== "eq"){ out.push(rows[i]); i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].t === "eq") j++;
    const run = j - i;
    if (run >= DIFF_FOLD_MIN){
      for (let k = 0; k < DIFF_FOLD_CONTEXT; k++) out.push(rows[i + k]);
      const hidden = rows.slice(i + DIFF_FOLD_CONTEXT, j - DIFF_FOLD_CONTEXT);
      out.push({ t:"fold", id: folds.push(hidden) - 1, count: hidden.length });
      for (let k = j - DIFF_FOLD_CONTEXT; k < j; k++) out.push(rows[k]);
    } else {
      for (let k = i; k < j; k++) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}

// 변경 행이 지나치게 많으면 앞뒤 문맥만 남긴다. 통계는 전체 rows 에서 먼저 계산하므로 정확하게 유지된다.
function diffLimitRows(rows, limit = DIFF_RENDER_LIMIT){
  if (rows.length <= limit) return rows;
  const keep = Math.max(2, limit - 1);
  const head = Math.ceil(keep / 2), tail = Math.floor(keep / 2);
  return [
    ...rows.slice(0, head),
    { t:"limit", count: rows.length - keep },
    ...rows.slice(rows.length - tail)
  ];
}

function diffRowHtml(row, view, aLines, bLines){
  const ln = (no) => '<div class="diff-ln">' + (no >= 0 ? no + 1 : "") + "</div>";
  const cell = (cls, inner) => '<div class="diff-cell' + (cls ? " " + cls : "") + '">' + inner + "</div>";
  if (row.t === "fold"){
    const label = "⋯ " + window.tf("같은 {n}줄 펼치기", { n: row.count });
    return '<button type="button" class="diff-fold" data-fold="' + row.id + '">' + escapeHtml(label) + "</button>";
  }
  if (row.t === "limit"){
    const label = "⋯ " + window.tf("성능 보호를 위해 가운데 {n}개 행을 생략했어요", { n: row.count });
    return '<div class="diff-limit">' + escapeHtml(label) + "</div>";
  }
  if (row.t === "eof"){
    const aLabel = window.t(row.aFinalNewline ? "파일 끝 개행 있음" : "파일 끝 개행 없음");
    const bLabel = window.t(row.bFinalNewline ? "파일 끝 개행 있음" : "파일 끝 개행 없음");
    if (view === "split"){
      return ln(-1) + cell("is-del is-left diff-eof", escapeHtml(aLabel)) +
        ln(-1) + cell("is-ins diff-eof", escapeHtml(bLabel));
    }
    return ln(-1) + ln(-1) + cell("is-del diff-eof", escapeHtml("− " + aLabel)) +
      ln(-1) + ln(-1) + cell("is-ins diff-eof", escapeHtml("+ " + bLabel));
  }
  const aText = row.ai >= 0 ? aLines[row.ai] : "";
  const bText = row.bi >= 0 ? bLines[row.bi] : "";
  if (view === "split"){
    if (row.t === "eq")  return ln(row.ai) + cell("is-left", escapeHtml(aText)) + ln(row.bi) + cell("", escapeHtml(bText));
    if (row.t === "del") return ln(row.ai) + cell("is-del is-left", escapeHtml(aText)) + ln(-1) + cell("is-none", "");
    if (row.t === "ins") return ln(-1) + cell("is-none is-left", "") + ln(row.bi) + cell("is-ins", escapeHtml(bText));
    const [aHtml, bHtml] = diffInlineHtml(aText, bText);
    return ln(row.ai) + cell("is-del is-left", aHtml) + ln(row.bi) + cell("is-ins", bHtml);
  }
  // 한 줄(unified) 보기: [A줄번호 | B줄번호 | 내용], 바뀐 줄은 삭제→추가 두 행으로
  if (row.t === "eq")  return ln(row.ai) + ln(row.bi) + cell("", escapeHtml(aText));
  if (row.t === "del") return ln(row.ai) + ln(-1) + cell("is-del", escapeHtml(aText));
  if (row.t === "ins") return ln(-1) + ln(row.bi) + cell("is-ins", escapeHtml(bText));
  const [aHtml, bHtml] = diffInlineHtml(aText, bText);
  return ln(row.ai) + ln(-1) + cell("is-del", aHtml) + ln(-1) + ln(row.bi) + cell("is-ins", bHtml);
}

function renderDiffView(doc, host){
  host.classList.add("diff-doc");
  const st = doc.diffState;
  const wrap = document.createElement("div"); wrap.className = "diff-wrap";
  const bar = document.createElement("div"); bar.className = "diff-bar";
  const nameA = document.createElement("span"); nameA.className = "diff-name is-a";
  const arrow = document.createElement("span"); arrow.className = "diff-arrow"; arrow.textContent = "↔";
  const nameB = document.createElement("span"); nameB.className = "diff-name is-b";
  const statsEl = document.createElement("span"); statsEl.className = "diff-stats";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const mkBtn = (label, title) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn";
    b.textContent = label; if (title) b.title = title;
    return b;
  };
  const viewBtn = mkBtn("", "");
  viewBtn.classList.add("diff-view-toggle");   // 언어와 무관한 선택자(E2E·스타일 공용)
  const wsBtn = mkBtn("공백 무시", "들여쓰기·공백만 다른 줄을 같은 줄로 취급해요");
  const swapBtn = mkBtn("⇄ 순서 바꾸기", "왼쪽(기준)과 오른쪽(비교)을 서로 바꿔요");
  const reloadBtn = st.reload ? mkBtn("↻ 다시 비교", "문서의 지금 내용(편집 중 포함)으로 다시 비교해요") : null;
  bar.append(nameA, arrow, nameB, statsEl, spacer, viewBtn, wsBtn, swapBtn);
  if (reloadBtn) bar.appendChild(reloadBtn);
  const body = document.createElement("div"); body.className = "diff-body";
  wrap.append(bar, body); host.appendChild(wrap);

  let folds = [];
  const syncBar = () => {
    nameA.textContent = st.a.name; nameA.title = st.a.name;
    nameB.textContent = st.b.name; nameB.title = st.b.name;
    viewBtn.textContent = window.t(st.view === "split" ? "한 줄로 보기" : "나란히 보기");
    viewBtn.title = window.t(st.view === "split" ? "삭제·추가를 위아래로 이어 한 줄 흐름으로 보기" : "왼쪽·오른쪽 두 칸으로 나란히 비교하기");
    wsBtn.setAttribute("aria-pressed", st.ignoreWs ? "true" : "false");
  };
  const rebuild = () => {
    syncBar();
    const aPart = diffTextParts(st.a.text), bPart = diffTextParts(st.b.text);
    const aLines = aPart.lines, bLines = bPart.lines;
    const keyOf = st.ignoreWs ? (s) => s.replace(/\s+/g, " ").trim() : null;
    const recs = diffLineRecords(aLines, bLines, keyOf);
    let rows = diffRowsFromRecords(recs);
    if (aPart.finalNewline !== bPart.finalNewline){
      rows.push({ t:"eof", aFinalNewline:aPart.finalNewline, bFinalNewline:bPart.finalNewline });
    }
    const added = rows.reduce((n, r) => n + (r.t === "ins" || r.t === "chg" ? 1 : 0), 0);
    const removed = rows.reduce((n, r) => n + (r.t === "del" || r.t === "chg" ? 1 : 0), 0);
    const eofChanged = rows.some(r => r.t === "eof");
    const shownAdded = added + (eofChanged ? 1 : 0);
    const shownRemoved = removed + (eofChanged ? 1 : 0);
    body.className = "diff-body " + (st.view === "split" ? "diff-view-split" : "diff-view-unified");
    if (!shownAdded && !shownRemoved){
      statsEl.textContent = window.t("차이 없음");
      statsEl.title = "";
      body.innerHTML = '<div class="diff-same">✓ ' + escapeHtml(window.t(
        st.ignoreWs && st.a.text !== st.b.text ? "공백·들여쓰기 차이만 있어요" : "두 파일의 내용이 같아요")) + "</div>";
      return;
    }
    statsEl.innerHTML = '<b class="diff-plus">+' + shownAdded + '</b> <b class="diff-minus">−' + shownRemoved + "</b>";
    statsEl.title = window.tf("추가·수정 {a}줄 · 삭제·수정 {d}줄", { a: shownAdded, d: shownRemoved });
    folds = [];
    rows = diffFoldRows(rows, folds);
    rows = diffLimitRows(rows);
    const html = [];
    for (const row of rows) html.push(diffRowHtml(row, st.view, aLines, bLines));
    body.innerHTML = html.join("");
    body._diffLines = { aLines, bLines };               // fold 펼침이 같은 원문을 쓰도록 보관
  };

  body.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("button.diff-fold");
    if (!btn || !body._diffLines) return;
    const hidden = folds[Number(btn.dataset.fold)];
    if (!hidden) return;
    const { aLines, bLines } = body._diffLines;
    const visible = diffLimitRows(hidden);
    btn.insertAdjacentHTML("beforebegin", visible.map(row => diffRowHtml(row, st.view, aLines, bLines)).join(""));
    btn.remove();
  });

  viewBtn.addEventListener("click", () => { st.view = st.view === "split" ? "unified" : "split"; rebuild(); });
  wsBtn.addEventListener("click", () => { st.ignoreWs = !st.ignoreWs; rebuild(); });
  swapBtn.addEventListener("click", () => { const t = st.a; st.a = st.b; st.b = t; st.swapped = !st.swapped; rebuild(); });
  if (reloadBtn) reloadBtn.addEventListener("click", async () => {
    if (reloadBtn.disabled) return;
    reloadBtn.disabled = true;
    try {
      const fresh = await st.reload();
      if (!fresh){ toast("비교하던 문서가 이미 닫혀 다시 읽지 못했어요.", 2600, { type:"error" }); return; }
      const freshA = { name:String(fresh.a.name || "A"), text:diffNormalizeText(fresh.a.text) };
      const freshB = { name:String(fresh.b.name || "B"), text:diffNormalizeText(fresh.b.text) };
      const limitMessage = diffLimitMessage(freshA.text, freshB.text);
      if (limitMessage){ toast(limitMessage, 3000, { type:"error" }); return; }
      st.a = st.swapped ? freshB : freshA;
      st.b = st.swapped ? freshA : freshB;
      rebuild();
      toast("지금 내용으로 다시 비교했어요.", 1800, { type:"success" });
    } finally { reloadBtn.disabled = false; }
  });

  rebuild();
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);
}

/* ---------- 문서 생성 · 텍스트 확보 ---------- */

function diffShortName(name){
  return String(name || "").replace(/\\/g, "/").split("/").pop() || "?";
}

// 비교 결과를 새 문서 탭으로 연다. a/b = { name, text }, opts.reload = 원본을 다시 읽는 함수(선택).
function openCompareResult(a, b, opts = {}){
  const aText = diffNormalizeText(a.text);
  const bText = diffNormalizeText(b.text);
  const limitMessage = diffLimitMessage(aText, bText);
  if (limitMessage){
    toast(limitMessage, 3000, { type:"error" });
    return null;
  }
  // 이름 구분자는 ⇄ — ↔ 는 icons.js 가 UI 텍스트에서 SVG 아이콘으로 치환해 textContent·툴팁에서 사라진다.
  const doc = makeDoc("diff", "비교: " + diffShortName(a.name) + " ⇄ " + diffShortName(b.name), {});
  doc.diffState = {
    a: { name: String(a.name || "A"), text: aText },
    b: { name: String(b.name || "B"), text: bText },
    view: "split", ignoreWs: false, swapped: false, reload: opts.reload || null
  };
  doc.render = async () => { const host = doc.el; host.innerHTML = ""; host.scrollTop = 0; renderDiffView(doc, host); };
  if (typeof refreshChrome === "function") refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

// 문서의 "지금 텍스트"(편집 중이면 편집 내용) — 노트북(.ipynb)은 파이썬 소스로 변환해 비교한다.
async function diffDocText(doc){
  if (!doc) return null;
  let text = null;
  if (doc.notebookModel && typeof modelToIpynb === "function"){
    try {
      if (typeof nbSyncFindModel === "function") nbSyncFindModel(doc);
      text = modelToIpynb(doc.notebookModel);
    } catch(_){ text = null; }
  }
  if (text == null){
    try { text = await openDocRunText(doc); } catch(_){ text = null; }
  }
  if (text == null) return null;
  text = String(text);
  if (/\.ipynb$/i.test(doc.name || "") && typeof ipynbToPython === "function"){
    try { text = ipynbToPython(text, doc.name); } catch(_){ /* 노트북 JSON 이 아니면 원문 그대로 비교 */ }
  }
  return text.replace(/\r\n?/g, "\n");
}

// 텍스트를 얻을 수 있는(=비교 가능한) 열린 문서 목록
function diffComparableDocs(){
  return docs.filter(d => {
    if (!d || d.kind !== "office") return false;
    if (d.codeEditor || typeof d.savedText === "string") return true;
    if (!d.sourceFile) return false;
    const ext = fileExtOf(d.name);
    return ext === "ipynb" || TEXT_ENCODING_EXTS.has(ext);
  });
}

/* ---------- 진입점: 두 파일 고르기 · 저장본과 비교 ---------- */

function openFileComparePicker(){
  const list = diffComparableDocs();
  if (list.length < 2){
    toast("비교할 텍스트·코드 문서가 2개 이상 열려 있어야 해요.", 2800);
    return;
  }
  // 기본값: 오른쪽(비교)=지금 보는 문서, 왼쪽(기준)=직전에 보던 비교 가능한 문서
  const mruRank = new Map(activeMru.map((id, i) => [id, i]));
  const byRecent = [...list].sort((x, y) => (mruRank.has(x.id) ? mruRank.get(x.id) : 1e9) - (mruRank.has(y.id) ? mruRank.get(y.id) : 1e9));
  const defB = byRecent.find(d => d.id === activeId) || byRecent[0];
  const defA = byRecent.find(d => d !== defB) || list.find(d => d !== defB);

  const modal = document.createElement("div"); modal.className = "modal diff-pick-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const title = document.createElement("h3"); title.textContent = "두 파일 비교";
  const sub = document.createElement("p"); sub.className = "diff-pick-sub";
  sub.textContent = "열린 문서 중 두 개를 골라 차이를 확인해요. 편집 중인 내용은 지금 상태 그대로 비교돼요.";
  const body = document.createElement("div"); body.className = "diff-pick-body";
  const mkRow = (labelText, def) => {
    const row = document.createElement("label"); row.className = "diff-pick-row";
    const cap = document.createElement("b"); cap.textContent = labelText;
    const sel = document.createElement("select");
    for (const d of list){
      const opt = document.createElement("option");
      opt.value = String(d.id);
      opt.textContent = d.workspacePath || d.relPath || d.name;
      if (def && d.id === def.id) opt.selected = true;
      sel.appendChild(opt);
    }
    row.append(cap, sel); body.appendChild(row);
    return sel;
  };
  const selA = mkRow("기준 (왼쪽)", defA);
  const selB = mkRow("비교 (오른쪽)", defB);
  const actions = document.createElement("div"); actions.className = "modal-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "취소";
  const go = document.createElement("button"); go.type = "button"; go.className = "btn primary"; go.textContent = "비교";
  actions.append(cancel, go);
  card.append(title, sub, body, actions); modal.appendChild(card);
  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => { if (e.key === "Escape"){ e.stopPropagation(); close(); } };
  window.addEventListener("keydown", onKey, true);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  cancel.addEventListener("click", close);
  go.addEventListener("click", async () => {
    const idA = Number(selA.value), idB = Number(selB.value);
    if (idA === idB){ toast("서로 다른 두 문서를 골라 주세요.", 2400); return; }
    const docA = docs.find(d => d.id === idA), docB = docs.find(d => d.id === idB);
    if (!docA || !docB){ toast("문서를 찾지 못했어요. 다시 열어 주세요.", 2400, { type:"error" }); return; }
    go.disabled = true;
    try {
      const [textA, textB] = await Promise.all([diffDocText(docA), diffDocText(docB)]);
      if (textA == null || textB == null){ toast("문서 내용을 읽지 못했어요.", 2600, { type:"error" }); return; }
      close();
      openCompareResult(
        { name: docA.name, text: textA },
        { name: docB.name, text: textB },
        { reload: async () => {
            const ra = docs.find(d => d.id === idA), rb = docs.find(d => d.id === idB);
            if (!ra || !rb) return null;
            const [ta, tb] = await Promise.all([diffDocText(ra), diffDocText(rb)]);
            if (ta == null || tb == null) return null;
            return { a: { name: ra.name, text: ta }, b: { name: rb.name, text: tb } };
          } }
      );
    } finally { go.disabled = false; }
  });
  document.body.appendChild(modal);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);
  requestAnimationFrame(() => { try { selA.focus(); } catch(_){} });
}

// 지금 편집 중인 문서를 마지막 저장본(또는 불러온 원본)과 비교한다.
async function compareActiveDocWithSaved(){
  const doc = docs.find(d => d.id === activeId);
  if (!doc || !doc.codeEditor || typeof doc.codeEditor.getValue !== "function"){
    toast("편집 중인 텍스트·코드 문서에서만 사용할 수 있어요.", 2600);
    return;
  }
  const readSaved = async (d) => {
    if (typeof d.savedText === "string") return d.savedText;
    if (d.sourceFile){
      try { return smartDecodeText(await readDocSourceBytes(d)); } catch(_){}
    }
    return null;
  };
  const saved = await readSaved(doc);
  if (saved == null){ toast("아직 저장된 적이 없는 새 문서라 비교할 저장본이 없어요.", 2800); return; }
  const docId = doc.id;
  openCompareResult(
    { name: doc.name + " (저장본)", text: saved },
    { name: doc.name + " (편집 중)", text: String(doc.codeEditor.getValue()) },
    { reload: async () => {
        const d = docs.find(x => x.id === docId);
        if (!d || !d.codeEditor || typeof d.codeEditor.getValue !== "function") return null;
        const s = await readSaved(d);
        if (s == null) return null;
        return {
          a: { name: d.name + " (저장본)", text: s },
          b: { name: d.name + " (편집 중)", text: String(d.codeEditor.getValue()) }
        };
      } }
  );
}
