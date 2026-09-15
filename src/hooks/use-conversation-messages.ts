"use client";

import * as React from "react";
import {
  useRetryingChannel,
  type BrowserClient,
  type RealtimeStatus,
} from "@/hooks/use-retrying-channel";

/**
 * New messages in the open thread (SPEC §7.9, §8 "Open thread").
 *
 * One `messages` INSERT subscription filtered to this conversation. The
 * `messages_select` RLS policy (participants only, drizzle/0005) decides what
 * reaches the socket; the filter only narrows it. The payload is a
 * NOTIFICATION: the thread reads the row back through the guarded `getMessage`
 * action rather than rendering what the socket sent.
 *
 * `onSubscribed` fires after every successful (re)subscribe, including the
 * first, so the thread can re-read its newest page and pick up anything that
 * arrived while the channel was still connecting or retrying.
 */

export interface ConversationMessageHandlers {
  onInsert: (messageId: string) => void;
  onSubscribed?: () => void;
}

export function useConversationMessages(
  conversationId: string,
  handlers: ConversationMessageHandlers,
): RealtimeStatus {
  const ref = React.useRef(handlers);
  ref.current = handlers;

  const build = React.useCallback(
    (supabase: BrowserClient) =>
      supabase.channel(`messages:${conversationId}`).on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; conversation_id?: string };
          if (row?.id && row.conversation_id === conversationId) {
            ref.current.onInsert(row.id);
          }
        },
      ),
    [conversationId],
  );

  const onSubscribed = React.useCallback(() => {
    ref.current.onSubscribed?.();
  }, []);

  return useRetryingChannel(
    conversationId ? `messages:${conversationId}` : null,
    build,
    onSubscribed,
  );
}
