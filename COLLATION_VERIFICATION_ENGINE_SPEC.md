# OpenBallot Nigeria
# Collation Verification Engine — Full Technical Specification
# Version 1.0 | April 2026

---

## Preamble: The Problem This Solves

In the 2023 Nigerian Presidential Election, the BBC counted EC8A forms for all
6,866 polling units in Rivers State and compared them to the official state
declaration. The official result for one candidate showed 80,239 votes.
The EC8A forms showed 17,293. A difference of 62,946 votes — fabricated at
the state collation level, in a single state, in a single election.

This was not discovered by INEC. It was not discovered by party legal teams in
time to matter. It was discovered by journalists doing manual arithmetic on
publicly available scanned documents — weeks after the declaration.

OpenBallot automates this arithmetic. In real time. For every ward, every LGA,
every state, every election. Before the returning officer picks up the
microphone.

This specification defines exactly how.

---

## 1. The Nigerian Collation Chain — Full Structure

### 1.1 The Five Forms and Their Legal Function

```
FORM     LEVEL              SIGNED BY                    DECLARES
─────────────────────────────────────────────────────────────────────────────
EC8A     Polling Unit       Presiding Officer +          PU result (votes per
                            all party agents present     candidate)

EC8B     Ward Collation     Ward Collation Officer +     Ward total (sum of
                            party agents at ward         all PU EC8As in ward)

EC8C     LGA Collation      LGA Collation Officer +      LGA total (sum of all
                            party agents at LGA          ward EC8Bs in LGA)

EC8D     State Collation    State Returning Officer +    State total (sum of
                            party agents at state        all LGA EC8Cs in state)

EC8E     INEC HQ /          Chief Returning Officer      Final declaration +
         Federal Level      (INEC Chairman for Pres.)    winner returned
─────────────────────────────────────────────────────────────────────────────
```

### 1.2 Form Variants by Election Type

INEC uses suffixed variants for different election types on the same forms.
The platform must handle all variants:

```
EC8A       → Polling Unit result (all election types)
EC8B(I)    → Ward collation for House of Reps / Senate / Governorship / STHA
EC8B(II)   → Ward collation for Presidential
EC8C(I)    → LGA collation for House of Reps / Senate / Governorship / STHA
EC8C(II)   → LGA collation for Presidential
EC8D(A)    → State collation for Governorship
EC8D(I)    → State collation for Senate / House of Reps
EC8D(II)   → State collation for Presidential
EC8E(I)    → Final declaration for Senate / House of Reps / Governorship
EC8E(II)   → Final declaration for Presidential
```

The OCR classifier must identify the exact variant before extraction.
Different variants have different column structures and candidate ordering.

### 1.3 The Collation Hierarchy Per Election Type

```
PRESIDENTIAL ELECTION:
  176,846 EC8A (Polling Units)
  → 8,809 EC8B(II) (Wards)
  → 774 EC8C(II) (LGAs + FCT)
  → 36 EC8D(II) (States + FCT)
  → 1 EC8E(II) (National Declaration)

GOVERNORSHIP ELECTION (per state):
  ~4,000–7,000 EC8A (varies by state)
  → ~300–500 EC8B(I) (Wards)
  → ~20–44 EC8C(I) (LGAs)
  → 1 EC8D(A) (State)
  → 1 EC8E(I) (Declaration)

SENATE ELECTION (per senatorial district):
  ~5,000–8,000 EC8A
  → Ward EC8Bs
  → LGA EC8Cs
  → 1 EC8D(I)
  → 1 EC8E(I)

HOUSE OF REPS (per federal constituency):
  ~500–1,500 EC8A
  → Ward EC8Bs
  → 1 EC8C(I) (if multi-LGA) or direct to EC8E
  → 1 EC8E(I)

STATE HOUSE OF ASSEMBLY (per constituency):
  ~100–400 EC8A
  → Ward EC8Bs
  → 1 EC8C(I) or direct to EC8E
  → 1 EC8E(I)

NOTE: On a General Election day, the same polling unit runs FIVE concurrent
elections. Five separate EC8A forms are produced at each PU. Five separate
collation chains run simultaneously upward.
```

---

## 2. Collation Agent System

### 2.1 Agent Roles Across Levels

Each political party is legally entitled to appoint agents at every level of
collation. OpenBallot models this exactly:

```
LEVEL          INEC ROLE               OPENBALLOT AGENT TYPE
──────────────────────────────────────────────────────────────
Polling Unit   Presiding Officer       polling_unit_agent
Ward           Ward Collation Officer  ward_agent
LGA            LGA Collation Officer   lga_agent
State          State Returning Officer state_agent
National/HQ    Chief Returning Officer national_agent (Pres. only)
```

### 2.2 Agent Assignment Rules

- A `polling_unit_agent` is assigned to exactly ONE polling unit.
- A `ward_agent` is assigned to exactly ONE ward collation centre.
- An `lga_agent` is assigned to exactly ONE LGA collation centre.
- A `state_agent` is assigned to exactly ONE state collation centre.
- A `national_agent` covers the Presidential national collation at INEC HQ.
- A single person CANNOT hold assignments at two different levels for the
  same election (prevents one compromised person submitting at multiple levels
  to create false consensus).
- Election observers are NOT level-locked — they may submit at any level they
  are physically present at. Observer submissions are labelled separately.

### 2.3 Agent Credential Structure

