"use strict";

async function renderHwp(file, ext, host){
  if (ext === "hwpx"){ await renderHwpx(file, host); return; }   // 신형 HWPX 는 zip/XML 직접 파싱(간이 미리보기)
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("hwp");   // 한글 뷰어는 .hwp 를 열 때 처음 로드
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
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("zip");   // 압축 라이브러리는 첫 사용 때 로드
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
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("docx");   // Word 뷰어는 .docx 를 열 때 처음 로드
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

/* ===== 구형 Word(.doc, Word 6.0~2003) 글자 미리보기 =====
 * .docx 와 달리 zip+XML 이 아니라 OLE 복합 문서(CFB)라 docx-preview 로는 못 읽는다.
 * 쓸 만한 순수 JS 렌더러가 없어서, 여기서 CFB 를 직접 읽고 본문 "글자"만 뽑아 문단으로 보여준다.
 * 표·그림·서식은 살리지 못하므로 상단 배너로 알리고, 정확한 모양이 필요하면 (실제 경로를 아는
 * 파일에 한해) '탐색기에서 보기' 로 원래 프로그램에서 열도록 안내한다.
 * 열지 않아도 통합 검색이 되도록 렌더와 추출을 분리했다(docLegacyExtractText). */

const DOC_TEXT_MAX_CHARS = 2000000;    // 추출 글자 상한(PDF·Office 검색과 같은 보호선)
const DOC_MAX_PARAGRAPHS = 20000;      // 화면에 그릴 문단 상한(초대용량 문서에서 DOM 폭주 방지)

/* CFB(OLE2 복합 문서) 최소 리더 — 필요한 건 이름으로 스트림 하나 꺼내는 것뿐이라 그만큼만 구현한다.
   반환: { read(name) -> Uint8Array|null } */
function cfbReadStreams(bytes){
  const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (bytes.length < 512) throw new Error("doc-not-cfb");
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error("doc-not-cfb");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const secShift = u16(30), miniShift = u16(32);
  if (secShift < 7 || secShift > 20 || miniShift < 4 || miniShift > secShift) throw new Error("doc-bad-cfb");
  const secSize = 1 << secShift, miniSecSize = 1 << miniShift;
  const perSec = secSize >> 2;                                  // 섹터 하나에 들어가는 4바이트 항목 수
  const secCount = Math.max(0, Math.floor((bytes.length - 512) / secSize));
  const secOffset = (id) => 512 + id * secSize;
  const FREE = 0xFFFFFFFA;                                      // 이 값 이상은 모두 "끝/예약" 표시

  // DIFAT(헤더 109개 + 이어지는 DIFAT 섹터) → FAT 섹터 번호 목록
  const difat = [];
  for (let i = 0; i < 109; i++){ const s = u32(76 + i * 4); if (s < FREE) difat.push(s); }
  let next = u32(68);
  for (let guard = 0; next < FREE && next < secCount && guard < 4096; guard++){
    const base = secOffset(next);
    for (let i = 0; i < perSec - 1; i++){ const s = u32(base + i * 4); if (s < FREE) difat.push(s); }
    next = u32(base + (perSec - 1) * 4);                         // 마지막 칸은 다음 DIFAT 섹터를 가리킨다
  }
  const fat = new Uint32Array(difat.length * perSec);
  fat.fill(0xFFFFFFFF);                                         // 못 읽은 자리는 "끝"으로 둔다(엉뚱한 0번 섹터 추적 방지)
  let fi = 0;
  for (const fs of difat){
    if (fs < secCount){
      const base = secOffset(fs);
      for (let i = 0; i < perSec; i++) fat[fi + i] = u32(base + i * 4);
    }
    fi += perSec;
  }

  // 일반 섹터 체인을 따라가며 바이트를 모은다(size 0 이면 체인 끝까지).
  const gather = (start, size) => {
    const parts = [];
    let id = start, got = 0;
    for (let guard = 0; id < FREE && guard <= secCount; guard++){
      if (id >= secCount) break;
      const want = size > 0 ? Math.min(secSize, size - got) : secSize;
      if (want <= 0) break;
      parts.push(bytes.subarray(secOffset(id), secOffset(id) + want));
      got += want;
      if (size > 0 && got >= size) break;
      id = id < fat.length ? fat[id] : 0xFFFFFFFE;
    }
    const out = new Uint8Array(got);
    let w = 0;
    for (const p of parts){ out.set(p, w); w += p.length; }
    return out;
  };

  // 디렉터리(128바이트 항목) — 이름·종류·시작섹터·크기만 본다.
  const dirBytes = gather(u32(48), 0);
  const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const streams = new Map();
  let root = null;
  for (let off = 0; off + 128 <= dirBytes.length; off += 128){
    const type = dirBytes[off + 66];                             // 1=저장소, 2=스트림, 5=루트
    if (type !== 2 && type !== 5) continue;
    const nameLen = Math.min(64, dirBytes[off + 64] | (dirBytes[off + 65] << 8));
    let name = "";
    for (let i = 0; i + 1 < nameLen; i += 2){
      const c = dirBytes[off + i] | (dirBytes[off + i + 1] << 8);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    const entry = { type, start: ddv.getUint32(off + 116, true), size: ddv.getUint32(off + 120, true) };
    if (type === 5){ if (!root) root = entry; }
    else if (name && !streams.has(name)) streams.set(name, entry);
  }

  // 작은 스트림은 미니 스트림(루트 스트림) 안에 미니 FAT 체인으로 흩어져 있다 — 필요할 때만 읽는다.
  const miniCutoff = u32(56) || 4096;
  let miniStream = null, miniFat = null;
  const getMiniStream = () => (miniStream || (miniStream = root ? gather(root.start, root.size) : new Uint8Array(0)));
  const getMiniFat = () => {
    if (!miniFat){
      const raw = gather(u32(60), 0);
      const rdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      miniFat = new Uint32Array(raw.length >> 2);
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = rdv.getUint32(i * 4, true);
    }
    return miniFat;
  };

  const read = (name) => {
    const e = streams.get(name);
    if (!e) return null;
    if (e.size >= miniCutoff) return gather(e.start, e.size);
    const mf = getMiniFat(), ms = getMiniStream();
    const out = new Uint8Array(e.size);
    let id = e.start, w = 0;
    for (let guard = 0; id < FREE && w < e.size && guard <= mf.length; guard++){
      const off = id * miniSecSize;
      const n = Math.min(miniSecSize, e.size - w);
      if (off + n > ms.length) break;
      out.set(ms.subarray(off, off + n), w);
      w += n;
      id = id < mf.length ? mf[id] : 0xFFFFFFFE;
    }
    return out.subarray(0, w);
  };
  return { read };
}

// CP1252 의 0x80~0x9F 만 유니코드로 옮긴다(나머지는 코드값이 그대로 유니코드와 같다).
const DOC_CP1252_HIGH = {
  0x80:0x20AC, 0x82:0x201A, 0x83:0x0192, 0x84:0x201E, 0x85:0x2026, 0x86:0x2020, 0x87:0x2021,
  0x88:0x02C6, 0x89:0x2030, 0x8A:0x0160, 0x8B:0x2039, 0x8C:0x0152, 0x8E:0x017D, 0x91:0x2018,
  0x92:0x2019, 0x93:0x201C, 0x94:0x201D, 0x95:0x2022, 0x96:0x2013, 0x97:0x2014, 0x98:0x02DC,
  0x99:0x2122, 0x9A:0x0161, 0x9B:0x203A, 0x9C:0x0153, 0x9E:0x017E, 0x9F:0x0178
};
function docDecodeCp1252(bytes){
  const codes = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++){
    const b = bytes[i];
    codes[i] = (b >= 0x80 && b <= 0x9F) ? (DOC_CP1252_HIGH[b] || b) : b;
  }
  return docCharsFromCodes(codes);
}
function docDecodeUtf16(bytes, off, count){
  const codes = new Array(count);
  for (let i = 0; i < count; i++){
    const o = off + i * 2;
    codes[i] = bytes[o] | (bytes[o + 1] << 8);
  }
  return docCharsFromCodes(codes);
}
function docCharsFromCodes(codes){       // 청크 단위 — 긴 문서에서 스택 오버플로 방지
  let s = "";
  const CH = 0x4000;
  for (let i = 0; i < codes.length; i += CH) s += String.fromCharCode.apply(null, codes.slice(i, i + CH));
  return s;
}

/* WordDocument 스트림에서 본문 글자를 뽑는다.
   Word 97+ 는 본문이 조각(piece)으로 흩어져 있어 표 스트림의 조각표(CLX/PlcPcd)를 따라가야 한다.
   조각마다 1바이트(CP1252 압축) 또는 2바이트(UTF-16)로 저장돼 한글 문서도 그대로 읽힌다. */
function docLegacyTextFromCfb(cfb){
  const wd = cfb.read("WordDocument");
  if (!wd || wd.length < 96) throw new Error("doc-no-word-stream");
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  const wIdent = dv.getUint16(0, true);
  if (wIdent !== 0xA5EC && wIdent !== 0xA5DC && wIdent !== 0xA5DB) throw new Error("doc-not-word");
  const nFib = dv.getUint16(2, true);
  const flags = dv.getUint16(10, true);
  if (flags & 0x0100) throw new Error("doc-encrypted");         // 열기 암호 — 구형 RC4 라 해제 지원 대상 아님

  if (nFib < 101){                                              // Word 6.0/95 — 조각표 없이 본문이 통째로 들어 있다
    const fcMin = dv.getUint32(24, true), fcMac = dv.getUint32(28, true);
    if (!(fcMac > fcMin) || fcMac > wd.length) throw new Error("doc-bad-range");
    const end = Math.min(fcMac, fcMin + DOC_TEXT_MAX_CHARS);
    return smartDecodeText(wd.subarray(fcMin, end));            // 유니코드 이전 문서 → CP949 자동 판별에 맡긴다
  }

  if (wd.length < 0x01AA) throw new Error("doc-short-fib");
  const table = cfb.read((flags & 0x0200) ? "1Table" : "0Table");
  if (!table) throw new Error("doc-no-table-stream");
  const fcClx = dv.getUint32(0x01A2, true), lcbClx = dv.getUint32(0x01A6, true);
  const ccpText = dv.getUint32(0x004C, true);                   // 본문(머리말·각주 제외) 글자 수
  if (!lcbClx || fcClx + lcbClx > table.length) throw new Error("doc-bad-clx");

  // CLX = [Prc(서식 묶음)…] + Pcdt(조각표). 앞의 Prc 들은 건너뛰고 조각표만 찾는다.
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  const cdv = new DataView(clx.buffer, clx.byteOffset, clx.byteLength);
  let plc = null;
  for (let p = 0; p < clx.length; ){
    if (clx[p] === 0x01){
      if (p + 3 > clx.length) break;
      p += 3 + Math.max(0, cdv.getInt16(p + 1, true));
    } else if (clx[p] === 0x02){
      if (p + 5 > clx.length) break;
      const lcb = cdv.getUint32(p + 1, true);
      plc = clx.subarray(p + 5, p + 5 + Math.min(lcb, clx.length - p - 5));
      break;
    } else break;
  }
  if (!plc || plc.length < 16) throw new Error("doc-no-piece-table");

  // PlcPcd = CP 경계 (조각수+1)개 + 조각서술자(8바이트) 조각수개
  const pieces = Math.floor((plc.length - 4) / 12);
  const pdv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength);
  let out = "";
  for (let i = 0; i < pieces && out.length < DOC_TEXT_MAX_CHARS; i++){
    const count = pdv.getUint32((i + 1) * 4, true) - pdv.getUint32(i * 4, true);
    if (!(count > 0)) continue;
    const raw = pdv.getUint32((pieces + 1) * 4 + i * 8 + 2, true);
    const compressed = (raw & 0x40000000) !== 0;                // 압축=1바이트(CP1252), 아니면 2바이트(UTF-16)
    const fc = compressed ? ((raw & 0x3FFFFFFF) >> 1) : (raw & 0x3FFFFFFF);
    const need = compressed ? count : count * 2;
    if (fc + need > wd.length) continue;                        // 손상된 조각은 건너뛰고 나머지를 살린다
    out += compressed ? docDecodeCp1252(wd.subarray(fc, fc + count)) : docDecodeUtf16(wd, fc, count);
  }
  if (!out) throw new Error("doc-empty");
  return ccpText > 0 && out.length > ccpText ? out.slice(0, ccpText) : out;
}

