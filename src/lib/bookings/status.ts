import type { BadgeProps } from "@/components/ui/badge";

/**
 * Human labels + badge variants for booking statuses (SPEC §4.3 enum). Shared by
 * both sides' list and detail views so the wording can't drift. Cancellation/
 * no-show/expired states are admin- or cron-set only (SPEC §7.3, §18) — never
 * user-set — but still render here when an admin has set them.
 */
export interface BookingStatusMeta {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
}

const META: Record<string, BookingStatusMeta> = {
  pending_payment: { label: "Awaiting payment", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "success" },
  in_progress: { label: "In progress", variant: "purple" },
  completed: { label: "Completed", variant: "neutral" },
  cancelled_by_student: { label: "Cancelled", variant: "danger" },
  cancelled_by_tutor: { label: "Cancelled by tutor", variant: "danger" },
  no_show_student: { label: "No-show", variant: "danger" },
  no_show_tutor: { label: "Tutor no-show", variant: "danger" },
  expired: { label: "Expired", variant: "neutral" },
};

export function bookingStatusMeta(status: string): BookingStatusMeta {
  return META[status] ?? { label: status, variant: "neutral" };
}
