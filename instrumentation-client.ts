import * as Sentry from "@sentry/nextjs";

// Client-side Sentry. The browser bundle cannot read the server-only
// SENTRY_DSN, so the client gates on the public NEXT_PUBLIC_SENTRY_DSN.
// Unset => no-op (nothing breaks locally or in preview).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
