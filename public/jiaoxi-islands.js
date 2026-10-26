(() => {
  const state = {
    config: null,
    categories: [],
    places: [],
    activeCategory: "all",
    selected: null,
    plan: JSON.parse(localStorage.getItem("jiaoxi-island-plan") || "[]"),
    lineUserId: "",
    motionPaused: false,
  };
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  const sessionId = localStorage.getItem("jiaoxi-island-session") || crypto.randomUUID();
  localStorage.setItem("jiaoxi-island-session", sessionId);

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2200);
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || "讀取失敗");
    return body;
  }

  function track(eventType, extra = {}) {
    fetch("/api/jiaoxi-islands/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType, sessionId, lineUserId: state.lineUserId, ...extra }),
    }).catch(() => {});
  }

  async function initLiff() {
    try {
      if (!state.config?.liffId || !window.liff || !/[?&]liff\.state=/.test(location.search)) return;
      await liff.init({ liffId: state.config.liffId });
      if (liff.isLoggedIn()) {
        const token = liff.getDecodedIDToken();
        state.lineUserId = String(token?.sub || "");
      }
    } catch (error) {
      console.info("LIFF optional:", error.message);
    }
  }

  function openExternal(url) {
    try {
      if (window.liff?.isInClient()) {
        liff.openWindow({ url, external: true });
        return;
      }
    } catch {}
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function destination(place) {
    if (place.latitude != null && place.longitude != null) return `${place.latitude},${place.longitude}`;
    if (place.googlePlaceId) return `place_id:${place.googlePlaceId}`;
    return place.destination || `${place.name} 宜蘭縣礁溪鄉`;
  }

  function mapsUrl(place, origin = "") {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("destination", destination(place));
    if (place.googlePlaceId) url.searchParams.set("destination_place_id", place.googlePlaceId);
    if (origin) url.searchParams.set("origin", origin);
    url.searchParams.set("travelmode", place.tags?.includes("步行") ? "walking" : "driving");
    url.searchParams.set("dir_action", "navigate");
    return url.toString();
  }

  function categoryFor(key) {
    return state.categories.find(category => category.key === key) || {
      label: "島",
      title: "礁溪",
      color: "#087f70",
    };
  }

  function activateCategory(key, shouldScroll = false) {
    state.activeCategory = key;
    renderTabs();
    renderDestinations();
    if (shouldScroll) {
      requestAnimationFrame(() => $("#destinations").scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    track("category_open", { category: key });
  }

  function renderMapPins() {
    const positions = ["food", "stay", "visit", "shop", "transport"];
    $("#mapPins").innerHTML = state.categories
      .filter(category => positions.includes(category.key))
      .map(category => `
        <button class="map-pin" data-map-category="${escapeHtml(category.key)}" data-key="${escapeHtml(category.key)}" style="--pin:${escapeHtml(category.color)}">
          <b>${escapeHtml(category.label)}</b>
          <span>${escapeHtml(category.title)}島</span>
        </button>
      `).join("");
    document.querySelectorAll("[data-map-category]").forEach(button => {
      button.addEventListener("click", () => activateCategory(button.dataset.mapCategory, true));
    });
  }

  function renderTabs() {
    const tabs = [{ key: "all", label: "全部", title: "五島總覽" }, ...state.categories];
    $("#categoryTabs").innerHTML = tabs.map(category => `
      <button class="tab" data-category="${escapeHtml(category.key)}" aria-selected="${state.activeCategory === category.key}">
        ${escapeHtml(category.label)} ${escapeHtml(category.title)}
      </button>
    `).join("");
    document.querySelectorAll("[data-category]").forEach(button => {
      button.addEventListener("click", () => activateCategory(button.dataset.category));
    });
  }

  function cardMarkup(place, category, index) {
    const tags = (place.tags || []).slice(0, 2).join(" · ") || "查看完整介紹";
    const image = place.imageUrl ? `
      <div class="card-media">
        <img src="${escapeHtml(place.imageUrl)}" alt="${escapeHtml(place.name)}實景圖" loading="lazy"
          onerror="this.parentElement.hidden=true">
        <span class="card-number">${String(index + 1).padStart(2, "0")}</span>
      </div>
    ` : "";
    return `
      <button class="destination-card" data-place="${escapeHtml(place.id)}" style="--accent:${escapeHtml(category.color)}">
        ${image}
        <span class="card-copy">
          <span>${escapeHtml(category.label)} ISLAND · ${String(index + 1).padStart(2, "0")}</span>
          <strong>${escapeHtml(place.name)}</strong>
          <small>${escapeHtml(tags)}</small>
          <i class="card-arrow" aria-hidden="true">↗</i>
        </span>
      </button>
    `;
  }

  function renderDestinations() {
    const categories = state.activeCategory === "all"
      ? state.categories
      : state.categories.filter(category => category.key === state.activeCategory);

    $("#islandList").innerHTML = categories.map(category => {
      const places = state.places.filter(place => place.category === category.key);
      return `
        <section class="destination-group" data-island="${escapeHtml(category.key)}">
          <header class="group-header">
            <div class="group-title">
              <span class="group-badge" style="--accent:${escapeHtml(category.color)}">${escapeHtml(category.label)}</span>
              <div>
                <h3>${escapeHtml(category.title)}島</h3>
                <p>從重口味溫泉魚出發，探索礁溪下一站</p>
              </div>
            </div>
            <span class="group-count">${places.length} DESTINATIONS</span>
          </header>
          <div class="destination-rail">
            ${places.map((place, index) => cardMarkup(place, category, index)).join("")}
          </div>
        </section>
      `;
    }).join("") || '<div class="loading">此分類目前沒有上架地點。</div>';

    document.querySelectorAll("[data-place]").forEach(button => {
      button.addEventListener("click", () => openPlace(button.dataset.place));
    });
  }

  function openPlace(id) {
    const place = state.places.find(item => item.id === id);
    if (!place) return;
    state.selected = place;
    const category = categoryFor(place.category);
    const media = $("#sheetImage").parentElement;
    media.hidden = !place.imageUrl;
    $("#sheetImage").src = place.imageUrl || "";
    $("#sheetImage").alt = place.imageUrl ? `${place.name}實景圖` : "";
    $("#sheetCategory").textContent = `${category.label} ISLAND / ${category.title}`;
    $("#sheetTitle").textContent = place.name;
    $("#sheetRating").textContent = place.rating
      ? `Google ${place.rating.toFixed(1)} ★${place.reviewCount ? ` · ${place.reviewCount} 則評論` : ""}${place.ratingCheckedAt ? ` · 查核 ${place.ratingCheckedAt}` : ""}`
      : "評分請至 Google Maps 查看即時資料";
    $("#sheetSummary").textContent = place.summary || "店家資料由後台維護，出發前請確認最新資訊。";
    $("#sheetTags").innerHTML = (place.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
    $("#sheetFacts").innerHTML = `
      <dt>電話</dt>
      <dd>${place.phone ? `<a href="tel:${escapeHtml(place.phone)}">${escapeHtml(place.phone)}</a>` : "未提供"}</dd>
      <dt>地址</dt>
      <dd>${escapeHtml(place.address || place.destination || "請由導航確認")}</dd>
    `;
    $("#sheetSource").textContent = place.imageSource ? `圖片來源：${place.imageSource}` : "圖片由管理後台維護";
    $("#placeSheet").classList.add("open");
    $("#placeSheet").setAttribute("aria-hidden", "false");
    $("#sheetBackdrop").hidden = false;
    document.body.style.overflow = "hidden";
    track("place_open", { category: place.category, placeId: place.id });
  }

  function closeSheet() {
    $("#placeSheet").classList.remove("open");
    $("#placeSheet").setAttribute("aria-hidden", "true");
    $("#sheetBackdrop").hidden = true;
    document.body.style.overflow = "";
  }

  function savePlan() {
    localStorage.setItem("jiaoxi-island-plan", JSON.stringify(state.plan));
    renderPlan();
  }

  function addPlan(id) {
    if (!state.plan.includes(id)) state.plan.push(id);
    savePlan();
    track("itinerary_add", { placeId: id, category: state.selected?.category || "visit" });
    toast("已加入今天行程");
  }

  const modes = {
    "2 小時": ["visit-01", "food-02", "shop-01"],
    "半日遊": ["visit-01", "food-05", "shop-03", "visit-04"],
    "雨天": ["food-03", "visit-01", "shop-02"],
    "親子": ["visit-01", "food-01", "visit-05"],
    "步行": ["visit-01", "food-02", "shop-03"],
    "自駕": ["visit-02", "food-04", "stay-01"],
  };

  function renderModes() {
    $("#planModes").innerHTML = Object.keys(modes)
      .map(name => `<button class="mode" data-mode="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
      .join("");
    document.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => {
        state.plan = modes[button.dataset.mode].filter(id => state.places.some(place => place.id === id));
        savePlan();
        toast(`已套用${button.dataset.mode}路線`);
      });
    });
  }

  function renderPlan() {
    state.plan = state.plan.filter(id => state.places.some(place => place.id === id));
    $("#planCount").textContent = `${state.plan.length} 站`;
    $("#planList").innerHTML = state.plan.map(id => {
      const place = state.places.find(item => item.id === id);
      return `
        <li class="plan-item">
          <div><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(categoryFor(place.category).title)}</small></div>
          <button data-remove="${escapeHtml(id)}" aria-label="移除 ${escapeHtml(place.name)}">×</button>
        </li>
      `;
    }).join("");
    document.querySelectorAll("[data-remove]").forEach(button => {
      button.addEventListener("click", () => {
        state.plan = state.plan.filter(id => id !== button.dataset.remove);
        savePlan();
      });
    });
  }

  async function load() {
    try {
      state.config = await fetchJson("/api/jiaoxi-islands/config");
      await initLiff();
      const data = await fetchJson("/api/jiaoxi-islands/places");
      state.categories = data.categories || [];
      state.places = data.places || [];
      $("#destinationsTitle").textContent = `五座島，${state.places.length} 個礁溪去處`;
      renderMapPins();
      renderTabs();
      renderDestinations();
      renderModes();
      renderPlan();
      track("page_view");
    } catch (error) {
      $("#islandList").innerHTML = `<div class="loading">目前無法載入群島資料。<br>${escapeHtml(error.message)}</div>`;
    }
  }

  $("#sheetClose").addEventListener("click", closeSheet);
  $("#sheetBackdrop").addEventListener("click", closeSheet);
  $("#addPlan").addEventListener("click", () => state.selected && addPlan(state.selected.id));
  $("#navCurrent").addEventListener("click", () => {
    if (!state.selected) return;
    track("navigate_current", { placeId: state.selected.id, category: state.selected.category });
    openExternal(mapsUrl(state.selected));
  });
  $("#navStore").addEventListener("click", () => {
    if (!state.selected) return;
    track("navigate_store", { placeId: state.selected.id, category: state.selected.category });
    openExternal(mapsUrl(state.selected, state.config.store.address));
  });
  $("#clearPlan").addEventListener("click", () => {
    state.plan = [];
    savePlan();
  });
  $("#startPlan").addEventListener("click", () => {
    const place = state.places.find(item => item.id === state.plan[0]);
    if (!place) return toast("請先加入至少一站");
    track("itinerary_open", {
      placeId: place.id,
      category: place.category,
      metadata: { stops: state.plan.length },
    });
    openExternal(mapsUrl(place, state.config.store.address));
  });
  $("#homeNode").addEventListener("click", () => {
    if (!state.config?.store) return;
    openExternal(mapsUrl(state.config.store));
  });
  $("#soundToggle").addEventListener("click", event => {
    state.motionPaused = !state.motionPaused;
    document.body.classList.toggle("reduced-motion", state.motionPaused);
    event.currentTarget.textContent = state.motionPaused ? "▶" : "Ⅱ";
    event.currentTarget.setAttribute("aria-label", state.motionPaused ? "恢復頁面動態" : "暫停頁面動態");
    toast(state.motionPaused ? "頁面動態已暫停" : "頁面動態已恢復");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("#placeSheet").classList.contains("open")) closeSheet();
  });

  load();
})();
