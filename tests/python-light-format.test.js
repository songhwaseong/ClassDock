const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lightReindentPython } = require("../src/js/core.js");

test("선행 탭을 Python의 8칸 탭 스톱 기준 스페이스로 바꾼다", () => {
  const src = "def f():\n\tx = 1\n";
  assert.equal(lightReindentPython(src), "def f():\n        x = 1\n");
});

test("공백과 탭이 섞인 유효한 중첩 들여쓰기 깊이를 보존한다", () => {
  const src = "if True:\n        if True:\n\t\tpass\n";
  assert.equal(lightReindentPython(src), "if True:\n        if True:\n                pass\n");
});

test("최상위에서 갑자기 깊어진 들여쓰기만 내어쓰고 괄호 안 인수는 유지한다", () => {
  const src = [
    'find_api = "OPENAI_API_KEY"',
    "api_key = get_api_key(find_api)",
    "",
    "# 모델 생성",
    "    model = ChatOpenAI(",
    "        model='gpt-4o',",
    "        temperature=0.3,",
    "        max_completion_tokens=150",
    "    )",
  ].join("\n");
  const expected = src.replace("    model = ChatOpenAI(", "model = ChatOpenAI(") + "\n";
  assert.equal(lightReindentPython(src), expected);
});

test("정상 블록·괄호·역슬래시 연속 줄의 추가 들여쓰기는 건드리지 않는다", () => {
  const src = [
    "if enabled:",
    "      result = call(",
    "          first,",
    "          second,",
    "      )",
    "      total = first + \\",
    "          second",
  ].join("\n");
  assert.equal(lightReindentPython(src), src + "\n");
});

test("여러 줄 블록 조건이 닫힌 뒤의 본문 들여쓰기를 정상 블록으로 인식한다", () => {
  const src = [
    "if (",
    "        first",
    "        and second",
    "):",
    "    result = 1",
    "if first and \\",
    "        second:",
    "    other = 2",
  ].join("\n");
  assert.equal(lightReindentPython(src), src + "\n");
});

test("블록 안에서 블록을 열지 않고 갑자기 깊어진 줄은 현재 블록 깊이로 되돌린다", () => {
  const src = "if enabled:\n    first = 1\n        second = 2\n";
  assert.equal(lightReindentPython(src), "if enabled:\n    first = 1\n    second = 2\n");
});

test("기존 블록 깊이와 맞지 않는 애매한 dedent는 추측해 고치지 않는다", () => {
  const src = "if outer:\n    if inner:\n        first = 1\n      second = 2\n";
  assert.equal(lightReindentPython(src), src);
});

test("줄 끝 공백을 제거한다", () => {
  const src = "x = 1   \ny = 2\t\n";
  assert.equal(lightReindentPython(src), "x = 1\ny = 2\n");
});

test("빈 줄 3개 이상은 2개로 줄이고, 파일 끝 빈 줄은 없앤다", () => {
  const src = "a = 1\n\n\n\n\nb = 2\n\n\n";
  assert.equal(lightReindentPython(src), "a = 1\n\n\nb = 2\n");
});

test("마지막 개행이 없어도 한 개를 보장한다", () => {
  assert.equal(lightReindentPython("x = 1"), "x = 1\n");
});

test("공백만 있는 소스는 빈 문자열", () => {
  assert.equal(lightReindentPython("\n\n   \n\t\n"), "");
  assert.equal(lightReindentPython(""), "");
});

test("삼중따옴표 문자열 내용(탭·후행 공백·빈 줄)은 건드리지 않는다", () => {
  // 문자열 안: 탭 들여쓰기, 줄 끝 공백, 빈 줄이 모두 보존되어야 한다.
  const src = 's = """\n\tkeep tab   \n\n\nmany blanks kept\n"""\ny = 1   \n';
  const out = lightReindentPython(src);
  assert.ok(out.includes('\tkeep tab   \n'), "문자열 안 탭·후행 공백 보존");
  assert.ok(out.includes('\n\n\nmany blanks kept'), "문자열 안 빈 줄 보존");
  assert.ok(out.endsWith('"""\ny = 1\n'), "문자열 밖 코드의 후행 공백은 정리");
});

test("문자열 안의 # 는 주석으로 오인하지 않는다(선행 탭만 변환)", () => {
  const src = "if url == 'http://x#frag':\n\tpass\n";
  assert.equal(lightReindentPython(src), "if url == 'http://x#frag':\n        pass\n");
});

test("닫히지 않은 삼중따옴표 문자열의 파일 끝 공백 줄을 보존한다", () => {
  const src = 'value = """\nkeep\n   \n';
  assert.equal(lightReindentPython(src), src);
});

test("들여쓰기 단계는 재계산하지 않는다(공백 정리만)", () => {
  // 이미 4칸이면 그대로 두고, 임의로 2칸을 4칸으로 늘리지 않는다(구문 파괴 방지).
  const src = "if x:\n  y = 1\n";
  assert.equal(lightReindentPython(src), "if x:\n  y = 1\n");
});

test("멱등: 두 번 정렬해도 결과가 같다", () => {
  const src = "def f():\n\tx = 1   \n\n\n\n\treturn x";
  const once = lightReindentPython(src);
  assert.equal(lightReindentPython(once), once);
});

test("자동 정렬 설정·단축키·결과 안내를 영어 UI에서도 번역한다", () => {
  const root = path.resolve(__dirname, "..");
  const i18n = fs.readFileSync(path.join(root, "src/js/i18n.js"), "utf8");
  const editor = fs.readFileSync(path.join(root, "src/js/python-editor.js"), "utf8");
  for (const key of [
    "Python 저장 시 코드 자동 정렬 — 들여쓰기·공백 정리(로컬 파이썬이면 black)",
    "코드 자동 정렬",
    "Python·SQL 코드 들여쓰기·공백 정렬(로컬 파이썬이면 black)",
    "구문 오류가 있어 완전 정렬은 못 하고 공백만 정리했어요.",
    "코드를 정렬했어요 ({engine}).",
    "경량 정렬",
    "이미 정렬돼 있어요.",
  ]) assert.ok(i18n.includes(JSON.stringify(key).slice(1, -1)), "번역 키 누락: " + key);
  assert.match(editor, /else if \(r\.changed\) \{/);
  assert.match(editor, /window\.tf\("코드를 정렬했어요 \(\{engine\}\)\."/);
});
