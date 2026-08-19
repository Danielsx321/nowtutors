import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
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
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-200 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          className="grid size-12 place-items-center rounded-full bg-purple-100 text-purple-500"
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <p className="text-h3 font-bold text-gray-700">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-body text-gray-500">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
