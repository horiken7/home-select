// Cloudflare Workers API for home-select
// Google Programmable Search API connector with registered-source visibility.
//
// Required Cloudflare Workers secrets:
// - GOOGLE_API_KEY
// - GOOGLE_CSE_ID
//
// Routes:
// - GET /health
// - GET /search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced
// - GET /debug/ur
// - GET /debug/google

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const GOOGLE_SEARCH_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=75";
const UR_DIRECT_RESULT_URL = "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/result/?area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&rent_low=&rent_high=&rent_low=&rent_high=&walk=&walk=&floorspace_low=&floorspace_high=&floorspace_low=&floorspace_high=&years=&years=&tdfk=40&todofuken=fukuoka";

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

const AREA_KEYWORDS = Object.keys(AREA_PRIORITY);

const SOURCES = [
  {
    id: "ur",
    label: "UR都市機構",
    type: "ur",
    siteSearch: "ur-net.go.jp",
    url: UR_DIRECT_RESULT_URL,
    sourceCardTitle: "UR賃貸公式検索結果を開く",
    note: "UR公式はJavaScriptで検索結果を描画するため、Workerでは部屋表を直接抽出できません。公式ページで空室・家賃を確認してください。",
    priority: 98
  },
  {
    id: "homes",
    label: "LIFULL HOME'S",
    type: "private",
    siteSearch: "homes.co.jp",
    url: "https://www.homes.co.jp/chintai/fukuoka/fukuoka-city/list/",
    sourceCardTitle: "LIFULL HOME'Sで福岡市の賃貸を検索",
    note: "Google Programmable Search API経由でHOME'Sの候補を取得します。条件詳細はリンク先で再確認してください。",
    priority: 88
  },
  {
    id: "suumo",
    label: "SUUMO",
    type: "private",
    siteSearch: "suumo.jp",
    url: "https://suumo.jp/chintai/fukuoka/sa_fukuoka/",
    sourceCardTitle: "SUUMOで福岡市の賃貸を検索",
    note: "Google Programmable Search API経由でSUUMOの候補を取得します。空室・管理費込み家賃はリンク先で確認してください。",
    priority: 86
  },
  {
    id: "athome",
    label: "アットホーム",
    type: "private",
    siteSearch: "athome.co.jp",
    url: "https://www.athome.co.jp/chintai/fukuoka/fukuoka-city/list/",
    sourceCardTitle: "アットホームで福岡市の賃貸を検索",
    note: "Google Programmable Search API経由でアットホームの候補を取得します。条件詳細はリンク先で再確認してください。",
    priority: 84
  },
  {
    id: "chintai",
    label: "CHINTAI",
    type: "private",
    siteSearch: "chintai.net",
    url: "https://www.chintai.net/fukuoka/area/40130/list/",
    sourceCardTitle: "CHINTAIで福岡市の賃貸を検索",
    note: "Google Programmable Search API経由でCHINTAIの候補を取得します。空室状況はリンク先で確認してください。",
    priority: 82
  },
  {
    id: "safetynet",
    label: "セーフティネット住宅",
    type: "safety",
    siteSearch: "safetynet-jutaku.jp",
    url: "https://www.safetynet-jutaku.jp/guest/index.php",
    sourceCardTitle: "セーフティネット住宅を検索",
    note: "住宅確保要配慮者向けの公的検索導線です。高齢者・保証人不安・無職可能性ありの場合に優先確認します。",
    priority: 92
  },
  {
    id: "fukuoka-city",
    label: "福岡市 居住支援",
    type: "safety",
    siteSearch: "city.fukuoka.lg.jp",
    url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojuushienkyougikai.html",
    sourceCardTitle: "福岡市の住まいサポートを確認",
    note: "福岡市の居住支援・住まいサポート情報です。民間賃貸の入居相談先として確認します。",
    priority: 90
  }
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const filters = parseFilters(url.searchParams);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "home-select-search",
        googleApiConfigured: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID),
        registeredSources: SOURCES.map((s) => s.label),
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/debug/ur") return json(await buildUrDiagnostics());
    if (url.pathname === "/debug/google") return json(await buildGoogleDiagnostics(env, filters));

    if (url.pathname === "/search" || url.pathname === "/") {
      return json(await buildSearchResponse(env, filters));
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

async function buildSearchResponse(env, filters) {
  const errors = [];
  const googleConfigured = Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID);
  const actualResults = [];
  const sourceCounts = {};

  if (googleConfigured) {
    for (const source of getEnabledSources(filters)) {
      try {
        const query = buildSourceQuery(source, filters);
        const items = await googleSearch(env, { query, siteSearch: source.siteSearch, num: 5 });
        sourceCounts[source.id] = items.length;
        for (const item of items) {
          const normalized = normalizeGoogleProperty(item, source, filters);
          if (normalized) actualResults.push(normalized);
        }
      } catch (error) {
        sourceCounts[source.id] = 0;
        errors.push(`${source.label}: ${error.message}`);
      }
    }
  }

  const actualBySource = new Set(actualResults.map((item) => item.sourceId));
  const sourceCards = getEnabledSources(filters)
    .filter((source) => !actualBySource.has(source.id))
    .map((source) => buildSourceCard(source, filters, googleConfigured, sourceCounts[source.id] || 0));

  const properties = finalizeProperties([...actualResults, ...sourceCards], filters);

  const news = googleConfigured ? await fetchNews(env, filters, errors) : [];

  return {
    meta: {
      mode: googleConfigured ? "google-source-search" : "source-links-only",
      message: googleConfigured
        ? "登録済みソースごとにGoogle Programmable Search APIで検索し、結果がないソースは検索導線として表示しています。"
        : "Google APIが未設定のため、登録済みソースへの検索導線を表示しています。",
      generatedAt: new Date().toISOString(),
      filters,
      googleApiConfigured: googleConfigured,
      registeredSources: SOURCES.map((s) => s.label),
      sourceCounts,
      errors
    },
    properties,
    news: news.length ? dedupeByUrl(news).slice(0, 6) : buildDefaultNews()
  };
}

