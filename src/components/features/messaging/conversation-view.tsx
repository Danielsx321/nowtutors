import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getConversationHeaderFor, getThreadPageFor } from "@/db/queries/messaging";
import { Avatar } from "@/components/ui/avatar";
import { Thread } from "@/components/features/messaging/thread";

/**
 * One conversation, shared by `/dashboard/messages/[id]` and
 * `/tutor/messages/[id]` (SPEC §6, §7.9).
 *
 * A malformed id, a missing conversation and someone else's conversation all
 * 404 the same way: the header query is scoped to the viewer, so a stranger's
 * thread is indistinguishable from one that never existed.
 */
export async function ConversationView({
  conversationId,
  viewerId,
  backHref,
}: {
  conversationId: string;
  viewerId: string;
  backHref: string;
}) {
  if (!z.string().uuid().safeParse(conversationId).success) notFound();

  const header = await getConversationHeaderFor(conversationId, viewerId);
  if (!header) notFound();
  const page = await getThreadPageFor(conversationId, viewerId);

  return (
    <div className="w-full space-y-3 py-2">
      <Link
        href={backHref}
        className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-small text-text-muted hover:text-text"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All messages
      </Link>

      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Avatar src={header.otherPartyAvatarUrl} name={header.otherPartyName} size="md" />
        <div className="min-w-0">
          <h1 className="truncate text-h3 font-bold text-text">{header.otherPartyName}</h1>
          {header.otherPartyTutorSlug ? (
            <Link
              href={`/tutors/${header.otherPartyTutorSlug}`}
              className="focus-ring rounded-sm text-small text-accent hover:underline"
            >
              View profile
            </Link>
          ) : (
            <p className="text-small text-text-muted">
              {header.otherPartyRole === "student" ? "Student" : "Tutor"}
            </p>
          )}
        </div>
      </div>

      <Thread
        conversationId={header.id}
        viewerId={viewerId}
        initialMessages={page.messages}
        initialHasOlder={page.hasOlder}
      />
    </div>
  );
}
