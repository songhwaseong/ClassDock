"use strict";

// 사진첩 소리: 배경음악(넣기·빼기·페이드·크로스페이드·덕킹과 그 프리셋), 효과음(시점·합성·전체 크기·페이드), MP4 소리 굽기의 연결.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness.js");

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message || ""} ${actual} vs ${expected}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const sticker = (kind, motion, speed = 1, extra = {}) => ({ id:kind + motion, art:"round", x:50, y:50, w:10, r:0, an:{ k:motion, s:speed }, sfx:{ k:kind }, ...extra });

// 크기 곡선(setValueAtTime·linearRampToValueAtTime)을 적어 두고 t 초의 값을 계산한다.
function automation(){
  const events = [];
  const param = { value:1, setValueAtTime:(value, time) => events.push([time, value, "set"]), linearRampToValueAtTime:(value, time) => events.push([time, value, "ramp"]), exponentialRampToValueAtTime:(value, time) => events.push([time, value, "ramp"]), cancelScheduledValues(){} };
  param.at = t => { let previousTime = 0, previousValue = events.length ? 1 : param.value;
    for (const [time, value, kind] of events){ if (t < time) return kind === "ramp" ? previousValue + (value - previousValue)*(t - previousTime)/(time - previousTime) : previousValue; previousTime = time; previousValue = value; }
    return previousValue; };
  param.events = events;
  return param;
}
// Web Audio 흉내: 노드 연결과 크기 값을 적어 둔다(실시간 AudioContext·OfflineAudioContext 공용).
function fakeAudio(){
  const nodes = [];
  const node = kind => { const made = { kind, gain:automation(), frequency:automation(), Q:automation(), connections:[], connect(target){ made.connections.push(target); return target; }, start(...args){ made.startArgs = args; }, stop(){}, type:"", buffer:null, loop:false }; nodes.push(made); return made; };
  class Context {
    constructor(){ this.currentTime = 0; this.sampleRate = 48000; this.destination = { kind:"destination" }; this.state = "running"; }
    createGain(){ return node("gain"); } createOscillator(){ return node("osc"); } createBufferSource(){ return node("source"); } createBiquadFilter(){ return node("filter"); }
    createBuffer(channels, length, rate = 48000){ const data = [...Array(channels)].map(() => new Float32Array(length)); return { numberOfChannels:channels, length, sampleRate:rate, duration:length/rate, getChannelData:c => data[c] }; }
    async decodeAudioData(){ return this.createBuffer(2, 4*48000, 48000); }
    async startRendering(){ return { numberOfChannels:2, getChannelData:() => new Float32Array(8) }; }
    async resume(){} async close(){ this.state = "closed"; }
  }
  class Encoder {
    static async isConfigSupported(){ return { supported:true }; }
    constructor({ output }){ this.output = output; this.first = true; }
    configure(){} encode(){ this.output({ byteLength:2, copyTo(){} }, this.first ? { decoderConfig:{ description:new Uint8Array([0x11, 0x90]) } } : null); this.first = false; }
    async flush(){} close(){}
  }
  class Data { constructor(){} close(){} }
  return { nodes, context:{ AudioContext:Context, OfflineAudioContext:Context, AudioEncoder:Encoder, AudioData:Data } };
}
class FakeAudioElement { constructor(){ this.paused = true; this.volume = 1; this.currentTime = 0; this.duration = NaN; } async play(){ this.paused = false; } pause(){ this.paused = true; } removeAttribute(){} load(){} addEventListener(){} }

test("재생목록: 여러 곡 넣기·순서 바꾸기·곡 빼기, 쓰지 않게 된 음악 파일만 지운다", async () => {
  const album = loadAlbum();
  const p1 = { id:"P1", type:"image", stickers:[] }, p2 = { id:"P2", type:"image", stickers:[] };
  album.useRecords([p1, p2]);
  await album.importMusic(p1, [{ name:"a.mp3", type:"audio/mpeg", size:1000 }, { name:"notes.txt", type:"text/plain", size:10 }, { name:"b.m4a", type:"", size:1000 }, { name:"huge.mp3", type:"audio/mpeg", size:60*1024*1024 }]);
  assert.deepEqual(plain(album.musicTracks(p1.music).map(track => track.name)), ["a.mp3", "b.m4a"], "음악이 아니거나 너무 큰 파일은 건너뛴다");
  assert.equal(p1.music.v, .8);
  await album.importMusic(p1, { name:"c.ogg", type:"audio/ogg", size:1000 });
  const [a, b, c] = album.musicTracks(p1.music).map(track => track.id);
  assert.equal(album.moveTrack(p1, c, -1), true); assert.equal(album.moveTrack(p1, a, -1), false, "맨 앞은 더 못 올린다");
  assert.deepEqual(plain(album.musicTracks(p1.music).map(track => track.id)), [a, c, b]);
  p2.music = { tracks:[{ id:b, name:"b.m4a" }] };                       // 다른 사진도 쓰는 곡
  await album.removeTrack(p1, b); assert.equal(album.launcher.deleted().includes(b), false, "다른 사진이 쓰면 남긴다");
  await album.removeTrack(p1, a); assert.deepEqual(plain(album.launcher.deleted()), [a]);
  await album.removeTrack(p1, c); assert.equal(p1.music, undefined, "마지막 곡을 빼면 음악이 없어진다");
  await album.removeMusic(p2); assert.equal(album.launcher.deleted().includes(b), true);
});

