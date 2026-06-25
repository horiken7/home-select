// Cloudflare Workers API scaffold for home-select
//
// Purpose:
// - Provide a future API endpoint for GitHub Pages frontend.
// - Return normalized properties and administrative news.
// - Later replace mock data with real search/API results.
//
// Routes:
// - GET /health
// - GET /search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=75";

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

const SEED_PROPERTIES = [
  {
    title: "UR賃貸 福岡市西区エリア検索",
    subtitle: "西区を最優先に、2LDK以上・管理費込み条件で探す起点",
    area: "福岡市西区",
    areaGroup: "fukuoka_city",
    type: "ur",
    layoutMin: 2,
    layoutLabel: "2LDK以上対応",
    rentHint: 10,
    rentLabel: "10万円以内で検索可",
    walkHint: 15,
    walkLabel: "15分以内で検索可",
    flexibleRent: true,
    flexibleWalk: true,
    tags: ["UR", "公的", "保証人不要", "2LDK以上", "代表画像"],
    note: "URは保証人不要・更新料なし等の特徴があるため、定年後・無職可能性ありの住み替え候補として優先度が高いです。",
    url: "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/area/",
    subUrl: "https://www.ur-net.go.jp/chintai/about/",
    imageUrl: "https://images.unsplash.com/photo-1560184897-ae75f418493e?auto=format&fit=crop&w=900&q=75",
    imageLabel: "代表画像"
  },
  {
    title: "福岡市 居住支援協議会・住まいサポートふくおか",
    subtitle: "高齢者などの民間賃貸入居を支援する相談導線",
    area: "福岡市中央区",
    areaGroup: "fukuoka_city",
    type: "safety",
    layoutMin: 2,
    layoutLabel: "相談先",
    rentHint: 10,
    rentLabel: "制度・相談で確認",
    walkHint: 15,
    walkLabel: "物件ごとに確認",
    flexibleRent: true,
    flexibleWalk: true,
    tags: ["行政", "高齢者相談", "保証会社", "条件要確認", "代表画像"],
    note: "無職・年金見込み・保証人問題が心配な場合、物件探しと並行して最優先で確認したい相談窓口です。",
    url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojuushienkyougikai.html",
    subUrl: "https://www.city.fukuoka.lg.jp/",
    imageUrl: "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=75",
    imageLabel: "相談・支援"
  },
  {
    title: "福岡市南区 一般賃貸検索",
    subtitle: "南区も含めて予算内2LDKを広く比較",
    area: "福岡市南区",
    areaGroup: "fukuoka_city",
    type: "private",
    layoutMin: 2,
    layoutLabel: "2LDK以上",
    rentHint: 10,
    rentLabel: "10万円以内を狙う",
    walkHint: 15,
    walkLabel: "15分以内",
    flexibleRent: false,
    flexibleWalk: false,
    tags: ["一般賃貸", "保証会社", "2LDK以上", "代表画像"],
    note: "南区は福岡市内で候補を増やすうえで重要です。駅徒歩と坂道の確認がポイントです。",
    url: "https://www.homes.co.jp/chintai/fukuoka/fukuoka_minami-city/",
    subUrl: "https://www.city.fukuoka.lg.jp/",
    imageUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=75",
    imageLabel: "代表画像"
  }
];

const ADMIN_NEWS = [
  {
    source: "福岡市",
    title: "福岡市居住支援協議会・住まいサポートふくおか",
    summary: "高齢者など、民間賃貸住宅への入居に不安がある人向けの住み替え相談先として最優先で確認します。",
    url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojuushienkyougikai.html"
  },
  {
    source: "福岡市",
    title: "居住サポート住宅の認定制度",
    summary: "住宅確保要配慮者向けの居住支援、家賃債務保証料等の低廉化、引っ越し費用・初期費用などの情報を確認します。",
    url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojusupportnintei.html"
  },
  {
    source: "UR都市機構",
    title: "UR賃貸住宅 福岡県エリア検索",
    summary: "福岡市と周辺市町村のUR賃貸を探す入口。保証人不要など、定年後の住み替えで比較しやすい候補です。",
    url: "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/area/"
  }
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "home-select-search", now: new Date().toISOString() });
    }

    if (url.pathname === "/search" || url.pathname === "/") {
      const filters = parseFilters(url.searchParams);

      // Later implementation plan:
      // 1. Fetch UR and public housing/search pages where permitted.
      // 2. Use an official/search API for private rental candidates if available.
      // 3. Normalize records to the same shape as SEED_PROPERTIES.
      // 4. Keep only items with valid links and, where available, imageUrl.
      const properties = SEED_PROPERTIES
        .filter((item) => item.type !== "senior")
        .filter((item) => isAreaMatch(item, filters.area))
        .filter((item) => isTypeMatch(item, filters.type))
        .filter((item) => item.layoutMin <= filters.layout)
        .filter((item) => item.rentHint <= filters.rent || item.flexibleRent)
        .filter((item) => item.walkHint <= filters.walk || item.flexibleWalk)
        .map((item) => ({ ...item, imageUrl: item.imageUrl || DEFAULT_IMAGE, score: calcScore(item, filters) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      return json({
        meta: {
          mode: "worker-seed",
          message: "Cloudflare Workers API scaffold is active. Real search connectors are not enabled yet.",
          generatedAt: new Date().toISOString(),
          filters
        },
        properties,
        news: ADMIN_NEWS
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

function parseFilters(params) {
  return {
    area: params.get("area") || "all",
    layout: Number(params.get("layout") || 2),
    rent: Number(params.get("rent") || 10),
    walk: Number(params.get("walk") || 15),
    type: params.get("type") || "all",
    priority: params.get("priority") || "balanced"
  };
}

function isAreaMatch(item, areaFilter) {
  if (areaFilter === "all") return true;
  if (areaFilter === "fukuoka_city") return item.areaGroup === "fukuoka_city";
  if (areaFilter === "preferred_wards") return ["福岡市西区", "福岡市早良区", "福岡市城南区"].includes(item.area);
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
