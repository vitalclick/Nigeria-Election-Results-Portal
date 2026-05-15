import { NextRequest } from 'next/server';

import { jsonOk } from '@/lib/api';
import { isMockMode } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  if (isMockMode()) {
    return jsonOk([
      {
        id: '2027-presidential',
        election_type: 'presidential',
        scope: 'national',
        election_date: '2027-02-27',
        status: 'upcoming',
      },
      {
        id: '2026-edo-gov',
        election_type: 'governorship',
        scope: 'ED',
        election_date: '2026-09-19',
        status: 'concluded',
      },
    ]);
  }
  const { data, error } = await supabaseAdmin()
    .from('elections')
    .select('id, election_type, scope, election_date, status')
    .order('election_date', { ascending: false });
  if (error) return jsonOk([], { status: 200 });
  return jsonOk(data ?? []);
}
