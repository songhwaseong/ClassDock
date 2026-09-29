"use strict";

// H.264 영상 조각(과 AAC 소리 조각)을 MP4 파일로 묶는다. 트랙마다 조각 하나에 몰아 담고 moov 를 앞에 둬 바로 재생된다.
// 영상 조각은 WebCodecs VideoEncoder 가 avc 형식(길이 앞붙임 NAL)으로 내준 그대로 쓰고, avcC 는 decoderConfig.description 이다.
// samples: [{ data:Uint8Array, key:boolean, timestamp:마이크로초 }] 를 디코딩 순서대로. B 프레임이 있으면 ctts(0 이상)와 편집 목록으로 표시 시각을 적는다.
// 조각마다 duration(마이크로초)이 있으면 장면 길이가 제각각인 영상(VFR)으로 적는다 — 수업 리플레이처럼 화면이 바뀔 때만
// 장면을 굽는 영상용이다. 이때 길이는 다음 조각의 timestamp 까지(마지막 조각만 제 duration)이고 B 프레임은 없다고 본다.
// audio(없어도 됨): { samples:[{ data }], asc:AudioSpecificConfig(=AudioEncoder 의 description), sampleRate, channels } — AAC 한 조각은 1024 표본.
const MNMp4Writer = (() => {
  const VIDEO_TIMESCALE = 90000, AAC_FRAME = 1024;
  const u32 = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
  const u16 = value => [value >>> 8 & 255, value & 255];
  const ascii = text => [...text].map(ch => ch.charCodeAt(0));
  const concat = parts => {
    const total = parts.reduce((sum, part) => sum + part.length, 0), out = new Uint8Array(total);
    let at = 0; for (const part of parts){ out.set(part, at); at += part.length; } return out;
  };
  const bytes = list => list instanceof Uint8Array ? list : Uint8Array.from(list);
  const box = (type, ...payload) => { const body = concat(payload.map(bytes)); return concat([bytes([...u32(body.length + 8), ...ascii(type)]), body]); };
  const fullBox = (type, version, flags, ...payload) => box(type, [version, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255], ...payload);
  const MATRIX = [0x00010000,0,0,0,0x00010000,0,0,0,0x40000000].flatMap(u32);
  // MPEG-4 기술자: 태그 + 길이(4바이트 늘임꼴, 플레이어들이 두루 읽는 꼴).
  const descriptor = (tag, payload) => { const body = bytes(payload); return concat([bytes([tag, 0x80, 0x80, 0x80, body.length & 0x7f]), body]); };

  // delta = 모든 조각의 같은 길이, 또는 [[개수, 길이], …] 묶음(길이가 제각각일 때).
  function sampleTables(sizes, delta, extra){
    const count = sizes.length, runs = Array.isArray(delta) ? delta : [[count, delta]];
    return [fullBox("stts", 0, 0, [...u32(runs.length), ...runs.flatMap(([n, ticks]) => [...u32(n), ...u32(ticks)])]), ...extra,
      fullBox("stsc", 0, 0, [...u32(1), ...u32(1), ...u32(count), ...u32(1)]),
      fullBox("stsz", 0, 0, [...u32(0), ...u32(count), ...sizes.flatMap(size => u32(size))])];
  }
  function track({ id, handler, timescale, durationTicks, durationMs, width = 0, height = 0, volume = 0, mediaHeader, stsd, tables, chunkOffset, edit = null }){
    const stbl = box("stbl", stsd, ...tables, fullBox("stco", 0, 0, [...u32(1), ...u32(chunkOffset)]));
    const minf = box("minf", mediaHeader, box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))), stbl);
    const mdia = box("mdia",
      fullBox("mdhd", 0, 0, [...u32(0), ...u32(0), ...u32(timescale), ...u32(durationTicks), ...u16(0x55c4), ...u16(0)]),
      fullBox("hdlr", 0, 0, [...u32(0), ...ascii(handler), ...new Array(12).fill(0), ...ascii(handler === "vide" ? "VideoHandler" : "SoundHandler"), 0]),
      minf);
    const tkhd = fullBox("tkhd", 0, 3, [...u32(0), ...u32(0), ...u32(id), ...u32(0), ...u32(durationMs), ...new Array(8).fill(0),
      ...u16(0), ...u16(0), ...u16(volume), ...u16(0), ...MATRIX, ...u32(width*65536), ...u32(height*65536)]);
    return edit ? box("trak", tkhd, edit, mdia) : box("trak", tkhd, mdia);
  }

  function mux({ width, height, fps, samples, avcC, audio = null }){
    if (!samples.length) throw new Error("mp4-no-samples");
    if (!avcC || !avcC.length) throw new Error("mp4-no-avcc");
    const withAudio = !!(audio && audio.samples && audio.samples.length && audio.asc && audio.asc.length);
    const delta = Math.round(VIDEO_TIMESCALE/fps), count = samples.length;
    // 시각이 숫자가 아니면(잘못된 입력) 받은 차례대로 본다 — NaN 이 표에 들어가면 파일이 깨진다.
    const ticks = samples.map((sample, i) => Math.round((Number.isFinite(sample.timestamp) ? sample.timestamp : i*1e6/fps)*VIDEO_TIMESCALE/1e6));
    // 조각이 수십만 개일 수 있어 Math.min(...배열) 대신 한 바퀴 돈다(펼침 인자 개수 한도).
    const least = list => list.reduce((low, value) => value < low ? value : low, Infinity), first = least(ticks);
    const variable = samples.every(sample => Number.isFinite(sample.duration) && sample.duration > 0);
    let durationRuns = delta, videoTicks = delta*count, videoMs = Math.round(count*1000/fps);
    if (variable){
      const lengths = ticks.map((tick, i) => i < count - 1 ? Math.max(1, ticks[i + 1] - tick) : Math.max(1, Math.round(samples[i].duration*VIDEO_TIMESCALE/1e6)));
      durationRuns = []; lengths.forEach(length => { const last = durationRuns[durationRuns.length - 1]; if (last && last[1] === length) last[0]++; else durationRuns.push([1, length]); });
      videoTicks = lengths.reduce((sum, length) => sum + length, 0); videoMs = Math.round(videoTicks*1000/VIDEO_TIMESCALE);
    }
    // 표시 시각 - 디코딩 시각. 모두 0 이면 B 프레임이 없는 것이라 ctts 를 넣지 않는다.
    // B 프레임이면 디코딩보다 먼저 보이는 장면(음수 어긋남)이 생긴다. 음수는 ffmpeg 등이 "pts<dts" 로 보고 장면을 잘못 세므로,
    // 표준 먹서처럼 모두를 shift 만큼 뒤로 미뤄 0 이상으로 만들고, 편집 목록(elst)으로 그 지연을 잘라 0초에 시작하게 한다.
    const raw = variable ? ticks.map(() => 0) : ticks.map((tick, i) => (tick - first) - i*delta), reordered = raw.some(offset => offset !== 0);
    const shift = reordered ? Math.max(0, -least(raw)) : 0, offsets = raw.map(offset => offset + shift);
    const videoExtra = [];
    if (reordered){
      // 같은 값이 이어지면 한 칸으로 묶는다.
      const runs = []; offsets.forEach(offset => { const last = runs[runs.length - 1]; if (last && last[1] === offset) last[0]++; else runs.push([1, offset]); });
      videoExtra.push(fullBox("ctts", 0, 0, u32(runs.length), runs.flatMap(([n, offset]) => [...u32(n), ...u32(offset)])));
    }
    const keys = samples.map((sample, i) => sample.key ? i + 1 : 0).filter(Boolean);
    videoExtra.push(fullBox("stss", 0, 0, u32(keys.length), keys.flatMap(key => u32(key))));
    const avc1 = box("avc1",
      [0,0,0,0,0,0, ...u16(1), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0),
       ...u16(width), ...u16(height), ...u32(0x00480000), ...u32(0x00480000), ...u32(0), ...u16(1),
       ...new Array(32).fill(0), ...u16(0x0018), ...u16(0xffff)],
      box("avcC", avcC));
    const videoBytes = samples.reduce((sum, sample) => sum + sample.data.length, 0);
    let audioMs = 0, audioTicks = 0, mp4a = null, audioSizes = [];
    if (withAudio){
      audioSizes = audio.samples.map(sample => sample.data.length); audioTicks = audioSizes.length*AAC_FRAME; audioMs = Math.round(audioTicks*1000/audio.sampleRate);
      const esds = fullBox("esds", 0, 0, descriptor(3, [...u16(2), 0,
        ...descriptor(4, [0x40, 0x15, 0, 0, 0, ...u32(0), ...u32(0), ...descriptor(5, audio.asc)]),
        ...descriptor(6, [2])]));
      mp4a = box("mp4a", [0,0,0,0,0,0, ...u16(1), ...u32(0), ...u32(0), ...u16(audio.channels), ...u16(16), ...u16(0), ...u16(0), ...u32(audio.sampleRate*65536 >>> 0)], esds);
    }
    const totalMs = Math.max(videoMs, audioMs);
    const build = mediaStart => {
      const traks = [track({ id:1, handler:"vide", timescale:VIDEO_TIMESCALE, durationTicks:videoTicks, durationMs:videoMs, width, height,
        mediaHeader:fullBox("vmhd", 0, 1, [0,0,0,0,0,0,0,0]), stsd:fullBox("stsd", 0, 0, u32(1), avc1),
        tables:sampleTables(samples.map(sample => sample.data.length), durationRuns, videoExtra), chunkOffset:mediaStart,
        edit:shift ? box("edts", fullBox("elst", 0, 0, [...u32(1), ...u32(videoMs), ...u32(shift), ...u16(1), ...u16(0)])) : null })];
      if (withAudio) traks.push(track({ id:2, handler:"soun", timescale:audio.sampleRate, durationTicks:audioTicks, durationMs:audioMs, volume:0x0100,
        mediaHeader:fullBox("smhd", 0, 0, [0,0,0,0]), stsd:fullBox("stsd", 0, 0, u32(1), mp4a),
        tables:sampleTables(audioSizes, AAC_FRAME, []), chunkOffset:mediaStart + videoBytes }));
      const mvhd = fullBox("mvhd", 0, 0, [...u32(0), ...u32(0), ...u32(1000), ...u32(totalMs), ...u32(0x00010000), ...u16(0x0100), ...u16(0),
        ...new Array(8).fill(0), ...MATRIX, ...new Array(24).fill(0), ...u32(withAudio ? 3 : 2)]);
      return box("moov", mvhd, ...traks);
    };
    const ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomiso2avc1mp41"));
    // 조각 시작 위치(stco)는 moov 크기를 알아야 정해지므로 한 번 재 보고 다시 만든다(숫자 크기만 바뀌어 길이는 같다).
    const moovSize = build(0).length, mediaStart = ftyp.length + moovSize + 8;
    const media = concat([...samples.map(sample => sample.data), ...(withAudio ? audio.samples.map(sample => sample.data) : [])]);
    return concat([ftyp, build(mediaStart), bytes([...u32(media.length + 8), ...ascii("mdat")]), media]);
  }
  return { mux };
})();
