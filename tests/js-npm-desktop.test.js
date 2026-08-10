"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const launcher = fs.readFileSync(path.join(root, "desktop", "launcher.cs"), "utf8");
const runner = fs.readFileSync(path.join(root, "desktop", "npm_package_runner.js"), "utf8");
const build = fs.readFileSync(path.join(root, "desktop", "build.bat"), "utf8");

test("EXE는 npm 설치·폴링·취소·목록·번들·삭제 API를 로컬 토큰으로 보호한다", () => {
  for (const route of [
    "/js-npm-status", "/js-npm-list", "/js-npm-bundle", "/js-npm-install-start",
    "/js-npm-install-poll", "/js-npm-install-cancel", "/js-npm-delete"
  ]) assert.ok(launcher.includes(route), route);
  assert.match(launcher, /path\.StartsWith\("\/js-npm-"/);
  assert.match(launcher, /x-manneung-npm-confirm/);
});

test("npm 러너는 설치 스크립트를 차단하고 브라우저 Worker 번들에 제한을 둔다", () => {
  assert.match(runner, /--ignore-scripts/);
  assert.match(runner, /platform:"browser"/);
  assert.match(runner, /MAX_PROJECT_BYTES = 250 \* 1024 \* 1024/);
  assert.match(runner, /MAX_BUNDLE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(runner, /globalThis\[/);
});

test("데스크톱 빌드는 npm 설치 러너를 EXE 리소스로 포함한다", () => {
  assert.match(build, /npm_package_runner\.js,npm_package_runner\.js/);
});
