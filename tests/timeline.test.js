"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const timeline = require("../src/js/timeline.js");

test("연대표 날짜는 연·연월·날짜와 기원전을 같은 축에서 정렬한다", () => {
  assert.deepEqual(
    ["기원전 300", "BC 1", "1", "1945-08", "2026-08-20"].map(value => timeline.timelineParseDate(value).precision),
    ["year", "year", "year", "month", "day"]
  );
  const bc300 = timeline.timelineParseDate("기원전 300");
  const bc1 = timeline.timelineParseDate("BC 1");
  const ad1 = timeline.timelineParseDate("서기 1년");
  assert.ok(bc300.key < bc1.key);
  assert.ok(bc1.key < ad1.key);
  assert.equal(timeline.timelineFormatDate("약 1592-04-13"), "약 1592년 4월 13일");
  assert.equal(timeline.timelineFormatDate("BCE 57"), "기원전 57년");
  for (const invalid of ["", "0", "2026-13", "2026-02-30", "조선 후기"]){
    assert.equal(timeline.timelineParseDate(invalid), null);
  }
});

test(".timeline은 사건·기간·분류·사진을 한 JSON으로 안전하게 왕복한다", () => {
  const model = timeline.timelineDocEmpty("한국사");
  model.viewMode = "scale";
  model.events.push(timeline.timelineNormalizeEvent({
    id:"event-1", title:"광복", start:"1945-08-15", end:"1948-08-15", category:"현대",
    placeName:"대한민국역사박물관", placeAddress:"서울특별시 종로구 세종대로 198",
    description:"해방 이후 정부 수립까지", color:"rose",
    image:{ name:"사진.jpg", dataUrl:"data:image/jpeg;base64,AA==", width:10, height:8 }
  }, 0));
  const again = timeline.timelineDocParse(timeline.timelineDocSerialize(model));
  assert.equal(again.title, "한국사");
  assert.equal(again.viewMode, "scale");
  assert.equal(again.events[0].title, "광복");
  assert.equal(again.events[0].placeName, "대한민국역사박물관");
  assert.equal(again.events[0].placeAddress, "서울특별시 종로구 세종대로 198");
  assert.equal(again.events[0].image.dataUrl, "data:image/jpeg;base64,AA==");
  assert.equal(timeline.timelineDocContentKey(again), timeline.timelineDocContentKey(model));

  const hostile = timeline.timelineDocParse(JSON.stringify({
    type:timeline.TIMELINE_DOC_TYPE, events:[{ start:"2020", title:"외부 그림", color:"unknown",
      image:{ dataUrl:"https://example.com/a.jpg" } }]
  }));
  assert.equal(hostile.events[0].image, null);
  assert.equal(hostile.events[0].color, "blue");
});

test("사건은 기원전부터 시간순으로 정렬하고 같은 날짜는 입력 순서를 지킨다", () => {
  const events = [
    { id:"c", title:"셋", start:"2000", order:2 },
    { id:"a", title:"하나", start:"기원전 10", order:0 },
    { id:"b2", title:"둘-나", start:"1000", order:2 },
    { id:"b1", title:"둘-가", start:"1000", order:1 },
    { id:"x", title:"날짜 없음", start:"미정", order:9 }
  ].map(timeline.timelineNormalizeEvent);
  assert.deepEqual(timeline.timelineSortedEvents(events).map(row => row.event.id), ["a", "b1", "b2", "c", "x"]);
});

test("균등 보기와 시간 비례 보기는 읽기 간격과 실제 시간 간격을 각각 반영한다", () => {
  const events = [
    timeline.timelineNormalizeEvent({ id:"a", title:"A", start:"1000" }, 0),
    timeline.timelineNormalizeEvent({ id:"b", title:"B", start:"1001", end:"1500" }, 1),
    timeline.timelineNormalizeEvent({ id:"c", title:"C", start:"2000" }, 2)
  ];
  const even = timeline.timelineLayoutEntries(events, "even", 1);
  const scale = timeline.timelineLayoutEntries(events, "scale", 1);
  assert.equal(Math.round(even.entries[1].x - even.entries[0].x), Math.round(even.entries[2].x - even.entries[1].x));
  assert.ok(scale.entries[1].x - scale.entries[0].x < scale.entries[2].x - scale.entries[1].x);
  assert.ok(scale.entries[1].endX > scale.entries[1].x);
  assert.ok(timeline.timelineLayoutEntries(events, "even", 2).width > even.width);
});

