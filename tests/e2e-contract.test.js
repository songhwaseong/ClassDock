const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const config = fs.readFileSync(path.join(root, "playwright.config.js"), "utf8");
const flows = fs.readFileSync(path.join(root, "tests/e2e/critical-flows.spec.js"), "utf8");

test("Playwright E2E 회귀 테스트는 화면 기록 없이 핵심 사용자 흐름을 실행한다", () => {
  assert.match(pkg.scripts["test:e2e"], /playwright test/);
  assert.match(pkg.devDependencies["@playwright\/test"], /^\^?\d+\.\d+\.\d+$/);
  assert.match(config, /screenshot:\s*"off"/);
  assert.match(config, /video:\s*"off"/);
  assert.match(config, /trace:\s*"off"/);
  assert.match(flows, /command palette opens and closes/);
  assert.match(flows, /text document can be opened/);
  assert.match(flows, /new whiteboard initializes/);
});
