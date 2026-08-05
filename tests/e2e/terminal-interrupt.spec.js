const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 터미널에서 명령이 도는 중 Ctrl+C 로 중지가 걸리는지 본다.
// 실제 백엔드(로컬 PowerShell·Pyodide) 대신 "끝나지 않는 실행"을 심어 두고,
// 취소가 호출되는지만 확인한다.
async function openTerminal(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "term.py", mimeType: "text/x-python", buffer: Buffer.from("print(1)\n", "utf8")
  });
  await expect(page.locator("textarea.code-input")).toBeVisible();
  await page.evaluate(() => {
    window.__terminalCancelled = 0;
    window.pythonBackendAvailable = () => false;                 // 브라우저 Pyodide 콘솔 경로로 고정
    window.preparePyodideWorkerPackages = async () => ({ urls:[], names:[] });
    window.startPyodideKernelRun = () => {
      let reject = null;
      const promise = new Promise((_, rejectFn) => { reject = rejectFn; });
      promise.catch(() => {});
      return {
        promise,
        cancel(){
          window.__terminalCancelled++;
          const error = new Error("중지했습니다");
          error.code = "worker-cancel";
          reject(error);
        }
      };
    };
  });
  await page.locator("button.run-output-tab", { hasText: "터미널" }).click();
  await expect(page.locator(".py-terminal-modal")).toBeVisible();
  await page.locator("textarea.py-terminal-command").fill("import time");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-stop")).toBeEnabled();     // 실행 중 표시
}

test.describe("터미널 중지", () => {
  test("실행 중 Ctrl+C 를 누르면 명령이 중지된다", async ({ page }) => {
    await openTerminal(page);
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => window.__terminalCancelled)).toBe(1);
    await expect(page.locator(".py-terminal-error").last()).toContainText("중지");
  });

  // 출력 로그를 클릭하면 포커스가 터미널 카드로 옮겨 간다(로그·머리말은 포커스를 못 받는다).
  // 예전에는 이 자리에서 Ctrl+C 가 통째로 무시돼 중지 버튼밖에 쓸 수 없었다.
  test("출력 로그를 클릭한 뒤에도 Ctrl+C 로 중지된다", async ({ page }) => {
    await openTerminal(page);
    await page.locator(".py-terminal-log").click();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.className : "";
    });
    expect(focused).toContain("py-terminal-card");     // 포커스가 로그가 아니라 카드로 간다
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => window.__terminalCancelled)).toBe(1);
  });

  // 닫으면 포커스가 모달 밖 터미널 버튼으로 돌아가고, 실행 중에는 입력칸이 disabled 라
  // 다시 열어도 포커스가 그대로 버튼에 남는다. 예전에는 이 자리에서 Ctrl+C 가 무시됐다.
  test("닫았다 다시 열어도 Ctrl+C 로 중지된다", async ({ page }) => {
    await openTerminal(page);
    await page.locator(".py-terminal-close").click();
    await expect(page.locator(".py-terminal-modal")).toBeHidden();
    await page.keyboard.press("Control+c");
    expect(await page.evaluate(() => window.__terminalCancelled)).toBe(0);   // 닫힌 동안에는 가로채지 않는다

    await page.locator("button.run-output-tab", { hasText: "터미널" }).click();
    await expect(page.locator(".py-terminal-modal")).toBeVisible();
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => window.__terminalCancelled)).toBe(1);
  });

  // 한글 입력 상태에서는 Ctrl+C 의 event.key 가 "ㅊ" 으로 온다(code 는 그대로 KeyC).
  test("한글 입력 상태의 Ctrl+C 도 중지된다", async ({ page }) => {
    await openTerminal(page);
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key:"ㅊ", code:"KeyC", ctrlKey:true, bubbles:true, cancelable:true
      }));
    });
    await expect.poll(() => page.evaluate(() => window.__terminalCancelled)).toBe(1);
  });

  // 터미널을 닫아도 명령은 계속 돌기 때문에, 버튼의 점이 유일한 "아직 돌고 있다" 표시가 된다.
  test("명령이 도는 동안 터미널 버튼에 실행 중 점이 켜진다", async ({ page }) => {
    await openTerminal(page);
    const button = page.locator("button.run-output-tab", { hasText: "터미널" });
    await expect(button).toHaveClass(/running/);

    await page.locator(".py-terminal-close").click();
    await expect(page.locator(".py-terminal-modal")).toBeHidden();
    await expect(button).toHaveClass(/running/);                  // 닫아도 점은 남는다
    await expect(button).toHaveAttribute("title", /실행 중/);

    await button.click();
    await page.locator(".terminal-stop").click();
    await expect(button).not.toHaveClass(/running/);              // 중지하면 꺼진다
  });

  test("중지 버튼도 같은 중지를 부른다", async ({ page }) => {
    await openTerminal(page);
    await page.locator(".terminal-stop").click();
    await expect.poll(() => page.evaluate(() => window.__terminalCancelled)).toBe(1);
  });
});
