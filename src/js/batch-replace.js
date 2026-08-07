"use strict";

/* ===== 여러 파일 찾아 바꾸기 (batch replace) =====
   열린 텍스트·코드 문서들에서 한 낱말/패턴을 한꺼번에 찾아 바꾼다.
   편집기는 활성 문서에만 붙어 있으므로, 닫혀 있는 파일까지 바꾸려면
   "미리보기 → 확인 → 적용+저장" 방식이 이 구조에서 유일하게 안전하다.
   저장은 이미 검증된 saveTextDoc({silent,existingOnly}) 경로를 그대로 재사용한다
   (exe 런처에선 서버 저장이라 대화상자 없이 조용히 저장된다).

   PDF·오피스(본문 읽기전용)·노트북(셀 모델은 별도 저장 경로)은 v1에서 제외한다.
   정규식의 . 은 줄바꿈을 넘지 않으며, 개수·미리보기·결과는 줄 단위로 계산해 항상 일치한다. */

const BATCH_REPLACE_PREVIEW_LINES = 8;      // 파일당 미리보기로 보여줄 바뀌는 줄 최대 개수
const BATCH_REPLACE_SNIPPET_MAX = 160;      // 미리보기 한 줄 최대 글자(넘으면 … 로 줄임)

/* ---------- 순수 코어(테스트 대상) ---------- */

