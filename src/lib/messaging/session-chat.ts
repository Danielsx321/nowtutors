import "server-only";
import {
  findConversationBetween,
  getThreadPageFor,
  messagingRunner,
} from "@/db/queries/messaging";
import { startConversation } from "@/lib/messaging/service";
import type { SessionChat } from "@/lib/messaging/session-chat-types";

export type { SessionChat };

/**
 * The conversation behind the instant room's chat panel (SPEC §7.4 in-session
 * UI, built 2026-09-30), found or opened for the booking's pair.
 *
 * §7.9's rule stands: **only a student starts a conversation.** The room page
 * calls this for either viewer, and when no thread exists yet it opens one with
 * the booking's student as the starter, whoever is looking. The authorization is
 * the booking: the caller has already proved the viewer is one of its two
 * participants (`getSessionRoomView` returned a row), an in-progress instant
 * booking exists only between a student and an approved, unsuspended tutor,
 * and the thread that results is the same one both would reach from Messages.
 * A refusal (a tutor suspended mid-session, say) returns null and the room shows
 * no panel rather than an error: chat is a convenience beside the call.
 */
export async function getSessionChat(input: {
  studentId: string;
  tutorId: string;
  viewerId: string;
}): Promise<SessionChat | null> {
  let conversationId = await findConversationBetween(input.studentId, input.tutorId);
  if (!conversationId) {
    const started = await startConversation(messagingRunner, {
      starterId: input.studentId,
      targetId: input.tutorId,
    });
    if (!started.ok) return null;
    conversationId = started.conversationId;
  }
  const page = await getThreadPageFor(conversationId, input.viewerId);
  return {
    conversationId,
    viewerId: input.viewerId,
    initialMessages: page.messages,
    initialHasOlder: page.hasOlder,
  };
}
