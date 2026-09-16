"use client";

import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ModalDescription, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { OnAirRing } from "@/components/ui/on-air-ring";
import { ProgressRing } from "@/components/ui/progress-ring";

/**
 * What the student sees after "Request now" (SPEC §7.4; extracted from
 * `instant-request-widget.tsx` in design overhaul Part 4).
 *
 * Five outcomes, and they are deliberately five rather than "answered / not
 * answered": a tutor who declined, a tutor who never looked, and a balance that
 * moved between the quote and the accept are different facts, and a student
 * who is told the wrong one takes the wrong next step (§4.3 is the same
 * argument, one layer down, for `failed_payment` being its own status).
 *
 * `elapsed` is only ever reached when nothing arrived: the server refuses to
 * accept a request past `expires_at`, so a ring that has run out can never be
 * contradicted by a late acceptance.
 *
 * When the tutor can't take it (declined or no answer), the student is never
 * left at a dead end: another live tutor, or a booked time with this one. The
 * credits line stays exact: nothing is taken at request time, so nothing is
 * "held"; the charge happens at accept.
 *
 * Strings E2E reads: "Waiting for {name}", "No answer", "nothing was charged",
 * and a text "Close" button.
 */
export interface WaitingForTutorProps {
  tutorName: string;
  tutorAvatarUrl?: string | null;
  priceCredits: number;
  secondsLeft: number;
  fraction: number;
  elapsed: boolean;
  status: string;
  onClose: () => void;
  /** Close the modal and take the student to this tutor's booking calendar. */
  onBookTime?: () => void;
}

export function WaitingForTutor({
  tutorName,
  tutorAvatarUrl,
  priceCredits,
  secondsLeft,
  fraction,
  elapsed,
  status,
  onClose,
  onBookTime,
}: WaitingForTutorProps) {
  const face = (
    <OnAirRing className="shrink-0">
      <Avatar src={tutorAvatarUrl} name={tutorName} size="xl" />
    </OnAirRing>
  );

  if (status === "accepted") {
    return (
      <>
        <ModalHeader>
          <ModalTitle>{tutorName} accepted</ModalTitle>
          <ModalDescription>Joining the session…</ModalDescription>
        </ModalHeader>
        <div className="grid place-items-center py-4">{face}</div>
      </>
    );
  }

  const fallbacks = (
    <div className="flex flex-col gap-2">
      <Button asChild variant="live">
        <Link href="/?live=1#tutors">Try another live tutor</Link>
      </Button>
      {onBookTime && (
        <Button variant="secondary" onClick={onBookTime}>
          Book a time with {tutorName}
        </Button>
      )}
    </div>
  );

  if (status === "declined") {
    return (
      <Outcome
        title="Tutor is unavailable right now"
        body={<>{tutorName} can&apos;t take a session at the moment, so nothing was charged.</>}
        actions={fallbacks}
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
            You no longer have the {priceCredits} credits this session was quoted at, so{" "}
            <strong>nothing was charged</strong>.
          </>
        }
        actions={
          <Button asChild>
            <Link href="/dashboard/wallet">Top up credits</Link>
          </Button>
        }
        onClose={onClose}
      />
    );
  }

  if (status === "cancelled") {
    return (
      <Outcome
        title="Request cancelled"
        body="This request was cancelled, so nothing was charged."
        actions={fallbacks}
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
            {tutorName} didn&apos;t answer in time, so <strong>nothing was charged</strong>.
          </>
        }
        actions={fallbacks}
        onClose={onClose}
      />
    );
  }

  return (
    <>
      <ModalHeader>
        <ModalTitle>Waiting for {tutorName}</ModalTitle>
        <ModalDescription>
          They have {secondsLeft} seconds to answer. You&apos;re charged {priceCredits} credits only if
          they accept.
        </ModalDescription>
      </ModalHeader>
      <div className="flex items-center justify-center gap-6 py-4">
        {face}
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
  actions,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
        <ModalDescription>{body}</ModalDescription>
      </ModalHeader>
      {actions}
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </>
  );
}
