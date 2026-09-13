const { test, expect } = require("@playwright/test");
const { spawnSync } = require("child_process");
const { collapseSidebar } = require("./helpers");

/* 단계 실행 '그림으로 보기'(프레임·객체 상자·화살표).
 *
 * 기록 스크립트는 앱이 만든 그대로를 이 컴퓨터 파이썬으로 돌려 실제 보고서를 얻고,
 * 브라우저 실행(Pyodide Worker)은 그 출력을 돌려주는 가짜로 바꿔 끼운다.
 * 파이썬이 없는 환경이면 건너뛴다.
 */
const hasPython = spawnSync("python", ["--version"], { encoding:"utf8" }).status === 0;

const SOURCE = [
  "def fact(n):",
  "    if n <= 1:",
  "        return 1",
  "    return n * fact(n - 1)",
  "a = [1, 2]",
  "b = a",
  "b.append(fact(3))",
  "print('done', a)",
  ""
].join("\n");

async function openTrace(page, source){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "trace.py", mimeType: "text/x-python", buffer: Buffer.from(source, "utf8")
  });
  await expect(page.locator(".run-go")).toBeVisible();
  const harness = await page.evaluate((src) => buildPythonTraceHarness(src, "trace.py", 300), source);
  const run = spawnSync("python", ["-"], { input:harness, encoding:"utf8" });
  expect(run.status).toBe(0);
  await page.evaluate((stdout) => {
    window.pythonBackendAvailable = async () => false;
    window.ensurePyodideWorker = async () => {};
    window.preparePyodideWorkerPackages = async () => ({ urls:[], names:[] });
    window.startPyodideWorkerRun = () => ({
      promise: Promise.resolve({ stdout, stderr:"", code:0, outputs:[] }),
      cancel(){}
    });
  }, run.stdout);
  await page.evaluate(() => document.querySelector(".run-trace").click());
  await expect(page.locator(".py-trace-controls")).toBeVisible();
}

// 슬라이더를 조건에 맞는 첫 단계로 옮긴다(단계 번호는 파이썬 버전에 따라 조금씩 달라서 번호로 짚지 않는다).
async function seekStep(page, predicateSource){
  const index = await page.evaluate((src) => {
    const panel = document.querySelector(".py-trace-controls").closest(".code-output") || document;
    const slider = panel.querySelector(".py-trace-controls input[type=range]");
    const max = Number(slider.max);
    const test = new Function("doc", "return (" + src + ")(doc)");
    for (let i = 0; i <= max; i++){
      slider.value = String(i);
      slider.dispatchEvent(new Event("input", { bubbles:true }));
      if (test(document)) return i;
    }
    return -1;
  }, predicateSource);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

test.describe("단계 실행 그림 보기", () => {
  test.skip(!hasPython, "로컬 파이썬이 없어 기록 보고서를 만들 수 없음");

  test("두 이름이 한 리스트를 가리키면 상자는 하나, 화살표는 둘", async ({ page }) => {
    await openTrace(page, SOURCE);
    await expect(page.locator(".py-mem")).toBeVisible();
    await seekStep(page, `doc => {
      const names = [...doc.querySelectorAll(".py-mem-frame.is-current .py-mem-name")].map(el => el.textContent);
      return names.includes("a") && names.includes("b");
    }`);
    const frame = page.locator(".py-mem-frame.is-current");
    await expect(frame.locator(".py-mem-frame-head")).toHaveText("전역");
    await expect(frame.locator(".py-mem-ptr")).toHaveCount(2);
    await expect(page.locator(".py-mem-obj.is-seq")).toHaveCount(1);
    // 화살표 두 개가 모두 같은 상자 왼쪽 가장자리에서 끝난다.
    const ends = await page.evaluate(() => {
      const inner = document.querySelector(".py-mem-inner").getBoundingClientRect();
      const box = document.querySelector(".py-mem-obj.is-seq").getBoundingClientRect();
      return [...document.querySelectorAll(".py-mem-arrows g path")].map(path => {
        const length = path.getTotalLength();
        const p = path.getPointAtLength(length);
        return { dx: Math.abs(p.x - (box.left - inner.left)), dy: Math.abs(p.y - (box.top - inner.top + 13)) };
      });
    });
    expect(ends).toHaveLength(2);
    for (const end of ends){ expect(end.dx).toBeLessThan(3); expect(end.dy).toBeLessThan(3); }
    // b.append 뒤 단계에서는 상자가 바뀜 표시를 받는다.
    await seekStep(page, `doc => [...doc.querySelectorAll(".py-mem-obj.is-seq .py-mem-slot")].length === 3`);
    await expect(page.locator(".py-mem-obj.is-seq")).toHaveClass(/is-changed/);
  });

  test("재귀 호출은 프레임이 쌓이고, 출력은 그 단계까지만 보인다", async ({ page }) => {
    await openTrace(page, SOURCE);
    await seekStep(page, `doc => doc.querySelectorAll(".py-mem-frame").length === 4`);
    await expect(page.locator(".py-mem-frame-head")).toHaveText(["전역", "fact()", "fact()", "fact()"]);
    await expect(page.locator(".py-mem-frame.is-current")).toHaveCount(1);
    await expect(page.locator(".py-trace-printed pre")).toHaveText("(아직 출력 없음)");
    await page.locator(".py-trace-controls input[type=range]").evaluate((slider) => {
      slider.value = slider.max; slider.dispatchEvent(new Event("input", { bubbles:true }));
    });
    await expect(page.locator(".py-trace-printed pre")).toHaveText("done [1, 2, 6]");
  });

  test("표로 보기로 바꾸면 예전 표가 나오고, 고른 보기가 다음에도 이어진다", async ({ page }) => {
    await openTrace(page, SOURCE);
    await page.locator(".py-trace-views button", { hasText: "표로 보기" }).click();
    await expect(page.locator(".py-mem")).toHaveCount(0);
    await expect(page.locator(".py-trace-vars")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mn.pyTraceView"))).toBe("table");
    await page.evaluate(() => document.querySelector(".run-trace").click());
    await expect(page.locator(".py-trace-views button.is-on")).toHaveText("표로 보기");
    await expect(page.locator(".py-trace-vars")).toBeVisible();
  });
});
