"use strict";

/* ===== 픽셀 펫 행동 도감 =====
   scene 이 있는 항목은 이벤트 감독이 두 펫을 잠시 모아 전용 연출을 재생한다.
   scene 이 없는 항목은 원래 행동 엔진에서 실제 상호작용이 일어났을 때 발견된다.
   데이터와 연출 엔진을 분리해 조합을 추가할 때 거대한 상태 분기를 더 만들지 않게 한다. */
const PET_EVENT_DEFS = [
  {
    id:"pencil_eraser_cleanup", pets:["pencil", "eraser"], scene:"cleanup", duration:300,
    title:"쓱싹쓱싹 대소동", hint:"쓰는 친구와 지우는 친구가 만나면?",
    description:"연필이 신나게 남긴 낙서를 지우개가 부지런히 따라가며 치웠어요.",
    finish:["다 지웠다!", "또 그려도 돼?"]
  },
  {
    id:"magnet_robot_reboot", pets:["magnet", "robot"], scene:"magnet", duration:240,
    title:"자력 과부하", hint:"쇠로 된 친구가 강한 자석 옆에 서면?",
    description:"자석에게 끌려온 로봇이 빙글빙글 돌다가 잠깐 재부팅했어요.",
    finish:["자력 정상!", "재부팅 완료!"]
  },
  {
    id:"ufo_alien_home", pets:["ufo", "alien"], scene:"home", duration:280,
    title:"고향 가는 길?", hint:"우주에서 온 두 친구가 가까워지면?",
    description:"UFO가 외계인을 태우고 화면 밖 우주를 한 바퀴 돌고 왔어요.",
    finish:["별 구경 완료!", "지구가 제일 재밌어!"]
  },
  {
    id:"cloud_frog_rain", pets:["cloud", "frog"], scene:"rain", duration:270,
    title:"개굴개굴 소나기", hint:"비를 좋아하는 친구 머리 위에 구름이 오면?",
    description:"번개구름이 작은 소나기를 내리자 개구리가 신나게 뛰어올랐어요.",
    finish:["개굴! 최고야!", "촉촉하게 완료!"]
  },
  {
    id:"apple_rabbit_chase", pets:["apple", "rabbit"], scene:"apple", duration:270,
    title:"사과를 잡아라!", hint:"아삭한 빨간 친구를 토끼가 발견하면?",
    description:"데굴데굴 달아나는 사과를 토끼가 화면 끝까지 쫓아갔어요.",
    finish:["거의 잡았는데!", "아삭은 다음 기회에!"]
  },
  {
    id:"snail_turtle_race", pets:["snail", "turtle"], scene:"slowrace", duration:360,
    title:"세상에서 가장 느린 경주", hint:"느긋한 두 친구가 출발선에 서면?",
    description:"달팽이와 거북이가 아주 천천히, 하지만 끝까지 경주했어요.",
    finish:["내가 이겼나?", "천천히 가도 도착!"]
  },
  {
    id:"cat_mouse_escape", pets:["cat", "mouse"],
    title:"찍찍! 도망가!", hint:"고양이와 아주 작은 친구가 마주치면?",
    description:"고양이를 발견한 생쥐가 깜짝 놀라 반대편으로 달아났어요."
  },
  {
    id:"dog_cat_chase", pets:["dog", "cat"],
    title:"멍멍! 냐앗!?", hint:"강아지가 고양이를 발견하면?",
    description:"신이 난 강아지가 고양이를 쫓아가 인사를 건넸어요."
  },
  {
    id:"chameleon_copycat", pets:["chameleon", "cat"],
    title:"고양이색 변신", hint:"색을 잘 숨기는 친구가 고양이 곁에 가면?",
    description:"카멜레온이 가까이 있던 고양이의 색을 슬쩍 빌렸어요."
  },
  {
    id:"ufo_rabbit_abduction", pets:["ufo", "rabbit"],
    title:"토끼 납치 미수", hint:"하늘의 수상한 빛이 토끼를 비추면?",
    description:"UFO가 토끼를 데려가려 했지만 이번에도 아슬아슬하게 실패했어요."
  }
];

const PET_EVENT_EN = {
  pencil_eraser_cleanup:{ title:"Scribble cleanup", hint:"What happens when the pencil meets the eraser?", description:"The eraser hurried after the pencil's doodles and cleaned them away.", finish:["All clean!", "Can I draw again?"] },
  magnet_robot_reboot:{ title:"Magnetic overload", hint:"What happens when a metal friend stands by a strong magnet?", description:"The robot spun around the magnet, then paused for a quick reboot.", finish:["Magnet power normal!", "Reboot complete!"] },
  ufo_alien_home:{ title:"The way home?", hint:"What happens when two friends from space meet?", description:"The UFO took the alien for a quick lap around the space beyond the screen.", finish:["Star-gazing complete!", "Earth is the most fun!"] },
  cloud_frog_rain:{ title:"Ribbit rain shower", hint:"What happens when a cloud visits a rain-loving friend?", description:"A tiny shower from the thundercloud sent the frog happily hopping.", finish:["Ribbit! Amazing!", "Nice and damp!"] },
  apple_rabbit_chase:{ title:"Catch that apple!", hint:"What happens when the rabbit spots a crisp red friend?", description:"The rabbit chased the rolling apple all the way to the edge of the screen.", finish:["I almost caught it!", "Crunchy next time!"] },
  snail_turtle_race:{ title:"The world's slowest race", hint:"What happens when two leisurely friends reach the starting line?", description:"The snail and turtle raced very slowly, but made it to the end.", finish:["Did I win?", "Slow still gets there!"] },
  cat_mouse_escape:{ title:"Squeak! Run!", hint:"What happens when a cat meets a very small friend?", description:"The mouse spotted the cat, panicked, and dashed the other way." },
  dog_cat_chase:{ title:"Woof! Meow!?", hint:"What happens when a dog spots a cat?", description:"The excited dog chased the cat over to say hello." },
  chameleon_copycat:{ title:"Cat-colored makeover", hint:"What happens when a color-changing friend gets near a cat?", description:"The chameleon borrowed the color of the nearby cat." },
  ufo_rabbit_abduction:{ title:"Rabbit abduction attempt", hint:"What happens when a strange light shines on a rabbit?", description:"The UFO tried to take the rabbit, but narrowly failed again." }
};

function petEventText(def, key){
  const english = PET_EVENT_EN[def && def.id];
  return petUsesEnglish() && english && english[key] != null ? english[key] : def[key];
}
