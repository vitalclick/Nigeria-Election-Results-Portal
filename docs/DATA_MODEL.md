# Data model

The schema is split into three concentric rings:

1. **Geography** - election-agnostic. Loaded once from INEC scrapes
   (`Polling-Units/` directory). Never mutated by application code.
2. **Operational** - per-election. Submissions, verified results,
   discrepancies. All scoped by `election_id`.
3. **Audit** - append-only. Hash-chained. Anchored to Ethereum.

The diagram below shows the relational structure. Every arrow is a foreign
key.

```
states ◄── lgas ◄── wards ◄── polling_units
                                   ▲
                                   │ pu_code
                                   │
elections ◄── election_candidates  │
    ▲                              │
    │ election_id                  │
    │                              │
parties ◄── agents ──┐             │
    ▲               │              │
    │ party_code    │ submitted_by │
    │               ▼              │
    └───────── ec8a_submissions ◄──┘
                    │
                    │ aggregated by verification engine
                    ▼
              verified_results
                    │
                    │ where status in (discrepancy, inec_conflict)
                    ▼
                discrepancies

(all writes shadowed in)
    audit_log ──► audit_anchors ──► Ethereum
```

## Key invariants

These are enforced by constraints, triggers, or RLS — not by application
discipline alone. Application code can be wrong; the schema cannot.

| Invariant | Enforced by |
|---|---|
| Every party agent has a party | `CHECK (role <> 'party_agent' OR party_code IS NOT NULL)` |
| One party gets one submission per PU per election | Partial unique index `uq_party_submission_per_pu` |
| `extracted_data` always has `candidate_votes` and `total_valid_votes` | `CHECK (extracted_data ? ...)` |
| `confidence_score` is in [0,1] | `CHECK (confidence_score BETWEEN 0 AND 1)` |
| Audit log cannot be updated or deleted | `REVOKE UPDATE, DELETE FROM PUBLIC` + RLS denial policies |
| Every audit_log row's hash matches the chain rule | `fn_audit_chain_link` trigger |
| Polling unit coordinates are valid WGS84 points | PostGIS `GEOGRAPHY(POINT, 4326)` column type |

## Sample queries

### National rollup for the map header

```sql
SELECT * FROM v_national_rollup WHERE election_id = '2027-presidential';
```

### All polling units in Lagos and their current status

```sql
SELECT pu_code, pu_name, status, consensus_data
FROM v_pu_live_status
WHERE state_code = 'LA' AND election_id = '2027-presidential';
```

### Verify the audit chain end-to-end

```sql
SELECT seq, event_type, prev_hash, log_hash FROM audit_log ORDER BY seq;
-- Then walk the chain in any language with hashlib.sha256
```

### Find INEC conflicts (the red state on the map)

```sql
SELECT pu_code, consensus_data, computed_at
FROM verified_results
WHERE status = 'inec_conflict'
ORDER BY computed_at DESC;
```

## Why JSONB for `extracted_data`?

EC8A has different candidate slates per election. A presidential election
has ~4 main candidates; a state-house election has ~20. Modelling each
candidate as a column requires a schema migration per election, which is
operationally hostile. JSONB with a `CHECK` constraint that the shape is
correct gives flexibility without losing validation.

The trade-off is that aggregate queries iterate the JSON, but the
materialised view `mv_state_rollup` precomputes them, so the public-facing
read path never pays that cost.
