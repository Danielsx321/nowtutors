import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

/**
 * Buttons are pills (DESIGN.md v2, "Buttons"). Roles, not colours:
 *
 * - `primary` — teal fill. The main action on a screen, and the only teal fill.
 * - `highlight` — yellow fill. The second action beside a primary one
 *   ("Book for later" next to "Find a live tutor").
 * - `ink` — near-black fill. A neutral action inside a card, where teal would
 *   compete with the page's own primary.
 * - `outline` — a bordered button on the surface it sits on.
 * - `ghost` — text only, for toolbars and menus.
 * - `live` — green fill, reserved for going on air ("Go live", "Join"). The
 *   product's one loud colour: it stays rare. "Request now" is `primary` from
 *   the live-globe rebuild on (Part D, as mocked): the green is the tutor's
 *   ring and chip, not the student's button.
 * - `danger` — destructive only.
 */
const buttonVariants = cva(
  // base
  "focus-ring relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary/85",
        highlight: "bg-highlight text-on-highlight hover:brightness-95",
        ink: "bg-ink text-on-ink hover:bg-ink/85",
        outline:
          "border border-border-strong bg-surface-raised text-text hover:bg-surface-muted",
        ghost: "text-text hover:bg-surface-muted",
        live: "bg-live text-on-live hover:brightness-95",
        danger: "bg-danger text-on-danger hover:brightness-95",
      },
      size: {
        sm: "h-[38px] px-4 text-small [&_svg]:size-4",
        md: "h-[46px] px-5 text-body [&_svg]:size-5",
        lg: "h-[54px] px-7 text-body-lg [&_svg]:size-5",
        icon: "size-[46px] [&_svg]:size-5",
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
