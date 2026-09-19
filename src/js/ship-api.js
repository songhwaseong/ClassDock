"use strict";
/* TAGO '국내선박운항정보'(여객선 시간표) 응답 해석과 런처 조회.
   응답에 좌표가 없고 상태(결항·지연)도 없다 — 출발 항구 하나를 고르면 그날 떠나는 편의
   선박명·도착지 이름·출발/도착 예정 시각·운임이 온다. 좌표는 ship-ports-data.js 의 이름 표로 붙인다.
   2026-09-19 전국 749개 항구를 모두 물어 본 실측:
   - 떠나는 편이 있는 항구 333곳, 하루 6258편, 이름 345개. 가장 붐비는 목포가 138편이라 한 쪽(500줄)이면 된다.
   - 도착 예정 시각은 한 배가 여러 섬을 들르면 모든 도착지에 같은 값(마지막 도착 무렵)이 온다
     (인천→대연평·소연평 둘 다 11:36). 그래서 '몇 분 걸린다'로 읽지 않는다.
   - 같은 이름의 항구가 둘인 곳이 있다(조도·장도·백야도 등 9곳) → 표에 두 자리를 두고 출발 항구에 가까운 쪽을 쓴다.
   - 선박명에 공백이 겹쳐 온다('뉴  퀸'). 운임 0 은 '정보 없음'이다.
   - 결과가 한 건이어도 배열로 오지만(버스와 다름), 빈 결과·단건 객체도 받아 둔다. */
