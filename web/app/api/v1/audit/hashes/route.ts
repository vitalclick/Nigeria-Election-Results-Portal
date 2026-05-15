import { NextRequest } from 'next/server';

import { isMockMode } from '@/lib/mock-data';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Downloadable hash manifest for an election.
// Returns CSV so it can be diffed by auditors with standard tooling.

export async function GET(req: NextRequest) {
  const electionId = req.nextUrl.searchParams.get('election_id') ?? '2027-presidential';

  if (isMockMode()) {
    const rows = [
      'submission_id,pu_code,party,image_sha256,submitted_at',
      `s-demo-0001,25-11-04-007,APC,${'a'.repeat(64)},2027-02-27T17:43:22Z`,
      `s-demo-0002,25-11-04-007,LP,${'b'.repeat(64)},2027-02-27T17:51:09Z`,
    ].join('\n');
    return new Response(rows, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="openballot-hashes-${electionId}.csv"`,
      },
    });
  }

  const { data } = await supabaseAdmin()
    .from('ec8a_submissions')
    .select('id, pu_code, party_code, image_sha256, submitted_at')
    .eq('election_id', electionId);

  const rows = [
    'submission_id,pu_code,party,image_sha256,submitted_at',
    ...(data ?? []).map(
      (r) => `${r.id},${r.pu_code},${r.party_code ?? ''},${r.image_sha256},${r.submitted_at}`
    ),
  ].join('\n');

  return new Response(rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="openballot-hashes-${electionId}.csv"`,
    },
  });
}
