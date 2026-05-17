'use strict';

// Endpoint discovery.
//
// IReV's URL scheme is not officially documented and has changed across
// election cycles. Rather than hard-code a single guess, the discovery
// step probes a small set of plausible templates against a known PU and
// returns whichever one returns a parseable JSON body. The operator can
// pipe the result into IREV_RESULT_PATHS before the pilot scrape.
//
// Conservative: at most one probe per template, then move on. We do not
// hammer the portal.
//
// 2026-05-17 — discovery findings.
//
// The live API base is the DigitalOcean origin:
//   https://dolphin-app-sleqh.ondigitalocean.app/api/v1/
// (the Angular SPA at irev.inecnigeria.org calls this directly).
//
// Confirmed reachable endpoints:
//   GET /                     -> heartbeat
//   GET /elections            -> paginated list, reverse-chronological
//   GET /states               -> 37 entries with INEC numeric codes
//
// EVERY template below currently 404s against the new API. The new
// model is election-first (look up election_id integer, then traverse
// state_id -> lga_id -> ward_id -> pu_id), not PU-first. See the
// "May 2026 discovery notes" section in README.md for the redesign
// path. New CANDIDATE_TEMPLATES will need to be filled in once the
// browser-DevTools probe of irev.inecnigeria.org reveals the real
// per-election traversal paths.

const config = require('../config');
const { getJSON } = require('./http');

const CANDIDATE_TEMPLATES = [
  // None of these match the live API as of 2026-05-17. Left in place
  // for historical reference; the discovery script will report all as
  // 404 until the redesign updates this list.
  '/api/v1/elections/{election_id}/polling-units/{pu_code}',
  '/api/v1/elections/{election_id}/results/{pu_code}',
  '/api/elections/{election_id}/results/{pu_code}',
  '/api/elections/{election_id}/polling-units/{pu_code}',
  '/api/v1/pu/{pu_code}?election={election_id}',
  '/api/pu/{pu_code}?election={election_id}',
  '/api/v1/results/{election_id}/{pu_code}',
  '/api/results/{election_id}/{pu_code}',
  '/elections/{election_id}/polling-units/{pu_code}.json',
];

function expand(template, electionId, puCode) {
  return (
    config.irevBase.replace(/\/$/, '') +
    template
      .replace('{election_id}', encodeURIComponent(electionId))
      .replace('{pu_code}', encodeURIComponent(puCode))
  );
}

function looksLikeResultPayload(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.result && (json.result.scores || json.result.results)) return true;
  if (json.data && (json.data.results || json.data.scores)) return true;
  if (Array.isArray(json.Votes)) return true;
  // Last resort: any nested array of {party, score|votes} pairs
  return false;
}

async function discoverResultPath({ electionId, puCode }) {
  const tried = [];
  for (const tmpl of CANDIDATE_TEMPLATES) {
    const url = expand(tmpl, electionId, puCode);
    const t0 = Date.now();
    try {
      const json = await getJSON(url);
      const elapsed = Date.now() - t0;
      const ok = looksLikeResultPayload(json);
      tried.push({ template: tmpl, url, status: 200, elapsed_ms: elapsed, parseable: ok });
      if (ok) return { winner: tmpl, url, tried };
    } catch (e) {
      tried.push({
        template: tmpl,
        url,
        status: e.status || 'network_error',
        elapsed_ms: Date.now() - t0,
        parseable: false,
        error: e.message,
      });
    }
  }
  return { winner: null, url: null, tried };
}

module.exports = { discoverResultPath, CANDIDATE_TEMPLATES, expand, looksLikeResultPayload };
