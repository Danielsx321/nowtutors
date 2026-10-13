import { requireRole } from "@/lib/auth/guards";
import { getPendingTutors, getChangedTutors, getOnHoldTutors, getResubmittedTutors } from "@/db/queries/admin-tutors";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  PendingCard,
  ChangedCard,
  OnHoldCard,
  QueueEmpty,
  type QueueTutor,
} from "@/components/features/admin/tutor-queue";

export const metadata = { title: "Tutor approvals · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * Admin approval queue (SPEC §6). Four views: applications awaiting a first
 * decision; tutors who were put on hold and have saved since (Resubmitted,
 * tutor-request-changes); tutors on hold still waiting on the tutor; and
 * approved tutors who changed a MATERIAL field since their last review (§4.1),
 * who stay live and bookable; that last one is a follow-up check, not a gate.
 *
 * Guarded here AND independently re-checked inside every action (§5 Layer 2).
 * Approval emails are Phase 10 — the actions carry the marked hook.
 */
export default async function AdminTutorsPage() {
  await requireRole("admin");

  const [pending, resubmitted, onHold, changed] = await Promise.all([
    getPendingTutors(),
    getResubmittedTutors(),
    getOnHoldTutors(),
    getChangedTutors(),
  ]);

  const serialize = (t: Awaited<ReturnType<typeof getPendingTutors>>[number]): QueueTutor => ({
    userId: t.userId,
    slug: t.slug,
    displayName: t.displayName,
    email: t.email,
    avatarUrl: t.avatarUrl,
    country: t.country,
    headline: t.headline,
    about: t.about,
    introVideoUrl: t.introVideoUrl,
    education: t.education,
    yearsExperience: t.yearsExperience,
    languages: t.languages,
    hourlyRateCredits: t.hourlyRateCredits,
    approvalNote: t.approvalNote,
    subjects: t.subjects,
    profileChangedAt: t.profileChangedAt?.toISOString() ?? null,
    profileReviewedAt: t.profileReviewedAt?.toISOString() ?? null,
  });

  return (
    <div className="w-full py-2">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Tutor approvals</h1>
        <p className="text-body text-text-muted">
          Review new applications, fixes from tutors on hold, and profiles that changed since their last review.
        </p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending
            {pending.length > 0 && (
              <Badge variant="accent" className="ml-2">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="resubmitted">
            Resubmitted
            {resubmitted.length > 0 && (
              <Badge variant="accent" className="ml-2">
                {resubmitted.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="on-hold">
            On hold
            {onHold.length > 0 && (
              <Badge variant="warning" className="ml-2">
                {onHold.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="changed">
            Edited since review
            {changed.length > 0 && (
              <Badge variant="warning" className="ml-2">
                {changed.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pending.length === 0 ? (
            <QueueEmpty label="No applications waiting" />
          ) : (
            <div className="grid gap-4">
              {pending.map((t) => (
                <PendingCard key={t.userId} tutor={serialize(t)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resubmitted">
          {resubmitted.length === 0 ? (
            <QueueEmpty label="No fixes waiting" />
          ) : (
            <div className="grid gap-4">
              {resubmitted.map((t) => (
                <PendingCard key={t.userId} tutor={serialize(t)} resubmitted />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="on-hold">
          {onHold.length === 0 ? (
            <QueueEmpty label="Nobody on hold" />
          ) : (
            <div className="grid gap-4">
              {onHold.map((t) => (
                <OnHoldCard key={t.userId} tutor={serialize(t)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="changed">
          {changed.length === 0 ? (
            <QueueEmpty label="Nothing changed since last review" />
          ) : (
            <div className="grid gap-4">
              {changed.map((t) => (
                <ChangedCard key={t.userId} tutor={serialize(t)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
