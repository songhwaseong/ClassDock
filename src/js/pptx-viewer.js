"use strict";

async function renderPptx(file, host, options={}){
  // PPT 미리보기 묶음(jQuery·JSZip·PPTXjs)은 .pptx 를 실제로 열 때 처음 로드한다.
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("pptx");
  if (typeof window.jQuery === "undefined" || !window.jQuery.fn || !window.jQuery.fn.pptxToHtml){
    toast("PowerPoint 뷰어 로드 실패"); return;
  }
  if (options.pptxConvertError) {
    const note = document.createElement("div");
    note.className = "code-note";
    note.textContent = "간이 PPTX 미리보기입니다. 도형/그룹이 원본과 다르면 manneung-classroom.exe로 열고 PowerPoint 변환 상태를 확인하세요. 사유: " + options.pptxConvertError;
    host.appendChild(note);
  }
  let pptxBytes = options.pptxBytes || await readPptxBytes(file);
  pptxBytes = repairPptxPackageForViewer(pptxBytes);
  loadPptxEmbeddedFonts(pptxBytes, host).catch(()=>{});   // 내장 글꼴 등록(비동기·실패해도 미리보기는 진행)
  await new Promise((resolve, reject) => {
    const div = document.createElement("div");
    div.id = "pptxHost_" + Date.now();
    div.className = "pptx-host";
    host.appendChild(div);
    const url = "memory-pptx-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".pptx";
    const pptxData = normalizeArrayBuffer(pptxBytes);
    const originalGetBinaryContent = window.JSZipUtils && window.JSZipUtils.getBinaryContent;
    if (!originalGetBinaryContent) throw new Error("pptx-loader-missing");
    window.JSZipUtils.getBinaryContent = function(requestUrl, options){
      if (requestUrl === url){
        const callback = (typeof options === "function") ? options : options && options.callback;
        if (callback) setTimeout(() => callback(null, pptxData), 0);
        return Promise.resolve(pptxData);
      }
      return originalGetBinaryContent.apply(this, arguments);
    };
    let settled = false;
    const restore = () => {
      if (window.JSZipUtils.getBinaryContent !== originalGetBinaryContent){
        window.JSZipUtils.getBinaryContent = originalGetBinaryContent;
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      restore();
      window.removeEventListener("error", onError);
      resolve();
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      restore();
      window.removeEventListener("error", onError);
      reject(err);
    };
    const onError = (event) => fail(event.error || new Error(event.message || "pptx-render-error"));
    window.addEventListener("error", onError);
    try {
      window.jQuery("#" + div.id).pptxToHtml({
        pptxFileUrl: url, slidesScale: "", slideMode: false, keyBoardShortCut: false,
      });
    } catch (e){ fail(e); return; }
    waitForPptxRender(div).then(() => { try { fitPptxSlides(div); } catch(e){} finish(); }, fail).finally(() => {
      window.removeEventListener("error", onError);
    });
  });
}

// pptxjs 는 슬라이드를 원본 픽셀 크기(예: 1920×1080)로 그린다. 큰 덱은 뷰어보다 넓어 가운데정렬이
// 깨지고(=오른쪽으로 넘침) 가로 스크롤이 생긴다. 뷰어 폭에 맞춰 zoom 으로 축소한다(원본보다 키우진 않음).
//  - zoom 은 레이아웃까지 축소돼 .slide 의 margin:auto 가운데정렬과 세로 높이가 정확히 유지된다.
//  - --pptx-zoom 은 모든 .slide 가 상속하므로, 늦게 추가되는 슬라이드도 자동으로 같은 배율이 적용된다.
//  - 창·사이드바 크기 변화는 ResizeObserver 로 다시 맞춘다.
function fitPptxSlides(host){
  if (!host || !host.isConnected) return;
  const slide = host.querySelector(".slide");
  if (!slide) return;
  const natW = parseFloat(slide.style.width) || slide.getBoundingClientRect().width || 960;
  const avail = host.clientWidth - 6;            // 슬라이드 테두리/여백 여유
  if (avail <= 1) return;                          // 숨김 상태 등 → 마지막 배율 유지
  const s = Math.max(0.1, Math.min(1, avail / natW));   // 1 초과 금지(원본보다 키워 흐려지지 않게)
  if (host.__z === s) return;                      // 변화 없으면 스킵(재계산 루프 방지)
  host.__z = s;
  host.style.setProperty("--pptx-zoom", s);
  if (!host.__ro && typeof ResizeObserver !== "undefined"){
    const ro = new ResizeObserver(() => {
      if (!host.isConnected){ ro.disconnect(); host.__ro = null; return; }
      fitPptxSlides(host);
    });
    ro.observe(host);
    host.__ro = ro;
  }
}

/* ===== PPTX 내장 글꼴(EOT) 적용 =====
   pptxjs 는 내장 글꼴을 무시하고 시스템 폰트로 대체해 원본과 글자 모양이 달라진다.
   PPTX 의 ppt/fonts/*.fntdata 는 EOT(Embedded OpenType) 래퍼이고, 실제 TTF/OTF 가 "맨 뒤
   FontDataSize 바이트"에 그대로 들어 있다. 이를 꺼내 FontFace 로 등록하면 pptxjs 가 출력한
   font-family(=원본 typeface 이름)와 매칭돼 원본 글꼴로 표시된다. (Chromium/WebView2 런타임) */
function eotToSfnt(eot){
  if (!eot || eot.length < 16) return null;
  const dv = new DataView(eot.buffer, eot.byteOffset, eot.byteLength);
  const fontDataSize = dv.getUint32(4, true);          // EOT: 실제 폰트 데이터 크기
  const flags = dv.getUint32(12, true);
  if (flags & 0x00000004) return null;                 // TTEMBED_TTCOMPRESSED(MTX 압축) → 미지원
  if (fontDataSize <= 0 || fontDataSize > eot.length) return null;
  const ttf = eot.subarray(eot.length - fontDataSize); // FontData 는 EOT 의 마지막 블록
  const v = (ttf[0] << 24 | ttf[1] << 16 | ttf[2] << 8 | ttf[3]) >>> 0;
  const ok = (v === 0x00010000 || v === 0x4F54544F || v === 0x74727565 || v === 0x74746366); // ttf/OTTO/true/ttcf
  return ok ? ttf.slice() : null;                      // EOT 버퍼와 분리된 복사본
}
function resolvePptPath(base, target){
  if (!target) return "";
  if (target.charAt(0) === "/") return target.slice(1);      // 절대경로(/ppt/..)
  const stack = base.split("/").filter(Boolean);
  for (const seg of target.split("/")){
    if (seg === "..") stack.pop();
    else if (seg && seg !== ".") stack.push(seg);
  }
  return stack.join("/");
}
async function loadPptxEmbeddedFonts(bytes, host){
  if (typeof JSZip === "undefined" || typeof FontFace === "undefined" || !document.fonts) return;
  let zip;
  try { zip = new JSZip(bytes); } catch(e){ return; }
  const presFile = zip.file("ppt/presentation.xml");
  const relFile  = zip.file("ppt/_rels/presentation.xml.rels");
  if (!presFile || !relFile) return;
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const parse = (txt) => new DOMParser().parseFromString(String(txt || "").replace(/^\uFEFF/, ""), "application/xml");
  const relDoc = parse(relFile.asText()), presDoc = parse(presFile.asText());
  if (relDoc.querySelector("parsererror") || presDoc.querySelector("parsererror")) return;
  const relMap = {};
  relDoc.querySelectorAll("Relationship").forEach(r => { relMap[r.getAttribute("Id")] = r.getAttribute("Target"); });
  // 굵기/기울임 슬롯 → CSS 디스크립터
  const slots = [["regular","400","normal"], ["bold","700","normal"], ["italic","400","italic"], ["boldItalic","700","italic"]];
  const doc = (typeof docs !== "undefined") ? docs.find(d => d.el === host) : null;
  const faces = [];
  for (const ef of Array.from(presDoc.getElementsByTagNameNS("*", "embeddedFont"))){
    const fontEl = ef.getElementsByTagNameNS("*", "font")[0];
    const family = fontEl && fontEl.getAttribute("typeface");
    if (!family) continue;
    for (const [slot, weight, style] of slots){
      const slotEl = ef.getElementsByTagNameNS("*", slot)[0];
      if (!slotEl) continue;
      const rid = slotEl.getAttributeNS(REL_NS, "id") || slotEl.getAttribute("r:id");
      const target = rid && relMap[rid];
      if (!target) continue;
      const part = zip.file(resolvePptPath("ppt/", target));
      if (!part) continue;
      const ttf = eotToSfnt(part.asUint8Array());
      if (!ttf) continue;
      try {
        const ff = new FontFace(family, ttf, { weight, style });
        faces.push(ff);
        ff.load().then(loaded => { if (!doc || !doc.closed){ try { document.fonts.add(loaded); } catch(e){} } }).catch(()=>{});
      } catch(e){ /* 개별 폰트 실패는 무시하고 나머지 진행 */ }
    }
  }
  if (doc && faces.length) doc.__fontFaces = (doc.__fontFaces || []).concat(faces);  // 닫을 때 정리용
}

function normalizeArrayBuffer(bytes){
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function repairPptxPackageForViewer(bytes){
  if (typeof JSZip === "undefined") return bytes;
  try {
    const zip = new JSZip(bytes);
    const entry = zip.file("[Content_Types].xml");
    if (!entry) return bytes;

    const xml = entry.asText().replace(/^\uFEFF/, "");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return bytes;

    const root = doc.documentElement;
    const ns = root.namespaceURI || "http://schemas.openxmlformats.org/package/2006/content-types";
    const children = Array.from(root.children);
    let changed = false;

    let xmlDefault = children.find(el =>
      el.localName === "Default" && (el.getAttribute("Extension") || "").toLowerCase() === "xml"
    );
    if (!xmlDefault) {
      xmlDefault = doc.createElementNS(ns, "Default");
      xmlDefault.setAttribute("Extension", "xml");
      root.insertBefore(xmlDefault, root.firstChild);
      changed = true;
    }
    if (xmlDefault.getAttribute("ContentType") !== "application/xml") {
      xmlDefault.setAttribute("ContentType", "application/xml");
      changed = true;
    }

    const hasCoreOverride = children.some(el =>
      el.localName === "Override" && el.getAttribute("PartName") === "/docProps/core.xml"
    );
    if (!hasCoreOverride) {
      const override = doc.createElementNS(ns, "Override");
      override.setAttribute("PartName", "/docProps/core.xml");
      override.setAttribute("ContentType", "application/vnd.openxmlformats-package.core-properties+xml");
      const firstOverride = Array.from(root.children).find(el => el.localName === "Override");
      root.insertBefore(override, firstOverride || null);
      changed = true;
    }

    zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(doc));
    changed = repairPptxAppProperties(zip) || changed;
    changed = normalizePptxRelTargets(zip) || changed;
    if (!changed) return bytes;
    return zip.generate({ type: "uint8array", compression: "DEFLATE" });
  } catch (e) {
    console.warn("pptx package repair skipped:", e);
    return bytes;
  }
}

function repairPptxAppProperties(zip){
  try {
    const entry = zip.file("docProps/app.xml");
    if (!entry) return false;

    const xml = entry.asText().replace(/^\uFEFF/, "");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return false;

    const oldRoot = doc.documentElement;
    const ns = oldRoot.namespaceURI || "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
    const values = {};
    Array.from(oldRoot.children).forEach(child => {
      values[child.localName] = child.textContent || "";
    });
    const fixedDoc = document.implementation.createDocument(ns, "Properties", null);
    const root = fixedDoc.documentElement;
    let changed = false;

    const ensureText = (name, value, replaceInvalid) => {
      const current = values[name] || "";
      const el = fixedDoc.createElementNS(ns, name);
      if (!String(current).trim() || (replaceInvalid && replaceInvalid(current))) {
        el.textContent = value;
        changed = true;
      } else {
        el.textContent = current;
      }
      root.appendChild(el);
    };

    changed = changed || oldRoot.nodeName !== "Properties";
    ensureText("Application", "Microsoft Office PowerPoint");
    ensureText("PresentationFormat", "On-screen Show (16:9)");
    const slideCount = Object.keys(zip.files || {}).filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length || 1;
    ensureText("Slides", String(slideCount), value => Number(value) < 1);
    ensureText("Notes", "0");
    ensureText("HiddenSlides", "0");
    ensureText("SharedDoc", "false");
    ensureText("DocSecurity", "0");
    ensureText("AppVersion", "16.0000");

    if (changed) zip.file("docProps/app.xml", new XMLSerializer().serializeToString(fixedDoc));
    return changed;
  } catch (e) {
    console.warn("pptx app property repair skipped:", e);
    return false;
  }
}

function normalizePptxRelTargets(zip){
  // 일부 도구(python-pptx 등)가 만든 pptx 는 관계(.rels) Target 을 "/ppt/..." 절대경로로 적는다.
  // PPTXjs 는 Target.replace("../","ppt/") 로만 경로를 해석해서 절대경로(앞 슬래시)를 못 따라가고
  // 레이아웃·마스터·테마·노트를 전부 못 찾아 렌더가 실패한다.
  // "/ppt/" → "../" 로 바꿔 정품 PowerPoint 와 같은 상대경로 형태로 정규화한다.
  let changed = false;
  try {
    const names = Object.keys(zip.files || {}).filter(name => /\.rels$/i.test(name));
    for (const name of names){
      const entry = zip.file(name);
      if (!entry) continue;
      const text = entry.asText();
      const fixed = text.replace(/Target=(["'])\/ppt\//g, "Target=$1../");
      if (fixed !== text){
        zip.file(name, fixed);
        changed = true;
      }
    }
  } catch (e) {
    console.warn("pptx rels normalize skipped:", e);
  }
  return changed;
}

function waitForPptxRender(div){
  return new Promise((resolve, reject) => {
    const ready = () => div.querySelector(".slide, .slide-wrapper");
    if (ready()) { resolve(); return; }
    const observer = new MutationObserver(() => {
      if (ready()) {
        cleanup();
        resolve();
      }
    });
    const cleanup = () => {
      clearTimeout(timer);
      observer.disconnect();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("pptx-render-timeout"));
    }, 45000);
    observer.observe(div, { childList: true, subtree: true });
  });
}

