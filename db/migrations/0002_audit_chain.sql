-- OpenBallot Nigeria - Audit log with tamper-evident hash chain
-- Migration 0002
--
-- Every event written to audit_log is chained to the previous event's hash.
-- The chain is verifiable end-to-end:
--    H(n) = SHA256(H(n-1) || canonical_json(event_data) || event_at || event_type || entity_id)
-- Any rewrite of history breaks the chain at the point of tampering.
--
-- Append-only is enforced via revoking UPDATE/DELETE in the policy migration.

BEGIN;

CREATE TABLE audit_log (
  seq             BIGSERIAL PRIMARY KEY,
  event_type      TEXT NOT NULL,            -- e.g. submission.created, verification.computed
  entity_type     TEXT NOT NULL,            -- e.g. ec8a_submission, verified_result
  entity_id       TEXT NOT NULL,
  actor_id        UUID,                     -- nullable for system events
  event_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_data      JSONB NOT NULL,
  prev_hash       CHAR(64) NOT NULL,
  log_hash        CHAR(64) NOT NULL UNIQUE
);

CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_event  ON audit_log (event_type, event_at DESC);

-- Genesis row so the chain always has a previous hash.
INSERT INTO audit_log (event_type, entity_type, entity_id, event_data, prev_hash, log_hash)
VALUES (
  'chain.genesis',
  'system',
  'openballot',
  jsonb_build_object('message', 'OpenBallot Nigeria audit chain genesis'),
  repeat('0', 64),
  encode(
    digest(
      repeat('0', 64) ||
      'chain.genesis' ||
      'system' ||
      'openballot',
      'sha256'
    ),
    'hex'
  )
);

-- Hash-chain trigger. Computes log_hash from previous row's log_hash + this
-- row's canonical fields. Use BEFORE INSERT so the value is written atomically.
CREATE OR REPLACE FUNCTION fn_audit_chain_link() RETURNS TRIGGER AS $$
DECLARE
  v_prev CHAR(64);
BEGIN
  SELECT log_hash INTO v_prev
  FROM audit_log
  ORDER BY seq DESC
  LIMIT 1
  FOR UPDATE;

  IF v_prev IS NULL THEN
    v_prev := repeat('0', 64);
  END IF;

  NEW.prev_hash := v_prev;
  NEW.log_hash := encode(
    digest(
      v_prev ||
      NEW.event_type ||
      NEW.entity_type ||
      NEW.entity_id ||
      COALESCE(NEW.actor_id::TEXT, '') ||
      NEW.event_at::TEXT ||
      NEW.event_data::TEXT,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_chain_link
BEFORE INSERT ON audit_log
FOR EACH ROW
WHEN (NEW.event_type <> 'chain.genesis')
EXECUTE FUNCTION fn_audit_chain_link();

-- Blockchain anchor batches: every N minutes the worker batches recent
-- audit_log rows, computes a Merkle root, and writes the root to Ethereum
-- via OP_RETURN. The TX hash + block number are recorded here.
CREATE TABLE audit_anchors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_start_seq BIGINT NOT NULL REFERENCES audit_log(seq),
  batch_end_seq   BIGINT NOT NULL REFERENCES audit_log(seq),
  merkle_root     CHAR(64) NOT NULL,
  chain           TEXT NOT NULL DEFAULT 'ethereum',
  tx_hash         TEXT,
  block_number    BIGINT,
  anchored_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending'    -- pending | confirmed | failed
);
CREATE INDEX idx_anchor_status ON audit_anchors(status);

COMMIT;
