"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { itemIsActive } from "@/components/layout/nav-config";
import { mobileNavByRole, moreNavItem, type Role } from "@/components/layout/nav-config";
import { useSharedUnreadCount } from "@/components/features/messaging/unread-context";

/**
 * The mobile bottom bar (below `md`): four destinations plus More, which opens
 * the same drawer the topbar's menu button does. 44px targets, label under
 * icon, and a `pb-16 md:pb-0` on the content panel so it never covers a message
 * composer or a sticky Save.
 *
 * Only Messages carries the unread badge, and it deliberately does NOT use the
 * `unread-badge` test id: the topbar link owns that (E2E test 6 asserts on a
 * single element), so a second one would break the spec at any viewport, the
 * bar being in the DOM even when hidden.
 */
export function BottomNav({
  role,
  messagesHref,
  onOpenMore,
}: {
  role: Role;
  messagesHref?: string;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();
  const items = mobileNavByRole[role];
  const unread = useSharedUnreadCount(!!messagesHref);
  const MoreIcon = moreNavItem.icon;

  const cell =
    "focus-ring flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-caption font-medium";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-border bg-surface px-2 pb-[env(safe-area-inset-bottom)] pt-1 md:hidden"
    >
      {items.map((item) => {
        const active = itemIsActive(pathname, item.href);
        const Icon = item.icon;
        const isMessages = item.href === messagesHref;
        const badge = isMessages && unread > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={badge ? `${item.label}, ${unread} unread` : undefined}
            className={cn(cell, active ? "text-text" : "text-text-muted")}
          >
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {badge && (
                <span
                  className="absolute -right-2 -top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-text-on-inverse"
                  aria-hidden
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMore} className={cn(cell, "text-text-muted")}>
        <MoreIcon className="size-5" aria-hidden />
        <span>{moreNavItem.label}</span>
      </button>
    </nav>
  );
}