/* Word 의 제어 문자를 읽을 수 있는 텍스트로 정리한다.
   0x0D 문단 끝 · 0x07 셀/행 끝 · 0x0B 줄바꿈 · 0x0C 쪽 나눔 → 줄바꿈.
   0x13~0x15 필드는 코드(예: HYPERLINK "…")를 버리고 화면에 보이는 결과만 남긴다. */
function docCleanText(raw){
  let out = "", inFieldCode = false;
  for (let i = 0; i < raw.length; i++){
    const c = raw.charCodeAt(i);
    if (c === 0x13){ inFieldCode = true; continue; }
    if (c === 0x14 || c === 0x15){ inFieldCode = false; continue; }
    if (inFieldCode) continue;
    if (c === 0x0D || c === 0x07 || c === 0x0B || c === 0x0C){ out += "\n"; continue; }
    if (c === 0x1E){ out += "-"; continue; }                    // 붙임표
    if (c === 0xA0){ out += " "; continue; }                    // 줄바꿈 없는 공백
    if (c === 0x1F) continue;                                   // 선택적 붙임표(화면에선 안 보임)
    if (c < 0x20 && c !== 0x09) continue;                       // 그림·각주 자리표시 등
    out += raw[i];
  }
  return out;
}

function docLooksRtf(bytes){
  return bytes.length > 5 && bytes[0] === 0x7B && bytes[1] === 0x5C &&
         bytes[2] === 0x72 && bytes[3] === 0x74 && bytes[4] === 0x66;
}
/* 확장자만 .doc 인 RTF 파일용 본문 추출.
   RTF 는 중괄호 그룹 구조라 단순 치환으로는 글꼴표·스타일표가 본문에 섞여 나온다.
   그래서 그룹을 따라가며 "본문이 아닌 목적지"(글꼴표 등)는 통째로 건너뛴다.
   한글은 \uN(유니코드) 또는 \'hh(코드페이지 바이트)로 오는데, 뒤엣것은 연속된 바이트를
   모아 한 번에 디코드해야 깨지지 않는다. */
