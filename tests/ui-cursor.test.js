"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 화면마다 cursor 를 빠뜨려도 버튼이 손가락 포인터가 되도록 우선순위 0 의 기본 규칙을 둔다.
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("누를 수 있는 요소의 기본 포인터 규칙은 :where 로 우선순위 0 이다", () => {
  const pointer = /:where\(([^{]*)\)\{cursor:pointer\}/.exec(styles);
  assert.ok(pointer, "기본 포인터 규칙이 없습니다");
  for (const selector of ["button", "summary", "select", '[role="button"]', 'input[type="checkbox"]']){
    assert.ok(pointer[1].includes(selector), selector);
  }
  assert.match(styles, /:where\(button:disabled[^{]*\)\{cursor:not-allowed\}/);
  // 다른 규칙보다 앞에 두어, 같은 우선순위라도 뒤의 화면별 규칙이 이기게 한다.
  assert.ok(pointer.index < styles.indexOf(":root{"));
});
