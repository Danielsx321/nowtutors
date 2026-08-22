import { requireRole } from "@/lib/auth/guards";
import { getTutorLiveState } from "@/db/queries/presence";
import { GoLiveToggle } from "@/components/features/tutor/go-live-toggle";

export const metadata = { title: "Overview · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor` — the tutor's overview, and the home the role guard sends tutors to
 * (`homeFor.tutor`). It had no page until now, which is why signing in as an
 * approved tutor 404'd in production (PROGRESS.md); Phase 6 Part 1 gives it one
 * because the go-live toggle (SPEC §7.5) has to live here.
 *
 * Deliberately thin: the availability toggle and nothing else. Earnings,
 * upcoming sessions and the request inbox belong to later phases, and a
 * placeholder dashboard would be scope this phase wasn't asked for.
 *
 * requireRole('tutor') re-checks role + approval (§5 Layer 2) independently of
 * the layout, and the toggle's action guards again on every call.
 */
export default async function TutorOverviewPage() {
  const { user } = await requireRole("tutor");
  const live = await getTutorLiveState(user.id);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-h1 font-bold text-gray-700">Overview</h1>
        <p className="text-body text-gray-500">
          Go live when you&apos;re free right now — students browsing Live now
          can send you an instant session request.
        </p>
      </div>

      <GoLiveToggle initialLive={live?.isLive ?? false} />

      <p className="mt-4 text-small text-gray-500">
        Your availability turns itself off if this tab closes or your connection
        drops, so you can&apos;t be left showing as live when you aren&apos;t.
      </p>
    </div>
  );
}
