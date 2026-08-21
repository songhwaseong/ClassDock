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
  const morning = timeline.timelineParseDate("2026-08-21 09:30");
  const afternoon = timeline.timelineParseDate("2026-08-21T14:05");
  assert.equal(morning.precision, "minute");
  assert.ok(morning.key < afternoon.key);
  assert.equal(timeline.timelineFormatDate(morning), "2026년 8월 21일 09:30");
  for (const invalid of ["", "0", "2026-13", "2026-02-30", "2026-08 09:30", "2026-08-21 24:00", "조선 후기"]){
    assert.equal(timeline.timelineParseDate(invalid), null);
  }
});

test(".timeline은 사건·기간·분류·사진을 한 JSON으로 안전하게 왕복한다", () => {
  const model = timeline.timelineDocEmpty("한국사");
  model.purpose = "trip";
  model.viewMode = "scale";
  model.events.push(timeline.timelineNormalizeEvent({
    id:"event-1", title:"광복", start:"1945-08-15", end:"1948-08-15", category:"현대",
    placeName:"대한민국역사박물관", placeAddress:"서울특별시 종로구 세종대로 198",
    description:"해방 이후 정부 수립까지", color:"rose", imageFileName:"images/광복.jpg",
    image:{ name:"사진.jpg", dataUrl:"data:image/jpeg;base64,AA==", width:10, height:8 }
  }, 0));
  const again = timeline.timelineDocParse(timeline.timelineDocSerialize(model));
  assert.equal(again.title, "한국사");
  assert.equal(again.purpose, "trip");
  assert.equal(again.viewMode, "scale");
  assert.equal(again.events[0].title, "광복");
  assert.equal(again.events[0].placeName, "대한민국역사박물관");
  assert.equal(again.events[0].placeAddress, "서울특별시 종로구 세종대로 198");
  assert.equal(again.events[0].imageFileName, "images/광복.jpg");
  assert.equal(again.events[0].image.dataUrl, "data:image/jpeg;base64,AA==");
  assert.equal(timeline.timelineDocContentKey(again), timeline.timelineDocContentKey(model));

  const hostile = timeline.timelineDocParse(JSON.stringify({
    type:timeline.TIMELINE_DOC_TYPE, events:[{ start:"2020", title:"외부 그림", color:"unknown",
      image:{ dataUrl:"https://example.com/a.jpg" } }]
  }));
  assert.equal(hostile.events[0].image, null);
  assert.equal(hostile.events[0].color, "blue");
});

test("같은 날짜·시각의 항목은 수동 순서를 바꾸되 다른 시각의 순서는 유지한다", () => {
  const events = [
    timeline.timelineNormalizeEvent({ id:"a", title:"아침", start:"2026-08-21 09:00", order:0 }, 0),
    timeline.timelineNormalizeEvent({ id:"b", title:"관광", start:"2026-08-21 10:00", order:1 }, 1),
    timeline.timelineNormalizeEvent({ id:"c", title:"점심 후보", start:"2026-08-21 10:00", order:2 }, 2)
  ];
  assert.equal(timeline.timelineCanMoveEvent(events, "b", -1), false);
  assert.equal(timeline.timelineCanMoveEvent(events, "b", 1), true);
  assert.equal(timeline.timelineMoveEvent(events, "c", -1), true);
  assert.deepEqual(timeline.timelineSortedEvents(events).map(row => row.event.id), ["a", "c", "b"]);
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
    placeAddress:"서울특별시 종로구 종로 99", imageFileName:"사진/3·1운동.jpg",
    description:"서울, 평양\n전국으로 확산", color:"green"
  }, 0)];
  const csv = timeline.timelineEventsToCsv(events);
  const parsed = timeline.timelineEventsFromCsv(csv);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].description, "서울, 평양\n전국으로 확산");
  assert.equal(parsed.events[0].color, "green");
  assert.equal(parsed.events[0].placeName, "탑골공원");
  assert.equal(parsed.events[0].placeAddress, "서울특별시 종로구 종로 99");
  assert.equal(parsed.events[0].imageFileName, "사진/3·1운동.jpg");
  assert.match(csv, /^시작,종료,제목,분류,유적지,유적지 주소,이미지 파일명,설명,색상/m);

  const tripCsv = timeline.timelineEventsToCsv(events, "trip");
  assert.match(tripCsv, /^시작,종료,제목,유형,장소,장소 주소,이미지 파일명,메모,색상/m);
  const tripParsed = timeline.timelineEventsFromCsv("시작,종료,일정,유형,장소,장소 주소,메모\r\n2026-08-21 09:30,,경복궁 관람,관광,경복궁,서울 종로구,예약 확인\r\n");
  assert.equal(tripParsed.events[0].start, "2026-08-21 09:30");
  assert.equal(tripParsed.events[0].category, "관광");
  assert.equal(tripParsed.events[0].placeAddress, "서울 종로구");

  const partial = timeline.timelineEventsFromCsv("시작,제목,이미지 파일\r\n1945,광복,광복.jpg\r\n날짜없음,제외,제외.jpg\r\n");
  assert.equal(partial.events.length, 1);
  assert.equal(partial.skipped, 1);
  assert.equal(partial.events[0].imageFileName, "광복.jpg");
});

