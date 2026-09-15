import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { getBroadcastPage } from "@/db/queries/broadcasts";
import { Button } from "@/components/ui/button";
import { HostStage } from "@/components/features/broadcasts/host-stage";

export const metadata = { title: "Your broadcast · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/broadcast/[broadcastId]` — the tutor's own host view (SPEC §6, §7.8; Phase 9
 * Part 3).
 *
 * In the `(session)` group so the AppShell heartbeat keeps the host fresh in
 * `live_tutors` while they teach; a stale host drops off `/live` and viewers
 * stop getting tokens. Only the host sees this page: a malformed id, a missing
 * broadcast and someone else's broadcast all 404. The token route checks host
 * ownership again before issuing a publisher token.
 */
export default async function BroadcastHostPage({
  params,
}: {
  params: Promise<{ broadcastId: string }>;
}) {
  const { broadcastId } = await params;
  if (!z.string().uuid().safeParse(broadcastId).success) notFound();
  const user = await requireUser();
  const broadcast = await getBroadcastPage(broadcastId);
  if (!broadcast || broadcast.tutorId !== user.id) notFound();

  return (
    <div className="flex flex-col gap-5 px-4 py-2 md:px-6">
      <header className="min-w-0">
        <h1 className="text-h2 font-bold text-gray-700">{broadcast.title}</h1>
        <p className="mt-1 text-body text-gray-500">
          {broadcast.subjectName ? `${broadcast.subjectName} · ` : ""}Live broadcast
        </p>
      </header>

      {broadcast.status === "live" ? (
        <HostStage
          broadcastId={broadcast.id}
          hostName={broadcast.tutorName}
          hostAvatarUrl={broadcast.tutorAvatarUrl}
        />
      ) : (
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
          <h2 className="text-h3 font-bold text-white">This broadcast has ended</h2>
          <p className="mt-2 max-w-prose text-body text-ink-300">
            {broadcast.peakViewers === 1
              ? "1 person watched at the peak."
              : `${broadcast.peakViewers} people watched at the peak.`}
          </p>
          <Button asChild variant="ink" className="mt-4">
            <Link href="/tutor/broadcasts">Back to broadcasts</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
