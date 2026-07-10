"use strict";

/* ===== 픽셀 펫(돌아다니는 캐릭터들) =====
   옵션에서 켤 때만 동작한다(기본 꺼짐·1마리). 픽셀 캐릭터가 화면을 자유롭게 돌아다닌다.
   - 화면 바닥을 걷고, 좌우 가장자리를 타고 올라가 천장에 매달려 걷다가 뛰어내린다.
   - 실제 UI 요소(탭 바·모달 카드·메모 패널 등) 위에도 착지해 그 위를 걸어다닌다.
   - 마우스로 붙잡아 던질 수 있고(중력 낙하 후 착지), 짧게 누르면 폴짝 뛰며 한마디 한다.
   - 여러 마리(최대 6)를 켤 수 있고, 종족·색·걸음 속도가 저마다 조금씩 다르다.
   종족마다 이동 방식(kind)이 다르다:
     climber(게·병아리)=걷기+벽타기+천장 / walker(로봇)=걷다가 가끔 방전·재부팅
     hopper(연필)=콩콩 뛰며 낙서 흔적 / bouncer(슬라임)=통통 튀고 착지 때 찌부
     roller(별)=데굴데굴 구르며 반짝 / ghost(유령)=중력 무시 부유+가끔 반투명
     ufo(UFO)=날아다니다 다른 펫을 광선으로 납치 시도(시늉만 하고 실패한다)
   몇 마리든 rAF 루프는 하나만 돌고 발판 스캔도 공유하므로 성능 부담이 거의 없다.
   그리기는 마리당 45×33px 작은 캔버스 하나뿐이고, 몸통에만 포인터가 잡혀 UI 클릭을 막지 않는다. */

