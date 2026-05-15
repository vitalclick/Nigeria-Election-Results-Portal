'use client';

import { useEffect, useState } from 'react';

import type { DiscrepancyRecord } from '@/lib/types';

export function DiscrepancyRegister({ electionId }: { electionId: string }) {
  const [items, setItems] = useState<DiscrepancyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/v1/discrepancies?election_id=${electionId}`);
      const j = await r.json();
      setItems(j.data ?? []);
      setLoading(false);
    })();
  }, [electionId]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (!items.length)
    return (
      <p className="text-slate-500">
        No discrepancies recorded yet. This page populates in real time as submissions arrive.
      </p>
    );

  return (
    <div className="space-y-6">
      {items.map((d) => (
        <article key={d.id} className="border rounded-lg bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="font-semibold">{d.pu_name}</h3>
              <p className="text-xs text-slate-500">
                {d.state_code} · PU {d.pu_code} · Detected{' '}
                {new Date(d.detected_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  d.severity >= 4
                    ? 'bg-red-100 text-red-800'
                    : 'bg-orange-100 text-orange-800'
                }`}
              >
                Severity {d.severity}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-slate-100">
                {d.escalation_status}
              </span>
            </div>
          </div>

          <div className="mt-2 text-sm">
            <span className="text-slate-500">Differing fields:</span>{' '}
            <span className="font-mono text-xs">{d.differing_fields.join(', ')}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            {d.submissions.map((s) => (
              <div key={s.submission_id} className="border rounded p-3 bg-slate-50">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">
                    {s.source === 'inec_irev' ? 'INEC IReV' : `${s.source}: ${s.party ?? '—'}`}
                  </span>
                  <span className="text-slate-500">
                    conf {(s.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <a
                  href={s.image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-2"
                >
                  <img
                    src={s.image_url}
                    alt="EC8A submission"
                    className="w-full rounded border"
                    loading="lazy"
                  />
                </a>
                <table className="w-full text-xs mt-2">
                  <tbody>
                    {Object.entries(s.extracted.candidate_votes).map(([p, v]) => (
                      <tr key={p}>
                        <td className="py-0.5">{p}</td>
                        <td className="py-0.5 text-right tabular-nums">{v.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 text-xs text-slate-500 font-mono break-all">
                  sha256:{s.image_sha256.slice(0, 16)}…
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
