#!/usr/bin/env node

/**
 * INEC Nigeria Polling Units Scraper
 *
 * Scrapes all 176,846 polling units via INEC's PHP API endpoints.
 * Flow: States -> LGAs -> Wards -> Polling Units
 *
 * Usage:
 *   node scraper.js                     # Scrape all states (resumes from progress)
 *   node scraper.js --state "Lagos"     # Scrape a single state
 *   node scraper.js --reset             # Clear progress and start fresh
 *   node scraper.js --detect-only       # Only detect working API base URL
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const config = require("./config");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * INEC's PHP endpoints return objects with numeric keys instead of arrays.
 * e.g. { "0": {...}, "1": {...}, "2": {...} }
 * This converts them to proper arrays.
 */
function objectToArray(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== "object") return [];
  const keys = Object.keys(obj);
  if (keys.length === 0) return [];
  const allNumeric = keys.every((k) => /^\d+$/.test(k));
  if (allNumeric) {
    return keys
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => obj[k]);
  }
  return [obj];
}

function encodeFormData(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────

function httpRequest(url, { method = "GET", body = null, headers = {}, timeout = config.REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { ...config.HEADERS, ...headers },
      timeout,
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });

    if (body) req.write(body);
    req.end();
  });
}

// ─── Scraper Class ────────────────────────────────────────────────────────────

class INECPollingUnitsScraper {
  constructor() {
    this.baseUrl = null;
    this.useAltPollingEndpoint = false;
    this.failures = [];
    this.stats = {
      states: 0,
      lgas: 0,
      wards: 0,
      pollingUnits: 0,
      startTime: null,
    };
  }

  // ── API Base URL Detection ────────────────────────────────────────────────

  async detectBaseUrl() {
    console.log("Detecting working INEC API base URL...\n");

    for (const baseUrl of config.BASE_URLS) {
      const url = `${baseUrl}/${config.ENDPOINTS.states}`;
      try {
        const res = await httpRequest(url, { timeout: 15000 });
        const parsed = JSON.parse(res.data);
        const states = objectToArray(parsed);
        if (states.length > 0 && states[0].code) {
          console.log(`  Found working base URL: ${baseUrl}`);
          console.log(`  States found: ${states.length}\n`);
          this.baseUrl = baseUrl;
          return states;
        }
      } catch (err) {
        console.log(`  Tried: ${baseUrl}`);
        console.log(`  Result: ${err.message}\n`);
      }
    }

    throw new Error(
      "Could not find a working INEC API base URL. " +
        "The INEC website may have changed its WordPress theme. " +
        "Check https://www.inecnigeria.org/polling-units/ and update BASE_URLS in config.js."
    );
  }

  // ── Fetch with Retry ──────────────────────────────────────────────────────

