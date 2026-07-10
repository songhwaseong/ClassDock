"use strict";

/* ===== 픽셀 펫 데이터(스프라이트·팔레트·대사) =====
   로직은 pet.js 에 있고, 이 파일은 순수 데이터만 담는다(캐릭터 추가는 여기서).
   스프라이트는 15×11 격자를 코드로 그린다 — 이미지 파일 불필요.
   격자 기호: 대문자=팔레트 색 · W=눈흰자 K=눈동자(깜빡임 처리) · .=투명
   종족의 kind 가 이동 방식을 정한다(엔진 목록은 pet.js 참고). */

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
  ],
  cat: [
    "..C.........C..",
    "..CC.......CC..",
    "..CCCCCCCCCCC..",
    "..CWKCCCCCWKC..",
    "..CCCCCNCCCCC..",
    "..CCCCCCCCCCC..",
    "...CCCCCCCCC.D.",
    "...CCCCCCCCCDD.",
    "...CCCCCCCCCD..",
    "...CC....CC....",
    "...CC....CC...."
  ],
  dog: [
    ".EE.........EE.",
    ".EEB.......BEE.",
    "..BBBBBBBBBBB..",
    "..BWKBBBBBWKB..",
    "..BBBBBNNBBBB..",
    "..BBBBBBBBBBB..",
    "...BBBBBBBBB.T.",
    "...BBBBBBBBBTT.",
    "...BBBBBBBBB...",
    "...BB....BB....",
    "...BB....BB...."
  ],
  spider: [
    "L.....L.L.....L",
    ".L....L.L....L.",
    "..L..SSSSS..L..",
    "..LLSSSSSSSLL..",
    "....SWKSWKS....",
    "..LLSSSSSSSLL..",
    "..L..SSSSS..L..",
    ".L....SSS....L.",
    "L......S......L",
    "...............",
    "..............."
  ],
  mole: [
    "...............",
    "....MMMMMMM....",
    "...MMMMMMMMM...",
    "..MMWKMMMWKMM..",
    "..MMMMNNNMMMM..",
    "..MMMMMNMMMMM..",
    ".CMMMMMMMMMMMC.",
    ".CCMMMMMMMMMCC.",
    "..MMMMMMMMMMM..",
    "...MMMMMMMMM...",
    "..MM..MMM..MM.."
  ],
  frog: [
    "..GGG.....GGG..",
    "..GWKG...GWKG..",
    "..GGGGGGGGGGG..",
    ".GGGGGGGGGGGGG.",
    ".GDGGGGGGGGGDG.",
    ".GGGGGGGGGGGGG.",
    ".GGGDDDDDDDGGG.",
    "..GGGGGGGGGGG..",
    "..GGGGGGGGGGG..",
    ".GG.........GG.",
    "GGG.........GGG"
  ],
  penguin: [
    "....PPPPPPP....",
    "...PPPPPPPPP...",
    "...PWKPPPWKP...",
    "...PPPPOPPPP...",
    "..PPPBBBBBPPP..",
    "..PPBBBBBBBPP..",
    "..PPBBBBBBBPP..",
    "..PPBBBBBBBPP..",
    "..PPBBBBBBBPP..",
    "...PPBBBBBPP...",
    "...OO.....OO..."
  ],
  balloon: [
    "....RRRRRRR....",
    "...RRRRRRRRR...",
    "..RRRRRRRRRRR..",
    "..RRWKRRRWKRR..",
    "..RRRRRRRRRRR..",
    "..RRRRDDRRRRR..",
    "...RRRRRRRRR...",
    "....RRRRRRR....",
    "......RRR......",
    ".......D.......",
    "......D.D......"
  ],
  snail: [
    "...........K.K.",
    "...........B.B.",
    "....SSSSS..BBB.",
    "...SSSSSSS.BBB.",
    "..SSSDDDSSSBBB.",
    "..SSDDSDDSSBB..",
    "..SSDDDDDSSBB..",
    "..SSSSSSSSSBB..",
    "...SSSSSSSBBB..",
    "..BBBBBBBBBBB..",
    "..............."
  ],
  ninja: [
    "....NNNNNNN....",
    "...NNNNNNNNN...",
    "...FWKFFFWKF...",
    "...NNNNNNNNN...",
    "....RRRRRRR....",
    "...NNNNNNNNN.R.",
    "..NNNNNNNNNNRR.",
    "..NNNNNNNNNNN..",
    "...NNNNNNNNN...",
    "....NN..NN.....",
    "...NNN..NNN...."
  ],
  bird: [
    "...............",
    "......BBBB.....",
    ".....BBBBBB....",
    ".....BWKBBBOO..",
    "....BBBBBBBB...",
    ".TTBBLLLLBBB...",
    "TTTBBLLLLBBB...",
    ".TTBBBBBBBB....",
    "....BBBBBB.....",
    ".....O...O.....",
    "..............."
  ],
  rabbit: [
    "...RR....RR....",
    "...RIR..RIR....",
    "...RIR..RIR....",
    "...RRRRRRRR....",
    "..RRRRRRRRRR...",
    "..RWKRRRRWKR...",
    "..RRRRNNRRRR...",
    "..RRRRRRRRRR...",
    "...RRRRRRRR....",
    "...RR.RR.RR....",
    "...RR....RR...."
  ],
  soccer: [
    ".....AAAAA.....",
    "...AADAAADAA...",
    "..AADDAAADDAA..",
    "..AAAAAAAAAAA..",
    ".AAWKAAAAWKAA..",
    ".AADAAADDAADAA.",
    ".AADAAADDAADAA.",
    "..AAAAAAAAAAA..",
    "..AADAAAAADAA..",
    "...AADAADAA....",
    ".....AAAAA....."
  ],
  chameleon: [
    "...............",
    "......CCCCCC...",
    ".....CCCCCCCC..",
    "..D..CCWKCCCC..",
    ".DDD.CCCCCCCC..",
    ".D.D.CCCCCCCC..",
    ".DDDCCCCCCCCC..",
    "....CCCCCCCC...",
    "....CCCCCCCC...",
    "....CC..CC.....",
    "....CC..CC....."
  ],
  wizard: [
    ".......H.......",
    "......HHH......",
    ".....HHHHH.....",
    "....HHHHHHH....",
    "..HHHHHHHHHHH..",
    "....FWKFFFWK...",
    "....FFFFFFF....",
    "...RRRRRRRRR...",
    "..RRRRRRRRRRR..",
    "..RRRRRRRRRRR..",
    "...RR.....RR..."
  ],
  magnet: [
    "..SSS.....SSS..",
    "..RRR.....RRR..",
    "..RRR.....RRR..",
    "..RRR.....RRR..",
    "..RRR.....RRR..",
    "..RRRR...RRRR..",
    "..RRRRRRRRRRR..",
    "...RRWKRWKRR...",
    "...RRRRRRRRR...",
    "....RR...RR....",
    "....RR...RR...."
  ],
  cloud: [
    "....GGGGG......",
    "..GGGGGGGGG....",
    ".GGGGGGGGGGGG..",
    ".GGWKGGGGWKGG..",
    "GGGGGGGGGGGGGG.",
    ".GGGGGGGGGGGG..",
    "..GGGGGGGGGG...",
    "....Y......Y...",
    "...Y......Y....",
    "...............",
    "..............."
  ],
  rocket: [
    ".......N.......",
    "......NNN......",
    "......RRR......",
    ".....RRRRR.....",
    ".....RWKRR.....",
    ".....RRRRR.....",
    "....FRRRRRF....",
    "...FFRRRRRFF...",
    "...FF.RRR.FF...",
    "...............",
    "..............."
  ],
  butterfly: [
    "......D.D......",
    ".BBB.DDWKD.BBB.",
    "BBBB..DDD..BBBB",
    "BBBBB.DDD.BBBBB",
    "BBBBBBDDDBBBBBB",
    "BBBBB.DDD.BBBBB",
    ".BBBB.DDD.BBBB.",
    "..BBB.DDD.BBB..",
    "..BB...D...BB..",
    "...............",
    "..............."
  ],
  fish: [
    "...............",
    "...............",
    "......FFFFF....",
    ".T...FFFFFFF...",
    "TT..FFFWKFFFF..",
    "TTT.FFFFFFFFFF.",
    "TT..FFFFFFFFF..",
    ".T...FFFFFFF...",
    "......FFFFF....",
    "........LL.....",
    "..............."
  ],
  snake: [
    "...............",
    "...............",
    "...............",
    "...............",
    "..........SSSS.",
    ".........SSWKS.",
    "..SSSS...SSSS..",
    ".SSSSSS.SSSSS..",
    ".SSDSSSSSSSDSS.",
    "..SSSSSSSSSSS..",
    "..............."
  ],
  mouse: [
    "...............",
    "...MM...MM.....",
    "..MEEM.MEEM....",
    "..MMMMMMMMM....",
    ".MMWKMMMWKMM...",
    ".MMMMMNMMMMM...",
    ".MMMMMMMMMMM.T.",
    "..MMMMMMMMM.TT.",
    "..MMMMMMMMMT...",
    "...MM..MM......",
    "..............."
  ],
  turtle: [
    "...............",
    "...............",
    "....SSSSSS.....",
    "...SSPPPPSS....",
    "..SSPPSSPPSS...",
    ".SSSSSSSSSSS.BB",
    ".SSSSSSSSSSSBWK",
    ".SSSSSSSSSSS.BB",
    "..BBSSSSSSBB...",
    "..BB......BB...",
    "..............."
  ],
  octopus: [
    "....OOOOOOO....",
    "...OOOOOOOOO...",
    "..OOOOOOOOOOO..",
    "..OOWKOOOWKOO..",
    "..OOOOOOOOOOO..",
    "..OOOODDOOOOO..",
    "...OOOOOOOOO...",
    "..O.O.OOO.O.O..",
    ".O..O..O..O..O.",
    ".O..O..O..O..O.",
    "..............."
  ],
  bat: [
    "...B.......B...",
    "...BB.....BB...",
    "....BBBBBBB....",
    "....BWKBWKB....",
    "BB..BBBBBBB..BB",
    "BBBBBBBBBBBBBBB",
    "BBB.BBBBBBB.BBB",
    "BB..BBBBBBB..BB",
    ".....BBBBB.....",
    "...............",
    "..............."
  ],
  owl: [
    "...O.......O...",
    "..OOOOOOOOOOO..",
    "..OFFFFOFFFFO..",
    "..OFWKFOFWKFO..",
    "..OFFFFBFFFFO..",
    "..OOOOOBOOOOO..",
    "..OOLLOOOLLOO..",
    "..OOLLOOOLLOO..",
    "...OOOOOOOOO...",
    "....BB...BB....",
    "..............."
  ],
  duck: [
    ".......YYYY....",
    "......YYYYYY...",
    "......YWKYYYOO.",
    "......YYYYYY...",
    "...YYYYYYYYY...",
    "..YYYYYYYYYYY..",
    "..YYYYYYYYYYY..",
    "..YYYYYYYYYY...",
    "...YYYYYYYY....",
    ".....OO..OO....",
    "..............."
  ],
  squirrel: [
    "TTT............",
    "TTTT..SS..SS...",
    "TTTT..SSSSSS...",
    ".TTT.SSWKSWKS..",
    ".TTT.SSSSSSSS..",
    ".TTTSSSCCSSSS..",
    ".TTTSSSCCSSS...",
    "..TTSSSSSSSS...",
    "...SSSSSSSSS...",
    "...SS..SS......",
    "..............."
  ],
  hedgehog: [
    "..H.H.H.H.H....",
    ".HHHHHHHHHH....",
    ".HHHHHHHHHHH...",
    "HHHHHHHHHHHFF..",
    "HHHHHHHHHHFWKF.",
    "HHHHHHHHHHFFFN.",
    "HHHHHHHHHHHFFF.",
    ".HHHHHHHHHHFF..",
    "..HHHHHHHHHH...",
    "...FF....FF....",
    "..............."
  ],
  hamster: [
    "...HH.....HH...",
    "..HHHHHHHHHHH..",
    ".HHHHHHHHHHHHH.",
    ".HHWKHHHHWKHH..",
    ".HHHHHNNHHHHH..",
    ".HCCHHHHHHCCH..",
    ".HHHHHHHHHHHH..",
    "..HHHHHHHHHHH..",
    "..HHHHHHHHHH...",
    "...HH....HH....",
    "..............."
  ],
  bee: [
    "....B.....B....",
    "...BBB...BBB...",
    "...BBBB.BBBB...",
    "..YYYYYYYYYY...",
    ".YYWKYDDYYDDY..",
    ".YYYYYDDYYDDYY.",
    "..YYYYDDYYDDY..",
    "...YYYYYYYYY.D.",
    "...............",
    "...............",
    "..............."
  ],
  ladybug: [
    "...............",
    "....D.....D....",
    "....DDDDDDD....",
    "...DWKDDDWKD...",
    "..RRRRRDRRRRR..",
    ".RRDRRRDRRRDRR.",
    ".RRRRRRDRRRRRR.",
    ".RRDRRRDRRRDRR.",
    "..RRRRRDRRRRR..",
    "...RRRRDRRRR...",
    "..D..D...D..D.."
  ],
  dice: [
    "..AAAAAAAAAAA..",
    ".AAAAAAAAAAAAA.",
    ".ADDAAAAAAADDA.",
    ".ADDAAAAAAADDA.",
    ".AAAAWKAWKAAAA.",
    ".AAAAAAAAAAAAA.",
    ".AAAADDDDDAAAA.",
    ".ADDAAAAAAADDA.",
    ".ADDAAAAAAADDA.",
    ".AAAAAAAAAAAAA.",
    "..AAAAAAAAAAA.."
  ],
  apple: [
    ".......S.......",
    "......SS.LL....",
    ".....SS.LLLL...",
    "...RRRRRRRRR...",
    "..RRRRRRRRRRR..",
    ".RRWKRRRRWKRR..",
    ".RRRRRRRRRRRR..",
    ".RRRRRRRRRRRR..",
    "..RRRRRRRRRRR..",
    "..RRRR...RRRR..",
    "..............."
  ],
  eraser: [
    "...............",
    "...............",
    "..EEEEEEEEEEE..",
    ".EEEEEEEEEEEEE.",
    ".EEWKEEEEWKEE..",
    ".EEEEEEEEEEEEE.",
    ".AAAAAAAAAAAAA.",
    ".AAAAAAAAAAAAA.",
    ".AAAAAAAAAAAAA.",
    "..AAAAAAAAAAA..",
    "..............."
  ],
  mushroom: [
    "....RRRRRRR....",
    "..RRRRRRRRRRR..",
    ".RRARRRRRRARR..",
    ".RRRRRAARRRRR..",
    ".RRRRRRRRRRRR..",
    "....FFFFFFF....",
    "....FWKFWKF....",
    "....FFFFFFF....",
    "....FFFFFFF....",
    "....FF...FF....",
    "..............."
  ],
  carrot: [
    "....LL.LL.LL...",
    ".....LLLLL.....",
    "....OOOOOOO....",
    "....OOOOOOO....",
    "....OWKOWKO....",
    "....OOOOOOO....",
    ".....OOOOO.....",
    ".....OOOOO.....",
    "......OOO......",
    "......OOO......",
    ".......O......."
  ],
  dino: [
    "......GGGGGG...",
    "......GWKGGG...",
    "......GGGGGG...",
    "......GGGG.....",
    "G....GGGGGG....",
    "GG..GGGGGGG....",
    "GGGGGGGGGGG....",
    ".GGGGGGGGGG....",
    "..GGGGGGGGG....",
    "....GG...GG....",
    "....GG...GG...."
  ],
  snowman: [
    "....HHHHH......",
    "....HHHHH......",
    "...AAAAAAA.....",
    "...AWKAWKA.....",
    "...AAAOAAA.....",
    "..AAAAAAAAA....",
    ".AAAADAAAAA....",
    ".AAAAAAAAAA....",
    ".AAAADAAAAA....",
    "..AAAAAAAAA....",
    "...AAAAAAA....."
  ],
  alien: [
    "....G.....G....",
    ".....G...G.....",
    "....GGGGGGG....",
    "..GGGGGGGGGGG..",
    ".GGWKGGGGGWKGG.",
    ".GGGGGGGGGGGGG.",
    "..GGGGDDDGGGG..",
    "...GGGGGGGGG...",
    "....GGGGGGG....",
    "....GG...GG....",
    "....GG...GG...."
  ],
  ant: [
    "...............",
    "...............",
    "...............",
    "..D.........D..",
    "...D..DDD..D...",
    "..DDD.DDD.DDDD.",
    ".DDDDDDDDDDWKD.",
    "..DDD.DDD.DDD..",
    ".D..D.D.D.D..D.",
    "...............",
    "..............."
  ],
  pig: [
    "..PP.......PP..",
    ".PPPPPPPPPPPPP.",
    ".PPWKPPPPWKPP..",
    ".PPPPNNNNPPPP..",
    ".PPPPPPPPPPPPP.",
    ".PPPPPPPPPPPPP.",
    "..PPPPPPPPPPP..",
    "..PPPPPPPPPPP..",
    "...PPPPPPPPP...",
    "...PP.....PP...",
    "...PP.....PP..."
  ],
  sheep: [
    "...AAAAAAA.....",
    "..AAAAAAAAAA...",
    ".AAAAAAAAAAFFF.",
    ".AAAAAAAAAAFWK.",
    ".AAAAAAAAAAFFF.",
    ".AAAAAAAAAAAA..",
    "..AAAAAAAAAA...",
    "..AAAAAAAAAA...",
    "...AAAAAAAA....",
    "...FF....FF....",
    "...FF....FF...."
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
  { kind:"hopper", art:PET_ART.pencil, trail:"scribble", palettes: [
      { P:"#f9a8d4", Y:"#fbbf24", M:"#d6a05c", T:"#161616" }     // 노랑 연필(T=심)
    ],
    sayings: ["사각사각", "글씨 연습!", "낙서는 즐거워", "필기 화이팅", "콩콩"] },
  { kind:"roller", art:PET_ART.star, palettes: [
      { Y:"#fcd34d" }                                            // 금색 별
    ],
    sayings: ["반짝!", "데굴데굴", "별일 없죠?", "빛나는 중", "어지러워~"] },
  { kind:"cat", art:PET_ART.cat, palettes: [
      { C:"#9aa3ad", D:"#6b7480", N:"#e89aa8" },                 // 회색 고양이
      { C:"#e8a94f", D:"#b57d2c", N:"#e89aa8" },                 // 치즈 고양이
      { C:"#4a4f5a", D:"#32363f", N:"#e89aa8" }                  // 검은 고양이
    ],
    sayings: ["야옹~", "...귀찮다냥", "츄르 있어요?", "골골골", "커서 어딨지?", "냐하!", "낮잠 시간이다냥"] },
  { kind:"dog", art:PET_ART.dog, palettes: [
      { B:"#c78d55", E:"#8a5a30", N:"#4a3220", T:"#8a5a30" },    // 갈색 강아지
      { B:"#f0ede5", E:"#c9b89a", N:"#4a3220", T:"#c9b89a" }     // 하양 강아지
    ],
    sayings: ["멍멍!", "산책 가요!", "꼬리 살랑살랑", "킁킁... 간식 냄새?", "왈!", "고양이 어딨지?"] },
  { kind:"spider", art:PET_ART.spider, palettes: [
      { S:"#4a4552", L:"#2f2b38" },                              // 먹색 거미
      { S:"#7a3b3b", L:"#4a2424" }                               // 붉은 거미
    ],
    sayings: ["줄타기 실력 봤어요?", "스르륵~", "안 물어요!", "대롱대롱", "깜짝 놀랐죠?", "거미줄은 튼튼해"] },
  { kind:"mole", art:PET_ART.mole, palettes: [
      { M:"#8a6a4f", N:"#e89aa8", C:"#e5d9c5" }                  // 갈색 두더지
    ],
    sayings: ["두더지 잡기 금지!", "땅속은 아늑해", "여기서 뿅!", "흙 묻었나?", "어두운 게 좋아", "뿅!"] },
  { kind:"frog", art:PET_ART.frog, palettes: [
      { G:"#5cbf5c", D:"#2f8f3f" },                              // 초록 개구리
      { G:"#d4c94f", D:"#a89a2c" }                               // 황금 개구리
    ],
    sayings: ["개굴!", "개굴개굴", "점프 준비...", "파리 어딨지?", "비 오면 신나요", "폴짝!"] },
  { kind:"penguin", art:PET_ART.penguin, palettes: [
      { P:"#2f3542", B:"#f2f2ee", O:"#f2a33c" }                  // 턱시도 펭귄
    ],
    sayings: ["뒤뚱뒤뚱", "미끄럼 최고!", "시원한 게 좋아", "꽥!", "배로 슝~", "남극에서 왔어요"] },
  { kind:"balloon", art:PET_ART.balloon, palettes: [
      { R:"#e85d5d", D:"#b53a3a" },                              // 빨강 풍선
      { R:"#5d9de8", D:"#3a6bb5" },                              // 파랑 풍선
      { R:"#f2c94c", D:"#c9992c" }                               // 노랑 풍선
    ],
    sayings: ["둥실둥실~", "날 놓치지 마세요", "바람 빠지면 어쩌지", "하늘은 좋아", "팡 터지면 안 돼요!", "두둥실"] },
  { kind:"snail", art:PET_ART.snail, trail:"slime", palettes: [
      { S:"#c9995c", D:"#8a6435", B:"#b8d48f" }                  // 연두 달팽이
    ],
    sayings: ["느려도 괜찮아", "내 집 좋죠?", "꾸준함이 최고!", "서두르지 마세요", "음~ 촉촉해", "달팽이도 갑니다"] },
  { kind:"ninja", art:PET_ART.ninja, palettes: [
      { N:"#3a3f4a", F:"#e8c9a8", R:"#d64545" }                  // 검은 닌자
    ],
    sayings: ["...!", "닌닌!", "연막술!", "조용히...", "날 봤다면 이미 늦었다", "슉!"] },
  { kind:"bird", art:PET_ART.bird, palettes: [
      { B:"#5aa3e8", L:"#a8d0f2", O:"#e8892c", T:"#3f7fd6" },    // 파랑새
      { B:"#b08a5c", L:"#d9c9a8", O:"#7a5a30", T:"#8a6a40" }     // 참새
    ],
    sayings: ["짹짹!", "훨훨~", "높이 나는 게 최고", "여기 앉아도 돼요?", "포로롱", "바람 타는 중~"] },
  { kind:"hopper", art:PET_ART.rabbit, palettes: [
      { R:"#f2f0ea", I:"#f2b8c8", N:"#e88a9a" },                 // 흰 토끼
      { R:"#b8bcc4", I:"#f2b8c8", N:"#e88a9a" }                  // 회색 토끼
    ],
    sayings: ["깡총!", "당근 주세요", "귀가 간지러워", "깡총깡총", "엉덩이 실룩", "토끼는 빨라요"] },
  { kind:"roller", art:PET_ART.soccer, palettes: [
      { A:"#f2f2ee", D:"#2f3542" }                               // 축구공
    ],
    sayings: ["뻥 차지 마세요!", "데굴데굴", "골인~!", "오늘 체육 있나요?", "슛~!", "동글동글"] },
  { kind:"chameleon", art:PET_ART.chameleon, palettes: [
      { C:"#5fbf6f", D:"#3a8f4a" }                               // 초록 카멜레온(옆 친구 색을 복사한다)
    ],
    sayings: ["무슨 색이 좋아요?", "슥- 변신!", "날 찾아보세요", "혀는 빠르답니다", "분위기 맞춰봤어요", "오늘의 색은 이거!"] },
  { kind:"wizard", art:PET_ART.wizard, palettes: [
      { H:"#7c5cd6", F:"#e8c9a8", R:"#5a3fb5" }                  // 보라 마법사
    ],
    sayings: ["수리수리 마수리~", "얍!", "마법은 장난이 아니야", "순간이동 보여줄까?", "지팡이 어디 갔지", "숙제 사라져라... 뻥!"] },
  { kind:"magnet", art:PET_ART.magnet, palettes: [
      { R:"#d65454", S:"#c9cdd6" }                               // 빨간 말굽자석
    ],
    sayings: ["철컥!", "끌리는 대로~", "N극? S극?", "우린 서로 끌려요", "자석은 힘이 세다", "붙지 마세요!"] },
  { kind:"cloud", art:PET_ART.cloud, palettes: [
      { G:"#7a8494", Y:"#fde047" }                               // 먹구름
    ],
    sayings: ["우르릉...", "비 올 것 같죠?", "콰르릉!", "전기 조심", "먹구름 아니에요... 맞아요", "번쩍!"] },
  { kind:"rocket", art:PET_ART.rocket, palettes: [
      { N:"#d65454", R:"#e8e8e2", F:"#8a94a6" }                  // 흰 로켓
    ],
    sayings: ["3, 2, 1... 발사!", "우주까지 갑니다", "연료 만땅!", "슈우웅~", "낙하산 펴짐", "달나라 가고 싶다"] },
  { kind:"flutter", art:PET_ART.butterfly, palettes: [
      { B:"#e8a0c8", D:"#4a4552" },                              // 분홍 나비
      { B:"#8ab8f2", D:"#4a4552" }                               // 파랑 나비
    ],
    sayings: ["팔랑팔랑~", "꽃이 어딨나요?", "날개 예쁘죠?", "살랑살랑", "봄이 좋아요", "앉아도 될까요?"] },
  { kind:"fish", art:PET_ART.fish, palettes: [
      { F:"#f2a04c", T:"#d67d2c", L:"#f2c98f" }                  // 주황 물고기(비눗방울 탑승)
    ],
    sayings: ["뻐끔뻐끔", "방울 안은 안전해요", "물이 그리워", "뻐끔?", "수영 잘해요", "방울 터뜨리지 마세요!"] },
  { kind:"snake", art:PET_ART.snake, palettes: [
      { S:"#6fbf5f", D:"#3f8f3a" },                              // 초록 뱀
      { S:"#d6b054", D:"#a8842c" }                               // 황금 뱀
    ],
    sayings: ["스르륵~", "쉬이익-", "다리는 필요 없어", "꼬불꼬불", "혀 낼름", "놀라지 마세요"] },
  { kind:"mouse", art:PET_ART.mouse, palettes: [
      { M:"#a8adb8", E:"#f2b8c8", N:"#e89aa8", T:"#c99a9a" }     // 회색 생쥐
    ],
    sayings: ["찍찍!", "치즈 어딨지?", "고양이 조심!", "찍!", "구멍 어디 갔지", "빠르죠?"] },
  { kind:"snail", art:PET_ART.turtle, palettes: [
      { S:"#5fa86f", P:"#3f7a4a", B:"#c9b98f" }                  // 거북이(느림보 동료, 점액은 없음)
    ],
    sayings: ["엉금엉금", "느린 게 아니라 신중한 거예요", "토끼야 기다려", "등껍질은 내 집", "서두르면 지는 거야", "음~ 여유"] },
  { kind:"bouncer", art:PET_ART.octopus, palettes: [
      { O:"#b08ad6", D:"#7a5aa8" }                               // 보라 문어
    ],
    sayings: ["꿈틀꿈틀", "먹물 아껴 쓰는 중", "다리가 여덟 개!", "흐물흐물", "바다가 그리워", "꾹 누르면 먹물 나와요... 뻥"] },
  { kind:"bird", art:PET_ART.bat, palettes: [
      { B:"#5a5468" }                                            // 박쥐
    ],
    sayings: ["끼익끼익", "거꾸로가 편해요", "밤이 좋아", "초음파 발사!", "깜깜한 게 최고", "낮잠... 아니 밤잠"] },
  { kind:"bird", art:PET_ART.owl, palettes: [
      { O:"#a8845c", F:"#e8d9b8", B:"#e8a04c", L:"#8a6a48" }     // 부엉이
    ],
    sayings: ["부엉부엉", "밤샘은 자신 있어요", "누구? 누구?", "지혜의 새랍니다", "고개가 잘 돌아가요", "공부 열심히!"] },
  { kind:"penguin", art:PET_ART.duck, palettes: [
      { Y:"#f2d54c", O:"#f2a33c" }                               // 오리(뒤뚱뒤뚱+배 미끄럼)
    ],
    sayings: ["꽥꽥!", "궁둥이 실룩", "물갈퀴 자랑", "꽥?", "미끄럼 가자~", "오리걸음 챌린지"] },
  { kind:"climber", art:PET_ART.squirrel, palettes: [
      { T:"#d68f4a", S:"#b06a35", C:"#f2d9b8" }                  // 다람쥐(나무 대신 벽 타기)
    ],
    sayings: ["도토리 어딨지?", "다다다닥!", "볼주머니 가득~", "나무 타기 선수", "겨울 준비 중", "폴짝폴짝"] },
  { kind:"roller", art:PET_ART.hedgehog, palettes: [
      { H:"#7a6a58", F:"#e8c9a0", N:"#3a3630" }                  // 고슴도치(동글동글)
    ],
    sayings: ["따가워요? 미안!", "데굴데굴~", "가시는 장식이에요", "동글동글", "만지려면 살살", "슈웅~"] },
  { kind:"roller", art:PET_ART.hamster, palettes: [
      { H:"#f2d9a8", C:"#e8a868", N:"#e89aa8" }                  // 햄스터(공처럼 구른다)
    ],
    sayings: ["볼이 빵빵해요", "쳇바퀴 어딨지?", "해바라기씨 주세요", "데굴데굴", "오물오물", "낮잠 자고 싶다"] },
  { kind:"flutter", art:PET_ART.bee, palettes: [
      { Y:"#f2c94c", D:"#3a3630", B:"#dbe8f2" }                  // 꿀벌
    ],
    sayings: ["붕붕~", "꿀 모으는 중!", "꽃가루 배달이요~", "윙윙", "일벌은 바빠요", "쏘지 않을게요"] },
  { kind:"climber", art:PET_ART.ladybug, palettes: [
      { R:"#d65454", D:"#2f2b30" }                               // 무당벌레(벽 타기 선수)
    ],
    sayings: ["점무늬 세보실래요?", "행운을 드려요!", "반질반질", "작아도 잘 날아요", "진딧물 어딨지", "콩콩"] },
  { kind:"roller", art:PET_ART.dice, palettes: [
      { A:"#f2f2ee", D:"#3a3f4a" }                               // 주사위(데굴데굴 굴러다닌다)
    ],
    sayings: ["데구르르...", "몇이 나올까요?", "6 나와라!", "굴려굴려~", "운에 맡겨요", "주사위는 던져졌다!"] },
  { kind:"hopper", art:PET_ART.apple, palettes: [
      { R:"#d65454", L:"#6fbf5f", S:"#8a6a48" }                  // 사과
    ],
    sayings: ["아삭!", "하루 한 알!", "빨갛게 익었어요", "벌레 없어요", "비타민 충전~", "떨어져도 안 아파요"] },
  { kind:"bouncer", art:PET_ART.eraser, trail:"dust", palettes: [
      { E:"#f2a0b8", A:"#f2f2ee" }                               // 지우개(착지하면 가루가 남는다)
    ],
    sayings: ["쓱싹쓱싹", "실수는 지우면 돼요", "지우개 가루 미안!", "깨끗하게~", "틀려도 괜찮아", "반으로 자르지 마세요!"] },
  { kind:"hopper", art:PET_ART.mushroom, palettes: [
      { R:"#d65454", A:"#f2f2ee", F:"#e8d9c0" }                  // 버섯
    ],
    sayings: ["버섯버섯", "쑥쑥 자라요", "비 온 뒤가 좋아", "폴짝!", "독 없어요, 아마도", "숲에서 왔어요"] },
  { kind:"hopper", art:PET_ART.carrot, palettes: [
      { O:"#e8923c", L:"#6fbf5f" }                               // 당근
    ],
    sayings: ["아삭아삭", "토끼가 쫓아와요!", "주황이 제일 예뻐", "비타민A 담당", "흙은 툭툭 털었어요", "머리숱 자랑"] },
  { kind:"walker", art:PET_ART.dino, palettes: [
      { G:"#6fae5f" },                                           // 초록 공룡
      { G:"#b08ad6" }                                            // 보라 공룡
    ],
    sayings: ["쿵쿵!", "크앙~", "팔이 좀 짧아요", "공룡은 멋져", "운석은 무서워", "화석 아니에요!"] },
  { kind:"walker", art:PET_ART.snowman, palettes: [
      { A:"#f2f2f0", D:"#3a3f4a", O:"#e8923c", H:"#4a4f5a" }     // 눈사람
    ],
    sayings: ["안 녹게 조심!", "시원한 게 좋아", "눈사람은 겨울 담당", "코가 당근이에요", "굴려서 만들어졌어요", "호호 춥다"] },
  { kind:"ninja", art:PET_ART.alien, palettes: [
      { G:"#8fd65f", D:"#4a8f2c" }                               // 외계인(순간이동 담당)
    ],
    sayings: ["삐리삐리?", "지구는 재밌군", "우리 별로 갈래?", "외계어 할 줄 알아요", "뿅!", "UFO 는 내 친구"] },
  { kind:"climber", art:PET_ART.ant, palettes: [
      { D:"#4a4038" }                                            // 개미(벽쯤이야)
    ],
    sayings: ["영차영차", "일개미는 바빠요", "줄 맞춰서~", "힘은 장사예요", "설탕 어딨지?", "아자아자!"] },
  { kind:"walker", art:PET_ART.pig, palettes: [
      { P:"#f2b8c0", N:"#e08a98" }                               // 돼지
    ],
    sayings: ["꿀꿀!", "진흙 목욕 최고", "꿀꿀꿀", "배고파요", "코가 매력 포인트", "뒹굴뒹굴"] },
  { kind:"bouncer", art:PET_ART.sheep, palettes: [
      { A:"#f2f0ea", F:"#4a4540" }                               // 양(폭신폭신 통통)
    ],
    sayings: ["메에에~", "폭신폭신", "털 깎을 때 됐나?", "양 한 마리, 양 두 마리...", "구름 아니에요", "포근하죠?"] }
];

