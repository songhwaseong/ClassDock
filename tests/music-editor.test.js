"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* 악보 문서(.msheet)가 앱에 붙는 접점 계약. 편집기는 DOM·VexFlow 위에서 도는 코드라
   여기서는 "어디에 어떻게 연결돼 있는가"를 지킨다(동작 확인은 브라우저에서). */

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const manifest = JSON.parse(read("scripts.manifest.json"));
const html = read("manneung-classroom.html");
const editorSource = read("src/js/music-editor.js");
const lazySource = read("src/js/lazy.js");

test("확장자 .msheet 는 악보 편집기로 열린다", () => {
  const loaders = read("src/js/file-loaders.js");
  assert.match(loaders, /ext === "msheet" && typeof loadMusicSheet === "function"/);
  assert.match(editorSource, /async function loadMusicSheet\(file, opts = \{\}\)/);
  // 읽지 못하는 파일은 앱을 막지 않고 텍스트로 연다(다른 문서 종류와 같은 규칙).
  assert.match(editorSource, /return typeof loadText === "function" \? loadText\(file, opts\) : null/);
});

test("새 악보는 명령 팔레트·사이드바·폴더 우클릭 세 곳에서 만든다", () => {
  assert.match(read("src/js/command-palette.js"), /newMusicScratch/);
  assert.match(read("src/js/app.js"), /sbNewMusic/);
  assert.ok(html.includes('id="sbNewMusic"'), "사이드바 새로 만들기 버튼이 HTML 에 있어야 한다");
  assert.match(read("src/js/documents.js"), /newMusicScratchInFolder/);
  assert.match(editorSource, /function newMusicScratch\(\)/);
  assert.match(editorSource, /function newMusicScratchInFolder\(folder\)/);
});

test("저장은 기존 문서 저장 경로(saveTextDoc)를 그대로 쓴다", () => {
  // 원본 덮어쓰기·서버 저장·다운로드 세 경로를 다시 만들지 않는다.
  assert.match(editorSource, /saveTextDoc\(json, doc, doc\.name\)/);
  assert.match(editorSource, /const json = musicSerialize\(doc\.sheet\)/);
  assert.match(editorSource, /markDocumentDirty/);
  // Ctrl+S 는 전역 핸들러가 .run-save 버튼을 누르는 방식으로 연결된다.
  assert.match(editorSource, /className = "run-save music-save"/);
});

test("VexFlow 는 시작할 때가 아니라 악보를 열 때 불러온다", () => {
  assert.match(editorSource, /MNLazy\.tryNeed\("vexflow"\)/);
  // MNLazy 묶음 · manifest · 실제 파일이 같은 것을 가리켜야 한다.
  assert.match(lazySource, /vexflow:\s*\{[^}]*files:\["vexflow-bravura\.min\.js"\]/);
  const vendor = manifest.vendorScripts.find((item) => item.file === "vexflow-bravura.min.js");
  assert.ok(vendor, "manifest 에 VexFlow 가 등록돼야 한다");
  assert.equal(vendor.lazy, "vexflow");
  assert.ok(!html.includes('<script src="vendor/vexflow-bravura.min.js"></script>'),
    "지연 로드 대상은 시작 시 로드하지 않는다");
  assert.ok(fs.existsSync(path.join(root, "vendor/licenses/vexflow-5.0.0.txt")), "라이선스 파일이 있어야 한다");
});

test("재생 중에는 대기 화면(화면보호기)이 뜨지 않는다", () => {
  // screensaverBusy() 는 <video>/<audio> 만 미디어로 보는데 Web Audio 는 그 검사에 걸리지 않는다.
  // 대신 이미 "실행 중"으로 취급되는 .is-running 을 재생 동안 붙인다 — screensaver.js 는 고치지 않는다.
  assert.match(editorSource, /classList\.toggle\("is-running", on\)/);
  assert.match(read("src/js/screensaver.js"), /querySelector\("\.is-running"\)/);
});

test("악보 편집기는 모델·소리 엔진 뒤에 로드된다", () => {
  const order = manifest.localScripts;
  const at = (name) => order.indexOf(name);
  assert.ok(at("music-model.js") >= 0 && at("music-audio.js") >= 0 && at("music-editor.js") >= 0);
  assert.ok(at("music-model.js") < at("music-audio.js"));
  assert.ok(at("music-audio.js") < at("music-editor.js"));
  // HTML 태그 순서도 같아야 한다(tools/check-source.js 가 강제하는 계약).
  assert.ok(html.indexOf('src/js/music-audio.js') < html.indexOf('src/js/music-editor.js'));
});

