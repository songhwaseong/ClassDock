"use strict";

/* ===== 독립 화이트보드(설명용 칠판) =====
   새 문서 종류 "board". 벡터 모델(items)로 그려 undo/redo·리사이즈에 안전하고,
   PNG/PDF 로 내보낸다. 새 라이브러리 없이 캔버스만 사용. */

let _boardCount = 0;
const BOARD_RECOVERY_PREFIX = "manneung-board-recovery:";
const WB_EDU_TRANSFER_TYPE = "application/x-manneung-whiteboard-education";
const WB_FORMULA_LIBRARY_KEY = "mn.wbFormulaLibrary.v1";

function whiteboardFormulaDictionary(){
  const rows = [];
  const add = (id, group, label, template, source, keywords, description) => rows.push({
    id:"formula-" + id, category:"formula", kind:"formula", formulaGroup:group,
    label, template, source, preview:source, keywords:String(keywords || ""), description:String(description || "")
  });
  // [[이름]]은 수식 입력칸에서 순서대로 채우는 자리다. MathML로 보내기 전에는 실제 글자로 펼친다.
  add("fraction","basic","분수",String.raw`\frac{[[분자]]}{[[분모]]}`,String.raw`\frac{a}{b}`,"나누기 몫 fraction frac","분자와 분모가 있는 분수");
  add("power","basic","거듭제곱",String.raw`[[밑]]^{[[지수]]}`,String.raw`a^n`,"제곱 지수 power exponent","밑과 지수를 입력하는 거듭제곱");
  add("subscript","basic","아래첨자",String.raw`[[기호]]_{[[아래첨자]]}`,String.raw`a_i`,"첨자 인덱스 subscript","변수의 아래첨자");
  add("sqrt","basic","제곱근",String.raw`\sqrt{[[값]]}`,String.raw`\sqrt{x}`,"루트 근호 root sqrt","값의 제곱근");
  add("nth-root","basic","n제곱근",String.raw`\sqrt[ [[차수]] ]{[[값]]}`,String.raw`\sqrt[3]{x}`,"세제곱근 고차근 nth root","차수를 지정하는 근호");
  add("absolute","basic","절댓값",String.raw`\left|[[값]]\right|`,String.raw`\left|x\right|`,"절대값 크기 absolute","절댓값 기호");
  add("binomial","basic","조합 괄호",String.raw`\binom{[[전체]]}{[[선택]]}`,String.raw`\binom{n}{r}`,"이항계수 조합 combination binomial","괄호형 이항계수");
  add("vector","basic","벡터",String.raw`\vec{[[벡터]]}`,String.raw`\vec{v}`,"화살표 vector vec","문자 위에 화살표를 붙인 벡터");
  add("overline","basic","윗줄",String.raw`\overline{[[값]]}`,String.raw`\overline{AB}`,"선분 평균 반복소수 overline bar","문자 위에 선 표시");

  add("linear-equation","algebra","일차방정식",String.raw`[[a]]x + [[b]] = [[c]]`,String.raw`2x + 3 = 7`,"일차 방정식 linear equation","ax+b=c 꼴");
  add("quadratic-equation","algebra","이차방정식",String.raw`[[a]]x^2 + [[b]]x + [[c]] = 0`,String.raw`ax^2 + bx + c = 0`,"이차 방정식 quadratic","일반적인 이차방정식");
  add("quadratic-formula","algebra","근의 공식",String.raw`x = \frac{-[[b]] \pm \sqrt{[[b]]^2 - 4[[a]][[c]]}}{2[[a]]}`,String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,"판별식 근 공식 quadratic formula","이차방정식의 근의 공식");
  add("square-identity","algebra","완전제곱식",String.raw`([[a]] + [[b]])^2 = [[a]]^2 + 2[[a]][[b]] + [[b]]^2`,String.raw`(a+b)^2=a^2+2ab+b^2`,"곱셈공식 전개 identity","합의 제곱 전개");
  add("difference-squares","algebra","제곱의 차",String.raw`[[a]]^2 - [[b]]^2 = ([[a]]-[[b]])([[a]]+[[b]])`,String.raw`a^2-b^2=(a-b)(a+b)`,"인수분해 곱셈공식 factor","제곱의 차 인수분해");
  add("slope","algebra","기울기",String.raw`m = \frac{[[y_2]] - [[y_1]]}{[[x_2]] - [[x_1]]}`,String.raw`m=\frac{y_2-y_1}{x_2-x_1}`,"직선 변화율 slope","두 점을 지나는 직선의 기울기");
  add("proportion","algebra","비례식",String.raw`[[a]]:[[b]] = [[c]]:[[d]]`,String.raw`a:b=c:d`,"비율 비례 proportion ratio","두 비가 같은 비례식");

  add("limit","calculus","극한",String.raw`\lim_{x \to [[a]]} [[f(x)]]`,String.raw`\lim_{x \to a} f(x)`,"미적분 극한 limit","x가 a로 갈 때의 극한");
  add("sum","calculus","수열의 합",String.raw`\sum_{[[i]]=[[시작]]}^{[[끝]]} [[a_i]]`,String.raw`\sum_{i=1}^{n} a_i`,"시그마 합계 sigma sum","시작과 끝이 있는 합");
  add("product","calculus","연속 곱",String.raw`\prod_{[[i]]=[[시작]]}^{[[끝]]} [[a_i]]`,String.raw`\prod_{i=1}^{n} a_i`,"파이 곱 product","시작과 끝이 있는 곱");
  add("derivative","calculus","미분",String.raw`\frac{d}{d[[x]]} [[f(x)]]`,String.raw`\frac{d}{dx} f(x)`,"도함수 derivative 미분계수","함수의 1차 미분");
  add("second-derivative","calculus","이계도함수",String.raw`\frac{d^2}{d[[x]]^2} [[f(x)]]`,String.raw`\frac{d^2}{dx^2} f(x)`,"이차 미분 second derivative","함수의 2차 미분");
  add("partial-derivative","calculus","편미분",String.raw`\frac{\partial [[f]]}{\partial [[x]]}`,String.raw`\frac{\partial f}{\partial x}`,"편도함수 partial derivative","여러 변수 함수의 편미분");
  add("integral","calculus","부정적분",String.raw`\int [[f(x)]]\,d[[x]]`,String.raw`\int f(x)\,dx`,"적분 integral 부정적분","적분 구간이 없는 적분");
  add("definite-integral","calculus","정적분",String.raw`\int_{[[아래끝]]}^{[[위끝]]} [[f(x)]]\,d[[x]]`,String.raw`\int_{a}^{b} f(x)\,dx`,"구간 적분 definite integral","아래끝과 위끝이 있는 적분");
  add("double-integral","calculus","이중적분",String.raw`\iint [[f(x,y)]]\,d[[x]]\,d[[y]]`,String.raw`\iint f(x,y)\,dx\,dy`,"다중적분 double integral","두 변수에 대한 이중적분");

  add("element","set","원소",String.raw`[[x]] \in [[A]]`,String.raw`x \in A`,"집합 포함 원소 element in","x가 집합 A의 원소");
  add("subset","set","부분집합",String.raw`[[A]] \subseteq [[B]]`,String.raw`A \subseteq B`,"부분집합 subset 포함","A가 B의 부분집합");
  add("union","set","합집합",String.raw`[[A]] \cup [[B]]`,String.raw`A \cup B`,"합집합 union cup","두 집합의 합집합");
  add("intersection","set","교집합",String.raw`[[A]] \cap [[B]]`,String.raw`A \cap B`,"교집합 intersection cap","두 집합의 교집합");
  add("set-builder","set","조건제시법",String.raw`[[A]] = \left\{ [[x]] \mid [[조건]] \right\}`,String.raw`A=\left\{x \mid x>0\right\}`,"집합 조건제시 set builder","조건으로 집합을 나타내기");
  add("forall","set","모든 원소",String.raw`\forall [[x]] \in [[A]],\; [[명제]]`,String.raw`\forall x \in A,\; P(x)`,"모든 전칭 forall 논리","모든 원소에 대한 명제");
  add("implication","set","이면",String.raw`[[명제 P]] \Rightarrow [[명제 Q]]`,String.raw`P \Rightarrow Q`,"논리 명제 implication rightarrow","P이면 Q");
  add("equivalence","set","동치",String.raw`[[명제 P]] \Leftrightarrow [[명제 Q]]`,String.raw`P \Leftrightarrow Q`,"필요충분 동치 equivalence","두 명제의 동치");

  add("mean","statistics","산술평균",String.raw`\bar{x} = \frac{[[값의 합]]}{[[개수]]}`,String.raw`\bar{x}=\frac{x_1+\cdots+x_n}{n}`,"평균 mean average 통계","자료의 산술평균");
  add("weighted-mean","statistics","가중평균",String.raw`\bar{x} = \frac{\sum [[가중치]]\cdot[[값]]}{\sum [[가중치]]}`,String.raw`\bar{x}=\frac{\sum w_i x_i}{\sum w_i}`,"가중치 평균 weighted mean","가중치를 반영한 평균");
  add("variance","statistics","분산",String.raw`\sigma^2 = \frac{\sum([[x_i]]-[[평균]])^2}{[[개수]]}`,String.raw`\sigma^2=\frac{\sum(x_i-\bar{x})^2}{n}`,"분산 variance 통계","모분산 공식");
  add("standard-deviation","statistics","표준편차",String.raw`\sigma = \sqrt{\frac{\sum([[x_i]]-[[평균]])^2}{[[개수]]}}`,String.raw`\sigma=\sqrt{\frac{\sum(x_i-\bar{x})^2}{n}}`,"표준편차 standard deviation","모표준편차 공식");
  add("probability","statistics","확률",String.raw`P([[사건]]) = \frac{[[유리한 경우]]}{[[전체 경우]]}`,String.raw`P(A)=\frac{n(A)}{n(S)}`,"경우의수 probability 확률","사건이 일어날 확률");
  add("conditional-probability","statistics","조건부확률",String.raw`P([[A]] \mid [[B]]) = \frac{P([[A]] \cap [[B]])}{P([[B]])}`,String.raw`P(A\mid B)=\frac{P(A\cap B)}{P(B)}`,"조건부 확률 conditional probability","B가 일어났을 때 A의 확률");
  add("normal-distribution","statistics","정규분포",String.raw`[[X]] \sim N([[평균]],[[표준편차]]^2)`,String.raw`X \sim N(\mu,\sigma^2)`,"정규분포 normal distribution","평균과 분산으로 나타낸 정규분포");

  add("pythagorean","geometry-formula","피타고라스 정리",String.raw`[[a]]^2 + [[b]]^2 = [[c]]^2`,String.raw`a^2+b^2=c^2`,"직각삼각형 피타고라스 geometry","직각삼각형 세 변의 관계");
  add("distance","geometry-formula","두 점 사이 거리",String.raw`d = \sqrt{([[x_2]]-[[x_1]])^2 + ([[y_2]]-[[y_1]])^2}`,String.raw`d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}`,"좌표 거리 distance","평면 위 두 점 사이의 거리");
  add("midpoint","geometry-formula","중점",String.raw`\left(\frac{[[x_1]]+[[x_2]]}{2},\frac{[[y_1]]+[[y_2]]}{2}\right)`,String.raw`\left(\frac{x_1+x_2}{2},\frac{y_1+y_2}{2}\right)`,"좌표 중점 midpoint","두 점을 잇는 선분의 중점");
  add("circle-equation","geometry-formula","원의 방정식",String.raw`(x-[[a]])^2 + (y-[[b]])^2 = [[r]]^2`,String.raw`(x-a)^2+(y-b)^2=r^2`,"원 중심 반지름 circle equation","중심과 반지름으로 나타낸 원");
  add("circle-area","geometry-formula","원의 넓이",String.raw`A = \pi [[r]]^2`,String.raw`A=\pi r^2`,"넓이 원주율 circle area","반지름으로 구하는 원의 넓이");
  add("triangle-area","geometry-formula","삼각형 넓이",String.raw`A = \frac{1}{2}[[밑변]][[높이]]`,String.raw`A=\frac{1}{2}bh`,"밑변 높이 triangle area","밑변과 높이로 구하는 삼각형 넓이");
  add("sine-law","geometry-formula","사인 법칙",String.raw`\frac{[[a]]}{\sin [[A]]} = \frac{[[b]]}{\sin [[B]]} = \frac{[[c]]}{\sin [[C]]}`,String.raw`\frac{a}{\sin A}=\frac{b}{\sin B}=\frac{c}{\sin C}`,"삼각형 사인법칙 sine law","삼각형의 변과 맞은편 각의 관계");
  add("cosine-law","geometry-formula","코사인 법칙",String.raw`[[c]]^2 = [[a]]^2 + [[b]]^2 - 2[[a]][[b]]\cos [[C]]`,String.raw`c^2=a^2+b^2-2ab\cos C`,"삼각형 코사인법칙 cosine law","두 변과 끼인각으로 나머지 변 구하기");

  add("speed","science-formula","속력",String.raw`v = \frac{[[거리]]}{[[시간]]}`,String.raw`v=\frac{d}{t}`,"물리 속도 speed distance time","거리와 시간으로 구하는 속력");
  add("newton","science-formula","뉴턴 제2법칙",String.raw`F = [[질량]][[가속도]]`,String.raw`F=ma`,"물리 힘 질량 가속도 Newton","힘은 질량과 가속도의 곱");
  add("kinetic-energy","science-formula","운동에너지",String.raw`E_k = \frac{1}{2}[[질량]][[속력]]^2`,String.raw`E_k=\frac{1}{2}mv^2`,"물리 에너지 kinetic","물체의 운동에너지");
  add("potential-energy","science-formula","위치에너지",String.raw`E_p = [[질량]][[중력가속도]][[높이]]`,String.raw`E_p=mgh`,"물리 중력 위치에너지 potential","중력에 의한 위치에너지");
  add("ohm-law","science-formula","옴의 법칙",String.raw`V = [[전류]][[저항]]`,String.raw`V=IR`,"전기 전압 전류 저항 ohm","전압·전류·저항의 관계");
  add("electric-power","science-formula","전력",String.raw`P = [[전압]][[전류]]`,String.raw`P=VI`,"전기 전력 power voltage current","전압과 전류로 구하는 전력");
  add("density","science-formula","밀도",String.raw`\rho = \frac{[[질량]]}{[[부피]]}`,String.raw`\rho=\frac{m}{V}`,"과학 밀도 density mass volume","질량을 부피로 나눈 밀도");
  add("wave","science-formula","파동 속력",String.raw`v = [[진동수]][[파장]]`,String.raw`v=f\lambda`,"물리 파동 진동수 파장 wave","진동수와 파장의 곱");
  add("ideal-gas","science-formula","이상기체 상태방정식",String.raw`[[압력]][[부피]] = [[몰수]][[기체상수]][[온도]]`,String.raw`PV=nRT`,"화학 기체 압력 부피 온도 ideal gas","이상기체의 상태방정식");
  add("reaction","science-formula","화학 반응식",String.raw`[[반응물]] \rightarrow [[생성물]]`,String.raw`A+B \rightarrow C`,"화학 반응 화살표 reaction","반응물에서 생성물로 향하는 반응식");
  add("equilibrium","science-formula","화학 평형",String.raw`[[반응물]] \leftrightarrow [[생성물]]`,String.raw`A+B \leftrightarrow C+D`,"화학 평형 가역반응 equilibrium","양방향으로 진행되는 반응");
  return rows;
}

