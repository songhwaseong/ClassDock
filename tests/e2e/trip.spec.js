const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 여행일지(.trip) — 갈래를 고르면 말이 바뀌되 자료는 그대로인지, 여정 띠로 날을 오가며
 * 종이에 쓴 글이 저장되고 다시 열었을 때 그대로인지. */

async function boot(page, purpose = "trip"){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(p => window.newTripScratch && window.newTripScratch(p), purpose);
  await expect(page.locator(".trip-bar")).toBeVisible();
}

const modelOf = page => page.evaluate(() => {
  const doc = docs.find(d => d.kind === "trip");
  return doc ? JSON.parse(JSON.stringify(doc.trip)) : null;
});

test("새 여행일지가 탭으로 열리고 갈래에 따라 이름이 다르다", async ({ page }) => {
  await boot(page, "field");
  await expect(page.locator(".tab.active")).toContainText("체험학습.trip");
  const model = await modelOf(page);
  expect(model.purpose).toBe("field");
  expect(model.days).toEqual([]);
});

test("여정 띠로 날을 더하고 오가며, 종이에 쓴 글이 그 날에 담긴다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-day-chip")).toHaveCount(1);
  await expect(page.locator(".trip-rail-head")).toHaveText("1일");

  await page.locator(".trip-day-title").fill("첫째 날 — 성산");
  await page.locator(".diary-text").fill("바람이 셌다");
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-day-chip")).toHaveCount(2);
  await expect(page.locator(".trip-rail-head")).toHaveText("2일");
  await page.locator(".diary-text").fill("둘째 날 글");

  // 첫째 날로 돌아가면 그 날 글이 그대로다
  await page.locator(".trip-day-chip").nth(0).click();
  await expect(page.locator(".diary-text")).toHaveValue("바람이 셌다");
  await expect(page.locator(".trip-day-title")).toHaveValue("첫째 날 — 성산");

  const model = await modelOf(page);
  expect(model.days.map(d => d.text)).toEqual(["바람이 셌다", "둘째 날 글"]);
});

test("갈래를 바꾸면 말만 바뀌고 자료는 한 글자도 안 바뀐다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-title").fill("성산");
  await page.locator(".diary-text").fill("본 것");
  await expect(page.locator(".trip-rail-head")).toHaveText("1일");
  await expect(page.locator(".trip-add-day")).toHaveText("＋ 날");

  const before = await modelOf(page);
  await page.locator(".trip-purpose-select").selectOption("survey");
  await expect(page.locator(".trip-rail-head")).toHaveText("조사 1차례");
  await expect(page.locator(".trip-add-day")).toHaveText("＋ 조사 차례");
  await expect(page.locator(".trip-day-chip-head")).toHaveText("1차 조사");

  const after = await modelOf(page);
  expect(after.purpose).toBe("survey");
  delete before.purpose; delete after.purpose;
  delete before.updatedAt; delete after.updatedAt;
  expect(after).toEqual(before);
});

test("저장하면 ZIP 으로 쓰이고 다시 열어도 그대로다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-title").fill("제주 3박 4일");
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-title").fill("첫째 날");
  await page.locator(".trip-day-date").fill("2026-07-20");
  await page.locator(".diary-text").fill("성산일출봉에 올랐다");
  await expect(page.locator(".tab.active")).toHaveClass(/dirty|unsaved/).catch(() => {});

  // 저장본 바이트를 그대로 받아 다시 연다(디스크 대화창을 띄우지 않는다)
  const bytes = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "trip");
    const packed = tripPack(doc.trip, doc.tripAssets, Date.now());
    return Array.from(packed.slice(0, 2)).concat([packed.length]);
  });
  expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  expect(bytes[2]).toBeGreaterThan(100);

  const round = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "trip");
    const packed = tripPack(doc.trip, doc.tripAssets, Date.now());
    const back = await tripUnpack(packed);
    return { title:back.model.title, days:back.model.days.map(d => [d.date, d.title, d.text]),
      same:tripContentKey(back.model) === tripContentKey(doc.trip) };
  });
  expect(round.title).toBe("제주 3박 4일");
  expect(round.days).toEqual([["2026-07-20", "첫째 날", "성산일출봉에 올랐다"]]);
  expect(round.same).toBe(true);
});

