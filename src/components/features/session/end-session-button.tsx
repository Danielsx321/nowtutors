"use client";

import * as React from "react";
import { PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import { endSession } from "@/actions/sessions";

/**
 * "End session", for either party (SPEC §7.4).
 *
 * **The confirm step exists because the consequence is not recoverable.** Credits
 * were charged upfront at accept and nothing is refunded on early exit, by either
 * party, with no proration and no grace period. So the dialog says that in plain
 * words rather than asking a soft "are you sure?" — the person clicking is
 * spending the rest of a session they have already paid for (or, if they are the
 * tutor, ending one the student has already paid for).
 *
 * Ending is authorized and performed entirely server-side. This button cannot end
 * anything by itself; it asks, and `endSession` re-checks who is calling.
 */
export interface EndSessionButtonProps {
  bookingId: string;
  /** Wording differs: one party is spending their own money, the other isn't. */
  viewerIsTutor: boolean;
  /** Called after the server confirms, so the room can tear the SDK down. */
  onEnded: () => void;
}

export function EndSessionButton({
  bookingId,
  viewerIsTutor,
  onEnded,
}: EndSessionButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await endSession(bookingId);
      if ("error" in result) {
        setError(result.error);
        setPending(false);
        return;
      }
      // `transitioned: false` is still a success — the room is closed either
      // way, whether this call did it or the other party got there first.
      setOpen(false);
      onEnded();
    } catch {
      setError("Couldn't end the session. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        <PhoneOff aria-hidden />
        End session
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>End this session?</ModalTitle>
            <ModalDescription>
              {viewerIsTutor
                ? "This closes the room for both of you straight away. The student has already paid for the full booked time and none of it is refunded, so only end early if you've both finished."
                : "This closes the room for both of you straight away. You've already paid for the full booked time and none of it is refunded — ending early doesn't give any of it back."}
            </ModalDescription>
          </ModalHeader>

          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}

          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Keep going
            </Button>
            <Button variant="danger" onClick={confirm} loading={pending}>
              End session
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
