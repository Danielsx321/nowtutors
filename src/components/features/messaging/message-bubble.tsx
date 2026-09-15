import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One message in a thread (SPEC §10.2 `MessageBubble`, deferred to Phase 9).
 *
 * The body is rendered as plain text: no HTML, no markdown, no auto-linking, so
 * a message can't inject markup or disguise a link. `whitespace-pre-wrap` keeps
 * the sender's line breaks and `break-words` stops a long URL from widening the
 * thread past the screen.
 */
export function MessageBubble({
  body,
  mine,
  time,
}: {
  body: string | null;
  mine: boolean;
  /** Already formatted for the viewer, e.g. "3:42 PM". */
  time: string;
}) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-body",
          mine ? "bg-purple-500 text-white" : "bg-gray-100 text-gray-700",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{body}</p>
        <p
          className={cn("mt-1 text-right text-caption", mine ? "text-purple-100" : "text-gray-500")}
          suppressHydrationWarning
        >
          {time}
        </p>
      </div>
    </div>
  );
}
