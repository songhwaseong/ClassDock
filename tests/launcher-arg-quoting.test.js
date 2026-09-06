// 프로세스 인자 인용.
//
// 런처는 UseShellExecute=false 로 실행하므로 셸 해석은 없다. 그래도 .NET 은 인자를 문자열 하나로
// 받아 CreateProcess 에 넘기고, 따옴표·공백을 그 문자열이 스스로 갈라야 한다. 손으로 따옴표를
// 붙이면 값에 따옴표나 공백이 섞이는 순간 인자가 갈라진다.
//
// 지금까지 새지 않은 이유는 Windows 경로에 따옴표를 못 쓰고, 자바 클래스·패키지 이름은 정규식으로
// 뽑은 식별자라 공백이 못 들어가기 때문이었다 - 코드 어디에도 적히지 않은 약속이었다. 파서를 조금만
// 느슨하게 고치면 그 약속이 깨진다. 그래서 값이 무엇이든 한 인자로 넘어가도록 인용을 한 곳에 모았다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");

test("따옴표 붙이기는 QuoteProcessArgument 한 곳에 있다", () => {
  // Windows 규칙: 백슬래시는 따옴표 앞에서만 두 배가 되고, 끝 백슬래시도 두 배가 되어야
  // 닫는 따옴표를 잡아먹지 않는다.
  const start = launcher.indexOf("static string QuoteProcessArgument(string value)");
  assert.ok(start > 0);
  const body = launcher.slice(start, launcher.indexOf("\n    }", start));
  assert.match(body, /IndexOfAny\(new char\[\] \{ ' ', '\\t', '\\n', '\\v', '"' \}\) < 0\) return value;/);
  assert.match(body, /result\.Append\('\\\\', slashes \* 2 \+ 1\)\.Append\('"'\);/);
  assert.match(body, /result\.Append\('\\\\', slashes \* 2\)\.Append\('"'\);/);
});

test("자바 실행·컴파일 인자는 손으로 따옴표를 붙이지 않는다", () => {
  assert.match(launcher, /args \+= "-cp " \+ QuoteProcessArgument\(classPath\) \+ " " \+ QuoteProcessArgument\(qualifiedClassName\);/);
  assert.match(launcher, /"-jar " \+ QuoteProcessArgument\(junitJar\) \+ " execute --class-path " \+ QuoteProcessArgument\(classPath\)/);
  assert.match(launcher, /-encoding UTF-8 -cp " \+ QuoteProcessArgument\(classPath\)/);
  assert.match(launcher, /-sourcepath " \+ QuoteProcessArgument\(tempRoot\)/);
  assert.match(launcher, /-d " \+ QuoteProcessArgument\(tempRoot\)/);
  assert.match(launcher, /\(lint \? " -Xlint:all" : ""\) \+ " " \+ QuoteProcessArgument\(scriptPath\);/);
  assert.match(launcher, /-processorpath " \+ QuoteProcessArgument\(jars\)/);

  // 예전에 클래스 이름은 아예 따옴표가 없었다. 그 모양으로 돌아가면 안 된다.
  assert.ok(!launcher.includes('+ "\\" " + qualifiedClassName'),
    "클래스 이름을 따옴표 없이 이어 붙이던 모양이 되살아났다");
});

test("파이썬 점검의 -c 는 경로가 아니라 소스라 특히 인용한다", () => {
  assert.match(launcher, /"-c " \+ QuoteProcessArgument\(code\);/);
  // 지금 호출부는 모두 고정 문자열이다 - 변수를 넘기게 되어도 안전하도록 인용해 둔 것이다.
  const calls = launcher.match(/RunPyCheck\(interp, [^)]*\)/g) || [];
  assert.ok(calls.length >= 2);
  for (const call of calls) assert.match(call, /RunPyCheck\(interp, "[^"]*"\)/, call);
});

test("자바·파이썬 계열 인자에는 손으로 붙인 따옴표가 남아 있지 않다", () => {
  // 자바 인자를 만드는 두 함수 안에는 \" 가 인코딩 지정 말고는 없어야 한다.
  for (const marker of ["static string StartJavaSessionProcess", "static bool CompileJavaSource"]){
    const at = launcher.indexOf(marker);
    assert.ok(at > 0, marker);
    const argsAt = launcher.indexOf("string args =", at);
    const psiAt = launcher.indexOf("ProcessStartInfo psi", argsAt);
    const block = launcher.slice(argsAt, psiAt);
    assert.ok(!block.includes('\\"'), marker + " 의 인자 문자열에 손으로 붙인 따옴표가 남아 있다");
  }
});

test("모든 프로세스 실행은 셸을 거치지 않는다", () => {
  // 인용이 중요한 이유의 절반은 여기서 이미 막혀 있다 - 셸이 없으니 리다이렉션·파이프는 해석되지 않는다.
  // 나머지 절반(인자가 갈라지는 것)을 QuoteProcessArgument 가 막는다.
  const starts = (launcher.match(/new ProcessStartInfo\(/g) || []).length;
  const shellFalse = (launcher.match(/UseShellExecute = false/g) || []).length;
  assert.ok(shellFalse >= starts - 3, `ProcessStartInfo ${starts}개 중 UseShellExecute=false 가 ${shellFalse}개뿐이다`);
  // 폴더·파일 열기(탐색기에 맡기는 것)만 셸을 쓴다.
  const shellTrue = launcher.match(/UseShellExecute = true/g) || [];
  assert.ok(shellTrue.length <= 4, "셸로 여는 자리가 늘었다 - 각각 무엇을 여는지 확인이 필요하다");
});
