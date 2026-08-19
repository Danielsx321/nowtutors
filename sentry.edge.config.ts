import * as Sentry from "@sentry/nextjs";

// Edge-runtime Sentry (middleware, edge routes). No-op without a DSN.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1,
  });
}
