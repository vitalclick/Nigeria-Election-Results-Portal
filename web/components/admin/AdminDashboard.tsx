'use client';

import { useEffect, useState } from 'react';

import {
  decideReview,
  fetchReviewQueue,
  uploadRoster,
  type ReviewQueueItem,
  type RosterImportResult,
} from '@/lib/admin-client';
import { AuthError } from '@/lib/auth-client';

// Real-wired admin portal:
//   * Roster upload posts to POST /v1/admin/roster; surfaces per-line
//     parser errors when the CSV is bad.
//   * Review queue pulls from GET /v1/admin/review/queue; approve/reject
//     calls POST /v1/admin/review/submissions/{id}. Each decision returns
//     the new verified_results status which we display inline so the
//     reviewer sees the consensus effect of their action.

export function AdminDashboard() {
  return (
    <div className="mt-6 space-y-8">
      <RosterUploadSection />
      <ReviewQueueSection />
    </div>
  );
}

function RosterUploadSection() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<RosterImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  return (
    <section className="border rounded-lg bg-white p-5">
      <h2 className="font-semibold">Roster upload</h2>
      <p className="text-sm text-slate-600 mt-1">
        CSV columns: <code className="text-xs">name, phone, pu_code, language</code>
      </p>
      <input
        type="file"
        accept=".csv"
        className="mt-3"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setFile(f);
          setResult(null);
          setErrors([]);
          const text = await f.text();
          setPreview(
            text
              .split(/\r?\n/)
              .slice(0, 6)
              .filter(Boolean)
              .map((row) => row.split(','))
          );
        }}
      />
      {preview.length > 0 && (
        <table className="mt-4 text-sm w-full">
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} className={i === 0 ? 'font-semibold' : ''}>
                {row.map((c, j) => (
                  <td key={j} className="border-b py-1 px-2">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {errors.length > 0 && (
        <div className="mt-3 border border-red-200 bg-red-50 rounded p-3 text-sm">
          <div className="font-semibold text-red-800">CSV rejected</div>
          <ul className="mt-1 list-disc pl-5 text-red-700">
            {errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
            {errors.length > 10 && <li>…and {errors.length - 10} more</li>}
          </ul>
        </div>
      )}

      {result && (
        <div className="mt-3 border border-green-200 bg-green-50 rounded p-3 text-sm text-green-800">
          Imported <strong>{result.inserted}</strong> agents for party{' '}
          <strong>{result.party}</strong>. Skipped <strong>{result.skipped_existing}</strong>{' '}
          already registered. Dispatched <strong>{result.sms_dispatched}</strong> SMS messages.
        </div>
      )}

      {file && (
        <button
          disabled={uploading}
          onClick={async () => {
            setUploading(true);
            setErrors([]);
            setResult(null);
            try {
              const r = await uploadRoster(file, true);
              setResult(r);
            } catch (e) {
              const err = e as AuthError;
              const detail = (err.detail || {}) as { errors?: string[]; message?: string };
              setErrors(
                detail.errors ?? [detail.message ?? err.code ?? 'Upload failed']
              );
            } finally {
              setUploading(false);
            }
          }}
          className="mt-3 px-4 py-2 bg-ng-green text-white rounded font-medium disabled:opacity-40"
        >
          {uploading ? 'Importing…' : `Import ${Math.max(0, preview.length - 1)} agents`}
        </button>
      )}
    </section>
  );
}

function ReviewQueueSection() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [lastVerificationStatus, setLastVerificationStatus] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await fetchReviewQueue();
      setItems(data);
    } catch (e) {
      // Most likely 403 - the operator isn't a consortium reviewer.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function act(action: 'approve' | 'reject') {
    if (!selected) return;
    if (action === 'reject' && !rejectReason.trim()) return;
    setActionInFlight(true);
    try {
      const r = await decideReview(selected.submission_id, action, rejectReason || undefined);
      setLastVerificationStatus(r.verification_status);
      setSelected(null);
      setRejectReason('');
      await refresh();
    } catch {
      // surface error; for the scaffold we just log
    } finally {
      setActionInFlight(false);
    }
  }

  return (
    <section className="border rounded-lg bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Review queue</h2>
        <button onClick={refresh} className="text-xs text-slate-500 underline">
          Refresh
        </button>
      </div>
      <p className="text-sm text-slate-600 mt-1">
        Submissions awaiting human review (low confidence or arithmetic failure). Approving
        feeds the submission into the consensus engine; rejecting marks it permanently with a
        reason. Every decision is written to the audit log.
      </p>
      {lastVerificationStatus && (
        <p className="text-xs text-slate-500 mt-2">
          Last decision recomputed verification status to{' '}
          <code>{lastVerificationStatus}</code>
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No submissions awaiting review. Either everything has been processed or you do not
          have consortium reviewer permissions.
        </p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b">
              <th className="py-2">PU</th>
              <th>State</th>
              <th>Source</th>
              <th>Confidence</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.submission_id} className="border-b">
                <td className="py-2 font-mono text-xs">{it.pu_code}</td>
                <td>{it.state_code}</td>
                <td className="text-xs">{it.party_code ?? it.source_type}</td>
                <td>{(it.confidence_score * 100).toFixed(0)}%</td>
                <td className="text-xs">
                  {new Date(it.submitted_at).toLocaleString()}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => setSelected(it)}
                    className="text-blue-700 hover:underline text-xs"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between">
              <div>
                <h3 className="font-semibold">{selected.pu_name}</h3>
                <p className="text-xs text-slate-500">
                  PU {selected.pu_code} · {selected.state_code} · submitted{' '}
                  {new Date(selected.submitted_at).toLocaleString()}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-500 text-xl">
                ×
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <a href={selected.image_url} target="_blank" rel="noopener noreferrer">
                <img
                  src={selected.image_url}
                  alt="EC8A"
                  className="w-full rounded border"
                />
              </a>
              <div className="text-sm">
                <h4 className="font-semibold mb-1">Extracted</h4>
                <pre className="text-xs bg-slate-50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(selected.extracted, null, 2)}
                </pre>
                <h4 className="font-semibold mt-3 mb-1">Validation flags</h4>
                <pre className="text-xs bg-slate-50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(selected.validation_flags, null, 2)}
                </pre>
                <p className="text-xs text-slate-500 mt-3">
                  sha256: <span className="font-mono">{selected.image_sha256.slice(0, 24)}…</span>
                </p>
              </div>
            </div>

            <div className="mt-5 border-t pt-4">
              <h4 className="font-semibold text-sm">Decision</h4>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => act('approve')}
                  disabled={actionInFlight}
                  className="px-4 py-2 bg-status-consensus text-white rounded text-sm font-medium disabled:opacity-40"
                >
                  Approve
                </button>
                <input
                  type="text"
                  placeholder="Rejection reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={() => act('reject')}
                  disabled={actionInFlight || !rejectReason.trim()}
                  className="px-4 py-2 bg-status-discrepancy text-white rounded text-sm font-medium disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
