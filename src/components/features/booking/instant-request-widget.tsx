"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import { ProgressRing } from "@/components/ui/progress-ring";
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
  // set, so this navigation is the handshake completing.
  // TODO(Phase 6 Part 3): /session/[bookingId] itself — the Agora room — is Part 3.
  React.useEffect(() => {
    if (outcome?.status === "accepted" && outcome.bookingId) {
      router.push(`/session/${outcome.bookingId}`);
    }
  }, [outcome, router]);

  if (mode === "anon") {
    return (
      <Alert variant="info" title="Sign in to request a session">
        <Link href={loginHref} className="font-medium text-purple-500 hover:underline">
          Log in or create an account
        </Link>{" "}
        to start a session with {tutorName} right now.
      </Alert>
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
          className="grid grid-cols-2 gap-2"
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
                  "focus-ring rounded-md border px-3 py-2 text-small font-medium transition-colors",
                  d === duration
                    ? "border-purple-500 bg-purple-500 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300",
                )}
              >
                {d} min
                <span
                  className={cn(
                    "ml-1.5 font-normal",
                    d === duration ? "text-white/80" : "text-gray-500",
                  )}
                >
                  · {p} credits
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
          <Link href="/dashboard/wallet" className="font-medium text-purple-500 hover:underline">
            Top up
          </Link>
          .
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      <Button
        className="w-full"
        onClick={onRequest}
        disabled={submitting || !canAfford}
        loading={submitting}
      >
        Request now · {price} credits
      </Button>

      <Modal open={open} onOpenChange={(next) => !next && closeWaiting()}>
        <ModalContent size="sm">
          <WaitingBody
            tutorName={tutorName}
            priceCredits={waiting?.priceCredits ?? price}
            secondsLeft={secondsLeft}
            fraction={fraction}
            elapsed={elapsed}
            status={outcome?.status ?? "pending"}
            onClose={closeWaiting}
          />
        </ModalContent>
      </Modal>
    </div>
  );
}

/**
 * The waiting modal's contents. Five states, and they are deliberately five
 * rather than "answered / not answered": a tutor who declined, a tutor who never
 * looked, and a balance that moved between the quote and the accept are
 * different facts, and a student who is told the wrong one takes the wrong next
 * step (§4.3 is the same argument, one layer down, for `failed_payment` being
 * its own status).
 *
 * `elapsed` is only ever reached when nothing arrived: the server refuses to
 * accept a request past `expires_at`, so a ring that has run out can never be
 * contradicted by a late acceptance.
 */
function WaitingBody({
  tutorName,
  priceCredits,
  secondsLeft,
  fraction,
  elapsed,
  status,
  onClose,
}: {
  tutorName: string;
  priceCredits: number;
  secondsLeft: number;
  fraction: number;
  elapsed: boolean;
  status: string;
  onClose: () => void;
}) {
  const browseLive = (
    <Link href="/tutors?live=1" className="font-medium text-purple-500 hover:underline">
      See who else is live now
    </Link>
  );

  if (status === "accepted") {
    return (
      <>
        <ModalHeader>
          <ModalTitle>{tutorName} accepted</ModalTitle>
          <ModalDescription>Taking you into the session…</ModalDescription>
        </ModalHeader>
        <div className="grid place-items-center py-4">
          <ProgressRing value={1} label="✓" />
        </div>
      </>
    );
  }

  if (status === "declined") {
    return (
      <Outcome
        title="Tutor is unavailable right now"
        body={<>{tutorName} can&apos;t take a session at the moment. {browseLive}.</>}
        onClose={onClose}
      />
    );
  }

  if (status === "failed_payment") {
    return (
      <Outcome
        title="Your balance changed"
        body={
          <>
            You no longer have the {priceCredits} credits this session was quoted
            at, so <strong>nothing was charged</strong>.{" "}
            <Link
              href="/dashboard/wallet"
              className="font-medium text-purple-500 hover:underline"
            >
              Top up
            </Link>{" "}
            and try again.
          </>
        }
        onClose={onClose}
      />
    );
  }

  if (status === "cancelled") {
    return (
      <Outcome
        title="Request cancelled"
        body={<>This request was cancelled. {browseLive}.</>}
        onClose={onClose}
      />
    );
  }

  if (status === "expired" || elapsed) {
    return (
      <Outcome
        title="No answer"
        body={
          <>
            {tutorName} didn&apos;t answer in time, so{" "}
            <strong>nothing was charged</strong>. {browseLive}.
          </>
        }
        onClose={onClose}
      />
    );
  }

  return (
    <>
      <ModalHeader>
        <ModalTitle>Waiting for {tutorName}</ModalTitle>
        <ModalDescription>
          They have {secondsLeft} seconds to answer. You&apos;re charged{" "}
          {priceCredits} credits only if they accept.
        </ModalDescription>
      </ModalHeader>
      <div className="grid place-items-center py-4">
        <ProgressRing
          value={fraction}
          label={secondsLeft}
          size={96}
          live
          aria-label={`${secondsLeft} seconds left`}
        />
      </div>
    </>
  );
}

function Outcome({
  title,
  body,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
        <ModalDescription>{body}</ModalDescription>
      </ModalHeader>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </>
  );
}