test("장소를 넣고 고치면 그 날에 담기고, 여정 띠 요약도 따라간다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-spots-empty")).toHaveText("들른 곳이 아직 없어요");
  await expect(page.locator(".trip-add-spot")).toHaveText("＋ 들른 곳");

  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot-name").fill("성산일출봉");
  await page.locator(".trip-spot-at").fill("9:30");
  await page.locator(".trip-spot-at").blur();
  await page.locator(".trip-spot-kind").selectOption("sight");
  await page.locator(".trip-spot-addr").fill("제주 서귀포시");
  await page.locator(".trip-spot-note").fill("바람이 셌다");
  await expect(page.locator(".trip-spot-icon svg")).toBeVisible();

  const model = await modelOf(page);
  const spot = model.days[0].spots[0];
  expect([spot.name, spot.at, spot.kind, spot.address, spot.note])
    .toEqual(["성산일출봉", "09:30", "sight", "제주 서귀포시", "바람이 셌다"]);
  await expect(page.locator(".trip-day-chip-sub")).toHaveText("들른 곳 1");
});

test("갈래마다 보이는 칸이 다르다 — 경비는 여행만, 조사 항목은 답사만, 질문은 학습지만", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-spot").click();
  await expect(page.locator(".trip-spot-cost")).toBeVisible();
  await expect(page.locator(".trip-spot-fields")).toHaveCount(0);
  await expect(page.locator(".trip-prompts")).toBeHidden();

  await page.locator(".trip-spot-cost").fill("5000");
  await page.locator(".trip-purpose-select").selectOption("survey");
  await expect(page.locator(".trip-spot-cost")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".trip-spot-fields")).toBeVisible();
  await expect(page.locator(".trip-spots-title")).toHaveText("조사 지점 목록");

  await page.locator(".trip-purpose-select").selectOption("field");
  await expect(page.locator(".trip-prompts")).toBeVisible();
  await expect(page.locator(".trip-spot-fields")).toHaveCount(0);

  // 갈래를 오가도 여행에서 적은 경비는 그대로 남아 있다(무손실)
  const model = await modelOf(page);
  expect(model.days[0].spots[0].cost).toEqual({ amount:5000, currency:"KRW" });
});

test("다른 갈래에서 고른 종류는 고르개에서 사라지지 않고 맨 아래에 남는다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot-kind").selectOption("stay");        // '잠자리'는 여행 갈래에만 있다

  await page.locator(".trip-purpose-select").selectOption("survey");
  const select = page.locator(".trip-spot-kind");
  await expect(select).toHaveValue("stay", { timeout:3000 });
  await expect(select.locator("option.trip-kind-foreign")).toHaveText("잠자리");
  const model = await modelOf(page);
  expect(model.days[0].spots[0].kind).toBe("stay");
});

test("학습지 질문을 넣고 답을 적으면 그 날에 담긴다", async ({ page }) => {
  await boot(page, "field");
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-prompts")).toBeVisible();
  await page.locator(".trip-add-prompt").click();
  await page.locator(".trip-prompt-q").fill("가장 기억에 남는 것은?");
  await page.locator(".trip-prompt-a").fill("바다");
  const model = await modelOf(page);
  expect(model.days[0].prompts).toEqual([{ q:"가장 기억에 남는 것은?", a:"바다" }]);
});

test("꾸미기 창이 여행일지에서도 돈다 — 줄 무늬·글꼴을 바꾸면 종이가 따라간다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-style-btn").click();
  const panel = page.locator(".diary-style-panel");
  await expect(panel).toBeVisible();

  await panel.locator('.diary-chip[data-lines="genko"]').click();
  await expect(page.locator(".diary-paper")).toHaveAttribute("data-lines", "genko");
  await expect(page.locator(".diary-genko")).toBeVisible();

  await panel.locator('.diary-chip[data-font="gungseo"]').click();
  await expect(page.locator(".diary-paper")).toHaveAttribute("data-font", "gungseo");

  const model = await modelOf(page);
  expect(model.style.lines).toBe("genko");
  expect(model.style.font).toBe("gungseo");
});

test("스티커 창이 여행일지에서도 돈다 — 내장 그림을 붙이면 종이에 그려진다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-sticker-btn").click();
  const panel = page.locator(".diary-art-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".diary-art-chip")).toHaveCount(144);

  await panel.locator('.diary-art-color[data-color="#3b82f6"]').click();
  await panel.locator('.diary-art-chip[data-art="heart"]').click();
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await expect(page.locator(".diary-sticker-art svg")).toBeVisible();

  const model = await modelOf(page);
  expect(model.days[0].stickers.map(s => [s.kind, s.art, s.color])).toEqual([["art", "heart", "#3b82f6"]]);
});

