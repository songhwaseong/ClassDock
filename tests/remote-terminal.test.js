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

test("개인키는 네이티브 선택창의 실행 중 ID로만 전달하고 선택한 키만 사용한다", () => {
  assert.match(ssh, /GetOpenFileName/);
  assert.match(ssh, /public IntPtr lpstrFile/);
  assert.match(ssh, /Marshal\.AllocHGlobal\(capacity \* 2\)/);
  assert.match(ssh, /Marshal\.PtrToStringUni\(fileBuffer\)/);
  assert.doesNotMatch(ssh, /StringBuilder lpstrFile/);
  assert.match(ssh, /PrivateKeyPickerStatusJson/);
  assert.match(ssh, /PrivateKeyPickerName/);
  assert.match(ssh, /PrivateKeyPickerId/);
  assert.doesNotMatch(ssh, /PrivateKeyPickerPath/);
  assert.match(launcher, /path == "\/ssh-key-pick"/);
  assert.match(launcher, /path == "\/ssh-key-pick-status"/);
  assert.match(launcher, /HasLocalActionHeader\(headers\)/);
  assert.match(ui, /"\/ssh-key-pick"/);
  assert.match(ui, /"\/ssh-key-pick-status"/);
  assert.match(ui, /"X-ClassDock-Action":"1"/);
  assert.match(ui, /body:encodeStrings\(\[authentication, host, port, user, secret, selectedKeyId, currentCols, currentRows\]\)/);
  assert.match(ssh, /"-o", "IdentityFile=none"/);
  assert.match(ssh, /"-o", "IdentitiesOnly=yes"/);
  assert.match(ssh, /"-o", "IdentityAgent=none"/);
  assert.match(ssh, /"-i", privateKeyPath/);
  assert.match(ssh, /"-o", "PasswordAuthentication=no"/);
  assert.match(ssh, /"-o", "KbdInteractiveAuthentication=no"/);
  assert.doesNotMatch(ui, /localStorage\.setItem\([^\n]*(?:selectedKey|privateKey|keyPath)/i);
});

test("개인키는 사용자 전용 ACL 사본으로 접속하고 세션이 끝나면 사본을 지운다", () => {
  assert.match(ssh, /StagePrivateKey\(privateKey\.Path\)/);
  assert.match(ssh, /BuildSshArguments\(host, port, user, authentication, stagedKeyPath\)/);
  assert.match(ssh, /session\.StagedKeyPath = stagedKeyPath;/);
  assert.match(ssh, /catch \{ WipeStagedPrivateKey\(stagedKeyPath\); throw; \}/);
  assert.match(ssh, /SetAccessRuleProtection\(true, false\)/);
  assert.match(ssh, /RemoveAccessRuleSpecific\(existing\)/);
  assert.match(ssh, /WindowsIdentity\.GetCurrent\(\)\.User/);
  assert.match(ssh, /new FileSystemAccessRule\(self, FileSystemRights\.FullControl/);
  assert.match(ssh, /static void WipeStagedPrivateKey\(string path\)/);
  assert.match(ssh, /static void SweepStagedPrivateKeys\(\)/);
  assert.match(ssh, /WipeStagedPrivateKey\(stagedKeyPath\);\s*\}\s*$/m);
  assert.doesNotMatch(ssh, /"-i", privateKey\.Path/);
  assert.doesNotMatch(ssh, /icacls/);
  assert.match(ui, /ssh-private-key-secure-copy-failed/);
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

test("장시간 SSH 출력은 원형 버퍼와 분리 잠금으로 입력을 막지 않는다", () => {
  assert.match(ssh, /MaxSessionOutputBytes = 16 \* 1024 \* 1024/);
  assert.match(ssh, /readonly byte\[\] data = new byte\[MaxSessionOutputBytes\]/);
  assert.match(ssh, /Buffer\.BlockCopy/);
  assert.doesNotMatch(ssh, /data\.RemoveRange/);
  assert.match(ssh, /readonly object BufferSync = new object\(\)/);
  assert.match(ssh, /lock \(session\.BufferSync\)[\s\S]*data = session\.Buffer\.Read/);
  assert.match(ssh, /lock \(session\.BufferSync\)[\s\S]*session\.Buffer\.Append/);
});

test("SSH 입력과 xterm 출력은 처리 속도보다 요청 대기열이 커지지 않게 조절한다", () => {
  assert.match(ui, /let inputTimer = 0, inputSending = false/);
  assert.match(ui, /while \(id === sessionId && inputQueue\.length\)/);
  assert.doesNotMatch(ui, /inputChain/);
  // 입력은 지연 없이 즉시 보내되 전송 중이면 큐에 모았다가 한 번에 나간다 — 요청 수는 왕복당 하나.
  assert.match(ui, /if \(inputSending\) return;[\s\S]*flushInput\(\);/);
  // 출력은 평소엔 렌더를 기다리지 않고(에코 지연 최소화) 밀린 양이 임계치를 넘을 때만 기다린다.
  assert.match(ui, /target\.write\(bytes, done\)/);
  assert.match(ui, /pendingWriteBytes > WRITE_BACKPRESSURE_BYTES\) await written/);
});

test("이전 xterm의 지연 write 콜백은 재접속한 터미널의 백프레셔를 줄이지 않는다", () => {
  assert.match(ui, /let pendingWriteBytes = 0, lastWrite = null, writeEpoch = 0/);
  assert.match(ui, /resetWriteBackpressure = \(\) => \{ writeEpoch\+\+; pendingWriteBytes = 0; lastWrite = null; \}/);
  assert.match(ui, /const size = bytes\.length, epoch = writeEpoch/);
  assert.match(ui, /if \(epoch === writeEpoch\) pendingWriteBytes = Math\.max\(0, pendingWriteBytes - size\)/);
  assert.match(ui, /if \(terminal\) terminal\.dispose\(\);\s*resetWriteBackpressure\(\);/);
});

test("SSH 폴 응답은 크기 상한을 두고 남은 출력은 다음 폴에서 이어 받는다", () => {
  assert.match(ssh, /MaxPollBytes = 256 \* 1024/);
  assert.match(ssh, /session\.Buffer\.Read\(offset, MaxPollBytes, out next, out reset\)/);
  assert.match(ssh, /more = next < session\.Buffer\.End/);
  assert.match(ssh, /\\"more\\":/);
  // 상한에 걸려 남은 분량이 있으면 세션이 끝났어도 다 받은 뒤에 종료 처리를 한다.
  assert.match(ui, /\(data\.complete \|\| data\.alive === false\) && !data\.more/);
});

test("요청 핸들러가 스레드를 오래 잡아도 다른 요청이 대기하지 않게 스레드풀 최소치를 올린다", () => {
  assert.match(launcher, /ThreadPool\.GetMinThreads\(out minWorker, out minIo\)/);
  assert.match(launcher, /ThreadPool\.SetMinThreads\(wantedWorker, minIo\)/);
});

test("SSH 출력 폴링은 서버에서 기다렸다가 출력 즉시 깨어나 연결 생성을 줄인다", () => {
  assert.match(ssh, /LongPollWaitMs = 500/);
  assert.match(ssh, /Monitor\.Wait\(session\.BufferSync, LongPollWaitMs\)/);
  assert.match(ssh, /session\.Buffer\.Append\(buffer, read\);[\s\S]*Monitor\.PulseAll\(session\.BufferSync\)/);
  assert.doesNotMatch(ui, /setTimeout\(resolve, 55\)/);
});

test("SSH 폴링 일시 실패는 빠르게 재시도하고 성공하면 이전 상태를 복원한다", () => {
  assert.match(ui, /pollStatusBeforeRetry = terminalStatus\.textContent/);
  assert.match(ui, /terminalStatus\.textContent = pollStatusBeforeRetry \|\| "접속됨"/);
  assert.match(ui, /Math\.min\(1000, 60 \* pollFailures\)/);
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
  assert.equal(classify("Load key id_ed25519: incorrect passphrase supplied to decrypt private key", 255).status, "키 암호 오류");
  assert.equal(classify("Load key id_rsa: invalid format", 255).status, "개인키 오류");
  assert.equal(classify("Permission denied (publickey).", 255).message.includes("authorized_keys"), true);
  assert.equal(classify("logout", 0).status, "정상 종료");
});

test("종료된 터미널은 비밀번호만 비우고 재접속하며 무한 상태 재시도를 막는다", () => {
  assert.match(ui, /retryButton = button\("재접속"/);
  assert.match(ui, /passwordInput\.value = "";[\s\S]*showForm\(message[\s\S]*!privateKey\)/);
  assert.match(ui, /IP·포트·계정은 유지되고 비밀번호만 다시 입력합니다/);
  assert.match(ui, /접속 정보와 선택한 개인키를 유지합니다/);
  assert.match(ui, /pollFailures >= 12/);
  assert.match(ui, /fetchTimed\("\/ssh-host-key-scan"/);
  assert.match(ui, /pointercancel/);
});

test("터미널 글꼴·크기·줄 간격을 즉시 적용하고 안전한 값만 기억한다", () => {
  assert.match(ui, /const FONT_KEY = "classdockSshFontV1"/);
  assert.match(ui, /cascadia:[^\n]*Cascadia Mono/);
  assert.match(ui, /d2coding:[^\n]*D2Coding/);
  assert.match(ui, /nanum:[^\n]*NanumGothicCoding/);
  assert.match(ui, /terminalFontSize = Math\.max\(11, Math\.min\(24/);
  assert.match(ui, /const values = \[1, 1\.15, 1\.3, 1\.5\]/);
  assert.match(ui, /terminal\.options\.fontFamily = FONT_STACKS\[fontChoice\]/);
  assert.match(ui, /terminal\.options\.fontSize = terminalFontSize/);
  assert.match(ui, /terminal\.options\.lineHeight = terminalLineHeight/);
  assert.match(ui, /localStorage\.setItem\(FONT_KEY/);
  assert.match(ui, /aria-label", "터미널 글꼴 설정/);
});

test("실제 xterm 셀 크기와 하단 안전 여백으로 작업 표시줄 위에 마지막 줄을 유지한다", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(ui, /querySelector\("\.xterm-screen"\)/);
  assert.match(ui, /screenRect\.height \/ terminal\.rows/);
  assert.match(ui, /Math\.floor\(innerHeight \/ cellHeight\) - 1/);
  assert.match(ui, /terminalView\.hidden \|\| dockCollapsed \|\| dock\.hidden/);
  assert.match(ui, /window\.visualViewport\.addEventListener\("resize", sendResize\)/);
  assert.match(css, /\.ssh-xterm-host\{[^}]*overflow:hidden[^}]*padding:10px 12px 16px/);
});
