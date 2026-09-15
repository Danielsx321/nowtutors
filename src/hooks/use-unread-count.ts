"use client";

import * as React from "react";
import { getUnreadCount } from "@/actions/messaging";
import { useRetryingChannel, type BrowserClient } from "@/hooks/use-retrying-channel";

/**
 * The unread-messages count for the topbar badge (SPEC §7.9, §8 "Unread
 * messages").
 *
 * **What pushes it.** Every send bumps `conversations.last_message_at` in the
 * same transaction (`lib/messaging/service.ts`), and that UPDATE reaches both
 * participants through the `conversations_select` RLS policy. There is no
 * filter on the channel because RLS already scopes it to the viewer's threads.
 * An event is only a signal: the count is always re-read through
 * `getUnreadCount`.
 *
 * **What the socket can't tell it.** Reading a thread writes `messages.read_at`
 * and leaves the conversation row alone, so no Realtime event fires. The thread
 * dispatches {@link MESSAGES_READ_EVENT} on `window` after it marks a thread
 * read, and this hook re-reads on that too. Same tab only, which is the tab
 * showing the badge.
 *
 * Re-read on mount and after every (re)subscribe as well, so a message that
 * arrived while the channel was connecting still raises the badge. No interval
 * anywhere (§8).
 */

export const MESSAGES_READ_EVENT = "nowtutors:messages-read";

export function useUnreadCount(enabled: boolean): number {
  const [count, setCount] = React.useState(0);
  const latest = React.useRef(0);

  const refresh = React.useCallback(() => {
    const call = ++latest.current;
    void getUnreadCount()
      .then((n) => {
        // An older read finishing after a newer one must not win.
        if (call === latest.current) setCount(n);
      })
      .catch((err: unknown) => {
        console.error("[messages/unread] count read failed", err);
      });
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    refresh();
    window.addEventListener(MESSAGES_READ_EVENT, refresh);
    return () => window.removeEventListener(MESSAGES_READ_EVENT, refresh);
  }, [enabled, refresh]);

  const build = React.useCallback(
    (supabase: BrowserClient) =>
      supabase
        .channel("conversations:unread")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations" },
          () => refresh(),
        ),
    [refresh],
  );

  useRetryingChannel(enabled ? "conversations:unread" : null, build, refresh);

  return enabled ? count : 0;
}
