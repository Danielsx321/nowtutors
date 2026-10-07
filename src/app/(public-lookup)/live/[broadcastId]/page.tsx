import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/guards";
import { getBroadcastPage } from "@/db/queries/broadcasts";
import { agoraUid } from "@/lib/agora/uid";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LiveChip } from "@/components/ui/live-chip";
import { BroadcastEnded, ViewerStage } from "@/components/features/broadcasts/viewer-stage";

export const metadata = { title: "Live broadcast · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/live/[broadcastId]` — the viewer page (SPEC §6, §7.8; Phase 9 Part 3).
 *
 * Public, but watching requires sign-in (Q4): a signed-out visitor sees the
 * title, the tutor and a sign-in button. A broadcast that has ended, or whose
 * host has gone stale, says so instead of mounting the player. The host is sent
 * to their own host view. The token route re-checks all of it before issuing a
 * subscriber token.
 *
 * Design overhaul Part 4: the page body is a dark band (`.theme-dark`) under the
 * light site header, like a room. Video on the left, the class and the tutor on
 * the right from `lg`. There is no chat: that is its own phase.
 */
export default async function LiveBroadcastPage({
  params,
}: {
  params: Promise<{ broadcastId: string }>;
}) {
  const { broadcastId } = await params;
  if (!z.string().uuid().safeParse(broadcastId).success) notFound();
  const broadcast = await getBroadcastPage(broadcastId);
  if (!broadcast) notFound();

  const profile = await getSessionProfile();

  const stage = !broadcast.watchable ? (
    broadcast.status === "ended" ? (
      <BroadcastEnded tutorName={broadcast.tutorName} tutorSlug={broadcast.tutorSlug} />
    ) : (
      <div className="rounded-panel bg-surface-raised p-6 md:p-8" data-broadcast-ended>
        <h2 className="font-display text-h3 font-semibold text-text">This broadcast isn&apos;t live right now</h2>
        <p className="mt-2 max-w-prose text-body text-text-muted">See who else is teaching right now.</p>
        <Button asChild className="mt-4">
          <Link href="/live">Live now</Link>
        </Button>
      </div>
    )
  ) : !profile ? (
    <div className="grid aspect-video place-items-center rounded-panel bg-surface-raised p-6 text-center">
      <div>
        <h2 className="font-display text-h3 font-semibold text-text">Sign in to watch</h2>
        <p className="mx-auto mt-2 max-w-prose text-body text-text-muted">
          Watching live broadcasts is free. You just need a NowTutors account.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/login?next=/live/${broadcast.id}`}>Sign in</Link>
        </Button>
      </div>
    </div>
  ) : profile.isSuspended ? (
    <Alert variant="danger">This account is suspended, so it can&apos;t watch broadcasts.</Alert>
  ) : profile.id === broadcast.tutorId ? (
    <div className="rounded-card bg-surface-raised p-6">
      <p className="text-body text-text">This is your broadcast.</p>
      <Button asChild className="mt-4">
        <Link href={`/broadcast/${broadcast.id}`}>Open your host view</Link>
      </Button>
    </div>
  ) : (
    <ViewerStage
      broadcastId={broadcast.id}
      tutorName={broadcast.tutorName}
      tutorAvatarUrl={broadcast.tutorAvatarUrl}
      tutorSlug={broadcast.tutorSlug}
      viewerKey={String(agoraUid(profile.id))}
    />
  );

  return (
    <div className="theme-dark min-h-[70vh] bg-surface text-text">
      <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-8 md:px-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {broadcast.watchable && <LiveChip label="LIVE" />}
            {broadcast.subjectName && <span className="text-small text-text-muted">{broadcast.subjectName}</span>}
          </div>
          <h1 className="font-display text-h2 font-semibold text-text">{broadcast.title}</h1>
          {stage}
        </div>

        <aside className="space-y-4 lg:pt-[88px]">
          <div className="space-y-3 rounded-card bg-surface-raised p-5">
            <div className="flex items-center gap-3">
              <Avatar src={broadcast.tutorAvatarUrl} name={broadcast.tutorName} size="lg" />
              <div className="min-w-0">
                <p className="text-small text-text-muted">Teaching</p>
                <p className="truncate font-display text-body-lg font-semibold text-text">{broadcast.tutorName}</p>
              </div>
            </div>
            {broadcast.tutorSlug && (
              <Button asChild variant="outline" className="w-full">
                <Link href={`/tutors/${broadcast.tutorSlug}`}>Book a 1:1</Link>
              </Button>
            )}
          </div>
          {broadcast.description && (
            <div className="space-y-2 rounded-card bg-surface-raised p-5">
              <h2 className="text-small font-medium text-text-muted">About this class</h2>
              <p className="whitespace-pre-line text-body text-text">{broadcast.description}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
