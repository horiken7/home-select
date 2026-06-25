// Cloudflare Workers API for home-select
// Google Programmable Search API + UR diagnostic/direct parser.
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
        urDirectConfigured: true,
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/debug/ur") {
      return json(await buildUrDiagnostics(filters));
    }

    if (url.pathname === "/search" || url.pathname === "/") {
      return json(await buildSearchResponse(env, filters));
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
      const ur = await fetchUrDirectResults(filters);
      urDirectCount = ur.length;
      propertyResults.push(...ur);
    } catch (error) {
      errors.push(`UR公式直接取得: ${error.message}`);
    }
  }

  if (env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID) {
    for (const queryInfo of buildPropertyQueries(filters)) {
      try {
        const items = await googleSearch(env, queryInfo.query, 10);
        for (const item of items) {
          const normalized = normalizeGoogleProperty(item, queryInfo, filters);
          if (normalized) propertyResults.push(normalized);
        }
      } catch (error) {
        errors.push(`${queryInfo.label}: ${error.message}`);
      }
    }
  }

  const properties = finalizeProperties(propertyResults, filters);
  const news = env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID ? await fetchNews(env, filters, errors) : [];

  if (properties.length) {
    return {
      meta: {
        mode: urDirectCount ? "ur-direct-google-api" : "google-api",
        message: urDirectCount
          ? "UR公式ページから部屋情報を直接抽出し、不足分をGoogle Programmable Search APIで補完しています。"
          : "Google Programmable Search APIから対象ソースの検索結果を取得しています。",
        generatedAt: new Date().toISOString(),
        filters,
        urDirectCount,
        googleApiConfigured: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID),
        errors
      },
      properties,
      news: news.length ? dedupeByUrl(news).slice(0, 6) : buildDefaultNews()
    };
  }

  return buildSeedResponse(filters, "no-results", "UR公式直接取得とGoogle API検索を実行しましたが、表示できる候補が取れませんでした。/debug/ur で診断してください。", errors);
}

async function buildUrDiagnostics(filters) {
  const fetched = await fetchUrHtml();
  const text = stripTags(fetched.html);
  let parsed = [];
  let parseError = "";

  try {
    parsed = parseUrHtml(fetched.html, filters);
  } catch (error) {
    parseError = error.message;
  }

  return {
    ok: parsed.length > 0,
    url: UR_DIRECT_RESULT_URL,
    status: fetched.status,
    contentType: fetched.contentType,
    htmlLength: fetched.html.length,
    textLength: text.length,
    contains: {
      abeinkasuga: fetched.html.includes("アーベイン春日公園") || text.includes("アーベイン春日公園"),
      rent73700: fetched.html.includes("73,700") || text.includes("73,700"),
      vacancy: fetched.html.includes("空室状況") || text.includes("空室状況"),
      room402: fetched.html.includes("402") || text.includes("402"),
      chintai: fetched.html.includes("/chintai/")
    },
    parsedCount: parsed.length,
    parseError,
    properties: parsed.slice(0, 5),
    textSample: text.slice(0, 2500),
    imageCandidates: extractAllImages(fetched.html).slice(0, 20),
    scriptCandidates: extractAllScripts(fetched.html).slice(0, 20)
  };
}

async function fetchUrDirectResults(filters) {
  const fetched = await fetchUrHtml();
  const parsed = parseUrHtml(fetched.html, filters);
  if (!parsed.length) throw new Error("URページから物件カードを抽出できませんでした");
  return parsed;
}

