import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "properties.json");
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=75";

const UR_URL = "https://www.ur-net.go.jp/chintai/kyushu/fukuoka/result/?area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&area=01&skcs=133&skcs=131&skcs=134&skcs=137&skcs=136&rent_low=&rent_high=&rent_low=&rent_high=&walk=&walk=&floorspace_low=&floorspace_high=&floorspace_low=&floorspace_high=&years=&years=&tdfk=40&todofuken=fukuoka";

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
      } else if (["homes", "suumo", "athome", "chintai"].includes(source.id)) {
        items = await scrapeGenericRentalSite(page, source);
      }

      if (!items.length) {
        items = [sourceLinkCard(source, "実物件カードは自動抽出できませんでした。公式検索ページを開いて確認してください。")];
      }

      diagnostics.push({ source: source.label, ok: true, count: items.length, url: source.url });
      all.push(...items);
    } catch (error) {
      diagnostics.push({ source: source.label, ok: false, error: error.message, url: source.url });
      all.push(sourceLinkCard(source, `自動取得に失敗しました：${error.message.slice(0, 90)}`));
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
  .slice(0, 40);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(process.cwd(), "data", "scrape-diagnostics.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), diagnostics }, null, 2)}\n`, "utf8");

console.log(`wrote ${output.length} properties to ${OUT}`);
console.table(diagnostics);

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(5000);
  // scroll to trigger lazy loading
  for (const y of [500, 1200, 2200, 0]) {
    await page.mouse.wheel(0, y);
    await page.waitForTimeout(800);
  }
}

async function scrapeUr(page, source) {
  const data = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const images = Array.from(document.images).map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt || "",
      w: img.naturalWidth || img.width || 0,
      h: img.naturalHeight || img.height || 0
    })).filter((img) => img.src && img.w >= 120 && img.h >= 80);

    const candidates = Array.from(document.querySelectorAll("article, section, li, div, table, tbody"))
      .map((el) => ({
        text: (el.innerText || "").replace(/\s+/g, " ").trim(),
        href: el.querySelector("a[href]")?.href || location.href,
        images: Array.from(el.querySelectorAll("img")).map((img) => ({
          src: img.currentSrc || img.src,
          alt: img.alt || "",
          w: img.naturalWidth || img.width || 0,
          h: img.naturalHeight || img.height || 0
        })).filter((img) => img.src && img.w >= 80 && img.h >= 60)
      }))
      .filter((x) => x.text.includes("空室状況") || x.text.includes("部屋詳細") || x.text.includes("家賃") || x.text.includes("共益費"))
      .filter((x) => x.text.length > 80 && x.text.length < 12000)
      .sort((a, b) => a.text.length - b.text.length)
      .slice(0, 30);

    return { text, images, candidates, url: location.href, title: document.title };
  });

  const items = [];

  // Prefer candidate blocks because they preserve property-level image and title better.
  for (const block of data.candidates) {
    const parsed = parseUrBlock(block.text, source, block.href, pickImage(block.images) || pickImage(data.images));
    items.push(...parsed);
  }

  if (!items.length) {
    const parsed = parseUrBlock(data.text, source, data.url, pickImage(data.images));
    items.push(...parsed);
  }

  return dedupe(items).slice(0, 20);
}

