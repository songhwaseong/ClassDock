"use strict";

const PhotoAlbum = (() => {
  const ART_DRAG_MIME = "application/x-classdock-photo-album-art";
  const backgrounds = [
    ["white","화이트","#f8fafc","#e4ebf5"], ["pink","핑크","#ffe3ee","#f7b8d0"],
    ["sky","하늘","#def3ff","#8fcdf6"], ["mint","민트","#dff9e9","#8ed6c1"],
    ["violet","라벤더","#efe8ff","#b8a3e9"], ["sunset","노을","#ffd1ae","#ed88a5"],
    ["night","밤하늘","#30466b","#111827"]
  ];
  const art = [
    ["round","안경","동그란 안경",40,40,39,'<circle cx="31" cy="40" r="20" fill="none" stroke="#242937" stroke-width="7"/><circle cx="89" cy="40" r="20" fill="none" stroke="#242937" stroke-width="7"/><path d="M51 38q9-8 18 0M11 36 1 31m108 5 10-5" fill="none" stroke="#242937" stroke-width="6"/>'],
    ["sun","안경","선글라스",40,40,40,'<path d="M8 27h46l-5 35q-20 13-36-5L8 27Zm58 0h46l-5 30q-16 18-36 5L66 27Z" fill="#273145" stroke="#101827" stroke-width="5"/><path d="M53 33q7-7 14 0M7 31 0 25m113 6 7-6" fill="none" stroke="#101827" stroke-width="6"/>'],
    ["heart","안경","하트 안경",40,40,42,'<path d="M30 59C-3 41 10 15 30 28c20-13 33 13 0 31Zm60 0C57 41 70 15 90 28c20-13 33 13 0 31Z" fill="#ffacc3" fill-opacity=".7" stroke="#e84c79" stroke-width="6"/><path d="M50 34q10-7 20 0" fill="none" stroke="#e84c79" stroke-width="5"/>'],
    ["straw","모자","밀짚모자",15,15,54,'<ellipse cx="60" cy="62" rx="57" ry="15" fill="#b9864c"/><path d="M28 56 38 15Q60 3 82 15l10 41Z" fill="#e9c48a" stroke="#a46e3e" stroke-width="3"/><path d="M30 46q30 13 60 0l2 9q-32 16-64 0Z" fill="#ad5672"/>'],
    ["beret","모자","베레모",16,16,43,'<path d="M12 54Q4 20 48 13q50-8 61 27l-9 21q-35-14-88-7Z" fill="#e986a1" stroke="#bc5776" stroke-width="4"/><path d="M13 55q48-13 86 5" fill="none" stroke="#993a5a" stroke-width="7"/><path d="M64 16q-2-13 6-14" stroke="#bc5776" stroke-width="5" fill="none"/>'],
    ["crown","모자","왕관",14,14,36,'<path d="M10 21 34 40 60 7l26 33 24-19-11 51H21Z" fill="#ffd866" stroke="#b67816" stroke-width="5"/><circle cx="60" cy="49" r="7" fill="#eb6c8f"/><circle cx="34" cy="48" r="5" fill="#70bdeb"/><circle cx="86" cy="48" r="5" fill="#70bdeb"/>'],
    ["shirt","옷","티셔츠",72,72,53,'<path d="m35 12-20 11L3 52l24 10 9-18v55h48V44l9 18 24-10-12-29-20-11-14 11H49Z" fill="#a2c8ff" stroke="#5684c2" stroke-width="4"/><path d="M49 12q11 20 22 0" fill="none" stroke="#5684c2" stroke-width="4"/>'],
    ["jacket","옷","재킷",72,72,57,'<path d="m37 9-22 13L3 96h48l9-50 9 50h48L105 22 83 9 60 26Z" fill="#e8b9a8" stroke="#925e53" stroke-width="4"/><path d="m37 9 23 17-16 25-19-21m58-21L60 26l16 25 19-21" fill="#fff7ed" stroke="#925e53" stroke-width="3"/>'],
    ["dress","옷","드레스",74,74,52,'<path d="M38 5q22 18 44 0l14 25-18 12 27 57H15l27-57-18-12Z" fill="#f5b9d1" stroke="#ad6488" stroke-width="4"/><path d="M38 5q22 18 44 0M42 42q18 9 36 0" fill="none" stroke="#fff1f6" stroke-width="5"/>'],
    ["sneakers","신발","운동화",91,91,47,'<path d="M8 31q11 0 18-13l20 12 8 19H5q-3-11 3-18Zm58 0q11 0 18-13l20 12 8 19H63q-3-11 3-18Z" fill="#fff" stroke="#617388" stroke-width="4"/><path d="M5 43h49m9 0h49M22 30h20m38 0h20" stroke="#7b97bb" stroke-width="4"/>'],
    ["boots","신발","부츠",91,91,44,'<path d="M13 7h25v32q7 7 17 7v13H4V46l9-8Zm64 0h25v32q7 7 17 7v13H68V46l9-8Z" fill="#a26d54" stroke="#5b3b34" stroke-width="4"/><path d="M6 52h47m17 0h47" stroke="#f2d0a2" stroke-width="4"/>'],
    // 모양·색이 서로 다른 추가 장식(종류별 10개)
    ["star-shades","안경","별 안경",40,40,42,'<path d="M31 18L37.5 33.1L53.8 34.6L41.5 45.4L45.1 61.4L31 53L16.9 61.4L20.5 45.4L8.2 34.6L24.5 33.1ZM89 18L95.5 33.1L111.8 34.6L99.5 45.4L103.1 61.4L89 53L74.9 61.4L78.5 45.4L66.2 34.6L82.5 33.1Z" fill="#ffe066" fill-opacity=".75" stroke="#f08c00" stroke-width="5" stroke-linejoin="round"/><path d="M53 35q7-6 14 0M9 35 1 30m110 5 8-5" fill="none" stroke="#f08c00" stroke-width="5" stroke-linecap="round"/>'],
    ["cateye-red","안경","고양이눈 안경",40,40,42,'<path d="M6 22Q20 26 50 30Q54 55 30 56Q10 55 6 22Z" fill="#ffd6de" fill-opacity=".55" stroke="#d7263d" stroke-width="6" stroke-linejoin="round"/><circle cx="12" cy="27" r="2.6" fill="#fff"/><circle cx="19" cy="29" r="1.8" fill="#fff"/><path d="M6 22 0 17" stroke="#d7263d" stroke-width="5" stroke-linecap="round"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M6 22Q20 26 50 30Q54 55 30 56Q10 55 6 22Z" fill="#ffd6de" fill-opacity=".55" stroke="#d7263d" stroke-width="6" stroke-linejoin="round"/><circle cx="12" cy="27" r="2.6" fill="#fff"/><circle cx="19" cy="29" r="1.8" fill="#fff"/><path d="M6 22 0 17" stroke="#d7263d" stroke-width="5" stroke-linecap="round"/></g><path d="M50 33q10-7 20 0" fill="none" stroke="#d7263d" stroke-width="5"/>'],
    ["pilot-gold","안경","보잉 선글라스",40,40,42,'<path d="M10 28Q30 22 52 28Q54 50 38 58Q18 64 12 46Q8 36 10 28Z" fill="#3f7a5d" fill-opacity=".88" stroke="#c9a227" stroke-width="3.5"/><path d="M17 35q6-5 14-5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/><path d="M10 29 0 26" stroke="#c9a227" stroke-width="3.5"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M10 28Q30 22 52 28Q54 50 38 58Q18 64 12 46Q8 36 10 28Z" fill="#3f7a5d" fill-opacity=".88" stroke="#c9a227" stroke-width="3.5"/><path d="M17 35q6-5 14-5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/><path d="M10 29 0 26" stroke="#c9a227" stroke-width="3.5"/></g><path d="M52 29Q60 25 68 29M52 35h16" fill="none" stroke="#c9a227" stroke-width="3"/>'],
    ["hex-mint","안경","육각 안경",40,40,40,'<path d="M52 40 41.5 58.2h-21L10 40l10.5-18.2h21Z" fill="#b8f2e6" fill-opacity=".45" stroke="#0f9d8f" stroke-width="5" stroke-linejoin="round"/><path d="M10 40 1 34" stroke="#0f9d8f" stroke-width="4" stroke-linecap="round"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M52 40 41.5 58.2h-21L10 40l10.5-18.2h21Z" fill="#b8f2e6" fill-opacity=".45" stroke="#0f9d8f" stroke-width="5" stroke-linejoin="round"/><path d="M10 40 1 34" stroke="#0f9d8f" stroke-width="4" stroke-linecap="round"/></g><path d="M52 38q8-7 16 0" fill="none" stroke="#0f9d8f" stroke-width="4.5"/>'],
    ["swim-goggles","안경","수영 고글",40,40,44,'<rect x="0" y="33" width="120" height="13" rx="5" fill="#ff7a45" stroke="#c4471a" stroke-width="2"/><rect x="50" y="35" width="20" height="9" rx="3" fill="#3d2a99"/><ellipse cx="32" cy="40" rx="21" ry="17" fill="#7b5cff" fill-opacity=".9" stroke="#3d2a99" stroke-width="6"/><path d="M20 34q5-7 13-7" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3.5" stroke-linecap="round"/><g transform="matrix(-1 0 0 1 120 0)"><ellipse cx="32" cy="40" rx="21" ry="17" fill="#7b5cff" fill-opacity=".9" stroke="#3d2a99" stroke-width="6"/><path d="M20 34q5-7 13-7" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3.5" stroke-linecap="round"/></g>'],
    ["monocle","안경","외알 안경",40,40,38,'<path d="M80 60Q72 92 40 96" fill="none" stroke="#c08a1e" stroke-width="3" stroke-dasharray="4 3"/><circle cx="37" cy="96" r="4" fill="none" stroke="#c08a1e" stroke-width="3"/><circle cx="80" cy="40" r="20" fill="#e8f4ff" fill-opacity=".5" stroke="#c08a1e" stroke-width="6"/><circle cx="80" cy="40" r="14.5" fill="none" stroke="#f5d27a" stroke-width="2"/><path d="M70 32q5-6 12-6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'],
    ["glasses-3d","안경","3D 안경",40,40,42,'<path d="M4 22h112v34q0 6-6 6H72q-6 0-9-8-3-6-6 0-3 8-9 8H10q-6 0-6-6Z" fill="#f8f9fa" stroke="#343a40" stroke-width="4" stroke-linejoin="round"/><rect x="12" y="28" width="38" height="24" rx="4" fill="#ef233c" fill-opacity=".85"/><rect x="70" y="28" width="38" height="24" rx="4" fill="#00b4d8" fill-opacity=".85"/><path d="M4 27 0 23m116 4 4-4" stroke="#343a40" stroke-width="4"/>'],
    ["flower-frame","안경","꽃 안경",40,40,42,'<circle cx="51" cy="40" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="45.1" cy="54.1" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="31" cy="60" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="16.9" cy="54.1" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="11" cy="40" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="16.9" cy="25.9" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="31" cy="20" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="45.1" cy="25.9" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="109" cy="40" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="103.1" cy="54.1" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="89" cy="60" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="74.9" cy="54.1" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="69" cy="40" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="74.9" cy="25.9" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="89" cy="20" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="103.1" cy="25.9" r="8" fill="#ffb3d9" stroke="#e05297" stroke-width="2"/><circle cx="31" cy="40" r="15" fill="#fff3b0" fill-opacity=".75" stroke="#f4a300" stroke-width="4"/><circle cx="89" cy="40" r="15" fill="#fff3b0" fill-opacity=".75" stroke="#f4a300" stroke-width="4"/><path d="M56 36q4-4 8 0" fill="none" stroke="#e05297" stroke-width="4"/>'],
    ["groucho","안경","코주부 안경",42,42,42,'<path d="M9 18q20-12 40 0" fill="none" stroke="#111" stroke-width="7" stroke-linecap="round"/><rect x="10" y="25" width="38" height="28" rx="12" fill="#fff" fill-opacity=".25" stroke="#111" stroke-width="6"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M9 18q20-12 40 0" fill="none" stroke="#111" stroke-width="7" stroke-linecap="round"/><rect x="10" y="25" width="38" height="28" rx="12" fill="#fff" fill-opacity=".25" stroke="#111" stroke-width="6"/></g><path d="M48 36h24" stroke="#111" stroke-width="5"/><path d="M60 34q-12 22-10 34 10 10 20 0 2-12-10-34Z" fill="#f4a582" stroke="#c46a4a" stroke-width="3" stroke-linejoin="round"/><path d="M60 72q-10-8-26-2-12 6-20 0 6 14 24 12 14-2 22-8 8 6 22 8 18 2 24-12-8 6-20 0-16-6-26 2Z" fill="#3b2416"/>'],
    ["cyber-visor","안경","사이버 고글",40,40,44,'<defs><linearGradient id="v" x1="0" x2="1"><stop offset="0" stop-color="#00f5d4"/><stop offset=".5" stop-color="#9b5de5"/><stop offset="1" stop-color="#f15bb5"/></linearGradient></defs><path d="M4 30Q60 18 116 30l-4 22q-22-5-42-4-10-10-20 0-20-1-42 4Z" fill="url(#v)" stroke="#1b1b3a" stroke-width="4" stroke-linejoin="round"/><path d="M14 34Q60 25 106 34" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.5" stroke-linecap="round"/><path d="M4 32 0 36m116-4 4 4" stroke="#1b1b3a" stroke-width="4"/>'],
    ["ball-cap","모자","야구모자",16,16,48,'<path d="M18 64Q18 18 60 16q42 2 42 48Z" fill="#e63946" stroke="#9d0208" stroke-width="4" stroke-linejoin="round"/><path d="M60 16v48M40 22q-8 20-6 42M80 22q8 20 6 42" fill="none" stroke="#9d0208" stroke-width="2"/><circle cx="60" cy="16" r="5" fill="#9d0208"/><circle cx="46" cy="42" r="10" fill="#fff"/><path d="m49 34-7 10h6l-3 9 9-12h-6l3-7Z" fill="#ffb703"/><path d="M16 62q48-8 102 12-34 12-68 2-26-6-34-14Z" fill="#c1121f" stroke="#9d0208" stroke-width="3" stroke-linejoin="round"/>'],
    ["top-hat-magic","모자","마술사 모자",14,14,44,'<ellipse cx="60" cy="72" rx="52" ry="12" fill="#1d1d27" stroke="#000" stroke-width="3"/><path d="M32 8Q60 3 88 8l-4 62H36Z" fill="#1d1d27" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M36 52h48l-1 14H37Z" fill="#7b2cbf"/><path d="M43 14v32" stroke="#6c6c80" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/><path d="M101 11L103.4 16.8L109.6 17.2L104.8 21.2L106.3 27.3L101 24L95.7 27.3L97.2 21.2L92.4 17.2L98.6 16.8ZM14 34L15.5 37.9L19.7 38.1L16.5 40.8L17.5 44.9L14 42.6L10.5 44.9L11.5 40.8L8.3 38.1L12.5 37.9Z" fill="#ffd60a"/>'],
    ["witch-hat","모자","마녀 모자",13,13,54,'<ellipse cx="60" cy="80" rx="57" ry="13" fill="#3c1a5b" stroke="#1e0b30" stroke-width="3"/><path d="M30 76q16-30 22-58 4-14 26-12-12 4-12 20 6 26 24 50Z" fill="#4a2170" stroke="#1e0b30" stroke-width="3" stroke-linejoin="round"/><path d="M33 68q27 6 54 0l3 8q-30 8-60 0Z" fill="#7fd35b"/><rect x="53" y="66" width="14" height="11" rx="2" fill="none" stroke="#ffd23f" stroke-width="3"/>'],
    ["party-cone","모자","고깔모자",13,13,40,'<path d="M58 88 44 104M62 88l14 16" stroke="#adb5bd" stroke-width="1.5"/><path d="M60 8 92 82q-32 10-64 0Z" fill="#4cc9f0" stroke="#3a0ca3" stroke-width="3" stroke-linejoin="round"/><circle cx="60" cy="34" r="4" fill="#f72585"/><circle cx="50" cy="56" r="5" fill="#ffd60a"/><circle cx="72" cy="62" r="5" fill="#f72585"/><circle cx="62" cy="78" r="4" fill="#ffd60a"/><circle cx="41" cy="76" r="4" fill="#7209b7"/><circle cx="67" cy="45" r="3" fill="#7209b7"/><path d="M28 82q32 10 64 0" fill="none" stroke="#ffd60a" stroke-width="6" stroke-dasharray="4 3" stroke-linecap="round"/><circle cx="66" cy="9" r="5" fill="#f72585"/><circle cx="63" cy="14.2" r="5" fill="#f72585"/><circle cx="57" cy="14.2" r="5" fill="#f72585"/><circle cx="54" cy="9" r="5" fill="#f72585"/><circle cx="57" cy="3.8" r="5" fill="#f72585"/><circle cx="63" cy="3.8" r="5" fill="#f72585"/><circle cx="60" cy="9" r="5" fill="#ff85c0"/>'],
    ["pom-beanie","모자","방울 털모자",15,15,48,'<path d="M16 72Q14 26 60 22q46 4 44 50Z" fill="#f4a261" stroke="#b5651d" stroke-width="3"/><path d="M17 52q43-8 86 0M20 38q40-9 80 0" fill="none" stroke="#fff4e6" stroke-width="5"/><path d="M12 70h96v18q-48 6-96 0Z" fill="#e76f51" stroke="#b5651d" stroke-width="3" stroke-linejoin="round"/><path d="M22 72v16M32 72v17M42 72v17M52 72v18M62 72v18M72 72v18M82 72v17M92 72v17M102 72v16" stroke="#b5651d" stroke-opacity=".45" stroke-width="2"/><circle cx="69" cy="16" r="7" fill="#fff4e6"/><circle cx="66.4" cy="22.4" r="7" fill="#fff4e6"/><circle cx="60" cy="25" r="7" fill="#fff4e6"/><circle cx="53.6" cy="22.4" r="7" fill="#fff4e6"/><circle cx="51" cy="16" r="7" fill="#fff4e6"/><circle cx="53.6" cy="9.6" r="7" fill="#fff4e6"/><circle cx="60" cy="7" r="7" fill="#fff4e6"/><circle cx="66.4" cy="9.6" r="7" fill="#fff4e6"/><circle cx="60" cy="16" r="10" fill="#fffaf2"/>'],
    ["white-cowboy","모자","카우보이모자",15,15,56,'<path d="M28 70q-4-40 6-48 12-6 26 4 14-10 26-4 10 8 6 48Z" fill="#f1e3c8" stroke="#8a6d3b" stroke-width="3" stroke-linejoin="round"/><path d="M60 26v16" stroke="#8a6d3b" stroke-width="3"/><path d="M28 58q32 6 64 0v10q-32 6-64 0Z" fill="#2a9d8f"/><circle cx="60" cy="63" r="4" fill="#dee2e6" stroke="#6c757d"/><path d="M4 62q6 20 56 18 50 2 56-18-8 12-56 8-48 4-56-8Z" fill="#e8d5b0" stroke="#8a6d3b" stroke-width="3" stroke-linejoin="round"/>'],
    ["chef-hat","모자","요리사 모자",14,14,42,'<circle cx="36" cy="36" r="20" fill="#fff" stroke="#adb5bd" stroke-width="3"/><circle cx="84" cy="36" r="20" fill="#fff" stroke="#adb5bd" stroke-width="3"/><circle cx="60" cy="26" r="24" fill="#fff" stroke="#adb5bd" stroke-width="3"/><path d="M30 40h60l-4 46H34Z" fill="#fff"/><path d="M30 40l4 46h52l4-46M34 72h52" fill="none" stroke="#adb5bd" stroke-width="3" stroke-linejoin="round"/><path d="M46 46v24M60 46v24M74 46v24" stroke="#dee2e6" stroke-width="3"/><path d="M35 79h50" stroke="#4895ef" stroke-width="4"/>'],
    ["bunny-band","모자","토끼 머리띠",16,16,48,'<path d="M38 70Q20 10 34 4q14-2 16 60Z" fill="#f8f9fa" stroke="#ced4da" stroke-width="3" stroke-linejoin="round"/><path d="M39 60Q29 18 36 12q8 0 10 48Z" fill="#ffb3c6"/><path d="M70 66q6-60 22-58 12 6-10 32-6 12-2 26Z" fill="#f8f9fa" stroke="#ced4da" stroke-width="3" stroke-linejoin="round"/><path d="M75 58q5-44 15-44 6 4-10 24Z" fill="#ffb3c6"/><path d="M14 88Q60 50 106 88" fill="none" stroke="#ff8fab" stroke-width="8" stroke-linecap="round"/><path d="M84 70 74 63v15Zm0 0 10-7v15Z" fill="#ff4d6d"/><circle cx="84" cy="70" r="3.5" fill="#c9184a"/>'],
    ["pirate-hat","모자","해적 모자",16,16,54,'<path d="M4 60q16-32 36-22 12-24 20-24t20 24q20-10 36 22-30-10-56 4-26-14-56-4Z" fill="#22223b" stroke="#0d0d1a" stroke-width="3" stroke-linejoin="round"/><path d="M6 58q28-10 54 4 26-14 54-4" fill="none" stroke="#e9c46a" stroke-width="3"/><path d="M49 50 71 30M49 30l22 20" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><circle cx="60" cy="36" r="9" fill="#fff"/><rect x="55" y="41" width="10" height="7" rx="2" fill="#fff"/><circle cx="56.8" cy="35" r="2.4" fill="#22223b"/><circle cx="63.2" cy="35" r="2.4" fill="#22223b"/>'],
    ["viking-helm","모자","바이킹 투구",14,14,52,'<path d="M28 50Q6 44 4 12q12 18 30 24Z" fill="#fff1d0" stroke="#b08968" stroke-width="3" stroke-linejoin="round"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M28 50Q6 44 4 12q12 18 30 24Z" fill="#fff1d0" stroke="#b08968" stroke-width="3" stroke-linejoin="round"/></g><path d="M24 70q0-44 36-46 36 2 36 46Z" fill="#adb5bd" stroke="#495057" stroke-width="3"/><path d="M60 26v38" stroke="#6c757d" stroke-width="6"/><rect x="22" y="64" width="76" height="12" rx="2" fill="#6c757d" stroke="#495057" stroke-width="3"/><circle cx="32" cy="70" r="2" fill="#dee2e6"/><circle cx="46" cy="70" r="2" fill="#dee2e6"/><circle cx="74" cy="70" r="2" fill="#dee2e6"/><circle cx="88" cy="70" r="2" fill="#dee2e6"/><path d="M55 76h10v14l-5 6-5-6Z" fill="#6c757d" stroke="#495057" stroke-width="2"/>'],
    ["hoodie","옷","후드티",72,72,54,'<path d="M34 20Q34 2 60 2t26 18Q60 34 34 20Z" fill="#248277" stroke="#1d6f65" stroke-width="4"/><path d="m34 20-20 10L4 70l18 6 8-24v48h60V52l8 24 18-6-10-40-20-10Z" fill="#2a9d8f" stroke="#1d6f65" stroke-width="4" stroke-linejoin="round"/><path d="M40 20q20 20 40 0Q60 28 40 20Z" fill="#1d6f65"/><path d="M54 30v16m12-16v16" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M42 74h36l6 18H36Z" fill="none" stroke="#1d6f65" stroke-width="3" stroke-linejoin="round"/><path d="M30 94h60" stroke="#1d6f65" stroke-width="3"/>'],
    ["breton","옷","줄무늬 셔츠",72,72,54,'<defs><clipPath id="c"><path d="M36 12 16 20 4 80l14 4 12-42v58h60V42l12 42 14-4-12-60-20-8q-24 8-48 0Z"/></clipPath></defs><path d="M36 12 16 20 4 80l14 4 12-42v58h60V42l12 42 14-4-12-60-20-8q-24 8-48 0Z" fill="#fdfcf7"/><g clip-path="url(#c)" fill="#1d3557"><rect y="22" width="120" height="5"/><rect y="34" width="120" height="5"/><rect y="46" width="120" height="5"/><rect y="58" width="120" height="5"/><rect y="70" width="120" height="5"/><rect y="82" width="120" height="5"/><rect y="94" width="120" height="5"/></g><path d="M36 12 16 20 4 80l14 4 12-42v58h60V42l12 42 14-4-12-60-20-8q-24 8-48 0Z" fill="none" stroke="#1d3557" stroke-width="3" stroke-linejoin="round"/><path d="m16 80 12 3m76-3-12 3" stroke="#e63946" stroke-width="4"/>'],
    ["overalls","옷","멜빵바지",72,72,50,'<path d="M40 24 32 3m48 21 8-21" stroke="#3a6ea5" stroke-width="8" stroke-linecap="round"/><path d="M28 54h64l4 46H66l-6-28-6 28H24Z" fill="#3a6ea5" stroke="#23466e" stroke-width="4" stroke-linejoin="round"/><path d="M38 20h44v38H38Z" fill="#3a6ea5" stroke="#23466e" stroke-width="4" stroke-linejoin="round"/><path d="M48 30h24v16q-12 5-24 0Z" fill="#4a7fb8" stroke="#23466e" stroke-width="2"/><circle cx="41" cy="25" r="4" fill="#ffd166"/><circle cx="79" cy="25" r="4" fill="#ffd166"/><path d="M30 62h60M42 20v36m36-36v36" stroke="#ffd166" stroke-width="1.8" stroke-dasharray="3 3"/>'],
    ["tuxedo","옷","턱시도",72,72,56,'<path d="M34 10 14 22 4 98h112l-10-76-20-12-26 20Z" fill="#1b1b1f" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M40 12h40L60 74Z" fill="#fff"/><path d="M40 12 60 74 42 44l-10-4 4-20Z" fill="#2e2e36" stroke="#000" stroke-width="2" stroke-linejoin="round"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M40 12 60 74 42 44l-10-4 4-20Z" fill="#2e2e36" stroke="#000" stroke-width="2" stroke-linejoin="round"/></g><path d="M60 21 46 13v16Zm0 0 14-8v16Z" fill="#d62828"/><circle cx="60" cy="21" r="4" fill="#9d0208"/><circle cx="60" cy="38" r="2" fill="#1b1b1f"/><circle cx="60" cy="50" r="2" fill="#1b1b1f"/><path d="M84 54h16" stroke="#555" stroke-width="2"/><path d="m86 54 5-7 5 7Z" fill="#d62828"/>'],
    ["hanbok","옷","한복",72,72,56,'<defs><clipPath id="s"><path d="M26 13 4 44l16 6 12-16V18Z"/></clipPath></defs><path d="M34 42h52l22 60H12Z" fill="#ff70a6" stroke="#c9184a" stroke-width="3" stroke-linejoin="round"/><path d="M48 50 40 100M60 50v50m12-50 8 50" stroke="#e0467f" stroke-width="2"/><path d="M38 8 16 18 4 44l16 6 12-16v12h56V34l12 16 16-6-12-26-22-10Z" fill="#b7e4c7" stroke="#2d6a4f" stroke-width="3" stroke-linejoin="round"/><g clip-path="url(#s)" stroke-width="4"><path d="m0 32 34 12" stroke="#ffd60a"/><path d="m0 26 34 12" stroke="#f72585"/><path d="m0 20 34 12" stroke="#4361ee"/><path d="m0 14 34 12" stroke="#ffffff"/></g><g transform="matrix(-1 0 0 1 120 0)"><g clip-path="url(#s)" stroke-width="4"><path d="m0 32 34 12" stroke="#ffd60a"/><path d="m0 26 34 12" stroke="#f72585"/><path d="m0 20 34 12" stroke="#4361ee"/><path d="m0 14 34 12" stroke="#ffffff"/></g></g><path d="M46 8 60 30 74 8" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><path d="M60 32q-8 12-14 38m14-38q4 14-2 40" fill="none" stroke="#d00000" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="32" r="4.5" fill="#d00000"/>'],
    ["raincoat","옷","우비",72,72,54,'<path d="M38 16Q36 0 60 0t22 16Z" fill="#ffd60a" stroke="#c9a000" stroke-width="3"/><path d="M38 14 18 22 6 78l16 4 8-30-4 50h68l-4-50 8 30 16-4-12-56-20-8q-22 8-44 0Z" fill="#ffd60a" stroke="#c9a000" stroke-width="4" stroke-linejoin="round"/><path d="M44 14q16-10 32 0Q60 20 44 14Z" fill="#c9a000"/><path d="M60 22v80" stroke="#c9a000" stroke-width="3"/><rect x="54" y="38" width="12" height="5" rx="2.5" fill="#3d2c00"/><rect x="54" y="56" width="12" height="5" rx="2.5" fill="#3d2c00"/><rect x="54" y="74" width="12" height="5" rx="2.5" fill="#3d2c00"/><path d="M34 70h14m24 0h14" stroke="#c9a000" stroke-width="3" stroke-linecap="round"/>'],
    ["hero-cape","옷","망토",70,70,56,'<path d="M40 10Q20 50 6 102q28-10 54 0 26-10 54 0-14-52-34-92Z" fill="#d62828" stroke="#9d0208" stroke-width="3" stroke-linejoin="round"/><path d="M44 24q-10 36-16 74m32-76v78m16-76q10 36 16 74" fill="none" stroke="#9d0208" stroke-opacity=".45" stroke-width="2"/><path d="M34 14Q60-2 86 14l-8 8Q60 12 42 22Z" fill="#9d0208"/><circle cx="60" cy="19" r="7" fill="#ffd60a" stroke="#b8860b" stroke-width="2"/><path d="M60 15L61.2 17.9L64.3 18.1L61.9 20.1L62.6 23.1L60 21.5L57.4 23.1L58.1 20.1L55.7 18.1L58.8 17.9Z" fill="#b8860b"/>'],
    ["aloha","옷","알로하 셔츠",72,72,54,'<defs><clipPath id="a"><path d="M36 12 14 22 4 50l22 8 6-14v56h56V44l6 14 22-8-10-28-22-10-24 18Z"/></clipPath></defs><path d="M36 12 14 22 4 50l22 8 6-14v56h56V44l6 14 22-8-10-28-22-10-24 18Z" fill="#ff8c42"/><g clip-path="url(#a)"><ellipse cx="30" cy="70" rx="9" ry="4" transform="rotate(-30 30 70)" fill="#2d6a4f"/><ellipse cx="88" cy="50" rx="9" ry="4" transform="rotate(35 88 50)" fill="#2d6a4f"/><ellipse cx="18" cy="42" rx="7" ry="3" transform="rotate(40 18 42)" fill="#2d6a4f"/><circle cx="50" cy="62" r="5" fill="#fff0f3"/><circle cx="45.9" cy="67.7" r="5" fill="#fff0f3"/><circle cx="39.1" cy="65.5" r="5" fill="#fff0f3"/><circle cx="39.1" cy="58.5" r="5" fill="#fff0f3"/><circle cx="45.9" cy="56.3" r="5" fill="#fff0f3"/><circle cx="44" cy="62" r="3.5" fill="#ffd60a"/><circle cx="84" cy="82" r="5" fill="#fff0f3"/><circle cx="79.9" cy="87.7" r="5" fill="#fff0f3"/><circle cx="73.1" cy="85.5" r="5" fill="#fff0f3"/><circle cx="73.1" cy="78.5" r="5" fill="#fff0f3"/><circle cx="79.9" cy="76.3" r="5" fill="#fff0f3"/><circle cx="78" cy="82" r="3.5" fill="#ffd60a"/><circle cx="25" cy="34" r="4" fill="#ffd6a5"/><circle cx="21.5" cy="38.8" r="4" fill="#ffd6a5"/><circle cx="16" cy="36.9" r="4" fill="#ffd6a5"/><circle cx="16" cy="31.1" r="4" fill="#ffd6a5"/><circle cx="21.5" cy="29.2" r="4" fill="#ffd6a5"/><circle cx="20" cy="34" r="2.8" fill="#e63946"/><circle cx="101" cy="38" r="4" fill="#ffd6a5"/><circle cx="97.5" cy="42.8" r="4" fill="#ffd6a5"/><circle cx="92" cy="40.9" r="4" fill="#ffd6a5"/><circle cx="92" cy="35.1" r="4" fill="#ffd6a5"/><circle cx="97.5" cy="33.2" r="4" fill="#ffd6a5"/><circle cx="96" cy="38" r="2.8" fill="#e63946"/><circle cx="44" cy="92" r="3.5" fill="#ffd6a5"/><circle cx="41.2" cy="95.8" r="3.5" fill="#ffd6a5"/><circle cx="36.8" cy="94.4" r="3.5" fill="#ffd6a5"/><circle cx="36.8" cy="89.6" r="3.5" fill="#ffd6a5"/><circle cx="41.2" cy="88.2" r="3.5" fill="#ffd6a5"/><circle cx="40" cy="92" r="2.4" fill="#e63946"/><circle cx="82" cy="58" r="3.5" fill="#ffd6a5"/><circle cx="79.2" cy="61.8" r="3.5" fill="#ffd6a5"/><circle cx="74.8" cy="60.4" r="3.5" fill="#ffd6a5"/><circle cx="74.8" cy="55.6" r="3.5" fill="#ffd6a5"/><circle cx="79.2" cy="54.2" r="3.5" fill="#ffd6a5"/><circle cx="78" cy="58" r="2.4" fill="#e63946"/></g><path d="M36 12 14 22 4 50l22 8 6-14v56h56V44l6 14 22-8-10-28-22-10-24 18Z" fill="none" stroke="#c75a13" stroke-width="3" stroke-linejoin="round"/><path d="M36 12 60 30 46 40 34 20Z" fill="#ffa764" stroke="#c75a13" stroke-width="2.5" stroke-linejoin="round"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M36 12 60 30 46 40 34 20Z" fill="#ffa764" stroke="#c75a13" stroke-width="2.5" stroke-linejoin="round"/></g><path d="M60 30v70" stroke="#c75a13" stroke-width="2"/>'],
    ["tutu","옷","발레 튜튜",66,66,48,'<path d="M44 8q16 10 32 0l4 4q-6 18-2 38H42q4-20-2-38Z" fill="#cdb4db" stroke="#7b5ea7" stroke-width="3" stroke-linejoin="round"/><path d="M4 70Q60 44 116 70l-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6Z" fill="#ffe0ec" stroke="#e5739b" stroke-width="2" stroke-linejoin="round"/><path d="M10 62Q60 40 110 62l-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6-8 8-8-6-8 8Z" fill="#ffc8dd" stroke="#e5739b" stroke-width="2" stroke-linejoin="round"/><path d="M42 48q18 6 36 0v6q-18 6-36 0Z" fill="#7b5ea7"/><circle cx="60" cy="53" r="4" fill="#ffafcc" stroke="#7b5ea7" stroke-width="1.5"/><path d="M52 22.5L52.9 24.8L55.3 24.9L53.4 26.5L54.1 28.8L52 27.5L49.9 28.8L50.6 26.5L48.7 24.9L51.1 24.8ZM68 31L68.8 32.9L70.9 33.1L69.2 34.4L69.8 36.4L68 35.3L66.2 36.4L66.8 34.4L65.1 33.1L67.2 32.9ZM24 65L24.8 66.9L26.9 67.1L25.2 68.4L25.8 70.4L24 69.3L22.2 70.4L22.8 68.4L21.1 67.1L23.2 66.9ZM94 66.5L94.9 68.8L97.3 68.9L95.4 70.5L96.1 72.8L94 71.5L91.9 72.8L92.6 70.5L90.7 68.9L93.1 68.8Z" fill="#fff"/>'],
    ["varsity","옷","야구 점퍼",72,72,56,'<path d="M36 12 16 22 4 90l18 4 10-52Z" fill="#f1e3c8" stroke="#4a1510" stroke-width="3" stroke-linejoin="round"/><path d="m5 86 17 4" stroke="#4a1510" stroke-width="6"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M36 12 16 22 4 90l18 4 10-52Z" fill="#f1e3c8" stroke="#4a1510" stroke-width="3" stroke-linejoin="round"/><path d="m5 86 17 4" stroke="#4a1510" stroke-width="6"/></g><path d="M36 12q24 10 48 0l6 18v66H30V30Z" fill="#7b2d26" stroke="#4a1510" stroke-width="3" stroke-linejoin="round"/><path d="M36 12q24 14 48 0l-4-4Q60 20 40 8Z" fill="#4a1510"/><path d="M30 88h60v10H30Z" fill="#4a1510"/><path d="M30 93h60" stroke="#f1e3c8" stroke-width="2"/><path d="M60 20v68" stroke="#4a1510" stroke-width="2"/><circle cx="60" cy="32" r="2.5" fill="#f1e3c8"/><circle cx="60" cy="48" r="2.5" fill="#f1e3c8"/><circle cx="60" cy="64" r="2.5" fill="#f1e3c8"/><circle cx="60" cy="80" r="2.5" fill="#f1e3c8"/><path d="m40 54 6-18 6 18m-9.5-7h7" fill="none" stroke="#f1e3c8" stroke-width="3.5" stroke-linejoin="round"/>'],
    ["high-top-red","신발","하이탑",91,91,46,'<path d="M8 10h20l4 20q14 0 22 10 4 6 2 12H6q-2-22 2-42Z" fill="#e63946" stroke="#7a1020" stroke-width="3" stroke-linejoin="round"/><path d="M44 42q10-2 12 8H42Z" fill="#fff"/><circle cx="16" cy="26" r="5" fill="#fff" stroke="#1d3557" stroke-width="2"/><path d="M16 23.2L16.8 25.3L19 25.4L17.3 26.8L17.9 29L16 27.8L14.1 29L14.7 26.8L13 25.4L15.2 25.3Z" fill="#1d3557"/><path d="m27 15 7 2m-6 5 7 2m-6 5 7 2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M4 50h54v7q-27 3-54 0Z" fill="#fff" stroke="#7a1020" stroke-width="3" stroke-linejoin="round"/><g transform="translate(60 0)"><path d="M8 10h20l4 20q14 0 22 10 4 6 2 12H6q-2-22 2-42Z" fill="#e63946" stroke="#7a1020" stroke-width="3" stroke-linejoin="round"/><path d="M44 42q10-2 12 8H42Z" fill="#fff"/><circle cx="16" cy="26" r="5" fill="#fff" stroke="#1d3557" stroke-width="2"/><path d="M16 23.2L16.8 25.3L19 25.4L17.3 26.8L17.9 29L16 27.8L14.1 29L14.7 26.8L13 25.4L15.2 25.3Z" fill="#1d3557"/><path d="m27 15 7 2m-6 5 7 2m-6 5 7 2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M4 50h54v7q-27 3-54 0Z" fill="#fff" stroke="#7a1020" stroke-width="3" stroke-linejoin="round"/></g>'],
    ["stiletto","신발","하이힐",91,91,46,'<path d="M6 34q6 4 8 6l-4 20H7Z" fill="#5a189a"/><path d="M6 20q-2 12 4 18 20 12 46 15 4-5-2-11-8-4-16-4-14-2-22-14-6-6-10-4Z" fill="#9d4edd" stroke="#5a189a" stroke-width="3" stroke-linejoin="round"/><path d="M10 38q20 12 46 15" fill="none" stroke="#240046" stroke-width="2"/><path d="M40 44q8 1 12 4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/><circle cx="41" cy="39.5" r="3.5" fill="#ffd6ff" stroke="#c77dff" stroke-width="1.5"/><g transform="translate(60 0)"><path d="M6 34q6 4 8 6l-4 20H7Z" fill="#5a189a"/><path d="M6 20q-2 12 4 18 20 12 46 15 4-5-2-11-8-4-16-4-14-2-22-14-6-6-10-4Z" fill="#9d4edd" stroke="#5a189a" stroke-width="3" stroke-linejoin="round"/><path d="M10 38q20 12 46 15" fill="none" stroke="#240046" stroke-width="2"/><path d="M40 44q8 1 12 4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/><circle cx="41" cy="39.5" r="3.5" fill="#ffd6ff" stroke="#c77dff" stroke-width="1.5"/></g>'],
    ["dot-rainboot","신발","물방울 장화",91,91,44,'<path d="M10 8h26v30q14 0 20 8v8H6V20q0-8 4-12Z" fill="#4cc9f0" stroke="#1d6fa3" stroke-width="3" stroke-linejoin="round"/><rect x="8" y="4" width="30" height="8" rx="3" fill="#3a86ff" stroke="#1d6fa3" stroke-width="2"/><circle cx="16" cy="20" r="2.5" fill="#fff"/><circle cx="28" cy="27" r="2.5" fill="#fff"/><circle cx="17" cy="38" r="2.5" fill="#fff"/><circle cx="32" cy="44" r="2.5" fill="#fff"/><circle cx="46" cy="47" r="2.5" fill="#fff"/><circle cx="29" cy="16" r="2" fill="#fff"/><path d="M5 52h52v6H5Z" fill="#1d3557"/><g transform="translate(60 0)"><path d="M10 8h26v30q14 0 20 8v8H6V20q0-8 4-12Z" fill="#4cc9f0" stroke="#1d6fa3" stroke-width="3" stroke-linejoin="round"/><rect x="8" y="4" width="30" height="8" rx="3" fill="#3a86ff" stroke="#1d6fa3" stroke-width="2"/><circle cx="16" cy="20" r="2.5" fill="#fff"/><circle cx="28" cy="27" r="2.5" fill="#fff"/><circle cx="17" cy="38" r="2.5" fill="#fff"/><circle cx="32" cy="44" r="2.5" fill="#fff"/><circle cx="46" cy="47" r="2.5" fill="#fff"/><circle cx="29" cy="16" r="2" fill="#fff"/><path d="M5 52h52v6H5Z" fill="#1d3557"/></g>'],
    ["flip-flops","신발","쪼리",89,89,40,'<path d="M28 4q16 0 16 20 0 14-4 26-2 10-12 10t-12-10q-4-12-4-26 0-20 16-20Z" fill="#ff7f50" stroke="#c44f28" stroke-width="3"/><path d="M28 9q11 0 11 15 0 11-3 21" fill="none" stroke="#ffb199" stroke-width="3" stroke-linecap="round"/><path d="M26 14q-10 8-13 20m13-20q12 8 17 20" fill="none" stroke="#06d6a0" stroke-width="5" stroke-linecap="round"/><circle cx="29.2" cy="14" r="2.8" fill="#ffd60a"/><circle cx="27" cy="17" r="2.8" fill="#ffd60a"/><circle cx="23.4" cy="15.9" r="2.8" fill="#ffd60a"/><circle cx="23.4" cy="12.1" r="2.8" fill="#ffd60a"/><circle cx="27" cy="11" r="2.8" fill="#ffd60a"/><circle cx="26" cy="14" r="2" fill="#f72585"/><g transform="matrix(-1 0 0 1 120 0)"><path d="M28 4q16 0 16 20 0 14-4 26-2 10-12 10t-12-10q-4-12-4-26 0-20 16-20Z" fill="#ff7f50" stroke="#c44f28" stroke-width="3"/><path d="M28 9q11 0 11 15 0 11-3 21" fill="none" stroke="#ffb199" stroke-width="3" stroke-linecap="round"/><path d="M26 14q-10 8-13 20m13-20q12 8 17 20" fill="none" stroke="#06d6a0" stroke-width="5" stroke-linecap="round"/><circle cx="29.2" cy="14" r="2.8" fill="#ffd60a"/><circle cx="27" cy="17" r="2.8" fill="#ffd60a"/><circle cx="23.4" cy="15.9" r="2.8" fill="#ffd60a"/><circle cx="23.4" cy="12.1" r="2.8" fill="#ffd60a"/><circle cx="27" cy="11" r="2.8" fill="#ffd60a"/><circle cx="26" cy="14" r="2" fill="#f72585"/></g>'],
    ["pointe","신발","토슈즈",91,91,44,'<path d="M22 30Q14 14 26 2m0 28q10-14-4-26" fill="none" stroke="#ff8fab" stroke-width="3" stroke-linecap="round"/><path d="M6 40q0-12 12-12t22 8q12 6 16 10 2 6-4 8H12q-6 0-6-14Z" fill="#ffc2d1" stroke="#e56b8a" stroke-width="3" stroke-linejoin="round"/><path d="M10 34q10-6 22 0-10 4-22 0Z" fill="#e5a0b3"/><path d="M18 40q16 8 30 6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/><g transform="translate(60 0)"><path d="M22 30Q14 14 26 2m0 28q10-14-4-26" fill="none" stroke="#ff8fab" stroke-width="3" stroke-linecap="round"/><path d="M6 40q0-12 12-12t22 8q12 6 16 10 2 6-4 8H12q-6 0-6-14Z" fill="#ffc2d1" stroke="#e56b8a" stroke-width="3" stroke-linejoin="round"/><path d="M10 34q10-6 22 0-10 4-22 0Z" fill="#e5a0b3"/><path d="M18 40q16 8 30 6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/></g>'],
    ["roller-skate","신발","롤러스케이트",89,89,46,'<path d="M8 4h22q2 20 14 24 12 2 12 12v6H6V10q0-6 2-6Z" fill="#f8f9fa" stroke="#0f766e" stroke-width="3" stroke-linejoin="round"/><path d="M7 18h24" stroke="#2ec4b6" stroke-width="4"/><path d="M30 10h6m-5 6h7m-4 6h7" stroke="#0f766e" stroke-width="2" stroke-linecap="round"/><path d="M53 44q5 0 5 5h-5Z" fill="#ff006e"/><rect x="6" y="46" width="50" height="4" fill="#6c757d"/><circle cx="16" cy="54" r="6" fill="#ff9f1c" stroke="#c26d00" stroke-width="2"/><circle cx="44" cy="54" r="6" fill="#ff9f1c" stroke="#c26d00" stroke-width="2"/><circle cx="16" cy="54" r="2" fill="#fff"/><circle cx="44" cy="54" r="2" fill="#fff"/><g transform="translate(60 0)"><path d="M8 4h22q2 20 14 24 12 2 12 12v6H6V10q0-6 2-6Z" fill="#f8f9fa" stroke="#0f766e" stroke-width="3" stroke-linejoin="round"/><path d="M7 18h24" stroke="#2ec4b6" stroke-width="4"/><path d="M30 10h6m-5 6h7m-4 6h7" stroke="#0f766e" stroke-width="2" stroke-linecap="round"/><path d="M53 44q5 0 5 5h-5Z" fill="#ff006e"/><rect x="6" y="46" width="50" height="4" fill="#6c757d"/><circle cx="16" cy="54" r="6" fill="#ff9f1c" stroke="#c26d00" stroke-width="2"/><circle cx="44" cy="54" r="6" fill="#ff9f1c" stroke="#c26d00" stroke-width="2"/><circle cx="16" cy="54" r="2" fill="#fff"/><circle cx="44" cy="54" r="2" fill="#fff"/></g>'],
    ["penny-loafer","신발","로퍼",91,91,46,'<path d="M4 36q0-10 10-10 8 4 20 4 14 0 20 8 4 6 2 12H6q-2-4-2-14Z" fill="#1b1b1f" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M4 48h54v6H4Z" fill="#6f4518"/><path d="M26 32q10 4 20 2l2 6q-12 2-22-2Z" fill="#343a40" stroke="#000" stroke-width="2"/><circle cx="37" cy="37" r="3" fill="#e9a23b"/><path d="M44 34q6 2 8 6" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/><g transform="translate(60 0)"><path d="M4 36q0-10 10-10 8 4 20 4 14 0 20 8 4 6 2 12H6q-2-4-2-14Z" fill="#1b1b1f" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M4 48h54v6H4Z" fill="#6f4518"/><path d="M26 32q10 4 20 2l2 6q-12 2-22-2Z" fill="#343a40" stroke="#000" stroke-width="2"/><circle cx="37" cy="37" r="3" fill="#e9a23b"/><path d="M44 34q6 2 8 6" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/></g>'],
    ["dino-slipper","신발","공룡 슬리퍼",91,91,46,'<path d="m13 25 4-10 5 8Zm12-3 5-10 5 10Zm13 3 6-9 3 11Z" fill="#ffd166" stroke="#2d6a1f" stroke-width="2" stroke-linejoin="round"/><path d="M4 46q-2-22 16-24 20-2 32 10 8 8 4 18H6Z" fill="#70c05a" stroke="#2d6a1f" stroke-width="3" stroke-linejoin="round"/><circle cx="46" cy="32" r="3.5" fill="#fff"/><circle cx="47" cy="32" r="1.7" fill="#111"/><path d="M38 44q10 2 18 0" fill="none" stroke="#2d6a1f" stroke-width="2"/><path d="m41 44 2.5 3.5 2.5-3.5 2.5 3.5 2.5-3.5" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M4 50h54v6q-27 2-54 0Z" fill="#ffd166" stroke="#2d6a1f" stroke-width="2" stroke-linejoin="round"/><g transform="translate(60 0)"><path d="m13 25 4-10 5 8Zm12-3 5-10 5 10Zm13 3 6-9 3 11Z" fill="#ffd166" stroke="#2d6a1f" stroke-width="2" stroke-linejoin="round"/><path d="M4 46q-2-22 16-24 20-2 32 10 8 8 4 18H6Z" fill="#70c05a" stroke="#2d6a1f" stroke-width="3" stroke-linejoin="round"/><circle cx="46" cy="32" r="3.5" fill="#fff"/><circle cx="47" cy="32" r="1.7" fill="#111"/><path d="M38 44q10 2 18 0" fill="none" stroke="#2d6a1f" stroke-width="2"/><path d="m41 44 2.5 3.5 2.5-3.5 2.5 3.5 2.5-3.5" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M4 50h54v6q-27 2-54 0Z" fill="#ffd166" stroke="#2d6a1f" stroke-width="2" stroke-linejoin="round"/></g>'],
    ["clog","신발","구멍 샌들",91,91,46,'<path d="M4 30q0-8 8-8 6 8 16 4 18-6 26 8 4 8 2 16H6q-2-10-2-20Z" fill="#ff9f1c" stroke="#b86b00" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="30" r="2.2" fill="#b86b00"/><circle cx="40" cy="28" r="2.2" fill="#b86b00"/><circle cx="47" cy="33" r="2.2" fill="#b86b00"/><circle cx="39" cy="36" r="2.2" fill="#b86b00"/><circle cx="51" cy="41" r="2.2" fill="#b86b00"/><circle cx="45" cy="42" r="2.2" fill="#b86b00"/><path d="M8 26q-6 12 8 18" fill="none" stroke="#ff6d00" stroke-width="5" stroke-linecap="round"/><circle cx="15" cy="42" r="2.5" fill="#fff"/><circle cx="29.2" cy="39" r="2.8" fill="#f72585"/><circle cx="27" cy="42" r="2.8" fill="#f72585"/><circle cx="23.4" cy="40.9" r="2.8" fill="#f72585"/><circle cx="23.4" cy="37.1" r="2.8" fill="#f72585"/><circle cx="27" cy="36" r="2.8" fill="#f72585"/><circle cx="26" cy="39" r="2" fill="#fff"/><path d="M4 48h54v7q-27 3-54 0Z" fill="#f2e8cf" stroke="#b86b00" stroke-width="2" stroke-linejoin="round"/><g transform="translate(60 0)"><path d="M4 30q0-8 8-8 6 8 16 4 18-6 26 8 4 8 2 16H6q-2-10-2-20Z" fill="#ff9f1c" stroke="#b86b00" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="30" r="2.2" fill="#b86b00"/><circle cx="40" cy="28" r="2.2" fill="#b86b00"/><circle cx="47" cy="33" r="2.2" fill="#b86b00"/><circle cx="39" cy="36" r="2.2" fill="#b86b00"/><circle cx="51" cy="41" r="2.2" fill="#b86b00"/><circle cx="45" cy="42" r="2.2" fill="#b86b00"/><path d="M8 26q-6 12 8 18" fill="none" stroke="#ff6d00" stroke-width="5" stroke-linecap="round"/><circle cx="15" cy="42" r="2.5" fill="#fff"/><circle cx="29.2" cy="39" r="2.8" fill="#f72585"/><circle cx="27" cy="42" r="2.8" fill="#f72585"/><circle cx="23.4" cy="40.9" r="2.8" fill="#f72585"/><circle cx="23.4" cy="37.1" r="2.8" fill="#f72585"/><circle cx="27" cy="36" r="2.8" fill="#f72585"/><circle cx="26" cy="39" r="2" fill="#fff"/><path d="M4 48h54v7q-27 3-54 0Z" fill="#f2e8cf" stroke="#b86b00" stroke-width="2" stroke-linejoin="round"/></g>'],
    ["kkotsin","신발","꽃신",91,91,46,'<path d="M2 40q0-10 8-10 18 6 34 4 8-4 12-12 2 16-4 24-4 6-12 6H10q-8 0-8-12Z" fill="#3d348b" stroke="#1f1a4a" stroke-width="3" stroke-linejoin="round"/><path d="M10 32q16 6 30 4-14 6-30-4Z" fill="#1f1a4a"/><path d="M10 30q18 6 34 4 8-4 12-12" fill="none" stroke="#e9c46a" stroke-width="3" stroke-linecap="round"/><ellipse cx="19" cy="45" rx="5" ry="2.2" transform="rotate(-25 19 45)" fill="#52b788"/><ellipse cx="37" cy="45" rx="5" ry="2.2" transform="rotate(25 37 45)" fill="#52b788"/><circle cx="31.6" cy="44" r="3.2" fill="#ff70a6"/><circle cx="29.1" cy="47.4" r="3.2" fill="#ff70a6"/><circle cx="25.1" cy="46.1" r="3.2" fill="#ff70a6"/><circle cx="25.1" cy="41.9" r="3.2" fill="#ff70a6"/><circle cx="29.1" cy="40.6" r="3.2" fill="#ff70a6"/><circle cx="28" cy="44" r="2.2" fill="#ffd60a"/><g transform="translate(60 0)"><path d="M2 40q0-10 8-10 18 6 34 4 8-4 12-12 2 16-4 24-4 6-12 6H10q-8 0-8-12Z" fill="#3d348b" stroke="#1f1a4a" stroke-width="3" stroke-linejoin="round"/><path d="M10 32q16 6 30 4-14 6-30-4Z" fill="#1f1a4a"/><path d="M10 30q18 6 34 4 8-4 12-12" fill="none" stroke="#e9c46a" stroke-width="3" stroke-linecap="round"/><ellipse cx="19" cy="45" rx="5" ry="2.2" transform="rotate(-25 19 45)" fill="#52b788"/><ellipse cx="37" cy="45" rx="5" ry="2.2" transform="rotate(25 37 45)" fill="#52b788"/><circle cx="31.6" cy="44" r="3.2" fill="#ff70a6"/><circle cx="29.1" cy="47.4" r="3.2" fill="#ff70a6"/><circle cx="25.1" cy="46.1" r="3.2" fill="#ff70a6"/><circle cx="25.1" cy="41.9" r="3.2" fill="#ff70a6"/><circle cx="29.1" cy="40.6" r="3.2" fill="#ff70a6"/><circle cx="28" cy="44" r="2.2" fill="#ffd60a"/></g>']
  ];
  // 철회된 장식만 저장된 사진에서 제거한다. 기존 기본 장식 ID는 그대로 유지한다.
  const withdrawnArtIds = new Set([
    ...["square","aviator","cat-eye","hexagon","oval","butterfly","half-rim","goggles","star-eye",
      "cap","bucket","beanie","fedora","cowboy","top-hat","visor","earflap","party-hat",
      "hoodie","polo","sweater","vest","cardigan","raincoat","overalls","sailor","kimono"]
      .flatMap(name => ["blue","rose","gold"].map(color => name + "-" + color)),
    ...["canvas","high-top","runner","slip-on","loafer","mary-jane","ballet","sandal","flip-flop",
      "rain-boot","hiker","ankle-boot","winter-boot","roller"]
      .flatMap(name => ["mint","plum"].map(color => name + "-" + color))
  ]);
  const PART_MIN_W = 5, PART_MAX_W = 150;
  // 고른 장식 id 모음. 하나면 장식 자체에 손잡이, 여럿이면 묶음 틀에 손잡이를 단다.
  let picked = new Set();
  // 레이어 목록에서 숨긴(h) 장식은 그리지도 내보내지도 않고, 잠근(l) 장식은 보이되 사진 위에서 잡히지 않는다. 둘 다 고를 수 없다.
  const pickable = part => !part.h && !part.l;
  const pickedParts = item => item ? (item.stickers || []).filter(part => picked.has(part.id)) : [];
  // 묶음은 장식마다 같은 g 값을 달아 둔다. 하나를 고르면 같은 묶음 전체가 함께 골라진다.
  const withGroups = (item, ids) => {
    const list = (item && item.stickers) || [], chosen = new Set(ids), groups = new Set(list.filter(part => chosen.has(part.id) && part.g).map(part => part.g));
    list.forEach(part => { if (part.g && groups.has(part.g)) chosen.add(part.id); });
    list.forEach(part => { if (!pickable(part)) chosen.delete(part.id); });
    return chosen;
  };
  const groupMembers = (item, part) => part.g ? item.stickers.filter(other => other.g === part.g).map(other => other.id) : [part.id];
  // 고른 것이 딱 한 묶음 전체인지(그러면 풀기, 아니면 묶기).
  const pickedIsOneGroup = item => { const parts = pickedParts(item), g = parts[0] && parts[0].g; return !!g && parts.every(part => part.g === g) && item.stickers.filter(part => part.g === g).length === parts.length; };
  const pickedHasGroup = item => pickedParts(item).some(part => part.g);
  let dbPromise, records = [], selectedId = null, filter = "all", category = "안경";
  let nativeStorage = false;
  const blobLoads = new Map();
  let root = null, stageUrl = null, listUrls = [], observer = null, viewing = false;
  const selected = () => records.find(row => row.id === selectedId);
  // 내장 장식이 아니면 "내 그림" 목록에서 찾는다(끌어 놓기로 id 만 넘어올 때).
  const artById = id => art.find(row => row[0] === id) || (() => { const record = customArts.find(other => other.id === id); return record ? customRow(record) : undefined; })();
  // 직접 그린 장식. 목록("내 그림")은 type "art" 기록으로 따로 저장하고, 사진에 붙인 장식은 그림(cs = { n:이름, s:획들 })을
  // 함께 담아 둔다. 그래서 목록에서 지우거나 고쳐도 이미 붙인 장식은 그대로 보인다. 획은 그림 좌표(120×105)의 점 목록이다.
  const CUSTOM_GROUP = "내 그림", CUSTOM_MAX_POINTS = 1500;
  let customArts = [];
  function cleanStrokes(strokes){
    if (!Array.isArray(strokes)) return [];
    let budget = CUSTOM_MAX_POINTS;
    return strokes.slice(0, 300).map(stroke => {
      if (!stroke || !Array.isArray(stroke.p)) return null;
      const points = [];
      for (const point of stroke.p){
        if (budget <= 0) break;
        const x = Array.isArray(point) ? Number(point[0]) : NaN, y = Array.isArray(point) ? Number(point[1]) : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([Math.round(Math.max(-10, Math.min(130, x))*10)/10, Math.round(Math.max(-10, Math.min(115, y))*10)/10]); budget--;
      }
      if (!points.length) return null;
      return { c:/^#[0-9a-f]{6}$/i.test(stroke.c) ? stroke.c.toLowerCase() : "#1f2937", w:Number.isFinite(Number(stroke.w)) ? Math.max(.5, Math.min(20, Number(stroke.w))) : 3, f:!!stroke.f, p:points };
    }).filter(Boolean);
  }
  // 점들을 이어 부드러운 선으로(가운데 점을 조절점 삼는 2차 곡선). 캔버스 미리보기도 같은 경로(Path2D)를 쓴다.
  function strokePath(stroke){
    const p = stroke.p, n = value => Math.round(value*10)/10;
    if (p.length === 1) return `M${n(p[0][0])} ${n(p[0][1])}h.01`;
    let d = `M${n(p[0][0])} ${n(p[0][1])}`;
    for (let i = 1; i < p.length - 1; i++) d += `Q${n(p[i][0])} ${n(p[i][1])} ${n((p[i][0] + p[i+1][0])/2)} ${n((p[i][1] + p[i+1][1])/2)}`;
    const last = p[p.length - 1]; d += `L${n(last[0])} ${n(last[1])}`;
    return stroke.f ? d + "Z" : d;
  }
  const strokesSvg = strokes => strokes.map(stroke => `<path d="${strokePath(stroke)}" fill="${stroke.f ? stroke.c : "none"}" stroke="${stroke.c}" stroke-width="${stroke.w}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  const customName = value => String(value || "").trim().slice(0, 40) || CUSTOM_GROUP;
  const customRow = record => [record.id, CUSTOM_GROUP, customName(record.name), 50, 50, 30, strokesSvg(record.strokes)];
  function normalizeArt(record){
    if (!record || record.type !== "art" || typeof record.id !== "string") return null;
    const strokes = cleanStrokes(record.strokes); if (!strokes.length) return null;
    return { id:record.id, type:"art", name:customName(record.name), strokes, created:Number(record.created) || 0, updated:Number(record.updated) || 0 };
  }
  // 글자 장식 tx = { t:글자(여러 줄), f:글꼴, c:글자 색, b:굵게, i:기울임, a:정렬 }. 장식 틀(120×105) 안에 꽉 차게 크기를 맞춰
  // SVG <text> 로 그린다. 그림 안에 들어가므로 색상·무늬·테두리 같은 효과가 그대로 먹는다. 고칠 땐 늘 새 객체로 바꾼다.
  // 그림(img) 속 SVG 는 웹 글꼴을 못 불러오므로 컴퓨터에 깔린 글꼴만 쓴다.
  const TEXT_GROUP = "글자", TEXT_MAX = 80, TEXT_MAX_LINES = 6;
  const TEXT_FONTS = [
    ["gothic","고딕","'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif"],
    ["serif","명조","'Batang','바탕','AppleMyungjo','Noto Serif KR',serif"],
    ["brush","궁서","'Gungsuh','궁서','GungSeo','Nanum Myeongjo',serif"],
    ["gulim","굴림","'Gulim','굴림','Apple SD Gothic Neo',sans-serif"],
    ["heavy","두꺼운 제목","'Arial Black','Malgun Gothic','맑은 고딕',sans-serif"]
  ];
  const TEXT_PHRASES = [["사랑해","#e63946"],["최고!","#ff8c42"],["HAPPY","#3a5bd9"],["여행 중","#2a9d8f"],["생일 축하해","#ff70a6"],["♥","#e63946"],["고마워","#8b5cf6"],["오늘의 나","#1f2937"],["WOW","#ffd60a"]];
  function cleanText(tx){
    if (!tx || typeof tx !== "object") return null;
    const text = String(tx.t == null ? "" : tx.t).replace(/\r/g, "").split("\n").slice(0, TEXT_MAX_LINES).join("\n").slice(0, TEXT_MAX);
    return { t:text, f:TEXT_FONTS.some(row => row[0] === tx.f) ? tx.f : "gothic", c:/^#[0-9a-f]{6}$/i.test(tx.c) ? tx.c.toLowerCase() : "#1f2937", b:tx.b !== false, i:!!tx.i, a:["left","center","right"].includes(tx.a) ? tx.a : "center" };
  }
  const xmlText = value => String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&apos;" })[ch]);
  // 100px 로 잰 너비. 캔버스가 없는 곳(시험)에선 글자 수로 어림한다.
  let textMeasure = null;
  function textWidth100(line, family, bold, italic){
    try {
      if (!textMeasure) textMeasure = document.createElement("canvas").getContext("2d");
      textMeasure.font = `${italic ? "italic " : ""}${bold ? 800 : 500} 100px ${family}`;
      return textMeasure.measureText(line).width;
    } catch { return [...line].reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 60 : 100), 0); }
  }
  function textSvg(tx){
    const family = TEXT_FONTS.find(row => row[0] === tx.f)[2], empty = !tx.t.trim();
    const lines = (empty ? "글자 입력" : tx.t).split("\n");
    const widest = Math.max(1, ...lines.map(line => textWidth100(line || " ", family, tx.b, tx.i)));
    const size = Math.max(4, Math.min(112*100/widest, 100/(lines.length*1.2), 64)), step = size*1.2;
    const x = tx.a === "left" ? 4 : tx.a === "right" ? 116 : 60, anchor = tx.a === "left" ? "start" : tx.a === "right" ? "end" : "middle";
    const r2 = value => Math.round(value*100)/100;
    return `<text font-family="${family}" font-size="${r2(size)}" font-weight="${tx.b ? 800 : 500}"${tx.i ? ' font-style="italic"' : ""} fill="${tx.c}"${empty ? ' fill-opacity=".35"' : ""} text-anchor="${anchor}" dominant-baseline="central">`
      + lines.map((line, i) => `<tspan x="${x}" y="${r2(52.5 + (i - (lines.length - 1)/2)*step)}">${xmlText(line) || " "}</tspan>`).join("") + "</text>";
  }
  const textName = tx => (tx.t.split("\n").find(line => line.trim()) || "글자").trim().slice(0, 20);
  function addText(text, color){
    const tx = cleanText({ t:text, c:color || "#1f2937" }); if (!tx) return;
    addSticker(["text", TEXT_GROUP, textName(tx), 50, 50, 40, textSvg(tx)], null, { tx });
  }
  // 고른 글자 장식들의 글자 모양을 한꺼번에 바꾼다(글 내용은 하나를 골랐을 때만 따로 고친다).
  function editText(item, key, value){
    pickedParts(item).forEach(part => { const tx = cleanText(part.tx); if (tx) part.tx = cleanText({ ...tx, [key]:value }); });
    updateStickerElements();
  }
  // 이모지 장식 em = 이모지 한 글자(여러 코드로 된 가족·국기 이모지도 한 덩어리). 컴퓨터의 컬러 이모지 글꼴로 SVG <text> 로 그린다.
  const EMOJI_GROUP = "이모지", EMOJI_RECENT_KEY = "classdock.photoAlbum.recentEmoji";
  const EMOJI_FONT = "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI Symbol',sans-serif";
  const EMOJI_SETS = [
    ["face","얼굴","😀 😂 🥰 😍 😎 🤩 😜 🤪 😇 🥳 😭 😡 🤔 😴 🤗 😱 🙄 😏 🤭 🥺"],
    ["heart","하트·기호","❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💝 💕 ✨ ⭐ 🌟 💫 🔥 💯 ✔️ ❗ ❓"],
    ["animal","동물","🐶 🐱 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐷 🐸 🐵 🐧 🐤 🦄 🐝 🦋 🐢 🐬 🐳"],
    ["food","음식","🍎 🍓 🍒 🍑 🍉 🍌 🍕 🍔 🍟 🌭 🍩 🍪 🎂 🍰 🍦 🍭 🍫 ☕ 🧋 🍜"],
    ["nature","자연","🌸 🌹 🌻 🌷 🍀 🌈 ☀️ 🌙 ⛅ ❄️ 🌊 🌴 🌵 🍁 🌍 ⚡ ☔ 🌺 🍄 🌿"],
    ["activity","활동","🎉 🎈 🎁 🎀 🎵 🎨 📷 ✈️ 🚗 ⚽ 🏀 🎮 📚 ✏️ 💡 🏆 👑 💎 🎓 🧸"]
  ].map(([id, label, list]) => [id, label, list.split(" ")]);
  let emojiSet = "face";
  const emojiRowCache = new Map();
  // 붙여 넣은 글에서 첫 이모지 한 덩어리만 받는다. 이모지가 아니면 null.
  function cleanEmoji(value){
    const text = String(value || "").trim(); if (!text) return null;
    let first = text;
    try { const segment = new Intl.Segmenter(undefined, { granularity:"grapheme" }).segment(text)[Symbol.iterator]().next().value; if (segment) first = segment.segment; }
    catch { first = Array.from(text)[0]; }
    first = first.slice(0, 32);
    return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? first : null;
  }
  const emojiSvg = em => `<text x="60" y="54" font-family="${EMOJI_FONT}" font-size="88" text-anchor="middle" dominant-baseline="central">${xmlText(em)}</text>`;
  function recentEmojis(){ try { const list = JSON.parse(localStorage.getItem(EMOJI_RECENT_KEY) || "[]"); return Array.isArray(list) ? list.map(cleanEmoji).filter(Boolean).slice(0, 20) : []; } catch { return []; } }
  function rememberEmoji(em){ try { localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify([em, ...recentEmojis().filter(other => other !== em)].slice(0, 20))); } catch { /* 기억 못 해도 붙이기는 된다 */ } }
  function addEmoji(value, position){
    const em = cleanEmoji(value); if (!em){ notice("이모지를 찾지 못했습니다. 이모지를 하나 붙여 넣어 주세요."); return false; }
    rememberEmoji(em);
    addSticker(["emoji", EMOJI_GROUP, em, 50, 50, 30, emojiSvg(em)], position || null, { em });
    return true;
  }
  // 사진에 붙은 장식의 그림 줄. 직접 그린 장식은 장식에 담긴 그림을 쓴다(같은 cs 객체면 한 번만 계산).
  const customRowCache = new WeakMap();
  function rowOf(part){
    if (!part) return null;
    if (typeof part.em === "string"){
      // 이모지는 글자라 WeakMap 에 못 넣는다. 끄는 동안 매번 다시 해석하지 않게 글자별로 기억한다.
      if (!emojiRowCache.has(part.em)){ if (emojiRowCache.size > 300) emojiRowCache.clear(); const em = cleanEmoji(part.em); emojiRowCache.set(part.em, em ? ["emoji", EMOJI_GROUP, em, 50, 50, 30, emojiSvg(em)] : null); }
      return emojiRowCache.get(part.em);
    }
    if (part.tx && typeof part.tx === "object"){
      if (customRowCache.has(part.tx)) return customRowCache.get(part.tx);
      const tx = cleanText(part.tx), row = tx ? [part.art, TEXT_GROUP, textName(tx), 50, 50, 40, textSvg(tx)] : null;
      customRowCache.set(part.tx, row); return row;
    }
    if (part.cs && typeof part.cs === "object"){
      if (customRowCache.has(part.cs)) return customRowCache.get(part.cs);
      const strokes = cleanStrokes(part.cs.s), row = strokes.length ? [part.art, CUSTOM_GROUP, customName(part.cs.n), 50, 50, 30, strokesSvg(strokes)] : null;
      customRowCache.set(part.cs, row); return row;
    }
    return artById(part.art);
  }
  async function persistArt(record){
    if (!nativeStorage) return query("readwrite", store => store.put(record));
    return nativeRequest("POST", "/photo-album-meta?id=" + encodeURIComponent(record.id), JSON.stringify(record));
  }
  async function deleteArt(record){
    if (!nativeStorage) return query("readwrite", store => store.delete(record.id));
    await nativeRequest("POST", "/photo-album-delete?id=" + encodeURIComponent(record.id));
  }

  const bgById = id => backgrounds.find(row => row[0] === id) || backgrounds[0];
  const background = bg => `linear-gradient(135deg,${bg[2]},${bg[3]})`;
  const svg = row => "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 105">' + row[6] + '</svg>');
  // 테두리 ol = { t:두께(그림 좌표 120×105 기준), c:색 }. 없거나 null 이면 테두리 없음.
  // 장식 SVG 안에 필터로 넣는다: 불투명하게 만든 모양을 t 만큼 부풀리고 원래 모양을 빼 둘레만 칠한다(반투명한 안경알 안쪽은 안 칠함).
  // 그림 자체에 들어가므로 두께가 장식 크기를 따라가고, 화면·내보내기·반사가 모두 같은 그림을 쓴다. 그림 틀 밖으로 나간 둘레는 잘린다.
  const OUTLINE_PRESETS = [["white","흰 테두리",{ t:4, c:"#ffffff" }],["black","검정 선",{ t:1.5, c:"#1f2937" }],["color","색 테두리",{ t:3, c:"#ff4d8d" }]];
  function partOutline(part){
    const ol = part.ol; if (!ol || typeof ol !== "object") return null;
    const t = Number(ol.t);
    return { t:Number.isFinite(t) ? Math.max(.5, Math.min(8, t)) : 3, c:/^#[0-9a-f]{6}$/i.test(ol.c) ? ol.c.toLowerCase() : "#ffffff" };
  }
  // 색상 cl = { h:색조 돌리기(도), s:채도(0~2), b:밝기(0.5~1.5), t:물들일 색(#rrggbb 또는 없음), k:물들이기 세기(0~1) }.
  // 물들이기는 밝기(휘도)는 살리고 색만 t 로 칠한 그림을 원래 그림과 k 만큼 섞는다. 모두 기본값이면 필터를 넣지 않는다.
  const TINTS = [["#e63946","빨강"],["#ff8c42","주황"],["#ffd60a","노랑"],["#52b788","초록"],["#4cc9f0","하늘"],["#3a5bd9","파랑"],["#8b5cf6","보라"],["#ff70a6","분홍"],["#8d6e63","갈색"],["#adb5bd","회색"]];
  function partColor(part){
    const cl = part.cl; if (!cl || typeof cl !== "object") return null;
    const num = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Number(value))) : fallback;
    const color = { h:((Math.round(num(cl.h,-3600,3600,0)) % 360) + 360) % 360, s:num(cl.s,0,2,1), b:num(cl.b,.5,1.5,1), t:/^#[0-9a-f]{6}$/i.test(cl.t) ? cl.t.toLowerCase() : "", k:num(cl.k,0,1,.85) };
    return color.h || color.s !== 1 || color.b !== 1 || (color.t && color.k > 0) ? color : null;
  }
  function colorFilter(color){
    const r3 = value => Math.round(value*1000)/1000;
    let chain = '<filter id="cl" color-interpolation-filters="sRGB">'
      + '<feColorMatrix type="hueRotate" values="' + color.h + '" result="h"/>'
      + '<feColorMatrix in="h" type="saturate" values="' + color.s + '" result="s"/>'
      + '<feComponentTransfer in="s" result="b"><feFuncR type="linear" slope="' + color.b + '"/><feFuncG type="linear" slope="' + color.b + '"/><feFuncB type="linear" slope="' + color.b + '"/></feComponentTransfer>';
    if (color.t && color.k > 0){
      const rgb = [1,3,5].map(i => parseInt(color.t.slice(i, i + 2), 16)/255), luma = [.2126,.7152,.0722];
      // 흰색은 고른 색 그대로, 검정은 검정으로: 색 = 고른 색 × 휘도. 그 뒤 원래 그림과 k 만큼 섞는다.
      const rows = rgb.map(channel => luma.map(weight => r3(channel*weight)).join(" ") + " 0 0").join(" ");
      chain += '<feColorMatrix in="b" type="matrix" values="' + rows + ' 0 0 0 1 0" result="t"/>'
        + '<feComposite in="t" in2="b" operator="arithmetic" k1="0" k2="' + r3(color.k) + '" k3="' + r3(1 - color.k) + '" k4="0"/>';
    }
    return chain + "</filter>";
  }
  // 무늬 pt = { p:무늬 종류, c:색, k:진하기 0~1, z:크기 배율 0.5~2.5, a:각도 }. 장식 모양 안에만 칠한다(모양을 흰 마스크로 바꿔 씀).
  // 타일은 10×10(그림 좌표)이고 사선·가로·세로는 같은 줄무늬를 각도만 달리한 것이다.
  const PATTERN_STAR = (() => { const pts = []; for (let i = 0; i < 10; i++){ const rad = i % 2 ? 1.5 : 3.6, angle = -Math.PI/2 + i*Math.PI/5; pts.push((5 + rad*Math.cos(angle)).toFixed(2) + " " + (5 + rad*Math.sin(angle)).toFixed(2)); } return "M" + pts.join("L") + "Z"; })();
  const PATTERNS = [
    ["","무늬 없음",0,() => ""],
    ["diagonal","사선 줄무늬",45,c => '<rect width="5" height="10" fill="' + c + '"/>'],
    ["horizontal","가로 줄무늬",90,c => '<rect width="5" height="10" fill="' + c + '"/>'],
    ["vertical","세로 줄무늬",0,c => '<rect width="5" height="10" fill="' + c + '"/>'],
    ["dots","물방울",0,c => '<circle cx="5" cy="5" r="2.2" fill="' + c + '"/>'],
    ["check","체크",0,c => '<rect width="5" height="5" fill="' + c + '"/><rect x="5" y="5" width="5" height="5" fill="' + c + '"/>'],
    ["grid","격자",0,c => '<path d="M0 .6H10M.6 0V10" fill="none" stroke="' + c + '" stroke-width="1.2"/>'],
    ["hearts","하트",0,c => '<path d="M5 8.2C1.5 5.8 2 2.8 5 4 8 2.8 8.5 5.8 5 8.2Z" fill="' + c + '"/>'],
    ["stars","별",0,c => '<path d="' + PATTERN_STAR + '" fill="' + c + '"/>'],
    ["zigzag","지그재그",0,c => '<path d="M0 7 2.5 3 5 7 7.5 3 10 7" fill="none" stroke="' + c + '" stroke-width="1.4" stroke-linejoin="round"/>']
  ];
  function partPattern(part){
    const pt = part.pt; if (!pt || typeof pt !== "object") return null;
    const kind = PATTERNS.find(row => row[0] && row[0] === pt.p); if (!kind) return null;
    const num = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Number(value))) : fallback;
    return { p:kind[0], c:/^#[0-9a-f]{6}$/i.test(pt.c) ? pt.c.toLowerCase() : "#ffffff", k:num(pt.k,0,1,.7), z:num(pt.z,.5,2.5,1), a:((Math.round(num(pt.a,-3600,3600,kind[2])) % 180) + 180) % 180 };
  }
  function patternDefs(pattern, shape){
    const tile = PATTERNS.find(row => row[0] === pattern.p)[3](pattern.c);
    return '<pattern id="pt" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(' + pattern.a + ' 60 52.5) scale(' + pattern.z + ')">' + tile + "</pattern>"
      + '<filter id="pw"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter>'
      + '<mask id="pm"><g filter="url(#pw)">' + shape + "</g></mask>";
  }
  // 무늬 버튼에 그리는 작은 미리보기.
  const patternPreview = id => { const kind = PATTERNS.find(row => row[0] === id); if (!kind || !id) return "";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(' + kind[2] + ' 10 10) scale(.8)">' + kind[3]("#64748b") + '</pattern></defs><rect width="20" height="20" fill="url(#p)"/></svg>'); };
  function setPattern(item, id){
    const kind = PATTERNS.find(row => row[0] === id);
    pickedParts(item).forEach(part => {
      if (!kind || !id){ delete part.pt; return; }
      const now = partPattern(part);
      part.pt = { p:id, c:now ? now.c : "#ffffff", k:now ? now.k : .7, z:now ? now.z : 1, a:kind[2] };
    });
    updateStickerElements(); save(item);
  }
  const editPattern = (item, key, value) => pickedParts(item).forEach(part => { const now = partPattern(part); if (now) part.pt = { ...now, [key]:value }; });
  function partSvg(row, part){
    const ol = part && partOutline(part), color = part && partColor(part), pattern = part && partPattern(part), patterned = !!(pattern && pattern.k > 0);
    if (!ol && !color && !patterned) return svg(row);
    let defs = "", body = row[6];
    if (color){ defs += colorFilter(color); body = '<g filter="url(#cl)">' + body + "</g>"; }
    // 무늬는 색을 바꾼 그림 위에, 장식 모양 안에만 얹는다. 테두리는 그 바깥을 감싼다.
    if (patterned){ defs += patternDefs(pattern, row[6]); body += '<rect width="120" height="105" fill="url(#pt)" mask="url(#pm)" opacity="' + pattern.k + '"/>'; }
    if (ol){
      defs += '<filter id="ol" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
        + '<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 40 0" result="a"/>'
        + '<feMorphology in="a" operator="dilate" radius="' + ol.t + '" result="d"/><feComposite in="d" in2="a" operator="out" result="ring"/>'
        + '<feFlood flood-color="' + ol.c + '"/><feComposite in2="ring" operator="in" result="line"/>'
        + '<feMerge><feMergeNode in="line"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      body = '<g filter="url(#ol)">' + body + "</g>";
    }
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 105"><defs>' + defs + "</defs>" + body + "</svg>");
  }
  // 물들일 색을 고르거나(없으면 세기 0.85로 시작) 원래 색으로 돌린다. 늘 새 객체로 바꿔 넣는다.
  function setTint(item, color){
    pickedParts(item).forEach(part => {
      if (!color){ delete part.cl; return; }
      const now = partColor(part) || { h:0, s:1, b:1, t:"", k:.85 };
      part.cl = { ...now, t:color, k:now.t ? now.k : .85 };
    });
    updateStickerElements(); save(item);
  }
  const editColor = (item, key, value) => pickedParts(item).forEach(part => {
    const now = partColor(part) || { h:0, s:1, b:1, t:"", k:.85 };
    part.cl = { ...now, [key]:value };
  });

  const button = (label, action, className="") => { const el = document.createElement("button"); el.type = "button"; el.textContent = label; el.className = className; if (action) el.onclick = action; return el; };
  const uiIconHtml = (name, fallback) => typeof window.uiIcon === "function" ? window.uiIcon(name) : fallback;
  const iconButton = (icon, label, action, className="") => { const el = button("", action, className); el.innerHTML = uiIconHtml(icon, label); el.title = label; el.setAttribute("aria-label", label); return el; };
  const status = message => { const el = root && root.querySelector(".pa-status"); if (el) el.textContent = message; };
  const notice = message => { status(message); if (typeof toast === "function") toast(message, 3000); };
  function db(){
    if (!dbPromise) dbPromise = new Promise((resolve,reject) => { const request = indexedDB.open("classdock-photo-album-v1", 1); request.onupgradeneeded = () => request.result.createObjectStore("media", { keyPath:"id" }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return dbPromise;
  }
  async function query(mode, command){
    const database = await db();
    return new Promise((resolve,reject) => { const tx = database.transaction("media", mode); const req = command(tx.objectStore("media")); tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }
  async function nativeRequest(method, route, body){
    const response = await fetch(route, { method, body, cache:"no-store", headers:{ "X-ClassDock-Album":"1" } });
    if (!response.ok) throw new Error("사진첩 저장소 응답: " + response.status);
    return response;
  }
  function metadata(item){
    const { blob, ...rest } = item;
    return { ...rest, mime:item.mime || (blob && blob.type) || "application/octet-stream" };
  }
  async function persistMetadata(item){
    if (!nativeStorage) return query("readwrite", store => store.put(item));
    return nativeRequest("POST", "/photo-album-meta?id=" + encodeURIComponent(item.id), JSON.stringify(metadata(item)));
  }
  async function persistNew(item){
    if (!nativeStorage) return query("readwrite", store => store.put(item));
    if (item.blob.size > 256 * 1024 * 1024) throw new Error("photo-album-file-too-large");
    await nativeRequest("POST", "/photo-album-file?id=" + encodeURIComponent(item.id), item.blob);
    await persistMetadata(item);
  }
  async function deleteItem(item){
    if (!nativeStorage) return query("readwrite", store => store.delete(item.id));
    await nativeRequest("POST", "/photo-album-delete?id=" + encodeURIComponent(item.id));
    await query("readwrite", store => store.delete(item.id)).catch(() => {});
  }
  // 배경음악. 음악 파일은 type "audio" 기록(원본은 사진처럼 파일로)으로 따로 저장하고, 사진에는 music = { id, name, v:소리 크기 } 만 둔다.
  // 사진마다 자기 음악 기록을 갖고, 음악을 빼거나 사진을 지우면 더 쓰는 곳이 없는 음악 기록도 지운다.
  const MUSIC_MAX_BYTES = 50 * 1024 * 1024;
  let audioRecords = [];
  const audioById = id => audioRecords.find(record => record.id === id);
  // 재생목록: music.tracks = [{ id, name, ls, le, li }] (곡마다 구간). 예전 한 곡짜리(music.id·name·ls·le·li)도 한 곡 목록으로 읽는다.
  // music.order = "seq"(순서대로) | "shuffle"(섞어서), music.tx = 곡 사이 겹침(초, 0~5). 음량 v·페이드 fi/fo 는 목록 전체에 쓴다.
  const TRACK_GAP_MAX = 5;
  function musicTracks(music){
    if (!music || typeof music !== "object") return [];
    const list = Array.isArray(music.tracks) ? music.tracks : music.id ? [{ id:music.id, name:music.name, ls:music.ls, le:music.le, li:music.li }] : [];
    return list.filter(track => track && typeof track.id === "string" && audioById(track.id));
  }
  const musicOf = item => item && item.music && typeof item.music === "object" && musicTracks(item.music).length ? item.music : null;
  // 사진첩 전체 배경음악: 원본 파일 없는 type "album" 기록 하나(고정 id)에 사진과 같은 꼴(music)로 둔다. 재생 엔진은 이것도 사진처럼 다룬다.
  // 사진 음악 우선: 사진에 음악이 있으면 그 음악, 없으면 전체 음악. 전체 음악끼리 넘길 땐 같은 세션이라 끊기지 않고 이어진다.
  const ALBUM_ID = "c1a55d0c-a1b0-4a1b-8000-000000000001";
  let albumItem = { id:ALBUM_ID, type:"album", created:0 };
  function albumRecord(list){
    const found = list.find(record => record && record.type === "album" && record.id === ALBUM_ID);
    return found ? { ...found, id:ALBUM_ID, type:"album" } : { id:ALBUM_ID, type:"album", created:0 };
  }
  const musicSource = item => musicOf(item) ? item : item && item.type === "image" && musicOf(albumItem) ? albumItem : null;
  // 고칠 때 예전 한 곡짜리를 목록 꼴로 바꿔 둔다.
  function playlistMusic(item){
    const music = item.music && typeof item.music === "object" ? item.music : {};
    const legacy = !Array.isArray(music.tracks) && music.id ? [{ id:music.id, name:music.name, ...(music.ls !== undefined ? { ls:music.ls } : {}), ...(music.le !== undefined ? { le:music.le } : {}), ...(music.li ? { li:true } : {}) }] : [];
    const tracks = Array.isArray(music.tracks) ? music.tracks.slice() : legacy;
    const { id, name, ls, le, li, ...rest } = music; void id; void name; void ls; void le; void li;
    item.music = { v:.8, ...rest, tracks };
    return item.music;
  }
  // 곡별 음량 track.tv(0~1, 기본 1). 목록 전체 음량(music.v)에 곱한다. 감상 모드의 audio 는 1 을 못 넘으므로 1 까지만 둔다.
  const trackVolume = track => Number.isFinite(Number(track && track.tv)) ? Math.max(0, Math.min(1, Number(track.tv))) : 1;
  // 곡별 페이드 track.fi / track.fo (초, 0~5). 여러 곡이면 그 곡이 시작·끝날 때, 한 곡이면 되풀이될 때마다(이음새를 가림).
  // 곡 사이 겹침과 함께 쓰면 둘 중 긴 쪽 곡선을 쓴다(감상 모드는 두 곡선 중 작은 값 = MP4 의 긴 곡선과 같다).
  const TRACK_FADE_MAX = 5;
  function trackFades(track){
    const num = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(TRACK_FADE_MAX, Number(value))) : 0;
    return { i:num(track && track.fi), o:num(track && track.fo) };
  }
  // 한 조각(start~end, 초) 안에서 들어갈 때·나갈 때 곡선을 따로 준다. 조각보다 길면 같은 비율로 줄인다.
  function segmentFade(fadeIn, fadeOut, length){
    if (fadeIn + fadeOut > length && length > 0){ const ratio = length/(fadeIn + fadeOut); fadeIn *= ratio; fadeOut *= ratio; }
    return { i:fadeIn, o:fadeOut };
  }
  function fadeParts(fade, t, start, end){
    return { rise:fade.i > 0 ? Math.max(0, Math.min(1, (t - start)/fade.i)) : 1, fall:fade.o > 0 ? Math.max(0, Math.min(1, (end - t)/fade.o)) : 1 };
  }
  // Web Audio 크기 값에 한 조각의 곡선을 새긴다(MP4).
  function rampSegment(param, fade, start, end){
    if (fade.i > 0){ param.setValueAtTime(0, start); param.linearRampToValueAtTime(1, start + fade.i); }
    if (fade.o > 0){ param.setValueAtTime(1, end - fade.o); param.linearRampToValueAtTime(0, end); }
  }
  // 곡별 반복 횟수 track.rc(1~10, 기본 1): 재생목록에서 그 곡(재생 구간)을 몇 번 이어 튼 뒤 다음 곡으로 갈지.
  // 반복 사이는 끊김 없이 잇고, 곡 페이드는 첫 반복 시작·마지막 반복 끝에만, 곡 사이 겹침은 마지막 반복 끝에만 든다. 한 곡뿐이면 안 쓴다.
  const TRACK_REPEAT_MAX = 10;
  const trackRepeats = track => Number.isFinite(Number(track && track.rc)) ? Math.max(1, Math.min(TRACK_REPEAT_MAX, Math.round(Number(track.rc)))) : 1;
  // 곡별 재생 속도 track.sp(0.5~2, 기본 1). 음 높이는 그대로 두고 빠르기만 바꾼다(감상 모드는 audio.preservesPitch, MP4 는 아래 timeStretch).
  // 재생 구간·반복은 곡 안 시간, 곡 페이드·겹침은 실제로 들리는 시간 기준이다.
  const trackSpeed = track => Number.isFinite(Number(track && track.sp)) ? Math.max(.5, Math.min(2, Number(track.sp))) : 1;
  // 음 높이를 지키며 길이만 1/speed 로 바꾼 새 AudioBuffer(WSOLA: 겹쳐 붙일 조각을 파형이 가장 비슷한 자리에서 골라 창 씌워 더한다).
  // 비슷한 자리 찾기는 두 채널을 섞은 소리로 8칸 건너 재고 둘레만 1칸씩 다시 재서 빠르게 한다.
  function timeStretch(ctx, buffer, speed){
    if (!(speed > 0) || Math.abs(speed - 1) < 1e-6) return buffer;
    const frame = 2048, hop = frame/2, tolerance = 256, channels = buffer.numberOfChannels, input = [...Array(channels).keys()].map(c => buffer.getChannelData(c));
    const inLength = buffer.length, outLength = Math.max(1, Math.round(inLength/speed)), out = ctx.createBuffer(channels, outLength, buffer.sampleRate);
    const target = [...Array(channels).keys()].map(c => out.getChannelData(c)), weights = new Float32Array(outLength);
    const mono = new Float32Array(inLength); input.forEach(data => { for (let i = 0; i < inLength; i++) mono[i] += data[i]/channels; });
    const windowShape = new Float32Array(frame); for (let i = 0; i < frame; i++) windowShape[i] = .5 - .5*Math.cos(2*Math.PI*i/frame);
    const similarity = (a, b, step) => { let sum = 0; for (let i = 0; i < hop; i += step){ const x = a + i, y = b + i; if (x >= 0 && y >= 0 && x < inLength && y < inLength) sum += mono[x]*mono[y]; } return sum; };
    let previous = 0;
    for (let outStart = 0, k = 0; outStart < outLength; outStart += hop, k++){
      const nominal = Math.round(k*hop*speed);
      let start = nominal;
      if (k > 0){
        // 앞 조각이 자연스럽게 이어질 자리(previous + hop)와 가장 닮은 곳을 nominal 둘레에서 찾는다.
        const natural = previous + hop; let best = -Infinity, coarse = nominal;
        for (let delta = -tolerance; delta <= tolerance; delta += 8){ const value = similarity(natural, nominal + delta, 8); if (value > best){ best = value; coarse = nominal + delta; } }
        best = -Infinity;
        for (let delta = -8; delta <= 8; delta++){ const value = similarity(natural, coarse + delta, 2); if (value > best){ best = value; start = coarse + delta; } }
      }
      start = Math.max(0, Math.min(inLength - 1, start)); previous = start;
      for (let i = 0; i < frame; i++){
        const o = outStart + i, n = start + i; if (o >= outLength) break;
        const w = windowShape[i]; weights[o] += w;
        if (n < inLength) for (let c = 0; c < channels; c++) target[c][o] += input[c][n]*w;
      }
    }
    for (let o = 0; o < outLength; o++) if (weights[o] > 1e-6) for (let c = 0; c < channels; c++) target[c][o] /= weights[o];
    return out;
  }
  // 늘이거나 줄인 곡에 맞춰 곡 안 시간(재생 구간)을 옮긴 곡 설정.
  const scaledTrack = (track, speed) => speed === 1 ? track : { ...track, ...(Number.isFinite(Number(track.ls)) ? { ls:Number(track.ls)/speed } : {}), ...(Number.isFinite(Number(track.le)) ? { le:Number(track.le)/speed } : {}) };
  const trackGap = music => Number.isFinite(Number(music && music.tx)) ? Math.max(0, Math.min(TRACK_GAP_MAX, Number(music.tx))) : 0;
  // 섞어 틀기 순서는 사진과 바퀴 수로 정해진다(미리 듣기·감상 모드·MP4 가 같은 순서로 튼다).
  function playlistOrder(item, cycle){
    const count = musicTracks(item.music).length, order = [...Array(count).keys()];
    if (!item.music || item.music.order !== "shuffle" || count < 2) return order;
    let seed = 2166136261;
    for (const ch of String(item.id) + ":" + cycle){ seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
    for (let i = count - 1; i > 0; i--){ seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  }
  const musicVolume = music => Number.isFinite(Number(music.v)) ? Math.max(0, Math.min(1, Number(music.v))) : .8;
  // 배경음악 페이드 music.fi / music.fo (초, 0~10). 페이드아웃 기본 1.5초는 예전 MP4 끝의 서서히 줄이기와 같다.
  const MUSIC_FADE_MAX = 10;
  function musicFades(music){
    const num = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(MUSIC_FADE_MAX, Number(value))) : fallback;
    return { i:num(music && music.fi, 0), o:num(music && music.fo, 1.5) };
  }
  // 감상 모드에서 사진을 넘길 때의 겹침(크로스페이드) 길이. "auto" 면 각 사진의 페이드아웃·페이드인을 따르고,
  // 숫자면 넘길 때만 앞 음악은 그 시간 동안 줄고 새 음악은 그 시간 동안 커진다(모든 사진 공통, 이 컴퓨터에 기억).
  const CROSSFADE_KEY = "classdock.photoAlbum.crossfade";
  function crossfadeSetting(){
    try { const raw = localStorage.getItem(CROSSFADE_KEY); if (raw === null || raw === "auto") return null; const value = Number(raw); return Number.isFinite(value) ? Math.max(0, Math.min(MUSIC_FADE_MAX, value)) : null; }
    catch { return null; }
  }
  function setCrossfade(value){ try { localStorage.setItem(CROSSFADE_KEY, value === null ? "auto" : String(value)); } catch { /* 이번 화면에만 */ } }
  // 재생 한 번 = 세션. 소리 크기 = 음악 크기 × 들어올 때 곡선 × 나갈 때 곡선. 곡선이 움직이는 동안만 짧은 타이머가 돈다.
  // 사진을 넘기면 앞 세션은 줄어들며 끝나고 새 세션이 커지며 시작한다(겹쳐 넘어감).
  // 덕킹: 효과음이 날 때 배경음악을 잠깐 줄였다가 되돌린다. item.duck = { on, a:줄이는 정도 0~0.9, r:되돌아오는 초 0.1~2 } (사진별, 기본 끔).
  // 효과음마다 길이만큼 줄여 두고, 되돌아오기 전에 다음 소리가 나면 한 덩어리로 묶는다(음악이 들쭉날쭉하지 않게).
  const SOUND_LENGTHS = { pop:.13, boing:.38, chime:.5, thump:.2, bell:1.1, beep:.09, bubble:.09, whoosh:.45 }, DUCK_ATTACK = .05;
  function duckSettings(item){
    const duck = item && item.duck && typeof item.duck === "object" ? item.duck : {}, num = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Number(value))) : fallback;
    return { on:!!duck.on, a:num(duck.a, 0, .9, .65), r:num(duck.r, .1, 2, .5) };
  }
  // from~to 초 사이에 줄여야 할 구간들 [시작, 끝] (시작 전 DUCK_ATTACK 동안 내려가고, 끝 뒤 r 동안 올라온다).
  function duckBlocks(item, from, to, release){
    const events = [];
    soundParts(item).forEach(part => { const kind = partSound(part).k; soundTimes(part, Math.max(0, from - 3), to + DUCK_ATTACK).forEach(at => events.push([at, at + (SOUND_LENGTHS[kind] || .3)])); });
    events.sort((x, y) => x[0] - y[0]);
    const blocks = [];
    events.forEach(([start, end]) => { const last = blocks[blocks.length - 1]; if (last && start - DUCK_ATTACK <= last[1] + release) last[1] = Math.max(last[1], end); else blocks.push([start, end]); });
    return blocks;
  }
  // t 초에서 음악에 곱할 값(1 = 그대로).
  function duckGain(blocks, t, duck){
    let gain = 1;
    for (const [start, end] of blocks){
      let value = 1;
      if (t >= start - DUCK_ATTACK && t < start) value = 1 - duck.a*((t - (start - DUCK_ATTACK))/DUCK_ATTACK);
      else if (t >= start && t <= end) value = 1 - duck.a;
      else if (t > end && t < end + duck.r) value = 1 - duck.a*(1 - (t - end)/duck.r);
      gain = Math.min(gain, value);
    }
    return gain;
  }
  // 같은 곡선을 Web Audio 크기 값에 건다(MP4 굽기). 묶인 구간끼리는 올라오는 줄과 내려가는 줄이 겹치지 않는다.
  // 덕킹 강도 프리셋: 누르면 덕킹을 켜고 줄이기·복귀를 한 번에 맞춘다. 막대로 고치면 "직접" 이 된다.
  const DUCK_PRESETS = [["soft","살짝",{ a:.3, r:.8 }],["normal","보통",{ a:.65, r:.5 }],["strong","강하게",{ a:.85, r:.35 }],["mute","거의 끄기",{ a:.9, r:1 }]];
  function duckPresetOf(item){
    const duck = duckSettings(item); if (!duck.on) return "";
    const hit = DUCK_PRESETS.find(([, , values]) => Math.abs(values.a - duck.a) < 1e-6 && Math.abs(values.r - duck.r) < 1e-6);
    return hit ? hit[0] : "custom";
  }
  // 프리셋 단추의 음량 곡선 그림: 효과음이 울리는 칸(옅은 띠) 동안 음악이 얼마나 꺼지고(a) 끝난 뒤 얼마 만에(r) 돌아오는지.
  // 실제 값으로 그리므로 들리는 모양과 같다. 가로는 2.3초, 내려가는 기울기만 눈에 보이게 조금 늘렸다.
  function duckCurveSvg(a, r){
    const W = 48, H = 22, span = 2.3, start = .35, end = 1.05, sx = W/span, y = v => 2 + (H - 4)*(1 - v), fall = Math.max(DUCK_ATTACK, .08);
    const points = [[0,1],[start - fall,1],[start,1 - a],[end,1 - a],[end + r,1],[span,1]].map(([t,v]) => (t*sx).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    return `<svg class="pa-duck-curve" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect x="${(start*sx).toFixed(1)}" y="1" width="${((end - start)*sx).toFixed(1)}" height="${H - 2}" rx="2" fill="currentColor" opacity=".13"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function applyDuckPreset(item, id){
    const preset = DUCK_PRESETS.find(row => row[0] === id); if (!preset) return false;
    item.duck = { on:true, ...preset[2] }; return true;
  }
  function applyDuck(param, blocks, duck){
    param.setValueAtTime(1, 0);
    blocks.forEach(([start, end]) => {
      param.setValueAtTime(1, Math.max(0, start - DUCK_ATTACK)); param.linearRampToValueAtTime(1 - duck.a, start);
      param.setValueAtTime(1 - duck.a, end); param.linearRampToValueAtTime(1, end + duck.r);
    });
  }
  // 감상 모드에서 지금 음악에 곱할 값. 같은 사진의 효과음이 실제로 울리는 중일 때만(효과음 재생 시계로 잰다).
  // 전체 음악이 흐를 때는 지금 효과음이 나는 사진의 덕킹 설정을 따른다.
  function liveDuck(session){
    const owner = session.item === albumItem ? sfxSession && sfxSession.item : session.item, duck = duckSettings(owner);
    if (!duck.on || !sfxSession || sfxSession.item !== owner) return { gain:1, active:false };
    const t = sfxSession.ctx.currentTime - sfxSession.origin;
    return { gain:duckGain(duckBlocks(owner, t - 3, t + 1, duck.r), t, duck), active:true };
  }
  // 반복 구간 music.ls(시작 초)·music.le(끝 초, 없으면 곡 끝)·music.li(처음엔 곡 처음부터). 구간은 0.5초 이상이어야 한다.
  // 곡 길이(duration)를 알아야 끝을 맞출 수 있다. 모르면(아직 안 잼) 시작만 지키고 끝은 곡 끝으로 본다.
  const LOOP_MIN = .5;
  function musicLoop(music, duration){
    const known = Number.isFinite(duration) && duration > 0, total = known ? duration : Infinity;
    const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
    let start = Math.max(0, num(music && music.ls) || 0), end = num(music && music.le);
    end = end === null || end <= 0 ? total : Math.min(end, total);
    if (known && start > total - LOOP_MIN) start = Math.max(0, total - LOOP_MIN);
    if (end - start < LOOP_MIN) end = Math.min(total, start + LOOP_MIN);
    const on = start > 0 || end < total;
    return { on, start, end, intro:!!(music && music.li) && start > 0, startAt:!!(music && music.li) ? 0 : start };
  }
  const clockText = seconds => { if (!Number.isFinite(seconds)) return "끝"; const whole = Math.max(0, seconds); return Math.floor(whole/60) + ":" + (whole % 60).toFixed(1).padStart(4, "0"); };
  // 음악 기록의 곡 길이(초). 한 번 재면 기록에 적어 둔다.
  const durationLoads = new Map(), durationFailed = new Set();
  function ensureMusicDuration(record){
    if (!record || Number.isFinite(record.dur)) return Promise.resolve(record && record.dur);
    if (durationFailed.has(record.id)) return Promise.resolve(NaN); // 못 재는 파일을 그릴 때마다 다시 재지 않게
    if (durationLoads.has(record.id)) return durationLoads.get(record.id);
    const pending = getBlob(record).then(blob => new Promise(resolve => {
      const probe = new Audio(), url = URL.createObjectURL(blob);
      const done = value => { URL.revokeObjectURL(url); probe.removeAttribute("src"); resolve(value); };
      probe.preload = "metadata"; probe.onloadedmetadata = () => done(probe.duration); probe.onerror = () => done(NaN); probe.src = url;
    })).then(duration => { if (Number.isFinite(duration) && duration > 0){ record.dur = duration; persistMetadata(record).catch(() => {}); } else durationFailed.add(record.id); durationLoads.delete(record.id); paintMusic(); return record.dur; })
      .catch(() => { durationLoads.delete(record.id); durationFailed.add(record.id); return NaN; });
    durationLoads.set(record.id, pending);
    return pending;
  }
  // 곡 하나를 어디부터 어디까지 트는지. 한 곡뿐이면 구간을 되풀이(loop), 여러 곡이면 구간만 틀고 다음 곡으로(구간이 없으면 곡 전체).
  function trackSpan(track, duration, single){
    const region = musicLoop(track, duration), end = Number.isFinite(duration) ? duration : Infinity;
    if (single) return { from:region.on ? region.startAt : 0, to:region.on ? region.end : end, loop:region.on ? region : null };
    return { from:region.on ? region.start : 0, to:region.on ? region.end : end, loop:null };
  }
  // 감상 모드·미리 듣기 재생 = 세션. 곡마다 audio(플레이어)를 두고 40ms 타이머 하나가 다 챙긴다:
  // 소리 크기(음량 × 들어올·나갈 곡선 × 덕킹 × 곡 사이 겹침), 한 곡이면 구간 되풀이, 여러 곡이면 끝나기 "곡 사이 겹침" 만큼 앞서 다음 곡.
  let musicSession = null;
  const fadingMusic = new Set();
  function musicLevel(session){
    const now = performance.now(), music = session.item.music || {}, fades = musicFades(music);
    const fadeIn = Number.isFinite(session.fadeIn) ? session.fadeIn : fades.i;
    const rise = fadeIn > 0 ? Math.min(1, (now - session.started)/(fadeIn*1000)) : 1;
    const fall = session.stopping ? (session.fadeOut > 0 ? Math.max(0, 1 - (now - session.stopping)/(session.fadeOut*1000)) : 0) : 1;
    const duck = liveDuck(session);
    return { level:musicVolume(music)*rise*fall*duck.gain, moving:rise < 1 || (session.stopping && fall > 0) || duck.active, done:!!session.stopping && fall <= 0 };
  }
  const currentPlayer = session => session.players.filter(player => !player.dying).pop() || null;
  const liveTrack = (session, player) => musicTracks(session.item.music).find(track => track.id === player.track.id) || player.track;
  function stopPlayer(player){
    player.audio.pause(); player.audio.removeAttribute("src"); player.audio.load();
    if (player.url) URL.revokeObjectURL(player.url);
  }
  // tracks[index] 를 새 플레이어로 튼다. 첫 곡이 아니면 "곡 사이 겹침" 동안 커진다.
  // place: 전체 음악을 이어 틀 자리(albumPlace). 곡 안 위치·반복 차례를 되살린다.
  async function startPlayer(session, index, place = null){
    const tracks = musicTracks(session.item.music), track = tracks[index]; if (!track) return;
    const player = { track, audio:new Audio(), url:null, born:performance.now(), dying:0, fadeLen:0, first:!session.players.length, repeat:0 };
    session.players.push(player); session.audio = player.audio;
    const blob = await getBlob(audioById(track.id));
    if (!session.players.includes(player)) return;
    player.url = URL.createObjectURL(blob); player.audio.src = player.url; player.audio.volume = 0;
    player.audio.preservesPitch = true; player.audio.playbackRate = trackSpeed(track);
    // 구간이 있으면 그 시작(한 곡이면 "처음엔 곡 처음부터" 도 따름)에서 튼다. 곡 길이는 메타데이터를 읽은 뒤에 안다.
    const single = tracks.length <= 1, span = trackSpan(track, audioById(track.id).dur, single);
    if (span.from > 0) player.audio.currentTime = span.from;
    if (place && place.t > 0){ player.audio.currentTime = place.t; player.repeat = place.repeat; player.looped = place.looped; player.lastTime = place.t; }
    player.audio.addEventListener("loadedmetadata", () => { const again = trackSpan(liveTrack(session, player), player.audio.duration, musicTracks(session.item.music).length <= 1); if (again.from > 0 && player.audio.currentTime < again.from - .05) player.audio.currentTime = again.from; }, { once:true });
    player.born = performance.now(); tickMusic(session);
    await player.audio.play();
  }
  // 다음 곡으로(목록 끝이면 처음으로, 섞어서면 새 순서로). 지금 곡은 "곡 사이 겹침" 동안 줄어들며 끝난다.
  function advanceTrack(session){
    const tracks = musicTracks(session.item.music), current = currentPlayer(session);
    if (!current || tracks.length < 2) return;
    session.pos++; if (session.pos >= tracks.length){ session.pos = 0; session.cycle++; }
    current.dying = performance.now(); current.fadeLen = Math.max(.05, trackGap(session.item.music));
    startPlayer(session, playlistOrder(session.item, session.cycle)[session.pos]).catch(error => console.warn("다음 곡을 틀지 못했습니다:", error));
    paintMusic();
  }
  // 곡 안 재생 위치로 잰 곡별 페이드. 한 곡이면 되풀이 한 바퀴(처음엔 시작점부터, 되돌아간 뒤엔 구간 시작부터)가 한 조각이다.
  function playerFade(session, player, single){
    const audio = player.audio, track = liveTrack(session, player), fades = trackFades(track);
    if (!fades.i && !fades.o || !player.url) return { rise:1, fall:1 };
    const span = trackSpan(track, audio.duration, single), t = audio.currentTime;
    if (single && !span.loop && Number.isFinite(player.lastTime) && t < player.lastTime - .5) player.looped = true;   // 곡 전체 되풀이가 한 바퀴 돎
    player.lastTime = t;
    const start = single && player.looped ? (span.loop ? span.loop.start : 0) : span.from, end = single ? (span.loop ? span.loop.end : audio.duration) : span.to;
    if (!Number.isFinite(end)) return { rise:1, fall:1 };
    const speed = trackSpeed(track), parts = fadeParts(segmentFade(fades.i*speed, fades.o*speed, end - start), t, start, end);
    // 여러 번 이어 틀면 첫 반복에서만 커지고 마지막 반복에서만 줄어든다(중간 이음새에선 그대로).
    if (!single){ if (player.repeat > 0) parts.rise = 1; if (player.repeat < trackRepeats(track) - 1) parts.fall = 1; }
    return parts;
  }
  function tickMusic(session){
    const state = musicLevel(session), now = performance.now(), tracks = musicTracks(session.item.music), gap = trackGap(session.item.music);
    if (state.done){ endMusic(session); return; }
    for (const player of [...session.players]){
      const rise = player.first || gap <= 0 ? 1 : Math.min(1, (now - player.born)/(gap*1000));
      const fall = player.dying ? Math.max(0, 1 - (now - player.dying)/(player.fadeLen*1000)) : 1;
      if (player.dying && fall <= 0){ stopPlayer(player); session.players.splice(session.players.indexOf(player), 1); continue; }
      const own = playerFade(session, player, tracks.length <= 1);
      player.audio.volume = Math.max(0, Math.min(1, state.level*Math.min(rise, own.rise)*Math.min(fall, own.fall)*trackVolume(liveTrack(session, player))));
    }
    session.players.forEach(player => { const speed = trackSpeed(liveTrack(session, player)); if (player.audio.playbackRate !== speed) player.audio.playbackRate = speed; });
    const current = currentPlayer(session);
    if (current && current.url){
      const audio = current.audio, single = tracks.length <= 1, span = trackSpan(liveTrack(session, current), audio.duration, single);
      if (single){
        audio.loop = !span.loop;
        if (span.loop && (audio.currentTime >= span.loop.end - .03 || audio.ended)){ current.looped = true; current.lastTime = span.loop.start; audio.currentTime = span.loop.start; if (audio.paused && !session.stopping) audio.play().catch(() => {}); }
      } else {
        audio.loop = false;
        const lastRepeat = current.repeat >= trackRepeats(liveTrack(session, current)) - 1;
        if (!lastRepeat && Number.isFinite(span.to) && (audio.currentTime >= span.to - .03 || audio.ended)){
          current.repeat++; audio.currentTime = span.from; if (audio.paused && !session.stopping) audio.play().catch(() => {});
        } else if (lastRepeat && !session.stopping && Number.isFinite(span.to) && (audio.currentTime >= span.to - Math.max(.03, gap*trackSpeed(liveTrack(session, current))) || audio.ended)) advanceTrack(session);
      }
    }
    if (!session.timer) session.timer = setInterval(() => tickMusic(session), 40);
  }
  function endMusic(session){
    clearInterval(session.timer); session.timer = 0; fadingMusic.delete(session);
    session.players.forEach(stopPlayer); session.players = [];
  }
  // fadeOut 초 동안 줄이며 멈춘다(0 이면 바로). 멈춤 단추처럼 직접 멈출 땐 바로, 감상 모드를 끝내거나 사진을 넘길 땐 그 음악의 페이드아웃만큼.
  function stopMusic(fadeOut = 0){
    const session = musicSession; musicSession = null;
    if (session){
      const current = currentPlayer(session);
      if (fadeOut > 0 && current && !current.audio.paused){ session.stopping = performance.now(); session.fadeOut = fadeOut; fadingMusic.add(session); tickMusic(session); }
      else endMusic(session);
    }
    paintMusic();
  }
  function stopAllMusic(){ stopMusic(0); [...fadingMusic].forEach(endMusic); }
  // 전체 음악이 사진 음악에 자리를 내줄 때 멈춘 자리를 적어 두고, 다시 돌아오면 거기서 잇는다(감상 모드를 끝내면 잊는다).
  // 곡 목록이 바뀌어 그 곡이 그 차례에 없으면 처음부터.
  let albumResume = null;
  function albumPlace(session){
    const current = currentPlayer(session); if (!current || !current.url) return null;
    return { pos:session.pos, cycle:session.cycle, id:current.track.id, t:current.audio.currentTime || 0, repeat:current.repeat || 0, looped:!!current.looped };
  }
  function resumeIndex(item, place){
    if (!place) return -1;
    const index = playlistOrder(item, place.cycle)[place.pos], track = musicTracks(item.music)[index];
    return track && track.id === place.id ? index : -1;
  }
  // fadeIn·fadeOut 을 주면(크로스페이드) 사진별 페이드 대신 그 시간을 쓴다. resume 이면 전체 음악을 멈춘 자리에서 잇는다.
  async function playMusic(item, { fadeIn, fadeOut, resume = false } = {}){
    const music = musicOf(item); if (!music) return;
    if (musicPlaying(item)) return;
    stopMusic(musicSession ? (Number.isFinite(fadeOut) ? fadeOut : musicFades(musicSession.item.music).o) : 0);
    const place = resume && item === albumItem ? albumResume : null, resumeAt = resumeIndex(item, place); if (item === albumItem) albumResume = null;
    const session = { item, players:[], audio:null, started:performance.now(), stopping:0, fadeOut:0, fadeIn, timer:0, pos:resumeAt >= 0 ? place.pos : 0, cycle:resumeAt >= 0 ? place.cycle : 0 };
    musicSession = session;
    try {
      session.started = performance.now();
      await startPlayer(session, resumeAt >= 0 ? resumeAt : playlistOrder(item, 0)[0], resumeAt >= 0 ? place : null);
    } catch(error){ console.warn("배경음악을 틀지 못했습니다:", error); if (musicSession === session){ musicSession = null; endMusic(session); } notice("배경음악을 재생하지 못했습니다."); }
    paintMusic();
  }
  const musicPlaying = item => { const current = item && musicSession && musicSession.item === item && currentPlayer(musicSession); return !!(current && !current.audio.paused); };
  const playingTrackId = item => { const current = musicSession && musicSession.item === item && currentPlayer(musicSession); return current ? current.track.id : null; };
  // 사진이 바뀌거나 감상 모드를 오갈 때: 감상 중이고 음악이 있으면 틀고(앞 음악은 줄어들며 끝남), 아니면 줄이며 멈춘다.
  // switching: 감상 중에 다른 사진으로 넘어가는 경우(크로스페이드 길이를 정해 뒀으면 그 길이로 겹쳐 넘긴다).
  // 사진 음악 우선: 사진에 음악이 없으면 전체 음악(이미 흐르면 playMusic 이 그대로 둔다).
  function syncMusic({ switching = false } = {}){
    const source = musicSource(selected()), cross = switching && viewing ? crossfadeSetting() : null, timing = cross === null ? { resume:true } : { fadeIn:cross, fadeOut:cross, resume:true };
    if (!viewing) albumResume = null;
    else if (musicSession && musicSession.item === albumItem && source !== albumItem) albumResume = albumPlace(musicSession);
    if (viewing && source) playMusic(source, timing);
    else if (musicSession) stopMusic(cross !== null ? cross : musicFades(musicSession.item.music).o);
  }
  async function dropAudioRecord(id){
    if (!id || [albumItem, ...records].some(item => musicTracks(item.music).some(track => track.id === id))) return;
    const record = audioById(id); if (!record) return;
    audioRecords = audioRecords.filter(other => other.id !== id);
    try { await deleteItem(record); } catch(error){ console.warn("배경음악 파일을 지우지 못했습니다:", error); }
  }
  // 음악 파일(한 개 또는 여러 개)을 재생목록 끝에 더한다. 음악이 아니거나 너무 큰 파일은 알리고 건너뛴다.
  async function importMusic(item, files){
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (!item || (item.type !== "image" && item !== albumItem) || !list.length) return;
    let added = 0;
    for (const file of list){
      if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(file.name)){ notice(`"${file.name}" 은(는) 음악 파일이 아닙니다(mp3·m4a·wav·ogg 등).`); continue; }
      if (file.size > MUSIC_MAX_BYTES){ notice(`"${file.name}" 은(는) 50MB 를 넘어 넣을 수 없습니다.`); continue; }
      const record = { id:crypto.randomUUID(), type:"audio", name:file.name, mime:file.type || "audio/mpeg", blob:file, created:Date.now() };
      try { await persistNew(record); }
      catch(error){ console.error(error); notice(`"${file.name}" 을(를) 저장하지 못했습니다.`); continue; }
      audioRecords.push(record); ensureMusicDuration(record);
      playlistMusic(item).tracks.push({ id:record.id, name:file.name });
      added++;
    }
    if (!added) return;
    await save(item); paintMusic();
    status(musicTracks(item.music).length > 1 ? `${item === albumItem ? "전체 " : ""}배경음악 ${added}곡을 재생목록에 더했습니다 (모두 ${musicTracks(item.music).length}곡).` : item === albumItem ? "전체 배경음악을 넣었습니다. 음악이 없는 사진에서 흐릅니다." : "배경음악을 넣었습니다. ▶ 로 들어 보거나 감상 모드에서 들을 수 있습니다.");
  }
  async function removeTrack(item, id){
    const music = playlistMusic(item); if (!music.tracks.some(track => track.id === id)) return;
    if (musicSession && musicSession.item === item) stopMusic();
    music.tracks = music.tracks.filter(track => track.id !== id);
    if (!music.tracks.length) delete item.music;
    if (musicEditTrack === id) musicEditTrack = null;
    await save(item); await dropAudioRecord(id); paintMusic(); status(item.music ? "재생목록에서 곡을 뺐습니다." : "배경음악을 뺐습니다.");
  }
  async function removeMusic(item){
    const ids = musicTracks(item && item.music).map(track => track.id); if (!item || !item.music) return;
    if (musicSession && musicSession.item === item) stopMusic();
    delete item.music; await save(item);
    for (const id of ids) await dropAudioRecord(id);
    paintMusic(); status("배경음악을 모두 뺐습니다.");
  }
  function moveTrack(item, id, step){
    const music = playlistMusic(item), from = music.tracks.findIndex(track => track.id === id), to = from + step;
    if (from < 0 || to < 0 || to >= music.tracks.length) return false;
    [music.tracks[from], music.tracks[to]] = [music.tracks[to], music.tracks[from]];
    save(item); paintMusic(); return true;
  }
  // 곡 하나의 설정(구간 등)을 고친다. undefined 로 준 값은 지운다.
  function setTrack(item, id, patch){
    const music = playlistMusic(item);
    music.tracks = music.tracks.map(track => {
      if (track.id !== id) return track;
      const next = { ...track, ...patch }; Object.keys(next).forEach(key => { if (next[key] === undefined) delete next[key]; }); return next;
    });
  }
  // 사진 전체 효과음 크기 줄. 효과음이 붙은 장식이 없으면 잠가 둔다(updateStickerElements 가 풀고 잠근다).
  function paintSfxMaster(){
    const host = root && root.querySelector(".pa-sfx-master"); if (!host) return;
    host.replaceChildren();
    const item = selected(); if (!item || item.type !== "image") return;
    const label = document.createElement("strong"); label.textContent = "🔔 효과음 전체";
    const range = document.createElement("input"); range.type = "range"; range.min = 0; range.max = 150; range.step = 5; range.value = Math.round(sfxMaster(item)*100);
    range.dataset.sfxMaster = "1"; range.setAttribute("aria-label","이 사진의 효과음 전체 크기"); range.title = "장식마다 정한 효과음 크기를 모두 함께 키우거나 줄입니다(100% = 그대로)";
    const value = document.createElement("span"); value.className = "pa-music-name pa-sfx-value"; value.textContent = range.value + "%";
    range.oninput = () => { item.sfxv = Number(range.value)/100; value.textContent = range.value + "%"; };
    range.onchange = () => { save(item); const first = soundParts(item)[0]; if (first) previewSound(partSound(first).k, partSound(first).v); };
    const hint = document.createElement("small"); hint.className = "pa-sfx-hint"; hint.textContent = "효과음 칸에서 소리를 붙이면 쓸 수 있어요";
    host.append(label, range, value, hint);
    const fades = document.createElement("div"); fades.className = "pa-sfx-fades";
    [["페이드인","i","감상 모드를 시작하거나 이 사진으로 넘어올 때, MP4 영상 처음에 효과음이 서서히 커지는 시간"],["페이드아웃","o","감상 모드를 끝내거나 다른 사진으로 넘길 때, MP4 영상 끝에 효과음이 서서히 줄어드는 시간"]].forEach(([text,key,title]) => {
      const field = document.createElement("label"); field.className = "pa-sfx-fade"; field.title = title;
      const name = document.createElement("span"); name.textContent = text;
      const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.max = SFX_FADE_MAX; slider.step = .5; slider.value = sfxFade(item)[key]; slider.dataset.sfxMaster = "1"; slider.setAttribute("aria-label","효과음 " + text + " 시간(초)");
      const shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = sfxFade(item)[key] + "초";
      slider.oninput = () => { item.sfxf = { ...sfxFade(item), [key]:Number(slider.value) }; shown.textContent = slider.value + "초"; };
      slider.onchange = () => save(item);
      field.append(name, slider, shown); fades.appendChild(field);
    });
    host.appendChild(fades);
    syncSfxMaster(item);
  }
  function syncSfxMaster(item){
    const host = root && root.querySelector(".pa-sfx-master"); if (!host) return;
    const has = !!(item && soundParts(item).length);
    host.classList.toggle("is-empty", !has);
    host.querySelectorAll("[data-sfx-master]").forEach(el => { el.disabled = !has; });
  }
  function crossfadeRow(){
    const row = document.createElement("div"); row.className = "pa-sfx-fades pa-crossfade";
    const field = document.createElement("label"); field.className = "pa-sfx-fade"; field.title = "감상 모드에서 사진을 넘길 때 앞 음악이 줄고 새 음악이 커지는 겹침 시간입니다. 모든 사진에 같이 쓰입니다";
    const label = document.createElement("span"); label.textContent = "넘길 때 겹침";
    const auto = document.createElement("input"); auto.type = "checkbox"; auto.checked = crossfadeSetting() === null; auto.setAttribute("aria-label","크로스페이드 자동");
    const autoText = document.createElement("span"); autoText.textContent = "자동"; autoText.title = "각 사진의 페이드아웃·페이드인을 따릅니다";
    const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.max = MUSIC_FADE_MAX; slider.step = .5; slider.value = crossfadeSetting() ?? 2; slider.disabled = auto.checked; slider.setAttribute("aria-label","크로스페이드 길이(초)");
    const shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = auto.checked ? "사진별" : slider.value + "초";
    auto.onchange = () => { slider.disabled = auto.checked; setCrossfade(auto.checked ? null : Number(slider.value)); shown.textContent = auto.checked ? "사진별" : slider.value + "초"; };
    slider.oninput = () => { shown.textContent = slider.value + "초"; };
    slider.onchange = () => setCrossfade(Number(slider.value));
    const note = document.createElement("small"); note.className = "pa-crossfade-note"; note.textContent = "모든 사진 공통";
    field.append(label, auto, autoText, slider, shown); row.append(field, note); return row;
  }
  // 곡 구간 줄. 한 곡이면 "반복 구간"(되풀이), 여러 곡이면 "재생 구간"(그 부분만 틀고 다음 곡으로). 곡 길이를 모르면 잰 뒤 다시 그린다.
  let musicEditTrack = null;
  function loopRow(item, track, single){
    const row = document.createElement("div"); row.className = "pa-sfx-fades pa-music-loop";
    const record = audioById(track.id), duration = record && record.dur, word = single ? "반복 구간" : "재생 구간";
    if (!Number.isFinite(duration)){ const wait = document.createElement("small"); wait.className = "pa-crossfade-note"; wait.textContent = word + (durationFailed.has(track.id) ? ": 곡 길이를 알 수 없어 고칠 수 없습니다" : ": 곡 길이 재는 중…"); row.appendChild(wait); ensureMusicDuration(record); return row; }
    const loop = musicLoop(track, duration), live = () => musicTracks(item.music).find(other => other.id === track.id) || track;
    const onField = document.createElement("label"); onField.className = "pa-sfx-fade";
    onField.title = single ? "곡 전체 대신 정한 구간만 되풀이합니다(감상 모드·미리 듣기·MP4)" : "이 곡은 정한 부분만 틀고 다음 곡으로 넘어갑니다";
    const onBox = document.createElement("input"); onBox.type = "checkbox"; onBox.checked = loop.on;
    const onText = document.createElement("span"); onText.textContent = word + (single ? "" : " · " + (track.name || "곡"));
    onField.append(onBox, onText); row.appendChild(onField);
    onBox.onchange = () => {
      if (onBox.checked){ const start = Math.min(Math.max(0, duration*.25), duration - LOOP_MIN); setTrack(item, track.id, { ls:Math.round(start*10)/10, le:Math.round(Math.min(duration, start + Math.max(LOOP_MIN, duration*.5))*10)/10 }); }
      else setTrack(item, track.id, { ls:undefined, le:undefined, li:undefined });
      save(item); paintMusic();
    };
    if (!loop.on){ const hint = document.createElement("small"); hint.className = "pa-crossfade-note"; hint.textContent = (single ? "곡 전체 반복" : "곡 전체") + " · 길이 " + clockText(duration); row.appendChild(hint); return row; }
    [["시작","ls",loop.start],["끝","le",loop.end]].forEach(([text,key,value]) => {
      const field = document.createElement("label"); field.className = "pa-sfx-fade"; field.title = text === "시작" ? (single ? "되풀이를 시작할 곳" : "이 곡을 틀기 시작할 곳") : (single ? "여기에 닿으면 시작으로 돌아갑니다" : "여기에 닿으면 다음 곡으로 넘어갑니다");
      const label = document.createElement("span"); label.textContent = text;
      const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.max = Math.floor(duration*10)/10; slider.step = .1; slider.value = Math.round(value*10)/10; slider.setAttribute("aria-label", word + " " + text + "(초)");
      const shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = clockText(value);
      slider.oninput = () => {
        let next = Number(slider.value);
        // 시작과 끝이 서로 넘지 않게(0.5초 이상 떨어지게) 막는다.
        if (key === "ls") next = Math.min(next, musicLoop(live(), duration).end - LOOP_MIN); else next = Math.max(next, musicLoop(live(), duration).start + LOOP_MIN);
        next = Math.max(0, Math.min(duration, Math.round(next*10)/10)); slider.value = next;
        setTrack(item, track.id, { [key]:next }); shown.textContent = clockText(next);
      };
      slider.onchange = () => {
        save(item);
        const current = musicSession && musicSession.item === item && currentPlayer(musicSession);
        if (key === "ls" && current && current.track.id === track.id) current.audio.currentTime = musicLoop(live(), duration).start;
      };
      field.append(label, slider, shown); row.appendChild(field);
    });
    if (single){
      const introField = document.createElement("label"); introField.className = "pa-sfx-fade"; introField.title = "켜면 곡 처음부터 한 번 흐른 뒤 구간을 되풀이합니다(도입부 + 반복)";
      const introBox = document.createElement("input"); introBox.type = "checkbox"; introBox.checked = !!track.li;
      const introText = document.createElement("span"); introText.textContent = "처음엔 곡 처음부터";
      introBox.onchange = () => { setTrack(item, track.id, { li:introBox.checked || undefined }); save(item); };
      introField.append(introBox, introText); row.appendChild(introField);
    }
    return row;
  }
  // 곡별 페이드 줄(지금 고르는 곡). 한 곡이면 되풀이될 때마다 적용된다.
  function trackFadeRow(item, track, single){
    const row = document.createElement("div"); row.className = "pa-sfx-fades pa-track-fades";
    const note = document.createElement("small"); note.className = "pa-crossfade-note"; note.textContent = single ? "되풀이될 때마다" : "곡 " + (track.name || "");
    const fades = trackFades(track);
    [["곡 페이드인","fi","i","이 곡이 시작할 때(한 곡이면 되풀이될 때마다) 서서히 커지는 시간"],["곡 페이드아웃","fo","o","이 곡이 끝날 때(한 곡이면 되풀이 끝마다) 서서히 줄어드는 시간"]].forEach(([text,key,short,title]) => {
      const field = document.createElement("label"); field.className = "pa-sfx-fade"; field.title = title;
      const label = document.createElement("span"); label.textContent = text;
      const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.max = TRACK_FADE_MAX; slider.step = .5; slider.value = fades[short]; slider.setAttribute("aria-label", text + " 시간(초)");
      const shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = fades[short] + "초";
      slider.oninput = () => { setTrack(item, track.id, { [key]:Number(slider.value) || undefined }); shown.textContent = slider.value + "초"; };
      slider.onchange = () => save(item);
      field.append(label, slider, shown); row.appendChild(field);
    });
    const speedField = document.createElement("label"); speedField.className = "pa-sfx-fade"; speedField.title = "이 곡의 빠르기(음 높이는 그대로). 100% 가 원래 빠르기";
    const speedLabel = document.createElement("span"); speedLabel.textContent = "속도";
    const speed = document.createElement("input"); speed.type = "range"; speed.min = 50; speed.max = 200; speed.step = 5; speed.value = Math.round(trackSpeed(track)*100); speed.setAttribute("aria-label", "곡 재생 속도(%)");
    const speedShown = document.createElement("span"); speedShown.className = "pa-range-value"; speedShown.textContent = speed.value + "%";
    speed.oninput = () => { const value = Number(speed.value)/100; setTrack(item, track.id, { sp:value === 1 ? undefined : value }); speedShown.textContent = speed.value + "%"; if (musicSession && musicSession.item === item) tickMusic(musicSession); };
    speed.onchange = () => { save(item); paintMusic(); };
    speedField.append(speedLabel, speed, speedShown); row.appendChild(speedField);
    if (!single){
      const field = document.createElement("div"); field.className = "pa-sfx-fade pa-track-repeat"; field.title = "이 곡(재생 구간)을 몇 번 이어 튼 뒤 다음 곡으로 넘어갈지";
      const label = document.createElement("span"); label.textContent = "반복";
      const count = trackRepeats(track), shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = count + "번";
      const change = step => { const next = Math.max(1, Math.min(TRACK_REPEAT_MAX, trackRepeats(musicTracks(item.music).find(other => other.id === track.id)) + step)); setTrack(item, track.id, { rc:next > 1 ? next : undefined }); save(item); paintMusic(); };
      const less = button("−", () => change(-1), "pa-playlist-action"), more = button("+", () => change(1), "pa-playlist-action");
      less.disabled = count <= 1; more.disabled = count >= TRACK_REPEAT_MAX; less.title = "한 번 덜"; more.title = "한 번 더";
      field.append(label, less, shown, more); row.appendChild(field);
    }
    row.appendChild(note); return row;
  }
  const MUSIC_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus";
  function musicPicker(item, label, title){
    const input = document.createElement("input"); input.type = "file"; input.accept = MUSIC_ACCEPT; input.multiple = true; input.hidden = true;
    input.onchange = () => { const files = [...(input.files || [])]; input.value = ""; importMusic(item, files); };
    const pick = button(label, () => input.click(), "pa-music-button"); pick.title = title;
    return [pick, input];
  }
  // 배경음악 칸(오른쪽 칸 음악 탭): 머리(▶·곡 추가) + 재생목록. 아래 '재생 설정' 줄(.pa-music-play)에 순서·페이드·넘길 때 겹침·전체 볼륨,
  // 나머지(곡 사이 겹침·구간·곡별 페이드·속도·반복·덕킹)는 '세부 설정' 칸(.pa-music-more)에 둔다. 세부 설정 칸은 틀에 있어 다시 그려도 열림 상태가 남는다.
  let musicMoreOpen = false, musicScope = "photo";
  const durationText = seconds => { const whole = Math.round(seconds); return String(Math.floor(whole/60)).padStart(2, "0") + ":" + String(whole % 60).padStart(2, "0"); };
  function musicMoreToggle(){
    const toggle = button(musicMoreOpen ? "세부 설정 ▴" : "세부 설정 ▾", () => { musicMoreOpen = !musicMoreOpen; paintMusic(); }, "pa-more-toggle" + (musicMoreOpen ? " active" : ""));
    toggle.setAttribute("aria-expanded", String(musicMoreOpen)); toggle.title = "곡 사이 겹침·반복 구간·곡별 페이드·속도·효과음 날 때 줄이기·효과음 전체 크기";
    return toggle;
  }
  function paintMusic(){
    paintSfxMaster();
    const host = root && root.querySelector(".pa-music"); if (!host) return;
    const play = root.querySelector(".pa-music-play"), more = root.querySelector(".pa-music-more"), moreBox = root.querySelector(".pa-more");
    [host, play, more].forEach(el => { if (el) el.replaceChildren(); });
    const item = selected(), image = !!item && item.type === "image";
    if (moreBox) moreBox.hidden = !image || !musicMoreOpen;
    if (!image) return;
    const album = musicScope === "album", owner = album ? albumItem : item;
    const head = document.createElement("div"); head.className = "pa-music-head";
    const label = document.createElement("strong"); label.textContent = "♫ 배경음악"; label.title = "사진 음악이 먼저 나오고, 음악이 없는 사진에서는 전체 음악이 흐릅니다";
    head.appendChild(label); host.appendChild(head);
    // 이 사진 / 전체: 어느 쪽 음악을 고칠지. 음악이 들어 있는 쪽엔 ♪ 를 붙인다.
    const scope = document.createElement("div"); scope.className = "pa-order-switch pa-music-scope"; scope.setAttribute("role","group"); scope.setAttribute("aria-label","배경음악 적용 범위");
    [["photo","이 사진",item,"이 사진에만 흐르는 음악(있으면 전체 음악보다 먼저 나옵니다)"],["album","전체",albumItem,"음악이 없는 모든 사진에 흐르는 음악. 사진을 넘겨도 끊기지 않고 이어집니다"]].forEach(([id,text,target,title]) => {
      const on = musicScope === id, choice = button(text + (musicOf(target) ? " ♪" : ""), () => { musicScope = id; musicEditTrack = null; paintMusic(); }, on ? "active" : "");
      choice.title = title; choice.setAttribute("aria-pressed", String(on)); scope.appendChild(choice);
    });
    host.appendChild(scope);
    const playTitle = document.createElement("strong"); playTitle.className = "pa-play-title"; playTitle.textContent = album ? "재생 설정 · 전체" : "재생 설정";
    const music = musicOf(owner);
    if (!music){
      const [pick, input] = musicPicker(owner, "+ 음악 넣기", album ? "음악이 없는 사진에 흐를 음악을 고릅니다(여러 곡을 한꺼번에 골라 재생목록으로 만들 수 있어요)" : "감상 모드와 MP4 영상에 함께 나올 음악을 고릅니다(여러 곡을 한꺼번에 골라 재생목록으로 만들 수 있어요)");
      pick.classList.add("pa-music-add"); head.append(pick, input);
      const empty = document.createElement("p"); empty.className = "pa-music-empty";
      empty.textContent = album ? "모든 사진에 흐를 전체 음악을 넣어 보세요. 음악이 없는 사진에서 흐르고, 사진을 넘겨도 끊기지 않고 이어집니다."
        : musicOf(albumItem) ? "이 사진엔 따로 넣은 음악이 없어 전체 음악이 흐릅니다. 여기에 음악을 넣으면 이 사진에선 그 음악이 먼저 나옵니다."
        : "이 사진에 흐를 음악을 넣어 보세요. 여러 곡을 한꺼번에 고르면 재생목록이 됩니다.";
      host.appendChild(empty);
      if (play) play.append(playTitle, crossfadeRow(), musicMoreToggle());
      return;
    }
    const tracks = musicTracks(music), single = tracks.length === 1, playing = musicPlaying(owner), nowId = playingTrackId(owner);
    const toggle = button(playing ? "⏸" : "▶", () => { if (musicPlaying(owner)) stopMusic(); else playMusic(owner); }, "pa-music-play-button" + (playing ? " playing" : "")); toggle.title = playing ? "멈춤" : "미리 듣기"; toggle.setAttribute("aria-label", toggle.title);
    const [add, addInput] = musicPicker(owner, "+ 곡 추가", "재생목록 끝에 곡을 더합니다(여러 곡 한꺼번에 가능)"); add.classList.add("pa-music-add");
    const clear = button("✕", () => removeMusic(owner), "pa-playlist-action pa-music-clear"); clear.title = "배경음악 모두 빼기";
    head.append(toggle, add, clear, addInput);
    // 재생목록: 곡 이름을 누르면 세부 설정에서 그 곡을 고친다. 막대는 곡별 크기, 오른쪽은 곡 길이. ↑↓ 로 순서, ✕ 로 빼기. 지금 나오는 곡엔 ♪.
    if (!tracks.some(track => track.id === musicEditTrack)) musicEditTrack = tracks[0].id;
    const list = document.createElement("ol"); list.className = "pa-playlist";
    tracks.forEach((track, index) => {
      const row = document.createElement("li"); row.className = "pa-playlist-row" + (track.id === musicEditTrack && !single ? " active" : "") + (track.id === nowId ? " playing" : "");
      const number = document.createElement("span"); number.className = "pa-playlist-num"; number.textContent = track.id === nowId ? "♪" : String(index + 1);
      const name = button((track.name || "음악") + (trackRepeats(track) > 1 ? " ×" + trackRepeats(track) : "") + (trackSpeed(track) !== 1 ? " · " + Math.round(trackSpeed(track)*100) + "%" : ""), () => { musicEditTrack = track.id; paintMusic(); }, "pa-playlist-name");
      name.title = (track.name || "") + (single ? "" : " — 눌러서 세부 설정에서 이 곡 고치기");
      const level = document.createElement("input"); level.type = "range"; level.className = "pa-playlist-volume"; level.min = 0; level.max = 100; level.step = 5; level.value = Math.round(trackVolume(track)*100);
      level.title = "이 곡 크기 " + level.value + "% (전체 볼륨에 곱함)"; level.setAttribute("aria-label", (track.name || "곡") + " 크기");
      level.oninput = () => { setTrack(owner, track.id, { tv:Number(level.value)/100 }); level.title = "이 곡 크기 " + level.value + "% (전체 볼륨에 곱함)"; if (musicSession && musicSession.owner === owner) tickMusic(musicSession); };
      level.onchange = () => save(owner);
      const record = audioById(track.id), duration = record && record.dur;
      if (!Number.isFinite(duration)) ensureMusicDuration(record);
      const length = document.createElement("span"); length.className = "pa-playlist-time"; length.textContent = Number.isFinite(duration) ? durationText(duration) : "--:--";
      const up = button("↑", () => moveTrack(owner, track.id, -1), "pa-playlist-action"); up.disabled = index === 0; up.title = "앞으로";
      const down = button("↓", () => moveTrack(owner, track.id, 1), "pa-playlist-action"); down.disabled = index === tracks.length - 1; down.title = "뒤로";
      const remove = button("✕", () => removeTrack(owner, track.id), "pa-playlist-action"); remove.title = "이 곡 빼기";
      row.append(number, name, level, length, up, down, remove); list.appendChild(row);
    });
    host.appendChild(list);
    // 재생 설정 줄
    if (play){
      play.appendChild(playTitle);
      if (!single){
        const orderField = document.createElement("div"); orderField.className = "pa-order-switch";
        [["seq","순서대로"],["shuffle","섞어서"]].forEach(([id,text]) => {
          const on = (music.order === "shuffle" ? "shuffle" : "seq") === id;
          const choice = button(text, () => { playlistMusic(owner).order = id; save(owner); paintMusic(); }, on ? "active" : ""); choice.setAttribute("aria-pressed", String(on));
          choice.title = id === "shuffle" ? "곡 순서를 섞어서 틉니다(사진마다 정해진 순서라 MP4 에도 같게 담김)" : "목록 순서대로 틉니다";
          orderField.appendChild(choice);
        });
        play.appendChild(orderField);
      }
      [["페이드 인","fi","i","감상 모드를 시작하거나 이 사진으로 넘어올 때, 미리 듣기와 MP4 영상 처음에 음악이 서서히 커지는 시간"],["페이드 아웃","fo","o","감상 모드를 끝내거나 다른 사진으로 넘길 때, MP4 영상 끝에 음악이 서서히 줄어드는 시간"]].forEach(([text,key,short,title]) => {
        const field = document.createElement("label"); field.className = "pa-sfx-fade"; field.title = title;
        const fadeLabel = document.createElement("span"); fadeLabel.textContent = text;
        const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.max = MUSIC_FADE_MAX; slider.step = .5; slider.value = musicFades(music)[short]; slider.setAttribute("aria-label","배경음악 " + text + " 시간(초)");
        const shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = musicFades(music)[short] + "초";
        slider.oninput = () => { playlistMusic(owner)[key] = Number(slider.value); shown.textContent = slider.value + "초"; };
        slider.onchange = () => save(owner);
        field.append(fadeLabel, slider, shown); play.appendChild(field);
      });
      play.appendChild(crossfadeRow());
      const volumeField = document.createElement("label"); volumeField.className = "pa-sfx-fade pa-music-volume"; volumeField.title = album ? "전체 배경음악 소리 크기" : "이 사진 배경음악 전체 소리 크기";
      const volumeLabel = document.createElement("span"); volumeLabel.textContent = "전체 볼륨";
      const volume = document.createElement("input"); volume.type = "range"; volume.min = 0; volume.max = 100; volume.value = Math.round(musicVolume(music)*100); volume.setAttribute("aria-label","배경음악 전체 볼륨");
      const volumeShown = document.createElement("span"); volumeShown.className = "pa-range-value"; volumeShown.textContent = volume.value + "%";
      volume.oninput = () => { playlistMusic(owner).v = Number(volume.value)/100; volumeShown.textContent = volume.value + "%"; if (musicSession && musicSession.owner === owner) tickMusic(musicSession); };
      volume.onchange = () => save(owner);
      volumeField.append(volumeLabel, volume, volumeShown); play.append(volumeField, musicMoreToggle());
    }
    if (!more) return;
    // 세부 설정 칸
    const moreHead = document.createElement("div"); moreHead.className = "pa-more-head";
    const moreTitle = document.createElement("strong"); moreTitle.textContent = album ? "♫ 전체 음악 세부 설정" : "♫ 음악 세부 설정";
    moreHead.appendChild(moreTitle);
    if (!single){ const hint = document.createElement("small"); hint.className = "pa-crossfade-note"; hint.textContent = "재생목록에서 곡 이름을 누르면 그 곡을 고칩니다"; moreHead.appendChild(hint); }
    more.appendChild(moreHead);
    if (!single){
      const gapField = document.createElement("label"); gapField.className = "pa-sfx-fade"; gapField.title = "한 곡이 끝날 때 다음 곡과 겹쳐 넘어가는 시간(0초면 바로 이어짐)";
      const gapLabel = document.createElement("span"); gapLabel.textContent = "곡 사이 겹침";
      const gap = document.createElement("input"); gap.type = "range"; gap.min = 0; gap.max = TRACK_GAP_MAX; gap.step = .5; gap.value = trackGap(music); gap.setAttribute("aria-label","곡 사이 겹침(초)");
      const gapShown = document.createElement("span"); gapShown.className = "pa-range-value"; gapShown.textContent = trackGap(music) + "초";
      gap.oninput = () => { playlistMusic(owner).tx = Number(gap.value); gapShown.textContent = gap.value + "초"; };
      gap.onchange = () => save(owner);
      gapField.append(gapLabel, gap, gapShown);
      const options = document.createElement("div"); options.className = "pa-sfx-fades pa-playlist-options"; options.appendChild(gapField); more.appendChild(options);
    }
    const ducking = document.createElement("div"); ducking.className = "pa-sfx-fades pa-duck";
    const duck = duckSettings(item), setDuck = (key, value) => { item.duck = { ...duckSettings(item), [key]:value }; if (musicSession && musicSession.item === item) tickMusic(musicSession); };
    const duckField = document.createElement("label"); duckField.className = "pa-sfx-fade"; duckField.title = "효과음이 울리는 동안 배경음악을 잠깐 줄였다가 되돌립니다(감상 모드·MP4)";
    const duckToggle = document.createElement("input"); duckToggle.type = "checkbox"; duckToggle.checked = duck.on;
    const duckText = document.createElement("span"); duckText.textContent = "효과음 날 때 줄이기";
    duckField.append(duckToggle, duckText); ducking.appendChild(duckField);
    const presets = document.createElement("div"); presets.className = "pa-duck-presets";
    const group = document.createElement("div"); group.className = "pa-duck-group"; group.setAttribute("role","group"); group.setAttribute("aria-label","줄이기 강도");
    const current = duckPresetOf(item);
    DUCK_PRESETS.forEach(([id,presetLabel,values]) => {
      const preset = button("", () => { applyDuckPreset(item, id); if (musicSession && musicSession.item === item) tickMusic(musicSession); save(item); paintMusic(); }, "pa-duck-preset" + (current === id ? " active" : ""));
      preset.innerHTML = duckCurveSvg(values.a, values.r);
      const name = document.createElement("span"); name.textContent = presetLabel; preset.appendChild(name);
      preset.title = `${presetLabel} — 줄이기 ${Math.round(values.a*100)}% · 복귀 ${values.r}초`; preset.setAttribute("aria-pressed", String(current === id)); group.appendChild(preset);
    });
    presets.appendChild(group);
    if (current === "custom"){ const custom = document.createElement("small"); custom.className = "pa-crossfade-note"; custom.textContent = "직접 맞춤"; presets.appendChild(custom); }
    ducking.appendChild(presets);
    [["줄이기","a",0,90,5,100,"%","효과음이 나는 동안 음악을 얼마나 줄일지"],["복귀","r",.1,2,.1,1,"초","효과음이 끝난 뒤 음악이 원래 크기로 돌아오는 시간"]].forEach(([text,key,min,max,step,scale,unit,title]) => {
      const field = document.createElement("label"); field.className = "pa-sfx-fade"; field.title = title;
      const duckLabel = document.createElement("span"); duckLabel.textContent = text;
      const slider = document.createElement("input"); slider.type = "range"; slider.min = min; slider.max = max; slider.step = step; slider.value = Math.round(duck[key]*scale*10)/10; slider.disabled = !duck.on; slider.setAttribute("aria-label","배경음악 " + text);
      const shown = document.createElement("span"); shown.className = "pa-range-value"; shown.textContent = slider.value + unit;
      slider.oninput = () => { setDuck(key, Number(slider.value)/scale); shown.textContent = slider.value + unit; };
      slider.onchange = () => { save(item); paintMusic(); };
      field.append(duckLabel, slider, shown); ducking.appendChild(field);
    });
    duckToggle.onchange = () => { setDuck("on", duckToggle.checked); save(item); paintMusic(); };
    const editing = tracks.find(track => track.id === musicEditTrack) || tracks[0];
    more.append(loopRow(owner, editing, single), trackFadeRow(owner, editing, single));
    // 효과음 날 때 줄이기는 효과음이 붙은 사진마다 정한다(전체 음악이 흐를 때도 그 사진 설정을 따른다).
    if (!album) more.appendChild(ducking);
    else { const note = document.createElement("small"); note.className = "pa-crossfade-note"; note.textContent = "효과음 날 때 줄이기는 '이 사진' 쪽에서 사진마다 정합니다."; more.appendChild(note); }
  }
  // 효과음 sfx = { k:소리, v:크기 0~1 }. 파일 없이 Web Audio 로 그때그때 만든다(실시간 재생과 MP4 굽기가 같은 함수를 써서 소리가 같다).
  // 움직임마다 소리가 나는 순간(한 바퀴 안의 비율): 통통은 땅에 닿을 때, 두근은 박동마다, 흔들흔들은 양 끝에서.
  const SOUNDS = [["","없음"],["pop","뿅"],["boing","통"],["chime","반짝"],["thump","두근"],["bell","딩"],["beep","삑"],["bubble","뽁"],["whoosh","휘익"]];
  const SOUND_PHASES = { bounce:[.6], float:[.5], swing:[.25,.75], spin:[0], pulse:[.15,.45], twinkle:[0], shake:[0], jelly:[.3] };
  const SFX_KEY = "classdock.photoAlbum.sfx";
  function partSound(part){
    const sfx = part.sfx; if (!sfx || typeof sfx !== "object" || !SOUNDS.some(row => row[0] && row[0] === sfx.k)) return null;
    return { k:sfx.k, v:Number.isFinite(Number(sfx.v)) ? Math.max(0, Math.min(1, Number(sfx.v))) : .6 };
  }
  // 소리 나는 시각들(초). 움직임이 없으면 소리도 없다.
  function soundTimes(part, from, to){
    const animation = partAnimation(part), sound = partSound(part); if (!animation || !sound) return [];
    const times = [];
    for (let cycle = Math.max(0, Math.floor(from/animation.d) - 1); cycle*animation.d < to; cycle++){
      (SOUND_PHASES[animation.k] || [0]).forEach(phase => { const at = (cycle + phase)*animation.d; if (at >= from && at < to) times.push(at); });
    }
    return times.sort((a, b) => a - b);
  }
  function noiseBuffer(ctx, seconds){
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*seconds), ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random()*2 - 1;
    return buffer;
  }
  // when 시각에 kind 소리를 destination 으로 낸다(AudioContext·OfflineAudioContext 모두).
  function playSound(ctx, kind, when, volume, destination){
    const out = ctx.createGain(); out.gain.value = volume*.7; out.connect(destination);
    const tone = (type, freq, start, length, peak, endFreq) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = type;
      osc.frequency.setValueAtTime(freq, when + start); if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, when + start + length*.8);
      gain.gain.setValueAtTime(.0001, when + start); gain.gain.exponentialRampToValueAtTime(peak, when + start + .01); gain.gain.exponentialRampToValueAtTime(.0001, when + start + length);
      osc.connect(gain).connect(out); osc.start(when + start); osc.stop(when + start + length + .02);
    };
    if (kind === "pop") tone("sine", 420, 0, .13, .9, 1250);
    else if (kind === "boing") tone("triangle", 430, 0, .38, .8, 110);
    else if (kind === "chime"){ tone("sine", 1760, 0, .5, .35); tone("sine", 2637, .05, .45, .25); tone("sine", 3520, .1, .4, .18); }
    else if (kind === "thump") tone("sine", 120, 0, .2, 1, 48);
    else if (kind === "bell"){ tone("sine", 880, 0, 1.1, .5); tone("sine", 1760, 0, .7, .15); tone("sine", 2640, 0, .35, .06); }
    else if (kind === "beep") tone("square", 1040, 0, .09, .22);
    else if (kind === "bubble") tone("sine", 240, 0, .09, .8, 980);
    else if (kind === "whoosh"){
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = noiseBuffer(ctx, .45); filter.type = "bandpass"; filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(400, when); filter.frequency.exponentialRampToValueAtTime(3200, when + .38);
      gain.gain.setValueAtTime(.0001, when); gain.gain.exponentialRampToValueAtTime(.8, when + .15); gain.gain.exponentialRampToValueAtTime(.0001, when + .42);
      source.connect(filter).connect(gain).connect(out); source.start(when); source.stop(when + .45);
    }
  }
  // 사진 전체 효과음 크기(item.sfxv). 장식마다 정한 크기에 곱한다. 배경음악과의 균형을 맞추는 데 쓴다.
  const sfxMaster = item => item && Number.isFinite(Number(item.sfxv)) ? Math.max(0, Math.min(1.5, Number(item.sfxv))) : 1;
  const soundParts = item => (item && item.stickers || []).filter(part => !part.h && partSound(part) && partAnimation(part) && rowOf(part));
  function soundsEnabled(){ try { return localStorage.getItem(SFX_KEY) !== "off"; } catch { return true; } }
  // 감상 모드에서 움직임에 맞춰 효과음을 낸다. 0.1초마다 앞으로 0.3초 안에 날 소리를 미리 걸어 둔다.
  let stageStartedAt = 0, previewContext = null;
  // 효과음 페이드 item.sfxf = { i:시작할 때 서서히 커지는 초, o:끝날 때 서서히 줄어드는 초 } (사진별, 0~5초, 기본 0).
  const SFX_FADE_MAX = 5;
  function sfxFade(item){
    const fade = item && item.sfxf && typeof item.sfxf === "object" ? item.sfxf : {}, num = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(SFX_FADE_MAX, Number(value))) : 0;
    return { i:num(fade.i), o:num(fade.o) };
  }
  // start 부터 seconds 동안의 크기 곡선(0→1→0)을 건다. 페이드인과 페이드아웃이 겹칠 만큼 짧으면 둘을 같은 비율로 줄인다.
  function applySfxFade(gain, fade, start, seconds){
    let fadeIn = fade.i, fadeOut = Number.isFinite(seconds) ? fade.o : 0;
    if (fadeIn + fadeOut > seconds){ const ratio = seconds/(fadeIn + fadeOut); fadeIn *= ratio; fadeOut *= ratio; }
    gain.setValueAtTime(fadeIn > 0 ? 0 : 1, start);
    if (fadeIn > 0) gain.linearRampToValueAtTime(1, start + fadeIn);
    if (fadeOut > 0){ gain.setValueAtTime(1, start + seconds - fadeOut); gain.linearRampToValueAtTime(0, start + seconds); }
  }
  // 감상 모드 효과음 재생 한 번(= 사진 하나). 모든 소리는 bus(크기 곡선)를 거친다. 멈출 때 페이드아웃이 있으면
  // 그동안에도 그 사진의 소리를 계속 예약하며 줄이다가 끝나면 닫는다(사진을 넘기면 앞 소리가 줄며 새 소리가 커진다).
  let sfxSession = null;
  const fadingSessions = new Set();
  function closeSession(session){ clearInterval(session.timer); fadingSessions.delete(session); session.ctx.close().catch(() => {}); }
  function stopSfx(fadeOut = 0){
    const session = sfxSession; sfxSession = null; if (!session) return;
    if (!(fadeOut > 0) || session.ctx.state !== "running"){ closeSession(session); return; }
    const now = session.ctx.currentTime, gain = session.bus.gain;
    gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now); gain.linearRampToValueAtTime(0, now + fadeOut);
    fadingSessions.add(session); session.closer = setTimeout(() => closeSession(session), fadeOut*1000 + 150);
  }
  function stopAllSfx(){ stopSfx(0); fadingSessions.forEach(session => { clearTimeout(session.closer); closeSession(session); }); }
  function syncSfx(){
    stopSfx(sfxSession ? sfxFade(sfxSession.item).o : 0);
    const item = selected(), reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!viewing || !soundsEnabled() || !motionEnabled() || reduced || !soundParts(item).length || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext(), bus = ctx.createGain(); bus.connect(ctx.destination);
    applySfxFade(bus.gain, sfxFade(item), ctx.currentTime, Infinity);
    // 화면 움직임은 무대를 그린 때부터 돌기 시작했으니 그만큼 앞당겨 맞춘다.
    const session = { ctx, bus, item, origin:ctx.currentTime - (performance.now() - stageStartedAt)/1000, scheduled:ctx.currentTime, timer:0, closer:0 };
    const tick = () => {
      const horizon = ctx.currentTime + .3, master = sfxMaster(session.item);
      soundParts(session.item).forEach(part => soundTimes(part, session.scheduled - session.origin, horizon - session.origin).forEach(at => playSound(ctx, partSound(part).k, session.origin + at, partSound(part).v*master, bus)));
      session.scheduled = horizon;
    };
    tick(); session.timer = setInterval(tick, 100);
    sfxSession = session;
    if (musicSession) tickMusic(musicSession);
  }
  function previewSound(kind, volume){
    if (!kind || typeof AudioContext === "undefined") return;
    volume *= sfxMaster(selected());
    if (!previewContext) previewContext = new AudioContext();
    previewContext.resume().catch(() => {});
    playSound(previewContext, kind, previewContext.currentTime + .02, volume, previewContext.destination);
  }
  function setSound(item, kind){
    pickedParts(item).forEach(part => { const now = partSound(part); if (!kind) delete part.sfx; else part.sfx = { k:kind, v:now ? now.v : .6 }; });
    const first = pickedParts(item)[0]; if (kind && first) previewSound(kind, partSound(first).v);
    updateStickerElements(); save(item); syncSfx();
  }
  function soundToggle(){
    const row = document.createElement("label"); row.className = "pa-snap-toggle"; row.title = "감상 모드에서 움직이는 장식의 효과음을 들려줍니다";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = soundsEnabled();
    input.onchange = () => { try { localStorage.setItem(SFX_KEY, input.checked ? "on" : "off"); } catch { /* 이번 화면에만 적용 */ } syncSfx(); };
    const text = document.createElement("span"); text.textContent = "🔔 감상 모드 효과음";
    row.append(input, text); return row;
  }
  // MP4 에 넣을 소리: 배경음악(있으면 영상 길이만큼 되풀이, 끝 1.5초 서서히 줄임)과 효과음을 48kHz 두 채널로 함께 만들어 AAC 로 굽는다.
  // 여러 곡을 영상 길이만큼 차례로(섞어서면 감상 모드와 같은 순서로) 늘어놓는다. 곡 사이 겹침만큼 앞 곡은 줄고 다음 곡은 커진다.
  function schedulePlaylist(ctx, item, tracks, buffers, destination, seconds){
    const gap = trackGap(item.music), placed = [];
    let at = 0;
    for (let cycle = 0; at < seconds && cycle < 1000; cycle++){
      for (const index of playlistOrder(item, cycle)){
        if (at >= seconds) break;
        const buffer = buffers[index], span = trackSpan(tracks[index], buffer.duration, false), part = Math.max(LOOP_MIN, span.to - span.from), repeats = trackRepeats(tracks[index]);
        const length = part*repeats, overlap = Math.min(gap, length/2);
        const source = ctx.createBufferSource(), level = ctx.createGain(), fade = ctx.createGain(); source.buffer = buffer; level.gain.value = trackVolume(tracks[index]);
        if (repeats > 1){ source.loop = true; source.loopStart = span.from; source.loopEnd = span.from + part; }
        const own = trackFades(tracks[index]);
        rampSegment(fade.gain, segmentFade(Math.max(at > 0 ? overlap : 0, own.i), Math.max(overlap, own.o), length), at, at + length);
        source.connect(level).connect(fade).connect(destination); source.start(at, span.from, length);
        placed.push({ index, at, from:span.from, length, repeats });
        at += Math.max(LOOP_MIN, length - overlap);
      }
    }
    return placed;
  }
  // 음악은 사진 음악 우선(없으면 전체 음악), 덕킹·효과음은 그 사진 것.
  async function encodeMusic(item, seconds){
    const source = musicSource(item), music = source && source.music, effects = soundParts(item);
    if ((!music && !effects.length) || typeof AudioEncoder === "undefined" || typeof AudioData === "undefined" || typeof OfflineAudioContext === "undefined") return null;
    const rate = 48000, channels = 2, length = Math.ceil(seconds*rate);
    const config = { codec:"mp4a.40.2", sampleRate:rate, numberOfChannels:channels, bitrate:160000 };
    try { if (!(await AudioEncoder.isConfigSupported(config)).supported) return null; } catch { return null; }
    const offline = new OfflineAudioContext(channels, length, rate);
    if (music){
      const tracks = [], buffers = [];
      for (const track of musicTracks(music)){
        const decoded = await offline.decodeAudioData(await (await getBlob(audioById(track.id))).arrayBuffer()), speed = trackSpeed(track);
        buffers.push(speed === 1 ? decoded : timeStretch(offline, decoded, speed)); tracks.push(scaledTrack(track, speed));
      }
      const gain = offline.createGain(), envelope = offline.createGain(), ducking = offline.createGain(), duck = duckSettings(item);
      applySfxFade(envelope.gain, musicFades(music), 0, seconds); gain.gain.value = musicVolume(music);
      if (duck.on && effects.length) applyDuck(ducking.gain, duckBlocks(item, 0, seconds, duck.r), duck);
      envelope.connect(ducking).connect(gain).connect(offline.destination);
      if (tracks.length === 1){
        const source = offline.createBufferSource(), span = trackSpan(tracks[0], buffers[0].duration, true);
        source.buffer = buffers[0]; source.loop = true;
        if (span.loop){ source.loopStart = span.loop.start; source.loopEnd = span.loop.end; }
        const level = offline.createGain(), laps = offline.createGain(), fades = trackFades(tracks[0]); level.gain.value = trackVolume(tracks[0]);
        if (fades.i || fades.o){
          const lapStart = span.loop ? span.loop.start : 0, lapEnd = span.loop ? span.loop.end : buffers[0].duration;
          for (let at = 0, first = true, guard = 0; at < seconds && guard < 10000; guard++, first = false){
            const length = Math.max(.05, lapEnd - (first ? span.from : lapStart));
            rampSegment(laps.gain, segmentFade(fades.i, fades.o, length), at, at + length); at += length;
          }
        }
        source.connect(level).connect(laps).connect(envelope); source.start(0, span.from);
      } else schedulePlaylist(offline, source, tracks, buffers, envelope, seconds);
    }
    const master = sfxMaster(item), sfxBus = offline.createGain(); sfxBus.connect(offline.destination);
    applySfxFade(sfxBus.gain, sfxFade(item), 0, seconds);
    effects.forEach(part => { const sound = partSound(part); soundTimes(part, 0, seconds - .05).forEach(at => playSound(offline, sound.k, at, sound.v*master, sfxBus)); });
    const rendered = await offline.startRendering(), left = rendered.getChannelData(0), right = rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1));
    const samples = []; let asc = null, failure = null;
    const encoder = new AudioEncoder({
      output:(chunk, meta) => {
        const description = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (description && !asc) asc = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); samples.push({ data });
      },
      error:error => { failure = error; }
    });
    encoder.configure(config);
    const block = 4800;
    for (let at = 0; at < length && !failure; at += block){
      const frames = Math.min(block, length - at), planes = new Float32Array(frames*2);
      planes.set(left.subarray(at, at + frames), 0); planes.set(right.subarray(at, at + frames), frames);
      const data = new AudioData({ format:"f32-planar", sampleRate:rate, numberOfFrames:frames, numberOfChannels:channels, timestamp:Math.round(at*1e6/rate), data:planes });
      encoder.encode(data); data.close();
    }
    await encoder.flush(); encoder.close();
    if (failure) throw failure;
    return asc && samples.length ? { samples, asc, sampleRate:rate, channels } : null;
  }
  async function getBlob(item){
    if (item.blob) return item.blob;
    if (!nativeStorage) throw new Error("사진 원본이 없습니다.");
    if (blobLoads.has(item.id)) return blobLoads.get(item.id);
    const pending = nativeRequest("GET", "/photo-album-file?id=" + encodeURIComponent(item.id))
      .then(response => response.blob()).then(data => {
        item.blob = new Blob([data], { type:item.mime || "application/octet-stream" });
        return item.blob;
      }).finally(() => blobLoads.delete(item.id));
    blobLoads.set(item.id, pending);
    return pending;
  }
  // 되돌리기: 사진마다 장식·바탕을 save 할 때 앞 모양과 견줘 한 단계로 쌓는다.
  // 끌기·막대·휠은 끝날 때 한 번만 save 하므로 한 동작이 한 단계가 된다. 기준점은 무대에 처음 그릴 때 잡는다.
  const HISTORY_LIMIT = 100, histories = new Map();
  const historySnapshot = item => JSON.stringify({ stickers:item.stickers || [], background:item.background || "white" });
  function trackHistory(item){
    if (item && item.type === "image" && !histories.has(item.id)) histories.set(item.id, { base:historySnapshot(item), undo:[], redo:[] });
  }
  function recordHistory(item){
    const entry = item && histories.get(item.id); if (!entry) return;
    const now = historySnapshot(item); if (now === entry.base) return;
    entry.undo.push(entry.base); if (entry.undo.length > HISTORY_LIMIT) entry.undo.shift();
    entry.base = now; entry.redo = [];
  }
  function stepHistory(direction){
    const item = selected(); if (!item || item.type !== "image") return;
    clearTimeout(pendingSaveTimer); recordHistory(item);
    const entry = histories.get(item.id); if (!entry) return;
    const from = direction < 0 ? entry.undo : entry.redo, to = direction < 0 ? entry.redo : entry.undo;
    if (!from.length){ status(direction < 0 ? "더 되돌릴 꾸미기가 없습니다." : "다시 할 꾸미기가 없습니다."); return; }
    to.push(entry.base); entry.base = from.pop();
    const snapshot = JSON.parse(entry.base); item.stickers = snapshot.stickers; item.background = snapshot.background;
    picked = new Set(pickedParts(item).filter(pickable).map(part => part.id));
    save(item); paintBackgrounds(); paintStage(); paintAdjust();
  }
  // 방향키 1px, Shift+방향키 10px(사진 위 화면 기준)씩 고른 장식을 모두 옮긴다.
  function nudgePart(event){
    const item = selected(), layer = root.querySelector(".pa-layer"), parts = pickedParts(item);
    if (!parts.length || !layer || !layer.clientWidth || !layer.clientHeight) return;
    event.preventDefault();
    const px = event.shiftKey ? 10 : 1, dx = event.key === "ArrowLeft" ? -px : event.key === "ArrowRight" ? px : 0, dy = event.key === "ArrowUp" ? -px : event.key === "ArrowDown" ? px : 0;
    parts.forEach(part => {
      part.x = Math.max(0, Math.min(100, part.x + dx/layer.clientWidth*100));
      part.y = Math.max(0, Math.min(100, part.y + dy/layer.clientHeight*100));
    });
    updateStickerElements(); saveSoon(item);
  }
  function refreshPicked(){ if (picked.size) showToolTab("deco"); updateStickerElements(); paintAdjust(); }
  // 감상 모드: ←/→ 로 지금 목록(필터) 차례대로 넘기고 끝에서는 반대쪽 끝으로 되돌아간다. Esc 는 꾸미기 모드로.
  // 영상 컨트롤에 포커스가 있어도 되감기·빨리감기 대신 사진 넘기기로 쓴다.
  function onViewingKey(event){
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target, inside = selector => !!(target && target.closest && target.closest(selector));
    // 전체화면이면 Esc 는 앱(app.js)에 맡겨 전체화면만 풀고, 한 번 더 누르면 꾸미기 모드로.
    if (event.key === "Escape"){ if (viewerFullscreenOn()){ viewFullscreen = false; return; } event.preventDefault(); setViewing(false); return; }
    // Space = 슬라이드쇼 켜고 끄기. 단추·고르개·영상에 포커스가 있으면 그쪽 기본 동작(누르기·재생)에 맡긴다.
    if (event.key === " "){ if (inside("button,select,video")) return; event.preventDefault(); setSlideshow(!slideshow); return; }
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || inside("select")) return;
    event.preventDefault(); stepViewing(event.key === "ArrowLeft" ? -1 : 1);
  }
  function stepViewing(step){
    const shown = shownRecords(); if (shown.length < 2) return;
    const index = shown.findIndex(item => item.id === selectedId);
    const next = index < 0 ? shown[step > 0 ? 0 : shown.length - 1] : shown[(index + step + shown.length) % shown.length];
    const ghost = viewGhost(); selectItem(next.id); viewSwitchIn(ghost, step); scheduleSlide();
  }
  // 슬라이드쇼: 사진은 정한 간격마다, 영상은 끝까지 튼 뒤 다음 장으로(재생이 막히면 사진처럼 간격만큼). 끝에서는 처음으로 되돌아간다.
  // 손으로 넘기면 그 장부터 다시 잰다. 탭이 가려져 있으면 넘기지 않고 기다린다. 간격만 브라우저에 기억하고 켜짐은 기억하지 않는다.
  const SLIDE_KEY = "classdock.photoAlbum.slideSeconds", SLIDE_SECONDS = [3,5,8,10,15,30];
  let slideshow = false, slideTimer = null;
  function slideSeconds(){ try { const value = Number(localStorage.getItem(SLIDE_KEY)); if (SLIDE_SECONDS.includes(value)) return value; } catch { /* 기본값 */ } return 5; }
  function setSlideshow(on){
    slideshow = !!on && viewing;
    const toggle = root && root.querySelector(".pa-slide-toggle");
    if (toggle){ toggle.textContent = slideshow ? "❚❚ 멈춤" : "▶ 슬라이드쇼"; toggle.setAttribute("aria-pressed", String(slideshow)); }
    scheduleSlide();
  }
  function scheduleSlide(){
    clearTimeout(slideTimer); slideTimer = null;
    if (!slideshow || !viewing || !root) return;
    const item = selected(), ms = slideSeconds()*1000;
    const video = item && item.type === "video" ? root.querySelector(".pa-stage video") : null;
    if (video){
      video.onended = () => { if (slideshow && video.isConnected) advanceSlide(); };
      video.play().catch(() => { if (slideshow && video.isConnected) slideTimer = setTimeout(advanceSlide, ms); });
      return;
    }
    slideTimer = setTimeout(advanceSlide, ms);
  }
  function advanceSlide(){
    slideTimer = null;
    if (!slideshow || !viewing || !root) return;
    if (document.hidden || root.closest("[hidden]")){ slideTimer = setTimeout(advanceSlide, 1000); return; }
    stepViewing(1);
  }
  // 넘기기 효과(감상 모드). 앞 사진(ghost)과 새 사진(stage)에 줄 움직임을 d(다음=1·이전=-1)·w·h(무대 크기)로 만든다.
  // box 가 없는 효과는 두 사진의 알맹이(액자)를 움직이고 앞 사진 층이 위에 온다. box 효과는 층 전체를 움직이며
  // 새 사진 층이 앞 사진 층을 덮는다(앞 층은 무대 바탕을 칠해 뒤가 비치지 않게). 목록 칸의 미리 보기도 같은 정의를 쓴다.
  const VIEW_EFFECT_KEY = "classdock.photoAlbum.viewEffect", VIEW_SPEED_KEY = "classdock.photoAlbum.viewEffectSpeed";
  const VIEW_SPEEDS = [["fast","빠르게",.6],["normal","보통",1],["slow","느리게",1.8]];
  const EASE_OUT = "cubic-bezier(.22,.7,.3,1)", EASE_BOTH = "cubic-bezier(.65,0,.35,1)";
  const tx = px => `translateX(${px}px)`, flip = deg => `perspective(1200px) rotateY(${deg}deg)`;
  const VIEW_EFFECTS = [
    { id:"slide", label:"밀기", ms:380, old:d => [{ opacity:1, transform:"none" }, { opacity:0, transform:tx(-48*d) }], in:d => [{ opacity:0, transform:tx(48*d) }, { opacity:1, transform:"none" }] },
    { id:"fade", label:"흐려지기", ms:420, old:() => [{ opacity:1 }, { opacity:0 }], in:() => [{ opacity:0 }, { opacity:1 }] },
    { id:"push", label:"밀어내기", ms:460, easing:EASE_BOTH, old:(d,w) => [{ transform:"none" }, { transform:tx(-w*d) }], in:(d,w) => [{ transform:tx(w*d) }, { transform:"none" }] },
    { id:"cover", label:"덮기", ms:480, easing:EASE_BOTH, box:true, in:(d,w) => [{ transform:tx(w*d), clipPath:d > 0 ? `inset(0 ${w}px 0 0)` : `inset(0 0 0 ${w}px)` }, { transform:"none", clipPath:"inset(0 0 0 0)" }] },
    { id:"zoom", label:"확대", ms:420, old:() => [{ opacity:1, transform:"none" }, { opacity:0, transform:"scale(1.12)" }], in:() => [{ opacity:0, transform:"scale(.88)" }, { opacity:1, transform:"none" }] },
    { id:"rise", label:"떠오르기", ms:420, old:(d,w,h) => [{ opacity:1, transform:"none" }, { opacity:0, transform:`translateY(${-.12*h*d}px)` }], in:(d,w,h) => [{ opacity:0, transform:`translateY(${.12*h*d}px)` }, { opacity:1, transform:"none" }] },
    { id:"flip", label:"뒤집기", ms:560, easing:"ease-in-out", old:d => [{ opacity:1, transform:flip(0) }, { offset:.5, opacity:1, transform:flip(-90*d) }, { opacity:0, transform:flip(-90*d) }], in:d => [{ opacity:0, transform:flip(90*d) }, { offset:.5, opacity:1, transform:flip(90*d) }, { opacity:1, transform:flip(0) }] },
    { id:"blur", label:"번지기", ms:480, old:() => [{ opacity:1, filter:"blur(0)" }, { opacity:0, filter:"blur(14px)" }], in:() => [{ opacity:0, filter:"blur(14px)" }, { opacity:1, filter:"blur(0)" }] },
    { id:"wipe", label:"닦아내기", ms:520, easing:EASE_BOTH, box:true, in:d => [{ clipPath:d > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)" }, { clipPath:"inset(0 0 0 0)" }] },
    { id:"circle", label:"동그라미", ms:560, easing:EASE_BOTH, box:true, in:() => [{ clipPath:"circle(0% at 50% 50%)" }, { clipPath:"circle(75% at 50% 50%)" }] },
    { id:"none", label:"바로 넘기기", ms:0 },
    { id:"random", label:"무작위", ms:0 }
  ];
  const viewEffectById = id => VIEW_EFFECTS.find(effect => effect.id === id);
  function viewEffectId(){ try { const id = localStorage.getItem(VIEW_EFFECT_KEY); if (viewEffectById(id)) return id; } catch { /* 기본값 */ } return "slide"; }
  function viewSpeed(){ try { const id = localStorage.getItem(VIEW_SPEED_KEY); const speed = VIEW_SPEEDS.find(row => row[0] === id); if (speed) return speed; } catch { /* 기본값 */ } return VIEW_SPEEDS[1]; }
  const movingEffects = () => VIEW_EFFECTS.filter(effect => effect.ms > 0);
  // 실제로 쓸 효과: 무작위면 움직이는 효과 중 하나를 앞과 다르게, 움직임 줄이기 설정이면 흐려지기만(바로 넘기기는 그대로).
  let lastRandomEffect = "";
  function resolveViewEffect(id, reduced){
    let effect = viewEffectById(id) || viewEffectById("slide");
    if (effect.id === "random"){
      const pool = movingEffects().filter(other => other.id !== lastRandomEffect);
      effect = pool[Math.floor(Math.random()*pool.length)]; lastRandomEffect = effect.id;
    }
    if (reduced && effect.ms > 0 && effect.id !== "fade") return viewEffectById("fade");
    return effect;
  }
  // ghost 는 앞 사진 층, stage 는 새 사진 층. 끝나면(도중에 끊겨도) 움직임 목록을 돌려준다. 겹침 순서는 부른 쪽이 되돌린다.
  function playViewEffect(effect, parts){
    const { ghost, stage, d, w, h } = parts, anims = [];
    if (!effect || !(effect.ms > 0)) return Promise.resolve(anims);
    const timing = { duration:Math.round(effect.ms*(parts.speed || 1)), easing:effect.easing || EASE_OUT, fill:"both", id:"pa-view-switch" };
    if (effect.box){ ghost.style.zIndex = "0"; stage.style.zIndex = "1"; }
    const run = (targets, frames) => { if (frames) targets.forEach(el => anims.push(el.animate(frames, timing))); };
    run(effect.box ? [ghost] : Array.from(ghost.children), effect.old && effect.old(d, w, h));
    run(effect.box ? [stage] : Array.from(stage.children), effect.in && effect.in(d, w, h));
    return Promise.allSettled(anims.map(animation => animation.finished)).then(() => anims);
  }
  // 넘기기 전환: 앞 사진의 요소를 그대로 떼어 무대 위 겹침 층(.pa-view-ghost)으로 옮겨 두고(복제하면 이미 풀어 버린
  // blob 주소를 다시 읽어 깨진다), 새 사진이 준비되면 고른 넘기기 효과로 바꾼다.
  // 겹침 층은 무대 뒤에 둬서 root.querySelector 가 새 무대를 먼저 찾는다.
  let viewSwitchToken = 0;
  function dropViewGhosts(){ if (root) root.querySelectorAll(".pa-view-ghost").forEach(el => el.remove()); }
  function viewGhost(){
    const stage = root && root.querySelector(".pa-stage"); dropViewGhosts();
    if (!stage || !stage.children.length || typeof stage.animate !== "function") return null;
    stage.getAnimations({ subtree:true }).forEach(animation => { if (animation.id === "pa-view-switch") animation.finish(); });
    const ghost = document.createElement("div"); ghost.className = "pa-view-ghost"; ghost.setAttribute("aria-hidden","true"); ghost.inert = true;
    Object.assign(ghost.style, { left:stage.offsetLeft + "px", top:stage.offsetTop + "px", width:stage.offsetWidth + "px", height:stage.offsetHeight + "px" });
    ghost.append(...stage.children); ghost.querySelectorAll("video").forEach(video => video.pause());
    stage.after(ghost); return ghost;
  }
  async function viewSwitchIn(ghost, step){
    const stage = root && root.querySelector(".pa-stage"); if (!ghost || !stage) return;
    const token = ++viewSwitchToken, reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const effect = resolveViewEffect(viewEffectId(), reduced);
    stage.style.zIndex = "";
    // 새 사진을 다 풀기 전에 흐려지기 시작하면 중간에 툭 나타나므로 잠깐(최대 0.4초) 기다린다. 그동안은 앞 사진이 그대로 보인다.
    const img = stage.querySelector(".pa-photo-surface > img");
    if (img && !img.complete){
      stage.classList.add("pa-view-wait");
      await Promise.race([img.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 400))]);
      if (stage.isConnected) stage.classList.remove("pa-view-wait");
      if (token !== viewSwitchToken || !ghost.isConnected) return;
    }
    if (!(effect.ms > 0)){ ghost.remove(); return; }
    if (effect.box){ const paint = getComputedStyle(stage); ghost.style.backgroundColor = paint.backgroundColor; ghost.style.backgroundImage = paint.backgroundImage; }
    const anims = await playViewEffect(effect, { ghost, stage, d:step < 0 ? -1 : 1, w:stage.offsetWidth, h:stage.offsetHeight, speed:viewSpeed()[2] });
    ghost.remove(); anims.forEach(animation => animation.cancel());
    if (token === viewSwitchToken) stage.style.zIndex = "";
  }
  // 목록 칸 위 '넘기기 효과' 단추와 고르는 창. 칸마다 작은 두 장짜리 미리 보기가 있고, 올려 두면 되풀이해 넘긴다.
  // 고른 효과·빠르기는 간격처럼 브라우저에만 기억한다(사진첩 파일과 무관).
  function paintEffectButton(){
    const picker = root && root.querySelector(".pa-view-effect"); if (picker) picker.value = viewEffectId();
    const name = root && root.querySelector(".pa-fx-name"); if (!name) return;
    const effect = viewEffectById(viewEffectId()), speed = viewSpeed();
    name.textContent = effect.label + (effect.ms > 0 || effect.id === "random" ? speed[0] === "normal" ? "" : " · " + speed[1] : "");
  }
  function fxDemo(){
    const demo = document.createElement("span"); demo.className = "pa-fx-demo"; demo.setAttribute("aria-hidden","true");
    ["a","b"].forEach((kind, index) => { const layer = document.createElement("span"); layer.className = "pa-fx-layer" + (index ? " is-off" : ""); const card = document.createElement("i"); card.className = "pa-fx-card is-" + kind; layer.appendChild(card); demo.appendChild(layer); });
    return demo;
  }
  // 미리 보기는 늘 첫 그림(A)에서 쉰다. 한 번 틀면 A→B 로 넘기고 B 에서 멈추며, 멈추거나 새로 틀면 A 로 되돌린다.
  // 되돌릴 때 움직임을 모두 취소하므로, 끊긴 앞 차례는 fxToken 이 달라 아무것도 건드리지 않고 끝난다.
  function resetFxDemo(demo){
    if (!demo) return;
    demo.fxToken = (demo.fxToken || 0) + 1;
    if (demo.getAnimations) demo.getAnimations({ subtree:true }).forEach(animation => animation.cancel());
    Array.from(demo.children).forEach((layer, index) => { layer.style.zIndex = ""; layer.className = "pa-fx-layer" + (index ? " is-off" : ""); });
    demo.classList.remove("is-box");
  }
  async function playFxDemo(demo, id){
    if (!demo || typeof demo.animate !== "function") return false;
    resetFxDemo(demo);
    const token = demo.fxToken, [ghost, stage] = demo.children, effect = resolveViewEffect(id, false);
    stage.classList.remove("is-off"); ghost.classList.add("is-top"); demo.classList.toggle("is-box", !!effect.box);
    await playViewEffect(effect, { ghost, stage, d:1, w:demo.offsetWidth, h:demo.offsetHeight, speed:viewSpeed()[2] });
    if (token !== demo.fxToken) return false;
    demo.getAnimations({ subtree:true }).forEach(animation => animation.cancel());
    ghost.style.zIndex = stage.style.zIndex = ""; ghost.className = "pa-fx-layer is-off"; stage.className = "pa-fx-layer"; demo.classList.remove("is-box");
    return true;
  }
  let fxPanel = null;
  function closeEffectPanel(){
    if (!fxPanel) return;
    fxPanel.stopDemo(); fxPanel.remove(); fxPanel = null;
    document.removeEventListener("pointerdown", onFxOutside, true);
    const open = root && root.querySelector(".pa-fx-open"); if (open) open.setAttribute("aria-expanded","false");
  }
  function onFxOutside(event){ if (fxPanel && !fxPanel.contains(event.target) && !(event.target.closest && event.target.closest(".pa-fx-open"))) closeEffectPanel(); }
  function openEffectPanel(){
    const open = root && root.querySelector(".pa-fx-open"); if (!open) return;
    if (fxPanel){ closeEffectPanel(); return; }
    const panel = fxPanel = document.createElement("div"); panel.className = "pa-fx-panel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","넘기기 효과");
    const head = document.createElement("div"); head.className = "pa-fx-head"; head.innerHTML = "<strong>넘기기 효과</strong><small>감상 모드에서 사진을 넘길 때 (←/→·휠·슬라이드쇼)</small>";
    const grid = document.createElement("div"); grid.className = "pa-fx-grid";
    // 올려 둔(키보드로 옮겨 간) 칸만 A→B 를 되풀이하고, 떠나면 곧바로 A 로 돌아간다. once 는 한 번만 보여 주고 A 로.
    let demoTile = null, demoTimer = null;
    const stopDemo = () => { clearTimeout(demoTimer); demoTimer = null; if (demoTile) resetFxDemo(demoTile.querySelector(".pa-fx-demo")); demoTile = null; };
    const loopDemo = (tile, once) => {
      stopDemo(); demoTile = tile;
      const demo = tile.querySelector(".pa-fx-demo"), id = tile.dataset.effect;
      const round = async () => {
        if (demoTile !== tile || !(await playFxDemo(demo, id)) || demoTile !== tile) return;
        demoTimer = setTimeout(() => {
          if (demoTile !== tile) return;
          if (once){ stopDemo(); return; }
          resetFxDemo(demo); demoTimer = setTimeout(round, 350);
        }, 800);
      };
      round();
    };
    const leaveDemo = tile => { if (demoTile === tile) stopDemo(); };
    panel.stopDemo = stopDemo;
    VIEW_EFFECTS.forEach(effect => {
      const tile = button("", () => {
        try { localStorage.setItem(VIEW_EFFECT_KEY, effect.id); } catch { /* 이번 화면에만 적용 */ }
        grid.querySelectorAll(".pa-fx-tile").forEach(other => other.setAttribute("aria-pressed", String(other === tile)));
        paintEffectButton(); loopDemo(tile, !tile.matches(":hover,:focus-visible"));
      }, "pa-fx-tile");
      tile.dataset.effect = effect.id; tile.setAttribute("aria-pressed", String(effect.id === viewEffectId()));
      const label = document.createElement("span"); label.textContent = effect.label;
      tile.append(fxDemo(), label);
      tile.onpointerenter = () => loopDemo(tile); tile.onpointerleave = () => leaveDemo(tile);
      tile.onfocus = () => { if (tile.matches(":focus-visible")) loopDemo(tile); }; tile.onblur = () => leaveDemo(tile);
      grid.appendChild(tile);
    });
    const speedRow = document.createElement("div"); speedRow.className = "pa-fx-speed"; speedRow.setAttribute("role","group"); speedRow.setAttribute("aria-label","빠르기");
    const speedLabel = document.createElement("span"); speedLabel.textContent = "빠르기"; speedRow.appendChild(speedLabel);
    VIEW_SPEEDS.forEach(([id,label]) => {
      const choice = button(label, () => {
        try { localStorage.setItem(VIEW_SPEED_KEY, id); } catch { /* 이번 화면에만 적용 */ }
        speedRow.querySelectorAll("button").forEach(other => other.setAttribute("aria-pressed", String(other === choice)));
        paintEffectButton();
        const tile = grid.querySelector('.pa-fx-tile[aria-pressed="true"]'); if (tile) loopDemo(tile, true);
      });
      choice.setAttribute("aria-pressed", String(id === viewSpeed()[0])); speedRow.appendChild(choice);
    });
    const foot = document.createElement("div"); foot.className = "pa-fx-foot";
    const note = document.createElement("small"); note.textContent = "컴퓨터의 '애니메이션 줄이기'가 켜져 있으면 흐려지기로 넘어갑니다.";
    const tryIt = button("감상 모드에서 보기", () => { closeEffectPanel(); setViewing(true); }, "primary");
    tryIt.disabled = shownRecords().length < 1;
    foot.append(note, tryIt);
    panel.append(head, grid, speedRow, foot);
    // 창 안의 키는 사진첩 단축키(되돌리기·장식 옮기기)로 새지 않게 막는다. 방향키로 칸을 옮겨 다닌다(한 줄 3칸).
    panel.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape"){ event.preventDefault(); closeEffectPanel(); open.focus(); return; }
      const move = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-3, ArrowDown:3 }[event.key], tiles = Array.from(grid.children), at = tiles.indexOf(document.activeElement);
      if (!move || at < 0) return;
      event.preventDefault(); const next = tiles[at + move]; if (next) next.focus();
    });
    root.appendChild(panel);
    // 단추 오른쪽(좁으면 아래)에 띄우고 사진첩 밖으로 넘치지 않게 당긴다. 두 사각형이 같은 좌표계라 확대 배율과 무관.
    const box = root.getBoundingClientRect(), at = open.getBoundingClientRect(), pw = panel.offsetWidth, ph = panel.offsetHeight;
    const side = at.right - box.left + 8 + pw <= box.width;
    let left = side ? at.right - box.left + 8 : at.left - box.left, top = side ? at.top - box.top : at.bottom - box.top + 6;
    left = Math.max(6, Math.min(left, box.width - pw - 6)); top = Math.max(6, Math.min(top, box.height - ph - 6));
    panel.style.left = left + "px"; panel.style.top = top + "px";
    open.setAttribute("aria-expanded","true");
    document.addEventListener("pointerdown", onFxOutside, true);
    (grid.querySelector('.pa-fx-tile[aria-pressed="true"]') || grid.firstChild).focus();
  }
  // 감상 모드 휠: 아래(오른쪽)=다음, 위(왼쪽)=이전. 터치패드는 작은 값이 잇달아 오므로 모아서 한 칸을 넘기고,
  // 넘긴 뒤 잠깐은 남은 관성 스크롤(작은 값)을 버린다. 마우스 휠 한 칸(큰 값)은 0.2초만 지나면 곧바로 다음 장으로.
  // Ctrl+휠(확대)은 건드리지 않는다.
  let wheelSum = 0, wheelQuietUntil = 0, wheelSteppedAt = 0;
  function onViewingWheel(event){
    if (!viewing || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const now = performance.now(), delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const px = event.deltaMode === 1 ? delta*40 : event.deltaMode === 2 ? delta*800 : delta;
    if (now < wheelQuietUntil){
      if (Math.abs(px) < 50){ wheelQuietUntil = now + 250; wheelSum = 0; return; }
      if (now - wheelSteppedAt < 200) return;
      wheelSum = 0;
    }
    wheelSum += px;
    if (Math.abs(wheelSum) < 60) return;
    stepViewing(wheelSum > 0 ? 1 : -1); wheelSum = 0; wheelSteppedAt = now; wheelQuietUntil = now + 250;
  }
  function onHistoryKey(event){
    if (!root || !root.isConnected || root.closest("[hidden]") || drawing || event.altKey) return;
    if (viewing){ onViewingKey(event); return; }
    const target = event.target;
    if (target && target.closest && target.closest("textarea,select,[contenteditable=true],input:not([type=range])")) return;
    const key = String(event.key || "").toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (mod && key === "z"){ event.preventDefault(); stepHistory(event.shiftKey ? 1 : -1); }
    else if (mod && key === "y"){ event.preventDefault(); stepHistory(1); }
    else if (mod && (key === "c" || key === "x") && !event.shiftKey){
      // 글자를 드래그해 골라 둔 상태면 브라우저 기본 복사에 맡긴다.
      if (String(window.getSelection ? window.getSelection() : "").trim()) return;
      const item = selected(); if (!pickedParts(item).length) return;
      event.preventDefault(); copyParts(item, key === "x");
    }
    else if (mod && key === "v" && !event.shiftKey){
      if (!partClipboard) return;
      if (pasteParts(selected())) event.preventDefault();
    }
    else if (mod && key === "g"){
      const item = selected(); if (!item || !picked.size) return;
      event.preventDefault(); event.shiftKey ? ungroupParts(item) : groupParts(item);
    }
    else if (mod && key === "a"){
      const item = selected(); if (!item || item.type !== "image" || !(item.stickers || []).length || (target && target.closest && target.closest("input"))) return;
      event.preventDefault(); picked = new Set(item.stickers.filter(pickable).map(part => part.id)); refreshPicked();
    }
    else if (!mod && event.key === "Escape" && picked.size){ event.preventDefault(); picked = new Set(); refreshPicked(); }
    else if (!mod && /^Arrow(Left|Right|Up|Down)$/.test(event.key) && picked.size && !(target && target.closest && target.closest("input,select,textarea"))) nudgePart(event);
    else if (!mod && (event.key === "Delete" || event.key === "Backspace") && picked.size){
      const item = selected(); if (!pickedParts(item).length) return;
      event.preventDefault(); removeParts(item);
    }
  }
  async function save(item){
    recordHistory(item);
    try { await persistMetadata(item); status("변경 내용이 자동 저장되었습니다."); }
    catch(error){ console.error(error); notice("사진첩 변경 내용을 저장하지 못했습니다."); }
  }
  function releaseUrls(){ if (stageUrl) URL.revokeObjectURL(stageUrl); stageUrl = null; listUrls.forEach(url => URL.revokeObjectURL(url)); listUrls = []; }
  function paintFilters(){
    const host = root.querySelector(".pa-filters"); if (!host) return; host.replaceChildren();
    [["all","▦ 전체"],["image","▧ 사진"],["video","▷ 동영상"],["favorite","♡ 즐겨찾기"]].forEach(([id,label]) => host.appendChild(button(label, () => { filter = id; paintFilters(); paintList(); }, filter === id ? "active" : "")));
  }
  const shownRecords = () => records.filter(item => filter === "all" || (filter === "favorite" ? item.favorite : item.type === filter));
  function selectItem(id){ selectedId = id; picked = new Set(); syncMusic({ switching:true }); paintList(); paintStage(); paintBackgrounds(); paintStickers(); }
  // 감상 모드는 사진만 남긴다(머리 줄·목록·아래 줄은 CSS 가 감춤). 끌 때는 목록에서 보던 사진이 보이게 굴린다.
  // 감상 모드에서 마우스가 2.5초 가만히 있으면 커서와 위쪽 조작 줄을 감춘다. 움직이거나 누르면 다시 보인다.
  // 조작 줄 위에 올려 둔 동안은 감추지 않는다. 화면이 바뀌며 생기는 제자리 이동(좌표가 그대로)은 움직임으로 치지 않는다.
  const CURSOR_IDLE_MS = 2500;
  let cursorTimer = null, cursorAt = "";
  function wakeCursor(event){
    if (!root) return;
    if (event && event.type === "pointermove"){ const at = event.screenX + "," + event.screenY; if (at === cursorAt) return; cursorAt = at; }
    root.classList.remove("pa-cursor-idle"); clearTimeout(cursorTimer); cursorTimer = null;
    if (!viewing || (event && event.target && event.target.closest && event.target.closest(".pa-view-bar"))) return;
    cursorTimer = setTimeout(() => { if (root && viewing) root.classList.add("pa-cursor-idle"); }, CURSOR_IDLE_MS);
  }
  // 감상 모드 더블클릭 = 전체화면 켜고 끄기. 앱 공용 문서 영역 전체화면(documents.js)을 써서 Esc·확인창·종료 단추를
  // 다른 문서와 똑같이 다룬다. 더블클릭으로 들어간 전체화면은 꾸미기 모드로 돌아갈 때 함께 푼다.
  let viewFullscreen = false;
  const viewerFullscreenOn = () => typeof isViewerFullscreen === "function" ? isViewerFullscreen() : !!document.fullscreenElement;
  function toggleViewFullscreen(){
    if (viewerFullscreenOn()){
      viewFullscreen = false;
      if (typeof exitViewerFullscreen === "function") exitViewerFullscreen(); else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } else {
      viewFullscreen = true;
      if (typeof enterViewerFullscreen === "function") enterViewerFullscreen(); else if (root && root.requestFullscreen) root.requestFullscreen().catch(() => { viewFullscreen = false; });
    }
  }
  function onViewingDblClick(event){
    if (!viewing || event.button !== 0 || (event.target && event.target.closest && event.target.closest(".pa-view-bar"))) return;
    event.preventDefault();   // 영상 기본 동작(영상만 전체화면)을 막고 사진첩 전체화면으로
    toggleViewFullscreen();
  }
  function setViewing(on){
    if (!root || viewing === on) return;
    dropViewGhosts(); closeEffectPanel(); if (!on) setSlideshow(false);
    if (!on && viewFullscreen){ viewFullscreen = false; if (viewerFullscreenOn()) toggleViewFullscreen(); } viewing = on; root.classList.toggle("pa-viewing",viewing); wakeCursor(); root.querySelector(".pa-view").textContent = viewing ? "✎ 꾸미기 모드" : "▣ 감상 모드";
    requestAnimationFrame(fitArtboard); syncMusic(); syncSfx();
    if (!viewing){ const card = root.querySelector(".pa-media-card.active"); if (card) card.scrollIntoView({ block:"nearest" }); }
  }
  function paintList(){
    const host = root.querySelector(".pa-list"); if (!host) return; host.replaceChildren(); listUrls.forEach(url => URL.revokeObjectURL(url)); listUrls = [];
    const shown = shownRecords();
    root.querySelector(".pa-count").textContent = shown.length + "개";
    if (!shown.length){ const p = document.createElement("p"); p.className = "pa-list-empty"; p.textContent = records.length ? "이 항목에 미디어가 없습니다." : "사진·영상을 가져와 시작하세요."; host.appendChild(p); }
    shown.forEach(item => {
      const card = button("", () => selectItem(item.id), "pa-media-card" + (selectedId === item.id ? " active" : ""));
      const thumb = document.createElement("span"); thumb.className = "pa-thumb";
      if (item.thumbnail || (item.type === "image" && item.blob)){
        const img = document.createElement("img"); img.alt = ""; img.loading = "lazy";
        if (item.thumbnail) img.src = item.thumbnail;
        else { const url = URL.createObjectURL(item.blob); listUrls.push(url); img.src = url; }
        thumb.appendChild(img);
      } else thumb.textContent = item.type === "video" ? "▶" : "▧";
      if (item.type === "video"){ const badge = document.createElement("b"); badge.textContent = "▶ 영상"; thumb.appendChild(badge); }
      const name = document.createElement("span"); name.className = "pa-media-name"; name.textContent = item.name;
      card.append(thumb,name); host.appendChild(card);
    });
  }
  function paintBackgrounds(){
    paintMusic();
    const host = root.querySelector(".pa-backgrounds"); if (!host) return; host.replaceChildren(); const item = selected();
    backgrounds.forEach(bg => {
      const card = button("", () => { if (!item || item.type !== "image") return; item.background = bg[0]; save(item); paintBackgrounds(); paintStage(); }, "pa-bg-choice" + (item && item.background === bg[0] ? " active" : ""));
      card.disabled = !item || item.type !== "image";
      const swatch = document.createElement("span"); swatch.style.background = background(bg);
      const label = document.createElement("small"); label.textContent = bg[1]; card.append(swatch,label); host.appendChild(card);
    });
  }
  function paintStickers(){
    const tabs = root.querySelector(".pa-categories"); if (!tabs) return; tabs.replaceChildren();
    ["안경","모자","옷","신발",TEXT_GROUP,EMOJI_GROUP,CUSTOM_GROUP].forEach(group => tabs.appendChild(button(group, () => { category = group; paintStickers(); }, category === group ? "active" : "")));
    const host = root.querySelector(".pa-sticker-grid"); if (!host) return; host.replaceChildren();
    if (category === CUSTOM_GROUP){
      const create = button("", () => openDrawPad(null), "pa-sticker-choice pa-draw-new"); create.title = "새 장식을 직접 그립니다";
      const plus = document.createElement("span"); plus.className = "pa-draw-plus"; plus.textContent = "+";
      const label = document.createElement("small"); label.textContent = "새로 그리기"; create.append(plus, label); host.appendChild(create);
      if (!customArts.length){ const hint = document.createElement("p"); hint.className = "pa-custom-hint"; hint.textContent = "직접 그린 장식이 여기에 모입니다. 모든 사진에서 다시 쓸 수 있어요."; host.appendChild(hint); }
    }
    if (category === EMOJI_GROUP){
      const recent = recentEmojis();
      if (emojiSet === "recent" && !recent.length) emojiSet = "face";
      const box = document.createElement("div"); box.className = "pa-emoji-box ui-keep-symbols";   // 전역 이모지 지우개(icons.js)가 칸을 비우지 않게
      const paste = document.createElement("div"); paste.className = "pa-emoji-paste";
      const input = document.createElement("input"); input.type = "text"; input.placeholder = "이모지 붙여넣기"; input.setAttribute("aria-label","붙일 이모지");
      const add = button("붙이기", () => { if (addEmoji(input.value)) input.value = ""; }, "pa-text-add");
      input.onkeydown = event => { if (event.key === "Enter"){ event.preventDefault(); add.click(); } };
      paste.append(input, add);
      const chips = document.createElement("div"); chips.className = "pa-emoji-sets";
      (recent.length ? [["recent","최근",recent], ...EMOJI_SETS] : EMOJI_SETS).forEach(([id, label]) => chips.appendChild(button(label, () => { emojiSet = id; paintStickers(); }, "pa-emoji-set" + (emojiSet === id ? " active" : ""))));
      const grid = document.createElement("div"); grid.className = "pa-emoji-grid";
      const list = emojiSet === "recent" ? recent : (EMOJI_SETS.find(row => row[0] === emojiSet) || EMOJI_SETS[0])[2];
      list.forEach(em => {
        const choice = button(em, () => addEmoji(em), "pa-emoji-choice"); choice.title = em + " — 눌러서 붙이기, 사진 위로 끌어 놓기";
        choice.draggable = true;
        choice.ondragstart = event => { if (!event.dataTransfer) return; event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(INTERNAL_DRAG_MIME,"photo-album-art"); event.dataTransfer.setData(ART_DRAG_MIME,"emoji:" + em); };
        grid.appendChild(choice);
      });
      box.append(paste, chips, grid); host.appendChild(box);
      paintAdjust(); return;
    }
    if (category === TEXT_GROUP){
      const box = document.createElement("div"); box.className = "pa-text-new";
      const area = document.createElement("textarea"); area.rows = 2; area.maxLength = TEXT_MAX; area.placeholder = "넣을 글자 (Enter 로 줄 바꿈)"; area.setAttribute("aria-label","넣을 글자");
      const add = button("T 글자 붙이기", () => { if (!area.value.trim()){ area.focus(); return; } addText(area.value); area.value = ""; }, "pa-text-add");
      add.title = "사진에 붙이기 (Ctrl+Enter)";
      area.onkeydown = event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)){ event.preventDefault(); add.click(); } };
      box.append(area, add); host.appendChild(box);
      TEXT_PHRASES.forEach(([phrase, color]) => {
        const tx = cleanText({ t:phrase, c:color }), card = button("", () => addText(phrase, color), "pa-sticker-choice");
        card.title = phrase + " — 눌러서 붙이기";
        const img = document.createElement("img"); img.src = svg([0,0,0,0,0,0,textSvg(tx)]); img.alt = ""; img.draggable = false;
        const name = document.createElement("small"); name.textContent = phrase; card.append(img, name); host.appendChild(card);
      });
      paintAdjust(); return;
    }
    const rows = category === CUSTOM_GROUP ? customArts.map(customRow) : art.filter(row => row[1] === category);
    rows.forEach(row => {
      const card = button("", () => addSticker(row), "pa-sticker-choice");
      card.title = row[2] + " — 사진 위로 끌어 놓거나 클릭해 추가";
      card.draggable = true;
      card.ondragstart = event => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(INTERNAL_DRAG_MIME,"photo-album-art");
        event.dataTransfer.setData(ART_DRAG_MIME,row[0]);
      };
      const img = document.createElement("img"); img.src = svg(row); img.alt = ""; img.draggable = false;
      const name = document.createElement("small"); name.textContent = row[2]; card.append(img,name);
      if (category !== CUSTOM_GROUP){ host.appendChild(card); return; }
      // 내 그림 카드엔 고치기·지우기 버튼을 따로 단다(버튼 안에 버튼을 넣을 수 없어 겉 칸으로 감싼다).
      const record = customArts.find(other => other.id === row[0]), wrap = document.createElement("div"); wrap.className = "pa-custom-card";
      const edit = button("✎", () => openDrawPad(record), "pa-custom-action"); edit.title = "그림 고치기";
      const drop = button("✕", () => removeCustomArt(record), "pa-custom-action danger"); drop.title = "내 그림에서 지우기";
      const actions = document.createElement("div"); actions.className = "pa-custom-actions"; actions.append(edit, drop);
      wrap.append(card, actions); host.appendChild(wrap);
    });
    paintAdjust();
  }
  function snapToggle(){
    const row = document.createElement("label"); row.className = "pa-snap-toggle"; row.title = "끌 때 다른 장식·사진의 가장자리와 가운데에 붙습니다. Alt 를 누르고 끌면 잠시 꺼집니다.";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = snapEnabled();
    input.onchange = () => { setSnapEnabled(input.checked); status(input.checked ? "자석 붙기를 켰습니다." : "자석 붙기를 껐습니다."); };
    const text = document.createElement("span"); text.className = "ui-keep-symbols"; text.textContent = "🧲 자석처럼 붙기 (Alt: 잠시 끄기)";
    row.append(input, text); return row;
  }
  // 레이어 목록: 맨 위 줄이 맨 앞(stickers 배열의 끝)이다. 접힘 상태는 이 컴퓨터에만 기억한다.
  const LAYERS_KEY = "classdock.photoAlbum.layersOpen";
  function layersOpen(){ try { return localStorage.getItem(LAYERS_KEY) !== "closed"; } catch { return true; } }
  function setLayersOpen(open){ try { localStorage.setItem(LAYERS_KEY, open ? "open" : "closed"); } catch { /* 기억 못 해도 이번 화면엔 적용 */ } }
  // 같은 장식이 여럿이면 "별 안경 2"처럼 뒤에서부터 번호를 붙인다.
  function layerNames(item){
    const seen = new Map(), totals = new Map(), names = new Map();
    // 보이는 이름으로 센다(글자 장식은 모두 같은 art "text" 라 art 로 세면 번호가 엉뚱하게 붙는다).
    const label = part => { const row = rowOf(part); return row ? row[2] : "장식"; };
    item.stickers.forEach(part => totals.set(label(part), (totals.get(label(part)) || 0) + 1));
    item.stickers.forEach(part => {
      const name = label(part), n = (seen.get(name) || 0) + 1; seen.set(name, n);
      names.set(part.id, name + (totals.get(name) > 1 ? " " + n : ""));
    });
    return names;
  }
  // 숨기기·잠그기는 묶음 전체에 함께 적용한다.
  function toggleLayerFlag(item, part, key){
    const members = item.stickers.filter(other => part.g ? other.g === part.g : other === part), on = !part[key];
    picked = new Set(picked);
    members.forEach(member => { if (on){ member[key] = true; picked.delete(member.id); } else delete member[key]; });
    save(item); paintStage(); paintAdjust();
    status((key === "h" ? (on ? "장식을 숨겼습니다." : "장식을 다시 보이게 했습니다.") : (on ? "장식을 잠갔습니다. 사진 위에서 잡히지 않습니다." : "잠금을 풀었습니다.")));
  }
  // 손잡이를 끌어 줄 사이에 놓으면 그 자리로 겹침 순서를 옮긴다.
  function startLayerDrag(event, item, part, list){
    event.preventDefault(); event.stopPropagation();
    const grip = event.currentTarget; grip.setPointerCapture(event.pointerId);
    const rows = [...list.querySelectorAll(".pa-layer-row")], shown = [...item.stickers].reverse();
    let slot = shown.indexOf(part);
    const mark = () => rows.forEach((row, i) => { row.classList.toggle("drop-before", i === slot && slot < rows.length); row.classList.toggle("drop-after", slot === rows.length && i === rows.length - 1); });
    const move = next => {
      slot = rows.length;
      for (let i = 0; i < rows.length; i++){ const box = rows[i].getBoundingClientRect(); if (next.clientY < box.top + box.height/2){ slot = i; break; } }
      mark();
    };
    const end = () => {
      grip.removeEventListener("pointermove",move); grip.removeEventListener("pointerup",end); grip.removeEventListener("pointercancel",end);
      rows.forEach(row => row.classList.remove("drop-before","drop-after"));
      const from = shown.indexOf(part), to = slot > from ? slot - 1 : slot;
      if (to === from) return;
      shown.splice(from, 1); shown.splice(to, 0, part);
      item.stickers = shown.reverse(); save(item); paintStage(); paintAdjust();
    };
    grip.addEventListener("pointermove",move); grip.addEventListener("pointerup",end); grip.addEventListener("pointercancel",end);
  }
  function paintLayers(){
    const host = root && root.querySelector(".pa-layers"); if (!host) return;
    const item = selected(); host.replaceChildren();
    host.hidden = !item || item.type !== "image"; if (host.hidden) return;
    const details = document.createElement("details"); details.className = "pa-layers-box"; details.open = layersOpen();
    details.ontoggle = () => setLayersOpen(details.open);
    const summary = document.createElement("summary"); summary.textContent = `레이어 (${item.stickers.length})`; details.appendChild(summary);
    if (!item.stickers.length){ const empty = document.createElement("p"); empty.className = "pa-layers-empty"; empty.textContent = "사진 위에 올린 장식이 여기에 앞에서부터 차례로 나옵니다."; details.appendChild(empty); host.appendChild(details); return; }
    const list = document.createElement("ol"); list.className = "pa-layer-list"; const names = layerNames(item);
    [...item.stickers].reverse().forEach(part => {
      const art = rowOf(part);
      const row = document.createElement("li"); row.className = "pa-layer-row" + (picked.has(part.id) ? " active" : "") + (part.h ? " is-hidden" : "") + (part.l ? " is-locked" : "");
      row.dataset.id = part.id;
      const grip = document.createElement("span"); grip.className = "pa-layer-grip"; grip.textContent = "⠿"; grip.title = "끌어서 겹침 순서 바꾸기";
      grip.onpointerdown = event => startLayerDrag(event, item, part, list);
      const thumb = document.createElement("img"); thumb.className = "pa-layer-thumb"; thumb.alt = ""; thumb.draggable = false; if (art) thumb.src = partSvg(art, part);
      const name = document.createElement("span"); name.className = "pa-layer-name ui-keep-symbols"; name.textContent = names.get(part.id);
      if (part.g){ const chain = document.createElement("small"); chain.textContent = " ⛓"; chain.title = "묶음"; name.appendChild(chain); }
      const eye = button(part.h ? "◌" : "👁", event => { event.stopPropagation(); toggleLayerFlag(item, part, "h"); }, "pa-layer-toggle ui-keep-symbols" + (part.h ? " off" : ""));
      eye.title = part.h ? "다시 보이기" : "숨기기"; eye.setAttribute("aria-pressed", String(!!part.h));
      const lock = button(part.l ? "🔒" : "🔓", event => { event.stopPropagation(); toggleLayerFlag(item, part, "l"); }, "pa-layer-toggle ui-keep-symbols" + (part.l ? " on" : ""));
      lock.title = part.l ? "잠금 풀기" : "잠그기(사진 위에서 잡히지 않음)"; lock.setAttribute("aria-pressed", String(!!part.l));
      row.onclick = event => {
        if (!pickable(part)){ status(part.h ? "숨긴 장식입니다. 👁 를 눌러 다시 보이게 한 뒤 고르세요." : "잠긴 장식입니다. 🔒 를 눌러 푼 뒤 고르세요."); return; }
        if (event.shiftKey || event.ctrlKey || event.metaKey){
          const members = groupMembers(item, part), on = !picked.has(part.id);
          picked = new Set(picked); members.forEach(id => on ? picked.add(id) : picked.delete(id));
        } else picked = withGroups(item, [part.id]);
        refreshPicked();
      };
      row.append(grip, thumb, name, eye, lock); list.appendChild(row);
    });
    details.appendChild(list); host.appendChild(details);
  }
  // 오른쪽 패널의 접는 칸. 펼침 상태는 칸마다 이 컴퓨터에만 기억한다. 제목 옆 작은 글씨(data-badge)는 지금 값을 보여 준다.
  const SECTIONS_KEY = "classdock.photoAlbum.sections";
  function sectionOpen(id, fallback){ try { const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}"); return typeof saved[id] === "boolean" ? saved[id] : fallback; } catch { return fallback; } }
  function setSectionOpen(id, open){ try { const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}"); saved[id] = open; localStorage.setItem(SECTIONS_KEY, JSON.stringify(saved)); } catch { /* 기억 못 해도 이번 화면엔 적용 */ } }
  function section(host, id, title, fallbackOpen){
    const details = document.createElement("details"); details.className = "pa-section"; details.dataset.section = id; details.open = sectionOpen(id, fallbackOpen);
    details.ontoggle = () => setSectionOpen(id, details.open);
    const summary = document.createElement("summary"); const name = document.createElement("span"); name.textContent = title;
    const badge = document.createElement("small"); badge.className = "pa-badge"; badge.dataset.badge = id;
    summary.append(name, badge); details.appendChild(summary);
    const body = document.createElement("div"); body.className = "pa-section-body"; details.appendChild(body);
    host.appendChild(details); return body;
  }
  // 막대 한 줄. apply(value) 는 고른 장식들에 값을 넣고, 손을 떼면 저장한다.
  function rangeRow(host, item, label, attrs, apply){
    const row = document.createElement("label"); row.className = "pa-range"; const span = document.createElement("span"); span.textContent = label;
    const input = document.createElement("input"); input.type = "range"; Object.entries(attrs).forEach(([key, value]) => { if (key.startsWith("data-")) input.setAttribute(key, value); else input[key] = value; });
    input.oninput = () => { apply(Number(input.value)); updateStickerElements(); }; input.onchange = () => save(item);
    row.append(span, input); host.appendChild(row); return input;
  }
  function colorRow(host, item, dataKey, apply){
    const row = document.createElement("label"); row.className = "pa-range pa-shadow-color"; const text = document.createElement("span"); text.textContent = "색";
    const input = document.createElement("input"); input.type = "color"; input.setAttribute(dataKey, "c");
    input.oninput = () => { apply(input.value); updateStickerElements(); }; input.onchange = () => save(item);
    row.append(text, input); host.appendChild(row);
  }
  function paintAdjust(){
    paintLayers();
    const host = root.querySelector(".pa-adjust"); if (!host) return; host.replaceChildren();
    const item = selected(), parts = pickedParts(item), many = parts.length > 1;
    if (!parts.length){ const hint = document.createElement("p"); hint.textContent = item && item.type === "image" ? "장식을 사진 위로 끌어 놓거나, 클릭해 추가한 뒤 위치를 맞추세요. Shift·Ctrl+클릭이나 빈 곳을 끌어 여러 개를 고를 수 있습니다." : "사진을 선택하면 장식을 올릴 수 있습니다."; host.appendChild(hint); if (item && item.type === "image") host.appendChild(snapToggle()); return; }
    const title = document.createElement("strong"); title.textContent = many ? `장식 ${parts.length}개 선택` : "선택한 장식"; host.appendChild(title);

    // 기본: 늘 펼쳐 둔다. 여럿일 때 크기·회전은 사진 위 묶음 틀로만 바꾼다(막대 하나로는 서로 다른 크기를 함께 옮길 수 없다).
    const ranges = many ? [["투명도","o",10,100]] : [["크기","w",PART_MIN_W,PART_MAX_W],["회전","r",-180,180],["투명도","o",10,100]];
    ranges.forEach(([label,key,min,max]) => {
      const input = rangeRow(host, item, label, { min, max, "data-key":key }, value => pickedParts(item).forEach(part => setPartValue(part,key,value)));
      input.value = partValue(parts[0],key);
    });
    const flips = document.createElement("div"); flips.className = "pa-flip-row";
    FLIPS.forEach(([key,icon,label]) => { const flip = button(icon + " " + label, () => { flipParts(item,key); save(item); }, "pa-flip-part"); flip.dataset.flip = key; flips.appendChild(flip); });
    host.appendChild(flips);

    // 이모지: 하나만 골랐으면 다른 이모지로 바꿀 수 있다(크기·효과는 그대로).
    if (!many && typeof parts[0].em === "string"){
      const swap = section(host, "emoji", "이모지 바꾸기", true), row = document.createElement("div"); row.className = "pa-emoji-paste";
      const input = document.createElement("input"); input.type = "text"; input.placeholder = "새 이모지 붙여넣기"; input.setAttribute("aria-label","바꿀 이모지");
      const apply = button("바꾸기", () => { const em = cleanEmoji(input.value); if (!em){ notice("이모지를 찾지 못했습니다."); return; } rememberEmoji(em); parts[0].em = em; save(item); updateStickerElements(); paintAdjust(); }, "pa-text-add");
      input.onkeydown = event => { if (event.key === "Enter"){ event.preventDefault(); apply.click(); } };
      row.append(input, apply); swap.appendChild(row);
      const quick = document.createElement("div"); quick.className = "pa-emoji-grid ui-keep-symbols";
      (recentEmojis().length ? recentEmojis() : EMOJI_SETS[0][2]).slice(0, 12).forEach(em => quick.appendChild(button(em, () => { parts[0].em = em; rememberEmoji(em); save(item); updateStickerElements(); paintAdjust(); }, "pa-emoji-choice")));
      swap.appendChild(quick);
    }
    // 글자: 고른 것이 모두 글자 장식이면 글자 칸을 연다. 내용은 하나만 골랐을 때 고친다(타자는 잠깐 멈추면 한 단계로 저장).
    if (parts.every(part => part.tx)){
      const textBody = section(host, "text", "글자", true), tx = cleanText(parts[0].tx);
      if (!many){
        const area = document.createElement("textarea"); area.className = "pa-text-input"; area.rows = 2; area.maxLength = TEXT_MAX; area.value = tx.t; area.setAttribute("aria-label","글자 내용");
        area.oninput = () => { const part = pickedParts(item)[0]; if (!part || !part.tx) return; part.tx = cleanText({ ...cleanText(part.tx), t:area.value }); updateStickerElements(); paintLayers(); saveSoon(item); };
        textBody.appendChild(area);
      }
      const fonts = document.createElement("div"); fonts.className = "pa-text-fonts";
      TEXT_FONTS.forEach(([id,label,family]) => { const choice = button(label, () => { editText(item, "f", id); save(item); paintAdjust(); }, "pa-shadow-part" + (tx.f === id ? " active" : "")); choice.style.fontFamily = family; fonts.appendChild(choice); });
      textBody.appendChild(fonts);
      const styles = document.createElement("div"); styles.className = "pa-text-styles";
      const bold = button("B", () => { editText(item, "b", !tx.b); save(item); paintAdjust(); }, "pa-shadow-part" + (tx.b ? " active" : "")); bold.title = "굵게"; bold.style.fontWeight = "800";
      const italic = button("I", () => { editText(item, "i", !tx.i); save(item); paintAdjust(); }, "pa-shadow-part" + (tx.i ? " active" : "")); italic.title = "기울임"; italic.style.fontStyle = "italic";
      styles.append(bold, italic);
      [["left","왼쪽"],["center","가운데"],["right","오른쪽"]].forEach(([align,label]) => { const choice = button(label, () => { editText(item, "a", align); save(item); paintAdjust(); }, "pa-shadow-part" + (tx.a === align ? " active" : "")); choice.title = label + " 정렬"; styles.appendChild(choice); });
      textBody.appendChild(styles);
      const textColor = document.createElement("label"); textColor.className = "pa-range pa-shadow-color"; const textColorLabel = document.createElement("span"); textColorLabel.textContent = "글자색";
      const textColorInput = document.createElement("input"); textColorInput.type = "color"; textColorInput.value = tx.c;
      textColorInput.oninput = () => editText(item, "c", textColorInput.value); textColorInput.onchange = () => save(item);
      textColor.append(textColorLabel, textColorInput); textBody.appendChild(textColor);
    }
    // 배치: 순서·정렬·크기·각도·묶기
    const place = section(host, "place", "배치 (순서·정렬·크기·각도)", true);
    const order = document.createElement("div"); order.className = "pa-order-row";
    ORDERS.forEach(([where,icon,label]) => { const move = button(icon + " " + label, () => moveParts(item, where), "pa-order-part"); move.dataset.order = where; move.title = label; order.appendChild(move); });
    place.appendChild(order);
    const align = document.createElement("div"); align.className = "pa-align-row";
    const alignLabel = document.createElement("span"); alignLabel.className = "pa-align-label"; alignLabel.textContent = pickedUnits(item).length > 1 ? "정렬 (고른 것 기준)" : "정렬 (사진 기준)";
    align.appendChild(alignLabel);
    ALIGNS.forEach(([how,label,icon]) => {
      const alignButton = button("", () => alignParts(item, how), "pa-align-part"); alignButton.dataset.align = how; alignButton.title = label; alignButton.setAttribute("aria-label", label);
      alignButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + icon + "</svg>";
      align.appendChild(alignButton);
    });
    place.appendChild(align);
    const sizing = document.createElement("div"); sizing.className = "pa-size-row";
    const sizingLabel = document.createElement("span"); sizingLabel.className = "pa-align-label"; sizingLabel.textContent = "같은 크기로";
    const larger = button("⬆ 큰 것에 맞춤", () => matchSizes(item, "largest"), "pa-size-part"); larger.dataset.sizeMatch = "largest"; larger.title = "고른 것 중 가장 큰 장식 크기로 모두 맞춥니다";
    const smaller = button("⬇ 작은 것에 맞춤", () => matchSizes(item, "smallest"), "pa-size-part"); smaller.dataset.sizeMatch = "smallest"; smaller.title = "고른 것 중 가장 작은 장식 크기로 모두 맞춥니다";
    sizing.append(sizingLabel, larger, smaller); place.appendChild(sizing);
    const angles = document.createElement("div"); angles.className = "pa-angle-row";
    const anglesLabel = document.createElement("span"); anglesLabel.className = "pa-align-label"; anglesLabel.textContent = many ? "같은 각도로" : "각도 정하기";
    const angleInput = document.createElement("input"); angleInput.type = "number"; angleInput.min = -180; angleInput.max = 180; angleInput.step = 1; angleInput.value = Math.round(parts[0].r); angleInput.setAttribute("aria-label","각도(도)");
    const apply = () => rotateTo(item, Number(angleInput.value));
    angleInput.onkeydown = event => { if (event.key === "Enter"){ event.preventDefault(); apply(); } };
    const applyButton = button("적용", apply, "pa-angle-apply");
    const presets = document.createElement("div"); presets.className = "pa-angle-presets";
    [0,45,90,-45].forEach(value => { const preset = button(value + "°", () => { angleInput.value = value; rotateTo(item, value); }, "pa-angle-preset"); preset.title = value === 0 ? "똑바로 세우기" : value + "°로 맞추기"; presets.appendChild(preset); });
    angles.append(anglesLabel, angleInput, document.createTextNode("°"), applyButton, presets); place.appendChild(angles);
    if (many || pickedHasGroup(item)){
      const grouping = document.createElement("div"); grouping.className = "pa-group-row";
      const join = button("⛓ 묶기", () => groupParts(item), "pa-group-part"); join.dataset.groupAction = "join"; join.title = "고른 장식을 한 묶음으로 (Ctrl+G)";
      const split = button("묶음 풀기", () => ungroupParts(item), "pa-group-part"); split.dataset.groupAction = "split"; split.title = "묶음 풀기 (Ctrl+Shift+G)";
      grouping.append(join, split); place.appendChild(grouping);
    }

    // 효과: 하나씩 접는 칸. 처음엔 접어 둔다.
    const effectsLabel = document.createElement("span"); effectsLabel.className = "pa-effects-label"; effectsLabel.textContent = "효과"; host.appendChild(effectsLabel);

    const colorBody = section(host, "color", "색상", false);
    const swatches = document.createElement("div"); swatches.className = "pa-tint-row";
    const original = button("원래 색", () => setTint(item, ""), "pa-tint-reset"); original.dataset.tint = ""; swatches.appendChild(original);
    TINTS.forEach(([hex,label]) => { const swatch = button("", () => setTint(item, hex), "pa-tint"); swatch.dataset.tint = hex; swatch.title = label + "으로 물들이기"; swatch.setAttribute("aria-label", label); swatch.style.setProperty("--pa-tint", hex); swatches.appendChild(swatch); });
    colorBody.appendChild(swatches);
    const tintColorRow = document.createElement("label"); tintColorRow.className = "pa-range pa-shadow-color"; const tintColorText = document.createElement("span"); tintColorText.textContent = "직접";
    const tintColor = document.createElement("input"); tintColor.type = "color"; tintColor.dataset.colorKey = "t"; tintColor.title = "물들일 색 고르기";
    tintColor.oninput = () => { editColor(item, "t", tintColor.value); updateStickerElements(); }; tintColor.onchange = () => save(item);
    tintColorRow.append(tintColorText, tintColor); colorBody.appendChild(tintColorRow);
    [["물들이기","k",0,100,100],["색조","h",0,359,1],["채도","s",0,200,100],["밝기","b",50,150,100]].forEach(([label,key,min,max,scale]) => {
      const input = rangeRow(colorBody, item, label, { min, max, "data-color-key":key, "data-scale":scale }, value => editColor(item, key, value/scale));
      if (key === "k") input.title = "고른 색으로 얼마나 칠할지(0=원래 색)"; else if (key === "h") input.title = "모든 색을 색상환에서 돌립니다";
    });
    const patternBody = section(host, "pattern", "무늬 채우기", false);
    const patterns = document.createElement("div"); patterns.className = "pa-pattern-row";
    PATTERNS.forEach(([id,label]) => {
      const choice = button(id ? "" : "없음", () => setPattern(item, id), "pa-pattern-part"); choice.dataset.pattern = id; choice.title = label; choice.setAttribute("aria-label", label);
      const preview = patternPreview(id); if (preview) choice.style.backgroundImage = `url("${preview}")`;
      patterns.appendChild(choice);
    });
    patternBody.appendChild(patterns);
    colorRow(patternBody, item, "data-pattern-key", value => editPattern(item, "c", value));
    [["진하기","k",0,100,100],["크기","z",50,250,100],["각도","a",0,179,1]].forEach(([label,key,min,max,scale]) => {
      rangeRow(patternBody, item, label, { min, max, "data-pattern-key":key, "data-scale":scale }, value => editPattern(item, key, value/scale));
    });
    const blur = section(host, "blur", "흐림", false);
    const blurInput = rangeRow(blur, item, "정도", { min:0, max:BLUR_MAX, step:.5, "data-blur":"1" }, value => pickedParts(item).forEach(part => { if (value > 0) part.bl = value; else delete part.bl; }));
    blurInput.title = "0 이면 흐림 없음. 장식 폭에 맞춰 흐려지는 정도가 함께 바뀝니다";

    const motionBody = section(host, "motion", "움직임", false);
    const motions = document.createElement("div"); motions.className = "pa-motion-row";
    ANIMATIONS.forEach(([kind,label]) => { const choice = button(label, () => setAnimation(item, kind), "pa-shadow-part"); choice.dataset.motion = kind; motions.appendChild(choice); });
    motionBody.appendChild(motions);
    const speedInput = rangeRow(motionBody, item, "빠르기", { min:25, max:300, step:5, "data-motion-speed":"1" }, value => pickedParts(item).forEach(part => { const now = partAnimation(part); if (now) part.an = { k:now.k, s:value/100 }; }));
    speedInput.title = "100 이 보통 빠르기";
    const motionNote = document.createElement("p"); motionNote.className = "pa-adjust-tip"; motionNote.textContent = "움직임은 화면에서만 보이고, PNG 는 멈춘 모습으로 저장됩니다.";
    motionBody.appendChild(motionNote);
    const soundBody = section(host, "sound", "효과음", false);
    const sounds = document.createElement("div"); sounds.className = "pa-motion-row";
    SOUNDS.forEach(([kind,label]) => { const choice = button(label, () => setSound(item, kind), "pa-shadow-part"); choice.dataset.sound = kind; choice.title = kind ? label + " — 누르면 들어 봅니다" : "효과음 없음"; sounds.appendChild(choice); });
    soundBody.appendChild(sounds);
    const soundVolume = rangeRow(soundBody, item, "이 장식", { min:0, max:100, step:5, "data-sound-volume":"1" }, value => pickedParts(item).forEach(part => { const now = partSound(part); if (now) part.sfx = { k:now.k, v:value/100 }; }));
    const soundReadout = document.createElement("span"); soundReadout.className = "pa-range-value"; soundReadout.dataset.soundReadout = "1"; soundVolume.parentNode.appendChild(soundReadout);
    soundVolume.addEventListener("input", () => { soundReadout.textContent = soundVolume.value + "%"; });
    soundVolume.title = "이 장식의 효과음 크기. 사진 전체 크기는 사진 아래 🔔 효과음 전체에서 함께 조절합니다";
    // 손을 떼면 바뀐 크기로 한 번 들려준다.
    soundVolume.addEventListener("change", () => { const first = pickedParts(item)[0], sound = first && partSound(first); if (sound) previewSound(sound.k, sound.v); });
    const listen = button("▶ 들어 보기", () => { const first = pickedParts(item)[0], sound = first && partSound(first); if (sound) previewSound(sound.k, sound.v); }, "pa-music-button"); listen.dataset.soundListen = "1";
    const soundNote = document.createElement("p"); soundNote.className = "pa-adjust-tip"; soundNote.textContent = "움직임을 준 장식에만 소리가 납니다. 감상 모드에서 움직임에 맞춰 들리고, MP4 영상에도 담깁니다.";
    soundBody.append(listen, soundNote);
    const fadeBody = section(host, "fade", "투명도 그라데이션", false);
    const fades = document.createElement("div"); fades.className = "pa-fade-row";
    const fadesLabel = document.createElement("span"); fadesLabel.className = "pa-align-label"; fadesLabel.textContent = "화살표 쪽으로 갈수록 흐려짐";
    fades.appendChild(fadesLabel);
    FADES.forEach(([direction,label,icon]) => { const fadeButton = button(icon, () => setFade(item, direction), "pa-fade-part"); fadeButton.dataset.fade = direction; fadeButton.title = label; fadeButton.setAttribute("aria-label", label); fades.appendChild(fadeButton); });
    fadeBody.appendChild(fades);
    const fadeStartInput = rangeRow(fadeBody, item, "시작", { min:0, max:90, "data-fade-start":"1" }, value => pickedParts(item).forEach(part => { const fade = partFade(part); if (fade) part.fade = { d:fade.d, s:value }; }));
    fadeStartInput.title = "이 지점까지는 그대로 보이고, 여기서부터 끝으로 갈수록 투명해집니다";

    const shadowBody = section(host, "shadow", "그림자", false);
    const shadows = document.createElement("div"); shadows.className = "pa-shadow-row";
    SHADOW_PRESETS.forEach(([id,label]) => { const preset = button(label, () => setShadowPreset(item, id), "pa-shadow-part"); preset.dataset.shadowPreset = id; shadows.appendChild(preset); });
    shadowBody.appendChild(shadows);
    // 막대·색은 지금 그림자를 고쳐 쓴다(없음이면 잠김). 여럿이면 모두 같은 값으로.
    const editShadow = (key, value) => pickedParts(item).forEach(part => { const sh = partShadow(part); if (sh) part.sh = { ...sh, [key]:value }; });
    [["거리","d",0,25,1],["번짐","b",0,25,1],["진하기","o",0,100,100],["방향","a",0,359,1]].forEach(([label,key,min,max,scale]) => {
      const input = rangeRow(shadowBody, item, label, { min, max, step:key === "d" || key === "b" ? .5 : 1, "data-shadow-key":key, "data-scale":scale }, value => editShadow(key, value/scale));
      if (key === "a") input.title = "그림자가 드리우는 쪽(0°=오른쪽, 90°=아래, 180°=왼쪽, 270°=위)";
    });
    colorRow(shadowBody, item, "data-shadow-key", value => editShadow("c", value));

    const reflectBody = section(host, "reflect", "반사 (거울)", false);
    const reflect = document.createElement("div"); reflect.className = "pa-reflect-row";
    const reflectOn = button("반사 켜기", () => setReflect(item, true), "pa-shadow-part"); reflectOn.dataset.reflect = "on";
    const reflectOff = button("반사 끄기", () => setReflect(item, false), "pa-shadow-part"); reflectOff.dataset.reflect = "off";
    reflect.append(reflectOn, reflectOff); reflectBody.appendChild(reflect);
    [["간격","g",0,30,1],["진하기","o",5,80,100],["길이","l",10,100,1]].forEach(([label,key,min,max,scale]) => {
      rangeRow(reflectBody, item, label, { min, max, "data-reflect-key":key, "data-scale":scale }, value => pickedParts(item).forEach(part => { const rf = partReflect(part); if (rf) part.rf = { ...rf, [key]:value/scale }; }));
    });

    const outlineBody = section(host, "outline", "테두리 (외곽선)", false);
    const outline = document.createElement("div"); outline.className = "pa-outline-row";
    [...OUTLINE_PRESETS.map(([id,label]) => [id,label]), ["","없음"]].forEach(([id,label]) => { const preset = button(label, () => setOutline(item, id), "pa-shadow-part"); preset.dataset.outline = id; outline.appendChild(preset); });
    outlineBody.appendChild(outline);
    const outlineEdit = (key, value) => pickedParts(item).forEach(part => { const ol = partOutline(part); if (ol) part.ol = { ...ol, [key]:value }; });
    rangeRow(outlineBody, item, "두께", { min:.5, max:8, step:.5, "data-outline-key":"t" }, value => outlineEdit("t", value));
    colorRow(outlineBody, item, "data-outline-key", value => outlineEdit("c", value));

    // 동작 버튼과 도움말
    host.appendChild(button(many ? `⧉ ${parts.length}개 복제` : "⧉ 장식 복제", () => duplicateParts(item), "pa-duplicate-part"));
    host.appendChild(button(many ? `장식 ${parts.length}개 삭제` : "장식 삭제", () => removeParts(item), "pa-remove-part"));
    host.appendChild(snapToggle());
    host.appendChild(motionToggle());
    host.appendChild(soundToggle());
    const help = section(host, "help", "마우스·단축키 도움말", false);
    const tip = document.createElement("p"); tip.className = "pa-adjust-tip";
    tip.textContent = (many ? "묶음 틀 모서리 점=함께 크기, 위쪽 둥근 점=함께 회전(Shift 15°씩), 끌기=함께 이동, " : "사진 위 모서리 점=크기, 위쪽 둥근 점=회전(Shift 15°씩), ")
      + "휠=크기, Shift+휠=회전, 방향키 1px·Shift 10px 이동, Shift·Ctrl+클릭=골라 넣기/빼기, 빈 곳 끌기=여러 개 고르기, Ctrl+A 모두, Esc 풀기, Ctrl+G 묶기·Ctrl+Shift+G 묶음 풀기, Ctrl+C·X·V 복사·잘라내기·붙여넣기, Delete 삭제, Ctrl+Z 되돌리기·Ctrl+Y 다시 하기";
    help.appendChild(tip);
    updateStickerElements();
  }

  // 투명도는 o(0.1~1)로 담는다. 예전 장식엔 o 가 없으니 1로 본다.
  const partOpacity = part => Number.isFinite(part.o) ? Math.max(.1, Math.min(1, part.o)) : 1;
  // 투명도 그라데이션은 fade = { d:방향, s:흐려지기 시작하는 곳(0~90%) } 로 담는다. 끝은 늘 완전히 투명하다.
  // d 는 "그쪽으로 갈수록 흐려짐" 이다. 고칠 땐 늘 새 객체를 넣는다(복제·붙여넣기가 얕은 복사라 같은 객체를 나눠 쓸 수 있다).
  const FADES = [["","그라데이션 없음","✕"],["right","오른쪽으로 흐리게","→"],["left","왼쪽으로 흐리게","←"],["down","아래로 흐리게","↓"],["up","위로 흐리게","↑"],
    ["down-right","오른쪽 아래로 흐리게","↘"],["down-left","왼쪽 아래로 흐리게","↙"],["up-right","오른쪽 위로 흐리게","↗"],["up-left","왼쪽 위로 흐리게","↖"],["radial","가장자리로 흐리게","◎"]];
  const FADE_ANGLES = { up:0, "up-right":45, right:90, "down-right":135, down:180, "down-left":225, left:270, "up-left":315 };
  const partFade = part => part.fade && (part.fade.d === "radial" || Object.prototype.hasOwnProperty.call(FADE_ANGLES, part.fade.d))
    ? { d:part.fade.d, s:Math.max(0, Math.min(90, Number(part.fade.s) || 0)) } : null;
  // 그림은 뒤집기(scale)보다 먼저 가려지므로, 뒤집은 장식은 방향을 거꾸로 줘야 눈에 보이는 방향이 그대로다.
  function fadeAngle(part, fade){ let angle = FADE_ANGLES[fade.d]; if (part.f) angle = (360 - angle) % 360; if (part.v) angle = (540 - angle) % 360; return angle; }
  function fadeMask(part){
    const fade = partFade(part); if (!fade) return "";
    return fade.d === "radial" ? `radial-gradient(closest-side, #000 ${fade.s}%, transparent 100%)` : `linear-gradient(${fadeAngle(part, fade)}deg, #000 ${fade.s}%, transparent 100%)`;
  }
  // 내보내기용: 화면의 CSS 마스크와 같은 모양(선형은 CSS 그라데이션 선 길이, 원형은 상자에 닿는 타원)으로 가린 그림.
  function fadedSticker(image, part, width, height){
    const fade = partFade(part); if (!fade) return image;
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    let gradient;
    if (fade.d === "radial"){ ctx.translate(w/2, h/2); ctx.scale(w/2, h/2); gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); }
    else {
      const rad = fadeAngle(part, fade)*Math.PI/180, dx = Math.sin(rad), dy = -Math.cos(rad), half = (Math.abs(w*dx) + Math.abs(h*dy)) / 2;
      gradient = ctx.createLinearGradient(w/2 - dx*half, h/2 - dy*half, w/2 + dx*half, h/2 + dy*half);
    }
    gradient.addColorStop(fade.s/100, "rgba(0,0,0,1)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    if (fade.d === "radial") ctx.fillRect(-1, -1, 2, 2); else ctx.fillRect(0, 0, w, h);
    return canvas;
  }
  // 그림자 sh = { d:거리, b:흐림(둘 다 장식 폭의 %), o:진하기 0~1, a:드리우는 방향(도, 0=오른쪽·90=아래), c:색 }.
  // sh 가 없으면(예전 장식) 예전 화면과 같은 옅은 그림자, null 이면 그림자 없음. 폭 대비 % 라 화면·내보내기 크기가 달라도 모양이 같다.
  const SHADOW_PRESETS = [
    ["none","없음",null],
    ["soft","살짝",{ d:1.4, b:1.4, o:.33, a:90, c:"#000000" }],
    ["normal","보통",{ d:4, b:5, o:.45, a:135, c:"#000000" }],
    ["strong","진하게",{ d:6, b:3, o:.75, a:135, c:"#000000" }],
    ["long","길게",{ d:14, b:6, o:.35, a:135, c:"#000000" }],
    ["glow","빛 번짐",{ d:0, b:10, o:.9, a:90, c:"#ffe066" }]
  ];
  const SHADOW_DEFAULT = SHADOW_PRESETS[1][2];
  function partShadow(part){
    if (part.sh === null) return null;
    const sh = part.sh && typeof part.sh === "object" ? part.sh : SHADOW_DEFAULT, num = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Number(value))) : fallback;
    return { d:num(sh.d,0,25,0), b:num(sh.b,0,25,0), o:num(sh.o,0,1,.35), a:((num(sh.a,-3600,3600,90) % 360) + 360) % 360, c:/^#[0-9a-f]{6}$/i.test(sh.c) ? sh.c.toLowerCase() : "#000000" };
  }
  const shadowRgba = sh => `rgba(${parseInt(sh.c.slice(1,3),16)},${parseInt(sh.c.slice(3,5),16)},${parseInt(sh.c.slice(5,7),16)},${sh.o})`;
  // 사진 기준(돌리지 않은) 방향의 그림자 어긋남. px 는 장식 폭.
  const shadowOffset = (sh, px) => ({ x:Math.cos(sh.a*Math.PI/180)*sh.d/100*px, y:Math.sin(sh.a*Math.PI/180)*sh.d/100*px });
  // 화면: 그림자는 img 안(뒤집기·회전 전)에서 그려지므로, 해가 사진 기준 한 방향에서 비추도록 어긋남을 거꾸로 돌리고 뒤집어 넣는다.
  function shadowFilter(part, px){
    const sh = partShadow(part); if (!sh || !(px > 0)) return "none";
    const world = shadowOffset(sh, px), rad = -part.r*Math.PI/180;
    let x = world.x*Math.cos(rad) - world.y*Math.sin(rad), y = world.x*Math.sin(rad) + world.y*Math.cos(rad);
    if (part.f) x = -x; if (part.v) y = -y;
    const r2 = value => Math.round(value*100)/100;
    return `drop-shadow(${r2(x)}px ${r2(y)}px ${r2(sh.b/100*px)}px ${shadowRgba(sh)})`;
  }
  function setShadowPreset(item, id){
    const preset = SHADOW_PRESETS.find(row => row[0] === id); if (!preset) return;
    pickedParts(item).forEach(part => { part.sh = preset[2] ? { ...preset[2] } : null; });
    updateStickerElements(); save(item);
  }
  const shadowPresetOf = part => { const sh = partShadow(part); const hit = SHADOW_PRESETS.find(([, , values]) => values ? sh && ["d","b","o","a","c"].every(key => values[key] === sh[key]) : !sh); return hit ? hit[0] : ""; };
  // 반사 rf = { g:장식과 반사 사이 간격(장식 높이의 %), o:진하기 0~1, l:보이는 길이(장식 높이의 %) }. 없거나 null 이면 반사 없음.
  const REFLECT_DEFAULT = { g:2, o:.35, l:60 };
  function partReflect(part){
    const rf = part.rf; if (!rf || typeof rf !== "object") return null;
    const num = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Number(value))) : fallback;
    return { g:num(rf.g,0,30,REFLECT_DEFAULT.g), o:num(rf.o,.05,.8,REFLECT_DEFAULT.o), l:num(rf.l,10,100,REFLECT_DEFAULT.l) };
  }
  // 반사 그림은 눈에 보이는 장식을 위아래로 뒤집은 것이다. 뒤집은 뒤 장식 쪽(가까운 쪽)이 진하고 멀어질수록 사라진다.
  // 뒤집기 전 좌표에서 "가까운 쪽"은 장식을 상하 뒤집지 않았으면 아래, 뒤집었으면 위다.
  const reflectMask = (part, rf) => `linear-gradient(${part.v ? "to bottom" : "to top"}, #000 0%, transparent ${rf.l}%)`;
  function setReflect(item, on){
    pickedParts(item).forEach(part => { if (on) part.rf = { ...(partReflect(part) || REFLECT_DEFAULT) }; else delete part.rf; });
    updateStickerElements(); save(item);
  }
  // PNG 내보내기에서 장식 하나(그림자·그라데이션·반사 포함)를 그린다. cx·cy 는 장식 가운데.
  // 그라데이션·반사처럼 장면마다 같은 조각은 한 번만 만든다(GIF 는 같은 장식을 수십 번 그린다).
  function prepareSticker(sticker, part, width, height){
    const art = fadedSticker(sticker, part, width, height), rf = partReflect(part);
    let mirror = null;
    if (rf){
      // 화면의 반사 요소와 같게: 가까운 쪽부터 흐려지는 뒤집힌 그림.
      const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height)); mirror = document.createElement("canvas"); mirror.width = w; mirror.height = h;
      const m = mirror.getContext("2d"); m.drawImage(art, 0, 0, w, h); m.globalCompositeOperation = "destination-in";
      const near = part.v ? 0 : h, far = part.v ? h*rf.l/100 : h - h*rf.l/100, gradient = m.createLinearGradient(0, near, 0, far);
      gradient.addColorStop(0, "rgba(0,0,0,1)"); gradient.addColorStop(1, "rgba(0,0,0,0)"); m.fillStyle = gradient; m.fillRect(0, 0, w, h);
    }
    return { art, mirror };
  }
  function drawStickerOnCanvas(ctx, sticker, part, cx, cy, width, height, pose = POSE_STILL, prepared = null){
    const { art, mirror } = prepared || prepareSticker(sticker, part, width, height), flipX = part.f ? -1 : 1, flipY = part.v ? -1 : 1;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(part.r*Math.PI/180);
    // 움직임(화면에선 안쪽 칸의 CSS 애니메이션)은 장식 방향 기준으로 옮기고·돌리고·키운다. 반사도 함께 움직인다.
    if (pose !== POSE_STILL){
      const pivot = (pose.oy - .5)*height;
      ctx.translate(pose.x*width, pose.y*height + pivot); ctx.rotate(pose.r*Math.PI/180); ctx.scale(pose.sx, pose.sy); ctx.translate(0, -pivot);
    }
    const blur = blurFilter(part, width) || "none";
    ctx.save(); ctx.scale(flipX, flipY); ctx.globalAlpha = partOpacity(part)*pose.o; ctx.filter = blur;
    const shadow = partShadow(part);
    if (shadow){ const offset = shadowOffset(shadow, width); ctx.shadowColor = shadowRgba(shadow); ctx.shadowBlur = shadow.b/100*width; ctx.shadowOffsetX = offset.x; ctx.shadowOffsetY = offset.y; }
    ctx.drawImage(art, -width/2, -height/2, width, height);
    ctx.restore();
    const rf = partReflect(part);
    if (rf && mirror){
      // 장식 바로 아래(간격만큼 띄워) 같은 크기 상자에, (좌우 뒤집기, 상하는 반대로) 그린다.
      ctx.translate(0, height + height*rf.g/100); ctx.scale(flipX, -flipY); ctx.globalAlpha = partOpacity(part)*rf.o*pose.o; ctx.filter = blur;
      ctx.drawImage(mirror, -width/2, -height/2, width, height);
    }
    ctx.restore();
  }
  function setOutline(item, id){
    const preset = OUTLINE_PRESETS.find(row => row[0] === id);
    pickedParts(item).forEach(part => {
      if (!preset){ delete part.ol; return; }
      // 이미 테두리가 있으면 색만 바꾸고 두께는 둔다("색 테두리"는 지금 색을 살린다).
      const now = partOutline(part);
      part.ol = now ? { t:now.t, c:id === "color" && now.c !== "#ffffff" && now.c !== "#1f2937" ? now.c : preset[2].c } : { ...preset[2] };
    });
    updateStickerElements(); save(item);
  }
  // 흐림 bl = 장식 폭의 %(0~BLUR_MAX). 화면은 CSS blur(), 내보내기는 캔버스 filter 로 같은 정도(표준편차 px)로 흐린다.
  const BLUR_MAX = 10;
  const partBlur = part => Number.isFinite(Number(part.bl)) ? Math.max(0, Math.min(BLUR_MAX, Number(part.bl))) : 0;
  const blurFilter = (part, px) => { const radius = partBlur(part)/100*px; return radius > 0 ? `blur(${Math.round(radius*100)/100}px)` : ""; };
  // 움직임 an = { k:종류, s:빠르기 배율 0.25~3 }. 화면에서만 움직이고 PNG 는 멈춘 모습으로 내보낸다.
  const ANIMATIONS = [["","멈춤",0],["bounce","통통",1],["float","둥실",3],["swing","흔들흔들",1.6],["spin","빙글",3],["pulse","두근",1.1],["twinkle","반짝",1.4],["shake","부르르",.5],["jelly","말랑",1.2]];
  const MOTION_KEY = "classdock.photoAlbum.motion";
  function partAnimation(part){
    const an = part.an; if (!an || typeof an !== "object") return null;
    const kind = ANIMATIONS.find(row => row[0] && row[0] === an.k); if (!kind) return null;
    const speed = Number.isFinite(Number(an.s)) ? Math.max(.25, Math.min(3, Number(an.s))) : 1;
    return { k:kind[0], s:speed, d:Math.round(kind[2]/speed*1000)/1000 };
  }
  function setAnimation(item, kind){
    pickedParts(item).forEach(part => { const now = partAnimation(part); if (!kind) delete part.an; else part.an = { k:kind, s:now ? now.s : 1 }; });
    updateStickerElements(); save(item);
  }
  // GIF 로 내보낼 때 쓰는, styles.css 의 @keyframes pa-* 와 같은 움직임. 시각 t(초)의 자세를 돌려준다.
  // x·y 는 장식 폭·높이의 비율, r 은 도, sx·sy 는 배율, o 는 투명도 배수, oy 는 회전 중심의 높이(위=0, 아래=1).
  const POSE_STILL = { x:0, y:0, r:0, sx:1, sy:1, o:1, oy:.5 };
  const POSE_KEYS = {
    bounce:{ stops:[[0,{y:0}],[.4,{y:-.14}],[.6,{y:0}],[.72,{y:-.04}],[.84,{y:0}],[1,{y:0}]] },
    float:{ stops:[[0,{y:0}],[.5,{y:-.06}],[1,{y:0}]] },
    swing:{ oy:.08, stops:[[0,{r:0}],[.25,{r:9}],[.75,{r:-9}],[1,{r:0}]] },
    spin:{ linear:true, stops:[[0,{r:0}],[1,{r:360}]] },
    pulse:{ stops:[[0,{sx:1,sy:1}],[.15,{sx:1.13,sy:1.13}],[.3,{sx:1,sy:1}],[.45,{sx:1.08,sy:1.08}],[.6,{sx:1,sy:1}],[1,{sx:1,sy:1}]] },
    twinkle:{ stops:[[0,{o:1}],[.5,{o:.3}],[1,{o:1}]] },
    shake:{ linear:true, stops:[[0,{x:0,r:0}],[.2,{x:-.03,r:-1}],[.4,{x:.03,r:1}],[.6,{x:-.02,r:0}],[.8,{x:.02,r:0}],[1,{x:0,r:0}]] },
    jelly:{ stops:[[0,{sx:1,sy:1}],[.3,{sx:1.12,sy:.88}],[.5,{sx:.9,sy:1.1}],[.7,{sx:1.04,sy:.96}],[1,{sx:1,sy:1}]] }
  };
  const easeInOut = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;   // CSS ease-in-out 과 거의 같은 곡선
  function animationPose(part, time){
    const animation = partAnimation(part), keys = animation && POSE_KEYS[animation.k];
    if (!keys) return POSE_STILL;
    const phase = ((time / animation.d) % 1 + 1) % 1, stops = keys.stops;
    let i = 0; while (i < stops.length - 2 && phase > stops[i + 1][0]) i++;
    const [a, from] = stops[i], [b, to] = stops[i + 1], local = b > a ? (phase - a)/(b - a) : 0, k = keys.linear ? local : easeInOut(local);
    const pose = { ...POSE_STILL, oy:keys.oy || .5 };
    Object.keys(from).forEach(key => { pose[key] = from[key] + ((key in to ? to[key] : from[key]) - from[key])*k; });
    return pose;
  }
  // 움직이는 장식들이 모두 이어지게 되풀이되는 길이(초). 딱 맞는 길이가 6초 안에 없으면 가장 긴 움직임 길이를 쓴다.
  function loopLength(durations){
    const longest = Math.max(...durations);
    for (let length = longest; length <= 6.0001; length += .05){ if (durations.every(d => Math.abs(length/d - Math.round(length/d)) < .02)) return Math.round(length*100)/100; }
    return Math.min(6, Math.max(1, longest));
  }
  function motionEnabled(){ try { return localStorage.getItem(MOTION_KEY) !== "off"; } catch { return true; } }
  function applyMotionSetting(){ if (root) root.classList.toggle("pa-motion-off", !motionEnabled()); }
  function motionToggle(){
    const row = document.createElement("label"); row.className = "pa-snap-toggle"; row.title = "꾸미는 동안 움직임이 거슬리면 잠시 멈춰 두세요. 설정은 그대로 남습니다.";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = motionEnabled();
    input.onchange = () => { try { localStorage.setItem(MOTION_KEY, input.checked ? "on" : "off"); } catch { /* 이번 화면에만 적용 */ } root.classList.toggle("pa-motion-off", !input.checked); syncSfx(); };
    const text = document.createElement("span"); text.textContent = "🎬 장식 움직임 보기";
    row.append(input, text); return row;
  }
  function setFade(item, direction){
    pickedParts(item).forEach(part => { if (!direction) delete part.fade; else part.fade = { d:direction, s:partFade(part) ? partFade(part).s : 40 }; });
    updateStickerElements(); save(item);
  }
  const partValue = (part, key) => key === "o" ? Math.round(partOpacity(part)*100) : part[key];
  function setPartValue(part, key, value){
    if (key === "o") part.o = Math.max(10, Math.min(100, value)) / 100;
    else if (key === "w") part.w = Math.max(PART_MIN_W, Math.min(PART_MAX_W, value));
    else if (key === "r") part.r = ((value + 540) % 360) - 180;
  }
  // 좌우 뒤집기는 f, 상하 뒤집기는 v(true/false)로 담는다. 회전은 뒤집은 그림을 돌린다.
  const FLIPS = [["f","⇆","좌우 뒤집기"],["v","⇅","상하 뒤집기"]];
  // 여럿을 뒤집을 땐 하나라도 안 뒤집혔으면 모두 뒤집고, 모두 뒤집혀 있으면 모두 되돌린다.
  function flipParts(item, key){
    const parts = pickedParts(item), on = !parts.every(part => part[key]);
    parts.forEach(part => { part[key] = on; }); updateStickerElements();
  }
  function resetParts(item){ pickedParts(item).forEach(part => { part.r = 0; part.o = 1; part.f = false; part.v = false; }); updateStickerElements(); }
  // 겹침 순서는 stickers 배열 순서 그대로다(뒤에 있을수록 위). 화면·내보내기 모두 이 순서로 그린다.
  // 여럿을 옮길 땐 고른 것끼리의 앞뒤 순서를 지킨 채 한 칸씩(또는 맨 앞·맨 뒤로) 옮긴다.
  const ORDERS = [["front","⤒","맨 앞으로"],["forward","↑","앞으로"],["backward","↓","뒤로"],["back","⤓","맨 뒤로"]];
  const orderRoom = item => {
    const list = item.stickers || [], marks = list.map(part => picked.has(part.id));
    return { forward:marks.some((on, i) => on && marks.slice(i + 1).some(next => !next)), backward:marks.some((on, i) => on && marks.slice(0, i).some(prev => !prev)) };
  };
  function moveParts(item, where){
    const list = item.stickers, room = orderRoom(item);
    if (!room[where === "front" || where === "forward" ? "forward" : "backward"]) return;
    if (where === "front" || where === "back"){
      const chosen = list.filter(part => picked.has(part.id)), rest = list.filter(part => !picked.has(part.id));
      item.stickers = where === "front" ? rest.concat(chosen) : chosen.concat(rest);
    } else if (where === "forward"){
      for (let i = list.length - 2; i >= 0; i--) if (picked.has(list[i].id) && !picked.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else {
      for (let i = 1; i < list.length; i++) if (picked.has(list[i].id) && !picked.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
    save(item); paintStage(); paintAdjust();
  }
  // 크기·회전·투명도·뒤집기를 그대로 두고 살짝 비껴 맨 위에 하나 더 올린다. 여럿이면 복제본들을 고른다.
  function duplicateParts(item){
    const nudge = (value, step) => value + step <= 100 ? value + step : Math.max(0, value - step);
    const newGroup = new Map(), groupOf = g => { if (!newGroup.has(g)) newGroup.set(g, crypto.randomUUID()); return newGroup.get(g); };
    const copies = pickedParts(item).map(source => {
      const copy = { ...source, id:crypto.randomUUID(), x:nudge(source.x,4), y:nudge(source.y,4) };
      if (source.g) copy.g = groupOf(source.g);
      return copy;
    });
    if (!copies.length) return;
    item.stickers.push(...copies); picked = new Set(copies.map(part => part.id)); save(item); showToolTab("deco"); paintStage(); paintAdjust();
  }
  function removeParts(item){
    if (!pickedParts(item).length) return;
    item.stickers = item.stickers.filter(row => !picked.has(row.id)); picked = new Set();
    save(item); paintStage(); paintAdjust();
  }
  // 사진첩 안에서만 쓰는 장식 클립보드. 다른 사진에 붙여 넣을 수 있고, 붙일 때마다 조금씩 비껴 놓는다.
  let partClipboard = null;
  function copyParts(item, cut){
    const parts = pickedParts(item); if (!parts.length) return false;
    partClipboard = { from:item.id, parts:parts.map(part => ({ ...part })), pastes:new Map() };
    if (cut){ removeParts(item); status(`장식 ${parts.length}개를 잘라 냈습니다. Ctrl+V 로 붙여 넣으세요.`); }
    else status(`장식 ${parts.length}개를 복사했습니다. Ctrl+V 로 붙여 넣으세요.`);
    return true;
  }
  function pasteParts(item){
    if (!partClipboard || !partClipboard.parts.length || !item || item.type !== "image") return false;
    // 사진마다 붙인 횟수를 세어, 같은 사진이면 첫 붙여 넣기부터, 다른 사진이면 두 번째부터 4%씩 비껴 놓는다(묶음 모양은 그대로).
    const count = (partClipboard.pastes.get(item.id) || 0) + 1; partClipboard.pastes.set(item.id, count);
    const step = 4 * (partClipboard.from === item.id ? count : count - 1);
    const xs = partClipboard.parts.map(part => part.x), ys = partClipboard.parts.map(part => part.y);
    const dx = Math.max(-Math.min(...xs), Math.min(100 - Math.max(...xs), step)), dy = Math.max(-Math.min(...ys), Math.min(100 - Math.max(...ys), step));
    const newGroup = new Map(), groupOf = g => { if (!newGroup.has(g)) newGroup.set(g, crypto.randomUUID()); return newGroup.get(g); };
    const copies = partClipboard.parts.filter(part => rowOf(part)).map(part => {
      const copy = { ...part, id:crypto.randomUUID(), x:part.x + dx, y:part.y + dy }; delete copy.h; delete copy.l;
      if (part.g) copy.g = groupOf(part.g);
      return copy;
    });
    if (!copies.length) return false;
    item.stickers.push(...copies); picked = new Set(copies.map(part => part.id));
    save(item); showToolTab("deco"); paintStage(); paintAdjust(); status(`장식 ${copies.length}개를 붙여 넣었습니다.`);
    return true;
  }
  // 정렬: 묶음은 한 덩어리로 본다. 덩어리가 하나면 사진에, 여럿이면 고른 것 전체의 둘레에 맞춘다.
  // 상자는 돌린 모양까지 감싼 화면 상자(partsBox)로 재야 비스듬한 장식도 눈에 보이는 가장자리가 맞는다.
  const ALIGNS = [
    ["left","왼쪽 맞춤",'<path d="M2 1v14"/><rect x="4" y="3" width="9" height="4" rx="1"/><rect x="4" y="9" width="5" height="4" rx="1"/>'],
    ["center","가로 가운데 맞춤",'<path d="M8 1v14"/><rect x="3" y="3" width="10" height="4" rx="1"/><rect x="5" y="9" width="6" height="4" rx="1"/>'],
    ["right","오른쪽 맞춤",'<path d="M14 1v14"/><rect x="3" y="3" width="9" height="4" rx="1"/><rect x="7" y="9" width="5" height="4" rx="1"/>'],
    ["spread-x","가로 간격 고르게",'<path d="M1 2v12M15 2v12"/><rect x="3" y="5" width="3" height="6" rx="1"/><rect x="10" y="5" width="3" height="6" rx="1"/>'],
    ["top","위쪽 맞춤",'<path d="M1 2h14"/><rect x="3" y="4" width="4" height="9" rx="1"/><rect x="9" y="4" width="4" height="5" rx="1"/>'],
    ["middle","세로 가운데 맞춤",'<path d="M1 8h14"/><rect x="3" y="3" width="4" height="10" rx="1"/><rect x="9" y="5" width="4" height="6" rx="1"/>'],
    ["bottom","아래쪽 맞춤",'<path d="M1 14h14"/><rect x="3" y="3" width="4" height="9" rx="1"/><rect x="9" y="7" width="4" height="5" rx="1"/>'],
    ["spread-y","세로 간격 고르게",'<path d="M2 1h12M2 15h12"/><rect x="5" y="3" width="6" height="3" rx="1"/><rect x="5" y="10" width="6" height="3" rx="1"/>']
  ];
  function pickedUnits(item){
    const units = new Map();
    pickedParts(item).forEach(part => { const key = part.g || part.id; if (!units.has(key)) units.set(key, []); units.get(key).push(part); });
    return [...units.values()];
  }
  function alignParts(item, how){
    const layer = root && root.querySelector(".pa-layer"), W = layer && layer.clientWidth, H = layer && layer.clientHeight;
    const units = pickedUnits(item); if (!units.length || !W || !H) return;
    const boxes = units.map(parts => ({ parts, box:partsBox(parts, W, H) }));
    const shift = (unit, dx, dy) => unit.parts.forEach(part => {
      part.x = Math.max(0, Math.min(100, part.x + dx/W*100)); part.y = Math.max(0, Math.min(100, part.y + dy/H*100));
    });
    if (how === "spread-x" || how === "spread-y"){
      if (boxes.length < 3) return;
      const horizontal = how === "spread-x", lo = horizontal ? "l" : "t", hi = horizontal ? "r" : "b";
      boxes.sort((a, b) => (a.box[lo] + a.box[hi]) - (b.box[lo] + b.box[hi]));
      const start = boxes[0].box[lo], end = boxes[boxes.length - 1].box[hi];
      const gap = (end - start - boxes.reduce((sum, unit) => sum + unit.box[hi] - unit.box[lo], 0)) / (boxes.length - 1);
      let at = start;
      boxes.forEach(unit => { const d = at - unit.box[lo]; shift(unit, horizontal ? d : 0, horizontal ? 0 : d); at += unit.box[hi] - unit.box[lo] + gap; });
    } else {
      const ref = boxes.length === 1 ? { l:0, t:0, r:W, b:H, cx:W/2, cy:H/2 } : partsBox(pickedParts(item), W, H);
      boxes.forEach(unit => {
        const b = unit.box;
        const dx = how === "left" ? ref.l - b.l : how === "center" ? ref.cx - b.cx : how === "right" ? ref.r - b.r : 0;
        const dy = how === "top" ? ref.t - b.t : how === "middle" ? ref.cy - b.cy : how === "bottom" ? ref.b - b.b : 0;
        shift(unit, dx, dy);
      });
    }
    updateStickerElements(); save(item);
    status(boxes.length === 1 ? "사진에 맞춰 정렬했습니다." : `장식 ${boxes.length}덩어리를 정렬했습니다.`);
  }
  // 자석(스냅): 켬/끔은 이 컴퓨터의 브라우저에만 기억한다(저장소가 막혀 있으면 늘 켬).
  const SNAP_KEY = "classdock.photoAlbum.snap", SNAP_DISTANCE = 6;
  function snapEnabled(){ try { return localStorage.getItem(SNAP_KEY) !== "off"; } catch { return true; } }
  function setSnapEnabled(on){ try { localStorage.setItem(SNAP_KEY, on ? "on" : "off"); } catch { /* 기억 못 해도 이번엔 적용 */ } }
  // 붙을 수 있는 선: 사진의 가장자리·가운데와, 고르지 않은 장식마다 왼쪽·가운데·오른쪽(위·가운데·아래).
  function snapLines(item, W, H){
    const xs = [0, W/2, W], ys = [0, H/2, H];
    (item.stickers || []).forEach(part => {
      if (picked.has(part.id) || part.h || !rowOf(part)) return;
      const box = partsBox([part], W, H); xs.push(box.l, box.cx, box.r); ys.push(box.t, box.cy, box.b);
    });
    return { xs, ys };
  }
  // 상자를 dx·dy 만큼 옮겼을 때 가장 가까운 선까지 더 옮길 양(축마다 따로)과 붙은 선 위치를 돌려준다.
  function snapOffset(box, dx, dy, lines){
    const nearest = (edges, candidates) => {
      let best = null;
      edges.forEach(edge => candidates.forEach(line => { const d = line - edge; if (Math.abs(d) <= SNAP_DISTANCE && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line }; }));
      return best;
    };
    const bx = nearest([box.l + dx, box.cx + dx, box.r + dx], lines.xs), by = nearest([box.t + dy, box.cy + dy, box.b + dy], lines.ys);
    return { x:bx ? bx.d : 0, y:by ? by.d : 0, lineX:bx ? bx.line : null, lineY:by ? by.line : null };
  }
  function showSnapGuides(layer, snap){
    layer.querySelectorAll(".pa-snap-guide").forEach(el => el.remove());
    if (!snap) return;
    if (snap.lineX !== null){ const guide = document.createElement("div"); guide.className = "pa-snap-guide x"; guide.style.left = snap.lineX + "px"; layer.appendChild(guide); }
    if (snap.lineY !== null){ const guide = document.createElement("div"); guide.className = "pa-snap-guide y"; guide.style.top = snap.lineY + "px"; layer.appendChild(guide); }
  }
  // 크기 맞추기: 덩어리마다 크기를 재어 가장 큰(작은) 것에 맞춘다. 낱개는 크기 값 w, 묶음은 화면 폭(돌린 모양 포함)을 사진 폭 대비 % 로 잰다.
  // 묶음은 가운데를 기준으로 통째로 늘이거나 줄여 모양을 지키고, 낱개는 제자리에서 크기만 바꾼다.
  const unitSize = (unit, W, H) => unit.length === 1 ? unit[0].w : (() => { const box = partsBox(unit, W, H); return (box.r - box.l)/W*100; })();
  function matchSizes(item, mode){
    const layer = root && root.querySelector(".pa-layer"), surface = root && root.querySelector(".pa-photo-surface");
    const units = pickedUnits(item); if (units.length < 2 || !layer || !surface || !layer.clientWidth) return;
    const W = layer.clientWidth, H = layer.clientHeight, sizes = units.map(unit => unitSize(unit, W, H));
    const target = mode === "largest" ? Math.max(...sizes) : Math.min(...sizes), rect = surface.getBoundingClientRect();
    units.forEach((unit, i) => { if (sizes[i] > 0 && Math.abs(sizes[i] - target) > 1e-6) transformParts(partStarts(unit), rect, groupCenter(unit, rect), target/sizes[i], 0); });
    updateStickerElements(); save(item);
    status(mode === "largest" ? `장식 ${units.length}덩어리를 가장 큰 것에 맞췄습니다.` : `장식 ${units.length}덩어리를 가장 작은 것에 맞췄습니다.`);
  }
  // 각도 맞추기: 낱개는 그 각도로 바로 세우고, 묶음은 첫 장식이 그 각도가 되도록 묶음 가운데를 기준으로 통째로 돌린다(모양 유지).
  function rotateTo(item, angle){
    const units = pickedUnits(item), surface = root && root.querySelector(".pa-photo-surface");
    if (!units.length || !surface || !Number.isFinite(angle)) return;
    const target = ((Math.round(angle) + 540) % 360) - 180, rect = surface.getBoundingClientRect();
    units.forEach(unit => {
      if (unit.length === 1) setPartValue(unit[0], "r", target);
      else { const delta = ((target - unit[0].r + 540) % 360) - 180; if (delta) transformParts(partStarts(unit), rect, groupCenter(unit, rect), 1, delta); }
    });
    updateStickerElements(); save(item);
    status(`${units.length > 1 ? "장식 " + units.length + "덩어리를 " : ""}${target}°로 맞췄습니다.`);
  }
  function groupParts(item){
    const parts = pickedParts(item); if (parts.length < 2) return;
    const g = crypto.randomUUID(); parts.forEach(part => { part.g = g; });
    save(item); refreshPicked(); status(`장식 ${parts.length}개를 묶었습니다.`);
  }
  function ungroupParts(item){
    const parts = pickedParts(item).filter(part => part.g); if (!parts.length) return;
    parts.forEach(part => { delete part.g; });
    save(item); refreshPicked(); status("묶음을 풀었습니다.");
  }
  const toggleGroup = item => pickedIsOneGroup(item) ? ungroupParts(item) : groupParts(item);
  // 그리기 창. 펜(채우기 켜면 닫힌 도형), 획 지우개, 되돌리기·다시 하기, 모두 지우기. 저장하면 "내 그림"에 넣고,
  // 새 그림이고 사진을 고른 상태면 그 사진에도 바로 붙인다. 창이 떠 있는 동안 사진첩 단축키는 쉰다(drawing).
  let drawing = false;
  const DRAW_COLORS = ["#1f2937","#ffffff","#e63946","#ff8c42","#ffd60a","#52b788","#4cc9f0","#3a5bd9","#8b5cf6","#ff70a6","#8d6e63","#adb5bd"];
  function openDrawPad(record){
    if (drawing || !root) return;
    drawing = true;
    let strokes = record ? cleanStrokes(record.strokes) : [], color = DRAW_COLORS[0], width = 3, fill = false, mode = "pen", current = null;
    const past = [], future = [], snapshot = () => JSON.stringify(strokes);
    const commit = () => { past.push(snapshot()); if (past.length > 100) past.shift(); future.length = 0; };
    const pointCount = () => strokes.reduce((sum, stroke) => sum + stroke.p.length, 0);

    const overlay = document.createElement("div"); overlay.className = "pa-draw-overlay";
    const dialog = document.createElement("div"); dialog.className = "pa-draw"; dialog.setAttribute("role","dialog"); dialog.setAttribute("aria-modal","true"); dialog.setAttribute("aria-label","장식 직접 그리기");
    const head = document.createElement("div"); head.className = "pa-draw-head";
    const heading = document.createElement("strong"); heading.textContent = record ? "내 그림 고치기" : "장식 직접 그리기";
    const nameInput = document.createElement("input"); nameInput.type = "text"; nameInput.maxLength = 40; nameInput.placeholder = "그림 이름"; nameInput.value = record ? record.name : "내 그림 " + (customArts.length + 1);
    head.append(heading, nameInput);
    const board = document.createElement("div"); board.className = "pa-draw-board";
    const canvas = document.createElement("canvas"); canvas.className = "pa-draw-canvas"; canvas.setAttribute("aria-label","그림판");
    board.appendChild(canvas);
    const tools = document.createElement("div"); tools.className = "pa-draw-tools";
    const swatches = document.createElement("div"); swatches.className = "pa-draw-swatches";
    const pickColor = value => { color = value; if (mode !== "pen") setMode("pen"); swatches.querySelectorAll("[data-draw-color]").forEach(el => el.classList.toggle("active", el.dataset.drawColor === value)); customColor.value = value; };
    DRAW_COLORS.forEach(value => { const swatch = button("", () => pickColor(value), "pa-draw-swatch"); swatch.dataset.drawColor = value; swatch.style.setProperty("--pa-tint", value); swatch.setAttribute("aria-label", "색 " + value); swatches.appendChild(swatch); });
    const customColor = document.createElement("input"); customColor.type = "color"; customColor.value = color; customColor.title = "다른 색 고르기"; customColor.oninput = () => pickColor(customColor.value);
    swatches.appendChild(customColor);
    const widthRow = document.createElement("label"); widthRow.className = "pa-range"; const widthText = document.createElement("span"); widthText.textContent = "굵기";
    const widthInput = document.createElement("input"); widthInput.type = "range"; widthInput.min = 1; widthInput.max = 14; widthInput.step = .5; widthInput.value = width; widthInput.oninput = () => { width = Number(widthInput.value); };
    widthRow.append(widthText, widthInput);
    const modes = document.createElement("div"); modes.className = "pa-draw-modes";
    const penButton = button("✏ 펜", () => setMode("pen"), "pa-draw-mode"), eraseButton = button("⌫ 획 지우개", () => setMode("erase"), "pa-draw-mode");
    const fillButton = button("◼ 채우기", () => { fill = !fill; fillButton.classList.toggle("active", fill); fillButton.setAttribute("aria-pressed", String(fill)); }, "pa-draw-mode");
    fillButton.title = "켜면 그린 선을 닫아 속을 칠합니다(도형 그리기)"; fillButton.setAttribute("aria-pressed","false");
    const undoButton = button("↶", () => undo(), "pa-draw-mode"), redoButton = button("↷", () => redo(), "pa-draw-mode"), clearButton = button("모두 지우기", () => { if (!strokes.length) return; commit(); strokes = []; render(); }, "pa-draw-mode");
    undoButton.title = "되돌리기 (Ctrl+Z)"; redoButton.title = "다시 하기 (Ctrl+Y)";
    modes.append(penButton, eraseButton, fillButton, undoButton, redoButton, clearButton);
    tools.append(swatches, widthRow, modes);
    const foot = document.createElement("div"); foot.className = "pa-draw-foot";
    const note = document.createElement("small"); note.className = "pa-draw-note";
    const cancel = button("취소", () => close(), ""), saveButton = button(record ? "고친 그림 저장" : "저장하고 붙이기", () => finish(), "primary");
    foot.append(note, cancel, saveButton);
    dialog.append(head, board, tools, foot); overlay.appendChild(dialog); root.appendChild(overlay);

    function setMode(next){ mode = next; penButton.classList.toggle("active", mode === "pen"); eraseButton.classList.toggle("active", mode === "erase"); canvas.classList.toggle("erasing", mode === "erase"); }
    function undo(){ if (!past.length) return; future.push(snapshot()); strokes = JSON.parse(past.pop()); render(); }
    function redo(){ if (!future.length) return; past.push(snapshot()); strokes = JSON.parse(future.pop()); render(); }
    const ctx = canvas.getContext("2d");
    function fitCanvas(){
      const box = board.getBoundingClientRect(), cssWidth = Math.max(160, Math.min(box.width, (box.height || box.width) * 120/105));
      const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.style.width = cssWidth + "px"; canvas.style.height = cssWidth*105/120 + "px";
      canvas.width = Math.round(cssWidth*ratio); canvas.height = Math.round(cssWidth*105/120*ratio); render();
    }
    function render(){
      const scale = canvas.width/120;
      ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.setTransform(scale,0,0,scale,0,0);
      // 옅은 모눈: 투명한 바탕임을 알리고 크기를 가늠하게 한다(저장되는 그림에는 없음).
      ctx.strokeStyle = "rgba(100,116,139,.14)"; ctx.lineWidth = .3;
      for (let x = 10; x < 120; x += 10){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,105); ctx.stroke(); }
      for (let y = 10; y < 105; y += 10){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(120,y); ctx.stroke(); }
      [...strokes, ...(current ? [current] : [])].forEach(stroke => {
        const path = new Path2D(strokePath(stroke));
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = stroke.w; ctx.strokeStyle = stroke.c;
        if (stroke.f){ ctx.fillStyle = stroke.c; ctx.fill(path); }
        ctx.stroke(path);
      });
      undoButton.disabled = !past.length; redoButton.disabled = !future.length; clearButton.disabled = !strokes.length; saveButton.disabled = !strokes.length;
      const used = pointCount() + (current ? current.p.length : 0);
      note.textContent = used > CUSTOM_MAX_POINTS*.8 ? `그림이 꽤 복잡해요 (${Math.round(used/CUSTOM_MAX_POINTS*100)}%)` : "투명한 바탕에 그려집니다";
    }
    const toPoint = event => { const box = canvas.getBoundingClientRect(); return [(event.clientX - box.left)/box.width*120, (event.clientY - box.top)/box.height*105]; };
    // 획 지우개: 누른 곳에서 가장 가까운(굵기 반 + 여유 안) 위쪽 획 하나를 지운다.
    function eraseAt(point){
      for (let i = strokes.length - 1; i >= 0; i--){
        const reach = strokes[i].w/2 + 2.5;
        if (strokes[i].p.some(p => Math.hypot(p[0] - point[0], p[1] - point[1]) <= reach)){ commit(); strokes.splice(i, 1); render(); return; }
      }
    }
    canvas.onpointerdown = event => {
      if (event.button !== 0) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId);
      const point = toPoint(event);
      if (mode === "erase"){ eraseAt(point); return; }
      if (pointCount() >= CUSTOM_MAX_POINTS){ note.textContent = "그림이 너무 복잡해 더 그릴 수 없습니다. 몇 획을 지워 주세요."; return; }
      current = { c:color, w:width, f:fill, p:[point] }; render();
    };
    canvas.onpointermove = event => {
      if (mode === "erase"){ if (event.buttons & 1) eraseAt(toPoint(event)); return; }
      if (!current) return;
      const point = toPoint(event), last = current.p[current.p.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) < .6 || pointCount() + current.p.length >= CUSTOM_MAX_POINTS) return;
      current.p.push(point); render();
    };
    const endStroke = () => { if (!current) return; const done = cleanStrokes([current])[0]; current = null; if (done){ commit(); strokes.push(done); } render(); };
    canvas.onpointerup = endStroke; canvas.onpointercancel = endStroke;
    const onKey = event => {
      const key = String(event.key || "").toLowerCase(), mod = event.ctrlKey || event.metaKey, typing = event.target === nameInput;
      if (event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); close(); return; }
      if (typing) return;
      if (mod && key === "z"){ event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo(); }
      else if (mod && key === "y"){ event.preventDefault(); event.stopPropagation(); redo(); }
    };
    window.addEventListener("keydown", onKey, true);
    const observer = new ResizeObserver(() => fitCanvas()); observer.observe(board);
    function close(){ window.removeEventListener("keydown", onKey, true); observer.disconnect(); overlay.remove(); drawing = false; }
    async function finish(){
      if (!strokes.length) return;
      const saved = { id:record ? record.id : crypto.randomUUID(), type:"art", name:customName(nameInput.value), strokes:cleanStrokes(strokes), created:record ? record.created : Date.now(), updated:Date.now() };
      saveButton.disabled = true;
      try { await persistArt(saved); }
      catch(error){ console.error(error); saveButton.disabled = false; notice("그린 장식을 저장하지 못했습니다."); return; }
      customArts = customArts.filter(other => other.id !== saved.id).concat(saved).sort((a, b) => (a.created || 0) - (b.created || 0));
      close(); category = CUSTOM_GROUP; paintStickers();
      const item = selected();
      if (!record && item && item.type === "image") addSticker(customRow(saved));
      else status(record ? "고친 그림을 저장했습니다. 이미 붙인 장식은 예전 그림 그대로입니다." : "그린 장식을 내 그림에 저장했습니다. 사진을 고른 뒤 눌러 붙이세요.");
    }
    setMode("pen"); pickColor(color); requestAnimationFrame(fitCanvas); nameInput.focus(); nameInput.select();
  }
  async function removeCustomArt(record){
    if (!await confirmDialog(`"${record.name}"을(를) 내 그림 목록에서 지울까요? 이미 사진에 붙인 장식은 그대로 남습니다.`, "지우기", "취소")) return;
    try { await deleteArt(record); customArts = customArts.filter(other => other.id !== record.id); paintStickers(); status("내 그림에서 지웠습니다."); }
    catch(error){ console.error(error); notice("그림을 지우지 못했습니다."); }
  }
  function addSticker(row, position, extra){
    const item = selected(); if (!item || item.type !== "image"){ notice("먼저 사진을 선택해 주세요."); return; }
    const part = { id:crypto.randomUUID(), art:row[0], x:position ? position.x : 50, y:position ? position.y : row[3], w:row[5], r:0 };
    if (extra) Object.assign(part, extra);
    else if (row[1] === CUSTOM_GROUP){ const record = customArts.find(other => other.id === row[0]); if (!record) return; part.cs = { n:record.name, s:record.strokes }; }
    item.stickers.push(part); picked = new Set([part.id]); save(item); showToolTab("deco"); paintStage(); paintAdjust();
  }
  function dropPosition(clientX, clientY, rect){
    if (!rect || rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    return { x:(clientX-rect.left)/rect.width*100, y:(clientY-rect.top)/rect.height*100 };
  }
  function photoDropPosition(event){
    const surface = root && root.querySelector(".pa-photo-surface");
    return surface && dropPosition(event.clientX,event.clientY,surface.getBoundingClientRect());
  }
  // 화면의 반사: 장식 안에 뒤집은 그림을 하나 더 두고(장식과 함께 돈다) 가까운 쪽부터 흐리게 가린다.
  // 그라데이션(fade)을 준 장식이면 같은 마스크를 겹쳐(교집합) 반사도 똑같이 흐려지게 한다.
  function paintReflection(el, part, fade, blur){
    const rf = partReflect(part); let mirror = el.querySelector(".pa-reflect");
    if (!rf){ if (mirror) mirror.remove(); return; }
    if (!mirror){ const art = el.querySelector("img"); mirror = document.createElement("img"); mirror.className = "pa-reflect"; mirror.alt = ""; mirror.draggable = false; mirror.src = art ? art.src : ""; (art ? art.parentNode : el).insertBefore(mirror, art ? art.nextSibling : null); }
    { const art = el.querySelector("img"); if (art && mirror.src !== art.src) mirror.src = art.src; }
    const mask = reflectMask(part, rf) + (fade ? ", " + fade : "");
    mirror.style.top = `calc(100% + ${rf.g}%)`;
    mirror.style.transform = `scale(${part.f ? -1 : 1},${part.v ? 1 : -1})`;
    mirror.style.opacity = String(partOpacity(part)*rf.o); mirror.style.filter = blur || "none";
    if (mirror.dataset.mask !== mask){ mirror.dataset.mask = mask; mirror.style.webkitMaskImage = mask; mirror.style.maskImage = mask; }
  }
  function updateStickerElements(){
    const item = selected(); if (!item) return;
    const solo = picked.size === 1, stageLayer = root.querySelector(".pa-layer"), stageWidth = stageLayer ? stageLayer.clientWidth : 0;
    root.querySelectorAll(".pa-part").forEach(el => {
      const part = item.stickers.find(row => row.id === el.dataset.id); if (!part) return;
      el.style.left = part.x + "%"; el.style.top = part.y + "%"; el.style.width = part.w + "%";
      el.style.transform = `translate(-50%,-50%) rotate(${part.r}deg)`;
      el.style.setProperty("--pa-part-opacity", String(partOpacity(part)));
      el.style.setProperty("--pa-part-flip", part.f ? "-1" : "1");
      el.style.setProperty("--pa-part-flip-y", part.v ? "-1" : "1");
      const artRow = rowOf(part), artSrc = artRow ? partSvg(artRow, part) : "";
      { const img = el.querySelector("img"); if (img && artSrc && img.dataset.src !== artSrc){ img.dataset.src = artSrc; img.src = artSrc; } }
      const partPx = stageWidth*part.w/100, blur = blurFilter(part, partPx), dropShadow = shadowFilter(part, partPx);
      const art = el.querySelector("img"), mask = fadeMask(part), shadow = [blur, dropShadow === "none" ? "" : dropShadow].filter(Boolean).join(" ") || "none";
      if (art && art.dataset.shadow !== shadow){ art.dataset.shadow = shadow; art.style.filter = shadow; }
      paintReflection(el, part, mask, blur);
      const motion = el.querySelector(".pa-part-anim"), animation = partAnimation(part);
      if (motion){ const kind = animation ? animation.k : ""; if (motion.dataset.anim !== kind){ if (kind) motion.dataset.anim = kind; else delete motion.dataset.anim; } motion.style.setProperty("--pa-anim-dur", (animation ? animation.d : 1) + "s"); }
      if (art && art.dataset.mask !== mask){ art.dataset.mask = mask; art.style.webkitMaskImage = mask; art.style.maskImage = mask; }
      el.classList.toggle("selected", picked.has(part.id));
      el.classList.toggle("solo", solo && picked.has(part.id));
      el.classList.toggle("locked", !!part.l);
    });
    const parts = pickedParts(item), first = parts[0];
    root.querySelectorAll(".pa-adjust input[data-key]").forEach(input => { if (first && document.activeElement !== input) input.value = partValue(first,input.dataset.key); });
    syncSaveButton(item);
    const room = orderRoom(item);
    root.querySelectorAll("[data-order]").forEach(el => { el.disabled = !parts.length || !room[/^(front|forward)$/.test(el.dataset.order) ? "forward" : "backward"]; });
    const firstFade = first ? partFade(first) : null;
    root.querySelectorAll("[data-fade]").forEach(el => { const on = parts.length > 0 && (firstFade ? firstFade.d : "") === el.dataset.fade; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-fade-start]").forEach(el => { el.disabled = !firstFade; if (firstFade && document.activeElement !== el) el.value = firstFade.s; });
    const firstShadow = first ? partShadow(first) : null, firstPreset = first ? shadowPresetOf(first) : "";
    root.querySelectorAll("[data-shadow-preset]").forEach(el => { const on = parts.length > 0 && el.dataset.shadowPreset === firstPreset; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-shadow-key]").forEach(el => { el.disabled = !firstShadow; if (firstShadow && document.activeElement !== el) el.value = el.dataset.shadowKey === "c" ? firstShadow.c : firstShadow[el.dataset.shadowKey]*Number(el.dataset.scale || 1); });
    const firstReflect = first ? partReflect(first) : null;
    root.querySelectorAll("[data-reflect]").forEach(el => { const on = parts.length > 0 && (el.dataset.reflect === "on") === !!firstReflect; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-reflect-key]").forEach(el => { el.disabled = !firstReflect; if (firstReflect && document.activeElement !== el) el.value = firstReflect[el.dataset.reflectKey]*Number(el.dataset.scale || 1); });
    const firstOutline = first ? partOutline(first) : null;
    const outlinePreset = !firstOutline ? "" : firstOutline.c === "#ffffff" ? "white" : firstOutline.c === "#1f2937" ? "black" : "color";
    root.querySelectorAll("[data-outline]").forEach(el => { const on = parts.length > 0 && el.dataset.outline === outlinePreset; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-outline-key]").forEach(el => { el.disabled = !firstOutline; if (firstOutline && document.activeElement !== el) el.value = firstOutline[el.dataset.outlineKey]; });
    root.querySelectorAll("[data-blur]").forEach(el => { if (first && document.activeElement !== el) el.value = partBlur(first); });
    const firstColor = first ? partColor(first) : null;
    root.querySelectorAll("[data-tint]").forEach(el => { const on = parts.length > 0 && (el.dataset.tint === "" ? !firstColor : !!(firstColor && firstColor.k > 0 && firstColor.t === el.dataset.tint)); el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-color-key]").forEach(el => {
      if (!first || document.activeElement === el) return;
      const now = firstColor || { h:0, s:1, b:1, t:"", k:.85 }, key = el.dataset.colorKey;
      el.value = key === "t" ? (now.t || "#ff70a6") : now[key]*Number(el.dataset.scale || 1);
    });
    const firstPattern = first ? partPattern(first) : null;
    root.querySelectorAll("[data-pattern]").forEach(el => { const on = parts.length > 0 && (firstPattern ? firstPattern.p : "") === el.dataset.pattern; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-pattern-key]").forEach(el => { el.disabled = !firstPattern; if (firstPattern && document.activeElement !== el) el.value = el.dataset.patternKey === "c" ? firstPattern.c : firstPattern[el.dataset.patternKey]*Number(el.dataset.scale || 1); });
    const firstMotion = first ? partAnimation(first) : null;
    root.querySelectorAll("[data-motion]").forEach(el => { const on = parts.length > 0 && (firstMotion ? firstMotion.k : "") === el.dataset.motion; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-motion-speed]").forEach(el => { el.disabled = !firstMotion; if (firstMotion && document.activeElement !== el) el.value = Math.round(firstMotion.s*100); });
    const firstSound = first ? partSound(first) : null;
    root.querySelectorAll("[data-sound]").forEach(el => { const on = parts.length > 0 && (firstSound ? firstSound.k : "") === el.dataset.sound; el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll("[data-sound-volume],[data-sound-listen]").forEach(el => { el.disabled = !firstSound; if (el.dataset.soundVolume && firstSound && document.activeElement !== el) el.value = Math.round(firstSound.v*100); });
    root.querySelectorAll("[data-sound-readout]").forEach(el => { el.textContent = firstSound ? Math.round(firstSound.v*100) + "%" : ""; });
    const badges = !first ? {} : {
      sound:firstSound ? SOUNDS.find(row => row[0] === firstSound.k)[1] + (partAnimation(first) ? "" : " (움직임 없음)") : "",
      motion:firstMotion ? ANIMATIONS.find(row => row[0] === firstMotion.k)[1] : "",
      pattern:firstPattern ? PATTERNS.find(row => row[0] === firstPattern.p)[1] : "없음",
      color:!firstColor ? "원래 색" : firstColor.t && firstColor.k > 0 ? (TINTS.find(row => row[0] === firstColor.t) || ["","물들임"])[1] : "바뀜",
      blur:partBlur(first) ? partBlur(first) + "%" : "없음",
      fade:firstFade ? (FADES.find(row => row[0] === firstFade.d) || ["","","?"])[2] + " " + firstFade.s + "%" : "없음",
      shadow:!firstShadow ? "없음" : ((SHADOW_PRESETS.find(row => row[0] === firstPreset) || [])[1] || "직접"),
      reflect:firstReflect ? "켜짐" : "없음",
      outline:!firstOutline ? "없음" : ((OUTLINE_PRESETS.find(row => row[0] === outlinePreset) || [])[1] || "켜짐"),
      place:parts.length > 1 ? pickedUnits(item).length + "덩어리" : ""
    };
    root.querySelectorAll("[data-badge]").forEach(el => { const text = badges[el.dataset.badge] || ""; el.textContent = text; el.classList.toggle("on", !!text && text !== "없음"); });
    root.querySelectorAll("[data-flip]").forEach(el => { const on = parts.length > 0 && parts.every(part => part[el.dataset.flip]); el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on)); });
    const oneGroup = pickedIsOneGroup(item), hasGroup = pickedHasGroup(item);
    root.querySelectorAll("[data-group-action]").forEach(el => {
      const action = el.dataset.groupAction;
      if (action === "join") el.disabled = parts.length < 2 || oneGroup;
      else if (action === "split") el.disabled = !hasGroup;
      else {
        el.hidden = parts.length < 2 && !hasGroup; el.disabled = !oneGroup && parts.length < 2;
        el.classList.toggle("active", oneGroup); el.title = oneGroup ? "묶음 풀기 (Ctrl+Shift+G)" : "한 묶음으로 묶기 (Ctrl+G)";
      }
    });
    const unitCount = pickedUnits(item).length;
    root.querySelectorAll("[data-size-match]").forEach(el => { el.disabled = unitCount < 2; });
    root.querySelectorAll("[data-align]").forEach(el => { el.disabled = !unitCount || (/^spread/.test(el.dataset.align) && unitCount < 3); });
    const groupBoxEl = root.querySelector(".pa-group-box"); if (groupBoxEl) groupBoxEl.classList.toggle("is-group", oneGroup);
    syncSfxMaster(item);
    placePartBar(parts);
  }
  // 장식들을 감싸는 화면 상자(돌린 모양까지 감싼 축 정렬 상자). W·H 는 사진 면의 크기다.
  function partsBox(parts, W, H){
    if (!parts.length) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const part of parts){
      const w = W*part.w/100, h = w*105/120, rad = part.r*Math.PI/180;
      const hw = (Math.abs(w*Math.cos(rad)) + Math.abs(h*Math.sin(rad))) / 2, hh = (Math.abs(w*Math.sin(rad)) + Math.abs(h*Math.cos(rad))) / 2;
      const cx = W*part.x/100, cy = H*part.y/100;
      l = Math.min(l, cx - hw); r = Math.max(r, cx + hw); t = Math.min(t, cy - hh); b = Math.max(b, cy + hh);
    }
    return { l, t, r, b, cx:(l + r) / 2, cy:(t + b) / 2 };
  }
  // 고른 장식(들) 바로 아래(아래 공간이 없으면 위)에 투명도 막대를 띄우고, 여럿이면 묶음 틀을 씌운다. 막대·틀은 돌지 않는다.
  function placePartBar(parts){
    const bar = root.querySelector(".pa-part-bar"), group = root.querySelector(".pa-group-box"), layer = root.querySelector(".pa-layer");
    if (!bar || !layer) return;
    const width = layer.clientWidth, height = layer.clientHeight, box = partsBox(parts || [], width, height);
    if (group){
      group.hidden = !box || parts.length < 2 || viewing;
      if (!group.hidden){ group.style.left = box.l + "px"; group.style.top = box.t + "px"; group.style.width = (box.r - box.l) + "px"; group.style.height = (box.b - box.t) + "px"; }
    }
    if (!box || viewing){ bar.hidden = true; return; }
    bar.hidden = false;
    const range = bar.querySelector("input"), value = bar.querySelector(".pa-part-bar-value");
    if (document.activeElement !== range) range.value = partValue(parts[0],"o");
    value.textContent = partValue(parts[0],"o") + "%";
    const barHeight = bar.offsetHeight || 32, gap = 16;
    const below = box.b + gap + barHeight <= height + 40;
    bar.style.left = Math.max(bar.offsetWidth/2, Math.min(width - bar.offsetWidth/2, box.cx)) + "px";
    bar.style.top = (below ? box.b + gap : box.t - gap - barHeight - 26) + "px";
  }
  // 고른 장식들을 한 점(center, 화면 좌표)을 중심으로 scale 배 키우고 angle 도 돌린다.
  // 화면 좌표에서 계산해야 가로세로 비율이 다른 사진에서도 모양이 찌그러지지 않는다.
  function transformParts(starts, rect, center, scale, angle){
    let lo = 0, hi = Infinity;
    starts.forEach(start => { lo = Math.max(lo, PART_MIN_W / start.w); hi = Math.min(hi, PART_MAX_W / start.w); });
    const s = lo <= hi ? Math.max(lo, Math.min(hi, scale)) : 1, rad = angle*Math.PI/180, cos = Math.cos(rad), sin = Math.sin(rad);
    starts.forEach(start => {
      const px = rect.left + rect.width*start.x/100 - center.x, py = rect.top + rect.height*start.y/100 - center.y;
      const nx = center.x + s*(px*cos - py*sin), ny = center.y + s*(px*sin + py*cos);
      start.part.x = Math.max(0, Math.min(100, (nx - rect.left)/rect.width*100));
      start.part.y = Math.max(0, Math.min(100, (ny - rect.top)/rect.height*100));
      start.part.w = Math.round(start.w*s*10)/10;
      setPartValue(start.part,"r",Math.round(start.r + angle));
    });
  }
  const partStarts = parts => parts.map(part => ({ part, x:part.x, y:part.y, w:part.w, r:part.r }));
  function groupCenter(parts, rect){
    const box = partsBox(parts, rect.width, rect.height);
    return { x:rect.left + box.cx, y:rect.top + box.cy };
  }
  // 모서리 점=크기, 둥근 점=회전. 하나면 그 장식 중심, 여럿이면 묶음 틀 중심을 기준으로 함께 바꾼다.
  function partHandleDrag(event, parts, item, surface, mode){
    event.preventDefault(); event.stopPropagation(); releaseFieldFocus();
    if (!parts.length) return;
    const handle = event.currentTarget; handle.setPointerCapture(event.pointerId);
    const rect = surface.getBoundingClientRect(), starts = partStarts(parts), center = groupCenter(parts, rect);
    const startDist = Math.max(1, Math.hypot(event.clientX-center.x, event.clientY-center.y));
    const startAngle = Math.atan2(event.clientY-center.y, event.clientX-center.x)*180/Math.PI;
    const move = next => {
      if (mode === "resize") transformParts(starts, rect, center, Math.hypot(next.clientX-center.x, next.clientY-center.y)/startDist, 0);
      else {
        let angle = Math.atan2(next.clientY-center.y, next.clientX-center.x)*180/Math.PI - startAngle;
        // 하나일 땐 장식 각도 자체를, 여럿일 땐 돌린 양을 15°에 맞춘다.
        if (next.shiftKey) angle = starts.length === 1 ? Math.round((starts[0].r + angle)/15)*15 - starts[0].r : Math.round(angle/15)*15;
        transformParts(starts, rect, center, 1, angle);
      }
      updateStickerElements();
    };
    const end = () => { handle.removeEventListener("pointermove",move); handle.removeEventListener("pointerup",end); handle.removeEventListener("pointercancel",end); save(item); };
    handle.addEventListener("pointermove",move); handle.addEventListener("pointerup",end); handle.addEventListener("pointercancel",end);
  }
  // 휠·방향키처럼 잇달아 오는 조절은 멈춘 뒤 한 번만 저장한다(되돌리기도 한 단계).
  let pendingSaveTimer = 0;
  const saveSoon = item => { clearTimeout(pendingSaveTimer); pendingSaveTimer = setTimeout(() => save(item), 350); };
  // 사진 위 장식을 잡으면 막대 입력칸에서 포커스를 떼야 방향키가 막대 대신 장식을 움직인다.
  const releaseFieldFocus = () => { const active = document.activeElement; if (active && root && root.contains(active) && active.matches("input,select,textarea")) active.blur(); };
  function partWheel(event, part, item, surface){
    if (viewing || !picked.has(part.id)) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1, parts = pickedParts(item);
    if (parts.length > 1){
      const rect = surface.getBoundingClientRect();
      transformParts(partStarts(parts), rect, groupCenter(parts, rect), event.shiftKey ? 1 : Math.pow(1.06, step), event.shiftKey ? step*5 : 0);
    } else if (event.shiftKey) setPartValue(part,"r",part.r + step*5);
    else setPartValue(part,"w",Math.round((part.w + step*Math.max(1, part.w*.06))*10)/10);
    updateStickerElements();
    saveSoon(item);
  }
  function partBar(item){
    const bar = document.createElement("div"); bar.className = "pa-part-bar"; bar.hidden = true;
    bar.onpointerdown = event => event.stopPropagation();
    const label = document.createElement("span"); label.textContent = "투명도";
    const range = document.createElement("input"); range.type = "range"; range.min = 10; range.max = 100; range.setAttribute("aria-label","장식 투명도");
    const value = document.createElement("span"); value.className = "pa-part-bar-value";
    range.oninput = () => { pickedParts(item).forEach(part => setPartValue(part,"o",Number(range.value))); updateStickerElements(); };
    range.onchange = () => save(item);
    const reset = button("↺", () => { if (!picked.size) return; resetParts(item); save(item); }, "pa-part-bar-button");
    reset.title = "회전·투명도·뒤집기 원래대로";
    const flips = FLIPS.map(([key,icon,label]) => {
      const flip = button(icon, () => { if (!picked.size) return; flipParts(item,key); save(item); }, "pa-part-bar-button");
      flip.dataset.flip = key; flip.title = label; return flip;
    });
    const duplicate = button("⧉", () => duplicateParts(item), "pa-part-bar-button");
    duplicate.title = "장식 복제";
    const remove = button("✕", () => removeParts(item), "pa-part-bar-button danger");
    remove.title = "장식 삭제";
    // 막대엔 한 칸씩만 두고, Shift 를 누르고 누르면 맨 앞/맨 뒤로 보낸다.
    const orders = [["forward","front","↑","앞으로 (Shift: 맨 앞으로)"],["backward","back","↓","뒤로 (Shift: 맨 뒤로)"]].map(([where,far,icon,label]) => {
      const move = button(icon, event => { if (picked.size) moveParts(item, event.shiftKey ? far : where); }, "pa-part-bar-button");
      move.dataset.order = where; move.title = label; return move;
    });
    const grouping = button("⛓", () => toggleGroup(item), "pa-part-bar-button"); grouping.dataset.groupAction = "toggle";
    bar.append(label,range,value,...flips,...orders,grouping,duplicate,reset,remove);
    return bar;
  }
  // 여럿을 골랐을 때 씌우는 틀. 틀 자체는 클릭을 통과시키고 손잡이만 잡힌다.
  function groupBox(item, surface){
    const box = document.createElement("div"); box.className = "pa-group-box"; box.hidden = true;
    ["nw","ne","se","sw"].forEach(corner => {
      const handle = document.createElement("span"); handle.className = "pa-handle pa-resize " + corner; handle.title = "끌어서 함께 크기 조절";
      handle.onpointerdown = event => { if (!viewing) partHandleDrag(event, pickedParts(item), item, surface, "resize"); };
      box.appendChild(handle);
    });
    const rotate = document.createElement("span"); rotate.className = "pa-handle pa-rotate"; rotate.title = "끌어서 함께 회전 (Shift: 15°씩)";
    rotate.onpointerdown = event => { if (!viewing) partHandleDrag(event, pickedParts(item), item, surface, "rotate"); };
    box.appendChild(rotate);
    return box;
  }
  // 빈 곳을 끌면 사각형에 닿은 장식을 고른다. Shift·Ctrl 을 누르고 끌면 지금 고른 것에 더한다. 끌지 않고 누르기만 하면 선택을 푼다.
  function startMarquee(event, item, surface, layer){
    if (event.button !== 0) return;
    const add = event.shiftKey || event.ctrlKey || event.metaKey, before = add ? new Set(picked) : new Set();
    const rect = surface.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
    let marquee = null;
    surface.setPointerCapture(event.pointerId);
    const move = next => {
      if (!marquee && Math.hypot(next.clientX-startX, next.clientY-startY) < 4) return;
      if (!marquee){ marquee = document.createElement("div"); marquee.className = "pa-marquee"; layer.appendChild(marquee); }
      const l = Math.min(startX, next.clientX) - rect.left, r = Math.max(startX, next.clientX) - rect.left, t = Math.min(startY, next.clientY) - rect.top, b = Math.max(startY, next.clientY) - rect.top;
      marquee.style.left = l/rect.width*100 + "%"; marquee.style.top = t/rect.height*100 + "%"; marquee.style.width = (r - l)/rect.width*100 + "%"; marquee.style.height = (b - t)/rect.height*100 + "%";
      const hit = item.stickers.filter(part => { if (!pickable(part)) return false; const box = partsBox([part], rect.width, rect.height); return box.r >= l && box.l <= r && box.b >= t && box.t <= b; });
      picked = withGroups(item, [...before, ...hit.map(part => part.id)]); updateStickerElements();
    };
    const end = () => {
      surface.removeEventListener("pointermove",move); surface.removeEventListener("pointerup",end); surface.removeEventListener("pointercancel",end);
      if (marquee) marquee.remove(); else if (!add) picked = new Set();
      refreshPicked();
    };
    surface.addEventListener("pointermove",move); surface.addEventListener("pointerup",end); surface.addEventListener("pointercancel",end);
  }
  function fitArtboard(){
    if (!root) return; const board = root.querySelector(".pa-stage .pa-artboard"), stage = root.querySelector(".pa-stage"); if (!board || !stage) return;
    const ratio = Number(board.dataset.ratio) || 1;
    const pad = parseFloat(getComputedStyle(board).paddingLeft) || 0;
    // 꾸미기 모드는 아래 이름 줄 자리를 비워 두고, 감상 모드는 사진이 무대를 거의 다 채운다.
    const spareX = viewing ? 24 : 54, spareY = viewing ? 24 : 114;
    const width = Math.max(100, Math.min(stage.clientWidth - spareX, (stage.clientHeight - spareY - 2*pad) * ratio + 2*pad));
    board.style.width = width + "px"; board.style.height = ((width - 2*pad) / ratio + 2*pad) + "px";
    updateStickerElements();
  }
  function paintStage(){
    if (stageUrl) URL.revokeObjectURL(stageUrl); stageUrl = null;
    const host = root.querySelector(".pa-stage"); if (!host) return; host.replaceChildren(); const item = selected(); trackHistory(item);
    if (!item){
      const empty = document.createElement("div"); empty.className = "pa-empty";
      const icon = document.createElement("span"); icon.textContent = "▧";
      const title = document.createElement("h3"); title.textContent = "추억을 담을 첫 장을 골라보세요";
      const desc = document.createElement("p"); desc.textContent = "사진과 영상을 가져와 나만의 사진첩을 만들 수 있습니다.";
      empty.append(icon,title,desc,button("사진·영상 가져오기", () => root.querySelector(".pa-input").click(), "primary")); host.appendChild(empty); return;
    }
    if (!item.blob){
      host.textContent = "원본 파일을 불러오는 중…";
      getBlob(item).then(() => { if (root && selectedId === item.id) paintStage(); })
        .catch(error => { console.error(error); if (root && selectedId === item.id) host.textContent = "원본 파일을 불러오지 못했습니다."; });
      return;
    }
    stageUrl = URL.createObjectURL(item.blob);
    if (item.type === "video"){
      const wrap = document.createElement("div"); wrap.className = "pa-video-wrap";
      const video = document.createElement("video"); video.src = stageUrl; video.poster = item.thumbnail || ""; video.controls = true; video.preload = "metadata"; video.playsInline = true;
      const play = button("▶", async () => { play.remove(); try { await video.play(); } catch(error){ console.warn(error); } }, "pa-play");
      video.onplay = () => play.remove(); wrap.append(video,play); host.appendChild(wrap);
    } else {
      const board = document.createElement("div"); board.className = "pa-artboard"; board.dataset.ratio = item.width / item.height || 1; board.style.aspectRatio = String(board.dataset.ratio); board.style.background = background(bgById(item.background));
      const surface = document.createElement("div"); surface.className = "pa-photo-surface";
      const img = document.createElement("img"); img.src = stageUrl; img.alt = item.name; img.draggable = false;
      const layer = document.createElement("div"); layer.className = "pa-layer"; surface.append(img,layer); board.appendChild(surface); host.appendChild(board);
      (item.stickers || []).forEach(part => {
        const row = rowOf(part); if (!row || part.h) return;
        // 키보드로 누를 때(detail 0)만 click 으로 고른다. 마우스 선택은 pointerdown 이 맡는다(Shift·Ctrl 토글을 덮어쓰지 않게).
        const control = button("", event => { if (event.detail === 0){ picked = withGroups(item, [part.id]); refreshPicked(); } }, "pa-part"); control.dataset.id = part.id; control.setAttribute("aria-label", row[2] + " 이동");
        const image = document.createElement("img"); image.src = partSvg(row, part); image.dataset.src = image.src; image.alt = ""; image.draggable = false;
        // 움직임은 그림을 감싼 안쪽 칸에만 준다(자리·회전·손잡이를 가진 바깥 칸은 가만히 있어 끌기·손잡이가 흔들리지 않는다).
        const motion = document.createElement("div"); motion.className = "pa-part-anim"; motion.appendChild(image); control.appendChild(motion);
        ["nw","ne","se","sw"].forEach(corner => {
          const handle = document.createElement("span"); handle.className = "pa-handle pa-resize " + corner; handle.title = "끌어서 크기 조절";
          handle.onpointerdown = event => { if (!viewing) partHandleDrag(event, [part], item, surface, "resize"); };
          control.appendChild(handle);
        });
        const rotate = document.createElement("span"); rotate.className = "pa-handle pa-rotate"; rotate.title = "끌어서 회전 (Shift: 15°씩)";
        rotate.onpointerdown = event => { if (!viewing) partHandleDrag(event, [part], item, surface, "rotate"); };
        control.appendChild(rotate);
        control.addEventListener("wheel", event => partWheel(event, part, item, surface), { passive:false });
        // 글자 장식을 두 번 누르면 글자 칸으로 가서 바로 고친다.
        control.ondblclick = () => {
          if (viewing || !part.tx) return;
          const details = root.querySelector('.pa-section[data-section="text"]'); if (details) details.open = true;
          const area = root.querySelector(".pa-text-input"); if (area){ area.focus(); area.select(); }
        };
        control.onpointerdown = event => {
          if (viewing || event.button !== 0) return; event.preventDefault(); releaseFieldFocus();
          // Shift·Ctrl+클릭은 고른 것에 넣거나 빼기만 한다.
          if (event.shiftKey || event.ctrlKey || event.metaKey){
            const members = groupMembers(item, part), on = !picked.has(part.id);
            picked = new Set(picked); members.forEach(id => on ? picked.add(id) : picked.delete(id));
            refreshPicked(); return;
          }
          // 이미 고른 묶음 안의 장식을 잡으면 묶음째 옮기고, 끌지 않고 떼면 그 장식 하나만 고른다.
          const wasPicked = picked.has(part.id);
          if (!wasPicked){ picked = withGroups(item, [part.id]); refreshPicked(); }
          control.setPointerCapture(event.pointerId);
          const rect = surface.getBoundingClientRect(), startX = event.clientX, startY = event.clientY, starts = partStarts(pickedParts(item));
          let moved = false;
          const snapTargets = snapLines(item, layer.clientWidth, layer.clientHeight), startBox = partsBox(starts.map(start => start.part), layer.clientWidth, layer.clientHeight);
          const move = next => {
            let dx = (next.clientX-startX)/rect.width*100, dy = (next.clientY-startY)/rect.height*100;
            if (!moved && Math.hypot(next.clientX-startX, next.clientY-startY) < 2) return;
            moved = true;
            // 자석: 옮기는 상자의 가장자리·가운데가 다른 장식이나 사진의 선 가까이 오면 딱 붙인다(Alt 를 누르면 잠시 끔).
            const snap = snapEnabled() && !next.altKey && startBox ? snapOffset(startBox, dx/100*layer.clientWidth, dy/100*layer.clientHeight, snapTargets) : null;
            if (snap){ dx += snap.x/layer.clientWidth*100; dy += snap.y/layer.clientHeight*100; }
            showSnapGuides(layer, snap);
            starts.forEach(start => { start.part.x = Math.max(0,Math.min(100,start.x + dx)); start.part.y = Math.max(0,Math.min(100,start.y + dy)); });
            updateStickerElements();
          };
          const end = () => {
            showSnapGuides(layer, null);
            control.removeEventListener("pointermove",move); control.removeEventListener("pointerup",end); control.removeEventListener("pointercancel",end);
            if (moved) save(item);
            else if (wasPicked && picked.size > 1){ const only = withGroups(item, [part.id]); if (only.size !== picked.size){ picked = only; refreshPicked(); } }
          };
          control.addEventListener("pointermove",move); control.addEventListener("pointerup",end); control.addEventListener("pointercancel",end);
        };
        layer.appendChild(control);
      });
      layer.appendChild(groupBox(item, surface));
      layer.appendChild(partBar(item));
      // 장식 밖 사진을 누르고 끌면 사각형으로 여러 개를 고르고, 누르기만 하면 선택을 푼다.
      surface.addEventListener("pointerdown", event => {
        if (viewing || event.target.closest(".pa-part,.pa-part-bar,.pa-group-box")) return;
        event.preventDefault(); releaseFieldFocus(); startMarquee(event, item, surface, layer);
      });
      stageStartedAt = performance.now(); if (viewing) syncSfx();
      updateStickerElements(); requestAnimationFrame(fitArtboard);
    }
    const caption = document.createElement("div"); caption.className = "pa-caption";
    const name = document.createElement("strong"); name.textContent = item.name;
    const actions = document.createElement("div"); actions.className = "pa-caption-actions";
    // 캡션 줄 단추는 그림만 두고 이름은 title·aria-label 로 전한다.
    const fav = iconButton("heart", item.favorite ? "즐겨찾기 해제" : "즐겨찾기", () => { item.favorite = !item.favorite; save(item); paintList(); paintStage(); }, "pa-ico pa-fav" + (item.favorite ? " on" : ""));
    fav.setAttribute("aria-pressed", item.favorite ? "true" : "false"); actions.appendChild(fav);
    if (item.type === "image"){
      closeSaveMenu();
      // 저장 단추는 하나. 움직이는 장식이 없으면 바로 PNG, 있으면 PNG·GIF·MP4 를 고르는 메뉴를 연다.
      const saveBtn = iconButton("save", "저장", event => { if (hasMotion(item)) toggleSaveMenu(item, event.currentTarget); else exportImage(item); }, "primary pa-ico pa-save");
      saveBtn.insertAdjacentHTML("beforeend", '<span class="pa-save-caret" aria-hidden="true">' + uiIconHtml("chevronDown", "▾") + '</span>');
      actions.appendChild(saveBtn); syncSaveButton(item);
    }
    actions.appendChild(iconButton("delete", "삭제", async () => {
      if (!await confirmDialog("사진첩에서 이 항목을 삭제할까요?", "삭제", "취소")) return;
      try { await deleteItem(item); if (musicSession && musicSession.item === item) stopMusic(); records = records.filter(row => row.id !== item.id); for (const track of musicTracks(item.music)) await dropAudioRecord(track.id); selectedId = records[0] && records[0].id; picked = new Set(); paintList(); paintStage(); paintBackgrounds(); paintAdjust(); }
      catch(error){ console.error(error); notice("항목을 삭제하지 못했습니다."); }
    }, "pa-ico pa-delete"));
    caption.append(name,actions); host.appendChild(caption);
  }
  async function dimensions(blob){ const image = await createImageBitmap(blob); const size = { width:image.width, height:image.height }; image.close(); return size; }
  async function imageThumbnail(blob){
    const image = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 280 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", .72);
    } finally { image.close(); }
  }
  async function videoThumbnail(blob){
    const url = URL.createObjectURL(blob);
    try { return await new Promise(resolve => {
      const video = document.createElement("video"); video.muted = true; video.preload = "auto"; video.src = url;
      const timeout = setTimeout(() => resolve(null), 6000);
      const capture = () => { clearTimeout(timeout); try { const canvas = document.createElement("canvas"); canvas.width = 280; canvas.height = Math.max(120,Math.round(280*video.videoHeight/video.videoWidth)); canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height); resolve(canvas.toDataURL("image/jpeg",.7)); } catch(error){ resolve(null); } };
      video.onloadeddata = () => { if (video.duration > .2) video.currentTime = Math.min(.25,video.duration/2); else capture(); };
      video.onseeked = capture; video.onerror = () => { clearTimeout(timeout); resolve(null); };
    }); } finally { URL.revokeObjectURL(url); }
  }
  // 가져온 파일의 갈래. 파일 종류(mime)를 먼저 보고, 없으면 확장자로 본다(음악 .webm 이 영상으로 잡히지 않게 mime 이 우선).
  function droppedMediaType(file){
    const mime = String(file && file.type || "").toLowerCase();
    const name = String(file && file.name || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (/\.(?:jpe?g|png|gif|webp|bmp|avif|svg)$/.test(name)) return "image";
    if (/\.(?:mp4|webm|mov|m4v|ogv)$/.test(name)) return "video";
    if (/\.(?:mp3|m4a|aac|wav|ogg|oga|flac|opus)$/.test(name)) return "audio";
    return null;
  }
  // 사진·영상은 사진첩에 더하고, 음악 파일은 지금 고른 사진의 배경음악 재생목록에 더한다
  // (고른 사진이 없으면 이번에 함께 가져온 첫 사진에).
  async function importFiles(fileList){
    const all = Array.from(fileList || []).map(file => ({ file, type:droppedMediaType(file) })).filter(entry => entry.type);
    const songs = all.filter(entry => entry.type === "audio").map(entry => entry.file), files = all.filter(entry => entry.type !== "audio");
    if (!all.length){ notice("사진·영상·음악 파일을 선택해 주세요."); return; }
    if (!files.length){ await importSongs(songs, null); return; }
    status(files.length + "개 파일을 가져오는 중…"); let count = 0;
    for (const {file,type} of files){
      const item = { id:crypto.randomUUID(), name:file.name, type, mime:file.type, blob:file, favorite:false, background:"white", stickers:[], created:Date.now() + count };
      try { if (type === "image"){ Object.assign(item,await dimensions(file)); item.thumbnail = await imageThumbnail(file); }
        else item.thumbnail = await videoThumbnail(file);
        await persistNew(item); records.unshift(item); if (!selectedId) selectedId = item.id; count++;
      } catch(error){ console.error(error); notice(error && error.message === "photo-album-file-too-large"
        ? file.name + " 파일은 256MB를 넘어 가져올 수 없습니다."
        : file.name + " 파일을 가져오지 못했습니다."); }
    }
    paintList(); paintStage(); paintBackgrounds(); paintAdjust(); status(count + "개 파일을 저장했습니다.");
    if (songs.length) await importSongs(songs, records.find(item => item.type === "image" && files.some(entry => entry.file === item.blob)));
  }
  async function importSongs(songs, fallback){
    const current = selected(), target = musicScope === "album" && current && current.type === "image" ? albumItem : current && current.type === "image" ? current : fallback;
    if (!target){ notice("배경음악은 사진에 붙습니다. 사진을 먼저 고른 뒤 음악 파일을 넣어 주세요."); return; }
    await importMusic(target, songs);
  }
  // 움직이는 장식을 한 장면씩 그리는 무대(GIF·MP4 공용). 긴 변을 maxSide 로 줄이고, even 이면 가로세로를 짝수로(H.264 조건) 맞춘다.
  async function motionScene(item, maxSide, even){
    const image = await createImageBitmap(await getBlob(item));
    try {
      const scale = Math.min(1, maxSide/Math.max(image.width, image.height)), photoWidth = Math.round(image.width*scale), photoHeight = Math.round(image.height*scale);
      const edge = Math.round(Math.max(photoWidth, photoHeight)*.07), canvas = document.createElement("canvas");
      canvas.width = photoWidth + edge*2; canvas.height = photoHeight + edge*2;
      if (even){ canvas.width -= canvas.width % 2; canvas.height -= canvas.height % 2; }
      const ctx = canvas.getContext("2d", { willReadFrequently:!even }), bg = bgById(item.background), gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, bg[2]); gradient.addColorStop(1, bg[3]);
      const pieces = [];
      for (const part of item.stickers){
        const row = rowOf(part); if (!row || part.h) continue;
        const sticker = new Image(); sticker.src = partSvg(row, part); await sticker.decode();
        const width = photoWidth*part.w/100, height = width*105/120;
        pieces.push({ part, sticker, width, height, prepared:prepareSticker(sticker, part, width, height) });
      }
      // 사진은 한 번만 줄여 그려 두고(장면마다 큰 사진을 다시 줄이지 않게) 장식만 그때그때 그린다.
      const photo = document.createElement("canvas"); photo.width = photoWidth; photo.height = photoHeight; photo.getContext("2d").drawImage(image, 0, 0, photoWidth, photoHeight);
      const moving = pieces.filter(piece => partAnimation(piece.part));
      return {
        canvas, ctx, length:loopLength(moving.map(piece => partAnimation(piece.part).d)),
        draw(time){
          ctx.save(); ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(photo, edge, edge); ctx.restore();
          pieces.forEach(({ part, sticker, width, height, prepared }) => drawStickerOnCanvas(ctx, sticker, part, edge + photoWidth*part.x/100, edge + photoHeight*part.y/100, width, height, animationPose(part, time), prepared));
        }
      };
    } finally { image.close(); }
  }
  const hasMotion = item => (item.stickers || []).some(part => !part.h && partAnimation(part) && rowOf(part));
  // 움직임이 생기거나 없어지면 ▾ 와 풀이만 바꾼다(장식을 고칠 때마다 updateStickerElements 가 부른다).
  function syncSaveButton(item){
    const btn = root && root.querySelector(".pa-save"); if (!btn) return;
    const motion = hasMotion(item);
    btn.classList.toggle("has-menu", motion);
    btn.title = motion ? "사진(PNG)·움직이는 그림(GIF)·영상(MP4) 중에서 골라 저장합니다" : "꾸민 사진을 PNG로 저장합니다";
    btn.setAttribute("aria-label", btn.title);
    if (motion) btn.setAttribute("aria-haspopup", "menu"); else { btn.removeAttribute("aria-haspopup"); closeSaveMenu(); }
  }
  let saveMenu = null;
  function closeSaveMenu(){
    if (!saveMenu) return;
    saveMenu.cleanup(); saveMenu.el.remove(); saveMenu.btn.setAttribute("aria-expanded", "false"); saveMenu = null;
  }
  function toggleSaveMenu(item, btn){
    if (saveMenu){ const same = saveMenu.btn === btn; closeSaveMenu(); if (same) return; }
    const menu = document.createElement("div"); menu.className = "pa-save-menu"; menu.setAttribute("role", "menu");
    [
      ["사진(PNG)", "지금 보이는 한 장면", () => exportImage(item)],
      ["움직이는 그림(GIF)", "어디서나 열리는 짧은 움직임", () => exportGif(item)],
      ["영상(MP4)", "GIF 보다 색이 곱고 부드럽습니다", () => exportMp4(item)]
    ].forEach(([label, hint, run]) => {
      const row = document.createElement("button"); row.type = "button"; row.setAttribute("role", "menuitem");
      const strong = document.createElement("strong"); strong.textContent = label;
      const small = document.createElement("small"); small.textContent = hint;
      row.append(strong, small); row.onclick = () => { closeSaveMenu(); run(); };
      menu.appendChild(row);
    });
    root.appendChild(menu);
    // 단추가 바닥 줄에 있으므로 보통 위로 연다. 위 자리가 모자랄 때만 아래로.
    const rect = btn.getBoundingClientRect(), height = menu.offsetHeight, width = menu.offsetWidth;
    const top = rect.top - height - 6 >= 8 ? rect.top - height - 6 : rect.bottom + 6;
    menu.style.top = Math.round(top) + "px";
    menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))) + "px";
    const onDown = event => { if (!menu.contains(event.target) && !btn.contains(event.target)) closeSaveMenu(); };
    const onKey = event => { if (event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); closeSaveMenu(); btn.focus(); } };
    document.addEventListener("pointerdown", onDown, true); window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeSaveMenu);
    saveMenu = { el:menu, btn, cleanup(){ document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", closeSaveMenu); } };
    btn.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("button"); if (first) first.focus();
  }
  function download(bytes, type, name){
    const url = URL.createObjectURL(new Blob([bytes], { type })), link = document.createElement("a");
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const baseName = item => item.name.replace(/\.[^.]+$/, "");
  // 움직이는 GIF 저장. 256색이라 긴 변을 640px 로 줄이고, 움직임이 이어지게 되풀이되는 길이만큼 초당 약 14장을 그린다.
  let motionBusy = false;
  async function exportGif(item){
    if (!hasMotion(item)){ notice("움직이는 장식이 없습니다. 효과 → 움직임에서 움직임을 준 뒤 저장하세요."); return; }
    if (motionBusy || typeof MNGifEncoder === "undefined") return;
    motionBusy = true;
    try {
      status("GIF 만드는 중… 0%");
      const scene = await motionScene(item, 640, false), length = scene.length;
      const count = Math.min(90, Math.max(2, Math.round(length*1000/70))), delay = length*1000/count, frames = [];
      for (let i = 0; i < count; i++){
        scene.draw(i*length/count); frames.push(scene.ctx.getImageData(0, 0, scene.canvas.width, scene.canvas.height));
        if (i % 6 === 0){ status(`GIF 만드는 중… ${Math.round((i + 1)/count*40)}%`); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      const bytes = await MNGifEncoder.encode(frames, { delay, onProgress:done => status(`GIF 만드는 중… ${40 + Math.round(done*60)}%`) });
      download(bytes, "image/gif", baseName(item) + "-움직이는.gif");
      notice(`움직이는 GIF를 저장했습니다 (${length}초, ${count}장).`);
    } catch(error){ console.error(error); notice("GIF를 만들지 못했습니다."); }
    finally { motionBusy = false; }
  }
  // MP4 저장: 브라우저 안의 H.264 부호기(WebCodecs)로 초당 30장을 굽고 mp4-writer.js 로 묶는다.
  // 움직임 한 바퀴를 되풀이해 6초 이상이 되게 한다. 이 부호기가 없는 브라우저면 알리고 GIF 를 권한다.
  const MP4_CODECS = ["avc1.42E028", "avc1.4D0028", "avc1.640028", "avc1.42E01F"];
  async function exportMp4(item){
    if (!hasMotion(item)){ notice("움직이는 장식이 없습니다. 효과 → 움직임에서 움직임을 준 뒤 저장하세요."); return; }
    if (motionBusy || typeof MNMp4Writer === "undefined") return;
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined"){ notice("이 브라우저는 영상 만들기를 지원하지 않습니다. GIF 저장을 써 주세요."); return; }
    motionBusy = true;
    let encoder = null;
    try {
      status("영상 만드는 중… 0%");
      const scene = await motionScene(item, 1280, true), { width, height } = scene.canvas, fps = 30;
      const loops = Math.max(1, Math.ceil(6/scene.length)), total = Math.round(scene.length*loops*fps);
      // 되도록 B 프레임이 없는 Baseline 부터. 해상도가 레벨 한도를 넘으면 다음 설정을 본다.
      let config = null;
      for (const codec of MP4_CODECS){
        const candidate = { codec, width, height, framerate:fps, bitrate:Math.round(Math.min(8e6, Math.max(2e6, width*height*6))), latencyMode:"quality", avc:{ format:"avc" } };
        try { if ((await VideoEncoder.isConfigSupported(candidate)).supported){ config = candidate; break; } } catch { /* 다음 설정 */ }
      }
      if (!config){ notice("이 컴퓨터에서 MP4(H.264) 영상을 만들 수 없습니다. GIF 저장을 써 주세요."); return; }
      const samples = []; let avcC = null, failure = null;
      encoder = new VideoEncoder({
        output:(chunk, meta) => {
          const description = meta && meta.decoderConfig && meta.decoderConfig.description;
          if (description && !avcC) avcC = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          samples.push({ data, key:chunk.type === "key", timestamp:chunk.timestamp });
        },
        error:error => { failure = error; }
      });
      encoder.configure(config);
      for (let i = 0; i < total && !failure; i++){
        scene.draw(i/fps);
        const frame = new VideoFrame(scene.canvas, { timestamp:Math.round(i*1e6/fps), duration:Math.round(1e6/fps) });
        encoder.encode(frame, { keyFrame:i % (fps*2) === 0 }); frame.close();
        // 부호기에 너무 많이 쌓이지 않게 기다리며, 틈틈이 화면에 진행률을 보인다.
        while (encoder.encodeQueueSize > 6 && !failure) await new Promise(resolve => setTimeout(resolve, 5));
        if (i % 10 === 0){ status(`영상 만드는 중… ${Math.round((i + 1)/total*95)}%`); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      if (failure) throw failure;
      await encoder.flush();
      if (failure) throw failure;
      let audio = null, soundNote = "";
      if (musicSource(item) || soundParts(item).length){
        status("영상 만드는 중… 소리 넣는 중");
        try { audio = await encodeMusic(item, total/fps); } catch(error){ console.warn("배경음악을 영상에 넣지 못했습니다:", error); }
        if (!audio) soundNote = " 이 컴퓨터에서는 소리를 넣지 못해 소리 없이 저장했습니다.";
      }
      const bytes = MNMp4Writer.mux({ width, height, fps, samples, avcC, audio });
      download(bytes, "video/mp4", baseName(item) + "-움직이는.mp4");
      notice(`움직이는 영상(MP4)을 저장했습니다 (${Math.round(total/fps*10)/10}초, ${width}×${height}${audio ? ", 배경음악 포함" : ""}).${soundNote}`);
    } catch(error){ console.error(error); notice("MP4 영상을 만들지 못했습니다. GIF 저장을 써 주세요."); }
    finally { if (encoder && encoder.state !== "closed") try { encoder.close(); } catch { /* 이미 닫힘 */ } motionBusy = false; }
  }
  async function exportImage(item){
    try {
      const media = await getBlob(item);
      const image = await createImageBitmap(media), edge = Math.round(Math.max(image.width,image.height)*.07);
      const canvas = document.createElement("canvas"); canvas.width = image.width+edge*2; canvas.height = image.height+edge*2;
      const ctx = canvas.getContext("2d"), bg = bgById(item.background), gradient = ctx.createLinearGradient(0,0,canvas.width,canvas.height);
      gradient.addColorStop(0,bg[2]); gradient.addColorStop(1,bg[3]); ctx.fillStyle = gradient; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,edge,edge);
      for (const part of item.stickers){ const row = rowOf(part); if (!row || part.h) continue;
        const sticker = new Image(); sticker.src = partSvg(row, part); await sticker.decode(); const width = image.width*part.w/100, height = width*105/120;
        drawStickerOnCanvas(ctx, sticker, part, edge+image.width*part.x/100, edge+image.height*part.y/100, width, height);
      }
      image.close(); const blob = await new Promise(resolve => canvas.toBlob(resolve,"image/png")); if (!blob) throw new Error("PNG encoding failed");
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = item.name.replace(/\.[^.]+$/,"") + "-꾸미기.png";
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); notice("꾸민 사진을 PNG로 저장했습니다.");
    } catch(error){ console.error(error); notice("PNG를 만들지 못했습니다."); }
  }
  // 오른쪽 칸 탭(꾸미기·배경·음악). 고른 탭은 이 브라우저에만 기억한다. 사진 위 장식을 고르면 꾸미기 탭으로 넘어간다(조절 칸이 거기 있다).
  const TOOL_TAB_KEY = "classdock.photoAlbum.toolTab", TOOL_TABS = ["deco","bg","music"];
  function storedToolTab(){ try { const saved = localStorage.getItem(TOOL_TAB_KEY); return TOOL_TABS.includes(saved) ? saved : "deco"; } catch { return "deco"; } }
  function showToolTab(id){
    if (!root || !TOOL_TABS.includes(id)) return;
    root.querySelectorAll(".pa-tool-tab").forEach(tab => { const on = tab.dataset.tab === id; tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1; });
    root.querySelectorAll(".pa-tab-panel").forEach(panel => { panel.hidden = panel.dataset.tab !== id; });
    const tools = root.querySelector(".pa-tools"); if (tools) tools.dataset.tab = id;   // 고른 탭 쪽 카드 모서리를 펴서 탭과 잇는다
    try { localStorage.setItem(TOOL_TAB_KEY, id); } catch { /* 이번 화면에만 적용 */ }
  }
  function setupToolTabs(){
    const tabs = Array.from(root.querySelectorAll(".pa-tool-tab"));
    tabs.forEach((tab, index) => {
      tab.onclick = () => showToolTab(tab.dataset.tab);
      tab.onkeydown = event => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!step) return;
        event.preventDefault(); const next = tabs[(index + step + tabs.length) % tabs.length]; showToolTab(next.dataset.tab); next.focus();
      };
    });
    showToolTab(storedToolTab());
  }
  // 양쪽 칸 폭 조절 막대. 폭은 이 브라우저에 기억하고, 좁은 화면(900px 이하)에서는 CSS 의 고정 폭을 따른다.
  // 가운데 무대는 CENTER_MIN 보다 좁아지지 않게 막는다. 무대 크기가 바뀌면 ResizeObserver 가 사진을 다시 맞춘다.
  const PANES_KEY = "classdock.photoAlbum.paneWidths", PANE_LIMITS = { left:[140,340,190], right:[250,440,280] }, CENTER_MIN = 360;
  const narrowLayout = () => matchMedia("(max-width:900px)").matches;
  function storedPaneWidths(){
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(PANES_KEY) || "{}") || {}; } catch { /* 처음 폭 */ }
    const widths = {};
    Object.entries(PANE_LIMITS).forEach(([side, [min, max, initial]]) => { const value = Number(saved[side]); widths[side] = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : initial; });
    return widths;
  }
  function setupPaneSplitters(){
    const layout = root.querySelector(".pa-layout"), widths = storedPaneWidths();
    const apply = (side, width) => { widths[side] = Math.round(width); layout.style.setProperty(side === "left" ? "--pa-left-w" : "--pa-right-w", widths[side] + "px"); };
    const save = () => { try { localStorage.setItem(PANES_KEY, JSON.stringify(widths)); } catch { /* 이번 화면에만 적용 */ } };
    apply("left", widths.left); apply("right", widths.right);
    root.querySelectorAll(".pa-split").forEach(handle => {
      const side = handle.dataset.side, [min, max, initial] = PANE_LIMITS[side], dir = side === "left" ? 1 : -1;
      const pane = root.querySelector(side === "left" ? ".pa-sidebar" : ".pa-tools"), other = root.querySelector(side === "left" ? ".pa-tools" : ".pa-sidebar");
      handle.setAttribute("aria-valuemin", String(min)); handle.setAttribute("aria-valuemax", String(max)); handle.setAttribute("aria-valuenow", String(widths[side]));
      const set = width => {
        const room = layout.getBoundingClientRect().width - other.getBoundingClientRect().width - CENTER_MIN;
        apply(side, Math.max(min, Math.min(max, room, width))); handle.setAttribute("aria-valuenow", String(widths[side]));
      };
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || narrowLayout()) return;
        event.preventDefault(); handle.setPointerCapture(event.pointerId); handle.classList.add("dragging"); root.classList.add("pa-resizing");
        const startX = event.clientX, startWidth = pane.getBoundingClientRect().width;
        const move = ev => set(startWidth + dir*(ev.clientX - startX));
        const up = () => {
          handle.classList.remove("dragging"); root.classList.remove("pa-resizing");
          handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); save();
        };
        handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
      });
      handle.addEventListener("dblclick", () => { if (narrowLayout()) return; set(initial); save(); });
      handle.addEventListener("keydown", event => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!step || narrowLayout()) return;
        event.preventDefault(); set(pane.getBoundingClientRect().width + dir*step*(event.shiftKey ? 48 : 16)); save();
      });
    });
  }
  function makeUi(host){
    closeEffectPanel(); host.replaceChildren(); root = document.createElement("section"); root.className = "photo-album"; viewing = false; slideshow = false; clearTimeout(slideTimer);
    root.innerHTML = '<header class="pa-header"><div><span class="pa-kicker">MY MOMENTS</span><h2>사진첩</h2><p>사진을 꾸미고, 영상은 큰 화면에서 감상하세요.</p></div><div class="pa-header-actions"><button type="button" class="pa-view">▣ 감상 모드</button><button type="button" class="pa-import primary">＋ 가져오기</button></div></header><div class="pa-layout"><aside class="pa-sidebar"><button type="button" class="pa-fx-open" aria-haspopup="dialog" aria-expanded="false" title="감상 모드에서 사진을 넘길 때의 움직임을 고릅니다"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="12" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="9.5" y="5" width="12" height="14" rx="2" fill="currentColor" opacity=".35"/><path d="M13 12h6m-2.5-2.5L19 12l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span><small>넘기기 효과</small><b class="pa-fx-name">밀기</b></span></button><nav class="pa-filters" aria-label="사진첩 필터"></nav><div class="pa-list-title"><strong>내 미디어</strong><span class="pa-count"></span></div><div class="pa-list"></div></aside><div class="pa-center"><div class="pa-view-bar"><button type="button" class="pa-slide-toggle" aria-pressed="false" title="사진을 저절로 넘깁니다 (Space)">▶ 슬라이드쇼</button><select class="pa-slide-seconds" aria-label="슬라이드쇼 간격" title="사진 한 장을 보여 줄 시간 (영상은 끝까지 본 뒤 넘어갑니다)"></select><select class="pa-view-effect" aria-label="넘기기 효과" title="사진을 넘길 때의 움직임 (빠르기는 꾸미기 모드의 목록 위 넘기기 효과 단추에서)"></select><button type="button" class="pa-view-exit" title="꾸미기 모드로 돌아갑니다 (Esc) · ←/→ 로 사진 넘기기 · 사진을 두 번 누르면 전체화면">✎ 꾸미기 모드</button></div><div class="pa-stage"></div></div><aside class="pa-tools"><div class="pa-tool-tabs" role="tablist" aria-label="꾸미기 도구"><button type="button" class="pa-tool-tab" role="tab" data-tab="deco" aria-selected="false" title="사진 위에 장식을 올립니다"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2 5.3 5.5 1.5-5.5 1.6L12 17.2l-2-5.3-5.5-1.6L10 8.8z"/><path d="M18.5 15.5l.8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7z"/></svg><span>꾸미기</span></button><button type="button" class="pa-tool-tab" role="tab" data-tab="bg" aria-selected="false" title="사진 둘레 배경을 고릅니다"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><rect x="7.5" y="8.5" width="9" height="7" rx="1"/></svg><span>배경</span></button><button type="button" class="pa-tool-tab" role="tab" data-tab="music" aria-selected="false" title="배경음악과 재생 설정"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17.5V6.2l10-2v11.3"/><circle cx="6.6" cy="17.5" r="2.4"/><circle cx="16.6" cy="15.5" r="2.4"/></svg><span>음악</span></button></div><div class="pa-deco-section pa-tab-panel" role="tabpanel" data-tab="deco" aria-label="꾸미기"><svg class="pa-sparkles is-right" viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor"><path d="M50 4C53 34 66 47 96 50C66 53 53 66 50 96C47 66 34 53 4 50C34 47 47 34 50 4Z"/><path d="M84 76C85 84 88 87 96 88C88 89 85 92 84 100C83 92 80 89 72 88C80 87 83 84 84 76Z"/></g></svg><svg class="pa-sparkles is-left" viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor"><path d="M50 4C53 34 66 47 96 50C66 53 53 66 50 96C47 66 34 53 4 50C34 47 47 34 50 4Z"/><path d="M84 76C85 84 88 87 96 88C88 89 85 92 84 100C83 92 80 89 72 88C80 87 83 84 84 76Z"/></g></svg><div class="pa-categories"></div><div class="pa-sticker-grid"></div><div class="pa-adjust"></div><div class="pa-layers" hidden></div></div><section class="pa-bg-section pa-tab-panel" role="tabpanel" data-tab="bg" aria-label="배경" hidden><svg class="pa-leaves is-left" viewBox="0 0 140 140" aria-hidden="true"><path d="M4 138C38 112 66 82 92 26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="currentColor"><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(26 118) rotate(-60)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(30 116) rotate(-10)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(52 94) rotate(-75)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(56 92) rotate(-20)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(74 64) rotate(-85)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(78 62) rotate(-30)"/><path d="M0 0c8-12 24-14 36-7C26 3 12 6 0 0Z" transform="translate(90 32) rotate(-65)"/></g></svg><svg class="pa-leaves is-right" viewBox="0 0 140 140" aria-hidden="true"><path d="M4 138C38 112 66 82 92 26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="currentColor"><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(26 118) rotate(-60)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(30 116) rotate(-10)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(52 94) rotate(-75)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(56 92) rotate(-20)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(74 64) rotate(-85)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(78 62) rotate(-30)"/><path d="M0 0c8-12 24-14 36-7C26 3 12 6 0 0Z" transform="translate(90 32) rotate(-65)"/></g></svg><div class="pa-bg-card"><div class="pa-bg-head"><strong>배경 템플릿</strong><small>사진 둘레를 꾸며보세요</small></div><div class="pa-backgrounds"></div></div></section><section class="pa-bg-section pa-tab-panel" role="tabpanel" data-tab="music" aria-label="음악" hidden><svg class="pa-leaves is-left" viewBox="0 0 140 140" aria-hidden="true"><path d="M4 138C38 112 66 82 92 26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="currentColor"><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(26 118) rotate(-60)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(30 116) rotate(-10)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(52 94) rotate(-75)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(56 92) rotate(-20)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(74 64) rotate(-85)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(78 62) rotate(-30)"/><path d="M0 0c8-12 24-14 36-7C26 3 12 6 0 0Z" transform="translate(90 32) rotate(-65)"/></g></svg><svg class="pa-leaves is-right" viewBox="0 0 140 140" aria-hidden="true"><path d="M4 138C38 112 66 82 92 26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><g fill="currentColor"><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(26 118) rotate(-60)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(30 116) rotate(-10)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(52 94) rotate(-75)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(56 92) rotate(-20)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(74 64) rotate(-85)"/><path d="M0 0c10-14 30-16 44-8C32 4 14 8 0 0Z" transform="translate(78 62) rotate(-30)"/><path d="M0 0c8-12 24-14 36-7C26 3 12 6 0 0Z" transform="translate(90 32) rotate(-65)"/></g></svg><div class="pa-music"></div><p class="pa-music-none">사진을 고르면 배경음악을 넣을 수 있어요.</p><div class="pa-music-play"></div><div class="pa-more" hidden><div class="pa-music-more"></div><div class="pa-sfx-master"></div></div></section></aside><div class="pa-split" data-side="left" role="separator" aria-orientation="vertical" aria-label="목록 칸 폭" title="끌어서 목록 칸 폭 조절 · 두 번 누르면 처음 폭" tabindex="0"></div><div class="pa-split" data-side="right" role="separator" aria-orientation="vertical" aria-label="꾸미기 칸 폭" title="끌어서 꾸미기 칸 폭 조절 · 두 번 누르면 처음 폭" tabindex="0"></div></div><footer class="pa-footer"><span class="pa-status ui-keep-symbols" role="status">사진과 영상을 가져와 시작하세요.</span><span>원본은 그대로 보관됩니다</span></footer><input class="pa-input" type="file" accept="image/*,video/*,audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus" multiple hidden>';
    host.appendChild(root);
    root.querySelector(".pa-import").onclick = () => root.querySelector(".pa-input").click();
    root.querySelector(".pa-input").onchange = async event => { await importFiles(event.target.files); event.target.value = ""; };
    root.querySelector(".pa-view").onclick = () => setViewing(!viewing);
    root.querySelector(".pa-view-exit").onclick = () => setViewing(false);
    root.querySelector(".pa-fx-open").onclick = openEffectPanel;
    // 감상 모드 단추 줄의 효과 고르개: 목록 위 단추와 같은 값을 쓴다. 고르면 포커스를 풀어 ←/→ 가 다시 사진 넘기기로.
    const effectPicker = root.querySelector(".pa-view-effect");
    VIEW_EFFECTS.forEach(effect => { const option = document.createElement("option"); option.value = effect.id; option.textContent = effect.label; effectPicker.appendChild(option); });
    effectPicker.onchange = () => { try { localStorage.setItem(VIEW_EFFECT_KEY, effectPicker.value); } catch { /* 이번 화면에만 적용 */ } effectPicker.blur(); paintEffectButton(); };
    paintEffectButton();
    root.querySelector(".pa-slide-toggle").onclick = () => setSlideshow(!slideshow);
    root.addEventListener("pointermove", wakeCursor); root.addEventListener("pointerdown", wakeCursor);
    const seconds = root.querySelector(".pa-slide-seconds"), chosen = slideSeconds();
    SLIDE_SECONDS.forEach(value => { const option = document.createElement("option"); option.value = String(value); option.textContent = value + "초"; option.selected = value === chosen; seconds.appendChild(option); });
    seconds.onchange = () => { try { localStorage.setItem(SLIDE_KEY, seconds.value); } catch { /* 이번 화면에만 적용 */ } seconds.blur(); scheduleSlide(); };
    root.querySelector(".pa-center").addEventListener("wheel", onViewingWheel, { passive:false });
    root.querySelector(".pa-center").addEventListener("dblclick", onViewingDblClick);
    root.ondragover = event => {
      if (!event.dataTransfer) return;
      const types = Array.from(event.dataTransfer.types);
      if (types.includes(ART_DRAG_MIME)){
        event.preventDefault(); event.dataTransfer.dropEffect = "copy";
        const surface = root.querySelector(".pa-photo-surface");
        if (surface) surface.classList.toggle("pa-drop-target",!!photoDropPosition(event));
      } else if (types.includes("Files")){
        event.preventDefault(); event.dataTransfer.dropEffect = "copy"; root.classList.add("pa-drag");
      }
    };
    root.ondragleave = event => {
      if (!root.contains(event.relatedTarget)){
        root.classList.remove("pa-drag");
        const surface = root.querySelector(".pa-photo-surface");
        if (surface) surface.classList.remove("pa-drop-target");
      }
    };
    root.ondrop = async event => {
      if (!event.dataTransfer) return;
      const types = Array.from(event.dataTransfer.types);
      if (types.includes(INTERNAL_DRAG_MIME)){
        event.preventDefault(); event.stopPropagation();
        const artId = event.dataTransfer.getData(ART_DRAG_MIME);
        const position = photoDropPosition(event);
        if (artId.startsWith("emoji:")){ if (position) addEmoji(artId.slice(6), position); }
        else { const row = artById(artId); if (row && position) addSticker(row,position); }
      } else if (types.includes("Files")){
        event.preventDefault(); event.stopPropagation();
        await importFiles(event.dataTransfer.files);
      }
      root.classList.remove("pa-drag");
      const surface = root.querySelector(".pa-photo-surface");
      if (surface) surface.classList.remove("pa-drop-target");
    };
    observer = new ResizeObserver(fitArtboard); observer.observe(root.querySelector(".pa-stage"));
    setupToolTabs(); setupPaneSplitters();
    paintFilters(); paintList(); paintBackgrounds(); paintStickers(); paintStage();
  }
  async function mount(host){
    try {
      nativeStorage = typeof workspaceBackendAvailable === "function" && await workspaceBackendAvailable();
      if (nativeStorage){
        const response = await nativeRequest("GET", "/photo-album-list");
        const listed = await response.json();
        if (!Array.isArray(listed)) throw new Error("사진첩 목록 형식이 잘못됐습니다.");
        customArts = listed.map(normalizeArt).filter(Boolean).sort((a, b) => a.created - b.created);
        audioRecords = listed.filter(item => item && typeof item.id === "string" && item.type === "audio");
        albumItem = albumRecord(listed);
        records = listed.filter(item => item && typeof item.id === "string" && (item.type === "image" || item.type === "video"))
          .map(item => ({ ...item, stickers:Array.isArray(item.stickers) ? item.stickers : [] }));
        // 이전 버전의 같은 접속 주소에 남은 사진은 한 번만 앱 저장소로 옮긴다.
        const previous = await query("readonly", store => store.getAll()).catch(() => []);
        const known = new Set([...records, ...audioRecords].map(item => item.id));
        for (const item of previous){
          if (!item || !item.blob) continue;
          if (known.has(item.id)){
            await query("readwrite", store => store.delete(item.id)).catch(() => {});
            continue;
          }
          try {
            item.mime = item.mime || item.blob.type;
            if (item.type === "image" && !item.thumbnail) item.thumbnail = await imageThumbnail(item.blob);
            await persistNew(item); (item.type === "audio" ? audioRecords : records).push(item); known.add(item.id);
            await query("readwrite", store => store.delete(item.id)).catch(() => {});
          } catch(error){ console.warn("기존 사진첩 항목을 옮기지 못했습니다:", error); }
        }
      } else {
        const stored = await query("readonly", store => store.getAll());
        customArts = stored.map(normalizeArt).filter(Boolean).sort((a, b) => a.created - b.created);
        audioRecords = stored.filter(item => item && item.type === "audio");
        albumItem = albumRecord(stored);
        records = stored.filter(item => item && (item.type === "image" || item.type === "video"));
      }
      for (const item of records){
        if (!Array.isArray(item.stickers) || !item.stickers.some(part => part && withdrawnArtIds.has(part.art))) continue;
        const previous = item.stickers;
        item.stickers = previous.filter(part => !part || !withdrawnArtIds.has(part.art));
        try { await persistMetadata(item); }
        catch(error){ item.stickers = previous; console.warn("철회된 사진첩 장식 기록을 지우지 못했습니다:",error); }
      }
      records.sort((a,b) => b.created-a.created);
    } catch(error){
      console.error("사진첩 저장소를 열지 못했습니다:", error);
      if (host.isConnected) host.textContent = "사진첩 저장소를 열지 못했습니다. 앱을 다시 실행해 주세요.";
      return;
    }
    if (!host.isConnected) return;
    if (!records.some(row => row.id === selectedId)) selectedId = records[0] && records[0].id;
    makeUi(host); applyMotionSetting();
    window.addEventListener("keydown", onHistoryKey);
  }
  function cleanup(){ closeSaveMenu(); closeEffectPanel(); slideshow = false; clearTimeout(slideTimer); slideTimer = null; clearTimeout(cursorTimer); cursorTimer = null; stopAllMusic(); stopAllSfx(); if (previewContext){ previewContext.close().catch(() => {}); previewContext = null; } window.removeEventListener("keydown", onHistoryKey); histories.clear(); releaseUrls(); if (observer) observer.disconnect(); observer = null; root = null; }
  return { mount, cleanup };
})();

function photoAlbumShouldRestore(saved, registry){
  const key = "사진첩";
  if (saved && Array.isArray(saved.tabs) && saved.tabs.includes(key)) return true;
  return !!(registry && Array.isArray(registry.items) && registry.items.some(record =>
    Array.isArray(record.tabKeys) && record.tabKeys.includes(key)));
}

function restoreSavedPhotoAlbum(saved){
  if (!photoAlbumShouldRestore(saved, workspaceRegistry)) return null;
  return openPhotoAlbum({ restoreInBackground:true });
}

function openPhotoAlbum(options={}){
  const existing = docs.find(doc => doc.kind === "photo-album" && !doc.closed);
  if (existing){
    if (!options.restoreInBackground){
      if (typeof workspaceHasDoc === "function" && !workspaceHasDoc(existing)) workspaceAttachExistingDoc(existing);
      setActiveDoc(existing.id);
    }
    return existing;
  }
  const doc = makeDoc("photo-album","사진첩");
  doc.el.classList.add("photo-album-doc");
  doc.render = async () => PhotoAlbum.mount(doc.el);
  doc.cleanupFns = [PhotoAlbum.cleanup];
  if (!options.restoreInBackground){ refreshChrome(); activateIfIdle(doc, {}); }
  return doc;
}