```sql
agents (
  id                  UUID PRIMARY KEY,
  phone_number        TEXT UNIQUE,           -- OTP delivery channel
  full_name           TEXT,                  -- internal only, never public
  party_code          TEXT,                  -- INEC-registered party code
  source_type         TEXT,                  -- party_agent | observer
  observer_org        TEXT NULL,             -- if observer: their accreditor
  observer_credential TEXT NULL,             -- INEC observer accreditation ID

  -- Level assignments (only one level populated per election per agent)
  assigned_election_id      TEXT,
  assigned_level            TEXT,            -- pu | ward | lga | state | national
  assigned_unit_code        TEXT,            -- the PU/ward/LGA/state code

  -- Security
  device_fingerprint    TEXT,               -- bound on first login
  is_active             BOOLEAN DEFAULT true,
  onboarded_at          TIMESTAMPTZ,
  last_seen_at          TIMESTAMPTZ
)
```

---

## 3. The Upload Flow — All Levels

### 3.1 Universal Upload Rules (Apply to All Levels)

1. Agent authenticates via phone OTP.
2. App confirms agent's assigned level and unit (read-only, cannot be changed
   by agent).
3. Agent opens camera — app captures GPS, timestamp, and device ID at the
   moment the shutter is pressed.
4. If offline: submission is queued locally and synced when signal returns.
   The GPS and timestamp captured at photo time are immutable — they cannot
   be updated post-capture even if the upload is delayed.
5. All submissions at all levels are SHA-256 hashed on ingestion.
6. All submissions pass through the Ingestion Validation layer before any
   data is written to the results tables.

### 3.2 EC8A Upload Flow (Polling Unit)

This is the foundation. Every other level depends on it.

```
TIMING: Immediately after announcement at polling unit.
        Polls close → votes counted → EC8A signed → agent photographs →
        uploads (or queues). Target: within 30 minutes of announcement.

GEOFENCE: Agent GPS must be within 200m of registered PU coordinates.
          Outside 200m → flagged "location unverified", submission still
          accepted but publicly labelled.

FORM CONTAINS:
  - Polling Unit Code and Name
  - Registration Area / Ward
  - LGA and State
  - Total Registered Voters
  - Total Accredited Voters
  - Votes per candidate (rows, handwritten)
  - Total Valid Votes
  - Rejected Ballots
  - Total Votes Cast
  - Presiding Officer name + signature
  - Party Agent names + signatures (one row per party agent present)
  - Official INEC stamp
  - Date and time of announcement

VALIDATION CHECKS:
  □ Arithmetic: sum(candidate votes) == Total Valid Votes
  □ Arithmetic: Total Valid + Rejected == Total Votes Cast
  □ Sanity: Total Votes Cast <= Total Accredited Voters
  □ Sanity: Total Accredited <= Total Registered Voters
  □ Presence: Presiding Officer signature detected
  □ Presence: At least one party agent signature detected
  □ Presence: Official stamp detected
  □ Geo: GPS within 200m of PU registered coordinates
  □ Duplicate: No prior EC8A from this party for this PU this election
```

### 3.3 EC8B Upload Flow (Ward Collation)

```
TIMING: After Ward Collation Officer announces ward totals and signs EC8B.
        This happens at the Ward Collation Centre, typically 2–6 hours
        after polls close.

AGENT: ward_agent assigned to this ward. May be same person as a PU agent
       from this ward — but the system treats this as a separate submission
       event at a separate level.

GEOFENCE: GPS must be within 500m of the ward collation centre's registered
          coordinates. Ward collation centres are known locations (typically
          INEC-designated schools, government buildings). These are preloaded
          from INEC's ward collation centre register.

FORM CONTAINS:
  - Ward Code and Name
  - LGA and State
  - Election Type
  - For each Polling Unit in the ward:
      * PU Code
      * PU Name
      * Votes per candidate
      * Total Valid Votes
      * Rejected Ballots
  - Ward Total per candidate
  - Ward Grand Total
  - Ward Collation Officer name + signature
  - Party Agent names + signatures
  - Official stamp
  - Date and time

CRITICAL CROSS-CHECK (runs immediately on EC8B receipt):
  For each PU row on EC8B:
    IF that PU already has verified EC8A submissions:
      Compare EC8B row figures against EC8A consensus figures.
      Any mismatch on any PU row → COLLATION_DISCREPANCY flagged
      at the specific PU row level.

  Ward total on EC8B vs. OpenBallot computed ward total from EC8As:
    IF mismatch → WARD_TOTAL_DISCREPANCY
```

### 3.4 EC8C Upload Flow (LGA Collation)

```
TIMING: After LGA Collation Officer announces LGA totals and signs EC8C.
        Typically 6–24 hours after polls close.

GEOFENCE: GPS within 500m of LGA collation centre registered coordinates.

FORM CONTAINS:
  - LGA Code and Name
  - State
  - Election Type
  - For each Ward in the LGA:
      * Ward Code and Name
      * Ward total per candidate
      * Ward grand total
  - LGA Total per candidate
  - LGA Grand Total
  - LGA Collation Officer name + signature
  - Party Agent names + signatures
  - Official stamp
  - Date and time

CRITICAL CROSS-CHECK (runs immediately on EC8C receipt):
  For each Ward row on EC8C:
    IF that ward already has verified EC8B submissions:
      Compare EC8C ward row figures against EC8B consensus figures.
      Mismatch → COLLATION_DISCREPANCY at ward row level.

  LGA total on EC8C vs. OpenBallot computed LGA total from EC8Bs:
    IF mismatch → LGA_TOTAL_DISCREPANCY

  LGA total on EC8C vs. OpenBallot computed LGA total directly from EC8As:
    (This catches cases where EC8B was fabricated AND EC8C repeats the lie)
    IF mismatch → LGA_TOTAL_DISCREPANCY_FROM_SOURCE
```

