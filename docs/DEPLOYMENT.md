# Deployment

## Production target

| Layer | Provider | Why |
|---|---|---|
| Web (Next.js) | Hetzner (Germany) behind Cloudflare | EU jurisdiction for data residency neutrality; Cloudflare for DDoS + edge caching. |
| Worker (FastAPI) | Hetzner, same VPC as DB | Co-located with DB to minimise extraction round-trip; horizontally scalable. |
| Database | Supabase Pro (managed Postgres + PostGIS + Realtime) | RLS + realtime + storage in one platform. Migrations applied via Supabase CLI. |
| Object storage | Cloudflare R2 (primary) + Supabase Storage (mirror) | EC8A images are the canonical evidence; we keep two independent copies. |
| Queue | Redis (Hetzner) | Ingestion + extraction backlog. |
| Blockchain anchor | Ethereum mainnet via Infura | Public, third-party-verifiable, well-understood by auditors. |
| Notifications | Twilio (SMS) + WhatsApp Business API | Both channels because rural agents may not have WhatsApp; metro agents prefer it. |
| Monitoring | Grafana + Loki + Prometheus, self-hosted | Election-day visibility we control. |

## Rollout phases

1. **Pre-election (T-6 months)**: schema deployed; geography backfilled
   from INEC scrapes; party admin portal opened for roster uploads;
   pilot governorship election runs end-to-end.
2. **Dress rehearsal (T-30 days)**: 10% of expected agent fleet runs a
   simulated upload event using historical 2023 EC8A images. Worker
   capacity and DB write throughput measured against the live target.
3. **T-day**:
   - `T-24h`: all queues drained, audit chain verified, Cloudflare
     pre-warmed.
   - `T-0`: polls open. Submissions begin.
   - `T+1h - T+10h`: peak ingestion window. Worker autoscaling on RQ
     queue depth.
   - `T+10h - T+72h`: collation continues; discrepancy register surfaces
     conflicts as INEC IReV uploads land.
4. **Post-election (T+7 days)**: audit dataset packaged; CSV manifest of
   all image hashes published; full evidentiary chain available via
   `/api/v1/audit/chain?election_id=...`.

## Capacity sizing

For a presidential election (176,846 PUs, expected ~3 sources/PU average):

- Postgres: a single 16-core / 64GB primary handles ingestion comfortably.
  Read replicas absorb public API traffic.
- Worker: ~8 instances of 4-core / 8GB during the 60-minute peak.
- Web: CDN-cached aggressively; ~4 instances of 2-core / 4GB sustains the
  remaining dynamic load.
- Bandwidth: ~600GB image upload + ~5TB outbound CDN delivery on
  election day. Cloudflare handles the latter.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push:

- Worker: `ruff check` + `pytest`
- Web: `tsc --noEmit` + `next lint`
- Database: spins up PostGIS, applies all migrations, seeds, and runs
  smoke queries

Deployment is gated on green CI plus a manual approval for production.
Migrations are applied via Supabase CLI; rollbacks are forward-only
(another migration to undo).

## Election-day playbook

A separate operational runbook lives at `docs/RUNBOOK.md` (to be drafted
with the founding consortium). Key checklists:

- T-24h freeze on schema migrations
- Anchor cron interval reduced from 30 min to 10 min during peak
- Review queue staffing: 24/7 rota of consortium reviewers for low-confidence
  submissions
- Escalation contacts: INEC liaison, accredited observer bodies, party
  legal contacts - all preloaded and verified