const RTF_SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl",
  "headerr", "headerf", "footerl", "footerr", "footerf", "footnote", "listtable", "listoverridetable",
  "filetbl", "revtbl", "rsidtbl", "generator", "themedata", "colorschememapping", "latentstyles",
  "datastore", "xmlnstbl", "mmathPr", "panose", "falt", "bkmkstart", "bkmkend"
]);
function docTextFromRtf(src){
  let out = "";
  let bytes = [];                                               // 연속된 \'hh 바이트 모음
  const flush = () => {
    if (!bytes.length) return;
    out += smartDecodeText(new Uint8Array(bytes));              // CP949/UTF-8 자동 판별
    bytes = [];
  };
  const emit = (s) => { flush(); out += s; };
  const stack = [];
  let skip = false, uc = 1, i = 0;
  while (i < src.length){
    const ch = src[i];
    if (ch === "{"){ stack.push({ skip, uc }); i++; continue; }
    if (ch === "}"){ flush(); const s = stack.pop(); if (s){ skip = s.skip; uc = s.uc; } i++; continue; }
    if (ch === "\\"){
      const next = src[i + 1];
      if (next === "'"){                                        // \'hh — 코드페이지 바이트
        const b = parseInt(src.substr(i + 2, 2), 16);
        if (!skip && Number.isFinite(b)) bytes.push(b);
        i += 4; continue;
      }
      if (next === "*"){ skip = true; i += 2; continue; }        // {\*\…} 알 수 없는 목적지 → 건너뜀
      if (next === "\\" || next === "{" || next === "}"){ if (!skip) emit(next); i += 2; continue; }
      if (next === "\n" || next === "\r"){ if (!skip) emit("\n"); i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i));
      if (!m){ i += 2; continue; }
      const word = m[1], num = m[2] === undefined ? null : +m[2];
      i += m[0].length;
      if (word === "u" && num !== null){
        if (!skip) emit(String.fromCharCode((num + 65536) % 65536));
        for (let n = uc; n > 0 && i < src.length; n--){         // \uN 뒤 대체 문자(uc개)는 버린다
          if (src[i] === "{" || src[i] === "}") break;
          i += (src[i] === "\\" && src[i + 1] === "'") ? 4 : 1;
        }
        continue;
      }
      if (word === "uc" && num !== null){ uc = Math.max(0, num); continue; }
      if (RTF_SKIP_DESTINATIONS.has(word)){ skip = true; continue; }
      if (word === "par" || word === "line" || word === "sect" || word === "row"){ if (!skip) emit("\n"); continue; }
      if (word === "cell" || word === "tab"){ if (!skip) emit("\t"); continue; }
      continue;                                                 // 그 밖 제어어(서식 등)는 무시
    }
    if (ch === "\r" || ch === "\n"){ i++; continue; }            // RTF 에서 날 줄바꿈은 의미 없음
    if (!skip) emit(ch);
    i++;
  }
  flush();
  return out;
}