### 3.5 EC8D Upload Flow (State Collation)

```
TIMING: After State Returning Officer announces state totals and signs EC8D.
        Typically 24–72 hours after polls close.

GEOFENCE: GPS within 1,000m of state collation centre registered coordinates.
          (State collation centres are larger venues; GPS accuracy varies.)

FORM CONTAINS:
  - State Name
  - Election Type
  - For each LGA in the State:
      * LGA Code and Name
      * LGA total per candidate
      * LGA grand total
  - State Total per candidate
  - State Grand Total
  - State Returning Officer name + signature
  - Party Agent names + signatures
  - Official stamp
  - Date and time

CRITICAL CROSS-CHECK:
  For each LGA row on EC8D:
    Compare against EC8C consensus → COLLATION_DISCREPANCY if mismatch.

  State total on EC8D vs. sum of EC8C consensuses → STATE_TOTAL_DISCREPANCY
  State total on EC8D vs. sum directly from EC8As → STATE_TOTAL_DISCREPANCY_FROM_SOURCE
```

### 3.6 EC8E Upload Flow (Final Declaration)

```
TIMING: After Chief Returning Officer makes final declaration.

NOTE: EC8E is the declaration form, not a collation form. It contains the
      declared winner and their total, not row-by-row breakdowns. It is the
      legal instrument of the result.

FORM CONTAINS:
  - Election Type and Office
  - Declared winner's name and party
  - Total valid votes cast (national/state)
  - Winner's votes
  - Runner-up(s) votes
  - Chief Returning Officer name + signature
  - Date, time, and location of declaration

CROSS-CHECK:
  Declared total vs. OpenBallot computed total from all verified EC8As.
  Declared winner's votes vs. OpenBallot computed winner votes from EC8As.
  Any mismatch → DECLARATION_DISCREPANCY — the highest severity flag.
```

---

## 4. The Shadow Collation Engine

### 4.1 Core Concept

The Shadow Collation Engine (SCE) is a continuous computation process that
runs in parallel with the official INEC collation. It builds election totals
from the ground up, using only verified EC8A data as its foundation. It never
trusts a number it hasn't computed itself from source documents.

```
                     SCE COMPUTATION DIRECTION
                     ─────────────────────────→  (bottom-up only)

EC8A (176,846 forms) → SCE Ward Totals
                     → SCE LGA Totals
                     → SCE State Totals
                     → SCE National Total

INEC COLLATION DIRECTION
────────────────────────→  (top-down declaration)

EC8B → EC8C → EC8D → EC8E

COMPARISON LAYER: At every level, SCE total vs. INEC declared total.
                  Discrepancy at any level = fraud signal at that level.
```

### 4.2 Coverage Calculation

The SCE works in real time as EC8A forms arrive. Not all forms arrive at once —
this needs to be handled gracefully.

For every geographic unit (ward, LGA, state, national), the SCE tracks:

```
coverage_pct        = ec8a_received / ec8a_expected * 100
verified_pct        = ec8a_consensus / ec8a_received * 100
sce_total           = sum of consensus figures from verified EC8As
sce_total_single    = sum including single-source (unverified) EC8As
sce_confidence      = coverage_pct * verified_pct / 100
```

An SCE total is only displayed as a "computed total" when `coverage_pct >= 50%`
for that unit. Below 50% it is shown as a "partial projection" with the
coverage percentage clearly stated. At 100% coverage it is "complete".

### 4.3 SCE Computation Algorithm

```python
def compute_sce_total(unit_code: str, unit_level: str,
                       election_id: str, candidate_id: str) -> SCEResult:
    """
    Recursively computes SCE total for any geographic unit.
    Always traces back to EC8A as the authoritative source.
    """

    if unit_level == 'ward':
        # Get all PUs in this ward
        pus = get_polling_units_for_ward(unit_code)
        total = 0
        verified_count = 0
        for pu in pus:
            consensus = get_ec8a_consensus(pu.code, election_id, candidate_id)
            if consensus.status in ('consensus', 'single_source', 'inec_confirmed'):
                total += consensus.votes
                if consensus.status != 'single_source':
                    verified_count += 1
        return SCEResult(total, len(pus), verified_count)

    elif unit_level == 'lga':
        wards = get_wards_for_lga(unit_code)
        # Sum the ward-level SCE totals
        return sum_sce_results([
            compute_sce_total(w.code, 'ward', election_id, candidate_id)
            for w in wards
        ])

    elif unit_level == 'state':
        lgas = get_lgas_for_state(unit_code)
        return sum_sce_results([
            compute_sce_total(l.code, 'lga', election_id, candidate_id)
            for l in lgas
        ])

    elif unit_level == 'national':
        states = get_all_states()
        return sum_sce_results([
            compute_sce_total(s.code, 'state', election_id, candidate_id)
            for s in states
        ])
```

This function is called:
- On every new EC8A consensus update (triggers recomputation up the chain)
- On every new INEC collation form upload (triggers comparison)
- On every public API request for a computed total

### 4.4 Memoisation and Caching

Recomputing national totals from 176,846 EC8A forms on every update would
be catastrophically slow. The SCE uses incremental delta computation:

```
On new EC8A consensus for PU X in Ward Y, LGA Z, State W:
  1. Recompute Ward Y total (affects ~20 PU rows — fast)
  2. Update LGA Z total = (old LGA Z total) - (old Ward Y total) + (new Ward Y total)
  3. Update State W total = (old State W total) - (old LGA Z total) + (new LGA Z total)
  4. Update National total = (old National total) - (old State W total) + (new State W total)
  5. Trigger comparison checks at each level

Total recomputation cost per EC8A update: O(log N) not O(N).
SCE totals are cached in Redis with TTL=30s.
Cache is invalidated on any new submission for that geographic unit.
```

