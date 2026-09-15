import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-surface-muted text-text",
        accent: "bg-accent/10 text-accent",
        live: "bg-live-surface text-live",
        success: "bg-success-surface text-success",
        warning: "bg-warning-surface text-warning",
        danger: "bg-danger-surface text-danger",
        // solid, for the rare place a filled label is needed on a light surface
        solid: "bg-primary text-on-primary",
        /** @deprecated alias of `accent`, REMOVE IN PART 6 */
        purple: "bg-accent/10 text-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