test("CSV 이미지 파일명은 선택한 폴더의 상대경로와 파일명으로 안전하게 연결된다", () => {
  const rootImage = { name:"광복.JPG", type:"image/jpeg", webkitRelativePath:"사진모음/광복.JPG" };
  const nestedImage = { name:"유물.png", type:"image/png", webkitRelativePath:"사진모음/삼국/유물.png" };
  const duplicateA = { name:"중복.jpg", type:"image/jpeg", webkitRelativePath:"사진모음/A/중복.jpg" };
  const duplicateB = { name:"중복.jpg", type:"image/jpeg", webkitRelativePath:"사진모음/B/중복.jpg" };
  const ignored = { name:"설명.txt", type:"text/plain", webkitRelativePath:"사진모음/설명.txt" };
  const lookup = timeline.timelineImageFileLookup([rootImage, nestedImage, duplicateA, duplicateB, ignored]);
  assert.equal(timeline.timelineFindImageFile("광복.jpg", lookup), rootImage);
  assert.equal(timeline.timelineFindImageFile("삼국\\유물.PNG", lookup), nestedImage);
  assert.equal(timeline.timelineFindImageFile("A/중복.jpg", lookup), duplicateA);
  assert.equal(timeline.timelineFindImageFile("중복.jpg", lookup), null);
  assert.equal(timeline.timelineFindImageFile("설명.txt", lookup), null);
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
  assert.match(styles, /\.timeline-present-body\{[^}]*grid-template-columns:minmax\(260px,1fr\) minmax\(320px,1\.05fr\)/);
  assert.match(styles, /\.timeline-present-card\.is-text-only \.timeline-present-body\{[^}]*grid-template-columns:1fr/);
  assert.match(styles, /\.timeline-present-card\.is-text-only \.timeline-present-copy\{[^}]*text-align:center/);
  assert.match(styles, /\.timeline-present-card\.is-text-only \.timeline-present-copy p\{[^}]*text-align:left/);
  assert.match(styles, /@media\(max-width:900px\)\{[\s\S]*?\.timeline-present-body,[^}]*grid-template-columns:1fr/);
});