---

## 5. The Divergence Detection System

### 5.1 Divergence Types

The system detects six distinct types of divergence, each with different
implications:

```
CODE                          DESCRIPTION
────────────────────────────────────────────────────────────────────────────
PU_ROW_ALTERED                A PU's figures on an EC8B (or higher form) differ
                              from the verified EC8A for that PU. The most
                              precise fraud signal — identifies the exact PU
                              whose figures were changed during ward collation.

WARD_TOTAL_FABRICATED         Ward total on EC8B cannot be derived from any
                              combination of its constituent EC8A forms, even
                              with incomplete EC8A coverage. Numerically
                              impossible — implies figures were invented.

LGA_TOTAL_FABRICATED          Same as above at LGA level (EC8C vs EC8Bs/EC8As).

STATE_TOTAL_FABRICATED        Same at state level (EC8D vs EC8Cs/EC8As).

DECLARATION_CONFLICT          EC8E declared total conflicts with SCE total
                              computed from EC8As. The highest severity flag.

INTERNAL_ARITHMETIC_ERROR     A collation form's own arithmetic is wrong
                              (sum of rows != stated total). May be genuine
                              error or may indicate tampering. Flagged
                              separately as it could be incompetence, not fraud.
────────────────────────────────────────────────────────────────────────────
```

### 5.2 The Fraud Localisation Algorithm

This is the engine's most powerful capability: pinpointing exactly which level
of the collation chain introduced a discrepancy.

```
Given a discrepancy between EC8E declared total and SCE national total:

STEP 1 — State Isolation:
  For each state:
    Compare EC8D[state] vs SCE[state]
    States where they match → rigging did NOT occur in that state
    States where they differ → rigging occurred IN or BELOW this state

STEP 2 — LGA Isolation (within flagged states):
  For each LGA in flagged state:
    Compare EC8C[lga] vs SCE[lga]
    LGAs where they match → rigging did NOT occur in that LGA
    LGAs where they differ → rigging occurred IN or BELOW this LGA

STEP 3 — Ward Isolation (within flagged LGAs):
  For each ward in flagged LGA:
    Compare EC8B[ward] vs SCE[ward]
    Wards where they match → clean
    Wards where they differ → rigging occurred at or below ward level

STEP 4 — PU Row Isolation (within flagged wards):
  For each PU row on the EC8B:
    Compare EC8B[pu_row] vs EC8A consensus[pu]
    PUs where they differ → SPECIFIC PU ROWS THAT WERE ALTERED, NAMED
```

The output of this algorithm is not "there are discrepancies" — it is:

> "Figures for 3 candidates were altered at Surulere Ward 4 collation centre.
> The following 7 polling units had their figures changed on the EC8B:
> [PU codes]. The EC8A forms for these units are publicly available.
> The EC8B form submitted by APC's ward agent is publicly available.
> The arithmetic difference is [X] votes for [candidate]."

This is what no court has ever had before a tribunal. OpenBallot produces it
automatically, publicly, before the declaration is even finalised.

### 5.3 Confidence Thresholds for Divergence Alerts

Not every computed divergence is displayed as a fraud signal — EC8A coverage
may be incomplete. The system applies confidence thresholds:

```
EC8A Coverage    Divergence Treatment
─────────────────────────────────────────────────────────────
< 30%            No divergence alert. Show as "Insufficient
                 data for comparison."
30–49%           Show as "Early indication — [X]% of PUs
                 reporting." Orange flag. Not escalated yet.
50–74%           Show as "Significant divergence detected —
                 [X]% of PUs reporting." Red flag. Automated
                 notification to parties and observer bodies.
75–89%           Show as "Strong divergence signal — [X]%
                 of PUs reporting." Red flag. Agency escalation
                 triggered.
90–100%          Show as "Verified divergence — [X]% of PUs
                 reporting." Red flag with fraud localisation
                 output. Maximum escalation.
```

### 5.4 The "Rivers State Test"

The BBC manually counted EC8A forms for 6,866 PUs in Rivers State and found
a 62,946 vote discrepancy against the declared total. Using the SCE:

- At 83% EC8A coverage (the approximate level the BBC achieved):
  → The system would have shown a "Strong divergence signal" within hours
    of the state collation announcement
  → The Fraud Localisation Algorithm would have isolated the discrepancy
    to specific LGAs, then specific wards
  → The specific EC8B forms showing altered PU rows would have been
    publicly visible alongside the original EC8A forms
  → This would have been visible at approximately 6pm on election day,
    not discovered by journalists six weeks later

This is the standard the system is designed to meet.

---

## 6. Real-Time Display Architecture

### 6.1 The Collation Chain View (New UI Component)

Each election on OpenBallot has a dedicated Collation Chain View — a visual
representation of the entire result chain from EC8A upward.

```
NATIONAL CHAIN VIEW (Presidential)

Candidate A                          Candidate B
──────────────────────────────────────────────────

EC8A FOUNDATION (176,846 PUs)
  SCE Computed:  12,847,293 ████████░░░░░░░░ 41.2%
  Coverage:      71.4% of PUs reporting

                      ↑ COMPARED ↑

EC8D DECLARED (36 states)
  INEC Official: [awaiting]
  Match Status:  ◐ Partial — 28 of 36 states declared

  State breakdown:
  Lagos:    SCE: 1,204,847  |  INEC: 1,204,847  ✅ Match
  Rivers:   SCE:   847,293  |  INEC: 1,204,000  ⚠ DIVERGENCE +356,707
  Kano:     SCE:   923,104  |  INEC: [awaiting]  ⬜ Pending
  [...]

DIVERGENCE ALERTS (2 active)
  🔴 Rivers State: +356,707 vote discrepancy detected
      Fraud Localisation: Running... 71% complete
      Isolated to: Obio/Akpor LGA, Okrika LGA
  🟠 Anambra State: +12,400 early indication (43% coverage)
```

