"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "focus-ring peer grid size-5 shrink-0 place-items-center rounded-sm border border-gray-500 bg-white transition-colors",
      "data-[state=checked]:border-purple-500 data-[state=checked]:bg-purple-500 data-[state=checked]:text-white",
      "data-[state=indeterminate]:border-purple-500 data-[state=indeterminate]:bg-purple-500 data-[state=indeterminate]:text-white",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="grid place-items-center text-current">
      {props.checked === "indeterminate" ? (
        <Minus className="size-3.5" strokeWidth={3} />
      ) : (
        <Check className="size-3.5" strokeWidth={3} />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
