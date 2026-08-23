const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const R = require("../src/js/exchange-rate.js");

const launcher = read("desktop/launcher.cs");
const goLauncher = read("desktop/main.go");
const ui = read("src/js/exchange-rate-ui.js");
const html = read("classdock.html");
const app = read("src/js/app.js");
const palette = read("src/js/command-palette.js");
const board = read("src/js/whiteboard.js");
const styles = read("src/styles.css");
const manifest = JSON.parse(read("scripts.manifest.json"));

/* 수출입은행이 실제로 주는 모양(2026-08-21 응답에서 값만 줄인 것).
   HTTP 는 늘 200 이고 잘못은 본문 result 로만 온다. */
const KOREAEXIM_OK = [
  { result:1, cur_unit:"JPY(100)", cur_nm:"일본 옌(100)", ttb:"940.6", tts:"959.6", deal_bas_r:"950.12" },
  { result:1, cur_unit:"USD", cur_nm:"미국 달러", ttb:"1,370.9", tts:"1,397.5", deal_bas_r:"1,384.2" }
];
const ECB_OK = {
  amount:1.0, base:"EUR", date:"2026-08-21",
  rates:{ JPY:185.66, KRW:1619.41, USD:1.1699 }
};

test("고시 단위(JPY(100))는 고시된 값과 1단위값을 함께 들고 있다", () => {
  assert.deepEqual(R.parseUnit("JPY(100)"), { code:"JPY", unit:100 });
  assert.deepEqual(R.parseUnit("USD"), { code:"USD", unit:1 });
  assert.equal(R.parseUnit("돈"), null);

  const result = R.normalizeKoreaexim(KOREAEXIM_OK, "2026-08-21");
  assert.equal(result.ok, true);
  const jpy = R.findRate(result, "JPY");
  assert.equal(jpy.unit, 100);
  assert.equal(jpy.base, 950.12);          // 표에는 100엔당 고시값 그대로
  assert.equal(jpy.perOne, 9.5012);        // 계산은 1엔당 값으로
  assert.equal(jpy.name, "일본 옌");        // cur_nm 의 "(100)" 은 단위로 따로 들고 있으므로 뗀다
  assert.equal(R.convert(100, jpy, true).toFixed(2), "950.12");
});

test("빈 칸·null 은 0원이 아니라 값 없음으로 다룬다", () => {
  // Number("")=0 이라 그냥 넘기면 "환율 0원"이 표로 나간다.
  assert.equal(R.parseNumber(""), null);
  assert.equal(R.parseNumber(null), null);
  assert.equal(R.parseNumber("  "), null);
  assert.equal(R.parseNumber("1,384.2"), 1384.2);

  const result = R.normalizeKoreaexim(
    [{ result:1, cur_unit:"USD", cur_nm:"미국 달러", deal_bas_r:"1,384.2", tts:"", ttb:null }], "2026-08-21");
  const usd = R.findRate(result, "USD");
  assert.equal(usd.send, null);
  assert.equal(usd.recv, null);
  assert.equal(usd.base, 1384.2);
  // 매매기준율 자체가 비면 표에 쓸 데가 없어 줄을 버린다.
  assert.equal(R.normalizeKoreaexim([{ result:1, cur_unit:"USD", deal_bas_r:"" }], "2026-08-21").code, "rate-no-data");
});

test("수출입은행의 잘못은 본문 result 로 갈라 서로 다른 안내가 되게 한다", () => {
  assert.equal(R.normalizeKoreaexim([], "2026-08-21").code, "rate-no-data");          // 주말·공휴일·오전 고시 전
  assert.equal(R.normalizeKoreaexim([{ result:2 }], "2026-08-21").code, "rate-bad-date");
  assert.equal(R.normalizeKoreaexim([{ result:3 }], "2026-08-21").code, "rate-key-invalid");
  assert.equal(R.normalizeKoreaexim([{ result:4 }], "2026-08-21").code, "rate-limit-reached");
  assert.equal(R.normalizeKoreaexim("망가진 응답", "2026-08-21").code, "rate-failed");
  // 코드마다 화면에 띄울 말이 따로 있어야 "키가 틀렸다"와 "아직 고시 전"이 섞이지 않는다.
  const texts = new Set(["rate-no-data", "rate-bad-date", "rate-key-invalid", "rate-limit-reached", "rate-failed"]
    .map(code => R.errorText(code)));
  assert.equal(texts.size, 5);
});

