"use strict";
/* 한국공항공사 '실시간 항공기 운항정보 조회'(flight-status/info)·'검색'(flight-search/info) 응답 해석.
   비행기의 실시간 위치가 아니라 공항 운항 게시판(예정·변경 시각, 상태, 게이트)이다. 좌표는 오지 않아
   공항 코드(IATA)를 아래 표로 바꿔 지도에 올린다.
   응답: {response:{header:{resultCode}, body:{items:{item:[…]}, totalCount, pageNo, numOfRows}}}.
   2026-09-19 실측 함정:
   - 한 쪽은 100줄이 한계다. numOfRows 를 100 넘게 주면 HTTP 200 에 {"OpenAPI_ServiceResponse":{…"04"}} 가 온다
     → 제주 도착(232편)처럼 큰 게시판은 여러 쪽으로 나눠 묻는다.
   - 아직 움직이지 않은 편은 상태(rmkKor)가 빈 칸이다(전국 1711편 중 816편). 영문 상태엔 꼬리 공백이 붙는다.
   - etd(변경시각)는 비어(null) 올 수 있고, 자정을 넘기면 std 2350 · etd 0005 처럼 거꾸로 보인다.
   - 인천(ICN)은 한국공항공사 관할이 아니지만 국내선은 이 API 에 나온다. */