// ----- 스프라이트(15×11 격자, 코드로 그림 — 이미지 파일 불필요) -----
// 격자 기호: 대문자=팔레트 색 · W=눈흰자 K=눈동자(깜빡임 처리) · .=투명
const PET_ART = {
  crab: [
    "..DD.......DD..",
    "D..D.....D..D..",
    "..BB.......BB..",
    "..BBBBBBBBBBBB.",
    ".BBBBBBBBBBBBBB",
    "BLBWKBBBBWKBLB.",
    "BBBWKBBBBWKBBB.",
    "BBBBBBBBBBBBBBB",
    "DBBBBBBBBBBBBBD",
    ".DDBBBBBBBBDD..",
    "D.D.D.DD.D.D.D."
  ],
  chick: [
    "......BBBB.....",
    ".....BBBBBB....",
    ".....BWKBBB....",
    ".....BBBBBBOO..",
    "....BBBBBBBB...",
    "...BBBBBBBBBB..",
    "...BLBBBBBBLB..",
    "...BBBBBBBBBB..",
    "....BBBBBBBB...",
    ".....B....B....",
    "....OO....OO..."
  ],
  robot: [
    "....GGGGGGG....",
    "....GDDDDDG....",
    "....GWKDWKG....",
    "....GGGGGGG....",
    ".....GGGGG.....",
    "..A.GGGGGGG.A..",
    "..A.GLLLLLG.A..",
    "..A.GLGGGLG.A..",
    "....GGGGGGG....",
    "....GG...GG....",
    "...GGG...GGG..."
  ],
  ghost: [
    ".....PPPPP.....",
    "....PPPPPPP....",
    "...PPPPPPPPP...",
    "...PWKPPPWKP...",
    "...PPPPPPPPP...",
    "...PPPDDDPPP...",
    "...PPPPPPPPP...",
    "...PPPPPPPPP...",
    "...PPPPPPPPP...",
    "...PP.PPP.PP...",
    "...P...P...P..."
  ],
  slime: [
    "...............",
    "...............",
    "......GGG......",
    "....GGGGGGG....",
    "...GGGGGGGGG...",
    "..GGWKGGGWKGG..",
    "..GGGGGGGGGGG..",
    ".GGGGGDDGGGGG..",
    ".GGGGGGGGGGGG..",
    ".GGGGGGGGGGGG..",
    "..GGGGGGGGGG..."
  ],
  ufo: [
    ".....DDDDD.....",
    "....DGGGGGD....",
    "....DGWKGGD....",
    ".....DGGGD.....",
    "..MMMMMMMMMMM..",
    ".MMLMMLMMLMML..",
    "..MMMMMMMMMMM..",
    "....M.....M....",
    "...M.......M...",
    "...............",
    "..............."
  ],
  pencil: [
    ".......PP......",
    "......PPPP.....",
    "......PPPP.....",
    "......YYYY.....",
    "......YYYY.....",
    "......YWKY.....",
    "......YYYY.....",
    "......YYYY.....",
    "......MMMM.....",
    ".......MM......",
    "........T......"
  ],
  star: [
    ".......Y.......",
    "......YYY......",
    "......YYY......",
    ".YYYYYYYYYYYYY.",
    "..YYYYYYYYYYY..",
    "...YYYYYYYYY...",
    "....YWKYWKY....",
    "....YYYYYYY....",
    "...YYYY.YYYY...",
    "..YYY.....YYY..",
    ".YY.........YY."
  ]
};
// 종족 목록: kind 가 이동 방식을 정한다. 같은 그림이라도 팔레트가 달라 저마다 다른 아이로 보인다.
const PET_SPECIES = [
  { kind:"climber", art:PET_ART.crab, palettes: [
      { B:"#d8622f", D:"#a8481f", L:"#e88a52" },                 // 주황 게(원조)
      { B:"#3f7fd6", D:"#2c5ba3", L:"#6da3e8" },                 // 파랑 게
      { B:"#3fae6a", D:"#2a7d4a", L:"#6ecb92" },                 // 초록 게
      { B:"#d65a9e", D:"#a33c75", L:"#e88cc0" }                  // 분홍 게
    ],
    sayings: ["폴짝!", "안녕하세요!", "열공 중이시군요", "옆차기~", "집게발 조심", "쉬엄쉬엄 하세요", "꾹 눌렀네요?", "히힛"] },
  { kind:"climber", art:PET_ART.chick, palettes: [
      { B:"#f6c945", D:"#c99a1e", L:"#fadf7e", O:"#e8892c" },    // 노랑 병아리
      { B:"#f2f2ee", D:"#c9c9c2", L:"#ffffff", O:"#e8892c" }     // 하양 병아리
    ],
    sayings: ["삐약!", "삐약삐약", "모이 주세요", "폴짝!", "공부 화이팅!", "구구?", "히힛"] },
  { kind:"walker", art:PET_ART.robot, palettes: [
      { G:"#8a94a6", D:"#3f4756", L:"#5eead4", A:"#64748b" },    // 회색+민트 로봇
      { G:"#b08968", D:"#4a3728", L:"#fbbf24", A:"#8a6d52" }     // 구리색 로봇
    ],
    sayings: ["삐빅. 반갑습니다", "충전 필요...", "오류 없음!", "계산 완료", "인간 감지됨"] },
  { kind:"ghost", art:PET_ART.ghost, palettes: [
      { P:"#c4b5fd", D:"#7c6bd4" },                              // 보라 유령
      { P:"#a5d8e6", D:"#5aa3b8" }                               // 하늘 유령
    ],
    sayings: ["우우~", "놀랐죠?", "심심해요", "훅-", "여기 있어요"] },
  { kind:"bouncer", art:PET_ART.slime, palettes: [
      { G:"#6ee7a0", D:"#2a9d5c" },                              // 초록 슬라임
      { G:"#7cc4f2", D:"#3479b5" }                               // 파랑 슬라임
    ],
    sayings: ["말랑말랑", "통통!", "찌부...", "탱글", "슬라임은 무죄"] },
  { kind:"ufo", art:PET_ART.ufo, palettes: [
      { M:"#94a3b8", L:"#fde047", D:"#64748b", G:"#a7f3d0" }     // 은색 UFO
    ],
    sayings: ["삐용삐용", "지구 조사 중", "안녕, 지구인", "연료가 부족하다"] },
  { kind:"hopper", art:PET_ART.pencil, palettes: [
      { P:"#f9a8d4", Y:"#fbbf24", M:"#d6a05c", T:"#161616" }     // 노랑 연필(T=심)
    ],
    sayings: ["사각사각", "글씨 연습!", "낙서는 즐거워", "필기 화이팅", "콩콩"] },
  { kind:"roller", art:PET_ART.star, palettes: [
      { Y:"#fcd34d" }                                            // 금색 별
    ],
    sayings: ["반짝!", "데굴데굴", "별일 없죠?", "빛나는 중", "어지러워~"] }
];
const PET_SCALE = 3, PET_GW = 15, PET_GH = 11;
const PET_W = PET_GW * PET_SCALE, PET_H = PET_GH * PET_SCALE;   // 45×33
const PET_GRAV = 0.5, PET_WALK = 1.05, PET_CLIMB = 1.0, PET_MAX = 6;
const PET_GROUND_STATES = ["walk", "idle", "seekwall", "reboot", "hopwait"];

