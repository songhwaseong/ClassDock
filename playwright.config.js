const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // 앱은 저장된 uiLang 이 없으면 브라우저 언어로 시작한다 — 기본(en-US)이면 한국어 문구를 찾는 시험이 영어 화면에서 돈다.
    locale: "ko-KR",
    screenshot: "off",
    video: "off",
    trace: "off"
  },
  webServer: {
    command: "node tools/e2e-server.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
