import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://raw.githubusercontent.com/OpenScore/Lieder/refs/heads/main/data/index.html";
const PROJECT_URL = "https://fourscoreandmore.org/openscore/lieder/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "src/js/music-library-data.js");

function decodeHtml(value){
  const named = { amp:"&", apos:"'", quot:'"', lt:"<", gt:">", nbsp:" " };
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
      if (entity[0] === "#"){
        const hex = entity[1].toLowerCase() === "x";
        const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : "";
      }
      return named[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function linkFrom(cell, pattern){
  for (const match of cell.matchAll(/href="([^"]+)"/g)){
    const href = decodeHtml(match[1]);
    if (pattern.test(href)) return href;
  }
  return "";
}

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`OpenScore catalogue download failed: ${response.status}`);
const html = await response.text();
const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || "";
const rows = [];
for (const rowMatch of body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)){
  const cells = [...rowMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
  if (cells.length < 7) continue;
  const mxl = linkFrom(cells[5], /\.mxl(?:\?|$)/i);
  if (!mxl) continue;
  rows.push({
    composer:decodeHtml(cells[0]),
    set:decodeHtml(cells[1]) === "—" ? "" : decodeHtml(cells[1]),
    title:decodeHtml(cells[2]),
    lyricist:decodeHtml(cells[3]),
    language:decodeHtml(cells[4]),
    mxl,
    imslp:linkFrom(cells[6], /^https:\/\/imslp\.org\//i)
  });
}

if (rows.length < 1000) throw new Error(`OpenScore catalogue is unexpectedly small: ${rows.length}`);
const generated = `"use strict";\n\n/* 이 파일은 tools/update-openscore-catalog.mjs가 OpenScore의 공식 CC0 카탈로그에서 만듭니다. */\n`
  + `const MNOpenScoreCatalog = Object.freeze(${JSON.stringify({
      provider:"OpenScore Lieder",
      license:"CC0-1.0",
      projectUrl:PROJECT_URL,
      sourceUrl:SOURCE_URL,
      updated:new Date().toISOString().slice(0, 10),
      scores:rows
    }, null, 2)});\n`;
await fs.writeFile(outputPath, generated, "utf8");
console.log(`Wrote ${rows.length} OpenScore entries to ${path.relative(root, outputPath)}`);