// 펫이 올라설 수 있는 UI 요소(윗변이 발판이 된다). 보이는 것만 골라 쓴다.
const PET_PLATFORM_SELECTORS = [
  "#tabBar", ".modal-card", ".scratchpad", ".image-memo",
  ".sb-search", ".sb-actions", ".pen-bar", ".pdf-pages-panel", ".fs-controls"
];

let petWorld = null;      // 켜져 있을 때만 { pets:[…], platforms, raf, … } 가 존재한다
let petTraceCount = 0;    // 연필 낙서 흔적 개수 상한용

// ----- 발판 수집: 화면 바닥 + 보이는 UI 요소들의 윗변(모든 펫이 공유) -----
function petCollectPlatforms(){
  const vw = window.innerWidth, vh = window.innerHeight;
  const list = [{ x:0, y:vh, w:vw, floor:true }];
  for (const sel of PET_PLATFORM_SELECTORS){
    document.querySelectorAll(sel).forEach(el => {
      if (el.closest("[hidden]")) return;
      const r = el.getBoundingClientRect();
      // 펫보다 좁거나, 너무 높아 서면 화면 밖으로 나가는 요소는 제외
      if (r.width < PET_W + 12 || r.top < PET_H + 14 || r.top > vh - 6) return;
      list.push({ x:r.left, y:r.top, w:r.width, floor:false });
    });
  }
  return list;
}

// 현재 발밑을 받치는 발판 찾기(발 y와 발판 윗변이 6px 이내·가로 중심이 범위 안)
function petFindSupport(p, platforms){
  const cx = p.x + PET_W / 2, feet = p.y + PET_H;
  let best = null;
  for (const pl of platforms){
    if (cx < pl.x - 2 || cx > pl.x + pl.w + 2) continue;
    if (Math.abs(pl.y - feet) > 6) continue;
    if (!best || Math.abs(pl.y - feet) < Math.abs(best.y - feet)) best = pl;
  }
  return best;
}

// 연필이 착지한 자리에 잠깐 남는 낙서 흔적
function petTrace(x, y){
  if (petTraceCount > 30) return;
  petTraceCount++;
  const d = document.createElement("div");
  d.className = "pixel-pet-trace";
  d.style.left = Math.round(x) + "px";
  d.style.top = Math.round(y) + "px";
  document.body.appendChild(d);
  setTimeout(() => { d.remove(); petTraceCount--; }, 1400);
}

