"use strict";

/* ===== MusicXML 호환 계층 =====
   현재 .msheet 편집기가 표현할 수 있는 화음·피아노 대보표 범위로 MusicXML을 가져오고,
   편집한 악보를 표준 score-partwise MusicXML로 내보낸다. 압축형 .mxl은 이미 제품에
   포함된 JSZip을 지연 로드해 읽으므로 EXE가 인터넷에 연결되거나 별도 설치를 할 필요가 없다. */

const MUSIC_XML_KEY_TO_FIFTHS = Object.fromEntries(Object.entries(MUSIC_KEYS)
  .map(([key, spec]) => [key, spec.fifths]));
const MUSIC_XML_FIFTHS_TO_KEY = Object.fromEntries(Object.entries(MUSIC_KEYS)
  .filter(([, spec]) => spec.mode === "major").map(([key, spec]) => [String(spec.fifths), key]));
const MUSIC_XML_FIFTHS_TO_MINOR_KEY = Object.fromEntries(Object.entries(MUSIC_KEYS)
  .filter(([, spec]) => spec.mode === "minor").map(([key, spec]) => [String(spec.fifths), key]));
const MUSIC_XML_VALUE_TO_TYPE = {
  whole:"whole", half:"half", quarter:"quarter", eighth:"eighth", "16th":"16th"
};
const MUSIC_XML_TYPE_TO_VALUE = {
  whole:"whole", half:"half", quarter:"quarter", eighth:"eighth", "16th":"16th",
  breve:"whole", "32nd":"16th", "64th":"16th"
};

function musicXmlLocalName(node){
  return String((node && (node.localName || node.nodeName)) || "").split(":").pop();
}

function musicXmlChildren(node, name){
  return Array.from((node && node.childNodes) || []).filter((child) =>
    child && child.nodeType === 1 && musicXmlLocalName(child) === name);
}

function musicXmlFirst(node, name){
  const children = musicXmlChildren(node, name);
  return children.length ? children[0] : null;
}

function musicXmlDescendants(node, name){
  if (!node || typeof node.getElementsByTagName !== "function") return [];
  return Array.from(node.getElementsByTagName("*")).filter((child) => musicXmlLocalName(child) === name);
}

function musicXmlFirstDescendant(node, name){
  const found = musicXmlDescendants(node, name);
  return found.length ? found[0] : null;
}

function musicXmlText(node, name){
  const child = name ? musicXmlFirst(node, name) : node;
  return child ? String(child.textContent || "").trim() : "";
}

function musicXmlParseDocument(text){
  if (typeof DOMParser !== "function") throw new Error("이 환경에서는 MusicXML을 읽을 수 없어요.");
  const doc = new DOMParser().parseFromString(String(text || ""), "application/xml");
  if (!doc || !doc.documentElement || musicXmlLocalName(doc.documentElement) === "parsererror"
      || musicXmlDescendants(doc, "parsererror").length){
    throw new Error("MusicXML 문법을 확인해 주세요.");
  }
  return doc;
}

function musicXmlSourceTitle(sourceName){
  return String(sourceName || "악보").replace(/\.(?:musicxml|mxl|xml)$/i, "") || "악보";
}

function musicXmlSupportedDuration(type, dots, duration, divisions, warnings){
  const dotCount = Math.max(0, Math.min(MUSIC_MAX_DOTS, Number(dots) || 0));
  const rawType = String(type || "").toLowerCase();
  const value = MUSIC_XML_TYPE_TO_VALUE[rawType];
  if (value && MUSIC_NOTE_VALUES[value]){
    if ((Number(dots) || 0) > MUSIC_MAX_DOTS) warnings.add("점이 세 개 이상인 음표는 겹점까지만 가져왔어요.");
    if (rawType === "breve") warnings.add("2온음표는 온음표로 바꿨어요.");
    if (rawType === "32nd" || rawType === "64th") warnings.add("지원하지 않는 짧은 음표는 16분음표로 바꿨어요.");
    return { value, dots:dotCount };
  }

  const rawTicks = divisions > 0 ? (Number(duration) || 0) * MUSIC_TICKS_PER_QUARTER / divisions : 0;
  let best = { value:"quarter", dots:0, delta:Infinity };
  for (const candidate of Object.keys(MUSIC_NOTE_VALUES)){
    for (let candidateDots = 0; candidateDots <= MUSIC_MAX_DOTS; candidateDots++){
      const ticks = musicNoteTicks({ value:candidate, dots:candidateDots });
      const delta = Math.abs(ticks - rawTicks);
      if (delta < best.delta) best = { value:candidate, dots:candidateDots, delta };
    }
  }
  warnings.add("일부 음표 길이는 편집기에서 가장 가까운 길이로 바꿨어요.");
  return { value:best.value, dots:best.dots };
}

