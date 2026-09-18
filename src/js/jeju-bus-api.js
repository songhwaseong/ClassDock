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
      .map(r=>({id:text(r.nodeid),name:text(r.nodenm),at:coords(r)}));
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
  // 도착 안내 한 줄의 남은 시간 글.
  function arrivalText(item,t=v=>v){
    const parts=[];
    if (item.seconds!=null) parts.push(item.seconds<60 ? t("곧 도착") : Math.round(item.seconds/60)+t("분 후"));
    if (item.stops!=null && item.stops>0) parts.push(item.stops+t("정류장 전"));
    return parts.join(" · ") || t("도착 정보 없음");
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
    const withCity=kind!=="nearby" && kind!=="cities" ? cityQuery(city) : "";
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
    if (kind==="routes") return routes(body,value);
    if (kind==="route") return route(body);
    if (kind==="cities") return cities(body);
    if (kind==="nearby") return nearby(body,jejuCodes);
    if (kind==="arrivals"){
      const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
      return {items:arrivals(body),fetchedAt:Number.isFinite(stamp)?stamp:Date.now()};
    }
    const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    const result=positions(body,value,stamp,Math.max(0,Date.now()-stamp));
    result.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
    result.stale=response.headers.get("X-ClassDock-Bus-Stale")==="1";
    return result;
  }
  return {provider,coords,rows,routes,route,positions,cities,arrivals,nearby,arrivalText,validNumber,
    request,catalog,catalogGroups,loadCatalog,catalogJob};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNJejuBusApi;
