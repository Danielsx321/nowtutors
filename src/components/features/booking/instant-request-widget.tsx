"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal, ModalContent } from "@/components/ui/modal";
import { WaitingForTutor } from "@/components/features/booking/waiting-for-tutor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sessionPriceCredits } from "@/lib/credits/pricing";
import { useCountdown } from "@/hooks/use-countdown";
import { useOutgoingSessionRequest } from "@/hooks/use-session-requests";
import { createSessionRequest } from "@/actions/session-requests";
import type { BookableSubject } from "@/db/queries/bookings";
import type { BookingMode } from "@/components/features/booking/booking-widget";

/** Sentinel for "no subject" — Select items cannot carry an empty value. */
const ANY_SUBJECT = "any";

export interface InstantRequestWidgetProps {
  tutorId: string;
  tutorName: string;
  tutorAvatarUrl?: string | null;
  hourlyRateCredits: number;
  durations: number[];
  subjects: BookableSubject[];
  walletBalance: number;
  mode: BookingMode;
  loginHref: string;
  /** `instant_request_ttl_seconds`, for the ring's full sweep. */
  ttlSeconds: number;
}

/**
 * "Request now" — the student half of the instant handshake (SPEC §7.4).
 *
 * The student picks a duration off the `session_durations` menu with **the
 * price shown against each option**, because duration and price are decided at
 * request time, not accept time (Phase 6 pre-build decision): whatever number is
 * on the button here is pinned to the request row and is exactly what gets
 * charged if the tutor accepts, even if the tutor re-rates themselves in
 * between. The price rendered here is the same `sessionPriceCredits()` the
 * server recomputes — this component never sends a price, and the server never
 * reads one.
 *
 * Then a waiting modal counts down 60 seconds. That ring is **cosmetic**; the
 * answer arrives over Realtime as an UPDATE to this student's own row, and each
 * outcome gets its own message — accepted, declined, timed out, and "your
 * balance moved" are four different things to have happened (§4.3).
 */
export function InstantRequestWidget({
  tutorId,
  tutorName,
  tutorAvatarUrl,
  hourlyRateCredits,
  durations,
  subjects,
  walletBalance,
  mode,
  loginHref,
  ttlSeconds,
}: InstantRequestWidgetProps) {
  const router = useRouter();
  const [duration, setDuration] = React.useState<number>(durations[0] ?? 60);
  const [subjectId, setSubjectId] = React.useState<string>(ANY_SUBJECT);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [waiting, setWaiting] = React.useState<{
    requestId: string;
    expiresAt: string;
    priceCredits: number;
  } | null>(null);

  const price = sessionPriceCredits(hourlyRateCredits, duration);
  const canAfford = walletBalance >= price;

  const outcome = useOutgoingSessionRequest(waiting?.requestId ?? null);
  const { secondsLeft, fraction, elapsed } = useCountdown(
    waiting?.expiresAt ?? null,
    ttlSeconds,
  );

  // Accepted: the booking exists and is already `in_progress` with its channel
  // set, so this navigation is the handshake completing — into the room built in
  // Phase 6 Part 3A.
  React.useEffect(() => {
    if (outcome?.status === "accepted" && outcome.bookingId) {
      router.push(`/session/${outcome.bookingId}`);
    }
  }, [outcome, router]);

  if (mode === "anon") {
    return (
      <div className="space-y-2">
        <Button asChild variant="primary" className="w-full">
          <Link href={loginHref}>Sign in to start now</Link>
        </Button>
        <p className="text-small text-text-muted">
          Log in or create an account to start a session with {tutorName} right now.
        </p>
      </div>
    );
  }
  if (mode !== "student") return null;

  async function onRequest() {
    setSubmitting(true);
    setError(null);
    const res = await createSessionRequest({
      tutorId,
      subjectId: subjectId === ANY_SUBJECT ? undefined : subjectId,
      message: message.trim() || undefined,
      durationMinutes: duration,
    });
    setSubmitting(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setWaiting({
      requestId: res.requestId,
      expiresAt: res.expiresAt,
      priceCredits: res.priceCredits,
    });
    setOpen(true);
  }

  function closeWaiting() {
    setOpen(false);
    setWaiting(null);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="instant-duration">Session length</Label>
        <div
          className="grid grid-cols-3 gap-1.5"
          id="instant-duration"
          role="group"
          aria-label="Session length"
        >
          {durations.map((d) => {
            const p = sessionPriceCredits(hourlyRateCredits, d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                aria-pressed={d === duration}
                className={cn(
                  "focus-ring flex flex-col items-center rounded-lg border px-1 py-2.5 text-small font-medium transition-colors",
                  d === duration
                    ? "border-primary text-primary ring-1 ring-inset ring-primary"
                    : "border-border bg-surface-raised text-text hover:border-border-strong",
                )}
              >
                {d} min
                <span
                  data-numeric
                  className={cn("text-caption font-normal", d === duration ? "text-primary" : "text-text-muted")}
                >
                  {p} cr
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {subjects.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="instant-subject">Subject (optional)</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger id="instant-subject">
              <SelectValue placeholder="Any subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_SUBJECT}>Any subject</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="instant-message">What you need help with (optional)</Label>
        <Textarea
          id="instant-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="e.g. Stuck on question 4 of tonight's homework"
        />
      </div>

      {!canAfford && (
        <Alert variant="warning" title="Not enough credits">
          This session costs {price} credits; your balance is {walletBalance}.{" "}
          <Link href="/dashboard/wallet" className="font-medium text-accent hover:underline">
            Top up
          </Link>
          .
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      <Button
        variant="primary"
        className="w-full"
        onClick={onRequest}
        disabled={submitting || !canAfford}
        loading={submitting}
      >
        Request now · {price} credits
      </Button>
      <p className="text-small text-text-muted">
        {firstName(tutorName)} has {ttlSeconds} seconds to accept. You&apos;re only charged if they do.
      </p>

      <Modal open={open} onOpenChange={(next) => !next && closeWaiting()}>
        <ModalContent size="sm">
          <WaitingForTutor
            tutorName={tutorName}
            tutorAvatarUrl={tutorAvatarUrl}
            priceCredits={waiting?.priceCredits ?? price}
            secondsLeft={secondsLeft}
            fraction={fraction}
            elapsed={elapsed}
            status={outcome?.status ?? "pending"}
            onClose={closeWaiting}
            onBookTime={() => {
              closeWaiting();
              document.getElementById("book")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        </ModalContent>
      </Modal>
    </div>
  );
}

/** "Sofia Marchetti" → "Sofia", for the one-line promise under the button. */
function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
