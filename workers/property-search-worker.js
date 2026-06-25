// Cloudflare Workers API for home-select
//
// Google Programmable Search API connector version.
//
// Required Cloudflare Workers secrets:
// - GOOGLE_API_KEY
// - GOOGLE_CSE_ID
//
// Routes:
// - GET /health
// - GET /search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const GOOGLE_SEARCH_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
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

const AREA_KEYWORDS = [
  "福岡市西区",
  "福岡市早良区",
  "福岡市城南区",
  "福岡市中央区",
  "福岡市博多区",
  "福岡市東区",
  "福岡市南区",
  "糸島市",
  "春日市",
  "大野城市",
  "那珂川市",
  "古賀市",
  "新宮町",
  "粕屋町",
  "志免町",
  "太宰府市",
  "宇美町"
];

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
  }
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "home-select-search",
        googleApiConfigured: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID),
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/search" || url.pathname === "/") {
      const filters = parseFilters(url.searchParams);

      const cacheKey = new Request(url.toString(), request);
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;

      let result;

      if (!env.GOOGLE_API_KEY || !env.GOOGLE_CSE_ID) {
        result = buildSeedResponse(filters, "missing-google-secrets", "Google API Key または Search Engine ID が未設定です。WorkersのSecret設定後に実検索へ切り替わります。");
      } else {
        result = await buildGoogleSearchResponse(env, filters);
      }

      const response = json(result);
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