// ----- 그리기: 작은 캔버스에 스프라이트만 다시 그린다 -----
function petDraw(p){
  const ctx = p.ctx;
  ctx.clearRect(0, 0, PET_W, PET_H);
  const moving = ["walk", "seekwall", "climb", "ceiling", "float"].includes(p.state);
  const wob = moving ? Math.round(Math.sin(p.t * 0.5) * 1.5) : 0;
  const eyesOff = p.blink > 0 || p.off;
  for (let r = 0; r < p.art.length; r++){
    const row = p.art[r];
    for (let c = 0; c < row.length; c++){
      const ch = row[c];
      if (ch === ".") continue;
      let col = ch === "W" ? "#ffffff" : ch === "K" ? "#161616" : p.palette[ch];
      if (!col) continue;
      if (ch === "W" && eyesOff) col = p.off ? (p.palette.D || p.blinkCol) : p.blinkCol;   // 깜빡임·방전
      if (ch === "K" && eyesOff) continue;
      const dx = (r >= 9) ? wob * ((c % 2) ? 1 : -1) : 0;     // 다리·자락만 꼼지락
      ctx.fillStyle = col;
      ctx.fillRect(c * PET_SCALE + dx, r * PET_SCALE, PET_SCALE, PET_SCALE);
    }
  }
  // 별은 가끔 반짝이 픽셀이 튄다
  if (p.kind === "roller" && Math.random() < 0.1){
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 2; i++)
      ctx.fillRect((3 + Math.floor(Math.random() * 9)) * PET_SCALE, (3 + Math.floor(Math.random() * 6)) * PET_SCALE, PET_SCALE, PET_SCALE);
  }
  // 위치·방향은 CSS transform 으로(리플로 없이 GPU 합성만 일어난다)
  const rot = p.kind === "roller" ? p.roll
    : p.state === "climb" ? (p.side < 0 ? -90 : 90) : (p.rot || 0);
  const flipY = p.state === "ceiling" ? -1 : 1;
  const sq = p.squash > 0 ? p.squash : 0;                     // 슬라임 찌부
  const pop = p.pop > 0 ? p.pop / 12 : 0;                     // 클릭했을 때 뽀잉
  const sx = p.face * (1 + 0.30 * sq + 0.12 * pop);
  const sy = flipY * (1 - 0.35 * sq + 0.12 * pop);
  p.el.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px)";
  p.cv.style.transform = "rotate(" + rot + "deg) scale(" + sx + "," + sy + ")";
}

// ----- 다음 행동 고르기(바닥·발판 위에서, 종족별로 레퍼토리가 다르다) -----
function petPickAction(p){
  const roll = Math.random();
  p.t = 0;
  if (p.kind === "climber"){
    if (roll < 0.44){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 150; }
    else if (roll < 0.66){ p.state = "idle"; p.timer = 50 + Math.random() * 110; }
    else if (roll < 0.86){ p.state = "jump"; p.vy = -(6 + Math.random() * 4); p.vx = p.face * (1.2 + Math.random() * 1.8); }
    else { // 가까운 쪽 벽으로 걸어가 타고 오르기(바닥에서만)
      if (p.support && p.support.floor){ p.state = "seekwall"; p.side = (p.x < window.innerWidth / 2) ? -1 : 1; p.face = p.side; }
      else { p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 80; }
    }
  }
  else if (p.kind === "walker"){   // 로봇: 벽은 못 타고, 가끔 방전돼 멈췄다 재부팅한다
    if (roll < 0.46){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 150; }
    else if (roll < 0.76){ p.state = "idle"; p.timer = 50 + Math.random() * 110; }
    else if (roll < 0.9){ p.state = "jump"; p.vy = -(4 + Math.random() * 3); p.vx = p.face * (1 + Math.random()); }
    else { p.state = "reboot"; p.timer = 110 + Math.random() * 70; p.off = true; }
  }
  else if (p.kind === "roller"){   // 별: 걷기가 곧 구르기
    if (roll < 0.5){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 150; }
    else if (roll < 0.75){ p.state = "idle"; p.timer = 40 + Math.random() * 90; }
    else { p.state = "jump"; p.vy = -(5 + Math.random() * 4); p.vx = p.face * (1.5 + Math.random() * 1.5); }
  }
  else {                           // hopper(연필)·bouncer(슬라임): 걷지 않고 콩콩 뛰어다닌다
    p.state = "hopwait"; p.timer = 8 + Math.random() * 40;
    if (Math.random() < 0.3) p.face *= -1;
  }
}

function petSay(p, text){
  p.bubble.textContent = text;
  p.bubble.classList.add("show");
  clearTimeout(p.bubbleTimer);
  p.bubbleTimer = setTimeout(() => p.bubble.classList.remove("show"), 1600);
}

