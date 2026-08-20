import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FieldErrorProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  children?: React.ReactNode;
}

/**
 * Inline validation message for a form field. Renders nothing when empty.
 * Give it an `id` and wire it to the input's `aria-describedby`.
 */
export function FieldError({ className, children, ...props }: FieldErrorProps) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-1.5 text-small text-danger",
        className,
      )}
      {...props}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
