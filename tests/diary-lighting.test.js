"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const diary = require("../src/js/diary.js");
for (const name of ["diaryDefaultStyle", "diaryNormalizeStyle", "diaryDefaultBackdrop", "diaryNormalizeBackdrop",
  "diaryNormalizeSticker", "diaryNormalizeStroke", "diaryNormalizeTags", "diaryCleanSticker", "diaryZipBuild", "diaryZipRead",
  "diaryLegacyLightColor"]){
  globalThis[name] = diary[name];
}
const trip = require("../src/js/trip.js");

test("old journals default to no lighting; invalid names and intensity are normalized", () => {
  assert.equal(diary.diaryNormalizeStyle({}).lighting, "none");
  for (const invalid of [undefined, null, "", "bright", Infinity, NaN]){
    assert.equal(diary.diaryNormalizeStyle({ lighting:"unknown", lightIntensity:invalid }).lightIntensity, .6);
  }
  assert.equal(diary.diaryNormalizeStyle({ lighting:"<svg>" }).lighting, "none");
  assert.equal(diary.diaryNormalizeStyle({ lightIntensity:-1 }).lightIntensity, 0);
  assert.equal(diary.diaryNormalizeStyle({ lightIntensity:2 }).lightIntensity, 1);
  assert.equal(diary.diaryNormalizeStyle({ lightIntensity:0 }).lightIntensity, 0);
  assert.equal(diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:15 }).style.lighting, "none");
  assert.equal(trip.tripNormalize({ format:trip.TRIP_FORMAT, version:5 }).style.lighting, "none");
});

test("all fifteen lights persist with independent date overrides in diary and trip ZIPs", async () => {
  for (const lighting of diary.DIARY_LIGHTINGS.filter(id => id !== "none")){
    const globalStyle = diary.diaryNormalizeStyle({ lighting, lightIntensity:.83, lightColor:"#85bfff" });
    const dateStyle = diary.diaryNormalizeStyle({ lighting:"glass", lightIntensity:0, lightColor:"#ff8aca" });
    const model = diary.diaryEmpty("Lights"); model.style = globalStyle;
    model.entries.push({ date:"2026-10-01", text:"Today", style:dateStyle, stickers:[] });
    const { model:back, assets } = await diary.diaryUnpack(diary.diaryPack(model, new Map()));
    assert.deepEqual(back.style, globalStyle);
    assert.deepEqual(back.entries[0].style, dateStyle);
    assert.equal(assets.size, 0);
    assert.equal(diary.diaryEffectiveStyle(back, back.entries[0]).lightIntensity, 0);
    assert.equal(diary.diaryEffectiveStyle(back, null).lightIntensity, .83);
    const journal = trip.tripEmpty("Lights"); journal.style = globalStyle;
    journal.days.push(trip.tripNormalizeDay({ id:"day1", date:"2026-10-01", text:"Today", style:dateStyle }));
    const { model:roundtrip } = await trip.tripUnpack(trip.tripPack(journal, new Map()));
    assert.deepEqual(roundtrip.style, globalStyle);
    assert.deepEqual(roundtrip.days[0].style, dateStyle);
    const key = trip.tripContentKey(roundtrip);
    roundtrip.style.lightIntensity = .2;
    assert.notEqual(trip.tripContentKey(roundtrip), key);
  }
  assert.throws(() => trip.tripNormalize({ format:trip.TRIP_FORMAT, version:11 }), /trip-version/);
});

