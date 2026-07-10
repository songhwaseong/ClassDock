"use strict";

/* ===== 픽셀 펫(돌아다니는 캐릭터들) — 이동 엔진 =====
   캐릭터 데이터(스프라이트·팔레트·대사)는 pet-data.js 에 있다. 이 파일은 물리·상태 기계만 담당한다.
   옵션에서 켤 때만 동작한다(기본 꺼짐·1마리). 픽셀 캐릭터가 화면을 자유롭게 돌아다닌다.
   - 화면 바닥을 걷고, 실제 UI 요소(탭 바·모달 카드·메모 패널 등) 위에도 착지해 그 위를 걸어다닌다.
   - 마우스로 붙잡아 던질 수 있고(중력 낙하 후 착지), 짧게 누르면 폴짝 뛰며 한마디 한다.
   - 여러 마리(최대 6)를 켤 수 있고, 종족·색·걸음 속도가 저마다 조금씩 다르다.
   종족마다 이동 방식(kind)이 다르다:
     climber(게·병아리)=걷기+벽타기+천장 / walker(로봇)=걷다가 가끔 방전·재부팅
     hopper(연필·토끼)=콩콩 뛰기 / bouncer(슬라임)=통통 튀고 착지 때 찌부
     roller(별·축구공)=데굴데굴 / ghost(유령)=중력 무시 부유+가끔 반투명
     ufo(UFO)=날아다니다 다른 펫을 광선으로 납치 시도(시늉만 하고 실패한다)
     cat(고양이)=마우스 커서를 발견하면 살금살금 다가가 덮침
     dog(강아지)=고양이를 발견하면 쫓아가 왕왕(고양이는 화들짝), 없으면 신나서 질주
     spider(거미)=천장에 살며 거미줄을 타고 내려왔다 올라감(던지면 실을 쏘아 복귀)
     mole(두더지)=바닥을 파고 들어가 다른 곳에서 뿅 / frog(개구리)=웅크려 모은 힘으로 대점프+혀 낼름
     penguin(펭귄)=뒤뚱뒤뚱 걷다 배 미끄럼 / balloon(풍선)=두둥실 뜨다 가끔 바람 빠져 추락
     snail(달팽이·거북이)=아주 느리게 기기+껍질 숨기 / ninja(닌자·외계인)=대시·연막 순간이동
     bird(새·박쥐·부엉이)=훨훨 날다 UI 발판에 내려앉아 쉼
     chameleon(카멜레온)=가까운 펫의 색을 슬쩍 복사+혀 낼름 / wizard(마법사)=주문으로 다른 펫을 순간이동
     magnet(자석)=자력으로 주변 펫을 끌어당김 / cloud(번개구름)=하늘을 떠다니다 번개로 펫을 잠깐 기절시킴
     rocket(로켓)=카운트다운→발사→낙하산 귀환 / flutter(나비·꿀벌)=팔랑팔랑 날다 다른 펫 머리에 앉아 쉼
     fish(물고기)=비눗방울 안에서 부유, 방울이 터지면(클릭·던지기) 바닥에서 파닥거리다 새 방울을 붐
     snake(뱀)=꿈틀꿈틀 기어다니고 똬리 틀기 / mouse(생쥐)=고양이가 다가오면 "찍찍!" 하고 도망
   몇 마리든 rAF 루프는 하나만 돌고 발판 스캔도 공유하므로 성능 부담이 거의 없다.
   그리기는 마리당 45×33px 작은 캔버스 하나뿐이고, 몸통에만 포인터가 잡혀 UI 클릭을 막지 않는다. */

const PET_SCALE = 3, PET_GW = 15, PET_GH = 11;
const PET_W = PET_GW * PET_SCALE, PET_H = PET_GH * PET_SCALE;   // 45×33
const PET_GRAV = 0.5, PET_WALK = 1.05, PET_CLIMB = 1.0, PET_MAX = 12;
const PET_FPS_MIN = 42, PET_FPS_FLOOR = 3, PET_FPS_TRIGGER_MS = 2500;   // 저사양 자동 하향: FPS가 이 아래로 약 2.5초 지속되면 마릿수를 절반으로
// 발판 위에 "서 있는" 상태들 — 발판 추적 대상이자 UFO 의 납치 후보가 된다
const PET_GROUND_STATES = ["walk", "idle", "seekwall", "reboot", "hopwait",
  "stalk", "chase", "zoomies", "slide", "charge", "tongue", "hide", "dash",
  "stun", "pull", "cast", "flee", "coil", "countdown"];

// 펫이 올라설 수 있는 UI 요소(윗변이 발판이 된다). 보이는 것만 골라 쓴다.
const PET_PLATFORM_SELECTORS = [
  "#tabBar", ".modal-card", ".scratchpad", ".image-memo",
  ".sb-search", ".sb-actions", ".pen-bar", ".pdf-pages-panel", ".fs-controls"
];

let petWorld = null;      // 켜져 있을 때만 { pets:[…], platforms, mouse, raf, … } 가 존재한다
let petTraceCount = 0;    // 낙서·점액·흙 흔적 개수 상한용

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

// 바닥에 잠깐 남는 흔적(연필 낙서·달팽이 점액·두더지 흙) — cls 로 모양, life 로 수명을 고른다
function petTrace(x, y, cls, life){
  if (petTraceCount > 40) return;
  petTraceCount++;
  const d = document.createElement("div");
  d.className = "pixel-pet-trace" + (cls ? " " + cls : "");
  d.style.left = Math.round(x) + "px";
  d.style.top = Math.round(y) + "px";
  d.style.animationDuration = (life || 1400) + "ms";
  document.body.appendChild(d);
  setTimeout(() => { d.remove(); petTraceCount--; }, life || 1400);
}

// 닌자의 연막(사라질 때·나타날 때 한 번씩)
function petSmoke(x, y){
  const d = document.createElement("div");
  d.className = "pixel-pet-smoke";
  d.style.left = Math.round(x + PET_W / 2 - 17) + "px";
  d.style.top = Math.round(y + PET_H / 2 - 17) + "px";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 650);
}

// ----- 그리기: 작은 캔버스에 스프라이트만 다시 그린다 -----
const PET_MOVING_STATES = ["walk", "seekwall", "climb", "ceiling", "float",
  "stalk", "chase", "zoomies", "dash", "fly", "ceilwalk", "descend", "ascend", "reel",
  "flee", "chute"];
function petDraw(p){
  const ctx = p.ctx;
  ctx.clearRect(0, 0, PET_W, PET_H);
  const moving = PET_MOVING_STATES.includes(p.state);
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
  // 별·축구공, 그리고 황금 펫은 가끔 반짝이 픽셀이 튄다
  if ((p.kind === "roller" || p.gold) && Math.random() < 0.1){
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 2; i++)
      ctx.fillRect((3 + Math.floor(Math.random() * 9)) * PET_SCALE, (3 + Math.floor(Math.random() * 6)) * PET_SCALE, PET_SCALE, PET_SCALE);
  }
  // 개구리·카멜레온 혀 낼름(입가에서 앞으로 늘었다 줄어든다 — 좌우 반전은 transform 이 처리)
  if (p.state === "tongue" && (p.kind === "frog" || p.kind === "chameleon")){
    const ty = p.kind === "frog" ? 6 : 4, tx = p.kind === "frog" ? 11 : 12;
    const len = 1 + Math.round(Math.sin((1 - p.timer / 16) * Math.PI) * 4);
    ctx.fillStyle = "#e86a7a";
    for (let i = 0; i < len; i++)
      ctx.fillRect(Math.min(14, tx + i) * PET_SCALE, ty * PET_SCALE, PET_SCALE, PET_SCALE);
  }
  // 위치·방향은 CSS transform 으로(리플로 없이 GPU 합성만 일어난다)
  const rot = p.kind === "roller" ? p.roll
    : p.state === "climb" ? (p.side < 0 ? -90 : 90) : (p.rot || 0);
  const flipY = (p.state === "ceiling" || p.state === "ceilwalk") ? -1 : 1;   // 천장에선 뒤집힌다
  const sq = p.squash > 0 ? p.squash : 0;                     // 찌부(슬라임 착지·개구리 웅크림 등)
  const pop = p.pop > 0 ? p.pop / 12 : 0;                     // 클릭했을 때 뽀잉
  const sx = p.face * (1 + 0.30 * sq + 0.12 * pop);
  const sy = flipY * (1 - 0.35 * sq + 0.12 * pop);
  p.el.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px)";
  p.cv.style.transform = "rotate(" + rot + "deg) scale(" + sx + "," + sy + ")";
}

