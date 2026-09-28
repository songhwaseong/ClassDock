"use strict";

// 움직이는 GIF(GIF89a) 만들기. 외부 라이브러리 없이 색 줄이기(미디언 컷, 256색)와 LZW 압축만 한다.
// 모든 장면이 한 팔레트를 함께 쓴다(사진 바탕은 거의 그대로라 장면마다 팔레트를 바꿀 필요가 적고 파일도 작다).
const MNGifEncoder = (() => {
  // 여러 장면에서 고르게 뽑은 색으로 팔레트를 만든다. 결과는 [r,g,b,...] 로 maxColors 개(2의 거듭제곱으로 채움).
  function buildPalette(frames, maxColors = 256){
    const samples = [];
    const total = frames.reduce((sum, frame) => sum + frame.width*frame.height, 0), step = Math.max(1, Math.floor(total / 90000));
    let counter = 0;
    for (const frame of frames){
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4){ if (counter++ % step === 0) samples.push(data[i] << 16 | data[i+1] << 8 | data[i+2]); }
    }
    if (!samples.length) samples.push(0);
    const palette = new Uint8Array(maxColors*3);
    // 색이 팔레트 칸보다 적으면(그림·글자 장식만 있는 경우 등) 그 색을 그대로 쓴다.
    const distinct = [...new Set(samples)];
    if (distinct.length <= maxColors){
      distinct.forEach((color, index) => { palette[index*3] = color >> 16 & 255; palette[index*3+1] = color >> 8 & 255; palette[index*3+2] = color & 255; });
      return palette;
    }
    let boxes = [samples];
    // 넓게 퍼지고 색이 많이 든 상자를 그 색 축의 가운데서 둘로 나누기를 되풀이한다(넓은 하늘 같은 곳에 색을 더 준다).
    while (boxes.length < maxColors){
      let best = -1, bestScore = 0, bestShift = 16;
      boxes.forEach((box, index) => {
        if (box.length < 2) return;
        for (const shift of [16, 8, 0]){
          let lo = 255, hi = 0; for (const color of box){ const value = color >> shift & 255; if (value < lo) lo = value; if (value > hi) hi = value; }
          const score = (hi - lo) * Math.sqrt(box.length);
          if (hi > lo && score > bestScore){ bestScore = score; best = index; bestShift = shift; }
        }
      });
      if (best < 0) break;
      const box = boxes[best].sort((a, b) => (a >> bestShift & 255) - (b >> bestShift & 255)), value = i => box[i] >> bestShift & 255;
      // 같은 값이 두 상자로 갈리지 않게, 가운데에서 가장 가까운 "값이 바뀌는 자리"에서 자른다.
      let cut = -1;
      for (let offset = 0; offset < box.length; offset++){
        const up = (box.length >> 1) + offset, down = (box.length >> 1) - offset;
        if (up > 0 && up < box.length && value(up - 1) !== value(up)){ cut = up; break; }
        if (down > 0 && down < box.length && value(down - 1) !== value(down)){ cut = down; break; }
      }
      if (cut < 0) break;
      boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
    }
    boxes.forEach((box, index) => {
      let r = 0, g = 0, b = 0; for (const color of box){ r += color >> 16 & 255; g += color >> 8 & 255; b += color & 255; }
      palette[index*3] = Math.round(r/box.length); palette[index*3+1] = Math.round(g/box.length); palette[index*3+2] = Math.round(b/box.length);
    });
    return palette;
  }
  // 색마다 가장 가까운 팔레트 번호. 5비트씩(32768칸) 묶어 한 번 찾은 답을 기억한다.
  function indexer(palette){
    const cache = new Int16Array(32768).fill(-1), count = palette.length/3;
    return (r, g, b) => {
      const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
      let found = cache[key];
      if (found < 0){
        const cr = (r & 0xf8) | 4, cg = (g & 0xf8) | 4, cb = (b & 0xf8) | 4; let best = Infinity;
        for (let i = 0; i < count; i++){
          const dr = palette[i*3] - cr, dg = palette[i*3+1] - cg, db = palette[i*3+2] - cb, distance = dr*dr*2 + dg*dg*4 + db*db*3;
          if (distance < best){ best = distance; found = i; }
        }
        cache[key] = found;
      }
      return found;
    };
  }
  // 바이트를 모아 두는 작은 버퍼.
  function writer(){
    let buffer = new Uint8Array(1 << 16), length = 0;
    const grow = extra => { if (length + extra <= buffer.length) return; let size = buffer.length; while (size < length + extra) size *= 2; const next = new Uint8Array(size); next.set(buffer.subarray(0, length)); buffer = next; };
    return {
      byte(value){ grow(1); buffer[length++] = value & 255; },
      bytes(list){ grow(list.length); buffer.set(list, length); length += list.length; },
      word(value){ this.byte(value); this.byte(value >> 8); },
      text(value){ for (const ch of value) this.byte(ch.charCodeAt(0)); },
      result(){ return buffer.slice(0, length); }
    };
  }
  // GIF 의 LZW: 코드 길이는 9비트부터 12비트까지 늘고, 사전이 차면 지우기 코드를 넣고 다시 시작한다.
  function lzw(indices, minCodeSize, out){
    const clear = 1 << minCodeSize, end = clear + 1;
    let codeSize = minCodeSize + 1, next = end + 1, dict = new Map(), bits = 0, bitCount = 0;
    const block = [];
    const flush = () => { if (!block.length) return; out.byte(block.length); out.bytes(block); block.length = 0; };
    const emit = code => { bits |= code << bitCount; bitCount += codeSize; while (bitCount >= 8){ block.push(bits & 255); if (block.length === 255) flush(); bits >>= 8; bitCount -= 8; } };
    out.byte(minCodeSize); emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++){
      const k = indices[i], key = prefix << 8 | k, found = dict.get(key);
      if (found !== undefined){ prefix = found; continue; }
      emit(prefix);
      if (next < 4096){ dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
      else { emit(clear); dict = new Map(); codeSize = minCodeSize + 1; next = end + 1; }
      prefix = k;
    }
    emit(prefix); emit(end);
    if (bitCount > 0) block.push(bits & 255);
    flush(); out.byte(0);
  }
  // frames: [{ width, height, data(RGBA) }] 같은 크기. delay: 장면 사이 시간(ms, GIF 는 1/100초 단위). loop 0 = 끝없이 되풀이.
  async function encode(frames, { delay = 70, loop = 0, palette = null, onProgress = null } = {}){
    if (!frames.length) throw new Error("gif-no-frames");
    const width = frames[0].width, height = frames[0].height;
    const colors = palette || buildPalette(frames), nearest = indexer(colors), out = writer();
    out.text("GIF89a"); out.word(width); out.word(height);
    out.byte(0xf7); out.byte(0); out.byte(0);                     // 전역 팔레트 256색
    out.bytes(colors);
    out.byte(0x21); out.byte(0xff); out.byte(11); out.text("NETSCAPE2.0"); out.byte(3); out.byte(1); out.word(loop); out.byte(0);
    const centiseconds = Math.max(2, Math.round(delay/10)), indices = new Uint8Array(width*height);
    for (let f = 0; f < frames.length; f++){
      const data = frames[f].data;
      for (let i = 0, p = 0; i < indices.length; i++, p += 4) indices[i] = nearest(data[p], data[p+1], data[p+2]);
      out.byte(0x21); out.byte(0xf9); out.byte(4); out.byte(0); out.word(centiseconds); out.byte(0); out.byte(0);
      out.byte(0x2c); out.word(0); out.word(0); out.word(width); out.word(height); out.byte(0);
      lzw(indices, 8, out);
      if (onProgress) onProgress((f + 1)/frames.length);
      await new Promise(resolve => setTimeout(resolve, 0));   // 긴 작업 중에도 화면이 멈추지 않게 틈을 준다
    }
    out.byte(0x3b);
    return out.result();
  }
  return { encode, buildPalette };
})();
