// Sentry server-side initialisation. Runs inside the Next.js server
// process, captures exceptions raised in /api/v1/* route handlers and
// during SSR.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    release: process.env.BUILD_SHA || process.env.NEXT_PUBLIC_BUILD_SHA,
    tracesSampleRate: 0.05,
  });
}
