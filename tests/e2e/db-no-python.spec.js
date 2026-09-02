const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 파이썬이 없는 컴퓨터에서의 접속 화면
 *
 * DB 접속은 런처가 db_worker.py 를 띄워서 한다. 파이썬을 찾지 못하면 런처는
 * /db-session-open 에 501 "no-python" 을 돌려준다(launcher.cs 의 PythonMissingException).
 * e2e 정적 서버에는 그 엔드포인트가 없으므로, 여기서는 런처가 주는 응답을 그대로 흉내 내어
 * 화면 쪽 계약만 지킨다 — 짧은 코드가 그대로 새지 않고, 사람 말과 다음 행동이 함께 뜨는가.
 */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// 파이썬을 못 찾은 런처 흉내. sessions 를 채워 두면 그 다음 연결부터는 성공한다.
async function stubLauncher(page, state){
  await page.route("**/db-session-open", (route) => {
    state.opens++;
    if (!state.python) return route.fulfill({ status:501, contentType:"text/plain; charset=utf-8", body:"no-python" });
    route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
      ok:true, id:"sess-1", readOnly:true, autoCommit:true, label:"root@127.0.0.1", info:{ serverVersion:"8.0.36" }
    }) });
  });
  await page.route("**/python-rescan", (route) => {
    state.rescans++;
    route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify(
      state.python ? { ok:true, command:"py", version:"Python 3.12.1", pip:true, jedi:false }
                   : { ok:false, command:"", version:"", pip:false, jedi:false }) });
  });
  // 연결에 성공한 뒤 화면이 부르는 것들(스키마 트리). 여기서 볼 것은 아니므로 비워서 답한다.
  await page.route("**/db-schema?**", (route) =>
    route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ok:true, objects:[], database:"" }) }));
}

async function fillAndConnect(page){
  const form = page.locator(".db-connect");
  await expect(form).toBeVisible();
  await form.locator("input[type=text]").first().fill("127.0.0.1");
  await form.locator("input[type=text]").nth(2).fill("root");
  await form.locator("input[type=password]").fill("hunter2");
  await form.locator(".db-btn-primary").click();
  return form;
}

test("파이썬이 없으면 이유·설치 순서·다시 검사가 함께 뜬다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  const state = { python:false, opens:0, rescans:0 };
  await stubLauncher(page, state);

  await page.evaluate(() => newDbConnScratch());
  const form = await fillAndConnect(page);

  const help = page.locator(".db-python-help");
  await expect(help).toBeVisible();
  await expect(help.locator("strong")).toHaveText("이 컴퓨터에서 Python 을 찾지 못했습니다");
  // 초보자가 가장 많이 걸리는 함정(PATH 체크)이 안내에 있어야 한다.
  await expect(help.locator(".db-help-steps li")).toHaveCount(3);
  await expect(help).toContainText("Add python.exe to PATH");
  expect(state.opens).toBe(1);

  // 접속 화면 그대로 — 작업 영역은 열리지 않고, 버튼은 다시 누를 수 있다.
  await expect(form).toBeVisible();
  await expect(page.locator(".db-workspace")).toBeHidden();
  await expect(form.locator(".db-btn-primary")).toBeEnabled();
  await expect(form.locator(".db-btn-primary")).toHaveText("연결");

  // 아직 설치하지 않은 채 '다시 검사' 를 누르면 그 사실을 말해 주고 안내는 그대로 남는다.
  const rescan = help.getByRole("button", { name:"다시 검사" });
  await rescan.click();
  await expect(page.locator(".db-help-note")).toContainText("아직 찾지 못했습니다");
  await expect(rescan).toBeEnabled();
  expect(state.rescans).toBe(1);
  expect(state.opens).toBe(1);          // 못 찾았으면 접속을 다시 시도하지 않는다

  expect(errors).toEqual([]);
});

test("설치한 뒤 '다시 검사' 를 누르면 exe 재시작 없이 이어서 연결한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  const state = { python:false, opens:0, rescans:0 };
  await stubLauncher(page, state);

  await page.evaluate(() => newDbConnScratch());
  await fillAndConnect(page);
  await expect(page.locator(".db-python-help")).toBeVisible();

  state.python = true;                  // 사용자가 파이썬을 설치했다
  await page.locator(".db-python-help").getByRole("button", { name:"다시 검사" }).click();

  // 캐시를 비운 런처가 파이썬을 찾으면, 비밀번호가 아직 칸에 있는 그 자리에서 연결까지 이어진다.
  await expect(page.locator(".db-workspace")).toBeVisible();
  await expect(page.locator(".db-connect")).toBeHidden();
  expect(state.rescans).toBe(1);
  expect(state.opens).toBe(2);
  await expect(page.locator(".db-python-help")).toHaveCount(0);

  expect(errors).toEqual([]);
});
