import { requireRole } from "@/lib/auth/guards";

export const metadata = { title: "Overview · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor` — the tutor's overview, and the home the role guard sends tutors to
 * (`homeFor.tutor`). It had no page until now, which is why signing in as an
 * approved tutor 404'd in production (PROGRESS.md); Phase 6 Part 1 gives it one
 * because the go-live toggle (SPEC §7.5) has to live here.
 *
 * Thin on purpose: the go-live switch moved into the topbar in design overhaul
 * Part 2, so it is reachable from every tutor page. Part 5 turns this page into
 * the Today feed (requests, unanswered messages, today's sessions, next steps).
 *
 * requireRole('tutor') re-checks role + approval (§5 Layer 2) independently of
 * the layout, and the toggle's action guards again on every call.
 */
export default async function TutorOverviewPage() {
  await requireRole("tutor");

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="space-y-1">
        <h1 className="font-display text-h1 font-semibold text-text">Today</h1>
        <p className="text-body text-text-muted">
          Use the switch in the top bar to go live. Students browsing Live now
          can then see you and send an instant session request.
        </p>
      </div>

      <p className="mt-6 text-small text-text-muted">
        Your availability turns itself off if this tab closes or your connection
        drops, so you can&apos;t be left showing as live when you aren&apos;t.
      </p>
    </div>
  );
}