test("재생목록: 예전 한 곡짜리 음악도 한 곡 목록으로 읽고, 고치면 설정을 지킨 채 목록 꼴로 바뀐다", async () => {
  const album = loadAlbum();
  album.set("audioRecords", [{ id:"old", type:"audio" }]);
  const photo = { id:"P", type:"image", stickers:[], music:{ id:"old", name:"old.mp3", v:.3, fo:4, ls:10, le:20, li:true } };
  album.useRecords([photo]);
  assert.deepEqual(plain(album.musicTracks(photo.music)), [{ id:"old", name:"old.mp3", ls:10, le:20, li:true }]);
  await album.importMusic(photo, { name:"new.mp3", type:"audio/mpeg", size:10 });
  assert.equal(photo.music.id, undefined); assert.equal(photo.music.v, .3); assert.equal(photo.music.fo, 4);
  assert.deepEqual(plain(photo.music.tracks[0]), { id:"old", name:"old.mp3", ls:10, le:20, li:true });
  assert.equal(photo.music.tracks.length, 2);
});

test("재생목록 순서: 순서대로, 섞어서는 사진·바퀴마다 정해진 순서(모든 곡 한 번씩)", () => {
  const album = loadAlbum();
  album.set("audioRecords", ["t0","t1","t2","t3","t4"].map(id => ({ id, type:"audio" })));
  const item = { id:"P", music:{ tracks:["t0","t1","t2","t3","t4"].map(id => ({ id })) } };
  assert.deepEqual(plain(album.playlistOrder(item, 0)), [0,1,2,3,4]);
  item.music.order = "shuffle";
  const first = plain(album.playlistOrder(item, 0));
  assert.deepEqual([...first].sort(), [0,1,2,3,4]); assert.deepEqual(plain(album.playlistOrder(item, 0)), first, "같은 사진·바퀴면 같은 순서");
  const cycles = [0,1,2,3,4,5].map(cycle => plain(album.playlistOrder(item, cycle)).join(""));
  assert.ok(new Set(cycles).size > 1, "바퀴마다 새로 섞는다");
  assert.notDeepEqual(plain(album.playlistOrder({ ...item, id:"Q" }, 0)), first);
});

