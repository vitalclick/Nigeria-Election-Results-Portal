import { NextRequest } from 'next/server';

import { mockPollingUnits } from '@/lib/mock-data';
import type { VerificationStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-Sent Events stream of verification status updates.
// In production this is wired to Supabase Realtime on the `verified_results`
// table and re-broadcasts row-level CDC events as SSE so the public map and
// any embedders receive sub-second updates.
//
// The mock implementation emits a random update every 4 seconds so the
// scaffolded map demonstrably moves during a demo.

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`: stream open for ${params.id}\n\n`));

      const id = setInterval(() => {
        const units = mockPollingUnits();
        const u = units[Math.floor(Math.random() * units.length)];
        const statuses: VerificationStatus[] = [
          'consensus',
          'inec_confirmed',
          'discrepancy',
          'inec_conflict',
        ];
        const next = statuses[Math.floor(Math.random() * statuses.length)];
        const payload = JSON.stringify({ pu_code: u.pu_code, status: next });
        controller.enqueue(encoder.encode(`event: verified_result\ndata: ${payload}\n\n`));
      }, 4_000);

      const heartbeat = setInterval(
        () => controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)),
        15_000
      );

      const close = () => {
        clearInterval(id);
        clearInterval(heartbeat);
      };
      // No abort signal handler available in this scope; the ReadableStream
      // is cancelled by the client closing EventSource, which GCs.
      return close;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
