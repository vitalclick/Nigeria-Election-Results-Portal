# Architecture

OpenBallot Nigeria is intentionally **boring** at the infrastructure layer
and **rigorous** at the data layer. Election platforms fail in two ways:
through ambitious infrastructure choices that don't survive election-day
load, or through schema choices that allow silent data drift. We optimise
hard against both.

## Topology

```
  Agents (PWA)        Observers      Party admins        INEC IReV mirror
       │                  │              │                     │
       └──────────────────┴──────┬───────┴─────────────────────┘
                                 │
                          Next.js Edge
                          (Vercel / Hetzner)
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
         Public API + map            Auth & PWA upload endpoint
                │                                 │
                ▼                                 ▼
        Supabase PostgreSQL ◄────── Worker (FastAPI + RQ)
        + PostGIS + Realtime               │
                ▲                          │
                │                  ┌───────┴───────┐
                │                  ▼               ▼
                │            Google           OpenAI GPT-4o
                │            Document AI      Vision
                │                  │               │
                │                  └──────┬────────┘
                │                         ▼
                │                  Object storage
                │                  (Cloudflare R2 / MinIO)
                │
                └─── Audit anchor cron ──► Ethereum (OP_RETURN via Infura)
```

## Service boundaries

### Web (Next.js 14 App Router)

- Public results map, discrepancy register, agent PWA, admin portal
- All read endpoints under `/api/v1/*` (REST, JSON, no auth required for public reads)
- Server-Sent Events stream at `/api/v1/elections/:id/stream` for sub-second map updates
- Edge-cached responses with `stale-while-revalidate` to absorb spikes

### Worker (FastAPI + RQ)

- POST `/v1/ingest` is the only write boundary into the evidentiary system
- Runs the ingestion pipeline (`geofence`, `exif`, duplicate check)
- Calls the extraction engine (Document AI primary, GPT-4o fallback)
- Recomputes verification on every submission
- Cron drives the audit anchor (Merkle root → Ethereum every 30 min)

### Database (PostgreSQL 16 + PostGIS)

- Election-agnostic geography (`polling_units`, `wards`, `lgas`, `states`)
- Per-election operational data (`ec8a_submissions`, `verified_results`,
  `discrepancies`)
- Append-only audit log with SQL-level hash chain trigger
- Realtime CDC streams `verified_results` updates to subscribers

## The four critical algorithms

These are the parts of the system where investors, auditors, and reviewers
should look first - if any of them is wrong, the platform's claims are wrong.

### 1. Multi-source consensus

`worker/app/verification/engine.py`. Pure function. Sources are
deduplicated by party (two APC agents are NOT independent), observers are
each their own source, INEC IReV is a distinct source. With `>=2`
independent sources agreeing within tolerance, the unit goes `consensus`.
With INEC present and matching, `inec_confirmed`. With INEC present and
disagreeing with non-INEC consensus, `inec_conflict` - the most important
state on the map.

### 2. Audit hash chain

`worker/app/audit/chain.py` + `db/migrations/0002_audit_chain.sql`. Both
implementations compute the same hash. The Postgres trigger writes
`log_hash = SHA256(prev_hash || event_type || entity_type || entity_id ||
actor || event_at || event_data)` on every insert. Python verifier reads
the published audit dataset back and walks the chain in O(n). Any rewrite
breaks the chain at the point of tampering.

### 3. Merkle anchor

`worker/app/audit/merkle.py`. Standard Bitcoin-style binary Merkle tree.
The worker batches recent audit rows every 30 minutes during active
elections, computes the root, and writes the root to Ethereum via
OP_RETURN. From that point on the batch is independently verifiable
without trusting OpenBallot's infrastructure at all.

### 4. Ingestion validation

`worker/app/ingestion/pipeline.py`. Hash format, image size, GPS
geofence (soft warn, hard block), EXIF integrity, duplicate party
submission. Every failure mode produces a flag, not silent rejection;
submissions are public evidence and so are their flags.

## Why these choices

| Decision | Rationale |
|---|---|
| Next.js + FastAPI split | Next.js is best-in-class for SSR + edge caching of read endpoints. FastAPI is the cleanest way to keep AI extractor calls (which dominate worker latency) out of the web request path. |
| Postgres + PostGIS | Geo queries at PU granularity, mature replication, RLS, JSONB for extracted payloads. The alternative (a NoSQL store) loses transactional consistency between submissions and the verified_results materialised view. |
| Append-only audit chain in SQL | The hash chain lives at the layer that owns the truth. A trigger guarantees no application path can write a row without producing a verifiable hash, even if a developer forgets. |
| PWA (no app store) | Election-day deployment to 176k+ agents through Play Store or App Store is impossible. A PWA installs from a URL in under five seconds. |
| Mapbox GL JS | Choropleth at polling-unit granularity (176k features) needs vector tiles. Mapbox is the only mature option on this size class. |
| AGPL-3.0 | Forbids any government or commercial deployer from running a closed fork. Transparency is enforced at the licence level. |

## Production scale envelope

| Quantity | Value |
|---|---|
| Polling units | 176,846 (presidential, all PUs) |
| Submissions on a busy election day | ~530,000 (3 sources × 176k PUs, presidential election) |
| Peak ingestion rate | ~150 submissions/second over a 60-minute window |
| Image storage | ~530GB at 1MB/image; CDN cached |
| Postgres writes | ~530k inserts + ~530k audit_log rows; well within a single node |
| Map clients | 250k+ concurrent during declaration; absorbed by CDN + SSE fan-out |

This is squarely within what a single PostgreSQL primary + a horizontally
scaled stateless web tier + a separate worker fleet handles. The platform
does not need exotic infrastructure.

## What we deliberately don't do

- **No closed numbers.** The platform never displays a tally without the
  signed EC8A behind it.
- **No silent corrections.** A low-confidence extraction is flagged and
  queued for human review; it is not "rounded" or "snapped" to a
  plausible value.
- **No first-source-wins.** The verification engine treats single-source
  submissions as `single_source`, not `consensus`. Citizens see the
  ambiguity, not a false certainty.
- **No deletion.** Submissions can be marked retracted; rows are never
  deleted. The audit chain enforces this.
