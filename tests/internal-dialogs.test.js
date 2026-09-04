"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("앱 기능은 브라우저 alert·confirm·prompt 대신 내부 창을 사용한다", () => {
  const sourceDir = path.join(root, "src/js");
  const nativeDialog = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
  for (const name of fs.readdirSync(sourceDir).filter(file => file.endsWith(".js"))){
    const source = fs.readFileSync(path.join(sourceDir, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, nativeDialog, `${name}에 브라우저 기본 대화상자가 남아 있습니다`);
  }
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  // 확인·입력창은 자기를 부른 창(관계도·암기 카드 모달 = 2200) 위에 떠야 버튼을 누를 수 있다.
  assert.match(styles, /#textModal,#confirmModal\{z-index:2300\}/);
  assert.match(styles, /\.concept-modal,\.study-modal\{[^}]*z-index:2200/);
});

test("닫기·취소 동작이 있는 모달은 Escape로 같은 정리 경로를 실행한다", () => {
  const app = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  assert.match(app, /const modalCancelButtons = \{[\s\S]*window\.addEventListener\("keydown",[\s\S]*e\.key !== "Escape"/);

  const notebookPdf = fs.readFileSync(path.join(root, "src/js/notebook-pdf-export.js"), "utf8");
  const video = fs.readFileSync(path.join(root, "src/js/video-viewer.js"), "utf8");
  for (const [name, source] of [["노트북 PDF", notebookPdf], ["영상 일괄 변환", video]]){
    assert.match(source, /const onKeydown = \(event\) => \{[\s\S]*event\.key !== "Escape"[\s\S]*requestCancel\(\)/, name);
    assert.match(source, /document\.removeEventListener\("keydown", onKeydown, true\)/, name + " ESC 수신기 정리");
  }

  const spreadsheet = fs.readFileSync(path.join(root, "src/js/spreadsheet-viewer.js"), "utf8");
  assert.match(spreadsheet, /condModalKeydown = \(event\) => \{[\s\S]*event\.key !== "Escape"[\s\S]*closeCondModal\(\)/);
  assert.match(spreadsheet, /pivotModalKeydown = \(event\) => \{[\s\S]*event\.key !== "Escape"[\s\S]*closePivotModal\(\)/);
});
