import type { CreditTransactionType } from "./ledger";

/**
 * Human labels for `credit_transactions.type` (SPEC §4.4), shown in wallet
 * history (§7.10) and `/admin/payments`. Pure and DB-free.
 *
 * The three `instant_*` values are retained in the enum but **unused** — §18
 * made instant billing a single flat `booking_debit`. They are labelled anyway
 * so a historical row (or a hand-written admin adjustment) never renders as a
 * raw enum string in front of a user.
 */
const LABELS: Record<CreditTransactionType, string> = {
  purchase: "Credit purchase",
  booking_debit: "Session booked",
  booking_refund: "Session refunded",
  session_earning: "Session earnings",
  withdrawal_hold: "Withdrawal held",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_reversed: "Withdrawal reversed",
  admin_adjustment: "Admin adjustment",
  instant_hold: "Instant session hold",
  instant_release: "Instant session release",
  instant_capture: "Instant session charge",
};

export function creditTransactionLabel(type: CreditTransactionType): string {
  return LABELS[type] ?? type;
}

/** `+30` / `−12`, using a real minus sign. `delta` is never zero (§4.4 check). */
export function formatCreditDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}
