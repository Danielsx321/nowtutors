import * as React from "react";
import { cn } from "@/lib/utils";
import type { ThreadAttachment } from "@/db/queries/messaging";
import { AttachmentPreview } from "@/components/features/messaging/attachment-preview";

/**
 * One message in a thread (SPEC §10.2 `MessageBubble`, deferred to Phase 9).
 *
 * The body is rendered as plain text: no HTML, no markdown, no auto-linking, so
 * a message can't inject markup or disguise a link. `whitespace-pre-wrap` keeps
 * the sender's line breaks and `break-words` stops a long URL from widening the
 * thread past the screen. An attachment (Part 2) renders above the text through
 * a signed link fetched on demand.
 */
export function MessageBubble({
  messageId,
  conversationId,
  body,
  attachment,
  mine,
  time,
}: {
  messageId: string;
  conversationId: string;
  body: string | null;
  attachment: ThreadAttachment | null;
  mine: boolean;
  /** Already formatted for the viewer, e.g. "3:42 PM". */
  time: string;
}) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] space-y-1.5 rounded-lg px-3 py-2 text-body",
          mine ? "bg-primary text-on-primary" : "bg-surface-muted text-text",
        )}
      >
        {attachment && (
          <AttachmentPreview
            messageId={messageId}
            conversationId={conversationId}
            attachment={attachment}
            mine={mine}
          />
        )}
        {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
        <p
          className={cn("text-right text-caption", mine ? "text-on-primary/75" : "text-text-muted")}
          suppressHydrationWarning
        >
          {time}
        </p>
      </div>
    </div>
  );
}
