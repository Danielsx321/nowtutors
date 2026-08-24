import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { getSessionRoomView } from "@/db/queries/sessions";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { Badge } from "@/components/ui/badge";
import { SessionRoom } from "@/components/features/session/session-room";

export const metadata = { title: "Session · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/session/[bookingId]` — the instant-session room (SPEC §6, §7.4, §9).
 *
 * A Server Component, and the authorization boundary for the room: it resolves
 * the booking for *this viewer* and renders nothing if they are not in it. A
 * booking that does not exist and a booking belonging to two other people
 * produce the identical `notFound()`, so the URL cannot be walked to discover
 * which booking ids are real.
 *
 * The guard is repeated by `POST /api/agora/token` rather than trusted from
 * here. This page decides what to *render*; the route decides who gets a
 * credential, and it re-reads the booking itself (SPEC §5 Layer 2, CLAUDE.md).
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const user = await requireUser();
  const view = await getSessionRoomView(bookingId, user.id);
  if (!view) notFound();

  const heading = view.subjectName ?? "Tutoring session";

  return (
    <div className="flex flex-col gap-5 px-4 py-2 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-gray-700">{heading}</h1>
          <p className="mt-1 text-body text-gray-500">
            with {view.otherPartyName}
            {view.durationMinutes ? ` · ${view.durationMinutes} minutes` : ""}
          </p>
        </div>
        <Badge variant={bookingStatusMeta(view.status).variant}>
          {bookingStatusMeta(view.status).label}
        </Badge>
      </header>

      {view.type !== "instant" ? (
        <ScheduledPlaceholder />
      ) : view.status !== "in_progress" ? (
        <NotLive status={view.status} />
      ) : (
        <SessionRoom
          bookingId={view.bookingId}
          viewerIsTutor={view.viewerIsTutor}
          viewerName={view.viewerName}
          viewerAvatarUrl={view.viewerAvatarUrl}
          otherPartyName={view.otherPartyName}
          otherPartyAvatarUrl={view.otherPartyAvatarUrl}
        />
      )}
    </div>
  );
}

/**
 * An instant booking that is not `in_progress` — already ended, cancelled, or
 * expired. Rendered instead of the room so the page does not mount the SDK and
 * ask for a microphone on behalf of a session nobody can join: the token route
 * would refuse it a moment later anyway (409), and the permission prompt would
 * already have been raised by then.
 */
function NotLive({ status }: { status: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
      <h2 className="text-h3 font-bold text-white">This session isn&apos;t live</h2>
      <p className="mt-2 max-w-prose text-body text-ink-300">
        It&apos;s marked <span className="text-white">{bookingStatusMeta(status).label.toLowerCase()}</span>,
        so there&apos;s no room to join. If you think that&apos;s wrong, your bookings
        page has the full history.
      </p>
    </div>
  );
}

/**
 * Scheduled bookings run in LessonSpace at `/classroom/[bookingId]` (SPEC §6,
 * §7.7), which is Phase 7. Nothing here stubs a room or fakes a join: a join
 * button that does not join is worse than an honest explanation, and a LessonSpace
 * placeholder would be the first thing a future session mistook for a seam to
 * build on.
 */
function ScheduledPlaceholder() {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
      <div className="flex gap-4">
        <CalendarClock className="mt-0.5 size-6 shrink-0 text-gold-400" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-h3 font-bold text-white">
            Scheduled sessions open in Phase 7
          </h2>
          <p className="mt-2 max-w-prose text-body text-ink-300">
            This is a scheduled booking. Scheduled sessions run in a LessonSpace
            classroom with a whiteboard and shared documents, which is not built
            yet — it arrives in Phase 7. This room handles instant sessions only.
          </p>
          <p className="mt-3 max-w-prose text-body text-ink-300">
            Your booking is safe and nothing needs to be re-booked. You&apos;ll be
            able to join it from your bookings page once the classroom is live.
          </p>
        </div>
      </div>
    </div>
  );
}