function getEnabledSources(filters) {
  return SOURCES.filter((source) => {
    if (filters.type === "all") return true;
    if (filters.type === "public") return ["ur", "safety"].includes(source.type);
    if (filters.type === "ur") return source.type === "ur";
    if (filters.type === "safety") return source.type === "safety";
    if (filters.type === "private") return source.type === "private";
    return true;
  });
}

function buildSourceQuery(source, filters) {
  const areaTerms = areaTermsFromFilter(filters.area);
  const layout = `${filters.layout || 2}LDK`;
  const rent = filters.rent ? `${filters.rent}万円以内` : "";
  const walk = filters.walk && filters.walk < 999 ? `徒歩${filters.walk}分以内` : "";

  if (source.type === "safety") {
    return `${areaTerms} 高齢者 賃貸 居住支援 住宅 保証人`;
  }

  if (source.type === "ur") {
    return `${areaTerms} UR 賃貸 ${layout}`;
  }

  return `${areaTerms} 賃貸 ${layout} ${rent} ${walk} -サ高住 -老人ホーム -介護施設`;
}

async function googleSearch(env, { query, siteSearch = "", num = 5 }) {
  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", env.GOOGLE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", query.replace(/\s+/g, " ").trim());
  url.searchParams.set("num", String(Math.min(Math.max(num, 1), 10)));
  url.searchParams.set("lr", "lang_ja");
  url.searchParams.set("gl", "jp");
  url.searchParams.set("safe", "active");
  if (siteSearch) {
    url.searchParams.set("siteSearch", siteSearch);
    url.searchParams.set("siteSearchFilter", "i");
  }

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function normalizeGoogleProperty(item, source, filters) {
  const title = clean(item.title);
  const snippet = clean(item.snippet || "");
  const url = item.link;
  const text = `${title} ${snippet} ${url}`;

  if (!url || !title || isExcluded(text)) return null;

  const area = detectArea(text);
  const layout = extractLayout(text, filters.layout);
  const rent = extractRent(text, filters.rent);
  const walk = extractWalk(text, filters.walk);
  const imageUrl = extractGoogleImage(item) || DEFAULT_IMAGE;
  const hasImage = imageUrl !== DEFAULT_IMAGE;
  const tags = buildTags(source.type, source.label, text, hasImage);
  if (source.type === "ur") tags.push("UR公式は詳細要確認");

  return {
    sourceId: source.id,
    title,
    subtitle: snippet || `${source.label}の検索結果です。`,
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type: source.type,
    source: source.label,
    layoutMin: layout.min,
    layoutLabel: layout.label,
    rentHint: rent.value,
    rentLabel: rent.label,
    walkHint: walk.value,
    walkLabel: walk.label,
    flexibleRent: rent.flexible,
    flexibleWalk: walk.flexible,
    tags,
    note: `${source.label}のGoogle検索結果です。家賃・管理費・空室・入居条件はリンク先で確認してください。`,
    url,
    subUrl: source.url,
    imageUrl,
    imageLabel: hasImage ? "取得画像" : "代表画像",
    score: source.priority + (hasImage ? 4 : 0)
  };
}

