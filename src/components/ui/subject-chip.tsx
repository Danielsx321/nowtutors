"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SubjectChipProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  selected?: boolean;
  interactive?: boolean;
  onRemove?: () => void;
}

/**
 * Subject tag. Static by default; `interactive` renders a toggle button (for
 * filters), `onRemove` adds a dismiss affordance (for selected-filter lists).
 */
export function SubjectChip({
  selected,
  interactive,
  onRemove,
  className,
  children,
  ...props
}: SubjectChipProps) {
  const base = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-small font-medium transition-colors",
    selected
      ? "border-primary bg-primary text-on-primary"
      : "border-border bg-surface-raised text-text",
    className,
  );

  if (interactive) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={cn(base, "focus-ring hover:border-border-strong")}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <span className={base} {...props}>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="focus-ring -mr-1 grid size-4 place-items-center rounded-full hover:bg-on-primary/20"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