// ----- 다음 행동 고르기(바닥·발판 위에서, 종족별로 레퍼토리가 다르다) -----
function petPickAction(p, w){
  const roll = Math.random();
  p.t = 0;
  if (p.kind !== "roller") p.rot = 0;                          // 기울어진 채 다음 행동을 시작하지 않게
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
  else if (p.kind === "roller"){   // 별·축구공: 걷기가 곧 구르기
    if (roll < 0.5){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 150; }
    else if (roll < 0.75){ p.state = "idle"; p.timer = 40 + Math.random() * 90; }
    else { p.state = "jump"; p.vy = -(5 + Math.random() * 4); p.vx = p.face * (1.5 + Math.random() * 1.5); }
  }
  else if (p.kind === "cat"){      // 고양이: 잘 늘어져 있다가 가끔 뛴다(커서 사냥은 petUpdate 가 건다)
    if (roll < 0.42){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 80 + Math.random() * 140; }
    else if (roll < 0.74){ p.state = "idle"; p.timer = 70 + Math.random() * 160; }
    else { p.state = "jump"; p.vy = -(5 + Math.random() * 3); p.vx = p.face * (1 + Math.random() * 1.5); }
  }
  else if (p.kind === "dog"){      // 강아지: 고양이가 보이면 쫓아가고, 없으면 가끔 신나서 질주한다
    const cat = w.pets.find(o => o !== p && o.kind === "cat" && PET_GROUND_STATES.includes(o.state));
    if (cat && roll < 0.3){ p.state = "chase"; p.victim = cat; p.timer = 420; petEventRecord("dog_cat_chase"); }
    else if (roll < 0.5){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 140; }
    else if (roll < 0.72){ p.state = "idle"; p.timer = 50 + Math.random() * 110; }
    else if (roll < 0.86){ p.state = "jump"; p.vy = -(5 + Math.random() * 3); p.vx = p.face * (1 + Math.random()); }
    else { p.state = "zoomies"; p.timer = 110 + Math.random() * 130; }
  }
  else if (p.kind === "frog"){     // 개구리: 앉아 있다가 웅크려 힘을 모아 크게 점프, 가끔 혀 낼름
    if (roll < 0.4){ p.state = "idle"; p.timer = 40 + Math.random() * 90; }
    else if (roll < 0.55){ p.state = "tongue"; p.timer = 16; }
    else { p.state = "charge"; p.timer = 26 + Math.random() * 14; if (Math.random() < 0.35) p.face *= -1; }
  }
  else if (p.kind === "penguin"){  // 펭귄: 뒤뚱뒤뚱 걷다가 배를 깔고 미끄러진다
    if (roll < 0.42){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 140; }
    else if (roll < 0.68){ p.state = "idle"; p.timer = 50 + Math.random() * 110; }
    else { p.state = "slide"; p.vx = p.face * (2.4 + Math.random() * 1.2); if (Math.random() < 0.35) petSay(p, "슈웅~"); }
  }
  else if (p.kind === "snail"){    // 달팽이: 아주 느리게 오래 기고, 가끔 껍질에 숨는다
    if (roll < 0.6){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 220 + Math.random() * 240; }
    else if (roll < 0.85){ p.state = "idle"; p.timer = 80 + Math.random() * 120; }
    else { p.state = "hide"; p.timer = 120 + Math.random() * 180; }
  }
  else if (p.kind === "mole"){     // 두더지: 바닥에서만 땅을 팔 수 있다
    if (roll < 0.35 && p.support && p.support.floor){ p.state = "digdown"; if (Math.random() < 0.3) petSay(p, "쑤욱~"); }
    else if (roll < 0.7){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 130; }
    else { p.state = "idle"; p.timer = 50 + Math.random() * 110; }
  }
  else if (p.kind === "ninja"){    // 닌자: 대시하거나 연막을 치고 다른 발판으로 순간이동한다
    if (roll < 0.34){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 80 + Math.random() * 120; }
    else if (roll < 0.58){ p.state = "idle"; p.timer = 50 + Math.random() * 100; }
    else if (roll < 0.8){ p.state = "dash"; p.timer = 22; if (Math.random() < 0.3) petSay(p, "슉!"); }
    else {
      petSmoke(p.x, p.y);
      p.el.style.opacity = "0"; p.el.style.pointerEvents = "none";
      p.state = "vanish"; p.timer = 45 + Math.random() * 40;
    }
  }
  else if (p.kind === "chameleon"){ // 카멜레온: 느긋하게 걷고, 가끔 혀를 낼름(색 복사는 petUpdate 가 상시)
    if (roll < 0.4){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 120 + Math.random() * 160; }
    else if (roll < 0.75){ p.state = "idle"; p.timer = 70 + Math.random() * 120; }
    else { p.state = "tongue"; p.timer = 16; }
  }
  else if (p.kind === "wizard"){   // 마법사: 가끔 주문을 외워 다른 펫을 순간이동시킨다
    if (roll < 0.36){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 130; }
    else if (roll < 0.66){ p.state = "idle"; p.timer = 50 + Math.random() * 110; }
    else if (roll < 0.82){ p.state = "jump"; p.vy = -(4 + Math.random() * 2); p.vx = p.face * (1 + Math.random()); }
    else { p.state = "cast"; p.timer = 46; if (Math.random() < 0.5) petSay(p, "수리수리 마수리~"); }
  }
  else if (p.kind === "magnet"){   // 자석: 자력을 켜서 주변 펫을 끌어당긴다
    if (roll < 0.4){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 90 + Math.random() * 130; }
    else if (roll < 0.7){ p.state = "idle"; p.timer = 50 + Math.random() * 110; }
    else { p.state = "pull"; p.timer = 80 + Math.random() * 60; petSay(p, "철컥!"); }
  }
  else if (p.kind === "snake"){    // 뱀: 꿈틀꿈틀 오래 기고, 가끔 똬리를 튼다
    if (roll < 0.55){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 160 + Math.random() * 200; }
    else if (roll < 0.8){ p.state = "idle"; p.timer = 60 + Math.random() * 100; }
    else { p.state = "coil"; p.timer = 90 + Math.random() * 120; }
  }
  else if (p.kind === "mouse"){    // 생쥐: 부지런히 종종거린다(고양이 감지는 petUpdate 가 건다)
    if (roll < 0.5){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 70 + Math.random() * 110; }
    else if (roll < 0.8){ p.state = "idle"; p.timer = 40 + Math.random() * 90; }
    else { p.state = "jump"; p.vy = -(3.5 + Math.random() * 2); p.vx = p.face * (1 + Math.random()); }
  }
  else if (p.kind === "rocket"){   // 로켓: 서성이다 카운트다운 후 발사(→낙하산 귀환)
    if (roll < 0.35){ p.state = "idle"; p.timer = 60 + Math.random() * 120; }
    else if (roll < 0.6){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 60 + Math.random() * 90; }
    else { p.state = "countdown"; p.timer = 80; if (Math.random() < 0.5) petSay(p, "3, 2, 1..."); }
  }
  else if (p.kind === "bird"){     // 새: 발판 위에서 쉬다가 다시 날아오른다
    if (roll < 0.28){ p.state = "walk"; p.face = Math.random() < 0.5 ? -1 : 1; p.timer = 50 + Math.random() * 70; }
    else if (roll < 0.52){ p.state = "idle"; p.timer = 50 + Math.random() * 100; }
    else if (roll < 0.66){ p.state = "jump"; p.vy = -(4 + Math.random() * 2); p.vx = p.face * (1 + Math.random()); }
    else { p.state = "fly"; p.gTarget = null; p.landT = null; }
  }
  else {                           // hopper(연필·토끼)·bouncer(슬라임): 걷지 않고 콩콩 뛰어다닌다
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

// ----- 수업 이벤트 반응: 파이썬 실행이 끝나면 성공/오류에 맞춰 펫들이 한마디씩 한다 -----
const PET_CHEER = ["성공! 🎉", "와~ 됐다!", "코드 천재!", "완벽해요!", "만세!", "박수 짝짝!"];
const PET_OOPS = ["어이쿠!", "으악, 빨간 글씨!", "괜찮아요, 다시!", "삐끗...", "오류는 스승님", "힘내요!"];
let petReactAt = 0;
function petReact(type){
  const w = petWorld;
  if (!w || (type !== "success" && type !== "error")) return;
  const now = Date.now();
  if (now - petReactAt < 4000) return;                        // 연속 실행 도배 방지
  petReactAt = now;
  const lines = type === "success" ? PET_CHEER : PET_OOPS;
  let delay = 0;
  for (const p of w.pets){
    delay += 100 + Math.random() * 250;                       // 한 마리씩 시차를 두고 반응
    setTimeout(() => {
      if (petWorld !== w || p.state === "drag") return;       // 꺼졌거나 붙잡힌 중이면 그대로
      petSay(p, lines[Math.floor(Math.random() * lines.length)]);
      if (p.grav && PET_GROUND_STATES.includes(p.state)){
        if (type === "success"){                              // 서 있던 애들은 기뻐서 점프
          p.state = "jump"; p.vy = -(5 + Math.random() * 3); p.vx = 0; p.rot = 0; p.t = 0;
        } else {                                              // 오류엔 깜짝 놀라 찌부
          p.squash = 1; p.state = "idle"; p.timer = 60 + Math.random() * 60;
        }
      } else p.pop = 12;                                      // 떠 있는 애들은 뽀잉
    }, delay);
  }
}

// ----- 행동 도감·숨겨진 조합 이벤트 -----
const PET_EVENT_DEX_KEY = "mn.petEventDex";
function petEventDexLoad(){
  try {
    const value = JSON.parse(localStorage.getItem(PET_EVENT_DEX_KEY));
    return value && typeof value === "object" ? value : {};
  } catch(_){ return {}; }
}
function petEventDef(id){
  return typeof PET_EVENT_DEFS === "object" ? PET_EVENT_DEFS.find(e => e.id === id) : null;
}
function petEventRecord(id){
  const def = petEventDef(id);
  if (!def) return;
  const dex = petEventDexLoad();
  const first = !dex[id];
  const now = Date.now();
  const entry = dex[id] || (dex[id] = { n:0, first:now });
  entry.n = (Number(entry.n) || 0) + 1;
  entry.last = now;
  try { localStorage.setItem(PET_EVENT_DEX_KEY, JSON.stringify(dex)); } catch(_){}
  if (first && typeof toast === "function"){
    toast("새로운 행동 발견! 「" + def.title + "」", 5200, {
      type:"success",
      action:{ label:"행동 도감", onClick:() => openPetDex("events") }
    });
  }
  const modal = document.getElementById("petDexModal");
  if (modal && !modal.hidden && typeof renderPetEventDex === "function") renderPetEventDex();
}
function petSpeciesById(id){
  for (const sp of PET_SPECIES) if (petSpeciesId(sp) === id) return sp;
  return null;
}
function petEventMoveToward(p, tx, ty, rate){
  const dx = tx - p.x, dy = ty - p.y;
  p.x += dx * rate; p.y += dy * rate;
  if (Math.abs(dx) > 2) p.face = dx < 0 ? -1 : 1;
}
function petEventPair(w, def){
  const free = p => !p.petEvent && p.state !== "drag" && p.state !== "abduct" && p.state !== "vanish";
  const a = w.pets.find(p => p.speciesId === def.pets[0] && free(p));
  const b = w.pets.find(p => p !== a && p.speciesId === def.pets[1] && free(p));
  return a && b ? [a, b] : null;
}
function petEventStart(w, def, pair){
  if (!def || !def.scene || !pair || w.event) return false;
  const evt = { world:w, def, a:pair[0], b:pair[1], t:0 };
  w.event = evt;
  for (const p of pair){
    p.petEvent = evt; p.state = "pet-event"; p.victim = null; p.gTarget = null;
    p.vx = 0; p.vy = 0; p.rot = 0; p.squash = 0; p.off = false;
    p.el.style.opacity = "";
    if (p.beam){ p.beam.style.display = "none"; p.beam.style.height = "0px"; }
    if (p.bolt) p.bolt.style.display = "none";
    if (p.thread) p.thread.style.display = "none";
    if (p.chute) p.chute.style.display = "none";
  }
  return true;
}
function petEventReleasePet(p){
  p.petEvent = null; p.victim = null; p.gTarget = null;
  p.vx = 0; p.vy = 0; p.rot = 0; p.squash = 0; p.off = false; p.pop = 6;
  p.el.style.opacity = "";
  if (p.beam){ p.beam.style.display = "none"; p.beam.style.height = "0px"; }
  if (p.bolt) p.bolt.style.display = "none";
  if (p.thread) p.thread.style.display = "none";
  if (p.chute) p.chute.style.display = "none";
  if (p.grav){
    p.y = Math.min(p.y, Math.max(0, window.innerHeight - PET_H - 1));
    p.state = "fall"; p.t = 0;
  } else petAirRelease(p);
}
function petEventEnd(evt, completed){
  if (!evt) return;
  const w = evt.world;
  if (w.event === evt) w.event = null;
  for (const p of [evt.a, evt.b]) if (p && p.petEvent === evt) petEventReleasePet(p);
  if (w.playedEvents) w.playedEvents.add(evt.def.id);
  w.eventTimer = 900 + Math.floor(Math.random() * 600);
  if (completed){
    petEventRecord(evt.def.id);
    const lines = evt.def.finish || [];
    if (lines[0]) petSay(evt.a, lines[0]);
    if (lines[1]) setTimeout(() => { if (petWorld === w && evt.b.el.isConnected) petSay(evt.b, lines[1]); }, 180);
  }
}
function petEventSceneStep(evt){
  const t = ++evt.t, a = evt.a, b = evt.b, scene = evt.def.scene;
  const vw = window.innerWidth, vh = window.innerHeight;
  const floorY = Math.max(42, vh - PET_H - 4);
  const left = Math.max(8, Math.min(vw - 230, vw * 0.18));
  const span = Math.max(80, Math.min(230, vw - left - 55));

  if (scene === "cleanup"){
    if (t < 70){
      petEventMoveToward(a, left, floorY, 0.09);
      petEventMoveToward(b, Math.max(4, left - 48), floorY, 0.09);
    } else if (t < 180){
      const u = (t - 70) / 110;
      a.x = left + span * u; a.y = floorY - Math.abs(Math.sin(t * 0.22)) * 18; a.face = 1;
      b.x += (left - 34 - b.x) * 0.08; b.y += (floorY - b.y) * 0.1;
      if (t === 72) petSay(a, "여기에도 그려야지!");
      if (t % 11 === 0) petTrace(a.x + PET_W / 2 - 5, floorY + PET_H - 4, "", 4200);
    } else {
      const u = Math.min(1, (t - 180) / 105);
      a.x = left + span; a.y += (floorY - a.y) * 0.1;
      b.x = Math.max(0, left - 34) + (span + 34) * u; b.y = floorY; b.face = 1;
      if (t === 182) petSay(b, "쓱싹쓱싹!");
      if (t % 9 === 0) petTrace(b.x + PET_W / 2 - 5, floorY + PET_H - 4, "dust", 900);
    }
  }
  else if (scene === "magnet"){
    const center = Math.max(60, Math.min(vw - 60, vw * 0.5));
    if (t < 70){
      petEventMoveToward(a, center - 70, floorY, 0.09);
      petEventMoveToward(b, center + 80, floorY, 0.09);
    } else {
      a.x = center - 55 + Math.sin(t * 0.18) * 5; a.y = floorY; a.rot = Math.sin(t * 0.8) * 8; a.face = 1;
      b.x += (center - 15 - b.x) * 0.025; b.y = floorY; b.face = -1;
      b.rot += 13; b.off = t > 170 && t < 215;
      if (t === 72) petSay(a, "철컥! 끌어당긴다!");
      if (t === 174) petSay(b, "과부하... 재부팅...");
    }
  }
  else if (scene === "home"){
    const center = Math.max(45, Math.min(vw - 45, vw * 0.5));
    if (t < 70){
      petEventMoveToward(a, center - 22, Math.max(12, floorY - 135), 0.08);
      petEventMoveToward(b, center - 18, floorY, 0.09);
    } else if (t < 180){
      const u = (t - 70) / 110;
      a.x = center - 22; a.y = Math.max(10, floorY - 135 - u * 35) + Math.sin(t * 0.1) * 3;
      b.x = center - 18; b.y = floorY + (a.y + PET_H - floorY) * u;
      a.beam.style.display = "block";
      a.beam.style.height = Math.max(18, b.y - (a.y + PET_H) + 10) + "px";
      b.rot = Math.sin(t * 0.45) * 18;
      if (t === 74) petSay(b, "어? 내 우주선!");
    } else if (t < 215){
      a.beam.style.display = "none";
      a.y -= 6; b.y -= 6;
      if (t > 198){ a.el.style.opacity = "0"; b.el.style.opacity = "0"; }
    } else {
      if (t === 215){
        const nx = center < vw / 2 ? vw - 70 : 25;
        a.x = Math.max(0, nx); b.x = Math.max(0, nx + 4); a.y = -30; b.y = 4;
        petSmoke(a.x, 18); a.el.style.opacity = ""; b.el.style.opacity = "";
      }
      a.y += (Math.max(12, floorY - 120) - a.y) * 0.05;
      b.y += (floorY - b.y) * 0.05; b.rot *= 0.86;
    }
  }
  else if (scene === "rain"){
    const center = Math.max(45, Math.min(vw - 45, vw * 0.5));
    if (t < 65){
      petEventMoveToward(a, center - 22, Math.max(12, floorY - 135), 0.08);
      petEventMoveToward(b, center - 18, floorY, 0.09);
    } else {
      a.x = center - 22 + Math.sin(t * 0.04) * 18; a.y = Math.max(10, floorY - 135) + Math.sin(t * 0.08) * 3;
      b.x = center - 18 + Math.sin(t * 0.09) * 16;
      b.y = floorY - Math.abs(Math.sin((t - 65) * 0.105)) * 75; b.squash = b.y > floorY - 5 ? 0.4 : 0;
      if (t === 68) petSay(a, "후두둑~ 소나기!");
      if (t === 94) petSay(b, "개굴개굴!");
      if (t % 4 === 0) petTrace(a.x + 5 + Math.random() * 55, a.y + PET_H + 12 + Math.random() * 45, "rain", 520);
    }
  }
  else if (scene === "apple"){
    if (t < 55){
      petEventMoveToward(a, left + 45, floorY, 0.09);
      petEventMoveToward(b, left, floorY, 0.09);
    } else {
      const u = Math.min(1, (t - 55) / 205);
      a.x = left + 45 + span * u; a.y = floorY - Math.abs(Math.sin(t * 0.18)) * 16;
      a.face = 1; a.rot = u * 850;
      b.x = Math.max(left, a.x - 58 - Math.sin(t * 0.08) * 12);
      b.y = floorY - Math.abs(Math.sin(t * 0.22)) * 28; b.face = 1;
      if (t === 58) petSay(b, "사과다! 기다려!");
      if (t === 175) petSay(a, "데굴데굴~");
    }
  }
  else if (scene === "slowrace"){
    const start = Math.max(8, Math.min(vw - 180, vw * 0.16));
    const raceSpan = Math.max(70, Math.min(250, vw - start - 55));
    if (t < 65){
      petEventMoveToward(a, start, floorY - 3, 0.08);
      petEventMoveToward(b, start + 4, floorY, 0.08);
    } else {
      const u = Math.min(1, (t - 65) / 285);
      a.x = start + raceSpan * Math.min(1, u * 0.91 + Math.sin(t * 0.04) * 0.008); a.y = floorY - 3; a.face = 1;
      b.x = start + raceSpan * Math.min(1, u * 0.94 + Math.sin(t * 0.035 + 1) * 0.008); b.y = floorY; b.face = 1;
      if (t === 68){ petSay(a, "준비... 출발..."); setTimeout(() => { if (b.petEvent === evt) petSay(b, "천천히 가자!"); }, 260); }
      if (t === 300) petSay(a.x > b.x ? a : b, "거의 다 왔다!");
    }
  }

  for (const p of [a, b]){
    p.x = Math.max(0, Math.min(vw - PET_W, p.x));
    p.y = Math.max(-PET_H * 2, Math.min(vh - PET_H, p.y));
  }
  if (t >= evt.def.duration) petEventEnd(evt, true);
}
function petEventTick(w){
  if (w.event){ petEventSceneStep(w.event); return; }
  if (--w.eventTimer > 0) return;
  const dex = petEventDexLoad();
  let choices = PET_EVENT_DEFS.filter(def => def.scene && !w.playedEvents.has(def.id))
    .map(def => ({ def, pair:petEventPair(w, def) })).filter(x => x.pair);
  const unseen = choices.filter(x => !dex[x.def.id]);
  if (unseen.length) choices = unseen;
  if (choices.length){
    const choice = choices[Math.floor(Math.random() * choices.length)];
    petEventStart(w, choice.def, choice.pair);
  } else w.eventTimer = 300;
}

// ----- 집중 모드·타이핑 생활 리듬 -----
function petWorldIsQuiet(w){
  return !!w && (w.rhythm === "focus" || Date.now() < (w.typingQuietUntil || 0));
}
function petWakeFromQuiet(p){
  if (!p.quiet) return;
  p.quiet = false; p.off = false; p.squash = 0; p.rot = 0;
  p.el.classList.remove("pet-quiet");
  if (p.state === "drag") return;
  if (p.grav){ p.state = "fall"; p.vx = 0; p.vy = 0; p.t = 0; }
  else petAirRelease(p);
}
function petQuietUpdate(p, w){
  if (!p.quiet){
    p.quiet = true; p.victim = null; p.gTarget = null; p.vx = 0; p.vy = 0;
    p.el.classList.add("pet-quiet");
    if (p.kind === "ufo") petUfoAbort(p);
    if (p.beam){ p.beam.style.display = "none"; p.beam.style.height = "0px"; }
    if (p.bolt) p.bolt.style.display = "none";
    if (p.thread) p.thread.style.display = "none";
    if (p.chute) p.chute.style.display = "none";
  }
  const index = Math.max(0, w.pets.indexOf(p));
  const side = index % 2, slot = Math.floor(index / 2);
  const gap = PET_W + 7, margin = 8;
  const tx = side === 0 ? margin + slot * gap : window.innerWidth - PET_W - margin - slot * gap;
  const ty = Math.max(0, window.innerHeight - PET_H - 6);
  p.x += (tx - p.x) * 0.065;
  p.y += (ty - p.y) * 0.065;
  p.face = side === 0 ? 1 : -1;
  p.rot = Math.sin(p.t * 0.035) * 2;
  p.squash = 0.08 + (Math.sin(p.t * 0.07) + 1) * 0.025;
  p.off = true;
}
function petSetRhythm(mode){
  const w = petWorld;
  if (!w) return;
  mode = mode === "focus" ? "focus" : mode === "break" ? "break" : "normal";
  if (w.rhythm === mode && mode !== "break") return;
  w.rhythm = mode;
  if (mode === "focus"){
    if (w.event) petEventEnd(w.event, false);
    w.typingQuietUntil = 0;
    const first = w.pets.find(p => p.state !== "drag");
    if (first) petSay(first, "집중 시간! 조용히 쉴게요");
    return;
  }
  for (const p of w.pets) petWakeFromQuiet(p);
  if (mode === "break"){
    w.eventTimer = Math.min(w.eventTimer || 300, 240);
    w.pets.forEach((p, index) => {
      if (p.state === "drag") return;
      setTimeout(() => {
        if (petWorld !== w || w.rhythm !== "break" || p.state === "drag") return;
        if (p.grav){ p.state = "jump"; p.vy = -(4.5 + Math.random() * 2); p.vx = 0; p.t = 0; p.off = false; }
        else { p.pop = 12; p.off = false; }
        if (index === 0) petSay(p, "휴식 시간! 쭉쭉~");
      }, index * 120);
    });
  }
}
function petTypingPulse(){
  const w = petWorld;
  if (!w || w.rhythm === "focus") return;
  w.typingQuietUntil = Date.now() + 3800;
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
        if (v.speciesId === "rabbit") petEventRecord("ufo_rabbit_abduction");
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

// ----- 거미: 천장에 살면서 거미줄을 타고 내려왔다 올라간다 -----
function petSpiderUpdate(p){
  const vw = window.innerWidth, vh = window.innerHeight;
  if (p.state === "ceilwalk"){
    p.y = 0; p.rot = 0;
    p.x += p.face * 0.8 * p.speed;
    if (p.x <= 0){ p.x = 0; p.face = 1; }
    if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.face = -1; }
    if (Math.random() < 0.004){ p.state = "descend"; p.t = 0; p.dropLen = 60 + Math.random() * vh * 0.45; }
  }
  else if (p.state === "descend"){
    p.y += 1.3 * p.speed;
    p.rot = Math.sin(p.t * 0.15) * 4;
    if (p.y >= p.dropLen){ p.hangY = p.y; p.state = "hang"; p.timer = 100 + Math.random() * 160; }
  }
  else if (p.state === "hang"){                                // 대롱대롱 매달려 흔들린다
    p.y = p.hangY + Math.sin(p.t * 0.08) * 5;
    p.rot = Math.sin(p.t * 0.06) * 7;
    if (--p.timer <= 0) p.state = "ascend";
  }
  else if (p.state === "ascend"){
    p.y -= 1.1 * p.speed; p.rot = 0;
    if (p.y <= 0){ p.y = 0; p.state = "ceilwalk"; p.face = Math.random() < 0.5 ? -1 : 1; }
  }
  else {                                                       // reel: 던져진 뒤 실을 쏘아 천장으로 복귀
    p.x += p.vx; p.vx *= 0.9;
    p.y -= 2.2; p.rot = 0;
    if (p.y <= 0){ p.y = 0; p.state = "ceilwalk"; }
  }
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
  // 실은 몸에서 천장까지 이어진다(천장을 걸을 땐 숨김)
  const showThread = p.state !== "ceilwalk";
  p.thread.style.display = showThread ? "block" : "none";
  if (showThread){
    p.thread.style.height = Math.max(0, Math.round(p.y)) + "px";
    p.thread.style.top = (-Math.round(p.y)) + "px";
  }
}

// ----- 풍선: 두둥실 떠다니다 가끔 바람이 빠져 지그재그로 추락한다 -----
function petBalloonUpdate(p){
  const vw = window.innerWidth, vh = window.innerHeight;
  p.x += p.vx; p.vx *= 0.95;                                   // 던져진 관성
  if (p.state === "deflate"){
    p.y += 2.6;
    p.x += Math.sin(p.t * 0.6) * 4;                            // 지그재그 푸슈슉
    p.rot = Math.sin(p.t * 0.9) * 35;
    if (p.y >= vh - PET_H){ p.y = vh - PET_H; p.state = "flat"; p.timer = 70; p.rot = 0; }
  }
  else if (p.state === "flat"){                                // 바닥에서 찌부된 채 숨 고르기
    p.squash = 0.6;
    if (--p.timer <= 0){ p.squash = 0; p.state = "rise"; if (Math.random() < 0.5) petSay(p, "다시 둥실~"); }
  }
  else {                                                       // rise: 천천히 떠올라 천장 근처를 떠다닌다
    p.y -= 0.45 * p.speed;
    p.x += Math.sin(p.t * 0.03) * 0.5;
    p.rot = Math.sin(p.t * 0.05) * 6;
    if (p.y <= 6) p.y = 6 + Math.sin(p.t * 0.06) * 3;
    if (Math.random() < 0.0012){ p.state = "deflate"; p.t = 0; petSay(p, "푸슈슈슉~"); }
  }
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
}

// ----- 번개구름: 하늘을 떠다니다 아래 펫 위로 가서 번개를 내리쳐 잠깐 기절시킨다 -----
function petCloudUpdate(p, w){
  const vw = window.innerWidth, vh = window.innerHeight;
  p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94;
  const bob = Math.sin(p.t * 0.06) * 0.4;
  if (p.state === "zap"){
    const v = p.victim;
    p.bolt.style.display = p.t % 6 < 3 ? "block" : "none";     // 번쩍번쩍 점멸
    if (v) p.bolt.style.height = Math.max(0, Math.min(320, v.y - (p.y + PET_H) + 10)) + "px";
    if (--p.timer <= 0){
      p.bolt.style.display = "none";
      p.victim = null; p.state = "drift";
    }
  }
  else if (p.state === "storm"){                               // 목표 머리 위로 이동
    const v = p.victim;
    if (!v || !PET_GROUND_STATES.includes(v.state)){ p.victim = null; p.state = "drift"; }
    else {
      const tx = v.x, ty = Math.max(8, v.y - 110);
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1, sp = 1.2 * p.speed;
      p.x += dx / d * Math.min(sp, d); p.y += dy / d * Math.min(sp, d) + bob;
      if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
      if (d < 10){                                             // 콰르릉! 아래 펫을 기절시킨다
        p.state = "zap"; p.timer = 40;
        petSay(p, "콰르릉!");
        v.state = "stun"; v.timer = 110; v.off = true; v.t = 0; v.vx = 0; v.vy = 0;
      }
    }
  }
  else { // drift: 화면 위쪽을 뭉게뭉게 떠다닌다
    const t = p.gTarget;
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) < 16 || Math.random() < 0.004)
      p.gTarget = { x: Math.random() * Math.max(1, vw - PET_W), y: 15 + Math.random() * Math.max(40, vh * 0.35) };
    const dx = p.gTarget.x - p.x, dy = p.gTarget.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 0.8 * p.speed;
    p.x += dx / d * sp; p.y += dy / d * sp + bob;
    if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
    if (Math.random() < 0.0025){                               // 벼락 맞을 친구 물색
      const targets = w.pets.filter(o => o !== p && o.grav && PET_GROUND_STATES.includes(o.state));
      if (targets.length){ p.victim = targets[Math.floor(Math.random() * targets.length)]; p.state = "storm"; petSay(p, "우르릉..."); }
    }
  }
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
}

