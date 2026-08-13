"use strict";

/* ===== MusicXML 호환 계층 =====
   현재 .msheet 편집기가 표현할 수 있는 한 성부·높은음자리표 범위로 MusicXML을 가져오고,
   편집한 악보를 표준 score-partwise MusicXML로 내보낸다. 압축형 .mxl은 이미 제품에
   포함된 JSZip을 지연 로드해 읽으므로 EXE가 인터넷에 연결되거나 별도 설치를 할 필요가 없다. */

const MUSIC_XML_KEY_TO_FIFTHS = { C:0, G:1, D:2, F:-1, Bb:-2 };
const MUSIC_XML_FIFTHS_TO_KEY = { "0":"C", "1":"G", "2":"D", "-1":"F", "-2":"Bb" };
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
  if (parts.length > 1) warnings.add("여러 파트 중 첫 번째 파트만 가져왔어요.");
  const part = parts[0];
  const titleNode = musicXmlFirstDescendant(root, "work-title") || musicXmlFirstDescendant(root, "movement-title");
  const sheet = musicEmpty((titleNode && String(titleNode.textContent || "").trim()) || musicXmlSourceTitle(sourceName));
  sheet.measures = [];

  let divisions = 1;
  let selectedVoice = null;
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
        else if (sheet.time.beats !== beats || sheet.time.beatValue !== beatValue){
          warnings.add("중간 박자표 변경은 첫 박자표로 통일했어요.");
        }
      }

      const key = musicXmlFirst(attributes, "key");
      if (key){
        const fifths = String(Math.round(Number(musicXmlText(key, "fifths")) || 0));
        const nextKey = MUSIC_XML_FIFTHS_TO_KEY[fifths] || "C";
        if (!MUSIC_XML_FIFTHS_TO_KEY[fifths]) warnings.add("지원 범위를 벗어난 조표는 다장조로 가져왔어요.");
        if (!keySeen){ sheet.key = nextKey; keySeen = true; }
        else if (sheet.key !== nextKey) warnings.add("중간 조표 변경은 첫 조표로 통일했어요.");
      }

      const clef = musicXmlFirst(attributes, "clef");
      if (clef){
        const sign = musicXmlText(clef, "sign").toUpperCase();
        if (!clefSeen && sign && sign !== "G") warnings.add("높은음자리표 기준으로 가져왔어요.");
        clefSeen = true;
      }
    }

    if (!tempoSeen){
      const sound = musicXmlFirstDescendant(xmlMeasure, "sound");
      const soundTempo = sound && Number(sound.getAttribute("tempo"));
      const perMinute = Number(musicXmlText(musicXmlFirstDescendant(xmlMeasure, "metronome"), "per-minute"));
      const tempo = soundTempo > 0 ? soundTempo : perMinute;
      if (tempo > 0){ sheet.tempo = musicClampTempo(tempo); tempoSeen = true; }
    }

    for (const xmlNote of musicXmlChildren(xmlMeasure, "note")){
      if (musicXmlFirst(xmlNote, "grace")){ warnings.add("꾸밈음은 가져오지 않았어요."); continue; }
      if (musicXmlFirst(xmlNote, "chord")){ warnings.add("화음은 가장 먼저 나온 음만 가져왔어요."); continue; }

      const voice = musicXmlText(xmlNote, "voice") || "1";
      if (selectedVoice === null) selectedVoice = voice;
      if (voice !== selectedVoice){ warnings.add("여러 성부 중 첫 번째 성부만 가져왔어요."); continue; }

      if (musicXmlFirst(xmlNote, "time-modification")) warnings.add("셋잇단음표 등 특수 길이는 가까운 길이로 바꿨어요.");
      if (musicXmlChildren(xmlNote, "tie").length || musicXmlFirst(xmlNote, "notations")){
        if (musicXmlChildren(xmlNote, "tie").length || musicXmlDescendants(xmlNote, "tied").length)
          warnings.add("붙임줄은 개별 음표로 가져왔어요.");
      }

      const type = musicXmlText(xmlNote, "type");
      const dots = musicXmlChildren(xmlNote, "dot").length;
      const duration = musicXmlText(xmlNote, "duration");
      const length = musicXmlSupportedDuration(type, dots, duration, divisions, warnings);
      if (musicXmlFirst(xmlNote, "rest")){
        measure.notes.push(musicRest(length.value, length.dots));
        continue;
      }

      const pitch = musicXmlFirst(xmlNote, "pitch");
      const step = musicXmlText(pitch, "step").toUpperCase();
      const octave = Math.round(Number(musicXmlText(pitch, "octave")));
      const alter = Math.round(Number(musicXmlText(pitch, "alter")) || 0);
      if (MUSIC_STEP_SEMITONES[step] === undefined || !Number.isFinite(octave)){
        warnings.add("음높이를 알 수 없는 음표는 건너뛰었어요.");
        continue;
      }
      const note = musicNote(step, octave, { alter, value:length.value, dots:length.dots });
      if (!musicMidiInRange(musicMidiNumber(note))) warnings.add("일부 음은 편집기의 권장 음역 밖에 있어요.");
      measure.notes.push(note);
    }
    sheet.measures.push(measure);
  }

  if (!sheet.measures.length) sheet.measures.push(musicMeasure());
  sheet.measures[0].lineBreakBefore = false;
  sheet.updatedAt = Date.now();
  return { sheet, warnings:Array.from(warnings) };
}

