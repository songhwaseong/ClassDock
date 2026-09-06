"use strict";

/* ===== 파일 내려받기 공용 =====
   "Blob 을 만들어 사용자에게 파일로 준다"는 20여 개 파일에서 25번 되풀이되던 여섯 줄이다.
   줄 수가 아까워서 모은 게 아니라, 그 여섯 줄 중 하나(해제)를 빠뜨리기 쉬워서 모았다 —
   실제로 빠뜨린 자리가 있었다.

   왜 이렇게 생겼는지(되돌리기 쉬운 순서라 적어 둔다):
   · <a> 를 문서에 붙였다 뗀다 — 붙지 않은 요소의 click() 을 무시하는 브라우저가 있다.
   · 곧바로 revokeObjectURL 하지 않는다 — 주소가 사라지면 브라우저가 아직 읽기 시작하지
     않은 큰 파일을 놓친다. 읽기 시작할 틈만 준 뒤 놓는다.
   · 그래서 큰 파일을 주는 쪽은 revokeAfterMs 로 그 틈을 늘린다(영상 60초, PDF 4초).

   참고: 모든 Object URL 이 여기로 오는 건 아니다. 화면에 계속 걸어 두는 주소
   (pdf.js 워커의 workerSrc 처럼 앱이 살아 있는 동안 살아 있어야 하는 것)는 해제하면
   안 되므로 여기 대상이 아니다. */
const MNDownload = (() => {
  const DEFAULT_REVOKE_MS = 1000;

  function saveBlob(blob, name, options){
    const opts = options || {};
    if (!blob) return false;
    try {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = String(name == null ? "" : name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      const wait = Number(opts.revokeAfterMs);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_){} },
        Number.isFinite(wait) && wait > 0 ? wait : DEFAULT_REVOKE_MS);
      return true;
    } catch(_){
      return false;   // 부르는 쪽이 저마다의 안내를 띄운다(여기서 toast 를 띄우면 두 번 뜬다)
    }
  }

  // 글자를 파일로. mime 을 안 주면 UTF-8 일반 텍스트로 본다.
  function saveText(text, name, mime, options){
    try { return saveBlob(new Blob([text], { type:mime || "text/plain;charset=utf-8" }), name, options); }
    catch(_){ return false; }
  }

  return Object.freeze({ saveBlob, saveText, DEFAULT_REVOKE_MS });
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNDownload;
