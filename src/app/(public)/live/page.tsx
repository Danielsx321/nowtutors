import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Radio } from "lucide-react";
import { listLiveBroadcasts } from "@/db/queries/broadcasts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LivePill } from "@/components/ui/live-pill";
import { SubjectChip } from "@/components/ui/subject-chip";

export const metadata = { title: "Live now · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/live` — broadcasts happening right now (SPEC §6, §7.8; Phase 9 Part 3).
 *
 * Public. Lists broadcasts that are `live` AND whose host is fresh in
 * `live_tutors` in broadcast mode, so a tutor who closed the tab disappears
 * within two minutes without waiting for the sweep. Watching needs sign-in,
 * which the viewer page and the token route enforce. No viewer counts here.
 */
export default async function LiveNowPage() {
  const broadcasts = await listLiveBroadcasts();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-6">
      <div className="space-y-1">
        <h1 className="text-h1 font-bold text-gray-700">Live now</h1>
        <p className="text-body text-gray-500">
          Tutors teaching live right now. Sign in to watch, it&apos;s free.
        </p>
      </div>

      {broadcasts.length === 0 ? (
        <EmptyState
          icon={<Radio className="size-6" />}
          title="Nobody is live right now"
          description="Tutors go live whenever they're ready to teach. You can still book a session or message a tutor."
          action={
            <Button asChild>
              <Link href="/tutors">Browse tutors</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {broadcasts.map((b) => (
            <Card
              key={b.id}
              surface="ink"
              className="relative flex flex-col overflow-hidden transition-colors hover:bg-ink-800"
            >
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <Avatar src={b.tutorAvatarUrl} name={b.tutorName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-white">{b.tutorName}</p>
                    {b.startedAt && (
                      <p className="text-caption text-ink-300">
                        Started {formatDistanceToNowStrict(b.startedAt, { addSuffix: true })}
                      </p>
                    )}
                  </div>
                  <LivePill surface="ink" />
                </div>
                <h2 className="text-body-lg font-bold text-white">
                  <Link
                    href={`/live/${b.id}`}
                    className="focus-ring-on-ink rounded-sm after:absolute after:inset-0"
                  >
                    {b.title}
                  </Link>
                </h2>
                {b.subjectName && (
                  <div>
                    <SubjectChip className="border-ink-700 bg-ink-800 text-caption text-white">
                      {b.subjectName}
                    </SubjectChip>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
