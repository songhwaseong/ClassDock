"use strict";

/* ===== 독립 화이트보드(설명용 칠판) =====
   새 문서 종류 "board". 벡터 모델(items)로 그려 undo/redo·리사이즈에 안전하고,
   PNG/PDF 로 내보낸다. 새 라이브러리 없이 캔버스만 사용. */

let _boardCount = 0;
const BOARD_RECOVERY_PREFIX = "classdock-board-recovery:";
const WB_EDU_TRANSFER_TYPE = "application/x-classdock-whiteboard-education";
const WB_ITEM_TRANSFER_TYPE = "application/x-classdock-whiteboard-item";
const WB_FORMULA_LIBRARY_KEY = "mn.wbFormulaLibrary.v1";
const WB_FOCUS_PREFS_KEY = "classdock-whiteboard:focus-prefs:v1";
const WB_TEXT_SIZE_MIN = 12;
const WB_TEXT_SIZE_MAX = 72;
const WB_OBJECT_SCALE_MIN = 25;
const WB_OBJECT_SCALE_MAX = 400;

function normalizeWhiteboardTextSize(value, fallback=16){
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : 16;
  const number = value == null || String(value).trim() === "" ? NaN : Number(value);
  return Math.max(WB_TEXT_SIZE_MIN, Math.min(WB_TEXT_SIZE_MAX, Math.round(Number.isFinite(number) ? number : safeFallback)));
}

function normalizeWhiteboardObjectScale(value, fallback=100){
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : 100;
  const number = value == null || String(value).trim() === "" ? NaN : Number(value);
  return Math.max(WB_OBJECT_SCALE_MIN, Math.min(WB_OBJECT_SCALE_MAX, Math.round(Number.isFinite(number) ? number : safeFallback)));
}

function whiteboardObjectScalePercent(value){
  if (!value || typeof value !== "object") return 0;
  if (value.type === "image" && value.role === "education-formula"){
    const baseW = Number(value.formulaBaseW) || (value.img && value.img.naturalWidth) || value.w;
    const baseH = Number(value.formulaBaseH) || (value.img && value.img.naturalHeight) || value.h;
    return Math.round(Math.sqrt(Math.max(.0001, Number(value.w) * Number(value.h) / Math.max(1, baseW * baseH))) * 100);
  }
  if (value.type === "group" && value.role === "education-stencil"){
    const baseW = Number(value.sourceW) || Number(value.w) || 240;
    const baseH = Number(value.sourceH) || Number(value.h) || 190;
    return Math.round(Math.sqrt(Math.max(.0001, Number(value.w) * Number(value.h) / Math.max(1, baseW * baseH))) * 100);
  }
  return 0;
}

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

// 측정 대상과 라벨은 보드 안에서 mid/measureFor 한 쌍으로 연결된다. 복제본이 그 식별자를
// 그대로 가져가면 원본 라벨을 가로채므로, 붙여넣을 때는 독립 항목으로 떼어 낸다.
function whiteboardDetachedClipboardItem(value){
  const copy = whiteboardClipboardItem(value);
  if (!copy) return null;
  delete copy.mid;
  if (copy.role === "measure" && copy.measureFor){
    delete copy.role; delete copy.measureFor; delete copy.measureKind;
    delete copy.anchorX; delete copy.anchorY;
  }
  return copy;
}

function whiteboardGraphUsesManualY(spec){
  return !!(spec && spec.yMin != null && spec.yMax != null
    && Number.isFinite(Number(spec.yMin)) && Number.isFinite(Number(spec.yMax)));
}

