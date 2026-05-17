import { NextRequest } from 'next/server';

import { jsonOk } from '@/lib/api';
import { isMockMode } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Party reference list for the public map's choropleth: each region
// polygon and each polling-unit dot is filled with the leading
// party's brand colour, so the client needs a (code -> colour) map.
//
// The `parties` table is seeded once and rarely changes between
// elections (party de-registrations / new entrants are infrequent),
// so this endpoint is cache-friendly. The client fetches it on map
// mount and falls back to a hard-coded palette if the request fails.
export async function GET(_req: NextRequest) {
  if (isMockMode()) {
    return jsonOk(MOCK_PARTIES);
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('parties')
    .select('code, name, colour_hex, inec_registered')
    .order('code');

  if (error || !data) {
    return jsonOk(MOCK_PARTIES);  // fail open with the well-known list
  }

  return jsonOk(
    data.map((p) => ({
      code: p.code as string,
      name: p.name as string,
      colour_hex: (p.colour_hex as string | null) ?? null,
      inec_registered: Boolean(p.inec_registered),
    }))
  );
}

// Fallback used when the DB is unreachable or running in mock mode.
// Colours mirror db/seed/01_geo_seed.sql; keep in sync.
const MOCK_PARTIES = [
  { code: 'APC',  name: 'All Progressives Congress',   colour_hex: '#1f4e9c', inec_registered: true },
  { code: 'PDP',  name: 'Peoples Democratic Party',    colour_hex: '#c0392b', inec_registered: true },
  { code: 'LP',   name: 'Labour Party',                colour_hex: '#2ecc71', inec_registered: true },
  { code: 'NNPP', name: 'New Nigeria Peoples Party',   colour_hex: '#f39c12', inec_registered: true },
  { code: 'ADC',  name: 'African Democratic Congress', colour_hex: '#8e44ad', inec_registered: true },
];
