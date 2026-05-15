import { NextRequest } from 'next/server';

import { jsonOk } from '@/lib/api';
import { isMockMode, mockDiscrepancies } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const electionId = req.nextUrl.searchParams.get('election_id') ?? '2027-presidential';
  if (isMockMode()) return jsonOk(mockDiscrepancies());

  const { data, error } = await supabaseAdmin()
    .from('v_discrepancy_register')
    .select('*')
    .eq('election_id', electionId)
    .order('detected_at', { ascending: false })
    .limit(500);
  if (error) return jsonOk([]);
  return jsonOk(data ?? []);
}
