"use strict";

/* ===== 독립 화이트보드(설명용 칠판) =====
   새 문서 종류 "board". 벡터 모델(items)로 그려 undo/redo·리사이즈에 안전하고,
   PNG/PDF 로 내보낸다. 새 라이브러리 없이 캔버스만 사용. */

let _boardCount = 0;
const BOARD_RECOVERY_PREFIX = "manneung-board-recovery:";
const WB_EDU_TRANSFER_TYPE = "application/x-manneung-whiteboard-education";
const WB_ITEM_TRANSFER_TYPE = "application/x-manneung-whiteboard-item";
const WB_FORMULA_LIBRARY_KEY = "mn.wbFormulaLibrary.v1";
const WB_FOCUS_PREFS_KEY = "manneung-whiteboard:focus-prefs:v1";

// Ctrl+C/Ctrl+V에서는 캔버스의 선택 항목을 화면 캡처가 아닌 편집 가능한 모델로 전달한다.
function whiteboardClipboardItem(value){
  try {
    const json = typeof value === "string"
      ? value
      : JSON.stringify(value, (key, item) => key === "img" ? undefined : item);
    if (!json || json.length > 16 * 1024 * 1024) return null;
    const copy = JSON.parse(json);
    const selectable = new Set(["image", "line", "arrow", "rect", "ellipse", "polyline", "text", "group"]);
    if (!copy || !selectable.has(copy.type)) return null;
    if (copy.type === "image" && !/^data:image\//i.test(String(copy.src || ""))) return null;
    return copy;
  } catch(_){
    return null;
  }
}

const WB_COLORABLE_TYPES = new Set(["pen", "highlighter", "line", "arrow", "rect", "ellipse", "polyline", "text"]);

// 선택 항목의 색을 바꿀 때 이전 Undo 스냅샷이 함께 변하지 않도록 새 객체로 만든다.
// 교육 도형은 자식마다 굵기·투명도가 다르므로 그 값은 보존하고 색만 재귀적으로 교체한다.
function whiteboardRecolorItem(value, color){
  if (!value || typeof value !== "object" || !/^#[0-9a-f]{6}$/i.test(String(color || ""))) return value;
  const nextColor = String(color).toLowerCase();
  if (value.type === "group" && Array.isArray(value.items)){
    let changed = value.educationColor !== nextColor;
    const items = value.items.map((child) => {
      const recolored = whiteboardRecolorItem(child, nextColor);
      if (recolored !== child) changed = true;
      return recolored;
    });
    return changed ? Object.assign({}, value, { items, educationColor:nextColor }) : value;
  }
  if (!WB_COLORABLE_TYPES.has(value.type) || String(value.color || "").toLowerCase() === nextColor) return value;
  return Object.assign({}, value, { color:nextColor });
}

function whiteboardItemColor(value){
  if (!value || typeof value !== "object") return "";
  if (/^#[0-9a-f]{6}$/i.test(String(value.formulaColor || ""))) return String(value.formulaColor).toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(String(value.educationColor || ""))) return String(value.educationColor).toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(String(value.color || ""))) return String(value.color).toLowerCase();
  if (value.type === "group" && Array.isArray(value.items)){
    for (const child of value.items){ const color = whiteboardItemColor(child); if (color) return color; }
  }
  return "";
}

// S/M/L은 수식과 같은 75%/100%/150% 비율을 사용한다. 텍스트는 처음 크기를 기준으로,
// 교육 도형 그룹은 원본 벡터 크기(sourceW/sourceH)를 기준으로 계산한다.
function whiteboardPresetResizeItem(value, scale){
  if (!value || typeof value !== "object") return null;
  const ratio = Math.max(.25, Math.min(4, Number(scale) || 1));
  if (value.type === "text"){
    const baseFontSize = Math.max(14, Number(value.textBaseFontSize) || Number(value.fontSize) || 16);
    return Object.assign({}, value, { fontSize:Math.max(14, Math.round(baseFontSize * ratio)), textBaseFontSize:baseFontSize });
  }
  if (value.type === "group" && value.role === "education-stencil"){
    const baseW = Math.max(24, Number(value.sourceW) || Number(value.w) || 240);
    const baseH = Math.max(16, Number(value.sourceH) || Number(value.h) || 190);
    return Object.assign({}, value, { w:Math.max(24, Math.round(baseW * ratio)), h:Math.max(16, Math.round(baseH * ratio)) });
  }
  return null;
}

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
  add("point-slope","algebra","점과 기울기의 직선",String.raw`y - [[y_1]] = [[m]](x - [[x_1]])`,String.raw`y-y_1=m(x-x_1)`,"직선 방정식 점 기울기 point slope","한 점과 기울기로 나타낸 직선의 방정식");
  add("exponent-product","algebra","지수법칙 곱",String.raw`[[a]]^{[[m]]} [[a]]^{[[n]]} = [[a]]^{[[m]]+[[n]]}`,String.raw`a^m a^n=a^{m+n}`,"지수법칙 거듭제곱 exponent law","밑이 같은 거듭제곱의 곱");
  add("arithmetic-term","algebra","등차수열 일반항",String.raw`a_{[[n]]} = [[a_1]] + ([[n]]-1)[[d]]`,String.raw`a_n=a_1+(n-1)d`,"등차수열 일반항 arithmetic sequence","첫째항과 공차로 구하는 등차수열 일반항");
  add("arithmetic-sum","algebra","등차수열의 합",String.raw`S_{[[n]]} = \frac{[[n]]([[a_1]]+[[a_n]])}{2}`,String.raw`S_n=\frac{n(a_1+a_n)}{2}`,"등차수열 합 arithmetic series","등차수열의 첫 n개 항의 합");
  add("geometric-term","algebra","등비수열 일반항",String.raw`a_{[[n]]} = [[a_1]][[r]]^{[[n]]-1}`,String.raw`a_n=a_1r^{n-1}`,"등비수열 일반항 geometric sequence","첫째항과 공비로 구하는 등비수열 일반항");
  add("matrix-2x2","algebra","2×2 행렬",String.raw`A = \begin{pmatrix} [[왼쪽 위]] & [[오른쪽 위]] \\ [[왼쪽 아래]] & [[오른쪽 아래]] \end{pmatrix}`,String.raw`A=\begin{pmatrix}a&b\\c&d\end{pmatrix}`,"행렬 2x2 matrix entries","두 행 두 열로 이루어진 기본 행렬");
  add("determinant-2x2","algebra","2×2 행렬식",String.raw`\det A = \begin{vmatrix} [[왼쪽 위]] & [[오른쪽 위]] \\ [[왼쪽 아래]] & [[오른쪽 아래]] \end{vmatrix}`,String.raw`\det A=\begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc`,"행렬식 determinant det 2x2","2×2 행렬의 행렬식");
  add("inverse-matrix-2x2","algebra","2×2 역행렬",String.raw`A^{-1} = \frac{1}{[[a]][[d]]-[[b]][[c]]}\begin{pmatrix} [[d]] & -[[b]] \\ -[[c]] & [[a]] \end{pmatrix}`,String.raw`A^{-1}=\frac{1}{ad-bc}\begin{pmatrix}d&-b\\-c&a\end{pmatrix}`,"역행렬 inverse matrix 2x2","행렬식이 0이 아닐 때의 2×2 역행렬");
  add("simultaneous-equations","algebra","연립방정식",String.raw`\begin{cases} [[a]]x + [[b]]y = [[c]] \\ [[d]]x + [[e]]y = [[f]] \end{cases}`,String.raw`\begin{cases}2x+y=5\\x-y=1\end{cases}`,"연립방정식 연립 일차 simultaneous equations system","두 일차방정식을 한 묶음으로 나타낸 식");
  add("piecewise-function","algebra","구간별 함수",String.raw`f(x) = \begin{cases} [[첫째 식]] & [[첫째 조건]] \\ [[둘째 식]] & [[둘째 조건]] \end{cases}`,String.raw`f(x)=\begin{cases}x^2&x\geq0\\-x&x<0\end{cases}`,"구간별 함수 조각함수 piecewise cases","조건에 따라 서로 다른 식을 사용하는 함수");
  add("log-product-law","algebra","로그의 곱셈 법칙",String.raw`\log_{[[밑]]}([[첫째 수]][[둘째 수]]) = \log_{[[밑]]}[[첫째 수]] + \log_{[[밑]]}[[둘째 수]]`,String.raw`\log_a(xy)=\log_a x+\log_a y`,"로그 법칙 곱셈 product logarithm","곱의 로그를 로그의 합으로 바꾸는 법칙");
  add("log-quotient-law","algebra","로그의 나눗셈 법칙",String.raw`\log_{[[밑]]}\frac{[[분자]]}{[[분모]]} = \log_{[[밑]]}[[분자]] - \log_{[[밑]]}[[분모]]`,String.raw`\log_a\frac{x}{y}=\log_a x-\log_a y`,"로그 법칙 나눗셈 몫 quotient logarithm","몫의 로그를 로그의 차로 바꾸는 법칙");
  add("log-power-law","algebra","로그의 거듭제곱 법칙",String.raw`\log_{[[밑]]}([[진수]]^{[[지수]]}) = [[지수]]\log_{[[밑]]}[[진수]]`,String.raw`\log_a(x^n)=n\log_a x`,"로그 법칙 지수 거듭제곱 power logarithm","거듭제곱의 지수를 로그 앞으로 내리는 법칙");

  add("limit","calculus","극한",String.raw`\lim_{x \to [[a]]} [[f(x)]]`,String.raw`\lim_{x \to a} f(x)`,"미적분 극한 limit","x가 a로 갈 때의 극한");
  add("sum","calculus","수열의 합",String.raw`\sum_{[[i]]=[[시작]]}^{[[끝]]} [[a_i]]`,String.raw`\sum_{i=1}^{n} a_i`,"시그마 합계 sigma sum","시작과 끝이 있는 합");
  add("product","calculus","연속 곱",String.raw`\prod_{[[i]]=[[시작]]}^{[[끝]]} [[a_i]]`,String.raw`\prod_{i=1}^{n} a_i`,"파이 곱 product","시작과 끝이 있는 곱");
  add("derivative","calculus","미분",String.raw`\frac{d}{d[[x]]} [[f(x)]]`,String.raw`\frac{d}{dx} f(x)`,"도함수 derivative 미분계수","함수의 1차 미분");
  add("second-derivative","calculus","이계도함수",String.raw`\frac{d^2}{d[[x]]^2} [[f(x)]]`,String.raw`\frac{d^2}{dx^2} f(x)`,"이차 미분 second derivative","함수의 2차 미분");
  add("partial-derivative","calculus","편미분",String.raw`\frac{\partial [[f]]}{\partial [[x]]}`,String.raw`\frac{\partial f}{\partial x}`,"편도함수 partial derivative","여러 변수 함수의 편미분");
  add("integral","calculus","부정적분",String.raw`\int [[f(x)]]\,d[[x]]`,String.raw`\int f(x)\,dx`,"적분 integral 부정적분","적분 구간이 없는 적분");
  add("definite-integral","calculus","정적분",String.raw`\int_{[[아래끝]]}^{[[위끝]]} [[f(x)]]\,d[[x]]`,String.raw`\int_{a}^{b} f(x)\,dx`,"구간 적분 definite integral","아래끝과 위끝이 있는 적분");
  add("double-integral","calculus","이중적분",String.raw`\iint [[f(x,y)]]\,d[[x]]\,d[[y]]`,String.raw`\iint f(x,y)\,dx\,dy`,"다중적분 double integral","두 변수에 대한 이중적분");
  add("chain-rule","calculus","연쇄법칙",String.raw`\frac{d}{d[[x]]} f(g([[x]])) = f'(g([[x]]))g'([[x]])`,String.raw`\frac{d}{dx}f(g(x))=f'(g(x))g'(x)`,"합성함수 미분 연쇄법칙 chain rule","합성함수의 미분법");
  add("tangent-line","calculus","접선의 방정식",String.raw`y - f([[a]]) = f'([[a]])(x-[[a]])`,String.raw`y-f(a)=f'(a)(x-a)`,"미분 접선 기울기 tangent line","함수 위 한 점에서의 접선 방정식");
  add("integration-parts","calculus","부분적분",String.raw`\int [[u]]\,d[[v]] = [[u]][[v]] - \int [[v]]\,d[[u]]`,String.raw`\int u\,dv=uv-\int v\,du`,"적분 부분적분 integration by parts","곱 형태를 적분하는 부분적분 공식");

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
  add("permutation","statistics","순열",String.raw`{}_{[[n]]}P_{[[r]]} = \frac{[[n]]!}{([[n]]-[[r]])!}`,String.raw`{}_nP_r=\frac{n!}{(n-r)!}`,"순열 경우의수 permutation","n개에서 r개를 순서 있게 고르는 경우의 수");
  add("combination","statistics","조합",String.raw`{}_{[[n]]}C_{[[r]]} = \frac{[[n]]!}{[[r]]!([[n]]-[[r]])!}`,String.raw`{}_nC_r=\frac{n!}{r!(n-r)!}`,"조합 경우의수 combination","n개에서 r개를 순서 없이 고르는 경우의 수");
  add("binomial-probability","statistics","이항확률",String.raw`P(X=[[k]]) = \binom{[[n]]}{[[k]]}[[p]]^{[[k]]}(1-[[p]])^{[[n]]-[[k]]}`,String.raw`P(X=k)=\binom{n}{k}p^k(1-p)^{n-k}`,"이항분포 베르누이 확률 binomial","독립 시행에서 성공 횟수의 확률");
  add("z-score","statistics","표준점수",String.raw`z = \frac{[[값]]-[[평균]]}{[[표준편차]]}`,String.raw`z=\frac{x-\mu}{\sigma}`,"표준화 표준점수 z score","자료를 평균과 표준편차로 표준화한 점수");

  add("pythagorean","geometry-formula","피타고라스 정리",String.raw`[[a]]^2 + [[b]]^2 = [[c]]^2`,String.raw`a^2+b^2=c^2`,"직각삼각형 피타고라스 geometry","직각삼각형 세 변의 관계");
  add("distance","geometry-formula","두 점 사이 거리",String.raw`d = \sqrt{([[x_2]]-[[x_1]])^2 + ([[y_2]]-[[y_1]])^2}`,String.raw`d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}`,"좌표 거리 distance","평면 위 두 점 사이의 거리");
  add("midpoint","geometry-formula","중점",String.raw`\left(\frac{[[x_1]]+[[x_2]]}{2},\frac{[[y_1]]+[[y_2]]}{2}\right)`,String.raw`\left(\frac{x_1+x_2}{2},\frac{y_1+y_2}{2}\right)`,"좌표 중점 midpoint","두 점을 잇는 선분의 중점");
  add("circle-equation","geometry-formula","원의 방정식",String.raw`(x-[[a]])^2 + (y-[[b]])^2 = [[r]]^2`,String.raw`(x-a)^2+(y-b)^2=r^2`,"원 중심 반지름 circle equation","중심과 반지름으로 나타낸 원");
  add("circle-area","geometry-formula","원의 넓이",String.raw`A = \pi [[r]]^2`,String.raw`A=\pi r^2`,"넓이 원주율 circle area","반지름으로 구하는 원의 넓이");
  add("triangle-area","geometry-formula","삼각형 넓이",String.raw`A = \frac{1}{2}[[밑변]][[높이]]`,String.raw`A=\frac{1}{2}bh`,"밑변 높이 triangle area","밑변과 높이로 구하는 삼각형 넓이");
  add("sine-law","geometry-formula","사인 법칙",String.raw`\frac{[[a]]}{\sin [[A]]} = \frac{[[b]]}{\sin [[B]]} = \frac{[[c]]}{\sin [[C]]}`,String.raw`\frac{a}{\sin A}=\frac{b}{\sin B}=\frac{c}{\sin C}`,"삼각형 사인법칙 sine law","삼각형의 변과 맞은편 각의 관계");
  add("cosine-law","geometry-formula","코사인 법칙",String.raw`[[c]]^2 = [[a]]^2 + [[b]]^2 - 2[[a]][[b]]\cos [[C]]`,String.raw`c^2=a^2+b^2-2ab\cos C`,"삼각형 코사인법칙 cosine law","두 변과 끼인각으로 나머지 변 구하기");
  add("circumference","geometry-formula","원의 둘레",String.raw`C = 2\pi [[r]]`,String.raw`C=2\pi r`,"원 둘레 원주 circumference","반지름으로 구하는 원의 둘레");
  add("arc-length","geometry-formula","호의 길이",String.raw`l = \frac{[[각도]]}{360^\circ}\cdot 2\pi [[r]]`,String.raw`l=\frac{\theta}{360^\circ}\cdot2\pi r`,"부채꼴 호 길이 arc length","중심각과 반지름으로 구하는 호의 길이");
  add("sector-area","geometry-formula","부채꼴 넓이",String.raw`A = \frac{[[각도]]}{360^\circ}\cdot \pi [[r]]^2`,String.raw`A=\frac{\theta}{360^\circ}\pi r^2`,"부채꼴 넓이 sector area","중심각과 반지름으로 구하는 부채꼴 넓이");
  add("cylinder-volume","geometry-formula","원기둥 부피",String.raw`V = \pi [[r]]^2 [[h]]`,String.raw`V=\pi r^2h`,"원기둥 부피 cylinder volume","밑면 반지름과 높이로 구하는 원기둥 부피");
  add("vector-components","geometry-formula","벡터 성분",String.raw`\vec{[[벡터]]} = \begin{pmatrix} [[가로 성분]] \\ [[세로 성분]] \end{pmatrix}`,String.raw`\vec{v}=\begin{pmatrix}v_x\\v_y\end{pmatrix}`,"벡터 성분 좌표 vector components","평면 벡터를 가로·세로 성분으로 나타낸 식");
  add("vector-dot-product","geometry-formula","벡터의 내적",String.raw`\vec{[[a]]}\cdot\vec{[[b]]} = [[a_x]][[b_x]] + [[a_y]][[b_y]]`,String.raw`\vec{a}\cdot\vec{b}=a_xb_x+a_yb_y`,"벡터 내적 스칼라곱 dot product","두 벡터의 대응 성분 곱을 더한 값");
  add("vector-cross-product","geometry-formula","벡터의 외적",String.raw`\vec{[[a]]}\times\vec{[[b]]} = \left|\vec{[[a]]}\right|\left|\vec{[[b]]}\right|\sin[[각]]\,\vec{[[방향]]}`,String.raw`\vec{a}\times\vec{b}=|\vec{a}||\vec{b}|\sin\theta\,\vec{n}`,"벡터 외적 벡터곱 cross product","두 벡터에 수직인 방향과 크기를 나타내는 외적");
  add("parabola-standard","geometry-formula","포물선 표준형",String.raw`(x-[[가로 꼭짓점]])^2 = 4[[초점 거리]](y-[[세로 꼭짓점]])`,String.raw`(x-h)^2=4p(y-k)`,"포물선 표준형 초점 parabola conic","꼭짓점과 초점 거리를 사용하는 포물선 방정식");
  add("ellipse-standard","geometry-formula","타원 표준형",String.raw`\frac{(x-[[가로 중심]])^2}{[[가로 반지름]]^2} + \frac{(y-[[세로 중심]])^2}{[[세로 반지름]]^2} = 1`,String.raw`\frac{(x-h)^2}{a^2}+\frac{(y-k)^2}{b^2}=1`,"타원 표준형 장축 단축 ellipse conic","중심과 두 반지름을 사용하는 타원 방정식");
  add("hyperbola-standard","geometry-formula","쌍곡선 표준형",String.raw`\frac{(x-[[가로 중심]])^2}{[[가로 기준]]^2} - \frac{(y-[[세로 중심]])^2}{[[세로 기준]]^2} = 1`,String.raw`\frac{(x-h)^2}{a^2}-\frac{(y-k)^2}{b^2}=1`,"쌍곡선 표준형 점근선 hyperbola conic","중심과 두 기준 길이를 사용하는 쌍곡선 방정식");
  add("general-conic","geometry-formula","원뿔곡선 일반형",String.raw`[[A]]x^2 + [[B]]xy + [[C]]y^2 + [[D]]x + [[E]]y + [[F]] = 0`,String.raw`Ax^2+Bxy+Cy^2+Dx+Ey+F=0`,"원뿔곡선 일반형 이차곡선 conic general","포물선·타원·쌍곡선을 포함하는 이차곡선 일반형");

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
  add("chemical-formula","science-formula","화학식과 아래첨자",String.raw`\mathrm{[[첫째 원소]]}_{[[첫째 개수]]}\mathrm{[[둘째 원소]]}_{[[둘째 개수]]}`,String.raw`\mathrm{H}_2\mathrm{SO}_4`,"화학식 원소 아래첨자 분자식 chemical formula subscript","원소 기호와 원자 개수를 함께 나타내는 화학식");
  add("ion-charge","science-formula","이온 전하",String.raw`\mathrm{[[이온]]}^{[[전하]]}`,String.raw`\mathrm{Ca}^{2+}`,"화학 이온 전하 양이온 음이온 ion charge","원소나 원자단의 전하를 위첨자로 나타낸 식");
  add("balanced-reaction","science-formula","계수를 넣은 반응식",String.raw`[[첫째 계수]]\mathrm{[[첫째 반응물]]} + [[둘째 계수]]\mathrm{[[둘째 반응물]]} \rightarrow [[생성물 계수]]\mathrm{[[생성물]]}`,String.raw`2\mathrm{H}_2+\mathrm{O}_2\rightarrow2\mathrm{H}_2\mathrm{O}`,"화학 반응식 계수 균형식 balanced equation","반응물과 생성물의 계수를 맞춘 화학 반응식");
  add("uniform-motion","science-formula","등속 직선 운동",String.raw`x = [[처음 위치]] + [[속도]][[시간]]`,String.raw`x=x_0+vt`,"물리 등속 운동 위치 시간 uniform motion","일정한 속도로 움직이는 물체의 위치");
  add("velocity-acceleration","science-formula","등가속도 속도",String.raw`v = [[처음 속도]] + [[가속도]][[시간]]`,String.raw`v=v_0+at`,"물리 등가속도 속도 시간 kinematics","일정한 가속도에서 시간에 따른 속도");
  add("displacement-acceleration","science-formula","등가속도 이동거리",String.raw`s = [[처음 속도]][[시간]] + \frac{1}{2}[[가속도]][[시간]]^2`,String.raw`s=v_0t+\frac{1}{2}at^2`,"물리 등가속도 이동거리 변위 kinematics","일정한 가속도에서 시간에 따른 이동거리");
  add("mechanical-work","science-formula","역학적 일",String.raw`W = [[힘]][[이동거리]]\cos[[각]]`,String.raw`W=Fs\cos\theta`,"물리 일 힘 거리 각도 work mechanics","힘과 이동 방향이 이루는 각을 고려한 일");
  add("coulomb-law","science-formula","쿨롱 법칙",String.raw`F = [[쿨롱 상수]]\frac{[[첫째 전하]][[둘째 전하]]}{[[거리]]^2}`,String.raw`F=k\frac{q_1q_2}{r^2}`,"물리 전기력 전하 거리 쿨롱 Coulomb law","두 전하 사이에 작용하는 전기력");
  add("series-resistance","science-formula","직렬 합성저항",String.raw`R = [[첫째 저항]] + [[둘째 저항]] + \cdots + [[마지막 저항]]`,String.raw`R=R_1+R_2+\cdots+R_n`,"물리 전기 직렬 저항 합성 series resistance","직렬로 연결한 저항의 합성저항");
  add("parallel-resistance","science-formula","병렬 합성저항",String.raw`\frac{1}{R} = \frac{1}{[[첫째 저항]]} + \frac{1}{[[둘째 저항]]} + \cdots + \frac{1}{[[마지막 저항]]}`,String.raw`\frac{1}{R}=\frac{1}{R_1}+\frac{1}{R_2}+\cdots+\frac{1}{R_n}`,"물리 전기 병렬 저항 합성 parallel resistance","병렬로 연결한 저항의 합성저항");
  add("acceleration","science-formula","가속도",String.raw`a = \frac{[[속도 변화량]]}{[[시간]]}`,String.raw`a=\frac{\Delta v}{\Delta t}`,"물리 가속도 속도 변화 acceleration","단위 시간당 속도 변화량");
  add("momentum","science-formula","운동량",String.raw`p = [[질량]][[속도]]`,String.raw`p=mv`,"물리 운동량 momentum 질량 속도","질량과 속도의 곱으로 나타낸 운동량");
  add("pressure","science-formula","압력",String.raw`P = \frac{[[힘]]}{[[넓이]]}`,String.raw`P=\frac{F}{A}`,"물리 압력 힘 넓이 pressure","단위 넓이에 작용하는 힘");
  add("heat","science-formula","열량",String.raw`Q = [[질량]][[비열]][[온도 변화]]`,String.raw`Q=mc\Delta T`,"열량 비열 온도 변화 heat","물질의 온도를 변화시키는 데 필요한 열량");
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

function whiteboardFormulaNeedsInput(source, stops){
  const value = String(source || "");
  return Array.isArray(stops) && stops.some((stop) => {
    const start = Math.max(0, Number(stop && stop.start) || 0);
    const end = Math.max(start, Number(stop && stop.end) || start);
    return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value.slice(start, end));
  });
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
    ["subset","부분집합","⊂"], ["union","합집합","∪"], ["intersection","교집합","∩"],
    ["therefore","그러므로","∴"], ["because","왜냐하면","∵"], ["congruent","합동","≅"], ["similar","닮음","∼"],
    ["superset","상위집합","⊃"], ["empty-set","공집합","∅"], ["real-numbers","실수 집합","ℝ"], ["natural-numbers","자연수 집합","ℕ"]
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
    ["sphere","구","입체도형 구면 반지름","solid"], ["pyramid","각뿔","입체도형 사각뿔","solid"],
    ["linear-graph","일차함수 그래프","직선 함수 기울기 절편","graph"], ["absolute-graph","절댓값 그래프","V자 함수 절대값","graph"],
    ["exponential-graph","지수함수 그래프","지수 증가 감소 함수","graph"], ["logarithmic-graph","로그함수 그래프","로그 지수 역함수","graph"],
    ["regular-pentagon","정오각형","평면도형 다각형 오각형","plane"], ["regular-octagon","정팔각형","평면도형 다각형 팔각형","plane"],
    ["similar-triangles","닮은 삼각형","삼각형 닮음 대응변","plane"], ["parallel-transversal","평행선과 각","엇각 동위각 평행선","plane"],
    ["triangular-prism","삼각기둥","입체도형 각기둥","solid"], ["hemisphere","반구","입체도형 구 절반","solid"],
    ["cube-net","정육면체 전개도","입체도형 전개도","solid"], ["cylinder-net","원기둥 전개도","입체도형 전개도 옆면","solid"],
    ["bar-chart","막대그래프","통계 자료 막대 차트","data"], ["line-chart","꺾은선그래프","통계 변화 추세 차트","data"],
    ["histogram","히스토그램","통계 도수분포 연속자료","data"], ["pie-chart","원그래프","통계 비율 원형 차트","data"],
    ["scatter-plot","산점도","통계 상관관계 점 그래프","data"], ["box-plot","상자그림","통계 사분위수 중앙값","data"],
    ["venn-diagram","벤다이어그램","집합 교집합 합집합","data"]
  ].forEach(([id, label, keywords, group]) => addStencil("geometry", "stencil-" + id, label, keywords, group));
  [
    ["force","힘과 운동","물리 힘 중력 수직항력 벡터","mechanics"], ["spring","용수철","물리 탄성 진동","mechanics"],
    ["inclined-plane","빗면의 힘","물리 경사면 중력 수직항력","mechanics"], ["pulley","도르래","물리 장력 추","mechanics"],
    ["lever","지레","물리 받침점 힘 거리","mechanics"], ["projectile","포물선 운동","물리 투사체 속도 중력","mechanics"],
    ["pendulum","단진자","물리 진동 주기","mechanics"], ["collision","충돌과 운동량","물리 충돌 운동량 보존","mechanics"],
    ["circular-motion","원운동","물리 구심력 속도","mechanics"], ["buoyancy","부력","물리 유체 뜨는 힘","mechanics"],
    ["pressure-diagram","압력과 넓이","물리 압력 힘 접촉면","mechanics"],
    ["circuit","간단한 전기회로","물리 전지 저항 전구 회로","electricity"], ["series-circuit","직렬회로","전기 저항 직렬 전류","electricity"],
    ["parallel-circuit","병렬회로","전기 저항 병렬 전압","electricity"], ["circuit-symbols","회로 기호 모음","전지 저항 전구 스위치 전류계 전압계","electricity"],
    ["magnetic-field","막대자석의 자기장","자기장 자석 N극 S극","electricity"], ["electromagnet","전자석","코일 전류 철심 자기장","electricity"],
    ["generator","발전기 원리","전자기 유도 코일 자석","electricity"],
    ["ray","빛의 반사","과학 광선 거울 입사 반사","optics"], ["convex-lens","볼록렌즈 광선도","광학 초점 실상 렌즈","optics"],
    ["concave-lens","오목렌즈 광선도","광학 초점 허상 렌즈","optics"], ["refraction","빛의 굴절","광학 매질 입사각 굴절각","optics"],
    ["prism-dispersion","프리즘 분산","광학 스펙트럼 색 분리","optics"], ["total-internal-reflection","전반사","광학 임계각 굴절 전반사","optics"],
    ["beaker","비커","화학 실험 용액","chemistry"], ["test-tube","시험관","화학 실험 가열 용액","chemistry"],
    ["flask","삼각 플라스크","화학 실험 용액 혼합","chemistry"], ["graduated-cylinder","메스실린더","화학 부피 측정 눈금","chemistry"],
    ["burette","뷰렛","화학 적정 콕 눈금","chemistry"], ["gas-collection","기체 포집 장치","화학 수상치환 집기병","chemistry"],
    ["reaction","화학 반응식","화학 반응 화살표 생성물","chemistry"], ["atom","원자 모형","과학 원자 전자","chemistry"],
    ["bohr-atom","전자껍질 모형","보어 원자 전자 배치","chemistry"], ["molecule","분자 결합 모형","화학 공유결합 분자","chemistry"],
    ["ph-scale","pH 눈금","화학 산성 중성 염기성","chemistry"], ["energy-profile","반응 에너지 그래프","화학 활성화에너지 발열 흡열","chemistry"],
    ["particle-states","물질의 세 상태","화학 고체 액체 기체 입자","chemistry"], ["electrolysis","전기분해","화학 전극 이온 전해질","chemistry"],
    ["titration","중화 적정 장치","화학 뷰렛 플라스크 적정","chemistry"],
    ["plant-cell","식물세포","생명 세포벽 엽록체 액포","biology"], ["animal-cell","동물세포","생명 핵 세포막 미토콘드리아","biology"],
    ["dna","DNA 이중나선","생명 유전 염기","biology"], ["mitosis","세포분열","생명 체세포 분열 염색체","biology"],
    ["food-chain","먹이사슬","생태계 생산자 소비자","biology"], ["meiosis","감수분열","생명 생식세포 염색체","biology"],
    ["punnett-square","유전 조합표","생명 유전 우열 퍼넷 사각형","biology"], ["photosynthesis","광합성 과정","생명 빛 이산화탄소 산소 포도당","biology"],
    ["ecology-pyramid","생태 피라미드","생태계 에너지 생산자 소비자","biology"],
    ["solar-system","태양계","지구과학 행성 공전","earth"], ["moon-phases","달의 위상","지구과학 초승 상현 보름 하현","earth"],
    ["earth-layers","지구 내부 구조","지각 맨틀 외핵 내핵","earth"], ["water-cycle","물의 순환","증발 응결 강수 지하수","earth"],
    ["weather-front","기상 전선","온난전선 한랭전선","earth"], ["tectonic-plates","판 구조와 맨틀 대류","지구과학 판 경계 화산","earth"],
    ["seasons","계절 변화","지구과학 자전축 공전 계절","earth"], ["eclipse","일식과 월식","지구과학 태양 지구 달 그림자","earth"],
    ["rock-cycle","암석의 순환","지구과학 화성암 퇴적암 변성암","earth"],
    ["transverse-wave","횡파","파동 진폭 파장 마루 골","waves"], ["longitudinal-wave","종파","파동 압축 소밀 음파","waves"],
    ["standing-wave","정상파","파동 마디 배 정상파","waves"], ["sound-reflection","소리의 반사","파동 소리 메아리 반사","waves"]
  ].forEach(([id, label, keywords, group]) => addStencil("science", "stencil-" + id, label, keywords, group));
  [
    ["degree","각도 단위","°"], ["celsius","섭씨","℃"], ["millimeter","밀리미터","㎜"],
    ["centimeter","센티미터","㎝"], ["square-meter","제곱미터","㎡"], ["cubic-meter","세제곱미터","㎥"],
    ["kilogram","킬로그램","㎏"], ["ohm","옴","Ω"], ["hertz","헤르츠","㎐"],
    ["meter","미터","m"], ["second","초","s"], ["newton","뉴턴","N"], ["joule","줄","J"],
    ["watt","와트","W"], ["pascal","파스칼","Pa"], ["volt","볼트","V"]
  ].forEach(([id, label, value]) => addText("science", "unit-" + id, label, value, "과학 단위"));
  return rows;
}

function whiteboardVectorGroupSvg(group, color="#111111"){
  if (!group || !Array.isArray(group.items)) return "";
  const rawColor = String(color || "");
  const c = rawColor === "currentColor" || /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#111111";
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
  const rawColor = String(color || "");
  const c = rawColor === "currentColor" || /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#111111";
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
  const rawColor = String(color || "");
  const c = rawColor === "currentColor" || /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#111111";
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
    "stencil-tectonic-plates": () => [poly([[15,86],[70,80],[105,94],[135,94],[170,80],[225,86]]),arrow(105,70,48,70),arrow(135,70,192,70),poly([[105,94],[120,118],[135,94]]),arc(82,135,34,0,Math.PI,12),arc(158,135,34,Math.PI,Math.PI*2,12),arrow(52,139,83,118),arrow(188,139,157,118),label(90,36,"판 경계",15),label(76,157,"맨틀 대류",15)],

    // 수학 확장: 함수 그래프·평면/입체도형·자료 시각화
    "stencil-linear-graph": () => [arrow(18,155,224,155),arrow(45,176,45,18),arrow(30,150,205,45,{width:4}),label(207,160,"x"),label(52,18,"y"),label(118,82,"y=ax+b",15)],
    "stencil-absolute-graph": () => [arrow(18,155,224,155),arrow(45,176,45,18),poly([[65,48],[125,145],[205,36]],{width:4}),label(207,160,"x"),label(52,18,"y"),label(126,108,"|x|",16)],
    "stencil-exponential-graph": () => [arrow(18,155,224,155),arrow(45,176,45,18),curve(50,210,36,(x)=>150-8*Math.exp((x-95)/32),{width:4}),line(45,150,215,150,{dash:[5,4],alpha:.35}),label(207,160,"x"),label(52,18,"y"),label(148,45,"y=aˣ",16)],
    "stencil-logarithmic-graph": () => [arrow(18,155,224,155),arrow(45,176,45,18),curve(49,215,38,(x)=>142-32*Math.log((x-43)/24),{width:4}),line(45,20,45,170,{dash:[5,4],alpha:.35}),label(207,160,"x"),label(52,18,"y"),label(137,62,"y=log x",15)],
    "stencil-regular-pentagon": () => [regular(120,98,78,5),...[0,1,2,3,4].map((i)=>line(120,98,120+Math.cos(-Math.PI/2+i*Math.PI*2/5)*78,98+Math.sin(-Math.PI/2+i*Math.PI*2/5)*78,{dash:[4,4],alpha:.35})),ellipse(116,94,124,102,{fill:true}),label(126,101,"O")],
    "stencil-regular-octagon": () => [regular(120,95,78,8,Math.PI/8),line(48,95,192,95,{dash:[5,4],alpha:.4}),line(120,23,120,167,{dash:[5,4],alpha:.4}),ellipse(116,91,124,99,{fill:true})],
    "stencil-similar-triangles": () => [poly([[18,150],[72,55],[126,150],[18,150]]),poly([[142,150],[174,92],[218,150],[142,150]]),label(48,32,"△ABC",14),label(164,68,"△DEF",14),label(83,157,"∼",22),line(36,117,48,123),line(158,126,170,132)],
    "stencil-parallel-transversal": () => [line(20,55,220,55,{width:4}),line(20,137,220,137,{width:4}),line(72,175,165,18),arc(143,55,24,0,1.02,8),arc(94,137,24,Math.PI,4.15,8),label(153,66,"θ",18),label(69,108,"θ",18),poly([[108,48],[120,48]]),poly([[108,144],[120,144]])],
    "stencil-triangular-prism": () => [poly([[30,145],[82,45],[132,145],[30,145]]),poly([[108,115],[160,15],[212,115],[108,115]],{dash:[5,4]}),line(30,145,108,115),line(82,45,160,15),line(132,145,212,115),label(147,148,"삼각기둥",15)],
    "stencil-hemisphere": () => [arc(120,105,82,Math.PI,Math.PI*2,24),ellipse(38,80,202,130),arc(120,105,82,0,Math.PI,18,{dash:[5,4],alpha:.45}),line(120,105,197,105),label(157,83,"r"),label(91,148,"반구",16)],
    "stencil-cube-net": () => [rect(80,15,130,65),rect(30,65,80,115),rect(80,65,130,115),rect(130,65,180,115),rect(180,65,230,115),rect(80,115,130,165),label(96,78,"전개도",14)],
    "stencil-cylinder-net": () => [rect(45,40,195,145),ellipse(3,73,45,115),ellipse(195,73,237,115),line(45,58,195,58,{dash:[5,4],alpha:.35}),label(102,82,"2πr",16),label(199,118,"r",14)],
    "stencil-bar-chart": () => [arrow(28,165,222,165),arrow(28,165,28,18),rect(50,105,78,165,{fill:true,alpha:.22}),rect(91,65,119,165,{fill:true,alpha:.22}),rect(132,35,160,165,{fill:true,alpha:.22}),rect(173,85,201,165,{fill:true,alpha:.22}),label(58,168,"A",13),label(99,168,"B",13),label(140,168,"C",13),label(181,168,"D",13)],
    "stencil-line-chart": () => [arrow(28,165,222,165),arrow(28,165,28,18),poly([[48,130],[85,92],[123,112],[161,52],[203,75]],{width:4}),...[ [48,130],[85,92],[123,112],[161,52],[203,75] ].map(([x,y])=>ellipse(x-5,y-5,x+5,y+5,{fill:true})),label(192,168,"시간",13)],
    "stencil-histogram": () => [arrow(25,165,222,165),arrow(25,165,25,18),rect(45,115,75,165,{fill:true,alpha:.2}),rect(75,75,105,165,{fill:true,alpha:.2}),rect(105,40,135,165,{fill:true,alpha:.2}),rect(135,62,165,165,{fill:true,alpha:.2}),rect(165,122,195,165,{fill:true,alpha:.2}),label(78,18,"도수분포",14)],
    "stencil-pie-chart": () => [ellipse(38,12,202,176),line(120,94,120,12),line(120,94,197,68),line(120,94,65,158),label(137,40,"25%",14),label(137,112,"40%",14),label(67,75,"35%",14)],
    "stencil-scatter-plot": () => [arrow(25,165,222,165),arrow(25,165,25,18),...[ [48,142],[67,126],[78,137],[95,103],[112,115],[128,86],[145,92],[158,64],[179,72],[198,39] ].map(([x,y])=>ellipse(x-4,y-4,x+4,y+4,{fill:true})),line(42,148,207,42,{dash:[6,4],alpha:.45}),label(171,18,"양의 상관",14)],
    "stencil-box-plot": () => [line(25,105,215,105),line(42,88,42,122),line(198,88,198,122),line(42,105,76,105),rect(76,66,170,144),line(118,66,118,144,{width:4}),line(170,105,198,105),...[42,76,118,170,198].map((x)=>line(x,154,x,164,{width:2})),label(95,35,"상자그림",15)],
    "stencil-venn-diagram": () => [ellipse(30,35,145,158),ellipse(95,35,210,158),rect(12,15,228,176,{alpha:.35}),label(66,65,"A",20),label(158,65,"B",20),label(111,101,"A∩B",15),label(18,18,"U",14)],

    // 과학 확장: 역학·파동·전기자기·광학·화학·생명·지구과학
    "stencil-collision": () => [line(18,145,222,145),rect(28,88,82,144),rect(158,88,212,144),arrow(18,75,78,75),arrow(222,75,162,75),label(43,105,"m₁",16),label(173,105,"m₂",16),label(37,48,"v₁",15),label(183,48,"v₂",15)],
    "stencil-circular-motion": () => [ellipse(38,15,202,179),ellipse(112,89,128,105,{fill:true}),ellipse(188,89,204,105,{fill:true}),line(120,97,196,97),arrow(196,97,196,38),arrow(196,97,150,97),label(157,74,"r"),label(203,43,"v"),label(151,105,"Fᶜ",15)],
    "stencil-buoyancy": () => [rect(24,35,216,174),line(24,85,216,85,{width:4}),rect(87,65,153,130,{fill:true,alpha:.15}),arrow(120,66,120,20),arrow(120,130,120,168),label(128,25,"부력",15),label(128,145,"무게",15),poly([[25,93],[45,87],[65,93],[85,87],[105,93],[125,87],[145,93],[165,87],[185,93],[215,87]],{alpha:.4})],
    "stencil-pressure-diagram": () => [line(15,160,225,160),rect(38,55,88,160,{fill:true,alpha:.14}),rect(135,105,215,160,{fill:true,alpha:.14}),arrow(63,20,63,52),arrow(175,70,175,102),label(42,166,"좁은 면",13),label(151,166,"넓은 면",13),label(48,21,"F",16),label(183,71,"F",16)],
    "stencil-transverse-wave": () => [arrow(18,100,224,100),curve(20,220,48,(x)=>100-55*Math.sin((x-20)*Math.PI/60),{width:4}),arrow(82,100,82,45),arrow(82,100,82,155),line(82,45,202,45,{dash:[5,4],alpha:.4}),label(91,55,"진폭",14),label(126,21,"파장 λ",15)],
    "stencil-longitudinal-wave": () => [arrow(18,95,222,95),...[35,41,47,70,88,106,129,135,141,164,182,200].map((x)=>line(x,55,x,135,{width:2})),arrow(45,35,105,35),arrow(195,155,135,155),label(31,14,"압축",14),label(83,137,"소밀",14),label(159,14,"압축",14)],
    "stencil-standing-wave": () => [line(20,95,220,95,{alpha:.35}),curve(20,220,48,(x)=>95-58*Math.sin((x-20)*Math.PI/50),{width:4}),curve(20,220,48,(x)=>95+58*Math.sin((x-20)*Math.PI/50),{dash:[5,4],alpha:.45}),...[20,70,120,170,220].map((x)=>ellipse(x-4,91,x+4,99,{fill:true})),label(96,18,"배",14),label(23,103,"마디",13)],
    "stencil-sound-reflection": () => [line(190,20,190,170,{width:6}),arrow(35,140,190,75),arrow(190,75,70,28),arc(45,120,20,-1.1,.7,10),arc(45,120,34,-1.1,.7,10),label(23,148,"소리",15),label(197,81,"벽",15),label(101,38,"반사음",14)],
    "stencil-magnetic-field": () => [rect(72,72,168,120,{fill:true,alpha:.15}),line(120,72,120,120),label(88,82,"N",20),label(137,82,"S",20),arc(120,96,80,Math.PI,Math.PI*2,18),arc(120,96,80,0,Math.PI,18),arc(120,96,105,Math.PI,Math.PI*2,18,{alpha:.5}),arc(120,96,105,0,Math.PI,18,{alpha:.5})],
    "stencil-electromagnet": () => [rect(55,62,190,126,{fill:true,alpha:.12}),poly([[45,78],[58,52],[72,136],[86,52],[100,136],[114,52],[128,136],[142,52],[156,136],[170,52],[184,136],[198,78]]),line(45,78,25,78),line(198,78,218,78),line(25,78,25,160),line(218,78,218,160),line(25,160,100,160),line(140,160,218,160),line(100,147,100,173),line(140,153,140,167),label(83,22,"전자석",16)],
    "stencil-generator": () => [rect(25,50,70,140,{fill:true,alpha:.15}),rect(170,50,215,140,{fill:true,alpha:.15}),label(39,82,"N",20),label(184,82,"S",20),rect(88,48,152,142),line(120,48,120,20),line(120,142,120,172),arc(120,95,48,-1.1,.8,12),arrow(155,60,171,80),label(85,174,"발전기 코일",14)],
    "stencil-refraction": () => [line(18,98,222,98,{width:4}),line(120,18,120,175,{dash:[6,5],alpha:.5}),arrow(45,28,120,98),arrow(120,98,165,168),arc(120,98,32,-2.36,-1.57,8),arc(120,98,28,.78,1.57,8),label(62,108,"매질 1",14),label(171,108,"매질 2",14),label(84,62,"i"),label(138,126,"r")],
    "stencil-prism-dispersion": () => [regular(112,95,65,3,0),arrow(18,88,56,88),line(166,80,220,40,{width:2}),line(166,87,224,70,{width:2}),line(166,94,224,96,{width:2}),line(166,101,224,122,{width:2}),line(166,108,218,153,{width:2}),label(13,62,"백색광",14),label(181,161,"스펙트럼",13)],
    "stencil-total-internal-reflection": () => [rect(20,35,220,150,{alpha:.35}),line(20,92,220,92,{dash:[6,5],alpha:.45}),arrow(45,135,120,92),arrow(120,92,195,45),line(120,20,120,170,{dash:[5,4],alpha:.4}),arc(120,92,32,.55,1.57,8),label(126,117,"임계각",14),label(158,28,"전반사",15)],
    "stencil-particle-states": () => [rect(8,45,76,155),rect(86,45,154,155),rect(164,45,232,155),...[ [22,130],[42,130],[62,130],[22,110],[42,110],[62,110] ].map(([x,y])=>ellipse(x-4,y-4,x+4,y+4,{fill:true})),...[ [98,128],[118,120],[140,132],[105,96],[135,88],[122,145] ].map(([x,y])=>ellipse(x-4,y-4,x+4,y+4,{fill:true})),...[ [177,62],[216,76],[184,112],[221,138],[198,91] ].map(([x,y])=>ellipse(x-4,y-4,x+4,y+4,{fill:true})),label(22,160,"고체",13),label(104,160,"액체",13),label(184,160,"기체",13)],
    "stencil-electrolysis": () => [rect(35,55,205,170),line(35,95,205,95,{width:4}),line(80,35,80,145,{width:6}),line(160,35,160,145,{width:6}),line(80,35,80,18),line(160,35,160,18),line(80,18,105,18),line(135,18,160,18),line(105,8,105,28),line(135,13,135,23),...[55,75,115,135].map((y)=>ellipse(70,y,78,y+8)),...[65,85,125].map((y)=>ellipse(164,y,172,y+8)),label(58,150,"전해질",14),label(71,18,"+"),label(164,18,"−")],
    "stencil-titration": () => [line(30,20,210,20),line(112,20,112,118),...[42,62,82,102].map((y)=>line(112,y,128,y,{width:1.5})),line(98,118,126,118),line(112,118,112,140),ellipse(108,136,116,144,{fill:true}),poly([[88,145],[72,178],[72,184],[152,184],[152,178],[136,145],[88,145]]),line(85,164,139,164),label(132,109,"콕",13)],
    "stencil-meiosis": () => [ellipse(8,55,66,113),line(24,72,50,96),line(50,72,24,96),arrow(70,84,94,84),ellipse(98,35,150,87),ellipse(98,105,150,157),line(112,50,136,72),line(112,120,136,142),arrow(154,84,176,84),ellipse(180,18,220,58),ellipse(180,62,220,102),ellipse(180,106,220,146),ellipse(180,150,220,188),label(13,121,"2n",13),label(109,165,"1차",13),label(190,80,"n",13)],
    "stencil-punnett-square": () => [rect(55,35,205,175),line(105,35,105,175),line(155,35,155,175),line(55,80,205,80),line(55,127,205,127),label(122,48,"A",18),label(172,48,"a",18),label(72,92,"A",18),label(72,139,"a",18),label(118,93,"AA",15),label(168,93,"Aa",15),label(118,140,"Aa",15),label(168,140,"aa",15)],
    "stencil-photosynthesis": () => [ellipse(80,52,165,132,{rotation:-.35}),line(122,92,180,160),ellipse(22,20,58,56,{fill:true}),...[0,1,2,3,4,5,6,7].map((i)=>line(40+Math.cos(i*Math.PI/4)*23,38+Math.sin(i*Math.PI/4)*23,40+Math.cos(i*Math.PI/4)*32,38+Math.sin(i*Math.PI/4)*32)),arrow(60,55,96,73),arrow(22,120,88,105),arrow(152,74,218,52),label(7,130,"CO₂",15),label(181,28,"O₂",15),label(73,145,"물+빛 → 포도당",14)],
    "stencil-ecology-pyramid": () => [poly([[120,20],[25,170],[215,170],[120,20]],{closed:true}),line(50,130,190,130),line(75,90,165,90),label(90,143,"생산자",15),label(85,104,"1차 소비자",14),label(92,54,"2차 소비자",13),arrow(220,160,220,40),label(169,20,"에너지",13)],
    "stencil-seasons": () => [ellipse(102,77,138,113,{fill:true}),ellipse(20,75,44,99),ellipse(196,75,220,99),ellipse(108,13,132,37),ellipse(108,153,132,177),ellipse(30,25,210,165,{alpha:.3}),...[ [32,87],[208,87],[120,25],[120,165] ].map(([x,y])=>line(x-4,y-12,x+4,y+12,{width:2})),label(5,105,"봄",13),label(205,105,"가을",13),label(128,8,"여름",13),label(128,166,"겨울",13)],
    "stencil-eclipse": () => [ellipse(12,65,68,121,{fill:true}),ellipse(102,78,136,112),ellipse(180,55,228,135),line(68,78,180,55,{alpha:.45}),line(68,108,180,135,{alpha:.45}),poly([[68,78],[180,55],[180,135],[68,108]],{closed:true,alpha:.12,fill:true}),label(20,130,"태양",13),label(105,120,"달",13),label(188,142,"지구",13)],
    "stencil-rock-cycle": () => [label(92,18,"마그마",17),label(18,120,"화성암",17),label(94,160,"변성암",17),label(176,120,"퇴적암",17),arrow(105,42,48,108),arrow(59,132,105,158),arrow(139,158,183,132),arrow(190,108,139,42),arrow(58,116,177,116,{alpha:.45}),label(85,66,"냉각",13),label(77,132,"열·압력",12),label(145,87,"퇴적",12)]
  };
  const factory = groups[id];
  if (!factory) return null;
  return { type:"group", x:0,y:0,w:240,h:190,sourceW:240,sourceH:190,items:factory(),role:"education-stencil",educationId:id,educationColor:c };
}

