import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getTutorEarningsBreakdown } from "@/db/queries/withdrawals";
import { EarningsBreakdown } from "@/components/features/tutor/earnings-breakdown";

export const metadata = { title: "Earnings · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/earnings`: held / available / withdrawn breakdown (SPEC §6, §7.11;
 * Phase 8 Part 2). Read-only; the tutor id comes from the guard.
 */
export default async function TutorEarningsPage() {
  const { user } = await requireRole("tutor");

  const [breakdown, [me]] = await Promise.all([
    getTutorEarningsBreakdown(user.id),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Earnings</h1>
        <p className="mt-1 text-body text-text-muted">
          What you&apos;ve earned per session, after the platform fee.
        </p>
      </div>
      <EarningsBreakdown breakdown={breakdown} timeZone={me?.timezone ?? "UTC"} />
    </div>
  );
}
