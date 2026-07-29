"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const html = read("manneung-classroom.html");
const app = read("src", "js", "app.js");
const documents = read("src", "js", "documents.js");
const notebook = read("src", "js", "notebook-cells.js");

test("시작 화면은 명시적인 파일 열기를 기본 행동으로 제공한다", () => {
  assert.match(html, /id="dzFileBtn" class="dz-open-primary"/);
  assert.match(html, /<strong>파일 열기<\/strong><small>한 개 또는 여러 파일 선택<\/small>/);
  assert.match(html, /id="dzFolderBtn" class="dz-open-secondary"/);
  assert.match(html, /<strong>Python 실습<\/strong>/);
  assert.match(html, /<strong>과제 제출 검수<\/strong>/);
  assert.match(app, /byId\("dzFileBtn"\)\.addEventListener\("click"[\s\S]*pickFilesOrInput\(fileInput\)/);
  assert.doesNotMatch(app, /byId\("dzInner"\)\.addEventListener\("click"/);
});

test("저장 대상 판단은 원본과 사본의 결과를 편집 전에 설명한다", () => {
  const start = documents.indexOf("function documentSaveTarget");
  const end = documents.indexOf("function updateOriginalSaveBadge", start);
  const sandbox = { workspaceBackendStatus: () => false };
  vm.runInNewContext(
    documents.slice(start, end) + "; this.documentSaveTarget = documentSaveTarget;",
    sandbox
  );

  const copy = sandbox.documentSaveTarget({ kind:"pdf" });
  assert.equal(copy.mode, "copy");
  assert.match(copy.summary, /다운로드 사본/);

  const original = sandbox.documentSaveTarget({ kind:"pdf", originalSaveMode:true });
  assert.equal(original.mode, "original");
  assert.match(original.summary, /원본 파일을 바로 바꿉니다/);

  const spreadsheet = sandbox.documentSaveTarget({
    kind:"office",
    saveCapability:"spreadsheet",
    fsHandle:{ createWritable(){} }
  });
  assert.equal(spreadsheet.mode, "original");
});

test("저장 안내는 처음 또는 방식 변경 때만 잠시 표시되고 버튼 표현과 일치한다", () => {
  assert.match(html, /id="saveTargetBar"[\s\S]*id="saveTargetBarLabel"[\s\S]*id="saveTargetBarText"/);
  assert.match(documents, /badge\.title = target\.mode \? _t\(target\.summary \|\| target\.title\)/);
  assert.match(documents, /doc\._saveTargetNoticeKey !== noticeKey/);
  assert.match(documents, /saveTargetNoticeTimer = setTimeout\([\s\S]*SAVE_TARGET_NOTICE_MS/);
  assert.match(documents, /barLabel\.textContent = _t\(target\.label\)/);
  assert.match(documents, /pdfSave\.textContent = actionLabel/);
  assert.match(documents, /querySelectorAll\("\.run-save"\)[\s\S]*button\.textContent = actionLabel/);
  assert.match(notebook, /const saveLabel = target && target\.mode \? target\.label : "저장"/);
});
