import * as React from "react";
import Link from "next/link";
import { ShieldCheck, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/layout/wordmark";

export interface SiteFooterProps {
  /** Tutors live right now, from `getLiveStrip`. Rendered server-side. */
  liveCount: number;
  /** Where the signed-in viewer's home is, if there is one. */
  viewerHome?: string | null;
}

/**
 * The columns. Every href must be a route the app serves (SPEC §10.3), and
 * `tests/dom/site-footer.test.tsx` checks each one against `lib/routes.ts`.
 * Terms and Privacy arrive with Phase 10 and are deliberately absent until the
 * pages exist.
 */
const columns = [
  {
    heading: "Learn",
    links: [
      { label: "Find tutors", href: "/tutors" },
      { label: "Live now", href: "/live" },
    ],
  },
  {
    heading: "Teach",
    links: [
      { label: "Become a tutor", href: "/signup" },
      { label: "Tutor log in", href: "/login" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Sign up", href: "/signup" },
    ],
  },
] as const;

/**
 * The site footer (DESIGN.md v2, Part 0 mockup): brand, the real live count,
 * two actions, three link columns and the trust pair, then a bottom bar. It is
 * a dark island, so `.theme-dark` re-resolves every role inside it and the
 * components below know nothing about the theme.
 *
 * It renders on every public-facing page, including log in, sign up,
 * onboarding, suspended, pending approval and the 404.
 */
export function SiteFooter({ liveCount, viewerHome }: SiteFooterProps) {
  return (
    <footer className="theme-dark bg-surface text-text">
      <div className="mx-auto max-w-[var(--container-page)] px-4 md:px-6">
        <div className="grid gap-10 border-b border-border pb-10 pt-14 lg:grid-cols-[1.1fr_1.9fr]">
          <div>
            <Wordmark tone="onDark" size="sm" />
            <p className="mb-5 mt-4 max-w-[34ch] text-body text-text-muted">
              Live tutoring, on demand. Find a real tutor who&apos;s online and start
              learning in the next minute.
            </p>
            <p className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-small">
              {liveCount > 0 ? (
                <>
                  <span
                    aria-hidden="true"
                    className="animate-pulse-live size-2 rounded-full bg-live"
                  />
                  <span data-numeric>
                    {liveCount} {liveCount === 1 ? "tutor" : "tutors"} live right now
                  </span>
                </>
              ) : (
                <span className="text-text-muted">No tutors live right now</span>
              )}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button asChild variant="primary" size="sm">
                <Link href="/tutors">Find a live tutor</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/signup">Become a tutor</Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {columns.map((col) => (
              <nav key={col.heading} aria-label={col.heading}>
                <h2 className="mb-3.5 font-sans text-caption font-semibold uppercase tracking-[0.1em] text-text">
                  {col.heading}
                </h2>
                <ul className="grid gap-2.5 text-body">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="focus-ring rounded-sm text-text-muted hover:text-text"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  {col.heading === "Account" && viewerHome ? (
                    <li>
                      <Link
                        href={viewerHome}
                        className="focus-ring rounded-sm text-text-muted hover:text-text"
                      >
                        Dashboard
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </nav>
            ))}

            <div>
              <h2 className="mb-3.5 font-sans text-caption font-semibold uppercase tracking-[0.1em] text-text">
                Trust
              </h2>
              <ul className="grid gap-2.5 text-body text-text-muted">
                <li className="flex items-start gap-2">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                  No-show promise
                </li>
                <li className="flex items-start gap-2">
                  <CreditCard aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                  Secure payment via PayPal
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6 text-small text-text-muted">
          <p>© {new Date().getFullYear()} NowTutors. Made for learners everywhere.</p>
          <p>Live tutoring in your browser.</p>
        </div>
      </div>
    </footer>
  );
}