// 바이트 → 본문 글자(문단 줄바꿈 포함). 렌더와 검색이 함께 쓴다.
function docLegacyTextOf(bytes){
  if (docLooksRtf(bytes)) return docTextFromRtf(smartDecodeText(bytes));
  return docCleanText(docLegacyTextFromCfb(cfbReadStreams(bytes)));
}
// 이름만 .doc 이고 실제 내용은 다른 형식인 파일이 흔하다 — 앞부분 바이트로 갈래를 가른다.
function docLooksZip(bytes){ return bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4B; }
function docLooksCfb(bytes){
  const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  return true;
}
/* .doc 파일의 실제 갈래: "docx"(zip) · "doc"(구형 바이너리·RTF) · "text"(그 밖 — 이름만 .doc 인 텍스트 등) */
function docLegacyKindOf(head){
  if (docLooksZip(head)) return "docx";
  if (docLooksCfb(head) || docLooksRtf(head)) return "doc";
  return "text";
}

/* 통합 검색용 — 화면에 그리지 않고 본문 글자만 뽑는다(안 연 문서도 검색된다).
   이름만 .doc 인 docx 면 null 을 돌려, 부르는 쪽이 zip 통로로 넘기게 한다. */
async function docLegacyExtractText(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (docLooksZip(bytes)) return null;
  return docLegacyTextOf(bytes);
}

