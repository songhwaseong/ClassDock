"use strict";

/* ===== .msheet 악보 — 소리 엔진 (P0) =====
   실제 피아노·나일론 기타 샘플 + 오실레이터 신디사이저 + 예약 재생 + WAV 저장.

   설계의 핵심 두 가지(docs/악보-설계.md §5):
   1) setTimeout 으로 음을 울리지 않는다. AudioContext.currentTime 기준으로 25ms마다 200ms 앞을
      "예약"한다. 파이썬 실행 등으로 메인 스레드가 잠깐 밀려도 이미 예약된 소리는 정확히 난다.
   2) 실시간 재생과 WAV 저장이 같은 예약 함수(scheduleInto)를 쓴다.
      들은 것과 다른 파일이 저장되는 사고가 구조적으로 막힌다.

   재생 중 음표 강조는 오디오가 아니라 requestAnimationFrame 에서 한다(오디오 쪽에서 DOM 을 만지지 않는다). */

const MNMusicAudio = (() => {
  // 소리 결. attack 을 0 이 아닌 값으로 두는 이유: 0에서 시작하지 않으면 딸깍 잡음이 난다.
  const ADSR = { attack:0.012, decay:0.06, sustain:0.7, release:0.09 };
  // 파형마다 체감 크기가 달라 맞춰 준다(square 는 그냥 두면 훨씬 크다).
  const TIMBRE_GAIN = { sine:0.9, triangle:0.9, square:0.4 };
  const MASTER_GAIN = 0.35;          // 단선율이라 이 정도면 충분하고 클리핑도 피한다
  const PIANO_GAIN = 0.82;
  const PIANO_ATTACK = 0.004;
  const PIANO_RELEASE = 0.32;
  const GUITAR_GAIN = 0.9;
  const GUITAR_ATTACK = 0.003;
  const GUITAR_RELEASE = 0.18;
  // 앱의 G3~C6 음역을 단3도 간격 실제 녹음으로 덮는다. 사이는 재생 속도로 최대 2반음만 옮긴다.
  const PIANO_SAMPLE_ROOTS = Object.freeze([
    { midi:56, file:"Gs3.mp3" }, { midi:60, file:"C4.mp3" },
    { midi:63, file:"Ds4.mp3" }, { midi:66, file:"Fs4.mp3" },
    { midi:69, file:"A4.mp3" },  { midi:72, file:"C5.mp3" },
    { midi:75, file:"Ds5.mp3" }, { midi:78, file:"Fs5.mp3" },
    { midi:81, file:"A5.mp3" },  { midi:84, file:"C6.mp3" }
  ]);
  // 나일론 기타도 같은 음역을 10개 실제 녹음으로 덮는다. 가장 먼 음도 2반음만 옮긴다.
  const GUITAR_SAMPLE_ROOTS = Object.freeze([
    { midi:55, file:"G3.mp3" },  { midi:57, file:"A3.mp3" },
    { midi:61, file:"Cs4.mp3" }, { midi:64, file:"E4.mp3" },
    { midi:68, file:"Gs4.mp3" }, { midi:71, file:"B4.mp3" },
    { midi:74, file:"D5.mp3" },  { midi:78, file:"Fs5.mp3" },
    { midi:80, file:"Gs5.mp3" }, { midi:82, file:"As5.mp3" }
  ]);
  const SAMPLE_INSTRUMENTS = Object.freeze({
    piano:{
      label:"피아노", roots:PIANO_SAMPLE_ROOTS, path:"src/assets/piano/",
      registryId:"mnMusicSamples", gain:PIANO_GAIN, attack:PIANO_ATTACK, release:PIANO_RELEASE
    },
    guitar:{
      label:"기타", roots:GUITAR_SAMPLE_ROOTS, path:"src/assets/guitar-nylon/",
      registryId:"mnGuitarSamples", gain:GUITAR_GAIN, attack:GUITAR_ATTACK, release:GUITAR_RELEASE
    }
  });
  const RENDER_SAMPLE_RATE = 44100;
  const LOOKAHEAD_SEC = 0.2;         // 얼마나 앞을 미리 예약할지
  const TIMER_MS = 25;               // 예약 타이머 주기
  const START_DELAY = 0.08;          // 첫 음까지의 여유(예약이 늦어 첫 음이 잘리는 것 방지)
  const TAIL_SEC = Math.max(ADSR.release, PIANO_RELEASE, GUITAR_RELEASE) + 0.4; // 마지막 음의 여운까지 담을 꼬리
  const PREVIEW_SEC = 0.45;          // 음표 하나 눌렀을 때 들려줄 길이
  const MIN_NOTE_SEC = 0.03;

  let ctx = null;          // 실시간 컨텍스트(첫 소리 요청 때 만든다)
  let master = null;
  let live = null;         // 재생 중 상태
  let playRequest = 0;     // 샘플 로딩 중 정지를 눌렀을 때 뒤늦게 재생되지 않게 한다
  let previewRequest = 0;
  const sampleBufferPromises = { piano:null, guitar:null };
  const sampleRegistryCaches = { piano:null, guitar:null };

  function contextClass(){
    if (typeof AudioContext !== "undefined") return AudioContext;
    if (typeof webkitAudioContext !== "undefined") return webkitAudioContext;
    return null;
  }

  function offlineContextClass(){
    if (typeof OfflineAudioContext !== "undefined") return OfflineAudioContext;
    if (typeof webkitOfflineAudioContext !== "undefined") return webkitOfflineAudioContext;
    return null;
  }

  function supported(){
    return !!contextClass();
  }

  // 문서를 여는 것만으로는 만들지 않는다. 브라우저 자동재생 정책 때문에
  // 반드시 사용자 제스처(클릭) 안에서 불려야 소리가 난다.
  function ensureContext(){
    const Ctor = contextClass();
    if (!Ctor) return null;
    if (!ctx){
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended" && typeof ctx.resume === "function"){
      try { ctx.resume(); } catch(_){}
    }
    return ctx;
  }

  function timbreOf(name){
    return SAMPLE_INSTRUMENTS[name] || TIMBRE_GAIN[name] ? name : "piano";
  }

  function sampleRegistry(timbre){
    const spec = SAMPLE_INSTRUMENTS[timbre];
    if (!spec) return {};
    if (sampleRegistryCaches[timbre]) return sampleRegistryCaches[timbre];
    sampleRegistryCaches[timbre] = {};
    if (typeof document === "undefined") return sampleRegistryCaches[timbre];
    const node = document.getElementById(spec.registryId);
    if (!node) return sampleRegistryCaches[timbre];
    try { sampleRegistryCaches[timbre] = JSON.parse(node.textContent || "{}"); }
    catch(error){ console.warn(`내장 ${spec.label} 음원 목록을 읽지 못했습니다:`, error); }
    return sampleRegistryCaches[timbre];
  }

  function sampleUrl(timbre, file){
    const spec = SAMPLE_INSTRUMENTS[timbre];
    const embedded = sampleRegistry(timbre)[file];
    return embedded || (spec ? spec.path : "") + file;
  }

  async function ensureSampleBuffers(target, timbre){
    const spec = SAMPLE_INSTRUMENTS[timbre];
    if (!spec) throw new Error("지원하지 않는 샘플 음색입니다.");
    if (sampleBufferPromises[timbre]) return sampleBufferPromises[timbre];
    if (!target || typeof target.decodeAudioData !== "function" || typeof fetch !== "function"){
      throw new Error(`${spec.label} 음원을 읽을 수 없는 환경입니다.`);
    }
    sampleBufferPromises[timbre] = Promise.all(spec.roots.map(async (root) => {
      const response = await fetch(sampleUrl(timbre, root.file));
      if (!response.ok) throw new Error(`${spec.label} 음원 ${root.file}을 읽지 못했습니다.`);
      const bytes = await response.arrayBuffer();
      const buffer = await target.decodeAudioData(bytes.slice(0));
      return { midi:root.midi, file:root.file, buffer };
    })).then((buffers) => {
      // 단일 HTML의 base64 문자열은 디코딩 뒤 놓아 메모리를 이중으로 오래 잡지 않는다.
      if (typeof document !== "undefined"){
        const node = document.getElementById(spec.registryId);
        if (node) node.textContent = "{}";
      }
      sampleRegistryCaches[timbre] = {};
      return buffers;
    }).catch((error) => {
      sampleBufferPromises[timbre] = null;    // 일시 실패면 다음 재생에서 다시 시도할 수 있다
      throw error;
    });
    return sampleBufferPromises[timbre];
  }

  const ensurePianoBuffers = (target) => ensureSampleBuffers(target, "piano");
  const ensureGuitarBuffers = (target) => ensureSampleBuffers(target, "guitar");

  /* 음 하나를 예약한다. start·duration 은 그 컨텍스트의 시간(초).
     짧은 음(빠른 16분음표)에서도 엔벨로프가 음 길이를 넘지 않도록 각 구간을 끝 시각으로 자른다. */
  function scheduleNote(target, destination, frequency, start, duration, timbre){
    const requested = timbreOf(timbre);
    const type = SAMPLE_INSTRUMENTS[requested] ? "triangle" : requested;
    const peak = TIMBRE_GAIN[type];
    const end = start + Math.max(MIN_NOTE_SEC, duration);
    const attackEnd = Math.min(start + ADSR.attack, end);
    const decayEnd = Math.min(attackEnd + ADSR.decay, end);
    const stopAt = end + ADSR.release;

    const osc = target.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);

    const gain = target.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.linearRampToValueAtTime(peak * ADSR.sustain, decayEnd);
    gain.gain.setValueAtTime(peak * ADSR.sustain, end);
    gain.gain.linearRampToValueAtTime(0, stopAt);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(stopAt + 0.01);
    return { source:osc, osc, gain, stopAt };
  }

  function nearestSample(midi, buffers){
    let best = null;
    for (const sample of (buffers || [])){
      if (!sample || !sample.buffer || !Number.isFinite(sample.midi)) continue;
      if (!best || Math.abs(sample.midi - midi) < Math.abs(best.midi - midi)) best = sample;
    }
    return best;
  }

  function scheduleSampleNote(target, destination, midi, start, duration, buffers, timbre){
    const spec = SAMPLE_INSTRUMENTS[timbre] || SAMPLE_INSTRUMENTS.piano;
    const sample = nearestSample(midi, buffers);
    if (!sample) return null;
    const end = start + Math.max(MIN_NOTE_SEC, duration);
    const attackEnd = Math.min(start + spec.attack, end);
    const stopAt = end + spec.release;
    const source = target.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.setValueAtTime(Math.pow(2, (midi - sample.midi) / 12), start);

    const gain = target.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(spec.gain, attackEnd);
    gain.gain.setValueAtTime(spec.gain, end);
    gain.gain.linearRampToValueAtTime(0, stopAt);

    source.connect(gain);
    gain.connect(destination);
    source.start(start);
    source.stop(stopAt + 0.02);
    return { source, gain, stopAt, sampleMidi:sample.midi };
  }

  const nearestPianoSample = nearestSample; // 기존 테스트·진단 API 호환
  const schedulePianoNote = (target, destination, midi, start, duration, buffers) =>
    scheduleSampleNote(target, destination, midi, start, duration, buffers, "piano");

  /* 실시간·오프라인 공용 예약. events 는 musicTimeline 이 만든 목록,
     offset 은 "타임라인 0초"가 그 컨텍스트의 몇 초에 해당하는지. */
  function scheduleInto(target, destination, events, offset, timbre, sampleBuffers){
    const nodes = [];
    const type = timbreOf(timbre);
    for (const event of (events || [])){
      if (!event || event.rest || !(event.frequency > 0)) continue;   // 쉼표는 시간만 흐른다
      const node = SAMPLE_INSTRUMENTS[type] && sampleBuffers
        ? scheduleSampleNote(target, destination, event.midi, offset + event.start, event.duration, sampleBuffers, type)
        : scheduleNote(target, destination, event.frequency, offset + event.start, event.duration,
            SAMPLE_INSTRUMENTS[type] ? "triangle" : type);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  function releaseNodes(nodes, at){
    for (const node of (nodes || [])){
      try {
        node.gain.gain.cancelScheduledValues(at);
        node.gain.gain.setValueAtTime(node.gain.gain.value, at);
        node.gain.gain.linearRampToValueAtTime(0, at + 0.03);   // 뚝 끊으면 잡음이 나므로 짧게 내린다
        const source = node.source || node.osc;
        if (source) source.stop(at + 0.04);
      } catch(_){}
    }
  }

  function clearTimers(state){
    if (!state) return;
    if (state.timer){ clearInterval(state.timer); state.timer = 0; }
    if (state.raf && typeof cancelAnimationFrame === "function"){ cancelAnimationFrame(state.raf); state.raf = 0; }
  }

  function finish(completed){
    if (!live) return;
    const state = live;
    live = null;
    clearTimers(state);
    if (!completed && ctx) releaseNodes(state.nodes, ctx.currentTime);
    if (typeof state.onNote === "function" && state.currentId !== null) state.onNote(null);
    if (typeof state.onEnd === "function") state.onEnd(!!completed);
  }

  /* 재생. from·to 는 1부터 세는 마디 번호(생략하면 전체) — 부분 재생이 여기로 들어온다.
     onNote(event|null) 은 지금 울리는 음표가 바뀔 때마다 불린다(강조용). */
  async function play(sheet, opts){
    const options = opts || {};
    const target = ensureContext();
    if (!target) return null;
    stop();
    const request = ++playRequest;

    const timeline = musicTimeline(sheet, { from:options.from, to:options.to });
    if (!timeline.events.length) return null;
    let timbre = timbreOf(options.timbre || (sheet && sheet.timbre));
    let sampleBuffers = null;
    if (SAMPLE_INSTRUMENTS[timbre]){
      const failedTimbre = timbre;
      try { sampleBuffers = await ensureSampleBuffers(target, timbre); }
      catch(error){
        timbre = "triangle";
        if (typeof options.onError === "function") options.onError(error, failedTimbre);
      }
    }
    if (request !== playRequest) return null;

    const state = {
      timeline, timbre, sampleBuffers,
      startAt:target.currentTime + START_DELAY,
      nodes:[], next:0, timer:0, raf:0, currentId:null,
      onNote:options.onNote, onEnd:options.onEnd
    };
    live = state;

    // 예약: 지금부터 LOOKAHEAD 안에 시작할 음들만 그때그때 예약한다.
    const pump = () => {
      if (live !== state) return;
      const horizon = target.currentTime - state.startAt + LOOKAHEAD_SEC;
      while (state.next < timeline.events.length && timeline.events[state.next].start <= horizon){
        const event = timeline.events[state.next++];
        if (!event.rest && event.frequency > 0){
          state.nodes.push(...scheduleInto(target, master, [event], state.startAt,
            state.timbre, state.sampleBuffers));
        }
      }
    };
    pump();
    state.timer = setInterval(pump, TIMER_MS);

    // 강조: 오디오 시계를 보고 화면만 갱신한다.
    const follow = () => {
      if (live !== state) return;
      const elapsed = target.currentTime - state.startAt;
      if (elapsed >= timeline.totalSeconds){ finish(true); return; }
      if (typeof state.onNote === "function"){
        let current = null;
        for (const event of timeline.events){
          if (event.start > elapsed) break;
          if (elapsed < event.start + event.duration) current = event;
        }
        const id = current ? current.id : null;
        if (id !== state.currentId){ state.currentId = id; state.onNote(current); }
      }
      if (typeof requestAnimationFrame === "function") state.raf = requestAnimationFrame(follow);
      else state.raf = 0;
    };
    if (typeof requestAnimationFrame === "function") state.raf = requestAnimationFrame(follow);

    return { totalSeconds:timeline.totalSeconds, stop };
  }

  function stop(){
    playRequest++;
    finish(false);
  }

  function playing(){
    return !!live;
  }

  // 음표 하나 미리듣기 — 도구상자·음표 클릭에서 쓴다.
  function previewNote(note, timbre){
    const target = ensureContext();
    if (!target) return false;
    const frequency = musicNoteFrequency(note);
    if (!(frequency > 0)) return false;   // 쉼표는 소리내지 않는다
    const request = ++previewRequest;
    const type = timbreOf(timbre);
    if (SAMPLE_INSTRUMENTS[type]){
      const midi = musicMidiNumber(note);
      ensureSampleBuffers(target, type).then((buffers) => {
        if (request !== previewRequest) return;
        scheduleSampleNote(target, master, midi, target.currentTime + 0.005, PREVIEW_SEC, buffers, type);
      }).catch((error) => {
        if (request !== previewRequest) return;
        console.warn(`${SAMPLE_INSTRUMENTS[type].label} 음원을 읽지 못해 삼각파로 미리듣습니다:`, error);
        scheduleNote(target, master, frequency, target.currentTime + 0.005, PREVIEW_SEC, "triangle");
      });
    } else {
      scheduleNote(target, master, frequency, target.currentTime + 0.005, PREVIEW_SEC, type);
    }
    return true;
  }

  /* WAV 저장 — 재생과 같은 scheduleInto 를 오프라인 컨텍스트에 태운다.
     실시간을 기다리지 않아 3분 곡도 1초 안에 끝난다. */
  async function renderWav(sheet, opts){
    const options = opts || {};
    const Ctor = offlineContextClass();
    if (!Ctor) throw new Error("이 브라우저는 오디오 파일 저장을 지원하지 않습니다.");
    const timeline = musicTimeline(sheet, { from:options.from, to:options.to });
    if (!timeline.events.length) throw new Error("저장할 음표가 없습니다.");

    const frames = Math.max(1, Math.ceil((timeline.totalSeconds + TAIL_SEC) * RENDER_SAMPLE_RATE));
    const target = new Ctor(1, frames, RENDER_SAMPLE_RATE);
    const bus = target.createGain();
    bus.gain.value = MASTER_GAIN;
    bus.connect(target.destination);
    let timbre = timbreOf(options.timbre || (sheet && sheet.timbre));
    let sampleBuffers = null;
    if (SAMPLE_INSTRUMENTS[timbre]){
      const failedTimbre = timbre;
      try { sampleBuffers = await ensureSampleBuffers(ensureContext() || target, timbre); }
      catch(error){
        timbre = "triangle";
        if (typeof options.onError === "function") options.onError(error, failedTimbre);
      }
    }
    scheduleInto(target, bus, timeline.events, 0, timbre, sampleBuffers);

    const buffer = await target.startRendering();
    const wav = encodeWav([buffer.getChannelData(0)], buffer.sampleRate);
    return new Blob([wav], { type:"audio/wav" });
  }

  /* 16bit PCM WAV 인코더 — 헤더 44바이트(RIFF/fmt /data). 외부 라이브러리 없이 충분하다. */
  function encodeWav(channels, sampleRate){
    const list = (channels || []).filter(Boolean);
    const numChannels = Math.max(1, list.length);
    const frames = list.length ? list[0].length : 0;
    const rate = Math.round(Number(sampleRate) || RENDER_SAMPLE_RATE);
    const blockAlign = numChannels * 2;
    const dataBytes = frames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    const putAscii = (offset, text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    putAscii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    putAscii(8, "WAVE");
    putAscii(12, "fmt ");
    view.setUint32(16, 16, true);            // fmt 청크 길이
    view.setUint16(20, 1, true);             // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);            // 비트 수
    putAscii(36, "data");
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let frame = 0; frame < frames; frame++){
      for (let channel = 0; channel < numChannels; channel++){
        const source = list[channel] || list[0];
        let sample = source ? source[frame] : 0;
        if (!(sample >= -1)) sample = sample > 1 ? 1 : -1;   // NaN 도 여기서 걸러진다
        else if (sample > 1) sample = 1;
        view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
        offset += 2;
      }
    }
    return buffer;
  }

  return {
    play, stop, playing, supported, previewNote, renderWav, encodeWav, scheduleInto,
    ensurePianoBuffers, ensureGuitarBuffers, nearestPianoSample, nearestSample,
    PIANO_SAMPLE_ROOTS, GUITAR_SAMPLE_ROOTS, ADSR, MASTER_GAIN, PIANO_RELEASE, GUITAR_RELEASE
  };
})();
