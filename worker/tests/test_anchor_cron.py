"""Tests for the anchor cron driver.

We mock the database pool so the driver can be exercised against
in-memory fixtures rather than a live Postgres. The Ethereum client is
also mocked - we are testing the cron's idempotency + sequencing, not
the chain interaction (that is covered in test_ethereum_client.py).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.audit import cron


class _FakeConn:
    def __init__(self, fixtures: dict):
        self.fixtures = fixtures
        self.executed: list[tuple[str, tuple]] = []

    async def fetchval(self, sql, *args):
        key = sql.strip().split()[0].upper()
        return self.fixtures.get(("fetchval", key), 0)

    async def fetch(self, sql, *args):
        if "audit_log" in sql:
            return self.fixtures.get("audit_log_rows", [])
        if "audit_anchors" in sql:
            return self.fixtures.get("pending_anchors", [])
        return []

    async def execute(self, sql, *args):
        self.executed.append((sql.strip().split()[0].upper(), args))


class _FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return _Acquire(self.conn)


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_pickup_returns_none_when_no_new_events():
    conn = _FakeConn({
        ("fetchval", "SELECT"): 100,    # last anchored seq
        "audit_log_rows": [],            # nothing new
    })
    with patch("app.audit.cron.pool", return_value=_FakePool(conn)):
        result = await cron.pickup_batch()
    assert result is None


@pytest.mark.asyncio
async def test_pickup_creates_pending_anchor():
    """When new audit_log rows exist, pickup computes the Merkle root and
    inserts an audit_anchors row in status='pending'."""
    conn = _FakeConn({
        ("fetchval", "SELECT"): 100,
        "audit_log_rows": [
            {"seq": 101, "log_hash": "a" * 64},
            {"seq": 102, "log_hash": "b" * 64},
            {"seq": 103, "log_hash": "c" * 64},
        ],
    })

    # Track the INSERT into audit_anchors via fetchval (which RETURNS id)
    async def fetchval(sql, *args):
        if sql.strip().startswith("INSERT INTO audit_anchors"):
            conn.executed.append(("INSERT", args))
            return "anchor-uuid-1"
        return 100

    conn.fetchval = fetchval

    with patch("app.audit.cron.pool", return_value=_FakePool(conn)):
        result = await cron.pickup_batch()

    assert result is not None
    assert result["start_seq"] == 101
    assert result["end_seq"] == 103
    assert result["leaf_count"] == 3
    assert result["anchor_id"] == "anchor-uuid-1"
    assert len(result["merkle_root"]) == 64  # hex sha256


@pytest.mark.asyncio
async def test_submit_pending_sends_each_and_marks_confirmed():
    """submit_pending iterates pending anchors, calls send_data_tx on each,
    and updates status='confirmed' with tx_hash + block_number."""
    conn = _FakeConn({
        "pending_anchors": [
            {"id": "a1", "merkle_root": "11" * 32},
            {"id": "a2", "merkle_root": "22" * 32},
        ],
    })

    client = MagicMock()
    client.send_data_tx = AsyncMock(side_effect=[
        ("0xtx1", 1000),
        ("0xtx2", 1001),
    ])

    with patch("app.audit.cron.pool", return_value=_FakePool(conn)):
        submitted = await cron.submit_pending(client)

    assert submitted == 2
    # Both UPDATE statements should have fired
    updates = [e for e in conn.executed if "UPDATE" in e[0]]
    assert len(updates) == 2


@pytest.mark.asyncio
async def test_submit_pending_skips_failed_anchors():
    """If send_data_tx raises, the anchor row stays pending - we do NOT
    mark it confirmed and we do NOT propagate the exception. The next
    cron tick will retry."""
    conn = _FakeConn({
        "pending_anchors": [
            {"id": "a1", "merkle_root": "11" * 32},
            {"id": "a2", "merkle_root": "22" * 32},
        ],
    })

    client = MagicMock()
    client.send_data_tx = AsyncMock(side_effect=[
        RuntimeError("gas spike"),
        ("0xtx2", 1001),
    ])

    with patch("app.audit.cron.pool", return_value=_FakePool(conn)):
        submitted = await cron.submit_pending(client)

    assert submitted == 1   # only the second one succeeded
    updates = [e for e in conn.executed if "UPDATE" in e[0]]
    assert len(updates) == 1


@pytest.mark.asyncio
async def test_run_once_picks_up_and_submits():
    """run_once is the single cron tick: pickup new batch + submit
    everything currently pending."""
    conn = _FakeConn({
        ("fetchval", "SELECT"): 200,
        "audit_log_rows": [{"seq": 201, "log_hash": "d" * 64}],
        "pending_anchors": [{"id": "a99", "merkle_root": "33" * 32}],
    })
    async def fetchval(sql, *args):
        if sql.strip().startswith("INSERT INTO audit_anchors"):
            return "new-anchor"
        return 200
    conn.fetchval = fetchval

    client = MagicMock()
    client.send_data_tx = AsyncMock(return_value=("0xtxX", 2000))

    with patch("app.audit.cron.pool", return_value=_FakePool(conn)):
        result = await cron.run_once(client)

    assert result["picked_up"] is not None
    assert result["picked_up"]["anchor_id"] == "new-anchor"
    assert result["submitted_count"] == 1