### 6.2 The Polling Unit Permanent Page

Every polling unit has a permanent URL:
```
https://openballot.ng/pu/{pu_code}
Example: https://openballot.ng/pu/25-11-04-007
```

This page shows:
- Full PU metadata (ward, LGA, state, GPS coordinates, registered voters)
- For EVERY election ever conducted at this PU:
  * All EC8A submissions (party + observer + INEC)
  * The consensus result (or discrepancy status)
  * The extracted figures with confidence scores
  * The SHA-256 hash of each form
  * The blockchain transaction ID anchoring the hash
  * Whether the figures were faithfully carried through EC8B → EC8C → EC8D → EC8E
    or altered at any collation level
- "Verify this form" tool — paste any SHA-256 hash to confirm it matches
  what OpenBallot has stored

This page is permanent. It exists between elections. It is the electoral
record for that specific square of Nigerian geography, forever.

### 6.3 The Discrepancy Page

The public Discrepancy Register is a first-class page, not a hidden feature:
```
https://openballot.ng/discrepancies
```

Layout:
```
ACTIVE DISCREPANCIES — 2027 Presidential Election
Last updated: 14 seconds ago

┌─────────────────────────────────────────────────────────────────┐
│ 🔴 DECLARATION CONFLICT — Rivers State                           │
│ Severity: CRITICAL  |  Detected: 11:47 PM  |  Status: ESCALATED │
│                                                                  │
│ SCE Computed (94% coverage): Candidate B — 847,293              │
│ INEC EC8D Declared:          Candidate B — 1,204,000            │
│ Unexplained difference:      +356,707 votes                     │
│                                                                  │
│ Fraud Localised To: Obio/Akpor LGA, Okrika LGA                  │
│ [View Evidence] [View EC8D Form] [View Computation] [Share]     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 🟠 WARD TOTAL FABRICATED — Surulere Ward 4, Lagos               │
│ Severity: HIGH  |  Detected: 6:23 PM  |  Status: NOTIFIED       │
│ ...                                                              │
└─────────────────────────────────────────────────────────────────┘
```

Each discrepancy card links to a full evidence page showing:
- The specific forms involved (images, side by side)
- The specific rows/figures that differ
- The mathematical proof of the discrepancy
- The timeline of when each submission arrived
- The escalation history

---

## 7. Data Model — Full Schema

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- GEOGRAPHIC HIERARCHY (election-agnostic master tables)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE states (
  code              TEXT PRIMARY KEY,   -- e.g. "LA" (Lagos)
  name              TEXT NOT NULL,
  geog              GEOGRAPHY(POLYGON)
);

CREATE TABLE lgas (
  code              TEXT PRIMARY KEY,   -- e.g. "LA-SUR" (Lagos Surulere)
  name              TEXT NOT NULL,
  state_code        TEXT REFERENCES states,
  geog              GEOGRAPHY(POLYGON),
  collation_centre_name  TEXT,
  collation_centre_geog  GEOGRAPHY(POINT)
);

CREATE TABLE wards (
  code              TEXT PRIMARY KEY,   -- e.g. "LA-SUR-04"
  name              TEXT NOT NULL,
  lga_code          TEXT REFERENCES lgas,
  state_code        TEXT REFERENCES states,
  geog              GEOGRAPHY(POLYGON),
  collation_centre_name  TEXT,
  collation_centre_geog  GEOGRAPHY(POINT)
);

CREATE TABLE polling_units (
  code              TEXT PRIMARY KEY,   -- e.g. "25/11/04/007" (INEC format)
  name              TEXT NOT NULL,
  ward_code         TEXT REFERENCES wards,
  lga_code          TEXT REFERENCES lgas,
  state_code        TEXT REFERENCES states,
  geog              GEOGRAPHY(POINT),   -- PostGIS
  registered_voters JSONB,              -- {"2023": 412, "2027": 438}
  is_active         BOOLEAN DEFAULT true
);

-- ─────────────────────────────────────────────────────────────────────────
-- ELECTIONS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE elections (
  id                TEXT PRIMARY KEY,   -- e.g. "2027-pres"
  election_type     TEXT NOT NULL,      -- presidential|senate|reps|gov|stha|lga
  election_date     DATE NOT NULL,
  ballot_scope      TEXT,               -- national | {state_code} | {senatorial_district} | {constituency}
  status            TEXT DEFAULT 'upcoming', -- upcoming|active|collating|concluded
  collation_levels  TEXT[],             -- which EC8X forms are expected
                                        -- e.g. ['ec8a','ec8b','ec8c','ec8d','ec8e']
  candidates        JSONB               -- [{id, name, party_code, party_name}]
);

