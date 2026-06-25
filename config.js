// Frontend configuration and small UI synchronization helpers.
// The site now displays GitHub Actions + Playwright generated JSON data.

window.HOME_SELECT_CONFIG = {
  apiEndpoint: "https://home-select-search.ken060720.workers.dev"
};

(() => {
  function extractCount(label) {
    const headings = Array.from(document.querySelectorAll(".result-section h3"));
    const heading = headings.find((el) => el.textContent.includes(label));
    const match = heading?.textContent.match(/([0-9]+)件/);
    return match ? Number(match[1]) : 0;
  }

  function syncDataStatusCounts() {
    const message = document.querySelector("#dataStatus p");
    const cards = document.querySelector("#cards");
    if (!message || !cards) return;

    const text = message.textContent || "";
    if (!text.includes("最終取得:")) return;

    const generatedAt = text.match(/最終取得:\s*([^/]+?)\s*\//)?.[1]?.trim() || "未取得";
    const matched = extractCount("条件に合う実取得物件");
    const needsCheck = extractCount("条件要確認の候補");
    const sourceLinks = extractCount("検索導線・行政支援リンク");
    const realCandidates = matched + needsCheck;

    message.textContent = `最終取得: ${generatedAt} / 実取得候補 ${realCandidates}件 / 条件要確認 ${needsCheck}件 / 検索導線 ${sourceLinks}件。条件変更後は「この条件で再検索」を押してください。`;
  }

  window.addEventListener("load", () => {
    window.setTimeout(syncDataStatusCounts, 300);
    const cards = document.querySelector("#cards");
    if (cards) {
      new MutationObserver(syncDataStatusCounts).observe(cards, { childList: true, subtree: true });
    }
  });
})();
