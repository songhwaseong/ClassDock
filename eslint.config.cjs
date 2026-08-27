"use strict";

const globals = require("globals");
const manifest = require("./scripts.manifest.json");
const { collectScriptGlobals } = require("./tools/source-globals.js");

const root = __dirname;
const declarations = collectScriptGlobals(root, manifest.localScripts);
const sharedRuntimeGlobals = {
  ...globals.browser,
  module: "readonly",
  exports: "readonly",
  require: "readonly",
  Buffer: "readonly",
  pdfjsLib: "readonly",
  PDFLib: "readonly",
  JSZip: "readonly",
  zip: "readonly",
  docx: "readonly",
  XLSX: "readonly",
  ExcelJS: "readonly",
  jsyaml: "readonly",
  Papa: "readonly",
  _: "readonly",
  dayjs: "readonly",
  math: "readonly",
  CryptoJS: "readonly",
  hwp: "readonly",
  html2canvas: "readonly",
  htmlToImage: "readonly",
  $: "readonly",
  jQuery: "readonly",
  L: "readonly"
  ,Terminal: "readonly"
  ,ClassDockCore: "readonly"
  ,MNI18N: "readonly"
  ,t: "readonly"
  ,setUiIcon: "readonly"
  ,uiIcon: "readonly"
  ,OfficeDecrypt: "readonly"
  ,Tesseract: "readonly"
  ,loadPyodide: "readonly"
  ,importScripts: "readonly"
  ,webkitAudioContext: "readonly"
  ,webkitOfflineAudioContext: "readonly"
};
const sourceRules = {
  "no-undef": ["error", { typeof: true }],
  "no-restricted-globals": ["error",
    { name:"alert", message:"브라우저 alert 대신 ClassDock toast 또는 내부 모달을 사용하세요." },
    { name:"confirm", message:"브라우저 confirm 대신 confirmDialog를 사용하세요." },
    { name:"prompt", message:"브라우저 prompt 대신 askText를 사용하세요." }
  ],
  "no-restricted-properties": ["error",
    { object:"window", property:"alert", message:"브라우저 alert 대신 ClassDock toast 또는 내부 모달을 사용하세요." },
    { object:"window", property:"confirm", message:"브라우저 confirm 대신 confirmDialog를 사용하세요." },
    { object:"window", property:"prompt", message:"브라우저 prompt 대신 askText를 사용하세요." }
  ],
  "no-unused-vars": ["error", {
    vars: "local",
    args: "after-used",
    caughtErrors: "none",
    ignoreRestSiblings: true
  }]
};

const projectGlobals = { ...sharedRuntimeGlobals };
for (const names of declarations.values()) {
  for (const name of names) projectGlobals[name] = "readonly";
}

const sourceConfigs = [];
for (const file of manifest.localScripts) {
  sourceConfigs.push({
    name: `source/${file}`,
    files: [`src/js/${file}`],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.node, ...globals.commonjs, ...projectGlobals }
    },
    rules: sourceRules
  });
}

module.exports = [
  {
    name: "global-ignores",
    ignores: [
      "node_modules/**",
      "vendor/**",
      "dist/**",
      "test-results/**",
      "classdock-offline.html",
      "사용법.html"
    ]
  },
  ...sourceConfigs,
  {
    name: "node-scripts",
    files: ["*.js", "tools/**/*.js", "desktop/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: sourceRules
  },
  {
    name: "node-modules",
    files: ["tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: sourceRules
  },
  {
    name: "node-tests",
    files: ["tests/**/*.test.js", "tests/fixtures/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.commonjs, ...projectGlobals }
    },
    rules: sourceRules
  },
  {
    name: "playwright-tests",
    files: ["tests/e2e/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: projectGlobals
    },
    rules: sourceRules
  }
];
