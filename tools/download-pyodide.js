/*
 * Pyodide 코어 런타임을 vendor/pyodide/ 로 내려받는다(오프라인 실행용).
 * - 버전은 src/js/python-viewer.js 의 PYODIDE_VER 한 줄에서 읽어 단일 출처로 유지.
 * - 받는 건 코어뿐(런타임 + 표준 라이브러리). 외부 패키지(.whl)는 받지 않는다
 *   — 패키지는 실행 시 인터넷이 있을 때 사용자 동의 후 CDN 에서 받는다.
 * 실행:  node tools/download-pyodide.js
 * 버전 바꾸기:  python-viewer.js 의 PYODIDE_VER 수정 → 이 스크립트 재실행 → 빌드
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.join(__dirname, "..");
const viewerPath = path.join(root, "src", "js", "python-viewer.js");
const viewer = fs.readFileSync(viewerPath, "utf8");
const m = viewer.match(/PYODIDE_VER\s*=\s*"([^"]+)"/);
if (!m) { console.error("PYODIDE_VER 를 python-viewer.js 에서 찾지 못했습니다."); process.exit(1); }
const ver = m[1];

const base = `https://cdn.jsdelivr.net/pyodide/v${ver}/full/`;
// 코어 부팅 + 표준 라이브러리에 필요한 최소 파일. pyodide-lock.json 은 패키지 이름→파일 매핑(런타임에 사용).
const files = ["pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
const outDir = path.join(root, "vendor", "pyodide");
fs.mkdirSync(outDir, { recursive: true });

function download(url, dest, depth = 0) {
  return new Promise((res, rej) => {
    if (depth > 5) return rej(new Error("redirect 가 너무 많습니다: " + url));
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return res(download(new URL(r.headers.location, url).href, dest, depth + 1));
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode} — ${url}`)); }
      const f = fs.createWriteStream(dest);
      r.pipe(f);
      f.on("finish", () => f.close(() => res()));
      f.on("error", rej);
    }).on("error", rej);
  });
}

(async () => {
  console.log(`Pyodide ${ver} 코어 내려받기 → vendor/pyodide/`);
  let total = 0;
  for (const name of files) {
    const dest = path.join(outDir, name);
    process.stdout.write(`  ${name} … `);
    await download(base + name, dest);
    const kb = fs.statSync(dest).size / 1024;
    total += kb;
    console.log(`${Math.round(kb).toLocaleString()} KB`);
  }
  fs.writeFileSync(path.join(outDir, "VERSION"), ver + "\n");
  console.log(`완료 — 합계 ${Math.round(total / 1024).toLocaleString()} MB (vendor/pyodide/, 버전 ${ver})`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
