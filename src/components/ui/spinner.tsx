import * as React from "react";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-4 border-2",
  md: "size-6 border-2",
  lg: "size-8 border-[3px]",
} as const;

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof sizes;
  label?: string;
}

/** Indeterminate loading spinner. Ink ring on a muted track, transparent top. */
export function Spinner({
  size = "md",
  label = "Loading",
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-block", className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "block rounded-full border-border border-t-primary animate-spin-brand",
          sizes[size],
        )}
      />
      <span className="sr-only">{label}…</span>
    </span>
  );
}
