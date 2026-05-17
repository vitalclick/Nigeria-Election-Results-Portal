# IReV results scraper

Ingests the 2023 Nigerian general election results from INEC's IReV portal
into the OpenBallot platform. Walks the polling-unit registry produced by
`Polling-Units/scraper.js` and, for each (election × PU) pair, fetches the
published result + EC8A image, mirrors the image to our storage, and writes
an `ec8a_submissions` row with `source_type='inec_irev'`.

> ⚠️ **Status (May 2026): API target has moved. Pipeline requires
> redesign before it can run end-to-end.** See "May 2026 discovery notes"
> below for what changed and what the next operator picks up. The
> docs above describe the *intended* end-state; the code currently in
> this directory was written against the original 2023 IReV API which
> INEC has since retired.

## What it produces

Per polling unit, per election:

- An entry in `ec8a_submissions` (review_status `auto_approved`, source
  `inec_irev`, confidence `1.0` because the source is INEC themselves)
- An `audit_log` event chained into the tamper-evident SHA-256 hash chain
- A `verified_results` row with status `inec_published`
- The EC8A image, mirrored to S3-compatible storage with its SHA-256 stored
  in the submission and verifiable from the public hash manifest

## Prerequisites

1. **Geo registry**: run `Polling-Units/scraper.js` first to produce the
   per-state JSON files in `Polling-Units/results/`.
2. **Database**: migrations applied (`db/migrations/0001..0005_*.sql`).
3. **Storage**: MinIO (dev) or Cloudflare R2 (prod) reachable.

## Configuration

All endpoints are configurable. Defaults are documented in `config.js`.
Override via environment variables; the values most likely to need
adjustment in a real run:

```bash
# Base URL of the IReV deployment (INEC has shifted this between cycles)
IREV_BASE=https://lv.irev.inecnigeria.org

# Comma-separated list of path templates to try per PU. Tokens
# {election_id} and {pu_code} are substituted. The first one returning a
# parseable JSON body wins.
IREV_RESULT_PATHS=/api/v1/elections/{election_id}/polling-units/{pu_code},/api/elections/{election_id}/results/{pu_code}

# Per-election IDs IReV uses internally. Confirm against the live portal.
IREV_ID_PRESIDENTIAL=presidential-2023
IREV_ID_SENATE=senate-2023
IREV_ID_REPS=house-of-reps-2023
IREV_ID_GOV=governorship-2023
IREV_ID_STHA=state-house-2023

# Rate limiting - this is a public-good archive scrape, be polite
IREV_DELAY_MS=450
IREV_CONCURRENCY=4

# Storage
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET=ec8a-evidence
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin

# Database
DATABASE_URL=postgresql://openballot:openballot@localhost:5432/openballot
```

## Recommended sequence: discover -> pilot -> full

Before committing multi-day scrape time, validate that the parser matches
INEC's current IReV schema. The pilot tooling makes that a 30-minute job.

### 1. Discover the live endpoint

```bash
# Pick any known-good PU code from Polling-Units/results/
node scripts/discover-endpoints.js \
  --election presidential \
  --pu 25-11-04-007
```

The script probes nine candidate URL templates, prints which ones returned
parseable JSON, and emits an `export IREV_RESULT_PATHS=...` line to paste
before the pilot.

### 2. Run the one-state pilot

```bash
node scripts/pilot.js \
  --state Lagos \
  --election presidential \
  --limit 200
```

This processes 200 PUs end-to-end (fetch -> parse -> upload -> persist ->
audit), captures every raw response to `fixtures/captured/<election_id>/`,
samples 5 uploaded images and recomputes their SHA-256 against the DB
record, runs the audit chain verifier, and writes:

  - `pilot-output/pilot-report.json`  - structured report
  - `pilot-output/pilot-report.md`    - human summary

The report ends with a verdict: **ship the full scrape** or **hold +
here's exactly what to fix**. Common holds:

  - parser saw an unrecognised payload shape -> update `lib/parse.js`
    (the exemplar fixture path is in the report)
  - low success rate -> investigate the IReV URL pattern or election ID
  - audit chain broken -> stop, this is a bug, not a config issue

### 3. Run the full scrape