test("ECB 는 유로 기준 교차환율로 계산하고 기준통화 유로를 직접 채운다", () => {
  const result = R.normalizeEcb(ECB_OK, "2026-08-23");
  assert.equal(result.ok, true);
  // 응답이 알려 준 실제 기준일을 쓴다(휴일에 부르면 직전 영업일 값이 온다).
  assert.equal(result.date, "2026-08-21");
  assert.equal(R.findRate(result, "USD").base.toFixed(2), (1619.41 / 1.1699).toFixed(2));
  // rates 에 없는 기준통화 유로가 빠지면 안 된다.
  assert.equal(R.findRate(result, "EUR").base, 1619.41);
  // 출처를 바꿔도 같은 줄이 같은 뜻으로 읽히도록 엔은 양쪽 다 100단위로 맞춘다.
  assert.equal(R.findRate(result, "JPY").unit, 100);
  assert.equal(R.findRate(result, "JPY").base.toFixed(2), ((1619.41 / 185.66) * 100).toFixed(2));
  assert.equal(R.findRate(result, "KRW"), null);
});

test("기간 조회는 통화 하나를 날짜 순으로 편다", () => {
  const series = R.normalizeEcbSeries({
    base:"EUR",
    rates:{
      "2026-08-20":{ KRW:1631.08, USD:1.1681 },
      "2026-08-18":{ KRW:1632.3, USD:1.1576 },
      "2026-08-19":{ KRW:1614.81 }                       // USD 가 빠진 날은 건너뛴다
    }
  }, "USD");
  assert.equal(series.ok, true);
  assert.deepEqual(series.points.map(point => point.date), ["2026-08-18", "2026-08-20"]);
  assert.equal(R.normalizeEcbSeries({ rates:{} }, "USD").code, "rate-no-data");
});

test("환전 계산은 고시 단위에 휘둘리지 않고 양방향 모두 맞다", () => {
  const result = R.normalizeKoreaexim(KOREAEXIM_OK, "2026-08-21");
  const usd = R.findRate(result, "USD");
  assert.equal(R.convert(100, usd, true).toFixed(0), "138420");     // 100달러 → 원
  assert.equal(R.convert(138420, usd, false).toFixed(0), "100");    // 원 → 달러
  assert.equal(R.convert("", usd, true), null);                     // 빈 입력은 0원이 아니다
  assert.equal(R.convert(1, null, true), null);
});

test("표로 꺼낼 때 송금 칸은 그 값이 있는 출처에서만 나온다", () => {
  const bank = R.toRows(R.normalizeKoreaexim(KOREAEXIM_OK, "2026-08-21"));
  assert.deepEqual(bank[0], ["통화", "코드", "단위", "매매기준율(원)", "송금 보낼 때(원)", "송금 받을 때(원)"]);
  assert.equal(bank.length, 3);
  // ECB 값을 "매매기준율" 이라 부르면 은행 고시환율로 오해한다 — 출처가 부르는 이름을 그대로 쓴다.
  const ecb = R.toRows(R.normalizeEcb(ECB_OK, "2026-08-21"));
  assert.deepEqual(ecb[0], ["통화", "코드", "단위", "참고환율(원)"]);
  assert.equal(R.SOURCES.ecb.hasTransfer, false);
  assert.equal(R.SOURCES.koreaexim.needsKey, true);
});

