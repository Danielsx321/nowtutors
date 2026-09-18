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
 *
 * v2 (Part E, pages.html `.iconbtn`): a 50px white circle; the count sits in a
 * small orange badge at its shoulder, ink on orange so it stays readable.
 */
export function UnreadMessagesLink({ href }: { href: string }) {
  const count = useSharedUnreadCount(true);
  const label = count > 0 ? `Messages, ${count} unread` : "Messages";
  return (
    <Link
      href={href}
      aria-label={label}
      className="focus-ring relative grid size-[50px] shrink-0 place-items-center rounded-full border border-border bg-surface-raised text-text transition-colors hover:bg-surface-muted"
    >
      <MessageSquare className="size-5" aria-hidden strokeWidth={1.75} />
      {count > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full border-2 border-surface-raised bg-spark px-1 text-[11px] font-semibold leading-4 text-ink"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
