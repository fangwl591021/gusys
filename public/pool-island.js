(() => {
  "use strict";

  const ZONES = [
    { id: "shore", index: "01", title: "淺灘入門", subtitle: "先熟悉魚群靠近雙腳的感覺" },
    { id: "current", index: "02", title: "湧流挑戰", subtitle: "接觸感逐漸明顯，依自己的步調前進" },
    { id: "lagoon", index: "03", title: "彩鱗主題", subtitle: "認識不同外觀與現場特色池" }
  ];

  const POOL_ITEMS = [
    {
      id: "junior", zone: "shore", marker: "入門", title: "幼幼班",
      subtitle: "第一次來，從這裡認識魚群",
      lead: "公開旅遊紀錄將幼幼班列為初次體驗與親子常見的起點。先坐穩、慢慢入水，不必急著往下一池。",
      fish: "現場小型魚群", sensation: 1, level: "輕柔起步", source: "公開池區紀錄",
      task: "停留片刻，觀察自己是否已適應魚群靠近。"
    },
    {
      id: "pool-01", zone: "shore", marker: "01", title: "小淘氣",
      subtitle: "朱文錦小魚群，數量感鮮明",
      lead: "公開現場紀錄將 1 號池稱為「小淘氣」，魚種記錄為朱文錦。魚群較小，仍請輕柔入池，避免驚嚇魚群。",
      fish: "朱文錦", sensation: 2, level: "小魚群互動", source: "2025 公開現場紀錄",
      task: "比較剛入水與適應一段時間後的感受。"
    },
    {
      id: "pool-02", zone: "shore", marker: "02", title: "小旋風",
      subtitle: "體型略有變化，感受因人而異",
      lead: "2 號池在公開紀錄中稱為「小旋風」。不要只看魚的體型判斷感受，每個人的敏感度都不同。",
      fish: "依現場標示", sensation: 2, level: "溫和比較", source: "2025 公開現場紀錄",
      task: "放鬆雙腳，找出自己最自在的停留方式。"
    },
    {
      id: "pool-03", zone: "shore", marker: "03", title: "黑旋風",
      subtitle: "進入下一階段的比較池",
      lead: "3 號池公開名稱為「黑旋風」。適合在體驗過前兩池後，再比較魚群接觸感的差異。",
      fish: "依現場標示", sensation: 3, level: "逐步適應", source: "2025 公開現場紀錄",
      task: "記住目前最喜歡的一池，稍後可以回頭再體驗。"
    },
    {
      id: "pool-04", zone: "current", marker: "04", title: "狠角色",
      subtitle: "接觸感更清楚，先短暫試水",
      lead: "4 號池在公開紀錄中稱為「狠角色」。建議先短暫體驗，覺得不舒服就立即把腳移開，不需要勉強。",
      fish: "依現場標示", sensation: 4, level: "進階互動", source: "2025 公開現場紀錄",
      task: "先用腳底感受，避免讓較敏感的位置停留過久。"
    },
    {
      id: "pool-05", zone: "current", marker: "05", title: "重口味餓勢力",
      subtitle: "辨識度高的重口味代表池",
      lead: "5 號池的公開名稱為「重口味餓勢力大隻佬」。這一站以短暫嘗試為主，請依自己的感受隨時停止。",
      fish: "依現場標示", sensation: 5, level: "重口味挑戰", source: "2025 公開現場紀錄",
      task: "挑戰不是比賽；不適合就換池，安全比完成關卡重要。"
    },
    {
      id: "pool-06", zone: "current", marker: "06", title: "吸癢癢",
      subtitle: "大型魚視覺焦點，互動方式不同",
      lead: "6 號池公開紀錄為大型台灣鯛／紅尼羅，現場稱「吸癢癢」。魚隻看起來較大，但實際感受仍以個人與當日狀況為準。",
      fish: "台灣鯛／紅尼羅", sensation: 3, level: "大型魚互動", source: "2025 公開現場紀錄",
      task: "先觀察魚群再慢慢入池，不要突然踩踏或站立。"
    },
    {
      id: "senior", zone: "current", marker: "主題", title: "啃老族",
      subtitle: "公開池牌曾出現的趣味命名",
      lead: "「啃老族／資深員工」是公開旅遊紀錄出現過的現場趣味池名。名稱與魚群可能隨現場調整。",
      fish: "依現場標示", sensation: 4, level: "主題挑戰", source: "公開池區紀錄",
      task: "先閱讀當日池牌，再決定是否進行體驗。"
    },
    {
      id: "red", zone: "lagoon", marker: "紅", title: "紅孩兒",
      subtitle: "以外觀命名的特色魚群",
      lead: "「紅孩兒」出現在店內公開走訪紀錄的無編號特色池。請以現場當日池牌確認魚種與使用方式。",
      fish: "依現場標示", sensation: 3, level: "彩色主題池", source: "2025 公開現場紀錄",
      task: "觀察外觀差異，也留意自己的敏感度。"
    },
    {
      id: "gold", zone: "lagoon", marker: "金", title: "黃金貴族",
      subtitle: "金色系魚群的主題池名",
      lead: "「黃金貴族」是公開現場紀錄中的特色池名。實際魚群與配置可能調整，不以網路舊照片代替現場資訊。",
      fish: "依現場標示", sensation: 3, level: "彩色主題池", source: "公開現場紀錄",
      task: "找找看魚群在水中的顏色與移動方式。"
    },
    {
      id: "blue", zone: "lagoon", marker: "藍", title: "藍天使",
      subtitle: "公開紀錄中的特色池名",
      lead: "「藍天使」曾出現在店內特色池紀錄中。池名保留現場趣味，但不預設每位訪客的實際感受。",
      fish: "依現場標示", sensation: 4, level: "彩色主題池", source: "公開現場紀錄",
      task: "坐穩後再入池，手機與物品不要放在池邊。"
    },
    {
      id: "spring", zone: "lagoon", marker: "湯", title: "溫泉休息站",
      subtitle: "沒有魚的泡腳轉場",
      lead: "公開走訪紀錄曾記載店內設有不放魚的碳酸氫鈉溫泉池，可作為探索路線中的休息轉場；是否開放請依現場為準。",
      fish: "無魚池", sensation: 0, level: "休息轉場", source: "2025 公開現場紀錄",
      task: "稍作休息，再回想今天最喜歡的互動池。"
    }
  ];

  const STORAGE_KEY = "gusys_pool_island_progress_v2";
  const diceFaces = ["●", "••", "∴", "∷", "⁙", "⠿"];
  const visited = new Set(loadVisited());
  let currentIndex = -1;
  let activeZone = "all";
  let soundEnabled = true;
  let rolling = false;

  const zoneList = document.querySelector("#zoneList");
  const islandWorld = document.querySelector("#islandWorld");
  const traveler = document.querySelector("#traveler");
  const dialog = document.querySelector("#poolDialog");
  const rollButton = document.querySelector("#rollButton");
  const rollHint = document.querySelector("#rollHint");
  const diceFace = document.querySelector("#diceFace");
  const soundButton = document.querySelector("#soundButton");

  function loadVisited() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((value) => Number.isInteger(value) && value >= 0 && value < POOL_ITEMS.length) : [];
    } catch (_) {
      return [];
    }
  }

  function saveVisited() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...visited]));
    } catch (_) {}
  }

  function renderMap() {
    const fragment = document.createDocumentFragment();
    ZONES.forEach((zone) => {
      const section = document.createElement("section");
      section.className = `zone zone-${zone.id}`;
      section.dataset.zone = zone.id;

      const heading = document.createElement("header");
      heading.className = "zone-heading";
      const index = document.createElement("span");
      index.className = "zone-index";
      index.textContent = zone.index;
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      const subtitle = document.createElement("p");
      title.textContent = zone.title;
      subtitle.textContent = zone.subtitle;
      copy.append(title, subtitle);
      heading.append(index, copy);

      const route = document.createElement("span");
      route.className = "zone-route";
      route.setAttribute("aria-hidden", "true");

      const grid = document.createElement("div");
      grid.className = "pool-grid";
      POOL_ITEMS.forEach((pool, poolIndex) => {
        if (pool.zone !== zone.id) return;
        const stop = document.createElement("div");
        stop.className = "pool-stop";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pool-node";
        button.dataset.index = String(poolIndex);
        button.setAttribute("aria-label", `查看${pool.title}`);

        const marker = document.createElement("span");
        marker.className = "pool-marker";
        marker.textContent = pool.marker;
        const nodeCopy = document.createElement("span");
        const name = document.createElement("span");
        const meta = document.createElement("span");
        const state = document.createElement("span");
        name.className = "pool-name";
        meta.className = "pool-meta";
        state.className = "pool-state";
        name.textContent = pool.title;
        meta.textContent = pool.subtitle;
        state.textContent = "✓ 已探索";
        nodeCopy.append(name, meta, state);
        button.append(marker, nodeCopy);
        button.addEventListener("click", () => visitPool(poolIndex, true));
        stop.append(button);
        grid.append(stop);
      });

      section.append(heading, route, grid);
      fragment.append(section);
    });
    zoneList.append(fragment);
  }

  function updateProgress() {
    const count = visited.size;
    document.querySelector("#visitedCount").textContent = String(count);
    document.querySelector("#heroVisited").textContent = String(count);
    const ring = document.querySelector("#progressRing");
    ring.setAttribute("aria-label", `已探索 ${count} 個池區`);
    document.querySelector("#missionText").textContent = count === 0
      ? "尚未出發，先擲骰或點選任一池區。"
      : count === POOL_ITEMS.length
        ? "全島探索完成！可以回到最喜歡的池區再看看。"
        : `已走訪 ${count} 站，還有 ${POOL_ITEMS.length - count} 站等你探索。`;
    document.querySelectorAll(".pool-node").forEach((node) => {
      const index = Number(node.dataset.index);
      node.classList.toggle("is-visited", visited.has(index));
      node.classList.toggle("is-current", index === currentIndex);
    });
  }

  function moveTraveler(index) {
    const node = document.querySelector(`.pool-node[data-index="${index}"]`);
    if (!node || node.closest(".zone")?.hidden) return;
    const mapRect = islandWorld.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    traveler.style.top = `${nodeRect.top - mapRect.top + nodeRect.height / 2 - 28}px`;
    traveler.style.left = `${nodeRect.left - mapRect.left + nodeRect.width / 2 - 28}px`;
  }

  function renderSensation(level) {
    const box = document.querySelector("#dialogSensation");
    box.replaceChildren();
    for (let step = 1; step <= 5; step += 1) {
      const bar = document.createElement("span");
      bar.classList.toggle("is-on", step <= level);
      box.append(bar);
    }
    const label = document.createElement("em");
    label.textContent = level === 0 ? "休息站" : "公開紀錄的相對感受";
    box.append(label);
  }

  function fillDialog(index) {
    const pool = POOL_ITEMS[index];
    const zone = ZONES.find((item) => item.id === pool.zone);
    document.querySelector("#dialogNumber").textContent = `${zone.title} · ${pool.marker}`;
    document.querySelector("#dialogTitle").textContent = pool.title;
    document.querySelector("#dialogLead").textContent = pool.lead;
    renderSensation(pool.sensation);
    const visual = document.querySelector("#dialogVisual");
    visual.style.background = pool.zone === "shore" ? "#78ced4" : pool.zone === "current" ? "#efaa8e" : "#aaaee0";

    const facts = document.querySelector("#dialogFacts");
    facts.replaceChildren();
    [["公開魚種", pool.fish], ["探索定位", pool.level], ["這站任務", pool.task], ["資料依據", pool.source]].forEach(([term, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      facts.append(dt, dd);
    });
  }

  function openDialog(index) {
    fillDialog(index);
    if (!dialog.open) dialog.showModal();
  }

  function visitPool(index, showDetails) {
    currentIndex = index;
    visited.add(index);
    saveVisited();
    updateProgress();
    requestAnimationFrame(() => {
      moveTraveler(index);
      document.querySelector(`.pool-node[data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (showDetails) window.setTimeout(() => openDialog(index), 430);
  }

  function playChime(value) {
    if (!soundEnabled || !window.AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 330 + value * 35;
    gain.gain.setValueAtTime(.05, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .18);
    oscillator.addEventListener("ended", () => context.close(), { once: true });
  }

  async function rollDice() {
    if (rolling) return;
    rolling = true;
    rollButton.disabled = true;
    diceFace.classList.add("is-rolling");
    rollHint.textContent = "正在選擇下一站…";
    const value = Math.floor(Math.random() * 6) + 1;
    for (let turn = 0; turn < 8; turn += 1) {
      diceFace.textContent = diceFaces[Math.floor(Math.random() * diceFaces.length)];
      await new Promise((resolve) => window.setTimeout(resolve, 70));
    }
    diceFace.classList.remove("is-rolling");
    diceFace.textContent = diceFaces[value - 1];
    playChime(value);
    const next = currentIndex < 0 ? value - 1 : (currentIndex + value) % POOL_ITEMS.length;
    if (activeZone !== "all" && POOL_ITEMS[next].zone !== activeZone) applyZone("all");
    rollHint.textContent = `擲出 ${value}，前往「${POOL_ITEMS[next].title}」`;
    visitPool(next, true);
    rolling = false;
    rollButton.disabled = false;
  }

  function applyZone(zone) {
    activeZone = zone;
    document.querySelectorAll(".zone-tab").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.zone === zone);
    });
    document.querySelectorAll(".zone").forEach((section) => {
      section.hidden = zone !== "all" && section.dataset.zone !== zone;
    });
    const currentVisible = currentIndex >= 0 && (zone === "all" || POOL_ITEMS[currentIndex].zone === zone);
    traveler.hidden = !currentVisible && zone !== "all";
    if (currentVisible) requestAnimationFrame(() => moveTraveler(currentIndex));
  }

  function showAdjacent(direction) {
    currentIndex = currentIndex < 0 ? 0 : (currentIndex + direction + POOL_ITEMS.length) % POOL_ITEMS.length;
    visited.add(currentIndex);
    saveVisited();
    updateProgress();
    fillDialog(currentIndex);
    if (activeZone !== "all" && POOL_ITEMS[currentIndex].zone !== activeZone) applyZone("all");
    requestAnimationFrame(() => moveTraveler(currentIndex));
  }

  function resetProgress() {
    visited.clear();
    currentIndex = -1;
    saveVisited();
    updateProgress();
    traveler.hidden = true;
    rollHint.textContent = "沿水路前往下一站";
  }

  function loadFieldVideo() {
    const frame = document.querySelector("#videoFrame");
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/baV_VKE4QMY?playsinline=1&rel=0";
    iframe.title = "黑仔熊：礁溪湯圍溝重口味溫泉魚 VLOG";
    iframe.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    frame.replaceChildren(iframe);
  }

  async function closePage() {
    try {
      if (window.liff?.isInClient?.()) {
        window.liff.closeWindow();
        return;
      }
    } catch (_) {}
    if (history.length > 1) history.back();
    else window.location.href = "/faq.html";
  }

  async function openExternal(url) {
    try {
      if (window.liff?.isInClient?.()) {
        window.liff.openWindow({ url, external: true });
        return;
      }
    } catch (_) {}
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function initializeLiff() {
    const liffId = new URLSearchParams(location.search).get("liffId");
    if (!liffId || !window.liff) return;
    try {
      await window.liff.init({ liffId });
    } catch (error) {
      console.warn("LIFF initialization skipped:", error);
    }
  }

  renderMap();
  updateProgress();
  traveler.hidden = true;
  rollButton.addEventListener("click", rollDice);
  document.querySelector("#heroRollButton").addEventListener("click", () => {
    document.querySelector(".control-dock").scrollIntoView({ behavior: "smooth", block: "center" });
    rollDice();
  });
  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.textContent = soundEnabled ? "♪" : "×";
  });
  document.querySelectorAll(".zone-tab").forEach((button) => {
    button.addEventListener("click", () => applyZone(button.dataset.zone));
  });
  document.querySelector("#resetButton").addEventListener("click", resetProgress);
  document.querySelector("#videoPoster").addEventListener("click", loadFieldVideo, { once: true });
  document.querySelector("#dialogClose").addEventListener("click", () => dialog.close());
  document.querySelector("#previousPool").addEventListener("click", () => showAdjacent(-1));
  document.querySelector("#nextPool").addEventListener("click", () => showAdjacent(1));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.querySelector("#backButton").addEventListener("click", closePage);
  document.querySelector("#closeButton").addEventListener("click", closePage);
  document.querySelectorAll('a[target="_blank"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      openExternal(anchor.href);
    });
  });
  window.addEventListener("resize", () => {
    if (currentIndex >= 0) moveTraveler(currentIndex);
  });
  window.addEventListener("load", initializeLiff, { once: true });
})();
