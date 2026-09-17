/* 테마 즉시 적용(깜빡임 방지): 저장값 없으면 OS 설정을 따름 */
  (function(){
    try{
      var t = localStorage.getItem("theme");
      if (t !== "light" && t !== "dark")
        t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      var lightBackground = localStorage.getItem("lightBackground");
      // custom = 사용자가 색 고르개로 고른 색. 저장된 색이 망가졌으면 기본으로 돌린다.
      var lightBackgroundColor = String(localStorage.getItem("lightBackgroundColor") || "").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(lightBackgroundColor)) lightBackgroundColor = "";
      if (lightBackground === "custom" && !lightBackgroundColor) lightBackground = "cool";
      if (["cool", "warm", "mint", "lavender", "sky", "custom"].indexOf(lightBackground) < 0) lightBackground = "cool";
      if (lightBackground === "custom" && document.documentElement.style)
        document.documentElement.style.setProperty("--light-custom-bg", lightBackgroundColor);
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-light-background", lightBackground);
    }catch(e){}
  })();
