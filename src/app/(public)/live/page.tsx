import type * as React from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Radio } from "lucide-react";
import { listLiveBroadcasts, type LiveBroadcastCard } from "@/db/queries/broadcasts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveChip } from "@/components/ui/live-chip";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Live now · NowTutors" };
export const dynamic = "force-dynamic";

/** Broadcasts younger than this are grouped as "Just started". */
const JUST_STARTED_MS = 10 * 60 * 1000;

/**
 * `/live` — broadcasts happening right now (SPEC §6, §7.8; Phase 9 Part 3).
 *
 * Public. Lists broadcasts that are `live` AND whose host is fresh in
 * `live_tutors` in broadcast mode, so a tutor who closed the tab disappears
 * within two minutes without waiting for the sweep. Watching needs sign-in,
 * which the viewer page and the token route enforce. No viewer counts here.
 *
 * Design overhaul Part 4 (research report 02, the streaming card anatomy): a
 * 16:9 picture of the tutor with the LIVE label on it, the class title as the
 * link, then the tutor and subject. Classes under ten minutes old get their own
 * "Just started" row, where joining costs the least. A subject filter appears
 * once there is more than one subject to choose between; it filters the list
 * the page already loaded (at most 50), so it is a query-string view, not a
 * second query.
 */
export default async function LiveNowPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const [all, { subject }] = await Promise.all([listLiveBroadcasts(), searchParams]);
  const subjects = [...new Set(all.map((b) => b.subjectName).filter((s): s is string => !!s))].sort();
  const broadcasts = subject ? all.filter((b) => b.subjectName === subject) : all;

  const now = Date.now();
  const fresh = broadcasts.filter((b) => b.startedAt && now - b.startedAt.getTime() < JUST_STARTED_MS);
  const rest = broadcasts.filter((b) => !fresh.includes(b));

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-8 px-4 py-8 md:px-6">
      <div className="space-y-1">
        <h1 className="font-display text-h1 font-bold text-text">Live now</h1>
        <p className="text-body text-text-muted">Tutors teaching live right now. Sign in to watch, it&apos;s free.</p>
      </div>

      {subjects.length > 1 && (
        <nav aria-label="Filter by subject" className="flex flex-wrap gap-2">
          <FilterChip href="/live" active={!subject}>
            All
          </FilterChip>
          {subjects.map((s) => (
            <FilterChip key={s} href={`/live?subject=${encodeURIComponent(s)}`} active={subject === s}>
              {s}
            </FilterChip>
          ))}
        </nav>
      )}

      {broadcasts.length === 0 ? (
        <EmptyState
          icon={<Radio className="size-6" />}
          title={subject ? `Nobody is live in ${subject} right now` : "Nobody is live right now"}
          description="Tutors go live whenever they're ready to teach. You can still book a session or message a tutor."
          action={
            <Button asChild>
              <Link href="/tutors">Browse tutors</Link>
            </Button>
          }
        />
      ) : (
        <>
          {fresh.length > 0 && <BroadcastRow title="Just started" broadcasts={fresh} />}
          {rest.length > 0 && <BroadcastRow title={fresh.length > 0 ? "On now" : undefined} broadcasts={rest} />}
        </>
      )}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring inline-flex h-9 items-center rounded-full border px-4 text-small font-medium",
        active ? "border-accent bg-surface-muted text-accent" : "border-border-strong text-text hover:bg-surface-muted",
      )}
    >
      {children}
    </Link>
  );
}

function BroadcastRow({ title, broadcasts }: { title?: string; broadcasts: LiveBroadcastCard[] }) {
  return (
    <section className="space-y-4">
      {title && <h2 className="text-h2 font-semibold text-text">{title}</h2>}
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {broadcasts.map((b) => (
          <li key={b.id} className="group relative space-y-3">
            <div className="relative">
              <TutorPhoto
                src={b.tutorAvatarUrl}
                name={b.tutorName}
                sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                className="aspect-video w-full rounded-xl"
                initialsClassName="text-display"
              />
              <LiveChip label="LIVE" size="sm" className="absolute left-3 top-3" />
            </div>
            <div className="space-y-1">
              <h3 className="line-clamp-2 font-display text-body-lg font-semibold text-text">
                <Link href={`/live/${b.id}`} className="focus-ring rounded-sm after:absolute after:inset-0 group-hover:underline">
                  {b.title}
                </Link>
              </h3>
              <p className="text-small text-text-muted">
                {b.tutorName}
                {b.subjectName ? ` · ${b.subjectName}` : ""}
                {b.startedAt ? ` · started ${formatDistanceToNowStrict(b.startedAt, { addSuffix: true })}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