function whiteboardFormulaSvg(mathMl, color="#111111", width=320, height=80){
  const c = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : "#111111";
  const w = Math.max(48, Math.ceil(Number(width) || 320)), h = Math.max(42, Math.ceil(Number(height) || 80));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:max-content;max-width:${w}px;height:${h}px;padding:6px;color:${c};font-size:32px;line-height:1.25;font-family:Cambria Math,Times New Roman,serif;white-space:nowrap">${String(mathMl || "")}</div></foreignObject></svg>`;
}

function whiteboardSvgDataUrl(svg){ return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(svg || "")); }
function whiteboardClampView(raw, width, height){
  const scale=Math.max(.25,Math.min(4,Number(raw && raw.scale)||1)), W=Math.max(0,Number(width)||0), H=Math.max(0,Number(height)||0);
  let x=Number(raw && raw.x)||0, y=Number(raw && raw.y)||0;
  // 배율이 100% 이하일 때도 화면을 끌어 옮길 수 있게 하되,
  // 원래 보드를 완전히 잃어버리지 않도록 가장자리 48px은 남긴다.
  if (W){ const sw=W*scale, edge=Math.min(48,W,sw); x=Math.max(edge-sw,Math.min(W-edge,x)); }
  if (H){ const sh=H*scale, edge=Math.min(48,H,sh); y=Math.max(edge-sh,Math.min(H-edge,y)); }
  return { scale,x,y };
}
function whiteboardZoomAt(raw, nextScale, anchor, width, height){
  const current=whiteboardClampView(raw,width,height), point=anchor||{x:(Number(width)||0)/2,y:(Number(height)||0)/2};
  const scale=Math.max(.25,Math.min(4,Number(nextScale)||1));
  const bx=(Number(point.x)-current.x)/current.scale, by=(Number(point.y)-current.y)/current.scale;
  return whiteboardClampView({scale,x:Number(point.x)-bx*scale,y:Number(point.y)-by*scale},width,height);
}
function normalizeWhiteboardFocusState(value){
  const raw=value&&typeof value==="object"?value:{}, spot=raw.spotlight&&typeof raw.spotlight==="object"?raw.spotlight:{}, curtain=raw.curtain&&typeof raw.curtain==="object"?raw.curtain:{};
  const clamp=(n,min,max,fallback)=>{ n=Number(n); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback; };
  return {
    active:raw.active===true,
    mode:raw.mode==="curtain"?"curtain":"spotlight",
    controlsVisible:raw.controlsVisible!==false,
    dimOpacity:clamp(raw.dimOpacity,.35,.9,.72),
    spotlight:{
      shape:spot.shape==="rect"?"rect":"ellipse",
      cx:clamp(spot.cx,0,1,.5),cy:clamp(spot.cy,0,1,.5),
      width:clamp(spot.width,.05,1,.36),height:clamp(spot.height,.05,1,.28),
      flashlight:spot.flashlight===true
    },
    curtain:{
      edge:["top","bottom","left","right"].includes(curtain.edge)?curtain.edge:"bottom",
      amount:clamp(curtain.amount,0,1,.5),
      color:curtain.color==="light"?"light":"dark"
    }
  };
}
function whiteboardFocusGeometry(value, width, height){
  const focus=normalizeWhiteboardFocusState(value), W=Math.max(0,Number(width)||0), H=Math.max(0,Number(height)||0);
  if (focus.mode==="spotlight"){
    const w=Math.min(W,Math.max(Math.min(96,W),focus.spotlight.width*W));
    const h=Math.min(H,Math.max(Math.min(72,H),focus.spotlight.height*H));
    const cx=Math.max(w/2,Math.min(Math.max(w/2,W-w/2),focus.spotlight.cx*W));
    const cy=Math.max(h/2,Math.min(Math.max(h/2,H-h/2),focus.spotlight.cy*H));
    return {mode:"spotlight",shape:focus.spotlight.shape,x:cx-w/2,y:cy-h/2,w,h,cx,cy,rx:w/2,ry:h/2};
  }
  const amount=focus.curtain.amount, edge=focus.curtain.edge;
  let x=0,y=0,w=W,h=H;
  if (edge==="top") h=H*amount;
  else if (edge==="bottom"){ h=H*amount; y=H-h; }
  else if (edge==="left") w=W*amount;
  else { w=W*amount; x=W-w; }
  return {mode:"curtain",edge,amount,x,y,w,h,boundary:(edge==="top"||edge==="bottom")?(edge==="top"?h:y):(edge==="left"?w:x)};
}
function whiteboardFocusAllowsPoint(value, point, width, height){
  const focus=normalizeWhiteboardFocusState(value);
  if (!focus.active) return true;
  const W=Math.max(0,Number(width)||0), H=Math.max(0,Number(height)||0), x=Number(point&&point.x), y=Number(point&&point.y);
  if (!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>W||y>H) return false;
  const g=whiteboardFocusGeometry(focus,W,H);
  if (g.mode==="spotlight"){
    if (g.shape==="rect") return x>=g.x&&x<=g.x+g.w&&y>=g.y&&y<=g.y+g.h;
    if (!g.rx||!g.ry) return false;
    const dx=(x-g.cx)/g.rx,dy=(y-g.cy)/g.ry;
    return dx*dx+dy*dy<=1;
  }
  if (g.amount<=0) return true;
  if (g.amount>=1) return false;
  if (g.edge==="top") return y>=g.boundary;
  if (g.edge==="bottom") return y<=g.boundary;
  if (g.edge==="left") return x>=g.boundary;
  return x<=g.boundary;
}
function whiteboardFlashlightGeometry(value,width,height){
  const focus=normalizeWhiteboardFocusState(value),W=Math.max(0,Number(width)||0),H=Math.max(0,Number(height)||0);
  if (!focus.active||focus.mode!=="spotlight"||focus.controlsVisible||!focus.spotlight.flashlight||!W||!H) return {visible:false};
  const spot=whiteboardFocusGeometry(focus,W,H);
  const spaces={right:W-(spot.x+spot.w),left:spot.x,bottom:H-(spot.y+spot.h),top:spot.y};
  const priority=["right","left","bottom","top"];
  let side=priority.find(name=>spaces[name]>=70);
  if (!side){ side=priority.slice().sort((a,b)=>spaces[b]-spaces[a])[0]; if (spaces[side]<70) return {visible:false}; }
  const gap=Math.min(16,Math.max(8,spaces[side]-62));
  const spreadX=Math.max(18,Math.min(42,spot.w*.22)),spreadY=Math.max(18,Math.min(42,spot.h*.22));
  let lensX=spot.cx,lensY=spot.cy,angle=0,beam=[];
  if (side==="right"){
    lensX=spot.x+spot.w+gap; beam=[[spot.x+spot.w,spot.cy-spreadY],[lensX,spot.cy-7],[lensX,spot.cy+7],[spot.x+spot.w,spot.cy+spreadY]];
  } else if (side==="left"){
    lensX=spot.x-gap; angle=180; beam=[[spot.x,spot.cy-spreadY],[lensX,spot.cy-7],[lensX,spot.cy+7],[spot.x,spot.cy+spreadY]];
  } else if (side==="bottom"){
    lensY=spot.y+spot.h+gap; angle=90; beam=[[spot.cx-spreadX,spot.y+spot.h],[spot.cx-7,lensY],[spot.cx+7,lensY],[spot.cx+spreadX,spot.y+spot.h]];
  } else {
    lensY=spot.y-gap; angle=-90; beam=[[spot.cx-spreadX,spot.y],[spot.cx-7,lensY],[spot.cx+7,lensY],[spot.cx+spreadX,spot.y]];
  }
  return {visible:true,side,lensX,lensY,angle,beam};
}
function boardRecoveryKey(name){ return BOARD_RECOVERY_PREFIX + String(name || "화이트보드"); }
// 새 보드를 열 때 쓸 배경색(설정값). 테스트가 이 파일만 node 로 불러오는 경우도 있어 설정이 없어도 견딘다.
function defaultBoardBg(){
  try {
    if (typeof normalizeBoardBg === "function" && typeof appSettings === "object" && appSettings) return normalizeBoardBg(appSettings.boardBg);
  } catch(_){}
  return "#ffffff";
}
// 스냅샷에 담긴 배경색. 배경색이 없던 시절의 스냅샷은 흰 종이에 그린 것이므로 흰색으로 되살린다
// (지금 설정한 기본색을 씌우면 그때 쓴 검정 펜이 사라져 보인다).
function boardSnapshotBg(value){
  if (typeof normalizeBoardBg === "function") return normalizeBoardBg(value);
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#ffffff";
}
// 저장된 스냅샷(자동복원·메모 블록)을 편집 가능한 보드 상태로 되살린다. 이미지는 src(data URL)만
// 들고 있다가 renderWhiteboard 의 restoreBoardImages 가 <img> 로 되살린다.
function validBoardSnapshot(saved){
  if (!saved || typeof saved !== "object" || saved.version !== 1 || !Array.isArray(saved.items)) return null;
  return saved;
}
function boardStateFromSnapshot(saved){
  const snapshot = validBoardSnapshot(saved);
  if (!snapshot) return null;
  return { tool:"pen", color:"#111111", width:4, bg:boardSnapshotBg(snapshot.bg), items:snapshot.items, selected:null };
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
  const wb = doc.boardState || (doc.boardState = { tool: "pen", color: "#111111", width: 4, items: [], bg: defaultBoardBg(), selected: null });
  // 화면 배율과 이동량은 판서 데이터가 아닌 탭별 보기 상태다. 저장·메모·리플레이에는 넣지 않는다.
  const view = doc.boardView || (doc.boardView = { scale:1, x:0, y:0 });
  Object.assign(view, whiteboardClampView(view, 0, 0));
  const readFocusPrefs = () => {
    try { return JSON.parse(localStorage.getItem(WB_FOCUS_PREFS_KEY) || "null"); }
    catch(_){ return null; }
  };
  let focus = normalizeWhiteboardFocusState(doc.boardFocus || readFocusPrefs());
  focus.active = !!(doc.boardFocus && doc.boardFocus.active);
  doc.boardFocus = focus;
  const focusMaskId = "wb-focus-mask-" + String(doc.id || _boardCount).replace(/[^a-zA-Z0-9_-]/g, "-");
  const focusVisual = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  focusVisual.classList.add("wb-focus-visual"); focusVisual.setAttribute("hidden", ""); focusVisual.style.display = "none"; focusVisual.setAttribute("aria-hidden", "true");
  const focusDefs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const focusMask = document.createElementNS("http://www.w3.org/2000/svg", "mask"); focusMask.id = focusMaskId; focusMask.setAttribute("maskUnits", "userSpaceOnUse");
  const focusMaskBase = document.createElementNS("http://www.w3.org/2000/svg", "rect"); focusMaskBase.setAttribute("fill", "white");
  const focusMaskEllipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse"); focusMaskEllipse.setAttribute("fill", "black");
  const focusMaskRect = document.createElementNS("http://www.w3.org/2000/svg", "rect"); focusMaskRect.setAttribute("fill", "black"); focusMaskRect.setAttribute("rx", "12");
  focusMask.append(focusMaskBase, focusMaskEllipse, focusMaskRect); focusDefs.appendChild(focusMask);
  const focusDim = document.createElementNS("http://www.w3.org/2000/svg", "rect"); focusDim.setAttribute("fill", "#000000"); focusDim.setAttribute("mask", `url(#${focusMaskId})`);
  const focusCurtain = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const flashlightBeam = document.createElementNS("http://www.w3.org/2000/svg", "path"); flashlightBeam.classList.add("wb-flashlight-beam"); flashlightBeam.style.display="none";
  const flashlightBody = document.createElementNS("http://www.w3.org/2000/svg", "g"); flashlightBody.classList.add("wb-flashlight-body"); flashlightBody.style.display="none";
  // 렌즈가 (0,0), 손잡이가 +x 방향인 손전등. renderFocus 에서 화면 가장자리 여유에 따라 회전한다.
  flashlightBody.innerHTML='<ellipse class="wb-flashlight-lens-glow" cx="0" cy="0" rx="15" ry="18"/><path d="M1-12 14-8v16L1 12Z" fill="#e2e8f0" stroke="#334155" stroke-width="2"/><rect x="12" y="-8" width="44" height="16" rx="7" fill="#475569" stroke="#1e293b" stroke-width="2"/><path d="M18-4h29" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/><rect x="50" y="-9" width="10" height="18" rx="4" fill="#334155" stroke="#1e293b" stroke-width="2"/><rect x="26" y="-11" width="12" height="5" rx="2.5" fill="#1e293b"/><circle cx="32" cy="-8.5" r="2" fill="#ef4444"/><path d="M2-9v18" stroke="#fef3c7" stroke-width="3" stroke-linecap="round"/>';
  focusVisual.append(focusDefs, focusDim, focusCurtain, flashlightBeam, flashlightBody); stage.appendChild(focusVisual);
  let zoomLabelBtn = null, positionTextEditor = null, spacePanning = false, lastBoardPointer = null;
  let renderFocus = () => {}, flashFocusBoundary = () => {};
  const focusAllowsScreenPoint = (p) => whiteboardFocusAllowsPoint(focus, p, W, H);
  const clampView = () => {
    Object.assign(view, whiteboardClampView(view, W, H));
  };
  const screenPoint = (e) => { const r = canvas.getBoundingClientRect(); return { x:e.clientX-r.left, y:e.clientY-r.top }; };
  const boardPointFromScreen = (p) => ({ x:(p.x-view.x)/view.scale, y:(p.y-view.y)/view.scale });
  const visibleBoardCenter = () => boardPointFromScreen({ x:W/2, y:H/2 });
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
    isSelectable: isSelectableBoardItem,
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
    const tolerance = HANDLE / view.scale;
    for (const h of HANDLES){ const hp = handlePos(it, h); if (Math.abs(p.x - hp.x) <= tolerance && Math.abs(p.y - hp.y) <= tolerance) return h; }
    return null;
  };
  let editingTextItem = null, openFormulaEditor = null, groupActionBtn = null, flipXBtn = null, flipYBtn = null;
  // 배경색은 캔버스에만 칠하면 부족하다. 무대(.wb-stage)는 창 크기를 바꾸는 순간 캔버스보다 잠깐 커져
  // 흰 테두리가 번쩍이고, 텍스트 입력칸이 흰 상자로 남으면 어두운 배경에 흰 글씨를 칠 때 글자가 안 보인다.
  // CSS 변수 하나로 셋을 같이 움직인다.
  wb.bg = boardSnapshotBg(wb.bg);
  const applyBoardBackground = () => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(wb.bg.slice(i, i + 2), 16));
    wrap.style.setProperty("--wb-bg", wb.bg);
    wrap.style.setProperty("--wb-textbg", `rgba(${r},${g},${b},.88)`);
  };
  applyBoardBackground();
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = wb.bg; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    for (const it of wb.items) if (it !== editingTextItem) drawItem(it);
    const s = wb.selected;                            // 선택 표시(점선 테두리, 이미지는 8핸들). 내보낼 땐 잠시 해제하므로 안 박힘.
    const sb = s && boundsOf(s);
    if (s && sb){
      ctx.save(); ctx.globalAlpha = 1; ctx.lineWidth = 1.5 / view.scale; ctx.strokeStyle = "#2563eb";
      const resizable = s.type === "image" || s.type === "group";
      const pad = resizable ? 0 : 4 / view.scale;
      ctx.setLineDash([6 / view.scale, 4 / view.scale]); ctx.strokeRect(sb.x - pad, sb.y - pad, Math.max(1, sb.w) + pad * 2, Math.max(1, sb.h) + pad * 2); ctx.setLineDash([]);
      if (resizable){
        ctx.fillStyle = "#fff";
        const handleSize = HANDLE / view.scale;
        for (const h of HANDLES){ const hp = handlePos(s, h); ctx.fillRect(hp.x - handleSize / 2, hp.y - handleSize / 2, handleSize, handleSize); ctx.strokeRect(hp.x - handleSize / 2, hp.y - handleSize / 2, handleSize, handleSize); }
      }
      ctx.restore();
    }
    if (groupActionBtn) groupActionBtn.disabled = !(s && s.type === "group");
    const canFlip = !!(s && s.type === "group" && s.role === "education-stencil");
    if (flipXBtn){ flipXBtn.disabled = !canFlip; flipXBtn.setAttribute("aria-pressed", canFlip && s.flipX ? "true" : "false"); }
    if (flipYBtn){ flipYBtn.disabled = !canFlip; flipYBtn.setAttribute("aria-pressed", canFlip && s.flipY ? "true" : "false"); }
    syncSelectionControls();
    if (zoomLabelBtn) zoomLabelBtn.textContent = Math.round(view.scale * 100) + "%";
    if (typeof positionTextEditor === "function") positionTextEditor();
    renderFocus();
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
  const deleteSelected = () => {
    if (!wb.selected) return false;
    const selected = wb.selected;
    wb.items = wb.items.filter(it => it !== selected); wb.selected = null;
    redraw(); history.commit(); recordCommit();
    return true;
  };
  const flipSelected = (axis) => {
    const selected = wb.selected;
    if (!selected || selected.type !== "group" || selected.role !== "education-stencil") return;
    const idx = wb.items.indexOf(selected); if (idx < 0) return;
    const flipped = Object.assign({}, selected, { [axis]:!selected[axis] });
    wb.items[idx] = flipped; wb.selected = flipped; redraw(); history.commit(); recordCommit();
  };
  const ungroupSelected = () => {
    const selected = wb.selected;
    if (!selected || selected.type !== "group") return;
    const idx = wb.items.indexOf(selected), children = ungroupBoardItem(selected, measureBoardText);
    if (idx < 0 || !children.length) return;
    wb.items.splice(idx, 1, ...children); wb.selected = null; redraw(); history.commit(); recordCommit();
    if (typeof toast === "function") toast("교육 도형을 구성 요소로 분리했어요.", 1800);
  };
  const resizeSelectedFormula = (scale) => {
    const selected = wb.selected;
    if (!selected || selected.type !== "image" || selected.role !== "education-formula") return false;
    const idx = wb.items.indexOf(selected); if (idx < 0) return false;
    const baseW = Number(selected.formulaBaseW) || (selected.img && selected.img.naturalWidth) || selected.w;
    const baseH = Number(selected.formulaBaseH) || (selected.img && selected.img.naturalHeight) || selected.h;
    let w = Math.max(24, Math.round(baseW * scale)), h = Math.max(16, Math.round(baseH * scale));
    const fit = Math.min(1, W * .85 / w, H * .85 / h); w = Math.round(w * fit); h = Math.round(h * fit);
    const centerX = selected.x + selected.w / 2, centerY = selected.y + selected.h / 2;
    const resized = Object.assign({}, selected, {
      x:Math.max(0, Math.min(Math.round(centerX - w / 2), Math.max(0, W - w))),
      y:Math.max(0, Math.min(Math.round(centerY - h / 2), Math.max(0, H - h))), w, h
    });
    wb.items[idx] = resized; wb.selected = resized; redraw(); history.commit(); recordCommit();
    return true;
  };
  const replaceSelectedItem = (selected, next) => {
    if (!selected || !next || selected === next) return false;
    const idx = wb.items.indexOf(selected); if (idx < 0) return false;
    wb.items[idx] = next; wb.selected = next; redraw(); history.commit(); recordCommit();
    return true;
  };
  const resizeSelectedPreset = (scale) => {
    const selected = wb.selected, before = selected && boundsOf(selected);
    if (!selected || !before) return false;
    let resized = whiteboardPresetResizeItem(selected, scale);
    if (!resized) return false;
    if (resized.type === "group"){
      const fit = W && H ? Math.min(1, W * .85 / resized.w, H * .85 / resized.h) : 1;
      resized.w = Math.max(24, Math.round(resized.w * fit)); resized.h = Math.max(16, Math.round(resized.h * fit));
    }
    const after = boundsOf(resized); if (!after) return false;
    const dx = before.x + before.w / 2 - after.x - after.w / 2;
    const dy = before.y + before.h / 2 - after.y - after.h / 2;
    resized = translateBoardItem(resized, dx, dy);
    const unchanged = resized.type === "text"
      ? Number(resized.fontSize) === Number(selected.fontSize)
      : Number(resized.w) === Number(selected.w) && Number(resized.h) === Number(selected.h);
    if (unchanged) return false;
    return replaceSelectedItem(selected, resized);
  };

  // ----- 사이즈/DPR (리사이즈해도 좌표는 CSS px 그대로라 그림 위치 유지) -----
  const resize = () => {
    const r = stage.getBoundingClientRect();
    // 인쇄·탭 전환처럼 잠깐 감춰진 순간(크기 0)에는 건너뛴다 — 1×1로 줄였다가는 화면 이동 위치가
    // clampView 에 눌려 사라진다. 다시 보이면 ResizeObserver 가 제 크기로 한 번 더 불러 준다.
    if (!r.width || !r.height) return;
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    clampView();
    redraw();
  };

  // ----- 포인터 그리기 -----
  const pt = (e) => boardPointFromScreen(screenPoint(e));
  // 선택 도구: 이미지·도형·텍스트 중 위에 그려진 항목부터 히트테스트
  const itemAt = (p) => {
    for (let i = wb.items.length - 1; i >= 0; i--){ const it = wb.items[i]; if (hitTestBoardItem(it, p, measureBoardText, 7 / view.scale)) return it; }
    return null;
  };
  const setViewScale = (nextScale, clientX, clientY) => {
    const anchor = Number.isFinite(clientX) && Number.isFinite(clientY) ? screenPoint({ clientX, clientY }) : { x:W/2, y:H/2 };
    Object.assign(view, whiteboardZoomAt(view, nextScale, anchor, W, H)); redraw();
  };
  const resetView = () => { view.scale = 1; view.x = 0; view.y = 0; redraw(); };
  const beginViewPan = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    canvas.classList.remove("pan-ready"); canvas.classList.add("panning");
    const startX=e.clientX, startY=e.clientY, originX=view.x, originY=view.y;
    const pointerId=e.pointerId;
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      view.x=originX+ev.clientX-startX; view.y=originY+ev.clientY-startY; clampView(); redraw();
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      canvas.removeEventListener("pointermove",move); canvas.removeEventListener("pointerup",up); canvas.removeEventListener("pointercancel",up); canvas.removeEventListener("lostpointercapture",up);
      canvas.classList.remove("panning");
      if (spacePanning) canvas.classList.add("pan-ready");
    };
    canvas.addEventListener("pointermove",move); canvas.addEventListener("pointerup",up); canvas.addEventListener("pointercancel",up); canvas.addEventListener("lostpointercapture",up);
  };
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (focus.active && focus.controlsVisible){ flashFocusBoundary(); return; }
    setViewScale(view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  }, { passive:false });
  canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
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
    if (h){ beginSelDrag(e, "resize", h); return true; }                                  // 핸들 → 그 방향으로 크기조절
    const item = itemAt(p);
    wb.selected = item || null; redraw();
    if (item){ beginSelDrag(e, "move"); return true; }                                    // 항목 본체 → 이동
    return false;
  };
  let cur = null, drawing = false, lastPt = null;
  canvas.addEventListener("pointerdown", (e) => {
    const screen = screenPoint(e);
    lastBoardPointer = boardPointFromScreen(screen);
    // 조절점이 보일 때는 집중 영역을 조정하는 단계다. 캔버스 입력을 먼저 끊어
    // 뒤의 선택·이동·판서·화면 이동이 실수로 실행되지 않게 한다.
    if (focus.active && focus.controlsVisible && e.button !== 2){ e.preventDefault(); flashFocusBoundary(); return; }
    if (e.button === 1 || (e.button === 0 && spacePanning)){ beginViewPan(e); return; }
    if (e.button !== 0) return;
    if (!focusAllowsScreenPoint(screen)){ e.preventDefault(); flashFocusBoundary(); return; }
    if (wb.tool === "select"){
      // 조절점을 숨긴 스포트라이트는 밝은 영역 자체를 이동 손잡이로 쓴다.
      // 보드 이동이 필요하면 기존처럼 Space+드래그 또는 가운데 버튼을 사용한다.
      if (focus.active && focus.mode === "spotlight" && !focus.controlsVisible){ beginSpotlightDrag(e,.5,.5,true); return; }
      // 선택 도구의 빈 공간은 손바닥 이동 영역으로 쓴다. 항목 위에서는 기존처럼 항목을 이동한다.
      if (!startSelect(e)) beginViewPan(e);
      return;
    }
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
    if (!focusAllowsScreenPoint(screenPoint(e))){ flashFocusBoundary(); finishStroke(); return; }
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
  // 가린 곳은 입력 불가, 드러난 곳의 선택 도구는 항목 위=이동, 이미지 핸들=크기조절.
  canvas.addEventListener("pointermove", (e) => {
    if (drawing) return;
    if (focus.active && focus.controlsVisible){ canvas.style.cursor = "not-allowed"; return; }
    if (spacePanning){ canvas.style.cursor = ""; return; }
    if (!focusAllowsScreenPoint(screenPoint(e))){ canvas.style.cursor = "not-allowed"; return; }
    canvas.style.cursor = "";
    if (wb.tool !== "select") return;
    if (focus.active && focus.mode === "spotlight" && !focus.controlsVisible){ canvas.style.cursor = "move"; return; }
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    canvas.style.cursor = h ? h.cur : (itemAt(p) ? "move" : "grab");
  });
  canvas.addEventListener("dblclick", (e) => {
    if (focus.active && focus.controlsVisible){ e.preventDefault(); e.stopPropagation(); flashFocusBoundary(); return; }
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
    ta.style.color = color; ta.style.fontSize = fs + "px"; ta.style.transformOrigin = "0 0";
    positionTextEditor = () => {
      ta.style.left = (view.x + p.x * view.scale) + "px"; ta.style.top = (view.y + p.y * view.scale) + "px";
      ta.style.transform = `scale(${view.scale})`;
    };
    positionTextEditor();
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
      editingTextItem = null; positionTextEditor = null;
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
        const item = { type: "text", color: wb.color, x: p.x, y: p.y, text: txt, fontSize: fs, textBaseFontSize:fs };
        wb.items.push(item); wb.selected = item; setTool("select"); redraw(); history.commit(); recordCommit();
      }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){
        e.preventDefault(); done = true; ta.remove(); editingTextItem = null; positionTextEditor = null;
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
    const center = visibleBoardCenter();
    const ccx = (cx == null) ? center.x : cx, ccy = (cy == null) ? center.y : cy;
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
      return PdfSignerCore.latexToMathML(String(source || ""), false, true);
    const safe = document.createElement("span"); safe.textContent = String(source || "");
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline"><mtext>${safe.innerHTML}</mtext></math>`;
  };
  const buildFormulaImage = (source, color) => {
    const mathMl = formulaMathMl(source);
    const probe = document.createElement("div"); probe.className = "wb-formula-probe"; probe.innerHTML = mathMl; stage.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    // 긴 문장도 먼저 실제 크기의 SVG로 만든 뒤 placeImage에서 보드 안에 맞춰 축소한다.
    // 여기서 보드 표시 폭(900px)으로 잘라 버리면 축소 전에 오른쪽 글자가 영구히 사라진다.
    const width = Math.min(16000, Math.max(80, Math.ceil(rect.width) + 18));
    const height = Math.min(16000, Math.max(54, Math.ceil(rect.height) + 16));
    probe.remove();
    const src = whiteboardSvgDataUrl(whiteboardFormulaSvg(mathMl, color, width, height));
    return loadBoardImageSource(src).then((img) => ({ img, src, width, height }));
  };
  const insertFormulaSource = (source, cx, cy, existing=null, colorOverride="") => {
    source = String(source || "").trim();
    if (!source){ if (typeof toast === "function") toast("수식을 입력하세요.", 1800); return false; }
    if (source.length > FORMULA_MAX_CHARS){ if (typeof toast === "function") toast("수식이 너무 깁니다. 4,000자 이하로 입력하세요.", 2200); return false; }
    const formulaColor = /^#[0-9a-f]{6}$/i.test(colorOverride) ? colorOverride : existing && existing.formulaColor ? existing.formulaColor : wb.color;
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
      const keepSelected = wb.selected === existing;
      wb.items[idx] = item; if (keepSelected) wb.selected = item; redraw(); history.commit(); recordCommit();
    }).catch(() => { if (typeof toast === "function") toast("수식을 그리지 못했어요.", 2000); });
    return true;
  };
  const insertEducationEntry = (entryOrId, cx, cy) => {
    const entry = typeof entryOrId === "string" ? educationById.get(entryOrId) : entryOrId;
    if (!entry) return false;
    const center = visibleBoardCenter();
    const centerX = cx == null ? center.x : cx, centerY = cy == null ? center.y : cy;
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
        text:content, fontSize, textBaseFontSize:fontSize,
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
  const pasteBoardClipboardItem = (raw) => {
    let item = whiteboardClipboardItem(raw);
    if (!item || !isSelectableBoardItem(item)) return false;
    const bounds = boundsOf(item);
    if (!bounds) return false;
    const destination = !wb.selected && lastBoardPointer;
    const dx = destination ? destination.x - (bounds.x + bounds.w / 2) : 24;
    const dy = destination ? destination.y - (bounds.y + bounds.h / 2) : 24;
    item = translateBoardItem(item, dx, dy);
    const moved = boundsOf(item);
    if (moved && moved.w <= W && moved.h <= H){
      let adjustX = 0, adjustY = 0;
      if (moved.x < 0) adjustX = -moved.x;
      else if (moved.x + moved.w > W) adjustX = W - moved.x - moved.w;
      if (moved.y < 0) adjustY = -moved.y;
      else if (moved.y + moved.h > H) adjustY = H - moved.y - moved.h;
      if (adjustX || adjustY) item = translateBoardItem(item, adjustX, adjustY);
    }
    const commit = () => {
      wb.items.push(item); wb.selected = item; setTool("select");
      redraw(); history.commit(); recordCommit();
    };
    if (item.type === "image"){
      loadBoardImageSource(item.src).then((img) => { item.img = img; commit(); })
        .catch(() => { if (typeof toast === "function") toast("복사한 항목을 붙여넣지 못했어요.", 2000); });
    } else commit();
    return true;
  };
  const onCopy = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    const item = whiteboardClipboardItem(wb.selected);
    if (!item || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData(WB_ITEM_TRANSFER_TYPE, JSON.stringify(item));
    const fallback = item.role === "education-formula" ? item.formulaSource
      : item.type === "text" ? item.text : "화이트보드 항목";
    e.clipboardData.setData("text/plain", String(fallback || "화이트보드 항목"));
    contextCopyHandled = true;
  };
  // 붙여넣기(Ctrl+V): 화이트보드 항목을 우선 복원하고, 없으면 외부 클립보드 이미지를 넣는다.
  const onPaste = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    const boardItem = e.clipboardData && e.clipboardData.getData(WB_ITEM_TRANSFER_TYPE);
    if (boardItem && pasteBoardClipboardItem(boardItem)){ e.preventDefault(); return; }
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items){
      if (it.kind === "file" && /^image\//.test(it.type)){
        const blob = it.getAsFile();
        if (blob){ e.preventDefault(); insertImageBlob(blob); return; }
      }
    }
  };
  document.addEventListener("copy", onCopy);
  document.addEventListener("paste", onPaste);
  let contextCopyHandled = false;
  const copySelectedFromMenu = () => {
    if (!whiteboardClipboardItem(wb.selected)) return false;
    contextCopyHandled = false;
    try { document.execCommand("copy"); } catch(_){}
    if (typeof toast === "function") toast(contextCopyHandled ? "선택한 항목을 복사했어요." : "복사하지 못했어요. Ctrl+C를 사용해 주세요.", 1800);
    return contextCopyHandled;
  };
  const duplicateSelected = () => {
    const item = whiteboardClipboardItem(wb.selected);
    if (!item || !pasteBoardClipboardItem(item)) return false;
    if (typeof toast === "function") toast("선택한 항목을 복제했어요.", 1500);
    return true;
  };
  const editSelected = () => {
    const selected = wb.selected;
    if (!selected) return false;
    if (selected.type === "text"){ startText({ x:selected.x, y:selected.y }, selected); return true; }
    if (selected.type === "image" && selected.role === "education-formula" && typeof openFormulaEditor === "function"){
      openFormulaEditor(selected); return true;
    }
    return false;
  };
  // 드래그&드롭: 캡처/이미지 파일을 보드에 떨구면 그 위치에 넣는다.
  stage.addEventListener("dragover", (e) => {
    if (!e.dataTransfer) return;
    const hasEducation = [...(e.dataTransfer.types || [])].includes(WB_EDU_TRANSFER_TYPE);
    const hasFile = [...(e.dataTransfer.items || [])].some(i => i.kind === "file");
    if (focus.active && focus.controlsVisible && (hasEducation || hasFile)){ e.preventDefault(); e.dataTransfer.dropEffect = "none"; return; }
    if (hasEducation || hasFile){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  });
  stage.addEventListener("drop", (e) => {
    if (focus.active && focus.controlsVisible){ e.preventDefault(); e.stopPropagation(); flashFocusBoundary(); return; }
    const educationId = e.dataTransfer && e.dataTransfer.getData(WB_EDU_TRANSFER_TYPE);
    if (educationId){
      e.preventDefault(); e.stopPropagation();
      const p = pt(e); insertEducationEntry(educationId, p.x, p.y); return;
    }
    const files = (e.dataTransfer && e.dataTransfer.files) || [];
    const imgFile = [...files].find(f => /^image\//.test(f.type));
    if (imgFile){ e.preventDefault(); e.stopPropagation(); const p = pt(e); insertImageBlob(imgFile, p.x, p.y); }
  });

  // 내보내기는 선택 표시와 화면 확대·이동을 제외하고 원래 보드 좌표로 만든다.
  // 배경색은 화면 그대로 담는다 — 인쇄·PDF만 흰 배경으로 바꾸면, 칠판 배경에 흰 펜으로 쓴 판서가
  // 흰 종이에 흰 글씨가 되어 통째로 사라진다. 어두운 배경으로 인쇄할지는 화면에서 이미 보고 판단한다.
  const withBoardExport = (fn) => {
    const selected=wb.selected, saved={ scale:view.scale, x:view.x, y:view.y };
    wb.selected=null; view.scale=1; view.x=0; view.y=0; redraw();
    try { return fn(); }
    finally { wb.selected=selected; view.scale=saved.scale; view.x=saved.x; view.y=saved.y; clampView(); redraw(); }
  };

  // ----- 내보내기 -----
  // notify: 버튼을 누른 게 아니라 Ctrl+S 로 부른 경우 — 화면에 아무 변화가 없어 알려줘야 한다.
  const exportPng = (options={}) => {
    withBoardExport(() => canvas.toBlob((b) => {
      if (!b){ if (typeof toast === "function") toast("이미지를 저장하지 못했어요.", 2000, { type: "error" }); return; }
      const u = URL.createObjectURL(b); const a = document.createElement("a");
      a.href = u; a.download = (doc.name || "화이트보드") + ".png";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
      if (options.notify && typeof toast === "function") toast("PNG 이미지로 저장했어요.", 2200);
    }, "image/png"));
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
    withBoardExport(() => canvas.toBlob(async (blob) => {
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
    }, "image/png"));
  };
  const exportPdf = async () => {
    if (typeof PDFLib === "undefined"){ if (typeof toast === "function") toast("PDF 라이브러리를 불러오지 못했어요.", 2200); return; }
    try {
      const png = withBoardExport(() => canvas.toDataURL("image/png"));
      const { PDFDocument } = PDFLib;
      const pdf = await PDFDocument.create();
      const img = await pdf.embedPng(png);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      const bytes = await pdf.save();
      if (typeof downloadPdfBytes === "function") downloadPdfBytes(bytes, (doc.name || "화이트보드") + ".pdf");
    } catch(e){ console.error(e); if (typeof toast === "function") toast("PDF로 저장하지 못했어요.", 2200, { type: "error" }); }
  };
  // 헤더의 "인쇄 / PDF로 저장"(window.print) 전용 경로.
  // 판서는 <canvas> 라서 화면 DOM을 그대로 인쇄하면 빈 종이가 나온다 — 인쇄 레이아웃에서는
  // .office 가 position:static 이 되며 .wb-wrap/.wb-stage 높이가 0으로 무너지고(캔버스는 absolute라
  // 자리를 안 차지한다) ResizeObserver 가 캔버스를 1×1로 다시 그려 내용까지 지운다.
  // 그래서 PDF 내보내기와 같은 그림을 만들어 그 이미지 한 장만 인쇄한다.
  const printBoard = async () => {
    let png = "";
    try { png = withBoardExport(() => canvas.toDataURL("image/png")); }
    catch(e){ console.error(e); }
    if (!png){ if (typeof toast === "function") toast("인쇄할 그림을 만들지 못했어요.", 2200, { type: "error" }); return; }
    const old = document.getElementById("boardPrintLayer");
    if (old) old.remove();
    const layer = document.createElement("div");
    layer.id = "boardPrintLayer"; layer.className = "board-print";
    const img = document.createElement("img");
    img.alt = doc.name || "화이트보드";
    layer.appendChild(img); document.body.appendChild(layer);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", cleanup);
      document.body.classList.remove("board-printing");
      layer.remove();
    };
    try {
      // data URL 도 로딩은 비동기라, 다 그려지기 전에 print() 를 부르면 빈 페이지가 나온다.
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = png; });
      window.addEventListener("afterprint", cleanup);
      document.body.classList.add("board-printing");
      window.print();                                  // 크로미움에서는 인쇄창이 닫힐 때까지 여기서 멈춘다
    } catch(e){ console.error(e); }
    finally { cleanup(); }
  };
  // 헤더 인쇄 버튼 진입점(app.js) — 보드 문서일 때만 window.print() 대신 이걸 쓴다.
  doc.printBoard = printBoard;

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
  const contextToolBtns = {};
  const swatchEls = {};
  const contextSwatchEls = {};
  const widthBtns = {};
  const contextWidthBtns = {};
  const FORMULA_SIZE_PRESETS = { 2:.75, 4:1, 8:1.5 };
  let customColor = null, contextCustomColor = null;
  let undoBtn, redoBtn, contextUndoBtn, contextRedoBtn;
  const setTool = (t) => {
    wb.tool = t; for (const k in toolBtns) toolBtns[k].classList.toggle("active", k === t);
    for (const k in contextToolBtns) contextToolBtns[k].classList.toggle("active", k === t);
    if (t !== "select" && wb.selected){ wb.selected = null; redraw(); }   // 다른 도구로 가면 선택 해제
    canvas.style.cursor = "";
    canvas.dataset.tool = t;
  };
  const setColor = (c, options={}) => {
    wb.color = c;
    for (const k in swatchEls) swatchEls[k].classList.toggle("active", k === c);
    for (const k in contextSwatchEls) contextSwatchEls[k].classList.toggle("active", k === c);
    if (customColor) customColor.value = c;
    if (contextCustomColor) contextCustomColor.value = c;
    const selected = wb.selected;
    if (options.applySelected !== false && selected){
      if (selected.type === "image" && selected.role === "education-formula" && selected.formulaSource && selected.formulaColor !== c){
        insertFormulaSource(selected.formulaSource, selected.x + selected.w / 2, selected.y + selected.h / 2, selected, c);
      } else {
        replaceSelectedItem(selected, whiteboardRecolorItem(selected, c));
      }
    }
    if (typeof renderEducationPanel === "function" && !eduPanel.hidden) renderEducationPanel();
  };
  const setWidth = (w) => {
    const selected = wb.selected;
    if (selected && selected.type === "image" && selected.role === "education-formula"){
      resizeSelectedFormula(FORMULA_SIZE_PRESETS[w] || 1);
      return;
    }
    if (selected && (selected.type === "text" || (selected.type === "group" && selected.role === "education-stencil"))){
      resizeSelectedPreset(FORMULA_SIZE_PRESETS[w] || 1);
      return;
    }
    if (selected && ["line","arrow","rect","ellipse","polyline"].includes(selected.type)){
      if (Number(selected.width) === Number(w)) return;
      replaceSelectedItem(selected, Object.assign({}, selected, { width:w }));
      return;
    }
    wb.width = w; syncSelectionControls();
  };
  function syncSelectionControls(){
    const selected = wb.selected;
    const formula = selected && selected.type === "image" && selected.role === "education-formula" ? selected : null;
    const text = selected && selected.type === "text" ? selected : null;
    const stencil = selected && selected.type === "group" && selected.role === "education-stencil" ? selected : null;
    const stroke = selected && ["line","arrow","rect","ellipse","polyline"].includes(selected.type) ? selected : null;
    const activeColor = whiteboardItemColor(selected) || wb.color;
    for (const k in swatchEls){ swatchEls[k].classList.toggle("active", k === activeColor); swatchEls[k].setAttribute("aria-pressed",String(k === activeColor)); }
    for (const k in contextSwatchEls){ contextSwatchEls[k].classList.toggle("active", k === activeColor); contextSwatchEls[k].setAttribute("aria-checked",String(k === activeColor)); }
    if (customColor && /^#[0-9a-f]{6}$/i.test(activeColor)) customColor.value = activeColor;
    if (contextCustomColor && /^#[0-9a-f]{6}$/i.test(activeColor)) contextCustomColor.value = activeColor;
    let currentScale = 0, sizeLabel = "굵기";
    if (formula){
      const baseW = Number(formula.formulaBaseW) || (formula.img && formula.img.naturalWidth) || formula.w;
      const baseH = Number(formula.formulaBaseH) || (formula.img && formula.img.naturalHeight) || formula.h;
      currentScale = Math.sqrt(Math.max(.0001, formula.w * formula.h / Math.max(1, baseW * baseH)));
      sizeLabel = "선택한 수식 크기";
    } else if (text){
      currentScale = (Number(text.fontSize) || 16) / Math.max(14, Number(text.textBaseFontSize) || Number(text.fontSize) || 16);
      sizeLabel = "선택한 텍스트 크기";
    } else if (stencil){
      const baseW = Number(stencil.sourceW) || Number(stencil.w) || 240;
      const baseH = Number(stencil.sourceH) || Number(stencil.h) || 190;
      currentScale = Math.sqrt(Math.max(.0001, stencil.w * stencil.h / Math.max(1, baseW * baseH)));
      sizeLabel = "선택한 교육 도형 크기";
    } else if (stroke){
      sizeLabel = "선택한 도형 선 굵기";
    }
    for (const k in widthBtns){
      const button = widthBtns[k], preset = FORMULA_SIZE_PRESETS[k];
      button.title = sizeLabel + " " + button.textContent;
      button.setAttribute("aria-label", button.title);
      button.classList.toggle("active", formula || text || stencil ? Math.abs(currentScale - preset) < .08 : Number(k) === (stroke ? Number(stroke.width) : wb.width));
    }
    for (const k in contextWidthBtns){
      const button = contextWidthBtns[k], preset = FORMULA_SIZE_PRESETS[k];
      button.title = sizeLabel + " " + button.textContent;
      button.setAttribute("aria-label", button.title);
      button.classList.toggle("active", formula || text || stencil ? Math.abs(currentScale - preset) < .08 : Number(k) === (stroke ? Number(stroke.width) : wb.width));
    }
  }
  const updateUndoButtons = () => {
    if (undoBtn) undoBtn.disabled = !history.canUndo(); if (redoBtn) redoBtn.disabled = !history.canRedo();
    if (contextUndoBtn) contextUndoBtn.disabled = !history.canUndo(); if (contextRedoBtn) contextRedoBtn.disabled = !history.canRedo();
  };

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

  // ----- 집중 도구(스포트라이트·화면 가리개) -----
  const focusControls = document.createElement("div"); focusControls.className = "wb-focus-controls"; focusControls.hidden = true;
  const focusFrame = document.createElement("div"); focusFrame.className = "wb-focus-frame";
  const focusHandleDefs = [
    [0,0,"nwse-resize","왼쪽 위"],[.5,0,"ns-resize","위"],[1,0,"nesw-resize","오른쪽 위"],
    [0,.5,"ew-resize","왼쪽"],[1,.5,"ew-resize","오른쪽"],
    [0,1,"nesw-resize","왼쪽 아래"],[.5,1,"ns-resize","아래"],[1,1,"nwse-resize","오른쪽 아래"]
  ];
  const focusHandles = focusHandleDefs.map(([hx,hy,cursor,label]) => {
    const button = mkBtn("", "스포트라이트 " + label + " 크기 조절", "wb-focus-handle", (e) => e.preventDefault());
    button.dataset.hx = String(hx); button.dataset.hy = String(hy); button.style.cursor = cursor;
    focusControls.appendChild(button); return button;
  });
  const focusMoveHandle = mkBtn("✥", "스포트라이트 이동", "wb-focus-handle wb-focus-move", (e) => e.preventDefault());
  const curtainHandle = mkBtn("⋮", "화면 가리개 경계 조절", "wb-focus-handle wb-curtain-handle", (e) => e.preventDefault());
  curtainHandle.setAttribute("role", "slider");
  focusControls.prepend(focusFrame); focusControls.append(focusMoveHandle, curtainHandle); stage.appendChild(focusControls);

  const focusPanel = document.createElement("section"); focusPanel.className = "wb-focus-panel"; focusPanel.hidden = true;
  focusPanel.id = "wb-focus-panel-" + doc.id; focusPanel.setAttribute("role", "dialog"); focusPanel.setAttribute("aria-label", "집중 도구 설정");
  const focusHead = document.createElement("div"); focusHead.className = "wb-focus-head";
  const focusTitle = document.createElement("strong"); focusTitle.textContent = "집중 도구";
  const focusClose = mkBtn("×", "집중 도구 설정 닫기 (효과는 유지)", "wb-edu-close", () => toggleFocusPanel(false));
  focusHead.append(focusTitle, focusClose);
  const focusModes = document.createElement("div"); focusModes.className = "wb-focus-modes"; focusModes.setAttribute("role", "group"); focusModes.setAttribute("aria-label", "집중 도구 종류");
  const spotlightModeBtn = mkBtn("스포트라이트", "사용할 집중 도구로 스포트라이트 선택", "wb-focus-choice", () => selectFocusMode("spotlight"));
  const curtainModeBtn = mkBtn("화면 가리개", "사용할 집중 도구로 화면 가리개 선택", "wb-focus-choice", () => selectFocusMode("curtain"));
  focusModes.append(spotlightModeBtn, curtainModeBtn);
  const makeFocusRow = (label, controls) => {
    const row=document.createElement("div"); row.className="wb-focus-row";
    const name=document.createElement("span"); name.className="wb-focus-label"; name.textContent=label;
    row.append(name,controls); return row;
  };
  const spotShapeChoices = document.createElement("div"); spotShapeChoices.className = "wb-focus-choices";
  const ellipseFocusBtn = mkBtn("원형", "타원형 스포트라이트", "wb-focus-small", () => setFocus({spotlight:{...focus.spotlight,shape:"ellipse"}}));
  const rectFocusBtn = mkBtn("사각형", "사각형 스포트라이트", "wb-focus-small", () => setFocus({spotlight:{...focus.spotlight,shape:"rect"}}));
  spotShapeChoices.append(ellipseFocusBtn, rectFocusBtn);
  const spotShapeRow = makeFocusRow("모양", spotShapeChoices);
  const dimControls = document.createElement("div"); dimControls.className = "wb-focus-range-wrap";
  const dimRange = document.createElement("input"); dimRange.type="range"; dimRange.min="35"; dimRange.max="90"; dimRange.step="1"; dimRange.setAttribute("aria-label","스포트라이트 어둡기");
  const dimOutput = document.createElement("output"); dimOutput.className="wb-focus-output";
  dimControls.append(dimRange,dimOutput); const dimRow = makeFocusRow("어둡기",dimControls);
  const flashlightChoices=document.createElement("div"); flashlightChoices.className="wb-focus-choices";
  const flashlightOffBtn=mkBtn("끔","손전등 효과 끄기","wb-focus-small",()=>setFocus({spotlight:{...focus.spotlight,flashlight:false}}));
  const flashlightOnBtn=mkBtn("켬","조절점을 숨겼을 때 손전등과 빛줄기 표시","wb-focus-small",()=>setFocus({spotlight:{...focus.spotlight,flashlight:true}}));
  flashlightChoices.append(flashlightOffBtn,flashlightOnBtn); const flashlightRow=makeFocusRow("손전등",flashlightChoices);
  const edgeChoices = document.createElement("div"); edgeChoices.className="wb-focus-choices wb-focus-directions";
  const edgeLabels = {top:"위",bottom:"아래",left:"왼쪽",right:"오른쪽"};
  const edgeBtns = {};
  for (const edge of ["top","bottom","left","right"]){
    const button=mkBtn(edgeLabels[edge],edgeLabels[edge]+"에서 화면 가리기","wb-focus-small",()=>setFocus({curtain:{...focus.curtain,edge}}));
    edgeBtns[edge]=button; edgeChoices.appendChild(button);
  }
  const edgeRow = makeFocusRow("방향",edgeChoices);
  const curtainAmountControls=document.createElement("div"); curtainAmountControls.className="wb-focus-range-wrap";
  const curtainAmount=document.createElement("input"); curtainAmount.type="range"; curtainAmount.min="0"; curtainAmount.max="100"; curtainAmount.step="1"; curtainAmount.setAttribute("aria-label","화면 가림 비율");
  const curtainOutput=document.createElement("output"); curtainOutput.className="wb-focus-output";
  curtainAmountControls.append(curtainAmount,curtainOutput); const curtainAmountRow=makeFocusRow("가림",curtainAmountControls);
  const colorChoices=document.createElement("div"); colorChoices.className="wb-focus-choices";
  const darkCurtainBtn=mkBtn("어두움","어두운 화면 가리개","wb-focus-small",()=>setFocus({curtain:{...focus.curtain,color:"dark"}}));
  const lightCurtainBtn=mkBtn("밝음","밝은 화면 가리개","wb-focus-small",()=>setFocus({curtain:{...focus.curtain,color:"light"}}));
  colorChoices.append(darkCurtainBtn,lightCurtainBtn); const colorRow=makeFocusRow("색",colorChoices);
  const focusActions=document.createElement("div"); focusActions.className="wb-focus-actions";
  const focusResetBtn=mkBtn("위치 초기화","집중 도구 위치와 크기 초기화","wb-focus-action",resetFocusGeometry);
  const focusControlsBtn=mkBtn("조절점 숨기기","집중 도구 조절점 숨기기","wb-focus-action",()=>setFocusControlsVisible(!focus.controlsVisible));
  const focusPowerBtn=mkBtn("시작","선택한 집중 효과 시작","wb-focus-action wb-focus-start",toggleFocusActive);
  focusActions.append(focusResetBtn,focusControlsBtn,focusPowerBtn);
  const focusHint=document.createElement("p"); focusHint.className="wb-focus-hint"; focusHint.textContent="조절점이 보이면 보드 입력을 잠급니다. 숨긴 뒤에는 판서하거나 선택 도구로 밝은 영역을 끌어 이동할 수 있습니다.";
  focusPanel.append(focusHead,focusModes,spotShapeRow,dimRow,flashlightRow,edgeRow,curtainAmountRow,colorRow,focusActions,focusHint); stage.appendChild(focusPanel);
  // ----- 화이트보드 우클릭 빠른 메뉴 -----
  // 집중 도구 전용으로 시작했던 메뉴를 일반 편집 메뉴로 확장한다. 도구막대와 같은 실행 함수를
  // 연결해 양쪽의 활성 상태와 Undo 기록이 어긋나지 않게 한다.
  const focusContextMenu=document.createElement("div"); focusContextMenu.className="wb-focus-context-menu"; focusContextMenu.hidden=true; focusContextMenu.setAttribute("role","menu"); focusContextMenu.setAttribute("aria-label","화이트보드 빠른 메뉴");
  const makeContextSection=(title,cls="")=>{
    const section=document.createElement("section"); section.className="wb-context-section "+cls;
    if(title){const heading=document.createElement("div");heading.className="wb-context-title";heading.textContent=title;section.appendChild(heading);}
    return section;
  };
  const contextAction=(label,title,cls,fn)=>{
    const button=mkBtn(label,title,cls,(e)=>{e.preventDefault();closeFocusContextMenu();fn();});
    button.setAttribute("role","menuitem"); return button;
  };

  const focusContextSection=makeContextSection("집중 도구","wb-context-focus");
  const focusContextToggle=mkBtn("조절점 숨기기","집중 도구 조절점 숨기기","wb-context-wide",()=>{
    const next=!focus.controlsVisible; setFocusControlsVisible(next); closeFocusContextMenu();
    if(typeof toast==="function")toast(next?"집중 도구 조절점을 표시했어요.":"집중 도구 조절점을 숨겼어요.",1300);
  });
  focusContextToggle.setAttribute("role","menuitem"); focusContextSection.appendChild(focusContextToggle);

  const contextItemSection=makeContextSection("선택 항목","wb-context-item");
  const contextItemName=document.createElement("div"); contextItemName.className="wb-context-target";
  const contextItemActions=document.createElement("div"); contextItemActions.className="wb-context-actions";
  const contextEditBtn=contextAction("편집","선택한 텍스트 또는 수식 편집","",editSelected);
  const contextCopyBtn=contextAction("복사","선택한 항목 복사 (Ctrl+C)","",copySelectedFromMenu);
  const contextDuplicateBtn=contextAction("복제","선택한 항목을 오른쪽 아래에 복제","",duplicateSelected);
  const contextFlipXBtn=contextAction("좌우 반전","선택한 교육 도형 좌우 반전","",()=>flipSelected("flipX"));
  const contextFlipYBtn=contextAction("상하 반전","선택한 교육 도형 상하 반전","",()=>flipSelected("flipY"));
  const contextUngroupBtn=contextAction("분리","선택한 그룹의 구성 요소 분리","",ungroupSelected);
  const contextDeleteBtn=contextAction("삭제","선택한 항목 삭제 (Delete)","wb-context-danger",deleteSelected);
  contextItemActions.append(contextEditBtn,contextCopyBtn,contextDuplicateBtn,contextFlipXBtn,contextFlipYBtn,contextUngroupBtn,contextDeleteBtn);
  contextItemSection.append(contextItemName,contextItemActions);

  const contextToolSection=makeContextSection("필기·도형 도구");
  const contextToolGrid=document.createElement("div"); contextToolGrid.className="wb-context-tools";
  const contextToolLabels={select:"선택",pen:"펜",highlighter:"형광펜",eraser:"지우개",line:"직선",arrow:"화살표",rect:"사각형",ellipse:"원",text:"텍스트"};
  TOOLS.forEach(([tool,icon,title])=>{
    const button=contextAction(contextToolLabels[tool]||tool,title,"wb-context-tool",()=>setTool(tool));
    button.prepend(mkIcon(icon)); contextToolBtns[tool]=button; contextToolGrid.appendChild(button);
  });
  contextToolSection.appendChild(contextToolGrid);

  const contextInkSection=makeContextSection("색상·굵기");
  const contextInkRow=document.createElement("div"); contextInkRow.className="wb-context-ink";
  const contextColors=document.createElement("div"); contextColors.className="wb-context-colors"; contextColors.setAttribute("role","group"); contextColors.setAttribute("aria-label","필기 색상");
  COLORS.forEach(([color,name])=>{
    const swatch=mkBtn("",name,"wb-context-swatch",()=>{setColor(color);closeFocusContextMenu();});
    swatch.style.background=color; swatch.setAttribute("role","menuitemradio"); swatch.setAttribute("aria-label",name); swatch.setAttribute("aria-checked",String(wb.color===color));
    if(color==="#ffffff")swatch.classList.add("light"); contextSwatchEls[color]=swatch; contextColors.appendChild(swatch);
  });
  contextCustomColor=document.createElement("input"); contextCustomColor.type="color"; contextCustomColor.className="wb-context-custom-color"; contextCustomColor.value=wb.color; contextCustomColor.title="색 직접 고르기"; contextCustomColor.setAttribute("aria-label","색 직접 고르기");
  contextCustomColor.addEventListener("input",()=>setColor(contextCustomColor.value,{applySelected:false}));
  contextCustomColor.addEventListener("change",()=>{setColor(contextCustomColor.value);closeFocusContextMenu();}); contextColors.appendChild(contextCustomColor);
  const contextWidths=document.createElement("div"); contextWidths.className="wb-context-widths"; contextWidths.setAttribute("role","group"); contextWidths.setAttribute("aria-label","필기 굵기");
  [["2","S",2],["4","M",4],["8","L",8]].forEach(([key,label,width])=>{
    const button=contextAction(label,"굵기 "+label,"wb-context-width",()=>setWidth(width)); contextWidthBtns[key]=button; contextWidths.appendChild(button);
  });
  contextInkRow.append(contextColors,contextWidths); contextInkSection.appendChild(contextInkRow);

  const contextHistorySection=makeContextSection("","wb-context-history");
  const contextHistoryActions=document.createElement("div"); contextHistoryActions.className="wb-context-actions wb-context-history-actions";
  contextUndoBtn=contextAction("되돌리기","되돌리기 (Ctrl+Z)","",doUndo);
  contextRedoBtn=contextAction("다시 실행","다시 실행 (Ctrl+Y)","",doRedo);
  contextHistoryActions.append(contextUndoBtn,contextRedoBtn); contextHistorySection.appendChild(contextHistoryActions);
  focusContextMenu.append(focusContextSection,contextItemSection,contextToolSection,contextInkSection,contextHistorySection);

  function closeFocusContextMenu(){ focusContextMenu.hidden=true; }
  function onFocusContextMenu(e){
    if(focusPanel.contains(e.target)||focusControls.contains(e.target)||(!eduPanel.hidden&&eduPanel.contains(e.target))||(!bgPanel.hidden&&bgPanel.contains(e.target)))return;
    e.preventDefault();e.stopPropagation();
    const screen=screenPoint(e); lastBoardPointer=boardPointFromScreen(screen);
    const canSelect=!(focus.active&&focus.controlsVisible)&&focusAllowsScreenPoint(screen);
    wb.selected=canSelect?itemAt(lastBoardPointer):null; redraw();

    const selected=wb.selected,formula=selected&&selected.type==="image"&&selected.role==="education-formula";
    const stencil=selected&&selected.type==="group"&&selected.role==="education-stencil";
    const typeLabels={image:formula?"수식":"이미지",line:"직선",arrow:"화살표",rect:"사각형",ellipse:"원",polyline:"도형",text:"텍스트",group:stencil?"교육 도형":"그룹"};
    focusContextSection.hidden=!focus.active;
    contextItemSection.hidden=!selected;
    contextItemName.textContent=selected?(typeLabels[selected.type]||"화이트보드 항목"):"";
    contextEditBtn.hidden=!(selected&&(selected.type==="text"||formula));
    contextFlipXBtn.hidden=!stencil; contextFlipYBtn.hidden=!stencil;
    contextUngroupBtn.hidden=!(selected&&selected.type==="group");
    focusContextToggle.textContent=focus.controlsVisible?"조절점 숨기기":"조절점 보이기";
    focusContextToggle.title=focusContextToggle.textContent;focusContextToggle.setAttribute("aria-label",focusContextToggle.textContent);
    syncSelectionControls(); updateUndoButtons();
    for(const color in contextSwatchEls)contextSwatchEls[color].setAttribute("aria-checked",String(contextSwatchEls[color].classList.contains("active")));
    const menuHost=document.fullscreenElement||document.body;
    if(focusContextMenu.parentElement!==menuHost)menuHost.appendChild(focusContextMenu);
    focusContextMenu.hidden=false;focusContextMenu.style.left="0px";focusContextMenu.style.top="0px";
    const rect=focusContextMenu.getBoundingClientRect(),margin=6;
    focusContextMenu.style.left=Math.max(margin,Math.min(e.clientX,window.innerWidth-rect.width-margin))+"px";
    focusContextMenu.style.top=Math.max(margin,Math.min(e.clientY,window.innerHeight-rect.height-margin))+"px";
    requestAnimationFrame(()=>{
      const first=[...focusContextMenu.querySelectorAll("button:not(:disabled)")].find(button=>!button.hidden&&!button.closest("[hidden]"));
      if(first)first.focus({preventScroll:true});
    });
  }
  focusContextMenu.addEventListener("keydown",e=>{
    if(!["ArrowDown","ArrowRight","ArrowUp","ArrowLeft","Home","End"].includes(e.key))return;
    const buttons=[...focusContextMenu.querySelectorAll("button:not(:disabled)")].filter(button=>!button.hidden&&!button.closest("[hidden]"));
    if(!buttons.length)return; e.preventDefault();
    const current=Math.max(0,buttons.indexOf(document.activeElement));
    const next=e.key==="Home"?0:e.key==="End"?buttons.length-1:(current+(["ArrowDown","ArrowRight"].includes(e.key)?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus({preventScroll:true});
  });
  stage.addEventListener("contextmenu",onFocusContextMenu);
  let focusToolBtn=null, focusFlashTimer=0, focusDragCleanup=null;

  const saveFocusPrefs = () => {
    try { localStorage.setItem(WB_FOCUS_PREFS_KEY,JSON.stringify({...focus,active:false})); } catch(_){}
  };
  function setFocus(changes,options={}){
    focus=normalizeWhiteboardFocusState({
      ...focus,...changes,
      spotlight:changes&&changes.spotlight?changes.spotlight:focus.spotlight,
      curtain:changes&&changes.curtain?changes.curtain:focus.curtain
    });
    doc.boardFocus=focus;
    if (options.persist!==false) saveFocusPrefs();
    renderFocus();
  }
  function selectFocusMode(mode){
    const changed=focus.mode!==mode;
    setFocus({mode});
    if (changed && focus.active && typeof toast==="function") toast(mode==="spotlight"?"스포트라이트로 바꿨어요.":"화면 가리개로 바꿨어요.",1400);
  }
  function startFocus(){
    if (focus.active) return;
    wb.selected=null;
    setFocus({active:true,controlsVisible:true}); redraw();
    if (typeof toast==="function") toast(focus.mode==="spotlight"?"스포트라이트를 켰어요.":"화면 가리개를 켰어요.",1600);
  }
  function stopFocus(){
    if (!focus.active) return;
    closeFocusContextMenu();
    setFocus({active:false}); canvas.style.cursor="";
    if (typeof toast==="function") toast("집중 효과를 종료했어요.",1400);
  }
  function toggleFocusActive(){ if (focus.active) stopFocus(); else startFocus(); }
  function setFocusControlsVisible(visible){
    if(visible&&wb.selected){wb.selected=null;redraw();}
    setFocus({controlsVisible:!!visible});
  }
  function resetFocusGeometry(){
    if (focus.mode==="spotlight") setFocus({spotlight:{...focus.spotlight,cx:.5,cy:.5,width:.36,height:.28},controlsVisible:true});
    else setFocus({curtain:{...focus.curtain,amount:.5},controlsVisible:true});
  }
  function syncFocusPanel(){
    const spotlight=focus.mode==="spotlight";
    spotlightModeBtn.classList.toggle("selected",spotlight); curtainModeBtn.classList.toggle("selected",!spotlight);
    spotlightModeBtn.classList.toggle("active",spotlight&&focus.active); curtainModeBtn.classList.toggle("active",!spotlight&&focus.active);
    spotlightModeBtn.setAttribute("aria-pressed",String(spotlight)); curtainModeBtn.setAttribute("aria-pressed",String(!spotlight));
    spotShapeRow.hidden=!spotlight; dimRow.hidden=!spotlight; flashlightRow.hidden=!spotlight; edgeRow.hidden=spotlight; curtainAmountRow.hidden=spotlight; colorRow.hidden=spotlight;
    ellipseFocusBtn.classList.toggle("active",focus.spotlight.shape==="ellipse"); rectFocusBtn.classList.toggle("active",focus.spotlight.shape==="rect");
    flashlightOffBtn.classList.toggle("active",!focus.spotlight.flashlight); flashlightOnBtn.classList.toggle("active",focus.spotlight.flashlight);
    for (const edge in edgeBtns) edgeBtns[edge].classList.toggle("active",focus.curtain.edge===edge);
    darkCurtainBtn.classList.toggle("active",focus.curtain.color==="dark"); lightCurtainBtn.classList.toggle("active",focus.curtain.color==="light");
    dimRange.value=String(Math.round(focus.dimOpacity*100)); dimOutput.value=dimRange.value+"%"; dimOutput.textContent=dimOutput.value;
    curtainAmount.value=String(Math.round(focus.curtain.amount*100)); curtainOutput.value=curtainAmount.value+"%"; curtainOutput.textContent=curtainOutput.value;
    focusControlsBtn.textContent=focus.controlsVisible?"조절점 숨기기":"조절점 보이기";
    focusControlsBtn.disabled=!focus.active; focusResetBtn.disabled=!focus.active;
    focusPowerBtn.textContent=focus.active?"종료":"시작";
    focusPowerBtn.title=focus.active?"집중 효과 종료 (Esc)":"선택한 집중 효과 시작"; focusPowerBtn.setAttribute("aria-label",focusPowerBtn.title);
    focusPowerBtn.classList.toggle("wb-focus-stop",focus.active); focusPowerBtn.classList.toggle("wb-focus-start",!focus.active);
    focusTitle.textContent="집중 도구"+(focus.active?(spotlight?" · 스포트라이트 켜짐":" · 가리개 켜짐"):" · 사용 안 함");
    focusHint.textContent=!focus.active?"사용할 도구와 설정을 고른 뒤 시작을 누르세요.":focus.controlsVisible?"조절점이 보이면 보드 입력을 잠급니다. 숨기면 판서와 밝은 영역 이동이 가능합니다.":"드러난 영역에 판서하거나 선택 도구로 밝은 영역을 끌어 이동할 수 있습니다.";
    if (focusToolBtn){ focusToolBtn.classList.toggle("active",focus.active); focusToolBtn.setAttribute("aria-pressed",String(focus.active)); focusToolBtn.setAttribute("aria-expanded",String(!focusPanel.hidden)); }
  }
  dimRange.addEventListener("input",()=>setFocus({dimOpacity:Number(dimRange.value)/100}));
  curtainAmount.addEventListener("input",()=>setFocus({curtain:{...focus.curtain,amount:Number(curtainAmount.value)/100}}));
  function toggleFocusPanel(force){
    const open=force==null?focusPanel.hidden:!!force;
    focusPanel.hidden=!open;
    if (open){
      if (typeof toggleEducationPanel==="function") toggleEducationPanel(false);
      if (typeof toggleBackgroundPanel==="function") toggleBackgroundPanel(false);
      if (focusFloat) focusFloat.clampOnOpen();
    }
    syncFocusPanel();
  }

  const setSvgBox=(el,x,y,w,h)=>{ el.setAttribute("x",String(x));el.setAttribute("y",String(y));el.setAttribute("width",String(Math.max(0,w)));el.setAttribute("height",String(Math.max(0,h))); };
  renderFocus=()=>{
    const active=focus.active&&W>0&&H>0;
    // SVGSVGElement의 .hidden 프로퍼티는 Chromium 버전에 따라 HTML 요소처럼 속성에
    // 반영되지 않을 수 있다. 실제 hidden 속성과 display를 함께 바꿔 종료 즉시 걷는다.
    focusVisual.toggleAttribute("hidden",!active); focusVisual.style.display=active?"":"none";
    focusControls.hidden=!(active&&focus.controlsVisible);
    if (focusToolBtn){ focusToolBtn.classList.toggle("active",active); focusToolBtn.setAttribute("aria-pressed",String(active)); }
    syncFocusPanel();
    if (!active) return;
    focusVisual.setAttribute("viewBox",`0 0 ${W} ${H}`); focusVisual.setAttribute("width",String(W)); focusVisual.setAttribute("height",String(H));
    setSvgBox(focusMaskBase,0,0,W,H); setSvgBox(focusDim,0,0,W,H);
    const g=whiteboardFocusGeometry(focus,W,H);
    if (g.mode==="spotlight"){
      focusDim.style.display=""; focusCurtain.style.display="none";
      focusDim.setAttribute("fill-opacity",String(focus.dimOpacity));
      const ellipse=g.shape==="ellipse";
      focusMaskEllipse.style.display=ellipse?"":"none"; focusMaskRect.style.display=ellipse?"none":"";
      focusMaskEllipse.setAttribute("cx",String(g.cx)); focusMaskEllipse.setAttribute("cy",String(g.cy)); focusMaskEllipse.setAttribute("rx",String(g.rx)); focusMaskEllipse.setAttribute("ry",String(g.ry));
      setSvgBox(focusMaskRect,g.x,g.y,g.w,g.h);
      focusFrame.className="wb-focus-frame"; Object.assign(focusFrame.style,{left:g.x+"px",top:g.y+"px",width:g.w+"px",height:g.h+"px",borderRadius:ellipse?"50%":"12px",border:"2px solid rgba(255,255,255,.92)"});
      focusHandles.forEach((button,index)=>{ const [hx,hy]=focusHandleDefs[index]; button.hidden=false; button.style.left=(g.x+g.w*hx)+"px"; button.style.top=(g.y+g.h*hy)+"px"; });
      focusMoveHandle.hidden=false; focusMoveHandle.style.left=g.cx+"px"; focusMoveHandle.style.top=g.cy+"px"; curtainHandle.hidden=true;
      const lamp=whiteboardFlashlightGeometry(focus,W,H);
      flashlightBeam.style.display=lamp.visible?"":"none"; flashlightBody.style.display=lamp.visible?"":"none";
      if (lamp.visible){
        flashlightBeam.setAttribute("d","M"+lamp.beam.map(point=>point[0]+","+point[1]).join(" L")+" Z");
        flashlightBody.setAttribute("transform",`translate(${lamp.lensX} ${lamp.lensY}) rotate(${lamp.angle})`);
      }
    } else {
      focusDim.style.display="none"; focusCurtain.style.display=""; focusMaskEllipse.style.display="none"; focusMaskRect.style.display="none";
      flashlightBeam.style.display="none"; flashlightBody.style.display="none";
      setSvgBox(focusCurtain,g.x,g.y,g.w,g.h); focusCurtain.setAttribute("fill",focus.curtain.color==="light"?"#ffffff":"#111827");
      const horizontal=g.edge==="top"||g.edge==="bottom";
      focusFrame.className="wb-focus-frame is-curtain "+(horizontal?"horizontal":"vertical");
      Object.assign(focusFrame.style,{left:(horizontal?0:g.boundary)+"px",top:(horizontal?g.boundary:0)+"px",width:(horizontal?W:0)+"px",height:(horizontal?0:H)+"px",borderRadius:"0",border:"0"});
      focusHandles.forEach(button=>button.hidden=true); focusMoveHandle.hidden=true; curtainHandle.hidden=false;
      curtainHandle.textContent=horizontal?"⋯":"⋮"; curtainHandle.style.cursor=horizontal?"ns-resize":"ew-resize"; curtainHandle.style.left=(horizontal?W/2:g.boundary)+"px"; curtainHandle.style.top=(horizontal?g.boundary:H/2)+"px";
      curtainHandle.setAttribute("aria-orientation",horizontal?"vertical":"horizontal"); curtainHandle.setAttribute("aria-valuemin","0"); curtainHandle.setAttribute("aria-valuemax","100"); curtainHandle.setAttribute("aria-valuenow",String(Math.round(g.amount*100))); curtainHandle.setAttribute("aria-valuetext",Math.round(g.amount*100)+"% 가림");
    }
  };
  flashFocusBoundary=()=>{
    if (!focus.active) return;
    clearTimeout(focusFlashTimer); focusVisual.classList.remove("blocked"); void focusVisual.getBoundingClientRect(); focusVisual.classList.add("blocked");
    focusFlashTimer=setTimeout(()=>focusVisual.classList.remove("blocked"),260);
  };

  const beginSpotlightDrag=(e,hx,hy,moveOnly=false)=>{
    if (!focus.active||focus.mode!=="spotlight"||!W||!H) return;
    e.preventDefault(); e.stopPropagation(); const target=e.currentTarget,pointerId=e.pointerId,startX=e.clientX,startY=e.clientY,g=whiteboardFocusGeometry(focus,W,H);
    const start={left:g.x/W,top:g.y/H,right:(g.x+g.w)/W,bottom:(g.y+g.h)/H};
    try{target.setPointerCapture(pointerId);}catch(_){}
    const move=(ev)=>{
      if(ev.pointerId!==pointerId)return; const dx=(ev.clientX-startX)/W,dy=(ev.clientY-startY)/H,minW=Math.min(1,96/W),minH=Math.min(1,72/H); let {left,top,right,bottom}=start;
      if(moveOnly){ const width=right-left,height=bottom-top; left=Math.max(0,Math.min(1-width,left+dx));top=Math.max(0,Math.min(1-height,top+dy));right=left+width;bottom=top+height; }
      else {
        if(hx===0)left=Math.max(0,Math.min(right-minW,left+dx)); else if(hx===1)right=Math.min(1,Math.max(left+minW,right+dx));
        if(hy===0)top=Math.max(0,Math.min(bottom-minH,top+dy)); else if(hy===1)bottom=Math.min(1,Math.max(top+minH,bottom+dy));
      }
      setFocus({spotlight:{...focus.spotlight,cx:(left+right)/2,cy:(top+bottom)/2,width:right-left,height:bottom-top}},{persist:false});
    };
    const end=(ev)=>{if(ev&&ev.pointerId!==pointerId)return;target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",end);target.removeEventListener("pointercancel",end);target.removeEventListener("lostpointercapture",end);focusDragCleanup=null;saveFocusPrefs();};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",end);target.addEventListener("pointercancel",end);target.addEventListener("lostpointercapture",end); focusDragCleanup=()=>end();
  };
  focusHandles.forEach(button=>button.addEventListener("pointerdown",e=>beginSpotlightDrag(e,Number(button.dataset.hx),Number(button.dataset.hy))));
  focusMoveHandle.addEventListener("pointerdown",e=>beginSpotlightDrag(e,.5,.5,true));
  const beginCurtainDrag=(e)=>{
    if(!focus.active||focus.mode!=="curtain"||!W||!H)return;
    e.preventDefault();e.stopPropagation();const target=e.currentTarget,pointerId=e.pointerId,startX=e.clientX,startY=e.clientY,startAmount=focus.curtain.amount,edge=focus.curtain.edge;
    try{target.setPointerCapture(pointerId);}catch(_){}
    const move=(ev)=>{if(ev.pointerId!==pointerId)return;let amount=startAmount;if(edge==="top")amount+=(ev.clientY-startY)/H;else if(edge==="bottom")amount-=(ev.clientY-startY)/H;else if(edge==="left")amount+=(ev.clientX-startX)/W;else amount-=(ev.clientX-startX)/W;amount=Math.max(0,Math.min(1,amount));if(amount<.02)amount=0;else if(amount>.98)amount=1;setFocus({curtain:{...focus.curtain,amount}},{persist:false});};
    const end=(ev)=>{if(ev&&ev.pointerId!==pointerId)return;target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",end);target.removeEventListener("pointercancel",end);target.removeEventListener("lostpointercapture",end);focusDragCleanup=null;saveFocusPrefs();};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",end);target.addEventListener("pointercancel",end);target.addEventListener("lostpointercapture",end);focusDragCleanup=()=>end();
  };
  curtainHandle.addEventListener("pointerdown",beginCurtainDrag);
  curtainHandle.addEventListener("keydown",e=>{
    if(!focus.active||focus.mode!=="curtain"||!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key))return;
    e.preventDefault();const delta=(e.shiftKey ? .05 : .01),increase=(focus.curtain.edge==="top"?e.key==="ArrowDown":focus.curtain.edge==="bottom"?e.key==="ArrowUp":focus.curtain.edge==="left"?e.key==="ArrowRight":e.key==="ArrowLeft");
    setFocus({curtain:{...focus.curtain,amount:Math.max(0,Math.min(1,focus.curtain.amount+(increase?delta:-delta)))}});
  });
  const focusFloat=typeof makeFloatingPanel==="function"?makeFloatingPanel(focusPanel,focusHead,{
    storageKey:"manneung-whiteboard:focus-rect:v1",min:{w:280,h:250},
    bounds:()=>{const box=typeof byId==="function"?byId("content"):null;return box?box.getBoundingClientRect():null;},
    host:()=>document.fullscreenElement||document.body,zIndex:()=>63
  }):null;

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
  formulaInput.placeholder = String.raw`LaTeX 수식 또는 '일반 문자열' (예: '속력은' \frac{d}{t})`; formulaInput.setAttribute("aria-label", "LaTeX 수식과 일반 문자열 입력");
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
  // 메모창처럼 제목줄을 끌어 옮기고, 네 변·네 모서리로 크기를 조절한다(위치·크기는 저장된다).
  // 무대 밖으로도 나갈 수 있게 화면 좌표로 띄우되, 앱 헤더는 이 창보다 위 층이라 가려 버리므로
  // 움직일 수 있는 범위는 작업 영역(#content)으로 잡는다.
  const eduFloat = typeof makeFloatingPanel === "function" ? makeFloatingPanel(eduPanel, eduHead, {
    storageKey: "manneung-whiteboard:edu-rect:v1",
    min: { w:300, h:280 },
    bounds: () => {
      const box = typeof byId === "function" ? byId("content") : null;
      return box ? box.getBoundingClientRect() : null;
    },
    // 전체화면(#content)에서는 핸들 레이어도 그 안에 있어야 보인다
    host: () => document.fullscreenElement || document.body,
    // 핸들 띠는 body 에 붙으므로 main(z-index:19)·헤더(30)·사이드바(40)보다 위여야 잡힌다.
    // 창 자체는 main 안이라 그 위로 못 올라가지만, 움직이는 범위를 헤더 아래로 잡아 두어 어긋나지 않는다.
    zIndex: () => 61
  }) : null;

  const EDU_CATEGORIES = [
    ["symbol", "기호"], ["formula", "수식"], ["geometry", "도형"], ["science", "과학"]
  ];
  const FORMULA_GROUPS = [
    ["all", "전체"], ["recent", "최근"], ["favorite", "즐겨찾기"], ["basic", "기본"],
    ["algebra", "대수"], ["calculus", "미적분"], ["set", "집합·논리"], ["statistics", "확률·통계"],
    ["geometry-formula", "기하"], ["science-formula", "과학"], ["custom", "내 수식"]
  ];
  const STENCIL_GROUPS = {
    geometry:[["all","전체"],["plane","평면도형"],["solid","입체도형"],["construction","작도·원"],["graph","좌표·그래프"],["data","자료·통계"]],
    science:[["all","전체"],["mechanics","역학"],["waves","파동·소리"],["electricity","전기·자기"],["optics","광학"],["chemistry","화학"],["biology","생명"],["earth","지구과학"]]
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
    if (whiteboardFormulaNeedsInput(source, formulaStops)){ selectFormulaStop(Math.max(0, formulaStopIndex)); if (typeof toast === "function") toast("표시된 한글 입력 부분을 모두 채워 주세요. Tab으로 이동할 수 있어요.", 2200); return; }
    const target = editingFormulaItem;
    const center = visibleBoardCenter();
    if (insertFormulaSource(source, center.x, center.y, target)){ resetFormulaEditor(); }
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
    eduSearch.placeholder = eduCategory === "formula" ? "한글·영문·LaTeX 수식 검색" : eduCategory === "geometry" ? "평면·입체·작도·그래프·통계 검색" : eduCategory === "science" ? "역학·파동·전기·광학·화학·생명·지구 검색" : "기호·수식·도형 검색";
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
      // 미리보기는 패널의 테마 글자색을 따르고, 실제 삽입 도형은 아래 insertEducationEntry 에서 wb.color 를 유지한다.
      if (entry.kind === "stencil") visual.innerHTML = whiteboardStencilSvg(entry.id, "currentColor");
      else if (entry.kind === "formula") visual.innerHTML = formulaMathMl(entry.source);
      else visual.textContent = entry.value;
      const label = document.createElement("span"); label.className = "wb-edu-label"; label.textContent = entry.label;
      card.append(visual, label);
      card.addEventListener("click", () => { const center=visibleBoardCenter(); return entry.kind === "formula" ? insertFormulaTemplate(entry) : insertEducationEntry(entry, center.x, center.y); });
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
    if (open){ toggleFocusPanel(false); renderEducationPanel(); if (eduFloat) eduFloat.clampOnOpen(); requestAnimationFrame(() => (editingFormulaItem ? formulaInput : eduSearch).focus({ preventScroll:true })); }
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
  customColor = document.createElement("input"); customColor.type = "color"; customColor.className = "wb-color-input"; customColor.value = wb.color; customColor.title = "색 직접 고르기";
  customColor.addEventListener("input", () => setColor(customColor.value, { applySelected:false }));
  customColor.addEventListener("change", () => setColor(customColor.value));
  colorGroup.appendChild(customColor);

  // ----- 배경색 -----
  // 도구막대가 이미 빽빽해서 프리셋을 늘어놓는 대신 버튼 하나로 접어 두고, 누르면 무대 왼쪽 위에
  // 작은 판이 뜬다(수학·과학 도구상자와 같은 방식이라 위치 계산이 필요 없다).
  const bgPanel = document.createElement("div");
  bgPanel.className = "wb-bg-panel"; bgPanel.hidden = true;
  bgPanel.id = "wb-bg-panel-" + doc.id;
  bgPanel.setAttribute("role", "dialog"); bgPanel.setAttribute("aria-label", "보드 배경색");
  const bgHead = document.createElement("div"); bgHead.className = "wb-bg-head";
  const bgTitle = document.createElement("strong"); bgTitle.textContent = "배경색";
  bgHead.append(bgTitle, mkBtn("×", "배경색 고르기 닫기 (Esc)", "wb-edu-close", () => toggleBackgroundPanel(false)));
  const bgChoices = document.createElement("div"); bgChoices.className = "wb-bg-choices";
  const bgChoiceEls = [];
  for (const preset of (typeof BOARD_BG_PRESETS !== "undefined" ? BOARD_BG_PRESETS : [])){
    const choice = mkBtn("", preset.label, "wb-bg-choice", () => setBackground(preset.color));
    choice.style.background = preset.color; choice.dataset.boardBg = preset.color;
    bgChoiceEls.push(choice); bgChoices.appendChild(choice);
  }
  const bgCustomRow = document.createElement("label"); bgCustomRow.className = "wb-bg-custom";
  const bgCustomLabel = document.createElement("span"); bgCustomLabel.textContent = "직접 고르기";
  const bgCustom = document.createElement("input"); bgCustom.type = "color"; bgCustom.className = "wb-color-input";
  bgCustom.value = wb.bg; bgCustom.title = "배경색 직접 고르기";
  // 색 고르개는 끌 때마다 input 이 쏟아진다 — 배경만 따라 바꿔 보여 주고, 펜 색 조정은 다 고른
  // 뒤(change) 한 번만 한다. 안 그러면 밝은 색과 어두운 색 사이를 지날 때마다 알림이 쌓인다.
  bgCustom.addEventListener("input", () => setBackground(bgCustom.value, { adjustInk:false }));
  bgCustom.addEventListener("change", () => setBackground(bgCustom.value));
  bgCustomRow.append(bgCustomLabel, bgCustom);
  const bgHint = document.createElement("p"); bgHint.className = "wb-bg-hint";
  bgHint.textContent = "이 보드에만 적용돼요. 새 보드의 기본 배경은 설정 › 문서에서 정합니다.";
  bgPanel.append(bgHead, bgChoices, bgCustomRow, bgHint);
  stage.appendChild(bgPanel);

  const bgGroup = grp();
  const bgToggleBtn = mkBtn("", "보드 배경색 바꾸기", "wb-act wb-bg-toggle", () => toggleBackgroundPanel());
  const bgToggleDot = document.createElement("span"); bgToggleDot.className = "wb-bg-dot";
  bgToggleBtn.appendChild(bgToggleDot);
  bgToggleBtn.setAttribute("aria-controls", bgPanel.id); bgToggleBtn.setAttribute("aria-expanded", "false");
  bgGroup.appendChild(bgToggleBtn);

  function toggleBackgroundPanel(force){
    const open = force == null ? bgPanel.hidden : !!force;
    bgPanel.hidden = !open;
    bgToggleBtn.classList.toggle("active", open);
    bgToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open){ toggleFocusPanel(false); requestAnimationFrame(() => { if (bgCustom.isConnected) bgCustom.focus({ preventScroll:true }); }); }
  }
  const syncBackgroundChoices = () => {
    bgToggleDot.style.background = wb.bg;
    if (bgCustom.value !== wb.bg) bgCustom.value = wb.bg;
    for (const choice of bgChoiceEls) choice.setAttribute("aria-pressed", String(choice.dataset.boardBg === wb.bg));
  };
  // 배경색은 판서 내용이 아니라 보드의 속성이라 되돌리기(Ctrl+Z) 대상에서 뺐다.
  // 대신 복구 스냅샷에 바로 남겨 탭을 닫았다 다시 열어도 고른 색이 그대로 온다.
  const setBackground = (value, options={}) => {
    const next = typeof normalizeBoardBg === "function" ? normalizeBoardBg(value) : boardSnapshotBg(value);
    const changed = next !== wb.bg;
    wb.bg = next;
    applyBoardBackground();
    syncBackgroundChoices();
    redraw();
    if (changed){
      scheduleBoardRecovery();
      // 녹화 중에 배경을 바꿨다면 리플레이도 같은 배경으로 재생돼야 한다.
      if (doc.recorder && doc.recorder.active && typeof doc.recorder.setBackground === "function") doc.recorder.setBackground(next);
    }
    if (options.adjustInk === false) return;
    // 어두운 배경으로 바꾸면 검정 펜은 그은 자리가 보이지 않는다 — 읽히는 색으로 맞춰 주고 알린다.
    const ink = typeof boardInkForBackground === "function" ? boardInkForBackground(next, wb.color) : "";
    if (!ink) return;
    setColor(ink, { applySelected:false });
    if (typeof toast === "function"){
      toast(ink === "#ffffff" ? "배경이 어두워 펜 색을 흰색으로 맞췄어요." : "배경이 밝아 펜 색을 검정으로 맞췄어요.", 2400);
    }
  };

  const widthGroup = grp();
  [["2", "S", 2], ["4", "M", 4], ["8", "L", 8]].forEach(([k, label, w]) => { const b = mkBtn(label, "굵기 " + label, "wb-width", () => setWidth(w)); widthBtns[k] = b; widthGroup.appendChild(b); });

  const zoomGroup = grp();
  const zoomOutBtn = mkBtn("−", "화이트보드 화면 축소", "wb-act wb-zoom-step", () => setViewScale(view.scale / 1.25));
  zoomLabelBtn = mkBtn(Math.round(view.scale * 100) + "%", "화이트보드 배율 100%로 초기화", "wb-act wb-zoom-label", resetView);
  const zoomInBtn = mkBtn("+", "화이트보드 화면 확대", "wb-act wb-zoom-step", () => setViewScale(view.scale * 1.25));
  zoomGroup.append(zoomOutBtn, zoomLabelBtn, zoomInBtn);

  const focusGroup=grp();
  focusToolBtn=mkBtn("◉","집중 도구 — 스포트라이트·화면 가리개","wb-act wb-focus-toggle",()=>toggleFocusPanel());
  focusToolBtn.setAttribute("aria-controls",focusPanel.id); focusToolBtn.setAttribute("aria-expanded","false"); focusToolBtn.setAttribute("aria-pressed",String(focus.active));
  focusGroup.appendChild(focusToolBtn);

  const imgGroup = grp();
  eduToolBtn = mkBtn("∑", "수학·과학 도구상자", "wb-act wb-edu-toggle", () => toggleEducationPanel());
  eduToolBtn.setAttribute("aria-controls", eduPanel.id); eduToolBtn.setAttribute("aria-expanded", "false");
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.hidden = true;
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; if (f) insertImageBlob(f); fileInput.value = ""; });
  imgGroup.append(eduToolBtn, mkIconBtn("image", "이미지 넣기 — 파일 선택 (또는 Ctrl+V 붙여넣기·드래그드롭)", "wb-act", () => fileInput.click()), fileInput);

  const actGroup = grp();
  undoBtn = mkIconBtn("undo", "되돌리기 (Ctrl+Z)", "wb-act", doUndo);
  redoBtn = mkIconBtn("redo", "다시 실행 (Ctrl+Y)", "wb-act", doRedo);
  flipXBtn = mkBtn("↔", "선택한 교육 도형 좌우 반전", "wb-act wb-flip-x", () => flipSelected("flipX")); flipXBtn.disabled = true;
  flipYBtn = mkBtn("↕", "선택한 교육 도형 상하 반전", "wb-act wb-flip-y", () => flipSelected("flipY")); flipYBtn.disabled = true;
  groupActionBtn = mkBtn("분리", "선택한 교육 도형의 그룹 풀기", "wb-act wb-ungroup", ungroupSelected); groupActionBtn.disabled = true;
  const clearBtn = mkIconBtn("trash", "보드 전체 지우기", "wb-act wb-clear", () => {
    if (!wb.items.length) return;
    if (typeof confirmDialog === "function"){ confirmDialog("보드 내용을 모두 지울까요?", "지우기", "취소").then(ok => { if (ok) clearAll(); }); }
    else clearAll();
  });
  actGroup.append(undoBtn, redoBtn, flipXBtn, flipYBtn, groupActionBtn, clearBtn);

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

  tools.append(posGroup, toolGroup, colorGroup, bgGroup, widthGroup, zoomGroup, focusGroup, imgGroup, actGroup, exportGroup, recGroup);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function"){ window.MNI18N.translateTree(tools); window.MNI18N.translateTree(bgPanel); window.MNI18N.translateTree(focusPanel); }
  // 열면 선택·이동 도구가 기본 활성 + 현재 판서를 기준점으로. 펜 색은 배경에 묻히지 않는 쪽으로 시작한다
  // (칠판 배경으로 저장해 둔 보드를 다시 열었을 때 검정 펜으로 시작하면 그어도 아무것도 안 보인다).
  const startInk = (typeof boardInkForBackground === "function" && boardInkForBackground(wb.bg, "#111111")) || "#111111";
  setTool("select"); setColor(startInk); setWidth(4); syncBackgroundChoices(); history.reset();

  // ----- 키보드(이 보드가 활성일 때만): Ctrl+Z / Ctrl+Y -----
  const onKey = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("wb-textinput")) return;
    const interactive = ae && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(ae.tagName) || ae.isContentEditable);
    if (e.code === "Space" && !interactive && eduPanel.hidden && bgPanel.hidden && focusPanel.hidden){
      e.preventDefault(); e.stopPropagation(); spacePanning = true; canvas.classList.add("pan-ready"); return;
    }
    if (e.key === "Escape" && !bgPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleBackgroundPanel(false); bgToggleBtn.focus(); return;
    }
    if (e.key === "Escape" && !eduPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleEducationPanel(false); return;
    }
    if (e.key === "Escape" && !focusContextMenu.hidden){ e.preventDefault(); e.stopPropagation(); closeFocusContextMenu(); return; }
    if (e.key === "Escape" && !focusPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleFocusPanel(false); if (focusToolBtn) focusToolBtn.focus(); return;
    }
    if (e.key === "Escape" && focus.active){ e.preventDefault(); e.stopPropagation(); stopFocus(); return; }
    if (!bgPanel.hidden && ae && bgPanel.contains(ae)) return;
    if (!eduPanel.hidden && ae && eduPanel.contains(ae)) return;
    if (!focusPanel.hidden && ae && focusPanel.contains(ae)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); doRedo(); }
    } else if ((e.key === "Delete" || e.key === "Backspace") && wb.selected){      // 선택한 이미지·도형·텍스트 삭제
      e.preventDefault(); e.stopPropagation();
      deleteSelected();
    } else if (e.key === "Escape" && wb.selected){ wb.selected = null; redraw(); }   // 선택 해제
  };
  const onKeyUp = (e) => {
    if (e.code !== "Space") return;
    spacePanning = false; canvas.classList.remove("pan-ready");
  };
  const onWindowBlur = () => { spacePanning=false; canvas.classList.remove("pan-ready"); closeFocusContextMenu(); };
  // 배경색 판은 색만 고르면 볼 일이 끝나므로 바깥을 누르면 닫는다(색 고르개 창은 문서 밖이라 걸리지 않는다).
  const onPointerDownOutside = (e) => {
    if (!focusContextMenu.hidden && !focusContextMenu.contains(e.target)) closeFocusContextMenu();
    if (bgPanel.hidden) return;
    const target = e.target;
    if (bgPanel.contains(target) || bgToggleBtn.contains(target)) return;
    toggleBackgroundPanel(false);
  };
  document.addEventListener("pointerdown", onPointerDownOutside, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onWindowBlur);

  // ----- 사이즈 추적 + 정리 -----
  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  restoreBoardImages();
  requestAnimationFrame(resize);

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { clearTimeout(boardRecoveryTimer); clearTimeout(focusFlashTimer); if (focusDragCleanup) focusDragCleanup(); if (doc.recorder) doc.recorder.active = false; stage.removeEventListener("contextmenu",onFocusContextMenu); focusContextMenu.remove(); document.removeEventListener("pointerdown", onPointerDownOutside, true); document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onKeyUp, true); window.removeEventListener("blur", onWindowBlur); document.removeEventListener("copy", onCopy); document.removeEventListener("paste", onPaste); if (ro) ro.disconnect(); if (focusFloat) focusFloat.destroy(); if (eduFloat) eduFloat.destroy(); imageUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_){} }); });
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    boardStateFromSnapshot, boardRecoveryKey, chooseBoardSnapshot, boardSnapshotBg,
    whiteboardClipboardItem, whiteboardRecolorItem, whiteboardItemColor, whiteboardPresetResizeItem,
    whiteboardEducationCatalog, whiteboardFormulaDictionary, expandWhiteboardFormulaTemplate, whiteboardFormulaNeedsInput, normalizeWhiteboardFormulaLibrary,
    whiteboardStencilSvg, whiteboardStencilGroup, whiteboardVectorGroupSvg, whiteboardFormulaSvg, whiteboardSvgDataUrl,
    whiteboardClampView, whiteboardZoomAt,
    normalizeWhiteboardFocusState, whiteboardFocusGeometry, whiteboardFocusAllowsPoint, whiteboardFlashlightGeometry
  };
}
