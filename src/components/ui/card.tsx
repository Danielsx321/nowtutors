import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface container: raised surface, hairline border, no shadow at rest
 * (DESIGN.md, "Cards"). `interactive` adds the hover border for cards that are
 * one big link.
 *
 * `surface="ink"` is the old dark-card treatment, kept rendering (on the
 * inverse tokens) so the pages Parts 3 to 5 convert stay legible in between.
 * REMOVE IN PART 6.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  /** @deprecated REMOVE IN PART 6 */
  surface?: "white" | "ink";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, surface = "white", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border transition-colors",
        surface === "ink"
          ? "border-border-strong bg-surface-inverse text-text-on-inverse"
          : "border-border bg-surface-raised text-text",
        interactive && "hover:border-border-strong",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-display text-h3 font-semibold", className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-small text-text-muted", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-3 p-5 pt-0", className)} {...props} />
  );
}
