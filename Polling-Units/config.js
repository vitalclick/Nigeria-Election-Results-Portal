const path = require("path");

module.exports = {
  // Fallback base URLs (the scraper auto-discovers the current theme first)
  BASE_URLS: [
    "https://www.inecnigeria.org/wp-content/themes/rishi/custom/views",
    "https://www.inecnigeria.org/wp-content/themes/independent-national-electoral-commission/custom/views",
  ],

  // PHP endpoints under the theme's custom/views/ directory
  ENDPOINTS: {
    states: "getPollingState.php",
    lgas: "lgaView.php",
    wards: "wardView.php",
    pollingUnits: "pollingView.php",
  },

  ENDPOINTS_ALT: {
    pollingUnits: "unitView.php",
  },

  MAX_CONCURRENT: 5,
  RETRY_ATTEMPTS: 4,
  RETRY_BASE_DELAY_MS: 2000,
  DELAY_BETWEEN_REQUESTS_MS: 800,
  REQUEST_TIMEOUT_MS: 30000,

  RESULTS_DIR: path.join(__dirname, "results"),
  PROGRESS_DIR: path.join(__dirname, "progress"),

  HEADERS: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.inecnigeria.org/polling-units/",
  },
};
