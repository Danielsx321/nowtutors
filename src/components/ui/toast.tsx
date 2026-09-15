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
            "flex w-full items-start gap-3 rounded-md border border-border bg-surface-raised p-4 text-body text-text shadow-md",
          title: "font-medium text-text",
          description: "text-small text-text-muted",
          icon: "mt-0.5 shrink-0",
          actionButton:
            "focus-ring ml-auto rounded-md bg-primary px-2.5 py-1 text-small font-medium text-on-primary hover:bg-primary/85",
          cancelButton:
            "focus-ring rounded-md px-2.5 py-1 text-small font-medium text-text-muted hover:bg-surface-muted",
          closeButton:
            "focus-ring rounded-md border border-border bg-surface-raised text-text-muted hover:bg-surface-muted",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-danger",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-text-muted",
        },
      }}
    />
  );
}

export { toast };
