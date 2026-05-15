# Security

## Threat model

The platform is a high-value target on election day. The adversaries we
design against are not generic web attackers but specific actors with
specific goals:

| Adversary | Goal | Primary defence |
|---|---|---|
| **A party operative** | Stuff their own party's tally; suppress rivals' | Multi-party cross-verification (cannot fake other parties' agreement); GPS geofence; image SHA-256 is computed on the device. |
| **A platform insider** | Quietly edit historical results | Append-only audit log + chained hashes + blockchain-anchored Merkle root. Any post-hoc edit breaks the chain. |
| **A DDoS actor** | Take the site down at the moment of declaration | Cloudflare Enterprise in front; aggressive edge caching of read paths; SSE fan-out separated from write path; worker is horizontally scalable. |
| **A credential stuffer** | Hijack agents to submit fake EC8A | Phone OTP + device binding + anomaly detection (same agent, multiple locations); party admin sees per-agent activity. |
| **An OCR confuser** | Feed shopped images that read as valid | Per-field confidence floor; arithmetic consistency checks; signatures + stamp detection; below-threshold submissions hit the human review queue. The signed image is **always** published, so the public can sanity check. |
| **A metadata stripper** | Hide image provenance | EXIF integrity flag is computed on ingest; missing or suspicious EXIF is visible on the submission card. We do not block - we publish. |

## Boundaries

- **Public read API**: anonymous, rate-limited at 240 req/min/IP at the
  application layer plus Cloudflare. Returns only verified-result-grade
  data + redacted submission projections.
- **Agent upload API**: phone-OTP-authenticated, scoped to the agent's
  assigned PU, with per-agent rate limits.
- **Admin API**: party admin scope, 2FA enforced, every action lands in
  the audit log.
- **Database**: row-level security on every operational table. The web
  app uses an anon JWT with read-only scope on materialised views; only
  the worker uses the service-role key, and only the worker writes to
  `ec8a_submissions` or `audit_log`.

## Cryptographic posture

- **Image integrity**: SHA-256 computed on the device (`crypto.subtle.digest`)
  before upload. The hash travels with the submission; the worker
  verifies the bytes it received hash to the same value.
- **Audit chain**: SHA-256 chained over (prev_hash || event metadata ||
  canonical event_data). Implementation lives in two places that must
  agree: `db/migrations/0002_audit_chain.sql` (SQL trigger) and
  `worker/app/audit/chain.py` (Python verifier).
- **External anchor**: Merkle root of each 30-minute audit batch is
  written to Ethereum mainnet via OP_RETURN. TX hash + block number land
  in `audit_anchors`. After confirmation the batch is verifiable without
  trusting OpenBallot's infrastructure at all.

## Privacy

- Agent name + phone number are never returned by any public API.
- Submission rows expose `source_type` and `party_code` only; `submitted_by`
  is server-side-only.
- The post-election audit dataset is anonymised to credential type, not
  personal identity. Personally identifying agent data is retained for one
  electoral cycle and then erased per NDPA 2023 § 27.
- Camera + geolocation permissions are requested only inside the agent
  flow, and the Permissions-Policy header restricts them site-wide.

## Headers

`next.config.mjs` sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (overridden to `ALLOWALL` for `/embed/*`)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`

## Responsible disclosure

Email **security@openballot.ng** with details. We acknowledge within 48
hours and aim to fix critical issues within 7 days. Hall of fame
contributors are listed at https://openballot.ng/security (post-launch).

## Out of scope

- We do not adjudicate disputes. We surface evidence; tribunals and INEC
  decide outcomes.
- We do not host the canonical INEC results. Our INEC IReV mirror is for
  cross-reference only; the canonical authority is INEC's portal.