function musicParseXmlText(text, sourceName){
  const xml = musicXmlParseDocument(text);
  const root = xml.documentElement;
  if (musicXmlLocalName(root) !== "score-partwise"){
    throw new Error("현재는 score-partwise MusicXML만 열 수 있어요.");
  }

  const warnings = new Set();
  const parts = musicXmlChildren(root, "part");
  if (!parts.length) throw new Error("MusicXML에 연주 파트가 없어요.");
  const part = parts[0];
  const titleNode = musicXmlFirstDescendant(root, "work-title") || musicXmlFirstDescendant(root, "movement-title");
  const sheet = musicEmpty((titleNode && String(titleNode.textContent || "").trim()) || musicXmlSourceTitle(sourceName));
  sheet.measures = [];

  let divisions = 1;
  const selectedVoices = { treble:[], bass:[] };
  let timeSeen = false;
  let keySeen = false;
  let clefSeen = false;
  let tempoSeen = false;

  const measures = musicXmlChildren(part, "measure");
  for (let measureIndex = 0; measureIndex < measures.length; measureIndex++){
    const xmlMeasure = measures[measureIndex];
    const measure = musicMeasure([], {
      lineBreakBefore:measureIndex > 0 && musicXmlChildren(xmlMeasure, "print")
        .some((node) => String(node.getAttribute("new-system") || "").toLowerCase() === "yes")
    });

    for (const attributes of musicXmlChildren(xmlMeasure, "attributes")){
      const nextDivisions = Number(musicXmlText(attributes, "divisions"));
      if (nextDivisions > 0) divisions = nextDivisions;

      const time = musicXmlFirst(attributes, "time");
      if (time){
        const beats = Math.max(1, Math.min(16, Math.round(Number(musicXmlText(time, "beats")) || 4)));
        const beatValue = [2, 4, 8, 16].includes(Math.round(Number(musicXmlText(time, "beat-type"))))
          ? Math.round(Number(musicXmlText(time, "beat-type"))) : 4;
        if (!timeSeen){ sheet.time = { beats, beatValue }; timeSeen = true; }
        else if (measureIndex > 0) measure.timeChange = { beats, beatValue };
      }

      const key = musicXmlFirst(attributes, "key");
      if (key){
        const fifths = String(Math.round(Number(musicXmlText(key, "fifths")) || 0));
        const mode = musicXmlText(key, "mode").toLowerCase();
        const keyMap = mode === "minor" ? MUSIC_XML_FIFTHS_TO_MINOR_KEY : MUSIC_XML_FIFTHS_TO_KEY;
        const nextKey = keyMap[fifths] || "C";
        if (!keyMap[fifths]) warnings.add("지원 범위를 벗어난 조표는 다장조로 가져왔어요.");
        if (!keySeen){ sheet.key = nextKey; keySeen = true; }
        else if (measureIndex > 0) measure.keyChange = nextKey;
      }

      const staves = Number(musicXmlText(attributes, "staves"));
      if (staves >= 2) sheet.grandStaff = true;
      for (const clef of musicXmlChildren(attributes, "clef")){
        const sign = musicXmlText(clef, "sign").toUpperCase();
        const number = Number(clef.getAttribute("number") || 1);
        if (sign === "F" || number === 2) sheet.grandStaff = true;
        else if (!clefSeen && sign && sign !== "G") warnings.add("지원하지 않는 음자리표는 높은음자리표 기준으로 가져왔어요.");
        clefSeen = true;
      }
    }

    const sound = musicXmlFirstDescendant(xmlMeasure, "sound");
    const soundTempo = sound && Number(sound.getAttribute("tempo"));
    const perMinute = Number(musicXmlText(musicXmlFirstDescendant(xmlMeasure, "metronome"), "per-minute"));
    const measureTempo = soundTempo > 0 ? soundTempo : perMinute;
    if (measureTempo > 0){
      if (!tempoSeen){ sheet.tempo = musicClampTempo(measureTempo); tempoSeen = true; }
      else if (measureIndex > 0) measure.tempoChange = musicClampTempo(measureTempo);
    }

    for (const barline of musicXmlChildren(xmlMeasure, "barline")){
      const repeat = musicXmlFirst(barline, "repeat");
      const direction = repeat && String(repeat.getAttribute("direction") || "").toLowerCase();
      if (direction === "forward") measure.repeatStart = true;
      if (direction === "backward") measure.repeatEnd = true;
      const ending = musicXmlFirst(barline, "ending");
      const endingNumber = Math.round(Number(ending && String(ending.getAttribute("number") || "").split(",")[0]) || 0);
      if (endingNumber === 1 || endingNumber === 2) measure.ending = endingNumber;
    }

    const pendingHarmony = { treble:"", bass:"" };
    const pendingDynamic = { treble:"", bass:"" };
    const pendingPedal = { treble:"", bass:"" };
    const lastNote = Object.create(null);
    for (const child of Array.from(xmlMeasure.childNodes || []).filter((node) => node && node.nodeType === 1)){
      const childName = musicXmlLocalName(child);
      if (childName === "harmony"){
        const staff = Number(musicXmlText(child, "staff")) === 2 ? "bass" : "treble";
        const kind = musicXmlFirst(child, "kind");
        let symbol = kind && String(kind.getAttribute("text") || "").trim();
        if (!symbol){
          const root = musicXmlFirst(child, "root");
          const rootStep = musicXmlText(root, "root-step");
          const rootAlter = Number(musicXmlText(root, "root-alter")) || 0;
          const mark = rootAlter > 0 ? "♯".repeat(rootAlter) : rootAlter < 0 ? "♭".repeat(-rootAlter) : "";
          const kindText = musicXmlText(kind).toLowerCase();
          const suffix = kindText === "minor" ? "m" : kindText === "dominant" ? "7" : "";
          symbol = rootStep + mark + suffix;
        }
        pendingHarmony[staff] = musicClampChordSymbol(symbol);
        continue;
      }
      if (childName === "direction"){
        const directionStaff = Number(musicXmlText(child, "staff")) === 2 ? "bass" : "treble";
        const dynamics = musicXmlFirstDescendant(child, "dynamics");
        if (dynamics){
          const name = musicXmlChildren(dynamics, "pp").length ? "pp"
            : musicXmlChildren(dynamics, "p").length ? "p"
            : musicXmlChildren(dynamics, "mp").length ? "mp"
            : musicXmlChildren(dynamics, "mf").length ? "mf"
            : musicXmlChildren(dynamics, "ff").length ? "ff"
            : musicXmlChildren(dynamics, "f").length ? "f" : "";
          if (name) pendingDynamic[directionStaff] = name;
        }
        const pedal = musicXmlFirstDescendant(child, "pedal");
        if (pedal){
          const type = String(pedal.getAttribute("type") || "").toLowerCase();
          if (type === "start" || type === "stop") pendingPedal[directionStaff] = type;
        }
        continue;
      }
      if (childName !== "note") continue;
      const xmlNote = child;
      if (musicXmlFirst(xmlNote, "grace")){ warnings.add("꾸밈음은 가져오지 않았어요."); continue; }

      const staff = Number(musicXmlText(xmlNote, "staff")) === 2 ? "bass" : "treble";
      if (staff === "bass") sheet.grandStaff = true;
      const voice = musicXmlText(xmlNote, "voice") || (staff === "bass" ? "2" : "1");
      if (!selectedVoices[staff].includes(voice)) selectedVoices[staff].push(voice);
      const voiceIndex = selectedVoices[staff].indexOf(voice);
      if (voiceIndex > 1){ warnings.add("각 오선의 성부는 두 개까지만 가져왔어요."); continue; }
      const editorVoice = voiceIndex + 1;
      const voiceKey = `${staff}:${editorVoice}`;

      const timeModification = musicXmlFirst(xmlNote, "time-modification");
      const isTriplet = !!timeModification && Number(musicXmlText(timeModification, "actual-notes")) === 3
        && Number(musicXmlText(timeModification, "normal-notes")) === 2;
      if (timeModification && !isTriplet) warnings.add("지원하지 않는 잇단음표는 가까운 길이로 바꿨어요.");
      const tieStart = musicXmlChildren(xmlNote, "tie").some((tie) => tie.getAttribute("type") === "start")
        || musicXmlDescendants(xmlNote, "tied").some((tie) => tie.getAttribute("type") === "start");
      const type = musicXmlText(xmlNote, "type");
      const dots = musicXmlChildren(xmlNote, "dot").length;
      const duration = musicXmlText(xmlNote, "duration");
      const length = musicXmlSupportedDuration(type, dots, duration, divisions, warnings);
      const targetNotes = musicVoiceNotes(measure, staff, editorVoice);
      const isChord = !!musicXmlFirst(xmlNote, "chord");
      if (musicXmlFirst(xmlNote, "rest")){
        if (!isChord){
          const rest = musicRest(length.value, length.dots);
          if (isTriplet) rest.tuplet = 3;
          targetNotes.push(rest);
          lastNote[voiceKey] = rest;
        }
        continue;
      }

      const pitchNode = musicXmlFirst(xmlNote, "pitch");
      const step = musicXmlText(pitchNode, "step").toUpperCase();
      const octave = Math.round(Number(musicXmlText(pitchNode, "octave")));
      const alter = Math.round(Number(musicXmlText(pitchNode, "alter")) || 0);
      if (MUSIC_STEP_SEMITONES[step] === undefined || !Number.isFinite(octave)){
        warnings.add("음높이를 알 수 없는 음표는 건너뛰었어요.");
        continue;
      }
      const pitch = { step, octave, alter };
      if (isChord && lastNote[voiceKey] && !lastNote[voiceKey].rest){
        musicAddChordPitch(lastNote[voiceKey], pitch);
        if (tieStart) lastNote[voiceKey].tieToNext = true;
        continue;
      }
      const notations = musicXmlFirst(xmlNote, "notations");
      const slurStart = musicXmlDescendants(notations, "slur").some((item) => item.getAttribute("type") === "start");
      const lyric = musicXmlText(musicXmlFirst(xmlNote, "lyric"), "text");
      const dynamicNode = musicXmlFirstDescendant(notations, "dynamics");
      const dynamic = dynamicNode && musicXmlChildren(dynamicNode, "pp").length ? "pp"
        : dynamicNode && musicXmlChildren(dynamicNode, "p").length ? "p"
        : dynamicNode && musicXmlChildren(dynamicNode, "mp").length ? "mp"
        : dynamicNode && musicXmlChildren(dynamicNode, "mf").length ? "mf"
        : dynamicNode && musicXmlChildren(dynamicNode, "ff").length ? "ff"
        : dynamicNode && musicXmlChildren(dynamicNode, "f").length ? "f" : "";
      const articulationNode = musicXmlFirstDescendant(notations, "articulations");
      const articulation = musicXmlFirst(articulationNode, "staccato") ? "staccato"
        : musicXmlFirst(articulationNode, "accent") ? "accent"
        : musicXmlFirst(articulationNode, "tenuto") ? "tenuto" : "";
      const fingering = Number(musicXmlText(musicXmlFirstDescendant(notations, "technical"), "fingering"));
      const note = musicNote(step, octave, { alter, value:length.value, dots:length.dots,
        tieToNext:tieStart, slurToNext:slurStart, chordSymbol:pendingHarmony[staff], lyric,
        dynamic:dynamic || pendingDynamic[staff], articulation, fingering, pedal:pendingPedal[staff],
        tuplet:isTriplet ? 3 : undefined });
      pendingHarmony[staff] = "";
      pendingDynamic[staff] = "";
      pendingPedal[staff] = "";
      if (!musicMidiInRange(musicMidiNumber(note), staff)) warnings.add("일부 음은 편집기의 권장 음역 밖에 있어요.");
      targetNotes.push(note);
      lastNote[voiceKey] = note;
    }
    if (measureIndex === 0 && String(xmlMeasure.getAttribute("implicit") || "").toLowerCase() === "yes"){
      const used = Math.max(musicMeasureUsedTicks(measure, "treble", 1), musicMeasureUsedTicks(measure, "treble", 2),
        musicMeasureUsedTicks(measure, "bass", 1), musicMeasureUsedTicks(measure, "bass", 2));
      if (used > 0) measure.pickupTicks = used;
    }
    sheet.measures.push(measure);
  }

  if (!sheet.measures.length) sheet.measures.push(musicMeasure());
  sheet.measures[0].lineBreakBefore = false;
  const partId = String(part.getAttribute("id") || "P1");
  const scorePart = musicXmlChildren(musicXmlFirst(root, "part-list"), "score-part")
    .find((node) => String(node.getAttribute("id") || "") === partId);
  const firstName = musicClampText(musicXmlText(scorePart, "part-name"), 80) || "악기 1";
  const inferTimbre = (name) => {
    const value = String(name || "").toLowerCase();
    if (/guitar|기타/.test(value)) return "guitar";
    if (/xylophone|실로폰|마림바/.test(value)) return "xylophone";
    if (/harp|하프/.test(value)) return "harp";
    if (/flute|플루트/.test(value)) return "flute";
    if (/clarinet|클라리넷/.test(value)) return "clarinet";
    return "piano";
  };
  const firstPart = musicPart(firstName, { id:`xml-${partId}`, timbre:inferTimbre(firstName),
    volume:1, grandStaff:sheet.grandStaff, measures:sheet.measures });
  sheet.parts = [firstPart];
  sheet.activePartId = firstPart.id;
  sheet.timbre = firstPart.timbre;

  if (parts.length > 1 && typeof XMLSerializer !== "undefined"){
    const serializer = new XMLSerializer();
    for (let partIndex = 1; partIndex < parts.length; partIndex++){
      const isolatedRoot = root.cloneNode(true);
      const isolatedParts = musicXmlChildren(isolatedRoot, "part");
      isolatedParts.forEach((node, index) => { if (index !== partIndex) node.parentNode.removeChild(node); });
      const isolatedList = musicXmlFirst(isolatedRoot, "part-list");
      const selectedId = String(parts[partIndex].getAttribute("id") || `P${partIndex + 1}`);
      for (const node of musicXmlChildren(isolatedList, "score-part")){
        if (String(node.getAttribute("id") || "") !== selectedId) node.parentNode.removeChild(node);
      }
      const imported = musicParseXmlText(serializer.serializeToString(isolatedRoot), sourceName);
      const importedPart = musicActivePart(imported.sheet);
      if (importedPart){
        importedPart.id = `xml-${selectedId}`;
        sheet.parts.push(importedPart);
      }
      for (const warning of imported.warnings) warnings.add(warning);
    }
  } else if (parts.length > 1){
    warnings.add("이 환경에서는 추가 악기 파트를 가져오지 못했어요.");
  }
  sheet.updatedAt = Date.now();
  return { sheet, warnings:Array.from(warnings) };
}