// ----- 유령: 중력을 무시하고 목표 지점을 향해 스르륵 떠다닌다. 가끔 반투명해진다 -----
function petGhostUpdate(p){
  const vw = window.innerWidth, vh = window.innerHeight;
  p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94;       // 던져진 관성은 서서히 줄어든다
  const t = p.gTarget;
  if (!t || Math.hypot(t.x - p.x, t.y - p.y) < 20 || Math.random() < 0.003)
    p.gTarget = { x: Math.random() * Math.max(1, vw - PET_W), y: Math.random() * Math.max(60, vh * 0.75) };
  const dx = p.gTarget.x - p.x, dy = p.gTarget.y - p.y, d = Math.hypot(dx, dy) || 1;
  const sp = 0.55 * p.speed;
  p.x += dx / d * sp;
  p.y += dy / d * sp + Math.sin(p.t * 0.05) * 0.4;
  if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
  p.rot = Math.sin(p.t * 0.04) * 5;
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
  if (p.fadeT > 0) p.fadeT--;
  else if (Math.random() < 0.0025) p.fadeT = 110;             // 가끔 반투명하게 숨는 시늉
  p.el.style.opacity = p.fadeT > 0 ? "0.4" : "0.92";
}

// ----- UFO: 날아다니다 걷고 있는 펫 위로 가서 광선으로 납치를 시도한다(끌어올리다 실패) -----
function petUfoAbort(p){
  p.beam.style.display = "none"; p.beam.style.height = "0px";
  if (p.victim && p.victim.state === "abduct"){ p.victim.state = "fall"; p.victim.vy = 0; p.victim.t = 0; }
  p.victim = null; p.state = "cruise";
}
function petUfoUpdate(p, pets){
  const vw = window.innerWidth, vh = window.innerHeight;
  p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94;
  const bob = Math.sin(p.t * 0.08) * 0.5;
  if (p.state === "beam"){
    const v = p.victim;
    if (!v || v.state !== "abduct"){ petUfoAbort(p); }         // 붙잡혀 가는 애를 사용자가 빼냈다 등
    else {
      p.x += (v.x - p.x) * 0.08;                               // 피해자 위를 따라간다
      p.beam.style.height = Math.max(0, Math.min(260, v.y - (p.y + PET_H) + 8)) + "px";
      if (--p.timer <= 0){ petUfoAbort(p); petSay(p, "납치 실패..."); }
    }
  }
  else if (p.state === "hunt"){
    const v = p.victim;
    if (!v || !PET_GROUND_STATES.includes(v.state)){ p.victim = null; p.state = "cruise"; }
    else {
      const tx = v.x, ty = Math.max(10, v.y - 95);
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1, sp = 1.4 * p.speed;
      p.x += dx / d * Math.min(sp, d); p.y += dy / d * Math.min(sp, d) + bob;
      if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
      if (d < 8){                                              // 목표 위 도착: 광선 발사, 피해자를 끌어올린다
        p.state = "beam"; p.timer = 110;
        p.beam.style.display = "block";
        v.state = "abduct"; v.vy = 0; v.rot = 0; v.t = 0;
      }
    }
  }
  else { // cruise: 화면 위쪽을 유유히 날아다닌다
    const t = p.gTarget;
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) < 16 || Math.random() < 0.004)
      p.gTarget = { x: Math.random() * Math.max(1, vw - PET_W), y: 20 + Math.random() * Math.max(40, vh * 0.45) };
    const dx = p.gTarget.x - p.x, dy = p.gTarget.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 1.1 * p.speed;
    p.x += dx / d * sp; p.y += dy / d * sp + bob;
    if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
    if (Math.random() < 0.0035){                               // 사냥감 물색
      const targets = pets.filter(o => o !== p && o.grav && PET_GROUND_STATES.includes(o.state));
      if (targets.length){ p.victim = targets[Math.floor(Math.random() * targets.length)]; p.state = "hunt"; }
    }
  }
  p.rot = Math.max(-10, Math.min(10, (p.gTarget ? (p.gTarget.x - p.x) : 0) * 0.02));
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
}

