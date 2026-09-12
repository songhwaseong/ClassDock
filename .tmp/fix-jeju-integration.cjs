const fs=require('fs'),read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>fs.writeFileSync(p,s);
let p='desktop/launcher.cs',s=read(p);s=s.replace('                    byte[] payload = Encoding.UTF8.GetBytes((kind == "routes"', '                    try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }\n                    byte[] payload = Encoding.UTF8.GetBytes((kind == "routes"');write(p,s);
p='src/styles.css';s=read(p).replace('color:var(--text,#172b33)','color:var(--ink,#172b33)');write(p,s);
p='docs/JS-파일별-기능.md';s=read(p).replace('**최종 업데이트: 2026년 8월 25일**','**최종 업데이트: 2026년 9월 12일**');
const rows='| `jeju-bus-api.js` | 제주 버스 공급자 응답 정규화와 런처 조회. 노선 ID, 좌표 검증, 원본 수신시각과 캐시 지연 정보를 보존합니다. | `jeju-bus-map.js`, `desktop/launcher.cs`, `tests/jeju-bus-live.test.js` |\n'
+'| `jeju-bus-live.js` | 차량별 관측 이력, 좌표 정체·누락·수신 지연 처리, 검증된 노선 구간에서만 짧은 이동 효과를 계산하는 순수 모듈입니다. | `jeju-bus-api.js`, `jeju-bus-map.js`, `tests/jeju-bus-live.test.js` |\n'
+'| `jeju-bus-map.js` | 제주 버스 시범 패널, 노선 선택, Leaflet 차량·노선 층, 숨김·종료 시 요청 정리, 캡처 시 위치 고정을 담당합니다. 문서 모델에는 기록하지 않습니다. | `map-viewer.js`, `tests/jeju-bus-controller.test.js` |\n';
s=s.replace('| `subway-stations.js` |',rows+'| `subway-stations.js` |');write(p,s);
p='tests/tool-visibility.test.js';s=read(p).replace('const mapSource = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");','const mapSource = ["map-viewer.js", "jeju-bus-map.js"].map(file => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\\n");');
s=s.replace('TOGGLEABLE_TOOLS.length, 179','TOGGLEABLE_TOOLS.length, 180').replace('map:29','map:30').replace('ids.includes("mapOffline")','ids.includes("mapOffline") && ids.includes("mapJejuBus")');write(p,s);
p='tests/map-radius.test.js';s=read(p).replace('let captured=null, fail=false;','let captured=null, fail=false, busFrozen=false;');
s=s.replace('    subwayCaptureLabels:()=>[],','    subwayCaptureLabels:()=>[],\n    jejuBus:{freeze(){busFrozen=true;return ()=>{busFrozen=false;};},captureNote:()=>"bus snapshot"},');
s=s.replace('    mapCaptureDataUrl:async()=>{','    mapCaptureDataUrl:async(stage,attribution)=>{\n      assert.equal(busFrozen,true); assert.match(attribution,/bus snapshot/);');
s=s.replace('  assert.equal(await context.captureRadius(),"test-png");','  assert.equal(await context.captureRadius(),"test-png");\n  assert.equal(busFrozen,false);');
s=s.replace('  await assert.rejects(context.captureRadius(),/capture failed/);','  await assert.rejects(context.captureRadius(),/capture failed/);\n  assert.equal(busFrozen,false);');write(p,s);
p='사용법.md';s=read(p);const start=s.indexOf('#### 🚌 제주 버스 (시범)'),end=s.indexOf('\n25.',start),section=s.slice(start,end);s=s.slice(0,start)+s.slice(end);const insert=s.indexOf('\n### ',start);if(insert<0)throw new Error('manual section');s=s.slice(0,insert)+'\n'+section+'\n'+s.slice(insert);write(p,s);