function layer(){
  return { dataset:{}, style:{ setProperty(key, value){ this[key] = value; } },
    setAttribute(key, value){ this[key] = value; } };
}
test("light colors reject unsafe values and old lighting files retain warm defaults", () => {
  for (const value of [undefined, null, "", "red", "#abc", "url(javascript:bad)", "#aabbcc;display:none"]){
    // 빈 값 = 조명마다 다른 기본 색
    assert.equal(diary.diaryNormalizeStyle({ lightColor:value }).lightColor, "");
  }
  assert.equal(diary.diaryNormalizeStyle({ lightColor:"#AABBCC" }).lightColor, "#aabbcc");
  const before = diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:16, style:{ lighting:"stars", lightIntensity:.25 } });
  assert.equal(before.style.lightColor, "");
  assert.equal(diary.diaryLightColor(before.style), diary.DIARY_LIGHT_DEFAULT_COLOR);
  assert.equal(before.style.lighting, "stars");
  assert.equal(before.style.lightIntensity, .25);
  assert.equal(diary.diaryLightColor(trip.tripNormalize({ format:trip.TRIP_FORMAT, version:6, style:{ lighting:"glass" } }).style),
    diary.DIARY_LIGHT_DEFAULT_COLOR);
  assert.deepEqual(diary.diaryLightingPalette("#000000"), { color:"#000000", soft:"#8c8c8c", core:"#ebebeb" });
  assert.deepEqual(diary.diaryLightingPalette("#ffffff"), { color:"#ffffff", soft:"#ffffff", core:"#ffffff" });
  const oldStyle = { lighting:"pendant", lightIntensity:.48, lightColor:"#55aaff" };
  assert.equal(diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:17, style:oldStyle }).style.lightColor, "#55aaff");
  assert.equal(trip.tripNormalize({ format:trip.TRIP_FORMAT, version:7, style:oldStyle }).style.lighting, "pendant");
});

test("one color picker gesture previews live and undoes independently from intensity", () => {
  const api = vm.runInNewContext(fs.readFileSync(require.resolve("../src/js/history.js"), "utf8") + ";MNEditHistory");
  let style = diary.diaryNormalizeStyle({ lighting:"glass", lightIntensity:.25 });
  const history = api.create({ capture:() => JSON.stringify(style), apply:value => { style = JSON.parse(value); }, isEqual:(a, b) => a === b });
  history.reset();
  const events = new Map();
  const input = { value:style.lightColor, addEventListener:(name, fn) => events.set(name, fn) };
  let previews = 0;
  const finish = diary.diaryBindLightColor(input, { style:() => style, flush:() => history.flush(),
    repaint:() => {}, preview:() => { previews++; }, commit:() => history.commit() });
  for (const value of ["#85bfff", "#B0AAFF", "#ff8aca"]){ input.value = value; events.get("input")(); }
  assert.equal(previews, 3);
  assert.equal(style.lightColor, "#ff8aca");
  assert.equal(history.size(), 1);
  events.get("change")(); events.get("blur")();
  assert.equal(history.size(), 2);
  history.undo(); assert.equal(style.lightColor, "");
  history.redo(); assert.equal(style.lightColor, "#ff8aca");
  assert.equal(style.lightIntensity, .25);
  input.value = "#000000"; events.get("input")(); finish();
  history.undo(); assert.equal(style.lightColor, "#ff8aca");
});

test("brightness updates only light groups, preserving fixtures and unique SVG references", () => {
  const ids = new Set();
  assert.equal(diary.DIARY_LIGHTINGS.length, 16);
  assert.deepEqual(Object.keys(diary.DIARY_LIGHTING_LABELS).sort(), [...diary.DIARY_LIGHTINGS].sort());
  assert.deepEqual(Object.keys(diary.DIARY_LIGHTING_LABELS_EN).sort(), [...diary.DIARY_LIGHTINGS].sort());
  for (const lighting of diary.DIARY_LIGHTINGS.filter(id => id !== "none")){
    const node = layer();
    diary.diaryPaintLighting(node, { lighting, lightIntensity:1 });
    const original = node.innerHTML;
    for (const match of original.matchAll(/id="([^"]+)"/g)){
      assert.ok(!ids.has(match[1])); ids.add(match[1]);
    }
    for (const match of original.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(match[1]));
    assert.ok(original.includes('class="diary-light-fixtures"'));
    assert.ok(!/filter|<script|<image/.test(original));
    diary.diaryPaintLighting(node, { lighting, lightIntensity:0, lightColor:"#85bfff" });
    assert.equal(node.style["--diary-light-intensity"], "0");
    assert.equal(node.innerHTML, original);
    assert.equal(node.style["--diary-light-color"], "#85bfff");
    assert.equal(node.hidden, false);
    diary.diaryPaintLighting(node, { lighting:"none" });
    assert.equal(node.hidden, true);
    assert.equal(node.innerHTML, "");
  }
});

