import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/guards";
import { getBroadcastPage } from "@/db/queries/broadcasts";
import { agoraUid } from "@/lib/agora/uid";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LivePill } from "@/components/ui/live-pill";
import { ViewerStage } from "@/components/features/broadcasts/viewer-stage";

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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-start gap-4">
        <Avatar src={broadcast.tutorAvatarUrl} name={broadcast.tutorName} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h2 font-bold text-gray-700">{broadcast.title}</h1>
            {broadcast.watchable && <LivePill />}
          </div>
          <p className="text-body text-gray-500">
            {broadcast.tutorSlug ? (
              <Link href={`/tutors/${broadcast.tutorSlug}`} className="focus-ring rounded-sm text-purple-500 hover:underline">
                {broadcast.tutorName}
              </Link>
            ) : (
              broadcast.tutorName
            )}
            {broadcast.subjectName ? ` · ${broadcast.subjectName}` : ""}
          </p>
        </div>
      </header>

      {broadcast.description && (
        <p className="max-w-prose whitespace-pre-line text-body text-gray-700">{broadcast.description}</p>
      )}

      {!broadcast.watchable ? (
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm" data-broadcast-ended>
          <h2 className="text-h3 font-bold text-white">
            {broadcast.status === "ended" ? "This broadcast has ended" : "This broadcast isn't live right now"}
          </h2>
          <p className="mt-2 max-w-prose text-body text-ink-300">See who else is teaching right now.</p>
          <Button asChild variant="ink" className="mt-4">
            <Link href="/live">Live now</Link>
          </Button>
        </div>
      ) : !profile ? (
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
          <h2 className="text-h3 font-bold text-white">Sign in to watch</h2>
          <p className="mt-2 max-w-prose text-body text-ink-300">
            Watching live broadcasts is free. You just need a NowTutors account.
          </p>
          <Button asChild variant="ink" className="mt-4">
            <Link href={`/login?next=/live/${broadcast.id}`}>Sign in</Link>
          </Button>
        </div>
      ) : profile.isSuspended ? (
        <Alert variant="danger">This account is suspended, so it can&apos;t watch broadcasts.</Alert>
      ) : profile.id === broadcast.tutorId ? (
        <div className="rounded-lg border border-gray-200 p-6">
          <p className="text-body text-gray-700">This is your broadcast.</p>
          <Button asChild className="mt-4">
            <Link href={`/broadcast/${broadcast.id}`}>Open your host view</Link>
          </Button>
        </div>
      ) : (
        <ViewerStage
          broadcastId={broadcast.id}
          tutorName={broadcast.tutorName}
          tutorAvatarUrl={broadcast.tutorAvatarUrl}
          viewerKey={String(agoraUid(profile.id))}
        />
      )}
    </div>
  );
}
