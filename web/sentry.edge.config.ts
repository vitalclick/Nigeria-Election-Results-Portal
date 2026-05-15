// Sentry edge-runtime initialisation. Covers middleware + edge route
// handlers. We don't currently run anything on the edge runtime; this
// file exists so @sentry/nextjs auto-instrumentation finds the
// expected config triple (client/server/edge).

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: 0.05,
  });
}
