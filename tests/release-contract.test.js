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

test("배포 라이브러리는 로컬 고정본과 SHA-384 무결성 값을 사용한다", () => {
  assert.ok(manifest.vendorScripts.length > 0);
  for (const item of manifest.vendorScripts) {
    assert.match(item.src, /^vendor\//);
    assert.match(item.sha384, /^sha384-[A-Za-z0-9+/]+={0,2}$/);
    const bytes = fs.readFileSync(path.join(root, "vendor", item.file));
    const raw = sha384(bytes);
    const actual = raw === item.sha384 ? raw : sha384(normalizedTextBytes(bytes));
    assert.equal(actual, item.sha384, item.file);
    assert.ok(html.includes(`<script src="${item.src}"></script>`), item.src);
  }
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i);
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