function expandWhiteboardFormulaTemplate(template){
  const fields = []; let text = "", last = 0;
  String(template || "").replace(/\[\[([^\]]{1,40})\]\]/g, (whole, label, offset) => {
    text += String(template).slice(last, offset);
    const start = text.length; text += label;
    fields.push({ label, start, end:text.length }); last = offset + whole.length;
    return whole;
  });
  text += String(template || "").slice(last);
  return { text, fields };
}

function normalizeWhiteboardFormulaLibrary(saved){
  saved = saved && typeof saved === "object" ? saved : {};
  const custom = [], seenCustom = new Set();
  for (const raw of (Array.isArray(saved.custom) ? saved.custom : []).slice(0,100)){
    const id=String(raw && raw.id || ""), label=String(raw && raw.label || "").trim().slice(0,50), source=String(raw && raw.source || "").trim().slice(0,4000);
    if (!/^custom-[a-zA-Z0-9_-]{4,80}$/.test(id) || !label || !source || seenCustom.has(id)) continue;
    seenCustom.add(id); custom.push({ id,label,source,template:source,preview:source,category:"formula",kind:"formula",formulaGroup:"custom",keywords:"내 수식 사용자 저장",description:"직접 저장한 수식",custom:true });
  }
  const validIds = new Set([...whiteboardFormulaDictionary().map((entry)=>entry.id), ...custom.map((entry)=>entry.id)]);
  const cleanIds = (value, limit) => {
    const out=[]; for (const id of (Array.isArray(value) ? value : [])){ const key=String(id||""); if (validIds.has(key) && !out.includes(key)) out.push(key); if (out.length>=limit) break; } return out;
  };
  return { custom, favorites:cleanIds(saved.favorites,200), recent:cleanIds(saved.recent,20) };
}

// 수학·과학 도구상자 1차 목록. 기호·수식은 편집 가능한 text 항목으로,
// 조합 도형은 SVG data URL 이미지로 넣어 기존 이동·크기조절·저장·내보내기를 그대로 탄다.
function whiteboardEducationCatalog(){
  const rows = [];
  const addText = (category, id, label, value, keywords="") => rows.push({ category, id, label, value, keywords, kind:"text" });
  const addStencil = (category, id, label, keywords="", stencilGroup="") => rows.push({ category, id, label, keywords, stencilGroup, kind:"stencil" });
  [
    ["plus-minus","플러스마이너스","±"], ["times","곱하기","×"], ["divide","나누기","÷"],
    ["not-equal","같지 않음","≠"], ["less-equal","작거나 같음","≤"], ["greater-equal","크거나 같음","≥"],
    ["approx","근사","≈"], ["infinity","무한대","∞"], ["root","제곱근","√"],
    ["pi","파이","π"], ["theta","세타","θ"], ["delta","델타","Δ"],
    ["sigma","합 시그마","∑"], ["integral","적분","∫"], ["partial","편미분","∂"],
    ["nabla","나블라","∇"], ["angle-symbol","각","∠"], ["perpendicular","수직","⊥"],
    ["parallel","평행","∥"], ["element","원소","∈"], ["not-element","원소 아님","∉"],
    ["subset","부분집합","⊂"], ["union","합집합","∪"], ["intersection","교집합","∩"]
  ].forEach(([id, label, value]) => addText("symbol", "symbol-" + id, label, value, "수학 기호 연산 집합"));
  rows.push(...whiteboardFormulaDictionary());
  [
    ["coordinate","좌표축","좌표 평면 x축 y축","graph"], ["grid","격자 좌표평면","그래프 모눈","graph"],
    ["number-line","수직선","숫자 축 구간","graph"], ["parabola","포물선 그래프","이차함수 꼭짓점","graph"],
    ["sine-graph","사인 그래프","삼각함수 주기 파동","graph"], ["vector-coordinate","좌표 벡터","벡터 성분 위치","graph"],
    ["triangle","삼각형","기하 도형","plane"], ["right-triangle","직각삼각형","피타고라스 직각","plane"],
    ["square","정사각형","사각형 네 변 같음","plane"], ["rectangle","직사각형","사각형 직각","plane"],
    ["parallelogram","평행사변형","평행 사각형","plane"], ["rhombus","마름모","네 변 같음 대각선","plane"],
    ["trapezoid","사다리꼴","한 쌍 평행","plane"], ["regular-hexagon","정육각형","다각형 육각형","plane"],
    ["angle","각도","각 호 세타","construction"], ["angle-bisector","각의 이등분선","작도 같은 각","construction"],
    ["perpendicular-bisector","수직이등분선","작도 수직 중점","construction"], ["circle-tangent","원과 접선","반지름 접선","construction"],
    ["circle-parts","원의 구성 요소","반지름 지름 현 중심","construction"], ["sector","부채꼴","중심각 호 넓이","construction"],
    ["cube","정육면체","입체도형 모서리","solid"], ["cuboid","직육면체","입체도형 상자","solid"],
    ["cylinder","원기둥","입체도형 밑면 높이","solid"], ["cone","원뿔","입체도형 밑면 꼭짓점","solid"],
    ["sphere","구","입체도형 구면 반지름","solid"], ["pyramid","각뿔","입체도형 사각뿔","solid"]
  ].forEach(([id, label, keywords, group]) => addStencil("geometry", "stencil-" + id, label, keywords, group));
  [
    ["force","힘과 운동","물리 힘 중력 수직항력 벡터","mechanics"], ["spring","용수철","물리 탄성 진동","mechanics"],
    ["inclined-plane","빗면의 힘","물리 경사면 중력 수직항력","mechanics"], ["pulley","도르래","물리 장력 추","mechanics"],
    ["lever","지레","물리 받침점 힘 거리","mechanics"], ["projectile","포물선 운동","물리 투사체 속도 중력","mechanics"],
    ["pendulum","단진자","물리 진동 주기","mechanics"],
    ["circuit","간단한 전기회로","물리 전지 저항 전구 회로","electricity"], ["series-circuit","직렬회로","전기 저항 직렬 전류","electricity"],
    ["parallel-circuit","병렬회로","전기 저항 병렬 전압","electricity"], ["circuit-symbols","회로 기호 모음","전지 저항 전구 스위치 전류계 전압계","electricity"],
    ["ray","빛의 반사","과학 광선 거울 입사 반사","optics"], ["convex-lens","볼록렌즈 광선도","광학 초점 실상 렌즈","optics"],
    ["concave-lens","오목렌즈 광선도","광학 초점 허상 렌즈","optics"],
    ["beaker","비커","화학 실험 용액","chemistry"], ["test-tube","시험관","화학 실험 가열 용액","chemistry"],
    ["flask","삼각 플라스크","화학 실험 용액 혼합","chemistry"], ["graduated-cylinder","메스실린더","화학 부피 측정 눈금","chemistry"],
    ["burette","뷰렛","화학 적정 콕 눈금","chemistry"], ["gas-collection","기체 포집 장치","화학 수상치환 집기병","chemistry"],
    ["reaction","화학 반응식","화학 반응 화살표 생성물","chemistry"], ["atom","원자 모형","과학 원자 전자","chemistry"],
    ["bohr-atom","전자껍질 모형","보어 원자 전자 배치","chemistry"], ["molecule","분자 결합 모형","화학 공유결합 분자","chemistry"],
    ["ph-scale","pH 눈금","화학 산성 중성 염기성","chemistry"], ["energy-profile","반응 에너지 그래프","화학 활성화에너지 발열 흡열","chemistry"],
    ["plant-cell","식물세포","생명 세포벽 엽록체 액포","biology"], ["animal-cell","동물세포","생명 핵 세포막 미토콘드리아","biology"],
    ["dna","DNA 이중나선","생명 유전 염기","biology"], ["mitosis","세포분열","생명 체세포 분열 염색체","biology"],
    ["food-chain","먹이사슬","생태계 생산자 소비자","biology"],
    ["solar-system","태양계","지구과학 행성 공전","earth"], ["moon-phases","달의 위상","지구과학 초승 상현 보름 하현","earth"],
    ["earth-layers","지구 내부 구조","지각 맨틀 외핵 내핵","earth"], ["water-cycle","물의 순환","증발 응결 강수 지하수","earth"],
    ["weather-front","기상 전선","온난전선 한랭전선","earth"], ["tectonic-plates","판 구조와 맨틀 대류","지구과학 판 경계 화산","earth"]
  ].forEach(([id, label, keywords, group]) => addStencil("science", "stencil-" + id, label, keywords, group));
  [
    ["degree","각도 단위","°"], ["celsius","섭씨","℃"], ["millimeter","밀리미터","㎜"],
    ["centimeter","센티미터","㎝"], ["square-meter","제곱미터","㎡"], ["cubic-meter","세제곱미터","㎥"],
    ["kilogram","킬로그램","㎏"], ["ohm","옴","Ω"], ["hertz","헤르츠","㎐"]
  ].forEach(([id, label, value]) => addText("science", "unit-" + id, label, value, "과학 단위"));
  return rows;
}