const MNFlightApi = (() => {
  const text = v => String(v == null ? "" : v).trim().slice(0,120);
  // 공항 좌표는 활주로 가운데쯤(소수 넷째 자리). 선은 두 공항을 곧게(대권으로) 잇는 그림일 뿐이라 이 정도면 된다.
  // domestic=true 는 게시판을 고를 수 있는 공항이다(한국공항공사 14곳 + 인천 국내선).
  const AIRPORTS = {
    GMP:{ko:"김포",en:"Gimpo",at:[37.5583,126.7906],domestic:true},
    PUS:{ko:"김해",en:"Gimhae",at:[35.1795,128.9382],domestic:true},
    CJU:{ko:"제주",en:"Jeju",at:[33.5113,126.4930],domestic:true},
    TAE:{ko:"대구",en:"Daegu",at:[35.8941,128.6589],domestic:true},
    CJJ:{ko:"청주",en:"Cheongju",at:[36.7166,127.4991],domestic:true},
    KWJ:{ko:"광주",en:"Gwangju",at:[35.1264,126.8089],domestic:true},
    MWX:{ko:"무안",en:"Muan",at:[34.9914,126.3828],domestic:true},
    RSU:{ko:"여수",en:"Yeosu",at:[34.8424,127.6170],domestic:true},
    USN:{ko:"울산",en:"Ulsan",at:[35.5935,129.3518],domestic:true},
    HIN:{ko:"사천",en:"Sacheon",at:[35.0886,128.0704],domestic:true},
    KPO:{ko:"포항경주",en:"Pohang Gyeongju",at:[35.9879,129.4204],domestic:true},
    YNY:{ko:"양양",en:"Yangyang",at:[38.0613,128.6692],domestic:true},
    WJU:{ko:"원주",en:"Wonju",at:[37.4381,127.9604],domestic:true},
    KUV:{ko:"군산",en:"Gunsan",at:[35.9038,126.6158],domestic:true},
    ICN:{ko:"인천",en:"Incheon",at:[37.4602,126.4407],domestic:true},
    // 국제선 상대 공항. 2026-09-19 전국 게시판에 나온 49곳과, 지방 공항에서 자주 뜨는 곳 몇을 더 넣었다.
    // 표에 없는 공항은 목록에만 보이고 선은 긋지 않는다.
    NRT:{ko:"도쿄/나리타",en:"Tokyo Narita",at:[35.7720,140.3929]},
    HND:{ko:"도쿄/하네다",en:"Tokyo Haneda",at:[35.5494,139.7798]},
    KIX:{ko:"오사카/간사이",en:"Osaka Kansai",at:[34.4347,135.2440]},
    UKB:{ko:"고베",en:"Kobe",at:[34.6328,135.2239]},
    NGO:{ko:"나고야",en:"Nagoya Chubu",at:[34.8584,136.8054]},
    FUK:{ko:"후쿠오카",en:"Fukuoka",at:[33.5859,130.4507]},
    KKJ:{ko:"기타큐슈",en:"Kitakyushu",at:[33.8459,131.0350]},
    KMJ:{ko:"구마모토",en:"Kumamoto",at:[32.8373,130.8551]},
    NGS:{ko:"나가사키",en:"Nagasaki",at:[32.9169,129.9136]},
    HSG:{ko:"사가",en:"Saga",at:[33.1497,130.3022]},
    OIT:{ko:"오이타",en:"Oita",at:[33.4794,131.7372]},
    KOJ:{ko:"가고시마",en:"Kagoshima",at:[31.8034,130.7195]},
    OKA:{ko:"오키나와",en:"Okinawa",at:[26.1958,127.6459]},
    MYJ:{ko:"마쓰야마",en:"Matsuyama",at:[33.8272,132.6997]},
    HIJ:{ko:"히로시마",en:"Hiroshima",at:[34.4361,132.9194]},
    TAK:{ko:"다카마쓰",en:"Takamatsu",at:[34.2142,134.0156]},
    OKJ:{ko:"오카야마",en:"Okayama",at:[34.7569,133.8553]},
    YGJ:{ko:"요나고",en:"Yonago",at:[35.4922,133.2364]},
    KMQ:{ko:"고마쓰",en:"Komatsu",at:[36.3946,136.4065]},
    FSZ:{ko:"시즈오카",en:"Shizuoka",at:[34.7960,138.1894]},
    IBR:{ko:"이바라키",en:"Ibaraki",at:[36.1811,140.4147]},
    SDJ:{ko:"센다이",en:"Sendai",at:[38.1397,140.9170]},
    HNA:{ko:"하나마키",en:"Hanamaki",at:[39.4286,141.1353]},
    CTS:{ko:"삿포로",en:"Sapporo",at:[42.7752,141.6923]},
    PEK:{ko:"베이징/서우두",en:"Beijing Capital",at:[40.0799,116.6031]},
    PKX:{ko:"베이징/다싱",en:"Beijing Daxing",at:[39.5098,116.4105]},
    PVG:{ko:"상하이/푸둥",en:"Shanghai Pudong",at:[31.1443,121.8083]},
    SHA:{ko:"상하이/훙차오",en:"Shanghai Hongqiao",at:[31.1979,121.3363]},
    TAO:{ko:"칭다오",en:"Qingdao",at:[36.3620,120.0880]},
    YNT:{ko:"옌타이",en:"Yantai",at:[37.6572,120.9870]},
    WEH:{ko:"웨이하이",en:"Weihai",at:[37.1871,122.2290]},
    TNA:{ko:"지난",en:"Jinan",at:[36.8572,117.2159]},
    DLC:{ko:"다롄",en:"Dalian",at:[38.9657,121.5386]},
    SHE:{ko:"선양",en:"Shenyang",at:[41.6398,123.4834]},
    CGQ:{ko:"창춘",en:"Changchun",at:[43.9962,125.6850]},
    HRB:{ko:"하얼빈",en:"Harbin",at:[45.6234,126.2503]},
    YNJ:{ko:"옌지",en:"Yanji",at:[42.8828,129.4513]},
    SJW:{ko:"스자좡",en:"Shijiazhuang",at:[38.2807,114.6973]},
    NKG:{ko:"난징",en:"Nanjing",at:[31.7420,118.8620]},
    WUX:{ko:"우시",en:"Wuxi",at:[31.4944,120.4290]},
    HGH:{ko:"항저우",en:"Hangzhou",at:[30.2295,120.4344]},
    NGB:{ko:"닝보",en:"Ningbo",at:[29.8267,121.4619]},
    XIY:{ko:"시안",en:"Xi'an",at:[34.4471,108.7516]},
    DYG:{ko:"장자제",en:"Zhangjiajie",at:[29.1028,110.4430]},
    CTU:{ko:"청두",en:"Chengdu Tianfu",at:[30.3125,104.4442]},
    KMG:{ko:"쿤밍",en:"Kunming",at:[25.1019,102.9292]},
    CAN:{ko:"광저우",en:"Guangzhou",at:[23.3924,113.2988]},
    SZX:{ko:"선전",en:"Shenzhen",at:[22.6393,113.8107]},
    SYX:{ko:"싼야",en:"Sanya",at:[18.3029,109.4122]},
    HKG:{ko:"홍콩",en:"Hong Kong",at:[22.3080,113.9185]},
    MFM:{ko:"마카오",en:"Macau",at:[22.1496,113.5919]},
    TPE:{ko:"타이베이/타오위안",en:"Taipei Taoyuan",at:[25.0797,121.2342]},
    TSA:{ko:"타이베이/쑹산",en:"Taipei Songshan",at:[25.0694,121.5525]},
    RMQ:{ko:"타이중",en:"Taichung",at:[24.2647,120.6207]},
    KHH:{ko:"가오슝",en:"Kaohsiung",at:[22.5771,120.3500]},
    ULN:{ko:"울란바토르(옛 공항)",en:"Ulaanbaatar (old)",at:[47.8431,106.7666]},
    UBN:{ko:"울란바토르",en:"Ulaanbaatar",at:[47.6468,106.8198]},
    VVO:{ko:"블라디보스토크",en:"Vladivostok",at:[43.3990,132.1480]},
    ALA:{ko:"알마티",en:"Almaty",at:[43.3521,77.0405]},
    MNL:{ko:"마닐라",en:"Manila",at:[14.5086,121.0194]},
    CRK:{ko:"클라크",en:"Clark",at:[15.1860,120.5603]},
    CEB:{ko:"세부",en:"Cebu",at:[10.3075,123.9794]},
    TAG:{ko:"보홀",en:"Bohol-Panglao",at:[9.5664,123.7752]},
    HAN:{ko:"하노이",en:"Hanoi",at:[21.2212,105.8072]},
    DAD:{ko:"다낭",en:"Da Nang",at:[16.0439,108.1992]},
    CXR:{ko:"나트랑",en:"Nha Trang",at:[11.9982,109.2194]},
    SGN:{ko:"호찌민",en:"Ho Chi Minh City",at:[10.8188,106.6520]},
    PQC:{ko:"푸꾸옥",en:"Phu Quoc",at:[10.1698,103.9931]},
    BKK:{ko:"방콕",en:"Bangkok",at:[13.6900,100.7501]},
    HKT:{ko:"푸껫",en:"Phuket",at:[8.1132,98.3169]},
    KUL:{ko:"쿠알라룸푸르",en:"Kuala Lumpur",at:[2.7456,101.7099]},
    BKI:{ko:"코타키나발루",en:"Kota Kinabalu",at:[5.9372,116.0510]},
    SIN:{ko:"싱가포르",en:"Singapore",at:[1.3644,103.9915]},
    CGK:{ko:"자카르타",en:"Jakarta",at:[-6.1256,106.6559]},
    DPS:{ko:"발리",en:"Bali Denpasar",at:[-8.7482,115.1672]},
    GUM:{ko:"괌",en:"Guam",at:[13.4834,144.7960]},
    SPN:{ko:"사이판",en:"Saipan",at:[15.1190,145.7290]}
  };
  // 게시판을 고를 수 있는 공항(고르개 차례). 붐비는 곳을 앞에 둔다.
  const BOARD_AIRPORTS = ["GMP","CJU","PUS","CJJ","TAE","KWJ","RSU","USN","HIN","KPO","YNY","WJU","KUV","MWX","ICN"];
  const validAirport = v => /^[A-Z]{3}$/.test(text(v));
  // 편명: 항공사 두 글자(숫자가 섞인 7C·5J 등) + 번호. 'ZE781A' 처럼 끝에 글자가 붙는 편도 있다.
  const normalizeFlight = v => text(v).toUpperCase().replace(/\s+/g,"");
  const validFlight = v => /^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$/.test(normalizeFlight(v));
  function airport(code){ return AIRPORTS[text(code).toUpperCase()] || null; }
  function airportName(code,english=false,fallback=""){
    const found=airport(code);
    return found ? (english ? found.en : found.ko) : (fallback || text(code));
  }

  /* 상태 글을 몇 갈래로 묶는다. 지도 선 색과 '끝난 편 숨기기'가 이 갈래를 본다.
     실측에 나온 글: 출발·도착·수속중·탑승장 입장·탑승중·탑승최종·마감예정·탑승구 변경·지연·사전결항·빈 칸. */
  function statusKind(label){
    const value=text(label);
    if (!value) return "scheduled";
    if (/결항|취소/.test(value)) return "cancelled";
    if (/회항|우회/.test(value)) return "diverted";
    if (/지연/.test(value)) return "delayed";
    if (/도착|착륙/.test(value)) return "arrived";
    if (/출발|이륙/.test(value)) return "departed";
    if (/탑승|마감|게이트|탑승구/.test(value)) return "boarding";
    if (/수속/.test(value)) return "checkin";
    return "other";
  }
  // 끝난 편 = 이미 떠났거나 내린 편. 결항·지연은 끝난 것으로 치지 않는다(보여야 할 소식이다).
  const finished = kind => kind==="departed" || kind==="arrived";
  const hhmm = v => /^[0-9]{4}$/.test(text(v)) ? text(v) : "";
  const timeText = v => { const value=hhmm(v); return value ? value.slice(0,2)+":"+value.slice(2) : ""; };
  const minutesOf = v => { const value=hhmm(v); return value ? Number(value.slice(0,2))*60+Number(value.slice(2)) : null; };
  // 예정→변경 차이(분). 자정을 넘긴 편(2350→0005)은 +15 로 본다. 12시간 넘게 차이 나면 이르게 뜬 것으로 읽는다.
  function delayMinutes(std,etd){
    const a=minutesOf(std), b=minutesOf(etd);
    if (a==null || b==null) return null;
    const diff=((b-a)%1440+1440)%1440;
    return diff>720 ? diff-1440 : diff;
  }

  // 봉투 해석. 정상(00)만 받고, 게이트웨이 오류(OpenAPI_ServiceResponse)나 모양이 다른 본문은 오류로 올린다.
  function rows(body){
    const response=body && typeof body==="object" ? body.response : null;
    const code=response && response.header ? text(response.header.resultCode) : "";
    if (code==="03") return {items:[],total:0};
    if (code!=="00" || !response.body || typeof response.body!=="object") throw new Error("flight-invalid-data");
    const total=Math.max(0,Math.floor(Number(response.body.totalCount) || 0));
    const items=response.body.items;
    if (items==null || items==="") return {items:[],total};
    if (typeof items!=="object") throw new Error("flight-invalid-data");
    const item=items.item;
    if (item==null) return {items:[],total};
    if (Array.isArray(item)) return {items:item,total};
    if (typeof item==="object") return {items:[item],total};
    throw new Error("flight-invalid-data");
  }
  /* 한 줄 = 한 공항에서 본 한 편. io O 는 이 공항(airport)에서 떠나 city 로 가는 편, I 는 city 에서 와서 내리는 편.
     그래서 같은 편을 편명으로 찾으면 출발 공항 줄·도착 공항 줄 두 줄이 온다. */
  function flight(r){
    if (!r || typeof r!=="object") return null;
    const base=text(r.airport).toUpperCase(), other=text(r.city).toUpperCase(), io=text(r.io).toUpperCase();
    const number=normalizeFlight(r.airFln);
    if (!validAirport(base) || !number || (io!=="O" && io!=="I")) return null;
    const out=io==="O", status=text(r.rmkKor), kind=statusKind(status);
    return {
      flight:number, airline:text(r.airlineKorean), airlineEn:text(r.airlineEnglish),
      io, line:/국제|^I$/.test(text(r.line)) ? "I" : "D", base, other:validAirport(other) ? other : "",
      from:out ? base : (validAirport(other) ? other : ""), to:out ? (validAirport(other) ? other : "") : base,
      fromName:text(r.boardingKor), toName:text(r.arrivedKor), fromNameEn:text(r.boardingEng), toNameEn:text(r.arrivedEng),
      std:hhmm(r.std), etd:hhmm(r.etd), gate:text(r.gate), status, statusEn:text(r.rmkEng), kind,
      delay:delayMinutes(r.std,r.etd)
    };
  }
  function flights(body){
    const parsed=rows(body);
    return {items:parsed.items.map(flight).filter(Boolean),total:parsed.total};
  }
  // 게시판을 상대 공항별로 묶는다(선 하나 = 상대 공항 하나). 이름은 게시판이 준 한글 이름을 먼저 쓴다.
  function destinations(items){
    const groups=new Map();
    for (const item of items){
      const code=item.other || "?";
      if (!groups.has(code)) groups.set(code,{code:item.other,name:item.io==="O" ? item.toName : item.fromName,
        nameEn:item.io==="O" ? item.toNameEn : item.fromNameEn,count:0,kinds:{}});
      const group=groups.get(code);
      group.count++;
      group.kinds[item.kind]=(group.kinds[item.kind] || 0)+1;
    }
    return [...groups.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,"ko"));
  }
  // 선 색을 정할 가장 급한 소식. 결항 > 회항 > 지연 > 그 밖.
  function worstKind(kinds){
    for (const kind of ["cancelled","diverted","delayed"]) if (kinds[kind]) return kind;
    return "normal";
  }

  /* 두 공항 사이 대권(大圈) 곡선. 김포–제주처럼 가까운 곳은 거의 직선이고, 괌·발리처럼 먼 곳만 조금 휜다.
     메르카토르 지도 위의 직선보다 실제 비행 경로 모양에 가깝다. */
  function greatCircle(a,b,steps=24){
    const rad=Math.PI/180, toVec=p=>[Math.cos(p[0]*rad)*Math.cos(p[1]*rad),Math.cos(p[0]*rad)*Math.sin(p[1]*rad),Math.sin(p[0]*rad)];
    const va=toVec(a), vb=toVec(b);
    const dot=Math.max(-1,Math.min(1,va[0]*vb[0]+va[1]*vb[1]+va[2]*vb[2])), omega=Math.acos(dot);
    if (!(omega>1e-6)) return [a,b];
    const points=[];
    for (let i=0;i<=steps;i++){
      const t=i/steps, s1=Math.sin((1-t)*omega)/Math.sin(omega), s2=Math.sin(t*omega)/Math.sin(omega);
      const v=[s1*va[0]+s2*vb[0],s1*va[1]+s2*vb[1],s1*va[2]+s2*vb[2]];
      points.push([Math.atan2(v[2],Math.hypot(v[0],v[1]))/rad,Math.atan2(v[1],v[0])/rad]);
    }
    return points;
  }

  // 런처 조회. 오류 까닭은 버스와 같은 이름(bus-key-required 등)으로 온다 — 같은 공공데이터포털 키·같은 조회 길을 쓴다.
  async function get(url,signal,refresh){
    const response=await fetch(url+(refresh?"&refresh=1":""),{signal,cache:"no-store"});
    if (!response.ok){
      let reason="";
      if (response.status===428 || response.status===429){try{reason=text(await response.text());}catch(_){}}
      const error=new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "flight-fetch-failed");
      error.retryAfterMs=Math.max(0,Number(response.headers.get("Retry-After")) || 0)*1000;
      throw error;
    }
    const stamp=Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return {body:await response.json(),fetchedAt:Number.isFinite(stamp) ? stamp : Date.now()};
  }
  const MAX_PAGES=6;          // 가장 큰 게시판(제주 국내선 도착)이 3쪽 남짓이다. 넉넉히 두되 끝없이 묻지 않는다.
  async function board({airport:code,io="O",line="D",signal,refresh=false}={}){
    if (!validAirport(code) || !["O","I"].includes(io) || !["D","I"].includes(line)) throw new Error("flight-bad-request");
    const items=[];let total=0,fetchedAt=0;
    for (let page=1;page<=MAX_PAGES;page++){
      const result=await get("/flight-board?airport="+code+"&io="+io+"&line="+line+"&page="+page,signal,refresh);
      const parsed=flights(result.body);
      items.push(...parsed.items);total=parsed.total;
      fetchedAt=fetchedAt ? Math.min(fetchedAt,result.fetchedAt) : result.fetchedAt;
      if (!parsed.items.length || items.length>=total) break;
    }
    // 같은 편이 쪽 경계에서 겹쳐 오면 한 번만 둔다.
    const seen=new Set();
    const unique=items.filter(item=>{const key=item.flight+"|"+item.io+"|"+item.std;if(seen.has(key))return false;seen.add(key);return true;});
    unique.sort((a,b)=>(minutesOf(a.std) ?? 9999)-(minutesOf(b.std) ?? 9999) || a.flight.localeCompare(b.flight));
    return {items:unique,total:Math.max(total,unique.length),fetchedAt,truncated:unique.length<total};
  }
  async function search(number,{signal,refresh=false}={}){
    if (!validFlight(number)) throw new Error("flight-bad-request");
    const result=await get("/flight-search?fln="+encodeURIComponent(normalizeFlight(number)),signal,refresh);
    const parsed=flights(result.body);
    parsed.items.sort((a,b)=>(a.io===b.io ? 0 : a.io==="O" ? -1 : 1) || (minutesOf(a.std) ?? 9999)-(minutesOf(b.std) ?? 9999));
    return {items:parsed.items,fetchedAt:result.fetchedAt};
  }
  return {AIRPORTS,BOARD_AIRPORTS,airport,airportName,validAirport,validFlight,normalizeFlight,statusKind,finished,
    timeText,delayMinutes,rows,flight,flights,destinations,worstKind,greatCircle,board,search};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNFlightApi;
