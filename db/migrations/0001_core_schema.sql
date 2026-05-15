-- OpenBallot Nigeria - Core schema
-- Migration 0001: geography, elections, agents, submissions
--
-- Conventions
--   * polling_units is the election-agnostic geo master table
--   * Every operational table is scoped by election_id
--   * Timestamps are UTC; display localisation happens at the edge
--   * JSONB columns store AI-extracted payloads; the schema enforces shape
--     via validation triggers, not by exploding fields into columns

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ────────────────────────────────────────────────────────────────────────────
-- Geography
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE states (
  code         TEXT PRIMARY KEY,           -- e.g. "LA"
  name         TEXT NOT NULL UNIQUE,
  zone         TEXT NOT NULL,              -- NW | NE | NC | SW | SE | SS | FCT
  fips         TEXT
);

CREATE TABLE lgas (
  code         TEXT PRIMARY KEY,           -- INEC LGA code
  name         TEXT NOT NULL,
  state_code   TEXT NOT NULL REFERENCES states(code),
  UNIQUE (state_code, name)
);
CREATE INDEX idx_lgas_state ON lgas(state_code);

CREATE TABLE wards (
  code         TEXT PRIMARY KEY,           -- INEC ward code
  name         TEXT NOT NULL,
  lga_code     TEXT NOT NULL REFERENCES lgas(code),
  UNIQUE (lga_code, name)
);
CREATE INDEX idx_wards_lga ON wards(lga_code);

CREATE TABLE polling_units (
  pu_code              TEXT PRIMARY KEY,    -- INEC polling unit code (e.g. "25-11-04-007")
  pu_name              TEXT NOT NULL,
  ward_code            TEXT NOT NULL REFERENCES wards(code),
  geog                 GEOGRAPHY(POINT, 4326),
  registered_voters    INTEGER CHECK (registered_voters >= 0),
  source               TEXT NOT NULL DEFAULT 'inec_scrape',
  scraped_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- denormalised geo for fast tile queries
  lga_code             TEXT NOT NULL REFERENCES lgas(code),
  state_code           TEXT NOT NULL REFERENCES states(code)
);
CREATE INDEX idx_pu_ward  ON polling_units(ward_code);
CREATE INDEX idx_pu_lga   ON polling_units(lga_code);
CREATE INDEX idx_pu_state ON polling_units(state_code);
CREATE INDEX idx_pu_geog  ON polling_units USING GIST(geog);

-- ────────────────────────────────────────────────────────────────────────────
-- Elections registry
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE election_type AS ENUM (
  'presidential', 'senate', 'reps', 'governorship', 'stha', 'fct_area', 'lga'
);

CREATE TYPE election_status AS ENUM ('upcoming', 'active', 'concluded');

CREATE TABLE elections (
  id              TEXT PRIMARY KEY,        -- e.g. "2027-presidential"
  election_type   election_type NOT NULL,
  scope           TEXT NOT NULL,           -- "national" or state/lga code
  election_date   DATE NOT NULL,
  status          election_status NOT NULL DEFAULT 'upcoming',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE election_candidates (
  election_id     TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  party_code      TEXT NOT NULL,           -- e.g. "APC", "PDP", "LP", "NNPP"
  candidate_name  TEXT NOT NULL,
  running_mate    TEXT,
  display_order   INTEGER NOT NULL,
  PRIMARY KEY (election_id, party_code)
);

-- ────────────────────────────────────────────────────────────────────────────
-- Identity: agents, observers, party admins
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE actor_role AS ENUM (
  'party_agent', 'observer', 'party_admin', 'consortium_reviewer', 'inec_liaison'
);

CREATE TABLE parties (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  inec_registered BOOLEAN NOT NULL DEFAULT TRUE,
  colour_hex      TEXT
);

CREATE TABLE agents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role              actor_role NOT NULL,
  full_name         TEXT NOT NULL,
  phone_e164        TEXT NOT NULL UNIQUE,    -- +234...
  party_code        TEXT REFERENCES parties(code),
  observer_org      TEXT,
  assigned_pu_code  TEXT REFERENCES polling_units(pu_code),
  credential_ref    TEXT,                    -- INEC observer accreditation ID
  language          TEXT NOT NULL DEFAULT 'en',
  device_fingerprint TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT party_agent_has_party
    CHECK (role <> 'party_agent' OR party_code IS NOT NULL),
  CONSTRAINT observer_has_org
    CHECK (role <> 'observer' OR observer_org IS NOT NULL)
);
CREATE INDEX idx_agents_pu    ON agents(assigned_pu_code);
CREATE INDEX idx_agents_party ON agents(party_code);