function musicXmlEscape(value){
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function musicSerializeXmlSingle(sheet){
  const model = sheet || musicEmpty();
  const title = musicXmlEscape(model.title || "악보");
  const grandStaff = model.grandStaff === true;
  const measures = Array.isArray(model.measures) && model.measures.length ? model.measures : [musicMeasure()];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${title}</work-title></work>`,
    '  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>',
    '  <part id="P1">'
  ];
  const exportTies = { "treble:1":new Set(), "treble:2":new Set(), "bass:1":new Set(), "bass:2":new Set() };
  const exportSlurs = { "treble:1":false, "treble:2":false, "bass:1":false, "bass:2":false };

  measures.forEach((measure, index) => {
    const effective = musicEffectiveMeasureSettings(model, index);
    const effectiveKey = MUSIC_KEYS[effective.key] || MUSIC_KEYS.C;
    const effectiveFifths = MUSIC_XML_KEY_TO_FIFTHS[effective.key] == null ? 0 : MUSIC_XML_KEY_TO_FIFTHS[effective.key];
    lines.push(`    <measure number="${index + 1}"${measure && measure.pickupTicks ? ' implicit="yes"' : ""}>`);
    if (index > 0 && measure && measure.lineBreakBefore === true) lines.push('      <print new-system="yes"/>');
    if (index === 0 || (measure && (measure.timeChange || measure.keyChange))){
      lines.push('      <attributes>');
      if (index === 0) lines.push(`        <divisions>${MUSIC_TICKS_PER_QUARTER}</divisions>`);
      if (index === 0 || measure.keyChange){
        lines.push(`        <key><fifths>${effectiveFifths}</fifths><mode>${effectiveKey.mode}</mode></key>`);
      }
      if (index === 0 || measure.timeChange){
        lines.push(`        <time><beats>${effective.time.beats}</beats><beat-type>${effective.time.beatValue}</beat-type></time>`);
      }
      if (index === 0 && grandStaff){
        lines.push('        <staves>2</staves>');
        lines.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
        lines.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      } else if (index === 0) {
        lines.push('        <clef><sign>G</sign><line>2</line></clef>');
      }
      lines.push('      </attributes>');
    }
    if (index === 0 || (measure && measure.tempoChange)){
      lines.push('      <direction placement="above">');
      lines.push(`        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${effective.tempo}</per-minute></metronome></direction-type>`);
      lines.push(`        <sound tempo="${effective.tempo}"/>`);
      lines.push('      </direction>');
    }

    if (measure && (measure.repeatStart || measure.ending)){
      lines.push('      <barline location="left">');
      if (measure.ending) lines.push(`        <ending number="${measure.ending}" type="start"/>`);
      if (measure.repeatStart) lines.push('        <repeat direction="forward"/>');
      lines.push('      </barline>');
    }

    function emitStaff(notes, staffNumber, voiceNumber, staffName){
      const voiceKey = `${staffName}:${voiceNumber}`;
      const tiedFromPrevious = exportTies[voiceKey];
      if (!notes.length){ tiedFromPrevious.clear(); exportSlurs[voiceKey] = false; return; }
      for (const note of notes){
        const value = MUSIC_XML_VALUE_TO_TYPE[note.value] || "quarter";
        if (note.chordSymbol && !note.rest){
          const rootAlter = musicClampAlter(note.alter);
          lines.push('      <harmony>');
          lines.push(`        <root><root-step>${musicXmlEscape(note.step || "C")}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ""}</root>`);
          lines.push(`        <kind text="${musicXmlEscape(note.chordSymbol)}">other</kind>`);
          if (grandStaff) lines.push(`        <staff>${staffNumber}</staff>`);
          lines.push('      </harmony>');
        }
        if (note.pedal && !note.rest){
          lines.push('      <direction placement="below">');
          lines.push(`        <direction-type><pedal type="${note.pedal === "stop" ? "stop" : "start"}"/></direction-type>`);
          if (grandStaff) lines.push(`        <staff>${staffNumber}</staff>`);
          lines.push('      </direction>');
        }
        const pitches = note.rest ? [null] : [{ step:note.step, octave:note.octave, alter:note.alter },
          ...(Array.isArray(note.chord) ? note.chord : [])];
        const nextTies = new Set();
        pitches.forEach((pitch, pitchIndex) => {
          const pitchKey = musicPitchKey(pitch);
          const tieStop = !!pitch && tiedFromPrevious.has(pitchKey);
          const tieStart = !!pitch && note.tieToNext === true;
          const slurStop = pitchIndex === 0 && exportSlurs[voiceKey] === true;
          const slurStart = pitchIndex === 0 && note.slurToNext === true;
          lines.push('      <note>');
          if (pitchIndex > 0) lines.push('        <chord/>');
          if (!pitch) lines.push('        <rest/>');
          else {
            lines.push('        <pitch>');
            lines.push(`          <step>${musicXmlEscape(pitch.step || "C")}</step>`);
            const alter = musicClampAlter(pitch.alter);
            if (alter) lines.push(`          <alter>${alter}</alter>`);
            lines.push(`          <octave>${Math.round(Number(pitch.octave) || 4)}</octave>`);
            lines.push('        </pitch>');
          }
          lines.push(`        <duration>${musicNoteTicks(note) || MUSIC_TICKS_PER_QUARTER}</duration>`);
          lines.push(`        <voice>${voiceNumber}</voice>`);
          lines.push(`        <type>${value}</type>`);
          for (let dot = 0; dot < musicClampDots(note.dots); dot++) lines.push('        <dot/>');
          if (note.tuplet === 3){
            lines.push('        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
          }
          if (tieStop) lines.push('        <tie type="stop"/>');
          if (tieStart) lines.push('        <tie type="start"/>');
          if (grandStaff) lines.push(`        <staff>${staffNumber}</staff>`);
          const hasExpression = pitchIndex === 0 && (slurStop || slurStart || note.dynamic || note.articulation || note.fingering);
          if (tieStop || tieStart || hasExpression){
            lines.push('        <notations>');
            if (tieStop) lines.push('          <tied type="stop"/>');
            if (tieStart) lines.push('          <tied type="start"/>');
            if (slurStop) lines.push('          <slur type="stop" number="1"/>');
            if (slurStart) lines.push('          <slur type="start" number="1"/>');
            if (pitchIndex === 0 && note.dynamic) lines.push(`          <dynamics><${note.dynamic}/></dynamics>`);
            if (pitchIndex === 0 && note.articulation){
              lines.push(`          <articulations><${note.articulation}/></articulations>`);
            }
            if (pitchIndex === 0 && note.fingering){
              lines.push(`          <technical><fingering>${note.fingering}</fingering></technical>`);
            }
            lines.push('        </notations>');
          }
          if (pitchIndex === 0 && note.lyric){
            lines.push(`        <lyric><text>${musicXmlEscape(note.lyric)}</text></lyric>`);
          }
          lines.push('      </note>');
          if (tieStart) nextTies.add(pitchKey);
        });
        tiedFromPrevious.clear();
        for (const key of nextTies) tiedFromPrevious.add(key);
        exportSlurs[voiceKey] = note.slurToNext === true;
      }
    }

    function backup(ticks){
      if (ticks <= 0) return;
      lines.push('      <backup>');
      lines.push(`        <duration>${ticks}</duration>`);
      lines.push('      </backup>');
    }
    const treble1 = musicVoiceNotes(measure, "treble", 1);
    const treble2 = musicVoiceNotes(measure, "treble", 2);
    emitStaff(treble1, 1, 1, "treble");
    let trebleCursor = musicMeasureUsedTicks(measure, "treble", 1);
    if (treble2.length){
      backup(trebleCursor);
      emitStaff(treble2, 1, 2, "treble");
      trebleCursor = musicMeasureUsedTicks(measure, "treble", 2);
    } else emitStaff([], 1, 2, "treble");
    if (grandStaff){
      backup(trebleCursor);
      const bass1 = musicVoiceNotes(measure, "bass", 1);
      const bass2 = musicVoiceNotes(measure, "bass", 2);
      emitStaff(bass1, 2, 1, "bass");
      const bass1Ticks = musicMeasureUsedTicks(measure, "bass", 1);
      if (bass2.length){ backup(bass1Ticks); emitStaff(bass2, 2, 2, "bass"); }
      else emitStaff([], 2, 2, "bass");
    }
    if (measure && (measure.repeatEnd || measure.ending)){
      lines.push('      <barline location="right">');
      if (measure.ending) lines.push(`        <ending number="${measure.ending}" type="stop"/>`);
      if (measure.repeatEnd) lines.push('        <repeat direction="backward"/>');
      lines.push('      </barline>');
    }
    lines.push('    </measure>');
  });
  lines.push('  </part>', '</score-partwise>', '');
  return lines.join("\n");
}

function musicSerializeXml(sheet){
  const model = sheet || musicEmpty();
  musicSyncActivePart(model);
  const parts = musicParts(model);
  if (!parts.length) return musicSerializeXmlSingle(model);
  const bodies = [];
  parts.forEach((part, index) => {
    const id = `P${index + 1}`;
    const single = musicSerializeXmlSingle(musicPartSheet(model, part));
    const match = single.match(/  <part id="P1">[\s\S]*?  <\/part>/);
    if (match) bodies.push(match[0].replace('<part id="P1">', `<part id="${id}">`));
  });
  const title = musicXmlEscape(model.title || "악보");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${title}</work-title></work>`,
    '  <part-list>'
  ];
  parts.forEach((part, index) => {
    lines.push(`    <score-part id="P${index + 1}"><part-name>${musicXmlEscape(part.name || `악기 ${index + 1}`)}</part-name></score-part>`);
  });
  lines.push('  </part-list>', ...bodies, '</score-partwise>', '');
  return lines.join("\n");
}

