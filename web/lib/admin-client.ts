// Admin API client. Sits on top of authedFetch from auth-client.ts so
// every call carries the agent JWT + device fingerprint.

import { authedFetch, AuthError } from './auth-client';

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8000';

export interface RosterImportResult {
  inserted: number;
  skipped_existing: number;
  sms_dispatched: number;
  party: string;
}

export interface CsvError {
  code: string;
  errors?: string[];
  message?: string;
}

export async function uploadRoster(
  file: File,
  dispatchSms: boolean = true
): Promise<RosterImportResult> {
  const form = new FormData();
  form.append('file', file);
  const url = `${WORKER}/v1/admin/roster?dispatch_sms=${dispatchSms}`;
  const r = await authedFetch(url, { method: 'POST', body: form });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { detail?: CsvError };
    throw new AuthError(r.status, j.detail?.code || 'roster_upload_failed', j.detail);
  }
  return r.json();
}

export interface ReviewQueueItem {
  submission_id: string;
  election_id: string;
  pu_code: string;
  pu_name: string;
  state_code: string;
  image_url: string;
  image_sha256: string;
  submitted_at: string;
  confidence_score: number;
  extracted: Record<string, unknown>;
  validation_flags: Record<string, unknown>;
  party_code: string | null;
  source_type: string;
}

export async function fetchReviewQueue(state?: string, limit = 100): Promise<ReviewQueueItem[]> {
  const params = new URLSearchParams();
  if (state) params.set('state', state);
  params.set('limit', String(limit));
  const r = await authedFetch(`${WORKER}/v1/admin/review/queue?${params}`);
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { detail?: CsvError };
    throw new AuthError(r.status, j.detail?.code || 'queue_fetch_failed', j.detail);
  }
  return r.json();
}

export interface ReviewDecision {
  submission_id: string;
  new_status: string;
  pu_code: string;
  verification_status: string;
}

export async function decideReview(
  submissionId: string,
  action: 'approve' | 'reject',
  reason?: string
): Promise<ReviewDecision> {
  const r = await authedFetch(
    `${WORKER}/v1/admin/review/submissions/${submissionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    }
  );
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { detail?: CsvError };
    throw new AuthError(r.status, j.detail?.code || 'review_failed', j.detail);
  }
  return r.json();
}
