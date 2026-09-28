const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function albumContext(){
  const calls = [];
  const context = {
    docs:[], workspaceRegistry:{ items:[] },
    makeDoc(kind,name){
      const doc = { id:1, kind, name, el:{ classList:{ add(){} } } };
      context.docs.push(doc);
      calls.push("make");
      return doc;
    },
    refreshChrome(){ calls.push("chrome"); },
    activateIfIdle(){ calls.push("activate"); },
    setActiveDoc(){ calls.push("active"); }
  };
  const source = fs.readFileSync(path.join(__dirname,"..","src","js","photo-album.js"),"utf8");
  vm.runInNewContext(source,context,{ filename:"photo-album.js" });
  return { context,calls };
}

test("photo album restores only when an open tab was saved", () => {
  const {context,calls} = albumContext();
  assert.equal(context.restoreSavedPhotoAlbum({ tabs:[] }),null);
  assert.equal(context.docs.length,0);
  const doc = context.restoreSavedPhotoAlbum({ tabs:["사진첩"] });
  assert.equal(doc.kind,"photo-album");
  assert.deepEqual(calls,["make"]);
  assert.equal(context.restoreSavedPhotoAlbum({ tabs:["사진첩"] }),doc);
  assert.equal(context.docs.length,1);
});

test("photo album in another saved workspace is restored in background", () => {
  const {context,calls} = albumContext();
  context.workspaceRegistry.items.push({ tabKeys:["사진첩"] });
  const doc = context.restoreSavedPhotoAlbum({ tabs:[] });
  assert.equal(doc.kind,"photo-album");
  assert.deepEqual(calls,["make"]);
});

test("workspace restoration creates album before applying saved tabs", () => {
  const source = fs.readFileSync(path.join(__dirname,"..","src","js","workspace-store.js"),"utf8");
  const occurrences = [...source.matchAll(/restoreSavedPhotoAlbum\(savedTabs\);[\s\S]{0,120}applyTabState\(savedTabs\)/g)];
  assert.equal(occurrences.length,2);
});

test("dragged decoration is placed relative to the photo surface", () => {
  const source = fs.readFileSync(path.join(__dirname,"..","src","js","photo-album.js"),"utf8")
    .replace("return { mount, cleanup };","return { mount, cleanup, dropPosition };");
  const dropPosition = vm.runInNewContext(source + "\nPhotoAlbum.dropPosition;",{});
  const rect = { left:100, top:50, right:500, bottom:250, width:400, height:200 };
  const center = dropPosition(300,150,rect);
  assert.equal(center.x,50);
  assert.equal(center.y,50);
  assert.equal(dropPosition(99,150,rect),null);
  assert.equal(dropPosition(300,251,rect),null);
});
