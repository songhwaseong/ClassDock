"use strict";

// 문서 형식 레지스트리와 사이드바 표시 규칙. 브라우저 전역과 CommonJS 양쪽에서 쓴다.
const MNDocumentTypes = (() => {
  const IMG_EXTS = ["png","jpg","jpeg","gif","webp","bmp","svg","avif","ico"];
  const SQLITE_EXTS = ["db","sqlite","sqlite3"];
  const BINARY_ASSET_EXTS = new Set([
    "model", "npy", "npz", "kv",
    "onnx", "tflite", "safetensors", "pt", "pth", "ckpt",
    "joblib", "pkl", "pickle", "keras", "h5", "hdf5", "pyc"
  ]);
  const CODE_EXTS = {
    js:"c", mjs:"c", cjs:"c", ts:"c", jsx:"c", tsx:"c", java:"c", c:"c", h:"c", cpp:"c", cc:"c", hpp:"c", cxx:"c",
    cs:"c", go:"c", rs:"c", php:"c", kt:"c", kts:"c", swift:"c", scala:"c", dart:"c", vue:"c", svelte:"c",
    json:"c", json5:"c", jsonc:"c", scss:"c", less:"c", bat:"c", cmd:"c",
    py:"python", pyi:"python", rb:"hash", sh:"hash", bash:"hash", zsh:"hash", ps1:"hash",
    yaml:"hash", yml:"hash", toml:"hash", ini:"hash", env:"hash", properties:"hash", conf:"hash",
    css:"css", sql:"sql",
    xml:"xml", xsl:"xml", xslt:"xml", xsd:"xml", rss:"xml", atom:"xml", plist:"xml", wsdl:"xml", dbk:"xml", docbook:"xml",
    rst:"text", adoc:"text", asciidoc:"text", asc:"text", org:"text", textile:"text", tex:"text", latex:"text", sty:"text", cls:"text", wiki:"text", mediawiki:"text",
    r:"hash", lua:"c", pl:"hash", pm:"hash", tcl:"hash", awk:"hash", groovy:"c", gradle:"c", proto:"c", coffee:"hash", cmake:"hash", dockerfile:"hash", makefile:"hash", mk:"hash",
    tsv:"text", log:"text", diff:"text", patch:"text", tokens:"text", vec:"text", vocab:"text"
  };
  const subtitleExts = typeof SUBTITLE_EXTS !== "undefined" ? SUBTITLE_EXTS : [];
  const videoExts = typeof VIDEO_EXTS !== "undefined" ? VIDEO_EXTS : [];
  const audioExts = typeof AUDIO_EXTS !== "undefined" ? AUDIO_EXTS : [];
  const TEXT_ENCODING_EXTS = new Set(["csv","md","markdown","mdx","txt","html","htm","xhtml", ...Object.keys(CODE_EXTS), ...subtitleExts]);
  const ZIP_OPENABLE = ["pdf","docx","doc","xlsx","xls","csv","pptx","hwp","hwpx","md","markdown","mdx","txt","html","htm","xhtml","ipynb","map","timeline","concept","study","mnote","msheet","musicxml","mxl",
    ...SQLITE_EXTS, ...Object.keys(CODE_EXTS), ...BINARY_ASSET_EXTS, "zip", "tar", "gz", "tgz", ...IMG_EXTS,
    ...videoExts, ...audioExts, ...subtitleExts];
  const ZIP_MIME = { svg:"image/svg+xml", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg",
    gif:"image/gif", webp:"image/webp", bmp:"image/bmp", avif:"image/avif", ico:"image/x-icon", pdf:"application/pdf",
    html:"text/html", htm:"text/html" };
  const ZIP_EXTRACT_CAP = 256 * 1024 * 1024;
  const ZIP_ENTRY_CAP = 128 * 1024 * 1024;
  const ZIP_MODE_NOTICE = "ZIP 모드: 원본 압축의 새로고침·덮어쓰기는 지원하지 않으며, 편집한 파일은 별도로 저장됩니다. Python 옆 파일 실행은 합계 50MB까지 지원합니다.";

  function isEnvFile(name){ return /^\.env(\.[^\\/]+)?$/i.test(String(name || "")); }
  function fileExtOf(name){
    const base = String(name || "");
    return isEnvFile(base) ? "env" : (base.split(".").pop() || "").toLowerCase();
  }
  function isHiddenFolderEntry(rel){
    const parts = String(rel || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (!parts.length) return true;
    const base = parts[parts.length - 1];
    if (parts.slice(0, -1).some(part => part.charAt(0) === ".")) return true;
    return base.charAt(0) === "." && !isEnvFile(base);
  }
  function iconFor(kind, name){
    if (kind === "folder") return "DIR";
    if (kind === "zip") return "ZIP";
    if (kind === "pdf") return "PDF";
    if (kind === "image") return "IMG";
    if (kind === "image-gallery" || kind === "pdf-gallery") return "▦";
    if (kind === "video") return audioExts.includes(fileExtOf(name)) ? "AUD" : "VID";
    if (kind === "board") return "칠판";
    if (kind === "map") return "지도";
    if (kind === "timeline") return "연표";
    if (kind === "concept") return "관계";
    if (kind === "study") return "암기";
    if (kind === "replay") return "▶";
    if (kind === "diff") return "비교";
  if (kind === "dbconn") return "DB";
    const ext = fileExtOf(name);
    if (ext === "md" || ext === "markdown" || ext === "mdx") return "MD";
    if (ext === "docx" || ext === "doc") return "DOC";
    if (ext === "pptx") return "PPT";
    if (ext === "hwp" || ext === "hwpx") return "한";
    return (ext || "?").slice(0, 4).toUpperCase();
  }
  function extCategory(kind, name){
    if (kind === "folder") return "dir";
    if (kind === "zip") return "zip";
    if (kind === "pdf") return "pdf";
    if (kind === "image" || kind === "image-gallery") return "img";
    if (kind === "pdf-gallery") return "pdf";
    if (kind === "video") return "media";
    if (kind === "binary") return "binary";
    if (kind === "diff") return "code";
    if (kind === "map") return "map";
    if (kind === "timeline") return "timeline";
    if (kind === "concept") return "concept";
    if (kind === "study") return "study";
    if (kind === "dbconn") return "db";
    const ext = fileExtOf(name);
    if (ext === "docx" || ext === "doc") return "word";
    if (ext === "xlsx" || ext === "xls" || ext === "csv") return "sheet";
    if (SQLITE_EXTS.includes(ext)) return "db";
    if (ext === "pptx") return "ppt";
    if (ext === "hwp" || ext === "hwpx") return "hwp";
    if (ext === "md" || ext === "markdown" || ext === "mdx") return "md";
    if (ext === "html" || ext === "htm" || ext === "xhtml") return "html";
    if (ext === "py") return "py";
    if (["zip", "tar", "gz", "tgz"].includes(ext)) return "zip";
    if (IMG_EXTS.includes(ext)) return "img";
    if (ext in CODE_EXTS) return "code";
    return "";
  }

  return {
    IMG_EXTS, SQLITE_EXTS, BINARY_ASSET_EXTS, CODE_EXTS, TEXT_ENCODING_EXTS,
    ZIP_OPENABLE, ZIP_MIME, ZIP_EXTRACT_CAP, ZIP_ENTRY_CAP, ZIP_MODE_NOTICE,
    isEnvFile, fileExtOf, isHiddenFolderEntry, iconFor, extCategory
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNDocumentTypes;
