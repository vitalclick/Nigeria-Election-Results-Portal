'use client';

import { useState } from 'react';

// Party admin portal - skeleton. Real flow:
//   1. Upload CSV of agent rosters (name, phone, pu_code)
//   2. System dispatches WhatsApp/SMS OTPs via Twilio adapter (worker)
//   3. Track per-PU coverage, submission timestamps, review queue items
//
// This component renders the upload UI and a per-PU coverage table backed
// by the public API. Auth + roster persistence are intentionally stubbed.

export function AdminDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);

  return (
    <div className="mt-6 space-y-8">
      <section className="border rounded-lg bg-white p-5">
        <h2 className="font-semibold">Roster upload</h2>
        <p className="text-sm text-slate-600 mt-1">
          CSV columns: <code className="text-xs">name,phone_e164,pu_code,language</code>
        </p>
        <input
          type="file"
          accept=".csv"
          className="mt-3"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
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
                    <td key={j} className="border-b py-1 px-2">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {file && (
          <button className="mt-3 px-4 py-2 bg-ng-green text-white rounded font-medium">
            Dispatch OTPs to {Math.max(0, preview.length - 1)} agents
          </button>
        )}
      </section>

      <section className="border rounded-lg bg-white p-5">
        <h2 className="font-semibold">Coverage</h2>
        <p className="text-sm text-slate-600 mt-1">
          Per-state submission progress for the next election cycle.
        </p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {['Lagos', 'Kano', 'Rivers', 'FCT'].map((s) => (
            <div key={s} className="border rounded p-3">
              <div className="text-xs uppercase text-slate-500">{s}</div>
              <div className="text-xl font-semibold mt-1">
                {Math.floor(Math.random() * 80 + 10)}%
              </div>
              <div className="text-xs text-slate-500">PUs covered</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border rounded-lg bg-white p-5">
        <h2 className="font-semibold">Review queue</h2>
        <p className="text-sm text-slate-600 mt-1">
          Submissions awaiting human review (low confidence or arithmetic failure).
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b">
              <th className="py-2">PU</th>
              <th>Submitted</th>
              <th>Confidence</th>
              <th>Flag</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[
              ['25-11-04-019', '17:48', '0.78', 'arithmetic'],
              ['33-15-05-001', '17:53', '0.82', 'low_confidence:total_valid_votes'],
              ['07-01-09-002', '18:02', '0.71', 'arithmetic;low_confidence:rejected'],
            ].map(([pu, time, conf, flag]) => (
              <tr key={pu} className="border-b">
                <td className="py-2 font-mono">{pu}</td>
                <td>{time}</td>
                <td>{conf}</td>
                <td className="text-xs">{flag}</td>
                <td className="text-right">
                  <button className="text-blue-700 hover:underline text-xs">Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
