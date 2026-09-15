"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useUnreadCount } from "@/hooks/use-unread-count";

/**
 * The Messages icon in the topbar with its unread badge (SPEC §7.9 "Unread
 * count in the header"). Its own component so a count change re-renders this
 * link, not the whole shell.
 */
export function UnreadMessagesLink({ href }: { href: string }) {
  const count = useUnreadCount(true);
  const label = count > 0 ? `Messages, ${count} unread` : "Messages";
  return (
    <Link
      href={href}
      aria-label={label}
      className="focus-ring-on-ink relative grid size-10 place-items-center rounded-md text-white hover:bg-ink-800"
    >
      <MessageSquare className="size-5" aria-hidden />
      {count > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-gold-400 px-1 text-caption font-bold text-ink-900"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