// ----- 나비·꿀벌: 팔랑팔랑 불규칙하게 날다가 가끔 다른 펫 머리 위에 살짝 앉는다 -----
function petFlutterUpdate(p, w){
  const vw = window.innerWidth, vh = window.innerHeight;
  if (p.state === "perch"){
    const v = p.victim;
    const calm = v && v.state !== "drag" && Math.abs(v.vx) < 2 && Math.abs(v.vy) < 2 &&
      !["jump", "fall", "fly", "chase", "zoomies", "dash", "slide", "flee", "launch"].includes(v.state);
    if (!calm || --p.timer <= 0){ p.victim = null; p.state = "flit"; p.gTarget = null; }
    else {
      const tx = v.x + 4, ty = v.y - 12;                       // 머리 위 자리
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d > 6){                                              // 아직 접근 중
        p.x += dx / d * 1.5; p.y += dy / d * 1.5;
        p.rot = Math.sin(p.t * 0.4) * 10;
        if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
      } else {                                                 // 앉았다: 친구를 따라다닌다
        p.x = tx; p.y = ty + Math.sin(p.t * 0.1);
        p.face = v.face; p.rot = 0;
      }
    }
  } else { // flit: 잔바람에 흔들리듯 지그재그 비행
    p.x += p.vx; p.y += p.vy; p.vx *= 0.9; p.vy *= 0.9;        // 던져진 관성
    const t = p.gTarget;
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) < 14 || Math.random() < 0.02)
      p.gTarget = { x: Math.random() * Math.max(1, vw - PET_W), y: 30 + Math.random() * Math.max(60, vh * 0.7) };
    const dx = p.gTarget.x - p.x, dy = p.gTarget.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 1.1 * p.speed;
    p.x += dx / d * sp + Math.sin(p.t * 0.7) * 0.8;
    p.y += dy / d * sp + Math.sin(p.t * 0.5) * 1.1;
    if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
    p.rot = Math.sin(p.t * 0.4) * 10;
    if (Math.random() < 0.002){                                // 쉬어갈 친구 물색
      const perchables = w.pets.filter(o => o !== p && o.grav && PET_GROUND_STATES.includes(o.state));
      if (perchables.length){
        p.victim = perchables[Math.floor(Math.random() * perchables.length)];
        p.state = "perch"; p.timer = 150 + Math.random() * 200;
      }
    }
  }
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
}

