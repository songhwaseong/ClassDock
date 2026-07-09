"use strict";

async function renderHwp(file, ext, host){
  if (ext === "hwpx"){ await renderHwpx(file, host); return; }   // 신형 HWPX 는 zip/XML 직접 파싱(간이 미리보기)
  if (!window.hwpjs || !window.hwpjs.Viewer){ toast("한글(HWP) 뷰어 로드 실패"); return; }
  // hwp.js 는 기본 type:'binary' = 바이너리 "문자열" 을 기대한다(Uint8Array 를 그대로 넘기면 s2a 에서 깨짐).
  // 그래서 바이트를 latin1 바이너리 문자열로 변환해 넘긴다.
  const u8 = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CH = 0x8000;                                   // 청크 단위(스택 오버플로 방지)
  for (let i = 0; i < u8.length; i += CH){
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  const wrap = document.createElement("div");
  wrap.className = "hwp-host";
  host.appendChild(wrap);
  new window.hwpjs.Viewer(wrap, bin);   // 생성자에서 동기 파싱+렌더 (type:'binary')
}

/* ===== HWPX(OWPML zip) 간이 미리보기 =====
 * hwp.js 가 신형 HWPX 를 렌더하지 못해, 압축 안 XML(Contents/section*.xml)을 직접 파싱한다.
 * 문단·표·그림과 기본 글자 서식(굵게·기울임·밑줄·크기·색·정렬)만 반영하는 내용 확인용이라
 * 원본과 배치가 다를 수 있음을 상단 배너로 안내한다. 파싱이 전부 실패하면 텍스트 미리보기
 * (Preview/PrvText.txt)로, 그것도 없으면 기존 안내(변환 후 열기)로 폴백한다. */
async function renderHwpx(file, host){
  if (typeof zip === "undefined"){ toast("압축 라이브러리를 불러오지 못했어요."); throw new Error("handled"); }
  zip.configure({ useWebWorkers: false });
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const fail = async (msg) => {
    try { await reader.close(); } catch(_){}
    toast(msg, 5000);
    throw new Error("handled");
  };
  let entries;
  try { entries = await reader.getEntries(); }
  catch(_){ return fail("HWPX를 열지 못했어요. 배포용(DRM)·암호 문서이거나 손상된 파일일 수 있어요."); }
  const byPath = new Map();
  for (const e of entries){ if (!e.directory) byPath.set(e.filename.replace(/\\/g, "/"), e); }
  const readText = (path) => { const e = byPath.get(path); return e ? e.getData(new zip.TextWriter()) : Promise.resolve(null); };

  const sections = orderHwpxSections([...byPath.keys()]);

  // 문자 모양(charPr)·문단 모양(paraPr) 표 — 없어도 본문은 보여준다.
  const charPrMap = new Map(), paraPrMap = new Map();
  try {
    const headerXml = await readText("Contents/header.xml");
    if (headerXml){
      const hdoc = new DOMParser().parseFromString(headerXml, "application/xml");
      for (const pr of hdoc.getElementsByTagName("*")){
        if (pr.localName === "charPr" && pr.getAttribute("id") != null){
          const st = {};
          const color = pr.getAttribute("textColor");
          if (color && /^#?[0-9a-fA-F]{6}$/.test(color)) st.color = color.charAt(0) === "#" ? color : "#" + color;
          const height = parseInt(pr.getAttribute("height"), 10);       // 1/100pt 단위 (1000 = 10pt)
          if (height >= 400 && height <= 12800) st.pt = height / 100;
          for (const c of pr.children){
            if (c.localName === "bold") st.bold = true;
            else if (c.localName === "italic") st.italic = true;
            else if (c.localName === "underline" && (c.getAttribute("type") || "").toUpperCase() !== "NONE") st.underline = true;
          }
          charPrMap.set(pr.getAttribute("id"), st);
        } else if (pr.localName === "paraPr" && pr.getAttribute("id") != null){
          for (const c of pr.children){
            if (c.localName === "align"){
              const h = (c.getAttribute("horizontal") || "").toUpperCase();
              const align = h === "CENTER" ? "center" : h === "RIGHT" ? "right" : h === "JUSTIFY" || h === "DISTRIBUTE" ? "justify" : "";
              if (align) paraPrMap.set(pr.getAttribute("id"), { align });
            }
          }
        }
      }
    }
  } catch(_){}

  // 그림 매핑: content.hpf 매니페스트의 item id → BinData 경로
  const binMap = new Map();
  try {
    const hpf = await readText("Contents/content.hpf");
    if (hpf){
      const mdoc = new DOMParser().parseFromString(hpf, "application/xml");
      for (const it of mdoc.getElementsByTagName("*")){
        if (it.localName === "item" && it.getAttribute("id") && it.getAttribute("href"))
          binMap.set(it.getAttribute("id"), { href: it.getAttribute("href").replace(/^\//, ""), type: it.getAttribute("media-type") || "" });
      }
    }
  } catch(_){}

  const shell = document.createElement("div");
  shell.className = "md-host hwpx-host";           // 흰 종이 페이지 스타일 재사용(다크 테마 대응 포함)

  const renderText = (tEl, st) => {
    const span = document.createElement("span");
    if (st.bold) span.style.fontWeight = "700";
    if (st.italic) span.style.fontStyle = "italic";
    if (st.underline) span.style.textDecoration = "underline";
    if (st.pt) span.style.fontSize = st.pt + "pt";
    if (st.color) span.style.color = st.color;
    for (const node of tEl.childNodes){
      if (node.nodeType === 3) span.appendChild(document.createTextNode(node.nodeValue));
      else if (node.nodeType === 1 && node.localName === "lineBreak") span.appendChild(document.createElement("br"));
      else if (node.nodeType === 1 && node.localName === "tab") span.appendChild(document.createTextNode("\t"));
    }
    return span;
  };

  const renderPic = (picEl) => {
    let binId = null;
    for (const d of picEl.getElementsByTagName("*")){
      if (d.localName === "img" && d.getAttribute("binaryItemIDRef")){ binId = d.getAttribute("binaryItemIDRef"); break; }
    }
    if (!binId) return null;
    const item = binMap.get(binId);
    let entry = (item && (byPath.get(item.href) || byPath.get("Contents/" + item.href))) || null;
    if (!entry){                                     // 매니페스트가 없으면 BinData 에서 id 로 추정
      for (const [path, e] of byPath){ if (path.startsWith("BinData/") && path.includes(binId)){ entry = e; break; } }
    }
    if (!entry) return null;
    const img = document.createElement("img");
    img.className = "hwpx-img"; img.alt = "문서 그림";
    entry.getData(new zip.BlobWriter(item && item.type ? item.type : "image/png"))
      .then((blob) => { img.src = URL.createObjectURL(blob); })
      .catch(() => { img.remove(); });
    return img;
  };

  const renderTbl = (tblEl) => {
    const table = document.createElement("table"); table.className = "hwpx-tbl";
    for (const tr of tblEl.children){
      if (tr.localName !== "tr") continue;
      const rowEl = document.createElement("tr");
      for (const tc of tr.children){
        if (tc.localName !== "tc") continue;
        const cell = document.createElement("td");
        for (const c of tc.children){
          if (c.localName === "cellSpan"){
            const cs = parseInt(c.getAttribute("colSpan"), 10), rs = parseInt(c.getAttribute("rowSpan"), 10);
            if (cs > 1) cell.colSpan = cs;
            if (rs > 1) cell.rowSpan = rs;
          } else if (c.localName === "subList"){
            for (const p of c.children){ if (p.localName === "p") cell.appendChild(renderPara(p)); }
          }
        }
        rowEl.appendChild(cell);
      }
      if (rowEl.childElementCount) table.appendChild(rowEl);
    }
    return table;
  };

  const renderPara = (pEl) => {
    const p = document.createElement("p"); p.className = "hwpx-p";
    const pr = paraPrMap.get(pEl.getAttribute("paraPrIDRef"));
    if (pr && pr.align) p.style.textAlign = pr.align;
    for (const run of pEl.children){
      if (run.localName !== "run") continue;
      const st = charPrMap.get(run.getAttribute("charPrIDRef")) || {};
      for (const node of run.children){
        if (node.localName === "t") p.appendChild(renderText(node, st));
        else if (node.localName === "tbl") p.appendChild(renderTbl(node));
        else if (node.localName === "pic"){ const img = renderPic(node); if (img) p.appendChild(img); }
        // secPr(쪽 설정)·ctrl(머리말/꼬리말 등)은 간이 미리보기에서 건너뜀
      }
    }
    if (!p.childNodes.length) p.appendChild(document.createElement("br"));   // 빈 문단도 줄 간격 유지
    return p;
  };

  let parsedAny = false;
  for (const path of sections){
    let xml = null;
    try { xml = await readText(path); } catch(_){ continue; }
    if (!xml) continue;
    const sdoc = new DOMParser().parseFromString(xml, "application/xml");
    if (sdoc.getElementsByTagName("parsererror").length) continue;
    for (const child of sdoc.documentElement.children){
      if (child.localName === "p"){ shell.appendChild(renderPara(child)); parsedAny = true; }
    }
  }

  if (!parsedAny){
    // 본문 파싱 실패 → 한글이 넣어둔 텍스트 미리보기(Preview/PrvText.txt)라도 보여준다.
    let previewText = null;
    const prv = byPath.get("Preview/PrvText.txt");
    if (prv){
      try { previewText = smartDecodeText(await prv.getData(new zip.Uint8ArrayWriter())); } catch(_){}
    }
    if (!previewText || !previewText.trim())
      return fail("HWPX 내용을 읽지 못했어요. 배포용(DRM) 문서일 수 있어요 — 한글에서 'PDF로 저장' 후 열어주세요.");
    const pre = document.createElement("pre"); pre.className = "hwpx-prvtext"; pre.textContent = previewText;
    shell.appendChild(pre);
  }
  await reader.close();

  const note = document.createElement("div");
  note.className = "code-note";
  note.textContent = parsedAny
    ? "HWPX 간이 미리보기 — 문단·표·그림과 기본 서식만 보여줘요. 정확한 모양이 필요하면 한글에서 'PDF로 저장' 후 열어주세요."
    : "HWPX 텍스트 미리보기 — 본문 구조를 읽지 못해 문서에 저장된 텍스트만 보여줘요.";
  host.append(note, shell);
}

async function renderDocx(file, host){
  if (typeof docx === "undefined"){ toast("Word 뷰어 로드 실패"); return; }
  let data = file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksEncryptedOffice(bytes)){
    const dec = await promptAndDecrypt(bytes, "docx");
    if (!dec) throw new Error("cancelled");
    data = dec;                                   // 복호화된 Uint8Array
  }
  const wrap = document.createElement("div");
  wrap.className = "docx-host";
  host.appendChild(wrap);
  const opts = { className: "docx", inWrapper: true, breakPages: true, useBase64URL: true };
  try {
    await docx.renderAsync(data, wrap, null, opts);
  } catch (e){
    // 일부 docx 는 임베디드 폰트(embedTrueTypeFonts) 처리에서 docx-preview 가 throw 한다.
    // 폰트/페이지브레이크 처리를 끄고 1회 재시도 → 시스템 폰트로라도 내용을 표시한다.
    console.warn("docx 렌더 실패 → 폰트 무시로 재시도:", e);
    wrap.innerHTML = "";
    await docx.renderAsync(data, wrap, null, { ...opts, ignoreFonts: true, ignoreLastRenderedPageBreak: true });
  }
}

/* CFB(OLE2) + EncryptionInfo 스트림 → 열기 암호로 암호화된 오피스 파일인지 판별 */
function looksEncryptedOffice(bytes){
  if (bytes.length < 16) return false;
  if (!(bytes[0]===0xD0 && bytes[1]===0xCF && bytes[2]===0x11 && bytes[3]===0xE0)) return false;
  const needle = "EncryptionInfo";              // CFB 디렉터리에 UTF-16LE 로 저장됨
  const end = bytes.length - needle.length * 2;
  outer: for (let i = 0; i < end; i++){
    for (let j = 0; j < needle.length; j++){
      if (bytes[i + j*2] !== needle.charCodeAt(j) || bytes[i + j*2 + 1] !== 0) continue outer;
    }
    return true;
  }
  return false;
}

/* 앱 내부 암호 입력 모달 → Promise<string|null> (취소 시 null) */
function askPassword(message){
  return new Promise((resolve) => {
    const modal = byId("pwModal"), input = byId("pwInput");
    byId("pwSub").textContent = message || "암호로 보호된 파일입니다. 암호를 입력하세요.";
    input.value = "";
    modal.hidden = false;
    setTimeout(() => input.focus(), 40);
    const cleanup = () => {
      modal.hidden = true;
      byId("pwOk").onclick = null; byId("pwCancel").onclick = null; input.onkeydown = null;
    };
    const ok = () => { const v = input.value; cleanup(); resolve(v); };
    const cancel = () => { cleanup(); resolve(null); };
    byId("pwOk").onclick = ok;
    byId("pwCancel").onclick = cancel;
    input.onkeydown = (e) => {
      if (e.key === "Enter"){ e.preventDefault(); ok(); }
      else if (e.key === "Escape"){ e.preventDefault(); cancel(); }
    };
  });
}

/* 앱 내부 텍스트 입력 모달 → Promise<string|null> (취소/Esc 시 null, 확인 시 입력값 그대로) */
function askText(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const modal = byId("textModal"), input = byId("textInput");
    byId("textTitle").textContent = opts.title || "이름 입력";
    byId("textSub").textContent = opts.message || "";
    byId("textOk").textContent = opts.okText || "확인";
    input.placeholder = opts.placeholder || "";
    input.value = opts.value || "";
    modal.hidden = false;
    setTimeout(() => {
      input.focus();
      const dot = input.value.lastIndexOf(".");          // 확장자 앞부분만 선택 → 바로 고쳐쓰기 편하게
      if (dot > 0) input.setSelectionRange(0, dot); else input.select();
    }, 40);
    const cleanup = () => { modal.hidden = true; byId("textOk").onclick = null; byId("textCancel").onclick = null; input.onkeydown = null; };
    const ok = () => { const v = input.value; cleanup(); resolve(v); };
    const cancel = () => { cleanup(); resolve(null); };
    byId("textOk").onclick = ok;
    byId("textCancel").onclick = cancel;
    input.onkeydown = (e) => {
      if (e.key === "Enter"){ e.preventDefault(); ok(); }
      else if (e.key === "Escape"){ e.preventDefault(); cancel(); }
    };
  });
}

/* 범용 확인 모달 — Promise<boolean> 반환 (확인=true, 취소/Esc=false) */
function confirmDialog(message, okText, cancelText){
  return new Promise((resolve) => {
    const modal = byId("confirmModal");
    byId("confirmSub").textContent = message || "계속하시겠어요?";
    byId("confirmOk").textContent = okText || "계속";
    byId("confirmCancel").textContent = cancelText || "취소";
    modal.hidden = false;
    setTimeout(() => byId("confirmOk").focus(), 40);
    const cleanup = () => {
      modal.hidden = true;
      byId("confirmOk").onclick = null; byId("confirmCancel").onclick = null;
      window.removeEventListener("keydown", onKey, true);
    };
    const done = (v) => { cleanup(); resolve(v); };
    byId("confirmOk").onclick = () => done(true);
    byId("confirmCancel").onclick = () => done(false);
    const onKey = (e) => {
      if (e.key === "Escape"){ e.preventDefault(); done(false); }
      else if (e.key === "Enter"){ e.preventDefault(); done(true); }
    };
    window.addEventListener("keydown", onKey, true);   // capture: 새로고침 가로채기보다 먼저 처리
  });
}

/* 암호 입력 → 복호화 → 복호화된 오피스 바이트(Uint8Array) 반환 (취소/실패 시 null) */
async function promptAndDecrypt(bytes, kind){
  hideLoading();
  const what = kind === "docx" ? "워드 문서" : kind === "pptx" ? "파워포인트" : "엑셀";
  for (let attempt = 0; attempt < 5; attempt++){
    const msg = attempt === 0
      ? `암호로 보호된 ${what}입니다. 암호를 입력하세요.`
      : "암호가 올바르지 않습니다. 다시 입력해 주세요.";
    const pw = await askPassword(msg);
    if (pw === null) return null;                // 취소
    try {
      showLoading("암호 해제 중…");
      const dec = await decryptOffice(bytes, pw, kind);
      hideLoading();
      if (dec) return dec;
    } catch (e){
      hideLoading();
      const m = e && e.message;
      if (m === "unsupported-encryption"){
        toast("이 암호화 방식은 아직 지원하지 않아요 (구형 Standard 방식).", 4000);
        return null;
      }
      if (m !== "wrong-password") console.warn("복호화 오류:", m);
      // wrong-password 등은 루프 → 재입력
    }
  }
  toast("암호 해제에 실패했습니다.", 3000);
  return null;
}

/* 범용 복호화: office-decrypt.js(crypto-js 기반, Agile) — xlsx/docx/pptx 공통 */
async function decryptOffice(bytes, password /*, kind */){
  if (typeof OfficeDecrypt === "undefined" || !OfficeDecrypt.decrypt) throw new Error("복호화 모듈 없음");
  return OfficeDecrypt.decrypt(bytes, password);   // Uint8Array 반환(동기)
}

