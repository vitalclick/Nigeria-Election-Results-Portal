-- OpenBallot Nigeria - Migration 0004
-- Add `inec_published` verification status.
--
-- This state fires when the ONLY submission for a PU is from INEC IReV
-- itself. It is semantically distinct from:
--
--   * single_source - a single party agent or observer (no INEC presence)
--   * inec_confirmed - independent multi-source consensus + INEC agreement
--
-- We need it because the 2023 historical dataset is INEC-only by design:
-- the election is concluded and no party agents will retroactively submit.
-- Without this state, every 2023 PU would render as `single_source` and
-- be visually indistinguishable from a 2027 PU with only one party report.

BEGIN;

ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'inec_published';

COMMIT;
