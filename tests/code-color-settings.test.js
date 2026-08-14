"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const styles = read("src/styles.css");
const stateSrc = read("src/js/state.js");
const app = read("src/js/app.js");
const html = read("classdock.html");

// state.js 는 ClassDockCore 구조분해로 시작해 통째로는 못 돌린다 — 코드 색 구획만 떼어 실행한다.
const start = stateSrc.indexOf("const CODE_COLOR_DEFS");
const end = stateSrc.indexOf("const DEFAULT_APP_SETTINGS");
assert.ok(start > 0 && end > start, "state.js 에서 코드 색 구획을 찾지 못했습니다");

// applyCodeColors 가 <html> 인라인 스타일을 어떻게 건드리는지 관찰하기 위한 최소 DOM 대역.
function makeContext(theme){
  const props = new Map();
  const context = {
    appSettings: { codeColors: {} },
    document: {
      documentElement: {
        getAttribute: (name) => (name === "data-theme" ? theme : null),
        style: {
          setProperty: (name, value) => props.set(name, value),
          removeProperty: (name) => props.delete(name)
        }
      }
    }
  };
  vm.createContext(context);
  // const 선언은 vm 컨텍스트의 속성이 되지 않으므로(렉시컬 스코프) 검사에 쓸 상수만 따로 내보낸다.
  vm.runInContext(stateSrc.slice(start, end)
    + "\nthis.CODE_COLOR_DEFS = CODE_COLOR_DEFS;"
    + "\nthis.CODE_COLOR_DEFAULTS = CODE_COLOR_DEFAULTS;"
    + "\nthis.CODE_COLOR_PRESETS = CODE_COLOR_PRESETS;"
    + "\nthis.CODE_COLOR_BACKGROUNDS = CODE_COLOR_BACKGROUNDS;", context);
  return { context, props };
}

// CSS 변수 실제 값 — :root 가 먼저, [data-theme="dark"] 가 그다음에 나온다.
function cssColors(varName){
  const found = [...styles.matchAll(new RegExp("--" + varName + ":(#[0-9a-fA-F]{3,6})", "g"))].map((m) => m[1].toLowerCase());
  return { light: found[0], dark: found[1] };
}

test("코드 색 기본값은 styles.css 의 실제 팔레트와 일치한다", () => {
  const { context } = makeContext("light");
  for (const def of context.CODE_COLOR_DEFS){
    const css = cssColors(def.varName.replace(/^--/, ""));
    for (const theme of ["light", "dark"]){
      assert.equal(context.CODE_COLOR_DEFAULTS[theme][def.id], css[theme],
        def.id + "(" + theme + ") 기본값이 styles.css 와 다릅니다 — 둘 중 하나만 고치면 '기본색으로 되돌리기'가 어긋납니다");
    }
  }
});