// ----- 물리·상태 기계: 펫 한 마리의 한 프레임 -----
function petUpdate(p, platforms, pets){
  p.t++;
  if (p.blink > 0) p.blink--;
  else if (!p.off && Math.random() < 0.008) p.blink = 8;
  if (p.squash > 0) p.squash = Math.max(0, p.squash - 0.06);
  if (p.pop > 0) p.pop--;
  if (p.state === "drag") return;                              // 좌표는 포인터 핸들러가 움직인다
  if (p.kind === "ghost") return petGhostUpdate(p);
  if (p.kind === "ufo") return petUfoUpdate(p, pets);

  const vw = window.innerWidth, vh = window.innerHeight;
  const walk = PET_WALK * p.speed, climb = PET_CLIMB * p.speed;
  if (PET_GROUND_STATES.includes(p.state)){
    // 서 있던 발판이 사라지면(모달 닫힘 등) 떨어진다. 살짝 움직였으면 발 위치를 따라간다.
    const s = petFindSupport(p, platforms);
    if (!s){ p.state = "fall"; p.vy = 0; p.vx = 0; }
    else { p.support = s; p.y = s.y - PET_H; }
  }

  if (p.state === "walk" || p.state === "seekwall"){
    p.x += p.face * walk;
    if (p.kind === "roller") p.roll += p.face * 4 * p.speed;   // 별은 걸을수록 구른다
    if (p.state === "seekwall"){
      if ((p.side < 0 && p.x <= 0) || (p.side > 0 && p.x >= vw - PET_W)){
        p.x = p.side < 0 ? 0 : vw - PET_W;
        p.state = "climb"; p.t = 0;
      }
    } else {
      // 발판 가장자리: 바닥이면 되돌아오고, UI 발판이면 절반 확률로 뛰어내린다
      const s = p.support;
      if (s && (p.x + PET_W / 2 < s.x + 4 || p.x + PET_W / 2 > s.x + s.w - 4)){
        if (!s.floor && Math.random() < 0.5){ p.state = "fall"; p.vy = 0; p.vx = p.face * 1.2; }
        else p.face *= -1;
      }
      if (p.x <= 0){ p.x = 0; p.face = 1; }
      if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.face = -1; }
      if (--p.timer <= 0) petPickAction(p);
    }
  }
  else if (p.state === "idle"){
    if (--p.timer <= 0) petPickAction(p);
  }
  else if (p.state === "reboot"){                              // 로봇 방전: 눈이 꺼진 채 멈췄다가 다시 켜진다
    if (p.timer === 20){ p.off = false; p.blink = 0; }
    p.rot = p.timer < 20 ? Math.sin(p.t) * 6 : 0;
    if (--p.timer <= 0){ p.rot = 0; p.off = false; petPickAction(p); }
  }
  else if (p.state === "hopwait"){                             // 연필·슬라임: 잠깐 숨 고르고 다음 콩콩
    if (--p.timer <= 0){
      p.state = "jump"; p.t = 0;
      if (Math.random() < 0.15) p.face *= -1;
      p.vy = -(4 + Math.random() * 3.5);
      p.vx = p.face * (1.4 + Math.random() * 1.4);
    }
  }
  else if (p.state === "abduct"){                              // UFO 광선에 끌려 올라가는 중(버둥버둥)
    p.y -= 0.5;
    p.rot = Math.sin(p.t * 0.5) * 20;
  }
  else if (p.state === "climb"){
    p.y -= climb;
    p.x = p.side < 0 ? 0 : vw - PET_W;
    if (p.y <= 0){ p.y = 0; p.state = "ceiling"; p.face = -p.side; p.timer = 80 + Math.random() * 140; }
    else if (p.t > 40 && Math.random() < 0.004){ p.state = "fall"; p.vy = 0; p.vx = -p.side * 1.5; }   // 가끔 손을 놓친다
  }
  else if (p.state === "ceiling"){
    p.x += p.face * 0.9 * p.speed;
    if (p.x <= 0){ p.x = 0; p.face = 1; }
    if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.face = -1; }
    if (--p.timer <= 0){ p.state = "fall"; p.vy = 0; p.vx = 0; p.t = 0; }
  }
  else if (p.state === "jump" || p.state === "fall"){
    const prevFeet = p.y + PET_H;
    p.vy += PET_GRAV; p.x += p.vx; p.y += p.vy;
    if (p.x < 0){ p.x = 0; p.vx *= -0.6; p.face = 1; }
    if (p.x > vw - PET_W){ p.x = vw - PET_W; p.vx *= -0.6; p.face = -1; }
    if (p.kind === "roller") p.roll += p.vx * 3;
    else p.rot = p.state === "fall" ? Math.sin(p.t * 0.35) * 14 : 0;
    if (p.vy > 0){
      const cx = p.x + PET_W / 2, feet = p.y + PET_H;
      for (const pl of platforms){
        if (cx < pl.x || cx > pl.x + pl.w) continue;
        if (prevFeet <= pl.y + 1 && feet >= pl.y){             // 이번 프레임에 윗변을 통과 → 착지
          p.y = pl.y - PET_H; p.vy = 0; p.vx = 0; p.rot = 0;
          p.support = pl;
          if (p.kind === "hopper" || p.kind === "bouncer"){    // 콩콩이들은 바로 다음 점프를 준비
            p.state = "hopwait"; p.timer = 6 + Math.random() * 36;
            if (p.kind === "bouncer") p.squash = 1;            // 슬라임은 찌부
            else petTrace(p.x + PET_W / 2 - 5, pl.y - 4);      // 연필은 낙서 흔적
          } else {
            p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1;
            p.timer = 80 + Math.random() * 120;
          }
          break;
        }
      }
    }
    if (p.y > vh + 60){ p.y = -PET_H; p.vy = 0; }              // 안전망: 뚫고 떨어지면 위에서 재등장
  }
}

