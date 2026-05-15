# Load tests

The two scenarios documented in `docs/DEPLOYMENT_INFO.md` § Phase 4
(Pre-launch). Both use [k6](https://k6.io/) - one tool, two scripts.

## Install k6

```bash
# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# macOS
brew install k6
```

## Tile endpoint

Validates the **public read path** - the vector-tile route that powers
the live map. Documented pass criterion: 1000 concurrent VUs sustained
at p95 < 200ms.

```bash
# Local dev (against `npm run dev` web app)
k6 run scripts/loadtest/tiles.js

# Staging
k6 run -e BASE=https://staging.openballot.ng -e ELECTION=2023-presidential \
  scripts/loadtest/tiles.js

# Production (run from outside the data centre to include Cloudflare)
k6 run -e BASE=https://openballot.ng -e ELECTION=2023-presidential \
  scripts/loadtest/tiles.js
```

The script runs two scenarios in parallel: a 50-VU baseline for 2 minutes
to confirm steady state, and a 1000-VU spike for 2 minutes to confirm
edge cache absorbs the burst. Two thresholds enforce the pass criterion:
`p95 < 200ms` during the spike, `p95 < 100ms` during the baseline.

Cloudflare cache HIT/MISS is logged automatically per k6's HTTP
instrumentation. If p95 spikes during the spike scenario it almost
always means the cache rule in Cloudflare needs `Cache Everything` (see
the deployment doc).

## Ingestion endpoint

Validates the **write path** - the worker's POST `/v1/ingest` route.
Documented pass criterion: 150 submissions/sec sustained for 1 hour.

The default duration is 5 minutes for routine deploy-time validation.
The 1-hour rehearsal runs once during pre-launch (T-7 days).

```bash
# Short version - fits in a deploy pipeline
k6 run -e API=http://localhost:8000 scripts/loadtest/ingestion.js

# Full pre-launch rehearsal (1 hour)
FULL_REHEARSAL=1 k6 run -e API=https://api.openballot.ng \
  -e BEARER="$(cat /tmp/loadtest-jwt.txt)" \
  scripts/loadtest/ingestion.js
```

Pre-launch rehearsal prerequisites:

1. **A real JWT** signed for a real test agent. Generate via the auth
   flow on staging (`POST /v1/auth/verify-otp`).
2. **Use a separate test election** (`2027-loadtest`) so the rehearsal
   does not pollute real data.
3. **Use a separate Twilio number** so test OTPs don't burn through
   production SMS budget.
4. The script generates 1 MB of synthetic image bytes per request - that
   is ~150 MB/s outbound to the worker host. Make sure the Hetzner box
   has the bandwidth headroom; for the same reason, do NOT run this
   rehearsal across the public internet from a metered connection.

## Reading the output

Both scripts print a summary at the end and write a structured JSON
report to `scripts/loadtest/<name>-summary.json` for the deploy
pipeline to capture.

```
──────────── tile load test summary ────────────
   requests:         42_318
   ok rate:          99.94%
   p50 latency:      28.4 ms
   p95 latency:      87.2 ms
   p99 latency:      152.6 ms
   max latency:      612.1 ms
────────────────────────────────────────────────
```

A `non-zero exit code` from k6 means one of the configured thresholds
failed. Whoever ran the test should investigate before declaring the
deploy / rehearsal complete.
