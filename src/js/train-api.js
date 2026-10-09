"use strict";
/* TAGO 열차정보(TrainInfo). 시간표이며 실제 열차 위치·지연·좌석 정보는 포함하지 않는다.
   2026-10-09 공식 명세와 실측: 필드 이름은 소문자, 시각은 YYYYMMDDHHMISS,
   열차번호는 앞자리 0을 포함한 문자열이다. 인증키는 EXE 런처에서만 사용한다. */
const MNTrainApi = (() => {
  const text = value => String(value == null ? "" : value).replace(/\s+/g," ").trim().slice(0,120);
  const validStation = value => /^NAT[A-Z0-9]{6,9}$/.test(text(value));
  const validCity = value => /^[1-9][0-9]{1,2}$/.test(text(value));
  function validDate(value){
    if (typeof value!=="string" || !/^[0-9]{8}$/.test(value)) return false;
    const year=Number(value.slice(0,4)),month=Number(value.slice(4,6)),day=Number(value.slice(6,8));
    const date=new Date(Date.UTC(year,month-1,day));
    return year>=2000 && year<=2100 && date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day;
  }
  function rows(body){
    const response=body && body.response,code=text(response && response.header && response.header.resultCode);
    if (code==="03") return [];
    if (code!=="00" || !response.body || typeof response.body!=="object") throw new Error("train-invalid-data");
    const items=response.body.items;
    if (items==null || items==="") return [];
    if (typeof items!=="object") throw new Error("train-invalid-data");
    if (items.item==null || items.item==="") return [];
    if (Array.isArray(items.item)) return items.item;
    if (typeof items.item==="object") return [items.item];
    throw new Error("train-invalid-data");
  }
  function count(body,fallback){
    const value=body && body.response && body.response.body && body.response.body.totalCount;
    if (value==null || value==="") return fallback;
    const number=Number(value);
    if (!Number.isSafeInteger(number) || number<0) throw new Error("train-invalid-data");
    return number;
  }
  function cities(body){
    return rows(body).flatMap(row=>{
      const id=text(row && row.citycode),name=text(row && row.cityname);
      return validCity(id) && name ? [{id,name}] : [];
    });
  }
  function grades(body){
    return rows(body).flatMap(row=>{
      const id=text(row && row.vehiclekndid),name=text(row && row.vehiclekndnm);
      return /^[0-9A-Z]{2}$/.test(id) && name ? [{id,name}] : [];
    });
  }
  function stations(body,city){
    return rows(body).flatMap(row=>{
      const id=text(row && row.nodeid),name=text(row && row.nodename);
      return validStation(id) && name ? [{id,name,cityCode:city.id,cityName:city.name,label:name+" · "+city.name}] : [];
    });
  }
  function stamp(value){
    const raw=text(value);
    if (!/^[0-9]{12}(?:[0-9]{2})?$/.test(raw) || !validDate(raw.slice(0,8))) return null;
    const hour=Number(raw.slice(8,10)),minute=Number(raw.slice(10,12)),second=Number(raw.slice(12,14) || "0");
    if (hour>23 || minute>59 || second>59) return null;
    return {day:raw.slice(0,8),time:raw.slice(8,10)+":"+raw.slice(10,12),raw,
      at:Date.UTC(Number(raw.slice(0,4)),Number(raw.slice(4,6))-1,Number(raw.slice(6,8)),hour,minute,second)-9*3600000};
  }
  function schedule(body){
    const seen=new Set();
    return rows(body).flatMap(row=>{
      if (!row || typeof row!=="object") return [];
      const dep=stamp(row.depplandtime),arr=stamp(row.arrplandtime),number=text(row.trainno),grade=text(row.traingradename);
      const from=text(row.depplacename),to=text(row.arrplacename),fare=Number(row.adultcharge);
      if (!dep || !arr || arr.at<dep.at || !number || !from || !to) return [];
      const key=number+"|"+dep.raw+"|"+arr.raw;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{number,grade,from,to,dep,arr,duration:Math.round((arr.at-dep.at)/60000),
        fare:Number.isFinite(fare) && fare>0 ? Math.round(fare) : null}];
    }).sort((a,b)=>a.dep.at-b.dep.at || a.number.localeCompare(b.number));
  }
  const isKtx = name => /^KTX(?:\b|[-\s])/i.test(text(name));
  const normalizeName = name => text(name).replace(/\s/g,"").replace(/역$/,"");
  function resolveStation(value,list){
    const exact=list.filter(row=>row.label===text(value) || row.id===text(value));
    if (exact.length===1) return exact[0];
    const matching=list.filter(row=>normalizeName(row.name)===normalizeName(value));
    return matching.length===1 ? matching[0] : null;
  }
  const dateAt = (at=Date.now()) => new Date(at+9*3600000).toISOString().slice(0,10);
  const ymd = (at=Date.now()) => dateAt(at).replace(/-/g,"");
  async function get(url,{signal,refresh=false}={}){
    const response=await fetch(url+(refresh ? (url.includes("?") ? "&" : "?")+"refresh=1" : ""),{signal,cache:"no-store"});
    if (!response.ok){
      let reason="";
      if (response.status===428 || response.status===429) { try { reason=text(await response.text()); } catch(_){} }
      const error=new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "train-fetch-failed");
      error.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
      throw error;
    }
    const at=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return {body:await response.json(),fetchedAt:Number.isFinite(at) ? at : Date.now()};
  }
  // 쪽을 빠뜨리지 않고 받는다. 상한에 닿으면 일부 자료라는 것을 호출자에게 알린다.
  async function pages(url,options){
    const items=[],limit=10,size=300;
    let total=0,fetchedAt=Infinity;
    for (let page=1;page<=limit;page++){
      const result=await get(url+(url.includes("?") ? "&" : "?")+"page="+page,options);
      const part=rows(result.body);
      total=count(result.body,items.length+part.length);items.push(...part);fetchedAt=Math.min(fetchedAt,result.fetchedAt);
      if (items.length>=total) return {items,total,fetchedAt,truncated:false};
      if (!part.length || part.length<size) return {items,total,fetchedAt,truncated:true};
    }
    return {items,total,fetchedAt,truncated:true};
  }
  let cachedCatalogue=null;
  async function loadCatalogue({signal}={}){
    if (cachedCatalogue && Date.now()-cachedCatalogue.at<86400000) return cachedCatalogue;
    const controller=new AbortController(),cancel=()=>controller.abort();
    if (signal){if(signal.aborted)controller.abort();else signal.addEventListener("abort",cancel,{once:true});}
    try{
      const [cityResult,gradeResult]=await Promise.all([get("/train-cities",{signal:controller.signal}),get("/train-grades",{signal:controller.signal})]);
      const cityList=cities(cityResult.body),gradeList=grades(gradeResult.body);
      if (!cityList.length) throw new Error("train-invalid-data");
      let next=0;
      const stationLists=await Promise.all(Array.from({length:Math.min(3,cityList.length)},async()=>{
        const found=[];
        while (next<cityList.length){
          const city=cityList[next++],result=await pages("/train-stations?city="+city.id,{signal:controller.signal});
          if (result.truncated) throw new Error("train-incomplete-stations");
          found.push(...stations({response:{header:{resultCode:"00"},body:{items:{item:result.items}}}},city));
        }
        return found;
      }));
      const unique=new Map(stationLists.flat().map(station=>[station.id,station]));
      const list=[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name,"ko") || a.cityName.localeCompare(b.cityName,"ko"));
      if (!list.length) throw new Error("train-invalid-data");
      const labels=new Map();
      for (const station of list) labels.set(station.label,(labels.get(station.label) || 0)+1);
      for (const station of list) if (labels.get(station.label)>1) station.label+=" · "+station.id;
      cachedCatalogue={stations:list,grades:gradeList,at:Date.now()};
      return cachedCatalogue;
    } catch(error){controller.abort();throw error;}
    finally {if(signal)signal.removeEventListener("abort",cancel);}
  }
  async function loadSchedule(from,to,date,options={}){
    if (!validStation(from) || !validStation(to) || from===to || !validDate(date)) throw new Error("train-bad-request");
    const result=await pages("/train-schedule?from="+from+"&to="+to+"&date="+date,options);
    return {...result,items:schedule({response:{header:{resultCode:"00"},body:{items:{item:result.items}}}})};
  }
  return {validStation,validCity,validDate,rows,count,cities,grades,stations,stamp,schedule,isKtx,resolveStation,dateAt,ymd,loadCatalogue,loadSchedule};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNTrainApi;