  async fetchWithRetry(endpoint, params = {}, label = "") {
    const isPost = Object.keys(params).length > 0;
    const url = `${this.baseUrl}/${endpoint}`;
    const fetchOptions = isPost
      ? { method: "POST", body: encodeFormData(params) }
      : { method: "GET" };

    for (let attempt = 1; attempt <= config.RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await httpRequest(url, fetchOptions);
        let parsed;
        try {
          parsed = JSON.parse(res.data);
        } catch {
          parsed = res.data;
        }
        return objectToArray(parsed);
      } catch (err) {
        if (attempt < config.RETRY_ATTEMPTS) {
          const backoff = config.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(
            `    Retry ${attempt}/${config.RETRY_ATTEMPTS} for ${label}: ${err.message} (waiting ${backoff}ms)`
          );
          await delay(backoff);
        } else {
          this.failures.push({
            type: endpoint,
            label,
            params,
            error: err.message,
            timestamp: new Date().toISOString(),
          });
          return [];
        }
      }
    }
    return [];
  }

  // ── Concurrency Limiter ───────────────────────────────────────────────────

  async runWithConcurrency(tasks, concurrency = config.MAX_CONCURRENT) {
    const results = [];
    let index = 0;

    async function worker() {
      while (index < tasks.length) {
        const currentIndex = index++;
        results[currentIndex] = await tasks[currentIndex]();
        await delay(config.DELAY_BETWEEN_REQUESTS_MS);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => worker()
    );
    await Promise.all(workers);
    return results;
  }

  // ── Data Fetchers ─────────────────────────────────────────────────────────

  async fetchStates() {
    return this.fetchWithRetry(config.ENDPOINTS.states, {}, "states");
  }

  async fetchLGAs(stateId) {
    return this.fetchWithRetry(
      config.ENDPOINTS.lgas,
      { state_id: stateId },
      `LGAs for state ${stateId}`
    );
  }

  async fetchWards(stateId, lgaId) {
    return this.fetchWithRetry(
      config.ENDPOINTS.wards,
      { state_id: stateId, lga_id: lgaId },
      `Wards for LGA ${lgaId}`
    );
  }

  async fetchPollingUnits(stateId, lgaId, wardId) {
    const endpoint = this.useAltPollingEndpoint
      ? config.ENDPOINTS_ALT.pollingUnits
      : config.ENDPOINTS.pollingUnits;

    let results = await this.fetchWithRetry(
      endpoint,
      { state_id: stateId, lga_id: lgaId, ward_id: wardId },
      `PUs for ward ${wardId}`
    );

    // Fallback to alt endpoint if primary returns nothing
    if (results.length === 0 && !this.useAltPollingEndpoint) {
      results = await this.fetchWithRetry(
        config.ENDPOINTS_ALT.pollingUnits,
        { state_id: stateId, lga_id: lgaId, ward_id: wardId },
        `PUs for ward ${wardId} (alt)`
      );
      if (results.length > 0) {
        console.log("  Switching to alternate polling units endpoint");
        this.useAltPollingEndpoint = true;
      }
    }

    return results;
  }

  // ── Progress Management ───────────────────────────────────────────────────

  getProgressPath() {
    return path.join(config.PROGRESS_DIR, "scrape_progress.json");
  }

  loadProgress() {
    try {
      const data = fs.readFileSync(this.getProgressPath(), "utf8");
      return JSON.parse(data);
    } catch {
      return { completedStates: [], inProgress: null };
    }
  }

  saveProgress(progress) {
    ensureDir(config.PROGRESS_DIR);
    fs.writeFileSync(this.getProgressPath(), JSON.stringify(progress, null, 2));
  }

  clearProgress() {
    const p = this.getProgressPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // ── Scrape a Single State ─────────────────────────────────────────────────

  async scrapeState(state) {
    const stateId = state.code || state.id || state.state_id;
    const stateName = state.name || state.state_name || `State-${stateId}`;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`STATE: ${stateName} (ID: ${stateId})`);
    console.log("=".repeat(60));

    const stateData = {
      state_id: stateId,
      state_name: stateName,
      lgas: [],
    };

    const rawLGAs = await this.fetchLGAs(stateId);
    if (rawLGAs.length === 0) {
      console.log(`  No LGAs found for ${stateName}`);
      return stateData;
    }
    console.log(`  Found ${rawLGAs.length} LGAs`);

    let statePollingUnitCount = 0;

    for (let i = 0; i < rawLGAs.length; i++) {
      const lga = rawLGAs[i];
      const lgaId = lga.id || lga.lga_id || lga.abbreviation;
      const lgaName = lga.name || lga.lga_name || `LGA-${lgaId}`;
      console.log(`\n  LGA ${i + 1}/${rawLGAs.length}: ${lgaName}`);

      const lgaData = {
        lga_id: lgaId,
        lga_name: lgaName,
        wards: [],
      };

      const rawWards = await this.fetchWards(stateId, lgaId);
      if (rawWards.length === 0) {
        console.log(`    No wards found for ${lgaName}`);
        stateData.lgas.push(lgaData);
        continue;
      }
      console.log(`    Found ${rawWards.length} wards`);

      // Fetch polling units for all wards with concurrency control
      const wardTasks = rawWards.map((ward) => async () => {
        const wardId = ward.id || ward.ward_id || ward.abbreviation;
        const wardName = ward.name || ward.ward_name || `Ward-${wardId}`;

        const rawPUs = await this.fetchPollingUnits(stateId, lgaId, wardId);

        const pollingUnits = rawPUs.map((pu) => ({
          pu_id: pu.id || pu.pu_id || pu.polling_unit_id,
          pu_code: pu.code || pu.pu_code || pu.polling_unit_code || "",
          pu_name:
            pu.name ||
            pu.pu_name ||
            pu.polling_unit ||
            pu.polling_unit_name ||
            "",
          delim: pu.abbreviation || pu.delim || "",
          registration_area:
            pu.registration_area || pu.registration_area_name || "",
        }));

        return {
          ward_id: wardId,
          ward_name: wardName,
          polling_units: pollingUnits,
          polling_unit_count: pollingUnits.length,
        };
      });

      const wardResults = await this.runWithConcurrency(wardTasks);

      for (const wardData of wardResults) {
        lgaData.wards.push(wardData);
        statePollingUnitCount += wardData.polling_unit_count;
        this.stats.pollingUnits += wardData.polling_unit_count;
        this.stats.wards++;
      }

      this.stats.lgas++;
      stateData.lgas.push(lgaData);
    }

    this.stats.states++;
    console.log(
      `\n  ${stateName} complete: ${rawLGAs.length} LGAs, ${statePollingUnitCount} polling units`
    );

    return stateData;
  }

  // ── Save State Results ────────────────────────────────────────────────────

  saveStateResult(stateData) {
    ensureDir(config.RESULTS_DIR);
    const filename = `${toKebabCase(stateData.state_name)}.json`;
    const filepath = path.join(config.RESULTS_DIR, filename);

    const lgaCount = stateData.lgas.length;
    let wardCount = 0;
    let puCount = 0;
    for (const lga of stateData.lgas) {
      wardCount += lga.wards.length;
      for (const ward of lga.wards) {
        puCount += ward.polling_units.length;
      }
    }

    const output = {
      state_id: stateData.state_id,
      state_name: stateData.state_name,
      summary: { lgas: lgaCount, wards: wardCount, polling_units: puCount },
      lgas: stateData.lgas,
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    const sizeKB = (fs.statSync(filepath).size / 1024).toFixed(1);
    console.log(`  Saved: ${filename} (${sizeKB} KB)`);
    return { filename, lgas: lgaCount, wards: wardCount, pollingUnits: puCount };
  }

  // ── Save Summary ──────────────────────────────────────────────────────────

  saveSummary(stateResults) {
    ensureDir(config.RESULTS_DIR);

    let totalLGAs = 0;
    let totalWards = 0;
    let totalPUs = 0;

    const states = stateResults.map((s) => {
      totalLGAs += s.lgas;
      totalWards += s.wards;
      totalPUs += s.pollingUnits;
      return s;
    });

    const summary = {
      scraped_at: new Date().toISOString(),
      base_url: this.baseUrl,
      totals: {
        states: states.length,
        lgas: totalLGAs,
        wards: totalWards,
        polling_units: totalPUs,
      },
      duration_seconds: Math.round(
        (Date.now() - this.stats.startTime) / 1000
      ),
      failures: this.failures.length,
      failure_details: this.failures,
      states,
    };

    const filepath = path.join(config.RESULTS_DIR, "summary.json");
    fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));
    console.log(`\nSummary saved: ${filepath}`);
    return summary;
  }

  // ── Merge All State Files into One ────────────────────────────────────────

  mergeResults() {
    ensureDir(config.RESULTS_DIR);
    const files = fs.readdirSync(config.RESULTS_DIR).filter(
      (f) => f.endsWith(".json") && f !== "summary.json" && f !== "all-polling-units.json"
    );

    const allPollingUnits = [];
    for (const file of files) {
      const data = JSON.parse(
        fs.readFileSync(path.join(config.RESULTS_DIR, file), "utf8")
      );
      for (const lga of data.lgas || []) {
        for (const ward of lga.wards || []) {
          for (const pu of ward.polling_units || []) {
            allPollingUnits.push({
              state: data.state_name,
              state_id: data.state_id,
              lga: lga.lga_name,
              lga_id: lga.lga_id,
              ward: ward.ward_name,
              ward_id: ward.ward_id,
              pu_code: pu.pu_code,
              pu_name: pu.pu_name,
              pu_id: pu.pu_id,
              delim: pu.delim,
            });
          }
        }
      }
    }

    const filepath = path.join(config.RESULTS_DIR, "all-polling-units.json");
    fs.writeFileSync(filepath, JSON.stringify(allPollingUnits, null, 2));
    const sizeMB = (fs.statSync(filepath).size / (1024 * 1024)).toFixed(1);
    console.log(
      `\nMerged file: all-polling-units.json (${allPollingUnits.length} polling units, ${sizeMB} MB)`
    );
    return allPollingUnits.length;
  }

  // ── Main Entry Point ──────────────────────────────────────────────────────

  async scrapeAll({ filterState = null, reset = false } = {}) {
    this.stats.startTime = Date.now();
    console.log("INEC Nigeria Polling Units Scraper");
    console.log("==================================\n");

    if (reset) {
      this.clearProgress();
      console.log("Progress cleared. Starting fresh.\n");
    }

    // Step 1: Detect working base URL and fetch states
    const rawStates = await this.detectBaseUrl();
    console.log(`Total states from API: ${rawStates.length}\n`);

    // Step 2: Filter if --state flag is used
    let statesToScrape = rawStates;
    if (filterState) {
      statesToScrape = rawStates.filter(
        (s) =>
          (s.name || "").toLowerCase() === filterState.toLowerCase() ||
          (s.code || "").toString() === filterState.toString()
      );
      if (statesToScrape.length === 0) {
        console.log(`State "${filterState}" not found. Available states:`);
        rawStates.forEach((s) => console.log(`  - ${s.name} (ID: ${s.code})`));
        process.exit(1);
      }
    }

    // Step 3: Load progress for resume capability
    const progress = this.loadProgress();
    const stateResults = [];

    for (const state of statesToScrape) {
      const stateName = state.name || state.state_name;

      // Skip already-completed states (resume)
      if (
        !filterState &&
        progress.completedStates.includes(stateName)
      ) {
        console.log(`\nSkipping ${stateName} (already completed)`);
        // Load existing result for summary
        const filename = `${toKebabCase(stateName)}.json`;
        const filepath = path.join(config.RESULTS_DIR, filename);
        if (fs.existsSync(filepath)) {
          const existing = JSON.parse(fs.readFileSync(filepath, "utf8"));
          let wc = 0;
          let pc = 0;
          for (const lga of existing.lgas || []) {
            wc += lga.wards.length;
            for (const w of lga.wards) pc += w.polling_units.length;
          }
          stateResults.push({
            filename,
            lgas: existing.lgas.length,
            wards: wc,
            pollingUnits: pc,
          });
        }
        continue;
      }

      // Mark state as in-progress
      progress.inProgress = stateName;
      this.saveProgress(progress);

      // Scrape the state
      const stateData = await this.scrapeState(state);
      const result = this.saveStateResult(stateData);
      stateResults.push(result);

      // Mark state as completed
      progress.completedStates.push(stateName);
      progress.inProgress = null;
      this.saveProgress(progress);
    }

    // Step 4: Save summary and merge
    const summary = this.saveSummary(stateResults);
    this.mergeResults();

    // Step 5: Final report
    const duration = Math.round((Date.now() - this.stats.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    console.log("\n" + "=".repeat(60));
    console.log("SCRAPE COMPLETE");
    console.log("=".repeat(60));
    console.log(`  States:        ${summary.totals.states}`);
    console.log(`  LGAs:          ${summary.totals.lgas}`);
    console.log(`  Wards:         ${summary.totals.wards}`);
    console.log(`  Polling Units: ${summary.totals.polling_units}`);
    console.log(`  Duration:      ${minutes}m ${seconds}s`);
    console.log(`  Failures:      ${this.failures.length}`);

    if (this.failures.length > 0) {
      console.log("\nFailed requests:");
      this.failures.forEach((f) =>
        console.log(`  - ${f.label}: ${f.error}`)
      );
    }

    return summary;
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const scraper = new INECPollingUnitsScraper();

  const stateIndex = args.indexOf("--state");
  const filterState =
    stateIndex !== -1 && args[stateIndex + 1]
      ? args[stateIndex + 1]
      : null;
  const reset = args.includes("--reset");
  const detectOnly = args.includes("--detect-only");

  if (detectOnly) {
    try {
      const states = await scraper.detectBaseUrl();
      console.log("States found:");
      states.forEach((s) => console.log(`  ${s.code}: ${s.name}`));
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

  try {
    await scraper.scrapeAll({ filterState, reset });
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    console.error(
      "The scraper saves progress automatically. Re-run to resume.\n"
    );
    process.exit(1);
  }
}

// Export for testing
module.exports = {
  INECPollingUnitsScraper,
  objectToArray,
  toKebabCase,
  encodeFormData,
};

if (require.main === module) {
  main();
}
