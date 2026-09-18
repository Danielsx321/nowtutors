import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PersonRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** "Maths · live now", "Economics · 3 sessions" */
  detail: string;
  /** A green dot on the avatar: live right now. */
  live?: boolean;
  /** Where the row's name links. */
  href: string;
  /** One action per row, or none. */
  action?: { label: string; href: string; variant: "primary" | "outline" };
}

/**
 * The right column's list of people (pages.html `.tutor-row`): avatar with a
 * live dot when live, name, one line of detail and at most one action. Used
 * for "Your tutors" here; Parts F and G reuse it for recent students and the
 * approval queue.
 */
export function PeopleList({ people }: { people: PersonRow[] }) {
  return (
    <ul>
      {people.map((p, i) => (
        <li
          key={p.id}
          className={cn("flex items-center gap-3 py-3", i > 0 && "border-t border-dashed border-border")}
        >
          <span className="relative shrink-0">
            <Avatar src={p.avatarUrl ?? undefined} name={p.name} size="lg" />
            {p.live && (
              <span
                aria-hidden
                className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface-raised bg-live"
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <Link href={p.href} className="focus-ring block truncate rounded-sm text-body font-semibold text-text hover:underline">
              {p.name}
            </Link>
            <span className="block truncate text-small text-text-muted">{p.detail}</span>
          </span>
          {p.action && (
            <Button asChild size="sm" variant={p.action.variant} className="h-[34px] shrink-0 px-3.5">
              <Link href={p.action.href}>{p.action.label}</Link>
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