function musicXmlEscape(value){
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function musicSerializeXml(sheet){
  const model = sheet || musicEmpty();
  const title = musicXmlEscape(model.title || "악보");
  const beats = Math.max(1, Math.round(Number(model.time && model.time.beats) || 4));
  const beatValue = Math.max(1, Math.round(Number(model.time && model.time.beatValue) || 4));
  const fifths = MUSIC_XML_KEY_TO_FIFTHS[model.key] == null ? 0 : MUSIC_XML_KEY_TO_FIFTHS[model.key];
  const tempo = musicClampTempo(model.tempo);
  const measures = Array.isArray(model.measures) && model.measures.length ? model.measures : [musicMeasure()];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${title}</work-title></work>`,
    '  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>',
    '  <part id="P1">'
  ];

  measures.forEach((measure, index) => {
    lines.push(`    <measure number="${index + 1}">`);
    if (index > 0 && measure && measure.lineBreakBefore === true) lines.push('      <print new-system="yes"/>');
    if (index === 0){
      lines.push('      <attributes>');
      lines.push(`        <divisions>${MUSIC_TICKS_PER_QUARTER}</divisions>`);
      lines.push(`        <key><fifths>${fifths}</fifths></key>`);
      lines.push(`        <time><beats>${beats}</beats><beat-type>${beatValue}</beat-type></time>`);
      lines.push('        <clef><sign>G</sign><line>2</line></clef>');
      lines.push('      </attributes>');
      lines.push('      <direction placement="above">');
      lines.push(`        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type>`);
      lines.push(`        <sound tempo="${tempo}"/>`);
      lines.push('      </direction>');
    }

    for (const note of ((measure && Array.isArray(measure.notes)) ? measure.notes : [])){
      const value = MUSIC_XML_VALUE_TO_TYPE[note.value] || "quarter";
      lines.push('      <note>');
      if (note.rest) lines.push('        <rest/>');
      else {
        lines.push('        <pitch>');
        lines.push(`          <step>${musicXmlEscape(note.step || "C")}</step>`);
        const alter = musicClampAlter(note.alter);
        if (alter) lines.push(`          <alter>${alter}</alter>`);
        lines.push(`          <octave>${Math.round(Number(note.octave) || 4)}</octave>`);
        lines.push('        </pitch>');
      }
      lines.push(`        <duration>${musicNoteTicks(note) || MUSIC_TICKS_PER_QUARTER}</duration>`);
      lines.push('        <voice>1</voice>');
      lines.push(`        <type>${value}</type>`);
      for (let dot = 0; dot < musicClampDots(note.dots); dot++) lines.push('        <dot/>');
      lines.push('      </note>');
    }
    lines.push('    </measure>');
  });
  lines.push('  </part>', '</score-partwise>', '');
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
