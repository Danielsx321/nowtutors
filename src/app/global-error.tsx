"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { tokens } from "@/lib/design/tokens";

/**
 * The last resort (Phase 10 Part 5): shown when the root layout itself fails,
 * so no stylesheet, font or component around it can be relied on. It renders
 * its own `<html>`, styles itself inline from `tokens.ts` (one palette), and
 * offers a reload and a plain link home. Reported to Sentry like the rest.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const c = {
    ground: tokens.ground.light,
    text: tokens.text.light,
    muted: tokens["text-muted"].light,
    button: tokens.band.light,
    onButton: tokens["on-primary"].light,
    link: tokens.accent.light,
  };

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: c.ground,
          color: c.text,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: 16,
        }}
      >
        <main role="alert" style={{ maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 22, fontWeight: 700, margin: "0 0 20px", letterSpacing: "-0.02em" }}>nowtutors</p>
          <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: "0 0 12px" }}>NowTutors didn&rsquo;t load</h1>
          <p style={{ fontSize: 16, lineHeight: 1.55, color: c.muted, margin: "0 0 24px" }}>
            Something on our side broke. Nothing you did caused it. Try again, and if it keeps happening, come back in
            a few minutes.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: c.button,
              color: c.onButton,
              border: 0,
              borderRadius: 999,
              padding: "12px 22px",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: 18 }}>
            {/* A full page load on purpose: the root layout failed, so the client router can't be trusted. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: c.link }}>
              Go to the home page
            </a>
          </p>
          {error.digest ? (
            <p style={{ fontSize: 13, color: c.muted, marginTop: 18 }}>Reference for support: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
