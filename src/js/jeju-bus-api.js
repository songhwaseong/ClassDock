"use strict";
/* TAGO(국토교통부 국가대중교통정보센터) 응답 해석. 수신시각을 GPS 측정시각으로 쓰지 않는다.
   응답 모양: {response:{header:{resultCode}, body:{items:{item:[…] 또는 {…}}, totalCount}}}.
   결과가 없으면 items 가 빈 문자열로 오고, 한 건이면 item 이 배열이 아니라 객체로 온다.
   숫자처럼 생긴 값(routeno 201)은 숫자로 올 수 있어 늘 text() 로 읽는다. */
const MNJejuBusApi = (() => {
  const provider = "tago";
  const text = v => String(v == null ? "" : v).trim().slice(0,180);
  const validId = v => /^[A-Za-z0-9]{1,30}$/.test(text(v));
  // 노선 번호. 제주는 숫자·하이픈뿐이지만 다른 도시엔 "마을1"·"급행2"·"B1" 같은 번호가 있다(런처 ValidBusRouteNumber 와 같은 규칙).
  const validNumber = v => /^[0-9A-Za-z가-힣\-]{1,20}$/.test(v) && /[0-9A-Za-z가-힣]/.test(v);
  // 도시코드(빈칸 = 제주).
  const validCity = v => /^[0-9]{0,9}$/.test(text(v));
  // 전국으로 넓히면서 제주 범위 대신 대한민국 범위로 거른다(0,0 같은 빈 좌표를 버리는 것이 목적).
  function coords(r){
    if (!r || r.gpslati == null || r.gpslong == null || r.gpslati === "" || r.gpslong === "") return null;
    const lat=Number(r.gpslati), lng=Number(r.gpslong);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat>=33 && lat<=38.7 && lng>=124.5 && lng<=132 ? [lat,lng] : null;
  }
  // 정상(00)·자료 없음(03)만 받는다. 그 밖의 코드나 모양이 다른 본문을 '운행 차량 없음'으로 바꾸지 않는다.
  function rows(body){
    const response=body && typeof body==="object" ? body.response : null;
    const code=response && response.header ? text(response.header.resultCode) : "";
    if (code==="03") return [];
    if (code!=="00" || !response.body || typeof response.body!=="object") throw new Error("bus-invalid-data");
    const items=response.body.items;
    if (items==null || items==="") return [];
    if (typeof items!=="object") throw new Error("bus-invalid-data");
    const item=items.item;
    if (item==null) return [];
    if (Array.isArray(item)) return item;
    if (typeof item==="object") return [item];
    throw new Error("bus-invalid-data");
  }
  // TAGO 번호 검색은 번호가 들어간 노선을 모두 준다(20 → 20·120·201…). 정확히 같은 번호가 있으면 그것만 보인다.
  function routes(body,keyword=""){
    const seen=new Set();
    const list=rows(body).flatMap(r=>{
      if (!r || !validId(r.routeid) || seen.has(text(r.routeid))) return [];
      const id=text(r.routeid); seen.add(id);
      return [{id,number:text(r.routeno),from:text(r.startnodenm),to:text(r.endnodenm),description:"",type:text(r.routetp)}];
    });
    const exact=list.filter(r=>r.number===text(keyword));
    return exact.length ? exact : list;
  }
  function route(body){
    return rows(body).filter(r=>r && coords(r)).sort((a,b)=>Number(a.nodeord)-Number(b.nodeord))
      .map(r=>({id:text(r.nodeid),name:text(r.nodenm),at:coords(r),order:Number(r.nodeord),direction:text(r.updowncd)}));
  }
  function positions(body,id,fetchedAt,cacheAgeMs=0){
    if (!validId(id) || !Number.isFinite(fetchedAt) || fetchedAt<=0) throw new Error("bus-invalid-data");
    const source=rows(body), seen=new Set();
    const vehicles=source.flatMap(r=>{
      const at=coords(r), key=r && text(r.vehicleno);
      if (!at || !key || seen.has(key)) return [];
      seen.add(key);
      return [{id:provider+":"+id+":"+key,label:key,at,stationId:text(r.nodeid),stationName:text(r.nodenm),observedAt:null}];
    });
    if (source.length && !vehicles.length) throw new Error("bus-invalid-data");
    return {provider,routeKey:provider+":"+id,fetchedAt,cacheAgeMs,vehicles};
  }
  // 도시 목록. 이름순으로 두되 제주는 빈 코드("")로 바꿔 둔다 — 런처가 도시를 비우면 제주로 묻고,
  // 예전 제주 노선 목록 파일·설정도 빈 코드에 묶여 있다.
  function cities(body){
    const seen=new Set();
    return rows(body).flatMap(r=>{
      const name=text(r && r.cityname), code=text(r && r.citycode);
      if (!name || !/^[0-9]{1,9}$/.test(code)) return [];
      const value=/제주/.test(name) ? "" : code;
      if (seen.has(value)) return [];
      seen.add(value);
      return [{code:value,name,raw:code}];
    }).sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  }
  // 정류장 도착 예정. arrtime 은 초, arrprevstationcnt 는 남은 정류장 수. 가까운 차례로 늘어놓는다.
  function arrivals(body){
    const whole=v=>{const n=Number(v);return v===""||v==null||!Number.isFinite(n)||n<0?null:Math.floor(n);};
    return rows(body).flatMap(r=>{
      if (!r || !text(r.routeno)) return [];
      return [{routeId:validId(r.routeid)?text(r.routeid):"",number:text(r.routeno),type:text(r.routetp),
        vehicleType:text(r.vehicletp),seconds:whole(r.arrtime),stops:whole(r.arrprevstationcnt)}];
    }).sort((a,b)=>(a.seconds==null?Infinity:a.seconds)-(b.seconds==null?Infinity:b.seconds) || a.number.localeCompare(b.number,"ko"));
  }
  // 좌표 근처 정류장. 도시코드가 함께 오므로 그 정류장의 도착 정보를 물을 때 쓴다(제주는 빈 코드로 바꾼다).
  function nearby(body,jejuCodes=[]){
    const seen=new Set();
    return rows(body).flatMap(r=>{
      const at=coords(r);
      if (!at || !validId(r.nodeid) || seen.has(text(r.nodeid))) return [];
      seen.add(text(r.nodeid));
      const city=text(r.citycode);
      return [{id:text(r.nodeid),name:text(r.nodenm),no:text(r.nodeno),at,
        city:jejuCodes.includes(city) || !/^[0-9]{1,9}$/.test(city) ? "" : city}];
    });
  }
  // 도착 안내 한 줄의 남은 시간 글. 서울은 '출발대기'·'운행종료' 처럼 시간 없는 안내(message)가 온다.
  function arrivalText(item,t=v=>v){
    const parts=[];
    if (item.seconds!=null) parts.push(item.seconds<60 ? t("곧 도착") : Math.round(item.seconds/60)+t("분 후"));
    if (item.stops!=null && item.stops>0) parts.push(item.stops+t("정류장 전"));
    return parts.join(" · ") || (item.message ? t(item.message) : t("도착 정보 없음"));
  }
  /* ── 서울(ws.bus.go.kr) ── 도시코드 11. TAGO 와 모양이 달라 따로 읽는다.
     응답: {msgHeader:{headerCd}, msgBody:{itemList:[…] 또는 null}} · headerCd 0 정상 · 4 결과 없음.
     좌표는 gpsX(경도)·gpsY(위도). 정류장은 arsId(표지판 5자리 번호)로 도착 정보를 묻는다 — "0" 은 가상 정류장이다. */
  const seoulCity="11";
  const seoulTypes={"1":"공항","2":"마을","3":"간선","4":"지선","5":"순환","6":"광역","7":"인천","8":"경기","0":"공용"};
  function seoulRows(body){
    const header=body && typeof body==="object" ? body.msgHeader : null;
    const code=header ? text(header.headerCd) : "";
    if (code==="4") return [];
    if (code!=="0") throw new Error("bus-invalid-data");
    const list=body.msgBody && body.msgBody.itemList;
    if (list==null || list==="") return [];
    if (Array.isArray(list)) return list;
    if (typeof list==="object") return [list];
    throw new Error("bus-invalid-data");
  }
  const seoulAt=r=>r ? coords({gpslati:r.gpsY,gpslong:r.gpsX}) : null;
  const seoulStop=v=>/^[0-9]{1,10}$/.test(text(v)) && !/^0+$/.test(text(v)) ? text(v) : "";
  function seoulRoutes(body,keyword=""){
    const seen=new Set();
    const list=seoulRows(body).flatMap(r=>{
      if (!r || !validId(r.busRouteId) || seen.has(text(r.busRouteId))) return [];
      const id=text(r.busRouteId); seen.add(id);
      return [{id,number:text(r.busRouteNm),from:text(r.stStationNm),to:text(r.edStationNm),description:"",type:seoulTypes[text(r.routeType)] || ""}];
    });
    const exact=list.filter(r=>r.number===text(keyword));
    return exact.length ? exact : list;
  }
  // stId 는 버스 위치의 '막 지난 정류장'(lastStnId)과 맞춰 정류장 이름을 붙이는 데 쓴다.
  function seoulRoute(body){
    return seoulRows(body).filter(r=>r && seoulAt(r)).sort((a,b)=>Number(a.seq)-Number(b.seq))
      .map(r=>({id:seoulStop(r.arsId),name:text(r.stationNm),at:seoulAt(r),stId:text(r.station),order:Number(r.seq),direction:text(r.direction),turn:text(r.transYn)==="Y"}));
  }
  function seoulPositions(body,id,fetchedAt,cacheAgeMs=0){
    if (!validId(id) || !Number.isFinite(fetchedAt) || fetchedAt<=0) throw new Error("bus-invalid-data");
    const source=seoulRows(body), seen=new Set();
    const vehicles=source.flatMap(r=>{
      const at=seoulAt(r), key=r && text(r.plainNo || r.vehId);
      if (!at || !key || seen.has(key)) return [];
      seen.add(key);
      return [{id:"seoul:"+id+":"+key,label:key,at,stationId:text(r.lastStnId),stationName:"",observedAt:null}];
    });
    if (source.length && !vehicles.length) throw new Error("bus-invalid-data");
    return {provider:"seoul",routeKey:"seoul:"+id,fetchedAt,cacheAgeMs,vehicles};
  }
  // "3분12초후[2번째 전]" · "곧 도착" · "출발대기" · "운행종료". 시간을 못 읽으면 글 그대로 둔다.
  function seoulArrival(message){
    const value=text(message);
    if (!value) return null;
    if (/곧 도착/.test(value)) return {seconds:0,stops:null,message:""};
    const time=/(?:(\d+)분)?\s*(?:(\d+)초)?\s*후/.exec(value), stop=/\[(\d+)번째 전\]/.exec(value);
    const seconds=time && (time[1] || time[2]) ? (Number(time[1] || 0)*60+Number(time[2] || 0)) : null;
    const stops=stop ? Number(stop[1]) : null;
    return {seconds,stops,message:seconds==null && stops==null ? value.replace(/\[[^\]]*\]/g,"").trim() || value : ""};
  }
  // 정류장 도착 예정. 한 노선에 첫째·둘째 차가 함께 오므로 두 줄로 편다(둘째 차는 시간이 있을 때만).
  function seoulArrivals(body){
    const lowFloor={"1":"저상","2":"굴절"};
    return seoulRows(body).flatMap(r=>{
      if (!r || !text(r.rtNm)) return [];
      const base={routeId:validId(r.busRouteId)?text(r.busRouteId):"",number:text(r.rtNm),type:seoulTypes[text(r.routeType)] || ""};
      const first=seoulArrival(r.arrmsg1), second=seoulArrival(r.arrmsg2);
      const out=[];
      if (first) out.push({...base,vehicleType:lowFloor[text(r.busType1)] || "",seconds:first.seconds,stops:first.stops,message:first.message});
      if (second && (second.seconds!=null || second.stops!=null))
        out.push({...base,vehicleType:lowFloor[text(r.busType2)] || "",seconds:second.seconds,stops:second.stops,message:""});
      return out;
    }).sort((a,b)=>(a.seconds==null?Infinity:a.seconds)-(b.seconds==null?Infinity:b.seconds) || a.number.localeCompare(b.number,"ko"));
  }
  function seoulNearby(body){
    const seen=new Set();
    return seoulRows(body).flatMap(r=>{
      const at=seoulAt(r), id=seoulStop(r && r.arsId);
      if (!at || !id || seen.has(id)) return [];
      seen.add(id);
      return [{id,name:text(r.stationNm),no:id,at,city:seoulCity}];
    });
  }
  // 노선 목록 한 줄 = [번호, 기점, 종점, 세부 노선 수]. 앱에 넣어 둔 목록과 런처가 최신화한 목록이 같은 모양이다.
  function catalog(body){
    if (!body || !Array.isArray(body.routes)) throw new Error("bus-invalid-data");
    const seen=new Set();
    const routes=body.routes.flatMap(r=>{
      const number=Array.isArray(r) ? text(r[0]) : "";
      if (!validNumber(number) || seen.has(number)) return [];
      seen.add(number);
      return [{number,from:text(r[1]),to:text(r[2]),count:Math.max(0,Math.floor(Number(r[3]) || 0))}];
    }).sort((a,b)=>{
      const pa=numberParts(a.number), pb=numberParts(b.number);
      return pa.prefix.localeCompare(pb.prefix,"ko") || (pa.value-pb.value) || a.number.localeCompare(b.number);
    });
    return {updatedAt:text(body.updatedAt),routes};
  }
  // "마을12-1" → 앞말 "마을", 수 12. 수가 없으면 아주 큰 값으로 뒤에 둔다.
  function numberParts(number){
    const match=/^([^0-9]*)([0-9]+)?/.exec(number) || ["","",""];
    const value=match[2] ? parseInt(match[2],10) : Number.MAX_SAFE_INTEGER;
    return {prefix:match[1] || "",value};
  }
  // 앞말(마을·급행 등)과 백 단위로 묶는다. 이 검색 응답은 노선 종류(busTypeStr)를 비워 주므로 급행·간선 같은 이름은 붙이지 않는다.
  function catalogGroups(routes){
    const groups=new Map();
    for (const route of routes){
      const {prefix,value}=numberParts(route.number);
      const hundred=value!==Number.MAX_SAFE_INTEGER ? Math.floor(value/100)*100 : -1;
      const key=prefix+"|"+hundred;
      if (!groups.has(key)) groups.set(key,{hundred,prefix,routes:[]});
      groups.get(key).routes.push(route);
    }
    return [...groups.values()];
  }
  const cityQuery=city=>validCity(city) && text(city) ? "city="+text(city) : "";
  async function loadCatalog({signal,city=""}={}){
    if (!validCity(city)) throw new Error("bus-bad-request");
    const query=cityQuery(city);
    const response=await fetch("/jeju-bus-catalog"+(query?"?"+query:""),{signal,cache:"no-store"});
    if (response.status===404) return null;
    if (!response.ok) throw new Error("bus-fetch-failed");
    return catalog(await response.json());
  }
  async function catalogJob(action,{signal,minimum=1,city=""}={}){
    if (!["status","refresh","cancel"].includes(action) || !validCity(city)) throw new Error("bus-bad-request");
    const query=cityQuery(city);
    const url=action==="status" ? "/jeju-bus-catalog-status"
      : action==="refresh" ? "/jeju-bus-catalog-refresh?min="+Math.max(1,Math.floor(Number(minimum) || 1))+(query?"&"+query:"") : "/jeju-bus-catalog-cancel";
    const response=await fetch(url,action==="status" ? {signal,cache:"no-store"}
      : {method:"POST",headers:{"X-ClassDock-Action":"1"},signal,cache:"no-store"});
    if (!response.ok && response.status!==409) throw new Error("bus-catalog-failed");
    const body=await response.json();
    const count=v=>Math.max(0,Math.floor(Number(v) || 0));
    return {state:text(body && body.state),error:text(body && body.error),done:count(body && body.done),
      total:count(body && body.total),found:count(body && body.found),busy:response.status===409,
      city:validCity(body && body.city) ? text(body && body.city) : ""};
  }
  // kind: routes(value=번호) · route/position(value=노선 ID) · arrivals(value=정류장 ID)
  //       · nearby(value=[위도,경도], 도시 없음) · cities(value 없음, 도시 없음)
  async function request(kind,value,{signal,refresh=false,city="",jejuCodes=[]}={}){
    if (!["routes","route","position","arrivals","nearby","cities"].includes(kind) || !validCity(city)) throw new Error("bus-bad-request");
    let query;
    if (kind==="cities") query="";
    else if (kind==="nearby"){
      const [lat,lng]=Array.isArray(value) ? value.map(Number) : [NaN,NaN];
      if (!coords({gpslati:lat,gpslong:lng})) throw new Error("bus-bad-request");
      query="lat="+lat.toFixed(4)+"&lng="+lng.toFixed(4);
    }
    else if (kind==="routes" ? !validNumber(value) : !validId(value)) throw new Error("bus-bad-request");
    else query=(kind==="routes"?"keyword":kind==="arrivals"?"nodeId":"routeId")+"="+encodeURIComponent(value);
    const seoul=text(city)===seoulCity && kind!=="cities";
    // 근처 정류장은 도시 없이 묻지만, 서울만은 서울 API 로 물어야 해서 도시를 붙인다.
    const withCity=seoul || (kind!=="nearby" && kind!=="cities") ? cityQuery(city) : "";
    const params=[query,withCity,refresh && kind!=="position"?"refresh=1":""].filter(Boolean).join("&");
    const response=await fetch("/jeju-bus-"+kind+(params?"?"+params:""),{signal,cache:"no-store"});
    if (!response.ok){
      // 428 = 키가 없거나 맞지 않음, 429 = 하루 호출 한도를 넘김. 본문에 까닭(bus-key-required 등)이 온다.
      let reason="";
      if (response.status===428 || response.status===429){try{reason=text(await response.text());}catch(_){}}
      const error=new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "bus-fetch-failed");
      error.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
      throw error;
    }
    const body=await response.json();
    if (kind==="routes") return seoul ? seoulRoutes(body,value) : routes(body,value);
    if (kind==="route") return seoul ? seoulRoute(body) : route(body);
    if (kind==="cities") return cities(body);
    if (kind==="nearby") return seoul ? seoulNearby(body) : nearby(body,jejuCodes);
    if (kind==="arrivals"){
      const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
      return {items:seoul ? seoulArrivals(body) : arrivals(body),fetchedAt:Number.isFinite(stamp)?stamp:Date.now()};
    }
    const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    const result=(seoul ? seoulPositions : positions)(body,value,stamp,Math.max(0,Date.now()-stamp));
    result.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
    result.stale=response.headers.get("X-ClassDock-Bus-Stale")==="1";
    return result;
  }
  /* 좌표 근처 정류장 — 도시를 고르지 않아도 되게 어느 API 로 물을지를 좌표로 정한다.
     서울 정류장은 TAGO 에 없고 서울 API 에만 있다. 그래서 서울 경계에서 얼마나 떨어졌는지로 가른다:
     경계 안쪽으로 800m 넘게 들어가면 서울 API 만, 바깥으로 800m 넘게 나가면 TAGO 만, 그 사이 띠에서는 둘 다.
     800m = 조회 반경 500m + 경계를 줄인 오차 200m + 여유 100m — 반대쪽 정류장이 조회 원에 걸릴 수 없는 거리다.
     둘 다 물었는데 한쪽만 실패하면 받은 쪽을 보여 준다(서울 활용신청을 안 했어도 경기 정류장은 보인다).
     모두 실패하면 서울 안이면 서울 쪽 오류를, 아니면 TAGO 오류를 던진다(error.city 로 어느 쪽인지 알린다).
     ask 는 시험이 request 를 갈아 끼울 수 있게 받는다. */
  // 서울특별시 바깥 고리 [위도, 경도, …] — tools/build-seoul-ring.mjs 가 vendor/korea-regions.js
  // (통계청 SGIS 행정경계, 가공 vuski/admdongkor · CC BY 4.0)에서 200m 허용으로 줄여 뽑은 값이다.
  const SEOUL_RING=[37.4601,126.8853,37.4625,126.8887,37.4795,126.8756,37.4885,126.8753,37.4951,126.8683,37.4816,126.8519,37.4817,126.8465,37.4745,126.8456,37.4776,126.8318,37.4747,126.8148,37.4885,126.823,37.4963,126.813,37.4992,126.8198,37.5083,126.8247,37.5162,126.8232,37.5267,126.8285,37.5349,126.8218,37.5407,126.8221,37.5431,126.8028,37.5358,126.7944,37.5437,126.7918,37.5483,126.7717,37.5541,126.7662,37.5567,126.7666,37.5575,126.7731,37.5737,126.7829,37.5888,126.8009,37.5966,126.7973,37.6041,126.8006,37.604,126.8049,37.5718,126.8536,37.5739,126.8541,37.5789,126.8771,37.5841,126.8767,37.5909,126.8822,37.5886,126.8873,37.5899,126.8998,37.6125,126.901,37.6418,126.9125,37.6489,126.9053,37.6447,126.9142,37.6456,126.9213,37.6589,126.9473,37.6548,126.9546,37.6314,126.9751,37.6366,126.9846,37.6407,126.9864,37.6549,126.9796,37.6665,126.9943,37.6795,126.9917,37.6838,126.998,37.6847,127.0083,37.6945,127.0088,37.701,127.0158,37.7006,127.0281,37.6917,127.0325,37.6954,127.0416,37.6924,127.0451,37.6939,127.0482,37.687,127.0508,37.6898,127.0651,37.6941,127.0688,37.6964,127.0773,37.6947,127.0838,37.6908,127.0849,37.6897,127.0928,37.6859,127.0963,37.6792,127.0918,37.6728,127.0956,37.6626,127.094,37.6581,127.0924,37.6559,127.086,37.6549,127.0928,37.6458,127.0945,37.6455,127.1066,37.6424,127.1112,37.6306,127.111,37.6231,127.1035,37.6193,127.1157,37.6074,127.1184,37.5994,127.114,37.595,127.1184,37.5919,127.1124,37.5847,127.1093,37.5841,127.1027,37.5736,127.1009,37.5709,127.1042,37.56,127.1011,37.5589,127.1138,37.5684,127.1338,37.5685,127.1492,37.5789,127.1666,37.5796,127.174,37.5691,127.1791,37.5458,127.1836,37.545,127.1632,37.5123,127.1411,37.5055,127.1411,37.5031,127.1576,37.4996,127.1614,37.4891,127.1576,37.4853,127.1498,37.4741,127.1434,37.4748,127.1326,37.4682,127.1327,37.4689,127.1251,37.4586,127.1167,37.4625,127.1063,37.4588,127.0982,37.4614,127.0963,37.4451,127.088,37.4412,127.0823,37.4424,127.0724,37.4301,127.0705,37.429,127.0657,37.4297,127.0509,37.4392,127.0359,37.4457,127.0384,37.4638,127.0347,37.4654,127.0299,37.4585,127.0261,37.4554,127.0111,37.4673,127.0034,37.4667,126.9963,37.4622,126.9968,37.4476,126.974,37.4456,126.9644,37.4408,126.9638,37.436,126.9386,37.4502,126.9287,37.4342,126.9093,37.4381,126.8994,37.4526,126.8941,37.4523,126.8897];
  const SEOUL_EDGE_METRES=800;
  const seoulArea=at=>at[0]>=37.40 && at[0]<=37.73 && at[1]>=126.75 && at[1]<=127.20;   // 서울 경계 + 800m 를 덮는 네모(빠른 거름)
  const flatXY=(lat,lng)=>[lng*111320*Math.cos(37.55*Math.PI/180),lat*110950];
  // 서울 경계까지의 부호 있는 거리(m) — 안쪽이면 양수, 바깥이면 음수.
  function seoulEdgeMetres(at){
    const [px,py]=flatXY(at[0],at[1]);
    let inside=false,nearest=Infinity;
    for (let i=0,j=SEOUL_RING.length-2;i<SEOUL_RING.length;j=i,i+=2){
      const [ax,ay]=flatXY(SEOUL_RING[i],SEOUL_RING[i+1]),[bx,by]=flatXY(SEOUL_RING[j],SEOUL_RING[j+1]);
      if ((ay>py)!==(by>py) && px<(bx-ax)*(py-ay)/(by-ay)+ax) inside=!inside;
      const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
      const t=Math.max(0,Math.min(1,length?((px-ax)*dx+(py-ay)*dy)/length:0));
      nearest=Math.min(nearest,Math.hypot(px-ax-t*dx,py-ay-t*dy));
    }
    return inside?nearest:-nearest;
  }
  // 이 자리에서 물을 곳: {tago, seoul}.
  function nearbySources(at){
    if (!seoulArea(at)) return {tago:true,seoul:false,inside:false};
    const edge=seoulEdgeMetres(at);
    return {tago:edge<SEOUL_EDGE_METRES,seoul:edge>-SEOUL_EDGE_METRES,inside:edge>0};
  }
  function nearMetres(a,b){
    const rad=Math.PI/180,x=(b[1]-a[1])*rad*Math.cos((a[0]+b[0])/2*rad),y=(b[0]-a[0])*rad;
    return Math.sqrt(x*x+y*y)*6371000;
  }
  async function nearbyAt(at,{signal,jejuCodes=[]}={},ask=request){
    const from=nearbySources(at);
    const skip=Promise.resolve(null);
    const [tago,seoul]=await Promise.allSettled([from.tago ? ask("nearby",at,{signal,jejuCodes}) : skip,
      from.seoul ? ask("nearby",at,{signal,city:seoulCity}) : skip]);
    const failed=r=>r.status==="rejected";
    if ((!from.tago || failed(tago)) && (!from.seoul || failed(seoul))){
      const useSeoul=from.seoul && (from.inside || !from.tago);
      const error=useSeoul ? seoul.reason : tago.reason;
      const thrown=error instanceof Error ? error : new Error("bus-fetch-failed");
      thrown.city=useSeoul ? seoulCity : "";
      throw thrown;
    }
    const seoulStops=seoul.status==="fulfilled" && seoul.value ? seoul.value : [];
    const tagoStops=tago.status==="fulfilled" && tago.value ? tago.value : [];
    // 경계 정류장이 양쪽에 다 실리면(이름 같고 30m 안) 서울 쪽만 남긴다 — 서울 API 가 서울 버스까지 알려 준다.
    const kept=tagoStops.filter(stop=>!seoulStops.some(other=>other.name===stop.name && nearMetres(other.at,stop.at)<30));
    return [...seoulStops,...kept];
  }
  // 같은 이름·ID가 반복되어도 정류장 "등장 순서"로 구간을 고른다.
  function tripStopLabel(stop,index){
    return (Number.isInteger(stop.order) && stop.order>0?stop.order:index+1)+". "+stop.name
      +(stop.id?" ("+stop.id+")":"")+(stop.direction && !/^[0-9]+$/.test(stop.direction)?" · "+stop.direction:"");
  }
  function tripStopIndex(stops,value){
    const query=String(value || "").trim();
    if(!query)return -1;
    const labeled=stops.findIndex((stop,index)=>tripStopLabel(stop,index)===query);
    if(labeled>=0)return labeled;
    const matches=stops.flatMap((stop,index)=>stop.name===query?[index]:[]);
    return matches.length===1?matches[0]:-1;
  }
  function tripSection(stops,from,to){
    if(!Number.isInteger(from) || !Number.isInteger(to) || from<0 || to<0 || from>=stops.length || to>=stops.length)return {error:"stops"};
    if(from===to)return {error:"same"};
    if(from>to)return {error:"direction"};
    const section=stops.slice(from,to+1);
    // 좌표 없는 정류장이 기존 지도 목록에서 빠졌다면 그 틈을 임의로 한 구간으로 계산하지 않는다.
    if(section.some((stop,i)=>!Number.isInteger(stop.order) || stop.order<1 || (i && stop.order!==section[i-1].order+1)))return {error:"gap",section};
    return {section,count:to-from};
  }
  function tripEstimate(data,choice,section,now=Date.now()){
    if(!choice || choice.city!==seoulCity)return {error:"unsupported"};
    if(!data || data.version!==1 || data.unit!=="seconds" || !data.routes)return {error:"data"};
    const end=Date.parse(data.to+"T23:59:59+09:00");
    if(!Number.isFinite(end) || !Number.isFinite(now) || now>end+90*86400000 || now<Date.parse(data.from+"T00:00:00+09:00"))return {error:"old"};
    const rows=data.routes[choice.id];
    if(!Array.isArray(rows) || !Array.isArray(section) || section.length<2)return {error:"missing"};
    const edges=new Map(rows.map(row=>[[row[0],row[1],row[2],row[3]].join(":"),row]));
    let seconds=0;
    for(let i=1;i<section.length;i++){
      const a=section[i-1],b=section[i];
      if(!Number.isInteger(a.order) || b.order!==a.order+1)return {error:"missing"};
      const edge=edges.get([a.stId,b.stId,a.order,b.order].join(":"));
      const hour=new Date(now+seconds*1000+9*3600000).getUTCHours();
      const duration=edge && edge[5+hour];
      if(!Number.isFinite(duration) || duration<=0 || duration>7200)return {error:"missing"};
      seconds+=duration;
    }
    return {seconds,from:data.from,to:data.to};
  }
  let tripDataPromise=null;
  function loadTripData(){
    if(!tripDataPromise)tripDataPromise=(async()=>{
      const embedded=typeof document!=="undefined" && document.getElementById("mnBusTravelData");
      if(embedded && embedded.textContent.trim())return JSON.parse(embedded.textContent);
      const response=await fetch("src/assets/bus-travel-seoul.json",{cache:"no-cache"});
      if(!response.ok)throw new Error("bus-travel-data-unavailable");
      return response.json();
    })().catch(error=>{tripDataPromise=null;throw error;});
    return tripDataPromise;
  }
  return {provider,coords,rows,routes,route,positions,cities,arrivals,nearby,arrivalText,validNumber,
    request,nearbyAt,nearbySources,seoulEdgeMetres,catalog,catalogGroups,loadCatalog,catalogJob,tripStopLabel,tripStopIndex,tripSection,tripEstimate,loadTripData,
    seoulCity,seoulRows,seoulRoutes,seoulRoute,seoulPositions,seoulArrival,seoulArrivals,seoulNearby};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNJejuBusApi;
