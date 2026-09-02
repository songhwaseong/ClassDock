"use strict";
/*
 * 지연 로드(MNLazy) — 무거운 vendor 라이브러리를 "그 파일을 열 때" 처음 불러온다.
 *
 * 왜: 예전에는 vendor 18개(약 7.2MB)를 시작할 때 전부 실행했다. .txt 하나를 열어도
 *     엑셀·한글·PPT·맞춤법 사전이 함께 파싱돼, 저사양 교실 PC에서 첫 화면이 늦었다.
 *     여기 등록된 묶음은 실제로 필요한 순간(그 형식을 열 때·그 버튼을 누를 때)에만 실행한다.
 *     PDF(pdf.js·pdf-lib)는 앱의 중심 기능이라 지금도 시작할 때 함께 싣는다.
 *
 * 두 가지 모드가 있고 자동으로 판별한다.
 *  · 단일 파일(오프라인 HTML·EXE): 빌드가 라이브러리 소스를 실행되지 않는 text/plain
 *    스크립트 블록(data-mn-lazy 속성 = 파일명)으로 심어 둔다. 필요할 때 그 텍스트를
 *    실행 가능한 스크립트로 옮겨 심는다(=전역 스코프, 원래 로드 순서와 동일).
 *  · 원본 HTML(개발·서버 서빙): vendor 경로를 가리키는 스크립트를 그때 만들어 붙인다.
 *
 * 같은 파일은 두 번 실행하지 않고(dedupe), 같은 묶음을 동시에 여러 번 요청해도
 * 로드는 한 번만 일어난다(진행 중 Promise 재사용).
 */
