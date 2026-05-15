-- OpenBallot Nigeria - Migration 0010
-- Observer onboarding.
--
-- Observers are the second half of the multi-source claim. Party agents
-- are onboarded via the party-admin CSV roster; observers self-register
-- with their INEC accreditation document and a consortium reviewer
-- approves them.
--
-- A successful approval CREATES an agents row with role='observer'.
-- One observer organisation may map to many agents - an EU observer
-- mission has hundreds of deployees, each registering as their own
-- agent record but all sharing the same observer_org.

BEGIN;

CREATE TYPE observer_review_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE observer_registrations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone_e164            TEXT NOT NULL,
  observer_org          TEXT NOT NULL,
  inec_accreditation_id TEXT,
  accreditation_doc_url TEXT,         -- where the operator uploaded it (R2)
  accreditation_sha256  CHAR(64),     -- hash of the doc, for tamper checks
  states_covered        TEXT[],       -- nullable - empty = nationwide
  language              TEXT NOT NULL DEFAULT 'en',
  review_status         observer_review_status NOT NULL DEFAULT 'pending',
  reviewed_by           UUID REFERENCES agents(id),
  reviewed_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  agent_id              UUID REFERENCES agents(id),  -- set on approval
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitter_ip          TEXT,
  UNIQUE (phone_e164),
  UNIQUE (email)
);

CREATE INDEX idx_observer_pending
  ON observer_registrations (submitted_at DESC)
  WHERE review_status = 'pending';

CREATE INDEX idx_observer_org
  ON observer_registrations (observer_org);

COMMIT;
