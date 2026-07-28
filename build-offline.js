/*
 * Builds the single-file offline HTML.
 * - Inlines local CSS and application scripts.
 * - Replaces known CDN/vendor script tags with bundled vendor files.
 * - Embeds pdf.worker as a text/js-worker script block for runtime Blob use.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read("scripts.manifest.json"));
const esc = (code) => code.replace(/<\/script/gi, "<\\/script");
const sha384 = (bytes) => "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
const normalizedTextBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");

function requireTag(source, tag, label) {
  if (!source.includes(tag)) {
    console.error(`${label} tag not found:`, tag);
    process.exit(1);
  }
}

function verifyVendorIntegrity(item) {
  if (!item.sha384 || !/^sha384-[A-Za-z0-9+/]+={0,2}$/.test(item.sha384)) {
    throw new Error(`Vendor SHA-384 is missing or invalid: ${item.file}`);
  }
  const bytes = fs.readFileSync(path.join(root, "vendor", item.file));
  const raw = sha384(bytes);
  const actual = raw === item.sha384 ? raw : sha384(normalizedTextBytes(bytes));
  if (actual !== item.sha384) {
    throw new Error(`Vendor SHA-384 mismatch: ${item.file}`);
  }
}

let html = read("manneung-classroom.html");

const localStyleTag = `<link rel="stylesheet" href="${manifest.styles.local}">`;
requireTag(html, localStyleTag, "Local stylesheet");
html = html.replace(localStyleTag, () => `<style>\n${read(manifest.styles.local)}\n</style>`);

// Wheels bundled for Pyodide's offline micropip path.
const bundledPyodideWheels = [
  {
    importName: "faker",
    packageName: "Faker",
    file: "vendor/wheels/faker-40.23.0-py3-none-any.whl",
    sha256: "775922453e54afa42eaf60eac478fa3a969357f224d09a8022b93e3ad88f18ae"
  }
];
const bundledWheelRegistry = {};
for (const wheel of bundledPyodideWheels) {
  const fullPath = path.join(root, wheel.file);
  if (!fs.existsSync(fullPath)) {
    console.error("Bundled Pyodide wheel not found:", wheel.file);
    process.exit(1);
  }
  const bytes = fs.readFileSync(fullPath);
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== wheel.sha256) {
    console.error("Bundled Pyodide wheel hash mismatch:", wheel.file);
    process.exit(1);
  }
  bundledWheelRegistry[wheel.importName] = {
    packageName: wheel.packageName,
    fileName: path.basename(wheel.file),
    base64: bytes.toString("base64")
  };
}

const coreScriptTag = '<script src="src/js/core.js"></script>';
requireTag(html, coreScriptTag, "Core script");
html = html.replace(
  coreScriptTag,
  () => `<script>window.__MN_PYODIDE_WHEELS__=${JSON.stringify(bundledWheelRegistry)};</script>\n${coreScriptTag}`
);

for (const file of manifest.localScripts) {
  const tag = `<script src="src/js/${file}"></script>`;
  requireTag(html, tag, "Local script");
  html = html.replace(tag, () => `<script>\n${esc(read("src/js/" + file))}\n</script>`);
}

// 이미지 기반 픽셀펫 스프라이트도 단일 HTML 안에 포함해 EXE에서 외부 파일 없이 보이게 한다.
// 예전에는 데이터 URL 을 pet-data.js 문자열에 직접 박아 넣어, 펫을 끈 사용자도 약 1.7MB 를
// JavaScript 로 함께 파싱했다. 이제는 실행되지 않는 JSON 블록에 경로→데이터URL 표로 두고,
// pet.js 가 실제로 펫을 만들 때 한 번만 읽는다(기본값은 펫 꺼짐이라 대개 읽히지 않는다).
const petSpriteRelatives = [
  "src/assets/pixel-teacher.png",
  "src/assets/blue-buddy-sprites.png",
  "src/assets/fluffy-cat-sprites-v2.png",
  "src/assets/calico-cat-sprites.png",
  "src/assets/moss-golem-sprites.png"
];
const petSpriteMap = {};
for (const petSpriteRelative of petSpriteRelatives) {
  const petSpritePath = path.join(root, petSpriteRelative);
  if (!fs.existsSync(petSpritePath)) {
    console.error("Pixel pet sprite not found:", petSpriteRelative);
    process.exit(1);
  }
  petSpriteMap[petSpriteRelative] = "data:image/png;base64," + fs.readFileSync(petSpritePath).toString("base64");
}
const petSpritePlaceholder = "<!--MN_PET_SPRITES-->";
requireTag(html, petSpritePlaceholder, "Pet sprite placeholder");
html = html.replace(
  petSpritePlaceholder,
  () => `<script type="application/json" id="mnPetSprites">${esc(JSON.stringify(petSpriteMap))}</script>`
);

// 시작할 때 실행하는 vendor 는 원래 자리에 그대로 인라인한다.
for (const item of manifest.vendorScripts.filter((item) => !item.lazy)) {
  verifyVendorIntegrity(item);
  const tag = `<script src="${item.src}"></script>`;
  requireTag(html, tag, "Vendor script");
  let inline = `<script>\n${esc(read("vendor/" + item.file))}\n</script>`;
  if (item.worker) {
    inline += `\n<script id="pdfWorkerSrc" type="text/js-worker">\n${esc(read("vendor/" + item.worker))}\n</script>`;
  }
  html = html.replace(tag, () => inline);
}

// 지연 로드 vendor 는 실행되지 않는 text/plain 블록으로 심는다. 브라우저는 이 블록을
// JavaScript 로 파싱·컴파일하지 않으므로 시작 비용에서 빠지고, MNLazy 가 필요한 순간에
// 텍스트를 실행 가능한 script 로 옮겨 심는다(원래 로드 순서는 MNLazy 의 묶음 정의가 보존).
const lazyVendorPlaceholder = "<!--MN_LAZY_VENDOR-->";
requireTag(html, lazyVendorPlaceholder, "Lazy vendor placeholder");
const lazyVendorBlocks = manifest.vendorScripts
  .filter((item) => item.lazy)
  .map((item) => {
    verifyVendorIntegrity(item);
    return `<script type="text/plain" data-mn-lazy="${item.file}">\n${esc(read("vendor/" + item.file))}\n</script>`;
  })
  .join("\n");
html = html.replace(lazyVendorPlaceholder, () => lazyVendorBlocks);

const pptxCssTag = `<link rel="stylesheet" href="${manifest.styles.pptx.src}">`;
if (html.includes(pptxCssTag)) {
  html = html.replace(pptxCssTag, () => `<style>\n${read("vendor/" + manifest.styles.pptx.file)}\n</style>`);
}

html = html.replace(
  "모든 처리는 이 브라우저 안에서만 이뤄집니다. 파일은 외부로 전송되지 않아요.",
  "인터넷 없이 동작합니다. 모든 처리는 이 브라우저 안에서만 이뤄지며 파일은 외부로 전송되지 않아요."
);

// 자세한 사용법(사용법.html)도 단일 파일 안에 넣는다. 배포 zip 에는 exe 만 들어가서, 예전에는
// 이 문서가 사실상 아무에게도 닿지 않았다. 실행되지 않는 블록이라 시작 비용은 생기지 않고,
// 도움말에서 열 때 Blob 으로 새 탭에 띄운다(openUserManual).
const manualPlaceholder = "<!--MN_MANUAL-->";
requireTag(html, manualPlaceholder, "User manual placeholder");
html = html.replace(
  manualPlaceholder,
  () => `<script type="text/plain" data-mn-manual="사용법.html">\n${esc(read("사용법.html"))}\n</script>`
);

const out = "manneung-classroom-offline.html";
if (/\b(?:src|href)=["']src\//.test(html)) {
  console.error("Offline output still contains local source references.");
  process.exit(1);
}
fs.writeFileSync(path.join(root, out), html, "utf8");
const kb = Math.round(fs.statSync(path.join(root, out)).size / 1024);
console.log(`생성 완료: ${out} (${kb} KB)`);
