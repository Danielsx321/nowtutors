"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import { ProgressRing } from "@/components/ui/progress-ring";
import { RealtimeStatusIndicator } from "@/components/features/tutor/realtime-status-indicator";
import { useCountdown } from "@/hooks/use-countdown";
import { useIncomingSessionRequests } from "@/hooks/use-session-requests";
import {
  acceptSessionRequest,
  declineSessionRequest,
  getIncomingRequest,
  listPendingIncomingRequests,
  type SerializedIncomingRequest,
} from "@/actions/session-requests";

export interface IncomingRequestsProps {
  tutorId: string;
  /** `instant_request_ttl_seconds`, for the ring's full sweep. */
  ttlSeconds: number;
}

/**
 * Merge freshly-read requests into the queue without disturbing it.
 *
 * The queue has TWO producers now — the Realtime INSERT and the mount-time
 * read — and they overlap by design: the read runs again after every successful
 * (re)subscribe precisely so a request that arrived in the connect window is not
 * lost, which means the common case is that it returns a row the event already
 * delivered. Deduplicating by id is what stops that being a second modal.
 *
 * Existing entries keep their position and their object identity: `current` is
 * `queue[0]`, and replacing it with an equal-but-new object would re-seed the
 * countdown ring mid-answer.
 *
 * **Exported for its test.** A double-add is not observable through the modal —
 * only `queue[0]` ever renders, and `drop` filters by id, so it removes every
 * copy — which means an assertion made through the DOM would pass whether the
 * rule held or not. The rule is real, so it is asserted where it can fail.
 */
export function mergeIntoQueue(
  queue: SerializedIncomingRequest[],
  incoming: SerializedIncomingRequest[],
): SerializedIncomingRequest[] {
  const known = new Set(queue.map((r) => r.id));
  const additions = incoming.filter((r) => !known.has(r.id));
  return additions.length === 0 ? queue : [...queue, ...additions];
}

/**
 * The tutor's incoming instant-request modal (SPEC §7.4, §8).
 *
 * Mounted once in the tutor layout, so a request finds the tutor on whichever
 * tutor page they happen to be on. It listens on Realtime — nothing polls — and
 * treats the payload as a notification only: the name, subject, note and price
 * shown here come back from a guarded Server Action keyed by the request id.
 *
 * **It also reads on mount, and that is not polling.** A subscription delivers
 * what happens after it is bound; it has nothing to say about a request that was
 * already waiting. Until this read existed the tutor side depended entirely on
 * catching the event live, so a request that arrived during a failed or
 * still-connecting subscribe was gone for good — and refreshing the page could
 * not recover it, because the refresh only re-subscribed. The read runs once on
 * mount (which covers the case where the subscription never establishes at all)
 * and again after each successful (re)subscribe (which closes the window
 * between the page loading and the channel being live). Two reads per page
 * load, not one per interval.
 *
 * The 60-second ring is **cosmetic**. Expiry is the server's: an accept past
 * `expires_at` is refused by the accept transaction whatever this ring says, and
 * a tutor whose ring is a second fast cannot steal a session by clicking early.
 * When the ring empties the modal closes itself, because a countdown that has
 * finished is not a decision anyone can still make.
 *
 * Neither button is authorization. Both actions re-check role and ownership
 * server-side (CLAUDE.md), and Accept re-checks expiry, the scheduled-booking
 * collision and the student's balance inside its transaction.
 */
