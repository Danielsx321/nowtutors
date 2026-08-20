"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/layout/nav-config";

function itemIsActive(pathname: string, href: string) {
  // Exact match for role-root links (e.g. /tutor), prefix match otherwise, so
  // /tutor doesn't light up on /tutor/bookings.
  const segments = href.split("/").filter(Boolean);
  if (segments.length <= 1) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The nav list for the authenticated shell. Dark-surface styling: white/gold
 * text, purple used only as a fill on the active item (SPEC §10.1 — purple on
 * ink fails contrast for small text, so it is never text on ink here).
 */
export function SidebarNav({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {items.map((item) => {
        const active = itemIsActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring-on-ink flex items-center gap-3 rounded-md px-3 py-2.5 text-body font-medium transition-colors",
              active
                ? "bg-purple-500 text-white"
                : "text-gray-200 hover:bg-ink-800 hover:text-white",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({
  items,
  roleLabel,
}: {
  items: NavItem[];
  roleLabel: string;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 bg-ink-900 p-4 md:flex">
      <div className="flex items-center gap-2 px-2 pt-2">
        <span className="text-h3 font-bold text-white">
          Now<span className="text-gold-400">Tutors</span>
        </span>
      </div>
      <p className="px-3 text-caption font-medium uppercase tracking-wide text-ink-300">
        {roleLabel}
      </p>
      <SidebarNav items={items} />
    </aside>
  );
}