// ----- 물고기: 비눗방울 안에서 부유한다. 방울이 터지면(클릭·던지기) 바닥에서 파닥거리다 새 방울을 분다 -----
function petFishUpdate(p){
  const vw = window.innerWidth, vh = window.innerHeight;
  if (p.state === "flop"){
    p.orb.style.display = "none";
    p.vy += PET_GRAV; p.x += p.vx; p.y += p.vy;
    if (p.x < 0){ p.x = 0; p.vx = Math.abs(p.vx); }
    if (p.x > vw - PET_W){ p.x = vw - PET_W; p.vx = -Math.abs(p.vx); }
    if (p.y >= vh - PET_H){                                    // 바닥에 닿을 때마다 파닥!
      p.y = vh - PET_H;
      p.vy = -(2 + Math.random() * 3);
      p.vx = (Math.random() - 0.5) * 4;
      p.face *= -1;
      p.rot = (Math.random() - 0.5) * 50;
    }
    if (--p.timer <= 0){ p.state = "bubble"; p.rot = 0; p.vx = 0; p.vy = 0; petSay(p, "후우- 새 방울!"); }
  } else { // bubble: 유령처럼 느긋하게 부유
    p.orb.style.display = "";
    p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94;
    const t = p.gTarget;
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) < 18 || Math.random() < 0.004)
      p.gTarget = { x: Math.random() * Math.max(1, vw - PET_W), y: 40 + Math.random() * Math.max(60, vh * 0.7) };
    const dx = p.gTarget.x - p.x, dy = p.gTarget.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 0.5 * p.speed;
    p.x += dx / d * sp;
    p.y += dy / d * sp + Math.sin(p.t * 0.06) * 0.5;
    if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
    p.rot = Math.sin(p.t * 0.05) * 6;
  }
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
}

