"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/* node 에는 Web Audio 가 없다. 그래서 브라우저가 필요한 부분(실제 소리)이 아니라
   "무엇을 몇 초에 예약했는가"와 "WAV 바이트가 규격대로인가"를 검증한다.
   예약은 가짜 AudioContext 로 받아 적어 확인한다. */

function loadMusicAudio(){
  const context = {
    console, Math, JSON, Date, Number, Array, Object, String, Error, Promise,
    ArrayBuffer, DataView, Float32Array, Uint8Array,
    setInterval, clearInterval, setTimeout, clearTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ["music-model.js", "music-audio.js"]){
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8"), context, { filename:file });
  }
  vm.runInContext(`
    ;globalThis.__music = { MNMusicAudio, musicEmpty, musicNote, musicRest, musicMeasure, musicTimeline };`, context);
  return context.__music;
}

// 오실레이터·게인 호출을 그대로 받아 적는 가짜 컨텍스트.
function fakeContext(){
  const ctx = { currentTime:0, oscillators:[], bufferSources:[], gains:[] };
  ctx.createOscillator = () => {
    const osc = { type:"", startedAt:null, stoppedAt:null, frequencyAt:[], connected:0 };
    osc.frequency = { setValueAtTime:(value, time) => osc.frequencyAt.push({ value, time }) };
    osc.connect = () => { osc.connected++; };
    osc.start = (time) => { osc.startedAt = time; };
    osc.stop = (time) => { osc.stoppedAt = time; };
    ctx.oscillators.push(osc);
    return osc;
  };
  ctx.createBufferSource = () => {
    const source = { buffer:null, startedAt:null, stoppedAt:null, rates:[], connected:0 };
    source.playbackRate = { setValueAtTime:(value, time) => source.rates.push({ value, time }) };
    source.connect = () => { source.connected++; };
    source.start = (time) => { source.startedAt = time; };
    source.stop = (time) => { source.stoppedAt = time; };
    ctx.bufferSources.push(source);
    return source;
  };
  ctx.createGain = () => {
    const gain = { value:0, envelope:[], connected:0 };
    gain.gain = {
      value:0,
      setValueAtTime:(value, time) => gain.envelope.push({ kind:"set", value, time }),
      linearRampToValueAtTime:(value, time) => gain.envelope.push({ kind:"ramp", value, time }),
      cancelScheduledValues:() => {}
    };
    gain.connect = () => { gain.connected++; };
    ctx.gains.push(gain);
    return gain;
  };
  return ctx;
}

function fourNotes(api){
  const sheet = api.musicEmpty("예약 검사");
  sheet.tempo = 100;    // 4분음표 0.6초
  sheet.measures = [api.musicMeasure([
    api.musicNote("A", 4), api.musicRest("quarter"), api.musicNote("A", 5), api.musicNote("A", 3)
  ])];
  return sheet;
}

test("예약은 쉼표를 건너뛰고, 시각과 주파수가 타임라인과 맞는다", () => {
  const api = loadMusicAudio();
  const sheet = fourNotes(api);
  const timeline = api.musicTimeline(sheet);
  const ctx = fakeContext();

  const nodes = api.MNMusicAudio.scheduleInto(ctx, {}, timeline.events, 10, "triangle");

  // 음표 4개 중 쉼표 하나는 소리를 만들지 않는다(시간만 흐른다).
  assert.equal(nodes.length, 3);
  assert.equal(ctx.oscillators.length, 3);

  const [first, second, third] = ctx.oscillators;
  assert.equal(first.type, "triangle");
  assert.equal(Math.round(first.frequencyAt[0].value), 440);      // A4
  assert.equal(Math.round(second.frequencyAt[0].value), 880);     // A5
  assert.equal(Math.round(third.frequencyAt[0].value), 220);      // A3

  // offset 10초 기준: 0.0 / 1.2 / 1.8 초에 시작
  assert.equal(round3(first.startedAt), 10);
  assert.equal(round3(second.startedAt), 11.2);
  assert.equal(round3(third.startedAt), 11.8);
});