-- ─────────────────────────────────────────────────────────────────────────
-- SUBMISSIONS (one table, level discriminated by form_type)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE form_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id       TEXT REFERENCES elections,
  form_type         TEXT NOT NULL,      -- ec8a|ec8b|ec8c|ec8d|ec8e
  form_variant      TEXT,               -- ec8b_i|ec8b_ii|ec8d_a etc.

  -- Geographic scope of this form
  unit_code         TEXT NOT NULL,      -- PU code (ec8a), ward code (ec8b), etc.
  unit_level        TEXT NOT NULL,      -- pu|ward|lga|state|national

  -- Submitter
  agent_id          UUID REFERENCES agents,
  party_code        TEXT,
  source_type       TEXT,               -- party_agent|observer|inec_irev

  -- Document
  image_url         TEXT NOT NULL,
  image_sha256      TEXT NOT NULL,
  blockchain_tx     TEXT,               -- Ethereum TX hash (set after anchoring)

  -- Capture metadata
  gps_lat           DOUBLE PRECISION,
  gps_lng           DOUBLE PRECISION,
  gps_distance_m    INTEGER,            -- distance from registered location
  captured_at       TIMESTAMPTZ NOT NULL, -- timestamp at photo capture
  uploaded_at       TIMESTAMPTZ NOT NULL, -- timestamp at server receipt

  -- Extraction
  extracted_data    JSONB,              -- {candidate_votes:{}, totals:{}, signatures:{}}
  confidence_score  DECIMAL(4,3),
  ocr_model_used    TEXT,               -- google_document_ai|gpt4o|human_review
  review_status     TEXT DEFAULT 'pending', -- pending|auto_approved|human_reviewed|rejected

  -- Validation flags (JSON array of flag objects)
  validation_flags  JSONB DEFAULT '[]',

  -- Status
  is_active         BOOLEAN DEFAULT true  -- false = superseded or rejected
);

-- Index for common queries
CREATE INDEX idx_submissions_election_unit
  ON form_submissions(election_id, unit_code, form_type);

CREATE INDEX idx_submissions_election_type_level
  ON form_submissions(election_id, form_type, unit_level);

-- ─────────────────────────────────────────────────────────────────────────
-- CONSENSUS LAYER (computed, not manually entered)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE ec8a_consensus (
  election_id         TEXT,
  pu_code             TEXT REFERENCES polling_units,
  PRIMARY KEY (election_id, pu_code),

  verification_status TEXT,
  -- no_data | single_source | consensus | discrepancy |
  -- inec_confirmed | inec_conflict

  consensus_votes     JSONB,            -- {candidate_id: votes}
  total_valid_votes   INTEGER,
  total_votes_cast    INTEGER,
  rejected_ballots    INTEGER,
  accredited_voters   INTEGER,

  submission_count    INTEGER DEFAULT 0,
  sources             TEXT[],           -- party codes that submitted
  last_updated        TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────
-- SHADOW COLLATION ENGINE — computed totals at every level
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE sce_totals (
  election_id       TEXT,
  unit_code         TEXT,
  unit_level        TEXT,               -- ward|lga|state|national
  PRIMARY KEY (election_id, unit_code, unit_level),

  -- Coverage
  units_expected    INTEGER,            -- total PUs / wards / LGAs in this unit
  units_with_ec8a   INTEGER,            -- units with at least one EC8A submission
  units_consensus   INTEGER,            -- units with confirmed consensus
  coverage_pct      DECIMAL(5,2),

  -- SCE Computed Totals
  sce_votes         JSONB,              -- {candidate_id: computed_votes}
  sce_total_valid   INTEGER,
  sce_total_cast    INTEGER,
  sce_confidence    DECIMAL(5,2),

  -- Computation metadata
  computed_at       TIMESTAMPTZ,
  computation_basis TEXT              -- 'ec8a_direct' (always — SCE never trusts EC8B+)
);

-- ─────────────────────────────────────────────────────────────────────────
-- OFFICIAL INEC COLLATION DECLARATIONS (from EC8B/C/D/E submissions or
-- from IReV scraping)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE inec_declared_totals (
  election_id       TEXT,
  unit_code         TEXT,
  unit_level        TEXT,
  PRIMARY KEY (election_id, unit_code, unit_level),

  form_type         TEXT,               -- which form this came from
  declared_votes    JSONB,              -- {candidate_id: declared_votes}
  declared_total    INTEGER,
  declared_at       TIMESTAMPTZ,
  source            TEXT,               -- 'party_agent_upload'|'observer_upload'|'irev_scrape'
  submission_id     UUID REFERENCES form_submissions
);

-- Row-level PU figures as declared on collation forms (EC8B onward)
-- This is how we detect PU_ROW_ALTERED — the most precise fraud signal
CREATE TABLE collation_pu_rows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     UUID REFERENCES form_submissions,  -- the EC8B/C form
  pu_code           TEXT REFERENCES polling_units,      -- the PU row on that form
  declared_votes    JSONB,              -- {candidate_id: votes} as written on form
  declared_total    INTEGER
);

-- ─────────────────────────────────────────────────────────────────────────
-- DIVERGENCES
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE divergences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id       TEXT,
  unit_code         TEXT,
  unit_level        TEXT,
  divergence_type   TEXT,
  -- pu_row_altered | ward_total_fabricated | lga_total_fabricated |
  -- state_total_fabricated | declaration_conflict | internal_arithmetic_error

  severity          TEXT,              -- low|medium|high|critical
  detected_at       TIMESTAMPTZ DEFAULT NOW(),

  -- The gap
  sce_total         JSONB,
  inec_declared     JSONB,
  difference        JSONB,             -- {candidate_id: delta}
  coverage_pct_at_detection DECIMAL(5,2),

  -- Evidence links
  sce_computation_snapshot  JSONB,     -- frozen snapshot of SCE at detection time
  triggering_submission_id  UUID,      -- the EC8B/C/D/E that triggered the detection
  affected_pu_codes         TEXT[],    -- PU-level: which specific PU rows were altered

  -- Escalation
  escalation_status TEXT DEFAULT 'open',  -- open|notified|escalated|resolved
  notified_at       TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,

  is_active         BOOLEAN DEFAULT true
);

