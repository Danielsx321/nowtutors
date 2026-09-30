import type { ThreadMessage } from "@/db/queries/messaging";

/** What the session room needs to draw its chat panel (built server-side, 2026-09-30). */
export interface SessionChat {
  conversationId: string;
  viewerId: string;
  initialMessages: ThreadMessage[];
  initialHasOlder: boolean;
}
