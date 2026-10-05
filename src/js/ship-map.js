"use strict";
/* 지도 '여객선' 층. 출발 항구 하나의 그날 시간표(TAGO)를 받아, 도착지마다 점선 하나를 긋는다.
   배의 실시간 위치도, 결항·지연 소식도 없다(이 API 에 없다) — 시간표일 뿐이라는 것을 패널에 적어 둔다.
   선을 점선으로 긋는 까닭: 실제 항로가 아니라 두 항구를 곧게 이은 그림이라서다(섬을 가로지른다).
   항구 좌표는 ship-ports-data.js 표에서 찾고, 표에 없는 도착지는 목록에만 둔다.
   버스·항공 층처럼 .map 문서 모델에는 아무것도 쓰지 않는다. */
const MNShipMap = (() => {
  const COLOR="#0e7490";
  function mount({map,stage,toolRow,doc,t = value=>value,movePanel = null}){
    const api=MNShipApi;
    const el=(tag,cls,label)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(label)node.textContent=t(label);return node;};
    const button=(label,cls="")=>{const node=el("button","map-btn "+cls,label);node.type="button";return node;};

    const toggle=button("여객선","map-toolvis-ship");
    if (typeof mapSetToolIcon==="function") mapSetToolIcon(toggle,"ship");
    toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-pressed","false");
    toggle.disabled=true;toggle.title=t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");toolRow.appendChild(toggle);

    const panel=el("section","map-ship-panel");panel.hidden=true;panel.setAttribute("aria-label",t("여객선 시간표"));
    const heading=el("div","map-ship-heading"),close=button("닫기");
    heading.append(el("strong","","여객선 시간표"),close);
    const form=el("form","map-ship-form");
    const portInput=el("input","map-input map-ship-port");portInput.setAttribute("aria-label",t("출발 항구"));
    portInput.placeholder=t("출발 항구 (예: 목포)");portInput.autocomplete="off";portInput.maxLength=30;
    const portList=document.createElement("datalist");portList.id="mapShipPorts-"+Math.random().toString(36).slice(2,8);
    portInput.setAttribute("list",portList.id);
    const dateSelect=el("select","map-select map-ship-date");dateSelect.setAttribute("aria-label",t("날짜"));
    const loadButton=button("시간표 보기","map-ship-load");loadButton.type="submit";
    form.append(portInput,portList,dateSelect,loadButton);
    const nearTools=el("div","map-ship-near-tools"),nearButton=button("📍 지도 가운데 근처 항구","map-ship-nearby");
    nearTools.appendChild(nearButton);
    const nearList=el("div","map-ship-near-list");nearList.hidden=true;
    const tools=el("div","map-ship-tools");
    const hideLabel=el("label","map-ship-hide"),hidePast=document.createElement("input");hidePast.type="checkbox";hidePast.checked=true;
    hideLabel.append(hidePast,el("span","","지난 편 숨기기"));
    const fitButton=button("전체 보기"),clearButton=button("지도에서 지우기");
    fitButton.disabled=clearButton.disabled=true;
    tools.append(hideLabel,fitButton,clearButton);
    const summary=el("p","map-ship-summary");
    const dests=el("div","map-ship-dests");dests.hidden=true;
    // 목록의 → 는 글자로 둔다(icons.js 가 그림으로 바꾸면 빽빽한 시간표에서 읽기 어렵다).
    const list=el("ul","map-ship-list ui-keep-symbols");list.hidden=true;
    const status=el("p","map-ship-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const note=el("p","map-ship-note","배의 실시간 위치나 결항 소식이 아니라 운항 시간표예요. 점선은 두 항구를 곧게 이은 그림이고 실제 뱃길과 다릅니다. 기상에 따라 결항될 수 있으니 떠나기 전에 선사에 확인하세요.");
    const source=el("a","","출처: 국가대중교통정보센터(TAGO) · 항구 위치: © OpenStreetMap");
    source.href="https://www.data.go.kr/data/15098523/openapi.do";source.target="_blank";source.rel="noopener noreferrer";
    panel.append(heading,form,nearTools,nearList,tools,summary,dests,list,status,note,source);
    stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
    if (typeof movePanel==="function") movePanel(panel,heading);

    const pane=map.createPane("mapShipPane");pane.style.zIndex="385";
    const layer=L.layerGroup();
    const capability=new AbortController();
    let destroyed=false,data=null,destFilter="",generation=0,abort=null,portsById=new Map(),portsByName=new Map();
    const setStatus=value=>{if(status.textContent!==value)status.textContent=value;};
    const english=()=>!!(window.MNI18N && window.MNI18N.lang==="en");
    // 단위 한 글자(원·곳·편)는 사전에 넣지 않는다 — 사전은 글 조각 전체를 바꿔서 다른 화면의 '원'까지 바뀐다.
    const won=value=>english() ? "₩"+value.toLocaleString("en") : value.toLocaleString()+"원";
    const places=count=>english() ? count+" place"+(count===1 ? "" : "s") : count+"곳";
    const trips=count=>english() ? count+" sailing"+(count===1 ? "" : "s") : count+"편";

    // 날짜: 오늘부터 이레. 런처는 어제~열흘 뒤만 받는다.
    for (let i=0;i<7;i++){
      const day=new Date();day.setDate(day.getDate()+i);
      const option=el("option","");option.value=api.ymd(day);
      const weekday=day.toLocaleDateString(english() ? "en-US" : "ko-KR",{weekday:"short"});
      option.textContent=(i===0 ? t("오늘")+" " : i===1 ? t("내일")+" " : "")+(day.getMonth()+1)+"/"+day.getDate()+" ("+weekday+")";
      dateSelect.appendChild(option);
    }
    try{const saved=JSON.parse(localStorage.getItem("mapShipBoard") || "null");
      if(saved && typeof saved.port==="string")portInput.value=saved.port.slice(0,30);
      if(saved && saved.hidePast===false)hidePast.checked=false;}catch(_){}
    if(!portInput.value)portInput.value="목포";
    const remember=()=>{try{localStorage.setItem("mapShipBoard",JSON.stringify({port:portInput.value.trim(),hidePast:hidePast.checked}));}catch(_){}};

    const failureText=(error,fallback)=>t(error && error.message==="bus-key-required" ? "설정의 '공공데이터포털'에 인증키를 넣어 주세요."
      : error && error.message==="bus-key-invalid" ? "인증키가 여객선 시간표에 쓰일 수 없어요. 공공데이터포털에서 '국토교통부_(TAGO)_국내선박운항정보' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요."
      : error && error.message==="bus-quota" ? "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요." : fallback);

    function shownItems(){
      if (!data) return [];
      if (!hidePast.checked || data.date!==api.ymd(new Date())) return data.items;
      const now=new Date(),minutes=now.getHours()*60+now.getMinutes();
      return data.items.filter(item=>item.dep.day!==data.date || item.dep.minutes>=minutes);
    }
    // 출발 항구 자리. 같은 이름 항구가 둘이면 도착지들 가운데에 가까운 쪽.
    function originAt(items){
      const spots=items.map(item=>api.coordsOf(item.to)).filter(Boolean);
      const middle=spots.length ? [spots.reduce((s,p)=>s+p[0],0)/spots.length,spots.reduce((s,p)=>s+p[1],0)/spots.length] : null;
      return api.coordsOf(data.port,middle);
    }

    // 지도 이름표(미니 출발 게시판, 시안 C): 짙은 판 머리에 항구·편수, 아래에 앞으로 떠날 항해 셋, 나머지는 '+N편 더'.
    // 오늘이면 아직 안 떠난 항해부터 보인다('지난 편 숨기기'를 꺼도). 남은 게 없으면 그날 것을 앞에서부터.
    const TIP_ROWS=3;
    function upcoming(items){
      const all=api.voyages(items);
      if (data.date!==api.ymd(new Date())) return all;
      const now=new Date(),minutes=now.getHours()*60+now.getMinutes();
      const left=all.filter(voyage=>voyage.dep.day!==data.date || voyage.dep.minutes>=minutes);
      return left.length ? left : all;
    }
    // dest 가 있으면 그 도착지 이름표: 가운데 칸=배 이름, 오른쪽=운임. 없으면 출발 항구: 가운데=들르는 곳, 오른쪽=배 이름.
    function tipOf(items,dest=""){
      const box=el("span","map-ship-tip-body ui-keep-symbols");
      const top=el("span","map-ship-tip-head"),icon=el("span","map-ship-tip-ico"),title=el("span","map-ship-tip-title");
      if (typeof mapToolIconUrl==="function"){const url=mapToolIconUrl("ship");if(url)icon.style.setProperty("--map-icon",url);}
      const port=api.displayName(data.port);
      title.textContent=dest ? port+" → "+api.displayName(dest) : english() ? "Departures · "+port : port+" 출발";
      // 편수는 항해(배·출발 시각) 수로 센다 — 아래 줄·'+N편 더'와 같은 셈이라야 어긋나지 않는다.
      const count=el("span","map-ship-tip-count");count.textContent=trips(api.voyages(items).length);
      top.append(icon,title,count);box.appendChild(top);
      const list=upcoming(items),rows=el("span","map-ship-tip-rows");
      for (const voyage of list.slice(0,TIP_ROWS)){
        const row=el("span","map-ship-tip-row");
        const time=el("span","map-ship-tip-time");time.textContent=voyage.dep.time;
        const main=el("span","map-ship-tip-main"),side=el("span","map-ship-tip-side");
        const ship=voyage.ship || t("배 이름 없음");
        if (dest){
          main.textContent=ship;
          if (voyage.fares.length) side.textContent=won(Math.min(...voyage.fares));
        } else {
          main.textContent=voyage.stops.map(api.displayName).join(" · ");
          side.textContent=ship;
        }
        row.append(time,main,side);rows.appendChild(row);
      }
      box.appendChild(rows);
      const more=list.length-TIP_ROWS,hint=dest ? t(destFilter===dest ? "누르면 전체 보기" : "누르면 이 곳만 보기") : "";
      const foot=[more>0 ? (english() ? "+"+more+" more" : "+"+more+"편 더") : "",hint].filter(Boolean).join(" · ");
      if (foot){const footNode=el("span","map-ship-tip-foot");footNode.textContent=foot;box.appendChild(footNode);}
      return box;
    }
    const TIP={className:"map-ship-tip"};
    function draw(items){
      layer.clearLayers();
      if (!data){map.removeLayer(layer);return new Set();}
      layer.addTo(map);
      const missing=new Set(),origin=originAt(data.items);
      if (!origin){missing.add(data.port);return missing;}
      // 가리킨 점을 키우고 게시판 시각과 같은 호박색 테를 둘러 어느 항구의 이름표인지 바로 보이게 한다.
      const dot=(at,tip,style)=>{
        const marker=L.circleMarker(at,{pane:"mapShipPane",bubblingMouseEvents:false,...style});
        marker.bindTooltip(tip,{...TIP,direction:"top",offset:[0,-10]});
        marker.on("mouseover",()=>marker.setStyle({radius:style.radius+3,weight:3,color:"#fbbf24"}));
        marker.on("mouseout",()=>marker.setStyle({radius:style.radius,weight:style.weight,color:style.color}));
        layer.addLayer(marker);return marker;
      };
      for (const group of api.destinations(items)){
        const at=api.coordsOf(group.name,origin);
        if (!at){missing.add(group.name);continue;}
        const faded=destFilter && destFilter!==group.name;
        const tip=()=>tipOf(items.filter(item=>item.to===group.name),group.name);
        const pick=()=>setDestFilter(destFilter===group.name ? "" : group.name);
        const line=L.polyline([origin,at],{pane:"mapShipPane",color:COLOR,weight:2+Math.min(4,Math.sqrt(group.count)),dashArray:"6 6",
          opacity:faded ? 0.2 : 0.85,bubblingMouseEvents:false,className:"map-ship-route"});
        line.bindTooltip(tip,{...TIP,sticky:true});line.on("click",pick);layer.addLayer(line);
        dot(at,tip,{radius:5,color:COLOR,weight:2,fillColor:"#ffffff",opacity:faded ? 0.3 : 1,fillOpacity:faded ? 0.3 : 1}).on("click",pick);
      }
      dot(origin,()=>tipOf(items),{radius:8,color:"#ffffff",weight:2,fillColor:"#0f172a",fillOpacity:1});
      return missing;
    }
    function fit(){
      const points=[];
      layer.eachLayer(item=>{if(item.getLatLngs)points.push(...item.getLatLngs());else if(item.getLatLng)points.push(item.getLatLng());});
      if (!points.length) return;
      const stageBox=stage.getBoundingClientRect(),panelBox=panel.hidden ? null : panel.getBoundingClientRect();
      const cover=panelBox ? Math.max(0,Math.min(stageBox.right,panelBox.right)-Math.max(stageBox.left,panelBox.left)) : 0;
      const right=cover && cover<stageBox.width*0.6 && panelBox.left>stageBox.left+stageBox.width/3 ? cover+20 : 40;
      map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[40,40],paddingBottomRight:[right,40],maxZoom:12});
    }
    function render(){
      const items=shownItems(),missing=draw(items);
      const visibleItems=destFilter ? items.filter(item=>item.to===destFilter) : items;
      const rows=api.voyages(visibleItems).map(voyage=>{
        const row=el("li","map-ship-item");
        const time=el("span","map-ship-time");time.textContent=voyage.dep.time;
        const ship=el("strong","map-ship-name");ship.textContent=voyage.ship || t("배 이름 없음");
        const stops=el("span","map-ship-stops");stops.textContent="→ "+voyage.stops.map(api.displayName).join(" · ");
        row.append(time,ship,stops);
        if (voyage.fares.length){
          const low=Math.min(...voyage.fares),high=Math.max(...voyage.fares);
          const fare=el("span","map-ship-fare");fare.textContent=low===high ? won(low) : won(low)+"~"+won(high);row.appendChild(fare);
        }
        return row;
      });
      list.replaceChildren(...rows);list.hidden=!data;
      if (data && !rows.length) list.replaceChildren(el("li","map-ship-empty",data.items.length && hidePast.checked
        ? "오늘 남은 편이 없어요. '지난 편 숨기기'를 끄면 오늘 편을 모두 봅니다." : "이 날 이 항구에서 떠나는 여객선이 없어요."));
      if (data){
        // 편수는 항해(배·출발 시각) 수로 센다 — 목록 줄 수·지도 이름표와 같은 셈. 도착지 칩은 그곳에 서는 항해 수.
        const groups=api.destinations(items),sailings=api.voyages(items).length;
        const all=button("","map-ship-dest"+(destFilter ? "" : " is-on"));all.textContent=t("전체")+" "+sailings;
        all.addEventListener("click",()=>setDestFilter(""));
        const chips=groups.map(group=>{
          const chip=button("","map-ship-dest"+(destFilter===group.name ? " is-on" : "")+(api.coordsOf(group.name) ? "" : " is-unplaced"));
          chip.textContent=api.displayName(group.name)+" "+group.count;
          chip.addEventListener("click",()=>setDestFilter(destFilter===group.name ? "" : group.name));
          return chip;
        });
        dests.replaceChildren(all,...chips);dests.hidden=!groups.length;
        const hidden=api.voyages(data.items).length-sailings;
        summary.textContent=[api.displayName(data.port)+" "+t("출발")+" · "+data.label,
          trips(sailings)+" · "+t("도착지")+" "+places(groups.length),
          hidden>0 ? t("지난 편")+" "+hidden+t("편 숨김") : "",
          missing.size ? t("위치를 모르는 곳")+" "+missing.size+t("곳은 목록에만") : ""].filter(Boolean).join(" · ");
      } else {dests.replaceChildren();dests.hidden=true;summary.textContent="";}
      fitButton.disabled=clearButton.disabled=!data;
      toggle.classList.toggle("is-on",!!data);toggle.setAttribute("aria-pressed",String(!!data));
    }
    function setDestFilter(name){destFilter=name;render();}

    // 항구 이름 → ID. 같은 이름이 둘이면 둘 다 물어 합친다(어느 쪽인지 이름만으로는 모른다).
    function resolvePort(value){
      const name=value.trim().replace(/\s+/g," ");
      const exact=portsByName.get(name) || portsByName.get(name.replace(/ /g,"_"));
      if (exact) return {name:portsById.get(exact[0]).name,ids:exact};
      if (api.validPort(name.toUpperCase()) && portsById.has(name.toUpperCase())) return {name:portsById.get(name.toUpperCase()).name,ids:[name.toUpperCase()]};
      return null;
    }
    async function load(event){
      if (event) event.preventDefault();
      if (!portsById.size){setStatus(t("항구 목록을 받는 중이에요. 잠시 뒤 다시 눌러 주세요."));loadPorts();return;}
      const port=resolvePort(portInput.value);
      if (!port){setStatus(t("항구 이름을 목록에서 골라 주세요. (예: 목포, 인천, 통영, 완도_화흥포)"));portInput.focus();return;}
      generation++;if(abort)abort.abort();
      const seq=generation,controller=new AbortController();abort=controller;loadButton.disabled=true;
      const date=dateSelect.value,label=dateSelect.selectedOptions[0] ? dateSelect.selectedOptions[0].textContent : date;
      setStatus(t("시간표를 받는 중…"));remember();
      try{
        const results=await Promise.all(port.ids.map(id=>api.loadSchedule(id,date,{signal:controller.signal})));
        if (destroyed || seq!==generation) return;
        const items=results.flatMap(result=>result.items).sort((a,b)=>a.dep.raw.localeCompare(b.dep.raw));
        const same=data && data.port===port.name && data.date===date;
        data={port:port.name,date,label,items,fetchedAt:Math.min(...results.map(result=>result.fetchedAt))};
        if (!same || !items.some(item=>item.to===destFilter)) destFilter="";
        render();fit();
        setStatus(t("수신")+" "+new Date(data.fetchedAt).toLocaleTimeString([], {hour12:false}));
      }catch(error){
        if (controller.signal.aborted || seq!==generation) return;
        setStatus(failureText(error,"시간표를 받지 못했어요. 잠시 후 다시 시도해 주세요."));
      }finally{
        if (seq===generation){loadButton.disabled=false;abort=null;}
      }
    }
    function clearAll(){
      generation++;if(abort)abort.abort();abort=null;loadButton.disabled=false;
      data=null;destFilter="";render();setStatus(t("여객선 표시를 지웠어요."));
    }
    // 지도 가운데 근처 항구: 떠나는 편이 있는 항구만(항구 목록 이름과 좌표 표가 겹치는 곳).
    function showNearby(){
      const center=map.getCenter(),known=new Set(portsByName.keys());
      const found=api.nearby([center.lat,center.lng],10,known.size ? known : null);
      nearList.hidden=false;
      if (!found.length){nearList.replaceChildren(el("p","map-ship-near-note","지도 가운데 근처에 아는 항구가 없어요."));return;}
      nearList.replaceChildren(...found.map(spot=>{
        const item=button("","map-ship-near");
        item.textContent=api.displayName(spot.name)+" · "+(spot.distance<1000 ? Math.round(spot.distance)+"m" : (spot.distance/1000).toFixed(1)+"km");
        item.addEventListener("click",()=>{portInput.value=api.displayName(spot.name);nearList.hidden=true;load();});
        return item;
      }));
    }
    async function loadPorts(){
      try{
        const ports=await api.loadPorts({signal:capability.signal});
        if (destroyed || !ports.length) return;
        portsById=new Map(ports.map(port=>[port.id,port]));portsByName=new Map();
        for (const port of ports){
          for (const key of [port.name,api.displayName(port.name)]){
            if (!portsByName.has(key)) portsByName.set(key,[]);
            if (!portsByName.get(key).includes(port.id)) portsByName.get(key).push(port.id);
          }
        }
        const names=[...new Set(ports.map(port=>api.displayName(port.name)))].sort((a,b)=>a.localeCompare(b,"ko"));
        portList.replaceChildren(...names.map(name=>{const option=document.createElement("option");option.value=name;return option;}));
      }catch(error){
        if (!destroyed && !capability.signal.aborted) setStatus(failureText(error,"항구 목록을 받지 못했어요. 잠시 후 다시 열어 주세요."));
      }
    }

    form.addEventListener("submit",load);
    nearButton.addEventListener("click",showNearby);
    hidePast.addEventListener("change",()=>{remember();if(data)render();});
    fitButton.addEventListener("click",fit);
    clearButton.addEventListener("click",clearAll);
    toggle.addEventListener("click",()=>{
      if (data){clearAll();panel.hidden=true;}
      else panel.hidden=!panel.hidden;
      toggle.setAttribute("aria-expanded",String(!panel.hidden));
      if (!panel.hidden){portInput.focus();if(!portsById.size)loadPorts();}
    });
    close.addEventListener("click",()=>{panel.hidden=true;nearList.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.focus();});
    panel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();close.click();}});

    fetch("/can-proxy-ship",{cache:"no-store",signal:capability.signal}).then(r=>r.ok ? r.text() : "").then(value=>{
      if (destroyed || value.trim()!=="yes") return;
      toggle.disabled=false;toggle.title=t("항구의 여객선 시간표를 지도에 뱃길 선으로 펼칩니다.");
    }).catch(()=>{});

    const controller={
      freeze(){return ()=>{};},
      captureNote(){
        if (!data) return "";
        return [t("여객선 시간표"),api.displayName(data.port)+" "+t("출발"),data.label,"TAGO",t("항구 위치")+" © OpenStreetMap"].join(" · ");
      },
      destroy(){
        destroyed=true;generation++;if(abort)abort.abort();capability.abort();
        layer.clearLayers();map.removeLayer(layer);panel.remove();toggle.remove();pane.remove();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns=[];
    doc.cleanupFns.push(()=>controller.destroy());
    return controller;
  }
  return {mount};
})();