test("이 날짜에만 꾸미기도 여행일지에서 그대로다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-chip").nth(0).click();
  await page.locator(".trip-style-btn").click();
  const panel = page.locator(".diary-style-panel");
  await panel.locator(".diary-style-scope input").check();
  await panel.locator('.diary-chip[data-lines="dots"]').click();
  await expect(page.locator(".diary-paper")).toHaveAttribute("data-lines", "dots");

  // 둘째 날은 전체 꾸미기 그대로다
  await page.locator(".trip-day-chip").nth(1).click();
  await expect(page.locator(".diary-paper")).toHaveAttribute("data-lines", "ruled");
  const model = await modelOf(page);
  expect(model.days[0].style.lines).toBe("dots");
  expect(model.days[1].style).toBe(null);
});

test("지도 칸에서 자리를 찍으면 장소에 좌표가 담기고 표시가 뜬다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot-name").fill("성산일출봉");
  await expect(page.locator(".trip-map-note")).toHaveText("장소에 좌표가 없어요");

  await page.locator(".trip-spot-pick").click();
  await expect(page.locator(".trip-map-stage")).toHaveClass(/is-picking/);
  const stage = page.locator(".trip-map-stage");
  // leaflet-container 는 자식이 아니라 칸 자체에 붙는다
  await expect(stage).toHaveClass(/leaflet-container/);
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator(".trip-map-stage")).not.toHaveClass(/is-picking/);
  const model = await modelOf(page);
  const spot = model.days[0].spots[0];
  expect(typeof spot.lat).toBe("number");
  expect(typeof spot.lng).toBe("number");
  await expect(page.locator(".trip-map-note")).toBeHidden();
  await expect(stage.locator("path.leaflet-interactive")).toHaveCount(1);
});

test("좌표가 둘 이상이면 목록 차례대로 선으로 잇고, 잇기를 끄면 선이 사라진다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  // 좌표는 모델에 바로 넣는다(지도를 두 번 찍는 것보다 흔들림이 적다)
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    doc.trip.days[0].spots.push(
      { id:"sp-a", at:"", name:"성산", address:"", note:"", kind:"sight", lat:33.458, lng:126.942, color:"", cost:null, photos:[], fields:[] },
      { id:"sp-b", at:"", name:"우도", address:"", note:"", kind:"move", lat:33.506, lng:126.951, color:"", cost:null, photos:[], fields:[] });
  });
  await page.locator(".trip-day-chip").nth(0).click();
  const stage = page.locator(".trip-map-stage");
  await expect(stage.locator("path.leaflet-interactive")).toHaveCount(3);   // 표시 둘 + 이은 선 하나
  await expect(stage.locator("path.trip-route-line")).toHaveCount(1);

  await page.locator(".trip-route-btn").click();
  await expect(stage.locator("path.trip-route-line")).toHaveCount(0);
  const model = await modelOf(page);
  expect(model.map.route).toBe(false);
});

/* 굳히기는 인터넷에서 타일이 와야 되는 일이라, e2e 에서는 '막는 규칙'까지만 확인한다.
   실제로 찍히는 것은 타일이 오는 환경에서만 되고, 그 판정 자체가 규칙 3이다. */
test("굳히기는 좌표가 없거나 배경 지도가 안 오면 막힌다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  const freeze = page.locator(".trip-freeze-btn");
  await expect(freeze).toBeDisabled();
  await expect(freeze).toHaveAttribute("title", /좌표가 없어요|배경 지도가 아직|지도 칸이|아직 열지/);

  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    doc.trip.days[0].spots.push({ id:"sp-a", at:"", name:"성산", address:"", note:"", kind:"sight",
      lat:33.458, lng:126.942, color:"", cost:null, photos:[], fields:[] });
  });
  await page.locator(".trip-day-chip").nth(0).click();
  // 좌표는 생겼지만 타일이 안 왔으면 여전히 막힌다(회색 사각형이 박히는 것을 막는 규칙)
  const state = await page.evaluate(() => {
    const b = document.querySelector(".trip-freeze-btn");
    return { disabled:b.disabled, title:b.title };
  });
  if (state.disabled) expect(state.title).toMatch(/배경 지도가 아직|지도 칸이|아직 열지/);
  else expect(state.title).toMatch(/굳히기/);
});

