import { SiteShell } from "@/components/layout/site-shell";

/**
 * Public pages that look something up by URL and must answer a real 404 when it
 * is missing: today `/tutors/[slug]`. Same shell as `(public)` (SPEC §10.3), one
 * difference: **no `loading.tsx` in this group, ever.**
 *
 * Why: Next decides the status code when it flushes the shell. A `loading.tsx`
 * puts the page behind a Suspense boundary, so the shell (header, spinner,
 * footer) goes out with a 200 before the page has run, and a `notFound()`
 * thrown after that can only swap the spinner for the not-found view; the 200
 * is already on the wire. That was production until 2026-10-07: a missing slug
 * returned 200 with `<meta name="robots" content="noindex">`. With no boundary
 * above the page the error reaches Next's shell render and the response is a
 * 404 (`tests/unit/public-lookup-404.test.ts` pins the layout). The cost is the
 * instant loading ring on client navigation to a profile; the top progress bar
 * (`NavigationProgress`) still runs.
 */
export default function PublicLookupLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