test("대량 사건 개요는 한 화면 폭 안에 모든 점을 배치하고 높이를 엇갈린다", () => {
  const events = Array.from({ length:100 }, (_, index) => timeline.timelineNormalizeEvent({
    id:"event-" + index, title:"사건 " + index, start:String(1900 + index)
  }, index));
  const overview = timeline.timelineOverviewEntries(events, "even", 1200);
  assert.equal(overview.length, 100);
  assert.ok(overview.every(row => row.x >= 54 && row.x <= 1146));
  assert.ok(overview.every((row, index) => index === 0 || row.x > overview[index - 1].x));
  assert.deepEqual([...new Set(overview.map(row => row.lane))].sort((a, b) => a - b), [-2, -1, 0, 1, 2]);
});

test("CSV는 쉼표·줄바꿈 설명을 보존하고 잘못된 날짜 줄만 제외한다", () => {
  const events = [timeline.timelineNormalizeEvent({
    start:"1919-03-01", title:"3·1 운동", category:"독립운동", placeName:"탑골공원",
    placeAddress:"서울특별시 종로구 종로 99", description:"서울, 평양\n전국으로 확산", color:"green"
  }, 0)];
  const csv = timeline.timelineEventsToCsv(events);
  const parsed = timeline.timelineEventsFromCsv(csv);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].description, "서울, 평양\n전국으로 확산");
  assert.equal(parsed.events[0].color, "green");
  assert.equal(parsed.events[0].placeName, "탑골공원");
  assert.equal(parsed.events[0].placeAddress, "서울특별시 종로구 종로 99");
  assert.match(csv, /^시작,종료,제목,분류,유적지,유적지 주소,설명,색상/m);

  const partial = timeline.timelineEventsFromCsv("시작,제목\r\n1945,광복\r\n날짜없음,제외\r\n");
  assert.equal(partial.events.length, 1);
  assert.equal(partial.skipped, 1);
});

test("연대표 문서 형식은 파일 열기·새 문서·ZIP·명령 팔레트에 연결된다", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
  const types = fs.readFileSync(path.join(root, "src/js/document-types.js"), "utf8");
  const loaders = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
  const documents = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");
  const palette = fs.readFileSync(path.join(root, "src/js/command-palette.js"), "utf8");
  assert.match(html, /id="sbNewTimeline"/);
  assert.match(html, /accept="[^"]*\.timeline/);
  assert.match(html, /src="src\/js\/timeline\.js"/);
  assert.match(types, /"timeline"/);
  assert.match(loaders, /ext === "timeline"[\s\S]{0,100}loadTimelineDoc/);
  assert.match(documents, /newTimelineScratchInFolder/);
  assert.match(palette, /newTimelineScratch/);
});

test("연대표 배율은 내부 캔버스의 카드·글자·시간축 전체에 적용된다", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/js/timeline.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(source, /canvas\.className = "timeline-canvas"/);
  assert.match(source, /canvas\.style\.transform = "scale\(" \+ factor \+ "\)"/);
  assert.match(source, /setZoom\([^\n]+, event\)/);
  assert.match(styles, /\.timeline-canvas\{[^}]*transform-origin:top left/);
  const zoomBody = /function setZoom\([\s\S]*?\n  \}/.exec(source);
  assert.ok(zoomBody);
  assert.match(zoomBody[0], /if \(!model\.events\.length\) renderTrack\(\);\s*else applyTrackScale\(\);/);
});

