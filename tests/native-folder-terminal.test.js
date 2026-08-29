"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const loaders = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
const documents = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");
const terminal = fs.readFileSync(path.join(root, "src/js/python-terminal.js"), "utf8");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");

test("EXE 폴더 열기는 Windows에서 받은 실제 경로를 로컬 핸들로 전달한다", () => {
  assert.match(loaders, /source-folder-capability/);
  assert.match(loaders, /chooseNativeSourceFolder\(\)/);
  assert.match(loaders, /new NativeSourceDirectoryHandle\(status\.id, status\.result\)/);
  assert.match(loaders, /class NativeSourceFileHandle/);
  assert.match(loaders, /class NativeSourceDirectoryHandle/);
  const chooseStart = loaders.indexOf("async function chooseFolderHandle");
  const chooseEnd = loaders.indexOf("\n}", chooseStart);
  const choose = loaders.slice(chooseStart, chooseEnd);
  assert.ok(choose.indexOf("chooseNativeSourceFolder()") < choose.indexOf("window.showDirectoryPicker"));
  assert.match(choose, /if \(native\.supported\) return native\.handle/);
  assert.match(loaders, /native source folder picker failed/);
  assert.match(loaders, /기본 폴더 선택창으로 전환합니다/);
  assert.match(loaders, /nativeSourceFolderCapability = false/);
});

test("EXE 원본 폴더 선택창은 PowerShell 없이 Windows Shell을 직접 호출한다", () => {
  const start = launcher.indexOf("static string RunSourceFolderPickerDialog()");
  const end = launcher.indexOf("static void RememberSourceFolder", start);
  const picker = launcher.slice(start, end);
  assert.match(launcher, /SHBrowseForFolderW/);
  assert.match(picker, /info\.hwndOwner = GetForegroundWindow\(\)/);
  assert.match(picker, /SHBrowseForFolder\(ref info\)/);
  assert.match(picker, /SHGetPathFromIDList\(pidl, selected\)/);
  assert.doesNotMatch(picker, /powershell|Process\.Start|EncodedCommand/i);
});

test("네이티브 원본 파일은 절대경로를 문서와 PowerShell 시작 폴더까지 유지한다", () => {
  assert.match(loaders, /__nativeAbsolutePath/);
  assert.match(loaders, /nativeAbsolutePath: options\.nativeAbsolutePath \|\| file\.__nativeAbsolutePath \|\| null/);
  assert.match(documents, /nativeAbsolutePath: options\.nativeAbsolutePath \|\| null/);
  assert.match(terminal, /options\.ownerDoc\.nativeAbsolutePath \|\| options\.ownerDoc\.workspacePath/);
});

test("로컬 원본 폴더 API는 선택한 루트 ID와 공통 경로 검증으로 범위를 제한한다", () => {
  assert.match(launcher, /Dictionary<string, string> SourceFolders/);
  assert.match(launcher, /TryResolveSourceFolderPath/);
  assert.match(launcher, /IsPathInsideRoot\(root, candidate, false\)/);
  assert.match(launcher, /HasReparsePointBelowRoot\(root, candidate\)/);
  assert.match(launcher, /RequiresLocalAuthToken[\s\S]*choose-source-folder/);
  assert.match(launcher, /RequiresLocalAuthToken[\s\S]*source-folder-file/);
});

test("terminal preserves UTF-8 output and falls back to the Windows OEM code page", () => {
  const start = launcher.indexOf("static Thread StartTerminalOutputReader");
  const end = launcher.indexOf("static void RunTerminalCommand", start);
  const reader = launcher.slice(start, end);
  assert.match(reader, /StandardOutput\.BaseStream/);
  assert.match(reader, /StandardError\.BaseStream/);
  assert.match(reader, /new UTF8Encoding\(false, true\)/);
  assert.match(reader, /Encoding\.GetEncoding\(\(int\)GetOEMCP\(\)\)/);
  assert.match(reader, /catch \(DecoderFallbackException\)/);
  assert.doesNotMatch(reader, /Standard(?:Output|Error)\.ReadLine\(\)/);
});

test("Python 후보 탐색은 출력 EOF보다 종료 제한을 먼저 확인한다", () => {
  const start = launcher.indexOf("static bool IsUsablePython");
  const end = launcher.indexOf("static List<string> InstalledPythonCandidates", start);
  const probe = launcher.slice(start, end);
  const wait = probe.indexOf("p.WaitForExit(5000)");
  const stdout = probe.indexOf("p.StandardOutput.ReadToEnd()");
  const stderr = probe.indexOf("p.StandardError.ReadToEnd()");
  assert.ok(wait >= 0 && stdout > wait && stderr > wait);
});