// ----- 공용 루프: 몇 마리든 rAF 하나로 돌린다 -----
function petWorldStep(w){
  if (--w.refresh <= 0){ w.platforms = petCollectPlatforms(); w.refresh = 30; }   // 발판은 0.5초마다 갱신
  for (const p of w.pets){ petUpdate(p, w.platforms, w.pets); petDraw(p); }
  w.raf = requestAnimationFrame(() => petWorldStep(w));
}

// ----- 붙잡기·던지기·짧은 클릭 -----
function petBindPointer(p){
  let dragging = false, moved = 0, last = null;
  p.el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true; moved = 0; last = { x:e.clientX, y:e.clientY };
    p.state = "drag"; p.rot = 0; p.vx = 0; p.vy = 0; p.blink = 0; p.off = false;
    p.el.setPointerCapture(e.pointerId);
    p.el.style.cursor = "grabbing";
  });
  p.el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    moved += Math.abs(dx) + Math.abs(dy);
    p.vx = dx; p.vy = dy;
    p.x = Math.max(0, Math.min(window.innerWidth - PET_W, p.x + dx));
    p.y = Math.max(0, Math.min(window.innerHeight - PET_H, p.y + dy));
    p.rot = Math.max(-25, Math.min(25, dx * 2));
    last = { x:e.clientX, y:e.clientY };
  });
  p.el.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    p.el.style.cursor = "grab";
    if (moved < 6){       // 거의 안 움직였으면 클릭: 한마디 + 반응
      petSay(p, p.sayings[Math.floor(Math.random() * p.sayings.length)]);
      if (p.grav){ p.state = "jump"; p.vy = -7; p.vx = 0; p.rot = 0; p.t = 0; }
      else { p.state = p.kind === "ghost" ? "float" : "cruise"; p.pop = 12; p.vx = 0; p.vy = 0; }
    } else {              // 던지기: 마지막 이동 속도로 날아간다(유령·UFO 는 관성 미끄러짐)
      p.vx = Math.max(-7, Math.min(7, p.vx));
      p.vy = Math.max(-9, Math.min(6, p.vy));
      if (p.grav){ p.state = "fall"; p.t = 0; }
      else { p.state = p.kind === "ghost" ? "float" : "cruise"; p.gTarget = null; }
    }
  });
}

