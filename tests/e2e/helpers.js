// e2e 공용 준비 동작.

// 본문(편집기·캔버스·표)을 직접 클릭·드래그하는 테스트는 사이드바를 접은 채로 시작한다.
//
// 사이드바는 본문을 밀어내지 않고 그 위에 뜨는 서랍이라, 열려 있는 동안 #sidebarBackdrop 이
// 본문 전체를 덮고 클릭을 가져간다(서랍 바깥을 누르면 닫히는 동작). 새 프로필은 사이드바가
// 열린 상태로 시작하므로, 그대로 두면 본문을 겨냥한 클릭이 전부 백드롭에 막힌다.
// 여기서 만드는 상태는 "사용자가 서랍을 한 번 닫아 둔" 것과 같다(localStorage 에 남는 값).
//
// 서랍이 열려 있을 때의 동작 자체는 sidebar-overlay.spec.js 가 따로 지킨다.
async function collapseSidebar(page){
  await page.addInitScript(() => { try { localStorage.setItem("sidebarCollapsed", "true"); } catch(_){} });
}

module.exports = { collapseSidebar };