function docLegacyFailMessage(code){
  if (code === "doc-encrypted") return "암호로 보호된 .doc 이라 열 수 없어요. Word에서 암호를 풀고 다시 저장한 뒤 열어주세요.";
  if (code === "doc-not-cfb" || code === "doc-not-word") return "Word 문서 형식이 아니에요. 이름만 .doc 인 다른 파일일 수 있어요.";
  return "구형 Word(.doc) 본문을 읽지 못했어요. 손상됐거나 아직 다루지 못하는 형태예요.";
}

/* '탐색기에서 보기' — 작업공간에 저장된 파일에 한해 런처가 폴더를 열고 그 파일을 선택해 준다.
   Word 가 깔려 있으면 거기서 두 번 클릭으로 원래 프로그램으로 넘어간다.
   디스크에 실제 파일이 없으면(브라우저 단독 실행·Go 폴백 런처·압축 내부 파일) 버튼을 만들지 않는다
   — 눌러도 실패할 버튼을 보여주지 않기 위해 저장 백엔드 유무까지 확인한다. */
async function docExplorerButton(doc){
  const rel = doc && doc.workspacePath ? String(doc.workspacePath) : "";
  if (!rel) return null;
  if (typeof saveFileBackendAvailable !== "function") return null;
  if (!(await saveFileBackendAvailable())) return null;   // /can-save-file 프로브(한 번만 확인 후 캐시)
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "doc-open-native";
  btn.textContent = "탐색기에서 보기";
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const res = await fetch("/open-file-folder", {
        method: "POST",
        headers: { "X-PdfSigner-Action": "1", "X-Save-Path": encodeURIComponent(rel) },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
    } catch(_){ toast("폴더를 열지 못했어요.", 2400); }
    finally { btn.disabled = false; }
  };
  return btn;
}

async function renderDocLegacy(file, host, doc){
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "", why = "";
  try { text = docLegacyTextOf(bytes); }
  catch (e){ why = docLegacyFailMessage(e && e.message); }

  const lines = text ? text.split("\n") : [];
  const shell = document.createElement("div");
  shell.className = "md-host doc-host";
  let shown = 0, drawn = 0;
  for (const line of lines){
    if (drawn >= DOC_MAX_PARAGRAPHS) break;
    const p = document.createElement("p");
    p.className = "doc-p";
    if (line.trim()){ p.textContent = line; shown++; }
    else p.appendChild(document.createElement("br"));            // 빈 문단도 줄 간격 유지
    shell.appendChild(p); drawn++;
  }

  const note = document.createElement("div");
  note.className = "code-note";
  const msg = document.createElement("span");
  if (shown){
    msg.textContent = drawn < lines.length
      ? `구형 Word(.doc) 글자 미리보기 — 문단이 많아 앞 ${DOC_MAX_PARAGRAPHS.toLocaleString()}개만 보여줘요. 표·그림·서식은 빠집니다.`
      : "구형 Word(.doc) 글자 미리보기 — 표·그림·서식은 빠지고 글자만 보여줘요. 정확한 모양이 필요하면 원래 프로그램에서 열어주세요.";
  } else {
    msg.textContent = why || "구형 Word(.doc)에서 읽을 글자를 찾지 못했어요.";
  }
  note.appendChild(msg);
  const openBtn = await docExplorerButton(doc);
  if (openBtn) note.appendChild(openBtn);
  host.append(note, shell);
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
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("officeCrypt");   // 암호 문서를 만났을 때만 로드
  if (typeof OfficeDecrypt === "undefined" || !OfficeDecrypt.decrypt) throw new Error("복호화 모듈 없음");
  return OfficeDecrypt.decrypt(bytes, password);   // Uint8Array 반환(동기)
}