test("두 런처가 같은 환율 엔드포인트와 같은 목적지를 쓴다", () => {
  // 한쪽만 고치면 그 런처에서만 환율이 안 뜬다 — 지도 타일 목록과 같은 이유로 함께 검사한다.
  for (const source of [launcher, goLauncher]) {
    assert.match(source, /https:\/\/oapi\.koreaexim\.go\.kr\/site\/program\/financial\/exchangeJSON/);
    assert.match(source, /https:\/\/api\.frankfurter\.dev\/v1\//);
    assert.match(source, /can-proxy-rates/);
    assert.match(source, /exchange-rate-key-status/);
    assert.match(source, /X-ClassDock-Rate-Cached/);
  }
  // 잘못을 담은 응답은 캐시하지 않는다(키를 고쳐도 계속 되살아나면 안 된다).
  // 같은 문자열을 C# 은 역슬래시로, Go 는 백틱으로 적으므로 파일마다 그 꼴로 찾는다.
  assert.ok(launcher.includes('\\"result\\":3'), "launcher.cs: result 3 검사");
  assert.ok(goLauncher.includes('`"result":3`'), "main.go: result 3 검사");
  // 캐시 자리를 두 런처가 같은 폴더로 잡아야 번갈아 써도 받아 둔 값을 이어 쓴다.
  assert.match(launcher, /"ClassDock", "rate-cache"/);
  assert.match(goLauncher, /"ClassDock", "rate-cache"/);
  // 키 시험은 오늘이 아니라 지난 영업일로 건다(주말·오전 고시 전에 멀쩡한 키를 틀렸다고 하면 안 된다).
  assert.match(launcher, /static string LastWeekdayCompact\(\)/);
  assert.match(goLauncher, /func lastWeekdayCompact\(\) string/);
});

test("환율 API 는 토큰을 요구하고 인증키는 런처 밖으로 나가지 않는다", () => {
  assert.match(launcher, /path == "\/can-proxy-rates" \|\| path == "\/exchange-rate-key-status"\) return true/);
  assert.match(launcher, /path\.StartsWith\("\/exchange-rate\?", StringComparison\.Ordinal\)\) return true/);
  assert.match(launcher, /path\.StartsWith\("\/exchange-rate-key", StringComparison\.Ordinal\)\) return true/);
  assert.match(launcher, /method == "DELETE" && \(path == "\/map-search-key" \|\| path == "\/exchange-rate-key"\)/);
  // 키 저장·삭제·상태는 동작 헤더까지 요구한다(지도 검색 키와 같은 규칙).
  const start = launcher.indexOf('else if (method == "GET" && path == "/exchange-rate-key-status")');
  const end = launcher.indexOf('else if (method == "GET" && path == "/map-search-key-status")', start);
  assert.ok(start > 0 && end > start);
  assert.equal(launcher.slice(start, end).match(/HasLocalActionHeader\(headers\)/g).length, 3);
  // 키는 이 Windows 사용자 계정으로만 풀리게 암호화해 둔다.
  assert.match(launcher, /ProtectedData\.Protect\(Encoding\.UTF8\.GetBytes\(key\), ExchangeRateKeyEntropy/);
  // 브라우저 쪽에는 키 문자열이 없고 보유 여부만 오간다.
  assert.doesNotMatch(ui, /authkey/);
  assert.doesNotMatch(app, /authkey/);
  assert.match(app, /__classDockExchangeRateKeyStatus/);
});

test("환율 창은 런처 능력을 따로 묻고, 없으면 조회를 막고 이유를 밝힌다", () => {
  // 저장 가능 여부·타일 프록시와는 다른 능력이라 프로브를 따로 둔다.
  assert.match(ui, /fetch\("\/can-proxy-rates", \{ cache:"no-store" \}\)/);
  assert.match(ui, /rate-unavailable/);
  assert.ok(R.ERROR_TEXT["rate-unavailable"]);
  // 인증키가 없으면 키 없이 되는 ECB 로 연다.
  assert.match(ui, /if \(!\(await hasExchangeRateKey\(\)\)\) sourceSelect\.value = "ecb"/);
  // 빈 날 기억은 '다시 받기' 에서 지운다 — 오전 고시 전에 열어 둔 창이 11시 뒤에도 굳으면 안 된다.
  assert.match(ui, /emptyDays\.clear\(\);\s*\n\s*load\(\);/);
});

