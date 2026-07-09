/* 테마 즉시 적용(깜빡임 방지): 저장값 없으면 OS 설정을 따름 */
  (function(){
    try{
      var t = localStorage.getItem("theme");
      if (t !== "light" && t !== "dark")
        t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", t);
    }catch(e){}
  })();
