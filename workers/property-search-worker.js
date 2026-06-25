// Cloudflare Workers API for home-select
// Google Programmable Search API + direct UR result connector.
//
// Required Cloudflare Workers secrets:
// - GOOGLE_API_KEY
// - GOOGLE_CSE_ID
//
// Routes:
// - GET /health
// - GET /search?area=all&layout=2&rent=10&walk=15&type=all&priority=balanced
// - GET /debug/ur

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const GOOGLE_SEARCH_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=75";
const UR_DIRECT_RESULT_URL = "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/result/?area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&rent_low=&rent_high=&rent_low=&rent_high=&walk=&walk=&floorspace_low=&floorspace_high=&floorspace_low=&floorspace_high=&years=&years=&tdfk=40&todofuken=fukuoka";
const UR_ORIGIN = "https://www.ur-net.go.jp";

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
const CITY_ONLY_WORDS = new Set([...AREA_KEYWORDS, "福岡市", "福岡県", "九州", "福岡市東区", "福岡市中央区", "福岡市南区", "福岡市城南区", "福岡市早良区"]);

const SEED_PROPERTIES = [
  {
    title: "UR賃貸 福岡市エリア検索",
    subtitle: "UR公式サイトの福岡県エリア検索です。実検索で候補が少ない場合の補助導線です。",
    area: "福岡市西区",
    areaGroup: "fukuoka_city",
    type: "ur",
    source: "UR都市機構",
    layoutMin: 2,
    layoutLabel: "2LDK以上 / 要確認",
    rentHint: 10,
    rentLabel: "10万円以内 / 要確認",
    walkHint: 15,
    walkLabel: "徒歩15分以内 / 要確認",
    flexibleRent: true,
    flexibleWalk: true,
    tags: ["UR", "公的", "保証人不要", "代表画像"],
    note: "URは保証人不要・更新料なし等の特徴があるため、定年後・無職可能性ありの住み替え候補として優先度が高いです。",
    url: "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/area/",
    subUrl: "https://www.ur-net.go.jp/chintai/about/",
    imageUrl: DEFAULT_IMAGE,
    imageLabel: "代表画像"
  }
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "home-select-search",
        googleApiConfigured: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID),
        urDirectConfigured: true,
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/debug/ur") {
      const filters = parseFilters(url.searchParams);
      try {
        const properties = await fetchUrDirectResults(filters);
        return json({ ok: true, count: properties.length, properties });
      } catch (error) {
        return json({ ok: false, error: error.message }, 500);
      }
    }

    if (url.pathname === "/search" || url.pathname === "/") {
      const filters = parseFilters(url.searchParams);
      const result = await buildSearchResponse(env, filters);
      return json(result);
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

async function buildSearchResponse(env, filters) {
  const errors = [];
  const propertyResults = [];
  let urDirectCount = 0;

  if (["all", "public", "ur"].includes(filters.type)) {
    try {
      const urResults = await fetchUrDirectResults(filters);
      urDirectCount = urResults.length;
      propertyResults.push(...urResults);
    } catch (error) {
      errors.push(`UR公式直接取得: ${error.message}`);
    }
  }

  if (env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID) {
    const propertyQueries = buildPropertyQueries(filters);
    for (const queryInfo of propertyQueries) {
      try {
        const items = await googleSearch(env, queryInfo.query, 10);
        for (const item of items) {
          const normalized = normalizeProperty(item, queryInfo, filters);
          if (normalized) propertyResults.push(normalized);
        }
      } catch (error) {
        errors.push(`${queryInfo.label}: ${error.message}`);
      }
    }

    const news = await fetchNews(env, filters, errors);
    const properties = finalizeProperties(propertyResults, filters);

    if (properties.length) {
      return {
        meta: {
          mode: urDirectCount ? "ur-direct-google-api" : "google-api",
          message: urDirectCount
            ? "UR公式検索結果から団地・部屋情報を直接取得し、不足分をGoogle Programmable Search APIで補完しています。"
            : "Google Programmable Search APIから対象ソースの検索結果を取得しています。",
          generatedAt: new Date().toISOString(),
          filters,
          urDirectCount,
          googleApiConfigured: true,
          errors
        },
        properties,
        news: news.length ? dedupeByUrl(news).slice(0, 6) : buildDefaultNews()
      };
    }

    const fallback = buildSeedResponse(filters, "no-results", "UR公式直接取得とGoogle API検索を実行しましたが、表示できる候補が取れませんでした。検索対象設定またはURページ構造を確認してください。");
    fallback.meta.errors = errors;
    return fallback;
  }

  const properties = finalizeProperties(propertyResults, filters);
  if (properties.length) {
    return {
      meta: {
        mode: "ur-direct-only",
        message: "Google APIは未設定ですが、UR公式検索結果から団地・部屋情報を直接取得しています。",
        generatedAt: new Date().toISOString(),
        filters,
        urDirectCount,
        googleApiConfigured: false,
        errors
      },
      properties,
      news: buildDefaultNews()
    };
  }

  const fallback = buildSeedResponse(filters, "missing-google-secrets", "Google API Key または Search Engine ID が未設定です。UR公式直接取得にも失敗したため、補助候補を表示します。");
  fallback.meta.errors = errors;
  return fallback;
}

async function fetchNews(env, filters, errors) {
  const news = [];
  try {
    const newsItems = await googleSearch(env, buildNewsQuery(filters), 10);
    for (const item of newsItems) {
      const normalized = normalizeNews(item);
      if (normalized) news.push(normalized);
    }
  } catch (error) {
    errors.push(`administrative-news: ${error.message}`);
  }
  return news;
}

function finalizeProperties(items, filters) {
  return dedupeProperties(items)
    .filter((item) => item.type !== "senior")
    .filter((item) => isAreaMatch(item, filters.area))
    .filter((item) => isTypeMatch(item, filters.type))
    .map((item) => ({ ...item, score: typeof item.score === "number" ? item.score : calcScore(item, filters) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function fetchUrDirectResults(filters) {
  const res = await fetch(UR_DIRECT_RESULT_URL, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
      "User-Agent": "Mozilla/5.0 (compatible; home-select-search/1.0; +https://horiken7.github.io/home-select/)"
    }
  });

  if (!res.ok) {
    throw new Error(`UR HTTP ${res.status}`);
  }

  const html = await res.text();
  const parsed = parseUrHtml(html, filters);
  if (!parsed.length) {
    throw new Error("URページから物件カードを抽出できませんでした");
  }
  return parsed;
}

function parseUrHtml(html, filters) {
  const results = [];
  const normalizedHtml = String(html || "").replace(/\r?\n/g, " ");

  // URの検索結果は、団地名→交通→住所→空室状況→部屋テーブル、という並びで出る。
  // まず「空室状況」を含む大きめのカード単位で分割して、団地＋部屋の固有情報を拾う。
  const cardRe = /(<[^>]*(?:class|id)=["'][^"']*(?:estate|property|result|article|list|panel|box|section|building|rent)[^"']*["'][^>]*>[\s\S]{0,9000}?空室状況[\s\S]{0,14000}?)(?=<[^>]*(?:class|id)=["'][^"']*(?:estate|property|result|article|list|panel|box|section|building|rent)[^"']*["']|$)/gi;
  let match;
  while ((match = cardRe.exec(normalizedHtml)) !== null) {
    const items = parseUrCard(match[1], filters);
    results.push(...items);
  }

  if (results.length) return dedupeProperties(results).slice(0, 12);

  // class名が想定外の場合のフォールバック。
  const parts = normalizedHtml.split(/空室状況/).slice(0, 30);
  for (let i = 1; i < parts.length; i++) {
    const block = `${parts[i - 1].slice(-5000)} 空室状況 ${parts[i].slice(0, 9000)}`;
    const items = parseUrCard(block, filters);
    results.push(...items);
  }

  return dedupeProperties(results).slice(0, 12);
}

function parseUrCard(block, filters) {
  const text = stripTags(block);
  const title = extractUrPropertyTitle(block, text);
  if (!isLikelyUrPropertyTitle(title)) return [];

  const propertyHref = extractUrPropertyHref(block) || UR_DIRECT_RESULT_URL;
  const propertyUrl = absoluteUrl(propertyHref);
  const area = detectArea(text);
  const transit = extractTransit(text);
  const address = extractUrAddress(text);
  const propertyImage = extractUrImage(block);
  const vacancy = extractVacancy(text);
  const rooms = extractUrRooms(text);

  if (!rooms.length) {
    return [normalizeUrRoom({
      propertyName: title,
      room: null,
      text,
      filters,
      propertyUrl,
      propertyImage,
      area,
      transit,
      address,
      vacancy
    })];
  }

  return rooms.map((room) => normalizeUrRoom({
    propertyName: title,
    room,
    text,
    filters,
    propertyUrl: room.url || propertyUrl,
    propertyImage: room.floorImage || propertyImage,
    area,
    transit,
    address,
    vacancy
  }));
}

function normalizeUrRoom({ propertyName, room, text, filters, propertyUrl, propertyImage, area, transit, address, vacancy }) {
  const layout = room?.layout ? parseLayoutLabel(room.layout, filters.layout) : extractLayout(text, filters.layout);
  const rent = room?.rentYen ? parseRentYen(room.rentYen, room.commonFeeYen, filters.rent) : extractRent(text, filters.rent);
  const walk = extractWalk(transit || text, filters.walk);
  const floorLabel = room?.floor || "要確認";
  const roomLabel = room?.roomName || "部屋番号 要確認";
  const title = room ? `${propertyName} ${roomLabel}` : propertyName;
  const specificImage = propertyImage || DEFAULT_IMAGE;
  const noteParts = ["UR公式検索結果から取得。"];

  if (vacancy) noteParts.push(`団地の空室状況は${vacancy}件。`);
  if (room?.rentYen) noteParts.push(`部屋別の家賃・間取り・階数を抽出済み。`);
  noteParts.push("最新の空室・申込状況はリンク先のUR公式ページで確認してください。");

  return {
    title,
    subtitle: [transit, address].filter(Boolean).join(" / ") || "UR公式検索結果から取得した候補です。",
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type: "ur",
    source: "UR都市機構・公式直接取得",
    layoutMin: layout.min,
    layoutLabel: layout.label,
    rentHint: rent.value,
    rentLabel: rent.label,
    walkHint: walk.value,
    walkLabel: walk.label,
    flexibleRent: rent.flexible,
    flexibleWalk: walk.flexible,
    tags: ["UR", "公的", "保証人不要", "UR公式直接", specificImage === DEFAULT_IMAGE ? "代表画像" : "取得画像", room?.floor ? `${floorLabel}` : "階数要確認"],
    note: noteParts.join(""),
    url: propertyUrl,
    subUrl: "https://www.ur-net.go.jp/chintai/about/",
    imageUrl: specificImage,
    imageLabel: specificImage === DEFAULT_IMAGE ? "代表画像" : (room?.floorImage ? "間取図" : "UR取得画像")
  };
}

function extractUrRooms(text) {
  const rooms = [];
  const normalized = normalizeFullWidth(text);
  const roomRe = /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,180}?([0-9,]+円)\s*(?:\(([0-9,]+円)\))?[\s\S]{0,160}?([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))[\s\S]{0,100}?([0-9]+階)/gi;
  let match;

  while ((match = roomRe.exec(normalized)) !== null) {
    rooms.push({
      roomName: clean(match[1]),
      rentYen: clean(match[2]),
      commonFeeYen: clean(match[3] || ""),
      layout: clean(match[4]).replace(/m2/i, "㎡"),
      floor: clean(match[5]),
      floorImage: "",
      url: ""
    });
  }

  return rooms;
}

function parseRentYen(rentYen, commonFeeYen, defaultRent) {
  const yen = Number(String(rentYen).replace(/[^0-9]/g, ""));
  const fee = Number(String(commonFeeYen || "").replace(/[^0-9]/g, ""));
  const value = yen ? Math.round((yen / 10000) * 100) / 100 : defaultRent;
  const feeText = fee ? `（共益費 ${fee.toLocaleString("ja-JP")}円）` : "";
  return {
    value,
    label: yen ? `${yen.toLocaleString("ja-JP")}円 ${feeText}`.trim() : `${defaultRent}万円以内 / 要確認`,
    flexible: !yen || value <= defaultRent
  };
}

function parseLayoutLabel(layoutLabel, defaultLayout) {
  const normalized = normalizeFullWidth(layoutLabel);
  const valueMatch = normalized.match(/([1-5])\s?(?:LDK|DK|K)/i);
  const value = Number(valueMatch?.[1] || defaultLayout);
  return { min: value, label: clean(normalized), flexible: false };
}

function extractUrPropertyTitle(block, text) {
  const headingPatterns = [
    /<h[1-4][^>]*>[\s\S]*?<a[^>]*>([\s\S]{2,120}?)<\/a>[\s\S]*?<\/h[1-4]>/i,
    /<h[1-4][^>]*>([\s\S]{2,120}?)<\/h[1-4]>/i,
    /<a[^>]*href=["'][^"']*\/chintai\/kyushu\/fukuoka\/[^"']*["'][^>]*>([\s\S]{2,80}?)<\/a>\s*(?:<[^>]+>\s*){0,6}お気に入り/i
  ];

  for (const pattern of headingPatterns) {
    const match = block.match(pattern);
    const title = normalizeTitle(stripTags(match?.[1] || ""));
    if (isLikelyUrPropertyTitle(title)) return title;
  }

  const favoriteIndex = text.indexOf("お気に入り");
  if (favoriteIndex > 0) {
    const before = text.slice(Math.max(0, favoriteIndex - 90), favoriteIndex).trim();
    const candidates = before.match(/[一-龥ぁ-んァ-ンーA-Za-z0-9０-９・ヶヶ\s]{2,34}/g) || [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const title = normalizeTitle(candidates[i]);
      if (isLikelyUrPropertyTitle(title)) return title;
    }
  }

  const addressIndex = text.search(/(?:福岡市|春日市|大野城市|糸島市|古賀市|新宮町|粕屋町|志免町|太宰府市|宇美町)/);
  if (addressIndex > 0) {
    const before = text.slice(Math.max(0, addressIndex - 160), addressIndex).trim();
    const title = guessUrTitleFromText(before);
    if (isLikelyUrPropertyTitle(title)) return title;
  }

  return "";
}

function extractUrPropertyHref(block) {
  const preferred = block.match(/<a\b[^>]*href=["']([^"']*\/chintai\/kyushu\/fukuoka\/(?:[0-9A-Za-z_\-\/]+)[^"']*)["'][^>]*>(?=[\s\S]{0,200}?(?:部屋詳細|建物情報|お問い合わせ|お気に入り))/i);
  if (preferred?.[1]) return preferred[1];

  const any = block.match(/<a\b[^>]*href=["']([^"']*\/chintai\/kyushu\/fukuoka\/[^"']*)["']/i);
  return any?.[1] || "";
}

function extractUrAddress(text) {
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/((?:福岡市|春日市|大野城市|糸島市|古賀市|新宮町|粕屋町|志免町|太宰府市|宇美町)[^\s]{1,40}(?:ほか)?)/);
  return match ? clean(match[1]) : "";
}

function buildSeedResponse(filters, mode, message) {
  const properties = SEED_PROPERTIES
    .filter((item) => isAreaMatch(item, filters.area))
    .filter((item) => isTypeMatch(item, filters.type))
    .map((item) => ({ ...item, score: calcScore(item, filters) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    meta: { mode, message, generatedAt: new Date().toISOString(), filters },
    properties,
    news: buildDefaultNews()
  };
}

function buildPropertyQueries(filters) {
  const areaTerms = areaTermsFromFilter(filters.area);
  const rentTerm = filters.rent ? `${filters.rent}万円以内` : "";
  const walkTerm = filters.walk && filters.walk < 999 ? `徒歩${filters.walk}分以内` : "";
  const base = `${areaTerms} 賃貸 2LDK ${rentTerm} ${walkTerm} -サ高住 -サービス付き高齢者向け住宅 -老人ホーム -介護施設`;
  const broad = `${areaTerms} 賃貸 2LDK -サ高住 -サービス付き高齢者向け住宅 -老人ホーム -介護施設`;
  const queries = [];

  if (["all", "public", "ur"].includes(filters.type)) {
    queries.push({ label: "UR賃貸", type: "ur", source: "UR都市機構", query: `site:ur-net.go.jp/chintai 福岡 UR 賃貸 2LDK` });
    queries.push({ label: "UR賃貸 エリア", type: "ur", source: "UR都市機構", query: `site:ur-net.go.jp/chintai ${areaTerms} UR 賃貸` });
  }

  if (["all", "public", "safety"].includes(filters.type)) {
    queries.push({ label: "セーフティネット住宅", type: "safety", source: "セーフティネット住宅", query: `site:safetynet-jutaku.jp 福岡 賃貸 住宅` });
    queries.push({ label: "福岡市 居住支援", type: "safety", source: "福岡市", query: `site:city.fukuoka.lg.jp 福岡市 居住支援 賃貸 高齢者` });
    queries.push({ label: "福岡県 住宅支援", type: "safety", source: "福岡県", query: `site:pref.fukuoka.lg.jp 福岡県 住宅支援 賃貸 高齢者` });
  }

  if (["all", "private"].includes(filters.type)) {
    queries.push({ label: "LIFULL HOME'S", type: "private", source: "LIFULL HOME'S", query: `site:homes.co.jp/chintai ${base}` });
    queries.push({ label: "SUUMO", type: "private", source: "SUUMO", query: `site:suumo.jp/chintai ${base}` });
    queries.push({ label: "アットホーム", type: "private", source: "アットホーム", query: `site:athome.co.jp ${base}` });
    queries.push({ label: "CHINTAI", type: "private", source: "CHINTAI", query: `site:chintai.net ${base}` });
    queries.push({ label: "一般賃貸 広め", type: "private", source: "一般賃貸検索", query: `(site:homes.co.jp OR site:suumo.jp OR site:athome.co.jp OR site:chintai.net) ${broad}` });
  }

  return queries;
}

function buildNewsQuery(filters) {
  const areaTerms = areaTermsFromFilter(filters.area);
  return `(site:city.fukuoka.lg.jp OR site:pref.fukuoka.lg.jp OR site:mlit.go.jp OR site:safetynet-jutaku.jp) ${areaTerms} 高齢者 賃貸 補助 居住支援 住宅`;
}

function areaTermsFromFilter(areaFilter) {
  if (areaFilter === "preferred_wards") return "福岡市西区 福岡市早良区 福岡市城南区";
  if (areaFilter === "fukuoka_city") return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区";
  if (areaFilter === "surrounding") return "糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
  return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区 糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
}

async function googleSearch(env, query, num = 10) {
  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", env.GOOGLE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", query.replace(/\s+/g, " ").trim());
  url.searchParams.set("num", String(Math.min(Math.max(num, 1), 10)));
  url.searchParams.set("lr", "lang_ja");
  url.searchParams.set("gl", "jp");
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body.slice(0, 240)}`);
  }

  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function normalizeProperty(item, queryInfo, filters) {
  const title = clean(item.title);
  const snippet = clean(item.snippet || "");
  const url = item.link;
  const text = `${title} ${snippet} ${url}`;

  if (!url || !title) return null;
  if (isExcluded(text)) return null;
  if (!looksLikeCandidate(text, queryInfo.type, url)) return null;

  const area = detectArea(text);
  const layout = extractLayout(text, filters.layout);
  const rent = extractRent(text, filters.rent);
  const walk = extractWalk(text, filters.walk);
  const imageUrl = extractImage(item);
  const source = detectSource(url, queryInfo.source);
  const type = detectType(url, queryInfo.type);
  const tags = buildTags(type, source, text, imageUrl);

  return {
    title,
    subtitle: snippet || source,
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type,
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
    note: buildNote(type, source, rent.flexible || walk.flexible || layout.flexible),
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
  if (isExcluded(`${title} ${summary} ${url}`)) return null;
  return { source: detectSource(url, "行政・住宅支援"), title, summary, url };
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
    .replace(/<\/tr>|<\/td>|<\/th>|<\/p>|<\/li>|<\/div>|<\/section>|<\/article>/gi, " ")
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
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function normalizeTitle(value) {
  return clean(value)
    .replace(/\s+/g, " ")
    .replace(/[｜|].*$/, "")
    .replace(/お気に入り.*$/, "")
    .replace(/空室状況.*$/, "")
    .trim();
}

function isLikelyUrPropertyTitle(title) {
  if (!title || title.length < 2 || title.length > 34) return false;
  if (CITY_ONLY_WORDS.has(title)) return false;
  if (/UR賃貸住宅|TOP|九州|福岡県|福岡市|物件を探す|店舗を探す|よくある|こちら|建物情報|お問い合わせ|お気に入り|空室状況|礼金|仲介手数料|更新料|保証人|PDF|選択|部屋名|家賃|共益費|間取り|床面積|階数|部屋詳細/.test(title)) return false;
  if (/^[0-9０-９]+$/.test(title)) return false;
  return true;
}

function guessUrTitleFromText(text) {
  const cleaned = clean(text);
  const candidates = cleaned.match(/[一-龥ぁ-んァ-ンーA-Za-z0-9０-９・ヶ\s]{2,34}/g) || [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const title = normalizeTitle(candidates[i]);
    if (isLikelyUrPropertyTitle(title)) return title;
  }
  return "";
}

function isExcluded(text) {
  return /サ高住|サービス付き高齢者向け住宅|老人ホーム|介護施設|有料老人|グループホーム/.test(text);
}

function looksLikeCandidate(text, type, url) {
  if (type === "safety") return /賃貸|住宅|居住支援|セーフティネット|入居|住まい/.test(text);
  if (/homes\.co\.jp|suumo\.jp|athome\.co\.jp|chintai\.net|ur-net\.go\.jp/.test(url)) return true;
  return /賃貸|マンション|アパート|UR|物件|住宅/.test(text);
}

function detectArea(text) {
  const found = AREA_KEYWORDS.find((area) => text.includes(area));
  if (found) return found;
  if (/姪浜|今宿|九大学研都市|周船寺|橋本|下山門/.test(text)) return "福岡市西区";
  if (/西新|藤崎|室見|百道|野芥|賀茂/.test(text)) return "福岡市早良区";
  if (/別府|七隈|茶山|金山|福大前/.test(text)) return "福岡市城南区";
  if (/天神|薬院|六本松|大濠|唐人町|平尾/.test(text)) return "福岡市中央区";
  if (/博多|吉塚|竹下|東比恵|千代/.test(text)) return "福岡市博多区";
  if (/香椎|千早|箱崎|和白|照葉|星の原/.test(text)) return "福岡市東区";
  if (/大橋|高宮|井尻|平尾|笹原/.test(text)) return "福岡市南区";
  if (/春日公園|大野城|白木原/.test(text)) return "春日市";
  return "福岡市西区";
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
  const yenMatches = [...normalized.matchAll(/([0-9,]+)\s?円/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 10000 && n <= 500000);
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
  const matches = [...normalized.matchAll(/徒歩\s?([0-9]+)\s?[〜~\-－]?\s?([0-9]+)?\s?分/g)]
    .map((m) => Number(m[1]))
    .filter(Boolean);
  if (!matches.length) return { value: defaultWalk, label: `徒歩${defaultWalk}分以内 / 要確認`, flexible: true };
  const value = Math.min(...matches);
  return { value, label: `徒歩${value}分〜`, flexible: value <= defaultWalk };
}

function extractVacancy(text) {
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/空室状況\s*([0-9]+)|該当空室数\s*([0-9]+)/);
  return match?.[1] || match?.[2] || "";
}

function extractTransit(text) {
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/((?:JR|西鉄|福岡市営|地下鉄|福岡市地下鉄|市営地下鉄)[^。]{0,180}?(?:徒歩|バス)[^。]{0,120}?(?:分|団地))/);
  return match ? clean(match[1]) : "";
}

function extractImage(item) {
  const pagemap = item.pagemap || {};
  const thumb = pagemap.cse_thumbnail?.[0]?.src;
  const cseImage = pagemap.cse_image?.[0]?.src;
  const ogImage = pagemap.metatags?.[0]?.["og:image"];
  return thumb || cseImage || ogImage || "";
}

function extractUrImage(block) {
  const images = [];
  const imgRe = /<img\b[^>]*(?:src|data-src|data-original|data-lazy|data-img)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRe.exec(block)) !== null) {
    const src = decodeHtml(match[1]);
    if (!src || /logo|icon|ico|bnr|button|favorite|sprite|arrow|search|map|pdf/i.test(src)) continue;
    const abs = absoluteUrl(src);
    const score = /madori|floor|plan|layout|間取|間取り/i.test(abs) ? 1 : 2;
    images.push({ url: abs, score });
  }
  images.sort((a, b) => b.score - a.score);
  return images[0]?.url || "";
}

function absoluteUrl(value) {
  try {
    return new URL(decodeHtml(value), UR_ORIGIN).href;
  } catch {
    return value;
  }
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

function detectType(url, fallback) {
  if (url.includes("ur-net.go.jp")) return "ur";
  if (url.includes("city.fukuoka.lg.jp") || url.includes("pref.fukuoka.lg.jp") || url.includes("safetynet-jutaku.jp")) return "safety";
  if (url.includes("homes.co.jp") || url.includes("suumo.jp") || url.includes("athome.co.jp") || url.includes("chintai.net")) return "private";
  return fallback;
}

function buildTags(type, source, text, imageUrl) {
  const tags = [];
  if (type === "ur" || source.includes("UR")) tags.push("UR", "公的");
  if (type === "safety") tags.push("行政", "高齢者相談");
  if (type === "private") tags.push("一般賃貸");
  if (/保証人不要/.test(text)) tags.push("保証人不要");
  if (/保証会社/.test(text)) tags.push("保証会社");
  if (/2LDK|3LDK|4LDK|2DK|3DK/.test(text)) tags.push("2LDK以上");
  tags.push(imageUrl ? "取得画像" : "代表画像");
  return [...new Set(tags)];
}

function buildNote(type, source, hasUnknowns) {
  if (type === "ur") return "Google検索結果から取得したUR関連候補です。実際の空室・家賃・入居条件はリンク先で確認してください。";
  if (type === "safety") return "行政・居住支援系の検索結果です。無職・年金見込み・保証人不安がある場合に優先確認してください。";
  return `${source}の検索結果です。${hasUnknowns ? "家賃・間取り・駅徒歩はリンク先で再確認してください。" : "空室、管理費込み家賃、審査条件はリンク先で確認してください。"}`;
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
    const key = `${item.title}|${item.rentLabel}|${item.layoutLabel}|${item.url}`;
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
  if (!item.flexibleRent && item.rentHint <= filter.rent) score += 8;
  if (!item.flexibleWalk && item.walkHint <= filter.walk) score += 8;
  if (item.layoutMin >= filter.layout) score += 8;

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
    if (!item.flexibleWalk && item.walkHint <= 10) score += 18;
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
      "Cache-Control": "no-store"
    }
  });
}
