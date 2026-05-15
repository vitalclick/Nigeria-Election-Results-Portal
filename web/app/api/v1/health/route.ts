import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
    timestamp: new Date().toISOString(),
  });
}