function buildSourceCard(source, filters, googleConfigured, count) {
  const area = defaultAreaForFilter(filters.area);
  const tags = [source.label, source.type === "private" ? "一般賃貸" : "公的・行政", "検索導線"];
  if (source.type === "ur") tags.push("保証人不要", "JS描画");
  if (source.type === "safety") tags.push("高齢者相談");

  return {
    sourceId: source.id,
    title: source.sourceCardTitle,
    subtitle: googleConfigured
      ? `${source.label}から直接表示できる検索結果は現在${count}件です。リンク先で公式検索を確認してください。`
      : `${source.label}の検索導線です。`,
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type: source.type,
    source: source.label,
    layoutMin: filters.layout || 2,
    layoutLabel: `${filters.layout || 2}LDK以上 / リンク先で確認`,
    rentHint: filters.rent || 10,
    rentLabel: `${filters.rent || 10}万円以内 / リンク先で確認`,
    walkHint: filters.walk || 15,
    walkLabel: filters.walk >= 999 ? "バス利用含む / リンク先で確認" : `徒歩${filters.walk || 15}分以内 / リンク先で確認`,
    flexibleRent: true,
    flexibleWalk: true,
    tags,
    note: source.note,
    url: source.url,
    subUrl: source.type === "safety" ? source.url : "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojuushienkyougikai.html",
    imageUrl: DEFAULT_IMAGE,
    imageLabel: "検索導線",
    score: source.priority
  };
}

