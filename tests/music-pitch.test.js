"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 음높이 찾기와 "한 음을 냈다" 판정은 DOM·마이크 없이 순수 함수로 검증한다.
const context = vm.createContext({ Float32Array, Math, Number, Object, globalThis:{} });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "js", "music-pitch.js"), "utf8")
  + "\nglobalThis.MNMusicPitch = MNMusicPitch;", context);
const P = context.globalThis.MNMusicPitch;

const RATE = 48000;
function tone(freq, { size = 2048, amp = 0.3, harmonics = [1] } = {}){
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++){
    let v = 0;
    harmonics.forEach((weight, h) => { v += weight * Math.sin(2 * Math.PI * freq * (h + 1) * i / RATE); });
    out[i] = amp * v;
  }
  return out;
}
const midiOf = (freq) => P.freqToMidi(P.detect(tone(freq), RATE).freq);

test("순음의 음높이를 반음 오차 안에서 찾는다 (낮은 목소리~리코더 높은 음)", () => {
  for (const [freq, midi] of [[98, 43], [261.63, 60], [440, 69], [880, 81], [2093, 96]]){
    const found = P.detect(tone(freq), RATE);
    assert.ok(found && found.freq, `${freq}Hz 를 찾아야 한다`);
    assert.ok(Math.abs(P.freqToMidi(found.freq) - midi) < 0.2, `${freq}Hz → ${P.freqToMidi(found.freq)}`);
  }
});

test("배음이 강한 소리도 옥타브를 틀리지 않는다", () => {
  const found = P.detect(tone(220, { harmonics:[0.6, 1, 0.7, 0.4] }), RATE);
  assert.ok(Math.abs(P.freqToMidi(found.freq) - 57) < 0.2, String(P.freqToMidi(found.freq)));
});

test("조용하거나 주기가 없는 소리는 음이 아니다", () => {
  assert.equal(P.detect(tone(440, { amp:0.001 }), RATE).freq, null);
  let seed = 7;
  const noise = new Float32Array(2048).map(() => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.6; });
  assert.equal(P.detect(noise, RATE).freq, null);
  assert.ok(Math.abs(midiOf(440) - 69) < 0.1);
});

function run(tracker, frames){
  const notes = [];
  for (const [t, midi] of frames){
    const note = tracker.feed({ t, midi });
    if (note) notes.push(note.midi);
  }
  return notes;
}
const hold = (from, to, midi, step = 30) => {
  const frames = [];
  for (let t = from; t < to; t += step) frames.push([t, midi]);
  return frames;
};

test("한 음을 길게 끌어도 한 번만 센다", () => {
  assert.deepEqual(run(P.createTracker(), hold(0, 2000, 60.1)), [60]);
});

test("잠깐 스친 음은 세지 않고, 자리 잡은 음만 센다", () => {
  const frames = [...hold(0, 60, 62), ...hold(60, 600, 64)];
  assert.deepEqual(run(P.createTracker(), frames), [64]);
});

test("같은 음을 두 번 내려면 사이에 쉬어야 한다 (도 도)", () => {
  const legato = [...hold(0, 300, 60), [300, 58.5], ...hold(330, 700, 60)];   // 음 사이를 스쳤을 뿐 쉬지 않았다
  assert.deepEqual(run(P.createTracker(), legato), [60]);
  const detached = [...hold(0, 300, 60), ...hold(300, 420, null), ...hold(420, 800, 60)];
  assert.deepEqual(run(P.createTracker(), detached), [60, 60]);
});

test("반음 사이에 걸친 음(센트가 크게 벗어난 음)은 자리 잡지 않은 것으로 본다", () => {
  assert.deepEqual(run(P.createTracker(), hold(0, 800, 60.5)), []);
});

test("머무는 시간을 음마다 달리 줄 수 있다 — 틀린 음은 오래 머물 때만 센다", () => {
  const tracker = P.createTracker({ holdMs:(midi) => (midi === 67 ? 120 : 450) });
  assert.deepEqual(run(tracker, [...hold(0, 300, 65), ...hold(300, 500, 67)]), [67]);
  tracker.reset();
  assert.deepEqual(run(tracker, hold(0, 600, 65)), [65]);
});

test("표시 글자는 음이름·옥타브·센트", () => {
  assert.equal(P.label(69.12), "라4 +12");
  assert.equal(P.label(59.9), "도4 −10");
});

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("따라 부르기는 따라치기와 같은 채점 문으로 들어오고 스피커 소리를 막는다", () => {
  const editor = read("src/js/music-editor.js");
  assert.match(editor, /onNote:\(note\) => \{ if \(practice\.active\) practicePress\(note\.pc, "mic"\); \}/);
  assert.match(editor, /if \(fromMic\)\{ practiceAdvance\(\); return; \}/, "목소리는 화음 중 한 음만 맞아도 넘어간다");
  assert.match(editor, /practiceMic\.mute\(MUSIC_MIC_PROMPT_MUTE_MS\);\s*practicePreviewMidis/, "들려주기 전에 마이크를 막아야 한다");
  assert.match(editor, /stopPracticeMic\(\);\s*practice\.active = false;/, "따라치기를 끝내면 마이크를 놓는다");
  assert.match(editor, /practiceMic\.stop\(\);\s*\/\/ 마이크를 놓아야/, "문서를 닫아도 마이크를 놓는다");
  assert.match(read("src/js/music-pitch.js"), /echoCancellation:false, noiseSuppression:false, autoGainControl:false/);
  const manifest = JSON.parse(read("scripts.manifest.json"));
  assert.ok(manifest.localScripts.indexOf("music-pitch.js") < manifest.localScripts.indexOf("music-editor.js"));
  assert.ok(read("classdock.html").includes('<script src="src/js/music-pitch.js"></script>'));
  const boundary = manifest.moduleBoundaries.find((item) => item.file === "music-pitch.js");
  assert.equal(boundary.publicApi, "MNMusicPitch");
});
