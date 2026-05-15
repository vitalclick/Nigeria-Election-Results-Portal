// Wire types shared with the worker. Kept in sync by hand for now; a future
// improvement is to codegen these from the Pydantic models.

export type ElectionType =
  | 'presidential'
  | 'senate'
  | 'reps'
  | 'governorship'
  | 'stha'
  | 'fct_area'
  | 'lga';

export type VerificationStatus =
  | 'no_data'
  | 'single_source'
  | 'consensus'
  | 'discrepancy'
  | 'inec_confirmed'
  | 'inec_conflict';

export type SubmissionSource = 'party_agent' | 'observer' | 'inec_irev';

export interface ExtractedEC8A {
  pu_code: string;
  registered_voters: number;
  accredited_voters: number;
  candidate_votes: Record<string, number>;
  total_valid_votes: number;
  rejected_ballots: number;
  total_votes_cast: number;
  presiding_officer_signed: boolean;
  agent_signatures_detected: number;
  official_stamp_present: boolean;
}

export interface SubmissionView {
  submission_id: string;
  source: SubmissionSource;
  party?: string | null;
  image_url: string;
  image_sha256: string;
  extracted: ExtractedEC8A;
  submitted_at: string;
  confidence: number;
}

export interface PollingUnitDetail {
  pu_code: string;
  pu_name: string;
  ward_code: string;
  lga_code: string;
  state_code: string;
  coordinates: { lat: number; lng: number };
  status: VerificationStatus;
  submission_count: number;
  source_count: number;
  consensus_data: ExtractedEC8A | null;
  submissions: SubmissionView[];
}

export interface NationalRollup {
  election_id: string;
  units_reporting: number;
  units_total: number;
  units_consensus: number;
  units_discrepancy: number;
  units_inec_confirmed: number;
  units_inec_conflict: number;
  party_totals?: Record<string, number>;
  last_updated: string;
}

export interface DiscrepancyRecord {
  id: string;
  election_id: string;
  pu_code: string;
  pu_name: string;
  state_code: string;
  detected_at: string;
  differing_fields: string[];
  severity: number;
  escalation_status: 'open' | 'notified' | 'acknowledged' | 'resolved';
  submissions: SubmissionView[];
}

export const STATUS_COLOURS: Record<VerificationStatus, string> = {
  no_data: '#e5e7eb',
  single_source: '#f6c453',
  consensus: '#22c55e',
  discrepancy: '#f97316',
  inec_confirmed: '#2563eb',
  inec_conflict: '#dc2626',
};