function parseUrBlock(rawText, source, url, imageUrl) {
  const text = normalize(rawText);
  const rooms = [];
  const roomPatterns = [
    /([0-9]+号棟\s*[0-9]+号室)\s+([0-9,]+円)\s*(?:\(([0-9,]+円)\))?\s+([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))\s+([0-9]+階)/gi,
    /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,260}?([0-9,]+円)[\s\S]{0,120}?\(([0-9,]+円)\)[\s\S]{0,260}?([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))[\s\S]{0,180}?([0-9]+階)/gi,
    /([0-9]+号棟\s*[0-9]+号室)[\s\S]{0,360}?([0-9,]+円)[\s\S]{0,360}?([1-5]\s?(?:LDK|DK|K)\s*\/\s*[0-9.]+\s*(?:㎡|m²|m2))[\s\S]{0,220}?([0-9]+階)/gi
  ];

  for (const pattern of roomPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      rooms.push({
        index: match.index,
        roomName: clean(match[1]),
        rentYen: clean(match[2]),
        commonFeeYen: clean(match[3] || ""),
        layout: clean(match[4]).replace(/m2/i, "㎡"),
        floor: clean(match[5])
      });
    }
    if (rooms.length) break;
  }

  const propertyName = guessPropertyName(text);
  const area = detectArea(text);
  const address = extractAddress(text);
  const transit = extractTransit(text);
  const vacancy = extractVacancy(text);

  if (!rooms.length) {
    if (!propertyName) return [];
    return [baseProperty({
      source,
      title: propertyName,
      subtitle: [transit, address].filter(Boolean).join(" / ") || "UR公式ページから取得した候補です。",
      area,
      layoutLabel: "2LDK以上 / リンク先で確認",
      rentLabel: "リンク先で確認",
      rentHint: 10,
      walkLabel: transit ? extractWalkLabel(transit) : "リンク先で確認",
      walkHint: extractWalkHint(transit),
      tags: ["UR", "公的", "保証人不要", "UR自動取得"],
      note: `UR公式ページから取得。${vacancy ? `団地の空室状況は${vacancy}件。` : ""}部屋別条件はリンク先で確認してください。`,
      url,
      imageUrl
    })];
  }

  return rooms.map((room) => {
    const { value, label } = rentFromYen(room.rentYen, room.commonFeeYen);
    return baseProperty({
      source,
      title: `${propertyName || "UR賃貸"} ${room.roomName}`,
      subtitle: [transit, address].filter(Boolean).join(" / ") || "UR公式ページから取得した部屋候補です。",
      area,
      layoutLabel: room.layout,
      layoutMin: Number(room.layout.match(/[1-5]/)?.[0] || 2),
      rentLabel: label,
      rentHint: value,
      walkLabel: transit ? extractWalkLabel(transit) : "リンク先で確認",
      walkHint: extractWalkHint(transit),
      tags: ["UR", "公的", "保証人不要", "UR自動取得", room.floor],
      note: `UR公式ページから部屋情報を取得。${vacancy ? `団地の空室状況は${vacancy}件。` : ""}最新の空室・申込状況はUR公式で確認してください。`,
      url,
      imageUrl
    });
  });
}

async function scrapeGenericRentalSite(page, source) {
  const data = await page.evaluate(() => {
    const selectors = [
      "article", "li", ".cassetteitem", ".property", ".bukken", ".mod-mergeBuilding", ".building", ".estate", ".result", ".list"
    ];
    const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
    const cards = nodes.map((el) => {
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      const href = el.querySelector("a[href]")?.href || location.href;
      const img = Array.from(el.querySelectorAll("img"))
        .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || "", w: i.naturalWidth || i.width || 0, h: i.naturalHeight || i.height || 0 }))
        .filter((i) => i.src && i.w >= 80 && i.h >= 60)[0];
      return { text, href, image: img?.src || "" };
    }).filter((c) => c.text.length > 80 && c.text.length < 3500)
      .filter((c) => /賃料|家賃|万円|2LDK|3LDK|間取り|徒歩/.test(c.text))
      .slice(0, 20);
    return { cards, title: document.title, url: location.href };
  });

  const items = data.cards.map((card) => normalizeGenericCard(card, source)).filter(Boolean);
  return dedupe(items).slice(0, 10);
}

