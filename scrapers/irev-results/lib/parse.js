'use strict';

// Parse IReV per-PU result responses into our ExtractedEC8A shape.
//
// IReV's JSON schema has changed across IReV deployments. The function
// below tolerates several known shapes and normalises them. If INEC ships
// a new shape, add a branch here; do not silently coerce - return null
// and let the caller log + skip the PU so the gap is visible in the
// progress report.

/**
 * @param {object} raw - decoded JSON from IReV per-PU endpoint
 * @param {string} puCode
 * @returns {object|null} - { extracted, image_url, raw_meta }
 */
function parseIRevPU(raw, puCode) {
  if (!raw || typeof raw !== 'object') return null;

  // Shape A: { result: { scores: [{party, score}], registered, accredited, valid, rejected, cast }, document_url }
  // Shape B: { data: { results: {APC: n, PDP: n, ...}, registered_voters, accredited_voters, ... }, ec8a_url }
  // Shape C (older): { Votes: [{PartyCode, Votes}], Document: { Url } }
  let votes = null;
  let registered = null;
  let accredited = null;
  let totalValid = null;
  let rejected = null;
  let cast = null;
  let imageUrl = null;
  let presiding = false;
  let stamp = false;
  let signatures = 0;

  if (raw.result && Array.isArray(raw.result.scores)) {
    votes = Object.fromEntries(
      raw.result.scores.map((s) => [normaliseParty(s.party), toInt(s.score)])
    );
    registered = toInt(raw.result.registered);
    accredited = toInt(raw.result.accredited);
    totalValid = toInt(raw.result.valid);
    rejected = toInt(raw.result.rejected ?? 0);
    cast = toInt(raw.result.cast ?? (totalValid + rejected));
    imageUrl = raw.document_url || raw.result.document_url || null;
  } else if (raw.data && raw.data.results) {
    votes = Object.fromEntries(
      Object.entries(raw.data.results).map(([k, v]) => [normaliseParty(k), toInt(v)])
    );
    registered = toInt(raw.data.registered_voters);
    accredited = toInt(raw.data.accredited_voters);
    totalValid = toInt(raw.data.total_valid_votes ?? sumValues(votes));
    rejected = toInt(raw.data.rejected_ballots ?? 0);
    cast = toInt(raw.data.total_votes_cast ?? (totalValid + rejected));
    imageUrl = raw.ec8a_url || raw.data.ec8a_url || null;
  } else if (Array.isArray(raw.Votes)) {
    votes = Object.fromEntries(
      raw.Votes.map((v) => [normaliseParty(v.PartyCode), toInt(v.Votes)])
    );
    totalValid = sumValues(votes);
    rejected = toInt(raw.RejectedBallots ?? 0);
    cast = toInt(raw.TotalVotesCast ?? (totalValid + rejected));
    registered = toInt(raw.RegisteredVoters);
    accredited = toInt(raw.AccreditedVoters);
    imageUrl = raw.Document?.Url || null;
  } else {
    return null;
  }

  // IReV records do not include signature/stamp detection - leave as defaults.
  // OCR-time downstream consumers will set these if/when we run our extractor.
  presiding = Boolean(raw.signed ?? raw.presiding_signed ?? true);
  stamp = Boolean(raw.stamped ?? raw.stamp_present ?? true);
  signatures = toInt(raw.agent_signatures ?? raw.signatures ?? 0);

  if (!votes || Object.keys(votes).length === 0 || imageUrl == null) return null;

  return {
    image_url: imageUrl,
    extracted: {
      pu_code: puCode,
      registered_voters: registered ?? 0,
      accredited_voters: accredited ?? 0,
      candidate_votes: votes,
      total_valid_votes: totalValid ?? sumValues(votes),
      rejected_ballots: rejected ?? 0,
      total_votes_cast: cast ?? (totalValid ?? sumValues(votes)) + (rejected ?? 0),
      presiding_officer_signed: presiding,
      agent_signatures_detected: signatures,
      official_stamp_present: stamp,
    },
    raw_meta: {
      submitted_at: raw.submitted_at || raw.uploaded_at || null,
      irev_record_id: raw.id || raw.record_id || null,
    },
  };
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function sumValues(obj) {
  return Object.values(obj).reduce((a, b) => a + (b || 0), 0);
}

function normaliseParty(code) {
  return String(code || '').trim().toUpperCase();
}

module.exports = { parseIRevPU };
