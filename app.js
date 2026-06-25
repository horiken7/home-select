const AREA_PRIORITY = {
  "福岡市西区": 100,
  "福岡市早良区": 95,
  "福岡市城南区": 90,
  "福岡市中央区": 82,
  "福岡市博多区": 78,
  "福岡市東区": 74,
  "福岡市南区": 72,
  "糸島市": 68,
  "春日市": 66,
  "大野城市": 64,
  "那珂川市": 62,
  "古賀市": 60,
  "新宮町": 58,
  "粕屋町": 56,
  "志免町": 54,
  "太宰府市": 52,
  "宇美町": 50
};

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=75";

const state = {
  properties: [],
  news: [],
  dataMode: "loading",
  isDirty: false
};

const qs = (selector) => document.querySelector(selector);

const filters = {
  area: qs("#areaFilter"),
  layout: qs("#layoutFilter"),
  rent: qs("#rentFilter"),
  walk: qs("#walkFilter"),
  type: qs("#typeFilter"),
  priority: qs("#priorityFilter")
};

function getApiEndpoint() {
  return window.HOME_SELECT_CONFIG?.apiEndpoint?.replace(/\/$/, "") || "";
}

async function loadData() {
  setDataStatus("loading", "データ取得モードを確認中", "API設定があればCloudflare Workersから取得し、未設定ならローカルJSONを表示します。");
  await runSearch({ scrollToResults: false });
}

async function runSearch(options = {}) {
  const { scrollToResults = true } = options;
  const apiEndpoint = getApiEndpoint();
  setSearchButtonsLoading(true);

  if (apiEndpoint) {
    try {
      await loadFromApi(apiEndpoint);
      markClean();
      if (scrollToResults) scrollToPropertyList();
      return;
    } catch (error) {
      console.warn("API取得に失敗したため、ローカルJSONへ切り替えます。", error);
      setDataStatus("error", "API取得に失敗。ローカルJSONに切り替えました", "Workers APIのURL、CORS、デプロイ状態を確認してください。");
      await loadFromLocal();
      markClean();
      if (scrollToResults) scrollToPropertyList();
      return;
    } finally {
      setSearchButtonsLoading(false);
    }
  }

  try {
    await loadFromLocal();
    setDataStatus("local", "ローカルJSON表示中", "Cloudflare Workers APIは未設定です。config.js にAPI URLを入れるとAPI優先になります。");
    markClean();
    if (scrollToResults) scrollToPropertyList();
  } finally {
    setSearchButtonsLoading(false);
  }
}

async function loadFromApi(apiEndpoint) {
  setDataStatus("loading", "検索中", "指定された条件でCloudflare Workers APIへ問い合わせています。");
  const url = buildApiUrl(apiEndpoint);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const data = await res.json();
  state.properties = Array.isArray(data.properties) ? data.properties : [];
  state.news = Array.isArray(data.news) ? data.news : [];
  state.dataMode = data.meta?.mode || "api";

  setDataStatus("api-ok", "Cloudflare Workers API接続中", data.meta?.message || "APIから検索候補と行政情報を取得しています。");
  render();
  renderNews();
}

async function loadFromLocal() {
  const [properties, news] = await Promise.all([
    fetch("data/properties.json").then((res) => res.json()),
    fetch("data/news.json").then((res) => res.json())
  ]);

  state.properties = properties;
  state.news = news;
  state.dataMode = "local-json";

  render();
  renderNews();
}

function buildApiUrl(apiEndpoint) {
  const filter = getFilterValues();
  const url = new URL(`${apiEndpoint}/search`);
  url.searchParams.set("area", filter.area);
  url.searchParams.set("layout", String(filter.layout));
  url.searchParams.set("rent", String(filter.rent));
  url.searchParams.set("walk", String(filter.walk));
  url.searchParams.set("type", filter.type);
  url.searchParams.set("priority", filter.priority);
  url.searchParams.set("ts", String(Date.now()));
  return url;
}