async function musicXmlZipEntryText(entry){
  if (!entry) return "";
  if (typeof entry.async === "function") return entry.async("string");
  if (typeof entry.asText === "function") return entry.asText();
  return "";
}

async function musicXmlReadMxl(file){
  if (typeof MNLazy === "undefined" || !(await MNLazy.tryNeed("jszip"))) throw new Error("압축 MusicXML을 읽는 도구를 준비하지 못했어요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const Zip = (typeof globalThis !== "undefined") ? globalThis.JSZip : null;
  if (!Zip) throw new Error("압축 MusicXML을 읽는 도구를 준비하지 못했어요.");
  const zip = (typeof Zip.loadAsync === "function") ? await Zip.loadAsync(bytes) : new Zip(bytes);
  const containerEntry = zip.file("META-INF/container.xml");
  let scorePath = "";
  if (containerEntry){
    const containerText = await musicXmlZipEntryText(containerEntry);
    const container = musicXmlParseDocument(containerText);
    const rootfile = musicXmlFirstDescendant(container, "rootfile");
    scorePath = rootfile ? String(rootfile.getAttribute("full-path") || "") : "";
  }
  scorePath = scorePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!scorePath || scorePath.split("/").includes("..")){
    const names = Object.keys(zip.files || {}).filter((name) => !/^META-INF\//i.test(name) && /\.(?:musicxml|xml)$/i.test(name));
    scorePath = names[0] || "";
  }
  const entry = scorePath && zip.file(scorePath);
  if (!entry) throw new Error("압축 파일 안에서 MusicXML 악보를 찾지 못했어요.");
  return musicXmlZipEntryText(entry);
}

function musicXmlDerivedName(name){
  return musicXmlSourceTitle(name) + ".msheet";
}

function musicXmlDerivedPath(path){
  if (!path) return path;
  const value = String(path);
  return /\.(?:musicxml|mxl)$/i.test(value) ? value.replace(/\.(?:musicxml|mxl)$/i, ".msheet") : value + ".msheet";
}

async function loadMusicXml(file, opts = {}){
  try {
    const ext = String(file && file.name || "").split(".").pop().toLowerCase();
    const text = ext === "mxl" ? await musicXmlReadMxl(file) : await file.text();
    const imported = musicParseXmlText(text, file.name);
    const name = musicXmlDerivedName(file.name);
    const derived = new File([musicSerialize(imported.sheet)], name, { type:"application/json" });
    const derivedOpts = {
      ...opts,
      isScratch:true,
      fsHandle:null,
      nativeAbsolutePath:null,
      sqliteDiskPath:null,
      originalSaveMode:false,
      textEncoding:null,
      workspacePath:musicXmlDerivedPath(opts.workspacePath),
      relPath:musicXmlDerivedPath(opts.relPath),
      sourceKey:opts.sourceKey || file.name
    };
    const doc = await loadMusicSheet(derived, derivedOpts);
    if (doc){
      doc.importedFromMusicXml = file.name;
      doc.musicImportWarnings = imported.warnings;
    }
    if (typeof toast === "function"){
      const detail = imported.warnings.length ? ` ${imported.warnings.join(" ")}` : "";
      toast(`MusicXML을 편집용 악보로 가져왔어요.${detail}`, imported.warnings.length ? 6500 : 2600);
    }
    return doc;
  } catch(error){
    console.error(error);
    if (typeof toast === "function") toast(error && error.message ? error.message : "MusicXML을 열지 못했어요.", 4200, { type:"error" });
    return null;
  }
}