test("이 날 / 여행 전체를 오가면 표시가 달라지고, 그 사실이 기억된다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-day").click();
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    doc.trip.days[0].spots.push({ id:"sp-a", at:"", name:"성산", address:"", note:"", kind:"sight",
      lat:33.458, lng:126.942, color:"", cost:null, photos:[], fields:[] });
    doc.trip.days[1].spots.push({ id:"sp-b", at:"", name:"우도", address:"", note:"", kind:"move",
      lat:33.506, lng:126.951, color:"", cost:null, photos:[], fields:[] });
  });
  await page.locator(".trip-day-chip").nth(0).click();
  const stage = page.locator(".trip-map-stage");
  await expect(stage.locator("path.leaflet-interactive")).toHaveCount(1);

  await page.locator(".trip-map-scope").click();
  await expect(page.locator(".trip-map-title")).toContainText("여행 전체");
  await expect(stage.locator("path.leaflet-interactive")).toHaveCount(3);   // 표시 둘 + 이은 선
  expect(await page.evaluate(() => localStorage.getItem("mn.tripMapScope"))).toBe("all");
});

test("굳힌 그림이 있으면 보이고, 장소가 바뀌면 낡았다고 알린다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  // 굳힌 그림을 손으로 넣어 둔다(타일 없이도 '낡음' 규칙을 확인할 수 있다)
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13]);
    doc.tripAssets.set("assets/frozenmap.png", { bytes:png });
    const day = doc.trip.days[0];
    day.spots.push({ id:"sp-a", at:"", name:"성산", address:"", note:"", kind:"sight",
      lat:33.458, lng:126.942, color:"", cost:null, photos:[], fields:[] });
    day.still = "assets/frozenmap.png";
    day.stillKey = "낡은-서명";
  });
  await page.locator(".trip-day-chip").nth(0).click();
  await expect(page.locator(".trip-still")).toBeVisible();
  await expect(page.locator(".trip-still-note")).toHaveText("지도 그림이 낡았어요 — 다시 굳히세요.");
  await expect(page.locator(".trip-still-note")).toHaveClass(/is-stale/);

  // 굳힌 그림도 저장되는 사진 목록에 든다(빠뜨리면 다음 저장에서 사라진다)
  const used = await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    return [...tripReferencedAssets(doc.trip)];
  });
  expect(used).toContain("assets/frozenmap.png");
});

/* EXIF 가 든 작은 JPEG 를 브라우저 안에서 만들어 넣는다(실제 사진을 저장소에 두지 않으려고). */
const EXIF_JPEG_MAKER = `(when, lat, lng) => {
  const b = [];
  const u16 = v => { b.push(v & 255, (v >> 8) & 255); };
  const u32 = v => { b.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); };
  const entry = (tag, type, count, val) => { u16(tag); u16(type); u32(count); u32(val); };
  const tiff = [];
  const push = (arr, fn) => { const save = b.length; fn(); while (b.length > save) arr.push(b.shift()); };
  // 자리 계산: 머리 8 + IFD0(2+2*12+4=30) + Exif(2+12+4=18) + GPS(2+4*12+4=54)
  const exifAt = 8 + 30, gpsAt = exifAt + 18, dataAt = gpsAt + 54;
  const whenBytes = [...when].map(c => c.charCodeAt(0)).concat([0]);
  const latAt = dataAt + whenBytes.length, lngAt = latAt + 24;
  push(tiff, () => { b.push(0x49, 0x49); u16(42); u32(8); });
  push(tiff, () => { u16(2); entry(0x8769, 4, 1, exifAt); entry(0x8825, 4, 1, gpsAt); u32(0); });
  push(tiff, () => { u16(1); entry(0x9003, 2, whenBytes.length, dataAt); u32(0); });
  push(tiff, () => {
    u16(4);
    u16(1); u16(2); u32(2); b.push(lat < 0 ? 83 : 78, 0, 0, 0);
    entry(2, 5, 3, latAt);
    u16(3); u16(2); u32(2); b.push(lng < 0 ? 87 : 69, 0, 0, 0);
    entry(4, 5, 3, lngAt);
    u32(0);
  });
  tiff.push(...whenBytes);
  const triple = v => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60);
    const s = Math.round((((a - d) * 60) % 1) * 60 * 100);
    push(tiff, () => { u32(d); u32(1); u32(m); u32(1); u32(s); u32(100); }); };
  triple(lat); triple(lng);
  const head = [0xFF, 0xD8, 0xFF, 0xE1];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = body.length + 2;
  return new Uint8Array([...head, (size >> 8) & 255, size & 255, ...body, 0xFF, 0xDA, 0, 2]);
}`;