test("재생목록 감상 모드: 곡 끝(재생 구간 끝)보다 겹침만큼 앞서 다음 곡이 커지고 앞 곡은 줄며, 끝나면 처음으로", async () => {
  const clock = { now:0 }, timers = [];
  class TrackAudio extends FakeAudioElement { constructor(){ super(); this.duration = 30; this.ended = false; } }
  const album = loadAlbum({ context:{ Audio:TrackAudio, performance:{ now:() => clock.now }, setInterval:callback => { timers.push(callback); return timers.length; }, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  album.set("audioRecords", [{ id:"t1", type:"audio", blob:{}, dur:30 }, { id:"t2", type:"audio", blob:{}, dur:30 }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:1, tx:2, tracks:[{ id:"t1", ls:5, le:15 }, { id:"t2" }] } };
  album.useRecords([item]);
  await album.playMusic(item); await tick();
  const session = album.musicSession, first = session.players[0];
  assert.equal(first.audio.currentTime, 5, "재생 구간 시작에서 튼다"); assert.equal(first.audio.loop, false);
  const beat = timers[timers.length - 1];
  first.audio.currentTime = 12; beat(); assert.equal(session.players.length, 1);
  first.audio.currentTime = 13; clock.now = 100; beat(); await tick();
  assert.equal(session.players.length, 2, "끝(15초)보다 겹침(2초) 앞에서 다음 곡"); assert.equal(album.playingTrackId(item), "t2");
  clock.now = 1100; beat();
  assert.ok(Math.abs(first.audio.volume - .5) < 1e-9, "앞 곡은 겹침 동안 줄고"); assert.ok(Math.abs(session.players[1].audio.volume - .5) < 1e-9, "다음 곡은 커진다");
  clock.now = 2200; beat(); assert.equal(session.players.length, 1, "다 줄면 앞 곡을 멈춘다");
  const second = session.players[0]; second.audio.currentTime = 28.5; beat(); await tick();
  assert.equal(session.cycle, 1); assert.equal(album.playingTrackId(item), "t1", "목록 끝이면 처음 곡으로");
  album.stopAllMusic();
});

test("재생목록 MP4: 곡을 재생 구간대로 이어 붙이고 겹침만큼 포개며 영상 끝까지 되풀이한다", async () => {
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  album.set("audioRecords", [{ id:"t1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }, { id:"t2", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:1, tx:.5, tracks:[{ id:"t1", ls:1, le:3, tv:.4 }, { id:"t2" }] } };
  album.useRecords([item]);
  await album.encodeMusic(item, 9);
  const sources = audio.nodes.filter(node => node.kind === "source");
  assert.ok(sources.every(source => !source.loop), "여러 곡이면 곡마다 되풀이하지 않는다");
  assert.deepEqual(sources.map(source => plain(source.startArgs)), [[0,1,2],[1.5,0,4],[5,1,2],[6.5,0,4]], "[시작 시각, 곡 안 위치, 길이] — 가짜 곡 길이는 4초");
  const levels = sources.map(source => source.connections[0]), fades = levels.map(level => level.connections[0]);
  assert.deepEqual(levels.map(level => level.gain.value), [.4, 1, .4, 1], "곡별 음량");
  assert.equal(fades[0].gain.at(0), 1, "첫 곡은 처음에 바로"); assert.ok(Math.abs(fades[1].gain.at(1.75) - .5) < 1e-9, "다음 곡은 겹침 동안 커지고");
  assert.ok(Math.abs(fades[0].gain.at(1.75) - .5) < 1e-9, "앞 곡은 같은 동안 줄어든다");
});

test("효과음: 움직임의 알맞은 순간에 나고, 모든 소리가 오류 없이 만들어진다", () => {
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  assert.equal(album.partSound({ sfx:{ k:"moo" } }), null);
  assert.deepEqual([...album.soundTimes({ sfx:{ k:"pop" } }, 0, 10)], [], "움직임이 없으면 소리도 없다");
  const bounce = sticker("boing", "bounce");
  const times = [...album.soundTimes(bounce, 0, 3)];
  assert.deepEqual(times.map(t => +t.toFixed(6)), [.6, 1.6, 2.6]);
  times.forEach(t => near(album.animationPose(bounce, t).y, 0, "통통 소리는 땅에 닿을 때"));
  assert.deepEqual([...album.soundTimes(sticker("thump", "pulse", 2), 0, 1.1)].map(t => +t.toFixed(4)), [.0825, .2475, .6325, .7975]);
  const shake = sticker("beep", "shake"), slices = [0, .7, 1.3, 3];
  assert.equal(slices.slice(1).reduce((count, end, i) => count + album.soundTimes(shake, slices[i], end).length, 0), album.soundTimes(shake, 0, 3).length);
  const ctx = new audio.context.AudioContext();
  album.SOUNDS.filter(row => row[0]).forEach(([kind]) => album.playSound(ctx, kind, 5, .5, ctx.destination));
  assert.ok(audio.nodes.length > 0);
});

test("효과음 전체 크기와 페이드: 감상 모드 재생이 장식 크기×전체 크기로, 페이드 곡선을 거쳐 난다", () => {
  const audio = fakeAudio(), album = loadAlbum({ context:{ ...audio.context, setInterval:() => 1, clearInterval(){} } });
  assert.equal(album.sfxMaster({ sfxv:9 }), 1.5); assert.equal(album.sfxMaster({}), 1);
  assert.deepEqual(plain(album.sfxFade({ sfxf:{ i:2, o:9 } })), { i:2, o:5 });
  const item = { id:"P", type:"image", stickers:[sticker("beep", "shake", 1, { sfx:{ k:"beep", v:.6 } })], sfxv:1.5, sfxf:{ i:2, o:0 } };
  album.useRecords([item]).set("viewing", true);
  album.syncSfx();
  const bus = album.sfxSession.bus;
  near(bus.gain.at(0), 0, "페이드인 시작"); near(bus.gain.at(1), .5); near(bus.gain.at(3), 1);
  const outs = audio.nodes.filter(node => node.kind === "gain" && node.connections[0] === bus);
  assert.ok(outs.length > 0); outs.forEach(out => near(out.gain.value, .6*1.5*.7, "장식 크기×전체 크기"));
  album.stopAllSfx();
});

test("페이드 곡선: 겹치면 같은 비율로 줄이고, 끝을 모르면(감상 모드) 페이드인만 건다", () => {
  const album = loadAlbum(), curve = (fade, start, seconds) => { const param = automation(); album.applySfxFade(param, fade, start, seconds); return param.at; };
  let at = curve({ i:1, o:2 }, 0, 10); near(at(.5), .5); near(at(5), 1); near(at(9), .5); near(at(10), 0);
  at = curve({ i:0, o:0 }, 0, 10); near(at(0), 1); near(at(10), 1);
  at = curve({ i:4, o:4 }, 0, 4); near(at(0), 0); near(at(2), 1); near(at(4), 0);
  at = curve({ i:2, o:3 }, 5, Infinity); near(at(6), .5); near(at(100), 1);
});

test("MP4 소리 굽기: 음악은 페이드→덕킹→크기, 효과음은 전체 크기와 페이드를 거친다", async () => {
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  const item = { id:"P", type:"image", stickers:[sticker("pop", "bounce", 1, { sfx:{ k:"pop", v:.5 } })], music:{ id:"m1", v:.8, fi:1, fo:2 }, sfxv:1.2, sfxf:{ i:1, o:1 }, duck:{ on:true, a:.5, r:.5 } };
  album.set("audioRecords", [{ id:"m1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]);
  album.useRecords([item]);
  const soundtrack = await album.encodeMusic(item, 6);
  assert.ok(soundtrack && soundtrack.samples.length > 0); assert.deepEqual([...soundtrack.asc], [0x11, 0x90]);
  const source = audio.nodes.find(node => node.kind === "source" && node.loop);
  const [trackLevel] = source.connections, [laps] = trackLevel.connections, [envelope] = laps.connections, [ducking] = envelope.connections, [volume] = ducking.connections;
  assert.equal(laps.gain.events.length, 0, "곡별 페이드가 없으면 곡선도 없다");
  assert.equal(trackLevel.gain.value, 1, "곡별 음량(기본 100%)");
  near(envelope.gain.at(.5), .5, "음악 페이드인"); near(envelope.gain.at(5), .5, "음악 페이드아웃");
  near(ducking.gain.at(.65), .5, "뿅 소리(0.6초부터 0.13초) 동안 음악을 줄인다"); near(ducking.gain.at(.98), .75, "복귀 0.5초의 절반"); near(ducking.gain.at(1.5), 1);
  assert.equal(volume.gain.value, .8); assert.equal(volume.connections[0].kind, "destination");
  const sfxBus = audio.nodes.find(node => node.kind === "gain" && node.gain.events.length && node !== envelope && node !== ducking && node.connections[0] && node.connections[0].kind === "destination");
  near(sfxBus.gain.at(.5), .5, "효과음 페이드인");
  audio.nodes.filter(node => node.kind === "gain" && node.connections[0] === sfxBus).forEach(out => near(out.gain.value, .5*1.2*.7));
});

test("배경음악 페이드·크로스페이드: 넘길 때만 겹침 길이를 쓰고 0초면 바로 바뀐다", async () => {
  const clock = { now:0 }, album = loadAlbum({ context:{ Audio:FakeAudioElement, performance:{ now:() => clock.now }, setInterval:() => 1, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  assert.deepEqual(plain(album.musicFades({})), { i:0, o:1.5 }); assert.deepEqual(plain(album.musicFades({ fi:3, fo:99 })), { i:3, o:10 });
  const p1 = { id:"P1", type:"image", stickers:[], music:{ id:"m1", v:1, fi:0, fo:4 } }, p2 = { id:"P2", type:"image", stickers:[], music:{ id:"m2", v:1, fi:6, fo:4 } };
  album.set("audioRecords", [{ id:"m1", type:"audio", blob:{} }, { id:"m2", type:"audio", blob:{} }]);
  const level = session => Math.round(album.musicLevel(session).level*1000)/1000;
  album.useRecords([p1, p2], "P1").set("viewing", true); album.syncMusic(); await tick(); const a1 = album.musicSession;
  clock.now = 1000; album.set("selectedId", "P2"); album.syncMusic({ switching:true }); await tick(); const a2 = album.musicSession;
  clock.now = 3000; assert.equal(level(a1), .5, "자동: 앞 음악은 자기 4초 페이드아웃"); assert.equal(level(a2), .333, "자동: 새 음악은 자기 6초 페이드인");
  album.stopMusic(); album.storage.setItem("classdock.photoAlbum.crossfade", "2");
  clock.now = 10000; album.set("selectedId", "P1"); album.syncMusic(); await tick(); const b1 = album.musicSession;
  clock.now = 11000; album.set("selectedId", "P2"); album.syncMusic({ switching:true }); await tick(); const b2 = album.musicSession;
  clock.now = 12000; assert.equal(level(b1), .5); assert.equal(level(b2), .5);
  clock.now = 20000; album.set("viewing", false); album.syncMusic(); clock.now = 22000; assert.equal(level(b2), .5, "감상 모드를 끌 땐 사진별 페이드");
  album.storage.setItem("classdock.photoAlbum.crossfade", "0");
  album.set("viewing", true); album.syncMusic(); await tick(); const c2 = album.musicSession;
  album.set("selectedId", "P1"); album.syncMusic({ switching:true }); await tick();
  assert.equal(c2.audio.paused, true, "0초면 바로 멈춘다");
  delete p1.music; assert.doesNotThrow(() => album.musicLevel(album.musicSession));
  album.stopAllMusic();
});

test("덕킹: 효과음 구간을 묶고, 감상 모드와 MP4 가 같은 곡선을 쓰며, 프리셋이 값을 맞춘다", () => {
  const album = loadAlbum();
  assert.deepEqual(plain(album.duckSettings({})), { on:false, a:.65, r:.5 });
  const item = { stickers:[sticker("boing", "bounce")], duck:{ on:true, a:.6, r:.3 } };
  assert.deepEqual(plain(album.duckBlocks(item, 0, 3, .3)).map(block => block.map(x => +x.toFixed(3))), [[.6,.98],[1.6,1.98],[2.6,2.98]]);
  assert.equal(album.duckBlocks(item, 0, 3, 1).length, 1, "되돌아오기 전에 다음 소리면 합친다");
  const duck = album.duckSettings(item), blocks = album.duckBlocks(item, 0, 3, duck.r), param = automation();
  album.applyDuck(param, blocks, duck);
  for (let t = 0; t < 3.2; t += .01) near(param.at(t), album.duckGain(blocks, t, duck), "t=" + t.toFixed(2));
  const session = { item };
  assert.equal(album.liveDuck(session).active, false);
  album.set("sfxSession", { item, origin:0, ctx:{ currentTime:.8 } }); near(album.liveDuck(session).gain, .4);
  album.set("sfxSession", { item:{}, origin:0, ctx:{ currentTime:.8 } }); assert.equal(album.liveDuck(session).active, false);
  const photo = { duck:{ on:false } };
  assert.equal(album.duckPresetOf(photo), "");
  assert.equal(album.applyDuckPreset(photo, "strong"), true);
  assert.deepEqual(plain(photo.duck), { on:true, a:.85, r:.35 }); assert.equal(album.duckPresetOf(photo), "strong");
  photo.duck.a = .7; assert.equal(album.duckPresetOf(photo), "custom");
  assert.equal(album.applyDuckPreset(photo, "nope"), false);
  album.DUCK_PRESETS.forEach(([id, , values]) => { album.applyDuckPreset(photo, id); assert.equal(album.duckPresetOf(photo), id); assert.deepEqual(plain(album.duckSettings(photo)), { on:true, ...values }); });
});

test("반복 구간: 값 규칙(0.5초 이상, 곡 길이 안, 처음부터 옵션)", () => {
  const album = loadAlbum(), loop = (music, duration) => plain(album.musicLoop(music, duration));
  assert.equal(loop({}, 60).on, false, "구간이 없으면 곡 전체 반복");
  assert.deepEqual(loop({ ls:10, le:20 }, 60), { on:true, start:10, end:20, intro:false, startAt:10 });
  assert.equal(loop({ ls:10, le:999 }, 60).end, 60, "끝은 곡 길이 안");
  assert.deepEqual([loop({ ls:10, le:10.1 }, 60).start, loop({ ls:10, le:10.1 }, 60).end], [10, 10.5], "0.5초보다 짧으면 늘린다");
  assert.equal(loop({ ls:59.9 }, 60).start, 59.5, "시작이 끝에 너무 붙으면 당긴다");
  assert.deepEqual(loop({ ls:10, le:20, li:true }, 60), { on:true, start:10, end:20, intro:true, startAt:0 });
  const unknown = album.musicLoop({ ls:5 }, NaN); assert.equal(unknown.on, true); assert.equal(unknown.end, Infinity, "길이를 모르면 끝은 곡 끝");
  assert.equal(album.clockText(75.25), "1:15.3"); assert.equal(album.clockText(Infinity), "끝");
});

test("반복 구간: MP4 는 loopStart·loopEnd 로 되풀이하고 시작점(또는 처음부터)에서 튼다", async () => {
  for (const [music, startAt] of [[{ ls:1, le:2.5 }, 1], [{ ls:1, le:2.5, li:true }, 0]]){
    const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
    const item = { id:"P", type:"image", stickers:[], music:{ id:"m1", v:1, ...music } };
    album.set("audioRecords", [{ id:"m1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]).useRecords([item]);
    await album.encodeMusic(item, 6);
    const source = audio.nodes.find(node => node.kind === "source" && node.loop);
    assert.equal(source.loopStart, 1); assert.equal(source.loopEnd, 2.5); assert.deepEqual(plain(source.startArgs), [0, startAt]);
  }
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  const item = { id:"P", type:"image", stickers:[], music:{ id:"m1", v:1 } };
  album.set("audioRecords", [{ id:"m1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]).useRecords([item]);
  await album.encodeMusic(item, 6);
  const source = audio.nodes.find(node => node.kind === "source" && node.loop);
  assert.equal(source.loopStart, undefined, "구간이 없으면 곡 전체 반복"); assert.deepEqual(plain(source.startArgs), [0, 0]);
});

test("반복 구간: 감상 모드 재생은 끝에 닿으면 시작으로 돌아가고, 구간을 끄면 곡 전체 반복으로", async () => {
  const timers = [];
  class LoopAudio extends FakeAudioElement { constructor(){ super(); this.duration = 60; this.ended = false; this.loop = false; } }
  const album = loadAlbum({ context:{ Audio:LoopAudio, setInterval:callback => { timers.push(callback); return timers.length; }, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  const item = { id:"P", type:"image", stickers:[], music:{ id:"m1", v:1, ls:10, le:20 } };
  album.set("audioRecords", [{ id:"m1", type:"audio", blob:{}, dur:60 }]).useRecords([item]);
  await album.playMusic(item); await tick();
  const session = album.musicSession, audio = session.audio;
  assert.equal(audio.currentTime, 10, "구간 시작에서 튼다"); assert.equal(audio.loop, false);
  const watch = timers[timers.length - 1];
  audio.currentTime = 15; watch(); assert.equal(audio.currentTime, 15);
  audio.currentTime = 19.99; watch(); assert.equal(audio.currentTime, 10, "끝에 닿으면 시작으로");
  delete item.music.ls; delete item.music.le; watch();
  assert.equal(audio.loop, true, "구간을 없애면 곡 전체 반복");
  album.stopAllMusic();
});

test("곡별 음량: 0~1 로 정리하고, 감상 모드에선 전체 음량에 곱하며 한 곡 MP4 에도 들어간다", async () => {
  const album = loadAlbum();
  assert.equal(album.trackVolume({}), 1); assert.equal(album.trackVolume({ tv:1.7 }), 1); assert.equal(album.trackVolume({ tv:-1 }), 0); assert.equal(album.trackVolume({ tv:.35 }), .35);
  class QuietAudio extends FakeAudioElement {}
  const live = loadAlbum({ context:{ Audio:QuietAudio, setInterval:() => 1, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  live.set("audioRecords", [{ id:"t1", type:"audio", blob:{}, dur:30 }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:.5, tracks:[{ id:"t1", tv:.4 }] } };
  live.useRecords([item]);
  await live.playMusic(item); await tick();
  live.tickMusic(live.musicSession);
  assert.ok(Math.abs(live.musicSession.audio.volume - .2) < 1e-9, "전체 50% × 곡 40%");
  live.stopAllMusic();
  const audio = fakeAudio(), mp4 = loadAlbum({ context:audio.context });
  mp4.set("audioRecords", [{ id:"t1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]);
  mp4.useRecords([item]);
  await mp4.encodeMusic(item, 4);
  const source = audio.nodes.find(node => node.kind === "source" && node.loop);
  assert.equal(source.connections[0].gain.value, .4, "한 곡도 곡별 음량을 거친다");
});

test("곡별 페이드: 값 정리와 한 조각 곡선(짧으면 비율로 줄임)", () => {
  const album = loadAlbum();
  assert.deepEqual(plain(album.trackFades({})), { i:0, o:0 }); assert.deepEqual(plain(album.trackFades({ fi:9, fo:-1 })), { i:5, o:0 });
  assert.deepEqual(plain(album.segmentFade(2, 2, 10)), { i:2, o:2 }); assert.deepEqual(plain(album.segmentFade(4, 4, 4)), { i:2, o:2 });
  const parts = album.fadeParts({ i:2, o:1 }, 1, 0, 10); assert.equal(parts.rise, .5); assert.equal(parts.fall, 1);
  assert.equal(album.fadeParts({ i:2, o:1 }, 9.5, 0, 10).fall, .5);
});

test("곡별 페이드 MP4: 여러 곡은 겹침과 곡 페이드 중 긴 쪽으로, 한 곡은 되풀이 바퀴마다", async () => {
  const records = [{ id:"t1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }, { id:"t2", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }];
  let audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  album.set("audioRecords", records);
  let item = { id:"P", type:"image", stickers:[], music:{ v:1, tx:.5, tracks:[{ id:"t1", fi:1.5 }, { id:"t2", fo:1 }] } };
  album.useRecords([item]); await album.encodeMusic(item, 8);
  const fades = audio.nodes.filter(node => node.kind === "source").map(source => source.connections[0].connections[0]);
  near(fades[0].gain.at(.75), .5, "첫 곡: 곡 페이드인 1.5초");
  near(fades[0].gain.at(3.75), .5, "첫 곡 끝: 곡 페이드아웃 없음 → 겹침 0.5초");
  near(fades[1].gain.at(3.75), .5, "둘째 곡 시작: 겹침 0.5초");
  near(fades[1].gain.at(3.5 + 4 - .5), .5, "둘째 곡 끝: 곡 페이드아웃 1초가 겹침보다 길다");
  audio = fakeAudio(); album = loadAlbum({ context:audio.context }); album.set("audioRecords", records);
  item = { id:"P", type:"image", stickers:[], music:{ v:1, tracks:[{ id:"t1", ls:1, le:3, fi:.5, fo:.5 }] } };
  album.useRecords([item]); await album.encodeMusic(item, 7);
  const laps = audio.nodes.find(node => node.kind === "source" && node.loop).connections[0].connections[0];
  for (const lapStart of [0, 2, 4]){ near(laps.gain.at(lapStart + .25), .5, "바퀴 시작 " + lapStart); near(laps.gain.at(lapStart + 1), 1); near(laps.gain.at(lapStart + 1.75), .5, "바퀴 끝 " + (lapStart + 2)); }
});

test("곡별 페이드 감상 모드: 재생 위치로 커지고 줄며, 한 곡 구간이 되돌아가면 새 바퀴로 친다", async () => {
  class PosAudio extends FakeAudioElement { constructor(){ super(); this.duration = 30; } }
  const album = loadAlbum({ context:{ Audio:PosAudio, setInterval:() => 1, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  album.set("audioRecords", [{ id:"t1", type:"audio", blob:{}, dur:30 }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:1, tracks:[{ id:"t1", ls:10, le:20, fi:2, fo:2 }] } };
  album.useRecords([item]); await album.playMusic(item); await tick();
  const session = album.musicSession, audio = session.audio, beat = () => album.tickMusic(session);
  audio.currentTime = 11; beat(); near(audio.volume, .5, "구간 시작 뒤 1초: 페이드인 절반");
  audio.currentTime = 15; beat(); near(audio.volume, 1);
  audio.currentTime = 19; beat(); near(audio.volume, .5, "구간 끝 1초 전: 페이드아웃 절반");
  audio.currentTime = 20; beat(); assert.equal(audio.currentTime, 10, "되돌아감");
  audio.currentTime = 10.5; beat(); near(audio.volume, .25, "새 바퀴도 처음부터 커진다");
  album.stopAllMusic();
});

test("곡별 반복 횟수: 1~10 으로 정리, MP4 는 그 곡 부분을 정확히 N번 틀고 다음 곡으로", async () => {
  const album0 = loadAlbum();
  assert.equal(album0.trackRepeats({}), 1); assert.equal(album0.trackRepeats({ rc:0 }), 1); assert.equal(album0.trackRepeats({ rc:99 }), 10); assert.equal(album0.trackRepeats({ rc:2.6 }), 3);
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  album.set("audioRecords", [{ id:"t1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }, { id:"t2", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:1, tx:.5, tracks:[{ id:"t1", ls:1, le:2, rc:3, fi:.4, fo:.4 }, { id:"t2" }] } };
  album.useRecords([item]); await album.encodeMusic(item, 6);
  const [first, second] = audio.nodes.filter(node => node.kind === "source");
  assert.equal(first.loop, true); assert.equal(first.loopStart, 1); assert.equal(first.loopEnd, 2);
  assert.deepEqual(plain(first.startArgs), [0, 1, 3], "구간 1초 × 3번");
  assert.deepEqual(plain(second.startArgs), [2.5, 0, 4], "마지막 반복 끝보다 겹침(0.5초)만큼 앞서 다음 곡");
  assert.equal(second.loop, false, "한 번이면 되풀이하지 않는다");
  const fade = first.connections[0].connections[0];
  near(fade.gain.at(.2), .5, "첫 반복 시작만 커지고"); near(fade.gain.at(1), 1, "반복 사이 이음새에선 그대로"); near(fade.gain.at(2), 1);
  near(fade.gain.at(2.75), .5, "마지막 반복 끝에서 줄어든다(곡 페이드 .4 와 겹침 .5 중 긴 .5)");
});

test("곡별 반복 횟수 감상 모드: 구간 끝에서 처음으로 돌아가 N번 틀고, 페이드는 바깥 끝에만, 그다음 곡으로", async () => {
  const timers = [];
  class RepeatAudio extends FakeAudioElement { constructor(){ super(); this.duration = 30; this.ended = false; } }
  const album = loadAlbum({ context:{ Audio:RepeatAudio, setInterval:callback => { timers.push(callback); return timers.length; }, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  album.set("audioRecords", [{ id:"t1", type:"audio", blob:{}, dur:30 }, { id:"t2", type:"audio", blob:{}, dur:30 }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:1, tracks:[{ id:"t1", ls:5, le:10, rc:2, fi:1, fo:1 }, { id:"t2" }] } };
  album.useRecords([item]); await album.playMusic(item); await tick();
  const session = album.musicSession, player = session.players[0], audio = player.audio, beat = () => album.tickMusic(session);
  audio.currentTime = 5.5; beat(); near(audio.volume, .5, "첫 반복은 커지며 시작");
  audio.currentTime = 9.5; beat(); near(audio.volume, 1, "첫 반복 끝에선 줄지 않는다");
  audio.currentTime = 10; beat(); assert.equal(audio.currentTime, 5, "구간 처음으로"); assert.equal(player.repeat, 1);
  audio.currentTime = 5.5; beat(); near(audio.volume, 1, "둘째 반복 시작에선 커지는 곡선 없음");
  audio.currentTime = 9.5; beat(); near(audio.volume, .5, "마지막 반복 끝에서 줄어든다");
  assert.equal(session.players.length, 1);
  audio.currentTime = 10; beat(); await tick();
  assert.equal(album.playingTrackId(item), "t2", "N번 다 틀면 다음 곡");
  album.stopAllMusic();
});

// 440Hz 사인파의 주파수(0 을 위로 지나는 횟수)와 크기(RMS).
function toneStats(data, rate, from, to){
  let crossings = 0, sum = 0;
  for (let i = from + 1; i < to; i++){ if (data[i - 1] < 0 && data[i] >= 0) crossings++; sum += data[i]*data[i]; }
  return { hz:crossings*rate/(to - from), rms:Math.sqrt(sum/(to - from)) };
}
test("곡별 속도: 시간 늘이기는 길이만 바꾸고 음 높이·크기는 지킨다", () => {
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context }), ctx = new audio.context.OfflineAudioContext();
  const rate = 48000, tone = ctx.createBuffer(2, rate*2, rate);
  for (let c = 0; c < 2; c++){ const data = tone.getChannelData(c); for (let i = 0; i < data.length; i++) data[i] = Math.sin(2*Math.PI*440*i/rate); }
  assert.equal(album.trackSpeed({}), 1); assert.equal(album.trackSpeed({ sp:9 }), 2); assert.equal(album.trackSpeed({ sp:.1 }), .5);
  assert.equal(album.timeStretch(ctx, tone, 1), tone, "1배면 그대로");
  for (const speed of [1.5, .75, 2, .5]){
    const out = album.timeStretch(ctx, tone, speed), stats = toneStats(out.getChannelData(0), rate, 4096, out.length - 4096);
    assert.equal(out.length, Math.round(tone.length/speed), speed + "배 길이");
    assert.ok(Math.abs(stats.hz - 440) < 8, speed + "배에서도 440Hz 근처: " + stats.hz.toFixed(1));
    assert.ok(Math.abs(stats.rms - Math.SQRT1_2) < .08, speed + "배 크기 유지: " + stats.rms.toFixed(3));
  }
});

test("곡별 속도: MP4 는 늘인 곡과 곡 안 시간을 맞춰 옮긴 구간을 쓰고, 감상 모드는 음 높이 유지로 빠르기만 바꾼다", async () => {
  const audio = fakeAudio(), album = loadAlbum({ context:audio.context });
  album.set("audioRecords", [{ id:"t1", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }, { id:"t2", type:"audio", blob:{ arrayBuffer:async () => new ArrayBuffer(4) } }]);
  const item = { id:"P", type:"image", stickers:[], music:{ v:1, tracks:[{ id:"t1", ls:1, le:3, sp:2 }, { id:"t2", sp:.5 }] } };
  album.useRecords([item]); await album.encodeMusic(item, 10);
  const [fast, slow] = audio.nodes.filter(node => node.kind === "source");
  assert.equal(fast.buffer.duration, 2, "4초 곡을 2배로 → 2초"); assert.deepEqual(plain(fast.startArgs), [0, .5, 1], "구간 1~3초 → 늘인 곡의 0.5~1.5초");
  assert.equal(slow.buffer.duration, 8, "0.5배 → 8초"); assert.deepEqual(plain(slow.startArgs), [1, 0, 8]);
  assert.deepEqual(plain(item.music.tracks[0]), { id:"t1", ls:1, le:3, sp:2 }, "원래 설정은 바꾸지 않는다");
  class SpeedAudio extends FakeAudioElement { constructor(){ super(); this.duration = 30; this.playbackRate = 1; } }
  const live = loadAlbum({ context:{ Audio:SpeedAudio, setInterval:() => 1, clearInterval(){}, URL:{ createObjectURL:() => "blob:x", revokeObjectURL(){} } } });
  live.set("audioRecords", [{ id:"t1", type:"audio", blob:{}, dur:30 }, { id:"t2", type:"audio", blob:{}, dur:30 }]);
  const liveItem = { id:"L", type:"image", stickers:[], music:{ v:1, tx:1, tracks:[{ id:"t1", ls:0, le:20, sp:2, fi:1 }, { id:"t2" }] } };
  live.useRecords([liveItem]); await live.playMusic(liveItem); await tick();
  const player = live.musicSession.players[0], beat = () => live.tickMusic(live.musicSession);
  assert.equal(player.audio.preservesPitch, true); assert.equal(player.audio.playbackRate, 2);
  player.audio.currentTime = 1; beat(); near(player.audio.volume, .5, "곡 페이드인 1초(들리는 시간) = 곡 안 2초의 절반");
  player.audio.currentTime = 17.9; beat(); assert.equal(live.musicSession.players.length, 1, "겹침 1초(들리는 시간) = 곡 안 2초 전까지는 그대로");
  player.audio.currentTime = 18; beat(); await tick(); assert.equal(live.playingTrackId(liveItem), "t2");
  liveItem.music.tracks[1].sp = 1.5; beat(); assert.equal(live.musicSession.players[1].audio.playbackRate, 1.5, "재생 중 바꾼 속도도 바로");
  live.stopAllMusic();
});

test("MP3 를 사진첩에 끌어 놓거나 가져오기로 넣으면 고른 사진의 배경음악 재생목록에 들어간다", async () => {
  const album = loadAlbum();
  const kind = (name, type = "") => album.droppedMediaType({ name, type });
  assert.equal(kind("song.mp3", "audio/mpeg"), "audio"); assert.equal(kind("SONG.MP3"), "audio", "종류 없이 확장자만(대문자)");
  assert.equal(kind("voice.webm", "audio/webm"), "audio", "음악 webm"); assert.equal(kind("clip.webm", "video/webm"), "video");
  assert.equal(kind("rain.ogg"), "audio"); assert.equal(kind("photo.JPG"), "image"); assert.equal(kind("notes.txt", "text/plain"), null);
  const photo = { id:"P", type:"image", stickers:[] };
  album.useRecords([photo], "P");
  await album.importFiles([{ name:"a.mp3", type:"audio/mpeg", size:1000 }, { name:"B.MP3", type:"", size:1000 }]);
  assert.deepEqual(plain(album.musicTracks(photo.music).map(track => track.name)), ["a.mp3", "B.MP3"]);
  assert.equal(album.records.length, 1, "음악은 사진첩 사진으로 들어가지 않는다");
  const empty = loadAlbum(); empty.useRecords([], null);
  await empty.importFiles([{ name:"a.mp3", type:"audio/mpeg", size:1000 }]);
  assert.equal(empty.audioRecords.length, 0, "고른 사진이 없으면 넣지 않고 알린다");
});
