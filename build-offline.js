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
  "src/assets/moss-golem-sprites.png",
  "src/assets/sky-island-clouds-sprite.png"
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

// 실제 악기 샘플은 앱 시작 때 JavaScript 로 파싱하지 않는다. 악기별로 분리한
// 실행되지 않는 JSON 블록에 MP3 데이터 URL로 넣고, 해당 음색을 처음 재생할 때만 읽는다.
const musicSampleSets = [
  { id:"mnMusicSamples", label:"Piano", dir:"piano", files:[
    ["Gs3.mp3", "f82a08ce29f7fc2a1bfd2ffcb6846956f5cb1fbde1d6480e8f11912f120140de"],
    ["C4.mp3", "a265c8cfd4140cf27b55054b4953b6c691fce3523530ca8ae0faed5e4cd39063"],
    ["Ds4.mp3", "981383275cc1021b425f5c3e4fab8e9ee4385e4023e82993e04140ad325d0f08"],
    ["Fs4.mp3", "0b23feb9c67e409aa18b7bd2b1897f198e5914121a709e4dfd9996af4f0a15b4"],
    ["A4.mp3", "a3b829eb92b37fd1174227bc83757f3a62bc3f9efbaf79503e83447c52338d44"],
    ["C5.mp3", "54a9304d2c609328580c0e06a394670559fe5f594f643d5d12c6dae158051b4a"],
    ["Ds5.mp3", "30f6a5ba2494603fb7c1cbb43c50769858f252a1a2111e1bd8c02d358513e2cd"],
    ["Fs5.mp3", "2ed25faa160029fcd28071ffa98f9504588511b2cb2179f74d7da00284f1bc33"],
    ["A5.mp3", "d121012517f4985f66a72eb3947a9f5de3d7489260c6deb97022191d23670212"],
    ["C6.mp3", "c3c9ee316e7b98a07d89be2340c2382aa689826b50db9080dab7f6e23ebc3d7c"]
  ]},
  { id:"mnGuitarSamples", label:"Guitar", dir:"guitar-nylon", files:[
    ["G3.mp3", "85cbc7aeb84956c5b30333d73fedb57f1c393d04302684566ca77523015a6449"],
    ["A3.mp3", "a4b25e648ce07f79ecb0c00f8a788add2a77e19163cd656ca48e10713854a5ea"],
    ["Cs4.mp3", "a4cc76204d938edb2190d70a16d916bdbc1db12ec751fe9b5f1edb38dd0e0527"],
    ["E4.mp3", "3f95d206021f8935d79da1f1b5bffe45c17f8dbfb598148e6a3ac4999cb0fa0b"],
    ["Gs4.mp3", "3310492adef184214d85d87e4d30ace28c6f5274a5883fb85db4bb730135dd4c"],
    ["B4.mp3", "74cbac2107e258ff27198e87081a76677ca8820e0b257db004eb979429f47469"],
    ["D5.mp3", "b14bda1a35b55008042de4d1443f8dc585fd990133b07d81d233dfe9f6f29570"],
    ["Fs5.mp3", "259a7b727dce9d31e12316dff887148360de02aec774ea999d47bd399388f0fe"],
    ["Gs5.mp3", "3714d1e2cd35be502a8b522db02207031b37d1495c6608548c31f1402532db3a"],
    ["As5.mp3", "8b58374042aa47d7aef055afca8492a0e25faeecee9ac44fb098afff53e6cb97"]
  ]},
  { id:"mnXylophoneSamples", label:"Xylophone", dir:"xylophone", files:[
    ["G4.mp3", "a5a0122e3111e4ac803d529d11bcff7f0655a76946ad3892af9f57a42310a799"],
    ["C5.mp3", "84e3a114c88d5735e6d0fc26dc141283947c5b2cc791ac36c33782d747e37a0a"],
    ["G5.mp3", "427bc39ed57eeeb0266195dc6dd5b3e5efe713c9cc29634e063aaceab05a176f"],
    ["C6.mp3", "8a4e5edc7e0ba9087ef8d67d9f5e2e513a4c8350cd0939e06b0e0d5eea9c6adb"]
  ]},
  { id:"mnHarpSamples", label:"Harp", dir:"harp", files:[
    ["G3.mp3", "058a84eeeba662f23659b49845adeccdac15cbb08698850df73092c9ceead7c0"],
    ["B3.mp3", "461bc54638be6b620a069a3141d1029efa068ccf288e44776a5fd727ce1316a3"],
    ["D4.mp3", "fbda23ff27080f0cca562b3703bfe00be1040cff5cc326e96fdb202b4ea5b478"],
    ["F4.mp3", "4e0486faf6e52b98ad1dcd123be9a2c177e9633c1376b538be449805c27a3281"],
    ["A4.mp3", "6ea5048f4d224e972d1b21bc725b597693a94cd48502878accbceb283133819d"],
    ["C5.mp3", "d585ef5b9571dc16a6d28735e6166c010d663ab6c2f6f43b8d926ccb0a1cbf73"],
    ["E5.mp3", "f5cdaded4adda5cf9fa97266aea110779d39262561327eeb39c7ded14d9ce14c"],
    ["G5.mp3", "41ae47b853334d7106cad1bc0fc2de538b366ef0af0d6d6efd6871a4f0752a4e"],
    ["B5.mp3", "aa36e1ac8e99dc5b1c1c0b50712aa81f6531aec9d01290962ea81f415ec9d767"],
    ["D6.mp3", "bac35c74e22e2feba5a5fa60716eb7c9e26d7033d0912c665409994b216c95df"]
  ]},
  { id:"mnFluteSamples", label:"Flute", dir:"flute", files:[
    ["C4.mp3", "d6837b9e7c524e7b733a11530d930316d85a91cd80dbba38a497047624bb63e3"],
    ["E4.mp3", "39fa9c7004bc2d168c98839475cc52448abdfb43486a11cf076b72dfcfa2b1d3"],
    ["A4.mp3", "615376784bd2a716baa8c7b1c57a3d55048a62cf89b313ed005d85da06a1d918"],
    ["C5.mp3", "1b6ec4d5bf2caeca80da4c53f6d9f09eb3a49e8de04588965c55ca8f00ff296d"],
    ["E5.mp3", "2d024d4cd56412bcb8cc3ecbce0736b63c9ba1d77de2e9601ba4efeda559a157"],
    ["A5.mp3", "0735eccfb744176f253d1f715f7a70cf045694cce1da99d934e52a3a3544f968"],
    ["C6.mp3", "535d1fbfaddbdb7f91c415708470f0860669c08733823212e81e98909afc9a64"]
  ]},
  { id:"mnClarinetSamples", label:"Clarinet", dir:"clarinet", files:[
    ["As3.mp3", "b29cc9c737fa527584a12000f641e78411073de8b060ef85c269b0ee6660bf23"],
    ["D4.mp3", "7ab866a30e53b96cf8950afdd1fedff84118a0c4e9a5a6756ef44f1b4f10b475"],
    ["F4.mp3", "2bdcbd7ad94ee0610e7253c3c116f6394370aa841f9406eef18d1b25e6559aee"],
    ["As4.mp3", "ee3601b3fa5b52a6214fc9d4155e282c538643d0177523fa02487c7139c9d3ed"],
    ["D5.mp3", "47e56dfdd2b9979cbbd3e544489fe202a0fd7f02b48a587fe9ef4fc7b5cd97d0"],
    ["F5.mp3", "115274abef1a73b7bfc218404abac42afca48a23b7a6185e72c5afbd079edb6f"],
    ["As5.mp3", "bcfa65db95a0f3535678ef6c39ff0401d6955451e72d0bd925372a9fc8d6b7eb"],
    ["D6.mp3", "a4fe4fac1ca70abb153e38873b25a268fde68d589601fec4b5cdfa1fc4a7cf5f"]
  ]}
];
for (const set of musicSampleSets) {
  set.map = {};
  for (const [file, expectedHash] of set.files) {
    const relative = `src/assets/${set.dir}/${file}`;
    const fullPath = path.join(root, relative);
    if (!fs.existsSync(fullPath)) {
      console.error(`${set.label} sample not found:`, relative);
      process.exit(1);
    }
    const bytes = fs.readFileSync(fullPath);
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      console.error(`${set.label} sample SHA-256 mismatch:`, relative);
      process.exit(1);
    }
    set.map[file] = "data:audio/mpeg;base64," + bytes.toString("base64");
  }
}
const musicSamplesPlaceholder = "<!--MN_MUSIC_SAMPLES-->";
requireTag(html, musicSamplesPlaceholder, "Music sample placeholder");
html = html.replace(
  musicSamplesPlaceholder,
  () => musicSampleSets.map((set) =>
    `<script type="application/json" id="${set.id}">${esc(JSON.stringify(set.map))}</script>`
  ).join("\n")
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
