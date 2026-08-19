import * as Sentry from "@sentry/nextjs";

// Server-side Sentry. Only initializes when a DSN is present, so a blank
// SENTRY_DSN is a no-op (local dev and preview builds are unaffected).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1,
  });
}
