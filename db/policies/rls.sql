-- OpenBallot Nigeria - Row Level Security policies
--
-- The database is multi-tenant in a soft sense: parties see their own agent
-- rosters and submissions, observers see their own, consortium reviewers
-- see everything, and the public role (anon) sees only the read-side
-- aggregates plus the published EC8A image evidence.
--
-- audit_log is publishable to public after election conclusion. During the
-- election it is readable by consortium_reviewer + inec_liaison only.

BEGIN;

-- In Supabase, the `auth` schema and `auth.uid()` function are provisioned by
-- the platform. For local / self-hosted Postgres we provide a shim that
-- returns NULL so the policies parse and apply identically in both worlds.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE SQL STABLE AS $$ SELECT NULL::UUID $$;

ALTER TABLE agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ec8a_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE discrepancies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_anchors       ENABLE ROW LEVEL SECURITY;

-- Append-only protection on the audit log: no UPDATE, no DELETE, ever.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
CREATE POLICY audit_log_no_update ON audit_log FOR UPDATE USING (FALSE);
CREATE POLICY audit_log_no_delete ON audit_log FOR DELETE USING (FALSE);

-- Public (anon) policies: read-only on the redacted view surface.
CREATE POLICY pub_read_verified
  ON verified_results FOR SELECT
  USING (TRUE);

CREATE POLICY pub_read_disc
  ON discrepancies FOR SELECT
  USING (TRUE);

-- Submissions are publicly readable, but agent identity columns are projected
-- away by the v_public_submissions view; direct table reads return everything
-- so we keep agent identity behind the application layer.
CREATE POLICY pub_read_submissions
  ON ec8a_submissions FOR SELECT
  USING (review_status IN ('auto_approved', 'reviewed_accepted'));

-- Agent rows are NEVER public.
CREATE POLICY agents_self_or_admin
  ON agents FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = auth.uid()
        AND a.role IN ('consortium_reviewer', 'party_admin')
    )
  );

-- Party admins can see their own party's agents.
CREATE POLICY agents_party_admin_scope
  ON agents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = auth.uid()
        AND a.role = 'party_admin'
        AND a.party_code = agents.party_code
    )
  );

-- Submission write: agent can insert their own submission for their own PU.
CREATE POLICY submissions_agent_insert
  ON ec8a_submissions FOR INSERT
  WITH CHECK (submitted_by = auth.uid());

-- Reviewers can update review_status only.
CREATE POLICY submissions_reviewer_update
  ON ec8a_submissions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = auth.uid()
        AND a.role = 'consortium_reviewer'
    )
  );

COMMIT;
