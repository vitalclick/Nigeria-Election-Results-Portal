"""Merkle root computation for batched audit log anchoring.

Every 30 minutes during an active election, the worker takes the slice of
audit_log since the last anchor, computes a Merkle root over the log_hashes,
and writes that root to Ethereum via OP_RETURN. The TX hash + block number
land in audit_anchors.

The construction is the standard binary Merkle tree with the Bitcoin-style
duplicate-last-leaf-on-odd convention (chosen for familiarity to auditors
who already know Bitcoin's SPV proofs).
"""

from __future__ import annotations

import hashlib


def _sha256d(b: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def merkle_root(leaves: list[str]) -> str:
    """Compute a Merkle root over a list of hex-encoded SHA-256 leaves.

    Returns a 64-char lowercase hex string. Empty input returns the all-zero
    root, matching Bitcoin's convention for an empty tree.
    """
    if not leaves:
        return "0" * 64

    layer = [bytes.fromhex(h) for h in leaves]
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])
        layer = [_sha256d(layer[i] + layer[i + 1]) for i in range(0, len(layer), 2)]
    return layer[0].hex()
