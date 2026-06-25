import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "properties.json");
const DIAG_OUT = path.join(process.cwd(), "data", "scrape-diagnostics.json");
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=75";

const DEFAULT_LIMITS = {
  rent: 10,
  walk: 15,
  layout: 2
};

const UR_URL = "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/result/?area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&rent_high=100000&walk=15&tdfk=40&todofuken=fukuoka";

const SOURCE_URLS = [
  {
    id: "ur",
    label: "UR都市機構",
    type: "ur",
    url: UR_URL,
    note: "UR公式サイトをPlaywrightで開き、JavaScript描画後の検索結果から抽出します。"
  },
  {
    id: "homes",
    label: "LIFULL HOME'S",
    type: "private",
    url: "https://www.homes.co.jp/chintai/fukuoka/fukuoka-city/list/",
    note: "HOME'Sの検索結果ページをPlaywrightで確認します。取得できない場合は検索導線として残します。"
  },
  {
    id: "suumo",
    label: "SUUMO",
    type: "private",
    url: "https://suumo.jp/chintai/fukuoka/sa_fukuoka/",
    note: "SUUMOの検索結果ページをPlaywrightで確認します。取得できない場合は検索導線として残します。"
  },
  {
    id: "athome",
    label: "アットホーム",
    type: "private",
    url: "https://www.athome.co.jp/chintai/fukuoka/fukuoka-city/list/",
    note: "アットホームの検索結果ページをPlaywrightで確認します。取得できない場合は検索導線として残します。"
  },
  {
    id: "chintai",
    label: "CHINTAI",
    type: "private",
    url: "https://www.chintai.net/fukuoka/area/40130/list/",
    note: "CHINTAIの検索結果ページをPlaywrightで確認します。取得できない場合は検索導線として残します。"
  },
  {
    id: "safetynet",
    label: "セーフティネット住宅",
    type: "safety",
    url: "https://www.safetynet-jutaku.jp/guest/index.php",
    note: "住宅確保要配慮者向けの公的検索導線です。"
  },
  {
    id: "fukuoka-city",
    label: "福岡市 居住支援",
    type: "safety",
    url: "https://www.city.fukuoka.lg.jp/jutaku-toshi/jigyochosei/life/kyojuushienkyougikai.html",
    note: "福岡市の住まいサポート・居住支援情報です。"
  }
];

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
  "宇美町": 50,
  "福岡市全域": 55
};

const UR_PROPERTY_BY_CODE = {
  "90_1440": "アーベイン春日公園",
  "90_0270": "香椎若葉団地"
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  viewport: { width: 1440, height: 1100 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
});

const all = [];
const diagnostics = [];

