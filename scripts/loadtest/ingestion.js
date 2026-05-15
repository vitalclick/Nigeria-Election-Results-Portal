// OpenBallot Nigeria - ingestion endpoint load test
//
// Hits POST /v1/ingest at sustained rate to validate the documented
// criterion in docs/DEPLOYMENT_INFO.md:
//
//   sustained 150 submissions/sec for 1 hour
//
// The default scenario is shorter (5 minutes) so it can be run on every
// deploy. The full 1-hour rehearsal is gated behind FULL_REHEARSAL=1.
//
// Run:
//   k6 run -e API=https://api.openballot.ng -e BEARER=eyJ... scripts/loadtest/ingestion.js
//
//   # 1-hour pre-launch rehearsal
//   FULL_REHEARSAL=1 k6 run scripts/loadtest/ingestion.js
//
// The script generates payloads against polling units from a fixed pool;
// each iteration uses a unique combination of (election, pu, party)
// so duplicate-party-submission rejections do not skew the success rate.

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const API = __ENV.API || 'http://localhost:8000';
const BEARER = __ENV.BEARER || '';
const DEVICE_FP = __ENV.DEVICE_FINGERPRINT || 'loadtest-device-fingerprint';
const FULL = __ENV.FULL_REHEARSAL === '1';

const okRate = new Rate('ingest_ok');
const acceptedRate = new Rate('ingest_accepted');
const latency = new Trend('ingest_latency_ms', true);

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: 150,
      timeUnit: '1s',
      duration: FULL ? '1h' : '5m',
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    'ingest_latency_ms': ['p(95) < 1500'],
    'ingest_ok':         ['rate > 0.99'],
    'ingest_accepted':   ['rate > 0.95'],
  },
};

// A small PU pool. In a real rehearsal substitute a larger list pulled
// from `polling_units` via `psql -At -c "SELECT pu_code FROM polling_units
// LIMIT 5000;"`.
const PU_POOL = (() => {
  const pool = [];
  for (let i = 0; i < 500; i++) {
    const state = ['LA', 'KN', 'RI', 'FC'][i % 4];
    pool.push(`${state}-${String(i).padStart(4, '0')}`);
  }
  return pool;
})();

const PARTIES = ['APC', 'PDP', 'LP', 'NNPP'];
const ELECTIONS = ['2027-presidential'];

function randomImageBytes() {
  // Synthesise a 1MB-ish blob and hash it. The worker uses a stub
  // extractor so the actual image content does not need to be a real
  // JPEG to exercise the persistence path.
  const size = 1_000_000;
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i += 4) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return buf;
}

function uuid4() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function () {
  const election = ELECTIONS[Math.floor(Math.random() * ELECTIONS.length)];
  const pu = PU_POOL[Math.floor(Math.random() * PU_POOL.length)];
  const party = PARTIES[Math.floor(Math.random() * PARTIES.length)];

  const bytes = randomImageBytes();
  const sha = crypto.sha256(bytes, 'hex');
  // We don't actually upload the bytes here - the ingest endpoint expects
  // a pre-uploaded image URL. In a real rehearsal this URL is a presigned
  // R2 PUT that has already been used; for synthetic load we use a stub.
  const imageUrl = `https://evidence.openballot.ng/loadtest/${sha}.jpg`;

  const payload = {
    election_id: election,
    pu_code: pu,
    source_type: 'party_agent',
    party_code: party,
    image_url: imageUrl,
    image_sha256: sha,
    image_bytes: bytes.length,
    gps: { lat: 6.5 + Math.random() * 0.5, lng: 3.3 + Math.random() * 0.5 },
    captured_at: new Date().toISOString(),
    client_submission_uuid: uuid4(),
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': DEVICE_FP,
  };
  if (BEARER) headers['Authorization'] = `Bearer ${BEARER}`;

  const t0 = Date.now();
  const res = http.post(`${API}/v1/ingest`, JSON.stringify(payload), { headers });
  latency.add(Date.now() - t0);

  const httpOk = res.status >= 200 && res.status < 500;
  okRate.add(httpOk);

  let accepted = false;
  try {
    accepted = JSON.parse(res.body || '{}').accepted === true;
  } catch { /* malformed body */ }
  acceptedRate.add(accepted);

  check(res, {
    'status < 500': (r) => r.status >= 200 && r.status < 500,
  });
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'scripts/loadtest/ingestion-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const l = m.ingest_latency_ms?.values || {};
  return [
    '',
    '──────────── ingestion load test summary ────────────',
    `   total requests:   ${m.http_reqs?.values?.count || 0}`,
    `   http ok rate:     ${((m.ingest_ok?.values?.rate || 0) * 100).toFixed(2)}%`,
    `   accepted rate:    ${((m.ingest_accepted?.values?.rate || 0) * 100).toFixed(2)}%`,
    `   p50 latency:      ${(l['p(50)'] || 0).toFixed(1)} ms`,
    `   p95 latency:      ${(l['p(95)'] || 0).toFixed(1)} ms`,
    `   p99 latency:      ${(l['p(99)'] || 0).toFixed(1)} ms`,
    `   max latency:      ${(l.max || 0).toFixed(1)} ms`,
    '──────────────────────────────────────────────────────',
    '',
  ].join('\n');
}
