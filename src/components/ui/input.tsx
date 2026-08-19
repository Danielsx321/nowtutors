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
        "focus-ring h-11 w-full rounded-md border bg-white px-3 text-body text-gray-700 transition-colors",
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
Input.displayName = "Input";
