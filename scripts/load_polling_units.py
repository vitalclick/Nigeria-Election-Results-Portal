#!/usr/bin/env python3
"""Load polling units scraped by the Node.js scraper into Postgres.

The existing scraper (`Polling-Units/scraper.js`) writes JSON per state to
`Polling-Units/results/<state>.json`. This script reads those files and
upserts into `polling_units` + `wards` + `lgas` + `states`.

Usage:
    DATABASE_URL=postgresql://... python load_polling_units.py Polling-Units/results
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras


def upsert_state(cur, code: str, name: str, zone: str) -> None:
    cur.execute(
        "INSERT INTO states (code, name, zone) VALUES (%s, %s, %s) ON CONFLICT (code) DO NOTHING",
        (code, name, zone),
    )


def upsert_lga(cur, code: str, name: str, state_code: str) -> None:
    cur.execute(
        "INSERT INTO lgas (code, name, state_code) VALUES (%s, %s, %s) ON CONFLICT (code) DO NOTHING",
        (code, name, state_code),
    )


def upsert_ward(cur, code: str, name: str, lga_code: str) -> None:
    cur.execute(
        "INSERT INTO wards (code, name, lga_code) VALUES (%s, %s, %s) ON CONFLICT (code) DO NOTHING",
        (code, name, lga_code),
    )


def upsert_pu(cur, row: dict) -> None:
    cur.execute(
        """
        INSERT INTO polling_units (
          pu_code, pu_name, ward_code, lga_code, state_code, geog, registered_voters
        ) VALUES (
          %s, %s, %s, %s, %s,
          CASE WHEN %s IS NULL OR %s IS NULL THEN NULL
               ELSE ST_GeogFromText('SRID=4326;POINT(' || %s || ' ' || %s || ')')
          END,
          %s
        )
        ON CONFLICT (pu_code) DO UPDATE
          SET pu_name = EXCLUDED.pu_name,
              registered_voters = EXCLUDED.registered_voters
        """,
        (
            row["pu_code"],
            row["pu_name"],
            row["ward_code"],
            row["lga_code"],
            row["state_code"],
            row.get("lng"),
            row.get("lat"),
            row.get("lng"),
            row.get("lat"),
            row.get("registered_voters"),
        ),
    )


def main(results_dir: str) -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 2

    conn = psycopg2.connect(url)
    conn.autocommit = False
    cur = conn.cursor()

    total = 0
    for path in sorted(Path(results_dir).glob("*.json")):
        with path.open() as f:
            payload = json.load(f)
        state = payload.get("state", {})
        upsert_state(cur, state["code"], state["name"], state.get("zone", "UNK"))
        for lga in payload.get("lgas", []):
            upsert_lga(cur, lga["code"], lga["name"], state["code"])
            for ward in lga.get("wards", []):
                upsert_ward(cur, ward["code"], ward["name"], lga["code"])
                for pu in ward.get("polling_units", []):
                    upsert_pu(
                        cur,
                        {
                            "pu_code": pu["code"],
                            "pu_name": pu["name"],
                            "ward_code": ward["code"],
                            "lga_code": lga["code"],
                            "state_code": state["code"],
                            "lat": pu.get("lat"),
                            "lng": pu.get("lng"),
                            "registered_voters": pu.get("registered_voters"),
                        },
                    )
                    total += 1
        conn.commit()
        print(f"loaded {path.name}: running total {total}")

    cur.close()
    conn.close()
    print(f"done: {total} polling units")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "Polling-Units/results"))