test("엔벨로프는 0에서 시작해 0으로 끝나고, 정지는 여운 뒤에 온다", () => {
  const api = loadMusicAudio();
  const sheet = fourNotes(api);
  const ctx = fakeContext();
  api.MNMusicAudio.scheduleInto(ctx, {}, api.musicTimeline(sheet).events, 0, "triangle");

  const envelope = ctx.gains[0].envelope;
  // 딸깍 잡음을 막으려면 반드시 0에서 올라가고 0으로 내려와야 한다.
  assert.equal(envelope[0].kind, "set");
  assert.equal(envelope[0].value, 0);
  assert.equal(envelope[0].time, 0);
  assert.equal(envelope[envelope.length - 1].kind, "ramp");
  assert.equal(envelope[envelope.length - 1].value, 0);

  // 엔벨로프 시각은 순서대로여야 한다(어긋나면 Web Audio 가 예외를 던진다).
  for (let i = 1; i < envelope.length; i++){
    assert.ok(envelope[i].time >= envelope[i - 1].time, `엔벨로프 시각 역전: ${JSON.stringify(envelope)}`);
  }

  // 소리를 끊는 시점은 여운(release)이 끝난 뒤여야 한다.
  const release = api.MNMusicAudio.ADSR.release;
  assert.ok(ctx.oscillators[0].stoppedAt >= 0.6 + release);
});

test("아주 짧은 음표에서도 엔벨로프가 음 길이를 넘지 않는다", () => {
  const api = loadMusicAudio();
  const sheet = api.musicEmpty("빠른 16분음표");
  sheet.tempo = 208;   // 16분음표 ≈ 0.072초 — attack+decay 보다 짧다
  sheet.measures = [api.musicMeasure([
    api.musicNote("C", 5, { value:"16th" }), api.musicNote("D", 5, { value:"16th" })
  ])];
  const ctx = fakeContext();
  api.MNMusicAudio.scheduleInto(ctx, {}, api.musicTimeline(sheet).events, 0, "square");

  const first = ctx.gains[0].envelope;
  const noteEnd = 60 / 208 / 4;                       // 16분음표 길이(초)
  for (const step of first){
    assert.ok(step.time <= noteEnd + api.MNMusicAudio.ADSR.release + 1e-9,
      `엔벨로프가 음 길이를 넘었다: ${step.time} > ${noteEnd}`);
  }
  // 겹치는 음이 없어야 한다: 다음 음 시작이 앞 음 시작보다 뒤.
  assert.ok(ctx.oscillators[1].startedAt > ctx.oscillators[0].startedAt);
});

test("피아노 음색은 가까운 실제 녹음을 골라 재생 속도로 음높이를 맞춘다", () => {
  const api = loadMusicAudio();
  const sheet = api.musicEmpty("피아노 샘플");
  sheet.measures = [api.musicMeasure([api.musicNote("B", 4)])]; // B4=71, C5=72가 가장 가깝다.
  const ctx = fakeContext();
  const buffers = [
    { midi:69, file:"A4.mp3", buffer:{ name:"A4" } },
    { midi:72, file:"C5.mp3", buffer:{ name:"C5" } }
  ];
  const nodes = api.MNMusicAudio.scheduleInto(ctx, {}, api.musicTimeline(sheet).events, 2, "piano", buffers);
  assert.equal(nodes.length, 1);
  assert.equal(ctx.oscillators.length, 0);
  assert.equal(ctx.bufferSources.length, 1);
  assert.equal(ctx.bufferSources[0].buffer.name, "C5");
  assert.equal(ctx.bufferSources[0].startedAt, 2);
  assert.ok(Math.abs(ctx.bufferSources[0].rates[0].value - Math.pow(2, -1 / 12)) < 1e-9);
  assert.equal(nodes[0].sampleMidi, 72);
  assert.ok(nodes[0].stopAt > 0.6); // 음 길이 뒤 피아노 여운을 남긴다.
});

test("나일론 기타 음색도 실제 녹음과 악기별 여운을 사용한다", () => {
  const api = loadMusicAudio();
  const sheet = api.musicEmpty("기타 샘플");
  sheet.timbre = "guitar";
  sheet.measures = [api.musicMeasure([api.musicNote("C", 6)])]; // C6=84, A#5=82가 가장 가깝다.
  const ctx = fakeContext();
  const buffers = [
    { midi:80, file:"Gs5.mp3", buffer:{ name:"Gs5" } },
    { midi:82, file:"As5.mp3", buffer:{ name:"As5" } }
  ];
  const nodes = api.MNMusicAudio.scheduleInto(ctx, {}, api.musicTimeline(sheet).events, 1, "guitar", buffers);
  assert.equal(nodes.length, 1);
  assert.equal(ctx.oscillators.length, 0);
  assert.equal(ctx.bufferSources[0].buffer.name, "As5");
  assert.equal(ctx.bufferSources[0].startedAt, 1);
  assert.ok(Math.abs(ctx.bufferSources[0].rates[0].value - Math.pow(2, 2 / 12)) < 1e-9);
  assert.equal(nodes[0].sampleMidi, 82);
  assert.ok(nodes[0].stopAt >= 0.6 + api.MNMusicAudio.GUITAR_RELEASE);
});

