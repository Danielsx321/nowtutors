"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "focus-ring peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
      "data-[state=unchecked]:bg-gray-200 data-[state=checked]:bg-purple-500",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform",
        "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-5",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
