const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { solidPng } = require("./helpers-png");

/* 저장 안 됨(●)은 껐다 켜도 기억한다(documents.js RESTORE_UNSAVED_KINDS). 그래서 '열기만 해도 문서가
   바뀌는' 편집기가 있으면 거짓 ● 가 저장 뒤에도 끈질기게 돌아온다 — 여행일지가 그랬다(지도가 장소에
   맞춰 움직이며 편집으로 쳤다). 같은 표식을 쓰는 종류마다 "열고 둘러보기만 → 저장 → 껐다 켜기"에서
   ● 가 한 번도 켜지지 않는지 본다. 여행일지·일기장은 각자 spec 에 따로 있다. */
const PNG = "data:image/png;base64," + solidPng(40, 30, [0, 120, 200]).toString("base64");
const KINDS = [
  { kind:"timeline", name:"확인.timeline", model:"timelineDoc", ser:"timelineDocSerialize", save:"saveTimelineDoc",
    build:`JSON.stringify({ type:TIMELINE_DOC_TYPE, version:TIMELINE_DOC_VERSION, title:"조선", purpose:"trip", events:[
      { id:"a", title:"경복궁", start:"1395", placeName:"경복궁", lat:37.5796, lng:126.977 },
      { id:"b", title:"창덕궁", start:"1405", end:"1412", category:"궁궐", lat:37.5794, lng:126.991 },
      { id:"c", title:"수원 화성", start:"1796", lat:37.287, lng:127.012 } ] })` },
  { kind:"concept", name:"확인.concept", model:"conceptDoc", ser:"conceptDocSerialize", save:"saveConceptDoc",
    build:`JSON.stringify({ type:"classdock-concept", version:1, title:"물의 순환", nodes:[
      { id:"sun", title:"햇빛", category:"에너지", description:"바다를 데운다", x:560, y:420 },
      { id:"vapor", title:"수증기", category:"물질", description:"올라간다", x:1200, y:420 },
      { id:"cloud", title:"구름", category:"물질", description:"비가 된다", x:560, y:760 } ],
      edges:[{ id:"e1", from:"sun", to:"vapor", type:"cause", label:"데워서" }] })` },
  { kind:"study", name:"확인.study", model:"studyDoc", ser:"studyDocSerialize", save:"saveStudyDoc",
    build:`JSON.stringify({ type:STUDY_DOC_TYPE, version:STUDY_DOC_VERSION, title:"단어", cards:[
      { id:"c1", front:"apple", back:"사과" }, { id:"c2", type:"cloze", front:"수도는 {{서울}}" },
      { id:"c3", front:"banana", back:"바나나", tags:"과일" } ] })` },
  { kind:"mnote", name:"확인.mnote", model:"mnote", ser:"mnoteSerialize", save:"saveMnote",
    build:`JSON.stringify({ format:MNOTE_FORMAT, version:MNOTE_VERSION, title:"메모", blocks:[
      { type:"text", text:"첫 줄 둘째 줄" }, { type:"table", header:true, rows:[["이름","값"],["가","1"]] },
      { type:"image", src:"${PNG}" }, { type:"text", text:"끝" } ] })` },
  { kind:"map", name:"확인.map", model:"mapDoc", ser:"mapDocSerialize", save:"saveMapDoc",
    build:`(() => { const m = mapDocEmpty("제주"); m.center = [37.5, 127]; m.zoom = 7; m.route = true;
      m.markers = [{ id:"m1", lat:33.458, lng:126.942, title:"성산", name:"성산" }, { id:"m2", lat:33.506, lng:126.951, title:"우도", name:"우도" }];
      return mapDocSerialize(m); })()` },
  { kind:"music", name:"확인.msheet", model:"sheet", ser:"musicSerialize", save:"saveMusicSheet",
    build:`musicSerialize(musicExampleSheet("school-bell"))` },
];

for (const k of KINDS){
  test(k.kind + " — 열고 둘러보기만 해서는 '저장 안 됨'이 안 켜지고, 저장 뒤 껐다 켜도 깨끗하다", async ({ page }) => {
    await page.setViewportSize({ width:1400, height:900 });
    await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){} });
    await collapseSidebar(page);
    await page.goto("/");
    await expect(page.locator("#commandPaletteOpen")).toBeVisible();
    await page.evaluate(async ({ build, name }) => {
      const text = (0, eval)(build);
      await handleFiles([new File(["다른 탭"], "다른.txt", { type:"text/plain" })], {});
      await handleFiles([new File([text], name, { type:"application/json" })], {});
    }, { build:k.build, name:k.name });
    const dirtyOf = () => page.evaluate(name => { const d = docs.find(x => x.name === name); return d ? !!d.hasUnsavedEdits : null; }, k.name);
    const expectClean = async () => { await page.waitForTimeout(400); expect(await dirtyOf()).toBe(false); };
    const tab = () => page.locator("#docTabs .tab", { hasText:k.name }).first();

    await expectClean();
    await tab().click();
    await page.waitForTimeout(1000);
    await expectClean();
    // 고치지 않고 둘러보기만 — 가운데 클릭, 스크롤·Ctrl+휠, 창 크기, 다른 탭 갔다 오기
    const box = await page.locator(".office:not([hidden])").first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.keyboard.press("Escape");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.wheel(0, 400); await page.mouse.wheel(300, 0);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -300); await page.keyboard.up("Control");
    await page.setViewportSize({ width:1000, height:780 });
    await page.locator("#docTabs .tab", { hasText:"다른.txt" }).first().click();
    await tab().click();
    await expectClean();

    await page.evaluate(async ({ name, save }) => { window.saveTextDoc = async () => true; await window[save](docs.find(x => x.name === name)); }, k);
    await expectClean();
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator("#commandPaletteOpen")).toBeVisible();
    await expect.poll(dirtyOf, { timeout:15_000 }).toBe(false);
    await tab().click();
    await page.waitForTimeout(1000);
    await expectClean();
  });
}