-- ─────────────────────────────────────────────────────────────────────────
-- AUDIT LOG (append-only — never DELETE or UPDATE)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id                BIGSERIAL PRIMARY KEY,
  event_type        TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         TEXT,
  actor_id          UUID,
  event_data        JSONB,
  event_at          TIMESTAMPTZ DEFAULT NOW(),
  log_hash          TEXT            -- SHA-256(prev_hash + event_data) chained
);

-- Row-level security: INSERT only. No UPDATE. No DELETE.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_insert_only ON audit_log
  FOR INSERT TO authenticated WITH CHECK (true);
-- SELECT granted to public. UPDATE/DELETE: no policy = denied.
```

---

## 8. Edge Cases and Failure Modes

### 8.1 Incomplete EC8A Coverage at Collation Time

**Problem:** Ward Collation Officer announces EC8B totals, but OpenBallot only
has EC8A for 14 of 22 PUs in that ward. Can we still run the comparison?

**Handling:**
- Compute SCE total for the 14 known PUs.
- Compare that partial total against the sum of the 14 matching rows on
  the EC8B form (using collation_pu_rows table).
- If the 14 known PU rows match → clean for those PUs, flag others as
  "unverified — no independent EC8A."
- If ANY of the 14 known PU rows differ → PU_ROW_ALTERED flagged immediately
  regardless of overall coverage.
- The system can detect a single altered PU row even at 1% coverage.

### 8.2 Violence-Affected / Cancelled Polling Units

Some PUs will be cancelled or have elections held over. INEC publishes the
list of cancelled/rescheduled PUs before and after elections.

**Handling:**
- Load INEC's cancelled PU register before election day.
- Mark these PUs as `status = 'cancelled'` or `status = 'rescheduled'`
  in the polling_units table for that election.
- Exclude them from SCE computation denominators.
- Display them on the map as "Election Cancelled" (grey with X marker).
- Do NOT flag their absence as a data gap.

### 8.3 Supplementary Elections

When no candidate meets the constitutional threshold (25% in 2/3 of states for
presidential), INEC conducts a supplementary election.

**Handling:**
- Create a new election record with `type = 'supplementary'` linked to the
  parent election_id.
- Supplementary elections run the full EC8A pipeline for affected PUs only.
- SCE for the supplementary merges with the parent to produce a final combined
  total.

### 8.4 Agent Submits Wrong Form Level

An agent assigned as a `ward_agent` accidentally photographs an EC8A form.

**Handling:**
- OCR classifier identifies form type from structure.
- If classified form_type != agent's assigned level → reject with explanation:
  "This appears to be an EC8A form. Your account is registered as a Ward
  Agent. Please photograph the EC8B Ward Collation form."
- Log the attempt in audit_log for transparency.

### 8.5 Same Form Submitted by Multiple Agents at Same Level

APC's ward agent and PDP's ward agent both submit EC8B for Ward 4.

**Handling:**
- Both submissions are stored and displayed.
- Consensus engine runs on EC8B forms the same way it does on EC8A:
  If APC EC8B and PDP EC8B agree → EC8B consensus status = 'consensus'
  If they disagree → EC8B consensus status = 'discrepancy'
- SCE comparison uses INEC's declared total (from their official EC8B upload
  or IReV), not any party's EC8B submission.
- Party EC8B submissions serve as independent witness documents, not as the
  comparison target.

### 8.6 Delayed Uploads (Hours/Days After Event)

Due to network outages or agent issues, EC8A uploads may arrive long after
the collation at that ward has been announced.

**Handling:**
- Accept ALL delayed uploads. Timestamp at capture time (from EXIF) is the
  canonical time, not upload time.
- If a delayed EC8A arrives after an EC8B comparison has already been run and
  flagged as "clean":
  * Re-run comparison with new EC8A included.
  * If comparison status changes → update divergence record and notify.
  * The audit log shows: "Comparison updated: new EC8A submission received
    for PU X (captured 14:23, uploaded 22:47)."
- Delayed uploads never retroactively remove a fraud flag — they can only
  confirm or deepen one.

### 8.7 Form EC60EC (Posted Results Sheet)

INEC mandates that a copy of the EC8A is publicly posted at each polling unit
after the result is announced. This is the "people's result sheet."

**Handling:**
- Treat EC60EC uploads as a separate document type — they are photographs of
  the posted sheet, not the signed original.
- Display alongside EC8A submissions as corroborating evidence.
- Do NOT use EC60EC figures in SCE computation — only signed EC8A counts.
- Any citizen (not just registered agents) can upload an EC60EC photo.
  This is publicly crowdsourced. Clearly labelled as "Community Upload —
  Not Agent-Verified."

### 8.8 Presidential 25% Rule — Spread Computation

The Nigerian constitution requires the presidential winner to have not just
the most votes nationally, but at least 25% of votes cast in at least 2/3
of all states (i.e. 24 of 36 states + FCT).

**Handling:**
- The SCE computes this automatically from state-level SCE totals.
- Display a live "Constitutional Threshold Tracker" per candidate:
  "Candidate A: 25% threshold met in 31 of 36 states (threshold = 24)"
- As state SCE totals update, this tracker updates in real time.
- If a candidate's SCE data shows they DO meet the threshold but INEC
  declares they DON'T (or vice versa) → DECLARATION_CONFLICT of the
  highest severity.

### 8.9 Collation Centre Physical Disruption

In some elections (Edo 2024, etc.), armed groups have disrupted collation
centres, forcing cancellation or relocation.

**Handling:**
- Agents can flag a collation event as "DISRUPTED" in the app.
- This logs an event_type = 'COLLATION_DISRUPTION' in the audit log.
- The platform displays a visible "Collation Disruption Reported" alert
  for that unit.
- SCE computation for that unit is paused and marked "DISRUPTED — results
  pending."
- INEC is automatically notified via the escalation protocol.

---

## 9. API Endpoints for the Collation Verification Engine

```
# Shadow Collation Engine totals
GET /v1/sce/{election_id}/national
GET /v1/sce/{election_id}/state/{state_code}
GET /v1/sce/{election_id}/lga/{lga_code}
GET /v1/sce/{election_id}/ward/{ward_code}
  → Returns: {sce_votes, coverage_pct, units_expected, units_reporting,
               sce_confidence, computed_at}