function setDataStatus(mode, title, message) {
  const el = qs("#dataStatus");
  if (!el) return;
  el.className = `data-status ${mode}`;
  el.innerHTML = `
    <span class="status-dot"></span>
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function getFilterValues() {
  return {
    area: filters.area.value,
    layout: Number(filters.layout.value),
    rent: Number(filters.rent.value),
    walk: Number(filters.walk.value),
    type: filters.type.value,
    priority: filters.priority.value
  };
}

function markDirty() {
  state.isDirty = true;
  const hint = qs("#filterHint");
  if (hint) hint.textContent = "条件が変更されています。結果を更新するには「この条件で再検索」を押してください。";
  setDataStatus("dirty", "条件が変更されています", "新しい条件で検索するには「この条件で再検索」を押してください。現在表示中の結果は前回検索分です。");
}

function markClean() {
  state.isDirty = false;
  const hint = qs("#filterHint");
  if (hint) hint.textContent = "条件を変更したら「この条件で再検索」を押してください。";
}

function setSearchButtonsLoading(isLoading) {
  [qs("#searchButton"), qs("#searchButtonTop")].forEach((button) => {
    if (!button) return;
    button.disabled = isLoading;
    button.textContent = isLoading ? "検索中..." : "この条件で再検索";
  });
}

function scrollToPropertyList() {
  qs("#property-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function isAreaMatch(item, areaFilter) {
  if (areaFilter === "all") return true;
  if (areaFilter === "fukuoka_city") return item.areaGroup === "fukuoka_city";
  if (areaFilter === "preferred_wards") {
    return ["福岡市西区", "福岡市早良区", "福岡市城南区"].includes(item.area);
  }
  if (areaFilter === "surrounding") return item.areaGroup === "surrounding";
  return true;
}

function isTypeMatch(item, typeFilter) {
  if (typeFilter === "all") return true;
  if (typeFilter === "public") return item.tags.includes("公的") || item.tags.includes("行政") || item.type === "ur";
  if (typeFilter === "ur") return item.type === "ur";
  if (typeFilter === "safety") return item.type === "safety";
  if (typeFilter === "private") return item.type === "private";
  return true;
}

function calcScore(item, filter) {
  let score = AREA_PRIORITY[item.area] || 40;

  if (item.tags.includes("公的")) score += 18;
  if (item.tags.includes("行政")) score += 18;
  if (item.tags.includes("UR")) score += 16;
  if (item.tags.includes("高齢者相談")) score += 12;
  if (item.tags.includes("保証人不要") || item.tags.includes("保証会社")) score += 10;
  if (item.layoutMin <= filter.layout) score += 8;
  if (item.rentHint <= filter.rent) score += 8;
  if (item.walkHint <= filter.walk) score += 8;

  if (filter.priority === "unemployed") {
    if (item.tags.includes("保証人不要")) score += 18;
    if (item.tags.includes("高齢者相談")) score += 14;
    if (item.tags.includes("行政")) score += 12;
  }

  if (filter.priority === "publicFirst") {
    if (item.tags.includes("公的")) score += 22;
    if (item.tags.includes("UR")) score += 18;
    if (item.tags.includes("行政")) score += 18;
  }

  if (filter.priority === "access") {
    if (item.walkHint <= 10) score += 18;
    if (item.area.includes("中央区") || item.area.includes("博多区")) score += 8;
  }

  return Math.min(score, 100);
}

function filterProperties() {
  const filter = getFilterValues();

  return state.properties
    .filter((item) => isAreaMatch(item, filter.area))
    .filter((item) => isTypeMatch(item, filter.type))
    .filter((item) => item.layoutMin <= filter.layout)
    .filter((item) => item.rentHint <= filter.rent || item.flexibleRent)
    .filter((item) => item.walkHint <= filter.walk || item.flexibleWalk)
    .map((item) => ({ ...item, score: typeof item.score === "number" ? item.score : calcScore(item, filter) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function badgeClass(tag) {
  if (["公的", "行政", "UR"].includes(tag)) return "green";
  if (["家賃要確認", "条件要確認", "代表画像"].includes(tag)) return "orange";
  if (["初期費用高め"].includes(tag)) return "red";
  return "";
}

function render() {
  const cards = qs("#cards");
  const items = filterProperties();

  qs("#matchCount").textContent = items.length;
  qs("#publicCount").textContent = items.filter((item) => item.tags.includes("公的") || item.tags.includes("行政") || item.tags.includes("UR")).length;
  qs("#topArea").textContent = items[0]?.area || "-";

  if (!items.length) {
    cards.innerHTML = `<div class="empty">条件に合う候補がありません。家賃上限または駅徒歩条件を少し広げてください。</div>`;
    return;
  }

  cards.innerHTML = items.map((item, index) => {
    const imageUrl = item.imageUrl || FALLBACK_IMAGE;
    const imageLabel = item.imageLabel || "代表画像";

    return `
      <article class="property-card ${index === 0 ? "top-pick" : ""}">
        <a class="property-image" href="${escapeAttr(item.url)}" target="_blank" rel="noopener" aria-label="${escapeAttr(item.title)}を開く">
          <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(item.title)}の画像" loading="lazy" onerror="this.src='${FALLBACK_IMAGE}'" />
          <span>${escapeHtml(imageLabel)}</span>
        </a>

        <div class="property-body">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(item.title)}</h3>
              <p class="muted">${escapeHtml(item.subtitle)}</p>
            </div>
            <div class="score">${item.score}</div>
          </div>
          <div class="badges">
            ${item.tags.map((tag) => `<span class="badge ${badgeClass(tag)}">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="specs">
            <div class="spec"><span>エリア</span><strong>${escapeHtml(item.area)}</strong></div>
            <div class="spec"><span>間取り目安</span><strong>${escapeHtml(item.layoutLabel)}</strong></div>
            <div class="spec"><span>家賃目安</span><strong>${escapeHtml(item.rentLabel)}</strong></div>
            <div class="spec"><span>駅徒歩目安</span><strong>${escapeHtml(item.walkLabel)}</strong></div>
          </div>
          <p class="note">${escapeHtml(item.note)}</p>
          <div class="card-actions">
            <a class="open-link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">公式/検索ページを開く</a>
            ${item.subUrl ? `<a class="sub-link" href="${escapeAttr(item.subUrl)}" target="_blank" rel="noopener">補助・制度を見る</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderNews() {
  const newsCards = qs("#newsCards");
  newsCards.innerHTML = state.news.map((item) => `
    <article class="news-card">
      <span class="news-source">${escapeHtml(item.source)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">詳細を見る</a>
    </article>
  `).join("");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

Object.values(filters).forEach((el) => {
  el.addEventListener("change", markDirty);
});

[qs("#searchButton"), qs("#searchButtonTop")].forEach((button) => {
  button?.addEventListener("click", () => runSearch({ scrollToResults: true }));
});

qs("#resetButton").addEventListener("click", async () => {
  filters.area.value = "all";
  filters.layout.value = "2";
  filters.rent.value = "10";
  filters.walk.value = "15";
  filters.type.value = "all";
  filters.priority.value = "balanced";
  await runSearch({ scrollToResults: true });
});

loadData().catch((error) => {
  console.error(error);
  setDataStatus("error", "データの読み込みに失敗しました", "GitHub Pages上で開くか、ファイル構成を確認してください。");
  qs("#cards").innerHTML = `<div class="empty">データの読み込みに失敗しました。GitHub Pages上で開くか、ローカルサーバー経由で確認してください。</div>`;
});