test("발표 화면은 연도를 좌상단에, 유적지는 우하단 지도 아이콘 버튼으로 배치한다", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/js/timeline.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(source, /class="timeline-present-card"><div class="timeline-present-meta"><\/div>/);
  assert.match(source, /presentPlace\.appendChild\(timelinePresentPlaceButton\(event\)\)/);
  assert.match(source, /button\.innerHTML = TIMELINE_MAP_ICON/);
  assert.match(source, /button\.setAttribute\("aria-label", timelineT\("지도에서 검색"\)/);
  assert.match(source, /tip\.className = "timeline-present-place-tip"/);
  assert.match(styles, /\.timeline-present-meta\{position:absolute;left:[^}]*top:/);
  assert.match(styles, /\.timeline-present-place\{position:absolute;right:[^}]*bottom:/);
  assert.match(styles, /\.timeline-present-place:hover \.timeline-present-place-tip,\s*\.timeline-present-place:focus-within \.timeline-present-place-tip\{opacity:1/);
});

test("연대표 도구막대는 CSV 이미지 파일명과 폴더 사진을 연결한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/timeline.js"), "utf8");
  assert.match(source, /timelineButton\("이미지 폴더", "CSV의 이미지 파일명과 연결할 폴더 선택"\)/);
  assert.match(source, /imageFolderInput\.setAttribute\("webkitdirectory", ""\)/);
  assert.match(source, /model\.events\.filter\(event => !event\.image && event\.imageFileName\)/);
  assert.match(source, /const file = timelineFindImageFile\(event\.imageFileName, lookup\)/);
  assert.match(source, /event\.image = \{ \.\.\.photo \}/);
  assert.match(source, /totalChars \+ photo\.dataUrl\.length > TIMELINE_PHOTO_TOTAL_MAX_CHARS/);
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

test("되돌리기 스냅샷은 사진 바이트를 복사하지 않고 참조로 공유한다", () => {
  const big = "data:image/jpeg;base64," + "A".repeat(200000);
  const model = timeline.timelineDocEmpty("사진 많은 연대표");
  model.events.push(timeline.timelineNormalizeEvent({
    id:"event-1", title:"광복", start:"1945-08-15",
    image:{ name:"광복.jpg", dataUrl:big, width:1280, height:960 }
  }, 0));
  const snapshot = timeline.timelineSnapshot(model);
  assert.ok(snapshot.text.length < 2000, "스냅샷 문자열에 사진 base64가 들어가면 안 된다");
  assert.equal(snapshot.images.length, 1);
  assert.equal(snapshot.images[0], model.events[0].image, "사진은 같은 객체를 참조해야 한다");

  assert.ok(timeline.timelineSnapshotEqual(snapshot, timeline.timelineSnapshot(model)));
  model.events[0].title = "8·15 광복";
  assert.equal(timeline.timelineSnapshotEqual(snapshot, timeline.timelineSnapshot(model)), false);

  const restored = timeline.timelineSnapshotModel(snapshot);
  assert.equal(restored.events[0].title, "광복");
  assert.equal(restored.events[0].image.dataUrl, big);
  assert.notEqual(restored.events[0], model.events[0], "되돌린 사건은 새 객체여야 한다");

  model.events[0].image = { name:"다른.jpg", dataUrl:big, width:1280, height:960 };
  assert.equal(timeline.timelineSnapshotEqual(snapshot, timeline.timelineSnapshot(model)), false,
    "같은 바이트라도 사진을 바꾸면 다른 상태로 봐야 한다");
});

test("사진 총량 상한은 40MB이고 안내 문구는 상한값을 따라간다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/timeline.js"), "utf8");
  assert.match(source, /TIMELINE_PHOTO_TOTAL_MAX_CHARS = 40 \* 1024 \* 1024/);
  assert.match(source, /TIMELINE_PHOTO_TOTAL_LABEL = Math\.round\(TIMELINE_PHOTO_TOTAL_MAX_CHARS/);
  assert.match(source, /timelineTf\("이 연대표의 사진 합계가 \{limit\}를 넘습니다[^"]*", \{ limit:TIMELINE_PHOTO_TOTAL_LABEL \}\)/);
  assert.match(source, /timelineTf\("전체 \{limit\} 제한으로 제외 \{count\}개"/);
  assert.doesNotMatch(source, /12MB/);
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  assert.match(i18n, /"이 연대표의 사진 합계가 \{limit\}를 넘습니다/);
  assert.match(i18n, /"전체 \{limit\} 제한으로 제외 \{count\}개"/);
});

test("새 연대표 파일 이름은 두 번째부터 번호가 붙는다", () => {
  assert.equal(timeline.timelineScratchFileName(1), "연대표.timeline");
  assert.equal(timeline.timelineScratchFileName(3), "연대표 3.timeline");
  assert.equal(timeline.timelineDefaultTitle("연대표 3.timeline"), "연대표 3");
});
