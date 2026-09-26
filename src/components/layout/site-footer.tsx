import * as React from "react";
import Link from "next/link";
import { ShieldCheck, CreditCard } from "lucide-react";
import { Wordmark } from "@/components/layout/wordmark";

export interface SiteFooterProps {
  /** Tutors live right now, from `getLiveTutorCount`. Read on the server. */
  liveCount: number;
  /** Where the signed-in viewer's home is, if there is one. */
  viewerHome?: string | null;
}

/**
 * The columns (DESIGN.md v3, design round 3 Part B; the shape is Oranum's
 * three-column footer). Every href must be a route the app serves (SPEC
 * §10.3), and `tests/dom/site-footer.test.tsx` checks each one against
 * `lib/routes.ts`. A Legal column (Terms, Privacy, Refunds) arrives with
 * Phase 10 and is deliberately absent until the pages exist; the trust pair
 * holds that place.
 */
const columns = [
  {
    heading: "For tutors",
    links: [
      { label: "Become a tutor", href: "/signup" },
      { label: "Tutor log in", href: "/login" },
      { label: "Go live", href: "/tutor" },
    ],
  },
  {
    heading: "Help",
    links: [
      { label: "Find a live tutor", href: "/tutors?live=1" },
      { label: "All tutors", href: "/tutors" },
      { label: "Live lessons", href: "/live" },
      { label: "Log in", href: "/login" },
      { label: "Sign up", href: "/signup" },
    ],
  },
] as const;

/**
 * The site footer (v3): brand and the real live count, two link columns and
 * the trust pair, then a bottom bar. It is a dark island, so `.theme-dark`
 * re-resolves every role inside it and the components below know nothing
 * about the theme. Navy, like the header.
 *
 * It renders on every public-facing page, including log in, sign up,
 * onboarding, suspended, pending approval and the 404.
 */
export function SiteFooter({ liveCount, viewerHome }: SiteFooterProps) {
  return (
    <footer className="theme-dark bg-ground text-text">
      <div className="mx-auto max-w-[1360px] px-4 md:px-6">
        <div className="grid gap-10 border-b border-border pb-10 pt-12 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Wordmark tone="onDark" size="sm" />
            <p className="mb-5 mt-4 max-w-[34ch] text-body text-text-muted">
              Live one-to-one tutoring, on your schedule or this minute. Pay in
              credits, get a session or your credits back.
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
          </div>

          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="mb-3.5 font-sans text-small font-semibold text-text">{col.heading}</h2>
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
                {col.heading === "Help" && viewerHome ? (
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
            <h2 className="mb-3.5 font-sans text-small font-semibold text-text">Trust</h2>
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

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6 text-small text-text-muted">
          <p>© {new Date().getFullYear()} NowTutors. Made for learners everywhere.</p>
          <p>Sessions run in your browser. No app to install.</p>
        </div>
      </div>
    </footer>
  );
}
