import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

/**
 * A plain-icon summary card (pages.html, dashboards `.mini`): a teal line
 * icon, a small label and one value. No tinted icon tile (DESIGN.md v2,
 * banned tells). The mockup's "⋮" is not reproduced: it would be a menu with
 * nothing in it. Instead the whole card links to where the number comes from.
 */
export function SummaryCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="focus-ring group flex items-center gap-3.5 rounded-[20px] border border-border bg-surface-raised px-[18px] py-4 transition-colors hover:border-border-strong"
    >
      <Icon className="size-6 shrink-0 text-accent" aria-hidden strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-small text-text-muted">{label}</span>
        <span data-numeric className="block font-display text-[17px] font-semibold leading-snug text-text">
          {value}
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
