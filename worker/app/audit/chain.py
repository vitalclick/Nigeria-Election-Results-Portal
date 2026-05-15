"""Audit log hash-chain primitives.

This is the same algorithm implemented by the database trigger in
migration 0002_audit_chain.sql. We keep a Python implementation so the
chain can be verified end-to-end from outside the database - e.g. by an
auditor who has only downloaded the published audit dataset.

Verification is O(n) and trivially parallelisable by batching.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

GENESIS_HASH = "0" * 64


@dataclass
class AuditEvent:
    seq: int
    event_type: str
    entity_type: str
    entity_id: str
    actor_id: str | None
    event_at: datetime
    event_data: dict[str, Any]
    prev_hash: str
    log_hash: str = ""


def _canonical_event_data(data: dict[str, Any]) -> str:
    # Match Postgres's text cast of JSONB sufficiently closely: sort keys,
    # no whitespace, ensure_ascii=False to match unicode preservation.
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def link_hash(event: AuditEvent) -> str:
    """Compute the chained log_hash for an event.

    The exact byte sequence must match the SQL trigger:
      prev_hash || event_type || entity_type || entity_id ||
      COALESCE(actor_id::text,'') || event_at::text || event_data::text
    """
    payload = (
        event.prev_hash
        + event.event_type
        + event.entity_type
        + event.entity_id
        + (event.actor_id or "")
        + event.event_at.isoformat()
        + _canonical_event_data(event.event_data)
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify_chain(events: list[AuditEvent]) -> tuple[bool, int | None]:
    """Verify the hash chain. Returns (ok, first_broken_seq).

    Events must be ordered by seq. Genesis row is skipped (it has its own
    deterministic hash, not derived from the chain rule).
    """
    prev = GENESIS_HASH
    for ev in events:
        if ev.event_type == "chain.genesis":
            prev = ev.log_hash
            continue
        if ev.prev_hash != prev:
            return False, ev.seq
        expected = link_hash(ev)
        if expected != ev.log_hash:
            return False, ev.seq
        prev = ev.log_hash
    return True, None
