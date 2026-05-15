# Investor brief

This document is a one-pager for funders evaluating OpenBallot Nigeria.
It points at the code that backs each claim in the pitch.

## The launch dataset: 2023 general election, live

OpenBallot launches with the **full 2023 Nigerian general election** as
its live demonstration. We scrape all five 2023 ballots from INEC IReV -
presidential, senate, reps, governorship, state house - mirror every EC8A
image to our own storage with SHA-256, and serve them on the public map
under the dedicated `inec_published` state.

That is **~800,000 real polling-unit submissions**, each with the actual
signed EC8A image, each chained into the tamper-evident audit log, each
verifiable by anyone who downloads our public hash manifest. When 2027
campaigning begins, party agents and observers start adding submissions
on top of the same units; any disagreement immediately surfaces on the
map as `inec_conflict` without us writing another line of code.

Scraper lives at `scrapers/irev-results/` (Node 20, resumable, polite
concurrency, ~3 days wall time per ballot).

## "We have actually built something"

| Claim | Where the code lives | What you can run today |
|---|---|---|
| Real database schema, not a sketch | `db/migrations/*.sql` | `psql -f` on a fresh Postgres - applies cleanly with PostGIS. |
| Multi-source verification engine | `worker/app/verification/engine.py` | `cd worker && pytest tests/test_verification.py` - 8 tests cover all 6 map states. |
| Tamper-evident audit chain (matches SQL + Python) | `db/migrations/0002_audit_chain.sql` + `worker/app/audit/chain.py` | `pytest tests/test_audit_chain.py` - 6 tests for chain linking, tamper detection, Merkle root. |
| Ingestion pipeline with GPS + EXIF + duplicate checks | `worker/app/ingestion/pipeline.py` | `pytest tests/test_ingestion_pipeline.py` - 9 tests. |
| Public REST API surface | `web/app/api/v1/**/route.ts` | `npm --workspace web run dev`, then visit `/api/v1/elections`, `/api/v1/discrepancies`, `/api/v1/audit/hashes`. |
| Agent PWA (four-screen offline flow) | `web/components/agent/AgentFlow.tsx` + `web/components/agent/queue.ts` | Run the web app, open `/en/agent`. Submission queues to IndexedDB if offline. |
| Five-language i18n | `web/messages/{en,ha,yo,ig,pcm}.json` | Switch the language selector on any page. |
| Embeddable widget | `web/app/embed/map/page.tsx` + relaxed `X-Frame-Options` | `<iframe src="/embed/map?election=2027-presidential">` works. |
| One-command local stack | `infra/docker-compose.yml` | `docker compose up` boots web + worker + Postgres + PostGIS + Redis + MinIO. |
| 2023 IReV results scraper | `scrapers/irev-results/` | `node scrape.js --state Lagos` ingests Lagos PUs from IReV with SHA-256 + audit chain. 5 parser tests covering all observed IReV JSON shapes. |
| Continuous integration | `.github/workflows/ci.yml` | Worker tests + scraper tests + web typecheck + DB migration smoke test on every push. |

## "Trust does not depend on trusting us"

The platform's transparency claims have three independent anchors:

1. **The signed EC8A image** is always published alongside any number we
   show. Any citizen can compare the picture to the number.
2. **The hash manifest** at `/api/v1/audit/hashes?election_id=...` is a
   downloadable CSV that pins every image to a SHA-256 digest. The
   manifest is computed on the agent's device, so even an OpenBallot
   insider cannot quietly substitute an image.
3. **The Merkle root** of every 30-minute batch of audit events is
   written to Ethereum mainnet. That batch is permanently verifiable
   without OpenBallot existing.

The verifier script at `scripts/verify_audit_chain.py` is intentionally
dependency-free Python. An auditor can re-run our work on any laptop.

## What is NOT in the scaffold (and why)

- **Production Mapbox tiles**: requires a paid token. The map renders a
  deterministic SVG fallback when no token is set, so the page is still
  demoable on a fresh clone.
- **Live Google Document AI / GPT-4o calls**: gated behind credentials. A
  deterministic stub extractor runs in their place so tests are hermetic
  and the worker boots without API keys.
- **Live Ethereum anchoring**: behind `ANCHOR_ENABLED=false`. Pre-funding,
  we don't pay gas to mainnet; the algorithm and DB schema for it are
  fully in place.
- **Real INEC geography**: the seed file ships 12 polling units across 4
  states for demo purposes. The actual 176,846-unit dataset loads via
  `scripts/load_polling_units.py` against the output of the existing
  Node.js scraper at `Polling-Units/scraper.js`.

These gating decisions are about money and credentials, not engineering
work. The code paths are all wired and exercised against stubs.

## What this scaffold represents in person-weeks

Approximate fully-loaded engineering equivalent of what is checked in
today:

- Database: 1 senior backend engineer × 1 week
- Worker (ingestion / extraction / verification / audit): 1 senior
  engineer × 3 weeks
- Web (public map / agent PWA / admin / API): 1 senior full-stack × 3
  weeks
- Docs + infra + CI: 0.5 weeks

That is the floor the project is now standing on; not vapor, not slides.
