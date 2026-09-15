/* 마이크 음 확인 — 노래·리코더 소리에서 음높이를 찾아 따라치기에 "누른 음"으로 넘긴다.
   공개 API: MNMusicPitch.detect(샘플, 표본율) · MNMusicPitch.createTracker(옵션) · MNMusicPitch.createMic(옵션)

   세 칸으로 나눈 이유 — 앞의 둘은 DOM·오디오 없이 node 에서 그대로 검증한다.
   · detect      : 한 조각(약 40ms)의 파형에서 기본 주파수 하나. YIN 알고리즘.
   · createTracker: 조각마다 나온 음높이를 이어 보고 "한 음을 냈다"는 사건을 만든다.
                   소리는 건반과 달리 누르는 순간이 없다. 끌어올리며 부르는 사이의 음,
                   한 음을 길게 끄는 동안의 반복, 같은 음 두 번(도 도)을 여기서 가려낸다.
   · createMic   : getUserMedia 로 마이크를 열고 일정 간격으로 detect → tracker 를 돌린다.

   채점 규칙(옥타브 통과·틀리면 진도 멈춤)은 따라치기(music-editor.js practicePress)가 그대로 맡는다.
   아이·어른 목소리가 옥타브가 달라도 같은 음으로 봐야 해서, 옥타브 통과 규칙이 노래에 오히려 잘 맞는다. */