const MNLazy = (() => {
  // 묶음 정의 — files 는 "반드시 이 순서로" 실행해야 하는 vendor 파일 목록이다.
  const BUNDLES = {
    xterm:       { label:"원격 터미널",         files:["xterm.js"] },
    spellcheck:  { label:"한국어 맞춤법 사전", files:["korean-hunspell-worker.js"] },
    jszip:       { label:"압축 읽기(JSZip)",   files:["jszip.min.js", "jszip-utils.min.js"] },
    zip:         { label:"압축 풀기",          files:["zip-full.min.js"] },
    xlsx:        { label:"엑셀 보기",          files:["xlsx.full.min.js"] },
    yaml:        { label:"YAML 읽기·쓰기",     files:["js-yaml.min.js"] },
    exceljs:     { label:"엑셀 편집·저장",     files:["exceljs.min.js"] },
    hwp:         { label:"한글(HWP) 보기",     files:["hwp.global.js"] },
    // 악보 조판(VexFlow). 음악 글꼴(Bravura)까지 담긴 배포본이라 네트워크 없이 그린다.
    vexflow:     { label:"악보 그리기",        files:["vexflow-bravura.min.js"] },
    // 지도 렌더러(Leaflet). 라이브러리 자체는 오프라인이고, 배경 타일만 인터넷에서 받는다.
    leaflet:     { label:"지도 그리기",        files:["leaflet.min.js"] },
    // SQL 정렬기(sql-formatter). DB 클라이언트 편집기에서 정렬을 누를 때만 읽는다.
    sqlFormat:   { label:"SQL 정렬",           files:["sql-formatter.min.js"] },
    officeCrypt: { label:"오피스 암호 해제",   files:["crypto-js.min.js", "office-decrypt.js"] },
    capture:     { label:"화면 캡처",          files:["html2canvas.min.js", "html-to-image.js"] },
    pptx:        { label:"PowerPoint 보기",
                   files:["jquery.min.js", "jszip.min.js", "jszip-utils.min.js", "divs2slides.min.js", "pptxjs.min.js"] },
    // docx-preview 는 JSZip 3.x(loadAsync)를 요구해 로드 시점에 전역 JSZip 을 붙잡는다.
    // 반면 PPTXjs·엑셀 복구 코드는 동기 API 의 JSZip 2.6.1 을 쓴다. 그래서 예전 HTML 은
    // "3.x 로드 → docx-preview 로드 → 2.6.1 로 되돌리기" 순서였다. 지연 로드에서도 순서가
    // 뒤바뀔 수 있으므로(예: PPT 를 먼저 연 뒤 Word 를 열기), 아래에서 그 되돌리기를 재현한다.
    docx:        { label:"Word 보기", files:["jszip3.min.js", "docx-preview.min.js"], jszipSwap:true },
    /* 전체 백업 ZIP 은 수백 MB 가 될 수 있어 2.6.1 의 동기 generate 로는 화면이 멈춘다.
       같은 3.x 소스를 써서 generateAsync·loadAsync 를 쓰고, 전역은 2.6.1 로 되돌려 놓는다. */
    jszipModern: { label:"압축 만들기(JSZip 3)", files:["jszip3.min.js"], jszipSwap:true },
    // 자바스크립트 연습 실행기는 소스를 부모 화면에서 실행하지 않고 Worker로 전달한다.
    // manifest의 지연 로드 계약에 등록하되, 실제 읽기는 source(file)를 사용한다.
    jsLodash:    { label:"JavaScript Lodash",    files:["lodash.min.js"] },
    jsDayjs:     { label:"JavaScript Day.js",    files:["dayjs.min.js"] },
    jsPapaParse: { label:"JavaScript Papa Parse", files:["papaparse.min.js"] },
    jsMath:      { label:"JavaScript Math.js",   files:["math.min.js"] }
  };

  const loadedFiles = new Map();     // 파일명 -> Promise (실행 완료)
  const loadedBundles = new Map();   // 묶음명 -> Promise
  const sourceFiles = new Map();     // 파일명 -> Promise<string> (Worker 전달용 원문)
  const JSZIP_BUNDLES = new Set(["jszip", "pptx", "docx", "jszipModern"]);
  let modernJSZip = null;            // JSZip 3.x 생성자 — 전역과 따로 보관한다
  let jszipBundleQueue = Promise.resolve();
  let inlineMode = null;             // null=미판별, true=단일 파일 모드

  function usesInlineSources(){
    if (inlineMode === null){
      inlineMode = !!(typeof document !== "undefined" && document.querySelector("script[data-mn-lazy]"));
    }
    return inlineMode;
  }

  // 단일 파일 모드: 심어 둔 text/plain 블록의 소스를 실행 가능한 <script> 로 옮겨 심는다.
  // textContent 로 넣은 스크립트는 append 시점에 동기 실행되며 전역 스코프를 쓴다.
  function runInlineSource(file){
    const holder = document.querySelector('script[data-mn-lazy="' + file + '"]');
    if (!holder) throw new Error("lazy-source-missing:" + file);
    if (!sourceFiles.has(file)) sourceFiles.set(file, Promise.resolve(holder.textContent));
    const script = document.createElement("script");
    script.textContent = holder.textContent;
    script.setAttribute("data-mn-lazy-loaded", file);
    document.head.appendChild(script);
    holder.remove();                 // 같은 소스를 두 벌 들고 있지 않게 원본 블록은 치운다
  }

  // 서버·파일 서빙 모드: 평범한 <script src> 를 붙이고 onload 를 기다린다.
  function loadVendorSrc(file){
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/" + file;
      script.setAttribute("data-mn-lazy-loaded", file);
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("lazy-load-failed:" + file));
      document.head.appendChild(script);
    });
  }

  // 실행하지 않은 원문을 돌려준다. 단일 파일에서는 text/plain 블록, 개발 서버에서는
  // vendor 파일을 읽는다. JavaScript 연습 Worker처럼 부모 전역을 오염시키면 안 되는 곳에서 쓴다.
  function source(file){
    file = String(file || "");
    if (sourceFiles.has(file)) return sourceFiles.get(file);
    let task;
    if (usesInlineSources()){
      const holder = document.querySelector('script[data-mn-lazy="' + file + '"]');
      task = holder
        ? Promise.resolve(holder.textContent)
        : Promise.reject(new Error("lazy-source-missing:" + file));
    } else {
      task = fetch("vendor/" + file, { cache:"force-cache" }).then((response) => {
        if (!response.ok) throw new Error("lazy-source-http:" + response.status);
        return response.text();
      });
    }
    const tracked = task.catch((error) => { sourceFiles.delete(file); throw error; });
    sourceFiles.set(file, tracked);
    return tracked;
  }

  function loadFile(file){
    if (loadedFiles.has(file)) return loadedFiles.get(file);
    const task = usesInlineSources()
      ? Promise.resolve().then(() => runInlineSource(file))
      : loadVendorSrc(file);
    // 실패하면 다음 시도에서 다시 받을 수 있게 기억에서 지운다(일시적 오류 회복).
    const tracked = task.catch((error) => { loadedFiles.delete(file); throw error; });
    loadedFiles.set(file, tracked);
    return tracked;
  }

  /* 3.x 소스가 방금 실행됐으면 그 생성자를 따로 보관한다.
     2.6.1 과는 정적 loadAsync 유무로 가른다(3.x 만 가진다). */
  function captureModernJSZip(){
    const candidate = typeof window !== "undefined" ? window.JSZip : undefined;
    if (!modernJSZip && typeof candidate === "function" && typeof candidate.loadAsync === "function")
      modernJSZip = candidate;
    return modernJSZip;
  }

  async function loadBundle(name){
    const bundle = BUNDLES[name];
    if (!bundle) throw new Error("unknown-lazy-bundle:" + name);
    // JSZip 2.6.1 을 쓰는 코드가 이미 있으면 그 전역을 기억해 두었다가 docx-preview 로드 뒤 되돌린다.
    const previousJSZip = bundle.jszipSwap ? (typeof window !== "undefined" ? window.JSZip : undefined) : undefined;
    for (const file of bundle.files){
      await loadFile(file);
      /* 같은 3.x 소스를 다른 묶음이 이미 실행했으면 여기서는 다시 실행되지 않아 전역이
         2.6.1 인 채로 남는다. 보관해 둔 생성자로 되살려, 뒤따르는 docx-preview 같은
         파일이 항상 3.x 를 보게 한다. */
      if (bundle.jszipSwap && captureModernJSZip()) window.JSZip = modernJSZip;
    }
    if (bundle.jszipSwap){
      if (previousJSZip) window.JSZip = previousJSZip;   // 원래 쓰던 2.6.1 복원
      else await loadFile("jszip.min.js");               // 아직 없으면 2.6.1 을 새로 싣는다
    }
  }

  /* 묶음을 (한 번만) 불러온다. 이미 준비됐으면 즉시 끝나는 Promise 를 준다.
     실패 시 reject 되므로, 부르는 쪽은 기존의 "…로드 실패" 안내로 이어가면 된다. */
  function need(name){
    if (loadedBundles.has(name)) return loadedBundles.get(name);
    // docx는 로드 중 잠시 JSZip 3.x를 전역에 두고, pptx/jszip은 2.6.1을 쓴다.
    // 서로 다른 묶음을 동시에 요청해도 전역 교체가 겹치지 않도록 이 세 묶음만 직렬화한다.
    const raw = JSZIP_BUNDLES.has(name)
      ? jszipBundleQueue.then(() => loadBundle(name), () => loadBundle(name))
      : loadBundle(name);
    if (JSZIP_BUNDLES.has(name)) jszipBundleQueue = raw.catch(() => {});
    const task = raw.catch((error) => {
      loadedBundles.delete(name);
      console.warn("지연 로드 실패:", name, error);
      throw error;
    });
    loadedBundles.set(name, task);
    return task;
  }

  /* 실패해도 조용히 넘어가는 형태 — 있으면 좋고 없으면 건너뛰는 보조 기능용.
     성공 여부를 boolean 으로 돌려준다. */
  function tryNeed(name){
    return need(name).then(() => true, () => false);
  }

  const isLoaded = (name) => loadedBundles.has(name);
  const bundleLabel = (name) => (BUNDLES[name] && BUNDLES[name].label) || name;

  /* 전역 JSZip(2.6.1) 을 건드리지 않고 3.x 생성자만 받아 간다. need("jszipModern") 뒤에 부른다. */
  const modernZip = () => modernJSZip;

  return { need, tryNeed, source, isLoaded, bundleLabel, modernZip, BUNDLES };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNLazy;
