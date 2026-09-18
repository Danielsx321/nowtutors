"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Monogram, Wordmark } from "@/components/layout/wordmark";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSharedUnreadCount } from "@/components/features/messaging/unread-context";
import { signOut } from "@/actions/auth";
import { itemIsActive, type NavItem } from "@/components/layout/nav-config";

export { itemIsActive } from "@/components/layout/nav-config";

/** Someone in the sidebar's people section (student: your tutors). */
export interface SidebarPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  href: string;
  /** "Live now" (with a green dot) or a short line like "3 sessions". */
  detail: string;
  live?: boolean;
}

export interface SidebarPeople {
  heading: string;
  people: SidebarPerson[];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 ml-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {children}
    </p>
  );
}

/**
 * The nav list for the authenticated shell (DESIGN.md v2, live-globe Part E;
 * pages.html dashboards): plain line icons, the active item a teal pill,
 * Messages carrying an orange unread count. The accessible name carries the
 * count too ("Messages, 2 unread"). It deliberately does NOT use the
 * `unread-badge` test id: the topbar owns it (E2E test 6).
 *
 * `collapsed` is the tablet rail (md to lg): icons only, label in a tooltip,
 * but the accessible name stays on the link so the E2E's
 * `getByRole("link", { name: /^messages/i })` keeps matching at every width.
 */
export function SidebarNav({
  items,
  collapsed,
  onNavigate,
  messagesHref,
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
  /** The role's inbox, so its item can show the unread count. */
  messagesHref?: string;
}) {
  const pathname = usePathname();
  const unread = useSharedUnreadCount(!!messagesHref);
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {items.map((item) => {
        const active = itemIsActive(pathname, item.href);
        const Icon = item.icon;
        const badge = item.href === messagesHref && unread > 0 ? unread : 0;
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={badge ? `${item.label}, ${badge} unread` : undefined}
            className={cn(
              "focus-ring relative flex items-center gap-3 rounded-xl text-body font-medium transition-colors",
              collapsed ? "justify-center px-0 py-3" : "px-3 py-[11px]",
              active
                ? "bg-primary text-on-primary"
                : "text-text-muted hover:bg-surface-muted hover:text-text",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden strokeWidth={1.75} />
            <span className={cn(collapsed && "sr-only")}>{item.label}</span>
            {badge > 0 && (
              <span
                aria-hidden
                className={cn(
                  "grid place-items-center rounded-full bg-spark font-semibold text-ink",
                  collapsed
                    ? "absolute right-1 top-1 min-w-4 px-1 text-[10px] leading-4"
                    : "ml-auto min-w-5 px-1.5 text-[11px] leading-5",
                )}
              >
                {badge > 9 ? "9+" : badge}
              </span>
            )}
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

/** Account links and Log out, the sidebar's last section. Log out is the one orange label (`spark-text`). */
export function SidebarAccount({
  links,
  onNavigate,
}: {
  links: { label: string; href: string }[];
  onNavigate?: () => void;
}) {
  return (
    <div>
      <SectionLabel>Account</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
            className="focus-ring rounded-xl px-3 py-[11px] text-body font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            {l.label}
          </Link>
        ))}
        <form action={signOut}>
          <button
            type="submit"
            className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-[11px] text-body font-medium text-spark-text transition-colors hover:bg-surface-muted"
          >
            <LogOut className="size-5 shrink-0" aria-hidden strokeWidth={1.75} />
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}

function People({ section }: { section: SidebarPeople }) {
  if (section.people.length === 0) return null;
  return (
    <div>
      <SectionLabel>{section.heading}</SectionLabel>
      <ul className="flex flex-col gap-0.5">
        {section.people.map((p) => (
          <li key={p.id}>
            <Link
              href={p.href}
              className="focus-ring flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-muted"
            >
              <Avatar src={p.avatarUrl ?? undefined} name={p.name} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-small font-semibold text-text">{p.name}</span>
                <span className="flex items-center gap-1.5 text-caption text-text-muted">
                  {p.live && <span aria-hidden className="size-[7px] rounded-full bg-live" />}
                  {p.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Desktop sidebar (pages.html dashboards `.side`). Hidden below `md`, an icon
 * rail between `md` and `lg` (where a 250px sidebar eats a third of the
 * screen), and the full sidebar at `lg`: wordmark, the Overview section, the
 * role's people section when there is one, and Account with Log out pinned to
 * the bottom. Below `md` the same items live in the bottom bar and its More
 * drawer.
 */
export function Sidebar({
  items,
  messagesHref,
  people,
  accountLinks,
}: {
  items: NavItem[];
  messagesHref?: string;
  people?: SidebarPeople | null;
  accountLinks: { label: string; href: string }[];
}) {
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col gap-6 border-r border-border bg-surface-raised px-2 py-4 md:flex lg:hidden">
        <div className="grid place-items-center" aria-hidden>
          <Monogram />
        </div>
        <SidebarNav items={items} collapsed messagesHref={messagesHref} />
      </aside>

      <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col gap-[26px] overflow-y-auto border-r border-border bg-surface-raised px-[18px] py-[26px] lg:flex">
        <div className="px-2.5">
          <Wordmark href="/" size="sm" />
        </div>
        <div>
          <SectionLabel>Overview</SectionLabel>
          <SidebarNav items={items} messagesHref={messagesHref} />
        </div>
        {people && <People section={people} />}
        <div className="mt-auto">
          <SidebarAccount links={accountLinks} />
        </div>
      </aside>
    </>
  );
}
