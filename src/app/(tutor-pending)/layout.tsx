import { SiteShell } from "@/components/layout/site-shell";

/**
 * `/tutor/pending-approval` lives in its own group so it gets the public site
 * shell (header + full footer, SPEC §10.3) instead of the tutor app shell. A
 * tutor waiting on approval has no dashboard to be inside: the app shell's
 * sidebar would link to pages they can't open, and the incoming-request
 * subscription the (tutor) layout mounts can never fire for them (only tutors
 * in `live_tutors`, which requires approval, can be sent a request).
 *
 * The page itself still guards role = tutor and checks approval, so moving it
 * out of the (tutor) group changed no authorization.
 */
export default function TutorPendingLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
