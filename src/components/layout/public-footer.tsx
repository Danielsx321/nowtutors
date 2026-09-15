import Link from "next/link";
import { Wordmark } from "@/components/layout/wordmark";

/**
 * Only routes that exist are linked. How it works, Pricing, FAQ, Terms and
 * Privacy were linked here before they were built and 404'd; they come back
 * with the pages in Phase 10 (PROGRESS).
 */
const columns: { heading: string; links: { label: string; href: string }[] }[] =
  [
    {
      heading: "Learn",
      links: [
        { label: "Find tutors", href: "/tutors" },
        { label: "Live now", href: "/live" },
      ],
    },
    {
      heading: "Get started",
      links: [
        { label: "Sign up", href: "/signup" },
        { label: "Log in", href: "/login" },
        { label: "Teach on NowTutors", href: "/signup" },
      ],
    },
  ];

/**
 * A dark island (docs/DESIGN.md): `.theme-dark` re-resolves every role inside,
 * so the links, the hairlines and the focus ring are all the dark theme's and
 * the components below know nothing about it.
 */
export function PublicFooter() {
  return (
    <footer className="theme-dark border-t border-border bg-surface text-text">
      <div className="grid gap-8 px-4 py-12 sm:grid-cols-2 md:grid-cols-3 md:px-6">
        <div className="space-y-3">
          <Wordmark tone="onDark" size="sm" />
          <p className="max-w-xs text-small text-text-muted">
            Live tutoring, on demand. Find a tutor and start learning now.
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading} className="space-y-3">
            <p className="text-small font-semibold text-text">{col.heading}</p>
            <ul className="space-y-2">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="focus-ring rounded-sm text-small text-text-muted hover:text-text hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="flex flex-col items-center justify-between gap-2 px-4 py-4 text-caption text-text-muted sm:flex-row md:px-6">
          <p>© {new Date().getFullYear()} NowTutors. All rights reserved.</p>
          <p>Made for learners everywhere.</p>
        </div>
      </div>
    </footer>
  );
}
