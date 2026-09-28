"use strict";

// 사진첩 장식 효과: 투명도 그라데이션·그림자·반사·테두리·흐림·색상·무늬, 움직임(화면 CSS 와 GIF/MP4 계산이 같은지).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadAlbum, plain, svgText, assertWellFormedXml, ROOT } = require("./photo-album-harness.js");

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message || ""} ${actual} vs ${expected}`);
// 그리기 호출을 적어 두는 가짜 캔버스(document.createElement("canvas") 가 이것을 돌려준다).
function recordingDocument(log){
  const context = name => ({
    save(){}, restore(){}, fillRect:(...args) => log.push([name, "fill", ...args]), drawImage:(image, ...args) => log.push([name, "draw", ...args]),
    translate:(...args) => log.push([name, "translate", ...args]), rotate:angle => log.push([name, "rotate", angle]), scale:(...args) => log.push([name, "scale", ...args]),
    createLinearGradient:(...args) => { log.push([name, "linear", ...args]); return { addColorStop:(offset, color) => log.push([name, "stop", offset, color]) }; },
    createRadialGradient:(...args) => { log.push([name, "radial", ...args]); return { addColorStop:(offset, color) => log.push([name, "stop", offset, color]) }; },
    set filter(value){ log.push([name, "filter", value]); }, set globalAlpha(value){ log.push([name, "alpha", value]); },
    set shadowColor(value){ log.push([name, "shadow", value]); }, set fillStyle(value){}, set globalCompositeOperation(value){}
  });
  return { createElement:() => ({ getContext:() => context("offscreen") }), context };
}
const round = values => values.map(value => Math.round(value*1e6)/1e6 + 0);

test("투명도 그라데이션: 뒤집어도 보이는 방향을 지키고 내보내기와 같은 기하를 쓴다", () => {
  const log = [], album = loadAlbum({ context:{ document:recordingDocument(log) } });
  const fade = (d, s, f, v) => ({ fade:{ d, s }, f, v });
  assert.equal(album.fadeAngle(fade("right", 0, true), { d:"right" }), 270);
  assert.equal(album.fadeAngle(fade("down", 0, false, true), { d:"down" }), 0);
  assert.equal(album.fadeAngle(fade("down-right", 0, true, true), { d:"down-right" }), 315);
  assert.equal(album.fadeMask(fade("right", 30)), "linear-gradient(90deg, #000 30%, transparent 100%)");
  assert.equal(album.fadeMask(fade("radial", 120)), "radial-gradient(closest-side, #000 90%, transparent 100%)");
  assert.equal(album.fadeMask({ fade:{ d:"sideways", s:10 } }), "");
  album.fadedSticker({}, fade("right", 25), 100, 50);
  assert.deepEqual(round(log.find(entry => entry[1] === "linear").slice(2)), [0, 25, 100, 25]);
  const item = { stickers:[{ id:"a" }, { id:"b" }] }; album.pick(["a","b"]);
  album.setFade(item, "left"); assert.notEqual(item.stickers[0].fade, item.stickers[1].fade);
});

test("그림자: 예전 장식은 옅은 그림자, 돌리고 뒤집어도 사진 기준 같은 쪽으로 드리운다", () => {
  const album = loadAlbum();
  assert.deepEqual(plain(album.partShadow({})), { d:1.4, b:1.4, o:.33, a:90, c:"#000000" });
  assert.equal(album.partShadow({ sh:null }), null);
  assert.equal(album.shadowPresetOf({ sh:{ d:14, b:6, o:.35, a:135, c:"#000000" } }), "long");
  const sh = { d:10, b:4, o:.5, a:90, c:"#000000" };
  assert.equal(album.shadowFilter({ r:90, sh }, 100), "drop-shadow(10px 0px 4px rgba(0,0,0,0.5))");
  for (const [r, f, v, a] of [[37, true, false, 135], [-120, false, true, 20], [200, true, true, 300]]){
    const [, xs, ys] = album.shadowFilter({ r, f, v, sh:{ ...sh, a } }, 100).match(/drop-shadow\((-?[\d.]+)px (-?[\d.]+)px/);
    let x = +xs, y = +ys; if (f) x = -x; if (v) y = -y;
    const rad = r*Math.PI/180, world = album.shadowOffset({ ...sh, a }, 100);
    assert.ok(Math.abs(x*Math.cos(rad) - y*Math.sin(rad) - world.x) < .02 && Math.abs(x*Math.sin(rad) + y*Math.cos(rad) - world.y) < .02);
  }
});

test("반사·흐림: 내보내기에서 간격만큼 아래에 거꾸로, 본체와 반사 모두 같은 흐림", () => {
  const log = [], doc = recordingDocument(log), album = loadAlbum({ context:{ document:doc } });
  assert.deepEqual(plain(album.partReflect({ rf:{ g:99, o:0, l:"x" } })), { g:30, o:.05, l:60 });
  assert.equal(album.reflectMask({ v:true }, { l:40 }), "linear-gradient(to bottom, #000 0%, transparent 40%)");
  assert.equal(album.blurFilter({ bl:2.5 }, 200), "blur(5px)");
  album.drawStickerOnCanvas(doc.context("main"), {}, { r:0, sh:null, o:.5, bl:5, rf:{ g:10, o:.4, l:50 } }, 200, 100, 120, 80);
  const main = log.filter(entry => entry[0] === "main").map(entry => entry.slice(1).join(" "));
  assert.ok(main.includes("translate 0 88")); assert.ok(main.includes("scale 1 -1")); assert.ok(main.includes("alpha 0.2"));
  assert.deepEqual(log.filter(entry => entry[0] === "main" && entry[1] === "filter").map(entry => entry[2]), ["blur(6px)", "blur(6px)"]);
});

test("색상·무늬·테두리를 겹쳐도 모든 장식 SVG 가 올바르고 겹 순서가 맞다", () => {
  const album = loadAlbum();
  assert.equal(album.partColor({ cl:{ h:360, s:1, b:1, t:"", k:.85 } }), null);
  assert.deepEqual(plain(album.partColor({ cl:{ h:-90, s:9, b:0, t:"#ABCDEF", k:2 } })), { h:270, s:2, b:.5, t:"#abcdef", k:1 });
  assert.equal(album.partPattern({ pt:{ p:"plaid" } }), null);
  assert.equal(album.partSvg(album.art[0], { pt:{ p:"dots", k:0 } }), album.partSvg(album.art[0], {}));
  const layered = svgText(album.partSvg(album.art[0], { cl:{ t:"#ff0000" }, pt:{ p:"check" }, ol:{ t:3, c:"#ffffff" } }));
  assert.match(layered, /<g filter="url\(#ol\)"><g filter="url\(#cl\)">.*<\/g><rect width="120" height="105" fill="url\(#pt\)"/);
  for (const row of album.art){
    assertWellFormedXml(svgText(album.partSvg(row, {})));
    for (const [id] of album.PATTERNS.filter(entry => entry[0])) assertWellFormedXml(svgText(album.partSvg(row, { pt:{ p:id }, cl:{ h:30, t:"#3a5bd9", k:.6 }, ol:{ t:2, c:"#000000" } })));
  }
});

test("테두리·색상은 고칠 때 새 객체로 바꿔 복제본끼리 나눠 쓰지 않는다", () => {
  const album = loadAlbum(), item = { stickers:[{ id:"a" }, { id:"b", ol:{ t:6, c:"#00ff00" } }] };
  album.pick(["a","b"]);
  album.setOutline(item, "white");
  assert.deepEqual(plain(item.stickers[0].ol), { t:4, c:"#ffffff" }); assert.deepEqual(plain(item.stickers[1].ol), { t:6, c:"#ffffff" });
  album.setTint(item, "#e63946"); album.editColor(item, "h", 45);
  assert.notEqual(item.stickers[0].cl, item.stickers[1].cl);
});

test("움직임: 화면 CSS @keyframes 와 GIF/MP4 용 계산이 모든 기준점에서 같다", () => {
  const album = loadAlbum(), css = fs.readFileSync(path.join(ROOT, "src", "styles.css"), "utf8");
  const durations = Object.fromEntries(album.ANIMATIONS.filter(row => row[0]).map(row => [row[0], row[2]]));
  for (const kind of Object.keys(album.POSE_KEYS)){
    assert.ok(css.includes(`[data-anim="${kind}"]`), kind);
    const body = css.match(new RegExp("@keyframes pa-" + kind + "\\{(.*?\\})\\}"))[1];
    for (const [, stopsText, decl] of body.matchAll(/([\d%,to ]+)\{([^}]*)\}/g)){
      const want = {}; let m;
      if ((m = decl.match(/translateY\((-?[\d.]+)%\)/))) want.y = +m[1]/100;
      if ((m = decl.match(/translateX\((-?[\d.]+)%\)/))) want.x = +m[1]/100;
      if ((m = decl.match(/rotate\((-?[\d.]+)(deg)?\)/))) want.r = +m[1];
      if ((m = decl.match(/scale\(([\d.]+)(?:,([\d.]+))?\)/))){ want.sx = +m[1]; want.sy = m[2] ? +m[2] : +m[1]; }
      if ((m = decl.match(/opacity:([\d.]+)/))) want.o = +m[1];
      for (const stop of stopsText.split(",").map(text => text.trim())){
        const at = stop === "to" ? 1 : parseFloat(stop)/100, pose = album.animationPose({ an:{ k:kind, s:1 } }, at*durations[kind]);
        for (const [key, value] of Object.entries(want)){
          const got = kind === "spin" && key === "r" ? ((pose.r % 360) + 360) % 360 : pose[key];
          near(got, kind === "spin" && key === "r" ? value % 360 : value, `${kind} @${stop} ${key}`);
        }
      }
    }
  }
  assert.equal(album.loopLength([3, 1.5]), 3); assert.equal(album.loopLength([1.4, .7]), 1.4);
  assert.deepEqual(plain(album.partAnimation({ an:{ k:"float", s:2 } })), { k:"float", s:2, d:1.5 });
});
