const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 자바 편집기 자동완성 — 키워드만 나오던 것을 표준 클래스 이름·점 뒤 멤버·자동 import 까지 넓혔다.
   실행에는 JDK 가 필요하지만 자동완성은 편집기 안에서만 도는 일이라 브라우저에서 그대로 확인된다. */
const SOURCE = [
  "import java.util.*;",
  "",
  "public class Main {",
  "    public static void main(String[] args) {",
  "        Scanner sc = new Scanner(System.in);",
  "        List<String> names = new ArrayList<>();",
  "",
  "    }",
  "}",
  ""
].join("\n");

// import 를 새로 넣는 자리를 보는 본문 — package 만 있고 import 는 아직 없다.
const BARE = [
  "package school;",
  "",
  "public class Main {",
  "    public static void main(String[] args) {",
  "",
  "    }",
  "}",
  ""
].join("\n");

async function openJava(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "Main.java", mimeType: "text/x-java-source", buffer: Buffer.from(SOURCE, "utf8")
  });
  await expect(page.locator("textarea.code-input")).toBeVisible();
}

/* 본문을 정해진 것으로 되돌린 뒤, 빈 줄에 커서를 두고 이어서 친다.
   한 테스트에서 두 번 치는 경우가 있어 앞서 친 글자가 남아 있으면 커서 자리를 못 찾는다. */
async function typeOnBlankLine(page, text, source){
  await page.locator("textarea.code-input").click();
  await page.evaluate((src) => {
    const ta = document.querySelector("textarea.code-input");
    ta.value = src;
    ta.dispatchEvent(new Event("input", { bubbles:true }));
    const at = ta.value.indexOf("\n\n    }");
    ta.selectionStart = ta.selectionEnd = at + 1;
  }, source || SOURCE);
  await page.keyboard.type(text);
}

const names = (page) => page.locator(".code-complete-item .code-complete-name");

test.describe("자바 자동완성", () => {
  test("표준 클래스 이름이 나온다 — 키워드에 없는 Scanner 도", async ({ page }) => {
    await openJava(page);
    await typeOnBlankLine(page, "        Scan");
    await expect(names(page).filter({ hasText: /^Scanner$/ })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await typeOnBlankLine(page, "        StringB");
    await expect(names(page).filter({ hasText: /^StringBuilder$/ })).toHaveCount(1);
  });

  test("점 뒤에는 선언한 타입의 멤버가 나오고, 수락하면 괄호까지 붙는다", async ({ page }) => {
    await openJava(page);
    await typeOnBlankLine(page, "        sc.");
    await expect(names(page).filter({ hasText: /^nextInt$/ })).toHaveCount(1);
    await expect(names(page).filter({ hasText: /^nextLine$/ })).toHaveCount(1);
    // 인자 안내도 함께 보여 준다.
    await expect(page.locator(".code-complete-signature").first()).toHaveText("nextInt()");

    await page.keyboard.type("nextIn");
    await page.keyboard.press("Enter");
    expect(await page.locator("textarea.code-input").inputValue()).toContain("sc.nextInt()");
  });

  test("System. 다음에는 out·println 이 나온다", async ({ page }) => {
    await openJava(page);
    await typeOnBlankLine(page, "        System.");
    await expect(names(page).first()).toHaveText("out");
    await page.keyboard.type("out.");
    await expect(names(page).filter({ hasText: /^println$/ })).toHaveCount(1);
  });

  test("List 를 고르면 import java.util.List; 가 위에 적힌다", async ({ page }) => {
    await openJava(page);
    await typeOnBlankLine(page, "        Lis", BARE);
    await expect(names(page).filter({ hasText: /^List$/ })).toHaveCount(1);
    // 후보 줄에 어떤 import 가 붙는지 함께 보여 준다.
    await expect(page.locator(".code-complete-signature").first()).toHaveText("import java.util.List;");
    await page.keyboard.press("Enter");

    const value = await page.locator("textarea.code-input").inputValue();
    expect(value).toContain("import java.util.List;");
    // package 아래, 클래스 선언 위에 들어간다.
    expect(value.indexOf("import java.util.List;")).toBeGreaterThan(value.indexOf("package school;"));
    expect(value.indexOf("import java.util.List;")).toBeLessThan(value.indexOf("public class Main"));
    expect(value).toContain("        List");        // 본문에는 고른 이름만 들어간다
  });

  test("이미 import 한 이름은 다시 적지 않고 후보도 하나뿐이다", async ({ page }) => {
    await openJava(page);
    // 이 파일 맨 위는 import java.util.*; 라 java.util 것들은 이미 다 들어와 있다.
    await typeOnBlankLine(page, "        Scan");
    await expect(names(page).filter({ hasText: /^Scanner$/ })).toHaveCount(1);
    await page.keyboard.press("Enter");
    const value = await page.locator("textarea.code-input").inputValue();
    expect(value.match(/^import /gm).length).toBe(1);
  });

  test("고른 라이브러리의 클래스는 점 뒤 멤버까지 답한다", async ({ page }) => {
    await openJava(page);
    // 라이브러리 목록은 EXE 런처가 주므로 브라우저에서는 비어 있다. 고른 상태만 그대로 흉내 내
    // 편집기가 실제로 부르는 함수가 화면에 실려 있는지·무엇을 답하는지 확인한다.
    const picked = await page.evaluate(() =>
      window.javaMemberCompletionCandidates("Gson gson = new Gson();", "gson", "", { words:["Gson"] }).map((item) => item.name));
    expect(picked).toContain("toJson");
    expect(picked).toContain("fromJson");
    // 고르지 않았으면 답하지 않는다 — 실행에 안 들어갈 코드를 권하지 않는다.
    const none = await page.evaluate(() =>
      window.javaMemberCompletionCandidates("Gson gson = new Gson();", "gson", "", { words:[] }).length);
    expect(none).toBe(0);

    // 직접 받은 jar 는 서버가 javap 로 뽑아 온 표로 답한다(메서드는 괄호가 붙어 온다).
    const fromJar = await page.evaluate(() =>
      window.javaMemberCompletionCandidates("FileUtils utils = null;", "utils", "", {
        words:[], members:{ FileUtils:"readFileToString() EMPTY_FILE_ARRAY" }
      }).map((item) => item.name + ":" + item.type));
    expect(fromJar).toEqual(["readFileToString:function", "EMPTY_FILE_ARRAY:property"]);
  });

  test("선언한 적 없는 이름에는 엉뚱한 후보를 내지 않는다", async ({ page }) => {
    await openJava(page);
    await typeOnBlankLine(page, "        names.");
    await expect(names(page).filter({ hasText: /^add$/ })).toHaveCount(1);   // 선언된 List 는 나오고
    await page.keyboard.press("Escape");
    await typeOnBlankLine(page, "        nobody.");
    await expect(names(page).filter({ hasText: /^add$/ })).toHaveCount(0);   // 모르는 이름에는 안 나온다
  });
});
