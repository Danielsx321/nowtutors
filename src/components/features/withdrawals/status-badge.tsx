import { Badge } from "@/components/ui/badge";
import type { WithdrawalStatus } from "@/lib/withdrawals/withdrawals";

const VARIANT = {
  requested: "warning",
  approved: "accent",
  paid: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const satisfies Record<WithdrawalStatus, string>;

const LABEL: Record<WithdrawalStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** One badge for a withdrawal's status, shared by the tutor and admin views. */
export function WithdrawalStatusBadge({ status }: { status: WithdrawalStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}

export function withdrawalStatusLabel(status: WithdrawalStatus): string {
  return LABEL[status];
}
