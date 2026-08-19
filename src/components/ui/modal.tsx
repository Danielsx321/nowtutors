"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Modal = Dialog.Root;
export const ModalTrigger = Dialog.Trigger;
export const ModalClose = Dialog.Close;

const sizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;

export const ModalContent = React.forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
    size?: keyof typeof sizes;
    hideClose?: boolean;
  }
>(({ className, size = "md", hideClose, children, ...props }, ref) => (
  <Dialog.Portal>
    <Dialog.Overlay
      data-slot="overlay"
      className="fixed inset-0 z-50 bg-ink-900/60"
    />
    <Dialog.Content
      ref={ref}
      data-slot="modal-content"
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-lg",
        sizes[size],
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
ModalContent.displayName = "ModalContent";

export function ModalHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-8", className)} {...props} />;
}

export const ModalTitle = React.forwardRef<
  React.ElementRef<typeof Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title
    ref={ref}
    className={cn("text-h3 font-bold text-gray-700", className)}
    {...props}
  />
));
ModalTitle.displayName = "ModalTitle";

export const ModalDescription = React.forwardRef<
  React.ElementRef<typeof Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description
    ref={ref}
    className={cn("text-body text-gray-500", className)}
    {...props}
  />
));
ModalDescription.displayName = "ModalDescription";

export function ModalFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
