const test = require("node:test");
const assert = require("node:assert/strict");
const {
  imageMemoStamp,
  imageMemoExtension,
  imageMemoDraftSnapshot
} = require("../src/js/image-memo.js");

test("이미지 메모 파일명 시각과 확장자를 안정적으로 만든다", () => {
  assert.equal(imageMemoStamp(new Date(2026, 5, 30, 9, 8, 7, 6)), "2026-06-30_09-08-07-006");
  assert.equal(imageMemoExtension({ type:"image/jpeg" }), "jpg");
  assert.equal(imageMemoExtension({ type:"image/webp" }), "webp");
  assert.equal(imageMemoExtension({ type:"" }), "png");
});

test("브라우저 임시복구에는 실제 파일로 저장하지 않은 이미지만 담는다", () => {
  const first = new Blob(["a"], { type:"image/png" });
  const second = new Blob(["b"], { type:"image/jpeg" });
  const snapshot = imageMemoDraftSnapshot([
    { order:1, blob:first, dimensions:"10×20", saved:false },
    { order:2, blob:second, dimensions:"20×30", saved:true }
  ], "2026-06-30_09-08-07-006", 3);

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.batchName, "2026-06-30_09-08-07-006");
  assert.equal(snapshot.nextOrder, 3);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].order, 1);
  assert.equal(snapshot.items[0].blob, first);
  assert.equal(snapshot.items[0].dimensions, "10×20");
});
