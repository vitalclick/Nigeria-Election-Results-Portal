'use strict';

// Thin client for IReV per-PU result endpoints.
//
// IReV's URL scheme has differed across releases. The path templates below
// are the two patterns most commonly observed; they can be overridden via
// IREV_RESULT_PATH if INEC changes the scheme. We try each in order and
// return the first one that yields a parseable response.

const config = require('../config');
const { getJSON, getBytes } = require('./http');

const RESULT_PATH_TEMPLATES = (
  process.env.IREV_RESULT_PATHS ||
    '/api/v1/elections/{election_id}/polling-units/{pu_code},' +
    '/api/elections/{election_id}/results/{pu_code},' +
    '/api/v1/pu/{pu_code}?election={election_id}'
).split(',').map((s) => s.trim()).filter(Boolean);

function buildUrls(electionId, puCode) {
  return RESULT_PATH_TEMPLATES.map(
    (tmpl) =>
      config.irevBase.replace(/\/$/, '') +
      tmpl.replace('{election_id}', encodeURIComponent(electionId)).replace('{pu_code}', encodeURIComponent(puCode))
  );
}

/**
 * Fetch a single PU's result record. Returns the first non-empty JSON.
 * Throws { code: 'not_uploaded' } if every URL 404s - meaning INEC has
 * no upload for this PU (a real, documented condition in the 2023
 * presidential election).
 */
async function fetchPUResult(electionId, puCode) {
  let last404 = null;
  for (const url of buildUrls(electionId, puCode)) {
    try {
      const json = await getJSON(url);
      if (json && (json.result || json.data || json.Votes)) return { url, json };
    } catch (e) {
      if (e.status === 404) {
        last404 = e;
        continue;
      }
      throw e;
    }
  }
  const err = new Error(`no IReV upload for ${puCode}@${electionId}`);
  err.code = 'not_uploaded';
  err.cause = last404;
  throw err;
}

async function fetchImage(imageUrl) {
  return getBytes(imageUrl);
}

module.exports = { fetchPUResult, fetchImage, buildUrls };
