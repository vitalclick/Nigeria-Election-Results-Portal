// Registered Nigerian political parties used by the dashboard.
//
// Colours are chosen to be visually distinct on the state-level
// choropleth; they are NOT a complete or official rendering of each
// party's brand palette. Seat counts are computed proportionally so
// the demo dashboard reads like a House of Representatives result.

export interface Party {
  code: string;
  name: string;
  color: string;
}

export const PARTIES: Party[] = [
  { code: 'APC',     name: 'All Progressives Congress',       color: '#1d4ed8' },
  { code: 'PDP',     name: 'Peoples Democratic Party',        color: '#dc2626' },
  { code: 'LP',      name: 'Labour Party',                    color: '#16a34a' },
  { code: 'NNPP',    name: 'New Nigeria Peoples Party',       color: '#ea580c' },
  { code: 'APGA',    name: 'All Progressives Grand Alliance', color: '#7c3aed' },
  { code: 'ADC',     name: 'African Democratic Congress',     color: '#0891b2' },
  { code: 'SDP',     name: 'Social Democratic Party',         color: '#facc15' },
  { code: 'YPP',     name: 'Young Progressive Party',         color: '#db2777' },
  { code: 'PRP',     name: 'Peoples Redemption Party',        color: '#65a30d' },
  { code: 'AAC',     name: 'African Action Congress',         color: '#475569' },
];

export const PARTY_BY_CODE: Record<string, Party> = Object.fromEntries(
  PARTIES.map((p) => [p.code, p])
);

// Seat counts for each legislative election type. Presidential and
// gubernatorial elections are winner-take-all so they have no seat
// allocation - SEATS_BY_ELECTION returns null in those cases.
export const SEATS_BY_ELECTION: Record<string, number | null> = {
  presidential: null,
  governorship: null,
  senate: 109,         // 3 per state x 36 + 1 for FCT
  reps: 360,           // House of Representatives
  stha: 990,           // State Houses of Assembly across all 36 states
};

export function seatTotalForElection(slug: string): number | null {
  return SEATS_BY_ELECTION[slug] ?? null;
}
