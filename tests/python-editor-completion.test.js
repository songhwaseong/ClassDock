"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const editor = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");

test("Python 자동완성은 목록 바깥을 클릭하면 닫히고 진행 중인 응답을 무효화한다", () => {
  assert.match(editor, /const dismissCompletion = \(\) => \{\s*completionSeq\+\+;\s*hideCompletion\(\);/);
  assert.match(editor, /if \(complete\.hidden \|\| complete\.contains\(event\.target\)\) return;/);
  assert.match(editor, /document\.addEventListener\("pointerdown", closeCompletionOnOutsidePointer, true\)/);
  assert.match(editor, /document\.removeEventListener\("pointerdown", closeCompletionOnOutsidePointer, true\)/);
  assert.match(editor, /ta\.addEventListener\("blur", \(\) => \{[^}]*dismissCompletion\(\)/);
});

test("주석 안에서는 자동완성을 띄우지 않는다", () => {
  assert.match(editor, /const caretInComment = \(caret\) => \{/);
  assert.match(editor, /if \(caretInComment\(word\.end\)\)\{ hideCompletion\(\); return; \}/);
});

test("작업공간 자동 import 는 자동 팝업에도 나오고, 설치 패키지 카탈로그는 Ctrl+Space 에서만 열린다", () => {
  // manual=false 여도 workspaceImportCandidates 는 호출하고, 카탈로그(pythonIndexedImportCandidates)는 manual 일 때만.
  assert.match(editor, /const indexed = manual && typeof pythonIndexedImportCandidates === "function"/);
  assert.match(editor, /if \(typeof options\.workspaceImportCandidates === "function"\) \{\s*try \{ workspace = options\.workspaceImportCandidates\(\)/);
  assert.match(editor, /pythonImportCompletionCandidates\(source, prefix, extra, \{ catalog: manual \}\)/);
  // 멤버 접근(obj.)·일반 텍스트 편집에서는 import 제안을 아예 만들지 않는다.
  // (자바처럼 자기 후보를 주는 편집기만 plainMode 에서도 연다 — options.importCandidates)
  assert.match(editor, /if \(dotContext\) return \[\];/);
  assert.match(editor, /if \(plainMode\) return \[\];/);
  // 두 경로(로컬 즉시 표시·Jedi 응답 보강) 모두 같은 후보 생성기를 쓴다.
  assert.match(editor, /const imports = importCtx \? \[\] : importCandidatesFor\(source, word\.prefix, manual, ctx\.dotContext\);/);
  assert.match(editor, /const imports = importCtx \? \[\] : importCandidatesFor\(source, word\.prefix, manual, dotContext\);/);
});

test("import 문을 치는 중에는 작업공간 모듈·이름 후보를 먼저 보여 준다", () => {
  // 문맥 판별은 core(pythonImportContextAt), 후보는 작업공간 색인에서 온다.
  assert.match(editor, /const importCtx = !plainMode && typeof pythonImportContextAt === "function"\s*\?\s*pythonImportContextAt\(ta\.value, ta\.selectionStart\) : null;/);
  assert.match(editor, /options\.workspaceModuleCandidates\(importCtx\)/);
  // 아직 한 글자도 안 쳤어도 팝업을 연다(from 모듈 import ⟨여기⟩).
  assert.match(editor, /if \(!manual && !dotContext && !importCtx && word\.prefix\.length < 1\)\{ hideCompletion\(\); return; \}/);
  // 모듈 후보가 목록 맨 앞(Jedi 후보보다 먼저) — Jedi 는 작업공간 모듈을 모른다.
  assert.match(editor, /mergeCompletionItems\(\[\.\.\.modules, \.\.\.members, \.\.\.local\]/);
  assert.match(editor, /mergeCompletionItems\(\[\.\.\.modules, \.\.\.fallbackMembers, \.\.\.pruned\]/);
  // import 줄에서 아직 아무것도 안 쳤으면 버퍼 단어는 넣지 않는다(목록 소음 방지).
  assert.match(editor, /const local = importCtx && !word\.prefix \? \[\] : pythonCompletionCandidates\(/);
});

test("앞 후보가 목록을 다 채워도 자동 import 자리는 남겨 둔다", () => {
  assert.match(editor, /const IMPORT_RESERVED_SLOTS = 3;/);
  assert.match(editor, /const reserve = Math\.min\(IMPORT_RESERVED_SLOTS, imports\.length\);\s*push\(primary, Math\.max\(0, limit - reserve\)\);\s*push\(imports, limit\);\s*push\(primary, limit\);/);
});

test("함수 자동완성 직후 ( 중복입력은 한 번 무시한다(튜플 인자는 그대로)", () => {
  // 수락으로 빈 () 가 삽입되면 그 커서 위치를 기록하고, 다음 키 입력 한 번만 유효한 one-shot 로 무효화한다.
  assert.match(editor, /pendingAutoParen = \(ta\.value\[caret - 1\] === "\(" && ta\.value\[caret\] === "\)"\) \? caret : -1;/);
  assert.match(editor, /const autoParenSpot = pendingAutoParen; pendingAutoParen = -1;/);
  assert.match(editor, /if \(e\.key === "\(" && start === end && start === autoParenSpot/);
});
