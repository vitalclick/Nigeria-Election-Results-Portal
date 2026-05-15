// Sentry client-side initialisation.
// Only runs when NEXT_PUBLIC_SENTRY_DSN is configured; the production
// build inlines that env var so misconfigured deploys do not silently
// drop errors.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'production',
    release: process.env.NEXT_PUBLIC_BUILD_SHA,
    tracesSampleRate: 0.05,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 0.0,
    // Drop personal information from event payloads. Agents' phone
    // numbers + the device fingerprint travel through the client; we
    // don't want them in Sentry breadcrumbs.
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['x-device-fingerprint'];
        delete event.request.headers['authorization'];
      }
      return event;
    },
  });
}