function normalizeGenericCard(card, source) {
  const text = normalize(card.text);
  if (/サ高住|老人ホーム|介護施設|サービス付き高齢者向け住宅/.test(text)) return null;

  const title = guessGenericTitle(text, source.label);
  const area = detectArea(text);
  const rent = extractRent(text);
  const layout = extractLayout(text);
  const walk = extractWalk(text);

  return baseProperty({
    source,
    title,
    subtitle: summarize(text),
    area,
    layoutLabel: layout.label,
    layoutMin: layout.min,
    rentLabel: rent.label,
    rentHint: rent.value,
    walkLabel: walk.label,
    walkHint: walk.value,
    tags: ["一般賃貸", source.label, card.image ? "取得画像" : "代表画像"],
    note: `${source.label}から自動抽出した候補です。管理費込み家賃・入居審査・空室はリンク先で確認してください。`,
    url: card.href,
    imageUrl: card.image
  });
}

function baseProperty({ source, title, subtitle, area, layoutLabel, layoutMin = 2, rentLabel, rentHint = 10, walkLabel, walkHint = 15, tags = [], note, url, imageUrl }) {
  return {
    title: clean(title),
    subtitle: clean(subtitle),
    area,
    areaGroup: area.startsWith("福岡市") ? "fukuoka_city" : "surrounding",
    type: source.type,
    layoutMin,
    layoutLabel,
    rentHint,
    rentLabel,
    walkHint,
    walkLabel,
    flexibleRent: true,
    flexibleWalk: true,
    tags: [...new Set(tags)],
    note,
    url,
    subUrl: source.url,
    imageUrl: imageUrl || FALLBACK_IMAGE,
    imageLabel: imageUrl ? "取得画像" : "代表画像",
    sourceId: source.id,
    source: source.label
  };
}

function sourceLinkCard(source, reason) {
  return baseProperty({
    source,
    title: `${source.label}を公式サイトで確認`,
    subtitle: reason,
    area: "福岡市全域",
    layoutLabel: "2LDK以上 / リンク先で確認",
    rentLabel: "10万円以内 / リンク先で確認",
    tags: [source.type === "private" ? "一般賃貸" : "公的・行政", "検索導線"],
    note: source.note,
    url: source.url,
    imageUrl: ""
  });
}

function pickImage(images = []) {
  const filtered = images
    .map((img) => typeof img === "string" ? { src: img, w: 999, h: 999, alt: "" } : img)
    .filter((img) => img.src && !/logo|icon|btn|button|sprite|search|map|pdf|bnr|banner/i.test(img.src))
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  return filtered[0]?.src || "";
}

function guessPropertyName(text) {
  const patterns = [
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,32})\s+お気に入り/,
    /(アーベイン春日公園)/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,32})\s+空室状況/,
    /([一-龥ぁ-んァ-ンーA-Za-z0-9・ヶ\s]{2,32})\s+(?:JR|西鉄|地下鉄|福岡市営)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = clean(match?.[1] || "").replace(/.*検索結果を開く\s*/, "");
    if (value && !/UR賃貸|福岡市|福岡県|九州|部屋名|家賃|間取り|床面積|階数|選択|検索|公式/.test(value)) return value;
  }
  return "";
}

function guessGenericTitle(text, fallback) {
  const chunks = text.split(/\s+/).filter(Boolean).slice(0, 10);
  const candidate = chunks.find((x) => x.length >= 3 && x.length <= 30 && !/賃料|家賃|管理費|敷金|礼金|万円|徒歩|間取り/.test(x));
  return candidate || `${fallback} 検索候補`;
}

function summarize(text) {
  return clean(text).slice(0, 140);
}

function extractAddress(text) {
  const match = text.match(/((?:福岡市|春日市|大野城市|糸島市|古賀市|新宮町|粕屋町|志免町|太宰府市|宇美町)[^\s]{1,45}(?:ほか)?)/);
  return match?.[1] || "";
}

function extractTransit(text) {
  const match = text.match(/((?:JR|西鉄|福岡市営|地下鉄|福岡市地下鉄|市営地下鉄)[^。]{0,180}?(?:徒歩|バス)[^。]{0,120}?(?:分|団地))/);
  return clean(match?.[1] || "");
}

function extractVacancy(text) {
  const match = text.match(/空室状況\s*([0-9]+)|該当空室数\s*([0-9]+)/);
  return match?.[1] || match?.[2] || "";
}

