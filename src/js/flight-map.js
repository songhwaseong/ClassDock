"use strict";
/* 지도 '항공 운항' 층. 공항 운항 게시판(한국공항공사)을 지도 위에 노선 선으로 펼친다.
   비행기의 실시간 위치를 쫓지 않는다 — 게시판에 오는 것은 예정·변경 시각과 상태뿐이고 좌표가 없다.
   그래서 '이 공항에서 오늘 어디로 몇 편이 뜨고, 어느 쪽이 지연·결항인가'를 선의 굵기·색으로 보인다.
   버스·지하철 층처럼 .map 문서 모델에는 아무것도 쓰지 않는다(지금 이 순간의 값이라 파일에 담으면 낡는다).
   캡처(칠판·PNG·인쇄)에는 선이 남고, 출처·수신 시각은 captureNote 로 그림 아래에 붙는다. */
const MNFlightMap = (() => {
  const COLORS={normal:"#1d6fb8",delayed:"#d97706",cancelled:"#c0392b",diverted:"#7c3aed"};
  const REFRESH_MS=180000;     // 게시판은 몇 분에 한 번 바뀌는 정도다. 런처도 1분 캐시를 둔다.
  function mount({map,stage,toolRow,doc,t = value=>value,movePanel = null}){
    const api=MNFlightApi;
    const english=()=>!!(window.MNI18N && window.MNI18N.lang==="en");
    const el=(tag,cls,label)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(label)node.textContent=t(label);return node;};
    const button=(label,cls="")=>{const node=el("button","map-btn "+cls,label);node.type="button";return node;};
    const option=(value,label)=>{const node=el("option","",label);node.value=value;return node;};

    const toggle=button("항공","map-toolvis-flight");
    if (typeof mapSetToolIcon==="function") mapSetToolIcon(toggle,"plane");
    toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-pressed","false");
    toggle.disabled=true;toggle.title=t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");toolRow.appendChild(toggle);

    const panel=el("section","map-flight-panel");panel.hidden=true;panel.setAttribute("aria-label",t("항공 운항"));
    const heading=el("div","map-flight-heading"),close=button("닫기");
    heading.append(el("strong","","항공 운항"),close);
    const boardForm=el("form","map-flight-board-form");
    const airportSelect=el("select","map-select map-flight-airport");airportSelect.setAttribute("aria-label",t("공항"));
    const ioSelect=el("select","map-select map-flight-io");ioSelect.setAttribute("aria-label",t("출발·도착"));
    ioSelect.append(option("O","출발"),option("I","도착"));
    const lineSelect=el("select","map-select map-flight-line");lineSelect.setAttribute("aria-label",t("국내선·국제선"));
    lineSelect.append(option("D","국내선"),option("I","국제선"));
    const loadButton=button("게시판 보기","map-flight-load");loadButton.type="submit";
    boardForm.append(airportSelect,ioSelect,lineSelect,loadButton);
    const tools=el("div","map-flight-tools");
    const hideLabel=el("label","map-flight-hide"),hideDone=document.createElement("input");hideDone.type="checkbox";hideDone.checked=true;
    hideLabel.append(hideDone,el("span","","끝난 편 숨기기"));
    const fitButton=button("전체 보기"),refreshButton=button("새로고침"),clearButton=button("지도에서 지우기");
    fitButton.disabled=refreshButton.disabled=clearButton.disabled=true;
    tools.append(hideLabel,fitButton,refreshButton,clearButton);
    const summary=el("p","map-flight-summary");
    const dests=el("div","map-flight-dests");dests.hidden=true;
    // 목록의 →(바뀐 시각·구간)는 글자로 둔다. icons.js 가 그림으로 바꾸면 빽빽한 시간표에서 읽기 어렵다.
    const list=el("ul","map-flight-list ui-keep-symbols");list.hidden=true;
    const searchForm=el("form","map-flight-search"),searchInput=el("input","map-input");
    searchInput.maxLength=8;searchInput.placeholder=t("편명 (예: KE1201)");searchInput.setAttribute("aria-label",t("편명"));
    searchInput.autocomplete="off";searchInput.spellcheck=false;
    const searchButton=button("편명 찾기");searchButton.type="submit";
    searchForm.append(searchInput,searchButton);
    const status=el("p","map-flight-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const note=el("p","map-flight-note","비행기의 실시간 위치가 아니라 공항 운항 게시판이에요. 선은 두 공항을 곧게 이은 그림입니다.");
    const source=el("a","","출처: 한국공항공사(공공데이터포털)");
    source.href="https://www.data.go.kr/data/15158625/openapi.do";source.target="_blank";source.rel="noopener noreferrer";
    panel.append(heading,boardForm,tools,summary,dests,list,searchForm,status,note,source);
    stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
    if (typeof movePanel==="function") movePanel(panel,heading);

    // 선은 표시(markerPane 600) 아래, 타일 위에 둔다 — 선이 표시를 가리면 표시를 누를 수 없다.
    const pane=map.createPane("mapFlightPane");pane.style.zIndex="380";
    const layer=L.layerGroup();
    const capability=new AbortController();

    let destroyed=false,frozen=0,mode="",data=null,destFilter="",generation=0,abort=null,loading=false,nextRefresh=0;
    const setStatus=value=>{if(status.textContent!==value)status.textContent=value;};
    const clock=stamp=>new Date(stamp).toLocaleTimeString([], {hour12:false});
    const visible=()=>!document.hidden && !!stage.offsetParent;
    // 공항 이름은 앱 표의 이름을 먼저 쓴다. 게시판 이름은 '베이징(서우두)/서우두'처럼 옛·새 표기가 겹쳐 온다.
    const nameOf=(code,fallback,fallbackEn)=>api.airportName(code,english(),english() ? (fallbackEn || fallback) : fallback);
    const flightsText=count=>english() ? count+" flight"+(count===1 ? "" : "s") : count+"편";
    const statusText=item=>english() ? (item.statusEn || (item.kind==="scheduled" ? "" : item.status)) : item.status;

    // 고른 공항·방향은 이 브라우저에 남긴다(문서가 아니라 사용자 편의).
    const saved=(()=>{try{return JSON.parse(localStorage.getItem("mapFlightBoard") || "null") || {};}catch(_){return {};}})();
    for (const code of api.BOARD_AIRPORTS) airportSelect.appendChild(option(code,api.airportName(code,english())+" ("+code+")"));
    airportSelect.value=api.BOARD_AIRPORTS.includes(saved.airport) ? saved.airport : "GMP";
    ioSelect.value=saved.io==="I" ? "I" : "O";lineSelect.value=saved.line==="I" ? "I" : "D";
    if (saved.hideDone===false) hideDone.checked=false;
    const remember=()=>{try{localStorage.setItem("mapFlightBoard",JSON.stringify({airport:airportSelect.value,io:ioSelect.value,line:lineSelect.value,hideDone:hideDone.checked}));}catch(_){}};

    // 키·한도 문제는 기다려도 풀리지 않는다. 활용신청은 API 마다 따로라 어느 것을 신청할지 알려 준다.
    const failureText=(error,fallback,kind)=>t(error && error.message==="bus-key-required" ? "설정의 '공공데이터포털'에 인증키를 넣어 주세요."
      : error && error.message==="bus-key-invalid" ? (kind==="search"
        ? "인증키가 편명 찾기에 쓰일 수 없어요. 공공데이터포털에서 '한국공항공사_실시간 항공기 운항정보 검색' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요."
        : "인증키가 항공 운항 조회에 쓰일 수 없어요. 공공데이터포털에서 '한국공항공사_실시간 항공기 운항정보 조회' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 시간이 걸릴 수 있어요.")
      : error && error.message==="bus-quota" ? "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요." : fallback);

    function shownItems(){
      if (!data) return [];
      return mode==="board" && hideDone.checked ? data.items.filter(item=>!api.finished(item.kind)) : data.items;
    }
    function kindCounts(items){
      const counts={};
      for (const item of items) counts[item.kind]=(counts[item.kind] || 0)+1;
      return counts;
    }
    function countText(counts){
      return [["delayed","지연"],["cancelled","결항"],["diverted","회항"]].filter(([kind])=>counts[kind])
        .map(([kind,label])=>t(label)+" "+counts[kind]).join(" · ");
    }
    function boardTitle(){
      if (!data) return "";
      return nameOf(data.airport)+" "+t(data.line==="I" ? "국제선" : "국내선")+" "+t(data.io==="I" ? "도착" : "출발");
    }

    // ── 지도 ──
    function draw(){
      layer.clearLayers();
      if (!mode || !data){map.removeLayer(layer);return;}
      layer.addTo(map);
      const items=shownItems(),missing=new Set();
      const dot=(at,tip,style)=>{
        const marker=L.circleMarker(at,{pane:"mapFlightPane",bubblingMouseEvents:false,...style});
        marker.bindTooltip(tip,{direction:"top",offset:[0,-6]});
        layer.addLayer(marker);return marker;
      };
      if (mode==="board"){
        const base=api.airport(data.airport);
        if (!base) return;
        for (const group of api.destinations(items)){
          const other=api.airport(group.code);
          if (!other){missing.add(group.code || group.name);continue;}
          const worst=api.worstKind(group.kinds),faded=destFilter && destFilter!==group.code;
          const place=nameOf(group.code,group.name,group.nameEn);
          const route=data.io==="I" ? place+" → "+nameOf(data.airport) : nameOf(data.airport)+" → "+place;
          const tip=[route,flightsText(group.count),countText(group.kinds)].filter(Boolean).join(" · ");
          const points=data.io==="I" ? api.greatCircle(other.at,base.at) : api.greatCircle(base.at,other.at);
          const line=L.polyline(points,{pane:"mapFlightPane",color:COLORS[worst],weight:2+Math.min(6,Math.sqrt(group.count)),
            opacity:faded ? 0.2 : 0.85,lineCap:"round",bubblingMouseEvents:false,className:"map-flight-route"});
          line.bindTooltip(tip,{sticky:true});
          line.on("click",()=>setDestFilter(destFilter===group.code ? "" : group.code));
          layer.addLayer(line);
          dot(other.at,tip,{radius:5,color:COLORS[worst],weight:2,fillColor:"#ffffff",opacity:faded ? 0.3 : 1,fillOpacity:faded ? 0.3 : 1})
            .on("click",()=>setDestFilter(destFilter===group.code ? "" : group.code));
        }
        dot(base.at,boardTitle()+" · "+flightsText(items.length),{radius:8,color:"#ffffff",weight:2,fillColor:"#0f172a",fillOpacity:1});
      } else {
        // 편명 찾기: 같은 편이 출발 공항 줄·도착 공항 줄 두 줄로 온다. 구간(출발→도착)마다 선 하나.
        const legs=new Map();
        for (const item of items){
          const key=item.from+">"+item.to;
          if (!legs.has(key)) legs.set(key,{from:item.from,to:item.to,fromName:item.fromName,toName:item.toName,
            fromNameEn:item.fromNameEn,toNameEn:item.toNameEn,flight:item.flight,kinds:{}});
          const leg=legs.get(key);leg.kinds[item.kind]=(leg.kinds[item.kind] || 0)+1;
        }
        for (const leg of legs.values()){
          const a=api.airport(leg.from),b=api.airport(leg.to);
          if (!a || !b){missing.add(!a ? (leg.from || leg.fromName) : (leg.to || leg.toName));continue;}
          const worst=api.worstKind(leg.kinds);
          const tip=leg.flight+" · "+nameOf(leg.from,leg.fromName,leg.fromNameEn)+" → "+nameOf(leg.to,leg.toName,leg.toNameEn);
          const line=L.polyline(api.greatCircle(a.at,b.at),{pane:"mapFlightPane",color:COLORS[worst],weight:4,opacity:0.9,
            lineCap:"round",bubblingMouseEvents:false,className:"map-flight-route"});
          line.bindTooltip(tip,{sticky:true});layer.addLayer(line);
          dot(a.at,nameOf(leg.from,leg.fromName,leg.fromNameEn)+" ("+t("출발")+")",{radius:7,color:"#ffffff",weight:2,fillColor:"#0f172a",fillOpacity:1});
          dot(b.at,nameOf(leg.to,leg.toName,leg.toNameEn)+" ("+t("도착")+")",{radius:6,color:COLORS[worst],weight:2,fillColor:"#ffffff",fillOpacity:1});
        }
      }
      return missing;
    }
    function fit(){
      const points=[];
      layer.eachLayer(item=>{
        if (item.getLatLngs) points.push(...item.getLatLngs());
        else if (item.getLatLng) points.push(item.getLatLng());
      });
      if (!points.length) return;
      // 패널이 지도 오른쪽을 덮으므로 그만큼 비워 두고 맞춘다(패널을 옮겼으면 덮는 폭만큼).
      const stageBox=stage.getBoundingClientRect(),panelBox=panel.hidden ? null : panel.getBoundingClientRect();
      const cover=panelBox ? Math.max(0,Math.min(stageBox.right,panelBox.right)-Math.max(stageBox.left,panelBox.left)) : 0;
      const right=cover && cover<stageBox.width*0.6 && panelBox.left>stageBox.left+stageBox.width/3 ? cover+20 : 40;
      map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[40,40],paddingBottomRight:[right,40],maxZoom:9});
    }

    // ── 패널 목록 ──
    function renderList(missing){
      const items=shownItems();
      const visibleItems=mode==="board" && destFilter ? items.filter(item=>item.other===destFilter) : items;
      const rows=visibleItems.map(item=>{
        const row=el("li","map-flight-item is-"+item.kind);
        const time=el("span","map-flight-time");time.textContent=api.timeText(item.std);
        if (item.etd && item.etd!==item.std){
          // 늦어진 시각은 주황, 앞당겨진 시각(일찍 도착 등)은 초록으로 가른다.
          const early=item.delay!=null && item.delay<0;
          const changed=el("span","map-flight-changed"+(early ? " is-early" : ""));changed.textContent="→ "+api.timeText(item.etd);
          if (item.delay) changed.title=(item.delay>0 ? "+" : "")+item.delay+" "+t("분");
          time.appendChild(changed);
        }
        const number=el("strong","map-flight-number");number.textContent=item.flight;
        const airline=el("span","map-flight-airline");airline.textContent=english() ? (item.airlineEn || item.airline) : item.airline;
        const place=el("span","map-flight-place");
        place.textContent=mode==="board" ? nameOf(item.other,item.io==="O" ? item.toName : item.fromName,item.io==="O" ? item.toNameEn : item.fromNameEn)
          : nameOf(item.from,item.fromName,item.fromNameEn)+" → "+nameOf(item.to,item.toName,item.toNameEn)+" · "+t(item.io==="O" ? "출발" : "도착");
        const badge=el("span","map-flight-badge is-"+item.kind);badge.textContent=statusText(item) || t("예정");
        row.append(time,number,airline,place,badge);
        if (item.gate){const gate=el("span","map-flight-gate");gate.textContent=t("게이트")+" "+item.gate;row.appendChild(gate);}
        return row;
      });
      list.replaceChildren(...rows);
      list.hidden=!mode;
      if (mode && !rows.length) list.replaceChildren(el("li","map-flight-empty",mode==="board" && hideDone.checked && data.items.length
        ? "남은 편이 없어요. '끝난 편 숨기기'를 끄면 오늘 편을 모두 봅니다." : "보여 줄 편이 없어요."));
      // 상대 공항 칩: 누르면 그 공항 편만 목록에 남기고 다른 선은 흐리게 한다.
      if (mode==="board"){
        const groups=api.destinations(items);
        const all=button("","map-flight-dest"+(destFilter ? "" : " is-on"));all.textContent=t("전체")+" "+items.length;
        all.addEventListener("click",()=>setDestFilter(""));
        const chips=groups.map(group=>{
          const chip=button("","map-flight-dest"+(destFilter===group.code ? " is-on" : ""));
          chip.textContent=nameOf(group.code,group.name,group.nameEn)+" "+group.count;
          const worst=api.worstKind(group.kinds);
          if (worst!=="normal"){chip.classList.add("is-"+worst);chip.title=countText(group.kinds);}
          chip.disabled=!group.code;
          chip.addEventListener("click",()=>setDestFilter(destFilter===group.code ? "" : group.code));
          return chip;
        });
        dests.replaceChildren(all,...chips);dests.hidden=!groups.length;
      } else {dests.replaceChildren();dests.hidden=true;}
      // 요약: 몇 편·지연·결항·숨긴 편·좌표 없는 공항.
      if (!mode){summary.textContent="";return;}
      const counts=kindCounts(items),hidden=data.items.length-items.length;
      summary.textContent=[mode==="board" ? boardTitle() : t("편명")+" "+data.flight,
        flightsText(items.length),countText(counts),
        hidden>0 ? t("끝난 편")+" "+hidden+t("편 숨김") : "",
        missing && missing.size ? t("위치를 모르는 공항")+" "+missing.size+t("곳은 목록에만") : "",
        data.truncated ? t("일부만 받음") : ""].filter(Boolean).join(" · ");
    }
    function render(){
      const missing=draw();
      renderList(missing);
      fitButton.disabled=refreshButton.disabled=clearButton.disabled=!mode;
      toggle.classList.toggle("is-on",!!mode);toggle.setAttribute("aria-pressed",String(!!mode));
    }
    function setDestFilter(code){destFilter=code;render();}

    // ── 조회 ──
    function cancel(){generation++;if(abort)abort.abort();abort=null;loading=false;loadButton.disabled=searchButton.disabled=false;}
    async function loadBoard({refresh=false,fitAfter=true}={}){
      cancel();remember();
      const seq=generation,controller=new AbortController();abort=controller;loading=true;loadButton.disabled=true;
      const want={airport:airportSelect.value,io:ioSelect.value,line:lineSelect.value};
      setStatus(t("운항 게시판을 받는 중…"));
      try{
        const result=await api.board({...want,signal:controller.signal,refresh});
        if (destroyed || seq!==generation) return;
        const same=mode==="board" && data && data.airport===want.airport && data.io===want.io && data.line===want.line;
        mode="board";data={...want,...result};
        if (!same) destFilter="";
        else if (destFilter && !result.items.some(item=>item.other===destFilter)) destFilter="";
        nextRefresh=Date.now()+REFRESH_MS;
        render();if (fitAfter) fit();
        setStatus(t("수신")+" "+clock(result.fetchedAt)+" · "+t("몇 분마다 새로 받아요."));
      }catch(error){
        if (controller.signal.aborted || seq!==generation) return;
        nextRefresh=Date.now()+Math.max(REFRESH_MS,error.retryAfterMs || 0);
        setStatus(failureText(error,"운항 정보를 받지 못했어요. 잠시 후 다시 시도해 주세요.","board"));
      }finally{
        if (seq===generation){loading=false;loadButton.disabled=false;abort=null;}
      }
    }
    async function searchFlight(event){
      event.preventDefault();
      const value=api.normalizeFlight(searchInput.value);
      if (!api.validFlight(value)){setStatus(t("편명을 입력해 주세요. (예: KE1201)"));searchInput.focus();return;}
      cancel();
      const seq=generation,controller=new AbortController();abort=controller;loading=true;searchButton.disabled=true;
      setStatus(t("편명을 찾는 중…"));
      try{
        const result=await api.search(value,{signal:controller.signal});
        if (destroyed || seq!==generation) return;
        if (!result.items.length){setStatus(t("오늘 운항 게시판에서 이 편명을 찾지 못했어요.")+" ("+value+")");return;}
        mode="search";destFilter="";data={flight:value,items:result.items,fetchedAt:result.fetchedAt,truncated:false};
        render();fit();
        setStatus(t("수신")+" "+clock(result.fetchedAt));
      }catch(error){
        if (controller.signal.aborted || seq!==generation) return;
        setStatus(failureText(error,"편명을 찾지 못했어요. 잠시 후 다시 시도해 주세요.","search"));
      }finally{
        if (seq===generation){loading=false;searchButton.disabled=false;abort=null;}
      }
    }
    function clearAll(){
      cancel();mode="";data=null;destFilter="";render();setStatus(t("항공 운항 표시를 지웠어요."));
    }

    boardForm.addEventListener("submit",event=>{event.preventDefault();loadBoard();});
    searchForm.addEventListener("submit",searchFlight);
    hideDone.addEventListener("change",()=>{remember();if(mode)render();});
    fitButton.addEventListener("click",fit);
    refreshButton.addEventListener("click",()=>mode==="board" ? loadBoard({refresh:true,fitAfter:false}) : searchFlight({preventDefault(){}}));
    clearButton.addEventListener("click",clearAll);
    // 켜진 채로 도구 단추를 누르면 지우고 닫는다(버스 단추와 같은 규칙).
    toggle.addEventListener("click",()=>{
      if (mode){clearAll();panel.hidden=true;}
      else panel.hidden=!panel.hidden;
      toggle.setAttribute("aria-expanded",String(!panel.hidden));
      if (!panel.hidden) airportSelect.focus();
    });
    close.addEventListener("click",()=>{panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.focus();});
    panel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();close.click();}});

    // 게시판을 띄워 두면 몇 분마다 새로 받는다. 탭이 가려졌거나 캡처 중이면 쉰다.
    function tick(){
      if (destroyed || frozen || loading || mode!=="board" || !visible()) return;
      if (Date.now()>=nextRefresh) loadBoard({fitAfter:false});
    }
    const timer=setInterval(tick,5000);
    // 한/EN 을 바꾸면 이름·상태 글을 다시 그린다.
    const onLang=()=>{if(mode)render();};
    window.addEventListener("mni18nchange",onLang);

    fetch("/can-proxy-flight",{cache:"no-store",signal:capability.signal}).then(r=>r.ok ? r.text() : "").then(value=>{
      if (destroyed || value.trim()!=="yes") return;
      toggle.disabled=false;toggle.title=t("공항 운항 게시판을 지도에 노선으로 펼칩니다.");
    }).catch(()=>{});

    const controller={
      freeze(){frozen++;return ()=>{frozen=Math.max(0,frozen-1);};},
      captureNote(){
        if (!mode || !data) return "";
        return [t("항공 운항"),mode==="board" ? boardTitle() : data.flight,t("수신")+" "+new Date(data.fetchedAt).toLocaleString(),t("한국공항공사")].join(" · ");
      },
      destroy(){
        destroyed=true;cancel();capability.abort();clearInterval(timer);window.removeEventListener("mni18nchange",onLang);
        layer.clearLayers();map.removeLayer(layer);panel.remove();toggle.remove();pane.remove();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns=[];
    doc.cleanupFns.push(()=>controller.destroy());
    return controller;
  }
  return {mount};
})();
