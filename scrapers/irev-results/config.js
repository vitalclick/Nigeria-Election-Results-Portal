'use strict';

// OpenBallot Nigeria - IReV scraper configuration.
//
// INEC's IReV portal exposes per-election PHP/JSON endpoints. The exact base
// URL and path scheme have shifted across deployments since 2023, so all
// endpoints are configurable via environment variables.
//
// 2026-05-17: the live API is at https://dolphin-app-sleqh.ondigitalocean.app/
// (the original lv.irev.inecnigeria.org host was retired post-2023). The
// default below has been updated, but the URL templates in
// lib/endpoint_discovery.js are stale - they were written for the 2023 API
// and do not match the current DigitalOcean / MongoDB / Express backend.
// See README.md "May 2026 discovery notes" for what's known and the
// redesign required to make the scraper work end-to-end again.

const path = require('path');

const ELECTION_TYPE_TO_IREV_ID = {
  // These IDs are the values IReV uses internally to identify each ballot.
  // They must be confirmed against the live IReV deployment before a run.
  presidential: process.env.IREV_ID_PRESIDENTIAL || 'presidential-2023',
  senate:       process.env.IREV_ID_SENATE       || 'senate-2023',
  reps:         process.env.IREV_ID_REPS         || 'house-of-reps-2023',
  governorship: process.env.IREV_ID_GOV          || 'governorship-2023',
  stha:         process.env.IREV_ID_STHA         || 'state-house-2023',
};

module.exports = {
  // ─── HTTP ────────────────────────────────────────────────────────────────
  // Default updated 2026-05-17 to the live DigitalOcean origin. The
  // Cloudflare-fronted hostnames (irev.inecnigeria.org, www.inec
  // electionresults.ng) serve only the Angular SPA shell, not the API.
  irevBase: process.env.IREV_BASE || 'https://dolphin-app-sleqh.ondigitalocean.app',
  userAgent: 'OpenBallotNG-IReVScraper/0.1 (+https://openballot.ng)',
  // Be very conservative on a public-good archive scrape. INEC infrastructure
  // is a national resource; we do not pound it.
  requestDelayMs: parseInt(process.env.IREV_DELAY_MS || '450', 10),
  maxConcurrent: parseInt(process.env.IREV_CONCURRENCY || '4', 10),
  maxRetries: 5,
  backoffBaseMs: 1000,
  requestTimeoutMs: 30_000,

  // ─── What to scrape ──────────────────────────────────────────────────────
  electionTypes: (process.env.IREV_ELECTION_TYPES || 'presidential,senate,reps,governorship,stha')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  electionIds: ELECTION_TYPE_TO_IREV_ID,

  // ─── Storage ─────────────────────────────────────────────────────────────
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT || 'http://localhost:9000',
    bucket:   process.env.STORAGE_BUCKET   || 'ec8a-evidence',
    accessKey: process.env.STORAGE_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.STORAGE_SECRET_KEY || 'minioadmin',
    region:    process.env.STORAGE_REGION    || 'auto',
    // Object key template. {election_id} and {pu_code} are substituted.
    keyTemplate: '{election_id}/{pu_code}.jpg',
  },

  // ─── Database ────────────────────────────────────────────────────────────
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://openballot:openballot@localhost:5432/openballot',

  // ─── State ───────────────────────────────────────────────────────────────
  // Geo registry produced by Polling-Units/scraper.js. We reuse this instead
  // of re-discovering the PU tree from IReV - it lets the IReV scrape focus
  // on per-PU result fetches only.
  geoRegistryDir: path.resolve(__dirname, '..', '..', 'Polling-Units', 'results'),

  // Resumable progress.
  progressFile: path.resolve(__dirname, 'progress.json'),

  // Test / dry-run mode: do not write to DB or storage.
  dryRun: process.argv.includes('--dry-run'),
};