const MNShipApi = (() => {
  const text = v => String(v == null ? "" : v).replace(/\s+/g," ").trim().slice(0,120);
  const validPort = v => /^SEA[0-9]{5}$/.test(text(v));
  const validDate = v => /^[0-9]{8}$/.test(text(v));
  // 표시용 이름: '울릉_도동' → '울릉 도동', '임자_진리(순회)' → '임자 진리(순회)'.
  const displayName = name => text(name).replace(/_/g," ");
  function rows(body){
    const response=body && typeof body==="object" ? body.response : null;
    const code=response && response.header ? text(response.header.resultCode) : "";
    if (code==="03") return [];
    if (code!=="00" || !response.body || typeof response.body!=="object") throw new Error("ship-invalid-data");
    const items=response.body.items;
    if (items==null || items==="") return [];
    if (typeof items!=="object") throw new Error("ship-invalid-data");
    const item=items.item;
    if (item==null) return [];
    if (Array.isArray(item)) return item;
    if (typeof item==="object") return [item];
    throw new Error("ship-invalid-data");
  }
  function ports(body){
    const seen=new Set();
    return rows(body).flatMap(r=>{
      const id=text(r && r.nodeId), name=text(r && r.nodeNm);
      if (!validPort(id) || !name || seen.has(id)) return [];
      seen.add(id);
      return [{id,name}];
    });
  }
  // YYYYMMDDHHMI(숫자로 온다) → {day:"YYYYMMDD", time:"HH:MM", minutes}
  function stamp(v){
    const value=text(v);
    if (!/^[0-9]{12}$/.test(value)) return null;
    const hour=Number(value.slice(8,10)), minute=Number(value.slice(10,12));
    if (hour>23 || minute>59) return null;
    return {day:value.slice(0,8),time:value.slice(8,10)+":"+value.slice(10,12),minutes:hour*60+minute,raw:value};
  }
  function schedule(body){
    const seen=new Set();
    return rows(body).flatMap(r=>{
      if (!r || typeof r!=="object") return [];
      const from=text(r.depPlaceNm), to=text(r.arrPlaceNm), dep=stamp(r.depPlandTime), arr=stamp(r.arrPlandTime);
      if (!from || !to || !dep) return [];
      const ship=text(r.vihicleNm), fare=Number(r.charge);
      const key=ship+"|"+to+"|"+dep.raw;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ship,from,to,dep,arr,fare:Number.isFinite(fare) && fare>0 ? Math.round(fare) : null}];
    }).sort((a,b)=>a.dep.raw.localeCompare(b.dep.raw) || a.ship.localeCompare(b.ship,"ko") || a.to.localeCompare(b.to,"ko"));
  }
  // 한 배가 같은 시각에 떠나 여러 섬을 들르는 것을 한 '항해'로 묶는다(목록에서 한 줄로 보이게).
  function voyages(items){
    const groups=new Map();
    for (const item of items){
      const key=item.ship+"|"+item.dep.raw;
      if (!groups.has(key)) groups.set(key,{ship:item.ship,from:item.from,dep:item.dep,arr:item.arr,stops:[],fares:[]});
      const group=groups.get(key);
      group.stops.push(item.to);
      if (item.fare!=null) group.fares.push(item.fare);
      if (item.arr && (!group.arr || item.arr.raw>group.arr.raw)) group.arr=item.arr;
    }
    return [...groups.values()];
  }
  function destinations(items){
    const groups=new Map();
    for (const item of items){
      if (!groups.has(item.to)) groups.set(item.to,{name:item.to,count:0,ships:new Set()});
      const group=groups.get(item.to);group.count++;if(item.ship)group.ships.add(item.ship);
    }
    return [...groups.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,"ko"));
  }

  // ── 좌표 ──
  function metres(a,b){
    const rad=Math.PI/180, dy=(b[0]-a[0])*rad, dx=(b[1]-a[1])*rad;
    const h=Math.sin(dy/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dx/2)**2;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  const table = () => (typeof MNShipPortData!=="undefined" && MNShipPortData && MNShipPortData.ports) || {};
  // 표의 값은 [위도,경도] 하나, 또는 같은 이름 항구가 둘이면 [[…],[…]]. near 가 있으면 가까운 쪽.
  function coordsOf(name,near=null){
    const value=table()[text(name)];
    if (!Array.isArray(value) || !value.length) return null;
    const spots=Array.isArray(value[0]) ? value : [value];
    if (spots.length===1 || !near) return spots[0].slice();
    return spots.slice().sort((a,b)=>metres(a,near)-metres(b,near))[0].slice();
  }
  function nearby(at,limit=12,known=null){
    const list=[];
    for (const [name,value] of Object.entries(table())){
      if (known && !known.has(name)) continue;
      const spots=Array.isArray(value[0]) ? value : [value];
      for (const spot of spots) list.push({name,at:spot.slice(),distance:metres(at,spot)});
    }
    return list.sort((a,b)=>a.distance-b.distance).slice(0,limit);
  }

  // ── 런처 조회 ── 오류 까닭은 버스와 같은 이름(같은 TAGO 키·같은 조회 길).
  async function get(url,signal,refresh){
    const response=await fetch(url+(refresh?(url.includes("?")?"&":"?")+"refresh=1":""),{signal,cache:"no-store"});
    if (!response.ok){
      let reason="";
      if (response.status===428 || response.status===429){try{reason=text(await response.text());}catch(_){}}
      const error=new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "ship-fetch-failed");
      error.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
      throw error;
    }
    const at=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return {body:await response.json(),fetchedAt:Number.isFinite(at) ? at : Date.now()};
  }
  async function loadPorts({signal}={}){
    const result=await get("/ship-ports",signal,false);
    return ports(result.body);
  }
  async function loadSchedule(port,date,{signal,refresh=false}={}){
    if (!validPort(port) || !validDate(date)) throw new Error("ship-bad-request");
    const result=await get("/ship-schedule?port="+port+"&date="+date,signal,refresh);
    return {items:schedule(result.body),fetchedAt:result.fetchedAt};
  }
  const ymd = day => day.getFullYear()+String(day.getMonth()+1).padStart(2,"0")+String(day.getDate()).padStart(2,"0");
  return {validPort,validDate,displayName,rows,ports,stamp,schedule,voyages,destinations,metres,coordsOf,nearby,
    loadPorts,loadSchedule,ymd};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNShipApi;