-- ────────────────────────────────────────────────────────────────────────────
-- EC8A submissions - the evidentiary core
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE submission_source AS ENUM ('party_agent', 'observer', 'inec_irev');

CREATE TYPE review_status AS ENUM (
  'auto_approved', 'pending_review', 'reviewed_accepted', 'reviewed_rejected'
);

CREATE TABLE ec8a_submissions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id          TEXT NOT NULL REFERENCES elections(id),
  pu_code              TEXT NOT NULL REFERENCES polling_units(pu_code),
  submitted_by         UUID REFERENCES agents(id),
  source_type          submission_source NOT NULL,
  party_code           TEXT REFERENCES parties(code),

  -- evidence
  image_url            TEXT NOT NULL,
  image_sha256         CHAR(64) NOT NULL,
  image_bytes          INTEGER NOT NULL CHECK (image_bytes > 0),
  exif_metadata        JSONB,
  exif_integrity_ok    BOOLEAN NOT NULL DEFAULT TRUE,

  -- capture
  gps_lat              DOUBLE PRECISION,
  gps_lng              DOUBLE PRECISION,
  gps_accuracy_metres  NUMERIC(8, 2),
  gps_distance_metres  NUMERIC(10, 2),     -- distance from registered PU coordinates
  captured_at          TIMESTAMPTZ,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- extraction output
  confidence_score     NUMERIC(4, 3) CHECK (confidence_score BETWEEN 0 AND 1),
  extracted_data       JSONB NOT NULL,     -- {candidate_votes:{}, registered_voters, accredited_voters, total_valid_votes, rejected, total_cast}
  per_field_confidence JSONB,              -- {field: confidence}
  validation_flags     JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- workflow
  review_status        review_status NOT NULL DEFAULT 'pending_review',
  reviewed_by          UUID REFERENCES agents(id),
  reviewed_at          TIMESTAMPTZ,
  rejection_reason     TEXT,

  -- audit anchor
  blockchain_tx        TEXT,
  blockchain_anchored_at TIMESTAMPTZ,

  -- soft constraint: one party-PU-election submission per party agent.
  -- Observers may submit multiple times (they cover multiple units) so this
  -- is enforced via partial unique index below, not in the primary table.
  CONSTRAINT chk_extracted_shape CHECK (
    extracted_data ? 'candidate_votes'
    AND extracted_data ? 'total_valid_votes'
  )
);

CREATE UNIQUE INDEX uq_party_submission_per_pu
  ON ec8a_submissions (election_id, pu_code, party_code)
  WHERE source_type = 'party_agent';

CREATE INDEX idx_sub_election_pu  ON ec8a_submissions (election_id, pu_code);
CREATE INDEX idx_sub_review       ON ec8a_submissions (review_status)
  WHERE review_status = 'pending_review';
CREATE INDEX idx_sub_submitted_at ON ec8a_submissions (submitted_at DESC);
CREATE INDEX idx_sub_hash         ON ec8a_submissions (image_sha256);

-- ────────────────────────────────────────────────────────────────────────────
-- Verification (consensus) and discrepancies
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE verification_status AS ENUM (
  'no_data', 'single_source', 'consensus',
  'discrepancy', 'inec_confirmed', 'inec_conflict'
);

CREATE TABLE verified_results (
  election_id        TEXT NOT NULL REFERENCES elections(id),
  pu_code            TEXT NOT NULL REFERENCES polling_units(pu_code),
  status             verification_status NOT NULL,
  consensus_data     JSONB,                  -- same shape as ec8a_submissions.extracted_data when status in (consensus, inec_confirmed)
  submission_count   INTEGER NOT NULL DEFAULT 0,
  source_count       INTEGER NOT NULL DEFAULT 0,  -- distinct submitting parties/observers
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (election_id, pu_code)
);
CREATE INDEX idx_vr_status ON verified_results (election_id, status);

CREATE TYPE escalation_status AS ENUM ('open', 'notified', 'acknowledged', 'resolved');

CREATE TABLE discrepancies (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id         TEXT NOT NULL REFERENCES elections(id),
  pu_code             TEXT NOT NULL REFERENCES polling_units(pu_code),
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conflicting_submissions UUID[] NOT NULL,
  differing_fields    TEXT[] NOT NULL,
  severity            INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  escalation_status   escalation_status NOT NULL DEFAULT 'open',
  notified_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  resolution_note     TEXT
);
CREATE INDEX idx_disc_open ON discrepancies (election_id)
  WHERE escalation_status <> 'resolved';

COMMIT;
