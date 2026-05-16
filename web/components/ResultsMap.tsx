'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MapboxRenderer } from '@/components/MapboxRenderer';
import { STATUS_COLOURS, type PollingUnitDetail, type VerificationStatus } from '@/lib/types';

// Nigeria's geographic bounding box. Coordinates from Natural Earth.
const NIGERIA_BBOX = { lngMin: 2.5, lngMax: 14.7, latMin: 4.0, latMax: 14.0 };

type Geom =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

type GeoFeature = {
  type: 'Feature';
  properties: { name: string; kind: 'country' | 'state'; iso?: string };
  geometry: Geom;
};
type GeoCollection = { type: 'FeatureCollection'; features: GeoFeature[] };

// The public results map.
//
// In production this is a Mapbox GL JS choropleth with polling-unit dot
// layers. The runtime requires NEXT_PUBLIC_MAPBOX_TOKEN. To keep the
// scaffold runnable without that token (so investors can see the page on a
// fresh clone), we render an SVG fallback that draws a real Nigeria
// outline plus 36 state boundaries + FCT from /public/nigeria.geo.json.

const STATUS_LABEL: Record<VerificationStatus, string> = {
  no_data: 'No data',
  single_source: 'Single source',
  inec_published: 'INEC published',
  consensus: 'Consensus',
  discrepancy: 'Discrepancy',
  inec_confirmed: 'INEC confirmed',
  inec_conflict: 'INEC conflict',
};

const ELECTION_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: 'presidential', label: 'Presidential Election' },
  { slug: 'senate',       label: 'Senate' },
  { slug: 'reps',         label: 'House of Representatives' },
  { slug: 'governorship', label: 'Gubernatorial' },
  { slug: 'stha',         label: 'State House of Assembly' },
];

const YEAR_OPTIONS = [2027, 2023, 2019, 2015, 2011];

interface Props { defaultElectionId: string }

export function ResultsMap({ defaultElectionId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const defaults = useMemo(() => {
    const [year, slug] = defaultElectionId.split('-');
    return { year: Number(year) || 2027, election: slug || 'presidential' };
  }, [defaultElectionId]);

  const year = Number(searchParams.get('year')) || defaults.year;
  const election = searchParams.get('election') || defaults.election;
  const electionId = `${year}-${election}`;

  const setFilter = useCallback(
    (key: 'year' | 'election', value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(key, value);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 h-full">
      <FiltersPanel year={year} election={election} onChange={setFilter} />
      <MapPanel electionId={electionId} />
    </div>
  );
}

function MapPanel({ electionId }: { electionId: string }) {
  const [units, setUnits] = useState<PollingUnitDetail[]>([]);
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | 'all'>('all');
  const [selected, setSelected] = useState<PollingUnitDetail | null>(null);
  const [focusState, setFocusState] = useState<{ code: string; name: string } | null>(null);
  const mapboxToken =
    typeof window === 'undefined' ? undefined : process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/v1/elections/${electionId}/units`);
      const j = await r.json();
      if (!cancelled) setUnits(j.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [electionId]);

  const filtered = useMemo(
    () => {
      let xs = units;
      if (statusFilter !== 'all') xs = xs.filter((u) => u.status === statusFilter);
      if (focusState) xs = xs.filter((u) => u.state_code === focusState.code);
      return xs;
    },
    [units, statusFilter, focusState]
  );

  // Realtime: subscribe to verification_status changes via Server-Sent Events.
  useEffect(() => {
    const es = new EventSource(`/api/v1/elections/${electionId}/stream`);
    es.addEventListener('verified_result', (ev: MessageEvent) => {
      try {
        const update = JSON.parse(ev.data) as { pu_code: string; status: VerificationStatus };
        setUnits((prev) =>
          prev.map((u) => (u.pu_code === update.pu_code ? { ...u, status: update.status } : u))
        );
      } catch {/* ignore malformed events */}
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [electionId]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] h-full bg-slate-100 rounded-md overflow-hidden border border-slate-200">
      <div className="flex flex-col bg-slate-100 min-h-0">
        <FilterBar value={statusFilter} onChange={setStatusFilter} />
        <Breadcrumb focusState={focusState} onReset={() => setFocusState(null)} />
        <div className="relative flex-1 min-h-0">
          {mapboxToken ? (
            <MapboxRenderer
              electionId={electionId}
              token={mapboxToken}
              onSelect={setSelected}
              focusState={focusState}
              onFocusState={setFocusState}
            />
          ) : (
            <SvgFallback
              units={filtered}
              focusState={focusState}
              onFocusState={setFocusState}
              onSelect={setSelected}
            />
          )}
          <Legend />
        </div>
      </div>
      <aside className="border-l bg-white overflow-y-auto">
        <PUDetailPane unit={selected} />
      </aside>
    </div>
  );
}

function FiltersPanel({
  year,
  election,
  onChange,
}: {
  year: number;
  election: string;
  onChange: (key: 'year' | 'election', value: string) => void;
}) {
  return (
    <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start p-3 lg:p-0">
      <FilterCard step="1" colour="bg-ng-600" label="Select Election Year">
        <select
          className="w-full border rounded px-2 py-1 text-sm bg-white"
          value={year}
          onChange={(e) => onChange('year', e.target.value)}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </FilterCard>
      <FilterCard step="2" colour="bg-ng-800" label="Select Election">
        <select
          className="w-full border rounded px-2 py-1 text-sm bg-white"
          value={election}
          onChange={(e) => onChange('election', e.target.value)}
        >
          {ELECTION_OPTIONS.map((o) => (
            <option key={o.slug} value={o.slug}>{o.label}</option>
          ))}
        </select>
      </FilterCard>
    </aside>
  );
}

function FilterCard({
  step,
  colour,
  label,
  children,
}: {
  step: string;
  colour: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${colour} rounded-md p-3 text-white shadow-sm`}>
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-white text-slate-900 font-bold text-[11px]">
          {step}
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-slate-900">{children}</div>
    </div>
  );
}

