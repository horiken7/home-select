// Cloudflare Workers API endpoint configuration
//
// GitHub Pages frontend uses this endpoint first.
// If the API request fails, app.js falls back to local JSON data.

window.HOME_SELECT_CONFIG = {
  apiEndpoint: "https://home-select-search.ken060720.workers.dev"
};
