"use client";

import * as React from "react";
import { getMessage, getThreadPage, markConversationRead } from "@/actions/messaging";
import type { ThreadMessage } from "@/db/queries/messaging";
import { useConversationMessages } from "@/hooks/use-conversation-messages";
import { MESSAGES_READ_EVENT } from "@/hooks/use-unread-count";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/features/messaging/composer";
import { MessageBubble } from "@/components/features/messaging/message-bubble";

/**
 * An open conversation (SPEC §7.9, §8 "Open thread").
 *
 * **Every message enters through {@link mergeMessages}**, deduplicated by id and
 * kept in `(createdAt, id)` order: the server-rendered page, "Load older", the
 * re-read after a (re)subscribe, a Realtime read-back and the composer's own
 * returned row. The composer's row and its own INSERT event are the same
 * message arriving twice, and must render once.
 *
 * **Read state.** The thread marks the conversation read when it mounts, and
 * again when a message from the other person arrives while the tab is visible
 * (or when the tab becomes visible with one waiting). After each mark it
 * dispatches {@link MESSAGES_READ_EVENT} so the topbar badge re-reads.
 */

export function mergeMessages(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

/** How close to the bottom counts as "reading the latest", in pixels. */
const STICK_TO_BOTTOM_PX = 80;

export function Thread({
  conversationId,
  viewerId,
  initialMessages,
  initialHasOlder,
}: {
  conversationId: string;
  viewerId: string;
  initialMessages: ThreadMessage[];
  initialHasOlder: boolean;
}) {
  const [messages, setMessages] = React.useState(initialMessages);
  const [hasOlder, setHasOlder] = React.useState(initialHasOlder);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);
  const prependedFrom = React.useRef<number | null>(null);

  const markRead = React.useCallback(() => {
    void markConversationRead({ conversationId })
      .then((res) => {
        if ("ok" in res && res.marked > 0) {
          window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
        }
      })
      .catch((err: unknown) => console.error("[messages/thread] mark read failed", err));
  }, [conversationId]);

  React.useEffect(() => {
    markRead();
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  const add = React.useCallback((incoming: ThreadMessage[]) => {
    const el = scrollRef.current;
    stickToBottom.current =
      !el || el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    setMessages((current) => mergeMessages(current, incoming));
  }, []);

  useConversationMessages(conversationId, {
    onInsert: (messageId) => {
      void getMessage({ messageId, conversationId })
        .then((message) => {
          if (!message) return;
          add([message]);
          if (message.senderId !== viewerId && document.visibilityState === "visible") {
            markRead();
          }
        })
        .catch((err: unknown) => console.error("[messages/thread] read-back failed", err));
    },
    onSubscribed: () => {
      // Anything that landed while the channel was connecting or retrying.
      void getThreadPage({ conversationId })
        .then((page) => {
          add(page.messages);
          if (page.messages.some((m) => m.senderId !== viewerId && m.readAt === null)) {
            markRead();
          }
        })
        .catch((err: unknown) => console.error("[messages/thread] resubscribe read failed", err));
    },
  });

  // Keep the view pinned to the newest message when the reader was already
  // there, and keep their place when older messages are prepended above.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependedFrom.current !== null) {
      el.scrollTop = el.scrollHeight - prependedFrom.current;
      prependedFrom.current = null;
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await getThreadPage({
        conversationId,
        before: { createdAt: first.createdAt, id: first.id },
      });
      const el = scrollRef.current;
      prependedFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((current) => mergeMessages(current, page.messages));
      setHasOlder(page.hasOlder);
    } finally {
      setLoadingOlder(false);
    }
  }

  const dayFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

  // Below `md` the mobile bottom bar takes 4rem off the viewport, and `dvh`
  // keeps the composer above the browser's own chrome on a phone. Part 5
  // rebuilds this thread; the height stays a shell concern until then.
  return (
    <div className="flex h-[calc(100dvh-18rem)] min-h-96 flex-col md:h-[calc(100dvh-14rem)]">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {hasOlder && (
          <div className="flex justify-center py-2">
            <Button variant="ghost" onClick={loadOlder} loading={loadingOlder}>
              Load older messages
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="py-12 text-center text-body text-gray-500">
            No messages yet. Say hello.
          </p>
        )}
        {messages.map((m, i) => {
          const at = new Date(m.createdAt);
          const prev = messages[i - 1];
          const newDay = !prev || dayFmt.format(new Date(prev.createdAt)) !== dayFmt.format(at);
          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <p
                  className="py-2 text-center text-caption font-medium text-gray-500"
                  suppressHydrationWarning
                >
                  {dayFmt.format(at)}
                </p>
              )}
              <MessageBubble
                messageId={m.id}
                conversationId={conversationId}
                body={m.body}
                attachment={m.attachment}
                mine={m.senderId === viewerId}
                time={timeFmt.format(at)}
              />
            </React.Fragment>
          );
        })}
      </div>
      <Composer
        conversationId={conversationId}
        onSent={(message) => {
          stickToBottom.current = true;
          setMessages((current) => mergeMessages(current, [message]));
        }}
      />
    </div>
  );
}
