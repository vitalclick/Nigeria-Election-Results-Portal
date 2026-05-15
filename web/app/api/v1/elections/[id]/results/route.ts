import { NextRequest } from 'next/server';

import { jsonOk } from '@/lib/api';
import { isMockMode, mockNationalRollup } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  if (isMockMode()) return jsonOk(mockNationalRollup());

  const { data, error } = await supabaseAdmin()
    .from('v_national_rollup')
    .select('*')
    .eq('election_id', params.id)
    .maybeSingle();
  if (error || !data) return jsonOk(mockNationalRollup());
  return jsonOk({ ...data, last_updated: new Date().toISOString() });
}
