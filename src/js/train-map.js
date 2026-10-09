"use strict";
/* KTX 역 지도와 TAGO 역 검색·구간 시간표. 역 위치는 출처가 명시된 고정 자료를 사용한다. */
const MNTrainMap = (() => {
  function mount({map,stage,toolRow,doc,t=value=>value,movePanel=null}){
    const api=MNTrainApi;
    const stations=MNTrainStationData.stations;
    const pane=map.createPane("mapTrainStationPane");pane.style.zIndex=430;
    const layer=L.layerGroup(),markers=new Map();
    const attribution='KTX · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · 한국철도공사';
    const el=(tag,cls,label)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(label)node.textContent=t(label);return node;};
    const button=(label,cls="")=>{const node=el("button","map-btn "+cls,label);node.type="button";return node;};
    const toggle=button("KTX·열차","map-toolvis-train");
    if (typeof mapSetToolIcon==="function") mapSetToolIcon(toggle,"train");
    toggle.disabled=false;toggle.title=t("KTX 역 위치와 구간 시간표를 봅니다.");
    toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-pressed","false");toolRow.appendChild(toggle);
    const panel=el("section","map-train-panel");panel.hidden=true;panel.setAttribute("aria-label",t("KTX·열차 시간표"));
    const heading=el("div","map-train-heading"),close=button("닫기");heading.append(el("strong","","KTX·열차 시간표"),close);
    const form=el("form","map-train-form");
    const stationList=el("datalist","");stationList.id="mapTrainStations-"+Math.random().toString(36).slice(2,9);
    function stationInput(label,placeholder){
      const wrap=el("label","map-train-field"),input=el("input","map-input");
      input.setAttribute("aria-label",t(label));input.placeholder=t(placeholder);input.autocomplete="off";input.maxLength=100;
      input.setAttribute("list",stationList.id);wrap.append(el("span","",label),input);return {wrap,input};
    }
    const from=stationInput("출발역","출발역 검색 (예: 서울)"),to=stationInput("도착역","도착역 검색 (예: 부산)");
    const swap=button("출발·도착 바꾸기","map-train-swap");
    const route=el("div","map-train-route");route.append(from.wrap,to.wrap,swap);
    const dateWrap=el("label","map-train-field"),date=el("input","map-input map-train-date");date.type="date";date.required=true;
    date.setAttribute("aria-label",t("출발 날짜"));dateWrap.append(el("span","","출발 날짜"),date);
    const gradeWrap=el("label","map-train-field"),grade=el("select","map-select map-train-grade");grade.setAttribute("aria-label",t("열차 종류"));
    for(const [value,label] of [["ktx","KTX 전체"],["all","모든 열차"]]){const option=el("option","",label);option.value=value;grade.appendChild(option);}
    gradeWrap.append(el("span","","열차 종류"),grade);
    const query=el("div","map-train-query"),loadButton=button("시간표 보기","map-train-load");loadButton.type="submit";
    query.append(dateWrap,gradeWrap,loadButton);form.append(route,stationList,query);
    const tools=el("div","map-train-tools"),hideLabel=el("label","map-train-hide"),hidePast=el("input","");hidePast.type="checkbox";hidePast.checked=true;
    hideLabel.append(hidePast,el("span","","지난 열차 숨기기"));const refresh=button("자료 갱신","map-train-refresh");tools.append(hideLabel,refresh);
    const catalogueStatus=el("p","map-train-catalogue");
    const summary=el("p","map-train-summary"),list=el("ul","map-train-list ui-keep-symbols");list.hidden=true;
    const status=el("p","map-train-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const note=el("p","map-train-note","운행 시간표 기준입니다. 실시간 열차 위치·지연·잔여 좌석은 제공하지 않습니다. 운임과 운행 여부는 예매할 때 확인해 주세요.");
    const source=el("a","","출처: 국가대중교통정보센터(TAGO)");source.href="https://www.data.go.kr/data/15098552/openapi.do";source.target="_blank";source.rel="noopener noreferrer";
    panel.append(heading,form,tools,catalogueStatus,summary,list,status,note,source);stage.appendChild(panel);
    const mapTools=el("div","map-train-map-tools"),stationLabel=el("label","map-train-hide"),showStations=el("input","");showStations.type="checkbox";showStations.checked=true;
    stationLabel.append(showStations,el("span","","KTX 역 표시"));
    const fitButton=button("전국 역 보기"),routeButton=button("선택한 역 보기");mapTools.append(stationLabel,fitButton,routeButton);
    const mapNote=el("p","map-train-note","역 표시를 누르면 주소·위치·노선과 시간표 선택 버튼을 볼 수 있습니다. 열차마다 정차역이 다르므로 시간표를 확인하세요.");
    panel.insertBefore(mapTools,form);panel.appendChild(mapNote);
    L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
    if(typeof movePanel==="function")movePanel(panel,heading);
    const capability=new AbortController();
    let destroyed=false,catalogue=null,cataloguePromise=null,abort=null,generation=0,data=null,layerShown=false,canQuery=false;
    const english=()=>!!(window.MNI18N && window.MNI18N.lang==="en");
    const setStatus=label=>{status.textContent=label;};
    function syncDate(){date.min=api.dateAt();date.max=api.dateAt(Date.now()+30*86400000);if(!date.value || date.value<date.min || date.value>date.max)date.value=date.min;}
    syncDate();from.input.value="서울";to.input.value="부산";
    try{
      const saved=JSON.parse(localStorage.getItem("mapTrainBoard") || "null");
      if(saved){if(typeof saved.from==="string")from.input.value=saved.from.slice(0,100);if(typeof saved.to==="string")to.input.value=saved.to.slice(0,100);if(saved.hidePast===false)hidePast.checked=false;}
    }catch(_){}
    const remember=()=>{try{localStorage.setItem("mapTrainBoard",JSON.stringify({from:from.input.value,to:to.input.value,hidePast:hidePast.checked}));}catch(_){}};
    const failure=error=>t(error.message==="bus-key-required" ? "설정의 '공공데이터포털'에 인증키를 넣어 주세요."
      : error.message==="bus-key-invalid" ? "공공데이터포털에서 '국토교통부_(TAGO)_열차정보' 활용신청과 승인 상태를 확인해 주세요. 승인 직후에는 반영까지 시간이 걸릴 수 있어요."
      : error.message==="bus-quota" ? "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요."
      : error.message==="train-incomplete-stations" ? "역 목록을 모두 받지 못했어요. 잠시 후 다시 열어 주세요."
      : "열차 정보를 받지 못했어요. 잠시 후 다시 시도해 주세요.");
    const duration=minutes=>english() ? Math.floor(minutes/60)+"h "+minutes%60+"m" : (minutes>=60 ? Math.floor(minutes/60)+"시간 " : "")+minutes%60+"분";
    const stationTitle=station=>station.name.replace(/역$/,"")+(english() ? " station" : "역");
    const link=(label,url)=>{const node=el("a","",label);node.href=url;node.target="_blank";node.rel="noopener noreferrer";return node;};
    function chosen(input){
      const value=input.value.trim();if(!value)return null;
      const station=catalogue && api.resolveStation(value,catalogue.stations);
      return station ? stations.find(row=>row.id===station.id) : stations.find(row=>row.name===value.replace(/역$/,"") || (row.id && row.id===value));
    }
    function selectionKind(station){
      const origin=chosen(from.input),destination=chosen(to.input);
      return station.id && station.id===origin?.id ? "from" : station.id && station.id===destination?.id ? "to" : "station";
    }
    function selectionIcon(station,kind=selectionKind(station)){
      const icon=el("span","map-train-station-badge is-"+kind);icon.setAttribute("aria-hidden","true");
      // 아래 점이 실제 역 좌표다. 짧은 연결선 위에 기차 아이콘을 띄운다.
      icon.innerHTML='<svg viewBox="0 0 40 44" aria-hidden="true" focusable="false">'
        +'<path d="M4 38 26 14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'
        +'<path d="M4 38 26 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
        +'<circle cx="4" cy="38" r="3.5" fill="currentColor" stroke="#fff" stroke-width="1.5"/>'
        +'<circle cx="26" cy="14" r="13" fill="currentColor" stroke="#fff" stroke-width="2"/>'
        +'<g transform="translate(16 4)" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
        +'<rect x="4" y="2" width="12" height="13" rx="3"/><path d="M4 8.5h12M7 18l2-3M13 18l-2-3"/>'
        +'<circle cx="7.5" cy="11.8" r=".7" fill="#fff" stroke="none"/><circle cx="12.5" cy="11.8" r=".7" fill="#fff" stroke="none"/>'
        +'</g></svg>';
      return L.divIcon({className:"map-train-station-icon",html:icon,iconSize:[40,44],iconAnchor:[4,38],tooltipAnchor:[37,-20],popupAnchor:[22,-39]});
    }
    function stationTooltip(station,kind=selectionKind(station)){
      const label=el("span","map-train-station-label-body is-"+kind),tag=el("span","map-train-station-tag");
      tag.textContent="KTX"+(kind==="from" ? " · "+t("출발") : kind==="to" ? " · "+t("도착") : "");
      label.append(el("strong","map-train-station-name",stationTitle(station)),tag);return label;
    }
    function updateSelection(){
      for(const station of stations){const marker=markers.get(station.name);if(!marker)continue;
        const kind=selectionKind(station);marker.setIcon(selectionIcon(station,kind));
        if(marker._trainPermanent!==undefined)marker.setTooltipContent(stationTooltip(station,kind));
      }
    }
    function updateLabels(){
      const permanent=map.getZoom()>=10;
      for(const station of stations){const marker=markers.get(station.name);if(!marker || marker._trainPermanent===permanent)continue;
        marker.unbindTooltip();marker.bindTooltip(stationTooltip(station),{permanent,direction:"right",interactive:true,opacity:1,className:"map-train-station-label"});marker._trainPermanent=permanent;
      }
    }
    async function choose(station,input){
      changed();const seq=generation;
      if(!canQuery){input.value=station.name;remember();show(true);updateSelection();map.closePopup();setStatus(t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요."));return;}
      const catalog=await ensureCatalogue();if(!catalog || destroyed || seq!==generation)return;
      const found=catalog.stations.find(row=>station.id && row.id===station.id);
      if(!found){setStatus(t("이 역의 시간표는 제공된 역 목록에서 찾을 수 없어요. 코레일 역 안내에서 확인해 주세요."));show(true);return;}
      input.value=found.label;changed();remember();show(true);updateSelection();map.closePopup();input.focus();
      setStatus(t(input===from.input ? "출발역으로 선택했어요. 도착역과 날짜를 정하고 '시간표 보기'를 누르세요." : "도착역으로 선택했어요. 출발역과 날짜를 정하고 '시간표 보기'를 누르세요."));
    }
    function popupOf(station){
      const box=el("div","map-train-station-info");box.appendChild(el("strong","map-train-station-title",stationTitle(station)));
      const lines=el("p","");lines.textContent=t("노선")+": "+station.lines.join(" · ");box.appendChild(lines);
      const address=el("p","");address.textContent=t(station.nearbyAddress ? "역 주변 주소" : "주소")+": "+(station.address || t("주소 정보 없음"));box.appendChild(address);
      const coords=el("p","map-train-coords");coords.textContent=t("위도·경도")+": "+station.lat.toFixed(6)+", "+station.lng.toFixed(6);box.appendChild(coords);
      const actions=el("div","map-train-popup-actions"),depart=button("출발역으로 선택"),arrive=button("도착역으로 선택"),zoom=button("위치 확대");
      depart.disabled=arrive.disabled=!station.id;
      depart.addEventListener("click",()=>choose(station,from.input));arrive.addEventListener("click",()=>choose(station,to.input));
      zoom.addEventListener("click",()=>map.setView([station.lat,station.lng],Math.max(14,map.getZoom())));actions.append(depart,arrive,zoom);box.appendChild(actions);
      box.appendChild(link("코레일 역 안내",station.url||"https://www.korail.com/ticket/train/stationGuide/station"));
      if(!station.id)box.appendChild(el("p","map-train-note","이 역의 시간표는 제공된 역 목록에서 찾을 수 없어요. 코레일 역 안내에서 확인해 주세요."));
      const details=el("p","map-train-note");details.textContent=t("정차역 자료 기준")+": "+MNTrainStationData.timetableDate+" · "+t("위치 출처")+": "+(station.osm.startsWith("korail/") ? t("한국철도공사") : "© OpenStreetMap");box.appendChild(details);
      return box;
    }
    function setLayer(showLayer){
      if(destroyed || layerShown===showLayer)return;
      layerShown=showLayer;
      toggle.setAttribute("aria-pressed",String(showLayer));
      if(showLayer){
        if(!markers.size){for(const station of stations){
          const marker=L.marker([station.lat,station.lng],{pane:"mapTrainStationPane",icon:selectionIcon(station),title:stationTitle(station),bubblingMouseEvents:false});
          marker.bindPopup(()=>{marker.getPopup().options.autoPanPaddingBottomRight=[panel.hidden ? 20 : Math.min(500,stage.clientWidth*0.45),20];return popupOf(station);},{className:"map-train-popup",maxWidth:330});markers.set(station.name,marker);layer.addLayer(marker);
        }updateLabels();}
        layer.addTo(map);map.attributionControl?.addAttribution(attribution);
      }else{map.removeLayer(layer);map.attributionControl?.removeAttribution(attribution);}
    }
    function fit(points){if(points.length)map.fitBounds(L.latLngBounds(points.map(station=>[station.lat,station.lng])),{paddingTopLeft:[40,40],paddingBottomRight:[Math.min(500,Math.max(40,stage.clientWidth*0.45)),40],maxZoom:13});}
    fitButton.addEventListener("click",()=>{showStations.checked=true;setLayer(true);fit(stations);});
    routeButton.addEventListener("click",()=>{const points=[chosen(from.input),chosen(to.input)].filter(Boolean);if(!points.length){setStatus(t("선택한 역의 위치 자료가 없어요."));return;}showStations.checked=true;setLayer(true);fit(points);});
    showStations.addEventListener("change",()=>setLayer(showStations.checked));map.on("zoomend",updateLabels);
    function render(){
      list.replaceChildren();list.hidden=!data;
      if(!data){summary.textContent="";return;}
      const kind=grade.value;
      const matching=data.items.filter(row=>kind==="all" || (kind==="ktx" ? api.isKtx(row.grade) : row.grade===kind.slice(5)));
      const visible=matching.filter(row=>!hidePast.checked || row.dep.at>=Date.now());
      const count=english() ? visible.length+" trains" : visible.length+"편";
      summary.textContent=data.from.name+" → "+data.to.name+" · "+data.date.slice(0,4)+"/"+data.date.slice(4,6)+"/"+data.date.slice(6,8)+" · "+count;
      for(const row of visible){
        const item=el("li","map-train-item"),top=el("div","map-train-item-top"),time=el("strong","map-train-time");
        time.textContent=row.dep.time+" → "+row.arr.time+(row.arr.day!==row.dep.day ? " ("+row.arr.day.slice(4,6)+"/"+row.arr.day.slice(6,8)+")" : "");
        const fare=el("span","map-train-fare");fare.textContent=row.fare==null ? t("운임 정보 없음") : (english() ? "₩"+row.fare.toLocaleString("en") : row.fare.toLocaleString("ko")+"원");
        top.append(time,fare);
        const detail=el("div","map-train-detail");detail.textContent=(row.grade || t("열차"))+" "+row.number+" · "+duration(row.duration);
        item.append(top,detail);list.appendChild(item);
      }
      if(!visible.length)list.appendChild(el("li","map-train-empty",!data.items.length ? "이 구간의 열차 시간표가 없어요. 날짜나 역을 바꿔 조회해 주세요."
        : matching.length && hidePast.checked ? "남은 열차가 없어요. '지난 열차 숨기기'를 해제하면 전체 시간표를 볼 수 있어요."
        : "선택한 종류의 열차가 없어요. '모든 열차'를 선택해 보세요."));
      if(data.truncated)list.appendChild(el("li","map-train-empty","시간표 일부만 받았습니다. 표시된 목록이 전체 운행편은 아닙니다."));
    }
    async function ensureCatalogue(){
      if(catalogue && Date.now()-catalogue.at<86400000)return catalogue;
      if(cataloguePromise)return cataloguePromise;
      catalogueStatus.textContent=t("전국 역 목록을 받는 중…");loadButton.disabled=true;
      cataloguePromise=api.loadCatalogue({signal:capability.signal}).then(result=>{
        if(destroyed)return null;
        catalogue=result;stationList.replaceChildren(...result.stations.map(station=>{const option=el("option","");option.value=station.label;return option;}));
        const previousGrade=grade.value;
        grade.replaceChildren(...[...grade.children].slice(0,2));
        for(const type of result.grades){const option=el("option","");option.value="name:"+type.name;option.textContent=type.name;grade.appendChild(option);}
        if([...grade.children].some(option=>option.value===previousGrade))grade.value=previousGrade;
        catalogueStatus.textContent=t("역 이름을 입력하고 목록에서 선택하세요.")+" · "+(english() ? result.stations.length+" stations" : result.stations.length+"개 역");
        updateSelection();
        return result;
      }).catch(error=>{if(!destroyed && !capability.signal.aborted){catalogueStatus.textContent="";setStatus(failure(error));}return null;})
        .finally(()=>{cataloguePromise=null;if(!destroyed)loadButton.disabled=false;});
      return cataloguePromise;
    }
    async function load(event,force=false){
      if(event)event.preventDefault();
      if(!canQuery){setStatus(t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요."));return;}
      const seq=++generation;if(abort)abort.abort();abort=null;
      const catalog=await ensureCatalogue();
      if(!catalog || destroyed || seq!==generation)return;
      const origin=api.resolveStation(from.input.value,catalog.stations),destination=api.resolveStation(to.input.value,catalog.stations);
      if(!origin || !destination){setStatus(t("출발역과 도착역을 목록에서 골라 주세요. 이름이 같은 역은 지역도 확인하세요."));(!origin ? from.input : to.input).focus();return;}
      if(origin.id===destination.id){setStatus(t("출발역과 도착역을 다르게 골라 주세요."));return;}
      const day=date.value.replace(/-/g,"");
      if(!api.validDate(day) || date.value<api.dateAt() || date.value>api.dateAt(Date.now()+30*86400000)){setStatus(t("출발 날짜는 오늘부터 30일 뒤까지 선택해 주세요."));return;}
      from.input.value=origin.label;to.input.value=destination.label;remember();
      const controller=new AbortController();abort=controller;loadButton.disabled=refresh.disabled=true;setStatus(t("시간표를 받는 중…"));
      try{
        const result=await api.loadSchedule(origin.id,destination.id,day,{signal:controller.signal,refresh:force});
        if(destroyed || seq!==generation)return;
        data={...result,from:origin,to:destination,date:day};render();
        setStatus(t("수신")+" "+new Date(data.fetchedAt).toLocaleTimeString(english() ? "en-US" : "ko-KR",{timeZone:"Asia/Seoul",hour12:false}));
      }catch(error){if(!destroyed && !controller.signal.aborted && seq===generation)setStatus(failure(error));}
      finally{if(!destroyed && seq===generation){abort=null;loadButton.disabled=refresh.disabled=false;}}
    }
    function changed(){
      generation++;if(abort)abort.abort();abort=null;loadButton.disabled=!!cataloguePromise;refresh.disabled=false;
      updateSelection();
      if(data)setStatus(t("조회 조건이 바뀌었어요. '시간표 보기'를 눌러 다시 조회해 주세요."));
    }
    form.addEventListener("submit",event=>load(event));
    refresh.addEventListener("click",()=>load(null,true));
    swap.addEventListener("click",()=>{const previous=from.input.value;from.input.value=to.input.value;to.input.value=previous;changed();remember();});
    for(const input of [from.input,to.input,date])input.addEventListener("input",changed);
    grade.addEventListener("change",render);hidePast.addEventListener("change",()=>{remember();render();});
    function show(open){panel.hidden=!open;toggle.setAttribute("aria-expanded",String(open));if(open){syncDate();from.input.focus();setLayer(showStations.checked);if(canQuery)ensureCatalogue();}toggle.setAttribute("aria-pressed",String(layerShown));}
    toggle.addEventListener("click",()=>show(panel.hidden));
    close.addEventListener("click",()=>{show(false);toggle.focus();});
    panel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();close.click();}});
    fetch("/can-proxy-train",{cache:"no-store",signal:capability.signal}).then(response=>response.ok ? response.text() : "").then(value=>{
      if(!destroyed && value.trim()==="yes"){canQuery=true;if(!panel.hidden)ensureCatalogue();}
    }).catch(()=>{});
    const timer=setInterval(()=>{if(!destroyed && !panel.hidden && data)render();},30000);
    const controller={
      captureNote(){return layerShown ? t("KTX 정차역")+" "+MNTrainStationData.timetableDate+" · 한국철도공사 · © OpenStreetMap" : "";},
      captureLabels(){return layerShown ? stations.map(station=>{const point=map.latLngToContainerPoint([station.lat,station.lng]);return {x:point.x,y:point.y,text:stationTitle(station)};}) : [];},
      destroy(){setLayer(false);destroyed=true;generation++;if(abort)abort.abort();capability.abort();clearInterval(timer);map.off("zoomend",updateLabels);layer.clearLayers();markers.clear();pane.remove();panel.remove();toggle.remove();}
    };
    if(!Array.isArray(doc.cleanupFns))doc.cleanupFns=[];doc.cleanupFns.push(()=>controller.destroy());
    return controller;
  }
  return {mount};
})();
