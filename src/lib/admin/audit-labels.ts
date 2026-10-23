/**
 * Audit actions in plain words, for the admin dashboard's "Recent activity"
 * (Part G). Unknown actions fall back to the raw name rather than guessing,
 * so a new action still shows up, just less politely, until it's added here.
 */
const LABELS: Record<string, string> = {
  "tutor.approve": "Approved a tutor",
  "tutor.reject": "Rejected a tutor application",
  "tutor.request_changes": "Asked a tutor for changes",
  "tutor.mark_reviewed": "Re-reviewed a changed tutor profile",
  "withdrawal.request": "A tutor requested a withdrawal",
  "withdrawal.approve": "Approved a withdrawal",
  "withdrawal.reject": "Rejected a withdrawal",
  "withdrawal.mark_paid": "Marked a withdrawal paid",
  "booking.force_cancel": "Force-cancelled a booking",
  "booking.force_complete": "Force-completed a booking",
  "payment.reverse_refund": "Reversed a refund",
  "wallet.adjust": "Adjusted a wallet",
  "user.suspend": "Suspended an account",
  "user.unsuspend": "Lifted a suspension",
  "user.promote_admin": "Made someone an admin",
  "setting.update": "Changed a setting",
  "subject.create": "Added a subject",
  "subject.rename": "Renamed a subject",
  "subject.activate": "Turned a subject on",
  "subject.deactivate": "Turned a subject off",
  "cron.run_now": "Ran a scheduled job by hand",
  "bonus.award_run": "Paid the weekly availability bonus",
  payout_email_changed: "A tutor set or changed their payout email",
};

export function auditActionLabel(action: string): string {
  return LABELS[action] ?? action;
}
