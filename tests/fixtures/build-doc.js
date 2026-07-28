/* 테스트용 최소 .doc(구형 Word) 파일 생성기 — 단위 테스트와 e2e 가 함께 쓴다. */

const SEC = 512;
const ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD;

/* 최소 CFB(OLE2) + Word 97 FIB + 조각표(CLX)를 만든다.
   섹터 0=FAT, 1=디렉터리, 2~9=WordDocument, 10~17=1Table (스트림은 미니 FAT 을 타지 않도록 4096바이트). */
function buildWordDoc({ text, compressed = false, encrypted = false }){
  const TEXT_AT = 0x800;                        // WordDocument 안 본문 시작 위치
  const wd = Buffer.alloc(4096);
  wd.writeUInt16LE(0xA5EC, 0);                  // wIdent
  wd.writeUInt16LE(193, 2);                     // nFib (Word 97)
  wd.writeUInt16LE(0x0200 | (encrypted ? 0x0100 : 0), 10);   // fWhichTblStm=1Table, fEncrypted
  wd.writeUInt32LE(text.length, 0x4C);          // ccpText
  wd.writeUInt32LE(0, 0x1A2);                   // fcClx (표 스트림 기준)
  wd.writeUInt32LE(16 + 5, 0x1A6);              // lcbClx = Pcdt 머리(5) + PlcPcd(16)

  if (compressed){
    for (let i = 0; i < text.length; i++) wd[TEXT_AT + i] = text.charCodeAt(i) & 0xFF;
  } else {
    for (let i = 0; i < text.length; i++) wd.writeUInt16LE(text.charCodeAt(i), TEXT_AT + i * 2);
  }

  const table = Buffer.alloc(4096);
  table[0] = 0x02;                              // Pcdt
  table.writeUInt32LE(16, 1);                   // PlcPcd 길이
  table.writeUInt32LE(0, 5);                    // CP 경계: 0
  table.writeUInt32LE(text.length, 9);          //           끝
  table.writeUInt16LE(0, 13);                   // PCD flags
  table.writeUInt32LE(compressed ? ((TEXT_AT * 2) | 0x40000000) : TEXT_AT, 15);   // fc(+압축 표시)
  table.writeUInt16LE(0, 19);                   // prm

  const dir = Buffer.alloc(SEC);
  const putEntry = (idx, name, type, start, size) => {
    const off = idx * 128;
    for (let i = 0; i < name.length; i++) dir.writeUInt16LE(name.charCodeAt(i), off + i * 2);
    dir.writeUInt16LE(name.length * 2 + 2, off + 64);   // 이름 길이(끝 널 포함)
    dir[off + 66] = type;
    dir.writeUInt32LE(start, off + 116);
    dir.writeUInt32LE(size, off + 120);
  };
  putEntry(0, "Root Entry", 5, ENDOFCHAIN, 0);
  putEntry(1, "WordDocument", 2, 2, 4096);
  putEntry(2, "1Table", 2, 10, 4096);

  const fat = Buffer.alloc(SEC);
  for (let i = 0; i < 128; i++) fat.writeUInt32LE(FREESECT, i * 4);
  fat.writeUInt32LE(FATSECT, 0);
  fat.writeUInt32LE(ENDOFCHAIN, 1 * 4);
  for (let i = 2; i <= 9; i++) fat.writeUInt32LE(i === 9 ? ENDOFCHAIN : i + 1, i * 4);
  for (let i = 10; i <= 17; i++) fat.writeUInt32LE(i === 17 ? ENDOFCHAIN : i + 1, i * 4);

  const header = Buffer.alloc(SEC);
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
  header.writeUInt16LE(9, 30);                  // 섹터 크기 = 512
  header.writeUInt16LE(6, 32);                  // 미니 섹터 크기 = 64
  header.writeUInt32LE(1, 44);                  // FAT 섹터 수
  header.writeUInt32LE(1, 48);                  // 디렉터리 첫 섹터
  header.writeUInt32LE(4096, 56);               // 미니 스트림 기준 크기
  header.writeUInt32LE(ENDOFCHAIN, 60);
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(ENDOFCHAIN, 68);
  header.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : FREESECT, 76 + i * 4);

  const sectors = [fat, dir];
  for (let i = 0; i < 8; i++) sectors.push(wd.subarray(i * SEC, (i + 1) * SEC));
  for (let i = 0; i < 8; i++) sectors.push(table.subarray(i * SEC, (i + 1) * SEC));
  return new Uint8Array(Buffer.concat([header, ...sectors]));
}

module.exports = { buildWordDoc };
