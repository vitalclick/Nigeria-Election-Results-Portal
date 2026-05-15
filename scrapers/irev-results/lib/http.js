'use strict';

// Resilient HTTP wrapper for IReV requests.
//
// IReV is a public-good service and we treat it as such:
//   * Conservative concurrency + delay
//   * Exponential backoff with jitter on 429 / 5xx
//   * Timeout on every request - never block the scraper indefinitely

const config = require('../config');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms) {
  return ms * (0.7 + Math.random() * 0.6);
}

async function getJSON(url) {
  return _fetchWithRetry(url, { accept: 'application/json' }).then((r) => r.json());
}

async function getBytes(url) {
  const res = await _fetchWithRetry(url, { accept: 'image/*' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

async function _fetchWithRetry(url, { accept }) {
  let lastErr;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(jitter(config.backoffBaseMs * 2 ** attempt));
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      const res = await fetch(url, {
        headers: { 'User-Agent': config.userAgent, Accept: accept },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (e) {
      if (e.status && e.status < 500) throw e; // permanent
      lastErr = e;
    }
  }
  throw lastErr || new Error(`gave up after ${config.maxRetries} attempts: ${url}`);
}

module.exports = { getJSON, getBytes, sleep };
