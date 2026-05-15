"""Ethereum anchoring of audit log Merkle roots.

The worker drives this in two phases:

  1. `prepare_batch` - select [last_anchored_seq+1, now] from audit_log,
     compute the Merkle root, insert an audit_anchors row with status='pending'.
  2. `submit_batch` - send an Ethereum transaction whose data field carries
     the Merkle root (effectively an OP_RETURN-style anchor). Record the TX
     hash + block number, set status='confirmed'.

Both phases are idempotent: re-running step 2 for an already-confirmed row
is a no-op, so the cron is safe to fire on overlapping schedules.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from .merkle import merkle_root

log = logging.getLogger(__name__)


@dataclass
class AnchorBatch:
    start_seq: int
    end_seq: int
    leaves: list[str]
    root: str


class EthereumClient(Protocol):
    async def send_data_tx(self, *, data_hex: str) -> tuple[str, int]:
        """Send a TX carrying `data_hex` as call-data. Returns (tx_hash, block)."""
        ...


def build_batch(start_seq: int, leaves: list[str], end_seq: int) -> AnchorBatch:
    return AnchorBatch(
        start_seq=start_seq,
        end_seq=end_seq,
        leaves=leaves,
        root=merkle_root(leaves),
    )


async def submit_anchor(batch: AnchorBatch, eth: EthereumClient) -> tuple[str, int]:
    tx_hash, block = await eth.send_data_tx(data_hex="0x" + batch.root)
    log.info(
        "audit.anchor.submitted",
        extra={
            "tx_hash": tx_hash,
            "block": block,
            "root": batch.root,
            "leaves": len(batch.leaves),
        },
    )
    return tx_hash, block
