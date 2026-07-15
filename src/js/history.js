"use strict";

/* ===== 편집기 공용 되돌리기/다시실행 =====
   PDF·표·이미지·화이트보드·파이썬 편집기가 저마다 만들던 스냅샷 스택을 하나로 모은다.
   각 편집기는 "상태를 어떻게 뜨고(capture) 어떻게 되돌리는지(apply)"만 알려주고,
   스택·상한·redo 무효화·버튼 상태·연속 입력 묶기는 여기서 공통으로 처리한다.

   불변 조건: entries[index] 는 항상 화면의 현재 상태와 같다.
   그래서 편집을 마친 뒤 commit() 을 부른다(편집 직전이 아니라).
   canUndo/canRedo 가 capture() 없이 index 만으로 결정되어 버튼 갱신이 싸다.

   isEqual 을 반드시 넘겨야 하는 이유: undo() 는 아직 기록 안 된 현재 상태를 먼저
   commit() 해서 확정한다. 이때 "안 바뀌었으면 쌓지 않는다"를 판정하지 못하면
   capture() 가 매번 새 객체를 주는 편집기(배열·객체 스냅샷)에서 undo 가 방금 만든
   같은 상태로 되돌아가 아무 일도 안 하게 된다. 조용히 깨지는 종류라 필수로 받는다. */

const MNEditHistory = (() => {

// 스냅샷 하나의 무게가 편집기마다 달라서(글자 몇 줄 vs 시트 전체 복제) 상한은 종류별로 둔다.
// 한곳에 모아 두면 "탭마다 되돌리기 깊이가 왜 다른지" 비교하기 쉽다.
const LIMITS = Object.freeze({
  text: 300,      // 문자열 스냅샷 — 가벼워서 깊게 쌓아도 된다
  board: 140,     // 벡터 항목 배열
  image: 50,      // 이미지 참조 + 도형 배열
  pdf: 50,        // 직렬화한 요소·페이지·목차
  sheet: 40,      // 시트 전체 복제 — 가장 무겁다
  notebook: 24,   // ipynb 전체 문자열 — 개수와 함께 총량(maxBytes)도 건다
});

function create(options){
  const opt = options || {};
  const capture = opt.capture;
  const apply = opt.apply;
  const isEqual = opt.isEqual;
  if (typeof capture !== "function" || typeof apply !== "function" || typeof isEqual !== "function") {
    throw new Error("MNEditHistory.create: capture/apply/isEqual 가 모두 필요합니다.");
  }
  const limit = Math.max(2, opt.limit || LIMITS.pdf);
  const onChange = typeof opt.onChange === "function" ? opt.onChange : null;
  // 한 단계의 크기가 들쭉날쭉한 편집기(노트북: 출력·이미지까지 들어간 ipynb 전체)는
  // 단계 수만으로는 메모리를 못 막는다. sizeOf 를 주면 총량 상한도 함께 건다.
  const sizeOf = typeof opt.sizeOf === "function" ? opt.sizeOf : null;
  const maxBytes = (sizeOf && opt.maxBytes > 0) ? opt.maxBytes : 0;

  const trim = () => {
    while (entries.length > limit) entries.shift();
    if (!maxBytes) return;
    let total = 0;
    for (const entry of entries) total += sizeOf(entry);
    while (entries.length > 1 && total > maxBytes){
      total -= sizeOf(entries[0]);
      entries.shift();
    }
  };

  let entries = [], index = -1, applying = false, timer = 0;

  const cancelPending = () => { if (timer){ clearTimeout(timer); timer = 0; } };

  const commit = () => {
    cancelPending();
    if (applying) return false;                 // 되돌리는 중 일어난 변경은 새 기록이 아니다
    const state = capture();
    if (index >= 0 && isEqual(entries[index], state)) return false;
    entries.length = index + 1;                 // 되돌린 뒤 새로 편집하면 앞쪽(redo) 기록은 버린다
    entries.push(state);
    trim();
    index = entries.length - 1;
    if (onChange) onChange();
    return true;
  };

  const applyEntry = (state) => {
    applying = true;
    try { apply(state); } finally { applying = false; }
  };

  const api = {
    // 편집기를 열었을 때 호출 — 현재 화면을 기준점으로 삼는다.
    reset(){ cancelPending(); entries = [capture()]; index = 0; if (onChange) onChange(); },
    commit,
    // 연속 입력을 한 단계로 묶는다(타자·드래그).
    commitSoon(ms){ if (applying) return; cancelPending(); timer = setTimeout(() => { timer = 0; commit(); }, ms > 0 ? ms : 0); },
    flush(){ if (timer) commit(); },
    // 문서를 닫을 때 — 묶는 중이던 입력을 버린다(사라진 화면을 capture 하지 않게).
    cancel(){ cancelPending(); },
    // 새 편집이 시작돼 앞쪽(redo) 갈래가 무효가 됐을 때. 편집을 마친 뒤 commit 하는 편집기는
    // commit 이 알아서 버리므로 쓸 일이 없고, 편집 "직전"에 기록하는 편집기(표)가 쓴다.
    dropRedo(){
      if (entries.length <= index + 1) return false;
      entries.length = index + 1;
      if (onChange) onChange();
      return true;
    },
    undo(){
      commit();                                 // 묶는 중이던 입력을 먼저 한 단계로 확정 → 되돌린 뒤 redo 가 가능해진다
      if (index <= 0) return false;
      index--; applyEntry(entries[index]);
      if (onChange) onChange();
      return true;
    },
    redo(){
      cancelPending();
      if (index >= entries.length - 1) return false;
      index++; applyEntry(entries[index]);
      if (onChange) onChange();
      return true;
    },
    canUndo(){ return index > 0; },
    canRedo(){ return index < entries.length - 1; },
    current(){ return index >= 0 ? entries[index] : null; },
    // 다시실행하면 갈 단계. 되돌리기 직후 "무엇을 되돌렸는지" 이름을 꺼낼 때 쓴다.
    peekRedo(){ return (index + 1 < entries.length) ? entries[index + 1] : null; },
    // 값은 그대로고 곁다리 정보만 바뀐 경우(예: 커서 위치) 새 단계를 만들지 않고 덮어쓴다.
    replaceCurrent(state){ if (index >= 0) entries[index] = state; },
    isApplying(){ return applying; },
    size(){ return entries.length; },
  };
  return api;
}

return Object.freeze({ create, LIMITS });
})();
