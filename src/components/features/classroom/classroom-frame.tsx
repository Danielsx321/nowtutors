"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The LessonSpace classroom itself (SPEC §7.7 step 5).
 *
 * **This component never talks to LessonSpace.** It POSTs a booking id to
 * `/api/lessonspace/join` and renders whatever `client_url` comes back. The API
 * key is `server-only` (§7.7's first line, CLAUDE.md), the room id is never a
 * request field, and the `teacher` / `student` role is derived from the booking
 * row on the server — exactly as `SessionRoom` gets its Agora credential from
 * `/api/agora/token` rather than minting one. A link this component fetched is a
 * link the server decided the viewer was entitled to.
 *
 * **The link is fetched on mount, not rendered into the HTML.** The page above
 * has already run the same access decision and would not have rendered this
 * component otherwise, so the round trip is not the authorization — it is what
 * makes the join *write* happen (§7.7 step 4 stamps `*_joined_at` inside the
 * route). Handing the URL down from the server component would have meant either
 * launching a space for every render — including a prefetch or a crawler — or
 * stamping an arrival for someone who only ever loaded the page.
 *
 * One request per mount, no retry loop and no timer: a failure surfaces a button
 * the person can press. `launchSpace` is idempotent on the booking id, so
 * pressing it costs nothing and lands in the same room.
 */

export interface ClassroomFrameProps {
  bookingId: string;
  /** Presentational only — the leader flag LessonSpace acts on is server-derived. */
  otherPartyName: string;
}

interface JoinResponse {
  url?: unknown;
  error?: unknown;
}

type Phase =
  | { kind: "joining" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

export function ClassroomFrame({ bookingId, otherPartyName }: ClassroomFrameProps) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "joining" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/lessonspace/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId }),
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as JoinResponse | null;
        if (cancelled) return;

        if (!res.ok) {
          // The route's own words. It refuses a closed window, a booking that
          // moved, and an unconfigured server with distinct messages, and every
          // one of them is more useful than a generic failure.
          setPhase({
            kind: "error",
            message:
              typeof body?.error === "string"
                ? body.error
                : "Couldn't open the classroom.",
          });
          return;
        }
        if (typeof body?.url !== "string" || body.url.length === 0) {
          setPhase({ kind: "error", message: "Couldn't open the classroom." });
          return;
        }
        setPhase({ kind: "ready", url: body.url });
      } catch {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: "Couldn't reach the classroom. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `attempt` re-runs the join when the person presses "Try again".
  }, [bookingId, attempt]);

  if (phase.kind === "error") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-lg border border-ink-700 bg-ink-900 p-6 text-center">
        <AlertTriangle className="size-8 text-warning" aria-hidden />
        <div>
          <h2 className="text-h3 font-bold text-white">Couldn&apos;t open the classroom</h2>
          <p className="mx-auto mt-2 max-w-prose text-body text-ink-300">{phase.message}</p>
        </div>
        <Button
          variant="ink"
          onClick={() => {
            setPhase({ kind: "joining" });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (phase.kind === "joining") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-lg border border-ink-700 bg-ink-900 p-6 text-center"
      >
        <Loader2 className="size-7 animate-spin text-gold-400 motion-reduce:animate-none" aria-hidden />
        <p className="text-body text-ink-300">
          Opening your classroom with {otherPartyName}…
        </p>
      </div>
    );
  }

  return (
    <iframe
      // §7.7 step 5, verbatim: the classroom needs the camera and microphone,
      // screen share is `display-capture`, and the whiteboard is only usable
      // full-screen on a phone. `allowFullScreen` is the same grant spelled the
      // older way, for browsers that predate the `allow` token.
      allow="camera; microphone; display-capture; fullscreen"
      allowFullScreen
      src={phase.url}
      title="Classroom"
      className="h-[calc(100vh-13rem)] min-h-[420px] w-full rounded-lg border border-ink-700 bg-ink-900"
    />
  );
}
