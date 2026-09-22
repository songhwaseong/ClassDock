/*
 * 오픈소스 라이선스 고지(THIRD_PARTY_NOTICES.txt) 생성기.
 *
 * 앱에 들어가는 라이브러리·글꼴·음원·데이터는 전부 exe 하나에 인라인되므로, 그 라이선스 전문과
 * 저작자 표시도 배포본에 함께 실어야 한다(MIT·BSD·Apache·MPL·OFL·CC BY 공통 조건).
 * 원본은 vendor/licenses/*.txt 와 src/assets/<악기>/ATTRIBUTION.md 이고 이 파일은 생성물이다.
 *   · 배포 zip 에는 pack.ps1 이 이 파일을 그대로 복사한다.
 *   · 앱 안에서는 도움말 → "오픈소스 라이선스" 가 연다(build-offline.js 가 단일 파일에 심는다).
 *
 *   node tools/build-third-party-notices.mjs           # 생성
 *   node tools/build-third-party-notices.mjs --check   # 생성 결과와 다르면 실패(동기화 검사)
 *
 * 새 vendor 를 넣으면 아래 COMPONENTS 에 한 줄 더하고 vendor/licenses 에 전문을 둘 것.
 * vendor/licenses 에 있는데 목록에 없는 파일이 있으면 생성이 실패한다(빠뜨림 방지).
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const TARGET = path.join(root, "THIRD_PARTY_NOTICES.txt");
const LICENSE_DIR = path.join(root, "vendor", "licenses");

// [이름, 버전, 라이선스, 주소, 쓰는 곳, vendor/licenses 파일(없으면 null)]
const COMPONENTS = [
  ["PDF.js", "3.11.174", "Apache-2.0", "https://github.com/mozilla/pdf.js", "PDF 보기", "pdfjs-3.11.174.txt"],
  ["pdf-lib", "1.x", "MIT", "https://github.com/Hopding/pdf-lib", "PDF 편집·저장", "pdf-lib.txt"],
  ["SheetJS Community Edition (xlsx)", "0.18.5", "Apache-2.0", "https://sheetjs.com", "엑셀 보기", "sheetjs-0.18.5.txt"],
  ["ExcelJS", "4.x", "MIT", "https://github.com/exceljs/exceljs", "엑셀 편집·저장", "exceljs-4.txt"],
  ["docx-preview (docxjs)", "", "Apache-2.0", "https://github.com/VolodymyrBaydalka/docxjs", "Word 보기", "docx-preview.txt"],
  ["hwp.js", "0.0.3", "Apache-2.0", "https://github.com/hahnlee/hwp.js", "한글(HWP) 보기", "hwp.js-0.0.3.txt"],
  ["PPTXjs", "1.21.1", "MIT", "https://github.com/meshesha/PPTXjs", "PowerPoint 보기", "pptxjs-1.21.1.txt"],
  ["divs2slides", "1.3.2", "MIT", "https://github.com/meshesha/divs2slides", "PowerPoint 보기", "divs2slides-1.3.2.txt"],
  ["jQuery", "3.7.1", "MIT", "https://jquery.com", "PowerPoint 보기", "jquery-3.7.1.txt"],
  ["JSZip", "2.6.1 · 3.10.1", "MIT (MIT/GPLv3 중 MIT 선택)", "https://github.com/Stuk/jszip", "압축 읽기·쓰기", "jszip-2-and-3.10.1.txt"],
  ["JSZipUtils", "", "MIT (MIT/GPLv3 중 MIT 선택)", "https://github.com/Stuk/jszip-utils", "압축 읽기", "jszip-utils.txt"],
  ["zip.js", "", "BSD-3-Clause", "https://github.com/gildas-lormeau/zip.js", "압축 풀기", "zipjs.txt"],
  ["crypto-js", "4.x", "MIT", "https://github.com/brix/crypto-js", "오피스 암호 해제", "crypto-js-4.txt"],
  ["html2canvas", "1.4.1", "MIT", "https://github.com/niklasvh/html2canvas", "화면 캡처", "html2canvas-1.4.1.txt"],
  ["html-to-image", "1.11.13", "MIT", "https://github.com/bubkoo/html-to-image", "화면 캡처", "html-to-image-1.11.13.txt"],
  ["js-yaml", "4.1.0", "MIT", "https://github.com/nodeca/js-yaml", "YAML 읽기·쓰기", "js-yaml-4.1.0.txt"],
  ["Leaflet", "1.9.4", "BSD-2-Clause", "https://leafletjs.com", "지도", "leaflet-1.9.4.txt"],
  ["VexFlow", "5.0.0", "MIT", "https://github.com/vexflow/vexflow", "악보 그리기", "vexflow-5.0.0.txt"],
  ["Bravura (VexFlow 에 포함된 악보 글꼴)", "", "SIL OFL 1.1", "https://github.com/steinbergmedia/bravura", "악보 그리기", "bravura-OFL.txt"],
  ["xterm.js", "6.0.0", "MIT", "https://github.com/xtermjs/xterm.js", "원격 터미널", "xterm-6.0.0.txt"],
  ["sql-formatter", "15.8.2", "MIT", "https://github.com/sql-formatter-org/sql-formatter", "SQL 정렬", "sql-formatter-15.8.2.txt"],
  ["Lodash", "4.17.21", "MIT", "https://lodash.com", "자바스크립트 연습 실행기", "lodash-4.17.21.txt"],
  ["Day.js", "1.11.13", "MIT", "https://day.js.org", "자바스크립트 연습 실행기", "dayjs-1.11.13.txt"],
  ["Papa Parse", "5.4.1", "MIT", "https://www.papaparse.com", "자바스크립트 연습 실행기", "papaparse-5.4.1.txt"],
  ["Math.js", "14.0.1", "Apache-2.0", "https://mathjs.org", "자바스크립트 연습 실행기", "mathjs-14.0.1.txt"],
  ["Math.js 브라우저 번들에 포함된 구성 요소", "14.0.1", "여러 라이선스", "https://mathjs.org", "자바스크립트 연습 실행기", "mathjs-browser-14.0.1.txt"],
  ["Pyodide", "0.27.7", "MPL-2.0", "https://pyodide.org", "파이썬 실행", "pyodide-0.27.7.txt"],
  ["Python (CPython 표준 라이브러리, Pyodide 에 포함)", "3.12", "PSF License", "https://www.python.org", "파이썬 실행", "cpython-PSF.txt"],
  ["Faker (파이썬 휠)", "40.23.0", "MIT", "https://github.com/joke2k/faker", "DB 예제 데이터", "faker-40.23.0.txt"],
  ["PyMySQL (파이썬 휠)", "1.2.0", "MIT", "https://github.com/PyMySQL/PyMySQL", "DB 접속", "pymysql-1.2.0.txt"],
  ["hunspell-wasm", "0.3.0", "MPL-1.1", "https://github.com/rotemdan/hunspell-wasm", "한국어 맞춤법 검사", "@spell:hunspellWasmMpl11"],
  ["hunspell-dict-ko (한국어 맞춤법 사전)", "0.6.1", "MPL-1.1 · 데이터 CC BY 4.0", "https://github.com/spellcheck-ko/hunspell-dict-ko", "한국어 맞춤법 검사", "@spell:koreanDictionaryNotice"],
  ["나눔고딕 (NanumGothic)", "", "SIL OFL 1.1", "https://github.com/google/fonts/tree/main/ofl/nanumgothic", "파이썬 그래프 한글", "nanumgothic-OFL.txt"],
  ["나눔손글씨 펜·붓", "", "SIL OFL 1.1", "https://hangeul.naver.com", "일기장 손글씨", "nanum-handwriting-OFL.txt"],
  ["나눔손글씨 모음 (CLOVA) 다섯 벌", "", "SIL OFL 1.1", "https://clova.ai/handwriting", "일기장 손글씨", "nanum-clova-handwriting-OFL.txt"],
  ["행정구역 경계 (통계청 SGIS · vuski/admdongkor 가공)", "2026-07-01", "공공누리 제1유형 · CC BY 4.0", "https://github.com/vuski/admdongkor", "색칠 지도", "admdongkor-20260701.txt"],
  ["FFmpeg (ffmpeg.exe 가 함께 있을 때만)", "", "GPL-3.0", "https://ffmpeg.org", "영상 변환", "ffmpeg-GPLv3.txt"]
];

// 악기 음원 — 폴더마다 ATTRIBUTION.md 가 원본이다.
const SOUND_DIRS = ["piano", "guitar-nylon", "xylophone", "harp", "flute", "clarinet"];

const FFMPEG_NOTE = [
  "ClassDock 은 FFmpeg 을 직접 고치거나 앱 안에 넣지 않습니다. 영상 변환을 처음 쓸 때 gyan.dev 의",
  "공식 Windows 빌드(ffmpeg-release-essentials)를 받아 exe 옆에 두고 별도 프로그램으로 실행합니다.",
  "배포 zip 에 ffmpeg.exe 가 함께 들어 있다면 그 파일은 GPL-3.0 으로 배포되며, 소스 코드는",
  "https://ffmpeg.org/download.html 과 https://www.gyan.dev/ffmpeg/builds/ 에서 받을 수 있습니다."
].join("\n");

const OTHER_NOTES = [
  "■ 함께 쓰지만 이 파일에 전문을 싣지 않는 것",
  "",
  "· JDK(자바 실행·채점): Eclipse Temurin(Adoptium), GPL-2.0 with Classpath Exception.",
  "  배포 zip 에 넣을 때는 JDK 압축본을 통째로 담으므로 라이선스 전문이 jdk\\<버전>\\legal 폴더에 들어 있습니다.",
  "· 앱 안에서 사용자가 받는 자바 라이브러리(jar)·파이썬 패키지는 각 배포처의 라이선스를 따릅니다.",
  "· 지도 배경 타일·지도 데이터: © OpenStreetMap 기여자(ODbL), © OpenTopoMap(CC BY-SA), © CARTO, © Esri 등.",
  "  지도 화면 오른쪽 아래에 출처가 표시되며, 타일은 각 제공자의 이용 정책에 따라 인터넷에서 받습니다.",
  "· 악보 라이브러리의 곡: OpenScore Lieder(CC0 1.0), https://fourscoreandmore.org/openscore/lieder/"
].join("\n");

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

const normalize = (text) => text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();

let spellLicenses = null;
function readSpellLicense(key){
  if (!spellLicenses){
    const source = fs.readFileSync(path.join(root, "vendor", "korean-hunspell-worker.js"), "utf8");
    const start = source.indexOf("window.__MN_KOREAN_SPELL_LICENSES__=");
    if (start < 0) throw new Error("korean-hunspell-worker.js 에서 라이선스 표를 찾지 못했습니다.");
    const jsonStart = source.indexOf("{", start);
    // 값이 모두 JSON 문자열이라 첫 번째 '};' 가 아니라 JSON.parse 가 받아 주는 끝을 찾는다.
    for (let end = source.indexOf("}", jsonStart); end > 0; end = source.indexOf("}", end + 1)){
      try { spellLicenses = JSON.parse(source.slice(jsonStart, end + 1)); break; } catch(_){ /* 더 뒤의 '}' */ }
    }
    if (!spellLicenses) throw new Error("맞춤법 라이선스 표를 읽지 못했습니다.");
  }
  const text = spellLicenses[key];
  if (!text) throw new Error(`맞춤법 라이선스 항목이 없습니다: ${key}`);
  return text;
}

