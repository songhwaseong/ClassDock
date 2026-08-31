"use strict";

// Pure, bounded preview policies. Remote content is never treated as application HTML.
const MNRemoteFiles = (() => {
  const MAX_PIXELS = 25000000;
  const resolvePath = (path) => {
    path = String(path || "");
    if (!path.startsWith("/")) throw new Error("/로 시작하는 전체 경로를 입력하세요. 예: /home/student/result.png (상대 경로와 ~는 지원하지 않습니다.)");
    if (/[\u0000-\u001f\u007f]/.test(path)) throw new Error("파일 경로에 줄바꿈이나 제어문자를 사용할 수 없습니다.");
    // Do not collapse '..': the preceding component may be a remote symlink.
    if (path.length > 4096) throw new Error("파일 경로가 너무 깁니다.");
    return path;
  };
  const decodeText = (bytes, partial=false, encoding="auto") => {
    let label = encoding;
    if (label === "auto") label = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
    const text = new TextDecoder(label, { fatal:true }).decode(bytes, { stream:partial });
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error("텍스트로 표시할 수 없는 바이너리 파일입니다. 다운로드를 이용하세요.");
    return text;
  };
  const textLines = (text) => {
    const all = text.split(/\r\n|\n|\r/);
    let limited = all.length > 10000;
    const lines = all.slice(0, 10000).map(line => {
      if (line.length <= 10000) return line;
      limited = true; return line.slice(0, 10000) + " … [긴 줄 생략]";
    });
    return { lines, limited };
  };
  const parseTable = (text, delimiter=",", partial=false) => {
    const rows = []; let row = [], cell = "", quoted = false, closed = false, start = true, limited = false;
    const addCell = () => { if (row.length < 100) row.push(cell); else limited = true; cell = ""; start = true; closed = false; };
    const addRow = () => { addCell(); rows.push(row); row = []; };
    for (let i=0; i<text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
        else cell += c;
      } else if (c === delimiter) addCell();
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i+1] === "\n") i++;
        addRow();
        if (rows.length >= 1000) { limited = i + 1 < text.length || partial; return { rows, limited }; }
      } else if (c === '"' && start) { quoted = true; start = false; }
      else {
        if (closed || c === '"') throw new Error("CSV 따옴표 형식이 올바르지 않습니다. 원문 보기를 이용하세요.");
        cell += c; start = false;
      }
      if (cell.length > 10000) throw new Error("너무 긴 CSV 셀입니다. 원문 보기를 이용하세요.");
    }
    if (partial) return { rows, limited:true }; // The last remote record may continue past the byte limit.
    if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다. 원문 보기를 이용하세요.");
    if (row.length || cell.length || closed) addRow();
    return { rows, limited };
  };
  const imageInfo = (bytes) => {
    const b = bytes, d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ascii = (at, n) => String.fromCharCode(...b.subarray(at, at+n));
    let width=0, height=0, mime="", frameEnd=0;
    if (b.length >= 24 && b[0] === 137 && ascii(1,7) === "PNG\r\n\x1a\n" && ascii(12,4) === "IHDR") {
      width=d.getUint32(16); height=d.getUint32(20); mime="image/png";
    } else if (b.length >= 13 && /^GIF8[79]a$/.test(ascii(0,6))) {
      width=d.getUint16(6,true); height=d.getUint16(8,true); mime="image/gif";
      let at=13 + ((b[10]&128) ? 3 * (1 << ((b[10]&7)+1)) : 0);
      const blocks = () => { while (at < b.length) { const n=b[at++]; if (!n) return; at+=n; if(at>b.length) break; } throw new Error("손상된 GIF 파일입니다."); };
      while (at < b.length) {
        const type=b[at++];
        if (type===0x21) { at++; blocks(); }
        else if (type===0x2c) {
          if (at+9>b.length) break;
          const fw=d.getUint16(at+4,true), fh=d.getUint16(at+6,true);
          if (!fw || !fh || fw*fh>MAX_PIXELS) throw new Error("이미지 해상도 제한을 넘었습니다.");
          const flags=b[at+8]; at+=9;
          if (flags&128) at+=3*(1<<((flags&7)+1));
          at++; blocks(); frameEnd=at; break;
        } else break;
      }
      if (!frameEnd) throw new Error("GIF 첫 프레임을 읽지 못했습니다.");
    } else if (b.length >= 30 && ascii(0,2)==="BM") {
      const header=d.getUint32(14,true);
      if(header===12){ width=d.getUint16(18,true); height=d.getUint16(20,true); }
      else if(header>=40){ width=d.getInt32(18,true); height=Math.abs(d.getInt32(22,true)); }
      mime="image/bmp";
    } else if (b.length >= 30 && ascii(0,4)==="RIFF" && ascii(8,4)==="WEBP") {
      mime="image/webp";
      const kind=ascii(12,4);
      if (kind==="VP8X") {
        if(b[20]&2) throw new Error("애니메이션 WebP는 다운로드로 확인하세요.");
        width=1+b[24]+(b[25]<<8)+(b[26]<<16); height=1+b[27]+(b[28]<<8)+(b[29]<<16);
      } else if(kind==="VP8 " && b[23]===0x9d && b[24]===1 && b[25]===0x2a) {
        width=d.getUint16(26,true)&0x3fff; height=d.getUint16(28,true)&0x3fff;
      } else if(kind==="VP8L" && b[20]===0x2f) {
        const bits=d.getUint32(21,true); width=(bits&0x3fff)+1; height=((bits>>>14)&0x3fff)+1;
      }
    } else if(b.length >= 4 && b[0]===255 && b[1]===216) {
      mime="image/jpeg"; let at=2;
      while(at+4<=b.length){
        if(b[at++]!==255) break;
        while(b[at]===255) at++;
        const marker=b[at++];
        if(marker===0xda || marker===0xd9) break;
        if(marker===1 || marker>=0xd0 && marker<=0xd7) continue;
        if(at+2>b.length) break;
        const size=d.getUint16(at); if(size<2 || at+size>b.length) break;
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size>=8){
          height=d.getUint16(at+3); width=d.getUint16(at+5); break;
        }
        at+=size;
      }
    }
    if(!width || !height || width<0 || width>32768 || height>32768 || width*height>MAX_PIXELS) throw new Error("이미지 형식이 잘못되었거나 25메가픽셀 제한을 넘었습니다. 다운로드를 이용하세요.");
    return { width, height, mime, frameEnd };
  };
  const errorText = (error) => {
    const raw=String(error?.message || error || "");
    const messages={
      closed:"파일 연결이 종료되었습니다. 인증 정보를 다시 입력한 뒤 시도하세요.",
      expired:"파일 정보가 만료되었습니다. 다시 읽어 주세요.",
      authentication:"파일 연결 인증에 실패했습니다. 비밀번호 또는 키 암호를 확인하세요.",
      "host-key":"서버 지문이 맞지 않습니다. SSH 접속 정보에서 지문을 확인하세요.",
      "sftp-unavailable":"이 서버에서는 SFTP 파일 전송을 사용할 수 없습니다.",
      "not-found":"파일을 찾지 못했습니다. 원래 연결한 서버의 SFTP 경로인지 확인하세요.",
      permission:"현재 SSH 계정에 파일 읽기 권한이 없습니다.",
      "not-regular":"일반 파일만 열 수 있습니다. 폴더·장치·파이프는 지원하지 않습니다.",
      "attributes-unavailable":"서버가 안전한 파일 확인에 필요한 속성을 제공하지 않습니다.",
      changed:"읽는 동안 원격 파일이 바뀌었습니다. 다시 시도하거나 정지된 복사본을 사용하세요.",
      "destination-changed":"저장 대상 파일이 바뀌었습니다. 다운로드를 다시 눌러 저장 위치를 확인하세요.",
      "disk-full":"저장할 디스크의 여유 공간이 부족합니다.",
      "local-permission":"선택한 폴더에 저장할 권한이 없습니다.",
      destination:"이 저장 위치는 지원하지 않습니다. 로컬 디스크의 다른 파일을 선택하세요.",
      "cache-limit":"미리보기 임시 공간(100 MiB)이 가득 찼습니다. 다른 미리보기를 닫아 주세요.",
      limit:"동시 작업 또는 임시 파일 정보 한도에 도달했습니다. 진행 중인 작업을 마치고 다시 시도하세요.",
      busy:"이 연결에서 다른 파일 작업이 진행 중입니다. 잠시 뒤 다시 시도하세요.",
      "picker-busy":"다른 파일 저장창이 열려 있습니다. 먼저 그 창을 닫아 주세요.",
      cancelled:"작업을 취소했습니다. 불완전한 파일은 저장하지 않습니다.",
      picker:"Windows 저장창을 열지 못했습니다.",
      path:"원격 절대 경로를 확인하세요.",
      protocol:"서버의 SFTP 응답이 올바르지 않습니다. 연결을 다시 열어 주세요.",
      io:"파일 통신 또는 디스크 입출력에 실패했습니다. 연결과 저장 공간을 확인하세요.",
      timeout:"파일 요청 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도하세요."
    };
    const code=raw.match(/ssh-file-([a-z-]+)/)?.[1];
    return messages[code] || raw || "파일을 열지 못했습니다.";
  };
  const formatBytes = value => {
    const bytes=Number(value)||0;
    if(bytes<1024) return bytes+" B";
    if(bytes<1024*1024) return (bytes/1024).toFixed(1)+" KiB";
    if(bytes<1024*1024*1024) return (bytes/1024/1024).toFixed(1)+" MiB";
    return (bytes/1024/1024/1024).toFixed(2)+" GiB";
  };
  return { resolvePath, decodeText, textLines, parseTable, imageInfo, errorText, formatBytes };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNRemoteFiles;