try {
  for (const source of SOURCE_URLS) {
    const page = await context.newPage();
    try {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await settle(page);

      let items = [];
      if (source.id === "ur") {
        items = await scrapeUr(page, source);
      } else if (source.id === "suumo") {
        items = await scrapeSuumo(page, source);
      } else if (["homes", "athome", "chintai"].includes(source.id)) {
        items = await scrapeGenericRentalSite(page, source);
      }

      if (!items.length) {
        items = [sourceLinkCard(source, "実物件カードは自動抽出できませんでした。公式検索ページを開いて確認してください。")];
      }

      const enriched = items.map(enrichItem).filter(Boolean);
      diagnostics.push(buildDiagnostic(source, enriched, page.url()));
      all.push(...enriched);
    } catch (error) {
      const fallback = enrichItem(sourceLinkCard(source, `自動取得に失敗しました：${error.message.slice(0, 90)}`));
      diagnostics.push({ source: source.label, ok: false, count: 1, realCount: 0, needsCheckCount: 0, sourceLinkCount: 1, error: error.message, url: source.url });
      all.push(fallback);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}

const output = dedupe(all)
  .map((item) => ({ ...item, score: typeof item.score === "number" ? item.score : calcScore(item) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 60);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(DIAG_OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), diagnostics }, null, 2)}\n`, "utf8");

console.log(`wrote ${output.length} properties to ${OUT}`);
console.table(diagnostics);

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  for (const y of [600, 1400, 2600, 0]) {
    await page.mouse.wheel(0, y);
    await page.waitForTimeout(700);
  }
}

async function scrapeUr(page, source) {
  const data = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const goodImage = (img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt || "",
      w: img.naturalWidth || img.width || 0,
      h: img.naturalHeight || img.height || 0
    });
    const getLinks = (el) => Array.from(el.querySelectorAll("a[href]"))
      .map((a) => ({ href: a.href, text: normalizeText(a.innerText || a.textContent || a.getAttribute("aria-label") || "") }))
      .filter((link) => link.href && !link.href.startsWith("javascript:"));

    const pageText = document.body.innerText || "";
    const images = Array.from(document.images).map(goodImage).filter((img) => img.src && img.w >= 120 && img.h >= 80);

    const rows = Array.from(document.querySelectorAll("tr, li, article, section, div"))
      .map((el) => {
        const text = normalizeText(el.innerText || "");
        const links = getLinks(el);
        const image = Array.from(el.querySelectorAll("img")).map(goodImage).filter((img) => img.src && img.w >= 80 && img.h >= 60)[0];
        return {
          text,
          href: links.find((link) => /_room\.html|room|JKSS/i.test(link.href))?.href || links[0]?.href || "",
          links,
          image: image?.src || ""
        };
      })
      .filter((row) => /号室/.test(row.text) && /円/.test(row.text) && /(?:LDK|DK|K|㎡|m2|m²)/i.test(row.text))
      .filter((row) => row.text.length > 30 && row.text.length < 1800)
      .sort((a, b) => a.text.length - b.text.length)
      .slice(0, 40);

    const candidateBlocks = Array.from(document.querySelectorAll("article, section, li, div, table, tbody"))
      .map((el) => ({
        text: normalizeText(el.innerText || ""),
        href: getLinks(el).find((link) => /_room\.html|room|JKSS/i.test(link.href))?.href || getLinks(el)[0]?.href || location.href,
        links: getLinks(el),
        images: Array.from(el.querySelectorAll("img")).map(goodImage).filter((img) => img.src && img.w >= 80 && img.h >= 60)
      }))
      .filter((x) => x.text.includes("空室状況") || x.text.includes("部屋詳細") || x.text.includes("家賃") || x.text.includes("共益費"))
      .filter((x) => x.text.length > 80 && x.text.length < 12000)
      .sort((a, b) => a.text.length - b.text.length)
      .slice(0, 20);

    return { pageText, images, rows, candidateBlocks, url: location.href, title: document.title };
  });

  const items = [];
  const pageImage = pickImage(data.images);
  const pageContext = normalize(`${data.title} ${data.pageText}`);

  for (const row of data.rows) {
    const parsed = parseUrBlock(row.text, source, {
      pageContext,
      pageUrl: data.url,
      rowUrl: normalizeUrl(row.href, data.url),
      links: row.links,
      imageUrl: row.image || pageImage
    });
    items.push(...parsed);
  }

  if (!items.length) {
    for (const block of data.candidateBlocks) {
      const parsed = parseUrBlock(block.text, source, {
        pageContext,
        pageUrl: data.url,
        rowUrl: normalizeUrl(block.href, data.url),
        links: block.links,
        imageUrl: pickImage(block.images) || pageImage
      });
      items.push(...parsed);
    }
  }

  if (!items.length) {
    items.push(...parseUrBlock(data.pageText, source, {
      pageContext,
      pageUrl: data.url,
      rowUrl: data.url,
      links: [],
      imageUrl: pageImage
    }));
  }

  return dedupe(items).slice(0, 25);
}

function parseUrBlock(rawText, source, options = {}) {
  const text = normalize(rawText);
  const context = normalize(`${text} ${options.pageContext || ""}`);
  const rooms = [];
  const roomPatterns = [
    /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,160}?([0-9,]+円)[\s\S]{0,120}?(?:\(([0-9,]+円)\)|共益費\s*([0-9,]+円))?[\s\S]{0,260}?([1-5]\s?(?:LDK|DK|K)\s*(?:\/\s*[0-9.]+\s*(?:㎡|m²|m2))?)[\s\S]{0,220}?([0-9]+階)/gi,
    /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,360}?([0-9,]+円)[\s\S]{0,360}?([1-5]\s?(?:LDK|DK|K)\s*(?:\/\s*[0-9.]+\s*(?:㎡|m²|m2))?)[\s\S]{0,220}?([0-9]+階)/gi
  ];

  for (const pattern of roomPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const layout = clean(match[5] || match[3]).replace(/m2/i, "㎡");
      rooms.push({
        index: match.index,
        roomName: clean(match[1]),
        rentYen: clean(match[2]),
        commonFeeYen: clean(match[3] || match[4] || ""),
        layout,
        floor: clean(match[6] || match[4] || "")
      });
    }
    if (rooms.length) break;
  }

  const propertyName = guessPropertyName(context, options.rowUrl || options.pageUrl);
  const area = detectArea(context);
  const address = extractAddress(context);
  const transit = extractTransit(context);
  const vacancy = extractVacancy(context);
  const estateUrl = urEstateUrl(options.rowUrl || options.pageUrl) || options.pageUrl;

  if (!rooms.length) {
    if (!propertyName) return [];
    return [baseProperty({
      source,
      title: propertyName,
      subtitle: [transit, address].filter(Boolean).join(" / ") || "UR公式ページから取得した候補です。",
      area,
      layoutLabel: "2LDK以上 / リンク先で確認",
      layoutKnown: false,
      rentLabel: "リンク先で確認",
      rentKnown: false,
      walkLabel: transit ? extractWalkLabel(transit) : "リンク先で確認",
      walkKnown: Boolean(transit),
      walkHint: extractWalkHint(transit),
      tags: ["UR", "公的", "保証人不要", "UR自動取得"],
      note: `UR公式ページから取得。${vacancy ? `団地の空室状況は${vacancy}件。` : ""}部屋別条件はリンク先で確認してください。`,
      url: estateUrl,
      imageUrl: options.imageUrl
    })];
  }

  return rooms.map((room) => {
    const rent = rentFromYen(room.rentYen, room.commonFeeYen);
    const roomUrl = pickRoomUrl(options.links, room, options.rowUrl) || estateUrl || options.pageUrl;
    return baseProperty({
      source,
      title: `${propertyName || "UR賃貸"} ${room.roomName}`,
      subtitle: [transit, address].filter(Boolean).join(" / ") || "UR公式ページから取得した部屋候補です。",
      area,
      layoutLabel: room.layout,
      layoutRank: layoutRank(room.layout),
      layoutKnown: true,
      rentLabel: rent.label,
      rentHint: rent.value,
      rentKnown: rent.known,
      walkLabel: transit ? extractWalkLabel(transit) : "リンク先で確認",
      walkHint: extractWalkHint(transit),
      walkKnown: Boolean(transit),
      tags: ["UR", "公的", "保証人不要", "UR自動取得", room.floor].filter(Boolean),
      note: `UR公式ページから部屋情報を取得。${vacancy ? `団地の空室状況は${vacancy}件。` : ""}最新の空室・申込状況はUR公式で確認してください。`,
      url: roomUrl,
      imageUrl: options.imageUrl
    });
  });
}

async function scrapeSuumo(page, source) {
  const data = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const textOf = (root, selector) => normalizeText(root.querySelector(selector)?.innerText || "");
    const validHref = (href) => href && !href.startsWith("javascript:") && !href.startsWith("#");
    const toAbs = (href) => {
      try { return new URL(href, location.origin).href; } catch { return ""; }
    };
    const pickHref = (root) => {
      const links = Array.from(root.querySelectorAll("a[href]")).map((a) => ({ href: a.getAttribute("href") || "", text: normalizeText(a.innerText || a.textContent || "") }));
      const preferred = links.find((link) => validHref(link.href) && /\/chintai\/(?:jnc_|bc_|detail)/.test(link.href))
        || links.find((link) => validHref(link.href) && /詳細|物件|部屋/.test(link.text))
        || links.find((link) => validHref(link.href));
      return preferred ? toAbs(preferred.href) : "";
    };
    const pickImage = (root) => {
      const img = Array.from(root.querySelectorAll("img"))
        .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || "", w: i.naturalWidth || i.width || 0, h: i.naturalHeight || i.height || 0 }))
        .filter((i) => i.src && i.w >= 80 && i.h >= 60 && !/logo|icon|button|sprite|bnr|banner/i.test(i.src))
        .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
      return img?.src || "";
    };

    const buildings = Array.from(document.querySelectorAll(".cassetteitem"));
    const cards = [];
    for (const building of buildings) {
      const buildingText = normalizeText(building.innerText || "");
      const buildingName = textOf(building, ".cassetteitem_content-title") || textOf(building, "h2,h3") || "SUUMO物件";
      const address = textOf(building, ".cassetteitem_detail-col1");
      const transit = textOf(building, ".cassetteitem_detail-col2");
      const age = textOf(building, ".cassetteitem_detail-col3");
      const image = pickImage(building);
      const rows = Array.from(building.querySelectorAll("tbody tr.js-cassette_link, tbody tr"));
      if (!rows.length) {
        cards.push({ title: buildingName, text: buildingText, href: pickHref(building), image, address, transit, age });
        continue;
      }
      for (const row of rows) {
        const rowText = normalizeText(row.innerText || "");
        if (!/万円|円|LDK|DK|K|m2|㎡|m²/.test(rowText)) continue;
        cards.push({
          title: buildingName,
          text: normalizeText(`${buildingName} ${address} ${transit} ${age} ${rowText}`),
          href: pickHref(row) || pickHref(building),
          image,
          address,
          transit,
          age
        });
      }
    }

    return { cards: cards.slice(0, 40), title: document.title, url: location.href };
  });

  return data.cards.map((card) => normalizeGenericCard(card, source, { site: "suumo" })).filter(Boolean).slice(0, 20);
}

async function scrapeGenericRentalSite(page, source) {
  const data = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const validHref = (href) => href && !href.startsWith("javascript:") && !href.startsWith("#");
    const toAbs = (href) => {
      try { return new URL(href, location.origin).href; } catch { return ""; }
    };
    const pickHref = (el) => {
      const links = Array.from(el.querySelectorAll("a[href]")).map((a) => ({ href: a.getAttribute("href") || "", text: normalizeText(a.innerText || a.textContent || "") }));
      const preferred = links.find((link) => validHref(link.href) && /detail|bukken|chintai|room|物件|賃貸/i.test(`${link.href} ${link.text}`))
        || links.find((link) => validHref(link.href));
      return preferred ? toAbs(preferred.href) : "";
    };
    const selectors = [
      "article", "li", ".cassetteitem", ".property", ".bukken", ".mod-mergeBuilding", ".building", ".estate", ".result", ".list", "[class*='property']", "[class*='bukken']"
    ];
    const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
    const cards = nodes.map((el) => {
      const text = normalizeText(el.innerText || "");
      const img = Array.from(el.querySelectorAll("img"))
        .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || "", w: i.naturalWidth || i.width || 0, h: i.naturalHeight || i.height || 0 }))
        .filter((i) => i.src && i.w >= 80 && i.h >= 60 && !/logo|icon|btn|button|sprite|search|map|pdf|bnr|banner/i.test(i.src))
        .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
      return { text, href: pickHref(el), image: img?.src || "", title: "" };
    }).filter((c) => c.text.length > 80 && c.text.length < 3500)
      .filter((c) => /賃料|家賃|万円|2LDK|3LDK|3DK|間取り|徒歩|歩/.test(c.text))
      .slice(0, 30);
    return { cards, title: document.title, url: location.href };
  });

  return data.cards.map((card) => normalizeGenericCard(card, source)).filter(Boolean).slice(0, 12);
}

function normalizeGenericCard(card, source, options = {}) {
  const text = normalize(card.text);
  if (/サ高住|老人ホーム|介護施設|サービス付き高齢者向け住宅/.test(text)) return null;

  const title = clean(card.title || guessGenericTitle(text, source.label));
  const area = detectArea(text);
  const rent = extractRent(text);
  const layout = extractLayout(text);
  const walk = extractWalk(text);
  const href = normalizeUrl(card.href, source.url);
  const genericTitle = isGenericTitle(title);

  return baseProperty({
    source,
    title: genericTitle ? `${source.label} 検索候補` : title,
    subtitle: summarize(text),
    area,
    layoutLabel: layout.label,
    layoutRank: layout.rank,
    layoutKnown: layout.known,
    rentLabel: rent.label,
    rentHint: rent.value,
    rentKnown: rent.known,
    walkLabel: walk.label,
    walkHint: walk.value,
    walkKnown: walk.known,
    tags: ["一般賃貸", source.label, card.image ? "取得画像" : "代表画像", genericTitle ? "条件要確認" : ""].filter(Boolean),
    note: `${source.label}から自動抽出した候補です。管理費込み家賃・入居審査・空室はリンク先で確認してください。`,
    url: href || source.url,
    imageUrl: card.image,
    site: options.site
  });
}

function baseProperty({ source, title, subtitle, area, layoutLabel, layoutRank: rank, layoutKnown = true, rentLabel, rentHint, rentKnown = true, walkLabel, walkHint, walkKnown = true, tags = [], note, url, imageUrl }) {
  const normalizedUrl = normalizeUrl(url, source.url);
  const validUrl = Boolean(normalizedUrl) && !/^javascript:/i.test(normalizedUrl);
  const layoutInfo = normalizeLayoutInfo(layoutLabel, rank, layoutKnown);
  const rentValue = Number.isFinite(Number(rentHint)) ? Number(rentHint) : null;
  const walkValue = Number.isFinite(Number(walkHint)) ? Number(walkHint) : null;

  return {
    title: clean(title),
    subtitle: clean(subtitle),
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type: source.type,
    layoutMin: layoutInfo.min,
    layoutRank: layoutInfo.rank,
    layoutKind: layoutInfo.kind,
    layoutLabel,
    rentHint: rentValue ?? 999,
    rentLabel,
    walkHint: walkValue ?? 999,
    walkLabel,
    flexibleRent: !rentKnown,
    flexibleWalk: !walkKnown,
    flexibleLayout: !layoutInfo.known,
    tags: [...new Set(tags.filter(Boolean))],
    note,
    url: validUrl ? normalizedUrl : source.url,
    subUrl: source.url,
    imageUrl: imageUrl || FALLBACK_IMAGE,
    imageLabel: imageUrl ? "取得画像" : "代表画像",
    sourceId: source.id,
    source: source.label,
    qualityIssues: [],
    matchStatus: "matched",
    matchStatusLabel: "条件に合う実取得物件"
  };
}

function sourceLinkCard(source, reason) {
  return baseProperty({
    source,
    title: `${source.label}を公式サイトで確認`,
    subtitle: reason,
    area: "福岡市全域",
    layoutLabel: "2LDK以上 / リンク先で確認",
    layoutKnown: false,
    rentLabel: "10万円以内 / リンク先で確認",
    rentKnown: false,
    walkLabel: "徒歩15分以内 / リンク先で確認",
    walkKnown: false,
    tags: [source.type === "private" ? "一般賃貸" : "公的・行政", "検索導線"],
    note: source.note,
    url: source.url,
    imageUrl: ""
  });
}

function enrichItem(item) {
  if (!item) return null;
  const issues = [];
  const tags = new Set(item.tags || []);
  let status = "matched";
  let statusLabel = "条件に合う実取得物件";

  if (tags.has("検索導線")) {
    status = "source_link";
    statusLabel = "検索導線・行政支援リンク";
  } else {
    if (!item.title || isGenericTitle(item.title) || item.title === "お気に入り") issues.push("物件名要確認");
    if (!item.url || /^javascript:/i.test(item.url)) issues.push("リンク要確認");
    if (item.flexibleRent || !Number.isFinite(Number(item.rentHint)) || Number(item.rentHint) >= 999) issues.push("家賃要確認");
    if (item.flexibleWalk || !Number.isFinite(Number(item.walkHint)) || Number(item.walkHint) >= 999) issues.push("駅徒歩要確認");
    if (item.flexibleLayout || !Number.isFinite(Number(item.layoutRank))) issues.push("間取り要確認");
    if (item.imageLabel !== "取得画像") issues.push("画像要確認");

    if (issues.length) {
      status = "needs_check";
      statusLabel = "条件要確認の候補";
      tags.add("条件要確認");
    }
  }

  if (!isLayoutPotentiallyEligible(item)) {
    // 2DK以下など、希望条件の「2LDK以上・3DK以上」に届かないものは実物件候補から外す。
    return null;
  }

  return {
    ...item,
    tags: [...tags],
    qualityIssues: issues,
    matchStatus: status,
    matchStatusLabel: statusLabel,
    score: calcScore({ ...item, tags: [...tags], matchStatus: status })
  };
}

function buildDiagnostic(source, items, pageUrl) {
  return {
    source: source.label,
    ok: true,
    count: items.length,
    realCount: items.filter((item) => item.matchStatus === "matched").length,
    needsCheckCount: items.filter((item) => item.matchStatus === "needs_check").length,
    sourceLinkCount: items.filter((item) => item.matchStatus === "source_link").length,
    url: pageUrl || source.url
  };
}

function pickImage(images = []) {
  const filtered = images
    .map((img) => typeof img === "string" ? { src: img, w: 999, h: 999, alt: "" } : img)
    .filter((img) => img.src && !/logo|icon|btn|button|sprite|search|map|pdf|bnr|banner/i.test(img.src))
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  return filtered[0]?.src || "";
}

function pickRoomUrl(links = [], room, fallbackUrl = "") {
  const roomNumber = room.roomName.match(/([0-9]+)号室/)?.[1] || "";
  const buildingNumber = room.roomName.match(/([0-9]+)号棟/)?.[1] || "";
  const normalizedLinks = links.map((link) => ({ href: normalizeUrl(link.href, fallbackUrl), text: normalize(link.text) })).filter((link) => link.href && !/^javascript:/i.test(link.href));
  const direct = normalizedLinks.find((link) => roomNumber && link.text.includes(`${roomNumber}号室`));
  if (direct) return direct.href;
  const byHref = normalizedLinks.find((link) => roomNumber && link.href.includes(roomNumber) && (!buildingNumber || link.href.includes(buildingNumber)));
  if (byHref) return byHref.href;
  const roomLink = normalizedLinks.find((link) => /_room\.html|JKSS|room/i.test(link.href));
  if (roomLink && normalizedLinks.length === 1) return roomLink.href;
  return urEstateUrl(fallbackUrl) || normalizeUrl(fallbackUrl, "");
}

function guessPropertyName(text, url = "") {
  const code = extractUrCode(url);
  if (code && UR_PROPERTY_BY_CODE[code]) return UR_PROPERTY_BY_CODE[code];
  const patterns = [
    /(アーベイン春日公園)/,
    /物件名\s*([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,32})/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,32})\s+空室状況/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,32})\s+(?:JR|西鉄|地下鉄|福岡市営)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = clean(match?.[1] || "").replace(/.*検索結果を開く\s*/, "");
    if (value && !isBadTitle(value)) return value;
  }
  return "";
}

function guessGenericTitle(text, fallback) {
  const normalized = normalize(text);
  const patterns = [
    /賃貸(?:マンション|アパート|一戸建て|テラス・タウンハウス)?\s+([^\s]+(?:\s?[A-Za-z0-9IVXⅢⅡⅠ]+)?)/,
    /(?:建物名|物件名)\s*([^\s]{2,32})/,
    /([^\s]{2,32})\s+(?:福岡県|福岡市|糸島市|春日市|大野城市)/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const value = clean(match?.[1] || "");
    if (value && !isBadTitle(value)) return value;
  }
  const chunks = normalized.split(/\s+/).filter(Boolean).slice(0, 12);
  const candidate = chunks.find((x) => x.length >= 3 && x.length <= 30 && !isBadTitle(x));
  return candidate || `${fallback} 検索候補`;
}

function summarize(text) {
  return clean(text).slice(0, 180);
}

function extractAddress(text) {
  const match = normalize(text).match(/((?:福岡市(?:西区|早良区|城南区|中央区|博多区|東区|南区)|春日市|大野城市|糸島市|古賀市|新宮町|粕屋町|志免町|太宰府市|宇美町)[^\s]{1,55}(?:ほか)?)/);
  return match?.[1] || "";
}

function extractTransit(text) {
  const normalized = normalize(text);
  const matches = [...normalized.matchAll(/((?:JR|ＪＲ|西鉄|福岡市営|地下鉄|福岡市地下鉄|市営地下鉄)[^。\n]{0,120}?(?:徒歩|歩|バス)[^。\n]{0,80}?分)/g)].map((m) => clean(m[1]));
  return matches.slice(0, 3).join(" / ");
}

function extractVacancy(text) {
  const match = normalize(text).match(/空室状況\s*([0-9]+)|該当空室数\s*([0-9]+)/);
  return match?.[1] || match?.[2] || "";
}

function extractWalk(text) {
  const value = extractWalkHint(text);
  return { value, label: value === 999 ? "リンク先で確認" : `徒歩${value}分〜`, known: value !== 999 };
}

function extractWalkLabel(text) {
  const value = extractWalkHint(text);
  return value === 999 ? "リンク先で確認" : `徒歩${value}分〜`;
}

function extractWalkHint(text) {
  const normalized = normalize(text);
  const matches = [
    ...normalized.matchAll(/徒歩\s?([0-9]+)\s?[〜~\-－]?\s?([0-9]+)?\s?分/g),
    ...normalized.matchAll(/歩\s?([0-9]+)\s?分/g)
  ].map((m) => Number(m[1])).filter(Boolean);
  return matches.length ? Math.min(...matches) : 999;
}

function extractLayout(text) {
  const match = normalize(text).match(/([1-5])\s?(LDK|DK|K)\s*(?:\/\s*([0-9.]+)\s*(?:㎡|m²|m2)|\s+([0-9.]+)\s*(?:㎡|m²|m2))?/i);
  if (!match) return { rank: 0, min: 2, label: "2LDK以上 / 要確認", known: false };
  const label = clean(match[0]).replace(/m2/i, "㎡");
  return { rank: layoutRank(label), min: Number(match[1]), label, known: true };
}

function normalizeLayoutInfo(label, rank, known = true) {
  const value = Number.isFinite(Number(rank)) && Number(rank) > 0 ? Number(rank) : layoutRank(label);
  const match = normalize(label).match(/([1-5])\s?(LDK|DK|K)/i);
  return {
    rank: value,
    min: match ? Number(match[1]) : 2,
    kind: match ? match[2].toUpperCase() : "",
    known: Boolean(known && match)
  };
}

function layoutRank(label) {
  const match = normalize(label).match(/([1-5])\s?(LDK|DK|K)/i);
  if (!match) return 0;
  const rooms = Number(match[1]);
  const kind = match[2].toUpperCase();
  if (kind === "LDK") return rooms;
  if (kind === "DK") return rooms - 0.25;
  return rooms - 0.5;
}

function extractRent(text) {
  const normalized = normalize(text);
  const manFee = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s?万円\s*(?:\/\s*)?([0-9,]+)\s?円/);
  if (manFee) {
    const rent = Number(manFee[1]);
    const fee = Number(manFee[2].replace(/,/g, "")) / 10000;
    const total = Math.round((rent + fee) * 100) / 100;
    return { value: total, label: `${rent}万円 + 管理費${Number(manFee[2].replace(/,/g, "")).toLocaleString("ja-JP")}円 = ${total}万円目安`, known: true };
  }

  const yenPair = normalized.match(/([0-9,]+)\s?円\s*(?:\(([0-9,]+)\s?円\)|共益費\s*([0-9,]+)\s?円|管理費\s*([0-9,]+)\s?円)/);
  if (yenPair) {
    const rent = Number(yenPair[1].replace(/,/g, ""));
    const fee = Number((yenPair[2] || yenPair[3] || yenPair[4] || "0").replace(/,/g, ""));
    const total = Math.round(((rent + fee) / 10000) * 100) / 100;
    return { value: total, label: `${rent.toLocaleString("ja-JP")}円 + 管理費${fee.toLocaleString("ja-JP")}円 = ${(rent + fee).toLocaleString("ja-JP")}円目安`, known: true };
  }

  const man = [...normalized.matchAll(/([0-9]+(?:\.[0-9]+)?)\s?万円/g)].map((m) => Number(m[1])).filter((n) => n > 1 && n < 60);
  if (man.length) {
    const value = Math.min(...man);
    return { value, label: `${value}万円目安`, known: true };
  }

  const yen = [...normalized.matchAll(/([0-9,]+)\s?円/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 10000 && n <= 500000);
  if (yen.length) {
    const value = Math.min(...yen);
    return { value: Math.round((value / 10000) * 100) / 100, label: `${value.toLocaleString("ja-JP")}円目安`, known: true };
  }

  return { value: 999, label: "10万円以内 / 要確認", known: false };
}

function rentFromYen(rentYen, commonFeeYen) {
  const yen = Number(String(rentYen).replace(/[^0-9]/g, ""));
  const fee = Number(String(commonFeeYen || "").replace(/[^0-9]/g, ""));
  if (!yen) return { value: 999, label: "10万円以内 / 要確認", known: false };
  const total = yen + fee;
  const feeText = fee ? ` + 共益費 ${fee.toLocaleString("ja-JP")}円 = ${total.toLocaleString("ja-JP")}円` : "";
  return { value: Math.round((total / 10000) * 100) / 100, label: `${yen.toLocaleString("ja-JP")}円${feeText}`.trim(), known: true };
}

function detectArea(text) {
  const normalized = normalize(text);
  for (const area of Object.keys(AREA_PRIORITY)) {
    if (normalized.includes(area)) return area;
  }
  if (/春日公園|大野城|白木原|春日市/.test(normalized)) return "春日市";
  if (/姪浜|今宿|九大学研都市|周船寺|橋本|下山門|宮浦/.test(normalized)) return "福岡市西区";
  if (/西新|藤崎|室見|百道|野芥|賀茂/.test(normalized)) return "福岡市早良区";
  if (/別府|七隈|茶山|金山|福大前|長尾/.test(normalized)) return "福岡市城南区";
  if (/天神|薬院|六本松|大濠|唐人町|平尾/.test(normalized)) return "福岡市中央区";
  if (/博多|吉塚|竹下|東比恵|千代/.test(normalized)) return "福岡市博多区";
  if (/香椎|千早|箱崎|和白|照葉|志賀島|西戸崎/.test(normalized)) return "福岡市東区";
  if (/大橋|高宮|井尻|笹原|柏原/.test(normalized)) return "福岡市南区";
  return "福岡市全域";
}

function isLayoutPotentiallyEligible(item) {
  if (item.matchStatus === "source_link" || item.tags?.includes("検索導線")) return true;
  if (item.flexibleLayout || !Number.isFinite(Number(item.layoutRank)) || Number(item.layoutRank) === 0) return true;
  // 2LDK以上相当。3DKは許容、2DK/2Kは除外。
  return Number(item.layoutRank) >= DEFAULT_LIMITS.layout;
}

function calcScore(item) {
  let score = AREA_PRIORITY[item.area] || 50;
  if (item.tags?.includes("UR")) score += 16;
  if (item.tags?.includes("公的")) score += 14;
  if (item.tags?.includes("UR自動取得")) score += 12;
  if (item.tags?.includes("検索導線")) score -= 25;
  if (item.matchStatus === "needs_check") score -= 10;
  if (item.imageUrl && item.imageUrl !== FALLBACK_IMAGE) score += 5;
  if (!item.flexibleRent && item.rentHint <= DEFAULT_LIMITS.rent) score += 6;
  if (!item.flexibleWalk && item.walkHint <= DEFAULT_LIMITS.walk) score += 6;
  return Math.max(10, Math.min(100, score));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sourceId}|${normalize(item.title)}|${item.rentLabel}|${normalizeUrl(item.url, item.subUrl)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(url, base = "") {
  const raw = String(url || "").trim();
  if (!raw || /^javascript:/i.test(raw)) return "";
  try {
    return new URL(raw, base || undefined).href;
  } catch {
    return raw;
  }
}

function extractUrCode(url = "") {
  const match = String(url).match(/(90_[0-9]{4})/);
  return match?.[1] || "";
}

function urEstateUrl(url = "") {
  const normalized = normalizeUrl(url, "https://www.ur-net.go.jp");
  const match = normalized.match(/(https:\/\/www\.ur-net\.go\.jp\/chintai\/kyushu\/fukuoka\/(90_[0-9]{4})(?:_room)?\.html)/);
  if (!match) return normalized;
  return `https://www.ur-net.go.jp/chintai/kyushu/fukuoka/${match[2]}.html`;
}

function isGenericTitle(title) {
  return isBadTitle(title) || /^(賃貸マンション|賃貸アパート|賃貸一戸建て|お気に入り|検索候補)$/.test(clean(title));
}

function isBadTitle(value) {
  return /UR賃貸|福岡市|福岡県|九州|部屋名|家賃|賃料|管理費|間取り|床面積|階数|選択|検索|公式|お気に入り|詳細を見る|お問い合わせ|無料|追加|写真|画像|地図|徒歩|万円|円|^[0-9]+階$/.test(clean(value));
}

function normalize(value) {
  return clean(String(value || "").replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