function whiteboardVectorGroupSvg(group, color="#111111"){
  if (!group || !Array.isArray(group.items)) return "";
  const c = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : "#111111";
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const attrs = (item, fill=false) => {
    const stroke = esc(item.color || c), width = Math.max(.5, Number(item.width) || 3);
    const dash = Array.isArray(item.dash) && item.dash.length ? ` stroke-dasharray="${item.dash.map(Number).join(" ")}"` : "";
    const opacity = Number.isFinite(item.alpha) ? ` opacity="${Math.max(0,Math.min(1,item.alpha))}"` : "";
    return `stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="${fill ? stroke : "none"}"${dash}${opacity}`;
  };
  const body = group.items.map((item) => {
    if (!item) return "";
    if (item.type === "line" || item.type === "arrow") return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" ${attrs(item)}${item.type === "arrow" ? ' marker-end="url(#wb-arrow)"' : ""}/>`;
    if (item.type === "rect") return `<rect x="${Math.min(item.x1,item.x2)}" y="${Math.min(item.y1,item.y2)}" width="${Math.abs(item.x2-item.x1)}" height="${Math.abs(item.y2-item.y1)}" ${attrs(item,!!item.fill)}/>`;
    if (item.type === "ellipse"){
      const cx=(item.x1+item.x2)/2,cy=(item.y1+item.y2)/2,rx=Math.abs(item.x2-item.x1)/2,ry=Math.abs(item.y2-item.y1)/2;
      const transform = Number(item.rotation) ? ` transform="rotate(${Number(item.rotation)*180/Math.PI} ${cx} ${cy})"` : "";
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${attrs(item,!!item.fill)}${transform}/>`;
    }
    if (item.type === "polyline"){
      const points = (item.points || []).map((p)=>`${p.x},${p.y}`).join(" ");
      const tag = item.closed ? "polygon" : "polyline";
      return `<${tag} points="${points}" ${attrs(item,!!item.fill)}/>`;
    }
    if (item.type === "text") return `<text x="${item.x}" y="${Number(item.y)+(Number(item.fontSize)||18)}" fill="${esc(item.color || c)}" stroke="none" font-family="system-ui,Malgun Gothic,sans-serif" font-size="${Number(item.fontSize)||18}">${esc(item.text)}</text>`;
    return "";
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="190" viewBox="0 0 240 190"><defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="${c}" stroke-width="1.5"/></marker></defs>${body}</svg>`;
}

function whiteboardStencilSvg(id, color="#111111"){
  const c = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : "#111111";
  const common = `fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const text = `fill="${c}" stroke="none" font-family="system-ui,Malgun Gothic,sans-serif" font-size="18"`;
  const shapes = {
    "stencil-coordinate": `<path d="M18 100H222M120 14V166M216 94l6 6-6 6M114 20l6-6 6 6"/><path d="M55 95v10M85 95v10M155 95v10M185 95v10M115 50h10M115 140h10"/><text x="207" y="124" ${text}>x</text><text x="132" y="27" ${text}>y</text><text x="105" y="120" ${text}>O</text>`,
    "stencil-grid": `<path opacity=".22" d="M30 20V170M60 20V170M90 20V170M120 20V170M150 20V170M180 20V170M210 20V170M15 35H225M15 65H225M15 95H225M15 125H225M15 155H225"/><path d="M15 95H225M120 15V175M219 89l6 6-6 6M114 21l6-6 6 6"/><text x="207" y="119" ${text}>x</text><text x="130" y="29" ${text}>y</text>`,
    "stencil-triangle": `<path d="M25 155L120 24l96 131z"/><text x="113" y="20" ${text}>A</text><text x="10" y="169" ${text}>B</text><text x="218" y="169" ${text}>C</text>`,
    "stencil-right-triangle": `<path d="M35 155V35l170 120zM35 133h22v22"/><text x="20" y="31" ${text}>A</text><text x="17" y="174" ${text}>B</text><text x="207" y="174" ${text}>C</text>`,
    "stencil-angle": `<path d="M28 148L115 78l102 42M82 104a48 48 0 0 1 75-9"/><text x="112" y="121" ${text}>θ</text>`,
    "stencil-circle-tangent": `<circle cx="100" cy="92" r="58"/><path d="M100 92L141 51M141 51L210 120M133 59l9 9 9-9"/><circle cx="100" cy="92" r="3" fill="${c}"/><text x="108" y="82" ${text}>r</text>`,
    "stencil-number-line": `<path d="M18 95H222M216 89l6 6-6 6M24 89l-6 6 6 6M55 88v14M90 88v14M125 88v14M160 88v14M195 88v14"/><text x="49" y="126" ${text}>-2</text><text x="84" y="126" ${text}>-1</text><text x="120" y="126" ${text}>0</text><text x="157" y="126" ${text}>1</text><text x="192" y="126" ${text}>2</text>`,
    "stencil-force": `<path d="M18 145H222"/><rect x="82" y="72" width="76" height="72" rx="4"/><path d="M120 72V20M114 28l6-8 6 8M120 144v42M114 178l6 8 6-8M82 106H30M38 100l-8 6 8 6M158 106h52M202 100l8 6-8 6"/><text x="128" y="34" ${text}>N</text><text x="128" y="184" ${text}>mg</text><text x="37" y="97" ${text}>F</text>`,
    "stencil-spring": `<path d="M18 30H62M62 18v24M62 30l12 22 18-44 18 44 18-44 18 44 18-44 18 44 12-22H222M202 17v26M210 17v26M218 17v26"/><rect x="176" y="76" width="46" height="46"/><path d="M62 99h114"/><text x="103" y="93" ${text}>k</text>`,
    "stencil-circuit": `<path d="M25 50H70M86 50h44l12-10 12 20 12-20 12 20 12-10h25V145H25V50M70 35v30M86 42v16"/><circle cx="120" cy="145" r="24"/><path d="M104 129l32 32M136 129l-32 32"/><text x="140" y="31" ${text}>R</text>`,
    "stencil-beaker": `<path d="M75 22h90M88 22v38L48 160c-5 12 2 20 16 20h112c14 0 21-8 16-20L152 60V22M67 130h106"/><path opacity=".25" d="M62 132h116l14 34c3 8-2 14-13 14H61c-11 0-16-6-13-14z" fill="${c}"/><path d="M68 148c18-10 34 10 52 0s34 10 52 0"/>`,
    "stencil-atom": `<ellipse cx="120" cy="95" rx="94" ry="36"/><ellipse cx="120" cy="95" rx="94" ry="36" transform="rotate(60 120 95)"/><ellipse cx="120" cy="95" rx="94" ry="36" transform="rotate(-60 120 95)"/><circle cx="120" cy="95" r="10" fill="${c}"/><circle cx="214" cy="95" r="6" fill="${c}"/><circle cx="73" cy="14" r="6" fill="${c}"/><circle cx="73" cy="176" r="6" fill="${c}"/>`,
    "stencil-ray": `<path d="M25 150H215M120 24V166M45 55l75 95 70-90M53 58l-8-3 2 9M182 63l8-3-2 9"/><path stroke-dasharray="6 6" d="M120 150V55"/><path d="M94 117a42 42 0 0 1 26-9M120 108a42 42 0 0 1 25 9"/><text x="72" y="112" ${text}>i</text><text x="154" y="112" ${text}>r</text>`,
    "stencil-reaction": `<text x="14" y="105" ${text} font-size="25">반응물</text><path d="M92 95H164M154 85l10 10-10 10"/><text x="172" y="105" ${text} font-size="25">생성물</text><path d="M96 123H160M106 113l-10 10 10 10"/>`
  };
  if (!shapes[id]) return whiteboardVectorGroupSvg(whiteboardStencilGroup(id, c), c);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="190" viewBox="0 0 240 190"><g ${common}>${shapes[id]}</g></svg>`;
}

// 2차 도구상자는 같은 스텐실을 실제 보드 벡터 묶음으로 삽입한다. 그룹을 풀면
// 선·도형·글자가 기존 선택 도구로 각각 편집 가능하고, 그룹 상태에서는 한 번에 이동·확대한다.
function whiteboardStencilGroup(id, color="#111111"){
  const c = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : "#111111";
  const line = (x1,y1,x2,y2,extra={}) => Object.assign({ type:"line", x1,y1,x2,y2, color:c, width:3 }, extra);
  const arrow = (x1,y1,x2,y2,extra={}) => Object.assign({ type:"arrow", x1,y1,x2,y2, color:c, width:3 }, extra);
  const rect = (x1,y1,x2,y2,extra={}) => Object.assign({ type:"rect", x1,y1,x2,y2, color:c, width:3 }, extra);
  const ellipse = (x1,y1,x2,y2,extra={}) => Object.assign({ type:"ellipse", x1,y1,x2,y2, color:c, width:3 }, extra);
  const label = (x,y,value,size=18,extra={}) => Object.assign({ type:"text", x,y,text:String(value),fontSize:size,color:c }, extra);
  const poly = (points,extra={}) => Object.assign({ type:"polyline", points:points.map(([x,y]) => ({x,y})), color:c, width:3 }, extra);
  const arc = (cx,cy,r,a1,a2,n=12,extra={}) => {
    const points = [];
    for (let i=0;i<=n;i++){ const a=a1+(a2-a1)*i/n; points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]); }
    return poly(points,extra);
  };
  const regular = (cx,cy,r,n,phase=-Math.PI/2,extra={}) => poly(Array.from({length:n},(_,i)=>[cx+Math.cos(phase+i*Math.PI*2/n)*r,cy+Math.sin(phase+i*Math.PI*2/n)*r]),Object.assign({closed:true},extra));
  const curve = (x1,x2,steps,fn,extra={}) => poly(Array.from({length:steps+1},(_,i)=>{ const x=x1+(x2-x1)*i/steps; return [x,fn(x,i)]; }),extra);
  const ticks = (axis, values) => values.map((v) => axis === "x" ? line(v,95,v,105) : line(115,v,125,v));
  const groups = {
    "stencil-coordinate": () => [
      arrow(18,100,222,100), arrow(120,166,120,14), ...ticks("x",[55,85,155,185]), ...ticks("y",[50,140]),
      label(207,116,"x"), label(132,18,"y"), label(105,112,"O")
    ],
    "stencil-grid": () => [
      ...[30,60,90,120,150,180,210].map((x) => line(x,20,x,170,{width:1,alpha:.22})),
      ...[35,65,95,125,155].map((y) => line(15,y,225,y,{width:1,alpha:.22})),
      arrow(15,95,225,95), arrow(120,175,120,15), label(207,111,"x"), label(130,20,"y")
    ],
    "stencil-triangle": () => [poly([[25,155],[120,24],[216,155],[25,155]]), label(113,2,"A"), label(8,159,"B"), label(218,159,"C")],
    "stencil-right-triangle": () => [poly([[35,155],[35,35],[205,155],[35,155]]), poly([[35,133],[57,133],[57,155]]), label(18,10,"A"), label(16,159,"B"), label(207,159,"C")],
    "stencil-angle": () => [poly([[28,148],[115,78],[217,120]]), arc(115,78,48,2.48,.34,14), label(111,112,"θ",22)],
    "stencil-circle-tangent": () => [ellipse(42,34,158,150), line(100,92,141,51), line(141,51,210,120), poly([[133,59],[142,68],[151,59]]), ellipse(97,89,103,95,{fill:true}), label(108,68,"r")],
    "stencil-number-line": () => [
      arrow(18,95,222,95), arrow(222,95,18,95), ...[55,90,125,160,195].map((x) => line(x,88,x,102)),
      label(46,111,"-2"),label(81,111,"-1"),label(120,111,"0"),label(157,111,"1"),label(192,111,"2")
    ],
    "stencil-parabola": () => [arrow(20,150,222,150),arrow(55,176,55,18),curve(65,210,28,(x)=>150-(x-135)*(x-135)/95),label(207,157,"x"),label(62,18,"y"),label(129,151,"O")],
    "stencil-sine-graph": () => [arrow(16,96,224,96),arrow(28,174,28,18),curve(28,220,36,(x)=>96-45*Math.sin((x-28)*Math.PI/64)),label(210,104,"x"),label(34,18,"y")],
    "stencil-vector-coordinate": () => [arrow(20,160,222,160),arrow(35,176,35,18),arrow(35,160,180,55,{width:4}),line(180,55,180,160,{dash:[5,5],alpha:.45}),line(35,55,180,55,{dash:[5,5],alpha:.45}),label(185,42,"P(a,b)"),label(98,92,"v",22)],
    "stencil-square": () => [rect(55,30,185,160),poly([[55,140],[75,140],[75,160]]),line(113,25,127,25),line(113,165,127,165),line(50,88,50,102),line(190,88,190,102)],
    "stencil-rectangle": () => [rect(30,50,210,145),poly([[30,125],[50,125],[50,145]]),poly([[190,145],[190,125],[210,125]]),label(112,151,"a"),label(214,90,"b")],
    "stencil-parallelogram": () => [poly([[58,35],[210,35],[180,155],[28,155],[58,35]],{closed:true}),poly([[83,30],[97,30]]),poly([[141,160],[155,160]]),poly([[40,92],[49,98],[44,108]]),poly([[194,82],[203,88],[198,98]])],
    "stencil-rhombus": () => [poly([[120,20],[218,95],[120,170],[22,95],[120,20]],{closed:true}),line(120,20,120,170,{dash:[5,5],alpha:.5}),line(22,95,218,95,{dash:[5,5],alpha:.5}),poly([[120,95],[136,95],[136,111]])],
    "stencil-trapezoid": () => [poly([[72,38],[172,38],[215,155],[25,155],[72,38]],{closed:true}),poly([[110,33],[124,33]]),poly([[110,160],[124,160]]),line(72,38,72,155,{dash:[5,5],alpha:.5}),poly([[72,137],[90,137],[90,155]])],
    "stencil-regular-hexagon": () => [regular(120,95,78,6,0),line(120,95,198,95,{dash:[5,5],alpha:.5}),ellipse(116,91,124,99,{fill:true}),label(126,99,"O")],
    "stencil-angle-bisector": () => [poly([[25,156],[112,72],[220,130]]),arrow(112,72,174,180),arc(112,72,38,2.37,.5,12),line(131,99,138,91),line(143,91,150,84),label(145,134,"이등분선",15)],
    "stencil-perpendicular-bisector": () => [line(25,112,215,112),line(120,22,120,178,{dash:[6,5]}),line(114,104,114,120),line(126,104,126,120),poly([[120,112],[138,112],[138,94]]),arc(25,112,112,-.75,.75,12,{alpha:.35}),arc(215,112,112,Math.PI-.75,Math.PI+.75,12,{alpha:.35}),label(108,120,"M")],
    "stencil-circle-parts": () => [ellipse(35,15,205,185),ellipse(116,96,124,104,{fill:true}),line(120,100,185,55),line(35,100,205,100),line(64,52,181,149),label(143,64,"r"),label(102,104,"O"),label(83,45,"현",15),label(91,107,"지름",15)],
    "stencil-sector": () => [ellipse(35,10,205,180),ellipse(116,91,124,99,{fill:true}),line(120,95,191,49),line(120,95,177,159),arc(120,95,30,-.58,.82,10),label(151,91,"θ",22),label(154,48,"r")],
    "stencil-cube": () => [rect(48,55,158,165),rect(82,25,192,135,{dash:[5,4]}),line(48,55,82,25),line(158,55,192,25),line(158,165,192,135),line(48,165,82,135,{dash:[5,4]})],
    "stencil-cuboid": () => [rect(32,68,175,160),rect(70,30,208,120,{dash:[5,4]}),line(32,68,70,30),line(175,68,208,30),line(175,160,208,120),line(32,160,70,120,{dash:[5,4]})],
    "stencil-cylinder": () => [ellipse(45,20,195,72),line(45,46,45,150),line(195,46,195,150),ellipse(45,124,195,176),arc(120,46,75,Math.PI,Math.PI*2,14,{dash:[5,4],alpha:.5}),label(126,87,"h"),line(120,150,190,150),label(153,132,"r")],
    "stencil-cone": () => [ellipse(42,128,198,178),line(120,20,42,153),line(120,20,198,153),line(120,20,120,153,{dash:[5,4],alpha:.5}),line(120,153,193,153),label(125,82,"h"),label(154,135,"r")],
    "stencil-sphere": () => [ellipse(30,5,210,185),ellipse(30,66,210,124),ellipse(82,5,158,185,{rotation:0}),ellipse(116,91,124,99,{fill:true}),line(120,95,185,55),label(151,58,"r")],
    "stencil-pyramid": () => [poly([[35,135],[120,165],[210,125],[125,103],[35,135]]),line(120,20,35,135),line(120,20,120,165),line(120,20,210,125),line(120,20,125,103,{dash:[5,4]}),line(120,20,120,132,{dash:[5,4],alpha:.55}),label(125,71,"h")],
    "stencil-force": () => [line(18,145,222,145),rect(82,72,158,144),arrow(120,72,120,20),arrow(120,144,120,186),arrow(82,106,30,106),arrow(158,106,210,106),label(128,20,"N"),label(128,166,"mg"),label(38,79,"F")],
    "stencil-spring": () => [line(18,30,62,30),line(62,18,62,42),poly([[62,30],[74,52],[92,8],[110,52],[128,8],[146,52],[164,8],[182,52],[194,30]]),line(194,30,222,30),...[202,210,218].map((x)=>line(x,17,x,43)),rect(176,76,222,122),line(62,99,176,99),label(103,72,"k")],
    "stencil-inclined-plane": () => [poly([[25,160],[210,160],[210,45],[25,160]],{closed:true}),poly([[105,89],[145,65],[166,100],[126,124],[105,89]],{closed:true}),arrow(136,95,136,158),arrow(136,95,98,35),arrow(136,95,188,63),label(142,137,"mg",15),label(85,23,"N",15),label(181,47,"F",15)],
    "stencil-pulley": () => [line(35,24,205,24),line(120,24,120,45),ellipse(88,42,152,106),line(88,74,88,154),line(152,74,152,154),rect(66,154,110,184),rect(130,154,174,184),arrow(88,145,88,112),arrow(152,145,152,112),label(69,116,"T"),label(157,116,"T")],
    "stencil-lever": () => [line(24,112,216,68,{width:5}),poly([[104,145],[130,90],[157,145],[104,145]],{closed:true}),arrow(48,106,48,35),arrow(195,73,195,145),label(28,28,"힘"),label(199,130,"하중",15),label(112,148,"받침점",14)],
    "stencil-projectile": () => [arrow(20,165,224,165),arrow(30,178,30,18),curve(35,210,26,(x)=>157-(x-35)*1.25+(x-35)*(x-35)/150),arrow(40,150,82,98),arrow(175,90,175,140),label(57,79,"v₀"),label(182,110,"g"),label(208,170,"x")],
    "stencil-pendulum": () => [line(40,22,200,22),line(120,22,76,142),ellipse(58,138,94,174,{fill:true}),line(120,22,120,160,{dash:[5,5],alpha:.4}),arc(120,22,55,Math.PI/2,1.88,10),arrow(76,142,108,104),arrow(76,142,76,184),label(91,109,"T"),label(82,165,"mg",15),label(97,73,"θ")],
    "stencil-circuit": () => [
      poly([[25,50],[70,50]]),line(70,35,70,65),line(86,42,86,58),poly([[86,50],[130,50],[142,40],[154,60],[166,40],[178,60],[190,50],[215,50],[215,145],[144,145]]),
      ellipse(96,121,144,169),poly([[104,129],[136,161]]),poly([[136,129],[104,161]]),poly([[96,145],[25,145],[25,50]]),label(140,15,"R")
    ],
    "stencil-series-circuit": () => [poly([[22,45],[65,45]]),line(65,30,65,60),line(80,37,80,53),poly([[80,45],[105,45],[113,35],[125,55],[137,35],[149,55],[157,45],[181,45],[189,35],[201,55],[213,35],[220,45],[220,150],[22,150],[22,45]]),label(115,15,"R₁"),label(186,15,"R₂"),arrow(90,150,150,150),label(112,155,"I",15)],
    "stencil-parallel-circuit": () => [poly([[22,45],[65,45]]),line(65,30,65,60),line(80,37,80,53),poly([[80,45],[218,45],[218,150],[22,150],[22,45]]),line(95,45,95,150),line(190,45,190,150),poly([[95,78],[112,78],[120,68],[132,88],[144,68],[152,78],[190,78]]),poly([[95,118],[112,118],[120,108],[132,128],[144,108],[152,118],[190,118]]),label(157,61,"R₁",14),label(157,121,"R₂",14)],
    "stencil-circuit-symbols": () => [line(14,35,48,35),line(48,20,48,50),line(62,27,62,43),line(62,35,94,35),label(15,53,"전지",13),poly([[126,35],[138,25],[150,45],[162,25],[174,45],[186,35],[222,35]]),label(151,53,"저항",13),ellipse(18,90,62,134),poly([[25,97],[55,127],[55,97],[25,127]]),label(18,139,"전구",13),line(92,112,127,112),line(127,112,164,87),line(164,112,202,112),ellipse(158,106,170,118,{fill:true}),label(126,139,"스위치",13)],
    "stencil-beaker": () => [poly([[75,22],[165,22]]),poly([[88,22],[88,60],[48,160],[48,172],[62,180],[178,180],[192,172],[192,160],[152,60],[152,22]]),line(67,130,173,130),poly([[68,148],[85,140],[102,148],[120,140],[138,148],[155,140],[172,148]])],
    "stencil-test-tube": () => [poly([[82,18],[158,18]]),poly([[94,18],[94,136],[100,158],[114,173],[134,173],[149,158],[154,136],[154,18]]),line(96,112,152,112),poly([[98,130],[112,124],[126,132],[140,124],[151,130]]),label(160,113,"용액",14)],
    "stencil-flask": () => [line(88,20,152,20),poly([[98,20],[98,67],[48,151],[48,168],[60,178],[180,178],[192,168],[192,151],[142,67],[142,20]]),line(70,132,170,132),poly([[71,150],[92,142],[112,151],[132,142],[169,151]])],
    "stencil-graduated-cylinder": () => [poly([[84,18],[156,18],[150,168],[90,168],[84,18]]),line(72,168,168,168),...[45,70,95,120,145].map((y)=>line(90,y,112,y)),line(91,118,149,118),label(158,112,"mL",14)],
    "stencil-burette": () => [line(38,20,202,20),line(120,20,120,143),line(110,20,130,20),...[43,63,83,103,123].map((y)=>line(120,y,136,y,{width:1.5})),line(105,143,135,143),line(120,143,120,179),line(120,154,153,154),ellipse(149,150,157,158,{fill:true}),label(160,145,"콕",13)],
    "stencil-gas-collection": () => [rect(25,120,215,178),poly([[25,140],[55,134],[85,141],[115,134],[145,141],[175,134],[215,140]]),poly([[52,120],[52,66],[76,42],[76,120]]),line(64,66,146,66),line(146,66,146,120),rect(130,38,190,120),arrow(146,88,170,88),label(81,47,"기체",14)],
    "stencil-atom": () => [ellipse(26,59,214,131),ellipse(26,59,214,131,{rotation:Math.PI/3}),ellipse(26,59,214,131,{rotation:-Math.PI/3}),ellipse(110,85,130,105,{fill:true}),ellipse(208,89,220,101,{fill:true}),ellipse(67,8,79,20,{fill:true}),ellipse(67,170,79,182,{fill:true})],
    "stencil-bohr-atom": () => [ellipse(108,83,132,107,{fill:true}),ellipse(78,53,162,137),ellipse(38,13,202,177),ellipse(155,89,167,101,{fill:true}),ellipse(73,89,85,101,{fill:true}),ellipse(194,89,206,101,{fill:true}),ellipse(34,89,46,101,{fill:true}),label(109,86,"+")],
    "stencil-molecule": () => [line(55,95,112,63,{width:7}),line(112,63,178,95,{width:7}),line(112,63,112,145,{width:7}),ellipse(31,71,79,119),ellipse(86,37,138,89),ellipse(154,71,202,119),ellipse(88,121,136,169),label(47,80,"H",17),label(103,47,"C",18),label(170,80,"H",17),label(104,130,"H",17)],
    "stencil-ph-scale": () => [arrow(20,95,220,95),...[27,40,53,66,79,92,105,118,131,144,157,170,183,196,209].map((x)=>line(x,86,x,104,{width:2})),label(22,108,"0"),label(112,108,"7"),label(199,108,"14"),label(22,55,"산성",16),label(104,55,"중성",16),label(174,55,"염기성",16)],
    "stencil-energy-profile": () => [arrow(25,165,220,165),arrow(25,165,25,18),curve(35,210,32,(x)=>130-80*Math.exp(-Math.pow((x-120)/32,2))+(x>120?28:0)),line(35,130,85,130,{dash:[5,4]}),line(158,158,210,158,{dash:[5,4]}),arrow(120,130,120,50),label(126,75,"Eₐ",16),label(183,169,"반응 진행",13)],
    "stencil-ray": () => [line(25,150,215,150),line(120,24,120,166,{dash:[6,6]}),arrow(45,55,120,150),arrow(120,150,190,60),arc(120,150,42,-2.24,-1.57,8),arc(120,150,42,-1.57,-.9,8),label(72,96,"i"),label(154,96,"r")],
    "stencil-convex-lens": () => [line(18,95,222,95,{dash:[6,5],alpha:.5}),ellipse(108,18,132,172),ellipse(68,91,76,99,{fill:true}),ellipse(164,91,172,99,{fill:true}),arrow(30,145,30,55),line(30,55,120,55),arrow(120,55,205,127),arrow(30,55,205,55),label(67,103,"F"),label(165,103,"F")],
    "stencil-concave-lens": () => [line(18,95,222,95,{dash:[6,5],alpha:.5}),poly([[112,18],[105,45],[103,95],[105,145],[112,172]]),poly([[128,18],[135,45],[137,95],[135,145],[128,172]]),ellipse(68,91,76,99,{fill:true}),ellipse(164,91,172,99,{fill:true}),arrow(30,145,30,55),line(30,55,120,68),arrow(120,68,210,40),line(120,68,72,95,{dash:[5,4],alpha:.5}),label(66,103,"F")],
    "stencil-reaction": () => [label(10,84,"반응물",24),arrow(92,95,164,95),label(168,84,"생성물",24),arrow(160,123,96,123)],
    "stencil-plant-cell": () => [poly([[35,28],[205,28],[220,52],[220,145],[198,166],[42,166],[20,143],[20,52],[35,28]],{closed:true}),poly([[43,40],[195,40],[207,58],[207,137],[190,153],[49,153],[34,136],[34,59],[43,40]],{closed:true,alpha:.55}),ellipse(54,65,105,116),ellipse(115,55,190,137),...[55,91,132,174].map((x)=>ellipse(x,43,x+18,55)),label(58,79,"핵",15),label(136,88,"액포",15)],
    "stencil-animal-cell": () => [ellipse(22,25,218,166),ellipse(64,57,120,113),...[138,170].map((x)=>ellipse(x,54,x+25,69)),...[55,96,145,184].map((x)=>ellipse(x,128,x+18,141)),label(78,76,"핵",15),label(128,22,"세포막",14),arrow(154,34,192,28)],
    "stencil-dna": () => [curve(35,205,34,(x)=>95-55*Math.sin((x-35)*Math.PI/58)),curve(35,205,34,(x)=>95+55*Math.sin((x-35)*Math.PI/58)),...[0,1,2,3,4,5,6,7,8].map((i)=>{ const x=40+i*20,y1=95-55*Math.sin((x-35)*Math.PI/58),y2=95+55*Math.sin((x-35)*Math.PI/58); return line(x,y1,x,y2,{width:2,alpha:.65}); }),label(87,166,"DNA 이중나선",16)],
    "stencil-mitosis": () => [ellipse(10,52,72,114),line(30,72,52,94),line(52,72,30,94),arrow(76,83,103,83),ellipse(108,52,170,114),line(125,70,153,96),line(153,70,125,96),line(139,54,139,112,{dash:[4,4]}),arrow(174,83,201,83),ellipse(202,45,234,79),ellipse(202,91,234,125),label(15,129,"간기",13),label(113,129,"분열",13),label(198,129,"딸세포",13)],
    "stencil-food-chain": () => [label(8,76,"풀",22),arrow(43,88,80,88),label(84,76,"토끼",21),arrow(130,88,165,88),label(169,76,"여우",21),label(8,132,"생산자",13),label(82,132,"1차 소비자",13),label(167,132,"2차 소비자",13)],
    "stencil-solar-system": () => [ellipse(14,71,62,119,{fill:true}),...[50,72,96,124,158].map((r)=>ellipse(120-r,95-r*.42,120+r,95+r*.42,{alpha:.35})),ellipse(81,91,89,99,{fill:true}),ellipse(113,89,125,101,{fill:true}),ellipse(151,87,167,103,{fill:true}),ellipse(190,84,210,106,{fill:true}),label(8,126,"태양",13),label(168,126,"행성 공전",13)],
    "stencil-moon-phases": () => [ellipse(12,62,52,102),ellipse(57,62,97,102),line(77,63,77,101),ellipse(102,62,142,102,{fill:true}),ellipse(147,62,187,102),line(167,63,167,101),ellipse(192,62,232,102),label(8,111,"삭",13),label(52,111,"상현",13),label(101,111,"보름",13),label(145,111,"하현",13),label(197,111,"삭",13)],
    "stencil-earth-layers": () => [ellipse(30,5,210,185),ellipse(55,30,185,160),ellipse(82,57,158,133),ellipse(105,80,135,110,{fill:true}),line(120,95,211,30),label(154,18,"지각",13),label(163,47,"맨틀",13),label(145,75,"외핵",13),label(91,92,"내핵",13)],
    "stencil-water-cycle": () => [ellipse(24,126,216,175),arc(120,76,25,Math.PI,Math.PI*2,10),arc(88,82,20,Math.PI,Math.PI*2,8),arc(150,83,18,Math.PI,Math.PI*2,8),line(68,83,168,83),ellipse(27,20,61,54,{fill:true}),...[0,1,2,3,4,5,6,7].map((i)=>line(44+Math.cos(i*Math.PI/4)*24,37+Math.sin(i*Math.PI/4)*24,44+Math.cos(i*Math.PI/4)*34,37+Math.sin(i*Math.PI/4)*34)),arrow(65,147,82,100),arrow(171,91,183,139),label(51,105,"증발",14),label(158,105,"강수",14),label(94,53,"응결",14)],
    "stencil-weather-front": () => [line(20,70,220,70,{width:4}),...[45,85,125,165,205].map((x)=>poly([[x-8,70],[x,54],[x+8,70]],{closed:true,fill:true})),label(70,26,"한랭전선",16),line(20,130,220,130,{width:4}),...[45,85,125,165,205].map((x)=>arc(x,130,9,Math.PI,Math.PI*2,8,{fill:false})),label(70,146,"온난전선",16)],
    "stencil-tectonic-plates": () => [poly([[15,86],[70,80],[105,94],[135,94],[170,80],[225,86]]),arrow(105,70,48,70),arrow(135,70,192,70),poly([[105,94],[120,118],[135,94]]),arc(82,135,34,0,Math.PI,12),arc(158,135,34,Math.PI,Math.PI*2,12),arrow(52,139,83,118),arrow(188,139,157,118),label(90,36,"판 경계",15),label(76,157,"맨틀 대류",15)]
  };
  const factory = groups[id];
  if (!factory) return null;
  return { type:"group", x:0,y:0,w:240,h:190,sourceW:240,sourceH:190,items:factory(),role:"education-stencil",educationId:id };
}

function whiteboardFormulaSvg(mathMl, color="#111111", width=320, height=80){
  const c = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : "#111111";
  const w = Math.max(48, Math.ceil(Number(width) || 320)), h = Math.max(42, Math.ceil(Number(height) || 80));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:max-content;max-width:${w}px;height:${h}px;padding:6px;color:${c};font-size:32px;line-height:1.25;font-family:Cambria Math,Times New Roman,serif;white-space:nowrap">${String(mathMl || "")}</div></foreignObject></svg>`;
}

function whiteboardSvgDataUrl(svg){ return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(svg || "")); }
function boardRecoveryKey(name){ return BOARD_RECOVERY_PREFIX + String(name || "화이트보드"); }
// 저장된 스냅샷(자동복원·메모 블록)을 편집 가능한 보드 상태로 되살린다. 이미지는 src(data URL)만
// 들고 있다가 renderWhiteboard 의 restoreBoardImages 가 <img> 로 되살린다.
function validBoardSnapshot(saved){
  if (!saved || typeof saved !== "object" || saved.version !== 1 || !Array.isArray(saved.items)) return null;
  return saved;
}
function boardStateFromSnapshot(saved){
  const snapshot = validBoardSnapshot(saved);
  if (!snapshot) return null;
  return { tool:"pen", color:"#111111", width:4, bg:snapshot.bg || "#ffffff", items:snapshot.items, selected:null };
}
// 메모 에셋과 자동복원본이 모두 있으면 더 최근 스냅샷을 쓴다. 예전 스냅샷처럼 시각이
// 없거나 같으면 메모에 확정 저장된 supplied 쪽을 우선해 낡은 복구본이 덮어쓰지 않게 한다.
function chooseBoardSnapshot(supplied, recovered){
  const primary = validBoardSnapshot(supplied), recovery = validBoardSnapshot(recovered);
  if (!primary) return recovery;
  if (!recovery) return primary;
  return (Number(recovery.savedAt) || 0) > (Number(primary.savedAt) || 0) ? recovery : primary;
}
function readBoardRecoverySnapshot(name){
  try { return validBoardSnapshot(JSON.parse(localStorage.getItem(boardRecoveryKey(name)) || "null")); }
  catch(_){ return null; }
}
function readBoardRecovery(name){
  return boardStateFromSnapshot(readBoardRecoverySnapshot(name));
}
/* options.state       — 메모 블록 등에서 받은 보드 스냅샷({version,bg,items}). 주면 자동복원 대신 이걸로 연다.
   options.name        — 탭 이름(메모에서 열 때 원래 보드 이름을 되살린다)
   options.memoBlockId — 이 보드가 온 메모 이미지 블록 id. "메모로"를 다시 누르면 그 블록을 제자리에서 바꾼다. */
function newWhiteboard(options={}){
  _boardCount++;
  const name = String(options.name || "").trim() || (_boardCount > 1 ? ("화이트보드 " + _boardCount) : "화이트보드");
  const doc = makeDoc("board", name, {});
  doc.memoBlockId = String(options.memoBlockId || "") || null;
  // 같은 이름의 일반 보드와 자동복원 칸을 나눠 쓰고, 전체 백업 복원 시 전달된 식별자도 받는다.
  doc.boardRecoveryName = String(options.recoveryName || "").trim()
    || (doc.memoBlockId ? "메모블록:" + doc.memoBlockId : "");
  const recoveryName = doc.boardRecoveryName || name;
  const snapshot = chooseBoardSnapshot(options.state, readBoardRecoverySnapshot(recoveryName));
  const restored = boardStateFromSnapshot(snapshot);
  // 복원한 판서도 ● 를 켜지 않는다 — 이 스냅샷 자체가 이미 자동 저장된 결과다(아래 recordCommit 주석 참고).
  if (restored) doc.boardState = restored;
  doc.render = async () => { const host = doc.el; host.innerHTML = ""; host.scrollTop = 0; renderWhiteboard(doc, host); };
  if (typeof refreshChrome === "function") refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

function renderWhiteboard(doc, host){
  host.classList.add("wb-doc");
  const wrap = document.createElement("div"); wrap.className = "wb-wrap";
  const tools = document.createElement("div"); tools.className = "wb-tools";
  const stage = document.createElement("div"); stage.className = "wb-stage";
  const canvas = document.createElement("canvas"); canvas.className = "wb-canvas";
  stage.appendChild(canvas);
  wrap.append(tools, stage); host.appendChild(wrap);

  const ctx = canvas.getContext("2d");
  let dpr = 1, W = 0, H = 0;
  // wb: 보드 상태(전역 active 문서 변수 state 와 헷갈리지 않게 이름 분리)
  // 탭을 다시 그려도 판서 모델을 문서에 붙여 유지한다. 저장 전 변경은 공통
  // 문서 상태에 전달돼 탭 닫기·새로고침 때도 놓치지 않는다.
  const wb = doc.boardState || (doc.boardState = { tool: "pen", color: "#111111", width: 4, items: [], bg: "#ffffff", selected: null });
  let boardRecoveryTimer = 0;
  // 저장·전송 공용 직렬화: <img> 객체는 못 담으므로 data URL(src)만 남긴다.
  const boardSnapshot = () => ({
    version:1,
    savedAt:Date.now(),
    bg:wb.bg,
    items:wb.items.map(item => {
      const copy = { ...item };
      if (copy.type === "image"){ copy.src = copy.src || (copy.img && (copy.img.__boardSrc || copy.img.src)) || ""; delete copy.img; }
      return copy;
    })
  });
  const saveBoardRecoveryNow = () => {
    clearTimeout(boardRecoveryTimer); boardRecoveryTimer = 0;
    try {
      localStorage.setItem(boardRecoveryKey(doc.boardRecoveryName || doc.name), JSON.stringify(boardSnapshot()));
      return true;
    } catch(error){
      console.warn("whiteboard recovery snapshot skipped:", error);
      return false;
    }
  };
  // 탭 닫기·브라우저 종료 직전엔 0.5초 디바운스를 건너뛰고 마지막 획까지 즉시 저장한다.
  doc.flushBoardRecovery = saveBoardRecoveryNow;
  const scheduleBoardRecovery = () => {
    clearTimeout(boardRecoveryTimer);
    boardRecoveryTimer = setTimeout(saveBoardRecoveryNow, 500);
  };

  // ----- 모델 → 캔버스 (그리기는 board-render.js 공용 함수 사용 → 리플레이 재생과 화면이 일치) -----
  const {
    applyStroke: applyBoardStroke,
    drawItem: drawBoardItem,
    itemBounds: boardItemBounds,
    hitTestItem: hitTestBoardItem,
    translateItem: translateBoardItem,
    ungroupItem: ungroupBoardItem
  } = MNBoardRenderer;
  const applyStroke = (it) => applyBoardStroke(ctx, it, wb.bg);
  const drawItem = (it) => drawBoardItem(ctx, it, wb.bg);
  const measureBoardText = (line, fontSize) => {
    ctx.save(); ctx.font = fontSize + 'px system-ui,"Malgun Gothic",sans-serif';
    const width = ctx.measureText(String(line || "")).width; ctx.restore(); return width;
  };
  const boundsOf = (it) => boardItemBounds(it, measureBoardText);
  // 수업 리플레이: 녹화 중이면 커밋(획/도형/텍스트/이미지/지우기/되돌리기)마다 스냅샷을 남긴다.
  /* 화이트보드는 디스크 파일 형식이 없는 가상 문서라 "저장"으로 끌 수 있는 ● 가 없다.
     대신 커밋마다 localStorage 복구본을 남겨(scheduleBoardRecovery) 탭을 닫거나 새로고침해도
     같은 이름으로 열면 그대로 돌아온다. app.js 가 보드를 닫기·새로고침 경고에서 빼는 것도 같은 이유다.
     그래서 markDocumentDirty 를 켜지 않는다 — 켜면 끄는 길이 없어 ● 가 영영 남는다. */
  const recordCommit = () => {
    scheduleBoardRecovery();
    if (doc.recorder && doc.recorder.active){ try { doc.recorder.capture(wb.items, wb.bg, { W, H }); } catch(_){} }
  };
  const HANDLE = 12;                                  // 크기조절 핸들 한 변 크기(클릭 판정에도 사용)
  // 8방향 핸들: hx/hy ∈ {0=왼/위, 0.5=가운데, 1=오른/아래}. 가운데(0.5,0.5) 제외.
  const HANDLES = [
    { hx:0,   hy:0,   cur:"nwse-resize" }, { hx:0.5, hy:0,   cur:"ns-resize" }, { hx:1, hy:0,   cur:"nesw-resize" },
    { hx:0,   hy:0.5, cur:"ew-resize" },                                        { hx:1, hy:0.5, cur:"ew-resize" },
    { hx:0,   hy:1,   cur:"nesw-resize" }, { hx:0.5, hy:1,   cur:"ns-resize" }, { hx:1, hy:1,   cur:"nwse-resize" }
  ];
  const handlePos = (it, h) => ({ x: it.x + it.w * h.hx, y: it.y + it.h * h.hy });
  const handleAt = (it, p) => {
    if (!it || (it.type !== "image" && it.type !== "group")) return null;
    for (const h of HANDLES){ const hp = handlePos(it, h); if (Math.abs(p.x - hp.x) <= HANDLE && Math.abs(p.y - hp.y) <= HANDLE) return h; }
    return null;
  };
  let editingTextItem = null, openFormulaEditor = null, groupActionBtn = null;
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = wb.bg; ctx.fillRect(0, 0, W, H);
    for (const it of wb.items) if (it !== editingTextItem) drawItem(it);
    const s = wb.selected;                            // 선택 표시(점선 테두리, 이미지는 8핸들). 내보낼 땐 잠시 해제하므로 안 박힘.
    const sb = s && boundsOf(s);
    if (s && sb){
      ctx.save(); ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = "#2563eb";
      const resizable = s.type === "image" || s.type === "group";
      const pad = resizable ? 0 : 4;
      ctx.setLineDash([6, 4]); ctx.strokeRect(sb.x - pad, sb.y - pad, Math.max(1, sb.w) + pad * 2, Math.max(1, sb.h) + pad * 2); ctx.setLineDash([]);
      if (resizable){
        ctx.fillStyle = "#fff";
        for (const h of HANDLES){ const hp = handlePos(s, h); ctx.fillRect(hp.x - HANDLE / 2, hp.y - HANDLE / 2, HANDLE, HANDLE); ctx.strokeRect(hp.x - HANDLE / 2, hp.y - HANDLE / 2, HANDLE, HANDLE); }
      }
      ctx.restore();
    }
    if (groupActionBtn) groupActionBtn.disabled = !(s && s.type === "group");
  };
  const restoreBoardImages = () => {
    for (const item of wb.items){
      if (!item || item.type !== "image" || item.img || !item.src) continue;
      const img = new Image();
      img.onload = () => { item.img = img; img.__boardSrc = item.src; redraw(); };
      img.onerror = () => { console.warn("whiteboard recovery image skipped"); };
      img.src = item.src;
    }
  };
  // 스냅샷은 항목 배열의 얕은 복사 — 항목 객체 자체를 제자리에서 고치면 이전 단계가 망가지므로
  // 기존 항목을 바꿀 때는 사본으로 교체한다(beginSelDrag 참고).
  const history = MNEditHistory.create({
    limit: MNEditHistory.LIMITS.board,
    capture: () => wb.items.slice(),
    apply: (items) => { wb.items = items.slice(); wb.selected = null; redraw(); },
    // 항목은 통째로 교체만 하고 제자리에서 고치지 않으므로 참조 비교로 충분하다.
    isEqual: (a, b) => a.length === b.length && a.every((it, i) => it === b[i]),
    onChange: () => updateUndoButtons(),
  });
  const doUndo = () => { if (history.undo()) recordCommit(); };
  const doRedo = () => { if (history.redo()) recordCommit(); };
  const clearAll = () => { if (!wb.items.length) return; wb.items = []; wb.selected = null; redraw(); history.commit(); recordCommit(); };
  const ungroupSelected = () => {
    const selected = wb.selected;
    if (!selected || selected.type !== "group") return;
    const idx = wb.items.indexOf(selected), children = ungroupBoardItem(selected);
    if (idx < 0 || !children.length) return;
    wb.items.splice(idx, 1, ...children); wb.selected = null; redraw(); history.commit(); recordCommit();
    if (typeof toast === "function") toast("교육 도형을 구성 요소로 분리했어요.", 1800);
  };

  // ----- 사이즈/DPR (리사이즈해도 좌표는 CSS px 그대로라 그림 위치 유지) -----
  const resize = () => {
    const r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    redraw();
  };

  // ----- 포인터 그리기 -----
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // 선택 도구: 이미지·도형·텍스트 중 위에 그려진 항목부터 히트테스트
  const itemAt = (p) => {
    for (let i = wb.items.length - 1; i >= 0; i--){ const it = wb.items[i]; if (hitTestBoardItem(it, p, measureBoardText, 7)) return it; }
    return null;
  };
  const beginSelDrag = (e, mode, handle) => {
    canvas.setPointerCapture(e.pointerId);
    const it = wb.selected; const start = pt(e);
    const o = (it.type === "image" || it.type === "group") ? { left: it.x, top: it.y, right: it.x + it.w, bottom: it.y + it.h } : null;
    const idx = wb.items.indexOf(it);
    let live = it, cloned = false;
    const move = (ev) => {
      const q = pt(ev);
      if (mode === "move"){
        live = translateBoardItem(it, q.x - start.x, q.y - start.y);
        wb.items[idx] = live; wb.selected = live; cloned = true;
      } else {                                          // 핸들이 잡은 변/모서리만 이동(반대편 고정), 가로·세로 독립
        // 이전 단계 스냅샷이 이 항목 객체를 함께 가리키므로, 제자리에서 고치지 않고 사본으로 바꿔 끼운다.
        if (!cloned){ live = Object.assign({}, it); wb.items[idx] = live; wb.selected = live; cloned = true; }
        if (handle.hx === 0){ const nx = Math.min(q.x, o.right - 24); live.x = nx; live.w = o.right - nx; }
        else if (handle.hx === 1){ live.x = o.left; live.w = Math.max(24, q.x - o.left); }
        if (handle.hy === 0){ const ny = Math.min(q.y, o.bottom - 16); live.y = ny; live.h = o.bottom - ny; }
        else if (handle.hy === 1){ live.y = o.top; live.h = Math.max(16, q.y - o.top); }
      }
      redraw();
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      redraw(); if (cloned){ history.commit(); recordCommit(); }   // 드래그 한 번을 한 단계로
    };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  };
  const startSelect = (e) => {
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    if (h){ beginSelDrag(e, "resize", h); return; }                                       // 핸들 → 그 방향으로 크기조절
    const item = itemAt(p);
    wb.selected = item || null; redraw();
    if (item) beginSelDrag(e, "move");                                                    // 항목 본체 → 이동
  };
  let cur = null, drawing = false, lastPt = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (wb.tool === "select"){ startSelect(e); return; }
    if (wb.tool === "text"){ e.preventDefault(); startText(pt(e)); return; }
    canvas.setPointerCapture(e.pointerId); drawing = true;
    const p = pt(e);
    if (wb.tool === "pen" || wb.tool === "highlighter" || wb.tool === "eraser"){
      const w = wb.tool === "eraser" ? Math.max(16, wb.width * 5) : (wb.tool === "highlighter" ? wb.width * 3 : wb.width);
      cur = { type: wb.tool, color: wb.color, width: w, points: [p] };
    } else {
      cur = { type: wb.tool, color: wb.color, width: wb.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    }
    lastPt = p;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing || !cur) return;
    const p = pt(e);
    if (cur.points){
      cur.points.push(p);
      applyStroke(cur); ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.globalAlpha = 1;
      lastPt = p;
    } else {
      cur.x2 = p.x; cur.y2 = p.y; redraw(); drawItem(cur);
    }
  });
  const finishStroke = () => {
    if (!drawing){ return; }
    drawing = false;
    if (!cur){ return; }
    if (!cur.points && Math.abs(cur.x2 - cur.x1) < 2 && Math.abs(cur.y2 - cur.y1) < 2){ cur = null; redraw(); return; }  // 점 찍힌 도형 무시
    wb.items.push(cur); cur = null; redraw(); history.commit(); recordCommit();
  };
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  // 선택 도구 호버 커서: 선택 가능한 항목 위=이동, 이미지 핸들=크기조절
  canvas.addEventListener("pointermove", (e) => {
    if (wb.tool !== "select" || drawing) return;
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    canvas.style.cursor = h ? h.cur : (itemAt(p) ? "move" : "default");
  });
  canvas.addEventListener("dblclick", (e) => {
    if (wb.tool !== "select") return;
    const item = itemAt(pt(e));
    if (!item) return;
    if (item.type === "image" && item.role === "education-formula" && typeof openFormulaEditor === "function"){
      e.preventDefault(); e.stopPropagation(); openFormulaEditor(item); return;
    }
    if (item.type !== "text") return;
    e.preventDefault(); e.stopPropagation(); startText({ x:item.x, y:item.y }, item);
  });

  // ----- 텍스트 도구: 클릭 위치에 인라인 입력 -----
  function startText(p, existing){
    const ta = document.createElement("textarea"); ta.className = "wb-textinput"; ta.rows = 1;
    const fs = existing ? Math.max(14, Number(existing.fontSize) || 16) : Math.max(14, wb.width * 4);
    const color = existing ? existing.color : wb.color;
    ta.style.left = p.x + "px"; ta.style.top = p.y + "px"; ta.style.color = color; ta.style.fontSize = fs + "px";
    ta.placeholder = "텍스트 입력";
    if (existing){
      ta.value = String(existing.text || "");
      const b = boundsOf(existing);
      if (b){ ta.style.width = Math.max(120, b.w + 16) + "px"; ta.style.height = Math.max(fs * 1.5, b.h + 8) + "px"; }
      editingTextItem = existing; wb.selected = null; redraw();
    }
    stage.appendChild(ta);
    // pointerdown 중 만든 입력창은 같은 클릭의 기본 포커스 처리로 즉시 blur 될 수 있어 다음 프레임에 포커스한다.
    requestAnimationFrame(() => {
      if (!ta.isConnected) return;
      ta.focus({ preventScroll:true });
      if (existing) ta.select();
    });
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const txt = ta.value; ta.remove();
      editingTextItem = null;
      if (existing){
        const idx = wb.items.indexOf(existing);
        if (idx < 0){ redraw(); return; }
        if (txt.trim()){
          const item = Object.assign({}, existing, { text:txt });
          wb.items[idx] = item; wb.selected = item;
        } else {
          wb.items.splice(idx, 1); wb.selected = null;
        }
        redraw(); history.commit(); recordCommit(); return;
      }
      if (txt.trim()){
        const item = { type: "text", color: wb.color, x: p.x, y: p.y, text: txt, fontSize: fs };
        wb.items.push(item); wb.selected = item; setTool("select"); redraw(); history.commit(); recordCommit();
      }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){
        e.preventDefault(); done = true; ta.remove(); editingTextItem = null;
        if (existing) wb.selected = existing; redraw();
      }
      else if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); ta.blur(); }
      e.stopPropagation();
    });
  }

  // ----- 이미지 넣기(캡처 붙여넣기·드래그드롭·파일선택) -----
  const imageUrls = [];                              // 이전 버전 object URL 정리 호환용(새 삽입은 복구 가능한 data URL 사용)
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image-read-failed"));
    reader.readAsDataURL(blob);
  });
  const loadImageBlob = async (blob) => {
    const src = await blobToDataUrl(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { img.__boardSrc = src; resolve(img); };
      img.onerror = () => reject(new Error("image-load-failed"));
      img.src = src;
    });
  };
  // (cx,cy) 중심으로 스테이지에 맞춰 축소 배치. cx/cy 없으면 화면 중앙.
  const placeImage = (img, cx, cy, extra={}) => {
    const maxW = W * 0.85, maxH = H * 0.85;
    let w = img.naturalWidth || 300, h = img.naturalHeight || 200;
    const sc = Math.min(1, maxW / w, maxH / h); w = Math.round(w * sc); h = Math.round(h * sc);
    const ccx = (cx == null) ? W / 2 : cx, ccy = (cy == null) ? H / 2 : cy;
    let x = Math.round(ccx - w / 2), y = Math.round(ccy - h / 2);
    x = Math.max(0, Math.min(x, Math.max(0, W - w))); y = Math.max(0, Math.min(y, Math.max(0, H - h)));
    const it = Object.assign({ type: "image", img, src:img.__boardSrc || img.src || "", x, y, w, h }, extra);
    wb.items.push(it);
    wb.selected = it; setTool("select");              // 넣자마자 선택 상태 + 선택 도구 → 바로 드래그로 위치·크기 조절
    redraw(); history.commit(); recordCommit();
  };
  const insertImageBlob = (blob, cx, cy) => {
    if (!blob || !/^image\//.test(blob.type)){ return false; }
    loadImageBlob(blob).then(img => placeImage(img, cx, cy)).catch(() => { if (typeof toast === "function") toast("이미지를 넣지 못했어요.", 2000); });
    return true;
  };
  const educationCatalog = whiteboardEducationCatalog();
  let formulaLibrary;
  try { formulaLibrary = normalizeWhiteboardFormulaLibrary(JSON.parse(localStorage.getItem(WB_FORMULA_LIBRARY_KEY) || "null")); }
  catch(_){ formulaLibrary = normalizeWhiteboardFormulaLibrary(null); }
  const educationById = new Map();
  const allEducationEntries = () => educationCatalog.concat(formulaLibrary.custom);
  const syncEducationIndex = () => {
    educationById.clear();
    for (const entry of allEducationEntries()) educationById.set(entry.id, entry);
  };
  const saveFormulaLibrary = () => {
    formulaLibrary = normalizeWhiteboardFormulaLibrary(formulaLibrary);
    syncEducationIndex();
    try { localStorage.setItem(WB_FORMULA_LIBRARY_KEY, JSON.stringify(formulaLibrary)); } catch(_){}
  };
  const rememberFormula = (id) => {
    if (!id || !educationById.has(id)) return;
    formulaLibrary.recent = [id, ...formulaLibrary.recent.filter((value) => value !== id)].slice(0, 20);
    saveFormulaLibrary();
  };
  syncEducationIndex();
  const FORMULA_MAX_CHARS = 4000;
  const loadBoardImageSource = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { img.__boardSrc = src; resolve(img); };
    img.onerror = () => reject(new Error("education-image-load-failed"));
    img.src = src;
  });
  const formulaMathMl = (source) => {
    if (typeof PdfSignerCore !== "undefined" && PdfSignerCore && typeof PdfSignerCore.latexToMathML === "function")
      return PdfSignerCore.latexToMathML(String(source || ""), false);
    const safe = document.createElement("span"); safe.textContent = String(source || "");
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline"><mtext>${safe.innerHTML}</mtext></math>`;
  };
  const buildFormulaImage = (source, color) => {
    const mathMl = formulaMathMl(source);
    const probe = document.createElement("div"); probe.className = "wb-formula-probe"; probe.innerHTML = mathMl; stage.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    const width = Math.min(900, Math.max(80, Math.ceil(rect.width) + 18));
    const height = Math.min(260, Math.max(54, Math.ceil(rect.height) + 16));
    probe.remove();
    const src = whiteboardSvgDataUrl(whiteboardFormulaSvg(mathMl, color, width, height));
    return loadBoardImageSource(src).then((img) => ({ img, src, width, height }));
  };
  const insertFormulaSource = (source, cx, cy, existing=null) => {
    source = String(source || "").trim();
    if (!source){ if (typeof toast === "function") toast("수식을 입력하세요.", 1800); return false; }
    if (source.length > FORMULA_MAX_CHARS){ if (typeof toast === "function") toast("수식이 너무 깁니다. 4,000자 이하로 입력하세요.", 2200); return false; }
    const formulaColor = existing && existing.formulaColor ? existing.formulaColor : wb.color;
    buildFormulaImage(source, formulaColor).then(({img,src,width:baseW,height:baseH}) => {
      if (!existing){
        placeImage(img, cx, cy, { role:"education-formula", formulaSource:source, formulaColor, formulaBaseW:baseW, formulaBaseH:baseH, src });
        return;
      }
      const idx = wb.items.indexOf(existing); if (idx < 0) return;
      const centerX = existing.x + existing.w / 2, centerY = existing.y + existing.h / 2;
      const displayScale = existing.formulaBaseH ? Math.max(.2, existing.h / existing.formulaBaseH) : 1;
      let w = (img.naturalWidth || baseW) * displayScale, h = (img.naturalHeight || baseH) * displayScale;
      const sc = Math.min(1, W * .85 / w, H * .85 / h); w = Math.round(w * sc); h = Math.round(h * sc);
      const x=Math.max(0,Math.min(Math.round(centerX-w/2),Math.max(0,W-w))), y=Math.max(0,Math.min(Math.round(centerY-h/2),Math.max(0,H-h)));
      const item = { type:"image",img,src,x,y,w,h,role:"education-formula",formulaSource:source,formulaColor,formulaBaseW:baseW,formulaBaseH:baseH };
      wb.items[idx] = item; wb.selected = item; redraw(); history.commit(); recordCommit();
    }).catch(() => { if (typeof toast === "function") toast("수식을 그리지 못했어요.", 2000); });
    return true;
  };
  const insertEducationEntry = (entryOrId, cx, cy) => {
    const entry = typeof entryOrId === "string" ? educationById.get(entryOrId) : entryOrId;
    if (!entry) return false;
    const centerX = cx == null ? W / 2 : cx, centerY = cy == null ? H / 2 : cy;
    if (entry.kind === "formula"){ rememberFormula(entry.id); return insertFormulaSource(entry.source, centerX, centerY); }
    if (entry.kind === "text"){
      let fontSize = entry.category === "formula" ? 27 : 32;
      const content = String(entry.value || "");
      let textW = measureBoardText(content, fontSize);
      if (textW > W - 16 && W > 32){
        fontSize = Math.max(16, Math.floor(fontSize * (W - 16) / textW));
        textW = measureBoardText(content, fontSize);
      }
      const item = {
        type:"text", color:wb.color,
        x:Math.max(8, Math.min(centerX - textW / 2, Math.max(8, W - textW - 8))),
        y:Math.max(8, Math.min(centerY - fontSize * 0.7, Math.max(8, H - fontSize * 1.4))),
        text:content, fontSize,
        educationId:entry.id
      };
      wb.items.push(item); wb.selected = item; setTool("select"); redraw(); history.commit(); recordCommit();
      return true;
    }
    const group = whiteboardStencilGroup(entry.id, wb.color);
    if (!group) return false;
    const sc = Math.min(1, W * .85 / group.w, H * .85 / group.h);
    group.w = Math.round(group.w * sc); group.h = Math.round(group.h * sc);
    group.x = Math.max(0, Math.min(Math.round(centerX - group.w / 2), Math.max(0, W - group.w)));
    group.y = Math.max(0, Math.min(Math.round(centerY - group.h / 2), Math.max(0, H - group.h)));
    group.educationLabel = entry.label;
    wb.items.push(group); wb.selected = group; setTool("select"); redraw(); history.commit(); recordCommit();
    return true;
  };
  // 붙여넣기(Ctrl+V): 이 보드가 활성이고 텍스트 입력 중이 아닐 때 클립보드 이미지를 넣는다.
  const onPaste = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("wb-textinput")) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items){
      if (it.kind === "file" && /^image\//.test(it.type)){
        const blob = it.getAsFile();
        if (blob){ e.preventDefault(); insertImageBlob(blob); return; }
      }
    }
  };
  document.addEventListener("paste", onPaste);
  // 드래그&드롭: 캡처/이미지 파일을 보드에 떨구면 그 위치에 넣는다.
  stage.addEventListener("dragover", (e) => {
    if (!e.dataTransfer) return;
    const hasEducation = [...(e.dataTransfer.types || [])].includes(WB_EDU_TRANSFER_TYPE);
    const hasFile = [...(e.dataTransfer.items || [])].some(i => i.kind === "file");
    if (hasEducation || hasFile){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  });
  stage.addEventListener("drop", (e) => {
    const educationId = e.dataTransfer && e.dataTransfer.getData(WB_EDU_TRANSFER_TYPE);
    if (educationId){
      e.preventDefault(); e.stopPropagation();
      const p = pt(e); insertEducationEntry(educationId, p.x, p.y); return;
    }
    const files = (e.dataTransfer && e.dataTransfer.files) || [];
    const imgFile = [...files].find(f => /^image\//.test(f.type));
    if (imgFile){ e.preventDefault(); e.stopPropagation(); const p = pt(e); insertImageBlob(imgFile, p.x, p.y); }
  });

  // 내보내기 전 선택 표시(점선·핸들)를 잠깐 지워 PNG/PDF 에 안 박히게 한다.
  const withoutSelection = (fn) => { const sel = wb.selected; if (sel){ wb.selected = null; redraw(); } try { return fn(); } finally { if (sel){ wb.selected = sel; } } };

  // ----- 내보내기 -----
  // notify: 버튼을 누른 게 아니라 Ctrl+S 로 부른 경우 — 화면에 아무 변화가 없어 알려줘야 한다.
  const exportPng = (options={}) => {
    const sel = wb.selected; if (sel){ wb.selected = null; redraw(); }
    canvas.toBlob((b) => {
      if (sel){ wb.selected = sel; redraw(); }
      if (!b){ if (typeof toast === "function") toast("이미지를 저장하지 못했어요.", 2000, { type: "error" }); return; }
      const u = URL.createObjectURL(b); const a = document.createElement("a");
      a.href = u; a.download = (doc.name || "화이트보드") + ".png";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
      if (options.notify && typeof toast === "function") toast("PNG 이미지로 저장했어요.", 2200);
    }, "image/png");
  };
  // Ctrl+S 진입점(app.js). 없으면 브라우저 기본 "웹페이지 저장(HTML)"이 떠 버린다.
  doc.saveBoardPng = () => exportPng({ notify:true });
  // 메모창으로 보내기: 보이는 그림(PNG)과 편집용 벡터 스냅샷을 함께 넘겨,
  // 메모 이미지 블록의 "✏️ 화이트보드로"로 다시 편집할 수 있게 한다.
  const sendToMemo = () => {
    if (typeof window.addBoardToScratchpad !== "function"){
      if (typeof toast === "function") toast("메모창을 열 수 없어요.", 2200, { type:"error" });
      return;
    }
    if (!wb.items.length){ if (typeof toast === "function") toast("보드가 비어 있어요.", 2000); return; }
    const snapshot = boardSnapshot();                    // 선택 해제 전에 떠도 모델은 같다
    const sel = wb.selected; if (sel){ wb.selected = null; redraw(); }
    canvas.toBlob(async (blob) => {
      if (sel){ wb.selected = sel; redraw(); }
      if (!blob){ if (typeof toast === "function") toast("메모로 보내지 못했어요.", 2200, { type:"error" }); return; }
      try {
        const result = await window.addBoardToScratchpad(blob, snapshot, {
          name:(doc.name || "화이트보드") + ".png",
          boardName:doc.name || "화이트보드",
          blockId:doc.memoBlockId                        // 있으면 그 블록을 제자리에서 교체
        });
        if (result && result.blockId) doc.memoBlockId = result.blockId;
      } catch(error){
        console.error(error);
        if (typeof toast === "function") toast("메모로 보내지 못했어요.", 2200, { type:"error" });
      }
    }, "image/png");
  };
  const exportPdf = async () => {
    if (typeof PDFLib === "undefined"){ if (typeof toast === "function") toast("PDF 라이브러리를 불러오지 못했어요.", 2200); return; }
    try {
      const png = withoutSelection(() => canvas.toDataURL("image/png"));
      if (wb.selected) redraw();
      const { PDFDocument } = PDFLib;
      const pdf = await PDFDocument.create();
      const img = await pdf.embedPng(png);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      const bytes = await pdf.save();
      if (typeof downloadPdfBytes === "function") downloadPdfBytes(bytes, (doc.name || "화이트보드") + ".pdf");
    } catch(e){ console.error(e); if (typeof toast === "function") toast("PDF로 저장하지 못했어요.", 2200, { type: "error" }); }
  };

  // ----- 도구막대 -----
  const COLORS = [
    ["#111111", "검정"], ["#e11d48", "빨강"], ["#2563eb", "파랑"], ["#16a34a", "초록"],
    ["#f59e0b", "주황"], ["#7c3aed", "보라"], ["#ffffff", "흰색"]
  ];
  const WB_ICONS = {
    select: '<path d="M5 3l12 9-6.2 1.2L8 19.5z"/><path d="m11 13 4.5 6.5"/>',
    pen: '<path d="m4 20 4.4-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.4 16z"/><path d="m14.7 6.7 3 3M5.4 16l3 3"/>',
    highlighter: '<path d="m7 14 7.8-7.8 3 3L10 17z"/><path d="m13.3 7.7 3 3M7 14l3 3M4 20h12"/>',
    eraser: '<path d="m4.7 14.3 8.6-8.6a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L9 20H6.4l-3.1-3.1a1.8 1.8 0 0 1 0-2.6z"/><path d="m10.5 8.5 5 5M9 20h11"/>',
    line: '<path d="M5 19 19 5"/>',
    arrow: '<path d="M5 19 19 5M11 5h8v8"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"/>',
    undo: '<path d="M9 7 5 11l4 4"/><path d="M5 11h8a6 6 0 0 1 6 6"/>',
    redo: '<path d="m15 7 4 4-4 4"/><path d="M19 11h-8a6 6 0 0 0-6 6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'
  };
  const TOOLS = [
    ["select", "select", "선택·이동 (이미지·수식·교육 도형 옮기기·크기조절)"],
    ["pen", "pen", "펜"], ["highlighter", "highlighter", "형광펜"], ["eraser", "eraser", "지우개"],
    ["line", "line", "직선"], ["arrow", "arrow", "화살표"], ["rect", "rect", "사각형"], ["ellipse", "ellipse", "원"], ["text", "text", "텍스트"]
  ];
  const toolBtns = {};
  const swatchEls = {};
  const widthBtns = {};
  let undoBtn, redoBtn;
  const setTool = (t) => {
    wb.tool = t; for (const k in toolBtns) toolBtns[k].classList.toggle("active", k === t);
    if (t !== "select" && wb.selected){ wb.selected = null; redraw(); }   // 다른 도구로 가면 선택 해제
    canvas.style.cursor = "";
    canvas.dataset.tool = t;
  };
  const setColor = (c) => {
    wb.color = c;
    for (const k in swatchEls) swatchEls[k].classList.toggle("active", k === c);
    customColor.value = c;
    if (typeof renderEducationPanel === "function" && !eduPanel.hidden) renderEducationPanel();
  };
  const setWidth = (w) => { wb.width = w; for (const k in widthBtns) widthBtns[k].classList.toggle("active", Number(k) === w); };
  const updateUndoButtons = () => { if (undoBtn) undoBtn.disabled = !history.canUndo(); if (redoBtn) redoBtn.disabled = !history.canRedo(); };

  const mkBtn = (label, title, cls, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", fn); return b;
  };
  const mkIcon = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wb-icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = WB_ICONS[name] || "";
    return svg;
  };
  const mkIconBtn = (icon, title, cls, fn) => {
    const b = mkBtn("", title, cls, fn);
    b.appendChild(mkIcon(icon));
    return b;
  };
  const grp = () => { const g = document.createElement("span"); g.className = "wb-group"; return g; };

  // ----- 수학·과학 도구상자 -----
  const eduPanel = document.createElement("section");
  eduPanel.className = "wb-edu-panel"; eduPanel.hidden = true;
  eduPanel.id = "wb-edu-panel-" + doc.id;
  eduPanel.setAttribute("role", "dialog"); eduPanel.setAttribute("aria-label", "수학·과학 도구상자");
  const eduHead = document.createElement("div"); eduHead.className = "wb-edu-head";
  const eduTitle = document.createElement("strong"); eduTitle.textContent = "수학·과학 도구상자";
  const eduClose = mkBtn("×", "도구상자 닫기 (Esc)", "wb-edu-close", () => toggleEducationPanel(false));
  eduHead.append(eduTitle, eduClose);
  const eduSearch = document.createElement("input"); eduSearch.type = "search"; eduSearch.className = "wb-edu-search";
  eduSearch.placeholder = "기호·수식·도형 검색"; eduSearch.setAttribute("aria-label", "교육 도구 검색");
  const eduTabs = document.createElement("div"); eduTabs.className = "wb-edu-tabs"; eduTabs.setAttribute("role", "tablist");
  const formulaBuilder = document.createElement("div"); formulaBuilder.className = "wb-formula-builder"; formulaBuilder.hidden = true;
  const formulaInput = document.createElement("textarea"); formulaInput.className = "wb-formula-input"; formulaInput.rows = 2;
  formulaInput.placeholder = String.raw`LaTeX 수식 (예: \frac{a}{b}, x^2, \sqrt{x})`; formulaInput.setAttribute("aria-label", "LaTeX 수식 입력");
  const formulaPreview = document.createElement("div"); formulaPreview.className = "wb-formula-preview"; formulaPreview.setAttribute("aria-label", "수식 미리보기");
  const formulaActions = document.createElement("div"); formulaActions.className = "wb-formula-actions";
  const formulaSave = mkBtn("내 수식 저장", "현재 LaTeX 수식을 수식 사전에 저장", "wb-formula-save", openFormulaSave);
  const formulaInsert = mkBtn("수식 넣기", "입력한 수식을 화이트보드에 넣기 (Ctrl+Enter)", "wb-formula-insert", submitFormulaEditor);
  const formulaCancel = mkBtn("취소", "수식 편집 취소", "wb-formula-cancel", resetFormulaEditor); formulaCancel.hidden = true;
  formulaActions.append(formulaSave, formulaCancel, formulaInsert);
  const formulaSaveRow = document.createElement("div"); formulaSaveRow.className = "wb-formula-save-row"; formulaSaveRow.hidden = true;
  const formulaName = document.createElement("input"); formulaName.type = "text"; formulaName.maxLength = 50; formulaName.className = "wb-formula-name"; formulaName.placeholder = "내 수식 이름"; formulaName.setAttribute("aria-label", "저장할 수식 이름");
  const formulaSaveConfirm = mkBtn("저장", "내 수식 사전에 저장", "wb-formula-save-confirm", saveCustomFormula);
  const formulaSaveCancel = mkBtn("닫기", "내 수식 저장 취소", "wb-formula-save-cancel", closeFormulaSave);
  formulaSaveRow.append(formulaName, formulaSaveConfirm, formulaSaveCancel);
  formulaBuilder.append(formulaInput, formulaPreview, formulaActions, formulaSaveRow);
  const formulaGroupBar = document.createElement("div"); formulaGroupBar.className = "wb-formula-groups"; formulaGroupBar.hidden = true; formulaGroupBar.setAttribute("aria-label", "수식 분야");
  const eduSubgroupBar = document.createElement("div"); eduSubgroupBar.className = "wb-formula-groups wb-edu-subgroups"; eduSubgroupBar.hidden = true; eduSubgroupBar.setAttribute("aria-label", "도구 분야");
  const eduGrid = document.createElement("div"); eduGrid.className = "wb-edu-grid";
  const eduHint = document.createElement("p"); eduHint.className = "wb-edu-hint";
  eduHint.textContent = "클릭하면 가운데에, 끌어 놓으면 원하는 위치에 들어갑니다.";
  eduPanel.append(eduHead, eduSearch, eduTabs, formulaBuilder, formulaGroupBar, eduSubgroupBar, eduGrid, eduHint); stage.appendChild(eduPanel);

  const EDU_CATEGORIES = [
    ["symbol", "기호"], ["formula", "수식"], ["geometry", "도형"], ["science", "과학"]
  ];
  const FORMULA_GROUPS = [
    ["all", "전체"], ["recent", "최근"], ["favorite", "즐겨찾기"], ["basic", "기본"],
    ["algebra", "대수"], ["calculus", "미적분"], ["set", "집합·논리"], ["statistics", "확률·통계"],
    ["geometry-formula", "기하"], ["science-formula", "과학"], ["custom", "내 수식"]
  ];
  const STENCIL_GROUPS = {
    geometry:[["all","전체"],["plane","평면도형"],["solid","입체도형"],["construction","작도·원"],["graph","좌표·그래프"]],
    science:[["all","전체"],["mechanics","역학"],["electricity","전기"],["optics","광학"],["chemistry","화학"],["biology","생명"],["earth","지구과학"]]
  };
  const stencilGroup = { geometry:"all", science:"all" };
  let eduCategory = "symbol", formulaGroup = "all", eduToolBtn, editingFormulaItem = null;
  let formulaStops = [], formulaStopIndex = -1, formulaInputBefore = null;
  const educationMatches = (entry, term) => {
    if (entry.category !== eduCategory) return false;
    if (term){
      const haystack = [entry.label, entry.value, entry.source, entry.template, entry.preview, entry.keywords, entry.description, entry.category, entry.formulaGroup].join(" ").toLowerCase();
      if (!haystack.includes(term.toLowerCase())) return false;
    }
    if ((eduCategory === "geometry" || eduCategory === "science") && !term && stencilGroup[eduCategory] !== "all") return entry.stencilGroup === stencilGroup[eduCategory];
    if (eduCategory !== "formula" || term || formulaGroup === "all") return true;
    if (formulaGroup === "recent") return formulaLibrary.recent.includes(entry.id);
    if (formulaGroup === "favorite") return formulaLibrary.favorites.includes(entry.id);
    return entry.formulaGroup === formulaGroup;
  };
  function selectFormulaStop(index){
    if (!formulaStops.length) return false;
    formulaStopIndex = (index + formulaStops.length) % formulaStops.length;
    const stop = formulaStops[formulaStopIndex];
    formulaInput.focus({ preventScroll:true }); formulaInput.setSelectionRange(stop.start, stop.end);
    return true;
  }
  function insertFormulaTemplate(entry){
    const expanded = entry.custom ? { text:String(entry.source || ""), fields:[] } : expandWhiteboardFormulaTemplate(entry.template || entry.source || "");
    const start = formulaInput.selectionStart == null ? formulaInput.value.length : formulaInput.selectionStart;
    const end = formulaInput.selectionEnd == null ? start : formulaInput.selectionEnd;
    const delta = expanded.text.length - (end - start);
    formulaStops = formulaStops.filter((stop) => stop.end <= start || stop.start >= end).map((stop) => {
      if (stop.start >= end) return Object.assign({}, stop, { start:stop.start + delta, end:stop.end + delta });
      return stop;
    });
    formulaInput.setRangeText(expanded.text, start, end, "end");
    const inserted = expanded.fields.map((field) => ({ label:field.label, start:start + field.start, end:start + field.end }));
    formulaStops.push(...inserted); formulaStops.sort((a,b) => a.start - b.start);
    rememberFormula(entry.id); refreshFormulaPreview();
    if (inserted.length) selectFormulaStop(formulaStops.indexOf(inserted[0]));
    else { formulaInput.focus({ preventScroll:true }); formulaInput.setSelectionRange(start + expanded.text.length, start + expanded.text.length); }
    renderEducationPanel();
  }
  function openFormulaSave(){
    if (!formulaInput.value.trim()){ if (typeof toast === "function") toast("저장할 수식을 먼저 입력하세요.", 1800); formulaInput.focus(); return; }
    formulaSaveRow.hidden = false; formulaName.focus({ preventScroll:true }); formulaName.select();
  }
  function closeFormulaSave(){ formulaSaveRow.hidden = true; formulaName.value = ""; }
  function saveCustomFormula(){
    const source = formulaInput.value.trim(), label = formulaName.value.trim();
    if (!source){ if (typeof toast === "function") toast("저장할 수식을 먼저 입력하세요.", 1800); formulaInput.focus(); return; }
    if (source.length > FORMULA_MAX_CHARS){ if (typeof toast === "function") toast("수식이 너무 깁니다. 4,000자 이하로 입력하세요.", 2200); return; }
    if (!label){ if (typeof toast === "function") toast("수식 이름을 입력하세요.", 1800); formulaName.focus(); return; }
    const random = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(1))[0].toString(36) : Math.random().toString(36).slice(2,10);
    const entry = { id:"custom-" + Date.now().toString(36) + "-" + random, label:label.slice(0,50), source, template:source, preview:source, category:"formula", kind:"formula", formulaGroup:"custom", keywords:"내 수식 사용자 저장", description:"직접 저장한 수식", custom:true };
    formulaLibrary.custom.unshift(entry); saveFormulaLibrary(); closeFormulaSave(); formulaGroup = "custom"; eduSearch.value = ""; renderEducationPanel();
    if (typeof toast === "function") toast("내 수식 사전에 저장했어요.", 1800);
  }
  function toggleFormulaFavorite(entry){
    const has = formulaLibrary.favorites.includes(entry.id);
    formulaLibrary.favorites = has ? formulaLibrary.favorites.filter((id) => id !== entry.id) : [entry.id, ...formulaLibrary.favorites];
    saveFormulaLibrary(); renderEducationPanel();
  }
  function deleteCustomFormula(entry){
    const remove = () => {
      formulaLibrary.custom = formulaLibrary.custom.filter((item) => item.id !== entry.id);
      formulaLibrary.favorites = formulaLibrary.favorites.filter((id) => id !== entry.id);
      formulaLibrary.recent = formulaLibrary.recent.filter((id) => id !== entry.id);
      saveFormulaLibrary(); renderEducationPanel();
      if (typeof toast === "function") toast("내 수식에서 삭제했어요.", 1600);
    };
    if (typeof confirmDialog === "function") confirmDialog(`‘${entry.label}’ 수식을 삭제할까요?`, "삭제", "취소").then((ok) => { if (ok) remove(); });
    else remove();
  }
  function refreshFormulaPreview(){
    const source = formulaInput.value.trim();
    if (!source){ formulaPreview.textContent = "입력한 수식이 여기에 보입니다."; return; }
    if (source.length > FORMULA_MAX_CHARS){ formulaPreview.textContent = "수식이 너무 깁니다. 4,000자 이하로 입력하세요."; return; }
    formulaPreview.innerHTML = formulaMathMl(source);
  }
  function resetFormulaEditor(){
    editingFormulaItem = null; formulaInput.value = ""; formulaStops = []; formulaStopIndex = -1; formulaInputBefore = null;
    formulaInsert.textContent = "수식 넣기"; formulaCancel.hidden = true; closeFormulaSave(); refreshFormulaPreview();
  }
  function submitFormulaEditor(){
    const source = formulaInput.value.trim(); if (!source){ if (typeof toast === "function") toast("수식을 입력하세요.", 1800); formulaInput.focus(); return; }
    if (formulaStops.length){ selectFormulaStop(Math.max(0, formulaStopIndex)); if (typeof toast === "function") toast("표시된 입력 부분을 모두 채워 주세요. Tab으로 이동할 수 있어요.", 2200); return; }
    const target = editingFormulaItem;
    if (insertFormulaSource(source, W/2, H/2, target)){ resetFormulaEditor(); toggleEducationPanel(false); }
  }
  openFormulaEditor = (item) => {
    editingFormulaItem = item; eduCategory = "formula"; eduSearch.value = ""; formulaInput.value = String(item.formulaSource || ""); formulaStops = []; formulaStopIndex = -1;
    formulaInsert.textContent = "수식 바꾸기"; formulaCancel.hidden = false; refreshFormulaPreview(); toggleEducationPanel(true);
    requestAnimationFrame(() => { formulaInput.focus({preventScroll:true}); formulaInput.select(); });
  };
  formulaInput.addEventListener("beforeinput", () => {
    formulaInputBefore = { start:formulaInput.selectionStart || 0, end:formulaInput.selectionEnd || 0, oldLength:formulaInput.value.length };
  });
  formulaInput.addEventListener("input", () => {
    if (formulaInputBefore){
      const {start,end,oldLength} = formulaInputBefore, delta = formulaInput.value.length - oldLength;
      let removedThroughActive = 0;
      formulaStops = formulaStops.filter((stop,index) => {
        const consumed = start === end ? stop.start <= start && start <= stop.end : !(stop.end <= start || stop.start >= end);
        const keep = !consumed;
        if (!keep && index <= formulaStopIndex) removedThroughActive++;
        return keep;
      }).map((stop) => stop.start >= end ? Object.assign({}, stop, {start:stop.start + delta, end:stop.end + delta}) : stop);
      formulaStopIndex = Math.min(formulaStopIndex - removedThroughActive, formulaStops.length - 1);
      formulaInputBefore = null;
    }
    refreshFormulaPreview();
  });
  formulaInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); submitFormulaEditor(); }
    else if (e.key === "Tab" && formulaStops.length){ e.preventDefault(); e.stopPropagation(); selectFormulaStop(formulaStopIndex + (e.shiftKey ? -1 : 1)); }
  });
  formulaName.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); saveCustomFormula(); } else if (e.key === "Escape"){ e.preventDefault(); closeFormulaSave(); formulaInput.focus(); } });
  function renderEducationPanel(){
    const term = eduSearch.value.trim();
    eduTitle.textContent = eduCategory === "formula" ? "수학·과학 도구상자 · 수식 사전" : "수학·과학 도구상자";
    eduSearch.placeholder = eduCategory === "formula" ? "한글·영문·LaTeX 수식 검색" : eduCategory === "geometry" ? "평면·입체·작도·그래프 검색" : eduCategory === "science" ? "역학·전기·광학·화학·생명·지구 검색" : "기호·수식·도형 검색";
    formulaBuilder.hidden = eduCategory !== "formula";
    if (!formulaBuilder.hidden) refreshFormulaPreview();
    formulaGroupBar.hidden = eduCategory !== "formula";
    formulaGroupBar.textContent = "";
    if (!formulaGroupBar.hidden){
      for (const [id, label] of FORMULA_GROUPS){
        const count = id === "recent" ? formulaLibrary.recent.length : id === "favorite" ? formulaLibrary.favorites.length : id === "custom" ? formulaLibrary.custom.length : null;
        const chip = mkBtn(label + (count == null ? "" : ` ${count}`), label + " 수식 보기", "wb-formula-group" + (id === formulaGroup ? " active" : ""), () => { formulaGroup = id; eduSearch.value = ""; renderEducationPanel(); });
        chip.setAttribute("aria-pressed", id === formulaGroup ? "true" : "false"); formulaGroupBar.appendChild(chip);
      }
    }
    const subgroupOptions = STENCIL_GROUPS[eduCategory] || null;
    eduSubgroupBar.hidden = !subgroupOptions;
    eduSubgroupBar.textContent = "";
    if (subgroupOptions){
      for (const [id,label] of subgroupOptions){
        const chip = mkBtn(label, label + " 도구 보기", "wb-formula-group" + (id === stencilGroup[eduCategory] ? " active" : ""), () => { stencilGroup[eduCategory] = id; eduSearch.value = ""; renderEducationPanel(); });
        chip.setAttribute("aria-pressed", id === stencilGroup[eduCategory] ? "true" : "false"); eduSubgroupBar.appendChild(chip);
      }
    }
    eduTabs.textContent = "";
    for (const [id, label] of EDU_CATEGORIES){
      const tab = mkBtn(label, label + " 도구", "wb-edu-tab" + (id === eduCategory ? " active" : ""), () => {
        eduCategory = id; eduSearch.value = ""; renderEducationPanel();
      });
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", id === eduCategory ? "true" : "false");
      eduTabs.appendChild(tab);
    }
    eduGrid.textContent = "";
    let visible = allEducationEntries().filter((entry) => educationMatches(entry, term));
    if (eduCategory === "formula" && formulaGroup === "recent" && !term){
      const recentOrder = new Map(formulaLibrary.recent.map((id,index) => [id,index]));
      visible.sort((a,b) => recentOrder.get(a.id) - recentOrder.get(b.id));
    }
    for (const entry of visible){
      const card = document.createElement("button"); card.type = "button";
      card.className = "wb-edu-card wb-edu-" + entry.kind + (entry.category === "formula" ? " wb-edu-formula" : "");
      card.title = entry.label + (entry.kind === "formula" ? " — 입력창에 넣기 또는 보드로 끌어 놓기" : " — 클릭해서 넣기 또는 보드로 끌어 놓기");
      card.setAttribute("aria-label", entry.label); card.draggable = true;
      const visual = document.createElement("span"); visual.className = "wb-edu-visual";
      if (entry.kind === "stencil") visual.innerHTML = whiteboardStencilSvg(entry.id, wb.color);
      else if (entry.kind === "formula") visual.innerHTML = formulaMathMl(entry.source);
      else visual.textContent = entry.value;
      const label = document.createElement("span"); label.className = "wb-edu-label"; label.textContent = entry.label;
      card.append(visual, label);
      if (entry.kind === "formula" && entry.description){ const description = document.createElement("span"); description.className = "wb-edu-description"; description.textContent = entry.description; card.appendChild(description); }
      card.addEventListener("click", () => entry.kind === "formula" ? insertFormulaTemplate(entry) : insertEducationEntry(entry, W / 2, H / 2));
      card.addEventListener("dragstart", (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(WB_EDU_TRANSFER_TYPE, entry.id); e.dataTransfer.effectAllowed = "copy";
      });
      if (entry.kind !== "formula"){ eduGrid.appendChild(card); continue; }
      const shell = document.createElement("div"); shell.className = "wb-edu-formula-shell"; shell.appendChild(card);
      const cardActions = document.createElement("div"); cardActions.className = "wb-edu-card-actions";
      const favorite = mkBtn(formulaLibrary.favorites.includes(entry.id) ? "★" : "☆", formulaLibrary.favorites.includes(entry.id) ? "즐겨찾기 해제" : "즐겨찾기", "wb-formula-favorite", () => toggleFormulaFavorite(entry));
      favorite.setAttribute("aria-pressed", formulaLibrary.favorites.includes(entry.id) ? "true" : "false"); cardActions.appendChild(favorite);
      if (entry.custom) cardActions.appendChild(mkBtn("삭제", "내 수식에서 삭제", "wb-formula-delete", () => deleteCustomFormula(entry)));
      shell.appendChild(cardActions); eduGrid.appendChild(shell);
    }
    if (!visible.length){
      const empty = document.createElement("p"); empty.className = "wb-edu-empty";
      empty.textContent = eduCategory === "formula" && formulaGroup === "custom" ? "저장한 내 수식이 없어요." : eduCategory === "formula" && formulaGroup === "favorite" ? "즐겨찾기한 수식이 없어요." : eduCategory === "formula" && formulaGroup === "recent" ? "최근 사용한 수식이 없어요." : "찾는 도구가 없어요.";
      eduGrid.appendChild(empty);
    }
  }
  function toggleEducationPanel(force){
    const open = force == null ? eduPanel.hidden : !!force;
    eduPanel.hidden = !open;
    if (eduToolBtn){ eduToolBtn.classList.toggle("active", open); eduToolBtn.setAttribute("aria-expanded", open ? "true" : "false"); }
    if (open){ renderEducationPanel(); requestAnimationFrame(() => (editingFormulaItem ? formulaInput : eduSearch).focus({ preventScroll:true })); }
    else if (editingFormulaItem) resetFormulaEditor();
  }
  eduSearch.addEventListener("input", renderEducationPanel);

  const toolGroup = grp();
  TOOLS.forEach(([t, icon, title]) => { const b = mkIconBtn(icon, title, "wb-tool", () => setTool(t)); toolBtns[t] = b; toolGroup.appendChild(b); });

  const colorGroup = grp();
  COLORS.forEach(([c, name]) => {
    const s = document.createElement("button"); s.type = "button"; s.className = "wb-swatch"; s.title = name; s.setAttribute("aria-label", name); s.style.background = c;
    if (c === "#ffffff") s.style.border = "1px solid #cbd5e1";
    s.addEventListener("click", () => setColor(c)); swatchEls[c] = s; colorGroup.appendChild(s);
  });
  const customColor = document.createElement("input"); customColor.type = "color"; customColor.className = "wb-color-input"; customColor.value = wb.color; customColor.title = "색 직접 고르기";
  customColor.addEventListener("input", () => setColor(customColor.value));
  colorGroup.appendChild(customColor);

  const widthGroup = grp();
  [["2", "S", 2], ["4", "M", 4], ["8", "L", 8]].forEach(([k, label, w]) => { const b = mkBtn(label, "굵기 " + label, "wb-width", () => setWidth(w)); widthBtns[k] = b; widthGroup.appendChild(b); });

  const imgGroup = grp();
  eduToolBtn = mkBtn("∑", "수학·과학 도구상자", "wb-act wb-edu-toggle", () => toggleEducationPanel());
  eduToolBtn.setAttribute("aria-controls", eduPanel.id); eduToolBtn.setAttribute("aria-expanded", "false");
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.hidden = true;
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; if (f) insertImageBlob(f); fileInput.value = ""; });
  imgGroup.append(eduToolBtn, mkIconBtn("image", "이미지 넣기 — 파일 선택 (또는 Ctrl+V 붙여넣기·드래그드롭)", "wb-act", () => fileInput.click()), fileInput);

  const actGroup = grp();
  undoBtn = mkIconBtn("undo", "되돌리기 (Ctrl+Z)", "wb-act", doUndo);
  redoBtn = mkIconBtn("redo", "다시 실행 (Ctrl+Y)", "wb-act", doRedo);
  groupActionBtn = mkBtn("분리", "선택한 교육 도형의 그룹 풀기", "wb-act wb-ungroup", ungroupSelected); groupActionBtn.disabled = true;
  const clearBtn = mkIconBtn("trash", "보드 전체 지우기", "wb-act wb-clear", () => {
    if (!wb.items.length) return;
    if (typeof confirmDialog === "function"){ confirmDialog("보드 내용을 모두 지울까요?", "지우기", "취소").then(ok => { if (ok) clearAll(); }); }
    else clearAll();
  });
  actGroup.append(undoBtn, redoBtn, groupActionBtn, clearBtn);

  const exportGroup = grp();
  exportGroup.append(
    mkBtn("PNG", "PNG 이미지로 저장", "wb-act", exportPng),
    mkBtn("PDF", "PDF로 저장", "wb-act", exportPdf),
    mkBtn("메모로", "메모창으로 보내기 — 메모에서 '✏️ 화이트보드로'를 누르면 다시 편집할 수 있어요", "wb-act", sendToMemo)
  );

  // ----- 수업 리플레이 녹화 -----
  // ● 녹화 → 판서를 시간순으로 기록, ■ 정지 → 리플레이(되감아 보기) 화면을 만든다.
  const recGroup = grp();
  const recBtn = mkBtn("● 녹화", "수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요", "wb-act wb-rec", () => toggleRecord());
  recGroup.appendChild(recBtn);
  function toggleRecord(){
    if (typeof LessonRecorder !== "function"){ if (typeof toast === "function") toast("리플레이 기능을 불러오지 못했어요.", 2400); return; }
    if (doc.recorder && doc.recorder.active){
      const lesson = doc.recorder.stop(wb.items, wb.bg, { W, H });
      doc.recorder = null;
      recBtn.classList.remove("recording"); recBtn.textContent = "● 녹화";
      recBtn.title = "수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요";
      if (lesson && lesson.keyframes.length > 1 && typeof finishLessonRecording === "function") finishLessonRecording(lesson, doc.name);
      else if (typeof toast === "function") toast("녹화된 판서가 없어요.", 2000);
    } else {
      doc.recorder = LessonRecorder(wb.items, wb.bg, { W, H });
      recBtn.classList.add("recording"); recBtn.textContent = "■ 정지";
      recBtn.title = "녹화 정지 — 지금까지 판서를 리플레이로 만들기";
      if (typeof toast === "function") toast("녹화를 시작했어요. 판서한 뒤 ■ 정지를 누르면 리플레이가 만들어져요.", 3000);
    }
  }

  // 도구막대 위치(상/우/하/좌) — ⋮⋮ 핸들을 끌면 마우스에서 가장 가까운 변에 자동 도킹.
  const POS_SEQ = ["top", "right", "bottom", "left"];
  const readPos = () => { try { const v = localStorage.getItem("wbToolbarPos"); return POS_SEQ.includes(v) ? v : "top"; } catch(_){ return "top"; } };
  let curPos = readPos();
  const applyPos = (p) => { POS_SEQ.forEach(x => wrap.classList.toggle("tb-pos-" + x, x === p)); };
  const savePos = (p) => { try { localStorage.setItem("wbToolbarPos", p); } catch(_){} };
  const dragHandle = document.createElement("span");
  dragHandle.className = "wb-drag"; dragHandle.title = "끌어서 도구막대 위치 바꾸기 — 상/하 가로, 좌/우 세로";
  dragHandle.textContent = "⋮⋮";
  let wbDragging = false;
  dragHandle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); dragHandle.setPointerCapture(e.pointerId); wbDragging = true;
  });
  dragHandle.addEventListener("pointermove", (e) => {
    if (!wbDragging) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // 4변 중 가장 가까운 쪽으로 라이브 도킹
    const cand = [
      { p: "top",    v: y },
      { p: "bottom", v: r.height - y },
      { p: "left",   v: x },
      { p: "right",  v: r.width - x }
    ].sort((a, b) => a.v - b.v)[0];
    if (cand.p !== curPos){ curPos = cand.p; applyPos(curPos); }
  });
  const endWbDrag = (e) => {
    if (!wbDragging) return;
    wbDragging = false;
    try { dragHandle.releasePointerCapture(e.pointerId); } catch(_){}
    savePos(curPos);
  };
  dragHandle.addEventListener("pointerup", endWbDrag);
  dragHandle.addEventListener("pointercancel", endWbDrag);
  const posGroup = grp();
  posGroup.appendChild(dragHandle);
  applyPos(curPos);

  tools.append(posGroup, toolGroup, colorGroup, widthGroup, imgGroup, actGroup, exportGroup, recGroup);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(tools);
  setTool("select"); setColor("#111111"); setWidth(4); history.reset();   // 열면 선택·이동 도구가 기본 활성 + 현재 판서를 기준점으로

  // ----- 키보드(이 보드가 활성일 때만): Ctrl+Z / Ctrl+Y -----
  const onKey = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("wb-textinput")) return;
    if (e.key === "Escape" && !eduPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleEducationPanel(false); return;
    }
    if (!eduPanel.hidden && ae && eduPanel.contains(ae)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); doRedo(); }
    } else if ((e.key === "Delete" || e.key === "Backspace") && wb.selected){      // 선택한 이미지·도형·텍스트 삭제
      e.preventDefault(); e.stopPropagation();
      wb.items = wb.items.filter(it => it !== wb.selected); wb.selected = null; redraw(); history.commit(); recordCommit();
    } else if (e.key === "Escape" && wb.selected){ wb.selected = null; redraw(); }   // 선택 해제
  };
  document.addEventListener("keydown", onKey, true);

  // ----- 사이즈 추적 + 정리 -----
  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  restoreBoardImages();
  requestAnimationFrame(resize);

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { clearTimeout(boardRecoveryTimer); if (doc.recorder) doc.recorder.active = false; document.removeEventListener("keydown", onKey, true); document.removeEventListener("paste", onPaste); if (ro) ro.disconnect(); imageUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_){} }); });
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    boardStateFromSnapshot, boardRecoveryKey, chooseBoardSnapshot,
    whiteboardEducationCatalog, whiteboardFormulaDictionary, expandWhiteboardFormulaTemplate, normalizeWhiteboardFormulaLibrary,
    whiteboardStencilSvg, whiteboardStencilGroup, whiteboardVectorGroupSvg, whiteboardFormulaSvg, whiteboardSvgDataUrl
  };
}
