"use strict";
/* TAGO(국토교통부 국가대중교통정보센터) 응답 해석. 수신시각을 GPS 측정시각으로 쓰지 않는다.
   응답 모양: {response:{header:{resultCode}, body:{items:{item:[…] 또는 {…}}, totalCount}}}.
   결과가 없으면 items 가 빈 문자열로 오고, 한 건이면 item 이 배열이 아니라 객체로 온다.
   숫자처럼 생긴 값(routeno 201)은 숫자로 올 수 있어 늘 text() 로 읽는다. */
const MNJejuBusApi = (() => {
  const provider = "tago";
  const text = v => String(v == null ? "" : v).trim().slice(0,180);
  const validId = v => /^[A-Za-z0-9]{1,30}$/.test(text(v));
  function coords(r){
    if (!r || r.gpslati == null || r.gpslong == null || r.gpslati === "" || r.gpslong === "") return null;
    const lat=Number(r.gpslati), lng=Number(r.gpslong);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat>=33 && lat<=33.7 && lng>=126 && lng<=127.1 ? [lat,lng] : null;
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
  // 노선 목록 한 줄 = [번호, 기점, 종점, 세부 노선 수]. 앱에 넣어 둔 목록과 런처가 최신화한 목록이 같은 모양이다.
  function catalog(body){
    if (!body || !Array.isArray(body.routes)) throw new Error("bus-invalid-data");
    const seen=new Set();
    const routes=body.routes.flatMap(r=>{
      const number=Array.isArray(r) ? text(r[0]) : "";
      if (!/^[0-9\-]{1,12}$/.test(number) || seen.has(number)) return [];
      seen.add(number);
      return [{number,from:text(r[1]),to:text(r[2]),count:Math.max(0,Math.floor(Number(r[3]) || 0))}];
    }).sort((a,b)=>(parseInt(a.number,10)-parseInt(b.number,10)) || a.number.localeCompare(b.number));
    return {updatedAt:text(body.updatedAt),routes};
  }
  // 백 단위로 묶는다. 이 검색 응답은 노선 종류(busTypeStr)를 비워 주므로 급행·간선 같은 이름은 붙이지 않는다.
  function catalogGroups(routes){
    const groups=new Map();
    for (const route of routes){
      const n=parseInt(route.number,10), hundred=Number.isFinite(n) ? Math.floor(n/100)*100 : -1;
      if (!groups.has(hundred)) groups.set(hundred,[]);
      groups.get(hundred).push(route);
    }
    return [...groups].map(([hundred,list])=>({hundred,routes:list}));
  }
  async function loadCatalog({signal}={}){
    const response=await fetch("/jeju-bus-catalog",{signal,cache:"no-store"});
    if (response.status===404) return null;
    if (!response.ok) throw new Error("bus-fetch-failed");
    return catalog(await response.json());
  }
  async function catalogJob(action,{signal,minimum=1}={}){
    if (!["status","refresh","cancel"].includes(action)) throw new Error("bus-bad-request");
    const url=action==="status" ? "/jeju-bus-catalog-status"
      : action==="refresh" ? "/jeju-bus-catalog-refresh?min="+Math.max(1,Math.floor(Number(minimum) || 1)) : "/jeju-bus-catalog-cancel";
    const response=await fetch(url,action==="status" ? {signal,cache:"no-store"}
      : {method:"POST",headers:{"X-ClassDock-Action":"1"},signal,cache:"no-store"});
    if (!response.ok && response.status!==409) throw new Error("bus-catalog-failed");
    const body=await response.json();
    const count=v=>Math.max(0,Math.floor(Number(v) || 0));
    return {state:text(body && body.state),error:text(body && body.error),done:count(body && body.done),
      total:count(body && body.total),found:count(body && body.found),busy:response.status===409};
  }
  async function request(kind,value,{signal,refresh=false}={}){
    if (!["routes","route","position"].includes(kind)) throw new Error("bus-bad-request");
    if (kind==="routes" ? !/^[0-9\-]{1,12}$/.test(value) : !validId(value)) throw new Error("bus-bad-request");
    const response=await fetch("/jeju-bus-"+kind+"?"+(kind==="routes"?"keyword":"routeId")+"="+encodeURIComponent(value)
      +(refresh && kind!=="position"?"&refresh=1":""),{signal,cache:"no-store"});
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
    const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    const result=positions(body,value,stamp,Math.max(0,Date.now()-stamp));
    result.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
    result.stale=response.headers.get("X-ClassDock-Bus-Stale")==="1";
    return result;
  }
  return {provider,coords,rows,routes,route,positions,request,catalog,catalogGroups,loadCatalog,catalogJob};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNJejuBusApi;
