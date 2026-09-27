"use strict";
/* 지도에만 속하는 실시간 층. .map 모델과 사용자 마커를 수정하지 않는다.
   처음엔 제주 버스만 봤다(이름 jeju-bus 는 그때 것). 지금은 TAGO 도시코드를 골라 전국 도시를 보고,
   정류장 도착 예정·근처 정류장도 함께 본다. 도시 빈칸("") = 제주 — 앱에 넣어 둔 노선 목록도 제주 것이다. */
const MNJejuBusMap = (() => {
  let tripPanelId=0;
  function mount({map,stage,toolRow,doc,t = value=>value,movePanel = null}){
    const el=(tag,cls,label)=>{const node=document.createElement(tag);node.className=cls;if(label)node.textContent=t(label);return node;};
    const button=(label,cls="")=>{const node=el("button","map-btn "+cls,label);node.type="button";return node;};
    const toggle=button("🚌 버스","map-toolvis-jeju-bus");
    if (typeof mapSetToolIcon==="function") mapSetToolIcon(toggle,"bus");
    toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-pressed","false");
    toggle.disabled=true;toggle.title=t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");toolRow.appendChild(toggle);
    const panel=el("section","map-jeju-bus-panel");panel.hidden=true;panel.setAttribute("aria-label",t("버스"));
    const heading=el("div","map-jeju-bus-heading"), close=button("닫기");
    const citySelect=el("select","map-select map-jeju-bus-city");citySelect.setAttribute("aria-label",t("도시"));
    heading.append(el("strong","","버스"),citySelect,close);
    const form=el("form","map-jeju-bus-search"), input=el("input","map-input");
    input.setAttribute("aria-label",t("버스 노선번호"));input.maxLength=20;
    try {input.value=localStorage.getItem("mapJejuBusKeyword") || "201";}catch(_){input.value="201";}
    const search=button("검색");search.type="submit";
    const catalogSelect=el("select","map-select map-jeju-bus-catalog");catalogSelect.setAttribute("aria-label",t("노선 목록에서 고르기"));
    form.append(catalogSelect,input,search);
    const select=el("select","map-select");select.setAttribute("aria-label",t("버스 세부 노선"));select.disabled=true;
    const preview=el("p","map-jeju-bus-preview","노선을 검색해 주세요.");
    const actions=el("div","map-jeju-bus-actions"), start=button("지도에 표시"),fit=button("노선 전체 보기"),refresh=button("노선 새로고침");
    start.disabled=true;fit.disabled=true;refresh.disabled=true;actions.append(start,fit,refresh);
    const status=el("p","map-jeju-bus-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    // 정류장 도착 정보. 지도 가운데 근처 정류장을 찾거나, 표시 중인 노선의 정류장 점을 눌러 연다.
    const stopBox=el("div","map-jeju-bus-stops");
    const stopTools=el("div","map-jeju-bus-stop-tools"),nearbyButton=button("📍 지도 가운데 근처 정류장","map-jeju-bus-nearby");
    nearbyButton.disabled=true;stopTools.append(nearbyButton);
    const stopList=el("div","map-jeju-bus-stop-list");stopList.hidden=true;
    const arrivalBox=el("div","map-jeju-bus-arrivals");arrivalBox.hidden=true;
    const arrivalHead=el("div","map-jeju-bus-arrivals-head"),arrivalTitle=el("strong",""),arrivalRefresh=button("새로고침");
    arrivalHead.append(arrivalTitle,arrivalRefresh);
    const arrivalList=el("ul","map-jeju-bus-arrival-list"),arrivalStatus=el("p","map-jeju-bus-arrival-status");
    arrivalStatus.setAttribute("role","status");arrivalStatus.setAttribute("aria-live","polite");
    arrivalBox.append(arrivalHead,arrivalList,arrivalStatus);
    stopBox.append(stopTools,stopList,arrivalBox);
    const tripBox=el("form","map-jeju-bus-trip");
    const tripHeading=el("strong","","구간 예상시간"),tripFields=el("div","map-jeju-bus-trip-fields");
    const tripInputs=[],tripLists=[],tripId=++tripPanelId;
    for(const [i,title] of ["출발 정류장","도착 정류장"].entries()){
      const label=el("label","",title),field=el("input","map-input"),list=el("datalist","");
      list.id="map-bus-trip-"+tripId+"-"+i;field.setAttribute("list",list.id);
      field.setAttribute("aria-label",t(title));field.placeholder=t("정류장명을 입력하거나 목록에서 고르세요.");field.maxLength=250;field.disabled=true;
      label.append(field);tripFields.append(label,list);tripInputs.push(field);tripLists.push(list);
    }
    const tripActions=el("div","map-jeju-bus-actions"),tripSearch=button("예상시간 조회"),tripFit=button("선택 구간 보기");
    tripSearch.type="submit";tripSearch.disabled=true;tripFit.disabled=true;tripActions.append(tripSearch,tripFit);
    const tripResult=el("p","map-jeju-bus-trip-result","노선을 검색한 뒤 출발·도착 정류장을 골라 주세요.");
    tripResult.setAttribute("role","status");tripResult.setAttribute("aria-live","polite");
    const tripSource=el("a","","소요시간 통계: 서울 열린데이터광장");tripSource.href="https://data.seoul.go.kr/dataList/OA-21217/S/1/datasetView.do";
    tripSource.target="_blank";tripSource.rel="noopener noreferrer";tripSource.hidden=true;
    tripBox.append(tripHeading,tripFields,tripActions,tripResult,tripSource);
    const note=el("p","map-jeju-bus-note","위치는 지연될 수 있으며, 갱신 사이에는 마지막 위치를 표시합니다.");
    const source=el("a","");source.target="_blank";source.rel="noopener noreferrer";
    const catalogRow=el("div","map-jeju-bus-catalog-info"),catalogText=el("span","");
    const catalogRefresh=button("목록 최신화","map-jeju-bus-catalog-refresh"),catalogCancel=button("최신화 취소");
    catalogRefresh.disabled=true;catalogCancel.hidden=true;catalogRow.append(catalogText,catalogRefresh,catalogCancel);
    // 목록 최신화 줄은 노선 목록 바로 밑에 둔다. 패널 맨 아래로 내리면 접힌 부분에 숨어 보이지 않는다.
    panel.append(heading,form,catalogRow,select,preview,actions,status,stopBox,tripBox,note,source);stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
    if(typeof movePanel==="function")movePanel(panel,heading);
    const pane=map.createPane("mapJejuBusPane");pane.style.zIndex="640";
    const routePane=map.createPane("mapJejuBusRoutePane");routePane.style.zIndex="370";
    const vehicles=L.layerGroup(),routesLayer=L.layerGroup(),stopsLayer=L.layerGroup(),markers=new Map();
    const tripLayer=L.layerGroup();
    let tripAbort=null,tripGeneration=0,tripPoints=[];
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
    const capability=new AbortController();
    let destroyed=false,active=null,state=MNJejuBusLive.create(),shape=null,stations=[],choices=[],on=false;
    let generation=0,searchGeneration=0,selectionGeneration=0,pollAbort=null,searchAbort=null,detailAbort=null;
    let polling=false,nextPoll=0,failures=0,delayed=false,frame=0,frozen=0,wasVisible=false,needsFit=false;
    let stopAbort=null,stopGeneration=0,arrivalStation=null;
    const bundledCatalog=(()=>{
      try{return MNJejuBusApi.catalog(typeof MNJejuBusRouteCatalog!=="undefined"?MNJejuBusRouteCatalog:null);}
      catch(_){return {updatedAt:"",routes:[]};}
    })();
    // 도시. 목록을 받기 전에는 제주·서울과 지난번에 고른 도시만 둔다.
    // 서울(11)은 TAGO 에 없어 서울시 버스정보로 따로 묻는다 — 도시 목록에 늘 끼워 넣는다.
    const seoulCity=MNJejuBusApi.seoulCity,seoulEntry=()=>({code:seoulCity,name:t("서울특별시"),raw:seoulCity});
    const isSeoul=code=>code===seoulCity;
    let city="",cityName=t("제주"),cityList=[{code:"",name:t("제주"),raw:""},seoulEntry()];
    try{const saved=JSON.parse(localStorage.getItem("mapBusCity") || "null");
      if(saved && /^[0-9]{1,9}$/.test(String(saved.code)) && typeof saved.name==="string"){city=String(saved.code);cityName=saved.name.slice(0,40);
        if(!cityList.some(item=>item.code===city))cityList.push({code:city,name:cityName,raw:city});}
    }catch(_){}
    const emptyCatalog={updatedAt:"",routes:[]};
    let catalogData=city?emptyCatalog:bundledCatalog,catalogLatest=false,catalogNote="",canRefresh=false;
    let catalogWatching=false,catalogPolling=false,catalogNextPoll=0;
    const visible=()=>!document.hidden && !!stage.offsetParent;
    const colorFor=type=>/급행|리무진|좌석/.test(type)?"#c0392b":/간선/.test(type)?"#176bc0":/관광/.test(type)?"#986b00":/마을/.test(type)?"#4f8a2b":"#087f8c";
    const routeColor=()=>colorFor(active?active.type:"");
    const clock=stamp=>new Date(stamp).toLocaleTimeString([], {hour12:false});
    const setStatus=text=>{if(status.textContent!==text)status.textContent=text;};
    // 키·한도 문제는 기다려도 풀리지 않으므로 '다시 시도하는 중'이라고 하지 않고 할 일을 알려 준다.
    // 활용신청은 API 마다 따로라, 키가 거절되면 어느 API 를 신청해야 하는지 조회마다 다르게 알린다.
    const keyInvalidText={
      arrivals:"인증키가 버스 도착 정보에 쓰일 수 없어요. 공공데이터포털에서 TAGO 버스도착정보 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요.",
      nearby:"인증키가 정류장 찾기에 쓰일 수 없어요. 공공데이터포털에서 TAGO 버스정류소정보 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요."};
    // 서울은 서비스 이름이 다르다(노선정보조회·버스위치정보조회·정류소정보조회).
    const seoulKeyInvalidText={
      routes:"인증키가 서울 버스 노선 검색에 쓰일 수 없어요. 공공데이터포털에서 '서울특별시_노선정보조회 서비스' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요.",
      position:"인증키가 서울 버스 위치에 쓰일 수 없어요. 공공데이터포털에서 '서울특별시_버스위치정보조회 서비스' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요.",
      arrivals:"인증키가 서울 정류장 정보에 쓰일 수 없어요. 공공데이터포털에서 '서울특별시_정류소정보조회 서비스' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요."};
    seoulKeyInvalidText.route=seoulKeyInvalidText.routes;seoulKeyInvalidText.nearby=seoulKeyInvalidText.arrivals;
    const failureText=(error,fallback,kind="",askedCity=city)=>t(error && error.message==="bus-key-required"?"설정의 '공공데이터포털'에 인증키를 넣어 주세요."
      :error && error.message==="bus-key-invalid"?(isSeoul(askedCity)?seoulKeyInvalidText[kind || "position"]
        :keyInvalidText[kind] || "인증키가 이 조회에 쓰일 수 없어요. 공공데이터포털에서 TAGO 버스노선정보·버스위치정보 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요.")
      :error && error.message==="bus-quota"?"오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.":fallback);
    const stopFrame=()=>{cancelAnimationFrame(frame);frame=0;};
    function clear(){markers.clear();vehicles.clearLayers();routesLayer.clearLayers();map.removeLayer(vehicles);map.removeLayer(routesLayer);}
    function cancelPoll(){if(pollAbort)pollAbort.abort();pollAbort=null;polling=false;}
    function stopLive(){
      generation++;on=false;cancelPoll();stopFrame();clear();state=MNJejuBusLive.create();active=null;needsFit=false;
      fit.disabled=true;toggle.title=t("버스 노선을 선택해 실시간 위치를 봅니다.");toggle.setAttribute("aria-pressed","false");toggle.classList.remove("is-on");setStatus(t("버스 표시를 껐어요."));
    }
    function fitRoute(){
      if(!on)return;
      const points=shape?shape.points:stations.map(s=>s.at);
      const all=points.length?points:[...state.vehicles.values()].map(v=>v.at);
      if(all.length){map.fitBounds(L.latLngBounds(all),{padding:[35,35],maxZoom:14});needsFit=false;}
    }
    function paint(){
      if(frame)cancelAnimationFrame(frame);frame=0;if(!on || frozen || !visible())return;
      const now=Date.now();let moving=false,shown=0;
      for(const [id,vehicle] of state.vehicles){
        const view=MNJejuBusLive.view(vehicle,now,reduced.matches);let marker=markers.get(id);
        if(!view){if(marker){vehicles.removeLayer(marker);markers.delete(id);}continue;}
        shown++;moving=moving || view.moving;
        if(!marker){
          const icon=el("span","map-live-vehicle-icon map-jeju-bus-icon");icon.style.color=routeColor();
          const image=el("img","map-live-vehicle-image");image.src=mapVehicleIconUrl("bus",routeColor());image.alt="";image.setAttribute("aria-hidden","true");image.width=20;image.height=20;
          icon.append(image);
          marker=L.marker(view.at,{pane:"mapJejuBusPane",keyboard:true,title:active.number+" · "+vehicle.label,
            icon:L.divIcon({html:icon,className:"map-jeju-bus-marker",iconSize:[24,24],iconAnchor:[12,12]})});
          const tip=el("div","");marker.bindTooltip(tip,{direction:"top",offset:[0,-14]});marker._busTip=tip;
          markers.set(id,marker);vehicles.addLayer(marker);
        }
        marker.setLatLng(view.at);marker.setOpacity(view.dim?0.45:1);
        const markerEl=marker.getElement();
        if(markerEl)markerEl.classList.toggle("bus-relocated",!reduced.matches && vehicle.relocatedAt>now-1000);
        const content=[active.number+" · "+vehicle.label,active.type,vehicle.stationName,
          t(view.status),t("마지막 수신")+" "+clock(vehicle.lastSeenAt)].filter(Boolean).join(" · ");
        if(marker._busTip.textContent!==content)marker._busTip.textContent=content;
      }
      for(const [id,marker] of markers)if(!state.vehicles.has(id)){vehicles.removeLayer(marker);markers.delete(id);}
      const age=state.fetchedAt?now-state.fetchedAt:Infinity;
      setStatus(active.number+" · "+active.to+" · "+(state.fetchedAt ? t("버스")+" "+shown+t("대")+" · "+t("마지막 수신")+" "+clock(state.fetchedAt):t(delayed?"버스 정보를 받지 못했어요. 다시 시도하는 중이에요.":"버스 정보를 받는 중…"))
        +((delayed || age>=120000) && state.fetchedAt?" · "+t("정보 수신 지연"):"")
        +(state.fetchedAt && !state.vehicles.size?" · "+t("현재 조회된 차량 없음"):""));
      if(moving)frame=requestAnimationFrame(paint);
    }
    async function poll(){
      if(!on || polling || frozen || !visible())return;
      const gen=generation,id=active.id,routeCity=active.city,controller=new AbortController();pollAbort=controller;polling=true;
      try{
        const response=await MNJejuBusApi.request("position",id,{signal:controller.signal,city:routeCity});
        if(destroyed || gen!==generation || !on || controller.signal.aborted || frozen)return;
        // 서울 위치엔 정류장 이름이 없고 막 지난 정류장 ID(stId)만 온다. 받아 둔 정류장 목록에서 이름을 찾아 붙인다.
        if(isSeoul(routeCity) && stations.length){
          const names=new Map(stations.filter(s=>s.stId).map(s=>[s.stId,s.name]));
          for(const vehicle of response.vehicles)if(!vehicle.stationName)vehicle.stationName=names.get(vehicle.stationId) || "";
        }
        MNJejuBusLive.ingest(state,response,Date.now(),shape,!reduced.matches);
        if(response.stale)nextPoll=Math.max(nextPoll,Date.now()+(response.retryAfterMs || 0));
        delayed=response.stale;failures=response.stale?Math.min(failures+1,2):0;
        if(needsFit)fitRoute();
        paint();
      }catch(error){
        if(controller.signal.aborted || gen!==generation)return;
        delayed=true;failures=Math.min(failures+1,2);
        nextPoll=Math.max(nextPoll,Date.now()+(error.retryAfterMs || 0));
        setStatus(failureText(error,"버스 정보를 받지 못했어요. 다시 시도하는 중이에요.","position",routeCity));
      }finally{
        if(pollAbort===controller){pollAbort=null;polling=false;nextPoll=Math.max(nextPoll,Date.now()+30000*2**failures);}
      }
    }
    async function loadSelection(force=false){
      stopLive();const seq=++selectionGeneration;
      if(detailAbort)detailAbort.abort();detailAbort=new AbortController();
      const controller=detailAbort,choice=choices.find(r=>r.id===select.value);
      stations=[];shape=null;start.disabled=true;refresh.disabled=!choice;resetTrip();
      if(!choice)return;
      preview.textContent=t("정류장 목록을 받는 중…");
      // TAGO 에는 도로를 따라 그린 노선 경로가 없다. 그래서 shape 는 비워 두고 이동은 옮겨 놓기로만 보인다
      // (정류장 사이를 곧게 잇는 선으로 보간하면 건물·바다를 가로지른다).
      let failure=null,loadedStations=[];
      try{loadedStations=await MNJejuBusApi.request("route",choice.id,{signal:controller.signal,refresh:force,city:choice.city});}
      catch(error){failure=error;}
      if(destroyed || controller.signal.aborted || seq!==selectionGeneration)return;
      stations=loadedStations;
      preview.textContent=choice.from+" → "+choice.to+"\n"+(stations.length?stations.map(s=>s.name).join(" → ")
        :failure?failureText(failure,"정류장 정보를 받지 못했어요. 노선을 새로고침해 주세요.","route",choice.city):t("정류장 정보가 없어요."));
      start.disabled=false;populateTrip();
    }
    // 검색·목록 고르기 어느 쪽이든 되돌릴 일(늦은 응답·보던 노선)을 먼저 끊는다.
    function resetSearch(){
      stopLive();selectionGeneration++;if(detailAbort)detailAbort.abort();
      searchGeneration++;if(searchAbort)searchAbort.abort();searchAbort=null;
      stations=[];resetTrip();select.replaceChildren();select.disabled=true;choices=[];start.disabled=true;refresh.disabled=true;search.disabled=false;
    }
    async function searchRoutes(event){
      event.preventDefault();const value=input.value.trim();
      if(!MNJejuBusApi.validNumber(value)){setStatus(t("노선번호를 입력해 주세요."));return;}
      syncCatalogSelect();
      resetSearch();
      const seq=searchGeneration;searchAbort=new AbortController();
      const controller=searchAbort,searchCity=city;search.disabled=true;
      preview.textContent=t("노선을 검색하는 중…");
      try{
        const result=(await MNJejuBusApi.request("routes",value,{signal:controller.signal,city:searchCity})).map(r=>({...r,city:searchCity}));
        if(destroyed || seq!==searchGeneration || controller.signal.aborted)return;
        choices=result;select.replaceChildren();
        result.forEach((r,i)=>{const option=el("option","",r.number+" · "+r.from+" → "+r.to+" · "+t("세부 경로")+" "+(i+1));option.value=r.id;select.appendChild(option);});
        try { const saved=JSON.parse(localStorage.getItem("mapJejuBusRoute") || "null");
          if(saved && saved.provider===MNJejuBusApi.provider && result.some(r=>r.id===saved.id))select.value=saved.id;
        }catch(_){}
        select.disabled=!result.length;
        try{localStorage.setItem("mapJejuBusKeyword",value);}catch(_){}
        if(result.length)await loadSelection();else preview.textContent=t("검색된 노선이 없어요.");
      }catch(error){if(!controller.signal.aborted){const text=failureText(error,"노선을 받지 못했어요. 잠시 후 다시 검색해 주세요.","routes",searchCity);setStatus(text);preview.textContent=text;}}
      finally{if(seq===searchGeneration)search.disabled=false;}
    }
    // 노선 목록. 제주는 앱에 넣어 둔 목록을 기본으로 쓰고, 사용자가 [목록 최신화]를 누르면
    // 런처가 TAGO 에서 받아 만든 목록으로 갈아 끼운다. 다른 도시는 최신화해야 목록이 생긴다.
    function renderCatalog(){
      const placeholder=el("option","",catalogData.routes.length?"노선 목록에서 고르기":"노선 목록 없음 · 목록 최신화로 받기");placeholder.value="";
      const nodes=[placeholder];
      for(const group of MNJejuBusApi.catalogGroups(catalogData.routes)){
        const box=document.createElement("optgroup");
        box.label=group.hundred>=100?(group.prefix?group.prefix+" ":"")+group.hundred+t("번대"):group.prefix || t("기타 번호");
        for(const route of group.routes){
          const option=el("option","",route.number+(route.from&&route.to?" · "+route.from+" – "+route.to:""));
          option.value=route.number;box.appendChild(option);
        }
        nodes.push(box);
      }
      catalogSelect.replaceChildren(...nodes);
      catalogSelect.disabled=!catalogData.routes.length;
      syncCatalogSelect();
      const day=catalogData.updatedAt?new Date(catalogData.updatedAt):null;
      catalogText.textContent=[catalogData.routes.length || catalogLatest || !city
        ?t(catalogLatest?"최신화한 노선 목록":"앱에 들어 있는 노선 목록")+" · "+catalogData.routes.length+t("개 번호")
        :t("이 도시는 노선 목록이 아직 없어요"),
        day&&!isNaN(day)?day.toLocaleDateString():"",catalogNote].filter(Boolean).join(" · ");
    }
    function syncCatalogSelect(){
      const value=input.value.trim();
      catalogSelect.value=catalogData.routes.some(route=>route.number===value)?value:"";
    }
    function showCatalogJob(job){
      const running=job.state==="running";
      catalogWatching=catalogWatching || running;
      catalogRefresh.disabled=running || !canRefresh;catalogCancel.hidden=!running;catalogCancel.disabled=false;
      if(running){
        catalogText.textContent=t("노선 목록 최신화 중")+" "+job.done+"/"+job.total+" · "+t("찾은 번호")+" "+job.found;
        return;
      }
      catalogNote=job.state==="cancelled"?t("최신화를 멈췄어요. 예전 목록을 그대로 씁니다.")
        :job.state!=="failed"?""
        :job.error==="bus-key-required" || job.error==="bus-key-invalid"?t("공공데이터포털 인증키가 없거나 맞지 않아요. 예전 목록을 그대로 씁니다.")
        :job.error==="bus-quota"?t("오늘 조회 한도를 다 썼어요. 예전 목록을 그대로 씁니다.")
        :job.error==="bus-catalog-too-few"?t("찾은 번호가 너무 적어 예전 목록을 그대로 씁니다.")
        :t("노선 목록을 받지 못했어요. 예전 목록을 그대로 씁니다.");
      renderCatalog();
    }
    async function loadCatalogFile(){
      const wanted=city;
      try{
        const saved=await MNJejuBusApi.loadCatalog({signal:capability.signal,city:wanted});
        if(destroyed || wanted!==city || !saved || !saved.routes.length)return;
        catalogData=saved;catalogLatest=true;renderCatalog();
      }catch(_){}
    }
    async function pollCatalog(){
      catalogPolling=true;
      try{
        const job=await MNJejuBusApi.catalogJob("status",{signal:capability.signal});
        if(destroyed)return;
        if(job.state!=="running"){catalogWatching=false;catalogNote="";}
        // 다른 도시의 최신화가 끝났으면 그 도시 목록 파일만 바뀐 것이다. 지금 도시 목록은 건드리지 않는다.
        if(job.state!=="running" && (job.city || "")!==city){catalogRefresh.disabled=!canRefresh;catalogCancel.hidden=true;renderCatalog();return;}
        showCatalogJob(job);
        if(job.state==="done"){catalogNote=t("노선 목록을 최신화했어요.");await loadCatalogFile();}
      }catch(_){if(!destroyed){catalogWatching=false;catalogRefresh.disabled=!canRefresh;catalogCancel.hidden=true;}}
      finally{catalogPolling=false;catalogNextPoll=Date.now()+1000;}
    }
    async function startCatalogRefresh(){
      if(typeof confirmDialog!=="function")return;
      // 묻는 횟수의 기본 몫은 런처가 정한다(상태 응답의 total). 결과가 여러 쪽이면 몇 번 더 묻는다.
      let total=10;
      try{const job=await MNJejuBusApi.catalogJob("status",{signal:capability.signal});if(job.total)total=job.total;}catch(_){}
      if(destroyed)return;
      const jobCity=city,jobCityName=cityName;
      const ok=await confirmDialog(t(isSeoul(jobCity)?"서울시 버스정보에서 노선 목록을 받아 새로 만듭니다.":"TAGO에서 노선 목록을 받아 새로 만듭니다.")+" ("+jobCityName+")"
        +"\n\n"+t("오늘 조회 한도에서 요청을 약")+" "+total+t("번 씁니다. 도중에 멈출 수 있어요."),t("목록 최신화"),t("취소"));
      if(!ok || destroyed || jobCity!==city)return;
      catalogRefresh.disabled=true;catalogNote="";
      try{
        // 제주는 앱에 넣어 둔 목록의 절반은 찾아야 갈아 끼운다. 다른 도시는 비교할 목록이 없다.
        const minimum=jobCity?1:Math.max(1,Math.ceil(bundledCatalog.routes.length/2));
        const job=await MNJejuBusApi.catalogJob("refresh",{signal:capability.signal,minimum,city:jobCity});
        if(destroyed)return;
        catalogWatching=true;catalogNextPoll=Date.now()+1000;showCatalogJob(job);
      }catch(_){if(!destroyed){catalogNote=t("노선 목록 최신화를 시작하지 못했어요.");renderCatalog();}}
    }
    catalogRefresh.addEventListener("click",startCatalogRefresh);
    catalogCancel.addEventListener("click",()=>{
      catalogCancel.disabled=true;
      MNJejuBusApi.catalogJob("cancel",{signal:capability.signal}).catch(()=>{});
    });
    catalogSelect.addEventListener("change",()=>{
      if(!catalogSelect.value)return;
      input.value=catalogSelect.value;searchRoutes({preventDefault(){}});
    });
    input.addEventListener("input",syncCatalogSelect);
    // ── 도시 ──
    function renderCities(){
      const nodes=cityList.map(item=>{const option=el("option","");option.textContent=item.name;option.value=item.code;return option;});
      citySelect.replaceChildren(...nodes);citySelect.value=city;
    }
    function applyPlaceholder(){
      input.placeholder=t(isSeoul(city)?"노선번호 (예: 402)":city?"노선번호":"노선번호 (예: 201)");
      source.textContent=t(isSeoul(city)?"출처: 서울특별시 버스정보(공공데이터포털)":"출처: 국가대중교통정보센터(TAGO)");
      source.href=isSeoul(city)?"https://www.data.go.kr/data/15000314/openapi.do":"https://www.tago.go.kr/";
    }
    function setCity(code,{keepKeyword=false}={}){
      const found=cityList.find(item=>item.code===code);
      if(!found || code===city){citySelect.value=city;return false;}
      resetSearch();city=code;cityName=found.name;citySelect.value=city;
      try{localStorage.setItem("mapBusCity",JSON.stringify(city?{code:city,name:cityName}:null));}catch(_){}
      catalogData=city?emptyCatalog:bundledCatalog;catalogLatest=false;catalogNote="";
      if(!keepKeyword)input.value=city?"":"201";
      applyPlaceholder();preview.textContent=t("노선을 검색해 주세요.");
      renderCatalog();if(canRefresh)loadCatalogFile();
      return true;
    }
    citySelect.addEventListener("change",()=>setCity(citySelect.value));
    async function loadCities(){
      try{
        const list=await MNJejuBusApi.request("cities","",{signal:capability.signal});
        if(destroyed || !list.length)return;
        if(!list.some(item=>item.code===""))list.unshift({code:"",name:t("제주"),raw:""});
        if(!list.some(item=>isSeoul(item.code)))list.splice(1,0,seoulEntry());
        cityList=list;
        if(!cityList.some(item=>item.code===city)){cityList.push({code:city,name:cityName,raw:city});}
        renderCities();
      }catch(_){}
    }
    // ── 정류장·도착 정보 ──
    function clearStops(){
      stopGeneration++;if(stopAbort)stopAbort.abort();stopAbort=null;
      stopsLayer.clearLayers();map.removeLayer(stopsLayer);
      stopList.replaceChildren();stopList.hidden=true;arrivalBox.hidden=true;arrivalStation=null;
    }
    // 대략의 서울 범위. TAGO 근처 조회가 비었을 때 '서울을 고르라'고 알려 주는 데만 쓴다.
    const inSeoul=at=>at.lat>=37.41 && at.lat<=37.72 && at.lng>=126.76 && at.lng<=127.19;
    async function findNearby(){
      const center=map.getCenter();
      stopGeneration++;if(stopAbort)stopAbort.abort();stopAbort=new AbortController();
      const seq=stopGeneration,controller=stopAbort;
      stopsLayer.clearLayers();arrivalBox.hidden=true;arrivalStation=null;
      stopList.hidden=false;stopList.replaceChildren(el("p","map-jeju-bus-stop-note","근처 정류장을 찾는 중…"));
      try{
        const jejuCodes=cityList.filter(item=>item.code==="" && item.raw).map(item=>item.raw);
        // 서울을 골랐으면 서울 API 로 묻는다(TAGO 좌표 조회에는 서울 정류장이 없다).
        const found=await MNJejuBusApi.request("nearby",[center.lat,center.lng],{signal:controller.signal,jejuCodes,city:isSeoul(city)?city:""});
        if(destroyed || seq!==stopGeneration || controller.signal.aborted)return;
        const here=[center.lat,center.lng];
        // 도시 경계 근처에선 같은 정류장이 이웃 도시 코드로도 온다(2026-09-18 실측: 대전역이 대전·계룡·세종·청주로 겹침).
        // 지금 도시가 아닌 정류장엔 도시 이름을 붙이고, 거리가 같으면 지금 도시를 앞세운다.
        const cityLabel=stop=>stop.city===city?"":((cityList.find(item=>item.code===stop.city) || {}).name || stop.city || t("제주"));
        const list=found.map(stop=>({...stop,distance:MNJejuBusLive.metres(here,stop.at),cityLabel:cityLabel(stop)}))
          .sort((a,b)=>Math.round(a.distance)-Math.round(b.distance) || (a.cityLabel?1:0)-(b.cityLabel?1:0));
        if(!list.length){stopList.replaceChildren(el("p","map-jeju-bus-stop-note",!isSeoul(city) && inSeoul(center)
          ?"서울 정류장은 도시에서 '서울특별시'를 고른 뒤 찾아 주세요.":"지도 가운데 근처에 정류장이 없어요. 지도를 옮겨 다시 찾아 주세요."));return;}
        stopsLayer.addTo(map);
        const buttons=list.slice(0,12).map(stop=>{
          const item=button("","map-jeju-bus-stop");
          item.textContent=stop.name+(stop.no?" ("+stop.no+")":"")+(stop.cityLabel?" · "+stop.cityLabel:"")+" · "+Math.round(stop.distance)+"m";
          item.addEventListener("click",()=>showArrivals(stop));
          return item;
        });
        stopList.replaceChildren(...buttons);
        for(const stop of list){
          const tip=el("span","");tip.textContent=stop.name+(stop.cityLabel?" · "+stop.cityLabel:"");
          const marker=L.circleMarker(stop.at,{pane:"mapJejuBusPane",radius:6,color:"#ffffff",weight:2,fillColor:"#e67e22",fillOpacity:0.95,bubblingMouseEvents:false})
            .bindTooltip(tip);
          marker.on("click",()=>showArrivals(stop));
          stopsLayer.addLayer(marker);
        }
      }catch(error){
        if(controller.signal.aborted || seq!==stopGeneration)return;
        stopList.replaceChildren(el("p","map-jeju-bus-stop-note",failureText(error,"근처 정류장을 받지 못했어요. 잠시 후 다시 찾아 주세요.","nearby",isSeoul(city)?city:"")));
      }
    }
    async function showArrivals(stop,force=false){
      if(!stop || !stop.id)return;
      if(panel.hidden){panel.hidden=false;toggle.setAttribute("aria-expanded","true");}
      stopGeneration++;if(stopAbort)stopAbort.abort();stopAbort=new AbortController();
      const seq=stopGeneration,controller=stopAbort;arrivalStation=stop;
      arrivalBox.hidden=false;arrivalTitle.textContent=stop.name+(stop.no?" ("+stop.no+")":"");
      if(!force)arrivalList.replaceChildren();
      arrivalStatus.textContent=t("도착 정보를 받는 중…");arrivalRefresh.disabled=true;
      try{
        const result=await MNJejuBusApi.request("arrivals",stop.id,{signal:controller.signal,city:stop.city || "",refresh:force});
        if(destroyed || seq!==stopGeneration || controller.signal.aborted)return;
        const rows=result.items.map(item=>{
          const row=el("li","");
          const pick=button("","map-jeju-bus-arrival");
          const badge=el("span","map-jeju-bus-arrival-number");badge.textContent=item.number;badge.style.backgroundColor=colorFor(item.type);
          const when=el("span","map-jeju-bus-arrival-when");when.textContent=MNJejuBusApi.arrivalText(item,t);
          const kind=el("span","map-jeju-bus-arrival-kind");kind.textContent=[item.type,item.vehicleType].filter(Boolean).join(" · ");
          pick.append(badge,when,kind);pick.title=t("이 노선을 검색합니다.");
          pick.addEventListener("click",()=>pickArrivalRoute(stop,item));
          row.appendChild(pick);return row;
        });
        arrivalList.replaceChildren(...rows);
        arrivalStatus.textContent=(rows.length?"":t("지금 이 정류장으로 오는 버스 정보가 없어요.")+" · ")+t("수신")+" "+clock(result.fetchedAt);
      }catch(error){
        if(controller.signal.aborted || seq!==stopGeneration)return;
        arrivalStatus.textContent=failureText(error,"도착 정보를 받지 못했어요. 잠시 후 새로고침해 주세요.","arrivals",stop.city || "");
      }finally{if(seq===stopGeneration)arrivalRefresh.disabled=false;}
    }
    // 도착 목록에서 노선을 누르면 그 정류장의 도시로 옮겨 번호를 검색한다.
    function pickArrivalRoute(stop,item){
      if(!MNJejuBusApi.validNumber(item.number))return;
      const target=stop.city || "";
      if(target!==city && !cityList.some(entry=>entry.code===target))return;
      if(target!==city)setCity(target,{keepKeyword:true});
      input.value=item.number;
      searchRoutes({preventDefault(){}});
    }
    function cancelTrip(){
      tripGeneration++;if(tripAbort)tripAbort.abort();tripAbort=null;tripSearch.disabled=stations.length<2;
    }
    function clearTripHighlight(){tripLayer.clearLayers();map.removeLayer(tripLayer);tripPoints=[];tripFit.disabled=true;}
    function resetTrip(){
      cancelTrip();clearTripHighlight();tripSource.hidden=true;
      for(const field of tripInputs){field.value="";field.disabled=true;}
      for(const list of tripLists)list.replaceChildren();
      tripSearch.disabled=true;tripResult.textContent=t("노선을 검색한 뒤 출발·도착 정류장을 골라 주세요.");
    }
    function populateTrip(){
      for(const list of tripLists)list.replaceChildren(...stations.map((stop,index)=>{
        const option=el("option","");option.value=MNJejuBusApi.tripStopLabel(stop,index);return option;
      }));
      for(const field of tripInputs)field.disabled=stations.length<2;
      tripSearch.disabled=stations.length<2;
      tripResult.textContent=t(stations.length<2?"구간을 선택할 정류장 정보가 부족해요.":"출발·도착 정류장을 골라 주세요. 같은 이름은 순번·정류장 번호로 구별합니다.");
    }
    const tripMinutes=seconds=>Math.max(1,Math.round(seconds/60))+t("분");
    function highlightTrip(section){
      clearTripHighlight();tripPoints=section.map(stop=>stop.at);
      tripLayer.addTo(map);
      tripLayer.addLayer(L.polyline(tripPoints,{pane:"mapJejuBusRoutePane",color:"#df6c16",weight:5,opacity:0.85,dashArray:"6 5",interactive:false}));
      for(const [stop,title] of [[section[0],"출발"],[section[section.length-1],"도착"]]){
        tripLayer.addLayer(L.circleMarker(stop.at,{pane:"mapJejuBusRoutePane",radius:7,color:"#df6c16",weight:3,fillOpacity:1}).bindTooltip(el("span","",t(title)+" · "+stop.name)));
      }
      tripFit.disabled=false;
      map.fitBounds(L.latLngBounds(tripPoints),{padding:[35,35],maxZoom:15});
    }
    async function queryTrip(event){
      event.preventDefault();cancelTrip();clearTripHighlight();tripSource.hidden=true;
      const choice=choices.find(r=>r.id===select.value),from=MNJejuBusApi.tripStopIndex(stations,tripInputs[0].value),to=MNJejuBusApi.tripStopIndex(stations,tripInputs[1].value);
      const picked=MNJejuBusApi.tripSection(stations,from,to);
      const errors={stops:"목록에서 출발·도착 정류장을 골라 주세요. 같은 이름이 여러 개면 순번까지 선택해 주세요.",same:"출발·도착 정류장이 같아요.",direction:"도착 정류장이 출발보다 앞에 있어요. 반대 방향의 세부 노선을 고르거나 정류장 순번을 확인해 주세요.",gap:"중간 정류장 정보가 빠져 있어 구간 예상시간을 제공할 수 없어요."};
      if(!choice || picked.error){tripResult.textContent=t(errors[picked.error] || errors.stops);return;}
      highlightTrip(picked.section);
      const header=choice.number+" · "+stations[from].name+" → "+stations[to].name+" · "+picked.count+t("구간");
      const controller=new AbortController(),seq=tripGeneration;tripAbort=controller;tripSearch.disabled=true;
      tripResult.textContent=header+"\n"+t("예상시간과 출발 정류장 도착정보를 확인하는 중…");
      let estimate={error:"unsupported"},tripData=null,waiting=null,waitStamp=0,waitError="";
      // 두 조회가 독립적이며, 하나가 실패해도 다른 결과는 보여 준다.
      const stop=stations[from],uniqueStop=stop.id && stations.filter(s=>s.id===stop.id).length===1;
      await Promise.all([
        (async()=>{if(isSeoul(choice.city))try{tripData=await MNJejuBusApi.loadTripData();estimate=MNJejuBusApi.tripEstimate(tripData,choice,picked.section,Date.now());}catch(_){estimate={error:"data"};}})(),
        (async()=>{
          if(!uniqueStop){waitError=t("이 정류장을 노선이 여러 번 지나거나 정류장 번호가 없어 대기시간을 구별할 수 없어요.");return;}
          try{
            const result=await MNJejuBusApi.request("arrivals",stop.id,{city:choice.city,signal:controller.signal,refresh:true});
            if(Date.now()-result.fetchedAt>120000){waitError=t("도착정보가 오래되어 대기시간을 제공할 수 없어요.");return;}
            const candidates=result.items.filter(item=>item.routeId===choice.id && Number.isFinite(item.seconds) && item.seconds>=0);
            waiting=candidates.length?Math.min(...candidates.map(item=>item.seconds)):null;waitStamp=result.fetchedAt;
          }catch(error){waitError=failureText(error,"출발 정류장의 도착정보를 받지 못했어요.","arrivals",choice.city);}
        })()
      ]);
      if(destroyed || seq!==tripGeneration || controller.signal.aborted)return;
      if(waiting!=null && !estimate.error)estimate=MNJejuBusApi.tripEstimate(tripData,choice,picked.section,Date.now()+waiting*1000);
      const lines=[header];
      if(!estimate.error){
        lines.push(t("탑승 후 예상 소요시간: 약 ")+tripMinutes(estimate.seconds));
        lines.push(t("통계 기준: ")+estimate.from+" ~ "+estimate.to+" · "+t("시간대별 평균 · 요일 구분 없음"));
        lines.push(t("실시간 정체·대기·도보·환승 시간은 포함하지 않습니다."));tripSource.hidden=false;
      }else lines.push(t(estimate.error==="unsupported"?"이 지역은 구간 운행시간 자료가 연결되어 있지 않아 예상시간을 제공할 수 없어요.":estimate.error==="old"?"운행시간 통계가 오래되어 예상시간을 제공할 수 없어요.":"선택 구간 또는 시간대의 운행시간 자료가 없어 예상시간을 제공할 수 없어요."));
      if(waiting!=null){
        lines.push(t("출발 정류장 버스 도착: ")+(waiting<60?t("곧 도착"):t("약 ")+tripMinutes(waiting)+t(" 후")));
        if(!estimate.error)lines.push(t("대기 포함 예상시간: 약 ")+tripMinutes(waiting+estimate.seconds));
      }else lines.push(waitError || t("현재 선택 노선의 대기시간 정보가 없어요."));
      if(waitStamp)lines.push(t("도착정보 수신: ")+clock(waitStamp));
      tripResult.textContent=lines.join("\n");tripAbort=null;tripSearch.disabled=false;
    }
    tripBox.addEventListener("submit",queryTrip);
    for(const field of tripInputs)field.addEventListener("input",()=>{cancelTrip();clearTripHighlight();tripSource.hidden=true;tripResult.textContent=t("정류장을 변경했어요. 예상시간을 다시 조회해 주세요.");});
    tripFit.addEventListener("click",()=>{if(tripPoints.length)map.fitBounds(L.latLngBounds(tripPoints),{padding:[35,35],maxZoom:15});});
    nearbyButton.addEventListener("click",findNearby);
    arrivalRefresh.addEventListener("click",()=>showArrivals(arrivalStation,true));
    renderCities();applyPlaceholder();renderCatalog();
    toggle.addEventListener("click",()=>{
      if(on){stopLive();panel.hidden=true;}
      else panel.hidden=!panel.hidden;
      if(panel.hidden){clearStops();cancelTrip();clearTripHighlight();}
      toggle.setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden)input.focus();
    });
    close.addEventListener("click",()=>{panel.hidden=true;clearStops();cancelTrip();clearTripHighlight();toggle.setAttribute("aria-expanded","false");toggle.focus();});
    panel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();close.click();}});
    form.addEventListener("submit",searchRoutes);select.addEventListener("change",()=>loadSelection());refresh.addEventListener("click",()=>loadSelection(true));
    start.addEventListener("click",()=>{
      const choice=choices.find(r=>r.id===select.value);if(!choice || on)return;
      try{localStorage.setItem("mapJejuBusRoute",JSON.stringify({provider:MNJejuBusApi.provider,id:choice.id}));}catch(_){}
      generation++;state=MNJejuBusLive.create();active=choice;on=true;failures=0;delayed=false;nextPoll=0;needsFit=true;
      vehicles.addTo(map);routesLayer.addTo(map);
      if(shape)routesLayer.addLayer(L.polyline(shape.segments,{pane:"mapJejuBusRoutePane",color:routeColor(),weight:3,opacity:0.5,interactive:false}));
      // 도로 경로가 없으니 정류장 순서만 점선으로 잇는다. 실제 도로가 아니라는 뜻으로 옅게 그린다.
      else if(stations.length>1)routesLayer.addLayer(L.polyline(stations.map(s=>s.at),{pane:"mapJejuBusRoutePane",color:routeColor(),weight:2,opacity:0.35,dashArray:"4 6",interactive:false}));
      // 정류장 점을 누르면 그 정류장 도착 정보를 연다.
      for(const station of stations){
        const tip=el("span","",station.name);
        const dot=L.circleMarker(station.at,{pane:"mapJejuBusRoutePane",radius:4,color:routeColor(),weight:1,fillOpacity:0.7,bubblingMouseEvents:false}).bindTooltip(tip);
        dot.on("click",()=>showArrivals({...station,city:choice.city}));
        routesLayer.addLayer(dot);
      }
      fit.disabled=false;toggle.title=t("버스 표시 끄기");toggle.setAttribute("aria-pressed","true");toggle.classList.add("is-on");fitRoute();poll();
    });
    fit.addEventListener("click",fitRoute);
    function tick(){
      if(destroyed)return;const shown=visible();
      if(!shown){if(wasVisible){cancelPoll();stopFrame();}wasVisible=false;return;}
      if(!wasVisible){nextPoll=0;for(const vehicle of state.vehicles.values())vehicle.animation=null;}
      wasVisible=true;if(frozen)return;
      if(catalogWatching && !catalogPolling && Date.now()>=catalogNextPoll)pollCatalog();
      if(on){if(!frame)paint();if(Date.now()>=nextPoll)poll();}
    }
    const timer=setInterval(tick,1000);document.addEventListener("visibilitychange",tick);map.on("zoomend",paint);
    fetch("/can-proxy-jeju-bus",{cache:"no-store",signal:capability.signal}).then(r=>r.ok?r.text():"").then(value=>{
      if(destroyed || value.trim()!=="yes")return;
      toggle.disabled=false;toggle.title=t("버스 노선을 선택해 실시간 위치를 봅니다.");
      canRefresh=true;catalogRefresh.disabled=false;nearbyButton.disabled=false;
      loadCatalogFile();
      loadCities();
      // 다른 탭에서 시작한 최신화가 돌고 있으면 이어서 지켜본다. 끝난 결과를 다시 알리지는 않는다.
      MNJejuBusApi.catalogJob("status",{signal:capability.signal})
        .then(job=>{if(!destroyed && job.state==="running")showCatalogJob(job);}).catch(()=>{});
    }).catch(()=>{});
    const controller={
      freeze(){frozen++;stopFrame();return ()=>{frozen=Math.max(0,frozen-1);nextPoll=0;tick();};},
      captureNote(){return on && state.fetchedAt?t("버스 위치")+" · "+t("마지막 수신")+" "+new Date(state.fetchedAt).toLocaleString()+" · "+(active && isSeoul(active.city)?t("서울특별시"):"TAGO"):"";},
      destroy(){destroyed=true;cancelTrip();clearTripHighlight();stopLive();clearStops();clearInterval(timer);capability.abort();if(searchAbort)searchAbort.abort();if(detailAbort)detailAbort.abort();
        document.removeEventListener("visibilitychange",tick);map.off("zoomend",paint);panel.remove();toggle.remove();pane.remove();routePane.remove();}
    };
    if(!Array.isArray(doc.cleanupFns))doc.cleanupFns=[];doc.cleanupFns.push(()=>controller.destroy());
    return controller;
  }
  return {mount};
})();