test("lighting reserves only each fixture's own space, aligned to the lines, for ruled, manuscript and picture pages", () => {
  for (const width of [320, 680, 780, 900]){
    for (const lines of ["ruled", "genko", "picture"]){
      const plain = diary.diaryNormalizeStyle({ lines });
      for (const lighting of diary.DIARY_LIGHTINGS.filter(id => id !== "none")){
        const lit = { ...plain, lighting, lightAvoid:true };
        const reserve = diary.DIARY_LIGHTING_RESERVE[lighting];
        const space = diary.diaryLightingSpace(lit, width);
        const before = diary.diaryLineMetrics(plain, width), after = diary.diaryLineMetrics(lit, width);
        const inset = diary.diaryLightingInset(lit, width);
        assert.equal(after.padTop - before.padTop, inset);
        assert.equal(inset % after.gap, 0, "handwriting must remain aligned to ruled lines");
        assert.equal(diary.diaryGenkoMetrics(lit, width).padTop - diary.diaryGenkoMetrics(plain, width).padTop, inset);
        if (lines === "picture") assert.equal(after.box.top - before.box.top, inset);
        if (reserve.right && lines === "ruled"){
          // 옆에 선 기구는 위 줄을 비우지 않고 오른쪽만 비운다.
          assert.equal(inset, 0);
          assert.ok(space.right >= reserve.right * width / 1000);
          assert.equal(after.padRight, Math.max(32, space.right));
          assert.equal(space.rightH % after.gap, 0);
        } else if (!diary.diaryLightingHasFixture(lighting)){
          // 창문 햇살처럼 기구가 없는 조명은 비울 자리가 없다.
          assert.deepEqual(space, { top:0, right:0, rightH:0 });
          assert.equal(after.padRight, 32);
        } else {
          // 원고지는 칸을 가운데 맞추므로 옆 기구도 위 띠로 바꾼다.
          const height = reserve.top || reserve.rightH;
          assert.ok(inset >= height * width / 1000 && inset < height * width / 1000 + after.gap);
          assert.equal(after.padRight, 32);
        }
      }
    }
  }
});

test("fixture space is off by default so text runs under the lights; old files open with it off", () => {
  for (const lighting of diary.DIARY_LIGHTINGS){
    const style = diary.diaryNormalizeStyle({ lighting });
    assert.equal(style.lightAvoid, false);
    assert.deepEqual(diary.diaryLightingSpace(style, 900), { top:0, right:0, rightH:0 });
    assert.deepEqual(diary.diaryLineMetrics(style, 900), diary.diaryLineMetrics(diary.diaryNormalizeStyle({}), 900));
    assert.equal(diary.diaryLightingMask(style, 900).image, "none");
  }
  for (const value of [undefined, null, "", 0, 1, "true", false]){
    assert.equal(diary.diaryNormalizeStyle({ lighting:"stars", lightAvoid:value }).lightAvoid, false);
  }
  assert.equal(diary.diaryNormalizeStyle({ lighting:"stars", lightAvoid:true }).lightAvoid, true);
  assert.equal(diary.diaryDefaultStyle().lightAvoid, false);
  assert.equal(diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:18, style:{ lighting:"shelf" } }).style.lightAvoid, false);
  assert.equal(trip.tripNormalize({ format:trip.TRIP_FORMAT, version:8, style:{ lighting:"shelf" } }).style.lightAvoid, false);
});

test("lines are hidden exactly where text cannot go", () => {
  const top = { ...diary.diaryNormalizeStyle({}), lighting:"pendant", lightAvoid:true };
  const space = diary.diaryLightingSpace(top, 780);
  assert.deepEqual(diary.diaryLightingMask(top, 780), { image:"linear-gradient(#000, #000)", size:"100% 100%",
    position:`0 ${space.top}px`, repeat:"no-repeat" });
  const side = { ...diary.diaryNormalizeStyle({}), lighting:"desk-lamp", lightAvoid:true };
  const s = diary.diaryLightingSpace(side, 780);
  const mask = diary.diaryLightingMask(side, 780);
  assert.equal(mask.size, `calc(100% - ${s.right}px) 100%, 100% 100%`);
  assert.equal(mask.position, `0 0, 0 ${s.rightH}px`);
  // 원고지 칸은 비운 자리 아래에만 그려지므로 가리개가 없다.
  assert.equal(diary.diaryLightingMask({ ...side, lines:"genko" }, 780).image, "none");
  assert.equal(diary.diaryLightingMask(diary.diaryNormalizeStyle({}), 780).image, "none");
});

