import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface container. `white` reads on any background; `ink` is the elevated
 * dark surface for the authenticated shell (SPEC §10.1).
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  surface?: "white" | "ink";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, surface = "white", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border shadow-sm",
        surface === "white"
          ? "border-gray-200 bg-white text-gray-700"
          : "border-ink-800 bg-ink-800 text-white",
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
    <h3 className={cn("text-h3 font-bold", className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-small text-gray-500", className)} {...props} />
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
