(() => {
  "use strict";

  const POOL_ITEMS = [
    { id: "gentle", number: "START", title: "無編號溫和池", summary: "第一次體驗、比較怕癢時，可先從這裡開始適應。", task: "先停留片刻，感受魚群接觸後再決定下一池。", tag: "初次體驗" },
    { id: "pool-01", number: "01", title: "01 池區", summary: "第一站從觀察自己的感受開始，不必急著挑戰。", task: "比較左右腳的接觸感受是否相同。", tag: "自由探索" },
    { id: "pool-02", number: "02", title: "02 池區", summary: "每一池的魚群與互動感受不同，適合逐池比較。", task: "放鬆雙腳，留意一開始與適應後的差異。", tag: "自由探索" },
    { id: "pool-03", number: "03", title: "03 池區", summary: "感受會受個人敏感度、當日魚群狀態等因素影響。", task: "覺得不舒服時立即移開雙腳，不必勉強。", tag: "自由探索" },
    { id: "pool-04", number: "04", title: "04 池區", summary: "用自己的速度探索，比較不同池區的接觸感。", task: "坐穩後再入池，池內不要站立或踩踏。", tag: "自由探索" },
    { id: "pool-05", number: "05", title: "05 池區", summary: "來到島嶼中段，繼續找出自己最喜歡的感受。", task: "記住目前最喜歡的池區，稍後可以再回訪。", tag: "自由探索" },
    { id: "pool-06", number: "06", title: "06 池區", summary: "不同人的感受不一定相同，同行者可以互相比較。", task: "分享你的感受，但不要推擠或拉扯同行者。", tag: "自由探索" },
    { id: "pool-07", number: "07", title: "07 池區", summary: "保持輕鬆坐姿，讓魚群自然靠近雙腳互動。", task: "不要抓魚、摸魚或自行餵食。", tag: "自由探索" },
    { id: "pool-08", number: "08", title: "08 池區", summary: "逐池體驗時可隨時休息，再依現場動線前進。", task: "起身前先確認地面，避免在濕滑區域奔跑。", tag: "自由探索" },
    { id: "pool-09", number: "09", title: "09 池區", summary: "接近探索尾聲，看看這一池帶來什麼不同感受。", task: "手機與隨身物品請拿穩，避免掉入池中。", tag: "自由探索" },
    { id: "pool-10", number: "10", title: "10 池區", summary: "可回想前面各池的差異，選出想再次體驗的一池。", task: "若有任何疑問，請直接詢問現場工作人員。", tag: "自由探索" },
    { id: "pool-11", number: "11", title: "11 池區", summary: "完成最後一站後，仍可在當日開放範圍內自由探索。", task: "離開體驗區後請洗腳，並帶走自己的物品。", tag: "完成探索" }
  ];

  const diceFaces = ["●", "••", "∴", "∷", "⁙", "⠿"];
  const visited = new Set();
  let currentIndex = -1;
  let soundEnabled = true;
  let rolling = false;
  let activeFilter = "all";

  const poolList = document.querySelector("#poolList");
  const islandMap = document.querySelector("#islandMap");
  const traveler = document.querySelector("#traveler");
  const visitedCount = document.querySelector("#visitedCount");
  const rollButton = document.querySelector("#rollButton");
  const rollHint = document.querySelector("#rollHint");
  const diceFace = document.querySelector("#diceFace");
  const soundButton = document.querySelector("#soundButton");
  const dialog = document.querySelector("#poolDialog");

  function categoryFor(index) {
    if (index === 0) return "gentle";
    if (index <= 4) return "01-04";
    if (index <= 8) return "05-08";
    return "09-11";
  }

  function renderPools() {
    const fragment = document.createDocumentFragment();
    POOL_ITEMS.forEach((pool, index) => {
      const stop = document.createElement("div");
      stop.className = "pool-stop";
      stop.dataset.category = categoryFor(index);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "pool-node";
      button.dataset.index = String(index);
      button.setAttribute("aria-label", `查看${pool.title}`);

      const badge = document.createElement("span");
      badge.className = "pool-badge";
      badge.textContent = pool.number;

      const copy = document.createElement("span");
      const title = document.createElement("h3");
      title.textContent = pool.title;
      const summary = document.createElement("p");
      summary.textContent = pool.summary;
      const done = document.createElement("span");
      done.className = "visited";
      done.textContent = "✓ 已探索";
      copy.append(title, summary, done);
      button.append(badge, copy);
      button.addEventListener("click", () => visitPool(index, true));
      stop.append(button);
      fragment.append(stop);
    });
    poolList.append(fragment);
  }

  function updateProgress() {
    visitedCount.textContent = `${visited.size} / ${POOL_ITEMS.length}`;
    document.querySelectorAll(".pool-node").forEach((node) => {
      node.classList.toggle("is-visited", visited.has(Number(node.dataset.index)));
      node.classList.toggle("is-current", Number(node.dataset.index) === currentIndex);
    });
  }

  function moveTraveler(index) {
    const node = document.querySelector(`.pool-node[data-index="${index}"]`);
    if (!node || node.closest(".pool-stop").hidden) return;
    const mapRect = islandMap.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    traveler.style.top = `${nodeRect.top - mapRect.top + nodeRect.height / 2 - 25}px`;
    traveler.style.left = `${nodeRect.left - mapRect.left + nodeRect.width / 2 - 25}px`;
  }

  function fillDialog(index) {
    const pool = POOL_ITEMS[index];
    document.querySelector("#dialogNumber").textContent = `魚池島 · ${pool.number}`;
    document.querySelector("#dialogTitle").textContent = pool.title;
    document.querySelector("#dialogLead").textContent = pool.summary;
    const facts = document.querySelector("#dialogFacts");
    facts.replaceChildren();
    [["探索提示", pool.task], ["體驗類型", pool.tag], ["開放資訊", "依現場當日標示"]].forEach(([term, value]) => {
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
    updateProgress();
    requestAnimationFrame(() => {
      moveTraveler(index);
      document.querySelector(`.pool-node[data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (showDetails) window.setTimeout(() => openDialog(index), 420);
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
    rollHint.textContent = "正在尋找下一個池區…";

    const value = Math.floor(Math.random() * 6) + 1;
    for (let turn = 0; turn < 8; turn += 1) {
      diceFace.textContent = diceFaces[Math.floor(Math.random() * diceFaces.length)];
      await new Promise((resolve) => window.setTimeout(resolve, 70));
    }

    diceFace.classList.remove("is-rolling");
    diceFace.textContent = diceFaces[value - 1];
    playChime(value);
    const next = currentIndex < 0 ? value - 1 : (currentIndex + value) % POOL_ITEMS.length;
    rollHint.textContent = `擲出 ${value}，前往 ${POOL_ITEMS[next].title}`;
    visitPool(next, true);
    rolling = false;
    rollButton.disabled = false;
  }

  function applyFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll(".filter").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === filter);
    });
    document.querySelectorAll(".pool-stop").forEach((stop) => {
      stop.hidden = filter !== "all" && stop.dataset.category !== filter;
    });
    if (currentIndex >= 0 && (filter === "all" || categoryFor(currentIndex) === filter)) {
      requestAnimationFrame(() => moveTraveler(currentIndex));
      traveler.hidden = false;
    } else {
      traveler.hidden = filter !== "all";
    }
  }

  function showAdjacent(direction) {
    currentIndex = currentIndex < 0 ? 0 : (currentIndex + direction + POOL_ITEMS.length) % POOL_ITEMS.length;
    visited.add(currentIndex);
    updateProgress();
    fillDialog(currentIndex);
    if (activeFilter !== "all" && categoryFor(currentIndex) !== activeFilter) applyFilter("all");
    requestAnimationFrame(() => moveTraveler(currentIndex));
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

  async function initializeLiff() {
    const liffId = new URLSearchParams(location.search).get("liffId");
    if (!liffId || !window.liff) return;
    try {
      await window.liff.init({ liffId });
    } catch (error) {
      console.warn("LIFF initialization skipped:", error);
    }
  }

  renderPools();
  updateProgress();
  requestAnimationFrame(() => moveTraveler(0));
  rollButton.addEventListener("click", rollDice);
  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.textContent = soundEnabled ? "♪" : "×";
  });
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.filter));
  });
  document.querySelector("#dialogClose").addEventListener("click", () => dialog.close());
  document.querySelector("#previousPool").addEventListener("click", () => showAdjacent(-1));
  document.querySelector("#nextPool").addEventListener("click", () => showAdjacent(1));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.querySelector("#backButton").addEventListener("click", closePage);
  document.querySelector("#closeButton").addEventListener("click", closePage);
  window.addEventListener("resize", () => {
    if (currentIndex >= 0) moveTraveler(currentIndex);
  });
  window.addEventListener("load", initializeLiff, { once: true });
})();