let _whiteboardInternalClipboard = null;
function setWhiteboardInternalClipboard(value){
  const item = whiteboardClipboardItem(value);
  _whiteboardInternalClipboard = item;
  return !!item;
}
function getWhiteboardInternalClipboard(){
  return whiteboardClipboardItem(_whiteboardInternalClipboard);
}
function hasWhiteboardInternalClipboard(){
  return !!_whiteboardInternalClipboard;
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

function whiteboardCanFlipItem(value){
  return !!(value && (value.type === "image" || (value.type === "group" && value.role === "education-stencil")));
}

// 수식 색상 변경은 SVG를 다시 만들지만, 보드 위 배치까지 다시 계산할 이유는 없다.
// 화면 이동·확대 뒤의 수식 좌표는 현재 스테이지 W/H 밖일 수 있으므로 색만 바꿀 때
// 화면 크기로 좌표를 clamp하면 수식이 다른 위치로 튄다.
function whiteboardFormulaReplacementRect(existing, baseW, baseH, stageW, stageH, preserveGeometry=false){
  if (!existing || typeof existing !== "object") return null;
  if (preserveGeometry){
    return { x:existing.x, y:existing.y, w:existing.w, h:existing.h };
  }
  const centerX = existing.x + existing.w / 2, centerY = existing.y + existing.h / 2;
  const displayScale = existing.formulaBaseH ? Math.max(.2, existing.h / existing.formulaBaseH) : 1;
  let w = baseW * displayScale, h = baseH * displayScale;
  const sc = Math.min(1, stageW * .85 / w, stageH * .85 / h); w = Math.round(w * sc); h = Math.round(h * sc);
  return {
    x:Math.max(0, Math.min(Math.round(centerX - w / 2), Math.max(0, stageW - w))),
    y:Math.max(0, Math.min(Math.round(centerY - h / 2), Math.max(0, stageH - h))),
    w, h
  };
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
  // 공용 escapeHtml 과 같은 일을 하지만 일부러 여기 둔다 - 이 함수는 앱 전역 없이 혼자 도는
  // 순수 함수라 테스트가 whiteboard.js 만 require 해서 부른다(whiteboard-education-toolbox).
  // 전역으로 바꾸면 그 테스트가 ReferenceError 로 죽는다.
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
// 새 보드를 열 때 쓸 배경 무늬(설정값). 배경색과 마찬가지로 "새 보드"에만 쓰고 기존 보드는 건드리지 않는다.
function defaultBoardPattern(){
  try {
    if (typeof normalizeBoardPattern === "function" && typeof appSettings === "object" && appSettings) return normalizeBoardPattern(appSettings.boardPattern);
  } catch(_){}
  return null;
}
// 스냅샷에 담긴 배경 무늬. 무늬가 없던 시절의 스냅샷·손상된 값은 모두 "무늬 없음"(null)이다.
function boardSnapshotPattern(value){
  if (typeof normalizeBoardPattern === "function") return normalizeBoardPattern(value);
  return (value && typeof value === "object" && value.id && value.id !== "none") ? { ...value } : null;
}
// 스냅샷에 담긴 배경 그림. data URL 이 아닌 값(바깥 주소·손상)은 그림 없음으로 떨어뜨린다.
function boardSnapshotImage(value){
  if (typeof normalizeBoardImage === "function") return normalizeBoardImage(value);
  return (value && typeof value === "object" && /^data:image\//i.test(String(value.src || ""))) ? { ...value } : null;
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
  return { tool:"pen", color:"#111111", width:4, textSize:normalizeWhiteboardTextSize(snapshot.textSize), bg:boardSnapshotBg(snapshot.bg), bgPattern:boardSnapshotPattern(snapshot.bgPattern), bgImage:boardSnapshotImage(snapshot.bgImage), items:snapshot.items, selected:null };
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
  const restoredNumber = /^화이트보드(?:\s+(\d+))?$/.exec(name);
  if (restoredNumber) _boardCount = Math.max(_boardCount, Number(restoredNumber[1]) || 1);
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
  activateIfIdle(doc, options.restoreInBackground ? { bulk:true } : {});
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
  const wb = doc.boardState || (doc.boardState = { tool: "pen", color: "#111111", width: 4, textSize:16, items: [], bg: defaultBoardBg(), bgPattern: defaultBoardPattern(), bgImage: null, selected: null });
  wb.textSize = normalizeWhiteboardTextSize(wb.textSize);
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
  let zoomLabelBtn = null, zoomOutBtn = null, zoomInBtn = null;
  let contextZoomOutBtn = null, contextZoomResetBtn = null, contextZoomInBtn = null;
  let positionTextEditor = null, spacePanning = false, lastBoardPointer = null;
  let renderFocus = () => {}, flashFocusBoundary = () => {};
  const focusAllowsScreenPoint = (p) => whiteboardFocusAllowsPoint(focus, p, W, H);
  const clampView = () => {
    Object.assign(view, whiteboardClampView(view, W, H));
  };
  const screenPoint = (e) => { const r = canvas.getBoundingClientRect(); return { x:e.clientX-r.left, y:e.clientY-r.top }; };
  const boardPointFromScreen = (p) => ({ x:(p.x-view.x)/view.scale, y:(p.y-view.y)/view.scale });
  const visibleBoardCenter = () => boardPointFromScreen({ x:W/2, y:H/2 });
  let boardRecoveryTimer = 0, boardRecoveryWarned = false;
  // 저장·전송 공용 직렬화: <img> 객체는 못 담으므로 data URL(src)만 남긴다.
  const boardSnapshot = () => (syncMeasureItems(), {
    version:1,
    savedAt:Date.now(),
    bg:wb.bg,
    bgPattern:wb.bgPattern,
    // 그림은 <img> 객체를 못 담는다 — 항목 이미지와 같이 data URL(src)만 남긴다.
    bgImage:wb.bgImage ? { ...wb.bgImage, img:undefined } : null,
    textSize:wb.textSize,
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
      boardRecoveryWarned = false;
      return true;
    } catch(error){
      console.warn("whiteboard recovery snapshot skipped:", error);
      /* 여기 걸리는 건 대부분 localStorage 용량(≈5MB)이다 — 배경 사진·붙여넣은 그림이 많으면 넘는다.
         조용히 넘기면 "탭을 닫았다 열면 판서가 그대로"라는 약속이 소리 없이 깨지므로 한 번은 알린다.
         한 번만: 획을 그을 때마다 시도하므로 알림이 쌓이면 판서를 못 한다. */
      if (!boardRecoveryWarned){
        boardRecoveryWarned = true;
        if (typeof toast === "function") toast("내용이 커서 자동복원본을 남기지 못했어요. 탭을 닫기 전에 PNG 로 저장해 두세요.", 4200, { type:"error" });
      }
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
  const applyStroke = (it) => applyBoardStroke(ctx, it);
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
    syncMeasureItems();
    scheduleBoardRecovery();
    if (doc.recorder && doc.recorder.active){ try { doc.recorder.capture(wb.items, wb.bg, { W, H }, { pattern:wb.bgPattern, image:wb.bgImage }); } catch(_){} }
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
  let editingTextItem = null, openFormulaEditor = null, openPlotEditor = null, openChartEditor = null, openTableEditor = null, openToolItemEditor = null, groupActionBtn = null, flipXBtn = null, flipYBtn = null;
  // 배경색은 캔버스에만 칠하면 부족하다. 무대(.wb-stage)는 창 크기를 바꾸는 순간 캔버스보다 잠깐 커져
  // 흰 테두리가 번쩍이고, 텍스트 입력칸이 흰 상자로 남으면 어두운 배경에 흰 글씨를 칠 때 글자가 안 보인다.
  // CSS 변수 하나로 셋을 같이 움직인다.
  wb.bg = boardSnapshotBg(wb.bg);
  wb.bgPattern = boardSnapshotPattern(wb.bgPattern);
  wb.bgImage = boardSnapshotImage(wb.bgImage);
  // 배경 그림은 현재 화면 자체다. 예전에 저장된 확대·이동 보기 상태가 남아 있어도 그림과 판서가
  // 어긋나지 않도록 배경을 되살리는 순간부터 100% 원점 보기로 고정한다.
  const backgroundViewLocked = () => !!wb.bgImage;
  if (backgroundViewLocked()){ view.scale = 1; view.x = 0; view.y = 0; }
  const applyBoardBackground = () => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(wb.bg.slice(i, i + 2), 16));
    wrap.style.setProperty("--wb-bg", wb.bg);
    wrap.style.setProperty("--wb-textbg", `rgba(${r},${g},${b},.88)`);
  };
  applyBoardBackground();
  // 지금 화면에 보이는 보드 좌표 사각형 = 무늬를 깔 범위(캔버스 전체). 반올림으로 가장자리 한 줄이
  // 비지 않도록 조금 넉넉히 잡는다.
  const visibleBoardArea = () => {
    const scale = view.scale || 1, pad = 2 / scale;
    return { x:-view.x / scale - pad, y:-view.y / scale - pad, w:W / scale + pad * 2, h:H / scale + pad * 2 };
  };
  /* 배경(색+무늬)은 판서를 다 그린 뒤 "밑에 깐다". 먼저 칠하면 지우개(destination-out)가 배경까지
     뚫어 내보낸 PNG 에 구멍이 남는다. 캔버스 변환은 보드 좌표계인 상태로 부른다. */
  const paintBoardBackground = () => {
    MNBoardRenderer.paintBackground(ctx, visibleBoardArea(), { bg:wb.bg, pattern:wb.bgPattern, image:wb.bgImage });
  };
  /* 배경 그림은 스냅샷에 src(data URL)만 있으므로 <img> 로 되살린 뒤에야 그려진다.
     항목 이미지의 restoreBoardImages 와 같은 방식 — 다 불러오면 한 번 다시 그린다. */
  const restoreBoardBackgroundImage = () => {
    const image = wb.bgImage;
    if (!image || image.img || !image.src) return;
    const img = new Image();
    img.onload = () => { if (wb.bgImage === image){ image.img = img; redraw(); } };
    img.onerror = () => { console.warn("whiteboard background image skipped"); };
    img.src = image.src;
  };

  /* ----- 교구(자·각도기·컴퍼스) -----
     교구는 판서 내용이 아니라 손에 든 도구다. items 에 넣지 않고 캔버스 위에 겹쳐 그리며,
     저장 스냅샷·리플레이·내보내기에는 남지 않는다. 대신 "그 도구를 대고 그은 선"만 items 로 남는다. */
  const GEAR_PREFS_KEY = "classdock-whiteboard:gear-prefs:v1";
  const GEAR_LINE = "#2563eb";
  const RULER_THICKNESS = 58, PROTRACTOR_RADIUS = 155, GEAR_SNAP_BAND = 32;
  const RULER_MIN_CM = 2, RULER_MAX_CM = 40;   // 왼쪽 손잡이로 늘릴 수 있는 범위(칠판 자 정도까지)
  const PROTRACTOR_MIN_R = 76, PROTRACTOR_MAX_R = 567;   // 밑변(지름) 4~30cm
  // 각도기 크기는 도구마다 다르므로 인스턴스 값을 쓰되, 예전 도구·잘못된 값은 기본 크기로 되돌린다.
  const protractorRadiusOf = (protractor) => {
    const radius = protractor && Number(protractor.radius);
    return Number.isFinite(radius) ? Math.min(PROTRACTOR_MAX_R, Math.max(PROTRACTOR_MIN_R, radius)) : PROTRACTOR_RADIUS;
  };
  // 가운데 붙잡기(1°씩 맞추기) 판정 반경 — 작은 각도기에서 너무 넓게 먹지 않게 크기를 따라간다.
  const protractorHoldBand = (radius) => Math.max(12, Math.min(30, radius * .17));
  const COMPASS_MIN_R = 76, COMPASS_MAX_R = 1134;   // 반지름 2~30cm
  // 컴퍼스를 너무 좁히면 바늘·반지름·연필 손잡이가 서로를 덮어 다시 벌릴 수 없게 된다.
  const compassRadiusOf = (compass) => {
    const radius = compass && Number(compass.radius);
    return Number.isFinite(radius) ? Math.min(COMPASS_MAX_R, Math.max(COMPASS_MIN_R, radius)) : 120;
  };
  // 반지름 손잡이는 팔의 55% 지점. 양 끝 손잡이와 최소 간격을 두어 항상 따로 잡힌다.
  const compassGripAt = (compass) => {
    const radius = compassRadiusOf(compass), to = (compass && compass.to) || 0;
    const along = Math.min(Math.max(radius * .55, 30), radius - 28);
    return { x:compass.cx + Math.cos(to) * along, y:compass.cy + Math.sin(to) * along };
  };
  const readGearPrefs = () => {
    try { return JSON.parse(localStorage.getItem(GEAR_PREFS_KEY) || "null") || {}; }
    catch(_){ return {}; }
  };
  const gearPrefs = readGearPrefs();
  const gear = doc.boardGear || (doc.boardGear = {
    ruler:null, protractor:null, compass:null,
    snap:gearPrefs.snap === true, tidy:gearPrefs.tidy === true
  });
  const saveGearPrefs = () => {
    try { localStorage.setItem(GEAR_PREFS_KEY, JSON.stringify({ snap:!!gear.snap, tidy:!!gear.tidy })); } catch(_){}
  };
  let gearHidden = false;
  // 변환(대칭·회전·닮음)의 기준점. 패널이 열려 있을 때만 보드에 ✛ 로 보여 준다.
  let transformPivot = null, transformPanel = null, drawTransformPivot = () => {};
  // 손잡이는 판서가 아니라 조작점이라 배율과 상관없이 같은 크기로 잡혀야 한다.
  const gearUi = (value) => value / (view.scale || 1);
  const gearHandleRadius = () => gearUi(13);
  const drawGearHandle = (x, y, active) => {
    const r = gearHandleRadius();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? GEAR_LINE : "#ffffff"; ctx.fill();
    ctx.strokeStyle = GEAR_LINE; ctx.lineWidth = gearUi(1.8); ctx.stroke();
  };
  const drawRulerGear = () => {
    const ruler = gear.ruler; if (!ruler) return;
    const edge = MNBoardTools.rulerEdge(ruler), cm = MNBoardTools.PX_PER_CM;
    ctx.save();
    ctx.translate(edge.a.x, edge.a.y); ctx.rotate(edge.angle);
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = "butt";
    ctx.fillStyle = "rgba(59,130,246,.12)";
    ctx.fillRect(0, 0, edge.length, RULER_THICKNESS);
    ctx.strokeStyle = GEAR_LINE; ctx.lineWidth = gearUi(1.6);
    ctx.strokeRect(0, 0, edge.length, RULER_THICKNESS);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(edge.length, 0);
    ctx.lineWidth = gearUi(2.6); ctx.stroke();                          // 그리는 모서리(눈금 쪽)
    ctx.lineWidth = gearUi(1.3); ctx.fillStyle = GEAR_LINE;
    ctx.font = '11px system-ui,"Malgun Gothic",sans-serif'; ctx.textBaseline = "top";
    for (let d = 0; d <= edge.length + .01; d += cm / 2){
      const major = Math.abs(d / cm - Math.round(d / cm)) < .001;
      ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d, major ? 15 : 8); ctx.stroke();
      if (major && d > 0.5) ctx.fillText(String(Math.round(d / cm)), d + 3, 16);
    }
    ctx.fillText("자 (cm)", 22, RULER_THICKNESS - 18);   // 왼쪽 길이 손잡이를 피해 살짝 안쪽에
    ctx.restore();
    const nx = -Math.sin(edge.angle), ny = Math.cos(edge.angle);
    drawGearHandle(edge.a.x + nx * RULER_THICKNESS / 2, edge.a.y + ny * RULER_THICKNESS / 2, false);  // 왼쪽=길이
    drawGearHandle(edge.b.x + nx * RULER_THICKNESS / 2, edge.b.y + ny * RULER_THICKNESS / 2, false);  // 오른쪽=회전
  };
  const drawProtractorGear = () => {
    const protractor = gear.protractor; if (!protractor) return;
    const radius = protractorRadiusOf(protractor);
    const size = radius / PROTRACTOR_RADIUS;                 // 눈금·글자도 함께 커지고 작아진다
    const fontSize = Math.round(Math.min(20, Math.max(9, 11 * size)));
    ctx.save();
    ctx.translate(protractor.x, protractor.y); ctx.rotate(protractor.angle || 0);
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.arc(0, 0, radius, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = "rgba(59,130,246,.10)"; ctx.fill();
    ctx.strokeStyle = GEAR_LINE; ctx.lineWidth = gearUi(1.6); ctx.stroke();
    ctx.fillStyle = GEAR_LINE; ctx.font = fontSize + 'px system-ui,"Malgun Gothic",sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let degree = 0; degree <= 180; degree += 5){
      const angle = -degree * Math.PI / 180;
      const major = degree % 10 === 0, long = degree % 30 === 0;
      const inner = radius - (long ? 17 : major ? 12 : 7) * size;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.lineTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineWidth = gearUi(major ? 1.5 : 1); ctx.stroke();
      if (long) ctx.fillText(String(degree), Math.cos(angle) * (radius - 28 * size), Math.sin(angle) * (radius - 28 * size));
    }
    ctx.beginPath(); ctx.arc(0, 0, gearUi(4), 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("각도기", -18, 8);
    ctx.restore();
    const angle = protractor.angle || 0;
    drawGearHandle(protractor.x - Math.cos(angle) * radius, protractor.y - Math.sin(angle) * radius, false);  // 왼쪽=크기
    drawGearHandle(protractor.x + Math.cos(angle) * radius, protractor.y + Math.sin(angle) * radius, false);  // 오른쪽=회전
  };
  const drawCompassGear = () => {
    const compass = gear.compass; if (!compass) return;
    const radius = compassRadiusOf(compass);
    const pencil = { x:compass.cx + Math.cos(compass.to) * radius, y:compass.cy + Math.sin(compass.to) * radius };
    const grip = compassGripAt(compass);
    ctx.save(); ctx.globalAlpha = 1;
    ctx.strokeStyle = GEAR_LINE; ctx.lineWidth = gearUi(1.2); ctx.setLineDash([gearUi(5), gearUi(5)]);
    ctx.beginPath(); ctx.arc(compass.cx, compass.cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (compass.drawing){                                                // 지금 돌리고 있는 호를 펜 색으로 미리 보여 준다
      ctx.strokeStyle = wb.color; ctx.lineWidth = Math.max(1, wb.width);
      ctx.beginPath();
      ctx.arc(compass.cx, compass.cy, radius, Math.min(compass.from, compass.to), Math.max(compass.from, compass.to));
      ctx.stroke();
      ctx.strokeStyle = GEAR_LINE;
    }
    ctx.lineWidth = gearUi(3); ctx.beginPath();
    ctx.moveTo(compass.cx, compass.cy); ctx.lineTo(pencil.x, pencil.y); ctx.stroke();
    ctx.restore();
    drawGearHandle(compass.cx, compass.cy, false);
    drawGearHandle(grip.x, grip.y, false);
    drawGearHandle(pencil.x, pencil.y, !!compass.drawing);
  };
  /* ----- 동적 측정 라벨 -----
     라벨은 평범한 text 항목이라 저장·리플레이·내보내기가 그대로 되고, 대상 도형을 끌면
     그릴 때마다 값을 다시 계산해 숫자가 따라 움직인다(모델에는 커밋 시점에 반영). */
  const MEASURE_ROLE = "measure";
  const nextMeasureId = () => "m" + (doc.boardMeasureSeq = (doc.boardMeasureSeq || 0) + 1) + "-" + Math.random().toString(36).slice(2, 7);
  const isMeasureItem = (item) => !!(item && item.role === MEASURE_ROLE && item.measureFor);
  const measureTargetOf = (label) => wb.items.find((item) => item && item.mid === label.measureFor && !isMeasureItem(item)) || null;
  const measureLabelOf = (target) => (target && target.mid ? wb.items.find((item) => isMeasureItem(item) && item.measureFor === target.mid) : null) || null;
  // 사용자가 라벨을 옮겼으면 그 어긋난 만큼(anchor 와의 차이)을 유지한 채 새 자리로 따라간다.
  const measureLabelValues = (label) => {
    const target = measureTargetOf(label);
    if (!target) return null;
    const info = MNBoardTools.measureLabel(target, measureBoardText);
    if (!info) return null;
    const dx = Number.isFinite(label.anchorX) ? label.x - label.anchorX : 0;
    const dy = Number.isFinite(label.anchorY) ? label.y - label.anchorY : 0;
    return { text:info.text, x:info.x + dx, y:info.y + dy, anchorX:info.x, anchorY:info.y, measureKind:info.kind };
  };
  const liveMeasureItem = (label) => {
    const values = measureLabelValues(label);
    return values ? Object.assign({}, label, values) : null;
  };
  // 저장·녹화 직전에 모델에도 최신 값을 적어 둔다. 파생값이라 제자리 갱신해 되돌리기 단계를 늘리지 않는다.
  const syncMeasureItems = () => {
    let dropped = false;
    for (const item of wb.items){
      if (!isMeasureItem(item)) continue;
      const values = measureLabelValues(item);
      if (!values){ dropped = true; continue; }
      Object.assign(item, values);
    }
    if (dropped) wb.items = wb.items.filter((item) => !isMeasureItem(item) || measureTargetOf(item));
    if (syncVectorSumItems()) dropped = true;              // 합력도 같은 파생 항목이라 여기서 함께 맞춘다
    return dropped;
  };

  /* ----- 벡터(힘) 합성 -----
     같은 점에서 출발한 두 화살표를 골라 합력을 붙인다. 측정 라벨과 같은 파생 항목이라
     원본 화살표를 끌면 그릴 때마다 다시 계산해 평행사변형과 합력이 따라 움직인다. */
  const VECTOR_SUM_ROLE = "vector-sum";
  const isVectorSumItem = (item) => !!(item && item.role === VECTOR_SUM_ROLE && Array.isArray(item.vectorSumOf));
  const vectorSumSources = (item) => {
    const found = item.vectorSumOf.map((mid) => wb.items.find((entry) => entry && entry.mid === mid && entry.type === "arrow") || null);
    return found.length === 2 && found.every(Boolean) ? found : null;
  };
  const vectorSumShape = (item) => {
    const sources = vectorSumSources(item);
    if (!sources) return null;
    try { return MNBoardTools.vectorSumGroup(sources[0], sources[1], { color:item.educationColor, sumColor:item.sumColor }); }
    catch(_){ return null; }                               // 합이 0이면 그리지 못한다 — 방금 모양을 그대로 둔다
  };
  const vectorSumFields = (shape) => ({
    x:shape.x, y:shape.y, w:shape.w, h:shape.h, sourceW:shape.sourceW, sourceH:shape.sourceH,
    items:shape.items, vectorSum:shape.vectorSum
  });
  const liveVectorSumItem = (item) => {
    const shape = vectorSumShape(item);
    return shape ? Object.assign({}, item, vectorSumFields(shape)) : null;
  };
  const syncVectorSumItems = () => {
    let dropped = false;
    for (const item of wb.items){
      if (!isVectorSumItem(item)) continue;
      const shape = vectorSumShape(item);
      if (!shape){ if (!vectorSumSources(item)) dropped = true; continue; }
      Object.assign(item, vectorSumFields(shape));
    }
    if (dropped) wb.items = wb.items.filter((item) => !isVectorSumItem(item) || vectorSumSources(item));
    return dropped;
  };
  const vectorSumsFor = (target) => (target && target.mid
    ? wb.items.filter((item) => isVectorSumItem(item) && item.vectorSumOf.includes(target.mid)) : []);

  /* 합성에 쓰인 화살표는 끝점에 손잡이가 생겨 길이·방향을 끌어 바꿀 수 있다.
     (보통 화살표는 통째로 옮기기만 되므로, 합력을 붙인 화살표에만 이 손잡이를 보인다.) */
  const ARROW_TIP_GRAB = 13;
  const arrowTipAt = (p) => {
    for (let i = wb.items.length - 1; i >= 0; i--){
      const item = wb.items[i];
      if (!item || item.type !== "arrow" || !item.mid || !vectorSumsFor(item).length) continue;
      if (Math.hypot(p.x - item.x2, p.y - item.y2) <= ARROW_TIP_GRAB / view.scale) return item;
    }
    return null;
  };
  const drawVectorTipHandles = () => {
    for (const item of wb.items){
      if (!item || item.type !== "arrow" || !item.mid || !vectorSumsFor(item).length) continue;
      drawGearHandle(item.x2, item.y2, false);
    }
  };

  const drawGear = () => {
    // 교구는 손에 든 도구지 판서가 아니다 — 내보내기·인쇄·메모 전송 그림에는 넣지 않는다.
    if (gearHidden) return;
    drawVectorTipHandles();
    if (transformPivot && transformPanel && !transformPanel.hidden) drawTransformPivot();
    if (!gear.ruler && !gear.protractor && !gear.compass) return;
    ctx.save();
    drawRulerGear(); drawProtractorGear(); drawCompassGear();
    ctx.restore();
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  };

  /* 그리기(paint)와 도구막대 맞추기(syncControls)를 가른다.
     둘을 한 덩어리로 두면 도형을 끄는 매 pointermove 마다 버튼 disabled·textContent·색 스와치까지
     다시 쓰게 되는데, 끄는 동안에는 그 값이 하나도 바뀌지 않는다(레이아웃만 매 프레임 다시 잰다).
     paint 는 화면 좌표(view)와 항목에만 의존하고, syncControls 는 선택·도구·색·배율에만 의존한다.
     기존 호출부(60여 곳)는 그대로 두 가지를 다 하는 redraw 를 쓴다 — 끌기 경로만 paint 로 바꾼다. */
  const paint = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    for (const it of wb.items){
      if (it === editingTextItem) continue;
      // 측정 라벨은 그릴 때마다 대상 도형에서 값을 다시 재 끌고 있는 동안에도 숫자가 살아 움직인다.
      drawItem(isMeasureItem(it) ? (liveMeasureItem(it) || it) : isVectorSumItem(it) ? (liveVectorSumItem(it) || it) : it);
    }
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
    drawGear();
    paintBoardBackground();                           // 판서·교구를 다 그린 뒤 맨 밑에 배경을 깐다
    // 글자 입력창은 캔버스 위에 겹쳐 둔 textarea 라 화면 이동·확대를 따라와야 한다(=paint 쪽).
    if (typeof positionTextEditor === "function") positionTextEditor();
  };

  const syncControls = () => {
    const s = wb.selected;
    if (groupActionBtn) groupActionBtn.disabled = !(s && s.type === "group");
    const canFlip = whiteboardCanFlipItem(s);
    if (flipXBtn){ flipXBtn.disabled = !canFlip; flipXBtn.setAttribute("aria-pressed", canFlip && s.flipX ? "true" : "false"); }
    if (flipYBtn){ flipYBtn.disabled = !canFlip; flipYBtn.setAttribute("aria-pressed", canFlip && s.flipY ? "true" : "false"); }
    syncSelectionControls();
    const viewLocked = backgroundViewLocked();
    if (zoomLabelBtn){
      zoomLabelBtn.textContent = Math.round(view.scale * 100) + "%";
      zoomLabelBtn.disabled = viewLocked;
      zoomLabelBtn.title = viewLocked ? "배경 그림을 쓰는 동안 화면 배율은 고정됩니다" : "화이트보드 배율 100%로 초기화";
    }
    if (zoomOutBtn) zoomOutBtn.disabled = viewLocked;
    if (zoomInBtn) zoomInBtn.disabled = viewLocked;
    if (contextZoomOutBtn) contextZoomOutBtn.disabled = viewLocked;
    if (contextZoomResetBtn) contextZoomResetBtn.disabled = viewLocked;
    if (contextZoomInBtn) contextZoomInBtn.disabled = viewLocked;
    // 집중 도구 겹침은 화면 좌표(W·H)에만 기대고 화면 이동·확대를 따르지 않는다 — 끌기마다 다시 그릴 필요가 없다.
    renderFocus();
  };

  const redraw = () => { paint(); syncControls(); };
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
  const confirmClearAll = () => {
    if (!wb.items.length) return;
    if (typeof confirmDialog === "function") confirmDialog("보드 내용을 모두 지울까요?", "지우기", "취소").then(ok => { if (ok) clearAll(); });
    else clearAll();
  };
  const deleteSelected = () => {
    if (!wb.selected) return false;
    const selected = wb.selected;
    // 잰 도형을 지우면 그 값을 가리키던 라벨도 함께 사라져야 한다.
    const label = measureLabelOf(selected), sums = vectorSumsFor(selected);
    wb.items = wb.items.filter(it => it !== selected && it !== label && !sums.includes(it)); wb.selected = null;
    redraw(); history.commit(); recordCommit();
    return true;
  };
  const moveSelectedLayer = (direction) => {
    const selected = wb.selected, index = selected ? wb.items.indexOf(selected) : -1;
    if (index < 0) return false;
    const last = wb.items.length - 1;
    if ((direction === "forward" || direction === "front") && index >= last) return false;
    if ((direction === "backward" || direction === "back") && index <= 0) return false;
    const next = wb.items.slice();
    if (direction === "forward") [next[index], next[index + 1]] = [next[index + 1], next[index]];
    else if (direction === "backward") [next[index], next[index - 1]] = [next[index - 1], next[index]];
    else if (direction === "front"){ next.splice(index, 1); next.push(selected); }
    else if (direction === "back"){ next.splice(index, 1); next.unshift(selected); }
    else return false;
    wb.items = next; redraw(); history.commit(); recordCommit();
    return true;
  };
  const flipSelected = (axis) => {
    const selected = wb.selected;
    if (!whiteboardCanFlipItem(selected)) return;
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
    for (let i = wb.items.length - 1; i >= 0; i--){
      const it = wb.items[i];
      // 합력은 원본 화살표에서 계산해 덮어 그리는 그림이라 고르지 않는다 — 그러지 않으면
      // 평행사변형 넓이만 한 상자가 그 안의 화살표를 전부 가려 잡을 수 없다(떼기는 화살표 쪽 메뉴에서).
      if (isVectorSumItem(it)) continue;
      if (hitTestBoardItem(it, p, measureBoardText, 7 / view.scale)) return it;
    }
    return null;
  };
  const setViewScale = (nextScale, clientX, clientY) => {
    if (backgroundViewLocked()){
      if (view.scale !== 1 || view.x !== 0 || view.y !== 0){ view.scale = 1; view.x = 0; view.y = 0; redraw(); }
      return;
    }
    const anchor = Number.isFinite(clientX) && Number.isFinite(clientY) ? screenPoint({ clientX, clientY }) : { x:W/2, y:H/2 };
    Object.assign(view, whiteboardZoomAt(view, nextScale, anchor, W, H)); redraw();
  };
  const resetView = () => { view.scale = 1; view.x = 0; view.y = 0; redraw(); };
  const beginViewPan = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (backgroundViewLocked()) return;
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    canvas.classList.remove("pan-ready"); canvas.classList.add("panning");
    const startX=e.clientX, startY=e.clientY, originX=view.x, originY=view.y;
    const pointerId=e.pointerId;
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      view.x=originX+ev.clientX-startX; view.y=originY+ev.clientY-startY; clampView(); paint();   // 화면만 움직인다 — 도구막대 값은 그대로
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
    if (backgroundViewLocked()) return;
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
      // 옮기기는 크기·종류가 그대로라 도구막대가 바뀔 일이 없다.
      // 크기조절은 다르다 — 수식·도형의 '크기 %' 입력이 끄는 동안 같이 움직여야 해서 전부 맞춘다.
      if (mode === "move") paint(); else redraw();
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
  // ----- 교구 조작(옮기기·돌리기·컴퍼스로 호 그리기)과 스냅 -----
  let syncGearButtons = () => {};
  // 길이·각도는 그리는 중에만 필요한 숫자라 캔버스에 박지 않고 커서 옆 작은 딱지로 보여 준다.
  const measureHud = document.createElement("div"); measureHud.className = "wb-measure"; measureHud.hidden = true;
  stage.appendChild(measureHud);
  const showMeasure = (text, screen) => {
    measureHud.hidden = false; measureHud.textContent = text;
    measureHud.style.left = Math.round(Math.min(Math.max(8, screen.x + 18), Math.max(8, W - 130))) + "px";
    measureHud.style.top = Math.round(Math.min(Math.max(8, screen.y + 18), Math.max(8, H - 34))) + "px";
  };
  const hideMeasure = () => { measureHud.hidden = true; };
  const formatCm = (pixels) => MNBoardTools.lengthInCm(pixels, MNBoardTools.PX_PER_CM).toFixed(1) + "cm";
  const setGear = (kind, force) => {
    const center = visibleBoardCenter();
    const on = force == null ? !gear[kind] : !!force;
    if (!on){ gear[kind] = null; }
    else if (kind === "ruler") gear.ruler = { x:center.x - 210, y:center.y - RULER_THICKNESS / 2, angle:0, length:420 };
    else if (kind === "protractor") gear.protractor = { x:center.x, y:center.y + PROTRACTOR_RADIUS / 2, angle:0, radius:PROTRACTOR_RADIUS };
    else if (kind === "compass") gear.compass = { cx:center.x - 60, cy:center.y + 40, radius:120, from:-Math.PI / 2, to:-Math.PI / 2, drawing:false };
    syncGearButtons(); redraw();
    return on;
  };
  const gearHandleAt = (p) => {
    const r = gearHandleRadius();
    const compass = gear.compass;
    if (compass){
      const radius = compassRadiusOf(compass);
      const pencil = { x:compass.cx + Math.cos(compass.to) * radius, y:compass.cy + Math.sin(compass.to) * radius };
      const grip = compassGripAt(compass);
      if (Math.hypot(p.x - pencil.x, p.y - pencil.y) <= r * 1.3) return { kind:"compass-draw", cursor:"crosshair" };
      if (Math.hypot(p.x - grip.x, p.y - grip.y) <= r) return { kind:"compass-radius", cursor:"ew-resize" };
      if (Math.hypot(p.x - compass.cx, p.y - compass.cy) <= r * 1.3) return { kind:"compass-move", cursor:"move" };
    }
    const protractor = gear.protractor;
    if (protractor){
      const angle = protractor.angle || 0, radius = protractorRadiusOf(protractor);
      const handle = { x:protractor.x + Math.cos(angle) * radius, y:protractor.y + Math.sin(angle) * radius };
      if (Math.hypot(p.x - handle.x, p.y - handle.y) <= r * 1.2) return { kind:"protractor-rotate", cursor:"grab" };
      // 크기 손잡이는 밑변 왼쪽 끝에 있어서 몸통(옮기기)보다 먼저 판정해야 잡힌다.
      const grip = { x:protractor.x - Math.cos(angle) * radius, y:protractor.y - Math.sin(angle) * radius };
      if (Math.hypot(p.x - grip.x, p.y - grip.y) <= r * 1.2) return { kind:"protractor-resize", cursor:"nwse-resize" };
      const dx = p.x - protractor.x, dy = p.y - protractor.y;
      const local = { x:dx * Math.cos(-angle) - dy * Math.sin(-angle), y:dx * Math.sin(-angle) + dy * Math.cos(-angle) };
      const distance = Math.hypot(local.x, local.y);
      // 안쪽은 비워 둬야 각도기 위로 선을 그을 수 있다. 테두리 띠와 밑변만 손잡이로 쓴다.
      const onRim = local.y <= 0 && Math.abs(distance - radius) <= 26;
      const onBase = Math.abs(local.y) <= 14 && Math.abs(local.x) <= radius;
      if (onRim || onBase) return { kind:"protractor-move", cursor:"move" };
    }
    const ruler = gear.ruler;
    if (ruler){
      const edge = MNBoardTools.rulerEdge(ruler);
      const nx = -Math.sin(edge.angle), ny = Math.cos(edge.angle);
      const handle = { x:edge.b.x + nx * RULER_THICKNESS / 2, y:edge.b.y + ny * RULER_THICKNESS / 2 };
      if (Math.hypot(p.x - handle.x, p.y - handle.y) <= r * 1.2) return { kind:"ruler-rotate", cursor:"grab" };
      // 길이 손잡이는 몸통(옮기기)보다 먼저 판정해야 잡힌다.
      const grip = { x:edge.a.x + nx * RULER_THICKNESS / 2, y:edge.a.y + ny * RULER_THICKNESS / 2 };
      if (Math.hypot(p.x - grip.x, p.y - grip.y) <= r * 1.2) return { kind:"ruler-resize", cursor:"ew-resize" };
      const dx = p.x - edge.a.x, dy = p.y - edge.a.y;
      const along = dx * Math.cos(edge.angle) + dy * Math.sin(edge.angle), across = dx * nx + dy * ny;
      if (along >= 0 && along <= edge.length && across >= 3 && across <= RULER_THICKNESS) return { kind:"ruler-move", cursor:"move" };
    }
    return null;
  };
  const beginGearDrag = (e, hit) => {
    e.preventDefault(); e.stopPropagation();
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    const start = pt(e);
    const ruler = gear.ruler ? Object.assign({}, gear.ruler) : null;
    const protractor = gear.protractor ? Object.assign({}, gear.protractor) : null;
    const compass = gear.compass ? Object.assign({}, gear.compass) : null;
    let lastAngle = compass ? compass.to : 0, sweep = 0;
    if (hit.kind === "compass-draw" && gear.compass){
      gear.compass.from = gear.compass.to; gear.compass.drawing = true;
    }
    const move = (ev) => {
      const p = pt(ev), screen = screenPoint(ev);
      if (hit.kind === "ruler-move"){
        gear.ruler.x = ruler.x + p.x - start.x; gear.ruler.y = ruler.y + p.y - start.y;
      } else if (hit.kind === "ruler-rotate"){
        let angle = Math.atan2(p.y - gear.ruler.y, p.x - gear.ruler.x);
        if (ev.shiftKey || gear.snap) angle = Math.round(angle * 180 / Math.PI / 15) * 15 * Math.PI / 180;
        gear.ruler.angle = angle;
        showMeasure(Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360) + "°", screen);
      } else if (hit.kind === "ruler-resize"){
        // 왼쪽 끝을 끌어 길이만 바꾼다. 각도와 오른쪽 끝(회전 손잡이 쪽)은 제자리에 둔다.
        const cm = MNBoardTools.PX_PER_CM;
        const angle = ruler.angle || 0, cos = Math.cos(angle), sin = Math.sin(angle);
        const was = Math.max(60, ruler.length || 420);
        const bx = ruler.x + cos * was, by = ruler.y + sin * was;
        const length = Math.min(RULER_MAX_CM * cm, Math.max(RULER_MIN_CM * cm, (bx - p.x) * cos + (by - p.y) * sin));
        gear.ruler.length = length; gear.ruler.x = bx - cos * length; gear.ruler.y = by - sin * length;
        showMeasure(formatCm(length), screen);
      } else if (hit.kind === "protractor-move"){
        gear.protractor.x = protractor.x + p.x - start.x; gear.protractor.y = protractor.y + p.y - start.y;
      } else if (hit.kind === "protractor-rotate"){
        let angle = Math.atan2(p.y - gear.protractor.y, p.x - gear.protractor.x);
        if (ev.shiftKey || gear.snap) angle = Math.round(angle * 180 / Math.PI / 15) * 15 * Math.PI / 180;
        gear.protractor.angle = angle;
        showMeasure(Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360) + "°", screen);
      } else if (hit.kind === "protractor-resize"){
        // 가운데(각을 재는 기준점)는 그대로 두고 반지름만 키운다.
        const radius = Math.min(PROTRACTOR_MAX_R, Math.max(PROTRACTOR_MIN_R, Math.hypot(p.x - gear.protractor.x, p.y - gear.protractor.y)));
        gear.protractor.radius = radius;
        showMeasure("밑변 " + formatCm(radius * 2), screen);
      } else if (hit.kind === "compass-move"){
        gear.compass.cx = compass.cx + p.x - start.x; gear.compass.cy = compass.cy + p.y - start.y;
      } else if (hit.kind === "compass-radius"){
        // 손잡이는 팔의 55% 지점이라, 잡은 자리까지의 거리를 팔 길이로 되돌려야 손을 따라온다.
        const reach = Math.hypot(p.x - gear.compass.cx, p.y - gear.compass.cy) / .55;
        gear.compass.radius = Math.min(COMPASS_MAX_R, Math.max(COMPASS_MIN_R, reach));
        gear.compass.to = Math.atan2(p.y - gear.compass.cy, p.x - gear.compass.cx);
        showMeasure(`반지름 ${formatCm(gear.compass.radius)} · 지름 ${formatCm(gear.compass.radius * 2)}`, screen);
      } else if (hit.kind === "compass-draw"){
        // 바늘을 축으로 돈 만큼만 호가 자란다(반지름은 고정). ±180°를 넘어가도 이어서 센다.
        const angle = Math.atan2(p.y - gear.compass.cy, p.x - gear.compass.cx);
        let delta = angle - lastAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        sweep += delta; lastAngle = angle;
        if (Math.abs(sweep) > Math.PI * 2) sweep = Math.sign(sweep) * Math.PI * 2;
        gear.compass.to = gear.compass.from + sweep;
        showMeasure(`반지름 ${formatCm(gear.compass.radius)} · ${Math.round(Math.abs(sweep) * 180 / Math.PI)}°`, screen);
      }
      paint();                                        // 교구는 판서가 아니라 손에 든 도구 — 도구막대와 무관하다
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      hideMeasure();
      if (hit.kind === "compass-draw" && gear.compass){
        gear.compass.drawing = false;
        const arc = MNBoardTools.compassArcItem(gear.compass, wb.color, wb.width);
        if (arc){ wb.items.push(arc); redraw(); history.commit(); recordCommit(); }
        else redraw();
        return;
      }
      redraw();
    };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  };
  // 자에 닿은 점은 모서리에 붙인다 — 실제로 자를 대고 그은 것처럼 곧게 나간다.
  const gearSnapPoint = (p) => {
    const snapped = gear.ruler ? MNBoardTools.snapToRuler(p, gear.ruler, GEAR_SNAP_BAND) : null;
    return snapped ? { x:snapped.x, y:snapped.y } : p;
  };
  const protractorCenterHold = (point) => {
    const protractor = gear.protractor;
    if (!protractor) return false;
    return Math.hypot(point.x - protractor.x, point.y - protractor.y) <= protractorHoldBand(protractorRadiusOf(protractor));
  };
  const gearSnapStart = (p) => {
    if (protractorCenterHold(p)) return { x:gear.protractor.x, y:gear.protractor.y };
    return gearSnapPoint(p);
  };
  // 끝점: 자가 있으면 모서리, 없으면 15° 스냅(Shift 또는 15° 단추) · 각도기 중심에서 시작했으면 1°
  const gearSnapEnd = (start, p, event) => {
    if (gear.ruler){
      const snapped = MNBoardTools.snapToRuler(p, gear.ruler, GEAR_SNAP_BAND);
      if (snapped) return { x:snapped.x, y:snapped.y };
    }
    const step = (event && event.shiftKey) || gear.snap ? 15 : protractorCenterHold(start) ? 1 : 0;
    if (!step) return p;
    const snapped = MNBoardTools.snapAngle(start, p, step);
    return { x:snapped.x, y:snapped.y };
  };
  const measureDrawing = (item, screen) => {
    if (!item || !screen) return;
    if (item.type === "line" || item.type === "arrow"){
      const start = { x:item.x1, y:item.y1 }, end = { x:item.x2, y:item.y2 };
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const base = gear.protractor && protractorCenterHold(start) ? (gear.protractor.angle || 0) : 0;
      const degrees = MNBoardTools.measureAngle(start, end, base);
      showMeasure(`${formatCm(length)} · ${degrees.toFixed(degrees % 1 ? 1 : 0)}°`, screen);
      return;
    }
    if (item.type === "rect"){ showMeasure(`${formatCm(Math.abs(item.x2 - item.x1))} × ${formatCm(Math.abs(item.y2 - item.y1))}`, screen); return; }
    if (item.type === "ellipse"){ showMeasure(`반지름 ${formatCm(Math.abs(item.x2 - item.x1) / 2)} × ${formatCm(Math.abs(item.y2 - item.y1) / 2)}`, screen); return; }
    hideMeasure();
  };
  // 손그림 정리: 방금 그은 펜 획이 반듯한 도형이면 바꿔 준다. 자신이 없으면 그대로 둔다.
  const tidyStroke = (stroke) => {
    if (!gear.tidy || !stroke || stroke.type !== "pen") return false;
    let shape = null;
    try { shape = MNBoardTools.recognizeStroke(stroke, {}); } catch(_){ return false; }
    if (!shape) return false;
    const index = wb.items.indexOf(stroke); if (index < 0) return false;
    wb.items[index] = shape; wb.selected = null;
    redraw(); history.commit(); recordCommit();
    if (typeof toast === "function") toast(`${MNBoardTools.recognizedShapeName(shape)} 모양으로 정리했어요. Ctrl+Z를 누르면 그은 그대로 돌아갑니다.`, 2400);
    return true;
  };

  // ----- 측정 붙이기/떼기 -----
  const toggleMeasureOnSelection = () => {
    const selected = wb.selected;
    if (!selected){ if (typeof toast === "function") toast("길이·각도·넓이를 잴 도형을 먼저 고르세요.", 2200); return false; }
    if (isMeasureItem(selected)){ deleteSelected(); if (typeof toast === "function") toast("측정값을 뗐어요.", 1600); return true; }
    const existing = measureLabelOf(selected);
    if (existing){
      wb.items = wb.items.filter((item) => item !== existing);
      redraw(); history.commit(); recordCommit();
      if (typeof toast === "function") toast("측정값을 뗐어요.", 1600);
      return true;
    }
    const info = MNBoardTools.measureLabel(selected, measureBoardText);
    if (!info){ if (typeof toast === "function") toast("이 항목은 잴 수 없어요. 직선·사각형·원·다각형을 골라 보세요.", 2600); return false; }
    const index = wb.items.indexOf(selected); if (index < 0) return false;
    const mid = selected.mid || nextMeasureId();
    // 대상에 이름표(mid)를 붙일 때도 제자리에서 고치지 않고 사본으로 바꿔 끼운다(이전 되돌리기 단계 보호).
    const target = selected.mid ? selected : Object.assign({}, selected, { mid });
    const label = {
      type:"text", role:MEASURE_ROLE, measureFor:mid, measureKind:info.kind,
      text:info.text, x:info.x, y:info.y, anchorX:info.x, anchorY:info.y,
      fontSize:15, textBaseFontSize:15, color:wb.color
    };
    wb.items[index] = target; wb.items.push(label); wb.selected = target;
    redraw(); history.commit(); recordCommit();
    if (typeof toast === "function") toast("측정값을 붙였어요. 도형을 끌면 숫자가 따라 바뀝니다.", 2600);
    return true;
  };

  // ----- 벡터 합성 붙이기/떼기 -----
  const VECTOR_SUM_SNAP = 28;                              // 두 화살표의 출발점이 이만큼 가까우면 "같은 점"으로 본다
  const toggleVectorSumOnSelection = () => {
    const selected = wb.selected;
    if (!selected){ if (typeof toast === "function") toast("합성할 화살표를 먼저 고르세요.", 2200); return false; }
    if (isVectorSumItem(selected)){ deleteSelected(); if (typeof toast === "function") toast("합력을 뗐어요.", 1600); return true; }
    if (selected.type !== "arrow"){ if (typeof toast === "function") toast("화살표 두 개를 같은 점에서 그린 뒤 그중 하나를 고르세요.", 2800); return false; }
    const existing = vectorSumsFor(selected);
    if (existing.length){
      wb.items = wb.items.filter((item) => !existing.includes(item));
      redraw(); history.commit(); recordCommit();
      if (typeof toast === "function") toast("합력을 뗐어요.", 1600);
      return true;
    }
    const partner = wb.items.find((item) => item !== selected && item && item.type === "arrow"
      && Math.hypot(item.x1 - selected.x1, item.y1 - selected.y1) <= VECTOR_SUM_SNAP);
    if (!partner){ if (typeof toast === "function") toast("같은 점에서 출발한 화살표가 하나 더 있어야 해요.", 2800); return false; }
    let shape;
    try { shape = MNBoardTools.vectorSumGroup(selected, partner, { color:boardInkColor() }); }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "합력을 구하지 못했어요.", 2400); return false; }
    // 이름표(mid)를 붙일 때도 제자리에서 고치지 않고 사본으로 바꿔 끼운다(이전 되돌리기 단계 보호).
    const named = (item) => {
      if (item.mid) return item;
      const copy = Object.assign({}, item, { mid:nextMeasureId() });
      wb.items[wb.items.indexOf(item)] = copy;
      return copy;
    };
    const first = named(selected), second = named(partner);
    wb.items.push(Object.assign({}, shape, { vectorSumOf:[first.mid, second.mid] }));
    wb.selected = first;
    redraw(); history.commit(); recordCommit();
    if (typeof toast === "function") toast("합력을 붙였어요. 화살표를 끌면 합력이 따라 바뀝니다.", 2800);
    return true;
  };

  // ----- 변환 기하(평행이동·회전·선대칭·점대칭·닮음) -----
  const transformState = { kind:"reflect", dx:2, dy:0, degrees:90, factor:2, axis:"vertical", keepOriginal:true };
  let transformPickPivot = false, syncTransformPanel = () => {};
  const transformTargetCenter = () => {
    const selected = wb.selected, bounds = selected && boundsOf(selected);
    if (!bounds) return visibleBoardCenter();
    return { x:bounds.x + bounds.w / 2, y:bounds.y + bounds.h / 2 };
  };
  const currentPivot = () => transformPivot || transformTargetCenter();
  drawTransformPivot = () => {
    const pivot = currentPivot(), arm = gearUi(11);
    ctx.save(); ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.strokeStyle = "#e11d48"; ctx.lineWidth = gearUi(2);
    ctx.beginPath();
    ctx.moveTo(pivot.x - arm, pivot.y); ctx.lineTo(pivot.x + arm, pivot.y);
    ctx.moveTo(pivot.x, pivot.y - arm); ctx.lineTo(pivot.x, pivot.y + arm);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(pivot.x, pivot.y, gearUi(4), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };
  const transformSpecNow = () => {
    const pivot = currentPivot();
    if (transformState.kind === "translate"){
      const cm = MNBoardTools.PX_PER_CM;
      return { kind:"translate", dx:transformState.dx * cm, dy:transformState.dy * cm };
    }
    if (transformState.kind === "rotate") return { kind:"rotate", cx:pivot.x, cy:pivot.y, degrees:transformState.degrees };
    if (transformState.kind === "point") return { kind:"point", cx:pivot.x, cy:pivot.y };
    if (transformState.kind === "scale") return { kind:"scale", cx:pivot.x, cy:pivot.y, factor:transformState.factor };
    if (transformState.axis === "ruler"){
      if (!gear.ruler) throw new Error("자를 먼저 꺼내 주세요. 자의 눈금 모서리가 대칭축이 됩니다.");
      const edge = MNBoardTools.rulerEdge(gear.ruler);
      return { kind:"reflect", ax:edge.a.x, ay:edge.a.y, bx:edge.b.x, by:edge.b.y };
    }
    return transformState.axis === "horizontal"
      ? { kind:"reflect", ax:pivot.x - 100, ay:pivot.y, bx:pivot.x + 100, by:pivot.y }
      : { kind:"reflect", ax:pivot.x, ay:pivot.y - 100, bx:pivot.x, by:pivot.y + 100 };
  };
  const applyTransform = () => {
    const selected = wb.selected;
    if (!selected){ if (typeof toast === "function") toast("변환할 도형을 먼저 고르세요.", 2200); return false; }
    if (isMeasureItem(selected)){ if (typeof toast === "function") toast("측정값 라벨은 변환할 수 없어요.", 2200); return false; }
    let spec, moved;
    try {
      spec = transformSpecNow();
      if (!MNBoardTools.canTransformItem(selected, spec)){
        if (typeof toast === "function") toast("이미지는 평행이동과 닮음만 적용할 수 있어요.", 2400);
        return false;
      }
      moved = MNBoardTools.transformedItem(selected, MNBoardTools.makeTransform(spec), measureBoardText);
    } catch(error){
      if (typeof toast === "function") toast(error && error.message ? error.message : "변환하지 못했어요.", 2600);
      return false;
    }
    if (!moved){ if (typeof toast === "function") toast("이 항목은 변환할 수 없어요.", 2200); return false; }
    const index = wb.items.indexOf(selected);
    if (transformState.keepOriginal || index < 0){
      delete moved.mid;                                  // 사본이 원본의 측정 라벨을 가로채면 안 된다
      wb.items.push(moved);
    } else {
      // 원본을 대신하는 경우엔 이름표를 물려받아, 붙여 둔 측정값이 바뀐 도형을 계속 따라간다
      // (닮음 2배로 넓이가 4배가 되는 것을 그 자리에서 보여 줄 수 있다).
      if (selected.mid) moved.mid = selected.mid; else delete moved.mid;
      wb.items[index] = moved;
    }
    wb.selected = moved; setTool("select"); redraw(); history.commit(); recordCommit();
    if (typeof toast === "function"){
      toast(`${MNBoardTools.transformName(spec)}${transformState.keepOriginal ? "한 사본을 만들었어요" : "했어요"}. Ctrl+Z로 되돌릴 수 있어요.`, 2400);
    }
    return true;
  };

  /* ----- 보드 위 매개변수 슬라이더 -----
     그래프 안에 함께 그려 둔 손잡이를 끌면 그 자리에서 곡선을 다시 계산한다. 끄는 동안은
     되돌리기 칸을 만들지 않고 손을 뗄 때 한 번만 남긴다(a를 10번 움직여도 Ctrl+Z 한 번). */
  const plotSliderHitAt = (p) => {
    for (let index = wb.items.length - 1; index >= 0; index--){
      const item = wb.items[index];
      if (!item || item.type !== "group" || item.role !== "education-plot" || !item.plotSpec) continue;
      const hit = MNBoardTools.plotSliderAt(item, p);
      if (hit) return { item, sliderIndex:hit.index };
    }
    return null;
  };
  const beginSliderDrag = (e, found) => {
    e.preventDefault(); e.stopPropagation();
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    const state = { item:found.item, sliderIndex:found.sliderIndex, changed:false };
    const sliderReadout = () => {
      const slider = (state.item.sliders || [])[state.sliderIndex];
      return slider ? `${slider.name} = ${slider.value}` : "";
    };
    const apply = (point) => {
      const index = wb.items.indexOf(state.item); if (index < 0) return;
      const slider = (state.item.sliders || [])[state.sliderIndex]; if (!slider) return;
      const local = MNBoardTools.groupLocalPoint(state.item, point);
      const value = MNBoardTools.sliderValueAt(slider, local.x);
      if (value === slider.value) return;
      const before = state.item.plotSpec;
      const spec = Object.assign({}, before, { params:Object.assign({}, before.params, { [slider.name]:value }) });
      let group;
      try { group = MNBoardTools.plotGroup(spec); }
      catch(_){ return; }                                   // 그 값에서 값이 없는 식이면 방금 모양을 그대로 둔다
      const next = Object.assign({}, group, {
        x:state.item.x, y:state.item.y, w:state.item.w, h:state.item.h, flipX:state.item.flipX, flipY:state.item.flipY
      });
      if (state.item.mid) next.mid = state.item.mid;
      if (wb.selected === state.item) wb.selected = next;
      wb.items[index] = next; state.item = next; state.changed = true;
      redraw();
    };
    const move = (ev) => { apply(pt(ev)); showMeasure(sliderReadout(), screenPoint(ev)); };
    const up = () => {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      hideMeasure();
      if (state.changed){ history.commit(); recordCommit(); }
    };
    apply(pt(e)); showMeasure(sliderReadout(), screenPoint(e));
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  };

  const beginArrowTipDrag = (e, arrow) => {
    e.preventDefault(); e.stopPropagation();
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    const state = { item:arrow, changed:false };
    const apply = (point, event) => {
      const index = wb.items.indexOf(state.item); if (index < 0) return;
      const end = gearSnapEnd({ x:state.item.x1, y:state.item.y1 }, point, event);
      if (end.x === state.item.x2 && end.y === state.item.y2) return;
      const next = Object.assign({}, state.item, { x2:end.x, y2:end.y });
      if (wb.selected === state.item) wb.selected = next;
      wb.items[index] = next; state.item = next; state.changed = true;
      redraw();
    };
    const readout = (event) => {
      const item = state.item;
      const length = Math.hypot(item.x2 - item.x1, item.y2 - item.y1);
      const degrees = MNBoardTools.measureAngle({ x:item.x1, y:item.y1 }, { x:item.x2, y:item.y2 }, 0);
      showMeasure(`${formatCm(length)} · ${degrees.toFixed(degrees % 1 ? 1 : 0)}°`, screenPoint(event));
    };
    const move = (ev) => { apply(pt(ev), ev); readout(ev); };
    const up = () => {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      hideMeasure();
      if (state.changed){ history.commit(); recordCommit(); }
    };
    apply(pt(e), e); readout(e);
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
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
    // 기준점 찍기 중에는 클릭 한 번이 곧 기준점이다(그 클릭으로 판서되면 안 된다).
    if (transformPickPivot){
      e.preventDefault(); e.stopPropagation();
      transformPivot = { x:lastBoardPointer.x, y:lastBoardPointer.y };
      transformPickPivot = false; syncTransformPanel(); redraw();
      if (typeof toast === "function") toast("기준점을 정했어요.", 1600);
      return;
    }
    // 교구의 손잡이는 어떤 도구를 쓰고 있든 먼저 잡힌다(자를 옮기려다 선이 그어지면 곤란하다).
    const gearHit = gearHandleAt(lastBoardPointer);
    if (gearHit){ beginGearDrag(e, gearHit); return; }
    // 그래프의 슬라이더 손잡이도 교구처럼 먼저 잡는다(그래프 위로 선이 그어지면 곤란하다).
    const sliderHit = plotSliderHitAt(lastBoardPointer);
    if (sliderHit){ beginSliderDrag(e, sliderHit); return; }
    const tipHit = arrowTipAt(lastBoardPointer);
    if (tipHit){ beginArrowTipDrag(e, tipHit); return; }
    if (wb.tool === "select"){
      // 조절점을 숨긴 스포트라이트는 밝은 영역 자체를 이동 손잡이로 쓴다.
      // 보드 이동이 필요하면 기존처럼 Space+드래그 또는 가운데 버튼을 사용한다.
      if (focus.active && focus.mode === "spotlight" && !focus.controlsVisible){ beginSpotlightDrag(e,.5,.5,true); return; }
      // 선택 도구의 빈 공간은 손바닥 이동 영역으로 쓴다. 항목 위에서는 기존처럼 항목을 이동한다.
      if (!startSelect(e) && !backgroundViewLocked()) beginViewPan(e);
      return;
    }
    if (wb.tool === "text"){ e.preventDefault(); startText(pt(e)); return; }
    canvas.setPointerCapture(e.pointerId); drawing = true;
    const p = gearSnapStart(pt(e));
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
    const raw = pt(e);
    if (cur.points){
      // 지우개는 자에 붙이지 않는다 — 자 옆을 문지르는데 획이 모서리로 끌려가면 못 지운다.
      const p = cur.type === "eraser" ? raw : gearSnapPoint(raw);
      cur.points.push(p);
      applyStroke(cur); ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      // 지우개는 덧칠이 아니라 뚫기다 — 뚫린 자리에 배경을 바로 다시 깔지 않으면 문지르는 동안
      // 모눈·오선이 사라졌다가 손을 뗄 때(전체 redraw) 돌아오는 깜빡임이 보인다.
      if (cur.type === "eraser") paintBoardBackground();
      lastPt = p;
    } else {
      const p = (cur.type === "line" || cur.type === "arrow") ? gearSnapEnd({ x:cur.x1, y:cur.y1 }, raw, e) : gearSnapPoint(raw);
      cur.x2 = p.x; cur.y2 = p.y; paint(); drawItem(cur);   // 그리는 중 — 선택도 도구도 그대로다
      measureDrawing(cur, screenPoint(e));
    }
  });
  const finishStroke = () => {
    if (!drawing){ return; }
    drawing = false;
    hideMeasure();
    if (!cur){ return; }
    if (!cur.points && Math.abs(cur.x2 - cur.x1) < 2 && Math.abs(cur.y2 - cur.y1) < 2){ cur = null; redraw(); return; }  // 점 찍힌 도형 무시
    const finished = cur;
    wb.items.push(finished); cur = null; redraw(); history.commit(); recordCommit();
    tidyStroke(finished);
  };
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  /* 가린 곳은 입력 불가, 드러난 곳의 선택 도구는 항목 위=이동, 이미지 핸들=크기조절.
     이 판정은 항목 목록을 최대 네 번 훑고(교구 손잡이·슬라이더·화살촉·항목), 좌표를 구하는 pt() 는
     그때마다 getBoundingClientRect 로 레이아웃을 읽는다. 포인터 이벤트는 초당 100번 넘게 오지만
     커서는 한 프레임에 한 번만 정하면 충분하므로, 마지막 좌표만 남겨 두고 프레임에서 한 번 판정한다.
     좌표도 한 번만 구한다 — 예전에는 한 번 움직일 때마다 레이아웃을 최대 다섯 번 읽었다. */
  let hoverAt = null, hoverFrame = 0;
  const updateHoverCursor = () => {
    hoverFrame = 0;
    const e = hoverAt; hoverAt = null;
    if (!e || drawing) return;                        // 프레임을 기다리는 사이에 그리기가 시작됐으면 버린다
    if (focus.active && focus.controlsVisible){ canvas.style.cursor = "not-allowed"; return; }
    if (spacePanning){ canvas.style.cursor = ""; return; }
    if (!focusAllowsScreenPoint(screenPoint(e))){ canvas.style.cursor = "not-allowed"; return; }
    canvas.style.cursor = "";
    const p = pt(e);
    const gearHover = gearHandleAt(p);
    if (gearHover){ canvas.style.cursor = gearHover.cursor; return; }
    if (plotSliderHitAt(p)){ canvas.style.cursor = "ew-resize"; return; }
    if (arrowTipAt(p)){ canvas.style.cursor = "grab"; return; }
    if (wb.tool !== "select") return;
    if (focus.active && focus.mode === "spotlight" && !focus.controlsVisible){ canvas.style.cursor = "move"; return; }
    const h = wb.selected && handleAt(wb.selected, p);
    canvas.style.cursor = h ? h.cur : (itemAt(p) ? "move" : "grab");
  };
  canvas.addEventListener("pointermove", (e) => {
    if (drawing) return;
    // 이벤트 객체는 들고 있지 않는다 — 좌표만 남기면 되고, 프레임까지 살려 둘 이유가 없다.
    hoverAt = { clientX:e.clientX, clientY:e.clientY };
    if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHoverCursor);
  });
  canvas.addEventListener("dblclick", (e) => {
    if (focus.active && focus.controlsVisible){ e.preventDefault(); e.stopPropagation(); flashFocusBoundary(); return; }
    if (wb.tool !== "select") return;
    const item = itemAt(pt(e));
    if (!item) return;
    if (item.type === "image" && item.role === "education-formula" && typeof openFormulaEditor === "function"){
      e.preventDefault(); e.stopPropagation(); openFormulaEditor(item); return;
    }
    if (item.type === "group" && item.role === "education-plot" && item.plotSpec && typeof openPlotEditor === "function"){
      e.preventDefault(); e.stopPropagation(); openPlotEditor(item); return;
    }
    if (item.type === "group" && item.role === "education-chart" && item.chartSpec && typeof openChartEditor === "function"){
      e.preventDefault(); e.stopPropagation(); openChartEditor(item); return;
    }
    if (item.type === "group" && item.role === "education-table" && item.tableSpec && typeof openTableEditor === "function"){
      e.preventDefault(); e.stopPropagation(); openTableEditor(item); return;
    }
    if (item.type === "group" && item.role === "education-tool" && item.toolSpec && typeof openToolItemEditor === "function"){
      e.preventDefault(); e.stopPropagation(); openToolItemEditor(item); return;
    }
    if (item.type !== "text") return;
    e.preventDefault(); e.stopPropagation(); startText({ x:item.x, y:item.y }, item);
  });

  // ----- 텍스트 도구: 클릭 위치에 인라인 입력 -----
  function startText(p, existing){
    const ta = document.createElement("textarea"); ta.className = "wb-textinput"; ta.rows = 1;
    const fs = existing ? Math.max(14, Number(existing.fontSize) || 16) : normalizeWhiteboardTextSize(wb.textSize);
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
  /* 다른 문서(지도 등)가 만든 그림을 이 보드에 넣는다.
     placeImage 를 그대로 타므로 크기 맞춤·선택 상태·되돌리기·리플레이 녹화가 손으로 넣은 그림과
     똑같이 동작한다. data URL 만 받는다 — 바깥 주소를 그대로 넣으면 자동복원 스냅샷이 그 주소에
     매여, 인터넷이 없는 다음 수업에서 빈 칸으로 되살아난다. */
  doc.insertBoardImage = async (src) => {
    if (typeof src !== "string" || !/^data:image\//.test(src)) return false;
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => { el.__boardSrc = src; resolve(el); };
        el.onerror = () => reject(new Error("image-load-failed"));
        el.src = src;
      });
      placeImage(img);
      return true;
    } catch(_){ return false; }
  };
  /* ----- 배경 그림 -----
     넣을 때 반드시 다시 인코딩한다. 요즘 사진 한 장은 5~10MB 라, 원본을 그대로 스냅샷에 실으면
     localStorage 자동복원본(≈5MB)이 그 한 장으로 꽉 차 "탭을 닫아도 판서가 그대로"가 깨진다.
     칠판에 띄우는 용도라 긴 변 1600px 이면 충분하다. */
  const boardImageMaxEdge = () => (typeof BOARD_IMAGE_MAX_EDGE !== "undefined" ? BOARD_IMAGE_MAX_EDGE : 1600);
  const boardImageMaxChars = () => (typeof BOARD_IMAGE_MAX_CHARS !== "undefined" ? BOARD_IMAGE_MAX_CHARS : 2000000);
  // JPEG 는 투명한 자리를 검게 칠한다 — 배경이 뚫린 그림(PNG·GIF·SVG)은 PNG 로 남겨야
  // 보드 배경색이 비쳐 보인다. 사진(JPEG)은 스캔할 필요 없이 바로 JPEG.
  const imageHasTransparency = (canvasEl, sourceType) => {
    if (/^image\/(jpeg|jpg|bmp)$/i.test(String(sourceType || ""))) return false;
    try {
      const data = canvasEl.getContext("2d").getImageData(0, 0, canvasEl.width, canvasEl.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
      return false;
    } catch(_){ return true; }        // 읽지 못하면 안전한 쪽(PNG)으로
  };
  const encodeBoardBackgroundImage = (img, sourceType) => {
    const nw = Math.max(1, img.naturalWidth || 1), nh = Math.max(1, img.naturalHeight || 1);
    let scale = Math.min(1, boardImageMaxEdge() / Math.max(nw, nh));
    const canvasEl = document.createElement("canvas");
    let src = "", transparent = null;
    // 사진이 크거나 결이 복잡해 한 번에 상한 아래로 안 내려오면 두 단계까지 더 줄인다.
    for (let attempt = 0; attempt < 3; attempt++){
      canvasEl.width = Math.max(1, Math.round(nw * scale));
      canvasEl.height = Math.max(1, Math.round(nh * scale));
      const c = canvasEl.getContext("2d");
      c.clearRect(0, 0, canvasEl.width, canvasEl.height);
      c.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
      if (transparent == null) transparent = imageHasTransparency(canvasEl, sourceType);
      src = transparent ? canvasEl.toDataURL("image/png") : canvasEl.toDataURL("image/jpeg", attempt ? .72 : .82);
      if (src.length <= boardImageMaxChars()) break;
      scale *= .72;
    }
    return { src, width:canvasEl.width, height:canvasEl.height };
  };
  const setBackgroundImage = (next) => {
    wb.bgImage = boardSnapshotImage(next);
    if (wb.bgImage){
      view.scale = 1; view.x = 0; view.y = 0;
      spacePanning = false; canvas.classList.remove("pan-ready", "panning");
    }
    restoreBoardBackgroundImage();
    syncBackgroundImageControls();
    redraw();
    scheduleBoardRecovery();
    if (doc.recorder && doc.recorder.active && typeof doc.recorder.setBackground === "function"){
      doc.recorder.setBackground(wb.bg, { pattern:wb.bgPattern, image:wb.bgImage });
    }
  };
  const applyBackgroundImageBlob = async (blob) => {
    if (!blob || !/^image\//.test(blob.type || "")){
      if (typeof toast === "function") toast("그림 파일만 배경으로 쓸 수 있어요.", 2200, { type:"error" });
      return false;
    }
    try {
      const img = await loadImageBlob(blob);
      const encoded = encodeBoardBackgroundImage(img, blob.type);
      if (!encoded.src) throw new Error("board-background-encode-failed");
      const fit = (wb.bgImage && wb.bgImage.fit) || "cover";
      setBackgroundImage({ src:encoded.src, fit, opacity:(wb.bgImage && wb.bgImage.opacity) || 1,
        x:0, y:0, w:encoded.width, h:encoded.height });
      if (typeof toast === "function") toast("배경 그림을 넣었어요. 판서가 잘 보이게 '흐리기'로 연하게 만들 수 있어요.", 3200);
      return true;
    } catch(error){
      console.error(error);
      if (typeof toast === "function") toast("배경 그림을 넣지 못했어요.", 2200, { type:"error" });
      return false;
    }
  };
  /* 보드에 올려 둔 그림을 배경으로 옮긴다. 복사가 아니라 옮기기다 — 똑같은 그림이 배경과 항목으로
     겹쳐 있으면 어느 쪽을 잡고 있는지 알 수 없다. 항목이 사라지는 건 삭제와 같은 편집이라
     되돌리기 단계로 남기고(배경 자체는 예전부터 되돌리기 대상이 아니다) 놓일 자리는
     그림이 지금 있던 자리를 그대로 쓴다 — 배경으로 내려가며 위치가 튀지 않는다. */
  const sendSelectedToBackground = async () => {
    const item = wb.selected;
    if (!item || item.type !== "image" || !item.src) return;
    try {
      const img = item.img && item.img.complete ? item.img : await loadBoardImageSource(item.src);
      // 붙여넣은 그림은 원본 그대로라 클 수 있다 — 배경으로 갈 때도 같은 상한을 태운다.
      const encoded = encodeBoardBackgroundImage(img, "");
      if (!encoded.src) throw new Error("board-background-encode-failed");
      wb.items = wb.items.filter((other) => other !== item);
      wb.selected = null;
      history.commit();
      recordCommit();
      setBackgroundImage({
        src:encoded.src, fit:"cover", opacity:(wb.bgImage && wb.bgImage.opacity) || 1,
        x:0, y:0, w:encoded.width, h:encoded.height
      });
      if (typeof toast === "function") toast("그림을 배경으로 내렸어요. 이제 판서에 걸리지 않아요.", 2800);
    } catch(error){
      console.error(error);
      if (typeof toast === "function") toast("배경으로 내리지 못했어요.", 2200, { type:"error" });
    }
  };
  const pickBackgroundImage = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) applyBackgroundImageBlob(file);
    });
    input.click();
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
    if (typeof ClassDockCore !== "undefined" && ClassDockCore && typeof ClassDockCore.latexToMathML === "function")
      return ClassDockCore.latexToMathML(String(source || ""), false, true);
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
      const preserveGeometry = existing.formulaSource === source && existing.formulaColor !== formulaColor;
      const {x,y,w,h} = whiteboardFormulaReplacementRect(existing, img.naturalWidth || baseW, img.naturalHeight || baseH, W, H, preserveGeometry);
      const item = Object.assign({}, existing, { type:"image",img,src,x,y,w,h,role:"education-formula",formulaSource:source,formulaColor,formulaBaseW:baseW,formulaBaseH:baseH });
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
  // 그래프·차트도 교육 도형과 같은 그룹 항목이라 이동·크기조절·되돌리기·내보내기를 그대로 탄다.
  const placeBoardGroup = (group, cx, cy) => {
    if (!group) return false;
    const center = visibleBoardCenter();
    const centerX = cx == null ? center.x : cx, centerY = cy == null ? center.y : cy;
    const fit = W && H ? Math.min(1, W * .9 / group.w, H * .9 / group.h) : 1;
    group.w = Math.round(group.w * fit); group.h = Math.round(group.h * fit);
    group.x = Math.max(0, Math.min(Math.round(centerX - group.w / 2), Math.max(0, W - group.w)));
    group.y = Math.max(0, Math.min(Math.round(centerY - group.h / 2), Math.max(0, H - group.h)));
    wb.items.push(group); wb.selected = group; setTool("select"); redraw(); history.commit(); recordCommit();
    return true;
  };
  // 글자 한 줄을 화면 가운데(보이는 영역 기준)에 넣는다. 너무 길면 보드 폭에 맞춰 줄인다.
  const placeBoardText = (content, preferredSize) => {
    const text = String(content || "").trim();
    if (!text) return false;
    const center = visibleBoardCenter();
    let fontSize = Math.max(12, Number(preferredSize) || 32);
    let textWidth = measureBoardText(text, fontSize);
    if (W > 32 && textWidth > W - 24){
      fontSize = Math.max(13, Math.floor(fontSize * (W - 24) / textWidth));
      textWidth = measureBoardText(text, fontSize);
    }
    const item = {
      type:"text", color:wb.color,
      x:Math.max(8, Math.min(center.x - textWidth / 2, Math.max(8, W - textWidth - 8))),
      y:Math.max(8, Math.min(center.y - fontSize * .7, Math.max(8, H - fontSize * 1.4))),
      text, fontSize, textBaseFontSize:fontSize
    };
    wb.items.push(item); wb.selected = item; setTool("select"); redraw(); history.commit(); recordCommit();
    return true;
  };
  /* 다른 문서(지도 등)가 센 자료를 이 보드의 차트로 넣는다. 그림이 아니라 도구상자가 만드는
     것과 똑같은 그룹이라, 넣은 뒤에도 차트로 다시 고치고 크기를 바꾸고 되돌릴 수 있다. */
  doc.insertBoardChart = (spec) => {
    if (!spec || typeof MNBoardTools === "undefined") return false;
    const boardWidth = Math.max(320, Math.min(W ? W * .8 : 640, 680));
    let group;
    try { group = MNBoardTools.chartGroup(Object.assign({}, spec, { width:Math.round(boardWidth), height:Math.round(boardWidth * .72) })); }
    catch(error){ console.warn("insertBoardChart failed:", error); return false; }
    return placeBoardGroup(group);
  };
  /* 바깥에서 만든 표(환율 등)를 이 보드에 넣는다. 도구상자의 값의 표·통계표와 같은 그룹이라
     넣은 뒤에도 크기 조절·되돌리기·분리가 그대로 먹는다. 다만 tableSpec 은 달지 않는다 —
     받아 온 값이라 표 편집기로 고칠 것이 아니고, 고치면 출처와 어긋난다. */
  doc.insertBoardTable = (rows, opts) => {
    if (!Array.isArray(rows) || !rows.length || typeof MNBoardTools === "undefined") return false;
    let group;
    try { group = MNBoardTools.tableGroup(rows, Object.assign({ align:"right", color:boardInkColor() }, opts || {})); }
    catch(error){ console.warn("insertBoardTable failed:", error); return false; }
    return placeBoardGroup(group);
  };
  // 고쳐 넣을 때는 보드에 놓인 자리와 크기를 그대로 두고 내용만 갈아 끼운다.
  const replaceBoardGroup = (existing, group) => {
    const index = wb.items.indexOf(existing);
    if (index < 0 || !group) return false;
    /* 자리와 확대 비율은 그대로 두되 상자 크기는 새 그림에 맞춘다 — 내용에 따라 높이가
       달라지는 종류(띠그래프)를 예전 상자에 밀어 넣으면 눌리거나 늘어난다.
       크기가 그대로인 종류에서는 예전과 똑같은 값이 나온다. */
    const scaleX = (Number(existing.w) || 1) / (Number(existing.sourceW) || Number(existing.w) || 1);
    const scaleY = (Number(existing.h) || 1) / (Number(existing.sourceH) || Number(existing.h) || 1);
    const next = Object.assign({}, group, {
      x:existing.x, y:existing.y,
      w:Math.round((Number(group.w) || 1) * scaleX), h:Math.round((Number(group.h) || 1) * scaleY),
      flipX:existing.flipX, flipY:existing.flipY
    });
    wb.items[index] = next; wb.selected = next; redraw(); history.commit(); recordCommit();
    return true;
  };
  const pasteBoardClipboardItem = (raw, destinationOverride=null) => {
    let item = whiteboardDetachedClipboardItem(raw);
    if (!item || !isSelectableBoardItem(item)) return false;
    const bounds = boundsOf(item);
    if (!bounds) return false;
    const destination = destinationOverride || (!wb.selected && lastBoardPointer);
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
  const writeSelectedClipboardEvent = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    const item = whiteboardClipboardItem(wb.selected);
    if (!item || !e.clipboardData) return;
    setWhiteboardInternalClipboard(item);
    e.preventDefault();
    e.clipboardData.setData(WB_ITEM_TRANSFER_TYPE, JSON.stringify(item));
    const fallback = item.role === "education-formula" ? item.formulaSource
      : item.type === "text" ? item.text : "화이트보드 항목";
    e.clipboardData.setData("text/plain", String(fallback || "화이트보드 항목"));
    return true;
  };
  const onCopy = (e) => { writeSelectedClipboardEvent(e); };
  const onCut = (e) => { if (writeSelectedClipboardEvent(e)) deleteSelected(); };
  // 붙여넣기(Ctrl+V): 화이트보드 항목을 우선 복원하고, 없으면 외부 클립보드 이미지를 넣는다.
  const onPaste = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    const boardItem = e.clipboardData && e.clipboardData.getData(WB_ITEM_TRANSFER_TYPE);
    if (boardItem && pasteBoardClipboardItem(boardItem)){ setWhiteboardInternalClipboard(boardItem); e.preventDefault(); return; }
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items){
      if (it.kind === "file" && /^image\//.test(it.type)){
        const blob = it.getAsFile();
        if (blob){ e.preventDefault(); insertImageBlob(blob); return; }
      }
    }
  };
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCut);
  document.addEventListener("paste", onPaste);
  const copySelectedFromMenu = () => {
    const item = whiteboardClipboardItem(wb.selected);
    if (!item || !setWhiteboardInternalClipboard(item)) return false;
    try { document.execCommand("copy"); } catch(_){}
    if (typeof toast === "function") toast("선택한 항목을 복사했어요.", 1500);
    return true;
  };
  const cutSelectedFromMenu = () => {
    const item = whiteboardClipboardItem(wb.selected);
    if (!item || !setWhiteboardInternalClipboard(item)) return false;
    try { document.execCommand("copy"); } catch(_){}
    if (!deleteSelected()) return false;
    if (typeof toast === "function") toast("선택한 항목을 잘라냈어요.", 1500);
    return true;
  };
  const pasteInternalClipboardAt = (point) => {
    const item = getWhiteboardInternalClipboard();
    if (!item || !pasteBoardClipboardItem(item, point || lastBoardPointer)) return false;
    if (typeof toast === "function") toast("복사한 항목을 붙여넣었어요.", 1500);
    return true;
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
    // 그래프·차트도 만든 재료(식·자료)를 그대로 들고 있어 다시 고칠 수 있다.
    if (selected.type === "group" && selected.role === "education-plot" && selected.plotSpec && typeof openPlotEditor === "function"){
      openPlotEditor(selected); return true;
    }
    if (selected.type === "group" && selected.role === "education-chart" && selected.chartSpec && typeof openChartEditor === "function"){
      openChartEditor(selected); return true;
    }
    if (selected.type === "group" && selected.role === "education-table" && selected.tableSpec && typeof openTableEditor === "function"){
      openTableEditor(selected); return true;
    }
    if (selected.type === "group" && selected.role === "education-tool" && selected.toolSpec && typeof openToolItemEditor === "function"){
      openToolItemEditor(selected); return true;
    }
    return false;
  };
  // 우클릭 메뉴·더블클릭이 "편집"을 보여 줄 수 있는 항목인지.
  const canEditSelected = (item) => !!(item && (item.type === "text"
    || (item.type === "image" && item.role === "education-formula")
    || (item.type === "group" && item.role === "education-plot" && item.plotSpec)
    || (item.type === "group" && item.role === "education-chart" && item.chartSpec)
    || (item.type === "group" && item.role === "education-table" && item.tableSpec)
    || (item.type === "group" && item.role === "education-tool" && item.toolSpec)));
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
    wb.selected=null; view.scale=1; view.x=0; view.y=0; gearHidden=true; redraw();
    try { return fn(); }
    finally { wb.selected=selected; view.scale=saved.scale; view.x=saved.x; view.y=saved.y; gearHidden=false; clampView(); redraw(); }
  };

  // ----- 내보내기 -----
  // notify: 버튼을 누른 게 아니라 Ctrl+S 로 부른 경우 — 화면에 아무 변화가 없어 알려줘야 한다.
  const exportPng = (options={}) => {
    withBoardExport(() => canvas.toBlob((b) => {
      if (!b){ if (typeof toast === "function") toast("이미지를 저장하지 못했어요.", 2000, { type: "error" }); return; }
      MNDownload.saveBlob(b, (doc.name || "화이트보드") + ".png");
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
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    ruler: '<rect x="2.5" y="8.5" width="19" height="7" rx="1"/><path d="M6 8.5v3.5M9.5 8.5v2.5M13 8.5v3.5M16.5 8.5v2.5"/>',
    protractor: '<path d="M3.5 16.5a8.5 8.5 0 0 1 17 0z"/><path d="M3.5 16.5h17M12 16.5v-3"/><path d="M7 10.6 8.3 12.4M17 10.6 15.7 12.4"/>',
    compass: '<circle cx="12" cy="4.2" r="1.3"/><path d="M11.2 5.4 7.5 20M12.8 5.4 16.5 20"/><path d="M6.4 15.6a7.5 7.5 0 0 0 11.2 0"/>',
    tidy: '<path d="m4 20 8.5-8.5"/><path d="M15 3.5v4M13 5.5h4M18.5 10v3M17 11.5h3"/><path d="m11 9.5 3.5 3.5"/>',
    plot: '<path d="M4 4v16h16"/><path d="M6.5 16.5c2.5 0 3.2-8 6-8s3 5 5.5 5"/>',
    chart: '<path d="M4 4v16h16"/><path d="M7.5 18v-5M12 18V8.5M16.5 18v-3"/>',
    measure: '<path d="M4 15.5h16"/><path d="M4 12.5v3M9 11v4.5M14 11v4.5M20 12.5v3"/><path d="M6 8.5h12M6 6.5v4M18 6.5v4"/>',
    transform: '<path d="M4 20V9l6-5v11z"/><path d="M20 20V9l-6-5v11z" stroke-dasharray="3 2.5"/><path d="M12 3.5v17"/>',
    vectorsum: '<path d="M4 20 14 10M14 10h-4.5M14 10v4.5"/><path d="M4 20 9 7M9 7 7 10.5M9 7l3 2" stroke-dasharray="3 2.5"/><path d="m14 10 5-6M19 4h-4.5M19 4v4.5"/>',
    /* 지도·환율 버튼은 이모지(🗺️·💱)로 두면 안 된다 — icons.js 가 앱 UI 의 색상 이모지를 걷어내는데
       대응하는 단색 SVG 가 없으면 글자만 사라져 빈 버튼이 된다. 그래서 여기에 직접 그려 둔다. */
    map: '<path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    /* 환율은 동전 안의 ₩ 하나로 그린다. 순환 화살표를 두르면 뜻은 더 맞지만 도구막대 크기(17px)
       에서 가운데 글자가 뭉개져 무엇인지 알아볼 수 없다 — 후보를 실제 크기로 찍어 보고 고른 모양이다. */
    exchange: '<circle cx="12" cy="12" r="8"/><path d="m8.4 7.6 1.8 4.2 1.8-3 1.8 3 1.8-4.2"/><path d="M8.6 13.2h6.8M8.6 15.6h6.8"/>',
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
  let customColor = null, contextCustomColor = null, textSizeInput = null, contextTextSizeInput = null;
  let textSizeCaption = null, textSizeUnit = null, contextTextSizeLabel = null, contextTextSizeUnit = null;
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
  const setTextSize = (value) => {
    const selected = wb.selected;
    const fallback = selected && selected.type === "text" ? selected.fontSize : wb.textSize;
    const size = normalizeWhiteboardTextSize(value, fallback);
    wb.textSize = size;
    if (selected && selected.type === "text"){
      if (Number(selected.fontSize) === size && Number(selected.textBaseFontSize) === size){ syncSelectionControls(); return; }
      replaceSelectedItem(selected, Object.assign({}, selected, { fontSize:size, textBaseFontSize:size }));
      return;
    }
    syncSelectionControls(); scheduleBoardRecovery();
  };
  const setDirectSize = (value) => {
    const selected = wb.selected;
    const objectScale = whiteboardObjectScalePercent(selected);
    if (objectScale){
      const percent = normalizeWhiteboardObjectScale(value, objectScale);
      if (Math.abs(objectScale - percent) < 1){ syncSelectionControls(); return; }
      if (selected.type === "image") resizeSelectedFormula(percent / 100);
      else resizeSelectedPreset(percent / 100);
      return;
    }
    setTextSize(value);
  };
  const bindTextSizeInput = (input) => {
    input.addEventListener("change", () => setDirectSize(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault(); setDirectSize(input.value); input.select();
    });
  };
  function syncSelectionControls(){
    const selected = wb.selected;
    const formula = selected && selected.type === "image" && selected.role === "education-formula" ? selected : null;
    const text = selected && selected.type === "text" ? selected : null;
    const stencil = selected && selected.type === "group" && selected.role === "education-stencil" ? selected : null;
    const stroke = selected && ["line","arrow","rect","ellipse","polyline"].includes(selected.type) ? selected : null;
    const activeColor = whiteboardItemColor(selected) || wb.color;
    if (transformPanel && !transformPanel.hidden) syncTransformPanel();
    for (const k in swatchEls){ swatchEls[k].classList.toggle("active", k === activeColor); swatchEls[k].setAttribute("aria-pressed",String(k === activeColor)); }
    for (const k in contextSwatchEls){ contextSwatchEls[k].classList.toggle("active", k === activeColor); contextSwatchEls[k].setAttribute("aria-checked",String(k === activeColor)); }
    if (customColor && /^#[0-9a-f]{6}$/i.test(activeColor)) customColor.value = activeColor;
    if (contextCustomColor && /^#[0-9a-f]{6}$/i.test(activeColor)) contextCustomColor.value = activeColor;
    const objectScale = whiteboardObjectScalePercent(formula || stencil);
    const directValue = objectScale || normalizeWhiteboardTextSize(text ? text.fontSize : wb.textSize);
    const directLabel = formula ? "수식" : stencil ? "도형" : "글자";
    const directUnit = objectScale ? "%" : "px";
    const directMin = objectScale ? WB_OBJECT_SCALE_MIN : WB_TEXT_SIZE_MIN;
    const directMax = objectScale ? WB_OBJECT_SCALE_MAX : WB_TEXT_SIZE_MAX;
    const directTitle = objectScale ? `${directLabel} 크기 직접 입력 (${directMin}~${directMax}%)` : `글자 크기 직접 입력 (${directMin}~${directMax}px)`;
    if (textSizeCaption) textSizeCaption.textContent = directLabel;
    if (contextTextSizeLabel) contextTextSizeLabel.textContent = directLabel;
    if (textSizeUnit) textSizeUnit.textContent = directUnit;
    if (contextTextSizeUnit) contextTextSizeUnit.textContent = directUnit;
    for (const input of [textSizeInput, contextTextSizeInput]){
      if (!input) continue;
      input.min = String(directMin); input.max = String(directMax); input.title = directTitle; input.setAttribute("aria-label", directTitle);
      if (document.activeElement !== input) input.value = String(directValue);
    }
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
  let contextMenuBoardPoint=null;
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
  const focusContextActions=document.createElement("div"); focusContextActions.className="wb-context-actions wb-focus-context-actions";
  const focusContextEllipseBtn=contextAction("원형","원형 스포트라이트로 변경","wb-focus-context-choice",()=>setFocus({spotlight:{...focus.spotlight,shape:"ellipse"}}));
  const focusContextRectBtn=contextAction("사각형","사각형 스포트라이트로 변경","wb-focus-context-choice",()=>setFocus({spotlight:{...focus.spotlight,shape:"rect"}}));
  const focusContextResetBtn=contextAction("위치 초기화","집중 도구 위치와 크기 초기화","",resetFocusGeometry);
  const focusContextToggle=mkBtn("조절점 숨기기","집중 도구 조절점 숨기기","",()=>{
    const next=!focus.controlsVisible; setFocusControlsVisible(next); closeFocusContextMenu();
    if(typeof toast==="function")toast(next?"집중 도구 조절점을 표시했어요.":"집중 도구 조절점을 숨겼어요.",1300);
  });
  focusContextToggle.setAttribute("role","menuitem");
  const focusContextStopBtn=contextAction("종료","집중 도구 종료","wb-context-danger",stopFocus);
  focusContextActions.append(focusContextEllipseBtn,focusContextRectBtn,focusContextResetBtn,focusContextToggle,focusContextStopBtn);
  focusContextSection.appendChild(focusContextActions);

  const contextItemSection=makeContextSection("선택 항목","wb-context-item");
  const contextItemName=document.createElement("div"); contextItemName.className="wb-context-target";
  const contextItemActions=document.createElement("div"); contextItemActions.className="wb-context-actions";
  const contextEditBtn=contextAction("편집","선택한 텍스트 또는 수식 편집","",editSelected);
  const contextCopyBtn=contextAction("복사","선택한 항목 복사 (Ctrl+C)","",copySelectedFromMenu);
  const contextCutBtn=contextAction("잘라내기","선택한 항목 잘라내기 (Ctrl+X)","",cutSelectedFromMenu);
  const contextPasteItemBtn=contextAction("붙여넣기","복사한 항목을 이 위치에 붙여넣기","",()=>pasteInternalClipboardAt(contextMenuBoardPoint));
  const contextDuplicateBtn=contextAction("복제","선택한 항목을 오른쪽 아래에 복제","",duplicateSelected);
  const contextForwardBtn=contextAction("앞으로","선택한 항목을 한 단계 앞으로","",()=>moveSelectedLayer("forward"));
  const contextBackwardBtn=contextAction("뒤로","선택한 항목을 한 단계 뒤로","",()=>moveSelectedLayer("backward"));
  const contextFrontBtn=contextAction("맨 앞으로","선택한 항목을 맨 앞으로","",()=>moveSelectedLayer("front"));
  const contextBackBtn=contextAction("맨 뒤로","선택한 항목을 맨 뒤로","",()=>moveSelectedLayer("back"));
  const contextFlipXBtn=contextAction("좌우 반전","선택한 이미지 또는 교육 도형 좌우 반전","",()=>flipSelected("flipX"));
  const contextFlipYBtn=contextAction("상하 반전","선택한 이미지 또는 교육 도형 상하 반전","",()=>flipSelected("flipY"));
  const contextUngroupBtn=contextAction("분리","선택한 그룹의 구성 요소 분리","",ungroupSelected);
  const contextMeasureBtn=contextAction("측정","선택한 도형의 길이·각도·넓이 붙이기","",toggleMeasureOnSelection);
  const contextVectorBtn=contextAction("합성","같은 점에서 출발한 두 화살표의 합력 붙이기","",toggleVectorSumOnSelection);
  const contextTransformBtn=contextAction("변환","대칭·회전·평행이동·닮음으로 바꾸기","",()=>toggleTransformPanel(true));
  const contextToBackgroundBtn=contextAction("배경으로","선택한 그림을 보드 배경으로 내리기","",()=>sendSelectedToBackground());
  const contextDeleteBtn=contextAction("삭제","선택한 항목 삭제 (Delete)","wb-context-danger",deleteSelected);
  contextItemActions.append(contextEditBtn,contextCopyBtn,contextCutBtn,contextPasteItemBtn,contextDuplicateBtn,contextForwardBtn,contextBackwardBtn,contextFrontBtn,contextBackBtn,contextToBackgroundBtn,contextFlipXBtn,contextFlipYBtn,contextMeasureBtn,contextTransformBtn,contextUngroupBtn,contextDeleteBtn);
  contextItemSection.append(contextItemName,contextItemActions);

  const contextBoardSection=makeContextSection("보드 작업","wb-context-board");
  const contextBoardActions=document.createElement("div"); contextBoardActions.className="wb-context-actions";
  const contextPasteBoardBtn=contextAction("붙여넣기","복사한 항목을 이 위치에 붙여넣기","",()=>pasteInternalClipboardAt(contextMenuBoardPoint));
  const contextImageBtn=contextAction("이미지","이미지 파일을 이 보드에 넣기","",openImageFilePicker);
  const contextEducationBtn=contextAction("수학·과학","수학·과학 도구상자 열기","",()=>toggleEducationPanel(true));
  const contextGraphBtn=contextAction("그래프","함수 그래프 만들기 — 식을 치면 곡선을 계산해 넣습니다","",()=>{eduCategory="graph";toggleEducationPanel(true);});
  const contextChartBtn=contextAction("차트","자료 차트 만들기 — 표 숫자로 막대·꺾은선·원그래프를 넣습니다","",()=>{eduCategory="chart";toggleEducationPanel(true);});
  const contextChemBtn=contextAction("주기율표","주기율표와 반응식 균형 맞추기 열기","",()=>{eduCategory="chemistry";toggleEducationPanel(true);});
  const contextBackgroundBtn=contextAction("배경","보드 배경(색·무늬) 바꾸기","",()=>toggleBackgroundPanel(true));
  contextZoomOutBtn=contextAction("축소","화이트보드 화면 축소","",()=>setViewScale(view.scale/1.25));
  contextZoomResetBtn=contextAction("100%","화이트보드 배율 100%로 초기화","",resetView);
  contextZoomInBtn=contextAction("확대","화이트보드 화면 확대","",()=>setViewScale(view.scale*1.25));
  const contextFocusBtn=contextAction("집중 도구","스포트라이트·화면 가리개 설정 열기","",()=>toggleFocusPanel(true));
  const contextClearBtn=contextAction("전체 지우기","보드 내용 전체 지우기","wb-context-danger wb-context-clear",confirmClearAll);
  contextBoardActions.append(contextPasteBoardBtn,contextImageBtn,contextEducationBtn,contextGraphBtn,contextChartBtn,contextChemBtn,contextBackgroundBtn,contextZoomOutBtn,contextZoomResetBtn,contextZoomInBtn,contextFocusBtn,contextClearBtn);
  contextBoardSection.appendChild(contextBoardActions);

  // 교구는 판서 내용이 아니라 손에 든 도구라 보드 작업과 같은 자리(선택 없을 때)에 둔다.
  const contextGearSection=makeContextSection("교구·정리","wb-context-gear-section");
  const contextGearActions=document.createElement("div"); contextGearActions.className="wb-context-actions wb-context-gear-actions";
  const contextRulerBtn=contextAction("자","자 꺼내기 — 대고 그으면 곧게 그려집니다 (왼쪽 손잡이로 길이 조절)","",()=>setGear("ruler"));
  const contextProtractorBtn=contextAction("각도기","각도기 꺼내기 — 가운데에서 그으면 1°씩 맞춰집니다 (왼쪽 손잡이로 크기 조절)","",()=>setGear("protractor"));
  const contextCompassBtn=contextAction("컴퍼스","컴퍼스 꺼내기 — 연필 손잡이를 돌리면 호·원이 그려집니다 (중간 손잡이로 반지름 조절)","",()=>setGear("compass"));
  const contextSnapBtn=contextAction("15° 맞추기","직선·화살표를 15°씩 맞춰 긋기","",()=>{gear.snap=!gear.snap;saveGearPrefs();syncGearButtons();});
  const contextTidyBtn=contextAction("손그림 정리","대충 그린 도형을 반듯하게 바꾸기","",()=>{
    gear.tidy=!gear.tidy;saveGearPrefs();syncGearButtons();
    if(typeof toast==="function")toast(gear.tidy?"손그림 정리를 켰어요.":"손그림 정리를 껐어요.",2000);
  });
  const contextGearClearBtn=contextAction("교구 치우기","꺼내 놓은 자·각도기·컴퍼스 치우기 (Esc)","",()=>{
    gear.ruler=null;gear.protractor=null;gear.compass=null;syncGearButtons();redraw();
  });
  contextGearActions.append(contextRulerBtn,contextProtractorBtn,contextCompassBtn,contextSnapBtn,contextTidyBtn,contextGearClearBtn);
  contextGearSection.appendChild(contextGearActions);

  const contextOutputSection=makeContextSection("출력·공유","wb-context-output");
  const contextOutputActions=document.createElement("div"); contextOutputActions.className="wb-context-actions wb-context-output-actions";
  const contextPngBtn=contextAction("PNG 저장","현재 보드를 PNG 이미지로 저장","",exportPng);
  const contextPdfBtn=contextAction("PDF 저장","현재 보드를 PDF로 저장","",exportPdf);
  const contextPrintBtn=contextAction("인쇄","현재 보드 판서 내용 인쇄","",printBoard);
  const contextMemoBtn=contextAction("메모로","현재 보드를 편집 가능한 상태로 메모창에 보내기","",sendToMemo);
  contextOutputActions.append(contextPngBtn,contextPdfBtn,contextPrintBtn,contextMemoBtn); contextOutputSection.appendChild(contextOutputActions);

  const contextRecordSection=makeContextSection("수업 기록","wb-context-record-section");
  const contextRecordActions=document.createElement("div"); contextRecordActions.className="wb-context-actions wb-context-record-actions";
  const contextRecordBtn=contextAction("● 녹화 시작","수업 리플레이 녹화 시작","wb-context-record",toggleRecord);
  contextRecordActions.appendChild(contextRecordBtn); contextRecordSection.appendChild(contextRecordActions);

  const contextToolbarSection=makeContextSection("도구막대","wb-context-toolbar-section");
  const contextToolbarActions=document.createElement("div"); contextToolbarActions.className="wb-context-actions wb-context-toolbar-actions";
  const contextToolbarToggle=contextAction("편집 도구막대 숨기기","편집 도구막대 숨기기","wb-context-toolbar-toggle",toggleToolbarVisibility);
  contextToolbarActions.appendChild(contextToolbarToggle); contextToolbarSection.appendChild(contextToolbarActions);

  const contextPositionSection=makeContextSection("도구막대 위치","wb-context-position-section");
  const contextPositionActions=document.createElement("div"); contextPositionActions.className="wb-context-actions wb-context-position-actions";
  const contextPositionBtns={};
  [["top","위"],["right","오른쪽"],["bottom","아래"],["left","왼쪽"]].forEach(([position,label])=>{
    const button=contextAction(label,"도구막대를 "+label+"에 배치","wb-context-position",()=>setToolbarPosition(position));
    button.setAttribute("aria-pressed","false"); contextPositionBtns[position]=button; contextPositionActions.appendChild(button);
  });
  contextPositionSection.appendChild(contextPositionActions);

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

  const contextTextSizeSection=makeContextSection("크기 직접 입력","wb-context-text-size-section");
  const contextTextSizeControl=document.createElement("label"); contextTextSizeControl.className="wb-context-text-size-control";
  contextTextSizeLabel=document.createElement("span"); contextTextSizeLabel.textContent="글자";
  contextTextSizeInput=document.createElement("input"); contextTextSizeInput.type="number"; contextTextSizeInput.className="wb-text-size-input";
  contextTextSizeInput.min=String(WB_TEXT_SIZE_MIN); contextTextSizeInput.max=String(WB_TEXT_SIZE_MAX); contextTextSizeInput.step="1"; contextTextSizeInput.inputMode="numeric";
  contextTextSizeInput.value=String(wb.textSize); contextTextSizeInput.title="글자 크기 직접 입력 (12~72px)"; contextTextSizeInput.setAttribute("aria-label",contextTextSizeInput.title);
  contextTextSizeUnit=document.createElement("span"); contextTextSizeUnit.textContent="px";
  bindTextSizeInput(contextTextSizeInput); contextTextSizeControl.append(contextTextSizeLabel,contextTextSizeInput,contextTextSizeUnit); contextTextSizeSection.appendChild(contextTextSizeControl);

  const contextHistorySection=makeContextSection("","wb-context-history");
  const contextHistoryActions=document.createElement("div"); contextHistoryActions.className="wb-context-actions wb-context-history-actions";
  contextUndoBtn=contextAction("되돌리기","되돌리기 (Ctrl+Z)","",doUndo);
  contextRedoBtn=contextAction("다시 실행","다시 실행 (Ctrl+Y)","",doRedo);
  contextHistoryActions.append(contextUndoBtn,contextRedoBtn); contextHistorySection.appendChild(contextHistoryActions);
  focusContextMenu.append(focusContextSection,contextItemSection,contextBoardSection,contextGearSection,contextOutputSection,contextRecordSection,contextToolbarSection,contextPositionSection,contextToolSection,contextInkSection,contextTextSizeSection,contextHistorySection);

  function closeFocusContextMenu(){ focusContextMenu.hidden=true; }
  function onFocusContextMenu(e){
    if(focusPanel.contains(e.target)||focusControls.contains(e.target)||(!eduPanel.hidden&&eduPanel.contains(e.target))||(!bgPanel.hidden&&bgPanel.contains(e.target))||(!transformPanel.hidden&&transformPanel.contains(e.target)))return;
    e.preventDefault();e.stopPropagation();
    const screen=screenPoint(e); lastBoardPointer=boardPointFromScreen(screen); contextMenuBoardPoint={x:lastBoardPointer.x,y:lastBoardPointer.y};
    const canSelect=!(focus.active&&focus.controlsVisible)&&focusAllowsScreenPoint(screen);
    wb.selected=canSelect?itemAt(lastBoardPointer):null; redraw();

    const selected=wb.selected,formula=selected&&selected.type==="image"&&selected.role==="education-formula";
    const stencil=selected&&selected.type==="group"&&selected.role==="education-stencil",flippable=whiteboardCanFlipItem(selected);
    const typeLabels={image:formula?"수식":"이미지",line:"직선",arrow:"화살표",rect:"사각형",ellipse:"원",polyline:"도형",text:"텍스트",group:stencil?"교육 도형":"그룹"};
    focusContextSection.hidden=!focus.active;
    contextItemSection.hidden=!selected;
    contextBoardSection.hidden=!!selected;
    contextOutputSection.hidden=!!selected; contextRecordSection.hidden=!!selected; contextPositionSection.hidden=!!selected;
    contextGearSection.hidden=!!selected;
    const plot=selected&&selected.type==="group"&&selected.role==="education-plot";
    const chart=selected&&selected.type==="group"&&selected.role==="education-chart";
    const element=selected&&selected.type==="group"&&selected.role==="education-element";
    const measureLabelItem=isMeasureItem(selected);
    if(plot)typeLabels.group="함수 그래프"; else if(chart)typeLabels.group="차트"; else if(element)typeLabels.group="원소 카드";
    else if(selected&&selected.role==="vector-sum")typeLabels.group="벡터 합성";
    else if(selected&&selected.role==="education-table")typeLabels.group="표";
    else if(selected&&selected.role==="education-tool")typeLabels.group=selected.educationLabel||"수 모형";
    if(measureLabelItem)typeLabels.text="측정값";
    contextItemName.textContent=selected?(typeLabels[selected.type]||"화이트보드 항목"):"";
    contextEditBtn.hidden=!canEditSelected(selected);
    // 잴 수 있는 도형에만 측정을 보여 주고, 이미 붙어 있으면 떼는 단추가 된다.
    const measurable=!!(selected&&!measureLabelItem&&MNBoardTools.measureLabel(selected,measureBoardText));
    const measured=!!(selected&&measureLabelOf(selected));
    contextMeasureBtn.hidden=!(measurable||measureLabelItem);
    contextMeasureBtn.textContent=(measured||measureLabelItem)?"측정 떼기":"측정";
    contextMeasureBtn.title=(measured||measureLabelItem)?"붙여 둔 길이·각도·넓이 떼기":"선택한 도형의 길이·각도·넓이 붙이기";
    contextMeasureBtn.setAttribute("aria-label",contextMeasureBtn.title);
    // 화살표에만 합성을 보여 주고, 이미 붙어 있으면 떼는 단추가 된다.
    const vectorSumItem=isVectorSumItem(selected);
    const vectorSummed=!!(selected&&vectorSumsFor(selected).length);
    contextVectorBtn.hidden=!(vectorSumItem||(selected&&selected.type==="arrow"));
    contextVectorBtn.textContent=(vectorSumItem||vectorSummed)?"합성 떼기":"합성";
    contextVectorBtn.title=(vectorSumItem||vectorSummed)?"붙여 둔 합력 떼기":"같은 점에서 출발한 두 화살표의 합력 붙이기";
    contextVectorBtn.setAttribute("aria-label",contextVectorBtn.title);
    contextTransformBtn.hidden=!selected||measureLabelItem||vectorSumItem;
    contextTransformBtn.classList.toggle("active",!transformPanel.hidden);
    contextFlipXBtn.hidden=!flippable; contextFlipYBtn.hidden=!flippable;
    contextFlipXBtn.classList.toggle("active",flippable&&!!selected.flipX); contextFlipYBtn.classList.toggle("active",flippable&&!!selected.flipY);
    contextFlipXBtn.setAttribute("aria-pressed",String(flippable&&!!selected.flipX)); contextFlipYBtn.setAttribute("aria-pressed",String(flippable&&!!selected.flipY));
    contextUngroupBtn.hidden=!(selected&&selected.type==="group");
    // 배경으로 내리기는 그림에만 — 도형·글씨는 배경이 될 수 없다(배경은 그림 한 장이다).
    contextToBackgroundBtn.hidden=!(selected&&selected.type==="image"&&selected.src);
    const selectedIndex=selected?wb.items.indexOf(selected):-1, lastIndex=wb.items.length-1;
    contextPasteItemBtn.disabled=!hasWhiteboardInternalClipboard(); contextPasteBoardBtn.disabled=!hasWhiteboardInternalClipboard();
    contextForwardBtn.disabled=selectedIndex<0||selectedIndex>=lastIndex; contextFrontBtn.disabled=contextForwardBtn.disabled;
    contextBackwardBtn.disabled=selectedIndex<=0; contextBackBtn.disabled=contextBackwardBtn.disabled;
    const focusBlocksInsert=focus.active&&focus.controlsVisible;
    contextImageBtn.disabled=focusBlocksInsert; contextEducationBtn.disabled=focusBlocksInsert; contextPasteBoardBtn.disabled=contextPasteBoardBtn.disabled||focusBlocksInsert;
    contextGraphBtn.disabled=focusBlocksInsert; contextChartBtn.disabled=focusBlocksInsert; contextChemBtn.disabled=focusBlocksInsert;
    // 꺼낸 교구·켜 둔 옵션은 눌린 상태로 보여 준다(도구막대 단추와 같은 표시).
    for(const [button,on] of [[contextRulerBtn,!!gear.ruler],[contextProtractorBtn,!!gear.protractor],[contextCompassBtn,!!gear.compass],[contextSnapBtn,!!gear.snap],[contextTidyBtn,!!gear.tidy]]){
      button.classList.toggle("active",on); button.setAttribute("aria-pressed",String(on));
    }
    contextGearClearBtn.disabled=!(gear.ruler||gear.protractor||gear.compass);
    contextClearBtn.disabled=!wb.items.length;
    const boardEmpty=!wb.items.length&&!wb.bgImage;
    contextPngBtn.disabled=boardEmpty; contextPdfBtn.disabled=boardEmpty; contextPrintBtn.disabled=boardEmpty; contextMemoBtn.disabled=boardEmpty;
    syncRecordButtons();
    for(const position in contextPositionBtns){
      const active=position===curPos; contextPositionBtns[position].classList.toggle("active",active); contextPositionBtns[position].setAttribute("aria-pressed",String(active));
    }
    contextToolbarToggle.textContent=toolbarVisible?"편집 도구막대 숨기기":"편집 도구막대 보이기";
    contextToolbarToggle.title=contextToolbarToggle.textContent; contextToolbarToggle.setAttribute("aria-label",contextToolbarToggle.textContent);
    const spotlightMode=focus.mode==="spotlight";
    focusContextEllipseBtn.hidden=!spotlightMode; focusContextRectBtn.hidden=!spotlightMode;
    focusContextEllipseBtn.classList.toggle("active",spotlightMode&&focus.spotlight.shape==="ellipse");
    focusContextRectBtn.classList.toggle("active",spotlightMode&&focus.spotlight.shape==="rect");
    focusContextEllipseBtn.setAttribute("aria-pressed",String(spotlightMode&&focus.spotlight.shape==="ellipse"));
    focusContextRectBtn.setAttribute("aria-pressed",String(spotlightMode&&focus.spotlight.shape==="rect"));
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
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement)return;
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
  function toggleFocusActive(){
    if (focus.active) stopFocus();
    else { startFocus(); toggleFocusPanel(false); }
  }
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
    storageKey:"classdock-whiteboard:focus-rect:v1",min:{w:280,h:250},
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

  // ----- 함수 그래프 만들기 -----
  // 식을 치면 실제로 값을 계산해 그린 곡선을 넣는다(모양만 흉내 낸 그림이 아니다).
  const graphBuilder = document.createElement("div"); graphBuilder.className = "wb-formula-builder wb-graph-builder"; graphBuilder.hidden = true;
  const graphRows = document.createElement("div"); graphRows.className = "wb-graph-rows";
  // 관계 기호를 = 아닌 것으로 바꾸면 곡선 대신 그쪽 반평면을 칠한 부등식 영역이 된다.
  const GRAPH_RELATIONS = [["eq", "y ="], ["gt", "y >"], ["ge", "y ≥"], ["lt", "y <"], ["le", "y ≤"]];
  const graphRelations = [], graphRowCaptions = [];
  const graphInputs = MNBoardTools.CURVE_COLORS.map((color, index) => {
    const row = document.createElement("label"); row.className = "wb-graph-row";
    const dot = document.createElement("span"); dot.className = "wb-graph-dot"; dot.style.background = color;
    const relation = document.createElement("select"); relation.className = "wb-graph-caption wb-graph-relation";
    relation.title = "관계 기호 — 부등호를 고르면 그쪽 영역을 칠합니다";
    relation.setAttribute("aria-label", `${index + 1}번째 식의 관계 기호`);
    for (const [id, text] of GRAPH_RELATIONS){
      const option = document.createElement("option"); option.value = id; option.textContent = text; relation.appendChild(option);
    }
    const input = document.createElement("input"); input.type = "text"; input.className = "wb-graph-input";
    input.placeholder = index === 0 ? "예: x^2 - 3x + 1" : "식을 더 넣으면 함께 그려요";
    input.setAttribute("aria-label", `${index + 1}번째 함수식`);
    // 극좌표·수열에서는 관계 기호 자리에 'r =' · 'aₙ =' 를 대신 세운다(고를 것이 없으므로 글자로).
    const caption = document.createElement("span"); caption.className = "wb-graph-caption"; caption.hidden = true;
    row.append(dot, relation, caption, input); graphRows.appendChild(row);
    graphRelations.push(relation); graphRowCaptions.push(caption);
    return input;
  });
  /* 매개변수 곡선은 한 곡선에 식이 둘(x(t)·y(t))이라 칸을 따로 둔다. 같은 줄에 억지로
     끼우면 어느 식이 x 인지 y 인지 알 수 없다. */
  const graphPairRows = document.createElement("div"); graphPairRows.className = "wb-graph-rows"; graphPairRows.hidden = true;
  const graphPairInputs = MNBoardTools.CURVE_COLORS.map((color, index) => {
    const row = document.createElement("div"); row.className = "wb-graph-row";
    const dot = document.createElement("span"); dot.className = "wb-graph-dot"; dot.style.background = color;
    const makePart = (caption, placeholder, aria) => {
      const wrap = document.createElement("label"); wrap.className = "wb-graph-pair";
      const name = document.createElement("span"); name.className = "wb-graph-caption"; name.textContent = caption;
      const input = document.createElement("input"); input.type = "text"; input.className = "wb-graph-input";
      input.placeholder = placeholder; input.setAttribute("aria-label", aria);
      wrap.append(name, input); return { wrap, input };
    };
    const x = makePart("x =", index === 0 ? "예: 3 cos(t)" : "", `${index + 1}번째 곡선의 x(t)`);
    const y = makePart("y =", index === 0 ? "예: 3 sin(t)" : "", `${index + 1}번째 곡선의 y(t)`);
    row.append(dot, x.wrap, y.wrap); graphPairRows.appendChild(row);
    return { x:x.input, y:y.input };
  });
  // 예시 식은 "커서가 있던 칸"에 들어간다. 예시 카드를 누르면 초점이 카드로 옮겨가므로 마지막 칸을 기억해 둔다.
  let graphFocusIndex = 0;
  const makeGearNumber = (caption, value, title, className) => {
    const wrap = document.createElement("label"); wrap.className = "wb-graph-field";
    const name = document.createElement("span"); name.textContent = caption;
    const input = document.createElement("input"); input.type = "number"; input.step = "any"; input.value = String(value);
    input.className = className || "wb-graph-number"; input.title = title; input.setAttribute("aria-label", title);
    // caption 은 이름표 자체다 — 같은 칸을 방법마다 다른 뜻으로 쓸 때 글자만 갈아 단다.
    wrap.append(name, input); return { wrap, input, caption:name };
  };
  const graphRange = document.createElement("div"); graphRange.className = "wb-graph-range";
  const graphXMin = makeGearNumber("x", -10, "x 최솟값");
  const graphXMax = makeGearNumber("~", 10, "x 최댓값");
  const graphYMin = makeGearNumber("y", -10, "y 최솟값");
  const graphYMax = makeGearNumber("~", 10, "y 최댓값");
  // 매개변수·극좌표에서 훑는 값의 범위. 한 바퀴(0~2π≈6.28)를 기본으로 둔다.
  const graphTMin = makeGearNumber("t", 0, "t(θ) 시작 값");
  const graphTMax = makeGearNumber("~", 6.28, "t(θ) 끝 값");
  const graphAutoWrap = document.createElement("label"); graphAutoWrap.className = "wb-graph-check";
  const graphAuto = document.createElement("input"); graphAuto.type = "checkbox"; graphAuto.checked = true;
  graphAutoWrap.append(graphAuto, document.createTextNode("y 자동"));
  const graphGridWrap = document.createElement("label"); graphGridWrap.className = "wb-graph-check";
  const graphGrid = document.createElement("input"); graphGrid.type = "checkbox"; graphGrid.checked = true;
  graphGridWrap.append(graphGrid, document.createTextNode("모눈"));
  // 식에 a·b 같은 문자가 있으면 그 값을 보드에서 바로 끌어 바꿀 수 있게 슬라이더 띠를 함께 넣는다.
  const graphSliderWrap = document.createElement("label"); graphSliderWrap.className = "wb-graph-check";
  graphSliderWrap.title = "a·b 값을 보드 위에서 끌어 바꿀 수 있는 슬라이더를 그래프에 함께 넣습니다.";
  const graphSlider = document.createElement("input"); graphSlider.type = "checkbox"; graphSlider.checked = true;
  graphSliderWrap.append(graphSlider, document.createTextNode("보드 슬라이더"));
  graphRange.append(graphXMin.wrap, graphXMax.wrap, graphTMin.wrap, graphTMax.wrap, graphAutoWrap, graphYMin.wrap, graphYMax.wrap, graphGridWrap, graphSliderWrap);
  // ----- 그래프 해석(교점·접선·구간 넓이) -----
  const makeGraphCheck = (text, title) => {
    const wrap = document.createElement("label"); wrap.className = "wb-graph-check"; wrap.title = title;
    const box = document.createElement("input"); box.type = "checkbox"; box.setAttribute("aria-label", title);
    wrap.append(box, document.createTextNode(text));
    return { wrap, box };
  };
  const graphAnalysis = document.createElement("div"); graphAnalysis.className = "wb-graph-range wb-graph-analysis";
  graphAnalysis.setAttribute("aria-label", "그래프 해석 도구");
  const graphCross = makeGraphCheck("교점", "두 곡선이 만나는 점의 좌표를 찍습니다.");
  const graphTangent = makeGraphCheck("접선", "고른 x 자리의 접선과 기울기(순간변화율)를 그립니다.");
  const graphTangentX = makeGearNumber("x", 1, "접선을 그을 x 값");
  const graphArea = makeGraphCheck("넓이", "구간과 x축 사이를 칠하고 넓이를 적습니다.");
  const graphDerivative = makeGraphCheck("도함수", "곡선의 기울기(순간변화율)를 이은 도함수 곡선을 같은 색 점선으로 겹쳐 그립니다.");
  const graphAreaFrom = makeGearNumber("", 0, "넓이를 구할 구간의 시작");
  const graphAreaTo = makeGearNumber("~", 2, "넓이를 구할 구간의 끝");
  const graphAreaBars = makeGearNumber("직사각형", 0, "직사각형 개수 — 0이면 매끄럽게 칠하고 정적분 값을 적습니다");
  // 식을 여러 개 적었을 때 접선·넓이를 어느 식에 쓸지 고른다(하나뿐이면 숨긴다).
  const graphTargetWrap = document.createElement("label"); graphTargetWrap.className = "wb-graph-field";
  graphTargetWrap.append(document.createTextNode("대상"));
  const graphTarget = document.createElement("select"); graphTarget.className = "wb-graph-number";
  graphTarget.title = "접선·넓이를 적용할 식"; graphTarget.setAttribute("aria-label", graphTarget.title);
  graphInputs.forEach((_, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = `${index + 1}번 식`;
    graphTarget.appendChild(option);
  });
  graphTargetWrap.appendChild(graphTarget); graphTargetWrap.hidden = true;
  graphAnalysis.append(graphCross.wrap, graphTangent.wrap, graphTangentX.wrap, graphArea.wrap, graphAreaFrom.wrap, graphAreaTo.wrap, graphAreaBars.wrap, graphDerivative.wrap, graphTargetWrap);
  // ----- 식 ↔ 값의 표 -----
  // 같은 식에서 x·y 대응표를 만든다. 그래프와 짝을 이뤄 "표로 보고 그래프로 보기"를 한 화면에서 한다.
  const graphTableRow = document.createElement("div"); graphTableRow.className = "wb-graph-range wb-graph-table-row";
  graphTableRow.setAttribute("aria-label", "값의 표 만들기");
  const graphTableFrom = makeGearNumber("표 x", -3, "표에 넣을 x 시작 값");
  const graphTableTo = makeGearNumber("~", 3, "표에 넣을 x 끝 값");
  const graphTableStep = makeGearNumber("간격", 1, "x 를 얼마씩 건너뛸지");
  const graphTableInsert = mkBtn("값의 표 넣기", "식의 x·y 대응표를 화이트보드에 넣기", "wb-formula-save wb-graph-table-insert", submitValueTable);
  const graphTableCancel = mkBtn("표 편집 취소", "값의 표 편집 취소", "wb-formula-cancel", resetTableEditor); graphTableCancel.hidden = true;
  graphTableRow.append(graphTableFrom.wrap, graphTableTo.wrap, graphTableStep.wrap, graphTableInsert, graphTableCancel);
  const graphParams = document.createElement("div"); graphParams.className = "wb-graph-params"; graphParams.hidden = true;
  const graphPreview = document.createElement("canvas"); graphPreview.className = "wb-tool-preview";
  graphPreview.setAttribute("aria-label", "그래프 미리보기");
  const graphMessage = document.createElement("p"); graphMessage.className = "wb-tool-message";
  const graphActions = document.createElement("div"); graphActions.className = "wb-formula-actions";
  const graphClear = mkBtn("비우기", "입력한 식 지우기", "wb-formula-save", clearGraphInputs);
  const graphCancel = mkBtn("취소", "그래프 편집 취소", "wb-formula-cancel", resetGraphEditor); graphCancel.hidden = true;
  const graphInsert = mkBtn("그래프 넣기", "계산한 그래프를 화이트보드에 넣기", "wb-formula-insert", submitGraph);
  graphActions.append(graphClear, graphCancel, graphInsert);
  /* 그리는 방법 — y=f(x) 말고도 매개변수(x(t), y(t))와 극좌표(r=f(θ))로 그릴 수 있다.
     방법마다 쓰는 칸이 달라서 맨 위에 두고 아래 칸을 갈아 끼운다. */
  const GRAPH_MODES = [
    ["function", "함수 y=f(x)"], ["parametric", "매개변수 x(t), y(t)"], ["polar", "극좌표 r=f(θ)"],
    ["implicit", "음함수 f(x,y)=0"], ["sequence", "수열 aₙ"]
  ];
  let graphMode = "function";
  const graphModeRow = document.createElement("div"); graphModeRow.className = "wb-chip-grid wb-graph-modes";
  graphModeRow.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
  graphModeRow.setAttribute("aria-label", "그래프 그리는 방법");
  const graphModeChips = GRAPH_MODES.map(([id, text]) => {
    const chip = mkBtn(text, text + " 로 그리기", "wb-formula-group", () => {
      if (graphMode === id) return;
      /* 같은 칸이 방법마다 다른 뜻이다(도는 각 t·θ ↔ 항의 번호 n). 저쪽 기본값이 그대로
         남아 있을 때만 이쪽 기본값으로 바꿔, 손수 정한 범위는 지키면서 뜻은 맞춘다. */
      const from = graphTMin.input.value.trim(), to = graphTMax.input.value.trim();
      if (id === "sequence" && from === "0" && to === "6.28"){ graphTMin.input.value = "1"; graphTMax.input.value = "10"; }
      if (id !== "sequence" && from === "1" && to === "10"){ graphTMin.input.value = "0"; graphTMax.input.value = "6.28"; }
      graphMode = id; graphParamKey = "__reset__"; refreshGraphPreview();
    });
    chip.dataset.graphMode = id; graphModeRow.appendChild(chip); return chip;
  });
  graphBuilder.append(graphModeRow, graphRows, graphPairRows, graphRange, graphAnalysis, graphTableRow, graphParams, graphPreview, graphMessage, graphActions);

  /* 만들기 화면 안의 구획 — 이름표를 단 묶음. 무엇이 무엇인지 보이고 줄이 뒤섞이지 않는다.
     (칩 줄은 가로로 흐르는 띠라 항목이 많으면 잘려 보이므로, 구획 안에서는 격자로 깐다.) */
  // fold 를 켜면 접이식(details) 구획이 된다 — 가끔 쓰는 도구는 접어 두어야 아래쪽 ‘넣기’가 안 밀린다.
  const makeToolSection = (caption, className, fold) => {
    const section = document.createElement(fold ? "details" : "section");
    section.className = "wb-tool-section" + (fold ? " wb-tool-fold" : "") + (className ? " " + className : "");
    section.setAttribute("aria-label", caption);
    const title = document.createElement(fold ? "summary" : "span");
    title.className = "wb-tool-caption"; title.textContent = caption;
    section.appendChild(title);
    return section;
  };
  const makeChipGrid = (columns) => {
    const grid = document.createElement("div"); grid.className = "wb-chip-grid";
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    return grid;
  };

  // ----- 자료 차트 만들기 -----
  const chartBuilder = document.createElement("div"); chartBuilder.className = "wb-formula-builder wb-chart-builder"; chartBuilder.hidden = true;
  // 비슷한 종류끼리 붙여 둔다 — 막대 갈래 → 변화 → 비율 → 분포 → 관계 순서.
  const CHART_TYPES = [
    ["bar", "막대"], ["barh", "가로 막대"], ["stacked", "누적 막대"],
    ["line", "꺾은선"], ["pie", "원"], ["band", "띠그래프"],
    ["histogram", "히스토그램"], ["freqpoly", "도수분포다각형"], ["box", "상자그림"],
    ["scatter", "산점도"], ["bubble", "버블"]
  ];
  const chartTypeSection = makeToolSection("차트 종류", "wb-chart-type-section");
  const chartTypeBar = makeChipGrid(3); chartTypeBar.classList.add("wb-chart-types");
  chartTypeSection.appendChild(chartTypeBar);
  const chartTitle = document.createElement("input"); chartTitle.type = "text"; chartTitle.className = "wb-chart-title";
  chartTitle.placeholder = "차트 제목(선택)"; chartTitle.setAttribute("aria-label", "차트 제목");
  const chartData = document.createElement("textarea"); chartData.className = "wb-formula-input"; chartData.rows = 4;
  chartData.placeholder = "한 줄에 하나씩: 국어, 12\n묶음을 더 넣으려면 값을 여러 열로: 국어, 7, 9\n첫 줄에 ‘과목, 1반, 2반’처럼 이름을 적으면 범례가 붙어요";
  chartData.rows = 5;
  chartData.setAttribute("aria-label", "차트에 쓸 자료");
  // 묶음(또는 항목)마다 색을 고른다. 고른 색은 차트에 저장돼 다시 열어도 그대로다.
  const chartColorRow = document.createElement("div"); chartColorRow.className = "wb-chart-colors"; chartColorRow.hidden = true;
  chartColorRow.setAttribute("aria-label", "묶음 색");
  let chartPalette = [];
  // 통계 도구 — 추세선·계급 수와, 자료에서 바로 만드는 요약 카드·도수분포표.
  const chartExtras = makeToolSection("통계 도구 — 추세선·요약 카드·도수분포표", "wb-chart-extras", true);
  const chartExtraFields = document.createElement("div"); chartExtraFields.className = "wb-field-grid";
  const chartTrendWrap = document.createElement("label"); chartTrendWrap.className = "wb-graph-check";
  chartTrendWrap.title = "산점도에 최소제곱 추세선과 상관계수 r 을 함께 그립니다.";
  const chartTrend = document.createElement("input"); chartTrend.type = "checkbox";
  chartTrendWrap.append(chartTrend, document.createTextNode("추세선"));
  const chartBins = makeGearNumber("계급 수", 0, "히스토그램·도수분포다각형·도수분포표의 계급 수 (0이면 자동)");
  // 도수분포다각형에서만 켜지는 곁가지 — 켜면 누적도수분포곡선이 된다.
  const chartCumulativeWrap = document.createElement("label"); chartCumulativeWrap.className = "wb-graph-check";
  chartCumulativeWrap.title = "도수분포다각형을 계급의 끝값마다 누적도수를 찍는 누적도수분포곡선으로 그립니다.";
  const chartCumulative = document.createElement("input"); chartCumulative.type = "checkbox";
  chartCumulativeWrap.append(chartCumulative, document.createTextNode("누적"));
  chartExtraFields.append(chartTrendWrap, chartCumulativeWrap, chartBins.wrap);
  const chartExtraButtons = document.createElement("div"); chartExtraButtons.className = "wb-button-row";
  const chartStatsBtn = mkBtn("요약 카드", "평균·중앙값·최빈값·사분위수·표준편차를 표로 넣기", "wb-formula-save wb-chart-stats", insertStatsCard);
  const chartFreqBtn = mkBtn("도수분포표", "계급·도수·상대도수·누적도수 표로 넣기", "wb-formula-save wb-chart-frequency", insertFrequencyTable);
  chartExtraButtons.append(chartStatsBtn, chartFreqBtn);
  chartExtras.append(chartExtraFields, chartExtraButtons);
  const chartPreview = document.createElement("canvas"); chartPreview.className = "wb-tool-preview";
  chartPreview.setAttribute("aria-label", "차트 미리보기");
  const chartMessage = document.createElement("p"); chartMessage.className = "wb-tool-message";
  const chartActions = document.createElement("div"); chartActions.className = "wb-formula-actions";
  const chartClear = mkBtn("비우기", "입력한 자료 지우기", "wb-formula-save", () => { chartData.value = ""; chartTitle.value = ""; chartPalette = []; refreshChartPreview(); });
  const chartCancel = mkBtn("취소", "차트 편집 취소", "wb-formula-cancel", resetChartEditor); chartCancel.hidden = true;
  const chartInsert = mkBtn("차트 넣기", "입력한 자료로 만든 차트를 화이트보드에 넣기", "wb-formula-insert", submitChart);
  chartActions.append(chartClear, chartCancel, chartInsert);
  /* 확률 실험: 동전·주사위를 실제로 굴려 자료를 만들고, 그대로 차트로 넣는다.
     실험 단추는 격자로 깔고 설정은 이름표를 붙여 두 칸씩 맞춘다(한 줄에 몰면 오른쪽이 잘린다). */
  const simRow = makeToolSection("확률 실험 — 동전·주사위·주머니·스피너", "wb-sim-row", true);
  const SIMULATION_KINDS = [["coin", "동전"], ["dice", "주사위"], ["dice2", "주사위 2개"], ["number", "무작위 수"], ["bag", "주머니"], ["spinner", "스피너"]];
  const simKinds = makeChipGrid(3);
  for (const [id, label] of SIMULATION_KINDS){
    simKinds.appendChild(mkBtn(label, `${label} 실험 자료 만들기`, "wb-formula-group wb-sim-" + id, () => runSimulation(id)));
  }
  simRow.appendChild(simKinds);
  const simFields = document.createElement("div"); simFields.className = "wb-field-grid";
  // 주머니·스피너는 무엇을 몇 개 넣었는지가 있어야 굴릴 수 있다(자료 칸은 결과가 들어가는 자리라 따로 받는다).
  const simBagWrap = document.createElement("label"); simBagWrap.className = "wb-graph-field wb-sim-bag wb-field-wide";
  simBagWrap.append(document.createTextNode("구성"));
  const simBag = document.createElement("input"); simBag.type = "text"; simBag.className = "wb-graph-input";
  simBag.value = "빨강 3, 파랑 2";
  simBag.title = "주머니·스피너에 넣을 것 — ‘빨강 3, 파랑 2’ 처럼"; simBag.setAttribute("aria-label", simBag.title);
  simBagWrap.appendChild(simBag);
  const simDraws = makeGearNumber("뽑기", 1, "한 번에 몇 개를 뽑을지(주머니)");
  simDraws.input.min = "1"; simDraws.input.max = "6";
  const simReplaceWrap = document.createElement("label"); simReplaceWrap.className = "wb-graph-check";
  simReplaceWrap.title = "뽑은 것을 다시 넣고 뽑습니다(끄면 비복원 추출)";
  const simReplace = document.createElement("input"); simReplace.type = "checkbox";
  simReplaceWrap.append(simReplace, document.createTextNode("되돌려 넣기"));
  const simCountWrap = document.createElement("label"); simCountWrap.className = "wb-graph-field wb-sim-count";
  const simCountName = document.createElement("span"); simCountName.textContent = "횟수";
  const simCount = document.createElement("input"); simCount.type = "number"; simCount.min = "1"; simCount.max = "10000"; simCount.step = "10";
  simCount.value = "100"; simCount.className = "wb-graph-number"; simCount.title = "실험 횟수"; simCount.setAttribute("aria-label", simCount.title);
  simCountWrap.append(simCountName, simCount);
  simFields.append(simBagWrap, simDraws.wrap, simReplaceWrap, simCountWrap);
  simRow.appendChild(simFields);
  const simLawRow = document.createElement("div"); simLawRow.className = "wb-button-row";
  simLawRow.appendChild(mkBtn("누적 그래프(큰 수의 법칙)", "방금 한 실험을 다시 굴리며 누적 상대도수를 그려 큰 수의 법칙을 보여 주기", "wb-formula-save wb-sim-law", () => insertRunningRatio()));
  simRow.appendChild(simLawRow);
  // 위에서 아래로 한 줄기: 무엇을 그릴지 → 무엇으로 → 곁들이 도구 → 실험으로 자료 만들기 → 결과.
  chartBuilder.append(chartTypeSection, chartTitle, chartData, chartColorRow, chartExtras, simRow, chartPreview, chartMessage, chartActions);

  // ----- 화학: 주기율표와 반응식 균형 -----
  const chemBuilder = document.createElement("div"); chemBuilder.className = "wb-formula-builder wb-chem-builder"; chemBuilder.hidden = true;
  const chemInput = document.createElement("input"); chemInput.type = "text"; chemInput.className = "wb-graph-input wb-chem-input";
  chemInput.placeholder = "예: CH4 + O2 -> CO2 + H2O"; chemInput.setAttribute("aria-label", "균형을 맞출 화학 반응식");
  const chemResult = document.createElement("p"); chemResult.className = "wb-chem-result"; chemResult.setAttribute("aria-live", "polite");
  const chemMessage = document.createElement("p"); chemMessage.className = "wb-tool-message";
  const chemActions = document.createElement("div"); chemActions.className = "wb-formula-actions";
  const chemSample = mkBtn("예시", "예시 반응식 넣어 보기", "wb-formula-save", () => {
    const samples = ["H2 + O2 -> H2O", "CH4 + O2 -> CO2 + H2O", "Fe + O2 -> Fe2O3", "Ca(OH)2 + HCl -> CaCl2 + H2O", "C3H8 + O2 -> CO2 + H2O"];
    chemInput.value = samples[Math.floor(Math.random() * samples.length)];
    refreshChemistry();
  });
  const chemInsert = mkBtn("반응식 넣기", "균형을 맞춘 반응식을 화이트보드에 넣기", "wb-formula-insert", insertBalancedEquation);
  chemActions.append(chemSample, chemInsert);
  /* 화학량론(몰 계산) — 균형을 맞춘 식에서 한 물질의 양을 알면 나머지가 모두 정해진다.
     반응식이 읽히기 전에는 이 줄을 아예 감춰 둔다. */
  const chemMoleRow = document.createElement("div"); chemMoleRow.className = "wb-graph-range wb-chem-mole"; chemMoleRow.hidden = true;
  chemMoleRow.setAttribute("aria-label", "몰 계산");
  const chemSpeciesWrap = document.createElement("label"); chemSpeciesWrap.className = "wb-graph-field";
  chemSpeciesWrap.append(document.createTextNode("아는 물질"));
  const chemSpecies = document.createElement("select"); chemSpecies.className = "wb-graph-number wb-chem-species";
  chemSpecies.title = "양을 아는 물질"; chemSpecies.setAttribute("aria-label", chemSpecies.title);
  chemSpeciesWrap.appendChild(chemSpecies);
  const chemAmount = makeGearNumber("양", 1, "아는 물질의 양");
  chemAmount.input.min = "0";
  const chemUnit = document.createElement("select"); chemUnit.className = "wb-graph-number wb-chem-unit";
  chemUnit.title = "단위"; chemUnit.setAttribute("aria-label", chemUnit.title);
  for (const unit of ["g", "mol"]){
    const option = document.createElement("option"); option.value = unit; option.textContent = unit; chemUnit.appendChild(option);
  }
  const chemMoleBtn = mkBtn("몰 계산표 넣기", "계수·몰질량·몰수·질량을 표로 넣기", "wb-formula-save wb-chem-mole-insert", insertStoichiometry);
  chemMoleRow.append(chemSpeciesWrap, chemAmount.wrap, chemUnit, chemMoleBtn);
  const chemMoleResult = document.createElement("p"); chemMoleResult.className = "wb-chem-mole-result"; chemMoleResult.setAttribute("aria-live", "polite");
  chemBuilder.append(chemInput, chemResult, chemMoleRow, chemMoleResult, chemMessage, chemActions);
  /* ----- 값을 넣어 만드는 도구(수 모형·과학 계산) -----
     종류 칩을 고르면 그 종류에 필요한 칸만 나타나고, 미리보기·넣기·다시 고치기는 모두 공통이다.
     만든 그룹은 role "education-tool" + toolSpec{kind,values} 라 두 번 눌러 그대로 되살린다. */
  const toolBuilders = [];
  function makeToolBuilder(config){
    const builder = document.createElement("div");
    builder.className = "wb-formula-builder wb-tool-builder " + config.className;
    builder.hidden = true; builder.setAttribute("aria-label", config.title);
    const kinds = document.createElement("div"); kinds.className = "wb-formula-groups wb-tool-kinds";
    const form = document.createElement("div"); form.className = "wb-graph-range wb-tool-form";
    const preview = document.createElement("canvas"); preview.className = "wb-tool-preview";
    preview.setAttribute("aria-label", config.title + " 미리보기");
    const message = document.createElement("p"); message.className = "wb-tool-message";
    const actions = document.createElement("div"); actions.className = "wb-formula-actions";
    let kind = config.tools[0].id, editing = null, formKind = "";
    const inputs = new Map();
    const values = new Map(config.tools.map((tool) => [tool.id, Object.fromEntries(tool.fields.map((field) => [field.key, field.value]))]));
    const currentTool = () => config.tools.find((tool) => tool.id === kind) || config.tools[0];
    const cancel = mkBtn("취소", "편집 취소", "wb-formula-cancel", () => { editing = null; sync(); });
    cancel.hidden = true;
    const insert = mkBtn("넣기", "만든 것을 화이트보드에 넣기", "wb-formula-insert", () => submit());
    actions.append(cancel, insert);
    builder.append(kinds, form, preview, message, actions);

    function renderKinds(){
      kinds.textContent = "";
      for (const tool of config.tools){
        const chip = mkBtn(tool.label, tool.title || tool.label + " 만들기", "wb-formula-group" + (tool.id === kind ? " active" : ""), () => {
          if (kind === tool.id) return;
          kind = tool.id; editing = null; sync();
        });
        chip.dataset.toolKind = tool.id;
        chip.setAttribute("aria-pressed", tool.id === kind ? "true" : "false");
        kinds.appendChild(chip);
      }
    }
    // 칸은 종류가 바뀔 때만 다시 만든다(입력 중에 다시 만들면 초점과 커서가 끊긴다).
    function renderForm(){
      const tool = currentTool();
      if (formKind === tool.id) return;
      formKind = tool.id; form.textContent = ""; inputs.clear();
      const current = values.get(tool.id);
      for (const field of tool.fields){
        const wrap = document.createElement("label"); wrap.className = "wb-graph-field";
        wrap.append(document.createTextNode(field.label));
        let input;
        if (field.type === "select"){
          input = document.createElement("select"); input.className = "wb-graph-number";
          for (const [id, text] of field.options){
            const option = document.createElement("option"); option.value = id; option.textContent = text; input.appendChild(option);
          }
        } else {
          input = document.createElement("input");
          input.type = field.type === "number" ? "number" : "text";
          input.className = field.type === "number" ? "wb-graph-number" : "wb-graph-input";
          if (field.type === "number"){ input.step = field.step || "1"; }
          if (field.min != null) input.min = String(field.min);
          if (field.max != null) input.max = String(field.max);
          if (field.width) input.style.width = field.width + "px";
        }
        input.title = field.title || field.label;
        input.setAttribute("aria-label", input.title);
        input.value = String(current[field.key]);
        input.addEventListener(field.type === "select" ? "change" : "input", () => { current[field.key] = input.value; refresh(); });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); submit(); } e.stopPropagation(); });
        wrap.appendChild(input); form.appendChild(wrap);
        inputs.set(field.key, input);
      }
    }
    function syncFields(){
      const current = values.get(currentTool().id);
      for (const [key, input] of inputs) if (input !== document.activeElement) input.value = String(current[key]);
    }
    const specOf = () => Object.assign({}, values.get(currentTool().id), { color:boardInkColor() });
    function refresh(){
      const tool = currentTool();
      let group;
      try { group = tool.build(specOf()); }
      catch(error){
        preview.hidden = true; insert.disabled = true;
        message.textContent = error && error.message ? error.message : "만들지 못했어요.";
        message.classList.add("is-error"); return;
      }
      preview.hidden = false; drawToolPreview(preview, group);
      message.textContent = tool.hint || "";
      message.classList.remove("is-error"); insert.disabled = false;
    }
    function submit(){
      const tool = currentTool();
      let group;
      try { group = tool.build(specOf()); }
      catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "만들지 못했어요.", 2400); return; }
      const target = editing;
      editing = null;
      if (target && replaceBoardGroup(target, group)){ sync(); return; }
      placeBoardGroup(group); sync();
    }
    function sync(){
      insert.textContent = editing ? "바꾸기" : "넣기";
      cancel.hidden = !editing;
      renderKinds(); renderForm(); syncFields(); refresh();
    }
    renderKinds(); renderForm();                            // 미리보기는 패널을 열 때(sync) 처음 그린다
    const handle = {
      builder, category:config.category, title:config.title, hint:config.hint, sync,
      reset(){ if (editing){ editing = null; sync(); } },
      open(item){
        const spec = item && item.toolSpec;
        const tool = spec && config.tools.find((entry) => entry.id === spec.kind);
        if (!tool) return false;
        kind = tool.id; editing = item;
        Object.assign(values.get(tool.id), spec.values || {});
        eduCategory = config.category;
        toggleEducationPanel(true); sync();
        return true;
      }
    };
    toolBuilders.push(handle);
    return handle;
  }

  // 수 모형 — 분수·자릿값 블록·수직선 뛰어세기·양팔 저울(등식). 만들어 두면 toolBuilders 가 들고 있는다.
  makeToolBuilder({
    category:"number", className:"wb-number-builder", title:"수 모형",
    hint:"값을 바꾸면 미리보기가 바로 따라옵니다. 넣은 뒤에도 두 번 누르면 다시 고칠 수 있어요.",
    tools:[
      { id:"fraction", label:"분수", hint:"3/4, 2/3 처럼 쉼표로 나눠 적으면 나란히 놓고 크기를 견줍니다(전체 3개까지).",
        fields:[
          { key:"shape", label:"모양", type:"select", value:"bar", options:[["bar", "막대"], ["circle", "원"]] },
          { key:"fractions", label:"분수", type:"text", value:"3/4, 2/3", width:150, title:"3/4, 2/3 처럼 적기" }
        ],
        build:(spec) => MNBoardTools.fractionModelGroup(spec) },
      { id:"place-value", label:"자릿값 블록", hint:"천 덩어리·백 판·십 막대·일 칸으로 수를 펼쳐 보여 줍니다(0~9999).",
        fields:[{ key:"value", label:"수", type:"number", value:1347, min:0, max:9999 }],
        build:(spec) => MNBoardTools.placeValueGroup(spec) },
      { id:"number-line", label:"수직선 뛰어세기", hint:"뛰는 크기를 음수로 적으면 거꾸로 뛰어 셉니다.",
        fields:[
          { key:"from", label:"처음", type:"number", value:0 },
          { key:"to", label:"끝", type:"number", value:20 },
          { key:"start", label:"출발", type:"number", value:2 },
          { key:"step", label:"뛰기", type:"number", value:3 },
          { key:"jumps", label:"번", type:"number", value:4, min:0, max:20 }
        ],
        build:(spec) => MNBoardTools.numberLineJumpGroup(spec) },
      { id:"balance", label:"양팔 저울", hint:"x 상자와 1 블록을 접시에 올려 등식을 보여 주고, 풀 수 있으면 답도 적습니다.",
        fields:[
          { key:"leftX", label:"왼쪽 x", type:"number", value:2, min:0, max:8 },
          { key:"leftOne", label:"왼쪽 1", type:"number", value:3, min:0, max:20 },
          { key:"rightX", label:"오른쪽 x", type:"number", value:0, min:0, max:8 },
          { key:"rightOne", label:"오른쪽 1", type:"number", value:11, min:0, max:20 }
        ],
        build:(spec) => MNBoardTools.balanceScaleGroup(spec) }
    ]
  });

  // 과학 계산 — 값을 넣으면 계산해서 그려 주는 도구(렌즈·거울 광선도)
  makeToolBuilder({
    category:"lab", className:"wb-lab-builder", title:"과학 계산",
    hint:"값을 바꾸면 미리보기가 바로 따라옵니다. 넣은 뒤에도 두 번 누르면 다시 고칠 수 있어요.",
    tools:[
      { id:"optics", label:"렌즈·거울 광선도", hint:"1/a + 1/b = 1/f 로 상의 자리를 구해 광선을 긋습니다. 물체가 초점 안쪽이면 허상(점선)이 됩니다.",
        fields:[
          { key:"kind", label:"종류", type:"select", value:"convex-lens", options:[
            ["convex-lens", "볼록렌즈"], ["concave-lens", "오목렌즈"], ["concave-mirror", "오목거울"], ["convex-mirror", "볼록거울"]
          ] },
          { key:"focal", label:"초점거리", type:"number", value:4, min:0.5, step:"0.5", title:"초점거리(cm)" },
          { key:"distance", label:"물체거리", type:"number", value:6, min:0.5, step:"0.5", title:"물체까지의 거리(cm)" },
          { key:"height", label:"물체 크기", type:"number", value:2, min:0.2, step:"0.5", title:"물체의 크기(cm)" }
        ],
        build:(spec) => MNBoardTools.opticsGroup(spec) },
      { id:"punnett", label:"퍼넷 사각형", hint:"Aa × Aa 는 3 : 1, AaBb × AaBb 는 9 : 3 : 3 : 1 — 배우자를 만들어 칸을 채우고 비율까지 셉니다.",
        fields:[
          { key:"parentA", label:"부모 1", type:"text", value:"Aa", width:80, title:"한쪽 부모의 유전자형(Aa·AaBb)" },
          { key:"parentB", label:"부모 2", type:"text", value:"Aa", width:80, title:"다른 쪽 부모의 유전자형(Aa·AaBb)" }
        ],
        build:(spec) => MNBoardTools.punnettGroup(spec) },
      { id:"circuit", label:"회로 계산", hint:"직렬은 전류가 같고 전압이 나뉘며, 병렬은 전압이 같고 전류가 나뉩니다. 저항은 쉼표로 나눠 적어요.",
        fields:[
          { key:"mode", label:"연결", type:"select", value:"series", options:[["series", "직렬"], ["parallel", "병렬"]] },
          { key:"resistors", label:"저항(Ω)", type:"text", value:"6, 3, 2", width:110, title:"저항 값 — 6, 3, 2 처럼" },
          { key:"voltage", label:"전압(V)", type:"number", value:12, min:0.1, step:"0.5" }
        ],
        build:(spec) => MNBoardTools.circuitGroup(spec) }
    ]
  });

  const formulaGroupBar = document.createElement("div"); formulaGroupBar.className = "wb-formula-groups"; formulaGroupBar.hidden = true; formulaGroupBar.setAttribute("aria-label", "수식 분야");
  const eduSubgroupBar = document.createElement("div"); eduSubgroupBar.className = "wb-formula-groups wb-edu-subgroups"; eduSubgroupBar.hidden = true; eduSubgroupBar.setAttribute("aria-label", "도구 분야");
  const eduGrid = document.createElement("div"); eduGrid.className = "wb-edu-grid";
  const eduHint = document.createElement("p"); eduHint.className = "wb-edu-hint";
  eduHint.textContent = "클릭하면 가운데에, 끌어 놓으면 원하는 위치에 들어갑니다.";
  eduPanel.append(eduHead, eduSearch, eduTabs, formulaBuilder, graphBuilder, chartBuilder, chemBuilder,
    ...toolBuilders.map((tool) => tool.builder), formulaGroupBar, eduSubgroupBar, eduGrid, eduHint); stage.appendChild(eduPanel);
  // 메모창처럼 제목줄을 끌어 옮기고, 네 변·네 모서리로 크기를 조절한다(위치·크기는 저장된다).
  // 무대 밖으로도 나갈 수 있게 화면 좌표로 띄우되, 앱 헤더는 이 창보다 위 층이라 가려 버리므로
  // 움직일 수 있는 범위는 작업 영역(#content)으로 잡는다.
  const eduFloat = typeof makeFloatingPanel === "function" ? makeFloatingPanel(eduPanel, eduHead, {
    storageKey: "classdock-whiteboard:edu-rect:v1",
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
    ["symbol", "기호"], ["formula", "수식"], ["geometry", "도형"], ["science", "과학"],
    ["graph", "그래프"], ["chart", "차트"], ["chemistry", "화학"], ["number", "수 모형"], ["lab", "과학 계산"]
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
  let editingPlotItem = null, editingChartItem = null, editingTableItem = null, chartType = "bar", graphParamKey = "";
  const graphParamValues = {};
  const GRAPH_PRESETS = [
    { label:"일차함수", curves:["a x + 1"], params:{ a:2 } },
    { label:"이차함수", curves:["x^2 - 3"] },
    { label:"꼭짓점 이차함수", curves:["a (x - 1)^2 + 2"], params:{ a:1 } },
    { label:"삼차함수", curves:["x^3 - 3x"] },
    { label:"절댓값", curves:["abs(x)"] },
    { label:"반비례", curves:["1/x"] },
    { label:"제곱근", curves:["sqrt(x)"], xMin:-2, xMax:12 },
    { label:"지수함수", curves:["2^x"], xMin:-4, xMax:6 },
    { label:"로그함수", curves:["log(x)"], xMin:-1, xMax:12 },
    { label:"사인·코사인", curves:["sin(x)", "cos(x)"], xMin:-6.5, xMax:6.5 },
    { label:"진폭 바꾸기", curves:["a sin(x)"], xMin:-6.5, xMax:6.5, params:{ a:2 } },
    { label:"원(위·아래)", curves:["sqrt(9 - x^2)", "-sqrt(9 - x^2)"], xMin:-4, xMax:4 },
    // 해석 도구는 예시로 한 번 눌러 보면 무엇을 하는 도구인지 바로 보인다.
    { label:"두 그래프의 교점", curves:["x^2 - 2", "x"], xMin:-4, xMax:4, cross:true },
    { label:"접선과 기울기", curves:["x^2"], xMin:-4, xMax:4, tangent:1.5 },
    { label:"구간 넓이(정적분)", curves:["x^2"], xMin:-1, xMax:3, area:[0, 2] },
    { label:"리만 직사각형", curves:["x^2"], xMin:-1, xMax:3, area:[0, 2], bars:8 },
    { label:"부등식 영역", curves:["x + 1"], xMin:-5, xMax:5, relations:["gt"] },
    { label:"도함수 겹쳐 보기", curves:["x^3 - 3x"], xMin:-3, xMax:3, derivative:true },
    // 매개변수·극좌표 — y = f(x) 로는 그릴 수 없는 곡선들(원·리사주·사이클로이드·장미·심장형).
    { label:"원(매개변수)", mode:"parametric", pairs:[["3 cos(t)", "3 sin(t)"]], tMin:0, tMax:6.28 },
    { label:"타원(매개변수)", mode:"parametric", pairs:[["4 cos(t)", "2 sin(t)"]], tMin:0, tMax:6.28 },
    { label:"리사주 곡선", mode:"parametric", pairs:[["sin(3t)", "sin(4t)"]], tMin:0, tMax:6.28 },
    { label:"사이클로이드", mode:"parametric", pairs:[["t - sin(t)", "1 - cos(t)"]], tMin:0, tMax:12.57 },
    { label:"장미 곡선", mode:"polar", curves:["4 cos(2θ)"], tMin:0, tMax:6.28 },
    { label:"심장형(카디오이드)", mode:"polar", curves:["2 + 2cos(θ)"], tMin:0, tMax:6.28 },
    { label:"나선(아르키메데스)", mode:"polar", curves:["θ"], tMin:0, tMax:18.85 },
    // 음함수 — 한 x 에 y 가 둘인 이차곡선. y = f(x) 로 쪼개 적지 않아도 된다.
    { label:"원(음함수)", mode:"implicit", curves:["x^2 + y^2 = 9"], xMin:-6, xMax:6 },
    { label:"타원", mode:"implicit", curves:["x^2/9 + y^2/4 = 1"], xMin:-5, xMax:5 },
    { label:"쌍곡선", mode:"implicit", curves:["x^2 - y^2 = 4"], xMin:-8, xMax:8 },
    { label:"렘니스케이트", mode:"implicit", curves:["(x^2+y^2)^2 = 8(x^2-y^2)"], xMin:-4, xMax:4 },
    // 조각적 정의 함수 — if(조건, 참일 때, 거짓일 때) 로 구간마다 다른 식을 쓴다.
    { label:"조각적 정의 함수", curves:["if(x < 0, -x, x^2)"], xMin:-4, xMax:4 },
    { label:"계단 함수", curves:["if(x < 1, 1, if(x < 2, 2, 3))"], xMin:-1, xMax:4 },
    // 수열 — 이어진 곡선이 아니라 항마다 찍은 점.
    { label:"등차수열", mode:"sequence", curves:["2n + 1"], tMin:1, tMax:10 },
    { label:"등비수열", mode:"sequence", curves:["2^n"], tMin:1, tMax:8 },
    { label:"조화수열", mode:"sequence", curves:["1/n"], tMin:1, tMax:12 }
  ];
  const CHART_PRESETS = [
    { label:"막대그래프", type:"bar", title:"좋아하는 과목", data:"국어, 7\n수학, 12\n영어, 5\n과학, 9" },
    { label:"꺾은선그래프", type:"line", title:"월별 기온(℃)", data:"3월, 8\n4월, 14\n5월, 19\n6월, 23\n7월, 26" },
    { label:"원그래프", type:"pie", title:"쉬는 시간에 하는 일", data:"독서, 5\n운동, 9\n이야기, 12\n기타, 4" },
    { label:"히스토그램", type:"histogram", title:"수학 점수", data:"62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77" },
    { label:"산점도", type:"scatter", title:"공부 시간과 점수", data:"1, 60\n2, 68\n3, 74\n4, 79\n5, 88" },
    { label:"반별 비교(묶음 막대)", type:"bar", title:"반별 좋아하는 과목", data:"과목, 1반, 2반\n국어, 7, 9\n수학, 12, 8\n영어, 5, 11\n과학, 9, 6" },
    { label:"두 해 비교(꺾은선)", type:"line", title:"월별 기온(℃)", data:"월, 작년, 올해\n3월, 8, 9\n4월, 14, 16\n5월, 19, 21\n6월, 23, 26\n7월, 26, 29" },
    { label:"상자그림", type:"box", title:"수학 점수", data:"62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77" },
    { label:"두 반 비교(상자그림)", type:"box", title:"반별 수학 점수", data:"번호, 1반, 2반\n1, 62, 71\n2, 75, 68\n3, 88, 79\n4, 91, 84\n5, 70, 95\n6, 83, 77" },
    { label:"추세선이 있는 산점도", type:"scatter", title:"공부 시간과 점수", data:"1, 60\n2, 68\n3, 74\n4, 79\n5, 88", trend:true },
    { label:"띠그래프", type:"band", title:"좋아하는 과목", data:"국어, 7\n수학, 12\n영어, 5\n과학, 9" },
    { label:"해마다 비교(띠그래프)", type:"band", title:"쉬는 시간에 하는 일", data:"활동, 작년, 올해\n독서, 5, 8\n운동, 9, 7\n이야기, 12, 10\n기타, 4, 5" },
    { label:"누적 막대", type:"stacked", title:"반별 좋아하는 과목", data:"과목, 1반, 2반\n국어, 7, 9\n수학, 12, 8\n영어, 5, 11\n과학, 9, 6" },
    { label:"도수분포다각형", type:"freqpoly", title:"수학 점수", data:"62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77", bins:5 },
    { label:"누적도수분포곡선", type:"freqpoly", title:"수학 점수", data:"62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77", bins:5, cumulative:true },
    // 가로 막대는 항목 이름이 길 때 — 세로 막대에서는 이름이 서로 겹친다.
    { label:"가로 막대그래프", type:"barh", title:"우리 반이 좋아하는 활동", data:"책 읽기, 7\n운동하기, 12\n이야기 나누기, 5\n그림 그리기, 9" },
    { label:"반별 비교(가로 막대)", type:"barh", title:"반별 좋아하는 활동", data:"활동, 1반, 2반\n책 읽기, 7, 9\n운동하기, 12, 8\n이야기 나누기, 5, 11" },
    { label:"버블 차트", type:"bubble", title:"공부 시간·점수·모둠 인원", data:"1, 60, 5\n2, 68, 12\n3, 74, 30\n4, 79, 18\n5, 88, 40" }
  ];
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
  /* 미리보기는 실제로 보드에 들어갈 벡터 묶음을 그대로 축소해 그린다(넣고 나서 달라 보이는 일이 없다).
     세로로 긴 그림(원 분수 모형·회로 등)을 비율 그대로 키우면 미리보기가 창을 밀어내
     아래쪽 ‘넣기’ 단추가 화면 밖으로 나간다 — 높이 한도 안에 맞춰 줄이고 가운데에 둔다. */
  const TOOL_PREVIEW_MAX_HEIGHT = 180;
  function drawToolPreview(canvasEl, group){
    const cssWidth = canvasEl.clientWidth || 320;
    // 창에 남은 자리를 재어 그 안에서만 키운다 — 칸이 많은 도구일수록 미리보기가 알아서 작아진다.
    let limit = TOOL_PREVIEW_MAX_HEIGHT;
    const box = canvasEl.closest(".wb-formula-builder");
    const panel = canvasEl.closest(".wb-edu-panel");
    if (box && panel && panel.clientHeight > 0){
      let used = 0;
      for (const child of panel.children){
        if (child === box || child.hidden || child.offsetHeight === 0) continue;
        // 카탈로그(예시 카드) 칸은 줄어들 수 있으니 최소 높이만 자리로 잡는다.
        used += (child.classList.contains("wb-edu-grid") ? Math.min(child.offsetHeight, 96) : child.offsetHeight) + 9;
      }
      const others = box.scrollHeight - canvasEl.offsetHeight;   // 만들기 화면에서 미리보기를 뺀 높이
      limit = Math.min(limit, panel.clientHeight - used - others - 26);
    }
    const cssHeight = Math.max(76, Math.round(Math.min(cssWidth * group.h / group.w, limit)));
    const ratio = window.devicePixelRatio || 1;
    canvasEl.style.height = cssHeight + "px";
    canvasEl.width = Math.round(cssWidth * ratio); canvasEl.height = Math.round(cssHeight * ratio);
    const preview = canvasEl.getContext("2d");
    preview.setTransform(ratio, 0, 0, ratio, 0, 0);
    preview.clearRect(0, 0, cssWidth, cssHeight);
    const scale = Math.min(cssWidth / group.w, cssHeight / group.h);
    const offsetX = (cssWidth - group.w * scale) / 2, offsetY = (cssHeight - group.h * scale) / 2;
    preview.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * offsetX, ratio * offsetY);
    MNBoardRenderer.drawItems(preview, group.items, { bg:wb.bg });
    preview.setTransform(ratio, 0, 0, ratio, 0, 0);
    // 그리기와 같은 순서: 배경은 맨 나중에 밑으로. 미리보기엔 무늬 없이 색만 깐다(작은 그림에선 결이 방해된다).
    MNBoardRenderer.paintBackground(preview, { x:0, y:0, w:cssWidth, h:cssHeight }, { bg:wb.bg });
  }
  const boardInkColor = () => (/^#[0-9a-f]{6}$/i.test(String(wb.color)) ? String(wb.color).toLowerCase() : "#111111");
  function readGraphSpec(size){
    const manualY = !graphAuto.checked;
    const filled = graphInputs.map((input, index) => index).filter((index) => graphInputs[index].value.trim());
    // 접선·넓이·도함수는 "몇 번 칸"이 아니라 "실제로 그린 몇 번째 곡선"에 붙는다(빈 칸을 건너뛰기 때문이다).
    const target = Math.max(0, filled.indexOf(Number(graphTarget.value)));
    // 매개변수만 식이 둘인 칸을 쓰고, 부등호는 y = f(x) 에서만 뜻이 통한다.
    const curves = graphMode === "parametric"
      ? graphPairInputs.map((pair, index) => ({
        x:pair.x.value.trim(), y:pair.y.value.trim(), color:MNBoardTools.CURVE_COLORS[index]
      })).filter((curve) => curve.x || curve.y)
      : graphInputs.map((input, index) => ({
        source:input.value.trim(), color:MNBoardTools.CURVE_COLORS[index],
        relation:graphMode === "function" ? graphRelations[index].value : "eq"
      })).filter((curve) => curve.source);
    return {
      mode:graphMode, curves,
      xMin:Number(graphXMin.input.value), xMax:Number(graphXMax.input.value),
      yMin:manualY ? Number(graphYMin.input.value) : undefined,
      yMax:manualY ? Number(graphYMax.input.value) : undefined,
      tMin:Number(graphTMin.input.value), tMax:Number(graphTMax.input.value),
      params:Object.assign({}, graphParamValues),
      showGrid:graphGrid.checked, showSliders:graphSlider.checked, axisColor:boardInkColor(),
      showIntersections:graphCross.box.checked,
      showDerivative:graphDerivative.box.checked, derivativeCurve:target,
      tangentX:graphTangent.box.checked ? Number(graphTangentX.input.value) : null, tangentCurve:target,
      areaFrom:graphArea.box.checked ? Number(graphAreaFrom.input.value) : null,
      areaTo:graphArea.box.checked ? Number(graphAreaTo.input.value) : null,
      areaBars:Number(graphAreaBars.input.value) || 0, areaCurve:target,
      width:(size && size.width) || 560, height:(size && size.height) || 400
    };
  }
  // 켜 둔 것만 값 칸을 살려 둔다(꺼 두면 흐릿하게). 식이 하나뿐이면 대상 고르기는 숨긴다.
  function syncGraphAnalysisFields(){
    for (const [field, on] of [[graphTangentX, graphTangent.box.checked], [graphAreaFrom, graphArea.box.checked],
      [graphAreaTo, graphArea.box.checked], [graphAreaBars, graphArea.box.checked]]){
      field.wrap.classList.toggle("is-off", !on);
      field.input.disabled = !on;
    }
    const filled = graphInputs.filter((input) => input.value.trim()).length;
    graphTargetWrap.hidden = filled < 2 || !(graphTangent.box.checked || graphArea.box.checked);
    graphCross.wrap.classList.toggle("is-off", filled < 2);
  }
  /* 그리는 방법에 따라 쓸 칸만 남긴다 — 함수는 x 범위와 해석 도구를, 매개변수·극좌표는
     t(θ) 범위를 쓴다(보이는 창은 곡선이 스스로 정하므로 x·y 범위 칸이 없다). */
  const GRAPH_EMPTY_HINTS = {
    function:"식을 입력하면 미리보기가 나타나요. 예) x^2 - 3x + 1, sin(x), 2^x",
    parametric:"x(t)와 y(t)를 함께 입력하면 미리보기가 나타나요. 예) 3 cos(t) 와 3 sin(t)",
    polar:"θ 로 쓴 식을 입력하면 미리보기가 나타나요. 예) 4 cos(2θ), 2 + 2cos(θ)",
    implicit:"등호가 있는 식을 입력하면 그 자리를 찾아 그려요. 예) x^2 + y^2 = 9, x^2 - y^2 = 4",
    sequence:"n 으로 쓴 식을 입력하면 항마다 점을 찍어요. 예) 2n + 1, 2^n, 1/n"
  };
  const GRAPH_ROW_CAPTIONS = { polar:"r =", sequence:"aₙ =" };
  const GRAPH_PLACEHOLDERS = {
    function:"예: x^2 - 3x + 1", polar:"예: 2 + 2cos(θ)",
    implicit:"예: x^2 + y^2 = 9", sequence:"예: 2n + 1"
  };
  function syncGraphMode(){
    const curved = graphMode !== "function", parametric = graphMode === "parametric";
    // 보기 창을 곡선이 스스로 잡는 방법(t·θ 를 도는 것)과, 사람이 x 범위를 정하는 방법을 가른다.
    const fitted = parametric || graphMode === "polar";
    const usesT = fitted || graphMode === "sequence";
    const usesX = graphMode === "function" || graphMode === "implicit";
    for (const chip of graphModeChips){
      const active = chip.dataset.graphMode === graphMode;
      chip.classList.toggle("active", active); chip.setAttribute("aria-pressed", String(active));
    }
    graphRows.hidden = parametric; graphPairRows.hidden = !parametric;
    for (const relation of graphRelations) relation.hidden = curved;
    for (const caption of graphRowCaptions){
      caption.textContent = GRAPH_ROW_CAPTIONS[graphMode] || "";
      caption.hidden = !GRAPH_ROW_CAPTIONS[graphMode];
    }
    graphInputs[0].placeholder = GRAPH_PLACEHOLDERS[graphMode] || GRAPH_PLACEHOLDERS.function;
    for (const field of [graphXMin, graphXMax]) field.wrap.hidden = !usesX;
    for (const field of [graphYMin, graphYMax]) field.wrap.hidden = fitted;
    graphAutoWrap.hidden = fitted;
    // 같은 칸을 t(θ)와 항의 번호 n 이 나눠 쓴다 — 이름표만 바꿔 단다.
    graphTMin.wrap.hidden = !usesT; graphTMax.wrap.hidden = !usesT;
    graphTMin.caption.textContent = graphMode === "sequence" ? "n" : "t";
    // 교점·접선·넓이·도함수와 값의 표는 모두 y = f(x) 를 전제로 한다.
    graphAnalysis.hidden = curved; graphTableRow.hidden = curved;
  }
  // 식에 훑는 변수 말고 다른 문자가 있으면 그 문자를 슬라이더로 만들어 "a를 키우면?"을 바로 보여 준다.
  function refreshGraphParams(){
    const names = [];
    const sources = [];
    if (graphMode === "parametric") for (const pair of graphPairInputs) sources.push(pair.x.value.trim(), pair.y.value.trim());
    else for (const input of graphInputs) sources.push(input.value.trim());
    // 훑는 변수는 슬라이더가 아니다. 극좌표는 θ 대신 t 라고 쳐도 받으므로 둘 다 뺀다.
    const reserved = graphMode === "parametric" ? ["t"] : graphMode === "polar" ? ["theta", "t"]
      : graphMode === "implicit" ? ["x", "y"] : graphMode === "sequence" ? ["n"] : ["x"];
    for (const source of sources){
      if (!source) continue;
      try {
        for (const name of MNBoardTools.parseExpression(source).variables){
          if (!reserved.includes(name) && !names.includes(name)) names.push(name);
        }
      } catch(_){}
    }
    const wanted = names.slice(0, 3), key = wanted.join(",");
    if (key === graphParamKey) return;
    graphParamKey = key;
    graphParams.textContent = ""; graphParams.hidden = !wanted.length;
    for (const name of wanted){
      if (!Number.isFinite(graphParamValues[name])) graphParamValues[name] = 1;
      const row = document.createElement("label"); row.className = "wb-graph-param";
      const caption = document.createElement("span"); caption.className = "wb-graph-param-name"; caption.textContent = name;
      const range = document.createElement("input"); range.type = "range"; range.min = "-10"; range.max = "10"; range.step = "0.1";
      range.value = String(graphParamValues[name]); range.setAttribute("aria-label", `${name} 값`);
      const output = document.createElement("output"); output.textContent = graphParamValues[name].toFixed(1);
      range.addEventListener("input", () => {
        graphParamValues[name] = Number(range.value);
        output.textContent = graphParamValues[name].toFixed(1);
        refreshGraphPreview();
      });
      row.append(caption, range, output); graphParams.appendChild(row);
    }
  }
  function refreshGraphPreview(){
    syncGraphMode(); refreshGraphParams(); syncGraphAnalysisFields();
    const spec = readGraphSpec({ width:560, height:400 });
    if (!spec.curves.length){
      graphMessage.textContent = GRAPH_EMPTY_HINTS[graphMode] || GRAPH_EMPTY_HINTS.function;
      graphMessage.classList.remove("is-error");
      graphPreview.hidden = true; graphInsert.disabled = true; return;
    }
    try {
      const group = MNBoardTools.plotGroup(spec);
      graphPreview.hidden = false; drawToolPreview(graphPreview, group);
      graphMessage.textContent = group.sliders && group.sliders.length
        ? "보드에 넣은 뒤에도 그래프 아래 손잡이를 끌면 그 자리에서 곡선이 다시 그려집니다."
        : "×· ÷ 없이 2x, sin x 처럼 써도 되고 sqrt·abs·log·ln 과 if(x < 0, -x, x) 같은 조각적 정의도 됩니다.";
      graphMessage.classList.remove("is-error"); graphInsert.disabled = false;
    } catch(error){
      graphPreview.hidden = true; graphInsert.disabled = true;
      graphMessage.textContent = error && error.message ? error.message : "그래프를 그리지 못했어요.";
      graphMessage.classList.add("is-error");
    }
  }
  function clearGraphInputs(){
    graphInputs.forEach((input) => { input.value = ""; });
    graphPairInputs.forEach((pair) => { pair.x.value = ""; pair.y.value = ""; });
    graphRelations.forEach((relation) => { relation.value = "eq"; });
    graphCross.box.checked = false; graphTangent.box.checked = false; graphArea.box.checked = false;
    graphDerivative.box.checked = false;
    graphParamKey = "__reset__"; refreshGraphPreview();
    (graphMode === "parametric" ? graphPairInputs[0].x : graphInputs[0]).focus({ preventScroll:true });
  }
  function resetGraphEditor(){
    editingPlotItem = null; graphInsert.textContent = "그래프 넣기"; graphCancel.hidden = true; refreshGraphPreview();
  }
  function applyGraphPreset(preset){
    // 그리는 방법이 정해진 예시는 방법부터 바꿔 놓는다 — 채워 넣을 칸 자체가 다르다.
    const wanted = GRAPH_MODES.some(([id]) => id === preset.mode) ? preset.mode : "function";
    if (wanted !== graphMode){ graphMode = wanted; syncGraphMode(); }
    if (Number.isFinite(preset.tMin)) graphTMin.input.value = String(preset.tMin);
    if (Number.isFinite(preset.tMax)) graphTMax.input.value = String(preset.tMax);
    if (graphMode === "parametric"){
      // 매개변수 예시는 x(t)·y(t) 가 한 짝이라 커서 자리와 상관없이 첫 줄부터 채운다.
      (Array.isArray(preset.pairs) ? preset.pairs : []).forEach((pair, index) => {
        const row = graphPairInputs[index];
        if (row){ row.x.value = String(pair[0] || ""); row.y.value = String(pair[1] || ""); }
      });
      if (preset.params) Object.assign(graphParamValues, preset.params);
      graphParamKey = "__reset__"; refreshGraphPreview();
      graphPairInputs[0].x.focus({ preventScroll:true });
      return;
    }
    if (preset.derivative != null) graphDerivative.box.checked = !!preset.derivative;
    // 커서가 있던 칸부터 채운다. 나머지 칸은 건드리지 않아야 식 여러 개를 골라 담을 수 있다.
    const curves = Array.isArray(preset.curves) ? preset.curves : [];
    const start = Math.max(0, Math.min(graphFocusIndex, graphInputs.length - curves.length));
    curves.forEach((source, offset) => {
      const input = graphInputs[start + offset];
      if (input) input.value = source;
    });
    const landed = graphInputs[Math.min(start + Math.max(1, curves.length) - 1, graphInputs.length - 1)];
    graphFocusIndex = graphInputs.indexOf(landed);
    landed.focus({ preventScroll:true });
    try { landed.setSelectionRange(landed.value.length, landed.value.length); } catch(_){}
    if (Number.isFinite(preset.xMin)) graphXMin.input.value = String(preset.xMin);
    if (Number.isFinite(preset.xMax)) graphXMax.input.value = String(preset.xMax);
    if (preset.params) Object.assign(graphParamValues, preset.params);
    // 해석 예시(교점·접선·넓이·부등식)는 켜 둔 것만 바꾸고 나머지는 쓰던 대로 둔다.
    (Array.isArray(preset.relations) ? preset.relations : []).forEach((relation, offset) => {
      const select = graphRelations[start + offset];
      if (select && GRAPH_RELATIONS.some(([id]) => id === relation)) select.value = relation;
    });
    if (preset.cross != null) graphCross.box.checked = !!preset.cross;
    if (Number.isFinite(preset.tangent)){ graphTangent.box.checked = true; graphTangentX.input.value = String(preset.tangent); }
    if (Array.isArray(preset.area)){
      graphArea.box.checked = true;
      graphAreaFrom.input.value = String(preset.area[0]); graphAreaTo.input.value = String(preset.area[1]);
      graphAreaBars.input.value = String(preset.bars || 0);
    }
    if (preset.cross || preset.derivative || Number.isFinite(preset.tangent) || Array.isArray(preset.area) || Array.isArray(preset.relations)) graphTarget.value = String(start);
    graphParamKey = "__reset__"; refreshGraphPreview();
  }
  function submitGraph(){
    const target = editingPlotItem;
    const boardWidth = Math.max(320, Math.min(W ? W * .8 : 640, 680));
    const spec = readGraphSpec({ width:Math.round(boardWidth), height:Math.round(boardWidth * .72) });
    if (!spec.curves.length){ if (typeof toast === "function") toast("그래프로 그릴 식을 입력하세요.", 1800); graphInputs[0].focus(); return; }
    let group;
    try { group = MNBoardTools.plotGroup(spec); }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "그래프를 그리지 못했어요.", 2400); return; }
    if (target && replaceBoardGroup(target, group)){ resetGraphEditor(); return; }
    placeBoardGroup(group); resetGraphEditor();
  }
  // ----- 값의 표 넣기/고치기 -----
  function readValueTableSpec(){
    const spec = readGraphSpec({ width:560, height:400 });
    return {
      curves:spec.curves, params:spec.params, variable:"x", color:boardInkColor(), title:"",
      from:Number(graphTableFrom.input.value), to:Number(graphTableTo.input.value), step:Number(graphTableStep.input.value)
    };
  }
  function resetTableEditor(){
    editingTableItem = null;
    graphTableInsert.textContent = "값의 표 넣기"; graphTableCancel.hidden = true;
    chartStatsBtn.textContent = "요약 카드"; chartFreqBtn.textContent = "도수분포표";
    chemMoleBtn.textContent = "몰 계산표 넣기";
  }
  // 표는 종류(kind)마다 만드는 곳이 다르다 — 같은 종류를 고쳐 넣는 중이면 그 자리에 갈아 끼운다.
  function placeTableGroup(group, kind){
    const target = editingTableItem && editingTableItem.tableSpec && editingTableItem.tableSpec.kind === kind ? editingTableItem : null;
    if (target && replaceBoardGroup(target, group)){ resetTableEditor(); return; }
    placeBoardGroup(group); resetTableEditor();
  }
  function submitValueTable(){
    let group;
    try { group = MNBoardTools.valueTableGroup(readValueTableSpec()); }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "표를 만들지 못했어요.", 2400); return; }
    placeTableGroup(group, "values");
  }
  function insertStatsCard(){
    let group;
    try { group = MNBoardTools.statsSummaryGroup({ data:chartData.value, title:chartTitle.value.trim(), color:boardInkColor() }); }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "요약 카드를 만들지 못했어요.", 2400); chartData.focus(); return; }
    placeTableGroup(group, "stats");
  }
  function insertFrequencyTable(){
    let group;
    try {
      group = MNBoardTools.frequencyTableGroup({
        data:chartData.value, title:chartTitle.value.trim(), bins:Number(chartBins.input.value) || null, color:boardInkColor()
      });
    }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "도수분포표를 만들지 못했어요.", 2400); chartData.focus(); return; }
    placeTableGroup(group, "frequency");
  }
  openTableEditor = (item) => {
    const spec = item && item.tableSpec ? item.tableSpec : null;
    if (spec && (spec.kind === "stats" || spec.kind === "frequency")){
      // 자료로 만든 표는 차트 탭에서 같은 자료를 고쳐 다시 만든다.
      resetChartEditor();
      editingTableItem = item; eduCategory = "chart";
      chartData.value = String(spec.data || ""); chartTitle.value = String(spec.title || "");
      if (spec.kind === "frequency") chartBins.input.value = String(Number(spec.bins) || 0);
      if (spec.kind === "stats") chartStatsBtn.textContent = "요약 카드 바꾸기"; else chartFreqBtn.textContent = "도수분포표 바꾸기";
      toggleEducationPanel(true); refreshChartPreview();
      return;
    }
    if (spec && spec.kind === "stoichiometry"){
      editingTableItem = item; eduCategory = "chemistry";
      chemInput.value = String(spec.equation || "");
      refreshChemistry();                                 // 물질 목록을 먼저 채워야 고른 물질이 되살아난다
      chemSpecies.value = String(Number(spec.species) || 0);
      chemAmount.input.value = String(spec.amount); chemUnit.value = spec.unit === "mol" ? "mol" : "g";
      refreshMolePreview();
      chemMoleBtn.textContent = "몰 계산표 바꾸기";
      toggleEducationPanel(true);
      return;
    }
    if (!spec || spec.kind !== "values"){ if (typeof toast === "function") toast("이 표는 만든 재료가 없어 고칠 수 없어요. 지우고 다시 넣어 주세요.", 2600); return; }
    resetGraphEditor();                                  // 표를 고치는 중엔 그래프 편집 상태를 함께 들고 있지 않는다
    editingTableItem = item; eduCategory = "graph";
    const curves = Array.isArray(spec.curves) ? spec.curves : [];
    graphInputs.forEach((input, index) => { input.value = curves[index] ? String(curves[index].source || "") : ""; });
    graphRelations.forEach((relation, index) => {
      const wanted = curves[index] ? String(curves[index].relation || "eq") : "eq";
      relation.value = GRAPH_RELATIONS.some(([id]) => id === wanted) ? wanted : "eq";
    });
    graphTableFrom.input.value = String(spec.from); graphTableTo.input.value = String(spec.to); graphTableStep.input.value = String(spec.step);
    if (spec.params) Object.assign(graphParamValues, spec.params);
    graphParamKey = "__reset__";
    graphTableInsert.textContent = "표 바꾸기"; graphTableCancel.hidden = false;
    toggleEducationPanel(true);
  };

  openPlotEditor = (item) => {
    const spec = item && item.plotSpec ? item.plotSpec : null;
    resetTableEditor();
    editingPlotItem = item; eduCategory = "graph";
    if (spec){
      const curves = Array.isArray(spec.curves) ? spec.curves : [];
      graphMode = GRAPH_MODES.some(([id]) => id === spec.mode) ? spec.mode : "function";
      if (graphMode === "parametric"){
        graphPairInputs.forEach((pair, index) => {
          pair.x.value = curves[index] ? String(curves[index].x || "") : "";
          pair.y.value = curves[index] ? String(curves[index].y || "") : "";
        });
      } else {
        graphInputs.forEach((input, index) => { input.value = curves[index] ? String(curves[index].source || "") : ""; });
        graphRelations.forEach((relation, index) => {
          const wanted = curves[index] ? String(curves[index].relation || "eq") : "eq";
          relation.value = GRAPH_RELATIONS.some(([id]) => id === wanted) ? wanted : "eq";
        });
      }
      if (Number.isFinite(Number(spec.tMin))) graphTMin.input.value = String(spec.tMin);
      if (Number.isFinite(Number(spec.tMax))) graphTMax.input.value = String(spec.tMax);
      graphDerivative.box.checked = !!spec.showDerivative;
      graphCross.box.checked = !!spec.showIntersections;
      graphTangent.box.checked = Number.isFinite(Number(spec.tangentX)) && spec.tangentX !== null;
      if (graphTangent.box.checked) graphTangentX.input.value = String(spec.tangentX);
      graphArea.box.checked = spec.areaFrom !== null && spec.areaTo !== null
        && Number.isFinite(Number(spec.areaFrom)) && Number.isFinite(Number(spec.areaTo));
      if (graphArea.box.checked){
        graphAreaFrom.input.value = String(spec.areaFrom); graphAreaTo.input.value = String(spec.areaTo);
        graphAreaBars.input.value = String(Number(spec.areaBars) || 0);
      }
      // 저장된 대상은 "그린 곡선의 순서"인데, 여기서는 그 순서대로 빈칸 없이 다시 채우므로 그대로 쓴다.
      const target = Number(graphTangent.box.checked ? spec.tangentCurve
        : graphArea.box.checked ? spec.areaCurve : spec.derivativeCurve) || 0;
      graphTarget.value = String(Math.min(graphInputs.length - 1, Math.max(0, target)));
      if (Number.isFinite(Number(spec.xMin))) graphXMin.input.value = String(spec.xMin);
      if (Number.isFinite(Number(spec.xMax))) graphXMax.input.value = String(spec.xMax);
      const manualY = whiteboardGraphUsesManualY(spec);
      graphAuto.checked = !manualY;
      if (manualY){ graphYMin.input.value = String(spec.yMin); graphYMax.input.value = String(spec.yMax); }
      syncGraphAutoFields(); syncGraphMode();
      graphGrid.checked = spec.showGrid !== false;
      graphSlider.checked = spec.showSliders !== false;
      if (spec.params) Object.assign(graphParamValues, spec.params);
      graphParamKey = "__reset__";
    }
    graphInsert.textContent = "그래프 바꾸기"; graphCancel.hidden = false;
    toggleEducationPanel(true);
  };

  /* 색을 몇 개 고르게 할지는 차트 종류마다 다르다. chartGroup 이 palette 를 쓰는 순서와 똑같이 맞춘다.
     묶음이 여럿이면 묶음마다, 막대·원그래프 한 묶음이면 항목마다, 꺾은선·산점도·히스토그램은 하나. */
  const CHART_COLOR_LIMIT = 12;
  function chartColorSlots(){
    let table = null;
    try { table = MNBoardTools.parseChartTable(chartData.value); } catch(_){ return []; }
    const rows = table.rows;
    const seriesCount = Math.max(1, rows.reduce((most, row) => Math.max(most, row.values.length), 1));
    if (chartType === "histogram") return ["기둥"];
    if (chartType === "freqpoly") return ["다각형"];
    if (chartType === "box" && seriesCount < 2) return ["상자"];
    // 버블은 둘째 값이 크기라 묶음이 아니다 — 색은 하나만 고른다.
    if (chartType === "bubble") return ["점"];
    // 누적 막대는 쌓은 칸(묶음)마다 색이 다르다 — 묶음이 하나뿐이어도 첫 색만 쓴다.
    if (chartType === "stacked"){
      return Array.from({ length:Math.min(seriesCount, CHART_COLOR_LIMIT) }, (_, index) => table.series[index] || `자료 ${index + 1}`);
    }
    // 띠그래프는 묶음이 여럿이어도 색은 띠를 나눠 가진 항목의 것이다(띠마다 같은 색 차례).
    if (seriesCount > 1 && chartType !== "pie" && chartType !== "band"){
      return Array.from({ length:Math.min(seriesCount, CHART_COLOR_LIMIT) }, (_, index) => table.series[index] || `자료 ${index + 1}`);
    }
    if (chartType === "line") return ["꺾은선"];
    if (chartType === "scatter") return ["점"];
    return rows.slice(0, CHART_COLOR_LIMIT).map((row, index) => String(row.label || index + 1));
  }
  // 고른 색은 자리(index)로 기억한다. 고르지 않은 자리는 기본 팔레트가 그대로 온다.
  function chartPaletteFor(slotCount){
    const base = MNBoardTools.CHART_PALETTE;
    const count = Math.max(base.length, slotCount || 0);
    return Array.from({ length:count }, (_, index) => chartPalette[index] || base[index % base.length]);
  }
  let chartColorKey = "";
  function syncChartColorReset(){
    const existing = chartColorRow.querySelector(".wb-chart-colors-reset");
    const wanted = chartPalette.some((color) => color);
    if (wanted && !existing){
      const reset = document.createElement("button"); reset.type = "button"; reset.className = "wb-chart-colors-reset";
      reset.textContent = "색 되돌리기"; reset.title = "고른 색을 기본 색으로 되돌리기";
      reset.addEventListener("click", () => { chartPalette = []; refreshChartPreview(); });
      chartColorRow.appendChild(reset);
    } else if (!wanted && existing){
      existing.remove();
    }
  }
  function renderChartColors(slots){
    const key = JSON.stringify(slots);
    const palette = chartPaletteFor(slots.length);
    if (key === chartColorKey){
      // 자리 구성이 그대로면 색만 갱신한다. 다시 만들면 열려 있는 색 고르기 창이 끊긴다.
      chartColorRow.querySelectorAll("input[type=color]").forEach((picker, index) => {
        if (picker !== document.activeElement && palette[index]) picker.value = palette[index];
      });
      syncChartColorReset();
      return;
    }
    chartColorKey = key;
    chartColorRow.textContent = "";
    chartColorRow.hidden = !slots.length;
    if (!slots.length) return;
    slots.forEach((name, index) => {
      const chip = document.createElement("label"); chip.className = "wb-chart-color";
      const picker = document.createElement("input"); picker.type = "color"; picker.value = palette[index];
      picker.title = `${name} 색 고르기`; picker.setAttribute("aria-label", picker.title);
      picker.addEventListener("input", () => { chartPalette[index] = picker.value; refreshChartPreview(); });
      const text = document.createElement("span"); text.textContent = name; text.title = name;
      chip.append(picker, text); chartColorRow.appendChild(chip);
    });
    syncChartColorReset();
  }
  function readChartSpec(size){
    return {
      type:chartType, data:chartData.value, title:chartTitle.value.trim(),
      bins:Number(chartBins.input.value) || null, trend:chartTrend.checked, cumulative:chartCumulative.checked,
      axisColor:boardInkColor(), palette:chartPaletteFor(chartColorSlots().length),
      width:(size && size.width) || 560, height:(size && size.height) || 400
    };
  }
  // 동전·주사위를 실제로 굴려 만든 자료를 차트 입력칸에 그대로 채운다(그다음은 차트 만들기와 같은 길).
  let lastSimulation = null;
  function simulationSettings(kind){
    const settings = { min:1, max:10 };
    if (kind !== "bag" && kind !== "spinner") return settings;
    // "빨강 3, 파랑 2" 를 자료 표와 같은 규칙으로 읽는다(쉼표가 줄바꿈 노릇을 한다).
    settings.items = MNBoardTools.parseChartData(simBag.value.split(",").join("\n"))
      .map((row) => ({ label:row.label, count:row.value }));
    settings.draws = Number(simDraws.input.value) || 1;
    settings.replace = simReplace.checked;
    return settings;
  }
  function runSimulation(kind){
    let result, settings;
    try {
      settings = simulationSettings(kind);
      result = MNBoardTools.simulateTrials(kind, Number(simCount.value) || 100, settings);
    }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "실험을 하지 못했어요.", 2400); return; }
    lastSimulation = { kind, settings, target:result.rows[0] ? result.rows[0].label : "" };
    chartType = "bar"; chartTitle.value = result.title; chartData.value = result.data; chartPalette = [];
    refreshChartPreview(result.summary);
  }
  // 큰 수의 법칙 — 방금 한 실험(없으면 동전)을 다시 굴리며 누적 상대도수를 그린다.
  function insertRunningRatio(){
    const source = lastSimulation || { kind:"coin", settings:{}, target:"" };
    let group;
    try {
      group = MNBoardTools.runningRatioGroup(source.kind, Number(simCount.value) || 200,
        Object.assign({}, source.settings, { target:source.target, color:boardInkColor() }));
    }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "누적 그래프를 만들지 못했어요.", 2400); return; }
    placeBoardGroup(group);
  }
  function refreshChemistry(){
    const source = chemInput.value.trim();
    if (!source){
      chemResult.textContent = ""; chemInsert.disabled = true;
      chemMessage.textContent = "‘반응물 -> 생성물’ 로 적으면 계수를 맞춰 드려요. 괄호가 있는 Ca(OH)2 도 됩니다.";
      chemMessage.classList.remove("is-error"); return null;
    }
    try {
      const balanced = MNBoardTools.balanceEquation(source);
      chemResult.textContent = balanced.text; chemInsert.disabled = false;
      chemMessage.textContent = "계수: " + balanced.coefficients.join(" · ");
      chemMessage.classList.remove("is-error");
      syncChemSpecies(balanced);
      return balanced;
    } catch(error){
      chemResult.textContent = ""; chemInsert.disabled = true;
      chemMessage.textContent = error && error.message ? error.message : "균형을 맞추지 못했어요.";
      chemMessage.classList.add("is-error");
      syncChemSpecies(null);
      return null;
    }
  }
  // 균형이 맞은 식에서만 몰 계산 줄을 보여 준다. 물질 목록이 그대로면 고른 물질을 유지한다.
  let chemSpeciesKey = "";
  function syncChemSpecies(balanced){
    chemMoleRow.hidden = !balanced;
    const key = balanced ? balanced.species.join("+") : "";
    if (key !== chemSpeciesKey){
      chemSpeciesKey = key;
      chemSpecies.textContent = "";
      if (balanced) balanced.species.forEach((formula, index) => {
        const option = document.createElement("option"); option.value = String(index);
        option.textContent = MNBoardTools.formulaWithSubscripts(formula);
        chemSpecies.appendChild(option);
      });
    }
    refreshMolePreview();
  }
  function readStoichiometrySpec(){
    return {
      species:Number(chemSpecies.value) || 0, amount:Number(chemAmount.input.value),
      unit:chemUnit.value === "mol" ? "mol" : "g", color:boardInkColor()
    };
  }
  function refreshMolePreview(){
    if (chemMoleRow.hidden){ chemMoleResult.textContent = ""; chemMoleBtn.disabled = true; return; }
    let result;
    try { result = MNBoardTools.stoichiometry(chemInput.value, readStoichiometrySpec()); }
    catch(error){
      chemMoleResult.textContent = error && error.message ? error.message : "";
      chemMoleBtn.disabled = true; return;
    }
    chemMoleBtn.disabled = false;
    const known = result.rows[result.basis.index];
    const others = result.rows.filter((row, index) => index !== result.basis.index)
      .map((row) => `${MNBoardTools.formulaWithSubscripts(row.formula)} ${row.moles.toFixed(3)}mol(${row.grams.toFixed(2)}g)`);
    chemMoleResult.textContent = `${MNBoardTools.formulaWithSubscripts(known.formula)} ${result.basis.amount}${result.basis.unit} → ` + others.join(" · ");
  }
  function insertStoichiometry(){
    let group;
    try { group = MNBoardTools.stoichiometryGroup(chemInput.value, readStoichiometrySpec()); }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "몰 계산표를 만들지 못했어요.", 2400); return; }
    placeTableGroup(group, "stoichiometry");
  }
  function insertBalancedEquation(){
    const balanced = refreshChemistry();
    if (!balanced){ chemInput.focus(); return; }
    placeBoardText(balanced.text, 34);
  }
  // 반응식 칸에 커서가 있으면 아래 주기율표의 원소 칩이 ‘보드에 카드 넣기’ 대신 ‘기호 이어 적기’로 움직인다.
  // (칩을 누를 때 focus 가 옮겨가지 않도록 mousedown 을 막아 두므로 여기서 activeElement 로 판단할 수 있다.)
  function chemInputActive(){ return !chemBuilder.hidden && document.activeElement === chemInput; }
  function typeChemSymbol(symbol){
    const value = chemInput.value;
    const start = chemInput.selectionStart == null ? value.length : chemInput.selectionStart;
    const end = chemInput.selectionEnd == null ? start : chemInput.selectionEnd;
    chemInput.value = value.slice(0, start) + symbol + value.slice(end);
    const caret = start + symbol.length;
    chemInput.focus(); chemInput.setSelectionRange(caret, caret);
    refreshChemistry();
  }
  function syncChemHint(){
    if (chemBuilder.hidden) return;
    eduHint.textContent = chemInputActive()
      ? "반응식 칸에 커서가 있어요 — 원소를 누르면 기호가 커서 자리에 들어갑니다."
      : "원소를 누르면 번호·기호·이름·원자량 카드가 들어갑니다. 반응식 칸에 커서를 두고 누르면 기호가 그 자리에 적혀요.";
  }
  function refreshChartPreview(note){
    for (const chip of chartTypeBar.children){
      const active = chip.dataset.chartType === chartType;
      chip.classList.toggle("active", active); chip.setAttribute("aria-pressed", String(active));
    }
    if (!chartData.value.trim()){
      chartMessage.textContent = "자료를 입력하면 미리보기가 나타나요. 아래 예시를 눌러 시작해도 좋아요.";
      chartMessage.classList.remove("is-error");
      chartColorRow.hidden = true; chartColorRow.textContent = ""; chartColorKey = "";
      chartPreview.hidden = true; chartInsert.disabled = true; return;
    }
    // 추세선은 산점도에서만, 계급 수는 계급으로 묶는 종류에서만, 누적은 도수분포다각형에서만
    // 쓴다(도수분포표 단추는 종류와 상관없이 늘 계급 수를 본다).
    chartTrendWrap.classList.toggle("is-off", chartType !== "scatter");
    chartTrend.disabled = chartType !== "scatter";
    chartCumulativeWrap.classList.toggle("is-off", chartType !== "freqpoly");
    chartCumulative.disabled = chartType !== "freqpoly";
    chartBins.wrap.classList.toggle("is-off", chartType !== "histogram" && chartType !== "freqpoly");
    renderChartColors(chartColorSlots());
    try {
      const group = MNBoardTools.chartGroup(readChartSpec({ width:560, height:400 }));
      chartPreview.hidden = false; drawToolPreview(chartPreview, group);
      chartMessage.textContent = note || "쉼표·탭·띄어쓰기로 이름과 값을 나눠 적으면 됩니다. 값을 여러 열 적으면 묶음끼리 나란히 비교하고, 표를 복사해 붙여넣어도 돼요.";
      chartMessage.classList.remove("is-error"); chartInsert.disabled = false;
    } catch(error){
      chartPreview.hidden = true; chartInsert.disabled = true;
      chartMessage.textContent = error && error.message ? error.message : "차트를 만들지 못했어요.";
      chartMessage.classList.add("is-error");
    }
  }
  function resetChartEditor(){
    editingChartItem = null; chartInsert.textContent = "차트 넣기"; chartCancel.hidden = true; refreshChartPreview();
  }
  function applyChartPreset(preset){
    chartType = preset.type; chartTitle.value = preset.title || ""; chartData.value = preset.data || "";
    chartPalette = [];                      // 자료가 통째로 바뀌므로 색도 기본으로 되돌린다
    chartTrend.checked = !!preset.trend; chartCumulative.checked = !!preset.cumulative;
    chartBins.input.value = String(Number(preset.bins) || 0);
    refreshChartPreview();
  }
  function submitChart(){
    const target = editingChartItem;
    const boardWidth = Math.max(320, Math.min(W ? W * .8 : 640, 680));
    let group;
    try { group = MNBoardTools.chartGroup(readChartSpec({ width:Math.round(boardWidth), height:Math.round(boardWidth * .72) })); }
    catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "차트를 만들지 못했어요.", 2400); return; }
    if (target && replaceBoardGroup(target, group)){ resetChartEditor(); return; }
    placeBoardGroup(group); resetChartEditor();
  }
  openChartEditor = (item) => {
    const spec = item && item.chartSpec ? item.chartSpec : null;
    resetTableEditor();
    editingChartItem = item; eduCategory = "chart";
    if (spec){
      chartType = CHART_TYPES.some(([id]) => id === spec.type) ? spec.type : "bar";
      chartTitle.value = String(spec.title || "");
      // 계열이 여럿이면 이름 줄까지 되살려야 다시 열었을 때 같은 차트가 나온다.
      const rows = Array.isArray(spec.rows) ? spec.rows : [];
      const series = Array.isArray(spec.series) ? spec.series : [];
      const cells = (row) => (Array.isArray(row.values) ? row.values : [row.value]).map((value) => (value == null ? "" : value));
      const lines = rows.map((row) => [row.label].concat(cells(row)).join(", "));
      if (series.length) lines.unshift(["항목"].concat(series).join(", "));
      chartData.value = lines.join("\n");
      chartPalette = Array.isArray(spec.palette) ? spec.palette.slice() : [];
      chartBins.input.value = String(Number(spec.bins) || 0);
      chartTrend.checked = !!spec.trend; chartCumulative.checked = !!spec.cumulative;
    }
    chartInsert.textContent = "차트 바꾸기"; chartCancel.hidden = false;
    toggleEducationPanel(true);
  };
  for (const [id, label] of CHART_TYPES){
    const chip = mkBtn(label, label + " 차트로 만들기", "wb-formula-group", () => { chartType = id; refreshChartPreview(); });
    chip.dataset.chartType = id; chartTypeBar.appendChild(chip);
  }
  graphInputs.forEach((input, index) => {
    input.addEventListener("input", refreshGraphPreview);
    input.addEventListener("focus", () => { graphFocusIndex = index; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); submitGraph(); } e.stopPropagation(); });
  });
  for (const pair of graphPairInputs){
    for (const input of [pair.x, pair.y]){
      input.addEventListener("input", refreshGraphPreview);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); submitGraph(); } e.stopPropagation(); });
    }
  }
  for (const field of [graphXMin, graphXMax, graphYMin, graphYMax, graphTMin, graphTMax, graphTangentX, graphAreaFrom, graphAreaTo, graphAreaBars]){
    field.input.addEventListener("change", refreshGraphPreview);
  }
  for (const box of [graphCross.box, graphTangent.box, graphArea.box, graphDerivative.box]) box.addEventListener("change", refreshGraphPreview);
  for (const relation of graphRelations) relation.addEventListener("change", refreshGraphPreview);
  graphTarget.addEventListener("change", refreshGraphPreview);
  function syncGraphAutoFields(){
    graphYMin.wrap.classList.toggle("is-off", graphAuto.checked);
    graphYMax.wrap.classList.toggle("is-off", graphAuto.checked);
  }
  graphAuto.addEventListener("change", () => {
    syncGraphAutoFields();
    refreshGraphPreview();
  });
  graphAuto.dispatchEvent(new Event("change"));
  graphGrid.addEventListener("change", refreshGraphPreview);
  graphSlider.addEventListener("change", refreshGraphPreview);
  chartTrend.addEventListener("change", () => refreshChartPreview());
  chartCumulative.addEventListener("change", () => refreshChartPreview());
  chartBins.input.addEventListener("change", () => refreshChartPreview());
  chartData.addEventListener("input", () => refreshChartPreview());
  chartTitle.addEventListener("input", () => refreshChartPreview());
  chemInput.addEventListener("input", refreshChemistry);
  chemSpecies.addEventListener("change", refreshMolePreview);
  chemUnit.addEventListener("change", refreshMolePreview);
  chemAmount.input.addEventListener("input", refreshMolePreview);
  chemInput.addEventListener("focus", syncChemHint);
  chemInput.addEventListener("blur", () => requestAnimationFrame(syncChemHint));
  chemInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); insertBalancedEquation(); }
    e.stopPropagation();
  });

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
  // 그래프·차트 탭은 카탈로그(고정 목록)가 아니라 만들기 화면이라, 아래쪽 칸에는 바로 쓰는 예시를 깐다.
  function renderToolPresets(){
    eduGrid.classList.remove("wb-periodic");
    eduGrid.textContent = "";
    const presets = eduCategory === "graph" ? GRAPH_PRESETS : CHART_PRESETS;
    for (const preset of presets){
      const card = document.createElement("button"); card.type = "button"; card.className = "wb-edu-card wb-edu-preset";
      card.title = preset.label + (eduCategory === "graph" ? " — 눌러서 커서가 있는 식 칸 채우기" : " — 눌러서 입력칸 채우기");
      const visual = document.createElement("span"); visual.className = "wb-edu-visual";
      const relation = GRAPH_RELATIONS.find(([id]) => id === ((preset.relations || [])[0] || "eq"));
      // 그리는 방법마다 예시 카드에 보일 식의 모양이 다르다.
      const shown = { polar:"r = ", sequence:"aₙ = ", implicit:"" };
      visual.textContent = eduCategory !== "graph" ? preset.title
        : preset.mode === "parametric" ? `x=${preset.pairs[0][0]}, y=${preset.pairs[0][1]}`
          : preset.mode ? shown[preset.mode] + preset.curves[0]
            : `${relation[1]} ${preset.curves[0]}`;
      const label = document.createElement("span"); label.className = "wb-edu-label"; label.textContent = preset.label;
      card.append(visual, label);
      card.addEventListener("click", () => (eduCategory === "graph" ? applyGraphPreset(preset) : applyChartPreset(preset)));
      eduGrid.appendChild(card);
    }
  }
  // 주기율표: 검색 전에는 진짜 표 모양(18족×7주기 + 란타넘·악티늄족 두 줄)으로, 검색 중에는 넓은 카드로 보여 준다.
  function renderPeriodicTable(term){
    eduGrid.textContent = "";
    const matches = MNBoardTools.findElements(term);
    const laidOut = !term;
    eduGrid.classList.toggle("wb-periodic", laidOut);
    for (const element of matches){
      const cell = document.createElement("button"); cell.type = "button"; cell.className = "wb-element";
      cell.title = `${element.number} ${element.name}(${element.symbol}) · 원자량 ${element.mass} · ${element.category}`;
      cell.setAttribute("aria-label", cell.title);
      // 반응식 칸을 쓰던 중이면 커서를 뺏지 않는다 — 그래야 누른 기호가 커서 자리에 이어 적힌다.
      cell.addEventListener("mousedown", (e) => { if (chemInputActive()) e.preventDefault(); });
      cell.style.setProperty("--wb-element-color", MNBoardTools.ELEMENT_CATEGORY_COLORS[element.category] || "#64748b");
      if (laidOut){
        // 란타넘족(57~71)·악티늄족(89~103)은 표 아래 두 줄에 3열부터 늘어놓는 표준 배치를 따른다.
        const row = element.group ? element.period : (element.period === 6 ? 9 : 10);
        const column = element.group || (element.period === 6 ? element.number - 54 : element.number - 86);
        cell.style.gridColumn = String(column); cell.style.gridRow = String(row);
      }
      const number = document.createElement("span"); number.className = "wb-element-no"; number.textContent = String(element.number);
      const symbol = document.createElement("span"); symbol.className = "wb-element-sym"; symbol.textContent = element.symbol;
      const name = document.createElement("span"); name.className = "wb-element-name"; name.textContent = element.name;
      cell.append(number, symbol, name);
      cell.addEventListener("click", () => {
        if (chemInputActive()){ typeChemSymbol(element.symbol); return; }
        try { placeBoardGroup(MNBoardTools.elementCardGroup(element, wb.color)); }
        catch(error){ if (typeof toast === "function") toast(error && error.message ? error.message : "원소 카드를 넣지 못했어요.", 2200); }
      });
      eduGrid.appendChild(cell);
    }
    if (!matches.length){
      const empty = document.createElement("p"); empty.className = "wb-edu-empty"; empty.textContent = "그런 원소가 없어요.";
      eduGrid.appendChild(empty);
    }
  }
  function renderEducationPanel(){
    const term = eduSearch.value.trim();
    const buildingTool = eduCategory === "graph" || eduCategory === "chart";
    // 값을 넣어 만드는 도구 탭(수 모형·과학 계산)은 카탈로그 대신 만들기 화면만 보여 준다.
    const openTool = toolBuilders.find((tool) => tool.category === eduCategory) || null;
    eduTitle.textContent = eduCategory === "formula" ? "수학·과학 도구상자 · 수식 사전"
      : eduCategory === "graph" ? "수학·과학 도구상자 · 함수 그래프"
      : eduCategory === "chart" ? "수학·과학 도구상자 · 자료 차트"
      : eduCategory === "chemistry" ? "수학·과학 도구상자 · 주기율표"
      : openTool ? "수학·과학 도구상자 · " + openTool.title : "수학·과학 도구상자";
    eduSearch.hidden = buildingTool || !!openTool;
    eduSearch.placeholder = eduCategory === "formula" ? "한글·영문·LaTeX 수식 검색" : eduCategory === "geometry" ? "평면·입체·작도·그래프·통계 검색" : eduCategory === "science" ? "역학·파동·전기·광학·화학·생명·지구 검색" : eduCategory === "chemistry" ? "원소 이름·기호·번호 검색 (예: 산소, Na, 26)" : "기호·수식·도형 검색";
    graphBuilder.hidden = eduCategory !== "graph";
    chartBuilder.hidden = eduCategory !== "chart";
    chemBuilder.hidden = eduCategory !== "chemistry";
    if (!chemBuilder.hidden) refreshChemistry();
    for (const tool of toolBuilders){
      tool.builder.hidden = tool !== openTool;
      if (tool !== openTool) tool.reset();
    }
    // 만들기 화면만 쓰는 탭에서는 빈 카탈로그 칸이 자리를 차지하지 않게 접어 둔다.
    eduPanel.classList.toggle("is-tool-tab", !!openTool);
    if (openTool) requestAnimationFrame(openTool.sync);
    eduHint.textContent = openTool ? openTool.hint : buildingTool
      ? "넣은 뒤에도 두 번 누르면 다시 고칠 수 있어요. ‘분리’를 누르면 선·글자로 흩어집니다."
      : eduCategory === "chemistry" ? "원소를 누르면 번호·기호·이름·원자량 카드가 들어갑니다. 반응식 칸에 커서를 두고 누르면 기호가 그 자리에 적혀요."
      : "클릭하면 가운데에, 끌어 놓으면 원하는 위치에 들어갑니다.";
    if (eduCategory === "chemistry") syncChemHint();
    formulaBuilder.hidden = eduCategory !== "formula";
    if (!formulaBuilder.hidden) refreshFormulaPreview();
    if (!graphBuilder.hidden) requestAnimationFrame(refreshGraphPreview);
    if (!chartBuilder.hidden) requestAnimationFrame(refreshChartPreview);
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
        if (eduCategory === "graph" && id !== "graph") resetGraphEditor();
        if (eduCategory === "chart" && id !== "chart") resetChartEditor();
        if (openTool && id !== eduCategory) openTool.reset();
        eduCategory = id; eduSearch.value = ""; renderEducationPanel();
      });
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", id === eduCategory ? "true" : "false");
      eduTabs.appendChild(tab);
    }
    if (buildingTool){ renderToolPresets(); return; }
    if (openTool){ eduGrid.classList.remove("wb-periodic"); eduGrid.textContent = ""; return; }
    if (eduCategory === "chemistry"){ renderPeriodicTable(term); return; }
    eduGrid.classList.remove("wb-periodic");
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
    if (open){
      toggleFocusPanel(false); renderEducationPanel();
      if (eduFloat) eduFloat.clampOnOpen();
      const first = editingFormulaItem ? formulaInput : eduCategory === "graph" ? graphInputs[0] : eduCategory === "chart" ? chartData : eduSearch;
      requestAnimationFrame(() => first.focus({ preventScroll:true }));
    } else {
      if (editingFormulaItem) resetFormulaEditor();
      if (editingPlotItem) resetGraphEditor();
      if (editingChartItem) resetChartEditor();
    }
  }
  // 보드의 도구 그룹을 두 번 누르면 만든 재료를 든 채로 그 종류의 탭이 열린다.
  openToolItemEditor = (item) => {
    for (const tool of toolBuilders) if (tool.open(item)) return true;
    if (typeof toast === "function") toast("이 도구는 만든 재료가 없어 고칠 수 없어요.", 2400);
    return false;
  };
  eduSearch.addEventListener("input", renderEducationPanel);

  const toolGroup = grp();
  TOOLS.forEach(([t, icon, title]) => { const b = mkIconBtn(icon, title, "wb-tool wb-toolvis-" + t, () => setTool(t)); toolBtns[t] = b; toolGroup.appendChild(b); });

  const colorGroup = grp(); colorGroup.classList.add("wb-toolvis-color");
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
  bgPanel.setAttribute("role", "dialog"); bgPanel.setAttribute("aria-label", "보드 배경");
  const bgHead = document.createElement("div"); bgHead.className = "wb-bg-head";
  const bgTitle = document.createElement("strong"); bgTitle.textContent = "배경";
  bgHead.append(bgTitle, mkBtn("×", "배경 고르기 닫기 (Esc)", "wb-edu-close", () => toggleBackgroundPanel(false)));
  const bgColorTitle = document.createElement("div"); bgColorTitle.className = "wb-bg-section"; bgColorTitle.textContent = "색";
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

  /* ----- 배경 무늬(모눈·오선 등) -----
     사진이 아니라 그릴 때마다 계산하는 벡터라, 저장되는 건 이름·간격·색뿐이다(자동복원 용량 0).
     칸은 보드 원점에 맞춰 깔리므로 확대·이동해도 판서와 칸이 함께 움직인다. */
  // 색은 무늬를 바꿔도 이어 쓰는 취향이라(파란 모눈 → 파란 오선) 마지막 선택을 들고 있는다.
  // 간격·진하기는 무늬마다 알맞은 값이 크게 달라 프리셋 기본값에서 다시 시작한다.
  let patternColorDraft = (wb.bgPattern && wb.bgPattern.color) || "";
  const patternTitle = document.createElement("div"); patternTitle.className = "wb-bg-section"; patternTitle.textContent = "무늬";
  const patternChoices = document.createElement("div"); patternChoices.className = "wb-bg-patterns";
  const patternChipEls = [];
  const PATTERN_CHIP_CELL = { grid:10, dots:10, graph:10, lines:9, staff:4, cells:11 };
  // 이름만 늘어놓으면 "원고지"와 "모눈종이"를 골라 보기 전에는 구분하기 어렵다 — 칩마다 실제
  // 그리기 코드로 축소판을 그려 둔다(같은 함수라 고른 결과와 미리보기가 어긋날 수 없다).
  const drawPatternChip = (canvasEl, id) => {
    const box = 34, ratio = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(box * ratio); canvasEl.height = Math.round(box * ratio);
    const c = canvasEl.getContext("2d");
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.fillStyle = wb.bg; c.fillRect(0, 0, box, box);
    if (id === "none" || !MNBoardRenderer.drawPattern) return;
    const cell = PATTERN_CHIP_CELL[id] || 10;
    MNBoardRenderer.drawPattern(c, { id, size:cell, color:patternColorDraft, opacity:.8 }, { x:0, y:0, w:box, h:box }, wb.bg);
  };
  for (const preset of (typeof BOARD_PATTERNS !== "undefined" ? BOARD_PATTERNS : [])){
    const chip = mkBtn("", preset.label, "wb-bg-pattern", () => setPatternId(preset.id));
    chip.dataset.boardPattern = preset.id;
    const thumb = document.createElement("canvas"); thumb.className = "wb-bg-pattern-thumb"; thumb.style.width = "34px"; thumb.style.height = "34px";
    const caption = document.createElement("span"); caption.textContent = preset.label;
    chip.append(thumb, caption);
    chip.__thumb = thumb; chip.__patternId = preset.id;
    patternChipEls.push(chip); patternChoices.appendChild(chip);
  }
  const patternDetails = document.createElement("div"); patternDetails.className = "wb-bg-pattern-details"; patternDetails.hidden = true;
  const mkPatternRange = (label, min, max, step, onInput) => {
    const row = document.createElement("label"); row.className = "wb-bg-range";
    const caption = document.createElement("span"); caption.textContent = label;
    const input = document.createElement("input");
    input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
    input.title = label; input.setAttribute("aria-label", label);
    input.addEventListener("input", () => onInput(Number(input.value)));
    row.append(caption, input); patternDetails.appendChild(row);
    return input;
  };
  const patternSizeInput = mkPatternRange("간격",
    (typeof BOARD_PATTERN_SIZE_MIN !== "undefined" ? BOARD_PATTERN_SIZE_MIN : 12),
    (typeof BOARD_PATTERN_SIZE_MAX !== "undefined" ? BOARD_PATTERN_SIZE_MAX : 160), 2,
    (value) => updatePattern({ size:value }));
  const patternOpacityInput = mkPatternRange("진하기", 5, 100, 5, (value) => updatePattern({ opacity:value / 100 }));
  const patternColorRow = document.createElement("div"); patternColorRow.className = "wb-bg-pattern-colors";
  const patternColorEls = [];
  // "자동"은 배경색과 대비가 큰 쪽(흰 종이엔 짙은 선, 칠판엔 밝은 선)을 그때그때 고른다 —
  // 배경색을 바꿔도 무늬가 배경에 묻히지 않는다.
  for (const [value, label] of [["", "자동"], ["#1f2937", "먹색"], ["#2563eb", "파랑"], ["#e11d48", "빨강"], ["#16a34a", "초록"], ["#ffffff", "흰색"]]){
    const swatch = mkBtn(value ? "" : "자", label + " 무늬", "wb-bg-pattern-color", () => updatePattern({ color:value }));
    swatch.dataset.patternColor = value;
    if (value) swatch.style.background = value;
    patternColorEls.push(swatch); patternColorRow.appendChild(swatch);
  }
  patternDetails.appendChild(patternColorRow);

  /* ----- 배경 그림 -----
     무늬가 "종이 결"이라면 이건 "칠판에 붙인 학습지"다 — 사진·스캔 위에 바로 판서한다.
     넣을 때 다시 인코딩하므로(encodeBoardBackgroundImage) 자동복원 스냅샷이 사진 한 장에 눌리지 않는다. */
  const imageTitle = document.createElement("div"); imageTitle.className = "wb-bg-section"; imageTitle.textContent = "배경 그림";
  const imageActions = document.createElement("div"); imageActions.className = "wb-bg-image-actions";
  const imagePickBtn = mkBtn("고르기", "배경으로 쓸 그림 파일 고르기", "wb-bg-image-btn", () => pickBackgroundImage());
  const imageClearBtn = mkBtn("지우기", "배경 그림 지우기", "wb-bg-image-btn", () => {
    setBackgroundImage(null);
    if (typeof toast === "function") toast("배경 그림을 지웠어요.", 1800);
  });
  imageActions.append(imagePickBtn, imageClearBtn);
  const imageDetails = document.createElement("div"); imageDetails.className = "wb-bg-pattern-details"; imageDetails.hidden = true;
  const imageFitRow = document.createElement("div"); imageFitRow.className = "wb-bg-fits";
  const imageFitEls = [];
  for (const fit of (typeof BOARD_IMAGE_FITS !== "undefined" ? BOARD_IMAGE_FITS : [])){
    const chip = mkBtn(fit.label, fit.label + "으로 놓기", "wb-bg-fit", () => setBackgroundImageFit(fit.id));
    chip.dataset.boardFit = fit.id;
    imageFitEls.push(chip); imageFitRow.appendChild(chip);
  }
  const imageOpacityRow = document.createElement("label"); imageOpacityRow.className = "wb-bg-range";
  const imageOpacityCaption = document.createElement("span"); imageOpacityCaption.textContent = "흐리기";
  const imageOpacityInput = document.createElement("input");
  imageOpacityInput.type = "range"; imageOpacityInput.min = "10"; imageOpacityInput.max = "100"; imageOpacityInput.step = "5";
  imageOpacityInput.title = "배경 그림 흐리기"; imageOpacityInput.setAttribute("aria-label", imageOpacityInput.title);
  imageOpacityInput.addEventListener("input", () => {
    if (!wb.bgImage) return;
    setBackgroundImage({ ...wb.bgImage, opacity:Number(imageOpacityInput.value) / 100 });
  });
  imageOpacityRow.append(imageOpacityCaption, imageOpacityInput);
  // 타일은 상자를 끌어 조절할 수가 없어(보드 전체에 반복된다) 칸 크기를 따로 준다.
  const imageTileRow = document.createElement("label"); imageTileRow.className = "wb-bg-range"; imageTileRow.hidden = true;
  const imageTileCaption = document.createElement("span"); imageTileCaption.textContent = "칸 크기";
  const imageTileInput = document.createElement("input");
  imageTileInput.type = "range"; imageTileInput.step = "5";
  imageTileInput.min = String(typeof BOARD_IMAGE_TILE_MIN !== "undefined" ? BOARD_IMAGE_TILE_MIN : 10);
  imageTileInput.max = String(typeof BOARD_IMAGE_TILE_MAX !== "undefined" ? BOARD_IMAGE_TILE_MAX : 200);
  imageTileInput.title = "타일 한 칸 크기"; imageTileInput.setAttribute("aria-label", imageTileInput.title);
  imageTileInput.addEventListener("input", () => {
    if (!wb.bgImage) return;
    setBackgroundImage({ ...wb.bgImage, tile:Number(imageTileInput.value) });
  });
  imageTileRow.append(imageTileCaption, imageTileInput);
  imageDetails.append(imageFitRow, imageTileRow, imageOpacityRow);

  bgPanel.append(bgHead, bgColorTitle, bgChoices, bgCustomRow, patternTitle, patternChoices, patternDetails,
    imageTitle, imageActions, imageDetails, bgHint);
  stage.appendChild(bgPanel);

  // ----- 변환 패널(선택한 도형을 옮기고·돌리고·뒤집고·닮음 복사) -----
  let transformToolBtn = null;
  transformPanel = document.createElement("div");
  transformPanel.className = "wb-transform-panel"; transformPanel.hidden = true;
  transformPanel.id = "wb-transform-panel-" + doc.id;
  transformPanel.setAttribute("role", "dialog"); transformPanel.setAttribute("aria-label", "도형 변환");
  const transformHead = document.createElement("div"); transformHead.className = "wb-bg-head";
  const transformTitle = document.createElement("strong"); transformTitle.textContent = "변환";
  transformHead.append(transformTitle, mkBtn("×", "변환 닫기 (Esc)", "wb-edu-close", () => toggleTransformPanel(false)));
  const transformKinds = document.createElement("div"); transformKinds.className = "wb-formula-groups wb-transform-kinds";
  const TRANSFORM_KINDS = [["reflect", "선대칭"], ["point", "점대칭"], ["rotate", "회전"], ["translate", "평행이동"], ["scale", "닮음"]];
  const transformKindBtns = {};
  for (const [id, label] of TRANSFORM_KINDS){
    const chip = mkBtn(label, label + "으로 바꾸기", "wb-formula-group", () => { transformState.kind = id; syncTransformPanel(); redraw(); });
    transformKindBtns[id] = chip; transformKinds.appendChild(chip);
  }
  const transformFields = document.createElement("div"); transformFields.className = "wb-transform-fields";
  const transformAxisRow = document.createElement("div"); transformAxisRow.className = "wb-formula-groups wb-transform-axis";
  const TRANSFORM_AXES = [["vertical", "세로축"], ["horizontal", "가로축"], ["ruler", "자 모서리"]];
  const transformAxisBtns = {};
  for (const [id, label] of TRANSFORM_AXES){
    const chip = mkBtn(label, label + "을 대칭축으로", "wb-formula-group", () => { transformState.axis = id; syncTransformPanel(); redraw(); });
    transformAxisBtns[id] = chip; transformAxisRow.appendChild(chip);
  }
  const makeTransformNumber = (caption, unit, value, step, title, apply) => {
    const wrap = document.createElement("label"); wrap.className = "wb-graph-field wb-transform-field";
    const name = document.createElement("span"); name.textContent = caption;
    const input = document.createElement("input"); input.type = "number"; input.step = String(step); input.value = String(value);
    input.className = "wb-graph-number"; input.title = title; input.setAttribute("aria-label", title);
    const unitLabel = document.createElement("span"); unitLabel.textContent = unit;
    input.addEventListener("change", () => { apply(Number(input.value)); redraw(); });
    wrap.append(name, input, unitLabel); transformFields.appendChild(wrap);
    return { wrap, input };
  };
  const transformDx = makeTransformNumber("→", "cm", transformState.dx, .5, "오른쪽으로 옮길 거리", (value) => { transformState.dx = Number.isFinite(value) ? value : 0; });
  const transformDy = makeTransformNumber("↓", "cm", transformState.dy, .5, "아래로 옮길 거리", (value) => { transformState.dy = Number.isFinite(value) ? value : 0; });
  const transformDegrees = makeTransformNumber("각", "°", transformState.degrees, 15, "회전할 각도(반시계는 음수)", (value) => { transformState.degrees = Number.isFinite(value) ? value : 90; });
  const transformFactor = makeTransformNumber("배율", "배", transformState.factor, .25, "닮음비(0.25~4)", (value) => { transformState.factor = Math.max(.05, Math.min(8, Number.isFinite(value) ? value : 2)); });
  const transformPivotRow = document.createElement("div"); transformPivotRow.className = "wb-transform-pivot";
  const transformPivotText = document.createElement("span"); transformPivotText.className = "wb-transform-pivot-text";
  const transformPickBtn = mkBtn("기준점 찍기", "보드를 눌러 대칭·회전·닮음의 기준점을 정합니다", "wb-formula-save", () => {
    transformPickPivot = true; syncTransformPanel();
    if (typeof toast === "function") toast("보드에서 기준점이 될 자리를 눌러 주세요.", 2600);
  });
  const transformPivotReset = mkBtn("도형 중심", "기준점을 선택한 도형의 중심으로 되돌립니다", "wb-formula-save", () => {
    transformPivot = null; transformPickPivot = false; syncTransformPanel(); redraw();
  });
  transformPivotRow.append(transformPivotText, transformPickBtn, transformPivotReset);
  const transformKeepRow = document.createElement("label"); transformKeepRow.className = "wb-graph-check";
  const transformKeep = document.createElement("input"); transformKeep.type = "checkbox"; transformKeep.checked = transformState.keepOriginal;
  transformKeep.addEventListener("change", () => { transformState.keepOriginal = transformKeep.checked; });
  transformKeepRow.append(transformKeep, document.createTextNode("원본 남기고 사본 만들기"));
  const transformHint = document.createElement("p"); transformHint.className = "wb-bg-hint";
  const transformApplyBtn = mkBtn("변환하기", "선택한 도형에 변환을 적용합니다", "wb-formula-insert", applyTransform);
  const transformActions = document.createElement("div"); transformActions.className = "wb-formula-actions";
  transformActions.appendChild(transformApplyBtn);
  transformPanel.append(transformHead, transformKinds, transformAxisRow, transformFields, transformPivotRow, transformKeepRow, transformHint, transformActions);
  stage.appendChild(transformPanel);
  syncTransformPanel = () => {
    for (const id in transformKindBtns){
      const active = id === transformState.kind;
      transformKindBtns[id].classList.toggle("active", active);
      transformKindBtns[id].setAttribute("aria-pressed", String(active));
    }
    for (const id in transformAxisBtns){
      const active = id === transformState.axis;
      transformAxisBtns[id].classList.toggle("active", active);
      transformAxisBtns[id].setAttribute("aria-pressed", String(active));
    }
    const kind = transformState.kind;
    transformAxisRow.hidden = kind !== "reflect";
    transformDx.wrap.hidden = kind !== "translate"; transformDy.wrap.hidden = kind !== "translate";
    transformDegrees.wrap.hidden = kind !== "rotate";
    transformFactor.wrap.hidden = kind !== "scale";
    // 평행이동은 기준점이 필요 없고, 자를 축으로 삼는 선대칭도 자 위치가 곧 축이다.
    const usesPivot = kind !== "translate" && !(kind === "reflect" && transformState.axis === "ruler");
    transformPivotRow.hidden = !usesPivot;
    transformPivotText.textContent = transformPickPivot ? "보드를 눌러 기준점 지정…" : transformPivot ? "기준점: 보드에 찍은 자리" : "기준점: 도형의 중심";
    transformPickBtn.classList.toggle("active", transformPickPivot);
    const canApply = !!(wb.selected && !isMeasureItem(wb.selected) && MNBoardTools.canTransformItem(wb.selected, { kind }));
    transformApplyBtn.disabled = !canApply;
    transformHint.textContent = wb.selected && wb.selected.type === "image" && !canApply
      ? "이미지는 방향을 틀지 않는 평행이동과 닮음만 적용할 수 있어요."
      : kind === "reflect" && transformState.axis === "ruler"
      ? "자의 눈금 모서리가 대칭축이 됩니다. 자를 옮기면 축도 함께 움직여요."
      : kind === "scale" ? "기준점에서 잰 거리가 배율만큼 늘거나 줄어듭니다. 글자 크기와 선 굵기도 함께 바뀝니다."
      : kind === "rotate" ? "양수는 시계 방향입니다. 글자는 읽을 수 있게 눕히지 않습니다."
      : "선택한 도형을 바꾼 결과를 사본으로 만듭니다.";
  };
  function toggleTransformPanel(force){
    const open = force == null ? transformPanel.hidden : !!force;
    transformPanel.hidden = !open;
    if (transformToolBtn){ transformToolBtn.classList.toggle("active", open); transformToolBtn.setAttribute("aria-expanded", open ? "true" : "false"); }
    if (open){ toggleFocusPanel(false); syncTransformPanel(); }
    else transformPickPivot = false;
    redraw();
  }

  const bgGroup = grp();
  bgGroup.classList.add("wb-toolvis-background");
  const bgToggleBtn = mkBtn("", "보드 배경(색·무늬) 바꾸기", "wb-act wb-bg-toggle", () => toggleBackgroundPanel());
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
    syncPatternControls();
    syncBackgroundImageControls();
  };
  function syncPatternControls(){
    const pattern = wb.bgPattern, activeId = pattern ? pattern.id : "none";
    for (const chip of patternChipEls){
      chip.setAttribute("aria-pressed", String(chip.__patternId === activeId));
      drawPatternChip(chip.__thumb, chip.__patternId);   // 배경색·무늬색을 바꾸면 미리보기도 같이 따라간다
    }
    patternDetails.hidden = !pattern;
    if (!pattern) return;
    patternSizeInput.value = String(pattern.size);
    patternOpacityInput.value = String(Math.round(pattern.opacity * 100));
    for (const swatch of patternColorEls) swatch.setAttribute("aria-pressed", String(swatch.dataset.patternColor === (pattern.color || "")));
  }
  function syncBackgroundImageControls(){
    const image = wb.bgImage;
    imageClearBtn.disabled = !image;
    imageDetails.hidden = !image;
    imagePickBtn.textContent = image ? "바꾸기" : "고르기";
    if (!image) return;
    imageOpacityInput.value = String(Math.round(image.opacity * 100));
    imageTileRow.hidden = image.fit !== "tile";
    if (image.fit === "tile") imageTileInput.value = String(image.tile || 50);
    for (const chip of imageFitEls) chip.setAttribute("aria-pressed", String(chip.dataset.boardFit === image.fit));
  }
  // 맞춤 방식은 현재 화면에 매번 적용된다. 배경은 화면 자체이므로 별도 위치 상자는 조절하지 않는다.
  function setBackgroundImageFit(fit){
    const image = wb.bgImage;
    if (!image) return;
    setBackgroundImage({ ...image, fit });
  }
  // 무늬도 배경색과 같이 "보드의 성질"이라 되돌리기(Ctrl+Z) 대상이 아니고, 복구 스냅샷에 바로 남는다.
  const commitPattern = (next) => {
    wb.bgPattern = boardSnapshotPattern(next);
    syncPatternControls();
    redraw();
    scheduleBoardRecovery();
    if (doc.recorder && doc.recorder.active && typeof doc.recorder.setBackground === "function"){
      doc.recorder.setBackground(wb.bg, { pattern:wb.bgPattern, image:wb.bgImage });
    }
  };
  function updatePattern(patch){
    if (!wb.bgPattern) return;
    if (patch.color !== undefined) patternColorDraft = patch.color;
    commitPattern({ ...wb.bgPattern, ...patch });
  }
  function setPatternId(id){
    if (!id || id === "none"){ commitPattern(null); return; }
    const preset = typeof boardPatternPreset === "function" ? boardPatternPreset(id) : null;
    const same = wb.bgPattern && wb.bgPattern.id === id;
    // 간격·진하기는 무늬마다 알맞은 기본값이 다르다(오선 15·진하게, 모눈 40·옅게). 손으로 바꿔 둔
    // 값은 같은 무늬를 다시 고를 때만 지키고, 다른 무늬로 넘어가면 그 무늬의 기본값에서 시작한다.
    const next = { id, color:patternColorDraft };
    if (same){ next.size = wb.bgPattern.size; next.opacity = wb.bgPattern.opacity; }
    else if (preset){ next.size = preset.size; next.opacity = preset.opacity; }
    // 좌표평면의 축은 "고른 순간 화면 한가운데"에 놓고 보드 좌표로 붙박는다 — 창 크기를 바꿔도
    // 원점이 판서와 함께 있다. 이미 좌표평면일 때 다시 누르면 지금 보는 화면 가운데로 옮겨 준다.
    if (id === "graph"){
      const center = visibleBoardCenter();
      next.originX = Math.round(center.x); next.originY = Math.round(center.y);
    }
    commitPattern(next);
  }
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

  const widthGroup = grp(); widthGroup.classList.add("wb-toolvis-width");
  [["2", "S", 2], ["4", "M", 4], ["8", "L", 8]].forEach(([k, label, w]) => { const b = mkBtn(label, "굵기 " + label, "wb-width", () => setWidth(w)); widthBtns[k] = b; widthGroup.appendChild(b); });

  const textSizeGroup = grp(); textSizeGroup.classList.add("wb-text-size-group", "wb-toolvis-textsize");
  const textSizeLabel = document.createElement("label"); textSizeLabel.className = "wb-text-size-control";
  textSizeCaption = document.createElement("span"); textSizeCaption.textContent = "글자";
  textSizeInput = document.createElement("input"); textSizeInput.type = "number"; textSizeInput.className = "wb-text-size-input";
  textSizeInput.min = String(WB_TEXT_SIZE_MIN); textSizeInput.max = String(WB_TEXT_SIZE_MAX); textSizeInput.step = "1"; textSizeInput.inputMode = "numeric";
  textSizeInput.value = String(wb.textSize); textSizeInput.title = "글자 크기 직접 입력 (12~72px)"; textSizeInput.setAttribute("aria-label", textSizeInput.title);
  textSizeUnit = document.createElement("span"); textSizeUnit.textContent = "px";
  bindTextSizeInput(textSizeInput); textSizeLabel.append(textSizeCaption, textSizeInput, textSizeUnit); textSizeGroup.appendChild(textSizeLabel);

  const zoomGroup = grp(); zoomGroup.classList.add("wb-toolvis-zoom");
  zoomOutBtn = mkBtn("−", "화이트보드 화면 축소", "wb-act wb-zoom-step", () => setViewScale(view.scale / 1.25));
  zoomLabelBtn = mkBtn(Math.round(view.scale * 100) + "%", "화이트보드 배율 100%로 초기화", "wb-act wb-zoom-label", resetView);
  zoomInBtn = mkBtn("+", "화이트보드 화면 확대", "wb-act wb-zoom-step", () => setViewScale(view.scale * 1.25));
  zoomGroup.append(zoomOutBtn, zoomLabelBtn, zoomInBtn);

  const focusGroup=grp(); focusGroup.classList.add("wb-toolvis-focus");
  focusToolBtn=mkBtn("◉","집중 도구 — 스포트라이트·화면 가리개","wb-act wb-focus-toggle",()=>toggleFocusPanel());
  focusToolBtn.setAttribute("aria-controls",focusPanel.id); focusToolBtn.setAttribute("aria-expanded","false"); focusToolBtn.setAttribute("aria-pressed",String(focus.active));
  focusGroup.appendChild(focusToolBtn);

  // ----- 교구(자·각도기·컴퍼스)와 손그림 정리 -----
  const gearGroup = grp();
  const rulerBtn = mkIconBtn("ruler", "자 — 대고 그으면 곧게 그려지고 cm 눈금이 보입니다 (길이 2~40cm 조절)", "wb-act wb-gear wb-toolvis-ruler", () => {
    const on = setGear("ruler");
    if (on && typeof toast === "function") toast("자를 놓았어요. 몸통을 끌어 옮기고, 오른쪽 동그라미로 돌리고, 왼쪽 동그라미를 끌어 길이를 40cm까지 늘립니다.", 3600);
  });
  const protractorBtn = mkIconBtn("protractor", "각도기 — 가운데에서 시작해 그으면 각도가 1°씩 맞춰집니다 (밑변 4~30cm 조절)", "wb-act wb-gear wb-toolvis-protractor", () => {
    const on = setGear("protractor");
    if (on && typeof toast === "function") toast("각도기를 놓았어요. 가운데 점에서 시작해 그으면 각도가 표시되고, 왼쪽 동그라미를 끌면 크기가 커집니다.", 3600);
  });
  const compassBtn = mkIconBtn("compass", "컴퍼스 — 연필 손잡이를 돌리면 호와 원이 그려집니다 (반지름 2~30cm 조절)", "wb-act wb-gear wb-toolvis-compass", () => {
    const on = setGear("compass");
    if (on && typeof toast === "function") toast("컴퍼스를 놓았어요. 가운데=바늘, 중간 손잡이를 끌면 반지름이 2~30cm로 벌어지고, 끝 손잡이를 돌리면 호가 그려집니다.", 3600);
  });
  const snapBtn = mkBtn("15°", "각도 맞추기 — 직선·화살표를 15°씩 맞춰 긋습니다 (Shift 를 눌러도 같아요)", "wb-act wb-gear wb-gear-snap wb-toolvis-snap", () => {
    gear.snap = !gear.snap; saveGearPrefs(); syncGearButtons();
  });
  const tidyBtn = mkIconBtn("tidy", "손그림 정리 — 대충 그린 동그라미·세모·네모를 반듯하게 바꿔 줍니다", "wb-act wb-gear wb-toolvis-tidy", () => {
    gear.tidy = !gear.tidy; saveGearPrefs(); syncGearButtons();
    if (typeof toast === "function") toast(gear.tidy ? "손그림 정리를 켰어요. 크게 그린 도형만 반듯하게 바꿉니다(글씨는 그대로)." : "손그림 정리를 껐어요.", 2600);
  });
  const measureToolBtn = mkIconBtn("measure", "측정 — 고른 도형의 길이·각도·넓이를 붙입니다(도형을 끌면 값이 따라 바뀜)", "wb-act wb-gear wb-toolvis-measure", () => toggleMeasureOnSelection());
  const vectorSumBtn = mkIconBtn("vectorsum", "벡터 합성 — 같은 점에서 출발한 두 화살표의 합력을 붙입니다(화살표를 끌면 따라 바뀜)", "wb-act wb-gear wb-toolvis-vectorsum", () => toggleVectorSumOnSelection());
  transformToolBtn = mkIconBtn("transform", "변환 — 고른 도형을 대칭·회전·평행이동·닮음으로 바꿉니다", "wb-act wb-gear wb-toolvis-transform", () => toggleTransformPanel());
  transformToolBtn.setAttribute("aria-controls", transformPanel.id); transformToolBtn.setAttribute("aria-expanded", "false");
  gearGroup.append(rulerBtn, protractorBtn, compassBtn, snapBtn, tidyBtn, measureToolBtn, vectorSumBtn, transformToolBtn);
  syncGearButtons = () => {
    const states = [[rulerBtn, !!gear.ruler], [protractorBtn, !!gear.protractor], [compassBtn, !!gear.compass], [snapBtn, !!gear.snap], [tidyBtn, !!gear.tidy]];
    for (const [button, on] of states){ button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); }
  };
  syncGearButtons();

  const imgGroup = grp();
  eduToolBtn = mkBtn("∑", "수학·과학 도구상자", "wb-act wb-edu-toggle wb-toolvis-education", () => toggleEducationPanel());
  eduToolBtn.setAttribute("aria-controls", eduPanel.id); eduToolBtn.setAttribute("aria-expanded", "false");
  const plotToolBtn = mkIconBtn("plot", "함수 그래프 — 식을 치면 실제로 계산한 곡선을 넣습니다", "wb-act wb-toolvis-plot", () => { eduCategory = "graph"; toggleEducationPanel(true); });
  const chartToolBtn = mkIconBtn("chart", "자료 차트 — 표 숫자로 막대·꺾은선·원그래프를 만듭니다", "wb-act wb-toolvis-chart", () => { eduCategory = "chart"; toggleEducationPanel(true); });
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = ".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.avif,.ico"; fileInput.hidden = true;
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; if (f) insertImageBlob(f); fileInput.value = ""; });
  function openImageFilePicker(){
    // 전용 picker API는 합성 click 경로보다 브라우저가 파일 선택창을 바로 준비할 수 있어
    // Windows 탐색기 UI가 덜 그려진 첫 프레임이 노출되는 시간을 줄인다.
    try {
      if (typeof fileInput.showPicker === "function"){ fileInput.showPicker(); return; }
    } catch(_){}
    fileInput.click();
  }
  /* 지도 넣기 — map-viewer.js 의 지도 고르기 창을 띄워 고른 화면을 그림으로 받아 넣는다.
     map-viewer 는 이 파일보다 뒤에 실행되므로 있는지 확인하고 부른다(순환 참조라 어느 쪽을
     먼저 싣든 한쪽은 실행 시점에 확인해야 한다 — 지도 쪽도 newWhiteboard 를 같은 방식으로 부른다). */
  const insertMapFromPicker = async () => {
    if (typeof openMapPicker !== "function"){
      if (typeof toast === "function") toast("지도를 열 수 없어요.", 2200);
      return;
    }
    const png = await openMapPicker();
    if (!png) return;                                  // 취소
    const placed = await doc.insertBoardImage(png);
    if (!placed && typeof toast === "function") toast("지도를 넣지 못했어요.", 2200);
  };
  const mapToolBtn = mkIconBtn("map", "지도 넣기 — 자리를 골라 배경지도를 그림으로 넣습니다", "wb-act wb-map wb-toolvis-map", insertMapFromPicker);
  /* 환율 넣기 — exchange-rate-ui.js 의 환율 창을 "이 보드에 넣기" 모드로 띄운다.
     새 칠판을 만드는 팔레트 쪽(Ctrl+K → 환율)과 달리, 여기서는 지금 서 있는 보드에 떨어뜨린다
     (지도의 openMapPicker 와 같은 짝 구조다 — 방향마다 입구가 다르다).
     색을 여기서 넣어 주는 까닭: 보드의 펜 색은 이 파일만 알고, 어두운 배경에서 검은 표가
     안 보이면 안 된다. */
  const insertExchangeRate = () => {
    // 환율 창은 IIFE 안에서 window 에 매달리는 모듈이라 전역 이름이 아니다 — window 로 짚는다.
    if (typeof window.openExchangeRate !== "function"){
      if (typeof toast === "function") toast("환율을 열 수 없어요.", 2200);
      return;
    }
    window.openExchangeRate({
      board: {
        insertTable: (rows, opts) => doc.insertBoardTable(rows, opts),
        insertChart: (spec) => doc.insertBoardChart(Object.assign({ axisColor:boardInkColor() }, spec))
      }
    });
  };
  const rateToolBtn = mkIconBtn("exchange", "환율 넣기 — 고시환율 표나 추이 그래프를 이 보드에 넣습니다", "wb-act wb-rate wb-toolvis-rate", insertExchangeRate);
  /* 환율은 런처가 대신 받아 줘야만 되는 기능이다(수출입은행·ECB 모두 브라우저에서 직접 못 부른다).
     능력이 없으면 버튼을 아예 내놓지 않는다 — 눌러도 늘 "런처로 열어야 해요"만 뜨는 버튼은
     없느니만 못하다. 프로브가 끝날 때까지는 감춰 두고, 된다고 답할 때만 꺼낸다. */
  rateToolBtn.hidden = true;
  if (typeof window.exchangeRatesAvailable === "function"){
    window.exchangeRatesAvailable().then((ok) => { if (ok) rateToolBtn.hidden = false; }).catch(() => {});
  }
  const imageToolBtn = mkIconBtn("image", "이미지 넣기 — 파일 선택 (또는 Ctrl+V 붙여넣기·드래그드롭)", "wb-act wb-toolvis-image", openImageFilePicker);
  imgGroup.append(eduToolBtn, plotToolBtn, chartToolBtn, mapToolBtn, rateToolBtn, imageToolBtn, fileInput);

  const actGroup = grp();
  undoBtn = mkIconBtn("undo", "되돌리기 (Ctrl+Z)", "wb-act", doUndo);
  redoBtn = mkIconBtn("redo", "다시 실행 (Ctrl+Y)", "wb-act", doRedo);
  flipXBtn = mkBtn("↔", "선택한 이미지 또는 교육 도형 좌우 반전", "wb-act wb-flip-x wb-toolvis-flipx", () => flipSelected("flipX")); flipXBtn.disabled = true;
  flipYBtn = mkBtn("↕", "선택한 이미지 또는 교육 도형 상하 반전", "wb-act wb-flip-y wb-toolvis-flipy", () => flipSelected("flipY")); flipYBtn.disabled = true;
  groupActionBtn = mkBtn("분리", "선택한 교육 도형의 그룹 풀기", "wb-act wb-ungroup wb-toolvis-ungroup", ungroupSelected); groupActionBtn.disabled = true;
  const clearBtn = mkIconBtn("trash", "보드 전체 지우기", "wb-act wb-clear wb-toolvis-clear", confirmClearAll);
  actGroup.append(undoBtn, redoBtn, flipXBtn, flipYBtn, groupActionBtn, clearBtn);

  const exportGroup = grp();
  exportGroup.append(
    mkBtn("PNG", "PNG 이미지로 저장", "wb-act wb-toolvis-png", exportPng),
    mkBtn("PDF", "PDF로 저장", "wb-act wb-toolvis-pdf", exportPdf),
    mkBtn("메모로", "메모창으로 보내기 — 메모에서 '✏️ 화이트보드로'를 누르면 다시 편집할 수 있어요", "wb-act wb-toolvis-memo", sendToMemo)
  );

  // ----- 수업 리플레이 녹화 -----
  // ● 녹화 → 판서를 시간순으로 기록, ■ 정지 → 리플레이(되감아 보기) 화면을 만든다.
  const recGroup = grp();
  const recBtn = mkBtn("● 녹화", "수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요", "wb-act wb-rec wb-toolvis-record", () => toggleRecord());
  recGroup.appendChild(recBtn);
  function syncRecordButtons(){
    const recording=!!(doc.recorder&&doc.recorder.active);
    recBtn.classList.toggle("recording",recording);
    recBtn.textContent=recording?"■ 정지":"● 녹화";
    recBtn.title=recording?"녹화 정지 — 지금까지 판서를 리플레이로 만들기":"수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요";
    contextRecordBtn.classList.toggle("recording",recording); contextRecordBtn.classList.toggle("wb-context-danger",recording);
    contextRecordBtn.textContent=recording?"■ 녹화 정지":"● 녹화 시작";
    contextRecordBtn.title=recording?"녹화를 정지하고 수업 리플레이 만들기":"수업 리플레이 녹화 시작";
    contextRecordBtn.setAttribute("aria-label",contextRecordBtn.title);
  }
  function toggleRecord(){
    if (typeof LessonRecorder !== "function"){ if (typeof toast === "function") toast("리플레이 기능을 불러오지 못했어요.", 2400); return; }
    if (doc.recorder && doc.recorder.active){
      const lesson = doc.recorder.stop(wb.items, wb.bg, { W, H }, { pattern:wb.bgPattern, image:wb.bgImage });
      doc.recorder = null;
      syncRecordButtons();
      if (lesson && lesson.keyframes.length > 1 && typeof finishLessonRecording === "function") finishLessonRecording(lesson, doc.name);
      else if (typeof toast === "function") toast("녹화된 판서가 없어요.", 2000);
    } else {
      doc.recorder = LessonRecorder(wb.items, wb.bg, { W, H }, { pattern:wb.bgPattern, image:wb.bgImage });
      syncRecordButtons();
      if (typeof toast === "function") toast("녹화를 시작했어요. 판서한 뒤 ■ 정지를 누르면 리플레이가 만들어져요.", 3000);
    }
  }

  // 도구막대 표시 여부와 위치는 모든 화이트보드에서 이어 쓰는 화면 환경설정으로 기억한다.
  const readToolbarVisible = () => { try { return localStorage.getItem("wbToolbarVisible") !== "false"; } catch(_){ return true; } };
  let toolbarVisible = readToolbarVisible();
  const applyToolbarVisible = () => { tools.hidden = !toolbarVisible; };
  const saveToolbarVisible = () => { try { localStorage.setItem("wbToolbarVisible", String(toolbarVisible)); } catch(_){} };
  function setToolbarVisible(visible){
    toolbarVisible=!!visible; applyToolbarVisible(); saveToolbarVisible();
    requestAnimationFrame(resize);
  }
  function toggleToolbarVisibility(){
    const next=!toolbarVisible; setToolbarVisible(next);
    if(typeof toast==="function")toast(next?"편집 도구막대를 표시했어요.":"편집 도구막대를 숨겼어요. 보드 우클릭 메뉴에서 다시 표시할 수 있어요.",next?1300:2400);
  }
  applyToolbarVisible();

  // 도구막대 위치(상/우/하/좌) — ⋮⋮ 핸들을 끌면 마우스에서 가장 가까운 변에 자동 도킹.
  const POS_SEQ = ["top", "right", "bottom", "left"];
  const readPos = () => { try { const v = localStorage.getItem("wbToolbarPos"); return POS_SEQ.includes(v) ? v : "top"; } catch(_){ return "top"; } };
  let curPos = readPos();
  const applyPos = (p) => { POS_SEQ.forEach(x => wrap.classList.toggle("tb-pos-" + x, x === p)); };
  const savePos = (p) => { try { localStorage.setItem("wbToolbarPos", p); } catch(_){} };
  function setToolbarPosition(position){
    if(!POS_SEQ.includes(position))return;
    curPos=position; applyPos(curPos); savePos(curPos);
  }
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

  tools.append(posGroup, toolGroup, colorGroup, bgGroup, widthGroup, textSizeGroup, zoomGroup, focusGroup, gearGroup, imgGroup, actGroup, exportGroup, recGroup);
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
    if (e.code === "Space" && !backgroundViewLocked() && !interactive && eduPanel.hidden && bgPanel.hidden && focusPanel.hidden && transformPanel.hidden){
      e.preventDefault(); e.stopPropagation(); spacePanning = true; canvas.classList.add("pan-ready"); return;
    }
    if (e.key === "Escape" && !bgPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleBackgroundPanel(false); bgToggleBtn.focus(); return;
    }
    if (e.key === "Escape" && !eduPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleEducationPanel(false); return;
    }
    if (e.key === "Escape" && !transformPanel.hidden){
      e.preventDefault(); e.stopPropagation();
      if (transformPickPivot){ transformPickPivot = false; syncTransformPanel(); redraw(); return; }
      toggleTransformPanel(false); if (transformToolBtn) transformToolBtn.focus(); return;
    }
    if (e.key === "Escape" && !focusContextMenu.hidden){ e.preventDefault(); e.stopPropagation(); closeFocusContextMenu(); return; }
    if (e.key === "Escape" && !focusPanel.hidden){
      e.preventDefault(); e.stopPropagation(); toggleFocusPanel(false); if (focusToolBtn) focusToolBtn.focus(); return;
    }
    if (e.key === "Escape" && focus.active){
      e.preventDefault(); e.stopPropagation();
      if (focus.controlsVisible){
        setFocusControlsVisible(false);
        if (typeof toast==="function") toast("집중 도구 조절점을 숨겼어요. Esc를 한 번 더 누르면 종료됩니다.",1800);
      } else stopFocus();
      return;
    }
    if (!bgPanel.hidden && ae && bgPanel.contains(ae)) return;
    if (!eduPanel.hidden && ae && eduPanel.contains(ae)) return;
    if (!focusPanel.hidden && ae && focusPanel.contains(ae)) return;
    if (!transformPanel.hidden && ae && transformPanel.contains(ae)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); doRedo(); }
    } else if ((e.key === "Delete" || e.key === "Backspace") && wb.selected){      // 선택한 이미지·도형·텍스트 삭제
      e.preventDefault(); e.stopPropagation();
      deleteSelected();
    } else if (e.key === "Escape" && wb.selected){ wb.selected = null; redraw(); }   // 선택 해제
    else if (e.key === "Escape" && (gear.ruler || gear.protractor || gear.compass)){  // 꺼낸 교구 치우기
      e.preventDefault(); e.stopPropagation();
      gear.ruler = null; gear.protractor = null; gear.compass = null;
      syncGearButtons(); redraw();
    }
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
  restoreBoardBackgroundImage();
  requestAnimationFrame(resize);

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { clearTimeout(boardRecoveryTimer); clearTimeout(focusFlashTimer); if (hoverFrame) cancelAnimationFrame(hoverFrame); if (focusDragCleanup) focusDragCleanup(); if (doc.recorder) doc.recorder.active = false; stage.removeEventListener("contextmenu",onFocusContextMenu); focusContextMenu.remove(); document.removeEventListener("pointerdown", onPointerDownOutside, true); document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onKeyUp, true); window.removeEventListener("blur", onWindowBlur); document.removeEventListener("copy", onCopy); document.removeEventListener("cut", onCut); document.removeEventListener("paste", onPaste); if (ro) ro.disconnect(); if (focusFloat) focusFloat.destroy(); if (eduFloat) eduFloat.destroy(); imageUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_){} }); });
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    boardStateFromSnapshot, boardRecoveryKey, chooseBoardSnapshot, boardSnapshotBg,
    whiteboardClipboardItem, whiteboardDetachedClipboardItem, whiteboardGraphUsesManualY,
    setWhiteboardInternalClipboard, getWhiteboardInternalClipboard, hasWhiteboardInternalClipboard,
    whiteboardRecolorItem, whiteboardItemColor, whiteboardCanFlipItem, whiteboardFormulaReplacementRect, whiteboardPresetResizeItem, normalizeWhiteboardTextSize, normalizeWhiteboardObjectScale, whiteboardObjectScalePercent,
    whiteboardEducationCatalog, whiteboardFormulaDictionary, expandWhiteboardFormulaTemplate, whiteboardFormulaNeedsInput, normalizeWhiteboardFormulaLibrary,
    whiteboardStencilSvg, whiteboardStencilGroup, whiteboardVectorGroupSvg, whiteboardFormulaSvg, whiteboardSvgDataUrl,
    whiteboardClampView, whiteboardZoomAt,
    normalizeWhiteboardFocusState, whiteboardFocusGeometry, whiteboardFocusAllowsPoint, whiteboardFlashlightGeometry
  };
}
