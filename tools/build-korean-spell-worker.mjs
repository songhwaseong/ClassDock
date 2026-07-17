import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const readBytes = relative => fs.readFileSync(path.join(root, relative));
const gzipBase64 = relative => zlib.gzipSync(readBytes(relative), { level:9 }).toString("base64");
const affGzip = gzipBase64("node_modules/hunspell-dict-ko/ko.aff");
const dicGzip = gzipBase64("node_modules/hunspell-dict-ko/ko.dic");
const wasmGzip = gzipBase64("node_modules/hunspell-wasm/wasm/hunspell.wasm");

const entry = `
import initializer from "./node_modules/hunspell-wasm/wasm/hunspell.js";
import { Hunspell } from "./node_modules/hunspell-wasm/dist/Hunspell.js";

const AFF_GZIP = ${JSON.stringify(affGzip)};
const DIC_GZIP = ${JSON.stringify(dicGzip)};
const WASM_GZIP = ${JSON.stringify(wasmGzip)};
const MAX_DICTIONARY_TOKENS = 8000;
let enginePromise = null;
const wordCache = new Map();

function decodeBase64(value){
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gunzip(value){
  if (typeof DecompressionStream !== "function") {
    throw new Error("이 브라우저는 내장 한국어 사전 압축 해제를 지원하지 않습니다.");
  }
  const compressed = decodeBase64(value);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function engine(){
  if (!enginePromise) enginePromise = (async () => {
    const [affBytes, dicBytes, wasmBinary] = await Promise.all([
      gunzip(AFF_GZIP), gunzip(DIC_GZIP), gunzip(WASM_GZIP)
    ]);
    const decoder = new TextDecoder("utf-8");
    const wasmModule = await initializer({
      wasmBinary,
      locateFile:() => "data:application/octet-stream;base64,"
    });
    return new Hunspell(wasmModule, decoder.decode(affBytes), decoder.decode(dicBytes));
  })();
  return enginePromise;
}

function tokenLooksTechnical(text, start, end){
  let left = start;
  let right = end;
  while (left > 0 && !/\\s/.test(text[left - 1])) left--;
  while (right < text.length && !/\\s/.test(text[right])) right++;
  const token = text.slice(left, right);
  return /(?:https?:\\/\\/|www\\.|[@\\\\/]|(?:[\\w가-힣-]+\\.)+[A-Za-z0-9]{1,12}(?:[?#].*)?$)/i.test(token);
}

function inspectWord(hunspell, word){
  if (wordCache.has(word)) return wordCache.get(word);
  const correct = hunspell.testSpelling(word);
  const result = correct ? { correct:true, suggestions:[] } : {
    correct:false,
    suggestions:hunspell.getSpellingSuggestions(word)
      .map(value => String(value || "").trim())
      .filter((value, index, list) => value && value !== word && list.indexOf(value) === index)
      .slice(0, 5)
  };
  wordCache.set(word, result);
  return result;
}

async function checkDictionary(payload){
  const hunspell = await engine();
  const text = String(payload.text || "");
  const ignored = new Set(Array.isArray(payload.ignored) ? payload.ignored : []);
  const ranges = Array.isArray(payload.ranges) ? payload.ranges : [];
  const issues = [];
  let tokenCount = 0;
  let truncated = false;
  for (const range of ranges){
    const rangeStart = Math.max(0, Math.min(text.length, Number(range.start) || 0));
    const rangeEnd = Math.max(rangeStart, Math.min(text.length, Number(range.end) || 0));
    const fragment = text.slice(rangeStart, rangeEnd);
    const words = /[가-힣]{2,}/g;
    let match;
    while ((match = words.exec(fragment))){
      if (++tokenCount > MAX_DICTIONARY_TOKENS){ truncated = true; break; }
      const original = match[0].normalize("NFC");
      const start = rangeStart + match.index;
      if (ignored.has(original) || tokenLooksTechnical(text, start, start + match[0].length)) continue;
      const result = inspectWord(hunspell, original);
      if (result.correct) continue;
      issues.push({
        id:"dictionary:" + start + ":" + original,
        ruleId:"dictionary",
        start,
        end:start + match[0].length,
        original:match[0],
        suggestions:result.suggestions,
        message:"한국어 사전에 없는 단어입니다. 고유명사나 기술 용어라면 사용자 사전에 추가할 수 있습니다.",
        category:"사전 미등록",
        dictionary:true
      });
    }
    if (truncated) break;
  }
  return { issues, truncated };
}

self.onmessage = async event => {
  const payload = event.data || {};
  if (payload.type !== "check") return;
  try {
    const result = await checkDictionary(payload);
    self.postMessage({ type:"result", requestId:payload.requestId, ...result });
  } catch (error) {
    self.postMessage({
      type:"error",
      requestId:payload.requestId,
      message:String(error && error.message || error || "한국어 사전 검사 실패")
    });
  }
};
`;

const built = await build({
  stdin:{ contents:entry, resolveDir:root, sourcefile:"korean-spell-worker-entry.js" },
  bundle:true,
  format:"iife",
  platform:"browser",
  external:["fs/promises", "module"],
  target:["chrome90"],
  minify:true,
  legalComments:"none",
  write:false
});
const workerSource = built.outputFiles[0].text;
const banner = [
  "/*! Korean offline spell worker.",
  " * hunspell-wasm: MPL-1.1 option, https://github.com/rotemdan/hunspell-wasm",
  " * hunspell-dict-ko 0.6.1: MPL-1.1 plus CC-BY-4.0 data attribution, https://github.com/spellcheck-ko/hunspell-dict-ko",
  " */"
].join("\n");
const licenseNotices = {
  hunspellWasmMpl11:readBytes("node_modules/hunspell-wasm/COPYING.MPL").toString("utf8"),
  koreanDictionaryNotice:readBytes("node_modules/hunspell-dict-ko/LICENSE").toString("utf8"),
  koreanDictionaryMpl11:readBytes("node_modules/hunspell-dict-ko/LICENSE.MPL").toString("utf8"),
  koreanDictionaryCcBy40:readBytes("node_modules/hunspell-dict-ko/LICENSE.CC-BY").toString("utf8")
};
const vendorSource =
  `${banner}\nwindow.__MN_KOREAN_SPELL_LICENSES__=${JSON.stringify(licenseNotices)};\n` +
  `window.__MN_KOREAN_HUNSPELL_WORKER_SOURCE__=${JSON.stringify(workerSource)};\n`;
const vendorRelative = "vendor/korean-hunspell-worker.js";
fs.writeFileSync(path.join(root, vendorRelative), vendorSource, "utf8");

const manifestPath = path.join(root, "scripts.manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const item = manifest.vendorScripts.find(entry => entry.file === "korean-hunspell-worker.js");
if (!item) throw new Error("scripts.manifest.json에 korean-hunspell-worker.js 항목이 없습니다.");
item.sha384 = "sha384-" + crypto.createHash("sha384").update(vendorSource).digest("base64");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(
  `한국어 맞춤법 Worker 생성 완료: ${Math.round(Buffer.byteLength(vendorSource) / 1024)} KB ` +
  `(원본 사전 ${Math.round((readBytes("node_modules/hunspell-dict-ko/ko.aff").length + readBytes("node_modules/hunspell-dict-ko/ko.dic").length) / 1024)} KB)`
);