async function fetchUrHtml() {
  const res = await fetch(UR_DIRECT_RESULT_URL, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.6",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    }
  });

  const html = await res.text();
  if (!res.ok) throw new Error(`UR HTTP ${res.status}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    html
  };
}

function parseUrHtml(html, filters) {
  const text = normalizeFullWidth(stripTags(html));
  const imageCandidates = extractAllImages(html).filter((src) => !/logo|icon|ico|bnr|button|favorite|sprite|arrow|search|map|pdf/i.test(src));
  const preferredImage = imageCandidates.find((src) => /chintai|kyushu|fukuoka|photo|img|jpg|jpeg|png/i.test(src)) || imageCandidates[0] || "";

  const rooms = extractUrRooms(text);
  if (rooms.length) {
    return rooms.map((room) => normalizeUrRoom({
      propertyName: extractBestPropertyName(text, room.index),
      room,
      text,
      filters,
      propertyUrl: UR_DIRECT_RESULT_URL,
      imageUrl: room.floorImage || preferredImage || DEFAULT_IMAGE,
      area: detectArea(text),
      transit: extractTransit(text),
      address: extractUrAddress(text),
      vacancy: extractVacancy(text)
    }));
  }

  const propertyName = extractBestPropertyName(text, 0);
  if (!isLikelyPropertyName(propertyName)) return [];

  return [normalizeUrRoom({
    propertyName,
    room: null,
    text,
    filters,
    propertyUrl: UR_DIRECT_RESULT_URL,
    imageUrl: preferredImage || DEFAULT_IMAGE,
    area: detectArea(text),
    transit: extractTransit(text),
    address: extractUrAddress(text),
    vacancy: extractVacancy(text)
  })];
}

function extractUrRooms(text) {
  const rooms = [];
  const patterns = [
    /([0-9]+号棟\s*[0-9]+号室)\s+([0-9,]+円)\s*(?:\(([0-9,]+円)\))?\s+([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))\s+([0-9]+階)/gi,
    /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,240}?([0-9,]+円)[\s\S]{0,80}?\(([0-9,]+円)\)[\s\S]{0,240}?([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))[\s\S]{0,160}?([0-9]+階)/gi,
    /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,300}?([0-9,]+円)[\s\S]{0,300}?([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))[\s\S]{0,200}?([0-9]+階)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      rooms.push({
        index: match.index,
        roomName: clean(match[1]),
        rentYen: clean(match[2]),
        commonFeeYen: clean(match[3] || ""),
        layout: clean(match[4]).replace(/m2/i, "㎡"),
        floor: clean(match[5]),
        floorImage: ""
      });
    }
    if (rooms.length) break;
  }

  return dedupeRooms(rooms);
}

function normalizeUrRoom({ propertyName, room, text, filters, propertyUrl, imageUrl, area, transit, address, vacancy }) {
  const name = isLikelyPropertyName(propertyName) ? propertyName : "UR賃貸 物件名要確認";
  const layout = room?.layout ? parseLayoutLabel(room.layout, filters.layout) : extractLayout(text, filters.layout);
  const rent = room?.rentYen ? parseRentYen(room.rentYen, room.commonFeeYen, filters.rent) : extractRent(text, filters.rent);
  const walk = extractWalk(transit || text, filters.walk);
  const title = room ? `${name} ${room.roomName}` : name;
  const note = [
    "UR公式ページから直接取得。",
    vacancy ? `団地の空室状況は${vacancy}件。` : "",
    room?.rentYen ? "部屋別の家賃・間取り・階数を抽出済み。" : "部屋別情報はリンク先で確認してください。",
    "最新の空室・申込状況はUR公式ページで確認してください。"
  ].filter(Boolean).join("");

  return {
    title,
    subtitle: [transit, address].filter(Boolean).join(" / ") || "UR公式ページから取得した候補です。",
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
    tags: ["UR", "公的", "保証人不要", "UR公式直接", imageUrl === DEFAULT_IMAGE ? "代表画像" : "取得画像", room?.floor || "階数要確認"],
    note,
    url: propertyUrl,
    subUrl: "https://www.ur-net.go.jp/chintai/about/",
    imageUrl,
    imageLabel: imageUrl === DEFAULT_IMAGE ? "代表画像" : "UR取得画像"
  };
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
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function normalizeGoogleProperty(item, queryInfo, filters) {
  const title = clean(item.title);
  const snippet = clean(item.snippet || "");
  const url = item.link;
  const text = `${title} ${snippet} ${url}`;
  if (!url || !title || isExcluded(text)) return null;
  if (!looksLikeCandidate(text, queryInfo.type, url)) return null;

  const area = detectArea(text);
  const layout = extractLayout(text, filters.layout);
  const rent = extractRent(text, filters.rent);
  const walk = extractWalk(text, filters.walk);
  const imageUrl = extractGoogleImage(item) || DEFAULT_IMAGE;
  const source = detectSource(url, queryInfo.source);
  const type = detectType(url, queryInfo.type);
  const tags = buildTags(type, source, text, imageUrl !== DEFAULT_IMAGE);

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
    imageUrl,
    imageLabel: imageUrl === DEFAULT_IMAGE ? "代表画像" : "取得画像"
  };
}

function normalizeNews(item) {
  const title = clean(item.title);
  const summary = clean(item.snippet || "");
  const url = item.link;
  if (!url || !title || isExcluded(`${title} ${summary} ${url}`)) return null;
  return { source: detectSource(url, "行政・住宅支援"), title, summary, url };
}

function buildSeedResponse(filters, mode, message, errors = []) {
  const properties = [{
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
    imageLabel: "代表画像",
    score: 100
  }];

  return { meta: { mode, message, generatedAt: new Date().toISOString(), filters, errors }, properties, news: buildDefaultNews() };
}

function buildNewsQuery(filters) {
  return `(site:city.fukuoka.lg.jp OR site:pref.fukuoka.lg.jp OR site:mlit.go.jp OR site:safetynet-jutaku.jp) ${areaTermsFromFilter(filters.area)} 高齢者 賃貸 補助 居住支援 住宅`;
}

function areaTermsFromFilter(areaFilter) {
  if (areaFilter === "preferred_wards") return "福岡市西区 福岡市早良区 福岡市城南区";
  if (areaFilter === "fukuoka_city") return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区";
  if (areaFilter === "surrounding") return "糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
  return "福岡市 西区 早良区 城南区 中央区 博多区 東区 南区 糸島市 春日市 大野城市 那珂川市 古賀市 新宮町 粕屋町 志免町 太宰府市 宇美町";
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

function extractBestPropertyName(text, roomIndex = 0) {
  const before = text.slice(Math.max(0, roomIndex - 4500), roomIndex || 4500);
  const patterns = [
    /(アーベイン春日公園)/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,30})\s+お気に入り/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,30})\s+(?:JR|西鉄|福岡市営|地下鉄)/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,30})\s+空室状況/
  ];
  for (const pattern of patterns) {
    const match = before.match(pattern) || text.match(pattern);
    const name = normalizeTitle(match?.[1] || "");
    if (isLikelyPropertyName(name)) return name;
  }
  return "";
}

function normalizeTitle(value) {
  return clean(value).replace(/お気に入り.*$/, "").replace(/空室状況.*$/, "").trim();
}

function isLikelyPropertyName(name) {
  if (!name || name.length < 2 || name.length > 34) return false;
  if (CITY_ONLY_WORDS.has(name)) return false;
  if (/UR賃貸住宅|TOP|九州|福岡県|福岡市|物件を探す|店舗を探す|よくある|こちら|建物情報|お問い合わせ|お気に入り|空室状況|礼金|仲介手数料|更新料|保証人|PDF|選択|部屋名|家賃|共益費|間取り|床面積|階数|部屋詳細/.test(name)) return false;
  if (/^[0-9]+$/.test(name)) return false;
  return true;
}

function parseRentYen(rentYen, commonFeeYen, defaultRent) {
  const yen = Number(String(rentYen).replace(/[^0-9]/g, ""));
  const fee = Number(String(commonFeeYen || "").replace(/[^0-9]/g, ""));
  const value = yen ? Math.round((yen / 10000) * 100) / 100 : defaultRent;
  const feeText = fee ? `（共益費 ${fee.toLocaleString("ja-JP")}円）` : "";
  return { value, label: yen ? `${yen.toLocaleString("ja-JP")}円 ${feeText}`.trim() : `${defaultRent}万円以内 / 要確認`, flexible: !yen || value <= defaultRent };
}

function parseLayoutLabel(label, defaultLayout) {
  const normalized = normalizeFullWidth(label);
  const value = Number(normalized.match(/([1-5])\s?(?:LDK|DK|K)/i)?.[1] || defaultLayout);
  return { min: value, label: clean(normalized), flexible: false };
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
  const matches = [...normalized.matchAll(/徒歩\s?([0-9]+)\s?[〜~\-－]?\s?([0-9]+)?\s?分/g)].map((m) => Number(m[1])).filter(Boolean);
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

function extractUrAddress(text) {
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/((?:福岡市|春日市|大野城市|糸島市|古賀市|新宮町|粕屋町|志免町|太宰府市|宇美町)[^\s]{1,40}(?:ほか)?)/);
  return match ? clean(match[1]) : "";
}

function extractAllImages(html) {
  const images = [];
  const re = /<img\b[^>]*(?:src|data-src|data-original|data-lazy|data-img)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html || "")) !== null) {
    images.push(absoluteUrl(decodeHtml(match[1])));
  }
  return [...new Set(images)];
}

function extractAllScripts(html) {
  const scripts = [];
  const re = /<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html || "")) !== null) {
    scripts.push(absoluteUrl(decodeHtml(match[1])));
  }
  return [...new Set(scripts)];
}

function extractGoogleImage(item) {
  const pagemap = item.pagemap || {};
  return pagemap.cse_thumbnail?.[0]?.src || pagemap.cse_image?.[0]?.src || pagemap.metatags?.[0]?.["og:image"] || "";
}

function absoluteUrl(value) {
  try { return new URL(decodeHtml(value), UR_ORIGIN).href; } catch { return value; }
}

function detectArea(text) {
  const found = AREA_KEYWORDS.find((area) => text.includes(area));
  if (found) return found;
  if (/春日公園|大野城|白木原/.test(text)) return "春日市";
  if (/姪浜|今宿|九大学研都市|周船寺|橋本|下山門/.test(text)) return "福岡市西区";
  if (/西新|藤崎|室見|百道|野芥|賀茂/.test(text)) return "福岡市早良区";
  if (/別府|七隈|茶山|金山|福大前/.test(text)) return "福岡市城南区";
  if (/天神|薬院|六本松|大濠|唐人町|平尾/.test(text)) return "福岡市中央区";
  if (/博多|吉塚|竹下|東比恵|千代/.test(text)) return "福岡市博多区";
  if (/香椎|千早|箱崎|和白|照葉|星の原/.test(text)) return "福岡市東区";
  if (/大橋|高宮|井尻|平尾|笹原/.test(text)) return "福岡市南区";
  return "福岡市西区";
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

function buildNote(type, source, hasUnknowns) {
  if (type === "ur") return "Google検索結果から取得したUR関連候補です。実際の空室・家賃・入居条件はリンク先で確認してください。";
  if (type === "safety") return "行政・居住支援系の検索結果です。無職・年金見込み・保証人不安がある場合に優先確認してください。";
  return `${source}の検索結果です。${hasUnknowns ? "家賃・間取り・駅徒歩はリンク先で再確認してください。" : "空室、管理費込み家賃、審査条件はリンク先で確認してください。"}`;
}

function isExcluded(text) {
  return /サ高住|サービス付き高齢者向け住宅|老人ホーム|介護施設|有料老人|グループホーム/.test(text);
}

function looksLikeCandidate(text, type, url) {
  if (type === "safety") return /賃貸|住宅|居住支援|セーフティネット|入居|住まい/.test(text);
  if (/homes\.co\.jp|suumo\.jp|athome\.co\.jp|chintai\.net|ur-net\.go\.jp/.test(url)) return true;
  return /賃貸|マンション|アパート|UR|物件|住宅/.test(text);
}

function dedupeRooms(rooms) {
  const seen = new Set();
  return rooms.filter((room) => {
    const key = `${room.roomName}|${room.rentYen}|${room.layout}|${room.floor}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