// ----- 펫 한 마리 만들기(i=0 은 항상 원조 주황 게, 나머지는 겹치지 않게 종족을 섞는다) -----
function petSpawn(i, total, bag){
  const species = (i === 0) ? PET_SPECIES[0] : bag[(i - 1) % bag.length];
  const palette = (i === 0) ? species.palettes[0] : species.palettes[Math.floor(Math.random() * species.palettes.length)];
  const el = document.createElement("div");
  el.className = "pixel-pet";
  el.title = "붙잡아 던질 수 있어요";
  const cv = document.createElement("canvas");
  cv.width = PET_W; cv.height = PET_H;
  const bubble = document.createElement("div");
  bubble.className = "pixel-pet-bubble";
  el.appendChild(cv); el.appendChild(bubble);
  let beam = null;
  if (species.kind === "ufo"){                                 // 납치 광선(평소엔 숨김)
    beam = document.createElement("div");
    beam.className = "pixel-pet-beam";
    el.appendChild(beam);
  }
  document.body.appendChild(el);
  const grav = species.kind !== "ghost" && species.kind !== "ufo";
  const p = {
    el, cv, bubble, beam, ctx: cv.getContext("2d"),
    kind: species.kind, art: species.art, palette, sayings: species.sayings,
    blinkCol: palette.B || palette.Y || palette.G || palette.P || palette.M || "#999999",
    speed: 0.85 + Math.random() * 0.4, grav,
    // 중력 펫은 위에서 흩어져 떨어지며 등장, 유령·UFO 는 제자리에서 스르륵 시작
    x: Math.max(0, Math.min(window.innerWidth - PET_W, window.innerWidth * (0.2 + 0.6 * ((i + 1) / (total + 1))))),
    y: grav ? (-PET_H - i * 90) : (60 + Math.random() * Math.max(40, window.innerHeight * 0.3)),
    vx: 0, vy: 0, face: 1, side: -1, rot: 0, roll: 0, squash: 0, pop: 0,
    state: grav ? "fall" : (species.kind === "ghost" ? "float" : "cruise"),
    t: Math.floor(Math.random() * 100), timer: 60, blink: 0, off: false, fadeT: 0,
    support: null, gTarget: null, victim: null, bubbleTimer: 0
  };
  petBindPointer(p);
  return p;
}

// ----- 켜기/끄기 -----
function petStart(count){
  if (petWorld) return;
  const n = Math.max(1, Math.min(PET_MAX, count || 1));
  // 종족 가방: 원조 게를 뺀 나머지를 무작위로 섞어 겹치지 않게 하나씩 나눠 준다
  const bag = PET_SPECIES.slice(1).concat(PET_SPECIES[0]).sort(() => Math.random() - 0.5);
  const w = petWorld = { pets: [], platforms: petCollectPlatforms(), refresh: 30, raf: 0 };
  for (let i = 0; i < n; i++) w.pets.push(petSpawn(i, n, bag));
  w.onResize = () => {
    w.platforms = petCollectPlatforms();
    for (const p of w.pets) p.x = Math.min(p.x, Math.max(0, window.innerWidth - PET_W));
  };
  window.addEventListener("resize", w.onResize);
  // 탭이 숨겨지면 루프를 멈춰 배터리를 아낀다
  w.onVis = () => {
    if (document.hidden){ cancelAnimationFrame(w.raf); }
    else { w.raf = requestAnimationFrame(() => petWorldStep(w)); }
  };
  document.addEventListener("visibilitychange", w.onVis);
  w.raf = requestAnimationFrame(() => petWorldStep(w));
}
function petStop(){
  const w = petWorld;
  if (!w) return;
  cancelAnimationFrame(w.raf);
  window.removeEventListener("resize", w.onResize);
  document.removeEventListener("visibilitychange", w.onVis);
  for (const p of w.pets){ clearTimeout(p.bubbleTimer); p.el.remove(); }
  petWorld = null;
}

// 설정 저장/시작 시 호출 — appSettings.petEnabled·petCount 를 따라 켜고 끈다.
function applyPetSettings(){
  const on = typeof appSettings === "object" && !!appSettings.petEnabled;
  const count = Math.max(1, Math.min(PET_MAX, Number(appSettings && appSettings.petCount) || 1));
  if (!on){ petStop(); return; }
  if (petWorld && petWorld.pets.length === count) return;   // 이미 원하는 마릿수로 돌고 있으면 그대로
  petStop();
  petStart(count);
}
function initPet(){ applyPetSettings(); }