# INEC declared totals
GET /v1/declared/{election_id}/state/{state_code}
GET /v1/declared/{election_id}/lga/{lga_code}
  → Returns: {declared_votes, declared_at, source, form_submission_id}

# Divergence comparison (the core output)
GET /v1/compare/{election_id}/state/{state_code}
GET /v1/compare/{election_id}/lga/{lga_code}
GET /v1/compare/{election_id}/ward/{ward_code}
  → Returns: {sce_total, inec_declared, difference, divergence_type,
               coverage_pct, is_divergent, confidence_level}

# Fraud localisation
GET /v1/localise/{election_id}/divergence/{divergence_id}
  → Returns: {affected_levels, affected_units, altered_pu_rows,
               evidence_links, localisation_confidence}

# All active divergences
GET /v1/divergences/{election_id}
GET /v1/divergences/{election_id}?severity=critical
GET /v1/divergences/{election_id}?state={state_code}

# Polling unit permanent record
GET /v1/pu/{pu_code}
GET /v1/pu/{pu_code}/history            → all elections
GET /v1/pu/{pu_code}/chain/{election_id} → how this PU's figures
                                           travelled through collation

# Collation form submissions at any level
GET /v1/forms/{election_id}/{form_type}/{unit_code}
  → Returns: all submissions for that form at that unit
             with images, extractions, validation flags

# Hash verification
GET /v1/verify/hash/{sha256}
  → Returns: {found: bool, submission_id, election_id, pu_code,
               blockchain_tx, captured_at}
```

---

## 10. Sequencing and Timing Design

Understanding the timeline is critical to the system's design:

```
T+0:00    Polls close
T+0:30    EC8A uploads begin (agents photograph immediately after announcement)
T+1:00    EC8A uploads at high volume — SCE ward totals begin populating
T+2:00    EC8B ward collation begins at most centres
T+3:00    EC8B uploads begin — FIRST COMPARISON POINT
          Platform begins running PU_ROW_ALTERED checks
T+4:00    Most EC8Bs expected. SCE has ~60-80% ward coverage.
T+6:00    LGA collation begins
T+8:00    EC8C uploads begin — SECOND COMPARISON POINT
T+12:00   State collation begins (for some states)
T+24:00   EC8D uploads begin — THIRD COMPARISON POINT
T+48:00   Some state declarations. Others take longer.
T+72:00   Presidential state declarations expected.
T+96:00   INEC HQ collation and EC8E declaration — FINAL COMPARISON POINT
```

The system must be designed to handle the full sequence, not just election
day. The most important fraud detection windows are T+3 (EC8B comparison)
and T+24 (EC8D comparison). These are when historically the biggest
discrepancies have been introduced.

---

## 11. Performance Requirements at Scale

At peak presidential election scale:

```
Metric                          Target
──────────────────────────────────────────────────────
Concurrent agent uploads        50,000 simultaneous
EC8A forms per hour (peak)      30,000
API read requests/second        100,000 (election day)
SCE recomputation latency       < 5 seconds from new EC8A
Divergence detection latency    < 30 seconds from EC8B receipt
Map update latency (public)     < 10 seconds from consensus change
EC8A image delivery latency     < 2 seconds (CDN-served)
Database write throughput       10,000 inserts/second
System availability on E-Day    99.9% uptime target
```

To meet these requirements:
- All EC8A images served from Cloudflare R2 via CDN — never from origin
- SCE computation is event-driven via Redis pub/sub + BullMQ workers
- Database reads for public map use Supabase read replicas
- Divergence detection runs as dedicated workers, not inline with uploads
- The public map API endpoints return pre-aggregated JSON, cached in Redis
  with 10-second TTL, not live database queries

---

## 12. What This Architecture Makes Possible — Summary

This system, when fully built, produces something that has never existed in
Nigerian electoral history:

**For any election, at any time, any person can:**

1. Enter any of Nigeria's 176,846 polling unit codes and see every EC8A
   ever submitted for it, from every election, with the original document
   visible, the extracted figures shown, and a cryptographic proof that
   neither has been altered since submission.

2. See whether that polling unit's figures were faithfully carried through
   every collation level — or altered, and at exactly which level.

3. See the real-time difference between what the EC8A forms collectively
   say the result should be, and what INEC has officially declared —
   at ward, LGA, state, and national level — simultaneously.

4. Download the complete evidentiary dataset for any election and verify
   every claim independently.

The forensic work the BBC did manually for Rivers State over six weeks —
OpenBallot does automatically, nationally, in real time.

That is the standard this specification is written to meet.

---

*End of Collation Verification Engine Specification v1.0*
*Next: Database migration scripts, API implementation guide, SCE worker code*
