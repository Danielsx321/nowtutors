"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { startConversationWithStudent } from "@/actions/messaging";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * "Message" on a tutor's booking detail when no thread exists yet (2026-09-30).
 * The booking on that page is what earns the tutor the right to open one; the
 * server re-checks it (`hasBookingBetween`) and this button cannot start
 * anything by itself.
 */
export function MessageStudentButton({ studentId, className }: { studentId: string; className?: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className={className}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await startConversationWithStudent({ studentId });
            if ("error" in res) {
              setError(res.error);
              return;
            }
            router.push(res.href);
          })
        }
      >
        <MessageSquare aria-hidden />
        Message
      </Button>
      {error && <Alert variant="danger">{error}</Alert>}
    </div>
  );
}