const MNMusicPitch = (() => {
  const MIN_FREQ = 70;          // 남자 낮은 목소리(대략 D2)까지
  const MAX_FREQ = 2500;        // 소프라노 리코더 가장 높은 음(D7 ≈ 2349Hz)까지
  const YIN_THRESHOLD = 0.15;   // 낮을수록 까다롭다. 0.1~0.2 가 흔히 쓰는 값
  const MIN_RMS = 0.012;        // 이보다 작은 소리는 조용함으로 본다(교실 잡음)
  const HOLD_MS = 120;          // 같은 반음에 이만큼 머물러야 한 음을 낸 것으로 본다
  const GAP_MS = 70;            // 같은 음을 다시 내려면 이만큼 쉬어야 한다(도 도)
  const CENTS_TOLERANCE = 45;   // 반음 한가운데서 이만큼 벗어나면 "음 사이"로 본다
  const FRAME_MS = 30;          // 마이크를 읽는 간격

  function rms(samples){
    let sum = 0;
    for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index];
    return samples.length ? Math.sqrt(sum / samples.length) : 0;
  }

  /* YIN(de Cheveigné & Kawahara, 2002). 자기상관보다 옥타브 착오가 적고, 계산이 단순해
     외부 라이브러리 없이 둘 수 있다. 창의 절반을 비교 폭으로 쓰고 나머지 절반을 지연 탐색 범위로 쓴다. */
  function detect(samples, sampleRate, opts){
    const options = opts || {};
    const rate = Number(sampleRate) || 0;
    if (!samples || samples.length < 64 || rate <= 0) return null;
    const level = rms(samples);
    if (level < (Number.isFinite(options.minRms) ? options.minRms : MIN_RMS)) return { freq:null, clarity:0, rms:level };
    const half = Math.floor(samples.length / 2);
    const minTau = Math.max(2, Math.floor(rate / (options.maxFreq || MAX_FREQ)));
    const maxTau = Math.min(half - 1, Math.ceil(rate / (options.minFreq || MIN_FREQ)));
    if (maxTau <= minTau) return { freq:null, clarity:0, rms:level };
    const diff = new Float32Array(maxTau + 1);
    for (let tau = 1; tau <= maxTau; tau++){
      let sum = 0;
      for (let index = 0; index < half; index++){
        const delta = samples[index] - samples[index + tau];
        sum += delta * delta;
      }
      diff[tau] = sum;
    }
    // 누적 평균으로 정규화한 차이(CMNDF). 지연 0 근처가 늘 작아 보이는 문제를 없앤다.
    const cmnd = new Float32Array(maxTau + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++){
      running += diff[tau];
      cmnd[tau] = running > 0 ? diff[tau] * tau / running : 1;
    }
    const threshold = Number.isFinite(options.threshold) ? options.threshold : YIN_THRESHOLD;
    let tau = -1;
    for (let at = minTau; at <= maxTau; at++){
      if (cmnd[at] < threshold){
        while (at + 1 <= maxTau && cmnd[at + 1] < cmnd[at]) at++;   // 골짜기 바닥까지 내려간다
        tau = at;
        break;
      }
    }
    if (tau < 0) return { freq:null, clarity:0, rms:level };   // 뚜렷한 주기가 없다(숨소리·잡음)
    // 이웃 세 점으로 포물선을 맞춰 지연을 표본 사이까지 좁힌다 — 높은 음일수록 반음 오차가 커진다.
    let better = tau;
    if (tau > 1 && tau < maxTau){
      const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
      const denom = a + c - 2 * b;
      if (Math.abs(denom) > 1e-12) better = tau + (a - c) / (2 * denom);
    }
    return { freq:rate / better, clarity:Math.max(0, Math.min(1, 1 - cmnd[tau])), rms:level };
  }

  function freqToMidi(freq){
    const value = Number(freq);
    return value > 0 ? 69 + 12 * Math.log2(value / 440) : null;
  }

  /* 조각마다 { midi(실수) | null, t(ms) } 를 받아, 한 음이 자리 잡는 순간 한 번만 사건을 낸다.
     holdMs 를 함수로 받을 수 있게 한 이유: 따라치기는 "맞는 음"은 빨리 받고 "틀린 음"은 오래
     머물 때만 틀린 것으로 센다. 노래는 음을 찾아 미끄러지며 들어가서, 같은 시간을 쓰면
     제 음에 닿기 전 스쳐 간 음이 모두 실수로 잡힌다. */
  function createTracker(opts){
    const options = opts || {};
    const holdOf = typeof options.holdMs === "function" ? options.holdMs
      : () => (Number.isFinite(options.holdMs) ? options.holdMs : HOLD_MS);
    const gapMs = Number.isFinite(options.gapMs) ? options.gapMs : GAP_MS;
    const tolerance = Number.isFinite(options.cents) ? options.cents : CENTS_TOLERANCE;
    const state = { candidate:null, since:0, emitted:null, silentSince:null, lastT:null };

    function reset(){
      state.candidate = null; state.since = 0; state.emitted = null; state.silentSince = null; state.lastT = null;
    }

    function feed(frame){
      const t = Number(frame && frame.t) || 0;
      state.lastT = t;
      const midi = frame && Number.isFinite(frame.midi) ? frame.midi : null;
      if (midi === null){
        if (state.silentSince === null) state.silentSince = t;
        // 충분히 쉬었으면 같은 음도 새로 낸 것으로 받는다.
        if (t - state.silentSince >= gapMs) state.emitted = null;
        state.candidate = null;
        return null;
      }
      const nearest = Math.round(midi);
      const cents = Math.round((midi - nearest) * 100);
      if (Math.abs(cents) > tolerance){       // 두 반음 사이를 지나는 중 — 자리 잡지 않았다
        state.candidate = null;
        return null;
      }
      state.silentSince = null;
      if (state.candidate !== nearest){
        state.candidate = nearest;
        state.since = t;
      }
      if (state.emitted === nearest) return null;            // 길게 끄는 중인 같은 음
      if (t - state.since < holdOf(nearest)) return null;
      state.emitted = nearest;
      return { midi:nearest, pc:((nearest % 12) + 12) % 12, cents };
    }

    return { feed, reset };
  }

  /* 마이크 한 개. start() 는 권한을 묻고 열리면 true, 거절·미지원이면 false.
     음을 들려주는 동안에는 mute(ms) 로 귀를 막는다 — 스피커 소리가 다시 마이크로 들어와
     앱이 낸 정답 소리를 학생이 부른 음으로 채점하는 일을 막는다. */
  function createMic(opts){
    const options = opts || {};
    const fire = (name, ...args) => { if (typeof options[name] === "function") options[name](...args); };
    const tracker = createTracker({ holdMs:options.holdMs, gapMs:options.gapMs, cents:options.cents });
    let stream = null, context = null, analyser = null, source = null, timer = null, buffer = null;
    let mutedUntil = 0, running = false, starting = null;

    function supported(){
      return typeof navigator !== "undefined" && !!navigator.mediaDevices
        && typeof navigator.mediaDevices.getUserMedia === "function"
        && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
    }

    function tick(){
      if (!running || !analyser) return;
      const now = performance.now();
      analyser.getFloatTimeDomainData(buffer);
      if (now < mutedUntil){
        tracker.feed({ midi:null, t:now });
        fire("onLevel", null);
        return;
      }
      const found = detect(buffer, context.sampleRate);
      const midi = found && found.freq ? freqToMidi(found.freq) : null;
      fire("onLevel", midi === null ? null : { midi, rms:found.rms, clarity:found.clarity });
      const note = tracker.feed({ midi, t:now });
      if (note) fire("onNote", note);
    }

    async function start(){
      if (running) return true;
      if (starting) return starting;
      if (!supported()) return false;
      starting = (async () => {
        try {
          // 음성 통화용 처리(메아리 제거·잡음 억제·자동 음량)는 노래의 음높이와 음량을 뭉갠다.
          stream = await navigator.mediaDevices.getUserMedia({ audio:{
            echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
          const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
          context = new Ctor();
          source = context.createMediaStreamSource(stream);
          analyser = context.createAnalyser();
          analyser.fftSize = 2048;      // 48kHz 에서 약 43ms — 70Hz 주기를 두 번 넘게 담는다
          buffer = new Float32Array(analyser.fftSize);
          source.connect(analyser);     // 스피커(destination)에는 잇지 않는다 — 되울림 방지
          tracker.reset();
          running = true;
          timer = setInterval(tick, FRAME_MS);
          return true;
        } catch(error){
          release();
          fire("onError", error);
          return false;
        } finally {
          starting = null;
        }
      })();
      return starting;
    }

    function release(){
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      try { if (source) source.disconnect(); } catch(_){}
      if (stream) for (const track of stream.getTracks()) { try { track.stop(); } catch(_){} }
      if (context && typeof context.close === "function") context.close().catch(() => {});
      stream = null; context = null; analyser = null; source = null; buffer = null;
      tracker.reset();
    }

    function stop(){
      if (!running && !stream) return;
      release();
      fire("onLevel", null);
    }

    function mute(ms){
      mutedUntil = Math.max(mutedUntil, performance.now() + Math.max(0, Number(ms) || 0));
    }

    return { start, stop, mute, supported, active:() => running };
  }

  const PC_LABELS = ["도", "도♯", "레", "레♯", "미", "파", "파♯", "솔", "솔♯", "라", "라♯", "시"];
  // 표시용 "솔 +12" — 음이름과 반음 한가운데서 벗어난 센트
  function label(midi){
    if (!Number.isFinite(midi)) return "";
    const nearest = Math.round(midi);
    const cents = Math.round((midi - nearest) * 100);
    const name = PC_LABELS[((nearest % 12) + 12) % 12];
    return `${name}${Math.floor(nearest / 12) - 1} ${cents >= 0 ? "+" : "−"}${Math.abs(cents)}`;
  }

  return Object.freeze({ detect, freqToMidi, createTracker, createMic, label,
    HOLD_MS, GAP_MS, CENTS_TOLERANCE });
})();
