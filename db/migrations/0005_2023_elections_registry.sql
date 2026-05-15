-- OpenBallot Nigeria - Migration 0005
-- Register the five 2023 general election ballots.
--
-- These are the elections the IReV scraper will populate. Status is
-- `concluded` because they are historical; the platform uses them as
-- the live demo dataset and the baseline for 2027 comparisons.

BEGIN;

INSERT INTO elections (id, election_type, scope, election_date, status) VALUES
  ('2023-presidential',  'presidential',  'national', '2023-02-25', 'concluded'),
  ('2023-senate',        'senate',        'national', '2023-02-25', 'concluded'),
  ('2023-reps',          'reps',          'national', '2023-02-25', 'concluded'),
  ('2023-governorship',  'governorship',  'national', '2023-03-18', 'concluded'),
  ('2023-stha',          'stha',          'national', '2023-03-18', 'concluded')
ON CONFLICT (id) DO NOTHING;

-- 2023 presidential candidate slate (top four parties by official totals).
INSERT INTO election_candidates (election_id, party_code, candidate_name, running_mate, display_order) VALUES
  ('2023-presidential', 'APC',  'Bola Ahmed Tinubu',          'Kashim Shettima',        1),
  ('2023-presidential', 'PDP',  'Atiku Abubakar',             'Ifeanyi Okowa',          2),
  ('2023-presidential', 'LP',   'Peter Obi',                  'Yusuf Datti Baba-Ahmed', 3),
  ('2023-presidential', 'NNPP', 'Rabiu Kwankwaso',            'Isaac Idahosa',          4)
ON CONFLICT (election_id, party_code) DO NOTHING;

COMMIT;