test("주석색은 --code-muted 에서 떨어져 나와 따로 바꿀 수 있다", () => {
  // --code-muted 는 줄번호·안내문 등 수십 곳이 함께 쓰므로 주석만 칠하는 변수가 따로 있어야 한다.
  assert.match(styles, /\.code-host \.tk-c,\.nbv-static \.tk-c\{color:var\(--code-comment\)/);
  assert.match(styles, /\.scratchpad-notebook-source \.tk-c\{color:var\(--code-comment\)/);
  const comment = cssColors("code-comment"), muted = cssColors("code-muted");
  assert.equal(comment.light, muted.light, "분리 시점에는 겉보기 색이 그대로여야 한다");
  assert.equal(comment.dark, muted.dark);
});

test("정규화는 기본색·잘못된 값을 걸러내고 #rgb 를 펼친다", () => {
  const { context } = makeContext("light");
  const out = context.normalizeCodeColors({
    light: { keyword:"#F00", string:"#047857", number:"빨강", comment:"#123456", bogus:"#000000" },
    dark: null
  });
  assert.equal(out.light.keyword, "#ff0000", "#rgb 는 #rrggbb 로 펼쳐야 색 고르개에 그대로 쓸 수 있다");
  assert.equal(out.light.string, undefined, "기본색과 같으면 저장하지 않는다");
  assert.equal(out.light.number, undefined, "색이 아닌 값은 버린다");
  assert.equal(out.light.comment, "#123456");
  assert.equal(out.light.bogus, undefined, "CODE_COLOR_DEFS 에 없는 항목은 버린다");
  assert.equal(Object.keys(out.dark).length, 0, "테마 한쪽이 비어 있어도 빈 묶음이 만들어져야 한다");
});

test("적용은 지금 테마 색만 얹고 기본값 항목은 인라인 스타일에서 걷어낸다", () => {
  const { context, props } = makeContext("dark");
  context.appSettings.codeColors = context.normalizeCodeColors({
    light: { keyword:"#111111" },
    dark: { keyword:"#eeeeee" }
  });
  context.applyCodeColors();
  assert.equal(props.get("--python-code-keyword"), "#eeeeee", "다크에서는 다크 색을 얹어야 한다");
  assert.equal(props.has("--python-code-string"), false, "고르지 않은 색은 CSS 테마 규칙에 맡긴다");
  assert.equal(props.has("--code-keyword"), false, "전역 코드 변수에 얹어 다른 언어까지 바꾸면 안 된다");

  // 라이트로 전환 — 인라인 스타일은 [data-theme] 규칙을 이기므로 반드시 다시 칠해져야 한다.
  const light = makeContext("light");
  light.context.appSettings.codeColors = context.appSettings.codeColors;
  light.context.applyCodeColors();
  assert.equal(light.props.get("--python-code-keyword"), "#111111");
});

test("기본색만 남으면 인라인 스타일을 모두 비워 CSS 테마 규칙이 다시 살아난다", () => {
  const { context, props } = makeContext("light");
  context.appSettings.codeColors = context.normalizeCodeColors({ light:{ keyword:"#111111" } });
  context.applyCodeColors();
  assert.equal(props.size, 1);
  context.appSettings.codeColors = context.normalizeCodeColors();
  context.applyCodeColors();
  assert.equal(props.size, 0, "'기본색으로 되돌리기' 후에는 얹은 색이 남으면 안 된다");
});

test("기본 팔레트와 프리셋은 라이트·다크를 모두 정의하고 배경 대비를 확보한다", () => {
  const { context } = makeContext("light");
  const ids = context.CODE_COLOR_DEFS.map((def) => def.id);
  const palettes = [
    { label:"기본", colors:context.CODE_COLOR_DEFAULTS },
    ...context.CODE_COLOR_PRESETS.filter((preset) => preset.colors).map((preset) => ({ label:preset.label, colors:preset.colors }))
  ];
  for (const palette of palettes){
    for (const theme of ["light", "dark"]){
      const set = palette.colors[theme];
      assert.ok(set, palette.label + " 프리셋에 " + theme + " 색이 없습니다 — 테마를 바꾸면 색이 깨져 보입니다");
      for (const id of ids){
        assert.equal(context.normalizeHexColor(set[id]), set[id], palette.label + "/" + theme + "/" + id + " 가 #rrggbb 형식이 아닙니다");
        const ratio = context.colorContrastRatio(set[id], context.CODE_COLOR_BACKGROUNDS[theme]);
        assert.ok(ratio >= 2.2, palette.label + "/" + theme + "/" + id + " 이 배경과 대비가 부족합니다(" + ratio.toFixed(2) + ") — 설정 화면이 스스로 경고를 띄우게 됩니다");
      }
    }
  }
});

test("짧은 이름은 i18n 사전 대신 labelEn 으로 번역한다", () => {
  const { context } = makeContext("light");
  const i18n = read("src/js/i18n.js");
  const items = [...context.CODE_COLOR_DEFS, ...context.CODE_COLOR_PRESETS];
  for (const item of items){
    assert.ok(item.labelEn, item.label + " 에 labelEn 이 없습니다");
    // 사전은 텍스트 완전 일치로 동작해 "기본"·"주석" 같은 낱말을 넣으면 다른 화면까지 번역된다.
    assert.doesNotMatch(i18n, new RegExp('^\\s*"' + item.label + '":', "m"),
      '"' + item.label + '" 는 다른 화면의 같은 글자까지 번역하므로 i18n 사전에 넣으면 안 됩니다');
  }
  // 이름은 그릴 때마다 현재 언어로 채워야 언어를 바꿔도 따라온다.
  assert.match(app, /data-code-color-label/);
  assert.match(app, /data-code-color-preset-label/);
  assert.match(app, /addEventListener\("mni18nchange"/);
});

test("설정 저장·테마 전환·미리보기 배선이 이어져 있다", () => {
  assert.match(html, /id="settingCodeColorPresets"/);
  assert.match(html, /id="settingCodeColorList"/);
  assert.match(html, /id="settingCodeColorPreview"/);
  assert.match(app, /codeColors: codeColorDraft/);
  assert.match(app, /codeColorDraft = normalizeCodeColors\(appSettings\.codeColors\)/);
  // 테마 토글 뒤 재적용이 빠지면 다크에서 고른 색이 라이트에 그대로 남는다.
  assert.match(app, /localStorage\.setItem\("theme", next\);[\s\S]{0,400}applyCodeColors\(\)/);
  assert.match(stateSrc, /codeColors:normalizeCodeColors\(merged\.codeColors\)/);
  assert.match(stateSrc, /codeColors:normalizeCodeColors\(saved\.codeColors\)/);
});

test("사용자 색은 Python 대상으로 표시한 코드에만 적용된다", () => {
  assert.match(styles, /\.code-color-target \.tk-k\{color:var\(--python-code-keyword,var\(--code-keyword\)\)\}/);
  assert.match(styles, /\.code-color-target \.tk-s\{color:var\(--python-code-string,var\(--code-string\)\)\}/);
  assert.doesNotMatch(styles, /\.json-tree[^\n]*--python-code-/,
    "JSON 트리는 Python 사용자 색 변수를 참조하면 안 된다");
  assert.match(read("src/js/python-editor.js"), /prof === "python"[^\n]*code-color-target/);
  assert.match(read("src/js/notebook-cells.js"), /nbv-static code-color-target/);
  assert.match(read("src/js/scratchpad.js"), /scratchpad-notebook-source[^\n]*code-color-target/);
});

test("프리셋과 초기화는 현재 테마만 교체한다", () => {
  assert.match(app, /\[theme\]:\(preset\.colors && preset\.colors\[theme\]\) \|\| \{\}/);
  assert.match(app, /normalizeCodeColors\(\{ \.\.\.codeColorDraft, \[theme\]:\{\} \}\)/);
  assert.match(app, /normalizeCodeColors\(preset\.colors\)\[theme\][\s\S]{0,100}codeColorDraft\[theme\]/,
    "프리셋 선택 표시도 현재 테마끼리 비교해야 한다");
});