export function IncomingRequests({ tutorId, ttlSeconds }: IncomingRequestsProps) {
  const router = useRouter();
  // A tutor may have several incoming at once (§7.4). Oldest first; accepting
  // one auto-declines the rest server-side, and the UPDATEs that produces drain
  // the queue here.
  const [queue, setQueue] = React.useState<SerializedIncomingRequest[]>([]);
  const [pending, setPending] = React.useState<"accept" | "decline" | null>(null);

  const drop = React.useCallback((requestId: string) => {
    setQueue((q) => q.filter((r) => r.id !== requestId));
  }, []);

  /** Ask what is already waiting. Never throws into the caller. */
  const loadPending = React.useCallback(() => {
    void (async () => {
      const res = await listPendingIncomingRequests();
      if ("error" in res) return;
      setQueue((q) => mergeIntoQueue(q, res.requests));
    })().catch((err: unknown) => {
      // Logged, not swallowed. A guard redirect thrown inside a promise nobody
      // awaits cannot navigate — it becomes an unhandled rejection, which is
      // exactly how the approval-guard mismatch below stayed invisible.
      console.error("[incoming-requests] pending read failed", err);
    });
  }, []);

  const status = useIncomingSessionRequests(tutorId, {
    onIncoming: (requestId) => {
      void (async () => {
        const res = await getIncomingRequest(requestId);
        // A request that vanished between the event and this read is simply not
        // shown — there is nothing for the tutor to answer.
        if ("error" in res) return;
        if (res.request.status !== "pending") return;
        setQueue((q) => mergeIntoQueue(q, [res.request]));
      })().catch((err: unknown) => {
        console.error("[incoming-requests] read-back failed", { requestId, err });
      });
    },
    // Expired, cancelled, or auto-declined by an accept elsewhere: stop showing it.
    onSettled: (requestId) => drop(requestId),
    onSubscribed: loadPending,
  });

  // Mount-time read. Separate from `onSubscribed` on purpose: that one never
  // fires if the channel never establishes, which is the case this whole change
  // exists for.
  React.useEffect(() => {
    loadPending();
  }, [loadPending]);

  const current = queue[0] ?? null;
  const { secondsLeft, fraction, elapsed } = useCountdown(
    current?.expiresAt ?? null,
    ttlSeconds,
  );

  // The ring reaching zero closes the modal. The row itself is moved to
  // `expired` by the cron (§12) — this is the local consequence, not the write.
  React.useEffect(() => {
    if (current && elapsed) drop(current.id);
  }, [current, elapsed, drop]);

  async function onAccept() {
    if (!current) return;
    setPending("accept");
    const res = await acceptSessionRequest(current.id);
    setPending(null);
    drop(current.id);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    // The booking is created `in_progress` with its channel already set, so the
    // room (Phase 6 Part 3A) opens straight into a join — the tutor's arrival is
    // stamped by /api/agora/token, not by anything here.
    router.push(`/session/${res.bookingId}`);
  }

  async function onDecline() {
    if (!current) return;
    setPending("decline");
    const res = await declineSessionRequest(current.id);
    setPending(null);
    drop(current.id);
    if ("error" in res) toast.error(res.error);
  }

  const indicator = status === "unavailable" ? <RealtimeStatusIndicator /> : null;

  if (!current) return indicator;

  return (
    <>
      {indicator}
      <Modal open onOpenChange={(open) => !open && drop(current.id)}>
        <ModalContent size="md" hideClose>
          <ModalHeader>
            <ModalTitle>Instant session request</ModalTitle>
            <ModalDescription>
              {current.studentName ?? "A student"} wants to start now.
            </ModalDescription>
          </ModalHeader>

          <div className="flex items-start gap-4">
            <Avatar
              src={current.studentAvatarUrl}
              name={current.studentName ?? "Student"}
              size="lg"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-body font-medium text-gray-700">
                {current.durationMinutes} minutes
                {current.subjectName ? ` · ${current.subjectName}` : ""}
              </p>
              <p className="text-small text-gray-500">
                Earns you {current.priceCredits} credits
              </p>
              {current.message && (
                <p className="mt-2 whitespace-pre-line rounded-md bg-gray-50 p-3 text-small text-gray-700">
                  {current.message}
                </p>
              )}
            </div>
            <ProgressRing
              value={fraction}
              label={secondsLeft}
              live
              aria-label={`${secondsLeft} seconds left to answer`}
            />
          </div>

          <ModalFooter>
            <Button
              variant="secondary"
              onClick={onDecline}
              disabled={pending !== null}
              loading={pending === "decline"}
            >
              Decline
            </Button>
            <Button
              onClick={onAccept}
              disabled={pending !== null}
              loading={pending === "accept"}
            >
              Accept and start
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
