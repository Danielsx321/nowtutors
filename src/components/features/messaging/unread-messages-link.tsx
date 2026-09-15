"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useSharedUnreadCount } from "@/components/features/messaging/unread-context";

/**
 * The Messages icon in the topbar with its unread badge (SPEC §7.9 "Unread
 * count in the header"). Its own component so a count change re-renders this
 * link, not the whole shell. It owns the `unread-badge` test id (E2E test 6
 * asserts on exactly one element with it), so no other badge may use it.
 */
export function UnreadMessagesLink({ href }: { href: string }) {
  const count = useSharedUnreadCount(true);
  const label = count > 0 ? `Messages, ${count} unread` : "Messages";
  return (
    <Link
      href={href}
      aria-label={label}
      className="focus-ring relative grid size-10 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
    >
      <MessageSquare className="size-5" aria-hidden />
      {count > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-caption font-bold text-text-on-inverse"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