// ----- 새: 훨훨 날다가 UI 발판이나 바닥에 내려앉아 쉰다 -----
function petBirdFly(p, w){
  const vw = window.innerWidth, vh = window.innerHeight;
  p.x += p.vx; p.y += p.vy; p.vx *= 0.92; p.vy *= 0.92;        // 던져진 관성
  const flap = Math.sin(p.t * 0.25) * 0.8;
  if (p.landT){                                                // 점찍어 둔 자리로 활강
    const dx = p.landT.x - p.x, dy = p.landT.y - p.y, d = Math.hypot(dx, dy) || 1;
    const sp = 1.5 * p.speed;
    p.x += dx / d * Math.min(sp, d); p.y += dy / d * Math.min(sp, d);
    if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
    if (d < 5){ p.state = "fall"; p.vy = 0.5; p.vx = 0; p.landT = null; p.t = 0; }   // 착지는 낙하 판정에 맡긴다
  } else {
    const t = p.gTarget;
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) < 16 || Math.random() < 0.005)
      p.gTarget = { x: Math.random() * Math.max(1, vw - PET_W), y: 20 + Math.random() * Math.max(40, vh * 0.55) };
    const dx = p.gTarget.x - p.x, dy = p.gTarget.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 1.5 * p.speed;
    p.x += dx / d * sp; p.y += dy / d * sp + flap;
    if (Math.abs(dx) > 3) p.face = dx < 0 ? -1 : 1;
    if (Math.random() < 0.003){                                // 앉을 자리 물색
      const spots = w.platforms.filter(pl => pl.w >= PET_W + 24);
      const pl = spots[Math.floor(Math.random() * spots.length)];
      if (pl) p.landT = { x: pl.x + 6 + Math.random() * Math.max(1, pl.w - PET_W - 12), y: pl.y - PET_H };
    }
  }
  p.rot = Math.sin(p.t * 0.2) * 6;
  p.x = Math.max(0, Math.min(vw - PET_W, p.x));
  p.y = Math.max(0, Math.min(vh - PET_H, p.y));
}

