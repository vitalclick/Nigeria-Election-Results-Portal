import { NextRequest } from 'next/server';

import { jsonOk } from '@/lib/api';
import { isMockMode, mockPollingUnits } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const state = req.nextUrl.searchParams.get('state');
  if (isMockMode()) {
    const all = mockPollingUnits();
    return jsonOk(state ? all.filter((u) => u.state_code === state) : all);
  }
  let q = supabaseAdmin().from('v_pu_live_status').select('*').eq('election_id', params.id);
  if (state) q = q.eq('state_code', state);
  const { data, error } = await q.limit(5000);
  if (error) return jsonOk([]);
  return jsonOk(data ?? []);
}
