# Polling-Units/results

Output directory for `scraper.js`. **The full scrape is committed here**
as a versioned snapshot of INEC's published roster at the time of scrape.
That makes this folder the only safe long-term store for the raw data
even after it's loaded into Postgres — useful for reproducing the load,
diffing future scrapes against this baseline, and recovery.

## Files

- `<state>.json` — one per state, e.g. `abia.json`, `lagos.json` (37 total)
- `all-polling-units.json` — merged flat list of every polling unit
- `summary.json` — totals (states / LGAs / wards / PUs) and failure log

## Current snapshot

| | Value |
|---|---|
| Scraped at | 2026-05-16 |
| States | 37 (36 + FCT) |
| LGAs | 774 |
| Wards | 8,799 |
| Polling units | 174,175 |
| Failures | 0 |
| Total size | ~88 MB on disk |

## Loading into Postgres

```bash
# From the repo root
DATABASE_URL="postgresql://user:pass@host:port/dbname" \
  python scripts/load_polling_units.py
```

The loader maps the JSON into `states` / `lgas` / `wards` /
`polling_units` per `db/migrations/0001_core_schema.sql`. It runs a
pre-flight pass to verify INEC's `delim` is globally unique before any
DB writes happen.

## Regenerating the scrape

INEC occasionally publishes roster updates (new PUs, name corrections).
To refresh:

```bash
cd Polling-Units
node scraper.js --reset    # fresh scrape, ~60 minutes
# or
node scraper.js            # resumes from progress/scrape_progress.json
```

Commit the updated `results/` files when satisfied so the repo's
snapshot stays current.
