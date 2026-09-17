import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        "focus-ring min-h-24 w-full rounded-lg border bg-surface-raised px-3 py-2 text-body text-text transition-colors",
        "placeholder:text-text-muted",
        "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
        invalid
          ? "border-danger focus-visible:outline-danger"
          : "border-border hover:border-border-strong",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