function finalizeProperties(items, filters) {
  return dedupeProperties(items)
    .filter((item) => item.type !== "senior")
    .filter((item) => isAreaMatch(item, filters.area))
    .map((item) => ({ ...item, score: typeof item.score === "number" ? Math.min(item.score, 100) : calcScore(item, filters) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function fetchNews(env, filters, errors) {
  const news = [];
  try {
    const items = await googleSearch(env, {
      query: `${areaTermsFromFilter(filters.area)} 高齢者 賃貸 補助 居住支援 住宅`,
      siteSearch: "city.fukuoka.lg.jp",
      num: 5
    });
    for (const item of items) {
      const normalized = normalizeNews(item);
      if (normalized) news.push(normalized);
    }
  } catch (error) {
    errors.push(`administrative-news: ${error.message}`);
  }
  return news;
}

function normalizeNews(item) {
  const title = clean(item.title);
  const summary = clean(item.snippet || "");
  const url = item.link;
  if (!url || !title || isExcluded(`${title} ${summary} ${url}`)) return null;
  return { source: detectSource(url, "行政・住宅支援"), title, summary, url };
}

async function buildGoogleDiagnostics(env, filters) {
  if (!env.GOOGLE_API_KEY || !env.GOOGLE_CSE_ID) {
    return { ok: false, error: "GOOGLE_API_KEY または GOOGLE_CSE_ID が未設定です。" };
  }

  const diagnostics = [];
  for (const source of getEnabledSources(filters)) {
    try {
      const query = buildSourceQuery(source, filters);
      const items = await googleSearch(env, { query, siteSearch: source.siteSearch, num: 3 });
      diagnostics.push({
        source: source.label,
        siteSearch: source.siteSearch,
        query,
        count: items.length,
        titles: items.map((item) => item.title).slice(0, 3)
      });
    } catch (error) {
      diagnostics.push({ source: source.label, siteSearch: source.siteSearch, error: error.message });
    }
  }

  return { ok: true, diagnostics };
}

async function buildUrDiagnostics() {
  try {
    const res = await fetch(UR_DIRECT_RESULT_URL, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.6",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
      }
    });
    const html = await res.text();
    const text = stripTags(html);
    return {
      ok: false,
      reason: "UR公式はJavaScript描画のため、Cloudflare Workerのfetchでは部屋表を取得できません。",
      status: res.status,
      htmlLength: html.length,
      textLength: text.length,
      contains: {
        abeinkasuga: html.includes("アーベイン春日公園") || text.includes("アーベイン春日公園"),
        rent73700: html.includes("73,700") || text.includes("73,700"),
        vacancy: html.includes("空室状況") || text.includes("空室状況"),
        room402: html.includes("402") || text.includes("402"),
        chintai: html.includes("/chintai/")
      },
      textSample: text.slice(0, 1200)
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function areaTermsFromFilter(areaFilter) {
  if (areaFilter === "preferred_wards") return "福岡市西区 福岡市早良区 福岡市城南区";
  if (areaFilter === "fukuoka_city") return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区";
  if (areaFilter === "surrounding") return "糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
  return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区 糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
}

function defaultAreaForFilter(areaFilter) {
  if (areaFilter === "surrounding") return "春日市";
  if (areaFilter === "preferred_wards") return "福岡市西区";
  return "福岡市全域";
}

function isAreaMatch(item, areaFilter) {
  if (areaFilter === "all") return true;
  if (areaFilter === "fukuoka_city") return item.areaGroup === "fukuoka_city" || item.area === "福岡市全域";
  if (areaFilter === "preferred_wards") return ["福岡市西区", "福岡市早良区", "福岡市城南区", "福岡市全域"].includes(item.area);
  if (areaFilter === "surrounding") return item.areaGroup === "surrounding";
  return true;
}

function calcScore(item, filter) {
  let score = AREA_PRIORITY[item.area] || item.score || 50;
  if (item.tags.includes("公的")) score += 14;
  if (item.tags.includes("公的・行政")) score += 14;
  if (item.tags.includes("UR")) score += 12;
  if (item.tags.includes("高齢者相談")) score += 10;
  if (item.tags.includes("保証人不要")) score += 8;
  if (!item.flexibleRent && item.rentHint <= filter.rent) score += 8;
  if (!item.flexibleWalk && item.walkHint <= filter.walk) score += 8;
  return Math.min(score, 100);
}

function buildTags(type, source, text, hasImage) {
  const tags = [];
  if (type === "ur" || source.includes("UR")) tags.push("UR", "公的");
  if (type === "safety") tags.push("行政", "高齢者相談");
  if (type === "private") tags.push("一般賃貸");
  if (/保証人不要/.test(text)) tags.push("保証人不要");
  if (/保証会社/.test(text)) tags.push("保証会社");
  if (/2LDK|3LDK|4LDK|2DK|3DK/.test(text)) tags.push("2LDK以上");
  tags.push(hasImage ? "取得画像" : "代表画像");
  return [...new Set(tags)];
}

function extractGoogleImage(item) {
  const pagemap = item.pagemap || {};
  return pagemap.cse_thumbnail?.[0]?.src || pagemap.cse_image?.[0]?.src || pagemap.metatags?.[0]?.["og:image"] || "";
}

function extractLayout(text, defaultLayout) {
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/([1-5])\s?LDK|([1-5])\s?DK/i);
  if (!match) return { min: defaultLayout, label: `${defaultLayout}LDK以上 / 要確認`, flexible: true };
  const value = Number(match[1] || match[2] || defaultLayout);
  return { min: value, label: `${value}${match[1] ? "LDK" : "DK"}`, flexible: false };
}

function extractRent(text, defaultRent) {
  const normalized = normalizeFullWidth(text);
  const yenMatches = [...normalized.matchAll(/([0-9,]+)\s?円/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => n >= 10000 && n <= 500000);
  if (yenMatches.length) {
    const yen = Math.min(...yenMatches);
    return { value: Math.round((yen / 10000) * 100) / 100, label: `${yen.toLocaleString("ja-JP")}円目安`, flexible: yen / 10000 <= defaultRent };
  }
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s?万円/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 50);
  if (!matches.length) return { value: defaultRent, label: `${defaultRent}万円以内 / 要確認`, flexible: true };
  const value = Math.min(...matches);
  return { value, label: `${value}万円目安`, flexible: value <= defaultRent };
}

function extractWalk(text, defaultWalk) {
  const normalized = normalizeFullWidth(text);
  const matches = [...normalized.matchAll(/徒歩\s?([0-9]+)\s?[〜~\-－]?\s?([0-9]+)?\s?分/g)].map((m) => Number(m[1])).filter(Boolean);
  if (!matches.length) return { value: defaultWalk, label: `徒歩${defaultWalk}分以内 / 要確認`, flexible: true };
  const value = Math.min(...matches);
  return { value, label: `徒歩${value}分〜`, flexible: value <= defaultWalk };
}

function detectArea(text) {
  const found = AREA_KEYWORDS.find((area) => text.includes(area));
  if (found) return found;
  if (/春日公園|大野城|白木原|春日市/.test(text)) return "春日市";
  if (/姪浜|今宿|九大学研都市|周船寺|橋本|下山門/.test(text)) return "福岡市西区";
  if (/西新|藤崎|室見|百道|野芥|賀茂/.test(text)) return "福岡市早良区";
  if (/別府|七隈|茶山|金山|福大前/.test(text)) return "福岡市城南区";
  if (/天神|薬院|六本松|大濠|唐人町|平尾/.test(text)) return "福岡市中央区";
  if (/博多|吉塚|竹下|東比恵|千代/.test(text)) return "福岡市博多区";
  if (/香椎|千早|箱崎|和白|照葉|星の原/.test(text)) return "福岡市東区";
  if (/大橋|高宮|井尻|平尾|笹原/.test(text)) return "福岡市南区";
  return "福岡市全域";
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

function isExcluded(text) {
  return /サ高住|サービス付き高齢者向け住宅|老人ホーム|介護施設|有料老人|グループホーム/.test(text);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeFullWidth(value) {
  return String(value || "").replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function stripTags(html) {
  return decodeHtml(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>(\s*)/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
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

function dedupeProperties(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sourceId}|${item.title}|${item.url}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDefaultNews() {
  return [
    { source: "福岡市", title: "福岡市居住支援協議会・住まいサポートふくおか", summary: "高齢者など、民間賃貸住宅への入居に不安がある人向けの住み替え相談先として最優先で確認します。", url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojuushienkyougikai.html" },
    { source: "福岡市", title: "居住サポート住宅の認定制度", summary: "住宅確保要配慮者向けの居住支援、家賃債務保証料等の低廉化、引っ越し費用・初期費用などの情報を確認します。", url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojusupportnintei.html" },
    { source: "UR都市機構", title: "UR賃貸住宅 福岡県エリア検索", summary: "福岡市と周辺市町村のUR賃貸を探す入口。保証人不要など、定年後の住み替えで比較しやすい候補です。", url: "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/area/" }
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