test("fixture space round-trips per date in diary and trip files", async () => {
  const off = diary.diaryNormalizeStyle({ lighting:"desk-lamp", lightAvoid:false });
  const model = diary.diaryEmpty("Space"); model.style = diary.diaryNormalizeStyle({ lighting:"desk-lamp", lightAvoid:true });
  model.entries.push({ date:"2026-10-01", text:"Today", style:off, stickers:[] });
  const { model:back } = await diary.diaryUnpack(diary.diaryPack(model, new Map()));
  assert.equal(back.style.lightAvoid, true);
  assert.equal(back.entries[0].style.lightAvoid, false);
  const journal = trip.tripEmpty("Space"); journal.style = off;
  const { model:roundtrip } = await trip.tripUnpack(trip.tripPack(journal, new Map()));
  assert.equal(roundtrip.style.lightAvoid, false);
  const key = trip.tripContentKey(roundtrip);
  roundtrip.style.lightAvoid = true;
  assert.notEqual(trip.tripContentKey(roundtrip), key);
});

test("one brightness gesture makes one undo step, supports date scope, blur and keyboard input", () => {
  const historyApi = vm.runInNewContext(fs.readFileSync(require.resolve("../src/js/history.js"), "utf8") + ";MNEditHistory");
  const model = diary.diaryEmpty();
  const entry = { style:diary.diaryNormalizeStyle({ lighting:"stars" }) };
  let own = true, previews = 0;
  const history = historyApi.create({
    capture:() => JSON.stringify([model.style, entry.style]), isEqual:(a, b) => a === b,
    apply:value => { [model.style, entry.style] = JSON.parse(value); }
  });
  history.reset();
  const events = new Map();
  const input = { value:"60", addEventListener:(name, fn) => events.set(name, fn) };
  const finish = diary.diaryBindLightIntensity(input, {
    style:() => own ? entry.style : model.style, flush:() => history.flush(),
    repaint:() => {}, preview:() => { previews++; }, commit:() => history.commit()
  });
  events.get("pointerdown")();
  for (const value of [70, 80, 100]){ input.value = String(value); events.get("input")(); }
  assert.equal(history.size(), 1);
  assert.equal(previews, 3);
  assert.equal(model.style.lightIntensity, .6);
  events.get("change")(); events.get("blur")();
  assert.equal(history.size(), 2);
  history.undo(); assert.equal(entry.style.lightIntensity, .6);
  history.redo(); assert.equal(entry.style.lightIntensity, 1);
  own = false;
  input.value = "0"; events.get("input")(); events.get("blur")();
  assert.equal(model.style.lightIntensity, 0);
  assert.equal(entry.style.lightIntensity, 1);
  history.undo(); assert.equal(model.style.lightIntensity, .6);
  input.value = "40"; events.get("input")(); finish();
  assert.equal(model.style.lightIntensity, .4);
  history.undo(); assert.equal(model.style.lightIntensity, .6);
});

test("print uses the same lighting renderer and removes lighting and header space in plain mode", () => {
  const previous = globalThis.document;
  globalThis.document = { createElement:() => ({ ...layer(), children:[], append(...items){ this.children.push(...items); } }) };
  try {
    for (const kind of diary.DIARY_LIGHTINGS.filter(name => name !== "none")){
      const style = diary.diaryNormalizeStyle({ lighting:kind, lightIntensity:.37, lightColor:"#8faaff" });
      const entry = { text:"Print me", stickers:[], drawing:[] };
      const colored = diary.diaryBuildPrintPaper(entry, style, 680, false, { assetUrl:() => "" }).paperEl;
      const lighting = colored.children.find(node => node.className === "diary-paper-lighting");
      assert.equal(lighting.dataset.lighting, kind);
      assert.equal(lighting.style["--diary-light-intensity"], "0.37");
      assert.equal(lighting.style["--diary-light-color"], "#8faaff");
      const plain = diary.diaryBuildPrintPaper(entry, style, 680, true, { assetUrl:() => "" }).paperEl;
      assert.ok(!plain.children.some(node => node.className === "diary-paper-lighting"));
      const printedText = plain.children.find(node => node.className === "diary-print-text");
      assert.equal(printedText.style.paddingTop, diary.diaryLineMetrics({ ...style, lighting:"none" }, 680).padTop + "px");
      assert.equal(style.lighting, kind);
    }
  } finally { globalThis.document = previous; }
});

