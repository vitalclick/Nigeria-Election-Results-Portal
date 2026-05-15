// OpenBallot Nigeria - tile endpoint load test
//
// Hits /api/v1/tiles/{election}/{z}/{x}/{y}.mvt with a realistic mix of
// zoom levels and Nigerian-territory tile coordinates. The pass criterion
// is documented in docs/DEPLOYMENT_INFO.md:
//
//   1000 concurrent tile requests at zoom 7-12 with p95 < 200ms
//
// Run:
//   k6 run -e BASE=https://openballot.ng -e ELECTION=2023-presidential scripts/loadtest/tiles.js
//
// Local dev:
//   k6 run scripts/loadtest/tiles.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const ELECTION = __ENV.ELECTION || '2023-presidential';

const okRate = new Rate('tile_ok');
const tileLatency = new Trend('tile_latency_ms', true);

export const options = {
  // Two scenarios run in parallel: a small steady baseline plus a stress
  // spike to validate the documented criterion.
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      tags: { phase: 'baseline' },
    },
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m',  target: 1000 },
        { duration: '2m',  target: 1000 },
        { duration: '30s', target: 0 },
      ],
      tags: { phase: 'spike' },
      startTime: '30s',
    },
  },
  thresholds: {
    // Per the deployment doc.
    'tile_latency_ms{phase:spike}':  ['p(95) < 200'],
    'tile_latency_ms{phase:baseline}': ['p(95) < 100'],
    'tile_ok': ['rate > 0.99'],
  },
};

// Nigeria bounds in tile coordinates per zoom level. We pre-compute a
// pool of valid (z, x, y) for zooms 7-12 covering Nigerian territory.
// The pool is built deterministically at script init so every VU draws
// from the same shape.
const POOL = (() => {
  const out = [];
  // Approximate Nigerian lat/lng bounds
  const lngMin = 2.7, lngMax = 14.7;
  const latMin = 4.0, latMax = 14.0;
  for (let z = 7; z <= 12; z++) {
    const n = 1 << z;
    const xMin = Math.floor(((lngMin + 180) / 360) * n);
    const xMax = Math.floor(((lngMax + 180) / 360) * n);
    const ySouth = Math.floor(
      ((1 - Math.log(Math.tan((latMin * Math.PI) / 180) + 1 / Math.cos((latMin * Math.PI) / 180)) / Math.PI) / 2) * n
    );
    const yNorth = Math.floor(
      ((1 - Math.log(Math.tan((latMax * Math.PI) / 180) + 1 / Math.cos((latMax * Math.PI) / 180)) / Math.PI) / 2) * n
    );
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yNorth; y <= ySouth; y++) {
        out.push({ z, x, y });
      }
    }
  }
  return out;
})();

export default function () {
  const tile = POOL[Math.floor(Math.random() * POOL.length)];
  const url = `${BASE}/api/v1/tiles/${ELECTION}/${tile.z}/${tile.x}/${tile.y}.mvt`;
  const t0 = Date.now();
  const res = http.get(url, { tags: { z: String(tile.z) } });
  tileLatency.add(Date.now() - t0);
  okRate.add(res.status === 200 || res.status === 204);
  check(res, {
    'status 200 or 204': (r) => r.status === 200 || r.status === 204,
  });
  // Brief think-time so we're not hammering at machine speed.
  sleep(0.05 + Math.random() * 0.1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'scripts/loadtest/tiles-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const lat = m.tile_latency_ms?.values || {};
  const ok = m.tile_ok?.values || {};
  return [
    '',
    '──────────── tile load test summary ────────────',
    `   requests:         ${m.http_reqs?.values?.count || 0}`,
    `   ok rate:          ${((ok.rate || 0) * 100).toFixed(2)}%`,
    `   p50 latency:      ${(lat['p(50)'] || 0).toFixed(1)} ms`,
    `   p95 latency:      ${(lat['p(95)'] || 0).toFixed(1)} ms`,
    `   p99 latency:      ${(lat['p(99)'] || 0).toFixed(1)} ms`,
    `   max latency:      ${(lat.max || 0).toFixed(1)} ms`,
    '────────────────────────────────────────────────',
    '',
  ].join('\n');
}