function FilterBar({
  value,
  onChange,
}: {
  value: VerificationStatus | 'all';
  onChange: (v: VerificationStatus | 'all') => void;
}) {
  const opts: Array<VerificationStatus | 'all'> = [
    'all',
    'no_data',
    'single_source',
    'inec_published',
    'consensus',
    'discrepancy',
    'inec_confirmed',
    'inec_conflict',
  ];
  return (
    <div className="m-3 mb-2 bg-white rounded-md shadow px-2 py-1 flex flex-wrap gap-1">
      {opts.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-2 py-1 text-xs rounded ${
            value === s ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
          }`}
        >
          {s === 'all' ? 'All' : STATUS_LABEL[s as VerificationStatus]}
        </button>
      ))}
    </div>
  );
}

function Breadcrumb({
  focusState,
  onReset,
}: {
  focusState: { code: string; name: string } | null;
  onReset: () => void;
}) {
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 text-xs text-slate-600">
      <button onClick={onReset} className="text-ng-700 hover:underline">Nigeria</button>
      {focusState && (
        <>
          <span className="text-slate-400">|</span>
          <span className="text-slate-800 font-medium">{focusState.name}</span>
          <button
            onClick={onReset}
            className="ml-auto text-slate-500 hover:text-slate-800"
            aria-label="Zoom out to Nigeria"
          >
            ← Back to Nigeria
          </button>
        </>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-3 right-3 bg-white rounded-md shadow p-3 text-xs">
      <div className="font-semibold mb-1">Verification status</div>
      {(Object.keys(STATUS_COLOURS) as VerificationStatus[]).map((s) => (
        <div key={s} className="flex items-center gap-2 py-0.5">
          <span className="status-dot" style={{ background: STATUS_COLOURS[s] }} />
          <span>{STATUS_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

// Strip the "NG-" ISO prefix so the GeoJSON iso (e.g. "NG-LA") matches
// the two-letter state_code on PollingUnitDetail.
function isoToStateCode(iso?: string): string | null {
  if (!iso) return null;
  return iso.startsWith('NG-') ? iso.slice(3) : iso;
}

const W = 1000, H = 700;
function toX(lng: number): number {
  return ((lng - NIGERIA_BBOX.lngMin) / (NIGERIA_BBOX.lngMax - NIGERIA_BBOX.lngMin)) * W;
}
function toY(lat: number): number {
  return H - ((lat - NIGERIA_BBOX.latMin) / (NIGERIA_BBOX.latMax - NIGERIA_BBOX.latMin)) * H;
}
function geomBbox(g: Geom): [number, number, number, number] {
  let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      if (typeof v[0] === 'number') {
        const [lng, lat] = v as number[];
        if (lng < lngMin) lngMin = lng;
        if (lng > lngMax) lngMax = lng;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      } else (v as unknown[]).forEach(walk);
    }
  };
  walk(g.coordinates);
  return [lngMin, latMin, lngMax, latMax];
}
function bboxToViewBox(
  [lngMin, latMin, lngMax, latMax]: number[]
): [number, number, number, number] {
  const x1 = toX(lngMin), x2 = toX(lngMax);
  const y1 = toY(latMax),  y2 = toY(latMin);
  const w = x2 - x1, h = y2 - y1;
  const pad = Math.max(w, h) * 0.08;
  return [x1 - pad, y1 - pad, w + pad * 2, h + pad * 2];
}

function SvgFallback({
  units,
  focusState,
  onFocusState,
  onSelect,
}: {
  units: PollingUnitDetail[];
  focusState: { code: string; name: string } | null;
  onFocusState: (s: { code: string; name: string } | null) => void;
  onSelect: (u: PollingUnitDetail) => void;
}) {
  const [geo, setGeo] = useState<GeoCollection | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState<[number, number]>([0, 0]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/nigeria.geo.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setGeo(j as GeoCollection); })
      .catch(() => {/* fall back to bare background */});
    return () => { cancelled = true; };
  }, []);

  // Reset manual zoom/pan whenever the user drills in or out.
  useEffect(() => { setZoomScale(1); setPanOffset([0, 0]); }, [focusState]);

  const ringToPath = (ring: number[][]) =>
    ring
      .map(([lng, lat], i) => `${i === 0 ? 'M' : 'L'}${toX(lng).toFixed(1)} ${toY(lat).toFixed(1)}`)
      .join(' ') + ' Z';

  const featureToPath = (f: GeoFeature) => {
    const polys =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return polys.map((poly) => poly.map(ringToPath).join(' ')).join(' ');
  };

  const states = useMemo(
    () => geo?.features.filter((f) => f.properties.kind === 'state') ?? [],
    [geo]
  );
  const country = useMemo(
    () => geo?.features.find((f) => f.properties.kind === 'country') ?? null,
    [geo]
  );

  // viewBox = bbox of country or focused state, modulated by zoom + pan.
  const viewBox = useMemo<[number, number, number, number]>(() => {
    let bbox: [number, number, number, number] = [
      NIGERIA_BBOX.lngMin, NIGERIA_BBOX.latMin, NIGERIA_BBOX.lngMax, NIGERIA_BBOX.latMax,
    ];
    if (focusState) {
      const s = states.find((f) => isoToStateCode(f.properties.iso) === focusState.code);
      if (s) bbox = geomBbox(s.geometry);
    }
    const [vx, vy, vw, vh] = bboxToViewBox(bbox);
    const cx = vx + vw / 2, cy = vy + vh / 2;
    const w = vw / zoomScale, h = vh / zoomScale;
    return [cx - w / 2 + panOffset[0], cy - h / 2 + panOffset[1], w, h];
  }, [focusState, states, zoomScale, panOffset]);

  // Drag-to-pan with click-vs-drag disambiguation (same approach as
  // ChoroplethMap - we delay setPointerCapture until after the drag
  // threshold so the underlying state click still fires on a tap).
  const DRAG_THRESHOLD = 5;
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number; startY: number; px: number; py: number;
    moved: boolean; pointerId: number;
  } | null>(null);
  const didDragRef = useRef(false);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoomScale((z) => Math.min(40, Math.max(1, z * factor)));
  }, []);
  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      px: panOffset[0], py: panOffset[1],
      moved: false, pointerId: e.pointerId,
    };
    didDragRef.current = false;
  }, [panOffset]);
  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    if (!dragRef.current.moved) {
      svgRef.current.setPointerCapture(dragRef.current.pointerId);
      setDragging(true);
    }
    dragRef.current.moved = true;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = viewBox[2] / rect.width;
    setPanOffset([dragRef.current.px - dx * scale, dragRef.current.py - dy * scale]);
  }, [viewBox]);
  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (svgRef.current?.hasPointerCapture?.(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
    didDragRef.current = !!dragRef.current?.moved;
    dragRef.current = null;
    setDragging(false);
  }, []);
  const guardedClick = useCallback(
    <T,>(fn: (arg: T) => void) =>
      (arg: T) => { if (!didDragRef.current) fn(arg); },
    []
  );

  const onStateClick = (f: GeoFeature) => {
    const code = isoToStateCode(f.properties.iso);
    if (!code) return;
    onFocusState({ code, name: f.properties.name });
  };

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox.join(' ')}
      className="w-full h-full select-none touch-none"
      preserveAspectRatio="xMidYMid meet"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
    >
      <defs>
        <linearGradient id="ng-land" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fbf6" />
          <stop offset="100%" stopColor="#eef4ea" />
        </linearGradient>
        <filter id="ng-shadow" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
          <feOffset dx="0" dy="1" />
          <feComponentTransfer><feFuncA type="linear" slope="0.25" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect
        x={NIGERIA_BBOX.lngMin}
        y={NIGERIA_BBOX.latMin}
        width={W}
        height={H}
        fill="#e6eef5"
      />

      {country && (
        <path
          d={featureToPath(country)}
          fill="url(#ng-land)"
          stroke="none"
          filter="url(#ng-shadow)"
        />
      )}

      {states.map((s) => {
        const code = isoToStateCode(s.properties.iso);
        const isFocused = !!focusState && focusState.code === code;
        const isOtherFocused = !!focusState && !isFocused;
        return (
          <path
            key={s.properties.iso ?? s.properties.name}
            d={featureToPath(s)}
            fill={isFocused ? '#dbeafe' : 'transparent'}
            fillOpacity={isOtherFocused ? 0.1 : 1}
            stroke={isFocused ? '#1d4ed8' : '#94a3b8'}
            strokeWidth={isFocused ? 1.4 : 0.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ cursor: focusState ? 'default' : 'pointer' }}
            onClick={focusState ? undefined : guardedClick(() => onStateClick(s))}
          >
            <title>{s.properties.name}</title>
          </path>
        );
      })}

      {country && (
        <path
          d={featureToPath(country)}
          fill="none"
          stroke="#475569"
          strokeWidth={1.4}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {units.map((u) => (
        <circle
          key={u.pu_code}
          cx={toX(u.coordinates.lng)}
          cy={toY(u.coordinates.lat)}
          r={focusState ? 4 : 5}
          fill={STATUS_COLOURS[u.status]}
          stroke="#0f172a"
          strokeOpacity={0.2}
          strokeWidth={0.5}
          style={{ cursor: 'pointer' }}
          onClick={guardedClick(() => onSelect(u))}
        >
          <title>
            {u.pu_name} — {STATUS_LABEL[u.status]}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function PUDetailPane({ unit }: { unit: PollingUnitDetail | null }) {
  if (!unit) {
    return (
      <div className="p-6 text-sm text-slate-500">
        Click a state to zoom in, then click a polling unit to see its EC8A submissions,
        extracted figures, and verification status.
      </div>
    );
  }
  return (
    <div className="p-5">
      <div className="text-xs uppercase text-slate-500 tracking-wider">{unit.state_code}</div>
      <h2 className="font-semibold text-lg leading-tight">{unit.pu_name}</h2>
      <div className="mt-1 text-xs text-slate-500">PU {unit.pu_code}</div>

      <div
        className="mt-3 inline-flex items-center gap-2 px-2 py-1 rounded text-xs font-medium"
        style={{ background: STATUS_COLOURS[unit.status] + '33', color: '#0f172a' }}
      >
        <span className="status-dot" style={{ background: STATUS_COLOURS[unit.status] }} />
        {STATUS_LABEL[unit.status]}
      </div>

      <a
        href={`/en/pu/${encodeURIComponent(unit.pu_code)}`}
        className="mt-3 text-xs text-blue-700 hover:underline inline-block"
      >
        Open full polling unit detail →
      </a>

      <div className="mt-4 text-sm space-y-2">
        <div className="flex justify-between">
          <span className="text-slate-500">Submissions</span>
          <span>{unit.submission_count}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Independent sources</span>
          <span>{unit.source_count}</span>
        </div>
      </div>

      {unit.consensus_data && (
        <div className="mt-4">
          <div className="font-medium text-sm">Consensus result</div>
          <table className="w-full mt-2 text-sm">
            <tbody>
              {Object.entries(unit.consensus_data.candidate_votes).map(([p, v]) => (
                <tr key={p} className="border-b last:border-0">
                  <td className="py-1">{p}</td>
                  <td className="py-1 text-right tabular-nums">{v.toLocaleString()}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1 text-slate-500">Total valid</td>
                <td className="py-1 text-right tabular-nums">
                  {unit.consensus_data.total_valid_votes.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-slate-500">Rejected</td>
                <td className="py-1 text-right tabular-nums">
                  {unit.consensus_data.rejected_ballots.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
