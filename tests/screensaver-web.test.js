"use strict";

/* 대기 화면 '웹 주소(URL)' 모드 — 주소 정규화, 삽입 차단 판정, 입력 해제가 계속 먹는지,
   그리고 안 열릴 때 영상·애니메이션으로 내려가는 폴백이 코드에 실제로 있는지 확인한다. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stateSource = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
const ssSource = fs.readFileSync(path.join(__dirname, "../src/js/screensaver.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../manneung-classroom.html"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

// state.js 에서 정규화 함수만 떼어내 실행한다(문서·localStorage 없이 검증).
const normStart = stateSource.indexOf("const SS_BLOCKED_SCHEME");
const normEnd = stateSource.indexOf("function normalizePetFocus");
assert.ok(normStart > 0 && normEnd > normStart, "정규화 함수 구간을 찾아야 한다");
const { normalizeScreensaverUrl, normalizeScreensaver, youtubeEmbedUrl, youtubeStartSeconds } = new Function(
  stateSource.slice(normStart, normEnd) + "\nreturn { normalizeScreensaverUrl, normalizeScreensaver, youtubeEmbedUrl, youtubeStartSeconds };"
)();

test("웹 주소 정규화: http/https 만 통과하고 스킴이 없으면 https 를 붙인다", () => {
  assert.equal(normalizeScreensaverUrl("https://earth.nullschool.net/ko/"), "https://earth.nullschool.net/ko/");
  assert.equal(normalizeScreensaverUrl("http://example.com/a"), "http://example.com/a");
  // 교사가 주소창에서 복사해 스킴 없이 붙여 넣는 경우
  assert.equal(normalizeScreensaverUrl("earth.nullschool.net/ko/"), "https://earth.nullschool.net/ko/");
  assert.equal(normalizeScreensaverUrl("  example.com  "), "https://example.com/");
  // 해시(#) 안의 좌표·옵션은 그대로 살아 있어야 대기 화면이 같은 장면을 띄운다
  assert.ok(normalizeScreensaverUrl("https://earth.nullschool.net/ko/#current/wind/surface/level/orthographic=-234,27,1900")
    .includes("#current/wind/surface/level/orthographic=-234,27,1900"));
});

test("웹 주소 정규화: 오버레이에서 코드가 돌 수 있는 스킴은 막는다", () => {
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "  javascript : alert(1)", "data:text/html,<b>x", "vbscript:msgbox", "file:///C:/Windows", "blob:https://x/y", "about:blank", "view-source:https://example.com"]){
    assert.equal(normalizeScreensaverUrl(bad), "", bad + " 는 걸러야 한다");
  }
  for (const empty of ["", "   ", null, undefined, {}]) assert.equal(normalizeScreensaverUrl(empty), "");
  // 주소처럼 생기지 않은 오타는 https:// 를 붙여 억지로 살리지 않는다(저장은 되는데 안 열리는 상황 방지)
  for (const typo of ["abc", "0", "네이버", "  검색어 "]) assert.equal(normalizeScreensaverUrl(typo), "", typo + " 는 주소가 아니다");
  assert.equal(normalizeScreensaverUrl("localhost:17645/"), "http://localhost:17645/".replace("http:", "https:"));
});

test("설정 정규화: mode 는 video/web 만, 잘못된 주소는 빈 값으로 떨어진다", () => {
  const def = normalizeScreensaver();
  assert.equal(def.mode, "video");
  assert.equal(def.url, "");
  assert.equal(normalizeScreensaver({ mode: "web", url: "example.com" }).mode, "web");
  assert.equal(normalizeScreensaver({ mode: "무엇", url: "example.com" }).mode, "video");
  assert.equal(normalizeScreensaver({ mode: "web", url: "javascript:alert(1)" }).url, "");
  // 기존 항목은 그대로 유지된다(예전 설정을 읽어도 깨지지 않아야 한다)
  const kept = normalizeScreensaver({ enabled: true, idleMin: 10, sound: true });
  assert.deepEqual(kept, { enabled: true, idleMin: 10, sound: true, mode: "video", url: "" });
});

test("삽입 차단 판정: about:blank 에 머물면 차단, 읽기가 막히면 정상 로드로 본다", () => {
  const blockedStart = ssSource.indexOf("function screensaverFrameBlocked");
  const blockedEnd = ssSource.indexOf("function ssStopWebGuard");
  assert.ok(blockedStart > 0 && blockedEnd > blockedStart);
  const { screensaverFrameBlocked } = new Function(
    ssSource.slice(blockedStart, blockedEnd) + "\nreturn { screensaverFrameBlocked };"
  )();
  // 삽입 거부 — 프레임이 처음의 about:blank 에 머물러 우리 오리진으로 읽힌다
  assert.equal(screensaverFrameBlocked({ contentWindow: { location: { href: "about:blank" } } }), true);
  assert.equal(screensaverFrameBlocked({ contentWindow: { location: { href: "" } } }), true);
  // 정상 로드 — 다른 오리진이라 읽기가 SecurityError 로 막힌다
  const crossOrigin = { get contentWindow(){ throw new Error("SecurityError"); } };
  assert.equal(screensaverFrameBlocked(crossOrigin), false);
  assert.equal(screensaverFrameBlocked({ contentWindow: { location: { href: "https://earth.nullschool.net/ko/" } } }), false);
});

test("웹 주소 프레임은 최상위 이동·팝업·다운로드를 못 하게 sandbox 로 묶는다", () => {
  // 스크립트와 자기 오리진 접근은 있어야 지도가 움직인다. 나머지 권한은 주지 않는다.
  const grants = [...ssSource.matchAll(/setAttribute\("sandbox",\s*"([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(grants.length >= 2, "대기 화면 프레임과 미리보기 프레임 모두 sandbox 가 있어야 한다");
  for (const grant of grants){
    assert.equal(grant, "allow-scripts allow-same-origin");
    for (const forbidden of ["allow-top-navigation", "allow-popups", "allow-downloads", "allow-forms", "allow-modals"]){
      assert.ok(!grant.includes(forbidden), forbidden + " 은 주지 않는다");
    }
  }
  // 리퍼러는 브라우저 기본값 — 끊어 버리면 유튜브 등에서 재생이 막히는 영상이 생긴다(전달되는 건 localhost 출처뿐).
  assert.ok(/SS_WEB_REFERRER\s*=\s*"strict-origin-when-cross-origin"/.test(ssSource));
  const referrers = (ssSource.match(/setAttribute\("referrerpolicy", SS_WEB_REFERRER\)/g) || []).length;
  assert.equal(referrers, 2, "대기 화면과 미리보기가 같은 리퍼러 정책을 써야 미리보기가 실제와 같다");
});

test("미리보기와 대기 화면이 같은 기능 권한을 넘겨 유튜브 퍼가기가 그대로 재생된다", () => {
  // encrypted-media 가 빠지면 DRM 스트림이 재생되지 않고, 미리보기에만 allow 가 없으면
  // 자동재생이 안 돼 실패한 것처럼 보인다 — 두 프레임이 같은 값을 써야 한다.
  const allowMatch = ssSource.match(/const SS_WEB_ALLOW = "([^"]+)"/);
  assert.ok(allowMatch, "권한 목록이 한곳에 정의돼 있어야 한다");
  for (const feature of ["autoplay", "encrypted-media"]) assert.ok(allowMatch[1].includes(feature), feature + " 는 있어야 한다");
  // 대기 화면에 필요 없는 권한은 넣지 않는다(넣으면 권한 창이 뜬다)
  for (const feature of ["camera", "microphone", "geolocation", "display-capture"]){
    assert.ok(!allowMatch[1].includes(feature), feature + " 는 넣지 않는다");
  }
  const allows = (ssSource.match(/setAttribute\("allow", SS_WEB_ALLOW\)/g) || []).length;
  assert.equal(allows, 2, "대기 화면과 미리보기 프레임 모두 같은 권한을 써야 한다");
});

test("크로스 오리진 프레임 위에서도 입력 해제가 먹도록 캡처 레이어와 포커스 고정이 있다", () => {
  assert.ok(ssSource.includes('cap.className = "ss-capture"'), "마우스를 가로챌 투명 레이어를 덮어야 한다");
  assert.ok(/cap\.tabIndex\s*=\s*0/.test(ssSource), "키보드 포커스를 받을 수 있어야 한다");
  assert.ok(/document\.activeElement\s*!==\s*cap/.test(ssSource), "포커스가 새면 되돌려야 한다");
  assert.ok(ssSource.includes("ssStopWebGuard()") && ssSource.includes("function hideScreensaver"), "해제할 때 감시 타이머를 멈춰야 한다");
  // 캡처 레이어가 프레임 위, 해제 안내는 그보다 위에 오도록 z-index 가 잡혀 있어야 한다
  assert.ok(/\.ss-capture\{[^}]*z-index:2/.test(cssSource));
  assert.ok(/\.ss-hint\{[^}]*z-index:3/.test(cssSource));
  assert.ok(/\.ss-web\{[^}]*position:absolute/.test(cssSource));
});

test("웹 → 영상 → 애니메이션 폴백과 오프라인·타임아웃 대비가 있다", () => {
  assert.ok(ssSource.includes("navigator.onLine === false"), "오프라인이면 시도조차 하지 않는다");
  assert.ok(/ssWebTimer\s*=\s*setTimeout\(\(\)\s*=>\s*fail\("timeout"\)/.test(ssSource), "load 가 안 오면 폴백해야 한다");
  assert.ok(/probeScreensaverWebUrl\(url,[^)]+\)\.then/.test(ssSource), "iframe load 와 별도로 실제 네트워크 연결도 확인해야 한다");
  assert.ok(/mode:\s*"no-cors"/.test(ssSource), "크로스 오리진 공개 페이지도 CORS 때문에 오판하지 않아야 한다");
  const runtimeLoad = ssSource.slice(ssSource.indexOf('frame.addEventListener("load"'), ssSource.indexOf('frame.addEventListener("load"') + 260);
  assert.ok(!runtimeLoad.includes("clearTimeout(ssWebTimer)"), "iframe load 만으로 실패 타이머를 해제하면 안 된다");
  assert.ok(ssSource.includes('fail("blocked")'), "삽입 차단이면 폴백해야 한다");
  assert.ok(/if \(!startScreensaverVideo\(ov, keys, sound\)\) startScreensaverAnimation\(ov\);/.test(ssSource),
    "웹이 실패하면 영상 → 애니메이션 순으로 내려가야 한다");
  // 대기 화면을 끌 때 프레임을 끊지 않으면 뒤에서 계속 돌며 CPU 를 먹는다
  assert.ok(ssSource.includes('w.src = "about:blank"'));
});

test("설정 화면: 모드 선택·주소칸·테스트 버튼·미리보기·로그인 경고가 있다", () => {
  for (const id of ["settingScreensaverMode", "settingScreensaverUrl", "settingScreensaverTest", "settingScreensaverPreview", "settingScreensaverTestResult", "settingScreensaverWebRow"]){
    assert.ok(htmlSource.includes('id="' + id + '"'), id + " 이 설정 화면에 있어야 한다");
  }
  assert.ok(htmlSource.includes('data-i18n="ss.web.warn"'), "로그인된 페이지 경고는 번역 대상이어야 한다");
  assert.ok(/로그인된 페이지는 넣지 마세요/.test(htmlSource), "로그인 상태가 그대로 뜬다는 경고가 있어야 한다");
  assert.ok(/미리보기 · 테스트/.test(htmlSource));
  const i18nSource = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  for (const key of ["ss.web.warn", "ss.web.desc"]) assert.ok(i18nSource.includes('"' + key + '"'), key + " 영문이 있어야 한다");
});

test("유튜브 변환: watch·youtu.be·shorts·live 주소에서 영상 ID 를 뽑아 퍼가기 주소로 바꾼다", () => {
  const ID = "bUYizFVMTSo";
  for (const raw of [
    "https://www.youtube.com/watch?v=" + ID,
    "https://youtube.com/watch?v=" + ID + "&feature=share",
    "https://m.youtube.com/watch?v=" + ID,
    "https://youtu.be/" + ID,
    "https://www.youtube.com/shorts/" + ID,
    "https://www.youtube.com/live/" + ID,
    "youtube.com/watch?v=" + ID   // 스킴 없이 붙여 넣어도 된다
  ]){
    const out = youtubeEmbedUrl(raw);
    assert.ok(out, raw + " 는 바꿀 수 있어야 한다");
    const u = new URL(out.url);
    assert.equal(u.origin + u.pathname, "https://www.youtube.com/embed/" + ID);
    // 유튜브는 loop 만으로는 한 번 재생하고 멈춘다 — 자기 자신을 playlist 로 지정해야 반복된다
    assert.equal(u.searchParams.get("loop"), "1");
    assert.equal(u.searchParams.get("playlist"), ID);
    // mute 가 없으면 브라우저 자동재생 정책에 막혀 아예 시작되지 않는다
    assert.equal(u.searchParams.get("autoplay"), "1");
    assert.equal(u.searchParams.get("mute"), "1");
    assert.equal(u.searchParams.get("cc_load_policy"), "0");
    assert.ok(out.notes.length, "무엇을 왜 바꿨는지 알려 줘야 한다");
  }
});

test("유튜브 변환: 재생목록·시작 시간·nocookie 를 살린다", () => {
  const list = youtubeEmbedUrl("https://www.youtube.com/playlist?list=PLabcdefghijklmnop");
  const lu = new URL(list.url);
  assert.equal(lu.pathname, "/embed/videoseries");
  assert.equal(lu.searchParams.get("list"), "PLabcdefghijklmnop");
  assert.equal(lu.searchParams.get("loop"), "1");
  assert.equal(lu.searchParams.get("cc_load_policy"), "0");
  // 시작 시간은 t=1h2m3s·90s·90 형태를 초로 옮긴다
  assert.equal(youtubeStartSeconds("1h2m3s"), 3723);
  assert.equal(youtubeStartSeconds("90s"), 90);
  assert.equal(youtubeStartSeconds("90"), 90);
  assert.equal(youtubeStartSeconds("2m"), 120);
  assert.equal(youtubeStartSeconds("아무거나"), 0);
  const timed = new URL(youtubeEmbedUrl("https://youtu.be/bUYizFVMTSo?t=1m30s").url);
  assert.equal(timed.searchParams.get("start"), "90");
  // nocookie 로 넣었으면 그대로 nocookie 로 만든다
  assert.ok(youtubeEmbedUrl("https://www.youtube-nocookie.com/watch?v=bUYizFVMTSo").url.startsWith("https://www.youtube-nocookie.com/embed/"));
  // 재생목록 안의 영상은 그 영상만 반복하고, 목록을 뺐다는 사실을 알려 준다
  const both = youtubeEmbedUrl("https://www.youtube.com/watch?v=bUYizFVMTSo&list=PLabcdefghijklmnop");
  assert.equal(new URL(both.url).searchParams.get("list"), null);
  assert.ok(both.notes.some(n => n.includes("재생목록")), "목록을 뺐다는 안내가 있어야 한다");
});

test("유튜브 변환: 바꿀 게 없으면 버튼이 뜨지 않도록 null 을 돌려준다", () => {
  for (const raw of [
    "https://www.youtube.com/embed/bUYizFVMTSo?autoplay=1&cc_load_policy=0",   // 이미 필요한 값이 모두 붙은 퍼가기 주소
    "https://www.youtube.com/@somechannel",                   // 틀 영상이 없다
    "https://www.youtube.com/results?search_query=hi",
    "https://earth.nullschool.net/ko/",                       // 유튜브가 아니다
    "https://notyoutube.com/watch?v=bUYizFVMTSo",
    "javascript:alert(1)", "", "   "
  ]) assert.equal(youtubeEmbedUrl(raw), null, raw + " 는 바꿀 게 없다");
});

test("유튜브 변환: 기존 퍼가기 주소도 cc_load_policy=0 을 보완하고 다른 옵션은 지키는다", () => {
  const out = youtubeEmbedUrl("https://www.youtube.com/embed/bUYizFVMTSo?autoplay=1&mute=1&controls=0");
  assert.ok(out);
  const u = new URL(out.url);
  assert.equal(u.searchParams.get("cc_load_policy"), "0");
  assert.equal(u.searchParams.get("autoplay"), "1");
  assert.equal(u.searchParams.get("mute"), "1");
  assert.equal(u.searchParams.get("controls"), "0");
  assert.ok(out.notes.some(n => n.includes("자막")));
});

test("유튜브 버튼은 바꿀 수 있을 때만 뜨고, 누르면 무엇을 바꿨는지 알려 준다", () => {
  assert.ok(htmlSource.includes('id="settingScreensaverYoutube"'), "버튼이 설정 화면에 있어야 한다");
  assert.ok(/id="settingScreensaverYoutube"[^>]*hidden/.test(htmlSource), "기본은 숨김이어야 한다");
  assert.ok(/button\.hidden = !\(typeof youtubeEmbedUrl === "function" && youtubeEmbedUrl\(input\.value\)\)/.test(appSource),
    "바꿀 수 있는 주소일 때만 버튼을 띄운다");
  assert.ok(appSource.includes("converted.notes.map(translateScreensaverNote)"), "무엇을 왜 바꿨는지 번역해 보여 줘야 한다");
  assert.ok(/input\.value = converted\.url/.test(appSource), "주소칸 내용이 실제로 바뀌어야 한다(조용히 다른 값을 저장하지 않는다)");
});

test("설정 저장: 잘못된 주소는 저장을 막고, 미리보기는 닫을 때 정리한다", () => {
  assert.ok(/if \(ssMode === "web" && !ssUrl\)\{[\s\S]{0,500}return;/.test(appSource),
    "web 모드인데 주소가 비면 저장하지 않아야 한다");
  assert.ok(appSource.includes("mode: ssMode, url: ssUrl"), "설정에 mode·url 이 실제로 저장되어야 한다");
  const clears = (appSource.match(/clearScreensaverPreview\(\)/g) || []).length;
  assert.ok(clears >= 4, "설정 열기·저장·취소·모드 변경 때 미리보기를 비워야 한다 (현재 " + clears + "곳)");
});

test("주소를 수정하면 이전 미리보기와 늦게 도착한 테스트 결과를 폐기한다", () => {
  assert.ok(/settingScreensaverUrl"\)\) byId\("settingScreensaverUrl"\)\.addEventListener\("input", \(\) => \{\s*clearScreensaverPreview\(\)/.test(appSource),
    "주소 입력 즉시 이전 성공 표시를 지워야 한다");
  assert.ok(/const run = \+\+screensaverPreviewRun/.test(appSource), "테스트마다 실행 번호를 발급해야 한다");
  assert.ok(/if \(run !== screensaverPreviewRun\) return/.test(appSource), "주소 변경 뒤 도착한 예전 결과를 버려야 한다");
});

test("대기 화면 URL의 동적 진행·성공·실패 문구도 영어 번역 경로를 탄다", () => {
  const i18nSource = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  for (const text of [
    "여는 중…", "페이지를 여는 중이에요…", "페이지에 연결할 수 없어요. 주소·인터넷 연결·보안 인증서를 확인해 주세요.",
    "정상적으로 열렸어요. 아래 미리보기를 확인한 뒤 설정을 저장하세요.", "퍼가기 주소로 바꿨어요."
  ]) assert.ok(i18nSource.includes('"' + text + '"'), text + " 영문 번역이 있어야 한다");
  assert.ok(appSource.includes('button.textContent = screensaverT("여는 중…")'));
  assert.ok(ssSource.includes('message:screensaverText("주소가 올바르지 않아요.'));
  assert.ok(appSource.includes("converted.notes.map(translateScreensaverNote)"), "유튜브 변환 설명도 번역해야 한다");
});
