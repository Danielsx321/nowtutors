"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/layout/wordmark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavItem } from "@/components/layout/nav-config";

export function itemIsActive(pathname: string, href: string) {
  // Exact match for role-root links (e.g. /tutor), prefix match otherwise, so
  // /tutor doesn't light up on /tutor/bookings.
  const segments = href.split("/").filter(Boolean);
  if (segments.length <= 1) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The nav list for the authenticated shell. Light surface: the active item is
 * a muted fill with an accent bar down its left edge, which reads at a glance
 * without colouring the text.
 *
 * `collapsed` is the tablet rail (md to lg): icons only, label in a tooltip,
 * but the accessible name stays on the link so the E2E's
 * `getByRole("link", { name: /^messages/i })` keeps matching at every width.
 */
export function SidebarNav({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {items.map((item) => {
        const active = itemIsActive(pathname, item.href);
        const Icon = item.icon;
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring relative flex items-center gap-3 rounded-md text-body font-medium transition-colors",
              collapsed ? "justify-center px-0 py-3" : "px-3 py-2.5",
              active
                ? "bg-surface-muted text-text"
                : "text-text-muted hover:bg-surface-muted hover:text-text",
            )}
          >
            {active && (
              <span
                className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent"
                aria-hidden
              />
            )}
            <Icon
              className={cn("size-5 shrink-0", active && "fill-current/10")}
              aria-hidden
            />
            <span className={cn(collapsed && "sr-only")}>{item.label}</span>
          </Link>
        );
        return (
          <div key={item.href} className={cn(item.groupStart && "mt-3 border-t border-border pt-3")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Desktop sidebar. Hidden below `md`, an icon rail between `md` and `lg`
 * (where a 256px sidebar eats a third of the screen), full width at `lg`.
 * Below `md` the same items live in the bottom bar and its More drawer.
 */
export function Sidebar({
  items,
  roleLabel,
}: {
  items: NavItem[];
  roleLabel: string;
}) {
  return (
    <>
      <aside className="hidden w-16 shrink-0 flex-col gap-6 border-r border-border bg-surface px-2 py-4 md:flex lg:hidden">
        <div className="grid place-items-center" aria-hidden>
          <span className="font-wordmark text-h3 font-bold text-text">N</span>
        </div>
        <SidebarNav items={items} collapsed />
      </aside>

      <aside className="hidden w-64 shrink-0 flex-col gap-5 border-r border-border bg-surface p-4 lg:flex">
        <div className="px-2 pt-2">
          <Wordmark href="/" size="sm" />
        </div>
        <p className="px-3 text-caption font-medium text-text-muted">{roleLabel}</p>
        <SidebarNav items={items} />
      </aside>
    </>
  );
}