test("칠판 💱 는 이 보드에 넣고, 런처 능력이 없으면 버튼 자체를 감춘다", () => {
  // 팔레트(새 칠판)와 칠판(이 보드)의 입구가 갈려 있어야 한다 — 보드 위에서 눌렀는데
  // 다른 칠판이 열리면 엉뚱하다(지도의 openMapPicker 와 같은 짝 구조).
  assert.match(board, /window\.openExchangeRate\(\{[\s\S]{0,40}board: \{/);
  assert.match(ui, /const board = \(options && options\.board && typeof options\.board\.insertChart === "function"\)/);
  assert.match(ui, /board\.insertChart\(spec\) === true/);
  assert.match(ui, /board\.insertTable\(R\.toRows\(shown\), \{ title \}\) === true/);
  /* 내보내는 네 길이 모두 "보이는 대로" 나가야 한다 — 거르기 칸이 표 바로 위에 있어 무엇이
     빠졌는지 눈에 보이고, 29종을 통째로 칠판에 올리면 글자가 뭉개져 못 읽는다. */
  assert.equal(ui.match(/R\.toRows\(shownResult\(\)\)/g).length, 3);   // 복사·CSV·표 편집기
  assert.doesNotMatch(ui, /R\.toRows\(result\)/);
  // 능력이 없으면 감춘다 — 프로브가 끝나기 전에도 감춰져 있어야 잠깐 보였다 사라지지 않는다.
  assert.match(board, /rateToolBtn\.hidden = true;/);
  assert.match(board, /window\.exchangeRatesAvailable\(\)\.then\(\(ok\) => \{ if \(ok\) rateToolBtn\.hidden = false; \}\)/);
  assert.match(ui, /window\.exchangeRatesAvailable = ratesAvailable;/);
  // .wb-act 는 display:inline-flex 라 [hidden] 만으로는 안 감춰진다.
  assert.match(styles, /\.wb-act\[hidden\]\{display:none\}/);
  // 그림은 이모지가 아니라 단색 SVG 라야 한다(까닭은 tests/ink-toolbar-icons.test.js 가 함께 지킨다).
  assert.match(board, /mkIconBtn\("exchange", "환율 넣기/);
  // 보드 표는 받아 온 값이라 표 편집기로 고칠 것이 아니다 — tableSpec 을 달지 않는다.
  const start = board.indexOf("doc.insertBoardTable = (rows, opts) =>");
  assert.ok(start > 0);
  assert.doesNotMatch(board.slice(start, start + 600), /tableSpec/);
});

test("환율 창은 팔레트·설정·manifest에 빠짐없이 연결된다", () => {
  assert.match(palette, /callFn\("openExchangeRate"\)/);
  assert.match(html, /src="src\/js\/exchange-rate\.js"/);
  assert.match(html, /src="src\/js\/exchange-rate-ui\.js"/);
  assert.match(html, /id="settingExchangeRateKey"/);
  assert.match(html, /id="settingExchangeRateTest"/);
  assert.match(html, /id="settingExchangeRateClear"/);
  // 순수 모듈이 창보다 먼저 실려야 한다.
  const order = manifest.localScripts;
  assert.ok(order.indexOf("exchange-rate.js") < order.indexOf("exchange-rate-ui.js"));
  assert.ok(order.indexOf("whiteboard.js") < order.indexOf("exchange-rate-ui.js"));
  assert.ok(order.indexOf("table-export.js") < order.indexOf("exchange-rate-ui.js"));
  const boundary = manifest.moduleBoundaries.find((item) => item.file === "exchange-rate.js");
  assert.equal(boundary.publicApi, "MNExchangeRate");
});
