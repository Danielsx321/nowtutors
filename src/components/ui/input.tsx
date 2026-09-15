import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Text input. Pass `invalid` to show the error border and set aria-invalid;
 * pair with <Label> and <FieldError> for a complete field.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "focus-ring h-11 w-full rounded-md border bg-surface-raised px-3 text-body text-text transition-colors",
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
Input.displayName = "Input";
