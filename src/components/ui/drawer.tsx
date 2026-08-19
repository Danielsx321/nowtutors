"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Side sheet, built on Radix Dialog (no extra dependency). Slides from the
 * right by default; used for mobile nav and filter panels. Enter/exit motion
 * is hand-rolled in globals.css via the data-slot hook.
 */
export const Drawer = Dialog.Root;
export const DrawerTrigger = Dialog.Trigger;
export const DrawerClose = Dialog.Close;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
    hideClose?: boolean;
  }
>(({ className, hideClose, children, ...props }, ref) => (
  <Dialog.Portal>
    <Dialog.Overlay
      data-slot="overlay"
      className="fixed inset-0 z-50 bg-ink-900/60"
    />
    <Dialog.Content
      ref={ref}
      data-slot="drawer-content"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-[calc(100%-3rem)] max-w-sm flex-col border-l border-gray-200 bg-white shadow-lg",
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <Dialog.Close
          aria-label="Close"
          className="focus-ring absolute right-4 top-4 grid size-8 place-items-center rounded-md text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
        >
          <X className="size-5" />
        </Dialog.Close>
      )}
    </Dialog.Content>
  </Dialog.Portal>
));
DrawerContent.displayName = "DrawerContent";

export function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-b border-gray-200 p-5 pr-12", className)}
      {...props}
    />
  );
}

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title
    ref={ref}
    className={cn("text-h3 font-bold text-gray-700", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description
    ref={ref}
    className={cn("text-body text-gray-500", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

export function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto p-5", className)} {...props} />;
}

export function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex gap-2 border-t border-gray-200 p-5", className)}
      {...props}
    />
  );
}