async function buildGoogleSearchResponse(env, filters) {
  const errors = [];
  const propertyQueries = buildPropertyQueries(filters);
  const newsQuery = buildNewsQuery();

  const propertyResults = [];

  for (const queryInfo of propertyQueries) {
    try {
      const items = await googleSearch(env, queryInfo.query, 5);
      for (const item of items) {
        const normalized = normalizeProperty(item, queryInfo, filters);
        if (normalized) propertyResults.push(normalized);
      }
    } catch (error) {
      errors.push(`${queryInfo.label}: ${error.message}`);
    }
  }

  const news = [];
  try {
    const newsItems = await googleSearch(env, newsQuery, 5);
    for (const item of newsItems) {
      const normalized = normalizeNews(item);
      if (normalized) news.push(normalized);
    }
  } catch (error) {
    errors.push(`administrative-news: ${error.message}`);
  }

  const dedupedProperties = dedupeByUrl(propertyResults)
    .filter((item) => item.type !== "senior")
    .filter((item) => isAreaMatch(item, filters.area))
    .filter((item) => isTypeMatch(item, filters.type))
    .filter((item) => item.layoutMin <= filters.layout)
    .filter((item) => item.rentHint <= filters.rent || item.flexibleRent)
    .filter((item) => item.walkHint <= filters.walk || item.flexibleWalk)
    .map((item) => ({ ...item, score: calcScore(item, filters) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (!dedupedProperties.length) {
    const fallback = buildSeedResponse(filters, "google-api-no-results", "Google APIには接続しましたが、条件に合う候補が十分に取れなかったため、補助候補を表示します。");
    fallback.meta.errors = errors;
    return fallback;
  }

  return {
    meta: {
      mode: "google-api",
      message: "Google Programmable Search APIから対象ソースの検索結果を取得しています。",
      generatedAt: new Date().toISOString(),
      filters,
      queryCount: propertyQueries.length + 1,
      errors
    },
    properties: dedupedProperties,
    news: news.length ? dedupeByUrl(news).slice(0, 6) : buildDefaultNews()
  };
}

function buildSeedResponse(filters, mode, message) {
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

  return {
    meta: {
      mode,
      message,
      generatedAt: new Date().toISOString(),
      filters
    },
    properties,
    news: buildDefaultNews()
  };
}

function buildPropertyQueries(filters) {
  const areaTerms = areaTermsFromFilter(filters.area);
  const baseTerms = `${areaTerms} 2LDK 賃貸 管理費込み ${filters.rent}万円以内 徒歩${filters.walk}分以内 -サ高住 -サービス付き高齢者向け住宅`;

  const queries = [];

  if (["all", "public", "ur"].includes(filters.type)) {
    queries.push({
      label: "UR賃貸",
      type: "ur",
      source: "UR都市機構",
      query: `site:ur-net.go.jp/chintai ${baseTerms} UR 賃貸`
    });
  }

  if (["all", "public", "safety"].includes(filters.type)) {
    queries.push({
      label: "セーフティネット・居住支援",
      type: "safety",
      source: "行政・居住支援",
      query: `(site:safetynet-jutaku.jp OR site:city.fukuoka.lg.jp OR site:pref.fukuoka.lg.jp) ${areaTerms} 賃貸 住宅 居住支援 高齢者 2LDK -サ高住`
    });
  }

  if (["all", "private"].includes(filters.type)) {
    queries.push({
      label: "一般賃貸",
      type: "private",
      source: "一般賃貸検索",
      query: `(site:homes.co.jp OR site:suumo.jp OR site:athome.co.jp OR site:chintai.net) ${baseTerms}`
    });
  }

  return queries;
}

function buildNewsQuery() {
  return `(site:city.fukuoka.lg.jp OR site:pref.fukuoka.lg.jp OR site:mlit.go.jp OR site:safetynet-jutaku.jp) 福岡 高齢者 賃貸 補助 居住支援 家賃 住宅`;
}

function areaTermsFromFilter(areaFilter) {
  if (areaFilter === "preferred_wards") return "福岡市西区 OR 福岡市早良区 OR 福岡市城南区";
  if (areaFilter === "fukuoka_city") return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区";
  if (areaFilter === "surrounding") return "糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
  return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区 糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
}

async function googleSearch(env, query, num = 5) {
  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", env.GOOGLE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(Math.max(num, 1), 10)));
  url.searchParams.set("lr", "lang_ja");
  url.searchParams.set("gl", "jp");
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString(), {
    headers: { "Accept": "application/json" }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function normalizeProperty(item, queryInfo, filters) {
  const title = clean(item.title);
  const snippet = clean(item.snippet || "");
  const url = item.link;
  const text = `${title} ${snippet} ${url}`;

  if (!url || isExcluded(text)) return null;
  if (!looksLikeRental(text, queryInfo.type)) return null;

  const area = detectArea(text);
  const layout = extractLayout(text, filters.layout);
  const rent = extractRent(text, filters.rent);
  const walk = extractWalk(text, filters.walk);
  const imageUrl = extractImage(item);
  const source = detectSource(url, queryInfo.source);

  const tags = buildTags(queryInfo.type, source, text, imageUrl);

  return {
    title,
    subtitle: snippet || source,
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type: queryInfo.type,
    source,
    layoutMin: layout.min,
    layoutLabel: layout.label,
    rentHint: rent.value,
    rentLabel: rent.label,
    walkHint: walk.value,
    walkLabel: walk.label,
    flexibleRent: rent.flexible,
    flexibleWalk: walk.flexible,
    tags,
    note: buildNote(queryInfo.type, source, text),
    url,
    subUrl: source.includes("UR") ? "https://www.ur-net.go.jp/chintai/about/" : "https://www.city.fukuoka.lg.jp/",
    imageUrl: imageUrl || DEFAULT_IMAGE,
    imageLabel: imageUrl ? "取得画像" : "代表画像"
  };
}

function normalizeNews(item) {
  const title = clean(item.title);
  const summary = clean(item.snippet || "");
  const url = item.link;
  if (!url || !title) return null;
  return {
    source: detectSource(url, "行政・住宅支援"),
    title,
    summary,
    url
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isExcluded(text) {
  return /サ高住|サービス付き高齢者向け住宅|老人ホーム|介護施設|有料老人/.test(text);
}

function looksLikeRental(text, type) {
  if (type === "safety") return /賃貸|住宅|居住支援|セーフティネット|入居/.test(text);
  return /賃貸|マンション|アパート|UR|物件|住宅/.test(text);
}

function detectArea(text) {
  const found = AREA_KEYWORDS.find((area) => text.includes(area));
  if (found) return found;
  if (/姪浜|今宿|九大学研都市|周船寺|橋本/.test(text)) return "福岡市西区";
  if (/西新|藤崎|室見|百道|野芥/.test(text)) return "福岡市早良区";
  if (/別府|七隈|茶山|金山|福大前/.test(text)) return "福岡市城南区";
  if (/天神|薬院|六本松|大濠|唐人町/.test(text)) return "福岡市中央区";
  if (/博多|吉塚|竹下|東比恵/.test(text)) return "福岡市博多区";
  if (/香椎|千早|箱崎|和白/.test(text)) return "福岡市東区";
  if (/大橋|高宮|井尻|平尾/.test(text)) return "福岡市南区";
  return "福岡市西区";
}

function extractLayout(text, defaultLayout) {
  const match = text.match(/([1-5])\s?LDK|([1-5])\s?DK/i);
  if (!match) return { min: defaultLayout, label: `${defaultLayout}LDK以上 / 要確認` };
  const value = Number(match[1] || match[2] || defaultLayout);
  return { min: value, label: `${value}${match[1] ? "LDK" : "DK"}` };
}

function extractRent(text, defaultRent) {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s?万円/g)].map((m) => Number(m[1])).filter(Boolean);
  if (!matches.length) return { value: defaultRent, label: `${defaultRent}万円以内 / 要確認`, flexible: true };
  const value = Math.min(...matches);
  return { value, label: `${value}万円目安`, flexible: false };
}

function extractWalk(text, defaultWalk) {
  const match = text.match(/徒歩\s?(\d+)\s?分/);
  if (!match) return { value: defaultWalk, label: `徒歩${defaultWalk}分以内 / 要確認`, flexible: true };
  const value = Number(match[1]);
  return { value, label: `徒歩${value}分` , flexible: false };
}

function extractImage(item) {
  const pagemap = item.pagemap || {};
  const thumb = pagemap.cse_thumbnail?.[0]?.src;
  const cseImage = pagemap.cse_image?.[0]?.src;
  const ogImage = pagemap.metatags?.[0]?.["og:image"];
  return thumb || cseImage || ogImage || "";
}

function detectSource(url, fallback) {
  if (url.includes("ur-net.go.jp")) return "UR都市機構";
  if (url.includes("city.fukuoka.lg.jp")) return "福岡市";
  if (url.includes("pref.fukuoka.lg.jp")) return "福岡県";
  if (url.includes("safetynet-jutaku.jp")) return "セーフティネット住宅";
  if (url.includes("homes.co.jp")) return "LIFULL HOME'S";
  if (url.includes("suumo.jp")) return "SUUMO";
  if (url.includes("athome.co.jp")) return "アットホーム";
  if (url.includes("chintai.net")) return "CHINTAI";
  if (url.includes("mlit.go.jp")) return "国土交通省";
  return fallback;
}

function buildTags(type, source, text, imageUrl) {
  const tags = [];
  if (type === "ur" || source.includes("UR")) tags.push("UR", "公的");
  if (type === "safety") tags.push("行政", "高齢者相談");
  if (type === "private") tags.push("一般賃貸");
  if (/保証人不要/.test(text)) tags.push("保証人不要");
  if (/保証会社/.test(text)) tags.push("保証会社");
  if (/2LDK|3LDK|4LDK/.test(text)) tags.push("2LDK以上");
  tags.push(imageUrl ? "取得画像" : "代表画像");
  return [...new Set(tags)];
}

function buildNote(type, source, text) {
  if (type === "ur") return "Google検索結果から取得したUR関連候補です。実際の空室・家賃・入居条件はリンク先で確認してください。";
  if (type === "safety") return "行政・居住支援系の検索結果です。無職・年金見込み・保証人不安がある場合に優先確認してください。";
  return `${source}の検索結果です。空室、管理費込み家賃、審査条件、画像利用可否はリンク先で確認してください。`;
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDefaultNews() {
  return [
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
}

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
