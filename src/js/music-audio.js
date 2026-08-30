"use strict";

/* ===== .msheet 악보 — 소리 엔진 (P0) =====
   실제 악기 샘플 + 오실레이터 신디사이저 + 예약 재생 + WAV 저장.

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
  const SYNTH_GAIN = 0.58;
  const MASTER_GAIN = 0.35;          // 단선율이라 이 정도면 충분하고 클리핑도 피한다
  const PIANO_GAIN = 0.82;
  const PIANO_ATTACK = 0.004;
  const PIANO_RELEASE = 0.32;
  const GUITAR_GAIN = 0.9;
  const GUITAR_ATTACK = 0.003;
  const GUITAR_RELEASE = 0.18;
  const XYLOPHONE_SAMPLE_ROOTS = Object.freeze([
    { midi:67, file:"G4.mp3" }, { midi:72, file:"C5.mp3" },
    { midi:79, file:"G5.mp3" }, { midi:84, file:"C6.mp3" }
  ]);
  const HARP_SAMPLE_ROOTS = Object.freeze([
    { midi:55, file:"G3.mp3" }, { midi:59, file:"B3.mp3" },
    { midi:62, file:"D4.mp3" }, { midi:65, file:"F4.mp3" },
    { midi:69, file:"A4.mp3" }, { midi:72, file:"C5.mp3" },
    { midi:76, file:"E5.mp3" }, { midi:79, file:"G5.mp3" },
    { midi:83, file:"B5.mp3" }, { midi:86, file:"D6.mp3" }
  ]);
  const FLUTE_SAMPLE_ROOTS = Object.freeze([
    { midi:60, file:"C4.mp3" }, { midi:64, file:"E4.mp3" },
    { midi:69, file:"A4.mp3" }, { midi:72, file:"C5.mp3" },
    { midi:76, file:"E5.mp3" }, { midi:81, file:"A5.mp3" },
    { midi:84, file:"C6.mp3" }
  ]);
  const CLARINET_SAMPLE_ROOTS = Object.freeze([
    { midi:58, file:"As3.mp3" }, { midi:62, file:"D4.mp3" },
    { midi:65, file:"F4.mp3" },  { midi:70, file:"As4.mp3" },
    { midi:74, file:"D5.mp3" },  { midi:77, file:"F5.mp3" },
    { midi:82, file:"As5.mp3" }, { midi:86, file:"D6.mp3" }
  ]);
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
    },
    xylophone:{
      label:"실로폰", roots:XYLOPHONE_SAMPLE_ROOTS, path:"src/assets/xylophone/",
      registryId:"mnXylophoneSamples", gain:0.72, attack:0.002, release:0.16
    },
    harp:{
      label:"하프", roots:HARP_SAMPLE_ROOTS, path:"src/assets/harp/",
      registryId:"mnHarpSamples", gain:0.78, attack:0.003, release:0.3
    },
    flute:{
      label:"플루트", roots:FLUTE_SAMPLE_ROOTS, path:"src/assets/flute/",
      registryId:"mnFluteSamples", gain:0.72, attack:0.025, release:0.16,
      sustainLoop:{ start:0.7, endPadding:0.4 }
    },
    clarinet:{
      label:"클라리넷", roots:CLARINET_SAMPLE_ROOTS, path:"src/assets/clarinet/",
      registryId:"mnClarinetSamples", gain:0.68, attack:0.022, release:0.18,
      sustainLoop:{ start:0.7, endPadding:0.4 }
    }
  });
  const RENDER_SAMPLE_RATE = 44100;
  const LOOKAHEAD_SEC = 0.2;         // 얼마나 앞을 미리 예약할지
  const TIMER_MS = 25;               // 예약 타이머 주기
  const START_DELAY = 0.08;          // 첫 음까지의 여유(예약이 늦어 첫 음이 잘리는 것 방지)
  const TAIL_SEC = Math.max(ADSR.release,
    ...Object.values(SAMPLE_INSTRUMENTS).map((spec) => spec.release)) + 0.4; // 마지막 음의 여운까지 담을 꼬리
  const PREVIEW_SEC = 0.45;          // 음표 하나 눌렀을 때 들려줄 길이
  const MIN_NOTE_SEC = 0.03;

  let ctx = null;          // 실시간 컨텍스트(첫 소리 요청 때 만든다)
  let master = null;
  let outputVolume = 1;
  let outputMuted = false;
  let live = null;         // 재생 중 상태
  let playRequest = 0;     // 샘플 로딩 중 정지를 눌렀을 때 뒤늦게 재생되지 않게 한다
  let previewRequest = 0;
  let previewNodes = [];   // 음표 미리듣기·음감 테스트에서 지금 울리는 노드
  const sampleBufferPromises = Object.fromEntries(Object.keys(SAMPLE_INSTRUMENTS).map((name) => [name, null]));
  const sampleRegistryCaches = Object.fromEntries(Object.keys(SAMPLE_INSTRUMENTS).map((name) => [name, null]));
  const synthImpulseBuffers = new WeakMap();

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

  function applyMasterVolume(){
    if (master) master.gain.value = MASTER_GAIN * (outputMuted ? 0 : outputVolume);
  }

  function setVolume(value){
    outputVolume = Math.max(0, Math.min(1, Number(value) || 0));
    applyMasterVolume();
    return outputVolume;
  }

  function getVolume(){ return outputVolume; }
  function setMuted(muted){ outputMuted = !!muted; applyMasterVolume(); return outputMuted; }
  function muted(){ return outputMuted; }

  // 문서를 여는 것만으로는 만들지 않는다. 브라우저 자동재생 정책 때문에
  // 반드시 사용자 제스처(클릭) 안에서 불려야 소리가 난다.
  function ensureContext(){
    const Ctor = contextClass();
    if (!Ctor) return null;
    if (!ctx){
      ctx = new Ctor();
      master = ctx.createGain();
      applyMasterVolume();
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended" && typeof ctx.resume === "function"){
      try { ctx.resume(); } catch(_){}
    }
    return ctx;
  }

  function timbreOf(name){
    return name === "synth" || SAMPLE_INSTRUMENTS[name] || TIMBRE_GAIN[name] ? name : "piano";
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
  const sampledTimbre = (name) => !!SAMPLE_INSTRUMENTS[name];

  /* 음 하나를 예약한다. start·duration 은 그 컨텍스트의 시간(초).
     짧은 음(빠른 16분음표)에서도 엔벨로프가 음 길이를 넘지 않도록 각 구간을 끝 시각으로 자른다. */
  function scheduleNote(target, destination, frequency, start, duration, timbre, level){
    const requested = timbreOf(timbre);
    const type = SAMPLE_INSTRUMENTS[requested] ? "triangle" : requested;
    const peak = TIMBRE_GAIN[type] * Math.max(0.1, Math.min(1.3, Number(level) || 1));
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

  function synthImpulse(target){
    if (!target || typeof target.createBuffer !== "function") return null;
    if (synthImpulseBuffers.has(target)) return synthImpulseBuffers.get(target);
    const sampleRate = Math.max(8000, Number(target.sampleRate) || RENDER_SAMPLE_RATE);
    const length = Math.max(1, Math.round(sampleRate * 0.9));
    const buffer = target.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x12345678;
    for (let index = 0; index < length; index++){
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      data[index] = noise * Math.pow(1 - index / length, 2.4);
    }
    synthImpulseBuffers.set(target, buffer);
    return buffer;
  }

  function scheduleSynthNote(target, destination, frequency, start, duration, rawSettings, level){
    const settings = typeof musicSynthSettings === "function" ? musicSynthSettings(rawSettings) : {
      waveform:"sawtooth", attack:0.02, decay:0.12, sustain:0.72, release:0.18,
      cutoff:4200, resonance:5, chorus:0.18, delay:0.12, reverb:0.12
    };
    const end = start + Math.max(MIN_NOTE_SEC, duration);
    const attackEnd = Math.min(start + settings.attack, end);
    const decayEnd = Math.min(attackEnd + settings.decay, end);
    const releaseEnd = end + settings.release;
    const peak = SYNTH_GAIN * Math.max(0.1, Math.min(1.3, Number(level) || 1));

    const osc = target.createOscillator();
    osc.type = settings.waveform;
    osc.frequency.setValueAtTime(frequency, start);
    const gain = target.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.linearRampToValueAtTime(peak * settings.sustain, decayEnd);
    gain.gain.setValueAtTime(peak * settings.sustain, end);
    gain.gain.linearRampToValueAtTime(0, releaseEnd);
    osc.connect(gain);

    let voiceOut = gain;
    let filter = null;
    if (typeof target.createBiquadFilter === "function"){
      filter = target.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(settings.cutoff, start);
      filter.Q.setValueAtTime(settings.resonance, start);
      gain.connect(filter);
      voiceOut = filter;
    }
    voiceOut.connect(destination);

    let lfo = null;
    if (settings.chorus > 0 && typeof target.createDelay === "function"){
      const chorusDelay = target.createDelay(0.05);
      chorusDelay.delayTime.setValueAtTime(0.018, start);
      const chorusGain = target.createGain();
      chorusGain.gain.value = settings.chorus * 0.42;
      voiceOut.connect(chorusDelay);
      chorusDelay.connect(chorusGain);
      chorusGain.connect(destination);
      lfo = target.createOscillator();
      const lfoDepth = target.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.8, start);
      lfoDepth.gain.value = 0.0035 * settings.chorus;
      lfo.connect(lfoDepth);
      lfoDepth.connect(chorusDelay.delayTime);
      lfo.start(start);
    }
    if (settings.delay > 0 && typeof target.createDelay === "function"){
      const echo = target.createDelay(0.5);
      echo.delayTime.setValueAtTime(0.24, start);
      const echoGain = target.createGain();
      echoGain.gain.value = settings.delay * 0.48;
      voiceOut.connect(echo);
      echo.connect(echoGain);
      echoGain.connect(destination);
    }
    if (settings.reverb > 0 && typeof target.createConvolver === "function"){
      const impulse = synthImpulse(target);
      if (impulse){
        const convolver = target.createConvolver();
        const reverbGain = target.createGain();
        convolver.buffer = impulse;
        reverbGain.gain.value = settings.reverb * 0.55;
        voiceOut.connect(convolver);
        convolver.connect(reverbGain);
        reverbGain.connect(destination);
      }
    }

    const stopAt = releaseEnd + Math.max(settings.delay > 0 ? 0.24 : 0, settings.reverb * 0.9);
    osc.start(start);
    osc.stop(releaseEnd + 0.01);
    if (lfo){ lfo.stop(stopAt + 0.01); }
    return { source:osc, osc, gain, filter, lfo, synth:settings, stopAt };
  }

  function scheduleMetronomeClick(target, destination, start, accented){
    const osc = target.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(accented ? 1500 : 1050, start);
    const gain = target.createGain();
    const peak = accented ? 0.34 : 0.22;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.002);
    gain.gain.linearRampToValueAtTime(0, start + 0.045);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + 0.05);
    return { source:osc, osc, gain, stopAt:start + 0.05 };
  }

  function scheduleDrumOscillator(target, destination, start, spec, level, kind){
    const duration = Math.max(0.02, Number(spec.duration) || 0.08);
    const stopAt = start + duration;
    const osc = target.createOscillator();
    osc.type = spec.type || "sine";
    osc.frequency.setValueAtTime(spec.frequency, start);
    if (spec.endFrequency > 0){
      if (typeof osc.frequency.exponentialRampToValueAtTime === "function"){
        osc.frequency.exponentialRampToValueAtTime(spec.endFrequency, stopAt);
      } else {
        osc.frequency.setValueAtTime(spec.endFrequency, stopAt);
      }
    }
    const gain = target.createGain();
    const peak = (Number(spec.peak) || 0.2) * Math.max(0, Math.min(1.3, Number(level) || 0));
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.004, duration / 4));
    gain.gain.linearRampToValueAtTime(0, stopAt);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(stopAt + 0.01);
    return { source:osc, osc, gain, stopAt, drumKind:kind };
  }

  /* 드럼 스타일은 별도 음원 파일 없이 Web Audio 로 만든다. 오프라인 HTML·EXE 용량을 늘리지 않고
     같은 함수가 실시간 재생과 WAV 저장 양쪽에서 똑같이 울린다. */
  function scheduleDrumHit(target, destination, start, kind, level){
    const gain = Math.max(0, Math.min(1.3, Number(level) || 0));
    if (!(gain > 0)) return [];
    if (kind === "kick"){
      return [scheduleDrumOscillator(target, destination, start,
        { type:"sine", frequency:145, endFrequency:48, duration:0.18, peak:0.95 }, gain, kind)];
    }
    if (kind === "snare"){
      return [
        scheduleDrumOscillator(target, destination, start,
          { type:"triangle", frequency:185, endFrequency:118, duration:0.12, peak:0.42 }, gain, kind),
        scheduleDrumOscillator(target, destination, start,
          { type:"square", frequency:1280, endFrequency:720, duration:0.075, peak:0.18 }, gain, kind)
      ];
    }
    return [scheduleDrumOscillator(target, destination, start,
      { type:"square", frequency:6200, endFrequency:4100, duration:0.038, peak:0.12 }, gain, "hihat")];
  }

  function scheduleDrumsInto(target, destination, events, offset){
    const nodes = [];
    for (const event of (events || [])){
      if (!event || !event.kind) continue;
      nodes.push(...scheduleDrumHit(target, destination, offset + event.start, event.kind, event.gain));
    }
    return nodes;
  }

  function nearestSample(midi, buffers){
    let best = null;
    for (const sample of (buffers || [])){
      if (!sample || !sample.buffer || !Number.isFinite(sample.midi)) continue;
      if (!best || Math.abs(sample.midi - midi) < Math.abs(best.midi - midi)) best = sample;
    }
    return best;
  }

  function scheduleSampleNote(target, destination, midi, start, duration, buffers, timbre, level){
    const spec = SAMPLE_INSTRUMENTS[timbre] || SAMPLE_INSTRUMENTS.piano;
    const sample = nearestSample(midi, buffers);
    if (!sample) return null;
    const end = start + Math.max(MIN_NOTE_SEC, duration);
    const attackEnd = Math.min(start + spec.attack, end);
    const stopAt = end + spec.release;
    const source = target.createBufferSource();
    source.buffer = sample.buffer;
    const playbackRate = Math.pow(2, (midi - sample.midi) / 12);
    source.playbackRate.setValueAtTime(playbackRate, start);
    // 관악기는 녹음의 안정 구간을 반복해 아주 느린 온음표도 중간에 끊기지 않게 한다.
    // 짧은 음은 loopEnd 전에 정지하므로 원래 어택과 음색을 그대로 듣는다.
    if (spec.sustainLoop && sample.buffer && Number.isFinite(sample.buffer.duration)){
      const loopStart = spec.sustainLoop.start;
      const loopEnd = sample.buffer.duration - spec.sustainLoop.endPadding;
      if (loopEnd > loopStart + 0.12){
        source.loop = true;
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;
      }
    }

    const gain = target.createGain();
    gain.gain.setValueAtTime(0, start);
    const peak = spec.gain * Math.max(0.1, Math.min(1.3, Number(level) || 1));
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.setValueAtTime(peak, end);
    gain.gain.linearRampToValueAtTime(0, stopAt);

    source.connect(gain);
    gain.connect(destination);
    source.start(start);
    source.stop(stopAt + 0.02);
    return { source, gain, stopAt, sampleMidi:sample.midi };
  }

  const nearestPianoSample = nearestSample; // 기존 테스트·진단 API 호환
  /* 실시간·오프라인 공용 예약. events 는 musicTimeline 이 만든 목록,
     offset 은 "타임라인 0초"가 그 컨텍스트의 몇 초에 해당하는지. */
  function scheduleInto(target, destination, events, offset, timbre, sampleBuffers, synthSettings){
    const nodes = [];
    const defaultType = timbreOf(timbre);
    for (const event of (events || [])){
      if (!event || event.rest || !(event.frequency > 0)) continue;   // 쉼표는 시간만 흐른다
      const type = timbreOf(event.timbre || defaultType);
      const buffers = Array.isArray(sampleBuffers) ? sampleBuffers
        : sampleBuffers && typeof sampleBuffers === "object" ? sampleBuffers[type] : null;
      const node = type === "synth"
        ? scheduleSynthNote(target, destination, event.frequency, offset + event.start, event.duration,
            event.synth || synthSettings, event.gain)
        : SAMPLE_INSTRUMENTS[type] && buffers
        ? scheduleSampleNote(target, destination, event.midi, offset + event.start, event.duration, buffers, type, event.gain)
        : scheduleNote(target, destination, event.frequency, offset + event.start, event.duration,
            SAMPLE_INSTRUMENTS[type] ? "triangle" : type, event.gain);
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

  // 미리듣기는 일반 악보 재생(live)과 별도 경로라 stop()에서 직접 걷어야 한다.
  // 요청 번호도 함께 올려 샘플을 읽는 중이던 Promise가 뒤늦게 소리를 내지 못하게 한다.
  function cancelPreview(){
    previewRequest++;
    if (previewNodes.length && ctx) releaseNodes(previewNodes, ctx.currentTime);
    previewNodes = [];
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
    if (typeof state.onCount === "function" && state.countCurrent !== null) state.onCount(null);
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

    const timeline = musicTimeline(sheet, {
      from:options.from, to:options.to, playbackRate:options.playbackRate, staff:options.staff,
      partId:options.partId
    });
    if (!timeline.events.length && !timeline.drums.length && !timeline.bass.length && !timeline.chords.length) return null;
    const timbre = timbreOf(options.timbre || (sheet && sheet.timbre));
    const sampleBuffers = Object.create(null);
    const melodyTimbres = Array.from(new Set(timeline.events.filter((event) => !event.rest)
      .map((event) => timbreOf(event.timbre || timbre))));
    for (const eventTimbre of melodyTimbres){
      if (!SAMPLE_INSTRUMENTS[eventTimbre]) continue;
      try { sampleBuffers[eventTimbre] = await ensureSampleBuffers(target, eventTimbre); }
      catch(error){
        sampleBuffers[eventTimbre] = null;
        if (typeof options.onError === "function") options.onError(error, eventTimbre);
      }
    }
    let accompanimentTimbre = typeof musicAccompanimentTimbre === "function"
      ? musicAccompanimentTimbre(sheet && sheet.accompanimentTimbre) : "piano";
    let accompanimentBuffers = null;
    if (timeline.chords.length && SAMPLE_INSTRUMENTS[accompanimentTimbre]){
      const failedTimbre = accompanimentTimbre;
      try { accompanimentBuffers = await ensureSampleBuffers(target, accompanimentTimbre); }
      catch(error){
        accompanimentTimbre = "triangle";
        if (typeof options.onError === "function") options.onError(error, failedTimbre);
      }
    }
    if (request !== playRequest) return null;

    const beatsPerMeasure = Math.max(1, Math.round(Number(timeline.countInBeats) || 4));
    const beatSeconds = Math.max(0.01, Number(timeline.countInBeatSeconds) || (60 / timeline.tempo));
    const countInBeats = options.countIn ? beatsPerMeasure : 0;
    const countInSeconds = countInBeats * beatSeconds;
    const countStartAt = target.currentTime + START_DELAY;
    const state = {
      timeline, timbre, sampleBuffers, accompanimentTimbre, accompanimentBuffers,
      synthSettings:typeof musicSynthSettings === "function" ? musicSynthSettings(sheet && sheet.synth) : null,
      startAt:countStartAt + countInSeconds,
      countStartAt, countInBeats, countCurrent:null,
      beatsPerMeasure, beatSeconds, metronome:!!options.metronome, loop:!!options.loop,
      nodes:[], next:0, nextBeat:0, nextDrum:0, nextBass:0, nextChord:0,
      timer:0, raf:0, currentId:null,
      onNote:options.onNote, onCount:options.onCount, onEnd:options.onEnd
    };
    live = state;

    for (let beat = 0; beat < countInBeats; beat++){
      state.nodes.push(scheduleMetronomeClick(target, master,
        countStartAt + beat * beatSeconds, beat === 0));
    }

    // 예약: 지금부터 LOOKAHEAD 안에 시작할 음들만 그때그때 예약한다.
    const pump = () => {
      if (live !== state) return;
      const horizon = target.currentTime - state.startAt + LOOKAHEAD_SEC;
      while (state.next < timeline.events.length && timeline.events[state.next].start <= horizon){
        const event = timeline.events[state.next++];
        if (!event.rest && event.frequency > 0){
          state.nodes.push(...scheduleInto(target, master, [event], state.startAt,
            state.timbre, state.sampleBuffers, state.synthSettings));
        }
      }
      while (state.metronome && state.nextBeat < timeline.metronome.length &&
             timeline.metronome[state.nextBeat].start <= horizon){
        const beat = timeline.metronome[state.nextBeat++];
        state.nodes.push(scheduleMetronomeClick(target, master,
          state.startAt + beat.start, beat.accented));
      }
      while (state.nextDrum < timeline.drums.length && timeline.drums[state.nextDrum].start <= horizon){
        const drum = timeline.drums[state.nextDrum++];
        state.nodes.push(...scheduleDrumsInto(target, master, [drum], state.startAt));
      }
      while (state.nextBass < timeline.bass.length && timeline.bass[state.nextBass].start <= horizon){
        const bass = timeline.bass[state.nextBass++];
        state.nodes.push(...scheduleInto(target, master, [bass], state.startAt, "triangle", null));
      }
      while (state.nextChord < timeline.chords.length && timeline.chords[state.nextChord].start <= horizon){
        const chord = timeline.chords[state.nextChord++];
        state.nodes.push(...scheduleInto(target, master, [chord], state.startAt,
          state.accompanimentTimbre, state.accompanimentBuffers));
      }
    };
    pump();
    state.timer = setInterval(pump, TIMER_MS);

    // 강조: 오디오 시계를 보고 화면만 갱신한다.
    const follow = () => {
      if (live !== state) return;
      let elapsed = target.currentTime - state.startAt;
      if (elapsed < 0 && state.countInBeats && typeof state.onCount === "function"){
        const beat = Math.max(1, Math.min(state.countInBeats,
          Math.floor((target.currentTime - state.countStartAt) / state.beatSeconds) + 1));
        if (beat !== state.countCurrent){ state.countCurrent = beat; state.onCount(beat, state.countInBeats); }
      } else if (state.countCurrent !== null && typeof state.onCount === "function"){
        state.countCurrent = null;
        state.onCount(null);
      }
      if (elapsed >= timeline.totalSeconds){
        if (!state.loop){ finish(true); return; }
        while (elapsed >= timeline.totalSeconds){
          state.startAt += timeline.totalSeconds;
          elapsed = target.currentTime - state.startAt;
        }
        state.nodes = state.nodes.filter((node) => node && node.stopAt > target.currentTime);
        state.next = 0;
        state.nextBeat = 0;
        state.nextDrum = 0;
        state.nextBass = 0;
        state.nextChord = 0;
        state.currentId = null;
        if (typeof state.onNote === "function") state.onNote(null);
        pump();
      }
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

    return { totalSeconds:timeline.totalSeconds, countInSeconds, loop:state.loop, stop };
  }

  function stop(){
    playRequest++;
    finish(false);
    cancelPreview();
  }

  function playing(){
    return !!live;
  }

  // 음표 또는 화음 미리듣기 — 도구상자·음표 클릭에서 쓴다.
  function previewNote(note, timbre, opts){
    const options = opts || {};
    const target = ensureContext();
    if (!target) return false;
    const pitches = typeof musicNotePitches === "function" ? musicNotePitches(note) : [note];
    // 이조 악기 파트는 적힌 음보다 낮게 울린다(기보음 → 실음).
    const shift = Math.round(Number(options.transpose) || 0);
    const playable = pitches.map((pitch) => {
      const written = musicMidiNumber(pitch);
      return written === null ? { midi:null, frequency:0 }
        : { midi:written + shift, frequency:musicFrequency(written + shift) };
    }).filter((pitch) => pitch.midi !== null && pitch.frequency > 0);
    if (!playable.length) return false;   // 쉼표는 소리내지 않는다
    cancelPreview();
    const request = previewRequest;
    const type = timbreOf(timbre);
    const started = (nodes) => {
      if (request !== previewRequest) return;
      previewNodes = (nodes || []).filter(Boolean);
      if (typeof options.onScheduled === "function") options.onScheduled();
    };
    if (type === "synth"){
      const start = target.currentTime + 0.005;
      started(playable.map((pitch) => scheduleSynthNote(target, master, pitch.frequency, start,
        PREVIEW_SEC, options.synth)));
    } else if (SAMPLE_INSTRUMENTS[type]){
      ensureSampleBuffers(target, type).then((buffers) => {
        if (request !== previewRequest) return;
        const start = target.currentTime + 0.005;
        started(playable.map((pitch) =>
          scheduleSampleNote(target, master, pitch.midi, start, PREVIEW_SEC, buffers, type)));
      }).catch((error) => {
        if (request !== previewRequest) return;
        console.warn(`${SAMPLE_INSTRUMENTS[type].label} 음원을 읽지 못해 삼각파로 미리듣습니다:`, error);
        const start = target.currentTime + 0.005;
        started(playable.map((pitch) =>
          scheduleNote(target, master, pitch.frequency, start, PREVIEW_SEC, "triangle")));
      });
    } else {
      const start = target.currentTime + 0.005;
      started(playable.map((pitch) =>
        scheduleNote(target, master, pitch.frequency, start, PREVIEW_SEC, type)));
    }
    return true;
  }

  /* 연습 음원 믹스 — 고른 파트는 그대로 두고 나머지 파트와 반주만 otherGain 만큼 낮춘다.
     0 이면 내 파트만 남는다. 음량만 건드리므로 박자·길이는 합주와 완전히 같아 함께 맞춰 부르기 좋다. */
  function mixPracticeTrack(list, focusPartId, otherGain, backing){
    const items = Array.isArray(list) ? list : [];
    if (!focusPartId) return items;
    const level = Math.max(0, Math.min(1, Number(otherGain) || 0));
    return items.map((item) => {
      const mine = !backing && item.partId === focusPartId;
      return Object.assign({}, item, { gain:(item.gain || 0) * (mine ? 1 : level) });
    }).filter((item) => item.rest === true || item.gain > 0.0001);
  }

  /* WAV 저장 — 재생과 같은 scheduleInto 를 오프라인 컨텍스트에 태운다.
     실시간을 기다리지 않아 3분 곡도 1초 안에 끝난다. */
  async function renderWav(sheet, opts){
    const options = opts || {};
    const Ctor = offlineContextClass();
    if (!Ctor) throw new Error("이 브라우저는 오디오 파일 저장을 지원하지 않습니다.");
    const timeline = musicTimeline(sheet, { from:options.from, to:options.to,
      playbackRate:options.playbackRate, includeMuted:options.includeMuted });
    if (!timeline.events.length && !timeline.drums.length && !timeline.bass.length && !timeline.chords.length){
      throw new Error("저장할 소리가 없습니다.");
    }

    const focusPartId = String(options.focusPartId || "");
    const otherGain = options.otherGain;
    const melody = mixPracticeTrack(timeline.events, focusPartId, otherGain, false);
    const drumTrack = mixPracticeTrack(timeline.drums, focusPartId, otherGain, true);
    const bassTrack = mixPracticeTrack(timeline.bass, focusPartId, otherGain, true);
    const chordTrack = mixPracticeTrack(timeline.chords, focusPartId, otherGain, true);

    // 2마디 준비(카운트인)를 넣으면 곡 전체를 그만큼 뒤로 민다.
    const beatSeconds = Math.max(0.01, Number(timeline.countInBeatSeconds) || (60 / timeline.tempo));
    const countInBeats = options.countIn ? Math.max(1, Math.round(Number(timeline.countInBeats) || 4)) : 0;
    const offset = countInBeats * beatSeconds;

    const synthTail = timeline.events.reduce((tail, event) => {
      if (timbreOf(event && event.timbre || sheet && sheet.timbre) !== "synth") return tail;
      const settings = typeof musicSynthSettings === "function" ? musicSynthSettings(event.synth || sheet && sheet.synth) : null;
      return settings ? Math.max(tail, settings.release + Math.max(settings.delay > 0 ? 0.24 : 0,
        settings.reverb * 0.9) + 0.2) : tail;
    }, 0);
    const frames = Math.max(1, Math.ceil((offset + timeline.totalSeconds + Math.max(TAIL_SEC, synthTail)) * RENDER_SAMPLE_RATE));
    const target = new Ctor(1, frames, RENDER_SAMPLE_RATE);
    const bus = target.createGain();
    bus.gain.value = MASTER_GAIN;
    bus.connect(target.destination);
    const timbre = timbreOf(options.timbre || (sheet && sheet.timbre));
    const sampleBuffers = Object.create(null);
    const melodyTimbres = Array.from(new Set(melody.filter((event) => !event.rest)
      .map((event) => timbreOf(event.timbre || timbre))));
    for (const eventTimbre of melodyTimbres){
      if (!SAMPLE_INSTRUMENTS[eventTimbre]) continue;
      try { sampleBuffers[eventTimbre] = await ensureSampleBuffers(ensureContext() || target, eventTimbre); }
      catch(error){
        sampleBuffers[eventTimbre] = null;
        if (typeof options.onError === "function") options.onError(error, eventTimbre);
      }
    }
    let accompanimentTimbre = typeof musicAccompanimentTimbre === "function"
      ? musicAccompanimentTimbre(sheet && sheet.accompanimentTimbre) : "piano";
    let accompanimentBuffers = null;
    if (chordTrack.length && SAMPLE_INSTRUMENTS[accompanimentTimbre]){
      const failedTimbre = accompanimentTimbre;
      try { accompanimentBuffers = await ensureSampleBuffers(ensureContext() || target, accompanimentTimbre); }
      catch(error){
        accompanimentTimbre = "triangle";
        if (typeof options.onError === "function") options.onError(error, failedTimbre);
      }
    }
    scheduleInto(target, bus, melody, offset, timbre, sampleBuffers,
      typeof musicSynthSettings === "function" ? musicSynthSettings(sheet && sheet.synth) : null);
    scheduleDrumsInto(target, bus, drumTrack, offset);
    scheduleInto(target, bus, bassTrack, offset, "triangle", null);
    scheduleInto(target, bus, chordTrack, offset, accompanimentTimbre, accompanimentBuffers);
    // 준비 딱딱이와 마디마다의 메트로놈은 재생 때 쓰던 그 소리를 그대로 굽는다.
    for (let beat = 0; beat < countInBeats; beat++){
      scheduleMetronomeClick(target, bus, beat * beatSeconds, beat === 0);
    }
    if (options.metronome){
      for (const beat of timeline.metronome) scheduleMetronomeClick(target, bus, offset + beat.start, beat.accented);
    }

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
    play, stop, playing, supported, previewNote, cancelPreview, renderWav, encodeWav, mixPracticeTrack,
    scheduleInto, scheduleSynthNote,
    scheduleMetronomeClick, scheduleDrumHit, scheduleDrumsInto, setVolume, getVolume, setMuted, muted,
    ensurePianoBuffers, ensureGuitarBuffers, nearestPianoSample, nearestSample, sampledTimbre,
    PIANO_SAMPLE_ROOTS, GUITAR_SAMPLE_ROOTS, XYLOPHONE_SAMPLE_ROOTS, HARP_SAMPLE_ROOTS,
    FLUTE_SAMPLE_ROOTS, CLARINET_SAMPLE_ROOTS, SAMPLE_INSTRUMENTS,
    ADSR, MASTER_GAIN, SYNTH_GAIN, PIANO_RELEASE, GUITAR_RELEASE
  };
})();
