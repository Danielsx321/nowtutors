"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

/**
 * Toast host. Built on sonner, but fully restyled to brand tokens via
 * `unstyled` + `classNames` (Phase 2 amendment #2) — sonner's own palette is
 * never rendered, so the brand grep stays clean and toasts are on-brand.
 * Sonner provides the aria-live announcement region (SPEC §10.3).
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      gap={10}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-start gap-3 rounded-md border border-gray-200 bg-white p-4 text-body text-gray-700 shadow-md",
          title: "font-medium text-gray-700",
          description: "text-small text-gray-500",
          icon: "mt-0.5 shrink-0",
          actionButton:
            "focus-ring ml-auto rounded-md bg-purple-500 px-2.5 py-1 text-small font-medium text-white hover:bg-purple-700",
          cancelButton:
            "focus-ring rounded-md px-2.5 py-1 text-small font-medium text-gray-500 hover:bg-gray-50",
          closeButton:
            "focus-ring rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-danger",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-purple-500",
        },
      }}
    />
  );
}

export { toast };