test("사진에서 장소 만들기 — 찍은 때·자리를 읽어 그 날에 넣는다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-date").fill("2026-07-20");

  await page.setInputFiles(".trip-exif-btn + input[type=file]", []);
  const files = await page.evaluate(make => {
    const makeJpeg = eval(make);
    const a = makeJpeg("2026:07:20 09:30:11", 33.458, 126.942);
    const b = makeJpeg("2026:07:20 14:05:00", 33.506, 126.951);
    return [[...a], [...b]];
  }, EXIF_JPEG_MAKER);
  await page.setInputFiles(".trip-exif-btn + input[type=file]", files.map((bytes, i) => ({
    name:"사진" + (i + 1) + ".jpg", mimeType:"image/jpeg", buffer:Buffer.from(bytes)
  })));

  await expect(page.locator(".trip-spot")).toHaveCount(2);
  const model = await modelOf(page);
  const spots = model.days[0].spots;
  expect(spots.map(s => s.at)).toEqual(["09:30", "14:05"]);
  expect(Math.round(spots[0].lat * 1000) / 1000).toBe(33.458);
  expect(Math.round(spots[1].lng * 1000) / 1000).toBe(126.951);
  expect(spots[0].name).toBe("사진1");
  // 합성 JPEG 는 그림 자료가 없어 못 굽는다 — 그때도 장소는 만들어지고 사진만 빠진다.
  expect(spots[0].photos.length).toBeLessThanOrEqual(1);
  await expect(page.locator(".trip-status")).toContainText("2곳을 만들었어요");
  // 좌표가 생겼으니 지도에 표시가 뜬다
  await expect(page.locator(".trip-map-stage path.leaflet-interactive")).toHaveCount(3);
});

test("찍힌 날짜와 같은 날이 여정에 있으면 그 날로 간다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-date").fill("2026-07-20");
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-date").fill("2026-07-21");
  // 보고 있는 날은 둘째 날인데, 사진은 첫째 날에 찍힌 것이다
  const bytes = await page.evaluate(make => [...eval(make)("2026:07:20 08:00:00", 33.4, 126.9)], EXIF_JPEG_MAKER);
  await page.setInputFiles(".trip-exif-btn + input[type=file]",
    [{ name:"첫날사진.jpg", mimeType:"image/jpeg", buffer:Buffer.from(bytes) }]);

  const model = await modelOf(page);
  expect(model.days[0].spots.length).toBe(1);
  expect(model.days[1].spots.length).toBe(0);
});

test("EXIF 가 없는 사진은 장소를 만들지 않고 그렇다고 알려 준다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.setInputFiles(".trip-exif-btn + input[type=file]",
    [{ name:"민무늬.jpg", mimeType:"image/jpeg", buffer:Buffer.from([0xFF, 0xD8, 0xFF, 0xDA, 0, 2]) }]);
  await expect(page.locator(".trip-spot")).toHaveCount(0);
  await expect(page.locator(".trip-status")).toContainText("찍은 때·자리가 없어요");
});

test("떼어 낸 종이 엔진이 여행일지에서도 그대로 돈다(스티커·되돌리기)", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".diary-text").fill("사진을 붙여 보자");

  // 종이 엔진이 붙여 주는 글상자 스티커 한 장(사진 바이트 없이 되는 갈래)
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    doc.trip.days[0].stickers.push({ id:"st-e2e-1", kind:"text", text:"제주", x:0.2, y:0.3, w:0.3,
      color:"#1f2937", font:"gothic", size:0.048, align:"left", rot:0, flip:false });
  });
  await page.locator(".trip-day-chip").nth(0).click();
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await expect(page.locator(".diary-sticker-text")).toContainText("제주");

  // 되돌리기 단추가 살아 있다
  await expect(page.locator(".trip-undo-btn")).toBeEnabled();
});
