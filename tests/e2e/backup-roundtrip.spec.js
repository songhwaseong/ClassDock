const { test, expect } = require("@playwright/test");
const { boot, makeBoard, exportBackup, restoreBackup, roundTrip } = require("./helpers-backup");

/* 전체 백업 ZIP 내보내기 → 복원 왕복.
 *
 * 단위 테스트는 형식(매니페스트·보드 중복 제거 규칙)만 지킨다. 여기서는 진짜 브라우저에서
 * 한 바퀴를 돌려, 그 사이의 것들 — JSZip 3.x 로드, IndexedDB 덤프, 작업공간 바이트,
 * localStorage 교체, 새로고침 뒤의 탭 복원 — 이 실제로 이어지는지 본다.
 *
 * 지켜야 할 것 두 가지가 여기서 나왔다.
 *  1) 화이트보드 탭은 지금 탭 상태(classdock-tabs:v1)와 작업공간 기록이 이미 되살린다.
 *     백업 매니페스트의 목록으로 또 만들면 같은 판서가 두 벌이 된다.
 *  2) 확인을 누른 뒤 새로고침까지의 짧은 사이에도 앱의 자동 저장 타이머가 돌고 있어,
 *     방금 되돌린 localStorage 를 복원 전 상태가 덮어썼다(백업에 없던 탭이 되살아났다).
 *
 * 지연 로드 경로가 배포본마다 다르므로 양쪽에서 본다(lazy-vendor.spec.js 와 같은 이유).
 *   · "/"                       = 원본 HTML → vendor 스크립트를 그때 붙이는 경로
 *   · "/classdock-offline.html" = 단일 파일(EXE 와 같은 산출물) → 심어 둔 text/plain 실행 경로
 */

const PAGES = [
  { name: "원본 HTML", url: "/" },
  { name: "단일 파일(EXE 산출물)", url: "/classdock-offline.html" }
];

for (const target of PAGES){
  test(`백업 ZIP을 만들고 되돌리면 화이트보드가 중복 없이 그대로 돌아온다 — ${target.name}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await boot(page, target.url);
    await roundTrip(page);
    expect(errors).toEqual([]);
  });

  test(`백업은 JSZip 3.x 로 만들고 전역 JSZip 은 2.6.1 로 되돌려 놓는다 — ${target.name}`, async ({ page }) => {
    await boot(page, target.url);
    await makeBoard(page, "판서");
    await exportBackup(page);

    const zip = await page.evaluate(() => ({
      modernLoaded: MNLazy.isLoaded("jszipModern"),
      modernIsV3: typeof MNLazy.modernZip() === "function"
        && typeof MNLazy.modernZip().loadAsync === "function",
      // PPTXjs·엑셀 복구가 쓰는 동기 API 2.6.1 이 전역에 그대로 남아 있어야 한다.
      globalIsV2: typeof window.JSZip === "function" && typeof window.JSZip.loadAsync !== "function"
    }));
    expect(zip).toEqual({ modernLoaded: true, modernIsV3: true, globalIsV2: true });
  });
}

test("화면보호기 영상 이름은 백업에 실리지 않고 복원해도 이 PC 값이 남는다", async ({ page }) => {
  await boot(page, "/");
  await page.evaluate(() => localStorage.setItem("mnScreensaverVideoNames", JSON.stringify(["내보낼때.mp4"])));
  await makeBoard(page, "판서");

  const zipPath = await exportBackup(page);
  await page.evaluate(() => localStorage.setItem("mnScreensaverVideoNames", JSON.stringify(["이PC영상.mp4"])));

  await restoreBackup(page, zipPath);

  // 영상 자체는 백업하지 않으므로, 이름도 이 PC 값이 그대로여야 한다(없는 영상이 목록에 뜨지 않게).
  expect(await page.evaluate(() => localStorage.getItem("mnScreensaverVideoNames")))
    .toBe(JSON.stringify(["이PC영상.mp4"]));
});
