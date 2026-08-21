"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const launcher = fs.readFileSync(path.join(root, "desktop", "launcher.cs"), "utf8");
const ssh = fs.readFileSync(path.join(root, "desktop", "ssh_terminal.cs"), "utf8");
const ui = fs.readFileSync(path.join(root, "src", "js", "remote-terminal.js"), "utf8");
const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const build = fs.readFileSync(path.join(root, "desktop", "build.bat"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));

const uiApi = () => {
  const context = {
    TextEncoder, TextDecoder,
    document:{ getElementById:() => null },
    globalThis:null
  };
  context.globalThis = context;
  vm.runInNewContext(ui + "\nglobalThis.__remoteTerminalApi = MNRemoteTerminal;", context);
  return context.__remoteTerminalApi;
};

test("원격 터미널은 사이드바의 독립 기능이며 xterm을 지연 로드한다", () => {
  assert.match(html, /id="remoteTerminalOpen"[\s\S]*원격 터미널/);
  assert.ok(manifest.localScripts.includes("remote-terminal.js"));
  assert.ok(manifest.vendorScripts.some((item) => item.file === "xterm.js" && item.lazy === "xterm" && /^sha384-/.test(item.sha384)));
  assert.match(ui, /MNLazy\.tryNeed\("xterm"\)/);
  assert.match(ui, /new Terminal\(/);
  assert.match(ui, /terminal\.onData\(queueInput\)/);
});

test("원격 터미널은 문서와 좌우 도킹하고 연결을 유지한 채 접을 수 있다", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(ui, /main\.append\(divider, dock\)/);
  assert.match(ui, /ssh-dock-left/);
  assert.match(ui, /setDockCollapsed\(true\)/);
  assert.match(ui, /dockSide === "right" \? "left" : "right"/);
  assert.match(ui, /--ssh-dock-width/);
  assert.match(ui, /localStorage\.setItem\(DOCK_KEY/);
  assert.match(ui, /rail\.addEventListener\("click", \(\) => setDockCollapsed\(false\)\)/);
  assert.match(css, /\.ssh-dock\{[^}]*flex:0 0/);
  assert.match(css, /main\.ssh-dock-left \.ssh-dock/);
  assert.match(css, /main\.ssh-dock-collapsed \.ssh-terminal-card\{display:none\}/);
});

test("SSH API는 로컬 실행 토큰으로 보호되고 EXE 빌드에 전용 백엔드가 포함된다", () => {
  assert.match(launcher, /path\.StartsWith\("\/ssh-"[\s\S]*return true/);
  assert.match(launcher, /ClassDockSshTerminal\.Open\(body\)/);
  assert.match(launcher, /ClassDockSshTerminal\.ShutdownAll\(\)/);
  assert.match(build, /"launcher\.cs" "ssh_terminal\.cs"/);
});

test("비밀번호는 저장소·명령행·환경변수가 아닌 일회성 named pipe로 전달한다", () => {
  assert.match(ssh, /NamedPipeServerStream/);
  assert.match(ssh, /NamedPipeClientStream/);
  assert.match(ssh, /CLASSDOCK_SSH_ASKPASS_PIPE/);
  assert.match(ssh, /SSH_ASKPASS_REQUIRE/);
  assert.doesNotMatch(ssh, /environment\["[^\"]*PASSWORD[^\"]*"\]/i);
  assert.doesNotMatch(ssh, /(?:-pw|-password)\s/);
  assert.doesNotMatch(ui, /localStorage\.setItem\([^\n]*(?:password|비밀번호)/i);
  assert.match(ui, /passwordInput\.value = ""/);
  assert.match(ui, /host:hostInput\.value\.trim\(\), port:portInput\.value\.trim\(\), user:userInput\.value\.trim\(\)/);
});

test("최초 서버 지문을 확인하고 신뢰된 키만으로 접속한다", () => {
  assert.match(ssh, /ssh-keyscan\.exe/);
  assert.match(ssh, /ProbeHostKeyWithSsh/);
  assert.match(ssh, /StrictHostKeyChecking=accept-new/);
  assert.match(ssh, /PasswordAuthentication=no/);
  assert.match(ssh, /classdock_ssh_scan_/);
  assert.match(ssh, /File\.Delete\(scanPath\)/);
  assert.match(ssh, /SHA256:/);
  assert.match(ssh, /StrictHostKeyChecking=yes/);
  assert.match(ssh, /UserKnownHostsFile=/);
  assert.match(ssh, /GlobalKnownHostsFile=NUL/);
  assert.match(ssh, /-F", "NUL"/);
  assert.match(ui, /\/ssh-host-key-scan/);
  assert.match(ui, /\/ssh-host-key-trust/);
  assert.match(ui, /서버의 SSH 지문이 이전 접속과 달라졌습니다/);
  assert.match(ui, /confirmModal\.classList\.add\("ssh-confirm-front"\)/);
  assert.match(fs.readFileSync(path.join(root, "src", "styles.css"), "utf8"), /\.modal\.ssh-confirm-front\{z-index:1270\}/);
});

test("ConPTY 입출력과 크기 변경으로 대화형 원격 PTY를 유지한다", () => {
  assert.match(ssh, /GetProcAddress\(kernel32, "CreatePseudoConsole"\)/);
  assert.doesNotMatch(ssh, /Environment\.OSVersion/);
  assert.match(ssh, /CreatePseudoConsole/);
  assert.match(ssh, /ResizePseudoConsole/);
  assert.match(ssh, /PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE/);
  assert.match(ssh, /PreferredAuthentications=password,keyboard-interactive/);
  assert.match(ssh, /ClearAllForwardings=yes/);
  assert.match(ui, /\/ssh-session-input/);
  assert.match(ui, /\/ssh-session-poll/);
  assert.match(ui, /\/ssh-session-resize/);
  assert.match(ui, /\/ssh-session-stop/);
});

test("사전 기능 검사는 실제 실패 원인을 숨기지 않는다", () => {
  assert.match(ui, /statusEl\.textContent = friendlyError\(error\)/);
  assert.match(ui, /원격 터미널은 ClassDock\.exe에서만 사용할 수 있습니다/);
});

test("SSH 종료 출력은 인증·시간 초과·거부·DNS·네트워크·지문 오류를 구분한다", () => {
  const classify = uiApi().classifySshFailure;
  assert.equal(classify("Permission denied, please try again.", 255).status, "인증 실패");
  assert.equal(classify("ssh: connect to host 10.0.0.1 port 22: Connection timed out", 255).status, "연결 시간 초과");
  assert.equal(classify("Connection refused", 255).status, "연결 거부");
  assert.equal(classify("Could not resolve hostname lab", 255).status, "호스트 오류");
  assert.equal(classify("No route to host", 255).status, "네트워크 오류");
  assert.equal(classify("REMOTE HOST IDENTIFICATION HAS CHANGED!", 255).status, "지문 확인 실패");
  assert.equal(classify("logout", 0).status, "정상 종료");
});

test("종료된 터미널은 비밀번호만 비우고 재접속하며 무한 상태 재시도를 막는다", () => {
  assert.match(ui, /retryButton = button\("재접속"/);
  assert.match(ui, /passwordInput\.value = "";[\s\S]*showForm\(message[^,]*, true\)/);
  assert.match(ui, /IP·포트·계정은 유지되고 비밀번호만 다시 입력합니다/);
  assert.match(ui, /pollFailures >= 12/);
  assert.match(ui, /fetchTimed\("\/ssh-host-key-scan"/);
  assert.match(ui, /pointercancel/);
});