// 정규식 특수문자를 문자 그대로 다루도록 이스케이프(일반 찾기 모드).
function batchEscapeRegExp(value){
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 찾기 조건 → 재사용 가능한 정규식 정보. 오류·위험 패턴은 { error } 로 돌려준다.
function batchBuildMatcher(query, opts){
  opts = opts || {};
  if (!query) return { error: "찾을 말을 입력하세요." };
  const flags = "g" + (opts.caseSensitive ? "" : "i");
  const pattern = opts.regex ? String(query) : batchEscapeRegExp(query);
  let probe;
  try { probe = new RegExp(pattern, flags); }
  catch(e){ return { error: "정규식이 올바르지 않아요: " + (e && e.message || e) }; }
  // 빈 문자열에도 일치하는 패턴(예: a*, 빈 정규식)은 모든 자리에 끼어들어 위험 → 막는다.
  if (probe.test("")) return { error: "빈 문자열에도 일치하는 패턴은 쓸 수 없어요." };
  return { pattern, flags, regex: !!opts.regex };
}

// 바꿀 문자열: 일반 모드에선 $ 를 문자 그대로($$ 로 이스케이프), 정규식 모드에선 $1·$& 등 그대로 둔다.
function batchReplacementString(replacement, regex){
  return regex ? String(replacement) : String(replacement).replace(/\$/g, "$$$$");
}

// 한 문서 본문에 치환을 적용. 줄 단위 처리라 개수·미리보기·결과가 서로 어긋나지 않는다.
// 반환: { out(바뀐 전체 본문), count(바뀐 곳 수), changes([{line, before, after, count}]) }
function batchComputeReplacement(text, matcher, replacement){
  const repl = batchReplacementString(replacement, matcher.regex);
  const lines = String(text).split("\n");
  let count = 0;
  const changes = [];
  const out = lines.map((line, i) => {
    const found = line.match(new RegExp(matcher.pattern, matcher.flags));   // 전역 → 겹치지 않는 일치 배열
    const n = found ? found.length : 0;
    if (!n) return line;
    count += n;
    const after = line.replace(new RegExp(matcher.pattern, matcher.flags), repl);
    changes.push({ line: i + 1, before: line, after, count: n });
    return after;
  });
  return { out: out.join("\n"), count, changes };
}

// 아직 렌더하지 않은 파일도 일괄 치환 대상이므로, 디스크 원문을 LF 로 바꾸기 전에
// 저장 시 되살릴 개행과 BOM 정보를 문서에 기록한다(renderCode 의 초기 감지와 같은 규약).
function batchDetectDominantEol(raw){
  const s = String(raw || "");
  const crlf = (s.match(/\r\n/g) || []).length;
  const totalLf = (s.match(/\n/g) || []).length;
  const totalCr = (s.match(/\r/g) || []).length;
  const lfOnly = totalLf - crlf;
  const crOnly = totalCr - crlf;
  if (crlf > 0 && crlf >= lfOnly && crlf >= crOnly) return "crlf";
  if (crOnly > 0 && crOnly > lfOnly) return "cr";
  return "lf";
}

function batchRememberDocTextFormat(doc, raw){
  if (!doc) return;
  if (doc.textEol == null) doc.textEol = batchDetectDominantEol(raw);
  if (doc.textBom == null){
    const fromEncoding = !!(doc.textEncoding && doc.textEncoding.bom);
    doc.textBom = fromEncoding || String(raw || "").charCodeAt(0) === 0xFEFF;
  }
}

function batchIsTargetDoc(doc, isTextSearchable, isLocked){
  if (!doc || doc.notebookModel || doc.kind === "pdf") return false;
  if (typeof isLocked === "function" && isLocked(doc)) return false;
  if (typeof isTextSearchable === "function") return isTextSearchable(doc) || !!doc.codeEditor;
  return typeof doc.savedText === "string" || !!doc.codeEditor;
}

/* .docx·.pptx 는 텍스트가 아니라 별도 통로(MNOfficeReplace)로 바꾼다 — 압축 안 XML 을 직접 고쳐 쓴다.
   위 batchIsTargetDoc 은 확장자로 자연히 걸러내므로 두 판정이 겹치지 않는다.
   반환값은 형식 문자열("docx"|"pptx") 또는 null 이라, 부르는 쪽이 그대로 read() 에 넘길 수 있다. */
function batchOfficeKind(doc, isLocked){
  if (!doc || doc.notebookModel || doc.kind === "pdf") return null;
  if (typeof isLocked === "function" && isLocked(doc)) return null;
  const name = String(doc.name || "").toLowerCase();
  if (/\.docx$/.test(name)) return "docx";
  if (/\.pptx$/.test(name)) return "pptx";
  return null;
}

/* 미리보기 줄 앞의 이름표.
    - 텍스트: 줄 번호("12")
    - Word:   파트 + 문단 번호("문단 12"·"머리말 2")
    - PPT:    파트가 이미 번호를 달고 있어 이름표만("슬라이드 3"·"노트 3") */
function batchChangeLabel(change){
  if (!change) return "";
  if (change.label) return (change.para && change.numbered !== false) ? change.label + " " + change.para : change.label;
  if (change.para) return "문단 " + change.para;
  return String(change.line == null ? "" : change.line);
}

// 바꾸지 않은 곳을 숫자로 알린다 — "머리말 2곳 · 메모 1곳". 조용히 빠뜨리지 않기 위한 문구.
function batchOutsideSummary(outside){
  if (!Array.isArray(outside)) return "";
  const merged = new Map();
  for (const item of outside){
    if (!item || !item.count) continue;
    merged.set(item.label, (merged.get(item.label) || 0) + item.count);
  }
  return [...merged].map(([label, count]) => label + " " + count + "곳").join(" · ");
}

function batchIsVisibleDoc(doc, currentActiveId, currentStudyId){
  return !!(doc && (doc.id === currentActiveId || doc.id === currentStudyId));
}

// 되돌리기에서 디스크 재저장이 실패해도 화면의 내용은 이전 값으로 복원하되,
// clean 으로 거짓 표시하지 않는다. actions 를 주입해 상태 전이를 단위 테스트할 수 있게 한다.
async function batchRestoreUndoEntry(entry, actions){
  let persisted = false;
  let saveFailed = false;
  if (entry.resave){
    try { persisted = (await actions.save(entry)) === true; }
    catch(_){ persisted = false; }
    saveFailed = !persisted;
  }
  actions.reflect(entry.doc, entry.prev);
  if (typeof actions.markDirty === "function") actions.markDirty(entry.doc, !persisted);
  return { persisted, needsSave: !persisted, saveFailed };
}

// 실제 파일 저장과 별개로 앱 재시작 복원 묶음도 최신 바이트로 교체한다.
// 여러 파일을 하나씩 rememberWorkspace 하면 매번 전체 묶음을 병합하므로, 성공한 파일을 모아 한 번만 저장한다.
async function batchRememberSavedEntries(entries, actions){
  if (!Array.isArray(entries) || !entries.length || !actions ||
      typeof actions.makeFile !== "function" || typeof actions.remember !== "function")
    return { attempted: false, saved: false };
  const files = entries.map(entry => actions.makeFile(entry)).filter(Boolean);
  if (!files.length) return { attempted: false, saved: false };
  let saved = false;
  try { saved = (await actions.remember(files)) === true; } catch(_){ saved = false; }
  entries.forEach(entry => { if (entry.doc) entry.doc.savedInWorkspace = saved; });
  return { attempted: true, saved };
}

function batchApplyButtonModel(preview){
  if (!preview) return { disabled: false, requiresPreview: true, label: "미리보기" };
  const chosen = Array.isArray(preview.files) ? preview.files.filter(file => file.checked) : [];
  if (!chosen.length) return { disabled: true, requiresPreview: false, label: "바꾸고 저장" };
  const total = chosen.reduce((sum, file) => sum + (Number(file.count) || 0), 0);
  return {
    disabled: false,
    requiresPreview: false,
    label: "바꾸고 저장 (" + chosen.length + "개 파일 · " + total + "곳)"
  };
}

/* ---------- 브라우저 전용: 대상 문서·본문 확보 ---------- */

if (typeof window !== "undefined" && window.document) {

  // 바꿀 수 있는(=편집 가능한 텍스트·코드) 열린 문서. PDF·노트북·바이너리 오피스는 제외.
  // 주의: 이 앱은 .txt·.md·.py 등도 kind==="office" 로 로드한다(viewer-base 의 loadOffice).
  // 그래서 kind 로 거르면 안 되고, 텍스트 여부는 isTextExtSearchable 로 판정한다
  // (이 함수는 pdf 를 빼고, .docx 같은 바이너리 오피스는 확장자로 자연히 false 가 된다).
  function batchReplaceTargetDocs(){
    if (typeof docs === "undefined") return [];
    const textCheck = typeof isTextExtSearchable === "function" ? isTextExtSearchable : null;
    const lockCheck = typeof isStudyReferenceLocked === "function" ? isStudyReferenceLocked : null;
    return docs.filter(d => batchIsTargetDoc(d, textCheck, lockCheck) || !!batchReplaceOfficeKind(d, lockCheck));
  }

  // 오피스 문서는 원본 바이트를 다시 읽어 zip 을 고쳐 쓰므로 sourceFile 이 없으면 대상이 아니다.
  function batchReplaceOfficeKind(doc, lockCheck){
    if (typeof MNOfficeReplace !== "object" || !MNOfficeReplace) return null;
    if (!doc || !doc.sourceFile) return null;
    return batchOfficeKind(doc, lockCheck);
  }

  // 설정(설정▸문서)에서 읽는 기본값. 창이 사는 동안 고정한다 — 미리보기와 결과가 다른 값을 보면 그게 곧 사고다.
  function batchOfficeSettings(){
    const settings = (typeof appSettings === "object" && appSettings) ? appSettings : {};
    return {
      includeAttached: settings.officeReplaceAttached === true,
      allowTrackedChanges: settings.officeReplaceTracked === true
    };
  }

  const BATCH_OFFICE_UNDO_MAX_BYTES = 200 * 1024 * 1024;   // 되돌리기용 원본 바이트를 들고 있을 상한

  /* 저장·반영은 문단 편집(docx-editor)과 같은 규칙을 써야 하므로 MNOfficeReplace 에 두었다.
     텍스트와 달리 "편집기에만 반영" 이 성립하지 않는다(Word·PPT 는 여기서 편집기가 없다) —
     저장하지 못하면 화면도 바꾸지 않아야 "바뀐 줄 알았는데 파일은 그대로" 를 막는다.
     반환은 { path, mode } — 원본을 덮어썼는지("original") 사본이 생겼는지("copy") 결과 문구에 옮긴다. */
  const batchOfficeSaveBytes = (doc, bytes, kind) => MNOfficeReplace.saveDocument(doc, bytes, kind);

  // 반영 + 다음에 볼 때 새로 그리기. 지금 보이는 문서면 즉시 다시 그린다.
  function batchOfficeReflect(doc, bytes, kind){
    if (!MNOfficeReplace.reflectSaved(doc, bytes, kind)) return;
    doc.rendered = false;
    const currentStudyId = typeof studyPdfId !== "undefined" ? studyPdfId : null;
    if (batchIsVisibleDoc(doc, activeId, currentStudyId) && typeof ensureRendered === "function") ensureRendered(doc);
  }

  // 문서의 현재 본문을 LF 로 정규화해 돌려준다(편집 중 > 저장본 > 디스크 순).
  async function batchReplaceReadText(doc){
    const norm = (s) => String(s).replace(/\r\n?/g, "\n");
    if (doc.codeEditor && typeof doc.codeEditor.getValue === "function"){
      try { return norm(doc.codeEditor.getValue()); } catch(_){}
    }
    if (typeof liveDocText === "function"){
      try { const live = liveDocText(doc); if (live != null) return norm(live); } catch(_){}
    }
    if (typeof doc.savedText === "string") return norm(doc.savedText);
    if (doc.sourceFile && typeof readDocSourceBytes === "function" && typeof smartDecodeText === "function"){
      try {
        const raw = smartDecodeText(await readDocSourceBytes(doc));
        batchRememberDocTextFormat(doc, raw);
        return norm(raw);
      } catch(_){}
    }
    return null;
  }

  const brEsc = (s) => (typeof escapeHtml === "function" ? escapeHtml(s)
    : String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])));
  const brClip = (s) => { s = String(s); return s.length > BATCH_REPLACE_SNIPPET_MAX ? s.slice(0, BATCH_REPLACE_SNIPPET_MAX) + "…" : s; };
  const brToast = (msg, ms, opts) => { if (typeof toast === "function") toast(msg, ms, opts); };

  /* ---------- 적용 · 되돌리기 ---------- */

  function batchWorkspaceSnapshotFile(entry){
    if (!entry || !entry.doc || typeof recoverySnapshotFile !== "function") return null;
    if (entry.bytes){  // 오피스 문서 — 바이트 그대로 복원 묶음에 넣는다
      const mime = MNOfficeReplace.mimeOf(entry.kind);
      return recoverySnapshotFile(entry.doc, new Blob([entry.bytes], { type: mime }), mime);
    }
    const out = typeof applyDocEncodingOnSave === "function"
      ? applyDocEncodingOnSave(entry.text, entry.doc)
      : String(entry.text == null ? "" : entry.text);
    return recoverySnapshotFile(entry.doc, new Blob([out], { type:"text/plain;charset=utf-8" }), "text/plain;charset=utf-8");
  }

  function batchRememberWorkspaceEntries(entries){
    return batchRememberSavedEntries(entries, {
      makeFile: batchWorkspaceSnapshotFile,
      remember: (files) => typeof rememberWorkspace === "function"
        ? rememberWorkspace(files, false, { silent:true })
        : false
    });
  }

  // 확장자 → renderCode 프로파일(viewer-base 의 텍스트 경로와 같은 매핑).
  const BATCH_PLAIN_EXTS = new Set(["md","markdown","mdx","txt","text","log","srt","vtt","smi","rst","adoc","asciidoc","org","textile","wiki","mediawiki"]);
  function batchTextProfile(ext){
    if (!ext || BATCH_PLAIN_EXTS.has(ext)) return "text";
    if (ext === "html" || ext === "htm" || ext === "xhtml") return "xml";
    if (typeof CODE_EXTS !== "undefined" && ext in CODE_EXTS) return null;   // renderCode 가 CODE_EXTS 로 결정
    return "text";
  }

  // 바뀐 내용을 앱이 실제로 읽는 곳에 반영한다. 핵심: doc.render 의 클로저는 처음 연 File 을
  // 붙들고 있어(viewer-base) sourceFile 만 바꿔선 재렌더가 옛 내용을 읽는다 → 새 File 로 render 를 다시 만든다.
  //  - 편집기가 떠 있으면(활성/편집 중): setValue 로 화면 반영, render 는 건드리지 않는다.
  //  - 그 밖(읽기전용 보기·아직 안 연 탭): 새 File 로 sourceFile·render 를 교체하고 다음에 열 때 새로 그리게 한다.
  function batchReflectInDoc(doc, newText){
    let fresh = null;
    try {
      const bytes = new TextEncoder().encode(newText);
      fresh = new File([bytes], doc.name || "text.txt", { type: "text/plain" });
      const old = doc.sourceFile;
      if (old){
        if (old.__fsHandle && typeof withFileHandle === "function") withFileHandle(fresh, old.__fsHandle);
        if (old.__fsDirHandle && typeof withDirHandle === "function") withDirHandle(fresh, old.__fsDirHandle);
      }
      doc.sourceFile = fresh;                 // 내용검색·비교·실행이 새 내용을 읽도록(readDocSourceBytes)
      if (typeof contentCacheDrop === "function") contentCacheDrop(doc.id);
    } catch(_){}
    if (doc.codeEditor && typeof doc.codeEditor.setValue === "function"){
      try { doc.codeEditor.setValue(newText); } catch(_){}
      return;                                 // 편집기가 곧 최신 화면 — render 재구성 불필요
    }
    if (!fresh) return;
    const ext = typeof fileExtOf === "function" ? fileExtOf(String(doc.name || "").toLowerCase()) : "";
    const prof = batchTextProfile(ext);
    const ctx = { relPath: doc.relPath, archiveCtx: doc.archiveCtx };
    doc.render = async () => {
      const host = doc.el; if (!host) return;
      host.innerHTML = ""; host.scrollTop = 0;
      await renderCode(fresh, host, ext, prof, ctx);
    };
    doc.rendered = false;                      // 다음 활성화 때 새로 그린다(지연 렌더)
    const currentStudyId = typeof studyPdfId !== "undefined" ? studyPdfId : null;
    if (batchIsVisibleDoc(doc, activeId, currentStudyId) && typeof ensureRendered === "function")
      ensureRendered(doc);                     // 작업 탭 또는 분할 참고 칸에 지금 보이는 문서는 즉시 갱신
  }

  // 선택한 파일들에 치환을 적용하고 저장한다. 반환: 되돌리기용 스냅샷 배열.
  async function batchReplaceApply(chosen){
    const undo = [];
    const workspaceEntries = [];
    let saved = 0, editedOnly = 0, skipped = 0, replaced = 0, undoDropped = 0, undoBytes = 0, savedAsCopy = 0;
    const outside = [];
    for (const f of chosen){
      const doc = f.doc;
      if (f.kind){                                  // "docx" | "pptx" — 오피스 통로
        if (Array.isArray(f.outside)) for (const item of f.outside) outside.push(item);
        let bytes = null;
        try { bytes = await MNOfficeReplace.build(f.source.bytes, f.replaced); }
        catch(e){ console.error(e); skipped++; continue; }
        const savedAt = await batchOfficeSaveBytes(doc, bytes, f.kind);
        if (!savedAt){ skipped++; continue; }       // 저장 못 하면 화면도 바꾸지 않는다
        if (savedAt.mode === "copy") savedAsCopy++;  // 원본이 아니라 자동 저장 폴더에 사본이 생겼다
        batchOfficeReflect(doc, bytes, f.kind);
        workspaceEntries.push({ doc, bytes, kind: f.kind });
        // 되돌리기는 원본 바이트를 들고 있어야 한다 — 합계가 상한을 넘으면 그 뒤 파일은 되돌리기 없이 저장한다.
        if (undoBytes + f.source.bytes.length <= BATCH_OFFICE_UNDO_MAX_BYTES){
          undo.push({ doc, prev: f.source.bytes, resave: true, kind: f.kind });
          undoBytes += f.source.bytes.length;
        } else undoDropped++;
        saved++; replaced += f.count;
        continue;
      }
      const hadEditor = doc.codeEditor && typeof doc.codeEditor.setValue === "function";
      let res = "skipped";
      if (typeof saveTextDoc === "function"){
        try { res = await saveTextDoc(f.out, doc, doc.name, { silent: true, existingOnly: true }); }
        catch(_){ res = false; }
      }
      if (res === true){
        batchReflectInDoc(doc, f.out);         // 디스크 저장됨 → 화면·재렌더도 새 내용으로
        undo.push({ doc, prev: f.text, resave: true });
        workspaceEntries.push({ doc, text: f.out });
        saved++; replaced += f.count;
        if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
      } else if (hadEditor){
        // 저장 위치는 없지만 편집기엔 반영 → 미저장으로 두어 사용자가 직접 저장(Ctrl+Z 로도 되돌릴 수 있다).
        batchReflectInDoc(doc, f.out);
        undo.push({ doc, prev: f.text, resave: false });
        editedOnly++; replaced += f.count;
        if (typeof markDocumentDirty === "function") markDocumentDirty(doc, true);
      } else {
        skipped++;   // 디스크 저장 불가 + 편집기 없음 → 아무것도 바꾸지 않는다(화면·디스크 어긋남 방지)
      }
    }
    const workspace = await batchRememberWorkspaceEntries(workspaceEntries);
    return { undo, saved, editedOnly, skipped, replaced, undoDropped, savedAsCopy, outside,
      workspaceAttempted: workspace.attempted, workspaceSaved: workspace.saved };
  }

  async function batchReplaceUndo(undo){
    let done = 0, needsSave = 0, saveFailed = 0;
    const workspaceEntries = [];
    for (const u of undo){
      const result = await batchRestoreUndoEntry(u, {
        save: (entry) => entry.kind
          ? batchOfficeSaveBytes(entry.doc, entry.prev, entry.kind).then(at => !!at)
          : (typeof saveTextDoc === "function"
            ? saveTextDoc(entry.prev, entry.doc, entry.doc.name, { silent: true, existingOnly: true })
            : false),
        reflect: (doc, prev) => { if (prev instanceof Uint8Array) batchOfficeReflect(doc, prev, batchOfficeKind(doc)); else batchReflectInDoc(doc, prev); },
        markDirty: typeof markDocumentDirty === "function" ? markDocumentDirty : null
      });
      done++;
      if (result.needsSave) needsSave++;
      if (result.saveFailed) saveFailed++;
      if (result.persisted) workspaceEntries.push(u.kind ? { doc: u.doc, bytes: u.prev, kind: u.kind } : { doc: u.doc, text: u.prev });
    }
    const workspace = await batchRememberWorkspaceEntries(workspaceEntries);
    let msg = done + "개 파일 내용을 되돌렸어요.";
    if (needsSave) msg += " · " + needsSave + "개는 저장 안 됨";
    if (saveFailed) msg += " (" + saveFailed + "개 재저장 실패)";
    if (workspace.attempted && !workspace.saved) msg += " · 자동 복원 갱신 실패";
    const failed = saveFailed || (workspace.attempted && !workspace.saved);
    brToast(msg, failed ? 6000 : 3200, { type: failed ? "error" : "success" });
  }

  /* ---------- 패널(모달) ---------- */

  let batchReplaceOpen = false;

  function openBatchReplace(){
    if (batchReplaceOpen) return;
    if (!batchReplaceTargetDocs().length){
      brToast("바꿀 텍스트·코드 파일이 열려 있지 않아요.", 2800);
      return;
    }
    batchReplaceOpen = true;

    const modal = document.createElement("div"); modal.className = "modal batch-replace-modal";
    const card = document.createElement("div"); card.className = "modal-card batch-replace-card";
    const title = document.createElement("h3"); title.textContent = "여러 파일 찾아 바꾸기";
    // 설정(설정▸문서)은 창이 열릴 때 한 번만 읽어 그 세션 내내 고정한다.
    const officeSettings = batchOfficeSettings();
    const officeKinds = new Set(batchReplaceTargetDocs().map(d => batchOfficeKind(d)).filter(Boolean));

    const sub = document.createElement("p"); sub.className = "batch-replace-sub";
    if (officeKinds.size){
      const names = [officeKinds.has("docx") ? "Word(.docx)" : "", officeKinds.has("pptx") ? "PowerPoint(.pptx)" : ""].filter(Boolean);
      sub.textContent = "열린 텍스트·코드 파일과 " + names.join("·") +
        " 본문에서 한꺼번에 바꿔요. 미리보기로 확인한 뒤 적용하며, 적용 후에도 되돌릴 수 있어요. (PDF·노트북 제외)";
    } else {
      sub.textContent = "열린 텍스트·코드 파일에서 한꺼번에 바꿔요. 미리보기로 확인한 뒤 적용하며, 적용 후에도 되돌릴 수 있어요. (PDF·오피스·노트북 제외)";
    }

    // 입력줄
    const form = document.createElement("div"); form.className = "batch-replace-form";
    const mkField = (labelText, placeholder) => {
      const wrap = document.createElement("label"); wrap.className = "batch-replace-field";
      const cap = document.createElement("span"); cap.textContent = labelText;
      const input = document.createElement("input"); input.type = "text"; input.placeholder = placeholder; input.autocomplete = "off"; input.spellcheck = false;
      wrap.append(cap, input); form.appendChild(wrap);
      return input;
    };
    const findInput = mkField("찾을 말", "예: 2025");
    const replaceInput = mkField("바꿀 말", "예: 2026");

    // 사이드바 검색창(#sbSearch, "파일명·내용 검색")에 입력해 둔 말이 있으면 "찾을 말"에 미리 채워,
    // 검색하던 낱말을 그대로 이어서 바꿀 수 있게 한다(프로그램 입력이라 input 이벤트는 안 튐 → 미리보기는 사용자가 실행).
    try {
      const sbSearch = document.getElementById("sbSearch");
      const seed = sbSearch && String(sbSearch.value || "").trim();
      if (seed) findInput.value = seed;
    } catch(_){}

    // 최근 검색어(batch 구획) — "찾을 말"에만 붙인다. "바꿀 말"은 기억하지 않는다.
    // 여기서는 마지막 검색어를 자동으로 채우지 않는다: 이 창의 결과는 여러 파일을 한꺼번에 바꾸는 것이라,
    // 지난 검색어가 미리 들어가 있으면 엉뚱한 대상을 바꿀 수 있다. 목록에서 직접 고른 것만 들어간다.
    const findHistory = (typeof MNSearchHistory === "object" && MNSearchHistory)
      ? MNSearchHistory.attach(findInput, {
          scope: "batch",
          insertAfter: findInput.closest(".batch-replace-field"),
          onPick: () => { clearTimeout(previewTimer); runFullPreview(); }
        })
      : null;
    const rememberBatchFind = () => { if (findHistory) findHistory.remember(findInput.value); };

    const opts = document.createElement("div"); opts.className = "batch-replace-opts";
    const mkCheck = (labelText, titleText) => {
      const l = document.createElement("label"); l.className = "batch-replace-check"; if (titleText) l.title = titleText;
      const c = document.createElement("input"); c.type = "checkbox";
      const s = document.createElement("span"); s.textContent = labelText;
      l.append(c, s); opts.appendChild(l);
      return c;
    };
    const caseChk = mkCheck("대소문자 구분", "체크하면 A 와 a 를 다르게 봐요.");
    const regexChk = mkCheck("정규식", "정규식(예: \\d+, 그룹 $1)으로 찾고 바꿔요.");
    // 오피스 파일이 하나라도 열려 있을 때만 보여준다. 설정값으로 시작하되, 여기서 끄고 켠 값은 저장하지 않는다
    // (대소문자·정규식과 같은 '이번 실행값'). 기본값을 바꾸려면 설정▸문서에서 바꾼다.
    const attachedChk = officeKinds.size
      ? mkCheck(officeKinds.has("pptx") && !officeKinds.has("docx") ? "발표자 노트 포함" : "머리말·꼬리말·노트 포함",
          "끄면 본문(Word 본문·슬라이드)만 바꾸고, 머리말·꼬리말·각주·발표자 노트에 걸린 곳은 개수만 알려 줘요. 기본값은 설정▸문서에서 바꿔요.")
      : null;
    if (attachedChk) attachedChk.checked = officeSettings.includeAttached;
    const officeOptsNow = () => ({
      includeAttached: attachedChk ? attachedChk.checked : officeSettings.includeAttached,
      allowTrackedChanges: officeSettings.allowTrackedChanges
    });

    const status = document.createElement("div"); status.className = "batch-replace-status"; status.setAttribute("aria-live", "polite");
    const results = document.createElement("div"); results.className = "batch-replace-results";

    const actions = document.createElement("div"); actions.className = "modal-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "닫기";
    const apply = document.createElement("button"); apply.type = "button"; apply.className = "btn primary";
    actions.append(cancel, apply);

    card.append(title, sub, form, opts, status, results, actions);
    modal.appendChild(card);

    let lastPreview = null;   // { matcher, sig, files:[{doc,out,count,changes,text,checked}] }
    let previewTimer = 0;     // "찾을 말"·옵션 입력을 몰아 처리하는 디바운스 타이머

    const setApplyLabel = () => {
      const model = batchApplyButtonModel(lastPreview);
      apply.disabled = model.disabled;
      apply.textContent = model.label;
    };
    setApplyLabel();

    function renderResults(){
      const prevScroll = results.scrollTop;   // 실시간 갱신 때 목록 스크롤이 튀지 않게 유지
      results.innerHTML = "";
      if (!lastPreview) return;
      const files = lastPreview.files;
      const blocked = lastPreview.blocked || [];
      if (!files.length && !blocked.length){ status.textContent = "바뀔 내용이 없어요."; setApplyLabel(); return; }
      const totalMatches = files.reduce((n, f) => n + f.count, 0);
      status.textContent = files.length
        ? files.length + "개 파일 · " + totalMatches + "곳에서 바뀔 수 있어요."
        : "바뀔 내용이 없어요.";
      files.forEach((f) => {
        const box = document.createElement("div"); box.className = "batch-replace-file";
        const head = document.createElement("label"); head.className = "batch-replace-file-head";
        const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = f.checked;
        chk.addEventListener("change", () => { f.checked = chk.checked; box.classList.toggle("off", !chk.checked); setApplyLabel(); });
        const nm = document.createElement("b"); nm.className = "batch-replace-file-name";
        nm.textContent = f.doc.workspacePath || f.doc.relPath || f.doc.name;
        head.append(chk, nm);
        if (f.kind){
          const badge = document.createElement("span"); badge.className = "batch-replace-badge";
          badge.textContent = f.kind === "pptx" ? "슬라이드" : "Word 본문"; head.appendChild(badge);
          if (f.trackedChanges){
            const warn = document.createElement("span"); warn.className = "batch-replace-badge warn";
            warn.textContent = "변경 이력 있음";
            warn.title = "이 프로그램이 바꾼 내용은 Word 의 변경 이력에 남지 않아요.";
            head.appendChild(warn);
          }
        }
        const cnt = document.createElement("span"); cnt.className = "batch-replace-file-count"; cnt.textContent = f.count + "곳";
        head.appendChild(cnt);
        box.appendChild(head);
        const lines = document.createElement("div"); lines.className = "batch-replace-lines";
        f.changes.slice(0, BATCH_REPLACE_PREVIEW_LINES).forEach(ch => {
          const row = document.createElement("div"); row.className = "batch-replace-line";
          row.innerHTML =
            '<span class="brl-no">' + brEsc(batchChangeLabel(ch)) + '</span>' +
            '<span class="brl-before">' + brEsc(brClip(ch.before)) + '</span>' +
            '<span class="brl-after">' + brEsc(brClip(ch.after)) + '</span>';
          lines.appendChild(row);
        });
        if (f.changes.length > BATCH_REPLACE_PREVIEW_LINES){
          const more = document.createElement("div"); more.className = "batch-replace-more";
          more.textContent = "…그리고 " + (f.changes.length - BATCH_REPLACE_PREVIEW_LINES) + "줄 더";
          lines.appendChild(more);
        }
        // 바꾸지 않는 자리는 숨기지 않고 숫자로 적는다.
        const notes = [];
        const outsideText = batchOutsideSummary(f.outside);
        if (outsideText) notes.push(outsideText + "은 바꾸지 않아요");
        if (f.skipped) notes.push("탭·줄바꿈을 넘는 " + f.skipped + "곳은 바꿀 수 없어요");
        if (notes.length){
          const note = document.createElement("div"); note.className = "batch-replace-note";
          note.textContent = notes.join(" · ");
          lines.appendChild(note);
        }
        box.appendChild(lines);
        results.appendChild(box);
      });
      blocked.forEach((item) => {
        const box = document.createElement("div"); box.className = "batch-replace-file blocked";
        const head = document.createElement("div"); head.className = "batch-replace-file-head";
        const nm = document.createElement("b"); nm.className = "batch-replace-file-name";
        nm.textContent = item.doc.workspacePath || item.doc.relPath || item.doc.name;
        const why = document.createElement("span"); why.className = "batch-replace-file-count"; why.textContent = item.reason;
        head.append(nm, why);
        box.appendChild(head);
        results.appendChild(box);
      });
      results.scrollTop = prevScroll;
      setApplyLabel();
    }

    // 모달이 떠 있는 동안 문서 본문은 바뀌지 않으므로(오버레이가 막음) 한 번 읽어 캐시한다.
    // 이래야 "바꿀 말"을 칠 때마다 디스크·편집기를 다시 읽지 않고 즉시 목록을 다시 계산할 수 있다.
    const textCache = new Map();
    async function readDocCached(doc){
      if (textCache.has(doc.id)) return textCache.get(doc.id);
      const t = await batchReplaceReadText(doc);
      textCache.set(doc.id, t);
      return t;
    }
    /* 오피스 문서도 같은 이유로 한 번만 푼다. 캐시에 담는 건 "찾을 말과 무관한 부분"(원본 바이트·파트 XML)이라
       찾을 말이나 머리말 옵션이 바뀌어도 zip 을 다시 풀지 않는다. 제외 사유도 여기서 한 번 정해진다. */
    const officeCache = new Map();
    async function readOfficeCached(doc, kind){
      if (officeCache.has(doc.id)) return officeCache.get(doc.id);
      let source;
      try { source = await MNOfficeReplace.read(doc.sourceFile, kind, officeSettings); }
      catch(e){ console.error(e); source = { reason: "문서를 열지 못했어요." }; }
      officeCache.set(doc.id, source);
      return source;
    }
    // "찾기" 조건의 지문. 이게 그대로면 걸리는 파일·줄은 안 바뀌고 "바꿀 말"만 다시 계산하면 된다.
    const findSig = () => JSON.stringify([findInput.value, caseChk.checked, regexChk.checked,
      attachedChk ? attachedChk.checked : null]);

    // 전체 재훑기: 파일을 (캐시 경유) 읽어 걸리는 곳을 새로 찾는다. "찾을 말"·옵션이 바뀔 때만 쓴다.
    async function runFullPreview(){
      const matcher = batchBuildMatcher(findInput.value, { caseSensitive: caseChk.checked, regex: regexChk.checked });
      if (matcher.error){ lastPreview = null; results.innerHTML = ""; status.textContent = matcher.error; setApplyLabel(); return; }
      const sig = findSig();
      const prevChecked = new Map((lastPreview ? lastPreview.files : []).map(f => [f.doc.id, f.checked]));
      lastPreview = null;
      apply.disabled = true; apply.textContent = "미리보기 만드는 중…";
      status.textContent = "훑는 중…"; results.innerHTML = "";
      try {
        const targets = batchReplaceTargetDocs();
        const officeOpts = officeOptsNow();
        const files = [], blocked = [];
        for (const doc of targets){
          const checked = prevChecked.has(doc.id) ? prevChecked.get(doc.id) : true;
          const kind = batchOfficeKind(doc);
          if (kind){
            const source = await readOfficeCached(doc, kind);
            if (!source) continue;
            // 바꿀 수 없는 문서는 목록에서 지우지 않는다 — 사라지면 "일치가 없구나" 로 오해한다.
            if (source.reason){ blocked.push({ doc, reason: source.reason }); continue; }
            const r = MNOfficeReplace.compute(source, matcher, replaceInput.value, officeOpts);
            if (r.count > 0) files.push({ doc, kind, source, replaced: r.replaced, count: r.count,
              changes: r.changes, skipped: r.skipped, outside: r.outside, checked,
              trackedChanges: source.hasTrackedChanges });
            continue;
          }
          const text = await readDocCached(doc);
          if (text == null) continue;
          const r = batchComputeReplacement(text, matcher, replaceInput.value);
          if (r.count > 0) files.push({ doc, out: r.out, count: r.count, changes: r.changes, text, checked });
        }
        lastPreview = { matcher, sig, files, blocked };
        renderResults();
      } finally { setApplyLabel(); }
    }

    // "찾을 말"은 그대로고 "바꿀 말"만 바뀐 경우: 파일을 다시 읽지 않고 결과 문자열만 다시 계산한다(즉시).
    function recomputeReplacement(){
      if (!lastPreview) return;
      const officeOpts = officeOptsNow();
      lastPreview.files = lastPreview.files.map(f => {
        if (f.kind){
          const r = MNOfficeReplace.compute(f.source, lastPreview.matcher, replaceInput.value, officeOpts);
          return { ...f, replaced: r.replaced, count: r.count, changes: r.changes, skipped: r.skipped, outside: r.outside };
        }
        const r = batchComputeReplacement(f.text, lastPreview.matcher, replaceInput.value);
        return { doc: f.doc, out: r.out, count: r.count, changes: r.changes, text: f.text, checked: f.checked };
      });
      renderResults();
    }

    function scheduleFullPreview(delay){
      clearTimeout(previewTimer);
      previewTimer = setTimeout(runFullPreview, delay);
    }

    const close = () => {
      clearTimeout(previewTimer);
      window.removeEventListener("keydown", onKey, true);
      modal.remove(); batchReplaceOpen = false;
    };
    const onKey = (e) => {
      // 이 창의 키 처리는 window 캡처라 입력창보다 먼저 온다. 최근 검색어 목록이 열려 있는 동안에는
      // 위/아래와 (고른 항목이 있는) Enter 를 목록에 양보하고, Esc 한 번은 목록만 닫는다.
      if (findHistory && findHistory.isOpen()){
        if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); findHistory.hide(); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") return;
        if (e.key === "Enter" && findHistory.hasActive()) return;
      }
      if (e.key === "Escape"){ e.stopPropagation(); close(); }
      else if (e.key === "Enter" && (e.target === findInput || e.target === replaceInput)){ e.preventDefault(); clearTimeout(previewTimer); rememberBatchFind(); runFullPreview(); }
    };
    window.addEventListener("keydown", onKey, true);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    cancel.addEventListener("click", close);
    // 입력할 때마다 아래 목록을 살아 있게 갱신한다.
    //  - "바꿀 말"만 바뀌었으면(찾기 지문 동일) 파일을 다시 읽지 않고 즉시 재계산한다.
    //  - "찾을 말"·옵션이 바뀌었으면 잠깐 뒤(디바운스) 전체를 다시 훑는다.
    findInput.addEventListener("input", () => scheduleFullPreview(250));
    replaceInput.addEventListener("input", () => {
      if (lastPreview && lastPreview.sig === findSig()) recomputeReplacement();
      else scheduleFullPreview(250);
    });
    [caseChk, regexChk, attachedChk].forEach(el => { if (el) el.addEventListener("change", () => scheduleFullPreview(0)); });

    apply.addEventListener("click", async () => {
      if (!lastPreview){
        clearTimeout(previewTimer);
        await runFullPreview();
        if (lastPreview && lastPreview.files.length)
          status.textContent += " 결과를 확인한 뒤 아래 버튼을 다시 누르면 저장돼요.";
        return;
      }
      const chosen = lastPreview.files.filter(f => f.checked);
      if (!chosen.length) return;
      rememberBatchFind();                       // 실제로 바꾼 말만 기록에 남긴다
      apply.disabled = true; apply.textContent = "바꾸는 중…";
      const r = await batchReplaceApply(chosen);
      close();
      const parts = [];
      if (r.saved) parts.push(r.saved + "개 파일 저장");
      if (r.editedOnly) parts.push(r.editedOnly + "개 편집기만 반영");
      let msg = r.replaced + "곳 바꿈";
      if (parts.length) msg += " · " + parts.join(" · ");
      if (r.skipped) msg += " · " + r.skipped + "개 건너뜀(저장 위치 없음)";
      const outsideText = batchOutsideSummary(r.outside);
      if (outsideText) msg += " · " + outsideText + "은 안 바꿈";
      if (r.undoDropped) msg += " · " + r.undoDropped + "개는 되돌리기 없이 저장(용량)";
      // 원본이 아니라 자동 저장 폴더에 사본이 생긴 파일은 반드시 따로 알린다.
      if (r.savedAsCopy) msg += " · " + r.savedAsCopy + "개는 원본이 아닌 사본으로 저장(원본을 고치려면 '열기 → 폴더 열기')";
      if (r.workspaceAttempted && !r.workspaceSaved) msg += " · 자동 복원 갱신 실패";
      const failed = (r.workspaceAttempted && !r.workspaceSaved) || !!r.savedAsCopy;
      brToast(msg, 6000, {
        type: failed ? "error" : (r.replaced ? "success" : undefined),
        action: r.undo.length ? { label: "되돌리기", onClick: () => batchReplaceUndo(r.undo) } : null
      });
    });

    document.body.appendChild(modal);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);
    // 검색어를 미리 채운 채로 열렸으면, 미리보기를 누른 것처럼 아래 목록을 바로 보여준다.
    if (findInput.value) runFullPreview();
    requestAnimationFrame(() => { try { findInput.focus(); if (findInput.value) findInput.select(); } catch(_){} });
  }

  // 진입점은 명령 팔레트(Ctrl+K)의 replaceAcrossFiles 하나뿐이다. 팔레트 쪽은 바꿀 수 있는 문서가
  // 있을 때만 항목을 보여 주므로, 사이드바 상시 버튼은 두지 않는다.
  window.openBatchReplace = openBatchReplace;
  window.batchReplaceTargetDocs = batchReplaceTargetDocs;
}
