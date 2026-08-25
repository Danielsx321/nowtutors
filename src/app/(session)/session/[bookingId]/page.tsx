import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { getSessionRoomView } from "@/db/queries/sessions";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { Badge } from "@/components/ui/badge";
import { SessionRoom } from "@/components/features/session/session-room";
import { hasElapsed, sessionDeadline } from "@/lib/sessions/deadline";

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
 *
 * **It refuses an elapsed session but does not close it.** The hard stop (§7.4)
 * is enforced here by not opening the room; the write that moves the booking to
 * `completed` is left to `getSessionState`, the token route, and Part 3C's cron.
 * A render is reachable by a prefetch from the bookings list, by a crawler
 * holding a session cookie, and twice over in React's development double-render
 * — so while the transition is idempotent and none of that would be *unsafe*,
 * a GET that mutates is not a shape worth adopting for the few minutes of
 * dashboard freshness it would buy. See docs/DECISIONS.md, Part 3B.
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

  // A scheduled booking's room is the LessonSpace classroom (§6, §7.7), which
  // Phase 7 Part 2 built. This URL is now a stale link rather than a place —
  // there is no state here to keep and no choice the person could usefully make,
  // so they are sent to their room instead of being shown a door to it. Only a
  // participant reaches this line (`getSessionRoomView` returned null otherwise),
  // so the redirect confirms nothing to a stranger. Tested positively on
  // `scheduled` rather than negatively on `!== "instant"`: `booking_type` has
  // exactly two values, and writing it this way means a third could never
  // ping-pong between the two rooms.
  if (view.type === "scheduled") redirect(`/classroom/${bookingId}`);

  const heading = view.subjectName ?? "Tutoring session";

  // The hard stop, computed server-side from `started_at` (§7.4). Null until
  // both parties have been in the room together — the clock has not started.
  const deadline = sessionDeadline(view);
  // Computed here rather than trusted from `status`: the booking stays
  // `in_progress` until some actor performs the transition, and this page must
  // not open a room in the window before one does.
  const elapsed = hasElapsed(view, new Date());

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

      {view.status !== "in_progress" ? (
        <NotLive status={view.status} />
      ) : elapsed ? (
        <TimeIsUp />
      ) : (
        <SessionRoom
          bookingId={view.bookingId}
          viewerIsTutor={view.viewerIsTutor}
          viewerName={view.viewerName}
          viewerAvatarUrl={view.viewerAvatarUrl}
          otherPartyName={view.otherPartyName}
          otherPartyAvatarUrl={view.otherPartyAvatarUrl}
          initialDeadline={deadline?.toISOString() ?? null}
          durationMinutes={view.durationMinutes}
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
 * The booked duration ran out while the booking is still flagged `in_progress` —
 * nobody has performed the transition yet (§7.4's hard stop is enforced by the
 * actors listed in the page note above, not by a background timer).
 *
 * Rendered instead of the room for the same reason as `NotLive`: mounting the
 * SDK and raising a microphone prompt for a session that cannot be joined is
 * worse than an honest explanation, and the token route would refuse the
 * credential a moment later anyway.
 *
 * Says nothing about a refund, because there is none (§7.4).
 */
function TimeIsUp() {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
      <h2 className="text-h3 font-bold text-white">This session&apos;s time is up</h2>
      <p className="mt-2 max-w-prose text-body text-ink-300">
        The booked time has run out, so the room is closed. Sessions run for the
        length they were booked for and can&apos;t be extended — if you need more
        time, start a new session.
      </p>
    </div>
  );
}