test("only lights with a fixture offer the fixture-space option", () => {
  assert.equal(diary.diaryLightingHasFixture("none"), false);
  assert.equal(diary.diaryLightingHasFixture("window-light"), false);
  for (const kind of ["hanji", "curtain", "firefly", "moon", "desk-lamp", "string"]) assert.equal(diary.diaryLightingHasFixture(kind), true);
  // 반딧불 유리병은 스탠드처럼 오른쪽 옆만 비운다.
  const jar = { ...diary.diaryNormalizeStyle({}), lighting:"firefly", lightAvoid:true };
  const space = diary.diaryLightingSpace(jar, 900);
  assert.equal(space.top, 0);
  assert.ok(space.right > 0 && space.rightH > 0);
  assert.equal(diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:20, style:{ lighting:"moon" } }).style.lighting, "moon");
  assert.equal(trip.tripNormalize({ format:trip.TRIP_FORMAT, version:10, style:{ lighting:"hanji" } }).style.lighting, "hanji");
});

test("each light has its own default color that follows the light until a color is picked", async () => {
  assert.equal(diary.diaryLightDefaultColor("firefly"), "#dff07e");
  assert.equal(diary.diaryLightDefaultColor("hanji"), "#ffb56b");
  assert.equal(diary.diaryLightDefaultColor("pendant"), diary.DIARY_LIGHT_DEFAULT_COLOR);
  for (const kind of Object.keys(diary.DIARY_LIGHT_COLORS)) assert.ok(diary.DIARY_LIGHTINGS.includes(kind));
  const auto = diary.diaryNormalizeStyle({ lighting:"firefly" });
  assert.equal(auto.lightColor, "");
  assert.equal(diary.diaryLightColor(auto), "#dff07e");
  assert.equal(diary.diaryLightColor({ ...auto, lighting:"moon" }), "#ffd98a");
  const node = layer();
  diary.diaryPaintLighting(node, auto);
  assert.equal(node.style["--diary-light-color"], "#dff07e");
  // 고른 색은 조명을 바꿔도 남는다.
  const picked = diary.diaryNormalizeStyle({ lighting:"firefly", lightColor:"#ffc66e" });
  assert.equal(diary.diaryLightColor({ ...picked, lighting:"hanji" }), "#ffc66e");
  // 판 20 파일에서 고른 #ffc66e 는 그대로, 옛 판의 기본 색은 빈 값으로 읽는다.
  const now = diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:20, style:{ lighting:"hanji", lightColor:"#ffc66e" } });
  assert.equal(now.style.lightColor, "#ffc66e");
  const old = diary.diaryNormalize({ format:diary.DIARY_FORMAT, version:19, style:{ lighting:"pendant", lightColor:"#ffc66e" },
    entries:[{ date:"2026-09-30", text:"x", style:{ lighting:"glass", lightColor:"#ffc66e" } }] });
  assert.equal(old.style.lightColor, "");
  assert.equal(old.entries[0].style.lightColor, "");
  const oldTrip = trip.tripNormalize({ format:trip.TRIP_FORMAT, version:9, style:{ lighting:"pendant", lightColor:"#ffc66e" },
    days:[{ id:"d1", text:"x", style:{ lighting:"glass", lightColor:"#ffc66e" } }] });
  assert.equal(oldTrip.style.lightColor, "");
  assert.equal(oldTrip.days[0].style.lightColor, "");
  assert.equal(trip.tripNormalize({ format:trip.TRIP_FORMAT, version:10, style:{ lightColor:"#ffc66e" } }).style.lightColor, "#ffc66e");
  // 빈 값도 파일을 오가며 그대로 남는다.
  const model = diary.diaryEmpty("Auto"); model.style = auto;
  const { model:back } = await diary.diaryUnpack(diary.diaryPack(model, new Map()));
  assert.equal(back.style.lightColor, "");
});