function readLicense(file){
  if (file.startsWith("@spell:")) return normalize(readSpellLicense(file.slice(7)));
  return normalize(fs.readFileSync(path.join(LICENSE_DIR, file), "utf8"));
}

function build(){
  const listed = new Set(COMPONENTS.map((c) => c[5]).filter((f) => f && !f.startsWith("@")));
  const onDisk = fs.readdirSync(LICENSE_DIR).filter((f) => f.endsWith(".txt"));
  const missing = [...listed].filter((f) => !onDisk.includes(f));
  const unlisted = onDisk.filter((f) => !listed.has(f));
  if (missing.length) throw new Error("vendor/licenses 에 없는 파일: " + missing.join(", "));
  if (unlisted.length) throw new Error("COMPONENTS 에 등록되지 않은 라이선스 파일: " + unlisted.join(", "));

  const out = [];
  out.push("ClassDock — 오픈소스 라이선스 고지 (Third-party notices)");
  out.push("");
  out.push("ClassDock 에는 아래의 오픈소스 소프트웨어·글꼴·음원·데이터가 포함되어 있습니다.");
  out.push("각 구성 요소의 저작권은 해당 저작자에게 있으며, 아래 라이선스 조건에 따라 사용합니다.");
  out.push("이 파일은 tools/build-third-party-notices.mjs 가 만듭니다. 직접 고치지 마세요.");
  out.push("");
  out.push(RULE);
  out.push("목록");
  out.push(RULE);
  for (const [name, version, license, , usedFor] of COMPONENTS){
    out.push(`· ${name}${version ? " " + version : ""} — ${license} (${usedFor})`);
  }
  out.push(`· 악기 음원 ${SOUND_DIRS.length}종 (tonejs-instruments) — CC BY 3.0 (악보 재생)`);
  out.push("");
  out.push(OTHER_NOTES);
  out.push("");

  out.push(RULE);
  out.push("악기 음원 저작자 표시 (CC BY 3.0)");
  out.push(RULE);
  for (const dir of SOUND_DIRS){
    out.push("");
    out.push(normalize(fs.readFileSync(path.join(root, "src", "assets", dir, "ATTRIBUTION.md"), "utf8")));
  }
  out.push("");

  const printed = new Map();   // 같은 전문(예: 맞춤법 MPL-1.1)은 한 번만 싣는다
  for (const [name, version, license, url, , file] of COMPONENTS){
    out.push(RULE);
    out.push(`${name}${version ? " " + version : ""}`);
    out.push(`라이선스: ${license}`);
    out.push(`출처: ${url}`);
    out.push(THIN);
    if (name.startsWith("FFmpeg")){ out.push(FFMPEG_NOTE); out.push(THIN); }
    const text = readLicense(file);
    if (printed.has(text)){
      out.push(`(라이선스 전문은 위 "${printed.get(text)}" 항목과 같습니다.)`);
    } else {
      printed.set(text, name);
      out.push(text);
    }
    out.push("");
  }
  // 맞춤법 사전 고지는 MPL-1.1·CC BY 4.0 전문을 가리키므로, 사전 쪽 전문도 덧붙인다.
  out.push(RULE);
  out.push("hunspell-dict-ko 데이터 — Creative Commons Attribution 4.0 International");
  out.push(THIN);
  out.push(normalize(readSpellLicense("koreanDictionaryCcBy40")));
  out.push("");
  return out.join("\n");
}

const text = build();
if (process.argv.includes("--check")){
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : "";
  if (current !== text){
    console.error("THIRD_PARTY_NOTICES.txt 가 원본과 다릅니다. node tools/build-third-party-notices.mjs 로 다시 만드세요.");
    process.exit(1);
  }
  console.log("THIRD_PARTY_NOTICES.txt 가 최신입니다.");
} else {
  fs.writeFileSync(TARGET, text, "utf8");
  console.log(`THIRD_PARTY_NOTICES.txt 생성 (${(Buffer.byteLength(text) / 1024).toFixed(0)}KB)`);
}
