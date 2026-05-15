-- OpenBallot Nigeria - Read-side aggregates for the public map and API
-- Migration 0003
--
-- These views power the public dashboard. They are materialised where the
-- query is expensive (state/national rollups) and regular where read traffic
-- is bounded by indexes (PU detail).

BEGIN;

-- Per-polling-unit live status feed for the realtime map.
CREATE OR REPLACE VIEW v_pu_live_status AS
SELECT
  pu.pu_code,
  pu.pu_name,
  pu.ward_code,
  pu.lga_code,
  pu.state_code,
  ST_Y(pu.geog::geometry) AS lat,
  ST_X(pu.geog::geometry) AS lng,
  COALESCE(vr.status, 'no_data'::verification_status) AS status,
  vr.consensus_data,
  vr.submission_count,
  vr.source_count,
  vr.computed_at,
  vr.election_id
FROM polling_units pu
LEFT JOIN verified_results vr ON vr.pu_code = pu.pu_code;

-- State-level rollup (materialised, refreshed by the worker on a fixed cadence).
CREATE MATERIALIZED VIEW mv_state_rollup AS
SELECT
  vr.election_id,
  pu.state_code,
  s.name AS state_name,
  COUNT(*) FILTER (WHERE vr.status <> 'no_data')                  AS units_reporting,
  COUNT(*)                                                         AS units_total,
  COUNT(*) FILTER (WHERE vr.status = 'consensus')                 AS units_consensus,
  COUNT(*) FILTER (WHERE vr.status = 'discrepancy')               AS units_discrepancy,
  COUNT(*) FILTER (WHERE vr.status = 'inec_confirmed')            AS units_inec_confirmed,
  COUNT(*) FILTER (WHERE vr.status = 'inec_conflict')             AS units_inec_conflict,
  -- party totals derived from consensus_data.candidate_votes
  jsonb_object_agg(
    party_votes.party_code,
    party_votes.total
  ) FILTER (WHERE party_votes.party_code IS NOT NULL) AS party_totals
FROM polling_units pu
LEFT JOIN verified_results vr ON vr.pu_code = pu.pu_code
JOIN states s ON s.code = pu.state_code
LEFT JOIN LATERAL (
  SELECT
    kv.key AS party_code,
    (kv.value)::INTEGER AS total
  FROM jsonb_each_text(COALESCE(vr.consensus_data -> 'candidate_votes', '{}'::jsonb)) kv
  WHERE vr.status IN ('consensus', 'inec_confirmed')
) party_votes ON TRUE
GROUP BY vr.election_id, pu.state_code, s.name;

CREATE UNIQUE INDEX uq_mv_state_rollup ON mv_state_rollup (election_id, state_code);

-- National rollup (small; can be a view).
CREATE OR REPLACE VIEW v_national_rollup AS
SELECT
  election_id,
  SUM(units_reporting)        AS units_reporting,
  SUM(units_total)            AS units_total,
  SUM(units_consensus)        AS units_consensus,
  SUM(units_discrepancy)      AS units_discrepancy,
  SUM(units_inec_confirmed)   AS units_inec_confirmed,
  SUM(units_inec_conflict)    AS units_inec_conflict
FROM mv_state_rollup
GROUP BY election_id;

-- Discrepancy register surface for the public page.
CREATE OR REPLACE VIEW v_discrepancy_register AS
SELECT
  d.id,
  d.election_id,
  d.pu_code,
  pu.pu_name,
  pu.ward_code,
  pu.lga_code,
  pu.state_code,
  d.detected_at,
  d.differing_fields,
  d.severity,
  d.escalation_status,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'submission_id', s.id,
      'source', s.source_type,
      'party', s.party_code,
      'image_url', s.image_url,
      'image_sha256', s.image_sha256,
      'extracted', s.extracted_data,
      'submitted_at', s.submitted_at,
      'confidence', s.confidence_score
    ))
    FROM ec8a_submissions s
    WHERE s.id = ANY (d.conflicting_submissions)
  ) AS submissions
FROM discrepancies d
JOIN polling_units pu ON pu.pu_code = d.pu_code;

COMMIT;
