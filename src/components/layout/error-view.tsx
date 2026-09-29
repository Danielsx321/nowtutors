"use client";

import * as React from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * What an `error.tsx` shows (Phase 10 Part 5). Until now a thrown error in any
 * page fell through to Next's own blank screen with no way back.
 *
 * - Plain words, no stack, no "something went wrong" on its own: it says the
 *   fault is ours and what to do next.
 * - "Try again" re-renders the segment (`reset`), which is enough for the
 *   usual cause, a database or network blip.
 * - The area's home is the second way out, so a page that fails twice is
 *   never a dead end.
 * - The error goes to Sentry from the browser (a no-op without a DSN). Server
 *   errors are already reported by `onRequestError` in `instrumentation.ts`;
 *   `digest` ties the two together and is shown so support can find it.
 */
export function ErrorView({
  error,
  reset,
  message,
  home,
  extra,
  headingLevel = 1,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** One sentence about this area, after the heading. */
  message: string;
  home: { href: string; label: string };
  /** An area-specific line, e.g. that a session keeps running. */
  extra?: React.ReactNode;
  headingLevel?: 1 | 2;
}) {
  React.useEffect(() => {
    Sentry.captureException(error);
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center px-4 py-16">
      <EmptyState
        role="alert"
        headingLevel={headingLevel}
        icon={<RefreshCw className="size-6" />}
        title="This page didn't load"
        description={
          <>
            {message} Nothing you did caused it.
            {extra ? <span className="mt-2 block">{extra}</span> : null}
            {error.digest ? (
              <span className="mt-3 block text-small">
                Reference for support: <span data-numeric>{error.digest}</span>
              </span>
            ) : null}
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button variant="primary" onClick={() => reset()}>
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href={home.href}>{home.label}</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
