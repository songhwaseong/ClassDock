"use strict";

/* OpenScore Lieder의 CC0 카탈로그를 로컬에서 검색하고, 고른 MXL만 내려받아 기존 MusicXML
   가져오기 경로로 넘긴다. 카탈로그 자체는 빌드에 들어가므로 검색은 오프라인에서도 된다. */
const MNMusicLibrary = (() => {
  const catalog = (typeof MNOpenScoreCatalog === "object" && MNOpenScoreCatalog)
    ? MNOpenScoreCatalog : { scores:[], provider:"OpenScore", license:"CC0-1.0", projectUrl:"" };
  const aliases = Object.freeze({
    beethoven:"베토벤", brahms:"브람스", schubert:"슈베르트", schumann:"슈만",
    mozart:"모차르트", haydn:"하이든", mendelssohn:"멘델스존", liszt:"리스트",
    mahler:"말러", strauss:"슈트라우스", wagner:"바그너", wolf:"볼프",
    faure:"포레", fauré:"포레", bizet:"비제", berlioz:"베를리오즈", grieg:"그리그",
    tchaikovsky:"차이콥스키", rachmaninoff:"라흐마니노프", mussorgsky:"무소륵스키",
    debussy:"드뷔시", ravel:"라벨", handel:"헨델", bach:"바흐"
  });
  const featured = ["Schubert", "Schumann", "Beethoven", "Brahms", "Mozart", "Grieg", "Fauré", "Bizet"];

  function normalized(value){
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
  function searchable(score){
    const surname = normalized(score.composer).split(" ")[0];
    const alias = aliases[surname] || "";
    return normalized([score.title, score.composer, score.set, score.lyricist, score.language, alias].join(" "));
  }
  const indexed = catalog.scores.map((score, order) => ({ score, order, search:searchable(score) }));

  function search(query, language = ""){
    const words = normalized(query).split(" ").filter(Boolean);
    const lang = String(language || "").toUpperCase();
    const found = indexed.filter((item) => (!lang || item.score.language === lang)
      && words.every((word) => item.search.includes(word)));
    if (words.length) return found.map((item) => item.score);
    return found.sort((a, b) => {
      const rankA = featured.findIndex((name) => a.score.composer.includes(name));
      const rankB = featured.findIndex((name) => b.score.composer.includes(name));
      const safeA = rankA < 0 ? featured.length : rankA;
      const safeB = rankB < 0 ? featured.length : rankB;
      return safeA - safeB || a.order - b.order;
    }).map((item) => item.score);
  }

  function safeFilename(score){
    const base = `${score.title} - ${score.composer}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, 150) || "OpenScore 악보";
    return base + ".mxl";
  }

  async function importScore(score, button, status){
    if (typeof loadMusicXml !== "function") throw new Error("MusicXML 가져오기 기능을 준비하지 못했어요.");
    const oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = "받는 중…";
    status.textContent = `‘${score.title}’ 악보를 내려받는 중이에요.`;
    try {
      const response = await fetch(score.mxl, { mode:"cors" });
      if (!response.ok) throw new Error(`악보 서버가 ${response.status} 오류를 보냈어요.`);
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) throw new Error("내려받은 악보가 비어 있어요.");
      const file = new File([bytes], safeFilename(score), { type:"application/vnd.recordare.musicxml" });
      const made = await loadMusicXml(file, {
        importAsSheet:true,
        sourceKey:score.mxl,
        sourceMetadata:{
          provider:catalog.provider,
          license:catalog.license,
          title:score.title,
          composer:score.composer,
          url:score.mxl,
          projectUrl:catalog.projectUrl,
          imslp:score.imslp
        }
      });
      if (!made) throw new Error("악보를 열지 못했어요.");
      status.textContent = "새 편집 악보로 가져왔어요.";
      return made;
    } catch(error){
      status.textContent = error && error.message ? error.message : "악보를 가져오지 못했어요.";
      status.classList.add("is-error");
      throw error;
    } finally {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }

  function externalLink(label, href){
    const link = document.createElement("a");
    link.textContent = label;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function open(){
    const existing = document.querySelector(".music-library-modal");
    if (existing){ existing.querySelector("input")?.focus(); return existing; }

    const modal = document.createElement("div");
    modal.className = "modal music-library-modal";
    const card = document.createElement("div");
    card.className = "modal-card music-library-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "무료 악보 가져오기");

    const title = document.createElement("h3");
    title.textContent = "무료 악보 가져오기";
    const sub = document.createElement("p");
    sub.className = "sub music-library-sub";
    sub.textContent = `OpenScore의 CC0 악보 ${catalog.scores.length.toLocaleString()}곡을 검색합니다. 검색은 오프라인에서도 되고, 가져올 때만 인터넷이 필요해요.`;

    const controls = document.createElement("div");
    controls.className = "music-library-controls";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "제목·작곡가 검색 (예: 슈베르트, Beethoven)";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "무료 악보 검색");
    const language = document.createElement("select");
    language.setAttribute("aria-label", "가사 언어");
    const languageLabels = { "":"모든 언어", DE:"독일어", EN:"영어", FR:"프랑스어", IT:"이탈리아어", RU:"러시아어" };
    for (const code of ["", ...new Set(catalog.scores.map((score) => score.language).filter(Boolean))]){
      const option = document.createElement("option");
      option.value = code;
      option.textContent = languageLabels[code] || code;
      language.appendChild(option);
    }
    controls.append(input, language);

    const summary = document.createElement("div");
    summary.className = "music-library-summary";
    summary.setAttribute("aria-live", "polite");
    const results = document.createElement("div");
    results.className = "music-library-results";
    const status = document.createElement("div");
    status.className = "music-library-status";
    status.setAttribute("aria-live", "polite");

    const foot = document.createElement("div");
    foot.className = "music-library-foot";
    const credit = document.createElement("span");
    credit.append("출처·라이선스가 악보에 함께 저장됩니다 · ", externalLink("OpenScore Lieder", catalog.projectUrl), " · CC0 1.0");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn";
    close.textContent = "닫기";
    foot.append(credit, close);
    card.append(title, sub, controls, summary, results, status, foot);
    modal.appendChild(card);
    document.body.appendChild(modal);

    let visibleLimit = 60;
    function render(){
      status.textContent = "";
      status.classList.remove("is-error");
      const matches = search(input.value, language.value);
      summary.textContent = `${matches.length.toLocaleString()}곡` + (matches.length > visibleLimit ? ` · 앞 ${visibleLimit}곡 표시` : "");
      results.replaceChildren();
      for (const score of matches.slice(0, visibleLimit)){
        const row = document.createElement("article");
        row.className = "music-library-item";
        const text = document.createElement("div");
        text.className = "music-library-item-text";
        const name = document.createElement("strong");
        name.textContent = score.title;
        const meta = document.createElement("span");
        meta.textContent = [score.composer, score.set, score.lyricist, score.language].filter(Boolean).join(" · ");
        const links = document.createElement("span");
        links.className = "music-library-links";
        links.append(externalLink("MusicXML", score.mxl));
        if (score.imslp) links.append(" · ", externalLink("원전(IMSLP)", score.imslp));
        text.append(name, meta, links);
        const take = document.createElement("button");
        take.type = "button";
        take.className = "btn primary";
        take.textContent = "가져오기";
        take.addEventListener("click", async () => {
          try { await importScore(score, take, status); }
          catch(error){ console.warn("무료 악보 가져오기 실패:", error); }
        });
        row.append(text, take);
        results.appendChild(row);
      }
      if (matches.length > visibleLimit){
        const more = document.createElement("button");
        more.type = "button";
        more.className = "btn music-library-more";
        more.textContent = `더 보기 (${Math.min(60, matches.length - visibleLimit)}곡)`;
        more.addEventListener("click", () => { visibleLimit += 60; render(); });
        results.appendChild(more);
      }
      if (!matches.length){
        const empty = document.createElement("p");
        empty.className = "music-library-empty";
        empty.textContent = "일치하는 악보가 없어요. 원어 제목이나 작곡가 이름으로 다시 찾아보세요.";
        results.appendChild(empty);
      }
    }
    function dispose(){ modal.remove(); }
    input.addEventListener("input", () => { visibleLimit = 60; render(); });
    language.addEventListener("change", () => { visibleLimit = 60; render(); });
    close.addEventListener("click", dispose);
    modal.addEventListener("click", (event) => { if (event.target === modal) dispose(); });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape"){ event.preventDefault(); dispose(); }
    });
    render();
    requestAnimationFrame(() => input.focus());
    return modal;
  }

  return Object.freeze({ open, search, count:catalog.scores.length, catalog });
})();
