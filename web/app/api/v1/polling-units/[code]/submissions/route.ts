import { NextRequest } from 'next/server';

import { jsonOk } from '@/lib/api';
import { isMockMode, mockDiscrepancies } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

interface Params { params: { code: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  if (isMockMode()) {
    const hit = mockDiscrepancies().find((d) => d.pu_code === params.code);
    return jsonOk(hit?.submissions ?? []);
  }
  const { data, error } = await supabaseAdmin()
    .from('ec8a_submissions')
    .select(
      'id, source_type, party_code, image_url, image_sha256, extracted_data, submitted_at, confidence_score, validation_flags'
    )
    .eq('pu_code', params.code)
    .in('review_status', ['auto_approved', 'reviewed_accepted'])
    .order('submitted_at', { ascending: false });
  if (error) return jsonOk([]);
  return jsonOk(data ?? []);
}
