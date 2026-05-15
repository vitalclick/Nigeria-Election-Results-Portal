# Development guide

## What you need locally

- Docker + Docker Compose (single command boots the whole stack)
- Node 20.x (only if running the web app outside Docker)
- Python 3.11 (only if running the worker outside Docker)

A clone of this repo with **no** environment variables set will boot in
**mock mode** - the web app uses deterministic synthetic data so investors
or contributors can see the full UI without provisioning Supabase, Mapbox,
or the AI extractors. To opt in to real backends, copy `.env.example` to
`.env.local` and fill in the keys.

## One-command boot

```bash
docker compose -f infra/docker-compose.yml up --build
```

This brings up:

| Service | URL                            | Notes |
|---------|--------------------------------|-------|
| web     | http://localhost:3000          | Next.js 14 - public map + agent PWA + admin |
| worker  | http://localhost:8000/docs     | FastAPI - ingestion / extraction / verification |
| db      | postgresql://localhost:5432    | PostgreSQL 16 + PostGIS, migrations auto-applied on first boot |
| redis   | redis://localhost:6379         | Ingestion queue |
| minio   | http://localhost:9001 (console)| S3-compatible EC8A image store |

The DB container loads `db/migrations/*.sql` → `db/policies/*.sql` →
`db/seed/*.sql` on first start, in that order. A subsequent boot reuses the
volume; run `npm run stack:down` to wipe.

## Running pieces independently

### Web only (mock mode - no backend required)

```bash
cd web
npm install
npm run dev
# open http://localhost:3000
```

### Worker only

```bash
cd worker
pip install -e ".[dev]"
uvicorn app.main:app --reload
# docs at http://localhost:8000/docs
```

### Database only

```bash
docker run --rm -p 5432:5432 \
  -e POSTGRES_USER=openballot -e POSTGRES_PASSWORD=openballot -e POSTGRES_DB=openballot \
  -v "$PWD/db/migrations:/docker-entrypoint-initdb.d/01-migrations:ro" \
  -v "$PWD/db/policies:/docker-entrypoint-initdb.d/02-policies:ro" \
  -v "$PWD/db/seed:/docker-entrypoint-initdb.d/03-seed:ro" \
  postgis/postgis:16-3.4
```

## Tests

```bash
# Verification engine + audit chain + ingestion pipeline
cd worker && pytest -q
```

The worker tests cover:

- The six map states (`no_data`, `single_source`, `consensus`, `discrepancy`,
  `inec_confirmed`, `inec_conflict`)
- Two-agents-from-the-same-party-is-not-consensus (anti-stuffing rule)
- The Rivers-2023 scenario (multi-party consensus contradicts INEC IReV)
- Audit chain tamper detection (event data, prev_hash rewrite)
- Merkle root determinism
- GPS geofence (warn vs hard violation), EXIF integrity flags, duplicate
  party submissions

## Repo layout

```
web/             Next.js 14 app (public map, agent PWA, admin, embed widget)
  app/           App Router routes + API endpoints
  components/    React components (Map, agent flow, admin)
  lib/           Types, supabase client, i18n config, mock-data fallback
  messages/      Five-language translations (en, ha, yo, ig, pcm)

worker/          FastAPI service
  app/
    ingestion/   Geofence + EXIF + pipeline (pure functions)
    extraction/  Document AI + GPT-4o engine (with deterministic stub)
    verification/ Multi-source consensus algorithm
    audit/       Hash chain + Merkle root + Ethereum anchor

db/
  migrations/    SQL schema (PostGIS, audit chain trigger, aggregates)
  policies/      Row-level security
  seed/          Demo geography + parties + elections

infra/           docker-compose.yml + Dockerfiles
.github/workflows/ CI (worker tests, web typecheck, DB migration smoke test)
docs/            Architecture, security, deployment, data model
```

## Style and conventions

- TypeScript strict mode. No `any` in production code.
- Python: `ruff` for lint, `pytest` for tests, `pydantic` v2 models at every
  service boundary.
- Database: every schema change is a new numbered migration; do not edit
  applied migrations.
- Audit log is append-only. Code paths that need to "undo" a submission
  insert a `submission.retracted` event instead of mutating the original.