test("도구상자는 길이 5종·점·쉼표·임시표·지우개·위치 조정·마디·오선을 갖춘다", () => {
  assert.match(editorSource, /const MUSIC_TOOL_VALUES = \[/);
  for (const value of ["whole", "half", "quarter", "eighth", "16th"]){
    assert.ok(editorSource.includes(`value:"${value}"`), `도구상자에 ${value} 가 있어야 한다`);
  }
  assert.match(editorSource, /setToolDots\(\(tool\.dots \+ 1\) % \(MUSIC_MAX_DOTS \+ 1\)\)/);
  assert.match(editorSource, /setToolRest\(!tool\.rest\)/);
  assert.match(editorSource, /function applyAccidental\(alter\)/);
  assert.match(editorSource, /setToolEraser\(!tool\.eraser\)/);
  assert.match(editorSource, /const positionBtn = musicButton\("위치 조정"/);
  assert.match(editorSource, /setPositionTool\(!tool\.position\)/);
  assert.match(editorSource, /function addMeasure\(\)/);
  assert.match(editorSource, /const addStaffBtn = musicButton\("＋오선"/);
  assert.match(editorSource, /function addStaffLine\(\)/);
  assert.match(editorSource, /musicMeasure\(\[\], \{ lineBreakBefore:true \}\)/);
  assert.match(editorSource, /const removeStaffBtn = musicButton\("－오선"/);
  assert.match(editorSource, /function removeStaffLine\(\)/);
  assert.match(editorSource, /if \(sheet\.measures\[index\] && sheet\.measures\[index\]\.lineBreakBefore\)/);
  assert.match(editorSource, /마지막 오선에 음표 또는 쉼표 \$\{noteCount\}개가 있어요/);
  assert.match(editorSource, /function removeMeasure\(measureIndex\)/);
  assert.match(editorSource, /const solfegeBtn = musicButton\("계이름"/);
  assert.match(editorSource, /sheet\.showSolfege = sheet\.showSolfege === false/);
});

test("화음·피아노 대보표·두 손·붙임줄·코드 기호를 화면에서 편집한다", () => {
  assert.match(editorSource, /const grandStaffBtn = musicButton\(sheet\.grandStaff \? "🎹 피아노 대보표"/);
  assert.match(editorSource, /new VF\.StaveConnector\(trebleStave, bassStave\).*BRACE/);
  assert.match(editorSource, /const rightHandBtn = musicButton\("오른손"/);
  assert.match(editorSource, /const leftHandBtn = musicButton\("왼손"/);
  assert.match(editorSource, /const playRightBtn = musicButton\("▶ 오른손"/);
  assert.match(editorSource, /const playLeftBtn = musicButton\("▶ 왼손"/);
  assert.match(editorSource, /startPlay\(null, \{ staff:"treble" \}\)/);
  assert.match(editorSource, /startPlay\(null, \{ staff:"bass" \}\)/);
  assert.match(editorSource, /function addSelectedChordPitch\(measureIndex, pitch, staff\)/);
  assert.match(editorSource, /musicAddChordPitch\(note, extra\)/);
  assert.match(editorSource, /new VF\.StaveTie\(/);
  assert.match(editorSource, /function toggleSelectedTie\(\)/);
  assert.match(editorSource, /function editSelectedChordSymbol\(\)/);
  assert.match(editorSource, /label\.classList\.add\("music-chord-symbol"\)/);
  assert.match(editorSource, /sheet\.grandStaff = restored\.grandStaff/);
  assert.match(read("src/styles.css"), /\.music-chord-symbol\{/);
});

test("두 성부와 고급 표기·MIDI·참고 이미지 도구를 제공한다", () => {
  for (const label of ["성부 1", "성부 2", "⌒ 이음줄", "가사", "셈여림", "연주 기호",
    "3잇단", "운지", "페달", "|: 반복 시작", ":| 반복 끝", "1·2번 괄호", "마디 설정"]){
    assert.ok(editorSource.includes(`musicButton("${label}"`), `${label} 도구가 있어야 한다`);
  }
  assert.match(editorSource, /musicVoiceNotes\(measure, staff, voice \|\| 1\)/);
  assert.match(editorSource, /setStemDirection\(voiceNumber === 1 \? 1 : -1\)/);
  assert.match(editorSource, /new VF\.Tuplet\(/);
  assert.match(editorSource, /classList\.add\("music-slur"\)/);
  assert.match(editorSource, /setBegBarType\(VF\.Barline\.type\.REPEAT_BEGIN\)/);
  assert.match(editorSource, /setVoltaType\(VF\.Volta\.type\.BEGIN_END/);
  assert.match(editorSource, /navigator\.requestMIDIAccess/);
  assert.match(editorSource, /musicExportName\(doc, "mid"\)/);
  assert.match(editorSource, /imageReferenceInput\.accept = "image\/png,image\/jpeg/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-image-reference\{/);
  assert.match(css, /\.music-notation/);
});

test("악보 초기화는 확인 뒤 음악 설정을 보존하고 빈 1마디로 만들며 되돌릴 수 있다", () => {
  assert.match(editorSource, /musicButton\("↺ 초기화"/);
  assert.match(editorSource, /resetScoreBtn\.addEventListener\("click", resetScoreContent\)/);
  assert.match(editorSource, /function resetScoreContent\(\)/);
  assert.match(editorSource, /제목·빠르기·박자·조표·음색은 그대로 유지됩니다/);
  assert.match(editorSource, /sheet\.measures = \[musicMeasure\(\)\]/);
  assert.match(editorSource, /악보를 비웠어요\. Ctrl\+Z로 되돌릴 수 있어요/);
  assert.match(read("src/styles.css"), /\.music-btn\.music-reset\{color:var\(--danger\)/);
});

test("새 음표는 현재 조표를 따르고 제자리표 선택과 미선택을 구분한다", () => {
  // null=미선택, 0=제자리표. 0 하나로 합치면 사장조의 F가 F#이 아니라 F♮로 들어간다.
  assert.match(editorSource, /accidental:null/);
  assert.match(editorSource, /const keyAlter = musicKeyAlterations\(key\)\[pitch\.step\] \|\| 0/);
  assert.match(editorSource, /return tool\.accidental === null \? keyAlter : tool\.accidental/);
  assert.match(editorSource, /alter:toolAlterForPitch\(pitch, measureIndex\)/);
  assert.match(editorSource, /tool\.accidental = null;\s*\/\/ 임시표는 한 번 쓰면 풀리고 다시 조표를 따른다/);
});

test("오선을 누르면 그 자리의 음높이로 음표가 들어가고, 가득 찬 마디는 막는다", () => {
  // 클릭 y → 줄 값 → 음높이 변환은 모델(music-model.js)에 있고 편집기는 부르기만 한다.
  assert.match(editorSource, /musicPitchFromStaveLine\(lineValue, box\.staff\)/);
  assert.match(editorSource, /Math\.round\(\(\(point\.y - box\.topY\) \/ box\.spacing\) \* 2\) \/ 2/);
  assert.match(editorSource, /getYForLine\(0\)/);
  // 박자를 넘기는 입력은 넣지 않고 안내한다.
  assert.match(editorSource, /if \(!musicCanFit\(sheet, measureIndex, note, targetStaff, targetVoice\)\)/);
  // 음역 밖은 넣지 않는다.
  assert.match(editorSource, /musicMidiInRange\(midi, box\.staff\)/);
});

test("오선 hover는 실제 입력될 계이름을 다른 영역에 보여주고 포인터 상태를 바꾼다", () => {
  assert.match(editorSource, /const MUSIC_SOLFEGE_LABELS = \{ C:"도", D:"레", E:"미", F:"파", G:"솔", A:"라", B:"시" \}/);
  assert.match(editorSource, /hint\.className = "music-hint music-hover-readout"/);
  assert.match(editorSource, /scoreHost\.addEventListener\("pointermove"/);
  assert.match(editorSource, /if \(!tool\.rest && !musicMidiInRange\(midi, box\.staff\)\)/);
  assert.match(editorSource, /const point = scorePoint\(event\)/);
  assert.match(editorSource, /const pitch = pitchAtScorePoint\(point, box\)/);
  assert.match(editorSource, /alter:toolAlterForPitch\(pitch, box\.index\)/);     // 조표·임시표까지 반영
  assert.match(editorSource, /musicCanFit\(sheet, box\.index, preview, box\.staff, activeVoice\)/);
  assert.match(editorSource, /입력 위치: /);
  assert.match(editorSource, /scoreHost\.addEventListener\("pointerleave", \(\) => \{\s*if \(!noteDrag\) resetHoverReadout\(\)/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-score\.is-note-entry\{cursor:crosshair\}/);
  assert.match(css, /\.music-score\.is-invalid-entry\{cursor:not-allowed\}/);
  assert.match(css, /\.music-score\.is-note-entry \[data-note-id\]:not\(\.is-rest\)\{cursor:ns-resize\}/);
});

test("오선 위아래 hover는 현재 음높이를 옅은 가상 덧줄로 보여준다", () => {
  assert.match(editorSource, /document\.createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "line"\)/);
  assert.match(editorSource, /guide\.classList\.add\("music-pitch-guide"\)/);
  assert.match(editorSource, /lineValue >= 0 && lineValue <= 4/); // 보이는 오선 안에서는 숨긴다.
  assert.match(editorSource, /const y = box\.topY \+ lineValue \* box\.spacing/);
  assert.match(editorSource, /pitchGuideEl\.setAttribute\("x1", String\(box\.x \+ 5\)\)/);
  assert.match(editorSource, /pitchGuideEl\.classList\.toggle\("is-invalid", !!invalid\)/);
  assert.match(editorSource, /if \(tool\.rest\) hidePitchGuide\(\)/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-pitch-guide\{stroke:var\(--accent\);stroke-width:1\.25;stroke-dasharray:4 5;opacity:\.32/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /\.music-pitch-guide\.is-invalid\{stroke:#dc2626;opacity:\.4\}/);
});

test("계이름 토글은 음표 아래 전용 줄에 고정도법 이름을 표시하고 선택·재생·인쇄와 함께 움직인다", () => {
  assert.match(editorSource, /const MUSIC_LINE_HEIGHT = 205/);
  assert.match(editorSource, /const solfegePlaces = \[\]/);
  assert.match(editorSource, /const noteX = staveNote\.getAbsoluteX\(\) \+ staveNote\.getXShift\(\)/);
  assert.match(editorSource, /x:noteX,[\s\S]*y:bottomY \+ 38/);
  assert.match(editorSource, /document\.createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "text"\)/);
  assert.match(editorSource, /MUSIC_SOLFEGE_LABELS\[place\.note\.step\]/);
  assert.match(editorSource, /if \(sheet\.showSolfege !== false && !note\.rest && scoreSvg\)/);
  assert.match(editorSource, /for \(const el of solfegeEls\.values\(\)\) el\.classList\.remove\("is-selected"\)/);
  assert.match(editorSource, /for \(const el of solfegeEls\.values\(\)\) el\.classList\.remove\("is-playing"\)/);
  assert.match(editorSource, /sheet\.showSolfege = restored\.showSolfege/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-solfege\{[^}]*font-size:13px[^}]*fill:#2563eb/);
  assert.match(css, /\.music-print \.music-solfege\{fill:#111\}/);
});

test("악보 우클릭 메뉴는 음표·빈 오선에 맞는 편집 도구를 같은 동작 경로로 제공한다", () => {
  assert.match(editorSource, /scoreHost\.addEventListener\("contextmenu", onScoreContextMenu\)/);
  assert.match(editorSource, /const noteTarget = target && target\.closest \? target\.closest\("\[data-note-id\]"\)/);
  assert.match(editorSource, /if \(noteInfo\) select\(noteInfo\.measureIndex, noteInfo\.note\.id,[\s\S]*voice:noteInfo\.voice/);
  assert.match(editorSource, /label:"이 음표 미리 듣기"/);
  assert.match(editorSource, /label:"이 음표 삭제 \(Delete\)"/);
  assert.match(editorSource, /label:"다음 입력 도구", children:nextInputContextItems\(\)/);
  assert.match(editorSource, /label:`\$\{targetMeasure \+ 1\}마디 삭제`/);
  assert.match(editorSource, /label:"계이름 표시", active:sheet\.showSolfege !== false, action:toggleSolfege/);
  assert.match(editorSource, /label:"입력 오선", children:/);
  assert.match(editorSource, /label:"오른손 · 높은음자리표"/);
  assert.match(editorSource, /label:"왼손 · 낮은음자리표"/);
  assert.match(editorSource, /label:"도레미 빠른 입력"/);
  assert.match(editorSource, /label:"피아노 대보표", active:sheet\.grandStaff/);
  assert.match(editorSource, /label:"악보 내용 초기화…", action:resetScoreContent/);
  assert.match(editorSource, /label:"재생·연습", children:playbackContextItems\(targetMeasure\)/);
  assert.match(editorSource, /label:"오른손만 재생"/);
  assert.match(editorSource, /label:"왼손만 재생"/);
  assert.match(editorSource, /label:"저장·내보내기", children:/);
  assert.match(editorSource, /label:"MusicXML 저장", action:exportMusicXml/);
  assert.match(editorSource, /label:"WAV 저장", action:exportMusicWav/);
  assert.match(editorSource, /label:"인쇄 · PDF 저장", action:printScore/);
  assert.match(editorSource, /setToolValue\(item\.value\)/); // 도구막대와 메뉴가 같은 함수로 상태를 바꾼다.
  assert.match(editorSource, /event\.key === "ContextMenu" \|\| \(event\.shiftKey && event\.key === "F10"\)/);
  assert.match(editorSource, /closeMusicContextMenu\(\);\s*scoreHost\.removeEventListener\("contextmenu"/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-context-menu\{position:fixed;z-index:1960/);
  assert.match(css, /\.music-context-menu button\.is-active::before\{content:"✓"/);
  assert.match(css, /\.music-context-menu button\.music-context-parent::after\{content:"▸"/);
});

test("되돌리기는 공용 MNEditHistory 로 하고 악보 JSON 을 스냅샷으로 쓴다", () => {
  assert.match(editorSource, /MNEditHistory\.create\(\{/);
  assert.match(editorSource, /capture:\(\) => musicSerialize\(sheet\)/);
  assert.match(editorSource, /isEqual:\(a, b\) => a === b/);
  // 되돌리는 중 일어난 변경을 다시 기록하면 스택이 꼬인다.
  assert.match(editorSource, /if \(history && !history\.isApplying\(\)\) history\.commit\(\)/);
  // 제목 타자는 한 단계로 묶는다.
  assert.match(editorSource, /history\.commitSoon\(MUSIC_TYPING_DELAY\)/);
  // 저장으로 updatedAt 이 바뀌면 현재 스냅샷도 새 저장본과 맞춰야 이후 Undo가 깨끗한 상태로 돌아온다.
  assert.match(editorSource, /doc\._musicHistory\.replaceCurrent\(json\)/);
  // 박자·조표 Undo 뒤 선택 상자도 복원된 모델과 같아야 한다.
  assert.match(editorSource, /timeSelect\.value = `\$\{sheet\.time\.beats\}\/\$\{sheet\.time\.beatValue\}`/);
  assert.match(editorSource, /keySelect\.value = sheet\.key/);
  const boundary = manifest.moduleBoundaries.find((item) => item.file === "history.js");
  assert.ok(boundary.consumers.includes("music-editor.js"));
});

test("자판 단축키는 입력칸 안에서는 동작하지 않는다", () => {
  assert.match(editorSource, /function editableTarget\(target\)/);
  assert.match(editorSource, /if \(editableTarget\(event\.target\)\) return;/);
  assert.match(editorSource, /if \(doc\.el\.hidden\) return;/);      // 다른 문서를 보고 있을 때 가로채지 않는다
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Escape"]){
    assert.ok(editorSource.includes(`"${key}"`), `${key} 처리가 있어야 한다`);
  }
  assert.match(editorSource, /document\.removeEventListener\("keydown", onKeyDown, true\)/);
});

test("조표·박자표는 화면에서 바꾸고, 조표는 소리까지 맞춘다", () => {
  assert.match(editorSource, /musicRetuneForKey\(sheet, keySelect\.value\)/);
  assert.match(editorSource, /const MUSIC_TIME_CHOICES = \["2\/4", "3\/4", "4\/4", "6\/8"\]/);
  assert.match(editorSource, /sheet\.time = \{ beats, beatValue \}/);
  // 박자를 줄이면 넘치는 마디가 생길 수 있다 — 막지 않고 알린다(되돌리기로 취소).
  assert.match(editorSource, /박자와 맞지 않는 마디는 아래에 표시했어요/);
});

test("실제 악기 샘플 음색을 선택하며 재생 준비와 WAV 실패를 안내한다", () => {
  assert.match(editorSource, /piano:"피아노\(추천\)"/);
  assert.match(editorSource, /guitar:"기타\(나일론\)"/);
  for (const timbre of ["xylophone:\"실로폰\"", "harp:\"하프\"", "flute:\"플루트\"", "clarinet:\"클라리넷\""]){
    assert.ok(editorSource.includes(timbre), `${timbre} 선택지가 있어야 한다`);
  }
  assert.match(editorSource, /async function startPlay\(range, practice\)/);
  assert.match(editorSource, /MNMusicAudio\.sampledTimbre\(sheet\.timbre\)/);
  assert.match(editorSource, /timbreLabel\(timbre\)/);
  assert.match(editorSource, /await MNMusicAudio\.play\(sheet/);
  assert.match(editorSource, /label \+ " 음원을 읽지 못해 삼각파로 재생해요/);
  assert.match(editorSource, /MNMusicAudio\.renderWav\(sheet, \{/);
  assert.match(editorSource, /label \+ " 음원을 읽지 못해 삼각파 WAV로 저장해요/);
});

test("학생 연습 재생은 느린 속도·카운트인·메트로놈·고른 마디 반복을 제공한다", () => {
  assert.match(editorSource, /for \(const rate of \[0\.5, 0\.75, 1\]\)/);
  assert.match(editorSource, /musicButton\("1234 준비"/);
  assert.match(editorSource, /musicButton\("♩ 메트로놈"/);
  assert.match(editorSource, /musicButton\("↻ 고른 마디"/);
  assert.match(editorSource, /playbackRate:Number\(speedSelect\.value\) \|\| 1/);
  assert.match(editorSource, /countIn:countInEnabled/);
  assert.match(editorSource, /metronome:metronomeEnabled/);
  assert.match(editorSource, /loop:!!options\.loop/);
  assert.match(editorSource, /startPlay\(\{ from:measure, to:measure \}, \{ loop:true \}\)/);
  assert.match(editorSource, /status\.textContent = `준비 \$\{beat\} \/ \$\{total\}`/);
});

test("입력 중인 마디는 사용 박자·남은 박자·완성 여부와 해결 방법을 보여준다", () => {
  assert.match(editorSource, /measureProgress\.className = "music-measure-progress"/);
  assert.match(editorSource, /musicMeasureProgress\(sheet, activeMeasureIndex\(\), activeStaff, activeVoice\)/);
  assert.match(editorSource, /박 · \$\{musicFriendlyNumber\(progress\.remainingBeats\)\}박 남음/);
  assert.match(editorSource, /마디.*완성/);
  assert.match(editorSource, /음표나 같은 길이 쉼표 하나를 넣으면 완성돼요/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-measure-progress\.is-complete/);
  assert.match(css, /\.music-measure-progress\.is-over/);
});

test("쉬운 입력은 옥타브와 도레미 버튼으로 다음 빈자리에 음표를 넣는다", () => {
  assert.match(editorSource, /beginnerTools\.className = "music-beginner-tools"/);
  for (const octave of [2, 3, 4, 5]) assert.ok(editorSource.includes(`[${octave},`));
  assert.match(editorSource, /for \(const step of MUSIC_STEPS\)/);
  assert.match(editorSource, /button\.addEventListener\("click", \(\) => insertSolfegeNote\(step\)\)/);
  assert.match(editorSource, /function insertSolfegeNote\(step\)/);
  assert.match(editorSource, /if \(musicCanFit\(sheet, index, candidate, activeStaff, activeVoice\)\)/);
  assert.match(editorSource, /sheet\.measures\.push\(musicMeasure\(\)\)/);
  assert.match(editorSource, /insertNote\(measureIndex, pitch, activeStaff\)/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-easy-notes \.music-btn\{[^}]*min-height:36px/);
});

test("빈 악보는 학교종·작은별 예제로 시작하고 기존 내용은 확인 뒤 바꾼다", () => {
  assert.match(editorSource, /\["school-bell", "학교종 4마디"\]/);
  assert.match(editorSource, /\["twinkle", "작은별 4마디"\]/);
  assert.match(editorSource, /exampleBtn\.addEventListener\("click", loadSelectedExample\)/);
  assert.match(editorSource, /const example = musicExampleSheet\(exampleSelect\.value\)/);
  assert.match(editorSource, /confirm\("현재 악보 내용을 선택한 예제로 바꿀까요\?"\)/);
  assert.match(editorSource, /sheet\.measures = example\.measures/);
  assert.match(editorSource, /예제로 시작했어요\. 바꾸거나 이어서 만들어 보세요/);
});

test("악보 음량·음소거를 조절하고 음색을 고르면 바로 미리듣는다", () => {
  assert.match(editorSource, /volumeInput\.type = "range"/);
  assert.match(editorSource, /volumeInput\.setAttribute\("aria-label", "악보 음량"\)/);
  assert.match(editorSource, /MNMusicAudio\.setVolume\(Number\(volumeInput\.value\) \/ 100\)/);
  assert.match(editorSource, /MNMusicAudio\.setMuted\(!MNMusicAudio\.muted\(\)\)/);
  assert.match(editorSource, /muteBtn\.textContent = isMuted \|\| MNMusicAudio\.getVolume\(\) === 0 \? "🔇" : "🔊"/);
  assert.match(editorSource, /MNMusicAudio\.previewNote\(\{ rest:false, step:"C", octave:4, alter:keyAlter \}, sheet\.timbre\)/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-volume-range\{[^}]*accent-color:var\(--accent\)/);
});

test("줄 나누기는 화면 폭을 따라간다", () => {
  assert.match(editorSource, /musicPackLines\(sheet\.measures, width - 20\)/);
  assert.match(editorSource, /const lineHeight = sheet\.grandStaff \? MUSIC_GRAND_LINE_HEIGHT : MUSIC_LINE_HEIGHT/);
  assert.match(editorSource, /const scoreHeight = layout\.length \* lineHeight \+ 30/);
  assert.match(editorSource, /renderer\.resize\(width, scoreHeight\)/);
  // 고정 4마디 배치는 더 쓰지 않는다.
  assert.doesNotMatch(editorSource, /MUSIC_BARS_PER_LINE/);
  assert.match(editorSource, /new ResizeObserver\(scheduleRedraw\)/);
});

test("악보 배율은 버튼·Ctrl+휠·자판으로 바꾸고 포인터 위치를 지킨다", () => {
  assert.match(editorSource, /const MUSIC_ZOOM_MIN = 0\.5/);
  assert.match(editorSource, /const MUSIC_ZOOM_MAX = 2/);
  assert.match(editorSource, /zoomWrap\.append\(zoomOutBtn, zoomLabel, zoomInBtn, zoomFitBtn\)/);
  assert.match(editorSource, /scoreHost\.addEventListener\("wheel", \(event\) => \{/);
  assert.match(editorSource, /if \(!\(event\.ctrlKey \|\| event\.metaKey\)\) return/);
  assert.match(editorSource, /\}, \{ passive:false \}\)/);
  assert.match(editorSource, /svg\.style\.width = Math\.max\(1, Math\.round\(baseWidth \* scoreZoom\)\)/);
  assert.match(editorSource, /scoreHost\.scrollLeft \+=/);
  assert.match(editorSource, /scoreHost\.scrollTop \+=/);
  // 다시 그린 SVG에도 현재 배율이 살아 있어야 한다.
  assert.match(editorSource, /svg\.dataset\.musicBaseWidth = String\(width\)/);
  assert.match(editorSource, /applyScoreZoom\(\);\s*paintSelection\(\)/);
  // 배율은 보기 상태이므로 touch/history 커밋 경로를 타지 않는다.
  assert.doesNotMatch(editorSource.match(/function setScoreZoom[\s\S]*?\n  \}/)[0], /touch\(|history\.commit/);
});

test("확대된 악보의 입력 영역 밖은 손바닥 드래그로 상하좌우 이동한다", () => {
  assert.match(editorSource, /function scoreHasOverflow\(\)/);
  assert.match(editorSource, /return !target && !staveBoxAtPoint\(scorePoint\(event\)\)/);
  assert.match(editorSource, /scoreHost\.addEventListener\("pointerdown"/);
  assert.match(editorSource, /Math\.abs\(dx\) \+ Math\.abs\(dy\) < 4/);
  assert.match(editorSource, /scoreHost\.scrollLeft = scorePan\.left - dx/);
  assert.match(editorSource, /scoreHost\.scrollTop = scorePan\.top - dy/);
  assert.match(editorSource, /scoreHost\.setPointerCapture\(event\.pointerId\)/);
  assert.match(editorSource, /if \(suppressScoreClick\)/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-score\.is-pan-ready\{cursor:grab\}/);
  assert.match(css, /\.music-score\.is-panning,.music-score\.is-panning \*\{cursor:grabbing!important/);
});

test("음표 좌우 위치는 위치 조정 도구나 Alt+드래그로 이웃과 마디 안에서 미세 조정된다", () => {
  assert.match(editorSource, /const noteHorizontalLimits = new Map\(\)/);
  assert.match(editorSource, /\(baseX - baseXs\[at - 1\]\) \/ 2 - 6/);
  assert.match(editorSource, /noteEndX - baseX - 6/);
  assert.match(editorSource, /Math\.max\(-MUSIC_X_OFFSET_MAX/);
  assert.match(editorSource, /item\.staveNote\.setXShift/);
  assert.match(editorSource, /staveNote\.getAbsoluteX\(\) \+ staveNote\.getXShift\(\)/); // 계이름도 함께 이동한다.
  assert.match(editorSource, /tool\.position \|\| \(event\.pointerType !== "touch" && event\.altKey\)/);
  assert.match(editorSource, /noteHorizontalLimits\.set\(item\.note\.id, \{ min, max, applied \}\)/);
  assert.match(editorSource, /startOffset:limits\.applied/);
  assert.match(editorSource, /Math\.round\(noteDrag\.startOffset \+ point\.x - noteDrag\.startX\)/);
  assert.match(editorSource, /delete noteDrag\.note\.xOffset/);
  assert.match(editorSource, /if \(history && !history\.isApplying\(\)\) history\.commit\(\)/);
  assert.match(editorSource, /label:"좌우 위치 원래대로"/);
  assert.match(editorSource, /label:"위치 조정 모드", active:tool\.position/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-score\.is-position-tool \[data-note-id\]\{cursor:ew-resize;touch-action:none\}/);
  assert.match(css, /\.music-score\.is-positioning,.music-score\.is-positioning \*\{cursor:ew-resize!important/);
});

test("일반 상태에서 음표를 위아래로 드래그하면 줄·칸 단위로 음높이가 바뀐다", () => {
  assert.match(editorSource, /const pitchDrag = existing && !existing\.note\.rest && !tool\.eraser && !tool\.position/);
  assert.match(editorSource, /kind:horizontalDrag \? "horizontal" : "pitch"/);
  assert.match(editorSource, /startPitch:\{ step:existing\.note\.step, octave:existing\.note\.octave, alter:existing\.note\.alter \}/);
  assert.match(editorSource, /const steps = -Math\.round\(dy \/ Math\.max\(1, \(noteDrag\.spacing \|\| 10\) \/ 2\)\)/);
  assert.match(editorSource, /sourcePitches\.map\(\(pitch\) => musicShiftPitch\(pitch, steps, noteDrag\.staff\)\)/);
  assert.match(editorSource, /음높이 이동 불가: 사용할 수 있는 음역을 벗어났어요/);
  assert.match(editorSource, /noteDrag\.note\.step = movedPitches\[0\]\.step/);
  assert.match(editorSource, /noteDrag\.note\.octave = movedPitches\[0\]\.octave/);
  assert.match(editorSource, /음높이 이동: /);
  assert.match(editorSource, /if \(pitchChanged\) MNMusicAudio\.previewNote\(draggedNote, sheet\.timbre\)/);
  const css = read("src/styles.css");
  assert.match(css, /\.music-score\.is-note-entry \[data-note-id\]:not\(\.is-rest\)\{cursor:ns-resize\}/);
  assert.match(css, /\.music-score\.is-pitching,.music-score\.is-pitching \*\{cursor:ns-resize!important/);
});

test("인쇄는 같은 문서 안에서 찍어 악보 글꼴을 지킨다", () => {
  // 새 창·iframe 으로 SVG 만 옮기면 Bravura 글꼴이 없어 음표가 깨진다.
  assert.doesNotMatch(editorSource, /window\.open|createElement\("iframe"\)/);
  assert.match(editorSource, /document\.body\.classList\.add\("music-printing"\)/);
  assert.match(editorSource, /window\.addEventListener\("afterprint", cleanup\)/);
  assert.match(editorSource, /copy\.style\.removeProperty\("width"\)/);
  assert.match(editorSource, /copy\.style\.removeProperty\("height"\)/);
  assert.match(editorSource, /doc\.printScore = printScore/);
  // 머리말 인쇄 버튼도 같은 경로로 들어온다(화이트보드와 같은 방식).
  assert.match(read("src/js/app.js"), /state\.kind === "music" && typeof state\.printScore === "function"/);
  const css = read("src/styles.css");
  assert.match(css, /body\.music-printing>\*\{display:none!important\}/);
  assert.match(css, /body\.music-printing>\.music-print\{display:block!important\}/);
});

test("조판은 VexFlow 5 API 로 부르고, 실패해도 문서를 열 수 있다", () => {
  // 자동 조판과 그리기 사이에 xShift를 넣어야 꼬리 잇기도 새 위치를 따라간다.
  assert.match(editorSource, /new VF\.Voice\(VF\.TIME4_4\)\.setMode\(VF\.Voice\.Mode\.SOFT\)/);
  assert.match(editorSource, /VF\.Beam\.applyAndGetBeams\(vexVoice\)/);
  assert.match(editorSource, /new VF\.Formatter\(\)\.joinVoices\(vexVoices\)\.formatToStave/);
  assert.match(editorSource, /vexVoice\.setContext\(context\)\.setStave\(stave\)\.drawWithStyle\(\)/);
  assert.match(editorSource, /beams\.forEach\(\(beam\) => beam\.setContext\(context\)\.drawWithStyle\(\)\)/);
  assert.match(editorSource, /new VF\.StaveTie\(\{ firstNote:item\.staveNote, lastNote:next\.staveNote,/);
  assert.match(editorSource, /firstIndexes:firstIndices, lastIndexes:lastIndices/);
  assert.doesNotMatch(editorSource, /first_note|last_note|first_indices|last_indices/);
  assert.doesNotMatch(editorSource, /auto_beam|align_rests|num_beats|beat_value/);
  assert.match(editorSource, /new VF\.Stave\(x, y, staveWidth\)/);
  assert.match(editorSource, /VF\.Renderer\.Backends\.SVG/);
  assert.match(editorSource, /VF\.Dot\.buildAndAttach/);
  // 그리기가 실패해도 재생·저장은 살아 있어야 한다.
  assert.match(editorSource, /catch\(error\)\{\s*console\.warn\("악보를 그리지 못했습니다:"/);
});

test("조옮김은 미리 세어 보고 물어본 뒤에 옮긴다", () => {
  // 머리말 버튼과 우클릭 메뉴가 같은 목록을 쓴다(같은 기능을 두 번 만들지 않는다).
  assert.match(editorSource, /const transposeBtn = musicButton\("조옮김"/);
  assert.match(editorSource, /openMusicContextMenu\(rect\.left, rect\.bottom \+ 4, transposeContextItems\(\)\)/);
  assert.match(editorSource, /\{ label:"조옮김", children:transposeContextItems\(\) \}/);
  // 올리기·내리기 간격은 한 곳에서만 정의한다.
  assert.match(editorSource, /const MUSIC_TRANSPOSE_CHOICES = \[/);
  for (const semitones of [1, 2, 3, 4, 5, 7, 12]){
    assert.ok(editorSource.includes(`semitones:${semitones},`), `조옮김 간격 ${semitones}반음이 있어야 한다`);
  }
  // 음역 밖 음이 생기면 먼저 물어보고, 옮긴 뒤에는 조표 선택도 새 조표를 가리킨다.
  assert.match(editorSource, /musicTransposeSheet\(sheet, semitones, \{ apply:false \}\)/);
  assert.match(editorSource, /preview\.blocked > 0/);
  assert.match(editorSource, /preview\.outOfRange > 0 && typeof confirm === "function"/);
  assert.match(editorSource, /const result = musicTransposeSheet\(sheet, semitones\);/);
  assert.match(editorSource, /keySelect\.value = sheet\.key;/);
  // 한 단계로 되돌릴 수 있어야 한다(afterEdit 가 history.commit 까지 한다).
  assert.match(editorSource, /function applyTranspose\(semitones\)\{[\s\S]*?afterEdit\(\);/);
});

test("MIDI 건반 입력은 모델의 음이름 표기를 함께 쓴다", () => {
  // 같은 표를 편집기에 다시 적지 않는다(조옮김도 같은 함수를 쓴다).
  assert.match(editorSource, /return musicPitchFromMidi\(midi, useFlats\)/);
  assert.doesNotMatch(editorSource, /\[\["C",0\],\["C",1\],\["D",0\]/);
  assert.match(read("src/js/music-model.js"), /function musicPitchFromMidi\(midi, preferFlats\)/);
});

test("저장·편집 중 내용이 자동 복원 사본에도 반영된다", () => {
  // saveTextDoc 은 디스크에만 쓴다. 작업공간 사본을 갱신하지 않으면 다음 실행 때
  // "만들 때의 빈 악보"가 되살아난다 — 표·이미지와 같은 공용 헬퍼로 사본까지 바꾼다.
  assert.match(editorSource, /markDocumentSavedSnapshot\(doc, new TextEncoder\(\)\.encode\(json\), "application\/json"\)/);
  // 저장 전에 꺼져도 복구되도록 편집이 멈추면 복구본을 남긴다(.mnote 와 같은 경로·간격).
  assert.match(editorSource, /const MUSIC_RECOVERY_DELAY = 1500;/);
  assert.match(editorSource, /saveDocumentRecoverySnapshot\(doc, bytes, "application\/json"\)/);
  assert.match(editorSource, /appSettings\.pdfRecovery/);
  assert.match(editorSource, /doc\.flushBackupRecovery = flushMusicBackup/);
  // 편집이 일어나는 자리(touch)에서 예약하고, 문서를 닫을 때 타이머를 정리한다.
  assert.match(editorSource, /markDocumentDirty\(doc, musicSerialize\(sheet\) !== doc\.savedText\);\s*\n\s*scheduleMusicRecovery\(\);/);
  assert.match(editorSource, /doc\.cleanupFns\.push\(\(\) => \{\s*\n\s*clearTimeout\(recoveryTimer\);/);
  // 공용 헬퍼는 documents.js 것을 쓴다(같은 기능을 다시 만들지 않는다).
  const documents = read("src/js/documents.js");
  assert.match(documents, /async function markDocumentSavedSnapshot\(doc, bytes, type\)/);
  assert.match(documents, /async function saveDocumentRecoverySnapshot\(doc, bytes, type\)/);
});
