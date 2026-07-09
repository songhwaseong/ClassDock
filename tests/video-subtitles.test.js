const test = require("node:test");
const assert = require("node:assert/strict");
const {
  srtToVtt,
  smiToVtt,
  subtitleToVtt,
  subtitleMatchesMedia,
  msToVttTime,
  isMediaFileName
} = require("../src/js/video-viewer.js");

test("SRT 자막은 타임코드만 바꿔 WebVTT 로 변환한다", () => {
  const srt = "1\r\n00:00:01,000 --> 00:00:04,000\r\n안녕하세요 <font color=\"red\">빨강</font>\r\n\r\n2\r\n00:00:05,5 --> 00:00:07,000\r\n두 번째 줄";
  assert.equal(
    srtToVtt(srt),
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n안녕하세요 빨강\n\n2\n00:00:05.500 --> 00:00:07.000\n두 번째 줄\n"
  );
  assert.equal(srtToVtt("자막 아님 그냥 텍스트"), "");   // 타임코드 없으면 실패 표시(빈 문자열)
});

test("SMI 자막은 SYNC 시각과 문장을 추려 WebVTT 큐로 만든다", () => {
  const smi = "<SAMI><BODY>\n"
    + "<SYNC Start=1000><P Class=KRCC>첫 자막<br>둘째 줄\n"
    + "<SYNC Start=3000><P Class=KRCC>&nbsp;\n"          // 빈 블록 = 자막 지우기 → 앞 큐의 끝
    + "<SYNC Start=4000><P>두 번째 &amp; 자막\n"
    + "</BODY></SAMI>";
  assert.equal(
    smiToVtt(smi),
    "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n첫 자막\n둘째 줄\n\n00:00:04.000 --> 00:00:09.000\n두 번째 & 자막\n"
  );
  assert.equal(smiToVtt("<SAMI><BODY>싱크 없음</BODY></SAMI>"), "");
});

test("자막 변환은 확장자를 따르고, 모르면 내용으로 추정한다", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n이미 VTT";
  assert.equal(subtitleToVtt("a.vtt", vtt), vtt);                          // 머리말 있으면 그대로
  assert.equal(
    subtitleToVtt("a.vtt", "00:00:01.000 --> 00:00:02.000\n머리말 없음"),
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n머리말 없음\n"
  );
  const smiBody = "<SYNC Start=500><P>내용으로 판별";
  assert.ok(subtitleToVtt("unknown.txt", smiBody).includes("00:00:00.500 --> "));   // SMI 로 추정
  assert.ok(subtitleToVtt("b.srt", "1\n00:00:01,000 --> 00:00:02,000\nSRT").startsWith("WEBVTT"));
});

test("영상과 같은 제목의 자막 파일만 자동 연결 대상으로 본다", () => {
  assert.ok(subtitleMatchesMedia("강의1.mp4", "강의1.srt"));
  assert.ok(subtitleMatchesMedia("강의1.mp4", "강의1.ko.smi"));            // 언어 꼬리표 허용
  assert.ok(subtitleMatchesMedia("Lecture.MP4", "lecture.SRT"));           // 대소문자 무시
  assert.ok(!subtitleMatchesMedia("강의1.mp4", "강의2.srt"));
  assert.ok(!subtitleMatchesMedia("강의12.mp4", "강의1.srt"));             // 접두어만 같은 다른 제목
  assert.ok(!subtitleMatchesMedia("강의1.mp4", "강의1.txt"));              // 자막 확장자 아님
});

test("영상·오디오 확장자는 작업공간 자동 저장에서 제외 대상으로 판정한다", () => {
  assert.ok(isMediaFileName("수업영상.mp4"));
  assert.ok(isMediaFileName("듣기평가.MP3"));
  assert.ok(!isMediaFileName("교재.pdf"));
  assert.ok(!isMediaFileName(null));
  assert.equal(msToVttTime(3661234), "01:01:01.234");
});