test("번들 피아노는 악보 음역을 덮는 10개 녹음과 출처 표기를 갖는다", () => {
  const api = loadMusicAudio();
  assert.equal(api.MNMusicAudio.PIANO_SAMPLE_ROOTS.length, 10);
  assert.equal(api.MNMusicAudio.PIANO_SAMPLE_ROOTS[0].midi, 56);
  assert.equal(api.MNMusicAudio.PIANO_SAMPLE_ROOTS.at(-1).midi, 84);
  for (const sample of api.MNMusicAudio.PIANO_SAMPLE_ROOTS){
    const fullPath = path.join(__dirname, "../src/assets/piano", sample.file);
    assert.ok(fs.statSync(fullPath).size > 40_000, `${sample.file} 녹음이 있어야 한다`);
  }
  assert.match(fs.readFileSync(path.join(__dirname, "../src/assets/piano/ATTRIBUTION.md"), "utf8"), /CC BY 3\.0|Attribution 3\.0/);
});

test("번들 나일론 기타는 악보 음역을 덮는 10개 녹음과 출처 표기를 갖는다", () => {
  const api = loadMusicAudio();
  assert.equal(api.MNMusicAudio.GUITAR_SAMPLE_ROOTS.length, 10);
  assert.equal(api.MNMusicAudio.GUITAR_SAMPLE_ROOTS[0].midi, 55);
  assert.equal(api.MNMusicAudio.GUITAR_SAMPLE_ROOTS.at(-1).midi, 82);
  for (const sample of api.MNMusicAudio.GUITAR_SAMPLE_ROOTS){
    const fullPath = path.join(__dirname, "../src/assets/guitar-nylon", sample.file);
    assert.ok(fs.statSync(fullPath).size > 30_000, `${sample.file} 녹음이 있어야 한다`);
  }
  const attribution = fs.readFileSync(path.join(__dirname, "../src/assets/guitar-nylon/ATTRIBUTION.md"), "utf8");
  assert.match(attribution, /CC BY 3\.0|Attribution 3\.0/);
  assert.match(attribution, /11573__quartertone__classicalguitar-multisampled/);
});

test("WAV 인코더는 규격대로 44바이트 헤더와 16bit 샘플을 쓴다", () => {
  const api = loadMusicAudio();
  const samples = Float32Array.from([0, 1, -1, 0.5, 2, -2]);   // 2·-2 는 잘려야 한다
  const buffer = api.MNMusicAudio.encodeWav([samples], 44100);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  assert.equal(buffer.byteLength, 44 + samples.length * 2);
  assert.equal(ascii(bytes, 0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2);
  assert.equal(ascii(bytes, 8, 4), "WAVE");
  assert.equal(ascii(bytes, 12, 4), "fmt ");
  assert.equal(view.getUint32(16, true), 16);        // fmt 청크 길이
  assert.equal(view.getUint16(20, true), 1);         // PCM
  assert.equal(view.getUint16(22, true), 1);         // 채널 수
  assert.equal(view.getUint32(24, true), 44100);     // 표본율
  assert.equal(view.getUint32(28, true), 44100 * 2); // 초당 바이트
  assert.equal(view.getUint16(32, true), 2);         // 블록 정렬
  assert.equal(view.getUint16(34, true), 16);        // 비트 수
  assert.equal(ascii(bytes, 36, 4), "data");
  assert.equal(view.getUint32(40, true), samples.length * 2);

  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), 32767);      // 1.0
  assert.equal(view.getInt16(48, true), -32768);     // -1.0
  assert.equal(view.getInt16(50, true), 16384);      // 0.5
  assert.equal(view.getInt16(52, true), 32767);      // 2.0 → 잘림
  assert.equal(view.getInt16(54, true), -32768);     // -2.0 → 잘림
});

test("빈 소리·다른 표본율에서도 헤더가 어긋나지 않는다", () => {
  const api = loadMusicAudio();
  const empty = new DataView(api.MNMusicAudio.encodeWav([new Float32Array(0)], 22050));
  assert.equal(empty.getUint32(40, true), 0);
  assert.equal(empty.getUint32(24, true), 22050);
  assert.equal(empty.getUint32(4, true), 36);
});

function ascii(bytes, offset, length){
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function round3(value){
  return Math.round(value * 1000) / 1000;
}
