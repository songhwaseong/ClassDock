const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');const write=(p,s)=>fs.writeFileSync(p,s,'utf8');
let p='src/js/jeju-bus-map.js',s=read(p);
s=s.replace('active=null;shape=null;needsFit=false;','active=null;needsFit=false;');
s=s.replace('frame=0;if(!on || frozen || !visible())return;','if(frame)cancelAnimationFrame(frame);frame=0;if(!on || frozen || !visible())return;');
s=s.replace('Date.now()*1+30000*2**failures','Date.now()+30000*2**failures');
s=s.replace('delayed=response.stale;failures=', 'if(response.stale)nextPoll=Math.max(nextPoll,Date.now()+(response.retryAfterMs || 0));\n        delayed=response.stale;failures=');
s=s.replace('if(!shape || elapsed','if(!shape || elapsed');
write(p,s);
p='src/js/jeju-bus-api.js';s=read(p).replace('result.stale=response.headers','result.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;\n    result.stale=response.headers');write(p,s);
p='desktop/launcher.cs';s=read(p).replace('+ "X-ClassDock-Bus-Stale: " + (stale ? "1" : "0") + "\\r\\n");','+ "X-ClassDock-Bus-Stale: " + (stale ? "1" : "0") + "\\r\\n"\n                            + (stale ? "Retry-After: " + retry.ToString(CultureInfo.InvariantCulture) + "\\r\\n" : ""));');write(p,s);
const translations={
'🚌 제주 버스':'🚌 Jeju buses','제주 버스':'Jeju buses','제주 버스 · 시범':'Jeju buses · Preview',
'ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.':'Available in ClassDock EXE with an internet connection.',
'노선번호 (예: 201)':'Route number (e.g. 201)','버스 노선번호':'Bus route number','버스 세부 노선':'Bus route variant',
'노선을 검색해 주세요.':'Search for a route.','지도에 표시':'Show on map','끄기':'Turn off','노선 전체 보기':'Show entire route','노선 새로고침':'Refresh route',
'위치는 지연될 수 있으며, 갱신 사이에는 마지막 위치를 표시합니다.':'Positions may be delayed. The last received position is shown between updates.',
'출처: 제주 버스정보시스템':'Source: Jeju Bus Information System','제주 버스 표시를 껐어요.':'Jeju bus display is off.',
'마지막 수신':'Last received','버스':'Buses','대':' vehicles','버스 정보를 받는 중…':'Loading bus positions…',
'정보 수신 지연':'Data reception delayed','현재 조회된 차량 없음':'No vehicles returned',
'버스 정보를 받지 못했어요. 다시 시도하는 중이에요.':'Could not load bus positions. Retrying.',
'정류장 목록을 받는 중…':'Loading stops…','정류장 정보를 받지 못했어요. 노선을 새로고침해 주세요.':'Could not load stops. Refresh the route.',
'노선번호를 입력해 주세요. (예: 201)':'Enter a route number (e.g. 201).','노선을 검색하는 중…':'Searching routes…','세부 경로':'Variant',
'검색된 노선이 없어요.':'No matching routes.','노선을 받지 못했어요. 잠시 후 다시 검색해 주세요.':'Could not load routes. Try again shortly.',
'제주 버스 노선을 선택해 실시간 위치를 봅니다.':'Select a Jeju bus route to see live positions.','제주 버스 위치':'Jeju bus positions',
'차량 정보 갱신 대기':'Waiting for vehicle update','정류장 정보 갱신 · 위치 갱신 대기':'Stop updated · Waiting for position update',
'위치 변화 확인 안 됨':'No position change observed','마지막 수신 위치':'Last received position'
};
p='src/js/i18n.js';s=read(p);const lines=Object.entries(translations).filter(([key])=>!s.includes(JSON.stringify(key)+':')).map(([key,value])=>'    '+JSON.stringify(key)+': '+JSON.stringify(value)+',').join('\n');
s=s.replace('  var DICT = {','  var DICT = {\n    // 제주 버스 실시간 지도\n'+lines);write(p,s);
p='사용법.md';s=read(p);const needle='24. **🚇 실시간 열차**';const at=s.indexOf(needle);if(at<0)throw new Error('manual anchor');
// 기존 번호는 유지하고 지도 사용법 항목 뒤의 소절로 덧붙인다.
const next=s.indexOf('\n25.',at);const bus='\n\n#### 🚌 제주 버스 (시범)\n\n- 인터넷이 연결된 **ClassDock EXE**에서 지도 도구막대의 **🚌 제주 버스**를 누릅니다. 인증키는 필요하지 않습니다.\n- 노선번호(예: **201**)를 검색하고 출발·종점과 **정류장 목록**을 확인해 세부 노선을 선택한 뒤 **지도에 표시**를 누릅니다. 같은 번호에도 방향과 운행 경로가 여러 개 있습니다.\n- 버스에 마우스를 올리거나 키보드로 초점을 옮기면 차량번호, 제공된 정류장 정보, 마지막 수신 시각을 볼 수 있습니다. **노선 전체 보기**로 지도 범위를 다시 맞추고 **끄기**로 조회와 표시를 끝냅니다. 패널의 **닫기**는 패널만 접습니다.\n- 선택 노선은 기본 30초 간격으로 조회합니다. 정상적인 좌표 변경은 확인된 노선 경로를 따라 짧게 이어 표시하며, 경로가 불확실하거나 위치 차이가 크면 새 위치에 표시합니다. 화면에서 이동이 부드럽더라도 GPS를 매 순간 측정한 위치라는 뜻은 아닙니다.\n- 같은 좌표가 반복되면 임의로 계속 움직이지 않습니다. **위치 변화 확인 안 됨**은 정차 또는 데이터 지연일 수 있습니다. 수신 지연이 오래 지속되면 차량이 흐려지고, 5분간 새 정보를 받지 못한 차량은 숨깁니다.\n- **노선 새로고침**은 정류장과 경로를 다시 받습니다. 다른 지도나 앱으로 전환하면 위치 조회를 쉬고, 돌아오면 다시 갱신합니다.\n- 버스 위치는 지도 문서나 CSV·GPX에 저장하지 않습니다. PNG·칠판·메모·인쇄에는 화면에 표시된 위치와 마지막 수신 시각·출처가 함께 남습니다.\n- 데이터 출처는 [제주 버스정보시스템](https://bus.jeju.go.kr/)입니다. 사이트 응답을 사용하는 시범 기능으로, 제공 사이트 변경이나 장애 시 조회되지 않을 수 있습니다. TAGO 인증키 연결은 후속 범위입니다.\n';
if(next>=0)s=s.slice(0,next)+bus+s.slice(next);else s=s.slice(0,at)+bus+'\n'+s.slice(at);write(p,s);
// 관측 중 실제 바뀐 차량과 좌표가 고정된 차량을 최소 fixture로 보존한다.
const ids=[7983202,7983077,7983229];const fixture=[];
for(let i=1;i<=5;i++){const raw=JSON.parse(read('.tmp/jeju-bus-check-20260912/sample-'+i+'.json').replace(/^\uFEFF/,''));fixture.push({at:Date.parse(raw.fetchedAt),rows:raw.rows.filter(r=>ids.includes(r.vhId)).map(({vhId,plateNo,localX,localY,currStationId,currStationNm})=>({vhId,plateNo,localX,localY,currStationId,currStationNm}))});}
write('tests/fixtures/jeju-bus-observations.json',JSON.stringify(fixture,null,2)+'\n');
