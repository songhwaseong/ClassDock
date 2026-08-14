/*
 * Release artifact smoke check.
 * This deliberately stays DOM/browser-free: it verifies that the generated
 * single-file build contains every executable asset and no network script URL.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const offlinePath = path.join(root, "classdock-offline.html");
const offline = fs.readFileSync(offlinePath, "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
const sha384 = (bytes) => "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
const normalizedTextBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");

function fail(message) {
  throw new Error(`Release artifact check failed: ${message}`);
}

function executableScriptSources(markup) {
  const sources = [];
  const openTag = /<script\b[^>]*>/gi;
  let cursor = 0;
  while (cursor < markup.length) {
    openTag.lastIndex = cursor;
    const open = openTag.exec(markup);
    if (!open) break;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(open[0]);
    if (src) sources.push(src[1]);
    const closeAt = markup.indexOf("</script", openTag.lastIndex);
    cursor = closeAt < 0 ? openTag.lastIndex : markup.indexOf(">", closeAt) + 1;
  }
  return sources;
}

for (const item of manifest.vendorScripts) {
  if (!item.src.startsWith("vendor/")) fail(`vendor URL must stay local: ${item.src}`);
  const bytes = fs.readFileSync(path.join(root, "vendor", item.file));
  const raw = sha384(bytes);
  const actual = raw === item.sha384 ? raw : sha384(normalizedTextBytes(bytes));
  if (actual !== item.sha384) fail(`vendor hash mismatch: ${item.file}`);
  if (item.lazy) {
    // 지연 로드본은 시작할 때 실행되지 않는 text/plain 블록으로만 들어가야 한다.
    if (source.includes(`<script src="${item.src}"></script>`)) fail(`lazy vendor is loaded at startup: ${item.src}`);
    if (!offline.includes(`data-mn-lazy="${item.file}"`)) fail(`offline lazy vendor block missing: ${item.file}`);
  } else if (!source.includes(`<script src="${item.src}"></script>`)) {
    fail(`source vendor tag missing: ${item.src}`);
  }
}

if (executableScriptSources(source).some((src) => /^https?:\/\//i.test(src))) {
  fail("source HTML still loads an executable script from the network");
}
if (executableScriptSources(offline).length) fail("offline HTML contains an external script tag");
if (/\b(?:src|href)=["'](?:src|vendor)\//i.test(offline)) fail("offline HTML still references source or vendor files");
if (!offline.includes("window.__MN_PYODIDE_WHEELS__")) fail("offline Pyodide wheel registry is missing");
if (!offline.includes('id="pdfWorkerSrc"')) fail("offline PDF worker is missing");
const expectedMusicSamples = {
  mnMusicSamples:["piano", 10], mnGuitarSamples:["guitar", 10],
  mnXylophoneSamples:["xylophone", 4], mnHarpSamples:["harp", 10],
  mnFluteSamples:["flute", 7], mnClarinetSamples:["clarinet", 8]
};
for (const [id, [label, expectedCount]] of Object.entries(expectedMusicSamples)) {
  const block = new RegExp(`<script type="application/json" id="${id}">([^<]+)<\\/script>`).exec(offline);
  if (!block) fail(`offline ${label} sample registry is missing`);
  let registry;
  try { registry = JSON.parse(block[1]); }
  catch(_) { fail(`offline ${label} sample registry is invalid JSON`); }
  const files = Object.keys(registry || {});
  if (files.length !== expectedCount) {
    fail(`offline ${label} sample count is ${files.length}, expected ${expectedCount}`);
  }
  if (files.some((file) => !/^data:audio\/mpeg;base64,/.test(registry[file]))) {
    fail(`offline ${label} sample data is missing`);
  }
}

console.log(`릴리스 산출물 검사 완료: vendor ${manifest.vendorScripts.length}개, 단일 HTML ${Math.round(fs.statSync(offlinePath).size / 1024)} KB`);
