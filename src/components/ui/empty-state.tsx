import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * Render the title as a real heading. Only where the empty state is the page
   * (the 404 uses 1); inside a page it stays text, so it can't jump the outline.
   */
  headingLevel?: 1 | 2 | 3;
}

/**
 * Designed empty state (SPEC §10.3: empty states are not afterthoughts — an
 * empty bookings list invites the student to browse tutors).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel,
  className,
  ...props
}: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          className="grid size-12 place-items-center rounded-full bg-surface-muted text-text-muted"
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <Title className="text-h3 font-bold text-text">{title}</Title>
        {description && (
          <p className="mx-auto max-w-sm text-body text-text-muted">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
