const { test, expect } = require("@playwright/test");
const { appReady, makeBoard, restoreBackup, roundTrip } = require("./helpers-backup");

/* EXE(C# 로컬 서버) 배포본에서의 백업 왕복.
 *
 * 다른 e2e 는 정적 서버로 열어 브라우저 IndexedDB 경로만 탄다. EXE 는 작업공간을
 * /workspace-save 로, 설정을 /app-state 로 서버에 두는 전혀 다른 길이라, 백업·복원이
 * 그 길에서도 이어지는지는 따로 봐야 한다(토큰 헤더·replace=1·workspace-clear).
 *
 * ⚠ 이 검사는 이 PC 의 실제 ClassDock 데이터(%LOCALAPPDATA%\ClassDock\workspace.bin,
 *    app-state.json)를 지우고 덮어쓴다. 그래서 기본으로는 건너뛰고, 지울 각오가 된
 *    사람이 주소를 직접 줄 때만 돈다:
 *
 *      CLASSDOCK_NO_BROWSER=1 ClassDock.exe          (포트는 instance-port.txt)
 *      MN_EXE_URL=http://127.0.0.1:17645 npx playwright test tests/e2e/backup-exe-server.spec.js
 */

// e2e 설정은 Node 전역을 넣지 않는다 — process 를 직접 쓰지 않고 불러온다.
const EXE_URL = require("node:process").env.MN_EXE_URL || "";

test.describe("EXE 로컬 서버", () => {
  test.skip(!EXE_URL, "MN_EXE_URL 을 주면 실행한다 — 이 PC 의 ClassDock 저장 데이터를 지운다");

  // 사용자의 실제 저장분·앞 검사의 흔적에 좌우되지 않게 서버를 비우고 시작한다.
  async function bootClean(page){
    await page.addInitScript(() => {
      try {
        localStorage.setItem("mn_onboarded_v1", "1");
        localStorage.setItem("uiLang", "ko");
        localStorage.setItem("sidebarCollapsed", "true");
        localStorage.setItem("classdock-workspaces:v1", JSON.stringify({
          version:1, activeId:"main",
          items:[{ id:"main", name:"기본 작업공간", sidebarCollapsed:true }]
        }));
      } catch(_){}
    });
    await page.goto(EXE_URL + "/");
    await appReady(page);
    const token = await page.evaluate(() => window.__CLASSDOCK_LOCAL_TOKEN__ || "");
    expect(token).not.toBe("");
    /* 앱을 살려 둔 채 지우면 자동 저장 타이머가 곰바로 되살려 쓴다(복원이 겪은 것과 같은 경쟁).
       빈 페이지로 옮겨 앱을 먼저 멈추고 나서 서버를 비운다. */
    /* 같은 origin 이면서 앱은 뜼지 않는 자리(404)로 옮긴다 — 앱이 멈춰야 지운 것이
       다시 쓰이지 않고, 같은 origin 이어야 localStorage 까지 같이 비울 수 있다. */
    await page.goto(EXE_URL + "/__e2e-reset__");
    await page.evaluate(() => { try { localStorage.clear(); } catch(_){} });
    await page.request.post(EXE_URL + "/workspace-clear", {
      headers:{ "X-ClassDock-Token":token, "X-ClassDock-Workspace":"1" }
    });
    await page.request.post(EXE_URL + "/app-state", {
      headers:{ "X-ClassDock-Token":token, "Content-Type":"application/json" }, data:"{}"
    });
    await page.goto(EXE_URL + "/");
    await appReady(page);
    await expect.poll(() => page.evaluate(() => docs.filter(d => d.kind === "board").length),
      { timeout: 15000 }).toBe(0);
  }

  test("EXE 로컬 서버에서도 백업 왕복이 그대로 된다", async ({ page }) => {
    const errors = [];
    const calls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (res) => {
      const path = new URL(res.url()).pathname;
      if (["/workspace-load", "/workspace-save", "/workspace-clear", "/app-state"].includes(path))
        calls.push(path + " " + res.status());
    });

    await bootClean(page);

    // 이 배포본에서는 작업공간이 브라우저가 아니라 로컬 서버에 저장돼야 한다.
    expect(await page.evaluate(() => workspaceBackendAvailable())).toBe(true);

    await roundTrip(page);

    // 백업은 서버에서 작업공간을 읽고, 복원은 서버에 되돌려 써야 한다.
    expect(calls.some(c => c === "/workspace-load 200")).toBe(true);
    expect(calls.some(c => c.startsWith("/workspace-save 200"))).toBe(true);
    expect(calls.some(c => c.startsWith("/app-state 200"))).toBe(true);
    // 서버 경로에서 토큰이 빠지면 403 이 난다 — 하나도 없어야 한다.
    expect(calls.filter(c => / (401|403)$/.test(c))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("복원한 작업공간이 서버에 남아 다음 실행에도 그대로다", async ({ page }) => {
    await bootClean(page);
    await page.locator("#fileInput").setInputFiles({
      name: "서버백업.txt", mimeType: "text/plain", buffer: Buffer.from("서버 경로 확인\n", "utf8")
    });
    await expect(page.locator("#activeFileName")).toHaveText("서버백업.txt");
    await makeBoard(page, "서버 판서");
    await expect.poll(() => page.evaluate(async () => (await (await fetch("/workspace-load",
      { cache:"no-store" })).arrayBuffer()).byteLength), { timeout: 15000 }).toBeGreaterThan(0);

    const wait = page.waitForEvent("download");
    await page.evaluate(() => MNBackup.exportBackup());
    const zipPath = await (await wait).path();

    // 작업공간을 비운 뒤 복원하면 서버에 도로 채워져야 한다.
    await page.evaluate(() => fetch("/workspace-clear",
      { method:"POST", headers:{ "X-ClassDock-Workspace":"1" } }));
    await restoreBackup(page, zipPath);

    const bytes = await page.evaluate(async () =>
      (await (await fetch("/workspace-load", { cache:"no-store" })).arrayBuffer()).byteLength);
    expect(bytes).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() =>
      docs.some(d => d.name === "서버백업.txt")), { timeout: 20000 }).toBe(true);
  });
});
