const { test, expect } = require("@playwright/test");

test("command palette opens and closes without console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.locator("#commandPaletteOpen").click();
  await expect(page.locator(".cmdk-overlay")).toBeVisible();
  await expect(page.locator(".cmdk-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cmdk-overlay")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a text document can be opened through the real file input", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("E2E regression content", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-note.txt");
  await expect(page.getByText("E2E regression content")).toBeVisible();
});

test("a new whiteboard initializes its canvas through the module boundary", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dzNewBoard").click();
  await expect(page.locator(".wb-canvas")).toBeVisible();
  await expect(page.locator("#activeFileName")).not.toHaveText("");
  await expect.poll(() => page.evaluate(() => typeof MNBoardRenderer)).toBe("object");
});