// ----- 물리·상태 기계: 펫 한 마리의 한 프레임 -----
function petUpdate(p, w){
  p.t++;
  if (p.blink > 0) p.blink--;
  else if (!p.off && Math.random() < 0.008) p.blink = 8;
  if (p.squash > 0) p.squash = Math.max(0, p.squash - 0.06);
  if (p.pop > 0) p.pop--;
  if (p.cool > 0) p.cool--;                                    // 고양이 사냥 쿨타임
  if (p.petEvent) return;                                      // 숨겨진 조합 연출은 이벤트 감독이 좌표를 움직인다
  if (p.state === "drag") return;                              // 좌표는 포인터 핸들러가 움직인다
  if (petWorldIsQuiet(w)){ petQuietUpdate(p, w); return; }
  if (p.quiet) petWakeFromQuiet(p);
  if (p.kind === "ghost") return petGhostUpdate(p);
  if (p.kind === "ufo") return petUfoUpdate(p, w.pets);
  if (p.kind === "spider") return petSpiderUpdate(p);
  if (p.kind === "balloon") return petBalloonUpdate(p);
  if (p.kind === "cloud") return petCloudUpdate(p, w);
  if (p.kind === "flutter") return petFlutterUpdate(p, w);
  if (p.kind === "fish") return petFishUpdate(p);
  if (p.state === "fly") return petBirdFly(p, w);

  const vw = window.innerWidth, vh = window.innerHeight;
  const walk = PET_WALK * p.speed, climb = PET_CLIMB * p.speed;
  if (PET_GROUND_STATES.includes(p.state)){
    // 서 있던 발판이 사라지면(모달 닫힘 등) 떨어진다. 살짝 움직였으면 발 위치를 따라간다.
    const s = petFindSupport(p, w.platforms);
    if (!s){ p.state = "fall"; p.vy = 0; p.vx = 0; }
    else { p.support = s; p.y = s.y - PET_H; }
  }

  // 고양이: 근처에서 마우스가 움직이면 하던 일을 멈추고 살금살금 다가간다
  if (p.kind === "cat" && (p.state === "walk" || p.state === "idle") && p.cool <= 0 && Date.now() - w.mouse.ts < 3000){
    const mdx = w.mouse.x - (p.x + PET_W / 2), mdy = w.mouse.y - (p.y + PET_H / 2);
    if (Math.abs(mdx) > 40 && Math.abs(mdx) < 300 && mdy > -220 && mdy < 80){ p.state = "stalk"; p.t = 0; }
  }
  // 생쥐: 고양이가 가까이 오면 "찍찍!" 하고 반대쪽으로 도망친다
  if (p.kind === "mouse" && (p.state === "walk" || p.state === "idle") && p.cool <= 0){
    const cat = w.pets.find(o => o.kind === "cat" && o.state !== "drag" &&
      Math.abs(o.x - p.x) < 170 && Math.abs(o.y - p.y) < 60);
    if (cat){
      p.state = "flee"; p.timer = 90; p.face = (p.x < cat.x) ? -1 : 1; p.cool = 400; petSay(p, "찍찍!");
      petEventRecord("cat_mouse_escape");
    }
  }
  // 카멜레온: 가까운 펫의 색을 슬쩍 복사하고, 멀어지면 원래 색으로 돌아온다
  if (p.kind === "chameleon" && p.t % 30 === 0){
    let near = null, best = 140;
    for (const o of w.pets){
      if (o === p) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < best){ best = d; near = o; }
    }
    if (near !== p.mimicOf){
      p.mimicOf = near;
      p.palette = near ? { C: near.blinkCol, D: near.palette.D || near.blinkCol } : p.basePal;
      if (near && Math.random() < 0.4) petSay(p, "슥- 변신!");
      if (near && near.speciesId === "cat") petEventRecord("chameleon_copycat");
    }
  }

  if (p.state === "walk" || p.state === "seekwall"){
    // 종족별 걸음 맵시: 달팽이·거북이=엉금엉금, 카멜레온=느긋, 뱀=꿈틀꿈틀 맥동
    const wf = p.kind === "snail" ? 0.25 : p.kind === "chameleon" ? 0.5
      : p.kind === "snake" ? (0.7 + Math.sin(p.t * 0.15) * 0.5) : 1;
    p.x += p.face * walk * wf;
    if (p.kind === "roller") p.roll += p.face * 4 * p.speed;   // 별·축구공·주사위는 걸을수록 구른다
    if (p.kind === "penguin") p.rot = Math.sin(p.t * 0.35) * 8;                    // 뒤뚱뒤뚱
    if (p.kind === "snake") p.rot = Math.sin(p.t * 0.3) * 3;                       // 스르륵 몸짓
    if (p.trail === "slime" && p.t % 26 === 0) petTrace(p.x + PET_W / 2 - 6, p.y + PET_H - 4, "slime", 3800);
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
      if (--p.timer <= 0) petPickAction(p, w);
    }
  }
  else if (p.state === "idle"){
    if (--p.timer <= 0) petPickAction(p, w);
  }
  else if (p.state === "reboot"){                              // 로봇 방전: 눈이 꺼진 채 멈췄다가 다시 켜진다
    if (p.timer === 20){ p.off = false; p.blink = 0; }
    p.rot = p.timer < 20 ? Math.sin(p.t) * 6 : 0;
    if (--p.timer <= 0){ p.rot = 0; p.off = false; petPickAction(p, w); }
  }
  else if (p.state === "hopwait"){                             // 연필·토끼·슬라임: 잠깐 숨 고르고 다음 콩콩
    if (--p.timer <= 0){
      p.state = "jump"; p.t = 0;
      if (Math.random() < 0.15) p.face *= -1;
      p.vy = -(4 + Math.random() * 3.5);
      p.vx = p.face * (1.4 + Math.random() * 1.4);
    }
  }
  else if (p.state === "stalk"){                               // 고양이: 몸을 낮추고 커서를 향해 살금살금
    const mdx = w.mouse.x - (p.x + PET_W / 2), mdy = w.mouse.y - (p.y + PET_H / 2);
    p.squash = 0.18;
    if (Math.abs(mdx) > 6){ p.face = mdx < 0 ? -1 : 1; p.x += p.face * 0.55 * p.speed; }
    if (Date.now() - w.mouse.ts > 3500 || Math.abs(mdx) > 420 || mdy > 120){       // 커서가 멎었거나 멀어짐: 시치미
      p.squash = 0; p.cool = 350; p.state = "idle"; p.timer = 50 + Math.random() * 80;
    } else if (Math.abs(mdx) < 85 && mdy < 20){                // 사정거리: 덮친다!
      p.squash = 0; p.cool = 550; p.state = "jump"; p.t = 0;
      p.vy = -8.5; p.vx = Math.max(-4, Math.min(4, mdx * 0.06));
      petSay(p, "냐옹!");
    }
  }
  else if (p.state === "chase"){                               // 강아지: 고양이를 향해 전력질주
    const v = p.victim;
    if (!v || !PET_GROUND_STATES.includes(v.state) || --p.timer <= 0){ p.victim = null; petPickAction(p, w); }
    else {
      const dx = v.x - p.x;
      if (Math.abs(dx) > 4){ p.face = dx < 0 ? -1 : 1; p.x += p.face * 2.3 * p.speed; }
      p.rot = p.face * 6;
      if (Math.abs(dx) < 28 && Math.abs(v.y - p.y) < 40){      // 따라잡았다: 왕왕! → 고양이 화들짝
        petSay(p, "멍멍!");
        v.state = "jump"; v.t = 0; v.face = p.face; v.vy = -7.5; v.vx = p.face * 2.8; v.squash = 0;
        petSay(v, "냐앗!?");
        p.victim = null; p.rot = 0; p.state = "idle"; p.timer = 90;
      }
    }
  }
  else if (p.state === "zoomies"){                             // 강아지: 이유 없이 신나서 왕복 질주
    p.x += p.face * 3.1 * p.speed;
    p.rot = p.face * 8;
    const s = p.support;
    if (s && (p.x + PET_W / 2 < s.x + 4 || p.x + PET_W / 2 > s.x + s.w - 4)) p.face *= -1;
    if (p.x <= 0){ p.x = 0; p.face = 1; }
    if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.face = -1; }
    if (Math.random() < 0.02) p.face *= -1;
    if (--p.timer <= 0){ p.rot = 0; petPickAction(p, w); }
  }
  else if (p.state === "charge"){                              // 개구리: 웅크려 힘 모으기(감쇠를 이겨내며 찌부)
    p.squash = Math.min(0.55, p.squash + 0.1);
    if (--p.timer <= 0){
      p.squash = 0; p.state = "jump"; p.t = 0;
      p.vy = -(8 + Math.random() * 3.5); p.vx = p.face * (2 + Math.random() * 1.6);
      if (Math.random() < 0.3) petSay(p, "개굴!");
    }
  }
  else if (p.state === "tongue"){                              // 개구리: 혀 낼름(그리기는 petDraw 가)
    if (--p.timer <= 0) petPickAction(p, w);
  }
  else if (p.state === "slide"){                               // 펭귄: 배를 깔고 주욱 미끄러진다
    p.x += p.vx * p.speed;
    p.vx *= 0.975;
    p.rot = p.face * 82;
    if (p.x <= 0){ p.x = 0; p.vx = Math.abs(p.vx); p.face = 1; }
    if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.vx = -Math.abs(p.vx); p.face = -1; }
    if (Math.abs(p.vx) < 0.4){ p.rot = 0; p.state = "idle"; p.timer = 40 + Math.random() * 80; }
  }
  else if (p.state === "hide"){                                // 달팽이·거북이: 껍질 속으로 쏙(눈도 감는다)
    p.off = true; p.squash = Math.min(0.4, p.squash + 0.1);
    if (--p.timer <= 0){ p.off = false; p.squash = 0; petPickAction(p, w); }
  }
  else if (p.state === "coil"){                                // 뱀: 똬리 틀고 쉬기
    p.squash = Math.min(0.3, p.squash + 0.1);
    if (--p.timer <= 0){ p.squash = 0; petPickAction(p, w); }
  }
  else if (p.state === "flee"){                                // 생쥐: 고양이 반대쪽으로 전력 질주
    p.x += p.face * 2.8 * p.speed;
    p.rot = p.face * 6;
    if (p.x <= 0){ p.x = 0; p.face = 1; }
    if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.face = -1; }
    if (--p.timer <= 0){ p.rot = 0; p.cool = 300; petPickAction(p, w); }
  }
  else if (p.state === "cast"){                                // 마법사: 주문 영창 → 다른 펫을 뿅 하고 순간이동
    p.rot = Math.sin(p.t * 0.6) * 8;
    if (p.timer === 20){
      const targets = w.pets.filter(o => o !== p && o.grav && PET_GROUND_STATES.includes(o.state));
      const v = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
      if (v){
        petSmoke(v.x, v.y);
        const spots = w.platforms.filter(pl => pl.w >= PET_W + 24);
        const pl = spots.length ? spots[Math.floor(Math.random() * spots.length)] : w.platforms[0];
        v.x = pl.x + 6 + Math.random() * Math.max(1, pl.w - PET_W - 12);
        v.y = pl.y - PET_H;
        v.state = "idle"; v.timer = 60; v.rot = 0; v.squash = 0; v.off = false;
        petSmoke(v.x, v.y);
        petSay(v, "어라?!");
        petSay(p, "얍!");
      }
    }
    if (--p.timer <= 0){ p.rot = 0; petPickAction(p, w); }
  }
  else if (p.state === "pull"){                                // 자석: 주변의 중력 펫들을 자력으로 끌어당긴다
    p.rot = Math.sin(p.t * 0.8) * 4;
    for (const o of w.pets){
      if (o === p || !o.grav || !PET_GROUND_STATES.includes(o.state)) continue;
      const dx = p.x - o.x, dist = Math.abs(dx);
      if (dist > 30 && dist < 280 && Math.abs(o.y - p.y) < 60){
        o.x += dx > 0 ? 1.4 : -1.4;
        o.face = dx > 0 ? 1 : -1;
      }
    }
    if (--p.timer <= 0){ p.rot = 0; p.state = "idle"; p.timer = 60; }
  }
  else if (p.state === "stun"){                                // 번개 맞고 띠용...(눈 꺼진 채 비틀비틀)
    p.rot = Math.sin(p.t * 0.7) * 10;
    if (--p.timer <= 0){ p.rot = 0; p.off = false; petPickAction(p, w); }
  }
  else if (p.state === "countdown"){                           // 로켓: 발사 직전 부들부들
    p.rot = p.timer < 30 ? Math.sin(p.t * 1.2) * 4 : 0;
    if (--p.timer <= 0){ p.rot = 0; p.state = "launch"; p.vy = -2; p.t = 0; petSay(p, "발사!"); }
  }
  else if (p.state === "launch"){                              // 로켓: 연기를 뿜으며 가속 상승
    p.vy = Math.max(-9, p.vy - 0.25);
    p.y += p.vy;
    if (p.t % 3 === 0) petTrace(p.x + PET_W / 2 - 9 + Math.random() * 10, p.y + PET_H, "puff", 500);
    if (p.y <= 20){ p.state = "chute"; p.vy = 0; p.t = 0; p.chute.style.display = "block"; petSay(p, "낙하산!"); }
  }
  else if (p.state === "chute"){                               // 로켓: 낙하산 펴고 흔들흔들 귀환
    p.y += 0.9;
    p.x += Math.sin(p.t * 0.05) * 1.2;
    p.rot = Math.sin(p.t * 0.05) * 12;
    p.x = Math.max(0, Math.min(vw - PET_W, p.x));
    if (p.y + PET_H >= vh){
      p.y = vh - PET_H; p.rot = 0; p.squash = 0.3;
      p.chute.style.display = "none";
      p.state = "idle"; p.timer = 80 + Math.random() * 80;
    }
  }
  else if (p.state === "dash"){                                // 닌자: 순간 대시
    p.x += p.face * 5 * p.speed;
    p.rot = p.face * 10;
    if (p.x <= 0){ p.x = 0; p.face = 1; }
    if (p.x >= vw - PET_W){ p.x = vw - PET_W; p.face = -1; }
    if (--p.timer <= 0){ p.rot = 0; petPickAction(p, w); }
  }
  else if (p.state === "vanish"){                              // 닌자: 연막 속에 숨었다가 다른 발판에서 등장
    if (--p.timer <= 0){
      const spots = w.platforms.filter(pl => pl.w >= PET_W + 24);
      const pl = spots.length ? spots[Math.floor(Math.random() * spots.length)] : w.platforms[0];
      p.x = pl.x + 6 + Math.random() * Math.max(1, pl.w - PET_W - 12);
      p.y = pl.y - PET_H;
      p.el.style.opacity = ""; p.el.style.pointerEvents = "";
      petSmoke(p.x, p.y);
      p.state = "idle"; p.timer = 50 + Math.random() * 60;
      if (Math.random() < 0.25) petSay(p, "...늦었다");
    }
  }
  else if (p.state === "digdown"){                             // 두더지: 흙을 튀기며 바닥 밑으로
    p.y += 1.2;
    if (p.t % 5 === 0) petTrace(p.x + PET_W / 2 - 8 + Math.random() * 12, vh - 6, "dirt", 900);
    if (p.y >= vh){ p.state = "burrow"; p.timer = 80 + Math.random() * 140; }
  }
  else if (p.state === "burrow"){                              // 땅속 이동(화면 밖) 후 다른 곳에서 등장
    if (--p.timer <= 0){ p.x = Math.random() * Math.max(1, vw - PET_W); p.state = "digup"; p.t = 0; }
  }
  else if (p.state === "digup"){
    p.y -= 1.4;
    if (p.t % 5 === 0) petTrace(p.x + PET_W / 2 - 8 + Math.random() * 12, vh - 6, "dirt", 900);
    if (p.y <= vh - PET_H){
      p.y = vh - PET_H; p.state = "jump"; p.t = 0; p.vy = -4.5; p.vx = 0;
      if (Math.random() < 0.4) petSay(p, "뿅!");
    }
  }
  else if (p.state === "abduct"){                              // UFO 광선에 끌려 올라가는 중(버둥버둥)
    p.y -= 0.5;
    p.rot = Math.sin(p.t * 0.5) * 20;
    p.off = false; p.squash = 0;                               // 숨거나 웅크리던 중이었어도 깨어난다
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
    if (p.kind === "bird" && p.state === "fall" && p.t > 14){  // 새는 떨어지다 날개를 편다
      p.state = "fly"; p.gTarget = null; p.landT = null; p.rot = 0; p.vx *= 0.5; p.vy = 0;
      return;
    }
    const prevFeet = p.y + PET_H;
    p.vy += PET_GRAV; p.x += p.vx; p.y += p.vy;
    if (p.x < 0){ p.x = 0; p.vx *= -0.6; p.face = 1; }
    if (p.x > vw - PET_W){ p.x = vw - PET_W; p.vx *= -0.6; p.face = -1; }
    if (p.kind === "roller") p.roll += p.vx * 3;
    else p.rot = p.state === "fall" ? Math.sin(p.t * 0.35) * 14 : 0;
    if (p.vy > 0){
      const cx = p.x + PET_W / 2, feet = p.y + PET_H;
      for (const pl of w.platforms){
        if (cx < pl.x || cx > pl.x + pl.w) continue;
        if (prevFeet <= pl.y + 1 && feet >= pl.y){             // 이번 프레임에 윗변을 통과 → 착지
          p.y = pl.y - PET_H; p.vy = 0; p.vx = 0; p.rot = 0;
          p.support = pl;
          if (p.kind === "hopper" || p.kind === "bouncer"){    // 콩콩이들은 바로 다음 점프를 준비
            p.state = "hopwait"; p.timer = 6 + Math.random() * 36;
            if (p.kind === "bouncer") p.squash = 1;            // 슬라임·문어·양은 찌부
            if (p.trail === "scribble") petTrace(p.x + PET_W / 2 - 5, pl.y - 4);                  // 연필 낙서
            else if (p.trail === "dust") petTrace(p.x + PET_W / 2 - 5, pl.y - 4, "dust", 1100);   // 지우개 가루
          } else if (p.kind === "frog"){                       // 개구리는 착지 찌부 후 잠깐 앉는다
            p.state = "idle"; p.timer = 30 + Math.random() * 70; p.squash = 0.5;
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
  const now = performance.now();
  const dt = w.fpsLast ? now - w.fpsLast : 0;
  w.fpsLast = now;
  if (dt > 0 && dt < 1000){                                     // 탭 복귀 등 비정상 간격(>1s)은 무시
    const fps = 1000 / dt;
    w.fpsEma = w.fpsEma ? w.fpsEma * 0.9 + fps * 0.1 : fps;
    if (!w.autoTrimmed && w.pets.length > PET_FPS_FLOOR && now - w.startTs > 3000){
      w.slowMs = w.fpsEma < PET_FPS_MIN ? w.slowMs + dt : 0;    // 워밍업 3초 후, 저FPS 지속 시간 누적
      if (w.slowMs >= PET_FPS_TRIGGER_MS) petAutoThrottle(w);
    }
  }
  if (--w.refresh <= 0){ w.platforms = petCollectPlatforms(); w.refresh = 30; }   // 발판은 0.5초마다 갱신
  if (!petWorldIsQuiet(w) || w.event) petEventTick(w);
  for (const p of w.pets){ petUpdate(p, w); petDraw(p); }
  w.raf = requestAnimationFrame(() => petWorldStep(w));
}

// 저사양 PC에서 프레임이 계속 떨어지면 마릿수를 절반(최소 PET_FPS_FLOOR)으로 줄여 부드럽게 유지한다.
// 세션당 한 번만 동작하며 저장된 설정(petCount)은 건드리지 않는다 — 다음 실행 때 다시 전체 마릿수로 시도.
function petAutoThrottle(w){
  w.autoTrimmed = true;
  const target = Math.max(PET_FPS_FLOOR, Math.floor(w.pets.length / 2));
  if (target >= w.pets.length) return;
  if (w.event){ petEventEnd(w.event, false); w.event = null; }   // 진행 중 이벤트의 펫 참조가 끊기지 않게 먼저 정리
  petTrimTo(w, target);
  w.slowMs = 0; w.fpsEma = 0;
  if (typeof toast === "function") toast(`화면이 버거워 펫을 ${target}마리로 줄였어요. 설정에서 다시 조절할 수 있어요.`);
}
function petTrimTo(w, target){
  while (w.pets.length > target){
    const p = w.pets.pop();
    if (!p) break;
    clearTimeout(p.bubbleTimer);
    if (p.el) p.el.remove();
  }
}

// 붙잡았다 놓았을 때 중력 없는 종족이 돌아가는 상태(물고기는 방울이 터져 파닥거린다)
function petAirRelease(p){
  if (p.kind === "ghost") p.state = "float";
  else if (p.kind === "spider") p.state = "reel";
  else if (p.kind === "balloon") p.state = "rise";
  else if (p.kind === "cloud") p.state = "drift";
  else if (p.kind === "flutter"){ p.state = "flit"; p.victim = null; }
  else if (p.kind === "fish"){ p.state = "flop"; p.timer = 150 + Math.random() * 100; }
  else p.state = "cruise";
  p.gTarget = null;
}

// ----- 붙잡기·던지기·짧은 클릭 -----
function petBindPointer(p){
  let dragging = false, moved = 0, last = null;
  const finishDrag = (cancelled) => {
    if (!dragging) return;
    dragging = false;
    p.el.style.cursor = "grab";
    if (cancelled){
      p.vx = 0; p.vy = 0; p.rot = 0;
      if (p.grav){ p.state = "fall"; p.t = 0; }
      else petAirRelease(p);
      return;
    }
    if (moved < 6){       // 거의 안 움직였으면 클릭: 한마디 + 반응
      petSay(p, p.sayings[Math.floor(Math.random() * p.sayings.length)]);
      if (p.grav){ p.state = "jump"; p.vy = -7; p.vx = 0; p.rot = 0; p.t = 0; }
      else { petAirRelease(p); p.pop = 12; p.vx = 0; p.vy = 0; }
    } else {              // 던지기: 마지막 이동 속도로 날아간다(중력 없는 애들은 관성 미끄러짐)
      p.vx = Math.max(-7, Math.min(7, p.vx));
      p.vy = Math.max(-9, Math.min(6, p.vy));
      if (p.grav){ p.state = "fall"; p.t = 0; }
      else petAirRelease(p);
    }
  };
  p.el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (p.petEvent) petEventEnd(p.petEvent, false);             // 연출 중 붙잡으면 발견 처리 없이 자연스럽게 취소
    if (p.quiet) petWakeFromQuiet(p);                           // 집중 중에도 직접 붙잡는 조작은 즉시 허용
    dragging = true; moved = 0; last = { x:e.clientX, y:e.clientY };
    if (p.kind === "ufo") petUfoAbort(p);                      // 납치 중이었으면 광선을 끄고 피해자를 놓아준다
    p.state = "drag"; p.rot = 0; p.vx = 0; p.vy = 0; p.blink = 0; p.off = false;
    if (p.thread) p.thread.style.display = "none";             // 붙잡힌 거미는 실이 끊긴다
    if (p.bolt){ p.bolt.style.display = "none"; p.victim = null; }   // 번개도 끊긴다
    if (p.chute) p.chute.style.display = "none";               // 낙하산 접힘
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
  p.el.addEventListener("pointerup", () => finishDrag(false));
  p.el.addEventListener("pointercancel", () => finishDrag(true));
  p.el.addEventListener("lostpointercapture", () => finishDrag(true));
}

// 눈꺼풀 색: 스프라이트에서 눈흰자(W) 바로 옆 픽셀의 색 = 그 자리 몸통 색
function petEyelidColor(art, palette){
  for (const row of art){
    const i = row.indexOf("W");
    if (i > 0 && palette[row[i - 1]]) return palette[row[i - 1]];
  }
  const first = Object.values(palette)[0];
  return first || "#999999";
}

// ----- 황금 펫(희귀)·도감 — 만난 종족을 localStorage 에 기록해 도감에서 보여준다 -----
const PET_GOLD_CHANCE = 0.02;         // 등장할 때마다 2% 확률로 금빛 개체
const PET_DEX_KEY = "mn.petDex";
function petSpeciesId(sp){            // 종족 id = PET_ART 에서 그 스프라이트의 키
  if (!sp._id){
    for (const k in PET_ART){ if (PET_ART[k] === sp.art){ sp._id = k; break; } }
  }
  return sp._id || "unknown";
}
function petDexLoad(){
  try { return JSON.parse(localStorage.getItem(PET_DEX_KEY)) || {}; } catch(_){ return {}; }
}
function petDexRecord(id, gold){
  const dex = petDexLoad();
  const e = dex[id] || (dex[id] = { n: 0 });
  e.n++;
  if (gold) e.g = true;
  try { localStorage.setItem(PET_DEX_KEY, JSON.stringify(dex)); } catch(_){}
}
// 원래 색의 밝기만 남기고 금빛 램프에 얹는다 — 어두운 부분은 진한 금갈색, 밝은 부분은 연한 금색
function petGoldColor(hex){
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const t = 0.25 + 0.75 * ((0.299 * (v >> 16 & 255) + 0.587 * (v >> 8 & 255) + 0.114 * (v & 255)) / 255);
  const r = Math.round(120 + 135 * t), g = Math.round(80 + 130 * t), b = Math.round(20 + 60 * t);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function petGoldPalette(pal){
  const out = {};
  for (const k in pal) out[k] = petGoldColor(pal[k]);
  return out;
}

// ----- 펫 한 마리 만들기(켤 때마다 종족 가방에서 겹치지 않게 뽑는다 — 오늘은 누가 나올까) -----
function petSpawn(i, total, bag){
  const species = bag[i % bag.length];
  const speciesId = petSpeciesId(species);
  const gold = Math.random() < PET_GOLD_CHANCE;
  let palette = species.palettes[Math.floor(Math.random() * species.palettes.length)];
  if (gold) palette = petGoldPalette(palette);
  petDexRecord(speciesId, gold);
  const el = document.createElement("div");
  el.className = "pixel-pet";
  el.title = "붙잡아 던질 수 있어요";
  const cv = document.createElement("canvas");
  cv.width = PET_W; cv.height = PET_H;
  const bubble = document.createElement("div");
  bubble.className = "pixel-pet-bubble";
  el.appendChild(cv); el.appendChild(bubble);
  let beam = null, thread = null, bolt = null, orb = null, chute = null;
  if (species.kind === "ufo"){                                 // 납치 광선(평소엔 숨김)
    beam = document.createElement("div");
    beam.className = "pixel-pet-beam";
    el.appendChild(beam);
  }
  if (species.kind === "spider"){                              // 거미줄(천장까지 이어지는 실)
    thread = document.createElement("div");
    thread.className = "pixel-pet-thread";
    el.appendChild(thread);
  }
  if (species.kind === "cloud"){                               // 번개(평소엔 숨김)
    bolt = document.createElement("div");
    bolt.className = "pixel-pet-bolt";
    el.appendChild(bolt);
  }
  if (species.kind === "fish"){                                // 물고기의 비눗방울
    orb = document.createElement("div");
    orb.className = "pixel-pet-orb";
    el.appendChild(orb);
  }
  if (species.kind === "rocket"){                              // 낙하산(귀환할 때만)
    chute = document.createElement("div");
    chute.className = "pixel-pet-chute";
    el.appendChild(chute);
  }
  document.body.appendChild(el);
  const grav = !["ghost", "ufo", "spider", "balloon", "cloud", "flutter", "fish"].includes(species.kind);
  // 등장 방식: 중력 펫은 위에서 흩어져 떨어지고, 부유 펫은 제자리에서, 거미는 천장·구름은 하늘에서 시작
  let y0, state0;
  if (species.kind === "spider"){ y0 = 0; state0 = "ceilwalk"; }
  else if (species.kind === "balloon"){ y0 = window.innerHeight * 0.3 + Math.random() * window.innerHeight * 0.3; state0 = "rise"; }
  else if (species.kind === "cloud"){ y0 = 15 + Math.random() * Math.max(30, window.innerHeight * 0.2); state0 = "drift"; }
  else if (species.kind === "flutter"){ y0 = 60 + Math.random() * Math.max(40, window.innerHeight * 0.4); state0 = "flit"; }
  else if (species.kind === "fish"){ y0 = 80 + Math.random() * Math.max(40, window.innerHeight * 0.4); state0 = "bubble"; }
  else if (!grav){ y0 = 60 + Math.random() * Math.max(40, window.innerHeight * 0.3); state0 = species.kind === "ghost" ? "float" : "cruise"; }
  else { y0 = -PET_H - i * 90; state0 = "fall"; }
  const p = {
    el, cv, bubble, beam, thread, bolt, orb, chute, ctx: cv.getContext("2d"),
    kind: species.kind, speciesId, art: species.art, palette, sayings: species.sayings, gold,
    basePal: palette, mimicOf: null, trail: species.trail || null,
    blinkCol: petEyelidColor(species.art, palette),
    speed: 0.85 + Math.random() * 0.4, grav,
    x: Math.max(0, Math.min(window.innerWidth - PET_W, window.innerWidth * (0.2 + 0.6 * ((i + 1) / (total + 1))))),
    y: y0,
    vx: 0, vy: 0, face: 1, side: -1, rot: 0, roll: 0, squash: 0, pop: 0,
    state: state0,
    t: Math.floor(Math.random() * 100), timer: 60, blink: 0, off: false, fadeT: 0,
    cool: 0, dropLen: 0, hangY: 0, landT: null,
    support: null, gTarget: null, victim: null, bubbleTimer: 0
  };
  petBindPointer(p);
  if (gold) setTimeout(() => { if (p.el.isConnected) petSay(p, "✨ 반짝반짝!"); }, 900 + Math.random() * 600);
  return p;
}

// 2마리 이상이면 아직 발견하지 못한 조합이 가끔 함께 나오게 해 수집이 순수 운에만 좌우되지 않게 한다.
function petEventBiasBag(bag, count){
  if (count < 2 || typeof PET_EVENT_DEFS !== "object" || Math.random() > 0.78) return bag;
  const dex = petEventDexLoad();
  const unseen = PET_EVENT_DEFS.filter(def => !dex[def.id] && def.pets.every(id => !!petSpeciesById(id)));
  if (!unseen.length) return bag;
  const directed = unseen.filter(def => def.scene);
  const choices = directed.length ? directed : unseen;
  const def = choices[Math.floor(Math.random() * choices.length)];
  const first = bag.find(sp => petSpeciesId(sp) === def.pets[0]);
  const second = bag.find(sp => petSpeciesId(sp) === def.pets[1]);
  if (!first || !second) return bag;
  return [first, second, ...bag.filter(sp => sp !== first && sp !== second)];
}

// ----- 켜기/끄기 -----
function petStart(count){
  if (petWorld) return;
  const n = Math.max(1, Math.min(PET_MAX, count || 1));
  // 종족 가방: 전체를 무작위로 섞어(피셔-예이츠) 겹치지 않게 하나씩 나눠 준다
  // sort(() => Math.random()-0.5) 는 원래 순서 근처에 머무는 편향이 있어 같은 펫만 계속 나온다
  const bag = PET_SPECIES.slice();
  for (let i = bag.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
  }
  const arrangedBag = petEventBiasBag(bag, n);
  const w = petWorld = { pets: [], platforms: petCollectPlatforms(), refresh: 30, raf: 0,
    mouse: { x:-9999, y:-9999, ts: 0 }, event:null,
    eventTimer:240 + Math.floor(Math.random() * 180), playedEvents:new Set(),
    rhythm:"normal", typingQuietUntil:0,
    startTs:performance.now(), fpsLast:0, fpsEma:0, slowMs:0, autoTrimmed:false };
  for (let i = 0; i < n; i++) w.pets.push(petSpawn(i, n, arrangedBag));
  w.onResize = () => {
    w.platforms = petCollectPlatforms();
    for (const p of w.pets) p.x = Math.min(p.x, Math.max(0, window.innerWidth - PET_W));
  };
  window.addEventListener("resize", w.onResize);
  // 고양이가 커서를 사냥할 수 있게 마우스 위치를 기억해 둔다
  w.onMouse = (e) => { w.mouse.x = e.clientX; w.mouse.y = e.clientY; w.mouse.ts = Date.now(); };
  window.addEventListener("mousemove", w.onMouse, { passive: true });
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
  if (w.event) petEventEnd(w.event, false);
  cancelAnimationFrame(w.raf);
  window.removeEventListener("resize", w.onResize);
  window.removeEventListener("mousemove", w.onMouse);
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

// ----- 펫 도감: 친구와 숨겨진 행동을 두 탭으로 보여준다 -----
function petDexDrawMini(cv, art, palette, silhouette, scale){
  const s = scale || PET_SCALE;
  cv.width = PET_GW * s; cv.height = PET_GH * s;
  const ctx = cv.getContext("2d");
  for (let r = 0; r < art.length; r++){
    const row = art[r];
    for (let c = 0; c < row.length; c++){
      const ch = row[c];
      if (ch === ".") continue;
      const col = silhouette ? "#3a4150"
        : ch === "W" ? "#ffffff" : ch === "K" ? "#161616" : palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(c * s, r * s, s, s);
    }
  }
}
function renderPetFriendDex(){
  const grid = document.getElementById("petDexGrid");
  if (!grid) return;
  const dex = petDexLoad();
  grid.textContent = "";
  let met = 0, golds = 0;
  for (const sp of PET_SPECIES){
    const id = petSpeciesId(sp);
    const e = dex[id];
    if (e){ met++; if (e.g) golds++; }
    const name = (typeof PET_NAMES === "object" && PET_NAMES[id]) || id;
    const cell = document.createElement("div");
    cell.className = "pet-dex-cell" + (e ? "" : " unmet") + (e && e.g ? " gold" : "");
    const cv = document.createElement("canvas");
    petDexDrawMini(cv, sp.art, sp.palettes[0], !e);
    const nm = document.createElement("span");
    nm.textContent = e ? name : "???";
    cell.appendChild(cv); cell.appendChild(nm);
    if (e){
      cell.title = name + " · " + e.n + "번 만남" + (e.g ? " · 황금 펫도 만났어요!" : "");
      if (e.g){ const b = document.createElement("b"); b.className = "pet-dex-star"; b.textContent = "★"; cell.appendChild(b); }
    } else cell.title = "아직 만나지 못했어요 — 펫을 켤 때마다 무작위로 등장해요";
    grid.appendChild(cell);
  }
  const count = document.getElementById("petDexCount");
  if (count) count.dataset.friends = "만난 친구 " + met + " / " + PET_SPECIES.length
    + (golds ? " · 황금 펫 ★ " + golds + "종" : "") + " — 숨겨진 행동은 펫이 2마리 이상일 때 만날 수 있어요";
}
function renderPetEventDex(){
  const grid = document.getElementById("petEventDexGrid");
  if (!grid || typeof PET_EVENT_DEFS !== "object") return;
  const dex = petEventDexLoad();
  grid.textContent = "";
  let met = 0;
  for (const def of PET_EVENT_DEFS){
    const entry = dex[def.id];
    if (entry) met++;
    const cell = document.createElement("div");
    cell.className = "pet-event-cell " + (entry ? "discovered" : "unmet");
    cell.title = entry ? def.description : def.hint;

    const pair = document.createElement("div");
    pair.className = "pet-event-pair";
    def.pets.forEach((id, index) => {
      if (index){
        const plus = document.createElement("span"); plus.className = "pet-event-plus"; plus.textContent = "+"; pair.appendChild(plus);
      }
      const sp = petSpeciesById(id);
      const cv = document.createElement("canvas");
      if (sp) petDexDrawMini(cv, sp.art, sp.palettes[0], !entry, 2);
      cv.setAttribute("aria-label", entry ? ((PET_NAMES && PET_NAMES[id]) || id) : "숨겨진 펫");
      pair.appendChild(cv);
    });

    const copy = document.createElement("div"); copy.className = "pet-event-copy";
    const title = document.createElement("strong"); title.className = "pet-event-title"; title.textContent = entry ? def.title : "???";
    const detail = document.createElement("span"); detail.className = entry ? "pet-event-desc" : "pet-event-hint";
    detail.textContent = entry ? def.description : def.hint;
    copy.appendChild(title); copy.appendChild(detail);
    cell.appendChild(pair); cell.appendChild(copy);
    if (entry && entry.n > 1){
      const n = document.createElement("span"); n.className = "pet-event-count"; n.textContent = entry.n + "회"; cell.appendChild(n);
    }
    grid.appendChild(cell);
  }
  const count = document.getElementById("petDexCount");
  if (count){
    count.dataset.events = "발견한 행동 " + met + " / " + PET_EVENT_DEFS.length
      + " — 조합이 함께 있으면 아직 못 본 행동이 조금 먼저 일어나요";
    const modal = document.getElementById("petDexModal");
    if (modal && modal.dataset.tab === "events") count.textContent = count.dataset.events;
  }
}
function petDexSetTab(tab){
  tab = tab === "events" ? "events" : "friends";
  const modal = document.getElementById("petDexModal");
  const friendsTab = document.getElementById("petDexFriendsTab");
  const eventsTab = document.getElementById("petDexEventsTab");
  const friends = document.getElementById("petDexGrid");
  const events = document.getElementById("petEventDexGrid");
  const count = document.getElementById("petDexCount");
  if (modal) modal.dataset.tab = tab;
  if (friendsTab){ friendsTab.classList.toggle("active", tab === "friends"); friendsTab.setAttribute("aria-selected", String(tab === "friends")); }
  if (eventsTab){ eventsTab.classList.toggle("active", tab === "events"); eventsTab.setAttribute("aria-selected", String(tab === "events")); }
  if (friends) friends.hidden = tab !== "friends";
  if (events) events.hidden = tab !== "events";
  if (count) count.textContent = tab === "events" ? (count.dataset.events || "") : (count.dataset.friends || "");
}
function openPetDex(tab){
  const modal = document.getElementById("petDexModal");
  if (!modal) return;
  renderPetFriendDex();
  renderPetEventDex();
  const friendsTab = document.getElementById("petDexFriendsTab");
  const eventsTab = document.getElementById("petDexEventsTab");
  if (friendsTab) friendsTab.onclick = () => petDexSetTab("friends");
  if (eventsTab) eventsTab.onclick = () => petDexSetTab("events");
  petDexSetTab(tab || "friends");
  modal.hidden = false;
  const close = document.getElementById("petDexClose");
  if (close) close.focus();                                   // ESC 가 뒤의 설정 창 대신 도감을 닫게
}
