import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

const buttonVariants = cva(
  // base
  "focus-ring relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-purple-500 text-white hover:bg-purple-700",
        secondary:
          "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
        ghost: "text-purple-500 hover:bg-purple-100",
        danger: "bg-danger text-white hover:brightness-95",
        // On-ink variants (SPEC §10.1): purple is fill-only-with-white-text and is
        // avoided entirely on ink surfaces here — gold/white carry the contrast instead.
        ink: "bg-gold-400 text-ink-900 hover:brightness-95",
        "ink-ghost": "text-white hover:bg-ink-800",
      },
      size: {
        sm: "h-9 px-3 text-small [&_svg]:size-4",
        md: "h-11 px-4 text-body [&_svg]:size-5",
        lg: "h-12 px-6 text-body-lg [&_svg]:size-5",
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
