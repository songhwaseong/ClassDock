// e2e 공용 준비 동작.

// 본문(편집기·캔버스·표)을 직접 클릭·드래그하는 테스트는 사이드바를 접은 채로 시작한다.
//
// 사이드바는 본문을 밀어내지 않고 그 위에 뜨는 서랍이라, 열려 있는 동안 #sidebarBackdrop 이
// 본문 전체를 덮고 클릭을 가져간다(서랍 바깥을 누르면 닫히는 동작). 새 프로필은 사이드바가
// 열린 상태로 시작하므로, 그대로 두면 본문을 겨냥한 클릭이 전부 백드롭에 막힌다.
// 여기서 만드는 상태는 "사용자가 서랍을 한 번 닫아 둔" 것과 같다(localStorage 에 남는 값).
//
// 서랍이 열려 있을 때의 동작 자체는 sidebar-overlay.spec.js 가 따로 지킨다.
async function collapseSidebar(page){
  await page.addInitScript(() => { try { localStorage.setItem("sidebarCollapsed", "true"); } catch(_){} });
}

/* 자리가 잡힐 때까지 기다렸다가 요소의 사각형을 돌려준다.
 *
 * `toBeVisible()` 만으로는 모자란 경우가 있다. VexFlow 악보처럼 여러 번에 나눠 그려지는 화면은
 * 그리는 도중에도 "보임"이라, 바로 이어서 `boundingBox()` 를 부르면 그 사이에 요소가 새로 그려져
 * `null` 이 온다(다음 줄 `box.x` 에서 TypeError). 단독 실행은 빨라서 안 나고 병렬로 느려지면 난다.
 *
 * 그래서 크기가 생기고 **두 번 연속 같은 자리**일 때까지 기다린다 — 다시 그리는 중이면 값이
 * 흔들리므로 자연히 걸러진다. */
async function stableBox(locator, timeout = 15_000){
  const deadline = Date.now() + timeout;
  let previous = null;
  for (;;){
    const box = await locator.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0){
      if (previous && previous.x === box.x && previous.y === box.y
          && previous.width === box.width && previous.height === box.height) return box;
      previous = box;
    } else {
      previous = null;
    }
    if (Date.now() > deadline) throw new Error("요소의 자리가 잡히지 않았습니다: " + locator);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/* 압축 없이(STORED) 담는 최소 ZIP 라이터.
   "압축 파일 안의 항목을 앱이 알아보고 제 뷰어로 여는가"를 확인하는 데 필요한 만큼만 만든다 —
   외부 의존성 없이 Buffer 로 헤더를 직접 쓴다. */
function crc32(buf){
  let c, table = crc32.table;
  if (!table){
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++){
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}
function storedZip(entries){
  const locals = [], central = [];
  let offset = 0;
  for (const entry of entries){
    const name = Buffer.from(entry.name, "utf8");
    // 문자열이면 UTF-8 로, Buffer 면 그대로 담는다(압축 안에 든 .mxl 처럼 이진 항목도 넣을 수 있게).
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const sum = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);          // UTF-8 파일 이름
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);

    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    name.copy(dir, 46);
    central.push(dir);
    offset += local.length + data.length;
  }
  const body = Buffer.concat(locals);
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dirBuf, end]);
}

module.exports = { collapseSidebar, storedZip, stableBox };
