// Upload client used by the agent PWA's offline-queue drainer.
//
// Three-step flow for a single EC8A submission:
//   1. presignUpload()    -> { upload_url, image_url, object_key }
//   2. uploadBytes()      direct browser -> R2 PUT
//   3. submitIngestion()  -> { submission_id, poll_url }
//
// Then the UI polls /v1/submissions/{id} until processing_status leaves
// 'queued' / 'processing'.

import { authedFetch, AuthError } from './auth-client';

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8000';

export interface PresignResponse {
  upload_url: string;
  image_url: string;
  object_key: string;
  expires_in_seconds: number;
}

export async function presignUpload(args: {
  election_id: string;
  pu_code: string;
  content_type: string;
  content_length: number;
  sha256_hex: string;
}): Promise<PresignResponse> {
  const r = await authedFetch(`${WORKER}/v1/uploads/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      election_id: args.election_id,
      pu_code: args.pu_code,
      content_type: args.content_type,
      content_length: args.content_length,
      sha256: args.sha256_hex,
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new AuthError(r.status, j.detail?.code || 'presign_failed', j.detail);
  }
  return r.json();
}

export async function uploadBytes(
  upload_url: string,
  blob: Blob,
  sha256_hex: string
): Promise<void> {
  // Base64-encode the SHA-256 so it matches the format the presign was
  // bound to (S3 SigV4 ChecksumSHA256 header).
  const sha256_b64 = hexToBase64(sha256_hex);
  const r = await fetch(upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type,
      'x-amz-checksum-sha256': sha256_b64,
    },
    body: blob,
  });
  if (!r.ok) {
    throw new Error(`upload failed: HTTP ${r.status}`);
  }
}

export interface SubmissionAck {
  accepted: boolean;
  submission_id: string;
  processing_status: 'queued' | 'processing' | 'extracted' | 'failed';
  flags: Record<string, unknown>;
  poll_url: string;
}

export async function submitIngestion(args: {
  election_id: string;
  pu_code: string;
  source_type: 'party_agent' | 'observer';
  party_code: string | null;
  image_url: string;
  image_sha256: string;
  image_bytes: number;
  gps: { lat: number; lng: number; acc?: number } | null;
  captured_at: string;
  client_submission_uuid: string;
}): Promise<SubmissionAck> {
  const r = await authedFetch(`${WORKER}/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok && r.status !== 202) {
    const j = await r.json().catch(() => ({}));
    throw new AuthError(r.status, j.detail?.code || 'ingest_failed', j.detail);
  }
  return r.json();
}

export interface SubmissionStatus {
  id: string;
  election_id: string;
  pu_code: string;
  processing_status: 'queued' | 'processing' | 'extracted' | 'failed';
  processing_error: string | null;
  review_status: string;
  confidence_score: number | null;
  queued_at: string | null;
  extraction_started_at: string | null;
  extraction_completed_at: string | null;
}

export async function pollSubmission(submission_id: string): Promise<SubmissionStatus> {
  const r = await authedFetch(`${WORKER}/v1/submissions/${submission_id}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new AuthError(r.status, j.detail?.code || 'status_failed', j.detail);
  }
  return r.json();
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
