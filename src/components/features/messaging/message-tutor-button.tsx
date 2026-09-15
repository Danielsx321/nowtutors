"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { startConversation } from "@/actions/messaging";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * "Message" for a student looking at a tutor (settled 2026-09-15: only a
 * student starts a conversation, only with an approved tutor).
 *
 * Signed-out visitors get a sign-in link that comes back here. The server action
 * re-checks every rule; this button is presentation, not the gate.
 */
export function MessageTutorButton({
  tutorId,
  loginHref,
  signedIn,
  className,
}: {
  tutorId: string;
  loginHref: string;
  signedIn: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  if (!signedIn) {
    return (
      <Link
        href={loginHref}
        className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-4 text-body font-medium text-gray-700 hover:bg-gray-50"
      >
        <MessageSquare className="size-4" aria-hidden />
        Sign in to message
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        className={className}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await startConversation({ tutorId });
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
