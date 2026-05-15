#!/usr/bin/env python3
"""Standalone audit chain verifier.

Run against the published audit dataset (CSV) to independently confirm
that the chain has not been tampered with. This script intentionally has
zero OpenBallot-specific dependencies - any auditor can drop it on a
machine, point it at the published CSV, and get a yes/no answer in
seconds.

Usage:
    python verify_audit_chain.py path/to/audit_log.csv

CSV columns expected (in order):
    seq, event_type, entity_type, entity_id, actor_id, event_at,
    event_data_json, prev_hash, log_hash
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys

GENESIS = "0" * 64


def link_hash(prev: str, et: str, en: str, eid: str, actor: str, when: str, data_json: str) -> str:
    parsed = json.loads(data_json)
    canonical = json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    payload = prev + et + en + eid + actor + when + canonical
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main(path: str) -> int:
    prev = GENESIS
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # header
        for i, row in enumerate(reader, start=1):
            seq, et, en, eid, actor, when, data_json, prev_hash, log_hash = row
            if et == "chain.genesis":
                prev = log_hash
                continue
            if prev_hash != prev:
                print(f"BROKEN at seq={seq} (row {i}): prev_hash mismatch", file=sys.stderr)
                return 1
            expected = link_hash(prev, et, en, eid, actor, when, data_json)
            if expected != log_hash:
                print(f"BROKEN at seq={seq} (row {i}): hash mismatch", file=sys.stderr)
                return 1
            prev = log_hash
    print("OK: chain verified")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "audit_log.csv"))
