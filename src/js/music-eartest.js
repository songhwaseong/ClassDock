/* 음감 테스트 — 소리만 듣고 음이름을 맞히는 연습 모드.
   공개 API: MNMusicEarTest.create(options) → 화면 한 조각(el)과 조작 몇 개를 돌려준다.

   따라치기(music-editor.js)와 형제지만 규칙이 정반대인 곳이 셋이다.
   · 악보를 보여 주지 않는다  — 따라치기는 악보가 교본이지만 여기서는 악보가 곧 정답표다.
   · 틀려도 진도가 나간다     — 정답을 바로 들려주는 것이 학습 신호다. 악보 위 위치를 잃을 일도 없다.
   · 다시 듣기를 제한한다     — 몇 번이고 다시 들으면 시행착오 게임이 된다.

   문제를 만드는 규칙은 music-model.js(musicEarQuestions 등)에 순수 함수로 있고, 여기서는
   그 문제를 소리로 내고 답을 받아 채점만 한다. 입력(자판·MIDI·도레미 버튼)은 편집기가
   이미 가진 경로를 그대로 써서 press()·answerOctave() 두 문으로 들어온다. */
const MNMusicEarTest = (() => {
  const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
  const BLACK_PCS = [1, 3, 6, 8, 10];
  const REPLAY_LIMIT = 1;              // 문제마다 다시 들을 수 있는 횟수
  const DISTRACTOR_GAP_MS = 750;       // 간섭음이 끝나고 문제 음이 나오기까지
  const REVEAL_MS = 1200;              // 정답을 보여 주고 다음 문제로 넘어가기까지
  const FIRST_MS = 450;                // 시작 버튼을 누르고 첫 소리까지(패널이 먼저 보이게)

  function pcLabel(pc){
    return MUSIC_PC_LABELS[((Math.round(Number(pc)) % 12) + 12) % 12] || "?";
  }
  function noteLabel(pc, octave, withOctave){
    return withOctave ? `${pcLabel(pc)}${Math.round(Number(octave))}` : pcLabel(pc);
  }
  function seconds(ms){
    return (Math.max(0, Math.round(Number(ms) || 0)) / 1000).toFixed(1);
  }

  function create(options){
    const opts = options || {};
    const timbreOf = typeof opts.timbre === "function" ? opts.timbre : () => "piano";
    const say = typeof opts.toast === "function" ? opts.toast : () => {};
    const fire = (name, ...args) => { if (typeof opts[name] === "function") opts[name](...args); };

    const state = {
      active:false, phase:"idle", level:null, questions:[], pos:0, records:[],
      askedAt:0, replays:0, pendingPc:null, reference:false, timers:[]
    };

    /* ----- 화면 ----- */
    const el = document.createElement("section");
    el.className = "music-ear";
    el.hidden = true;
    const panel = document.createElement("div");
    panel.className = "music-ear-panel";
    el.appendChild(panel);

    const head = document.createElement("div");
    head.className = "music-ear-head";
    const headTitle = document.createElement("strong");
    headTitle.textContent = "🎧 음감 테스트";
    const progressEl = document.createElement("span");
    progressEl.className = "music-ear-progress";
    const modeEl = document.createElement("span");
    modeEl.className = "music-ear-mode";
    head.append(headTitle, progressEl, modeEl);

    const stage = document.createElement("div");
    stage.className = "music-ear-stage";
    const askEl = document.createElement("p");
    askEl.className = "music-ear-ask";
    askEl.setAttribute("aria-live", "polite");
    const replayBtn = document.createElement("button");
    replayBtn.type = "button";
    replayBtn.className = "music-btn music-ear-replay";
    const feedbackEl = document.createElement("p");
    feedbackEl.className = "music-ear-feedback";
    feedbackEl.setAttribute("aria-live", "polite");
    stage.append(askEl, replayBtn, feedbackEl);

    const whiteRow = document.createElement("div");
    whiteRow.className = "music-ear-keys";
    const blackRow = document.createElement("div");
    blackRow.className = "music-ear-keys music-ear-black";
    const keyButtons = new Map();
    for (const [row, pcs] of [[whiteRow, WHITE_PCS], [blackRow, BLACK_PCS]]){
      for (const pc of pcs){
        const button = document.createElement("button");
        button.type = "button";
        button.className = "music-btn music-ear-key";
        button.textContent = pcLabel(pc);
        button.dataset.pc = String(pc);
        button.addEventListener("click", () => press(pc));
        row.appendChild(button);
        keyButtons.set(pc, button);
      }
    }

    const octaveRow = document.createElement("div");
    octaveRow.className = "music-ear-octaves";
    octaveRow.hidden = true;
    const octaveButtons = new Map();

    const hintEl = document.createElement("p");
    hintEl.className = "music-ear-hint";

    const result = document.createElement("div");
    result.className = "music-ear-result";
    result.hidden = true;
    const resultScore = document.createElement("p");
    resultScore.className = "music-ear-score";
    const resultDetail = document.createElement("p");
    resultDetail.className = "music-ear-detail";
    const resultConfusion = document.createElement("p");
    resultConfusion.className = "music-ear-confusion";
    const resultNote = document.createElement("p");
    resultNote.className = "music-ear-note";
    // 이 테스트는 조건을 통제한 검사가 아니다 — "절대음감이다/아니다"로 읽히지 않게 못박는다.
    resultNote.textContent = "이 기록은 연습 결과예요. 절대음감이 있는지를 가리는 검사는 아니에요.";
    const resultButtons = document.createElement("div");
    resultButtons.className = "music-ear-result-buttons";
    const againBtn = document.createElement("button");
    againBtn.type = "button";
    againBtn.className = "music-btn";
    againBtn.textContent = "↻ 한 번 더";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "music-btn";
    closeBtn.textContent = "닫기 (Esc)";
    resultButtons.append(againBtn, closeBtn);
    result.append(resultScore, resultDetail, resultConfusion, resultNote, resultButtons);

    panel.append(head, stage, whiteRow, blackRow, octaveRow, hintEl, result);

    replayBtn.addEventListener("click", () => replay());
    // 결과 화면의 "한 번 더" — 테스트를 켠 채로 문제만 새로 뽑는다. 끄고 다시 켜면 그 사이에
    // 악보가 잠깐 드러났다 사라져 눈이 어지럽다.
    againBtn.addEventListener("click", () => {
      if (!state.active) return;
      restart();
    });
    closeBtn.addEventListener("click", () => stop("done"));

    /* ----- 소리 ----- */
    function playMidis(midis, onScheduled){
      const pitches = (midis || []).map((midi) => musicPitchFromMidi(midi, false)).filter(Boolean);
      if (!pitches.length) return false;
      const [first, ...rest] = pitches;
      // previewNote 는 부를 때마다 앞의 미리듣기를 취소하므로 화음처럼 한 번에 넘긴다.
      // 샘플 음색은 비동기로 준비되므로 실제 예약 시점을 돌려받아 그때부터 답과 시간을 받는다.
      return MNMusicAudio.previewNote(
        { rest:false, step:first.step, octave:first.octave, alter:first.alter, chord:rest },
        timbreOf(), { onScheduled });
    }
    function later(fn, ms){
      const id = setTimeout(() => {
        state.timers = state.timers.filter((value) => value !== id);
        if (state.active) fn();
      }, ms);
      state.timers.push(id);
      return id;
    }
    function clearTimers(){
      for (const id of state.timers) clearTimeout(id);
      state.timers = [];
    }

    /* ----- 화면 갱신 ----- */
    function syncKeys(){
      const level = state.level;
      blackRow.hidden = !level || !level.black;
      const asking = state.phase === "ask" && !!level;
      for (const [pc, button] of keyButtons) button.disabled = !asking || (!level.black && BLACK_PCS.includes(pc));
      octaveRow.hidden = state.phase !== "octave";
      for (const button of octaveButtons.values()) button.disabled = state.phase !== "octave";
      replayBtn.disabled = !asking || state.replays >= REPLAY_LIMIT;
      replayBtn.textContent = state.replays >= REPLAY_LIMIT
        ? "🔊 다시 듣기 (다 썼어요)" : `🔊 다시 듣기 (${REPLAY_LIMIT - state.replays}번 남음)`;
    }
    function syncProgress(){
      const total = state.questions.length;
      const at = Math.min(state.pos + 1, total);
      progressEl.textContent = total ? `${at} / ${total}` : "";
      modeEl.textContent = state.level ? state.level.label : "";
    }
    function buildOctaveButtons(){
      octaveRow.replaceChildren();
      octaveButtons.clear();
      octaveRow.append("몇 옥타브였나요? ");
      for (const octave of musicEarOctaves(state.level.id)){
        const button = document.createElement("button");
        button.type = "button";
        button.className = "music-btn music-ear-key";
        button.textContent = `${octave}옥타브`;
        button.addEventListener("click", () => answerOctave(octave));
        octaveRow.appendChild(button);
        octaveButtons.set(octave, button);
      }
    }

    /* ----- 진행 ----- */
    function askCurrent(withDistractor){
      const question = state.questions[state.pos];
      if (!question) return;
      state.phase = "wait";
      state.pendingPc = null;
      state.replays = 0;
      askEl.textContent = withDistractor ? "잠깐 다른 소리를 들려줄게요…" : "잘 들어 보세요…";
      syncKeys();
      const startAsk = () => {
        playMidis([question.midi], () => {
          if (!state.active || state.questions[state.pos] !== question || state.phase !== "wait") return;
          state.askedAt = Date.now();
          state.phase = "ask";
          askEl.textContent = state.level.octaveAnswer ? "무슨 음일까요? (음이름 먼저)" : "무슨 음일까요?";
          syncKeys();
        });
      };
      if (withDistractor){
        // 샘플을 처음 읽는 판에서도 간섭음이 실제로 난 뒤부터 간격을 센다.
        playMidis(musicEarDistractor(), () => later(startAsk, DISTRACTOR_GAP_MS));
      } else {
        later(startAsk, FIRST_MS);
      }
    }

    function record(question, answerPc, answerOctave, judged){
      state.records.push({
        index:question.index, midi:question.midi, pc:question.pc, octave:question.octave,
        answerPc:Number.isFinite(answerPc) ? answerPc : null,
        answerOctave:Number.isFinite(answerOctave) ? answerOctave : null,
        correct:judged.correct, ms:Date.now() - state.askedAt, replays:state.replays, answered:true
      });
    }

    function reveal(question, answerPc, answerOctave, judged){
      state.phase = "reveal";
      state.pendingPc = null;
      syncKeys();
      const withOctave = !!state.level.octaveAnswer;
      const want = noteLabel(question.pc, question.octave, withOctave);
      if (judged.correct){
        feedbackEl.className = "music-ear-feedback is-ok";
        feedbackEl.textContent = `맞았어요! ${want} · ${seconds(Date.now() - state.askedAt)}초`;
      } else {
        const given = Number.isFinite(answerPc)
          ? noteLabel(answerPc, Number.isFinite(answerOctave) ? answerOctave : question.octave, withOctave) : "?";
        feedbackEl.className = "music-ear-feedback is-bad";
        feedbackEl.textContent = `정답은 ${want} · 누른 음은 ${given}`;
      }
      askEl.textContent = "";
      playMidis([question.midi]);           // 틀렸든 맞았든 정답 음을 한 번 더 들려준다
      later(() => {
        state.pos++;
        feedbackEl.textContent = "";
        feedbackEl.className = "music-ear-feedback";
        if (state.pos >= state.questions.length){ finish(); return; }
        syncProgress();
        askCurrent(true);
      }, REVEAL_MS);
    }

    function finish(){
      state.phase = "done";
      clearTimers();
      const summary = musicEarSummary(state.records);
      askEl.textContent = "";
      feedbackEl.textContent = "";
      stage.hidden = true;
      whiteRow.hidden = true;
      blackRow.hidden = true;
      octaveRow.hidden = true;
      hintEl.hidden = true;
      result.hidden = false;
      progressEl.textContent = `${summary.answered} / ${summary.total}`;
      resultScore.textContent = `${summary.correct}문제 맞았어요 · 정확도 ${summary.accuracy}%`;
      resultDetail.textContent = `평균 ${seconds(summary.avgMs)}초 · 가장 빨리 맞힌 답 ${seconds(summary.bestMs)}초`
        + (summary.replays ? ` · 다시 듣기 ${summary.replays}번` : "");
      resultConfusion.textContent = summary.confusions.length
        ? "자주 헷갈린 음: " + summary.confusions.map((item) => `${item.label} ${item.count}번`).join(" · ")
        : "헷갈린 음이 없었어요.";
      closeBtn.focus({ preventScroll:true });
      fire("onFinish", summary);
    }

    /* ----- 바깥에서 들어오는 답 ----- */
    // pc 는 옥타브를 뺀 음이름(0~11). midi 를 함께 주면(MIDI 건반) 옥타브까지 한 번에 답한 것으로 본다.
    function press(pc, midi){
      if (!state.active || state.phase !== "ask") return;
      const value = Math.round(Number(pc));
      if (!Number.isFinite(value)) return;
      if (!state.level.black && BLACK_PCS.includes(((value % 12) + 12) % 12)){
        say("이 단계에서는 검은건반 음이 나오지 않아요.", 1800);
        return;
      }
      const question = state.questions[state.pos];
      if (!question) return;
      if (state.level.octaveAnswer && !Number.isFinite(Number(midi))){
        // 자판·버튼으로는 옥타브를 함께 누를 수 없어 두 번에 나눠 받는다.
        state.pendingPc = value;
        state.phase = "octave";
        askEl.textContent = `${pcLabel(value)} — 몇 옥타브였나요?`;
        buildOctaveButtons();
        syncKeys();
        return;
      }
      const answerOctave = Number.isFinite(Number(midi)) ? Math.floor(Number(midi) / 12) - 1 : null;
      const judged = musicEarJudge(question, { pc:value, octave:answerOctave }, state.level.id);
      record(question, value, answerOctave, judged);
      reveal(question, value, answerOctave, judged);
    }

    function answerOctave(octave){
      if (!state.active || state.phase !== "octave") return;
      const value = Math.round(Number(octave));
      if (!Number.isFinite(value)) return;
      // 이 단계에 없는 옥타브(숫자키 3·6 등)는 틀린 답으로 세지 않고 그냥 흘린다 —
      // 고를 수 없는 답으로 점수가 깎이면 억울하다.
      if (!musicEarOctaves(state.level.id).includes(value)) return;
      const question = state.questions[state.pos];
      if (!question) return;
      const judged = musicEarJudge(question, { pc:state.pendingPc, octave:value }, state.level.id);
      record(question, state.pendingPc, value, judged);
      reveal(question, state.pendingPc, value, judged);
    }

    function replay(){
      if (!state.active || state.phase !== "ask") return;
      if (state.replays >= REPLAY_LIMIT){
        say("이 문제는 다시 듣기를 다 썼어요. 들리는 대로 눌러 보세요.", 2000);
        return;
      }
      state.replays++;
      const question = state.questions[state.pos];
      if (question) playMidis([question.midi]);
      syncKeys();
    }

    // 한 판을 차린다(문제 뽑기·화면 되돌리기·첫 소리). start 와 "한 번 더"가 함께 쓴다.
    function beginRound(built){
      state.level = built.level;
      state.questions = built.questions;
      state.records = [];
      state.pos = 0;
      state.replays = 0;
      state.pendingPc = null;
      clearTimers();
      stage.hidden = false;
      whiteRow.hidden = false;
      hintEl.hidden = false;
      result.hidden = true;
      feedbackEl.textContent = "";
      feedbackEl.className = "music-ear-feedback";
      hintEl.textContent = "A S D F G H J = 도 레 미 파 솔 라 시"
        + (built.level.black ? " · 검은건반 W E T Y U" : "")
        + (built.level.octaveAnswer ? " · 옥타브는 숫자키 4·5" : "")
        + " · Space 다시 듣기 · Esc 그만두기";
      syncProgress();
      syncKeys();
      if (state.reference){
        // 상대음감 모드 — 기준음을 먼저 들려주고 시작한다. 절대음감 모드에는 이 소리가 없다.
        askEl.textContent = "기준음(가온다 도4)을 들려줄게요.";
        // 기준음도 실제 예약된 뒤부터 0.9초를 센다. 차가운 샘플 로딩 중 다음 음에 취소되지 않는다.
        playMidis([MUSIC_EAR_REFERENCE_MIDI], () => later(() => askCurrent(false), 900));
      } else {
        askCurrent(false);
      }
    }

    function start(config){
      if (state.active) return false;
      const setup = config || {};
      const built = musicEarQuestions({ level:setup.level, count:setup.count });
      if (!built.questions.length) return false;
      state.active = true;
      state.reference = !!setup.reference;
      el.hidden = false;
      beginRound(built);
      fire("onStart", built.level);
      return true;
    }

    function restart(){
      if (!state.active) return false;
      const built = musicEarQuestions({ level:state.level ? state.level.id : 1, count:state.questions.length });
      if (!built.questions.length) return false;
      beginRound(built);
      return true;
    }

    // reason: "done"=끝까지 풀었다 / "cancel"=그만뒀다 / "restart"=결과 화면에서 한 번 더
    function stop(reason){
      if (!state.active) return null;
      const summary = musicEarSummary(state.records);
      clearTimers();
      MNMusicAudio.stop();
      state.active = false;
      state.phase = "idle";
      state.questions = [];
      state.records = [];
      state.pos = 0;
      state.pendingPc = null;
      el.hidden = true;
      result.hidden = true;
      octaveRow.hidden = true;
      fire("onEnd", summary, reason || "cancel");
      return summary;
    }

    function destroy(){
      clearTimers();
      MNMusicAudio.cancelPreview();
      state.active = false;
      state.phase = "idle";
      state.questions = [];
      state.records = [];
      el.hidden = true;
    }

    return {
      el,
      start, stop, press, answerOctave, replay, destroy,
      active:() => state.active,
      needsOctave:() => state.phase === "octave",
      finished:() => state.phase === "done",
      phase:() => state.phase
    };
  }

  return { create, LEVELS:MUSIC_EAR_LEVELS, COUNTS:MUSIC_EAR_COUNTS, REPLAY_LIMIT };
})();
