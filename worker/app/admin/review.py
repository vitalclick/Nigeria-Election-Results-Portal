"""Consortium review queue.

A consortium reviewer can:
  * Approve a pending submission - flips review_status to
    'reviewed_accepted'. The submission becomes eligible for the
    public verified_results view.
  * Reject a pending submission - flips to 'reviewed_rejected' with a
    required reason string. The submission stays in the database (we
    never delete evidence) and is publicly visible as rejected.

Every action writes an audit_log row. Whoever reviewed what is
permanently recorded; the chain trigger hashes the event.

After any decision we recompute the verified_results for the affected
PU so the public map reflects the change without waiting for the next
worker tick.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from uuid import UUID

import asyncpg

from ..models import (
    ExtractedEC8A,
    SubmissionRecord,
    SubmissionSource,
)
from ..verification import compute_consensus


class ReviewAction(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"


@dataclass
class ReviewOutcome:
    submission_id: UUID
    new_status: str
    pu_code: str
    election_id: str
    verification_status: str


async def apply_review(
    conn: asyncpg.Connection,
    *,
    submission_id: UUID,
    action: ReviewAction,
    reviewer_id: UUID,
    reason: str | None = None,
) -> ReviewOutcome:
    """Apply approve / reject and recompute the verification status.

    Raises ValueError if:
      * the submission does not exist
      * the submission is not in 'pending_review' (no double-decisions)
      * action is REJECT without a reason
    """
    if action == ReviewAction.REJECT and not reason:
        raise ValueError("reject requires a reason")

    row = await conn.fetchrow(
        """
        SELECT id, election_id, pu_code, review_status
          FROM ec8a_submissions
         WHERE id = $1
         FOR UPDATE
        """,
        submission_id,
    )
    if row is None:
        raise ValueError("submission not found")
    if row["review_status"] != "pending_review":
        raise ValueError(
            f"submission is in status {row['review_status']}, not pending_review"
        )

    new_status = (
        "reviewed_accepted" if action == ReviewAction.APPROVE else "reviewed_rejected"
    )
    await conn.execute(
        """
        UPDATE ec8a_submissions
           SET review_status = $1,
               reviewed_by = $2,
               reviewed_at = NOW(),
               rejection_reason = $3
         WHERE id = $4
        """,
        new_status,
        reviewer_id,
        reason if action == ReviewAction.REJECT else None,
        submission_id,
    )

    await conn.execute(
        """
        INSERT INTO audit_log (event_type, entity_type, entity_id, actor_id, event_data)
        VALUES ($1, 'ec8a_submission', $2, $3, $4::jsonb)
        """,
        f"submission.{action.value}d",   # submission.approved | submission.rejected
        str(submission_id),
        reviewer_id,
        {
            "election_id": row["election_id"],
            "pu_code": row["pu_code"],
            "reason": reason,
        },
    )

    # Recompute verified_results for the affected PU.
    new_verification = await _recompute_verification(
        conn, election_id=row["election_id"], pu_code=row["pu_code"]
    )

    return ReviewOutcome(
        submission_id=submission_id,
        new_status=new_status,
        pu_code=row["pu_code"],
        election_id=row["election_id"],
        verification_status=new_verification,
    )


async def _recompute_verification(
    conn: asyncpg.Connection, *, election_id: str, pu_code: str
) -> str:
    """Pull all approved submissions for the PU, run the consensus engine,
    upsert the verified_results row, return the resulting status."""
    rows = await conn.fetch(
        """
        SELECT id, source_type, party_code, image_url, image_sha256,
               extracted_data, submitted_at, confidence_score,
               validation_flags, review_status
          FROM ec8a_submissions
         WHERE election_id = $1 AND pu_code = $2
           AND review_status IN ('auto_approved', 'reviewed_accepted')
        """,
        election_id,
        pu_code,
    )

    submissions = [
        SubmissionRecord(
            id=r["id"],
            election_id=election_id,
            pu_code=pu_code,
            source_type=SubmissionSource(r["source_type"]),
            party_code=r["party_code"],
            image_url=r["image_url"],
            image_sha256=r["image_sha256"],
            gps=None,
            submitted_at=r["submitted_at"],
            confidence_score=float(r["confidence_score"] or 0),
            extracted_data=ExtractedEC8A.model_validate_json(r["extracted_data"])
            if isinstance(r["extracted_data"], str)
            else ExtractedEC8A.model_validate(r["extracted_data"]),
            validation_flags=r["validation_flags"] or {},
            review_status=r["review_status"],
        )
        for r in rows
    ]

    outcome = compute_consensus(
        submissions, election_id=election_id, pu_code=pu_code
    )
    await conn.execute(
        """
        INSERT INTO verified_results (
          election_id, pu_code, status, consensus_data,
          submission_count, source_count, computed_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())
        ON CONFLICT (election_id, pu_code) DO UPDATE
          SET status = EXCLUDED.status,
              consensus_data = EXCLUDED.consensus_data,
              submission_count = EXCLUDED.submission_count,
              source_count = EXCLUDED.source_count,
              computed_at = EXCLUDED.computed_at
        """,
        election_id,
        pu_code,
        outcome.status.value,
        outcome.consensus_data.model_dump_json() if outcome.consensus_data else None,
        outcome.submission_count,
        outcome.source_count,
    )
    return outcome.status.value