```bash
npm install

# Full scrape (resumable - safe to interrupt and re-run)
node scrape.js

# A single state
node scrape.js --state Lagos

# A single election type
node scrape.js --election presidential

# Smoke test (100 PUs, no writes)
node scrape.js --dry-run --max 100

# Reset progress and start over
node scrape.js --reset
```

## Resumability

Progress is flushed atomically every 50 PUs to `progress.json`. A re-run
skips any `(election_id, pu_code)` pair already marked done in the
progress file. To force re-processing of a single unit, edit the JSON or
use `--reset` for a clean restart.

## Status values written to verified_results

For every PU successfully scraped the row is written with status
`inec_published` - distinct from `single_source` (which means a single
party agent or observer). This makes the 2023 historical dataset visually
distinguishable on the map from in-progress current elections.

## When INEC's response shape changes

The parser in `lib/parse.js` tolerates three observed IReV JSON shapes
(`result.scores` array, `data.results` map, `Votes` array). If INEC
ships a new shape, add a branch there - do not silently coerce, return
`null` and let the PU be flagged in the progress report so the gap is
visible.

## Cost / volume envelope

| Election    | Approx PUs | Images at ~1MB each | Storage |
|-------------|------------|---------------------|---------|
| Presidential | 176,846    | ~180 GB             | R2: ~$3/mo |
| Senate       | 176,846    | ~180 GB             | R2: ~$3/mo |
| Reps         | 176,846    | ~180 GB             | R2: ~$3/mo |
| Gov          | ~140,000   | ~140 GB             | R2: ~$2/mo |
| STHA         | ~140,000   | ~140 GB             | R2: ~$2/mo |
| **Total**    | ~810,000   | ~820 GB             | R2: ~$13/mo |

At 450ms inter-request delay and 4 concurrent workers, a full single-election
scrape lands in ~3 days of wall time. The full five-election dataset is
~12-15 days of continuous scraping. Both fit comfortably inside any
reasonable run schedule before the public launch.

## Tests

```bash
node --test test/
```

The unit tests cover the parser against all three known IReV JSON shapes
plus the empty/unrecognised cases. End-to-end testing against a real IReV
deployment is run manually as part of pre-launch validation - not in CI
- because it depends on INEC's live infrastructure.

## May 2026 discovery notes — the API has moved and the model changed

A 2026-05-17 session attempted to run this scraper end-to-end and found
that **none of the URL templates in `lib/endpoint_discovery.js` are
reachable**. INEC retired the original `lv.irev.inecnigeria.org` host
after 2023 and rebuilt IReV on a different stack. The new picture:

### Hosts

| Hostname | Status | Role |
|---|---|---|
| `lv.irev.inecnigeria.org` | DNS does not resolve | Original 2023 host — gone |
| `www.inecelectionresults.ng` | Cloudflare → DigitalOcean SPA | Public-facing portal (Angular) |
| `irev.inecnigeria.org` | Cloudflare → DigitalOcean SPA | Same Angular app under INEC's own domain |
| `dolphin-app-sleqh.ondigitalocean.app` | **Reachable, this is the live API** | Express + MongoDB backend |
| `lv001-r.inecelectionresults.ng` | DNS does not resolve | Stale URL still referenced in the SPA bundle |
| `irev-v2.herokuapp.com` | Legacy — Heroku, likely stale | Pilot environment from earlier vintage |

EC8A image storage:
- `ecollation-result-docs.s3.eu-west-2.amazonaws.com` — collated docs
- `etransmission-result-docs.s3.eu-west-2.amazonaws.com` — raw EC8A scans (the canonical evidence per ADR-0001)

### Confirmed working API endpoints (May 2026)

Base: `https://dolphin-app-sleqh.ondigitalocean.app/api/v1/`

```
GET /                     -> { status: "success", request_time: <epoch_ms> }
GET /elections            -> { success: true, data: [{...election...}] }   paginated, newest first
GET /states               -> { success: true, states: [{...state...}] }    37 entries
```

Schema fragments observed in responses:

