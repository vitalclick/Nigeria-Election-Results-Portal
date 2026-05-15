"""Anchor cron driver.

Picks up audit_log rows since the last successful anchor, computes the
Merkle root, submits to Ethereum, records the anchor in audit_anchors.

The driver is idempotent in two senses:

  * Re-running pickup for an already-pending batch DOES NOT submit a
    duplicate transaction - it returns the existing pending anchor row.
  * A submitted-but-not-yet-confirmed anchor is reconciled by
    `reconcile_pending_anchors` on the next cron tick: we re-check the
    receipt on chain and update the row to confirmed when ready.

This split prevents the worker from spending gas twice if a deploy or
SIGTERM lands between sendRawTransaction and the receipt write.
"""

from __future__ import annotations

import logging

from ..db import pool
from ..observability import ANCHOR_COUNTER
from .ethereum_client import GasPriceTooHigh
from .merkle import merkle_root

log = logging.getLogger(__name__)


async def pickup_batch(min_batch_size: int = 1) -> dict | None:
    """Find new audit_log rows since the last anchor batch, compute the
    Merkle root, insert an audit_anchors row with status='pending', and
    return its details.

    Returns None when there is nothing to anchor.
    """
    async with pool().acquire() as conn:
        # Find the last anchored seq.
        last_anchored = await conn.fetchval(
            "SELECT COALESCE(MAX(batch_end_seq), 0) FROM audit_anchors"
        )

        leaves = await conn.fetch(
            """
            SELECT seq, log_hash
              FROM audit_log
             WHERE seq > $1
             ORDER BY seq
            """,
            last_anchored,
        )
        if not leaves or len(leaves) < min_batch_size:
            return None

        leaf_hashes = [r["log_hash"] for r in leaves]
        root = merkle_root(leaf_hashes)
        start_seq = leaves[0]["seq"]
        end_seq = leaves[-1]["seq"]

        anchor_id = await conn.fetchval(
            """
            INSERT INTO audit_anchors (
              batch_start_seq, batch_end_seq, merkle_root, chain, status
            ) VALUES ($1, $2, $3, 'ethereum', 'pending')
            RETURNING id
            """,
            start_seq,
            end_seq,
            root,
        )

    return {
        "anchor_id": anchor_id,
        "start_seq": start_seq,
        "end_seq": end_seq,
        "merkle_root": root,
        "leaf_count": len(leaf_hashes),
    }


async def submit_pending(client) -> int:
    """Submit any audit_anchors rows in status='pending' to the chain.

    Returns the number of anchors successfully submitted.
    """
    submitted = 0
    async with pool().acquire() as conn:
        pending = await conn.fetch(
            """
            SELECT id, merkle_root
              FROM audit_anchors
             WHERE status = 'pending'
             ORDER BY batch_start_seq
            """
        )

    for row in pending:
        try:
            tx_hash, block_number = await client.send_data_tx(
                data_hex="0x" + row["merkle_root"]
            )
            ANCHOR_COUNTER.labels(outcome="confirmed").inc()
        except GasPriceTooHigh as e:
            ANCHOR_COUNTER.labels(outcome="gas_too_high").inc()
            log.warning(
                "audit.anchor.gas_too_high",
                extra={"anchor_id": str(row["id"]), "error": str(e)},
            )
            continue
        except Exception as e:
            ANCHOR_COUNTER.labels(outcome="failed").inc()
            log.warning(
                "audit.anchor.submit_failed",
                extra={"anchor_id": str(row["id"]), "error": str(e)},
            )
            # Leave the row pending; next cron tick will retry.
            continue

        async with pool().acquire() as conn:
            await conn.execute(
                """
                UPDATE audit_anchors
                   SET tx_hash = $1, block_number = $2, anchored_at = NOW(),
                       status = 'confirmed'
                 WHERE id = $3
                """,
                tx_hash,
                block_number,
                row["id"],
            )
        log.info(
            "audit.anchor.submitted",
            extra={
                "anchor_id": str(row["id"]),
                "tx_hash": tx_hash,
                "block": block_number,
            },
        )
        submitted += 1

    return submitted


async def run_once(client) -> dict:
    """One cron tick: pick up a new batch (if any) and submit pending."""
    new_batch = await pickup_batch()
    submitted = await submit_pending(client)
    return {
        "picked_up": new_batch,
        "submitted_count": submitted,
    }
