"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("지도 설정창과 지도 문제 만들기는 전체화면 요소 안에 붙는다", () => {
  for (const file of ["map-viewer.js", "task-package.js"]){
    const source = fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8");
    assert.doesNotMatch(source, /document\.body\.appendChild\(modal\)/, file);
    const mounts = source.match(/\(document\.fullscreenElement \|\| document\.body\)\.appendChild\(modal\)/g) || [];
    assert.ok(mounts.length >= (file === "map-viewer.js" ? 9 : 2), file);
  }
});

test("지도 2단 메뉴는 오른쪽에 열리고 화면 가장자리에서는 왼쪽으로 전환한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const open = /const openContextSub = \(group, focus = false\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(open);
  let anchor = { left:200, right:400, top:100 };
  const panel = { offsetWidth:214, offsetHeight:300, style:{}, hidden:true };
  const heading = { setAttribute(){}, classList:{ add(){} }, getBoundingClientRect:() => anchor };
  const host = { appendChild(node){ node.host = this; } };
  const context = {
    group:{ heading, panel }, focus:false, contextOpenGroup:null,
    cancelContextSubClose(){}, closeContextSub(){},
    document:{ body:{ style:{ zoom:"2" } }, fullscreenElement:host },
    window:{ innerWidth:1600, innerHeight:1000 }
  };
  const run = () => vm.runInNewContext("(() => {" + open[1] + "})()", context);
  run();
  assert.equal(panel.style.left, "196px");
  assert.equal(panel.style.top, "50px");
  assert.equal(panel.host, host);
  assert.equal(panel.hidden, false);
  context.contextOpenGroup = null;
  anchor = { left:1300, right:1550, top:900 };
  run();
  assert.equal(panel.style.left, "440px");
  assert.equal(panel.style.top, "192px");
});

test("지도 메뉴는 전체화면 내부에서 열리고 창 모드 복귀와 화면 배율을 따른다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const handler = /map\.on\("contextmenu", \(e\) => \{([\s\S]*?)\n  \}\);/.exec(source);
  assert.ok(handler);
  const body = { style:{ zoom:"2" }, appendChild(menu){ menu.host = this; } };
  const fullscreen = { appendChild(menu){ menu.host = this; } };
  const menu = { style:{}, offsetWidth:214, offsetHeight:300, hidden:true, querySelector(){ return null; } };
  const context = {
    e:{ latlng:{ lat:37, lng:127 }, originalEvent:{ clientX:900, clientY:700 } },
    document:{ body, fullscreenElement:fullscreen, addEventListener(){} },
    window:{ innerWidth:1000, innerHeight:800, addEventListener(){} },
    drawingMode:false, adding:false, doc:{}, contextLatLng:null,
    L:{ latLng:(lat, lng) => ({ lat, lng }) }, mapClampLat:v => v, mapClampLng:v => v,
    contextHead:{}, contextZoomBtn:{}, contextWeatherBtn:{},
    weather:{ isAvailable:() => true }, map:{ getZoom:() => 10, on(){} }, maxViewZoom:() => 18,
    syncContextMirrors(){}, contextMenu:menu, onContextOutside(){}, onContextKey(){}, closeContextMenu(){}
  };
  vm.runInNewContext("(() => {" + handler[1] + "})()", context);
  assert.equal(menu.host, fullscreen);
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.left, "278px");
  assert.equal(menu.style.top, "92px");
  context.document.fullscreenElement = null;
  vm.runInNewContext("(() => {" + handler[1] + "})()", context);
  assert.equal(menu.host, body);
  assert.match(source, /document\.removeEventListener\("fullscreenchange", closeContextMenu\)/);
});
