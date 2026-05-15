// Shared API helpers used by both server and client components.

import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    { data, error: null },
    { ...init, headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=15' } }
  );
}

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

// Rate limit by IP for the public read API. The map embedders are heavy
// consumers so the limit is generous; abuse triggers Cloudflare.
const RATE_LIMIT_PER_MINUTE = 240;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return { ok: true, remaining: RATE_LIMIT_PER_MINUTE - 1 };
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= RATE_LIMIT_PER_MINUTE,
    remaining: Math.max(0, RATE_LIMIT_PER_MINUTE - bucket.count),
  };
}
