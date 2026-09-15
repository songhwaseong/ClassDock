"use strict";
/* 공급자별 응답 해석. 수신시각을 GPS 측정시각으로 쓰지 않는다. */
const MNJejuBusApi = (() => {
  const provider = "jeju-bis";
  const text = v => String(v == null ? "" : v).trim().slice(0,180);
  const validId = v => /^\d{1,12}$/.test(text(v));
  function coords(r){
    if (!r || r.localY == null || r.localX == null) return null;
    const lat=Number(r.localY), lng=Number(r.localX);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat>=33 && lat<=33.7 && lng>=126 && lng<=127.1 ? [lat,lng] : null;
  }
  function rows(body, field){
    if (Array.isArray(body)) return body;
    if (body && typeof body==="object" && Object.prototype.hasOwnProperty.call(body,field)) return [body];
    throw new Error("bus-invalid-data");
  }
  function routes(body){
    const seen=new Set();
    return rows(body,"routeId").flatMap(r=>{
      if (!r || !validId(r.routeId) || seen.has(String(r.routeId))) return [];
      const id=String(r.routeId); seen.add(id);
      return [{id,number:text(r.routeNum),from:text(r.orgtNm),to:text(r.dstNm),description:text(r.routeNm || r.routeSubNm),type:text(r.busTypeStr)}];
    });
  }
  function route(body){
    if (!body || !Array.isArray(body.stationInfoList)) throw new Error("bus-invalid-data");
    return body.stationInfoList.filter(r=>r && coords(r)).sort((a,b)=>Number(a.linkOrd)-Number(b.linkOrd))
      .map(r=>({id:text(r.stationId),name:text(r.stationNm),at:coords(r)}));
  }
  function shape(body){
    if (!Array.isArray(body) || body.length<2 || body.length>20000) return [];
    const points=body.map(coords);
    return points.every(Boolean) ? points.filter((p,i)=>!i || p[0]!==points[i-1][0] || p[1]!==points[i-1][1]) : [];
  }
  function positions(body,id,fetchedAt,cacheAgeMs=0){
    if (!validId(id) || !Number.isFinite(fetchedAt) || fetchedAt<=0) throw new Error("bus-invalid-data");
    const source=rows(body,"vhId"), seen=new Set();
    const vehicles=source.flatMap(r=>{
      const at=coords(r), key=r && text(r.vhId || r.plateNo);
      if (!at || !key || seen.has(key)) return [];
      seen.add(key);
      return [{id:provider+":"+id+":"+key,label:text(r.plateNo),at,stationId:text(r.currStationId),stationName:text(r.currStationNm),observedAt:null}];
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
    if (!["routes","route","shape","position"].includes(kind)) throw new Error("bus-bad-request");
    if (kind==="routes" ? !/^[0-9\-]{1,12}$/.test(value) : !validId(value)) throw new Error("bus-bad-request");
    const response=await fetch("/jeju-bus-"+kind+"?"+(kind==="routes"?"keyword":"routeId")+"="+encodeURIComponent(value)
      +(refresh && kind!=="position"?"&refresh=1":""),{signal,cache:"no-store"});
    if (!response.ok){
      const error=new Error("bus-fetch-failed");
      error.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
      throw error;
    }
    const body=await response.json();
    if (kind==="routes") return routes(body);
    if (kind==="route") return route(body);
    if (kind==="shape") return shape(body);
    const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    const result=positions(body,value,stamp,Math.max(0,Date.now()-stamp));
    result.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
    result.stale=response.headers.get("X-ClassDock-Bus-Stale")==="1";
    return result;
  }
  return {provider,coords,routes,route,shape,positions,request,catalog,catalogGroups,loadCatalog,catalogJob};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNJejuBusApi;
