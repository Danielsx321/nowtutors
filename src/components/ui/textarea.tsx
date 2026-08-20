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
        "focus-ring min-h-24 w-full rounded-md border bg-white px-3 py-2 text-body text-gray-700 transition-colors",
        "placeholder:text-gray-500",
        "disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60",
        invalid
          ? "border-danger focus-visible:outline-danger"
          : "border-gray-200 hover:border-gray-500",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
