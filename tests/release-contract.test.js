const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
const sha384 = (bytes) => "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
const normalizedTextBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const jsGuide = fs.readFileSync(path.join(root, "docs", "JS-파일별-기능.md"), "utf8");
const documentsSource = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
const paletteSource = fs.readFileSync(path.join(root, "src/js/command-palette.js"), "utf8");

test("배포 라이브러리는 로컬 고정본과 SHA-384 무결성 값을 사용한다", () => {
  assert.ok(manifest.vendorScripts.length > 0);
  for (const item of manifest.vendorScripts) {
    assert.match(item.src, /^vendor\//);
    assert.match(item.sha384, /^sha384-[A-Za-z0-9+/]+={0,2}$/);
    const bytes = fs.readFileSync(path.join(root, "vendor", item.file));
    const raw = sha384(bytes);
    const actual = raw === item.sha384 ? raw : sha384(normalizedTextBytes(bytes));
    assert.equal(actual, item.sha384, item.file);
    // 지연 로드 대상은 시작할 때 실행하지 않는다(태그 없음). 나머지는 원래대로 시작 시 로드.
    if (item.lazy) assert.ok(!html.includes(`<script src="${item.src}"></script>`), `lazy: ${item.src}`);
    else assert.ok(html.includes(`<script src="${item.src}"></script>`), item.src);
  }
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i);
});

test("무거운 vendor 는 지연 로드 묶음(MNLazy)에 정확히 한 번씩 등록한다", () => {
  const bundles = require("../src/js/lazy.js").BUNDLES;
  const declared = manifest.vendorScripts.filter((item) => item.lazy);
  assert.ok(declared.length > 0);
  for (const item of declared) {
    assert.ok(bundles[item.lazy], `${item.file}: 알 수 없는 묶음 ${item.lazy}`);
    assert.ok(bundles[item.lazy].files.includes(item.file), `${item.file}: 선언한 묶음에 없음`);
  }
  const bundledFiles = Object.values(bundles).flatMap((bundle) => bundle.files);
  const lazyFiles = new Set(declared.map((item) => item.file));
  for (const file of new Set(bundledFiles)) assert.ok(lazyFiles.has(file), `묶음에만 있는 파일: ${file}`);
  // 시작 비용의 대부분을 차지하던 라이브러리가 다시 즉시 로드로 돌아가지 않게 고정한다.
  for (const file of ["korean-hunspell-worker.js", "xlsx.full.min.js", "exceljs.min.js", "hwp.global.js"]) {
    assert.ok(lazyFiles.has(file), `지연 로드 유지: ${file}`);
  }
  assert.match(html, /<!--MN_LAZY_VENDOR-->/);
});

test("전역 스크립트 로딩은 레이어와 선행 의존성 계약으로 고정한다", () => {
  const layered = manifest.applicationLayers.flatMap((layer) => layer.scripts);
  assert.deepEqual(layered, manifest.localScripts);
  const order = new Map(manifest.localScripts.map((name, index) => [name, index]));
  for (const [script, dependencies] of Object.entries(manifest.scriptDependencies)) {
    assert.ok(order.has(script), script);
    for (const dependency of dependencies) {
      assert.ok(order.has(dependency), dependency);
      assert.ok(order.get(dependency) < order.get(script), `${dependency} -> ${script}`);
    }
  }
});

test("전역 유틸리티의 모듈 경계와 공개 API 소비 순서를 고정한다", () => {
  for (const boundary of manifest.moduleBoundaries) {
    const source = fs.readFileSync(path.join(root, "src/js", boundary.file), "utf8");
    assert.match(source, new RegExp(`\\bconst\\s+${boundary.publicApi}\\b`));
    for (const consumer of boundary.consumers) {
      const consumerSource = fs.readFileSync(path.join(root, "src/js", consumer), "utf8");
      assert.match(consumerSource, new RegExp(`\\b${boundary.publicApi}\\b`));
      assert.ok(manifest.localScripts.indexOf(boundary.file) < manifest.localScripts.indexOf(consumer));
    }
  }
});

test("앱 JavaScript 파일은 manifest와 기능 안내 문서에 빠짐없이 등록한다", () => {
  const files = fs.readdirSync(path.join(root, "src", "js"))
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.deepEqual([...manifest.localScripts].sort(), files);
  for (const name of manifest.localScripts) {
    assert.ok(jsGuide.includes("`" + name + "`"), `docs/JS-파일별-기능.md: ${name}`);
  }
});

test("저장 위치·영구 삭제·다중 닫기의 회귀 계약을 지킨다", () => {
  assert.match(documentsSource, /workspaceBackendStatus\(\) === true/);
  assert.doesNotMatch(documentsSource, /viaServer\s*=\s*[^;\n]*workspaceBackendAvailable\(\)/);
  assert.match(documentsSource, /doc\.kind === "pdf" && doc\.originalSaveMode/);
  assert.match(documentsSource, /viaServer = doc\.kind !== "pdf"/);
  assert.match(documentsSource, /closeDoc\(doc\.id, \{ forgetWorkspace:true, skipConfirm:true \}\)/);
  assert.match(documentsSource, /function closeDoc[\s\S]*return true;/);
  assert.match(appSource, /if \(closeDoc\(id, \{ forgetWorkspace: true \}\) === true\) closed\+\+/);
  assert.match(appSource, /const cancelled = ids\.length - closed/);
});

test("명령 팔레트의 표 찾기와 사용법 새 탭 열기는 실제 성공 여부를 정확히 판정한다", () => {
  assert.ok(paletteSource.includes('clickBtn(".xlsx-tool-menu-find > summary")'));
  assert.match(appSource, /window\.open\(url, "_blank"\)/);
  assert.doesNotMatch(appSource, /window\.open\(url, "_blank", "noopener"\)/);
  assert.match(appSource, /opened\.opener = null/);
});

test("README와 사용법 문서는 최신 폴더 드롭·통합 자동 저장 동작을 설명한다", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const guideMd = fs.readFileSync(path.join(root, "사용법.md"), "utf8");
  const guideHtml = fs.readFileSync(path.join(root, "사용법.html"), "utf8");
  for (const guide of [readme, guideMd, guideHtml]) {
    assert.match(guide, /Chrome·Edge/);
    assert.match(guide, /원본 저장/);
  }
  assert.doesNotMatch(guideMd, /폴더를 화면으로 드래그.*원본 쓰기 권한을 받을 수 없습니다/);
  assert.doesNotMatch(guideHtml, /폴더를 화면으로 드래그[\s\S]{0,120}원본 쓰기 권한을 받을 수 없습니다/);
  assert.match(readme, /텍스트 기반 편집본 자동 복구·파일 자동 저장/);
});
