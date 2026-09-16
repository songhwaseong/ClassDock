"use strict";
/* 지도에만 속하는 실시간 층. .map 모델과 사용자 마커를 수정하지 않는다. */
const MNJejuBusMap = (() => {
  function mount({map,stage,toolRow,doc,t = value=>value}){
    const el=(tag,cls,label)=>{const node=document.createElement(tag);node.className=cls;if(label)node.textContent=t(label);return node;};
    const button=(label,cls="")=>{const node=el("button","map-btn "+cls,label);node.type="button";return node;};
    const toggle=button("🚌 제주 버스","map-toolvis-jeju-bus");
    toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-pressed","false");
    toggle.disabled=true;toggle.title=t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");toolRow.appendChild(toggle);
    const panel=el("section","map-jeju-bus-panel");panel.hidden=true;panel.setAttribute("aria-label",t("제주 버스"));
    const heading=el("div","map-jeju-bus-heading"), close=button("닫기");
    heading.append(el("strong","","제주 버스"),close);
    const form=el("form","map-jeju-bus-search"), input=el("input","map-input");
    input.placeholder=t("노선번호 (예: 201)");input.setAttribute("aria-label",t("버스 노선번호"));input.maxLength=12;
    try {input.value=localStorage.getItem("mapJejuBusKeyword") || "201";}catch(_){input.value="201";}
    const search=button("검색");search.type="submit";
    const catalogSelect=el("select","map-select map-jeju-bus-catalog");catalogSelect.setAttribute("aria-label",t("노선 목록에서 고르기"));
    form.append(catalogSelect,input,search);
    const select=el("select","map-select");select.setAttribute("aria-label",t("버스 세부 노선"));select.disabled=true;
    const preview=el("p","map-jeju-bus-preview","노선을 검색해 주세요.");
    const actions=el("div","map-jeju-bus-actions"), start=button("지도에 표시"),fit=button("노선 전체 보기"),refresh=button("노선 새로고침");
    start.disabled=true;fit.disabled=true;refresh.disabled=true;actions.append(start,fit,refresh);
    const status=el("p","map-jeju-bus-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const note=el("p","map-jeju-bus-note","위치는 지연될 수 있으며, 갱신 사이에는 마지막 위치를 표시합니다.");
    const source=el("a","","출처: 국가대중교통정보센터(TAGO)");source.href="https://www.tago.go.kr/";source.target="_blank";source.rel="noopener noreferrer";
    const catalogRow=el("div","map-jeju-bus-catalog-info"),catalogText=el("span","");
    const catalogRefresh=button("목록 최신화","map-jeju-bus-catalog-refresh"),catalogCancel=button("최신화 취소");
    catalogRefresh.disabled=true;catalogCancel.hidden=true;catalogRow.append(catalogText,catalogRefresh,catalogCancel);
    // 목록 최신화 줄은 노선 목록 바로 밑에 둔다. 패널 맨 아래로 내리면 접힌 부분에 숨어 보이지 않는다.
    panel.append(heading,form,catalogRow,select,preview,actions,status,note,source);stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
    const pane=map.createPane("mapJejuBusPane");pane.style.zIndex="640";
    const routePane=map.createPane("mapJejuBusRoutePane");routePane.style.zIndex="370";
    const vehicles=L.layerGroup(),routesLayer=L.layerGroup(),markers=new Map();
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
    const capability=new AbortController();
    let destroyed=false,active=null,state=MNJejuBusLive.create(),shape=null,stations=[],choices=[],on=false;
    let generation=0,searchGeneration=0,selectionGeneration=0,pollAbort=null,searchAbort=null,detailAbort=null;
    let polling=false,nextPoll=0,failures=0,delayed=false,frame=0,frozen=0,wasVisible=false,needsFit=false;
    const bundledCatalog=(()=>{
      try{return MNJejuBusApi.catalog(typeof MNJejuBusRouteCatalog!=="undefined"?MNJejuBusRouteCatalog:null);}
      catch(_){return {updatedAt:"",routes:[]};}
    })();
    let catalogData=bundledCatalog,catalogLatest=false,catalogNote="",canRefresh=false;
    let catalogWatching=false,catalogPolling=false,catalogNextPoll=0;
    const visible=()=>!document.hidden && !!stage.offsetParent;
    const routeColor=()=>active && /급행|리무진/.test(active.type)?"#c0392b":active && /간선/.test(active.type)?"#176bc0":active && /관광/.test(active.type)?"#986b00":"#087f8c";
    const clock=stamp=>new Date(stamp).toLocaleTimeString([], {hour12:false});
    const setStatus=text=>{if(status.textContent!==text)status.textContent=text;};
    // 키·한도 문제는 기다려도 풀리지 않으므로 '다시 시도하는 중'이라고 하지 않고 할 일을 알려 준다.
    const failureText=(error,fallback)=>t(error && error.message==="bus-key-required"?"설정의 '버스 실시간'에 공공데이터포털 인증키를 넣어 주세요."
      :error && error.message==="bus-key-invalid"?"인증키가 이 조회에 쓰일 수 없어요. 공공데이터포털에서 TAGO 버스노선정보·버스위치정보 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요."
      :error && error.message==="bus-quota"?"오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.":fallback);
    const stopFrame=()=>{cancelAnimationFrame(frame);frame=0;};
    function clear(){markers.clear();vehicles.clearLayers();routesLayer.clearLayers();map.removeLayer(vehicles);map.removeLayer(routesLayer);}
    function cancelPoll(){if(pollAbort)pollAbort.abort();pollAbort=null;polling=false;}
    function stopLive(){
      generation++;on=false;cancelPoll();stopFrame();clear();state=MNJejuBusLive.create();active=null;needsFit=false;
      fit.disabled=true;toggle.title=t("제주 버스 노선을 선택해 실시간 위치를 봅니다.");toggle.setAttribute("aria-pressed","false");toggle.classList.remove("is-on");setStatus(t("제주 버스 표시를 껐어요."));
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
          const icon=el("span","map-jeju-bus-icon");icon.style.backgroundColor=routeColor();icon.append(el("span","","🚌"),el("span","map-jeju-bus-number",active.number));
          marker=L.marker(view.at,{pane:"mapJejuBusPane",keyboard:true,title:active.number+" · "+vehicle.label,
            icon:L.divIcon({html:icon,className:"map-jeju-bus-marker",iconSize:[44,26],iconAnchor:[22,13]})});
          const tip=el("div","");marker.bindTooltip(tip,{direction:"top",offset:[0,-14]});marker._busTip=tip;
          markers.set(id,marker);vehicles.addLayer(marker);
        }
        marker.setLatLng(view.at);marker.setOpacity(view.dim?0.45:1);
        const markerEl=marker.getElement();
        if(markerEl){markerEl.classList.toggle("bus-relocated",!reduced.matches && vehicle.relocatedAt>now-1000);
          markerEl.classList.toggle("bus-wide-label",map.getZoom()>=12);}
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
      const gen=generation,id=active.id,controller=new AbortController();pollAbort=controller;polling=true;
      try{
        const response=await MNJejuBusApi.request("position",id,{signal:controller.signal});
        if(destroyed || gen!==generation || !on || controller.signal.aborted || frozen)return;
        MNJejuBusLive.ingest(state,response,Date.now(),shape,!reduced.matches);
        if(response.stale)nextPoll=Math.max(nextPoll,Date.now()+(response.retryAfterMs || 0));
        delayed=response.stale;failures=response.stale?Math.min(failures+1,2):0;
        if(needsFit)fitRoute();
        paint();
      }catch(error){
        if(controller.signal.aborted || gen!==generation)return;
        delayed=true;failures=Math.min(failures+1,2);
        nextPoll=Math.max(nextPoll,Date.now()+(error.retryAfterMs || 0));
        setStatus(failureText(error,"버스 정보를 받지 못했어요. 다시 시도하는 중이에요."));
      }finally{
        if(pollAbort===controller){pollAbort=null;polling=false;nextPoll=Math.max(nextPoll,Date.now()+30000*2**failures);}
      }
    }
    async function loadSelection(force=false){
      stopLive();const seq=++selectionGeneration;
      if(detailAbort)detailAbort.abort();detailAbort=new AbortController();
      const controller=detailAbort,choice=choices.find(r=>r.id===select.value);
      stations=[];shape=null;start.disabled=true;refresh.disabled=!choice;
      if(!choice)return;
      preview.textContent=t("정류장 목록을 받는 중…");
      // TAGO 에는 도로를 따라 그린 노선 경로가 없다. 그래서 shape 는 비워 두고 이동은 옮겨 놓기로만 보인다
      // (정류장 사이를 곧게 잇는 선으로 보간하면 건물·바다를 가로지른다).
      let failure=null;
      try{stations=await MNJejuBusApi.request("route",choice.id,{signal:controller.signal,refresh:force});}
      catch(error){failure=error;stations=[];}
      if(destroyed || controller.signal.aborted || seq!==selectionGeneration)return;
      preview.textContent=choice.from+" → "+choice.to+"\n"+(stations.length?stations.map(s=>s.name).join(" → ")
        :failure?failureText(failure,"정류장 정보를 받지 못했어요. 노선을 새로고침해 주세요."):t("정류장 정보가 없어요."));
      start.disabled=false;
    }
    async function searchRoutes(event){
      event.preventDefault();const value=input.value.trim();
      if(!/^[0-9\-]{1,12}$/.test(value)){setStatus(t("노선번호를 입력해 주세요. (예: 201)"));return;}
      syncCatalogSelect();
      stopLive();selectionGeneration++;if(detailAbort)detailAbort.abort();
      const seq=++searchGeneration;if(searchAbort)searchAbort.abort();searchAbort=new AbortController();
      const controller=searchAbort;search.disabled=true;select.disabled=true;start.disabled=true;refresh.disabled=true;
      select.replaceChildren();choices=[];preview.textContent=t("노선을 검색하는 중…");
      try{
        const result=await MNJejuBusApi.request("routes",value,{signal:controller.signal});
        if(destroyed || seq!==searchGeneration || controller.signal.aborted)return;
        choices=result;select.replaceChildren();
        result.forEach((r,i)=>{const option=el("option","",r.number+" · "+r.from+" → "+r.to+" · "+t("세부 경로")+" "+(i+1));option.value=r.id;select.appendChild(option);});
        try { const saved=JSON.parse(localStorage.getItem("mapJejuBusRoute") || "null");
          if(saved && saved.provider===MNJejuBusApi.provider && result.some(r=>r.id===saved.id))select.value=saved.id;
        }catch(_){}
        select.disabled=!result.length;
        try{localStorage.setItem("mapJejuBusKeyword",value);}catch(_){}
        if(result.length)await loadSelection();else preview.textContent=t("검색된 노선이 없어요.");
      }catch(error){if(!controller.signal.aborted){const text=failureText(error,"노선을 받지 못했어요. 잠시 후 다시 검색해 주세요.");setStatus(text);preview.textContent=text;}}
      finally{if(seq===searchGeneration)search.disabled=false;}
    }
    // 노선 목록. 앱에 넣어 둔 목록을 기본으로 쓰고, 사용자가 [목록 최신화]를 누르면
    // 런처가 TAGO 에서 받아 만든 목록으로 갈아 끼운다.
    function renderCatalog(){
      const placeholder=el("option","","노선 목록에서 고르기");placeholder.value="";
      const nodes=[placeholder];
      for(const group of MNJejuBusApi.catalogGroups(catalogData.routes)){
        const box=document.createElement("optgroup");
        box.label=group.hundred>=100?group.hundred+t("번대"):t("기타 번호");
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
      catalogText.textContent=[t(catalogLatest?"최신화한 노선 목록":"앱에 들어 있는 노선 목록"),
        catalogData.routes.length+t("개 번호"),day&&!isNaN(day)?day.toLocaleDateString():"",catalogNote].filter(Boolean).join(" · ");
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
      try{
        const saved=await MNJejuBusApi.loadCatalog({signal:capability.signal});
        if(destroyed || !saved || !saved.routes.length)return;
        catalogData=saved;catalogLatest=true;renderCatalog();
      }catch(_){}
    }
    async function pollCatalog(){
      catalogPolling=true;
      try{
        const job=await MNJejuBusApi.catalogJob("status",{signal:capability.signal});
        if(destroyed)return;
        if(job.state!=="running"){catalogWatching=false;catalogNote="";}
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
      const ok=await confirmDialog(t("TAGO에서 제주 노선 목록을 받아 새로 만듭니다.")
        +"\n\n"+t("오늘 조회 한도에서 요청을 약")+" "+total+t("번 씁니다. 도중에 멈출 수 있어요."),t("목록 최신화"),t("취소"));
      if(!ok || destroyed)return;
      catalogRefresh.disabled=true;catalogNote="";
      try{
        const job=await MNJejuBusApi.catalogJob("refresh",{signal:capability.signal,minimum:Math.max(1,Math.ceil(bundledCatalog.routes.length/2))});
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
    renderCatalog();
    toggle.addEventListener("click",()=>{
      if(on){stopLive();panel.hidden=true;}
      else panel.hidden=!panel.hidden;
      toggle.setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden)input.focus();
    });
    close.addEventListener("click",()=>{panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.focus();});
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
      for(const station of stations){const tip=el("span","",station.name);routesLayer.addLayer(L.circleMarker(station.at,{pane:"mapJejuBusRoutePane",radius:3,color:routeColor(),weight:1,fillOpacity:0.7}).bindTooltip(tip));}
      fit.disabled=false;toggle.title=t("제주 버스 표시 끄기");toggle.setAttribute("aria-pressed","true");toggle.classList.add("is-on");fitRoute();poll();
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
      toggle.disabled=false;toggle.title=t("제주 버스 노선을 선택해 실시간 위치를 봅니다.");
      canRefresh=true;catalogRefresh.disabled=false;
      loadCatalogFile();
      // 다른 탭에서 시작한 최신화가 돌고 있으면 이어서 지켜본다. 끝난 결과를 다시 알리지는 않는다.
      MNJejuBusApi.catalogJob("status",{signal:capability.signal})
        .then(job=>{if(!destroyed && job.state==="running")showCatalogJob(job);}).catch(()=>{});
    }).catch(()=>{});
    const controller={
      freeze(){frozen++;stopFrame();return ()=>{frozen=Math.max(0,frozen-1);nextPoll=0;tick();};},
      captureNote(){return on && state.fetchedAt?t("제주 버스 위치")+" · "+t("마지막 수신")+" "+new Date(state.fetchedAt).toLocaleString()+" · TAGO":"";},
      destroy(){destroyed=true;stopLive();clearInterval(timer);capability.abort();if(searchAbort)searchAbort.abort();if(detailAbort)detailAbort.abort();
        document.removeEventListener("visibilitychange",tick);map.off("zoomend",paint);panel.remove();toggle.remove();pane.remove();routePane.remove();}
    };
    if(!Array.isArray(doc.cleanupFns))doc.cleanupFns=[];doc.cleanupFns.push(()=>controller.destroy());
    return controller;
  }
  return {mount};
})();