test("연대표 빈 여백은 손바닥으로 끌고 카드·시간축은 이동 시작에서 제외한다", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/js/timeline.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(source, /target === viewport \|\| target === stage \|\| target === canvas/);
  assert.match(source, /viewport\.setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /viewport\.scrollLeft = panState\.left -/);
  assert.match(source, /viewport\.scrollTop = panState\.top -/);
  assert.match(styles, /\.timeline-viewport\{[^}]*cursor:grab/);
  assert.match(styles, /\.timeline-viewport\.is-panning[^}]*cursor:grabbing/);
});

test("개요의 사건 점을 누르면 상세 카드로 돌아가 해당 사건을 선택한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/timeline.js"), "utf8");
  assert.match(source, /timelineButton\("▤ 개요"/);
  assert.match(source, /timelineOverviewEntries\(model\.events, model\.viewMode, trackBaseWidth\)/);
  assert.match(source, /setOverview\(false, \{ skipRestore:true \}\);\s*selectEvent\(event\.id, true\)/);
});

test("빈 연대표의 첫 사건 안내는 현재 작업 영역의 정중앙을 기준으로 배치된다", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/js/timeline.js"), "utf8");
  const render = source.slice(source.indexOf("function renderTrack()"), source.indexOf("function renderList()"));
  assert.match(render, /const isEmpty = !layout\.entries\.length/);
  assert.match(render, /viewport\.clientWidth \|\| 840\)[\s\S]*?\/ \(zoom \|\| 1\)/);
  assert.match(render, /viewport\.clientHeight \|\| TIMELINE_STAGE_HEIGHT\)[\s\S]*?\/ \(zoom \|\| 1\)/);
  assert.match(source, /if \(!model\.events\.length\) renderTrack\(\);[\s\S]*?else applyTrackScale\(\);/);
  assert.match(source, /if \(overview \|\| !model\.events\.length\) renderTrack\(\);/);
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(styles, /\.timeline-empty\{[^}]*left:50%;top:50%;transform:translate\(-50%,-50%\)/);
});

test("발표 화면은 사진 유무에 따라 집중형과 분할형 레이아웃을 자동 전환한다", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/js/timeline.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(source, /class="timeline-present-progress" role="progressbar"/);
  assert.match(source, /progress\.style\.setProperty\("--timeline-progress"/);
  assert.match(source, /presentCard\.classList\.toggle\("is-text-only", !event\.image\)/);
  assert.match(source, /presentCard\.classList\.toggle\("has-image", !!event\.image\)/);
  assert.match(styles, /\.timeline-present-card\{[^}]*grid-template-columns:minmax\(260px,\.82fr\) minmax\(340px,1\.18fr\)/);
  assert.match(styles, /\.timeline-present-card\.is-text-only\{[^}]*grid-template-columns:1fr/);
  assert.match(styles, /\.timeline-present-card\.is-text-only \.timeline-present-copy\{[^}]*text-align:center/);
  assert.match(styles, /\.timeline-present-card\.is-text-only \.timeline-present-copy p\{[^}]*text-align:left/);
  assert.match(styles, /@media\(max-width:900px\)\{[\s\S]*?\.timeline-present-card,[^}]*grid-template-columns:1fr/);
});

test("유적지 주소는 카드와 발표 화면에서 기존 지도 검색으로 연결된다", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/js/timeline.js"), "utf8");
  assert.match(source, /globalThis\.searchMapForPlace\(query\)/);
  assert.match(source, /className = className/);
  assert.match(source, /timeline-form-place-name/);
  assert.match(source, /timeline-form-place-address/);
  assert.match(source, /event\.placeAddress \|\| event\.placeName/);
});

test("새 연대표 파일 이름은 두 번째부터 번호가 붙는다", () => {
  assert.equal(timeline.timelineScratchFileName(1), "연대표.timeline");
  assert.equal(timeline.timelineScratchFileName(3), "연대표 3.timeline");
  assert.equal(timeline.timelineDefaultTitle("연대표 3.timeline"), "연대표 3");
});
