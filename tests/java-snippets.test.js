const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 자바 예제 갤러리의 데이터 계약(docs/자바-예제갤러리-설계.md).
// 파일 이름·클래스 이름·문법 수준이 어긋나면 학생 화면에서 저장이나 컴파일이 막히므로 여기서 고정한다.
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/js/java-snippets.js"), "utf8");
const SNIPPETS = new Function(source + "\nreturn JAVA_SNIPPETS;")();

const CATEGORIES = ["기초·출력", "반복·패턴", "수학·숫자", "문자열", "배열·컬렉션", "메서드·재귀",
  "클래스·객체", "예외·입력검증", "정렬·탐색", "시뮬레이션·확률", "날짜·시간", "응용·도전"];

// 최상위(0칸 들여쓰기) 타입 선언 — 중첩 클래스는 들여써 있으므로 잡히지 않는다.
const topLevelTypes = (code) => {
  const re = /^(?:public\s+|abstract\s+|final\s+)*(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  const names = [];
  let m;
  while ((m = re.exec(code))) names.push(m[1]);
  return names;
};

test("예제 목록은 12갈래 83개이고 파일 이름이 겹치지 않는다", () => {
  assert.equal(SNIPPETS.length, 83);
  const names = SNIPPETS.map(s => s.name);
  assert.equal(new Set(names).size, names.length, "파일 이름은 중복이 없어야 한다");

  const cats = [...new Set(SNIPPETS.map(s => s.cat))];
  assert.deepEqual(cats, CATEGORIES, "갈래는 설계 문서의 순서를 따른다");
  // 같은 갈래가 목록 여기저기 흩어지면 갤러리에서 묶음이 쪼개진다.
  for (const cat of CATEGORIES) {
    const idx = SNIPPETS.map((s, i) => (s.cat === cat ? i : -1)).filter(i => i >= 0);
    assert.equal(idx[idx.length - 1] - idx[0] + 1, idx.length, cat + " 는 한 덩어리로 모여 있어야 한다");
  }
});

test("파일 이름은 대문자로 시작하고 public 클래스 이름과 같다", () => {
  for (const s of SNIPPETS) {
    // java-editor.js 의 JAVA_FILE_ID_START_RE(/^[A-Z]$/) 검사를 통과해야 저장이 된다.
    assert.match(s.name, /^[A-Z][A-Za-z0-9]*\.java$/, s.name);
    const cls = s.name.replace(/\.java$/, "");
    const declared = s.code.match(/^public\s+class\s+([A-Za-z_$][\w$]*)/m);
    assert.ok(declared, s.name + ": public class 선언이 있어야 한다");
    assert.equal(declared[1], cls, s.name + ": 파일 이름과 public 클래스 이름이 같아야 한다");
    // public 타입은 파일에 하나뿐이어야 한다.
    assert.equal((s.code.match(/^public\s+(?:class|interface|enum)\s/gm) || []).length, 1, s.name);
    assert.equal((s.code.match(/public\s+static\s+void\s+main\s*\(/g) || []).length, 1,
      s.name + ": main 은 파일당 하나여야 한다(여러 개면 실행 대상 선택 UI가 끼어든다)");
  }
});

test("최상위 클래스 이름은 예제끼리도 겹치지 않는다", () => {
  // 학생이 여러 예제를 한 폴더에 저장해도 서로 헷갈리지 않게 한다.
  const seen = new Map();
  for (const s of SNIPPETS) {
    for (const type of topLevelTypes(s.code)) {
      assert.ok(!seen.has(type), type + " 가 " + seen.get(type) + " 와 " + s.name + " 에 겹쳐 있다");
      seen.set(type, s.name);
    }
  }
});

test("JDK 클래스와 같은 이름은 파일 이름으로 쓰지 않는다", () => {
  // 같은 이름이면 그 클래스를 import 하는 순간 자기 자신과 충돌한다(DayOfWeek → WeekdayFinder).
  const reserved = ["DayOfWeek", "Math", "String", "System", "Object", "Integer", "Double", "Character",
    "List", "ArrayList", "Map", "HashMap", "Set", "HashSet", "Arrays", "Collections", "Random",
    "Scanner", "Comparator", "LocalDate", "LocalDateTime", "Period", "YearMonth", "Thread", "Exception"];
  for (const s of SNIPPETS) {
    assert.ok(!reserved.includes(s.name.replace(/\.java$/, "")), s.name);
  }
});

test("문법은 Java 11 까지만 쓴다", () => {
  for (const s of SNIPPETS) {
    assert.doesNotMatch(s.code, /"""/, s.name + ": 텍스트 블록은 Java 15 부터다");
    assert.doesNotMatch(s.code, /^\s*(?:public\s+)?record\s+[A-Z]/m, s.name + ": record 는 Java 16 부터다");
    assert.doesNotMatch(s.code, /case\s+[^:\n]*->/, s.name + ": switch 식(화살표 라벨)은 Java 14 부터다");
    assert.doesNotMatch(s.code, /\byield\s+[^;\n]+;/, s.name + ": switch 식의 yield 는 Java 14 부터다");
    assert.doesNotMatch(s.code, /\bvar\s+\w+\s*=/, s.name + ": 수업 예제에서는 타입을 적어 보여 준다");
  }
});

test("모든 예제에 난이도·설명·개념 태그가 있다", () => {
  for (const s of SNIPPETS) {
    assert.ok(s.cat && s.title, s.name);
    assert.ok(Number.isInteger(s.level) && s.level >= 1 && s.level <= 5, s.name + ": level 1~5");
    assert.ok(s.desc && s.desc.length >= 10, s.name + ": 한 줄 설명");
    assert.ok(Array.isArray(s.learn) && s.learn.length > 0, s.name + ": 개념 태그");
    assert.ok(s.code.endsWith("\n"), s.name + ": 코드는 줄바꿈으로 끝난다");
    assert.doesNotMatch(s.code, /\r/, s.name + ": 줄 끝은 LF 로 둔다");
  }
});

test("파이썬 짝(pair) 은 중복 없이 붙인다", () => {
  const pairs = SNIPPETS.map(s => s.pair).filter(Boolean);
  assert.equal(new Set(pairs).size, pairs.length, "같은 파이썬 예제를 두 번 가리키면 안 된다");
  assert.ok(pairs.length >= 60, "파이썬과 짝 지은 예제가 60개 이상이어야 한다");
  for (const p of pairs) assert.match(p, /^[a-z0-9-]+$/, p);
});

test("자바의 pair 와 파이썬의 id 는 빠짐없이 맞물린다", () => {
  // 파이썬 목록은 제목도 파일 이름도 중복이 있어(소수.py·회문.py 등) 이름으로는 짝을 못 찾는다.
  // 그래서 명시적 id 로 잇는다 — 한쪽만 고치면 갤러리의 "○○ 버전 보기" 링크가 조용히 사라진다.
  const pySource = fs.readFileSync(path.join(root, "src/js/python-snippets.js"), "utf8");
  const PY = new Function(pySource + "\nreturn PY_SNIPPETS;")();

  const ids = PY.map(s => s.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "파이썬 id 는 중복이 없어야 한다");
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);

  const byId = new Map(PY.filter(s => s.id).map(s => [s.id, s]));
  for (const s of SNIPPETS) {
    if (!s.pair) continue;
    assert.ok(byId.has(s.pair), s.name + " 의 짝 '" + s.pair + "' 인 파이썬 예제가 없다");
  }
  const usedByJava = new Set(SNIPPETS.map(s => s.pair).filter(Boolean));
  for (const id of ids) assert.ok(usedByJava.has(id), "쓰이지 않는 파이썬 id: " + id);
  assert.equal(ids.length, 64);
});
