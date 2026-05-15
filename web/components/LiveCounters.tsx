'use client';

import { useEffect, useState } from 'react';

import type { NationalRollup } from '@/lib/types';

export function LiveCounters({ electionId }: { electionId: string }) {
  const [data, setData] = useState<NationalRollup | null>(null);
  const [age, setAge] = useState<string>('—');

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      const r = await fetch(`/api/v1/elections/${electionId}/results`, { cache: 'no-store' });
      const j = await r.json();
      if (!cancelled && j.data) setData(j.data);
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [electionId]);

  useEffect(() => {
    if (!data) return;
    const update = () => {
      const secs = Math.max(
        0,
        Math.round((Date.now() - new Date(data.last_updated).getTime()) / 1000)
      );
      setAge(`${secs}s ago`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [data]);

  if (!data) {
    return <div className="text-slate-500 text-sm">Loading live counters…</div>;
  }

  const pct = ((data.units_reporting / Math.max(1, data.units_total)) * 100).toFixed(1);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Stat label="Polling units reporting" value={`${data.units_reporting.toLocaleString()} / ${data.units_total.toLocaleString()} (${pct}%)`} />
      <Stat label="Consensus reached" value={data.units_consensus.toLocaleString()} accent="bg-status-consensus" />
      <Stat label="Discrepancies" value={data.units_discrepancy.toLocaleString()} accent="bg-status-discrepancy" />
      <Stat label="INEC conflicts" value={data.units_inec_conflict.toLocaleString()} accent="bg-status-conflict" />
      <div className="col-span-2 md:col-span-4 text-xs text-slate-500">Last updated {age}</div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="p-4 border rounded-lg bg-white flex items-start gap-3">
      {accent && <span className={`inline-block w-2 h-10 rounded-sm ${accent}`} />}
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="font-semibold text-lg leading-tight mt-1">{value}</div>
      </div>
    </div>
  );
}