// 도감 표시용 이름표 — PET_ART 의 키가 종족 id 가 된다(pet.js 가 art 로 역추적).
const PET_NAMES = {
  crab:"게", chick:"병아리", robot:"로봇", ghost:"유령", slime:"슬라임",
  ufo:"UFO", pencil:"연필", star:"별", cat:"고양이", dog:"강아지",
  spider:"거미", mole:"두더지", frog:"개구리", penguin:"펭귄", balloon:"풍선",
  snail:"달팽이", ninja:"닌자", bird:"새", rabbit:"토끼", soccer:"축구공",
  chameleon:"카멜레온", wizard:"마법사", magnet:"자석", cloud:"번개구름", rocket:"로켓",
  butterfly:"나비", fish:"물고기", snake:"뱀", mouse:"생쥐", turtle:"거북이",
  octopus:"문어", bat:"박쥐", owl:"부엉이", duck:"오리", squirrel:"다람쥐",
  hedgehog:"고슴도치", hamster:"햄스터", bee:"꿀벌", ladybug:"무당벌레", dice:"주사위",
  apple:"사과", eraser:"지우개", mushroom:"버섯", carrot:"당근", dino:"공룡", snowman:"눈사람",
  alien:"외계인", ant:"개미", pig:"돼지", sheep:"양"
};