function extractWalk(text) {
  const value = extractWalkHint(text);
  return { value, label: value === 999 ? "リンク先で確認" : `徒歩${value}分〜` };
}

function extractWalkLabel(text) {
  const value = extractWalkHint(text);
  return value === 999 ? "リンク先で確認" : `徒歩${value}分〜`;
}

function extractWalkHint(text) {
  const matches = [...normalize(text).matchAll(/徒歩\s?([0-9]+)\s?[〜~\-－]?\s?([0-9]+)?\s?分/g)].map((m) => Number(m[1])).filter(Boolean);
  return matches.length ? Math.min(...matches) : 999;
}

function extractLayout(text) {
  const match = normalize(text).match(/([1-5])\s?(LDK|DK|K)\s*(?:\/\s*([0-9.]+)\s*(?:㎡|m²|m2))?/i);
  if (!match) return { min: 2, label: "2LDK以上 / 要確認" };
  return { min: Number(match[1]), label: clean(match[0]).replace(/m2/i, "㎡") };
}

function extractRent(text) {
  const normalized = normalize(text);
  const yen = [...normalized.matchAll(/([0-9,]+)\s?円/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 10000 && n <= 500000);
  if (yen.length) {
    const value = Math.min(...yen);
    return { value: Math.round((value / 10000) * 100) / 100, label: `${value.toLocaleString("ja-JP")}円目安` };
  }
  const man = [...normalized.matchAll(/([0-9]+(?:\.[0-9]+)?)\s?万円/g)].map((m) => Number(m[1])).filter((n) => n > 1 && n < 60);
  if (man.length) {
    const value = Math.min(...man);
    return { value, label: `${value}万円目安` };
  }
  return { value: 10, label: "10万円以内 / 要確認" };
}

function rentFromYen(rentYen, commonFeeYen) {
  const yen = Number(String(rentYen).replace(/[^0-9]/g, ""));
  const fee = Number(String(commonFeeYen || "").replace(/[^0-9]/g, ""));
  const value = yen ? Math.round((yen / 10000) * 100) / 100 : 10;
  const feeText = fee ? `（共益費 ${fee.toLocaleString("ja-JP")}円）` : "";
  return { value, label: yen ? `${yen.toLocaleString("ja-JP")}円 ${feeText}`.trim() : "10万円以内 / 要確認" };
}

function detectArea(text) {
  const normalized = normalize(text);
  for (const area of Object.keys(AREA_PRIORITY)) {
    if (normalized.includes(area)) return area;
  }
  if (/春日公園|大野城|白木原|春日市/.test(normalized)) return "春日市";
  if (/姪浜|今宿|九大学研都市|周船寺|橋本|下山門/.test(normalized)) return "福岡市西区";
  if (/西新|藤崎|室見|百道|野芥|賀茂/.test(normalized)) return "福岡市早良区";
  if (/別府|七隈|茶山|金山|福大前/.test(normalized)) return "福岡市城南区";
  if (/天神|薬院|六本松|大濠|唐人町|平尾/.test(normalized)) return "福岡市中央区";
  if (/博多|吉塚|竹下|東比恵|千代/.test(normalized)) return "福岡市博多区";
  if (/香椎|千早|箱崎|和白|照葉|星の原/.test(normalized)) return "福岡市東区";
  if (/大橋|高宮|井尻|平尾|笹原/.test(normalized)) return "福岡市南区";
  return "福岡市全域";
}

function calcScore(item) {
  let score = AREA_PRIORITY[item.area] || 50;
  if (item.tags?.includes("UR")) score += 16;
  if (item.tags?.includes("公的")) score += 14;
  if (item.tags?.includes("UR自動取得")) score += 12;
  if (item.tags?.includes("検索導線")) score -= 20;
  if (item.imageUrl && item.imageUrl !== FALLBACK_IMAGE) score += 5;
  return Math.max(10, Math.min(100, score));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sourceId}|${item.title}|${item.rentLabel}|${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  return clean(String(value || "").replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
