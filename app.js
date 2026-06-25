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

const state = {
  properties: [],
  news: []
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

async function loadData() {
  const [properties, news] = await Promise.all([
    fetch("data/properties.json").then((res) => res.json()),
    fetch("data/news.json").then((res) => res.json())
  ]);

  state.properties = properties;
  state.news = news;

  render();
  renderNews();
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
  if (typeFilter === "senior") return item.type === "senior";
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
    .map((item) => ({ ...item, score: calcScore(item, filter) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function badgeClass(tag) {
  if (["公的", "行政", "UR"].includes(tag)) return "green";
  if (["家賃要確認", "条件要確認"].includes(tag)) return "orange";
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

  cards.innerHTML = items.map((item, index) => `
    <article class="property-card ${index === 0 ? "top-pick" : ""}">
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
        <a class="open-link" href="${item.url}" target="_blank" rel="noopener">公式/検索ページを開く</a>
        ${item.subUrl ? `<a class="sub-link" href="${item.subUrl}" target="_blank" rel="noopener">補助・制度を見る</a>` : ""}
      </div>
    </article>
  `).join("");
}

function renderNews() {
  const newsCards = qs("#newsCards");
  newsCards.innerHTML = state.news.map((item) => `
    <article class="news-card">
      <span class="news-source">${escapeHtml(item.source)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <a href="${item.url}" target="_blank" rel="noopener">詳細を見る</a>
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

Object.values(filters).forEach((el) => {
  el.addEventListener("change", render);
});

qs("#resetButton").addEventListener("click", () => {
  filters.area.value = "all";
  filters.layout.value = "2";
  filters.rent.value = "10";
  filters.walk.value = "15";
  filters.type.value = "all";
  filters.priority.value = "balanced";
  render();
});

loadData().catch((error) => {
  console.error(error);
  qs("#cards").innerHTML = `<div class="empty">データの読み込みに失敗しました。GitHub Pages上で開くか、ローカルサーバー経由で確認してください。</div>`;
});
