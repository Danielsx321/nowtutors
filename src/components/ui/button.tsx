import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

/**
 * Buttons are pills (DESIGN.md, "Shape"). `primary` is the ink fill and the
 * default action everywhere; `live` is the green fill and is reserved for
 * live actions ("Request now", "Go live", "Join"): it is the product's one
 * loud colour and must stay rare.
 */
const buttonVariants = cva(
  // base
  "focus-ring relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary/85",
        secondary:
          "border border-border-strong bg-surface-raised text-text hover:bg-surface-muted",
        ghost: "text-text hover:bg-surface-muted",
        live: "bg-live text-on-live hover:brightness-95",
        danger: "bg-danger text-on-danger hover:brightness-95",
        /** @deprecated alias of `live`. REMOVE IN PART 6. */
        ink: "bg-live text-on-live hover:brightness-95",
        /** @deprecated white ghost for the old ink header, gone with it. REMOVE IN PART 6. */
        "ink-ghost": "text-text-on-inverse hover:bg-text-on-inverse/10",
      },
      size: {
        sm: "h-9 px-4 text-small [&_svg]:size-4",
        md: "h-11 px-5 text-body [&_svg]:size-5",
        lg: "h-12 px-7 text-body-lg [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild, loading, disabled, children, ...props },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);

    // asChild composes onto a single child (e.g. a Link) — no loading overlay.
    if (asChild) {
      return (
        <Slot ref={ref} className={classes} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 grid place-items-center">
            <Spinner
              size="sm"
              className="[&_span]:border-current [&_span]:border-t-transparent"
            />
          </span>
        )}
        <span className={cn("contents", loading && "invisible")}>{children}</span>
      </button>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