```
Election:
  _id              MongoDB ObjectId           e.g. "6549830e8f260c2694ceab91"
  election_id      integer                    e.g. 2793, 1486   <-- this is the lookup key
  full_name        human label                 e.g. "Governorship election - 2023-11-11 - BAYELSA"
  election_date    ISO date
  election_type_id integer                    1=Presidential, 2=Gov, 3=Senate, 4=Reps,
                                              5=Assembly, 6=Chairman, 7=Councillor
  state_id         integer                    1..37, IReV-internal (NOT INEC alpha)
  state            embedded state document    has .name ("BAYELSA") and .code ("06")
  domain_id        integer                    state/LGA/ward/constituency id (depends on election scope)
  domain_type      string                     "App\\Models\\State" | "App\\Models\\Lga" | "App\\Models\\Ward" | etc.
  domain           embedded domain document

State:
  _id              MongoDB ObjectId
  state_id         integer                    1..37
  name             string                     "FCT", "RIVERS"
  code             string                     "37", "32" -- INEC NUMERIC, not the alpha codes we use
```

### Confirmed broken — paths that returned 404

```
/api/v1/results
/api/v1/polling-units/{pu_code}
/api/v1/elections/{slug}/polling-units/{pu_code}
```

…plus every template in the current `CANDIDATE_TEMPLATES` array.

### Why the model mismatch matters

This scraper was designed PU-first: walk every PU in
`Polling-Units/results/*.json` and for each PU fetch all its elections.
The live IReV API is election-first: pick an `election_id`, then traverse
through `state_id → lga_id → ward_id → polling_unit_id` (all
IReV-internal integers, not our INEC delim codes), then fetch the result
for a single `(election_id, pu_id)` pair.

Switching to that model requires:

1. **Find the 2023 Presidential `election_id`.** It is buried far back
   in `/api/v1/elections`; the response is reverse-chronological and
   pagination defaults likely cap at 100. Filter by `election_type_id=1`
   if the API supports a query string (untested), or paginate.
2. **Find the traversal endpoints.** Plausible patterns to probe (none
   verified yet):
   - `/api/v1/elections/{election_id}/states`
   - `/api/v1/elections/{election_id}/states/{state_id}/lgas`
   - `/api/v1/elections/{election_id}/.../polling-units`
   - `/api/v1/elections/{election_id}/polling-units/{pu_id}/result`
   The reliable way to find these is to open
   <https://irev.inecnigeria.org/> in a browser, open DevTools → Network
   → Fetch/XHR, and click through to a polling unit result. Each click
   reveals the exact path.
3. **Build a mapping from INEC delim codes to IReV internal IDs.** Our
   geo loader (scripts/load_polling_units.py) keys on INEC's delim
   ("25-11-04-007"). IReV stores its own MongoDB ObjectIds and integer
   IDs per state/LGA/ward/PU. The mapping table needs to be populated
   once via a discovery pass that traverses IReV's hierarchy and joins
   by name. Probably a new table `irev_pu_mapping (inec_pu_code,
   irev_pu_id, irev_object_id, confidence)`.
4. **Rewrite `lib/irev_client.js` and `scrape.js`** around the election-
   first traversal. The existing `parse.js` is likely still useful for
   the per-PU result payload (assuming the result shape hasn't changed
   much) but won't be exercisable until step 3 produces a real PU ID.
5. **Update `lib/endpoint_discovery.js` `CANDIDATE_TEMPLATES`** with the
   actually-discovered templates from step 2.

### Pending verification

- Whether INEC has put authentication or rate limiting in front of
  `dolphin-app-sleqh.ondigitalocean.app` for high-volume traversal
  (the diagnostic curls returned 200 with no apparent throttling, but
  walking 174,175 PUs is a different volume profile).
- Whether the EC8A image URLs returned by the per-PU result endpoint
  reference the S3 buckets above directly or go through a signed-URL
  proxy.
- Whether the 2023 Presidential election rows include the `parties[]`
  list inline (newer elections in `/api/v1/elections` show
  `parties: []` empty) or need a separate endpoint.

### Where to pick up

Open <https://irev.inecnigeria.org/> in a browser, DevTools → Network
→ Fetch/XHR, click Presidential → 2023 → any state → any LGA → any
ward → any PU. The 5-6 XHR requests that fire are the exact API paths
this scraper needs. Update `lib/endpoint_discovery.js`
`CANDIDATE_TEMPLATES` and the new `IREV_BASE` default in `config.js`,
then proceed with the redesign per the steps above.
