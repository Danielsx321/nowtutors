import type { CreditTransactionType } from "./ledger";

/**
 * Human labels for `credit_transactions.type` (SPEC §4.4), shown in wallet
 * history (§7.10) and `/admin/payments`. Pure and DB-free.
 *
 * The three `instant_*` labels are gone with the enum values themselves
 * (drizzle/0014): §18 made instant billing a single flat `booking_debit`, and
 * the ledger held no rows of those types to orphan. `Record<CreditTransactionType, …>`
 * means adding an enum value without a label is a typecheck failure, so this map
 * cannot silently fall behind §4.4 again.
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
};

export function creditTransactionLabel(type: CreditTransactionType): string {
  return LABELS[type] ?? type;
}

/** `+30` / `−12`, using a real minus sign. `delta` is never zero (§4.4 check). */
export function formatCreditDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}
