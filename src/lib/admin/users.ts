import { z } from "zod";

/**
 * Pure rules for `/admin/users` (SPEC §5, §6, §7.10; Phase 8 Part 5). No
 * database, no framework: the actions and the query layer call these, and the
 * unit tests pin them.
 */

/** Largest single admin adjustment, either direction. A guard rail, not a product rule. */
export const MAX_ADJUSTMENT_CREDITS = 10_000;
export const ADJUSTMENT_NOTE_MIN = 5;
export const ADJUSTMENT_NOTE_MAX = 500;

/**
 * What the user reads in their wallet history. The admin's note is internal (it
 * can name another person or a dispute), so it lives in `audit_log` only.
 */
export const ADJUSTMENT_DESCRIPTION = "Adjusted by NowTutors support";

export const adjustmentSchema = z.object({
  userId: z.string().uuid(),
  delta: z
    .number({ error: "Enter a whole number of credits." })
    .int("Enter a whole number of credits.")
    .refine((n) => n !== 0, "The adjustment can't be zero.")
    .refine(
      (n) => Math.abs(n) <= MAX_ADJUSTMENT_CREDITS,
      `One adjustment can move at most ${MAX_ADJUSTMENT_CREDITS.toLocaleString("en-US")} credits.`,
    ),
  note: z
    .string()
    .trim()
    .min(ADJUSTMENT_NOTE_MIN, "Add a note saying why (at least 5 characters).")
    .max(ADJUSTMENT_NOTE_MAX, "Keep the note under 500 characters."),
  /**
   * One per rendered form. Used as the ledger `reference_id`, so a double-click
   * or a retried request lands once (the `(type, reference_id)` unique index),
   * while a deliberate second adjustment from a fresh form is a new key.
   */
  requestKey: z.string().uuid(),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export type Role = "student" | "tutor" | "admin";

/** Roles whose wallet an admin may adjust. Admins and not-onboarded accounts have no wallet UI. */
export function canAdjustWallet(role: Role | null): boolean {
  return role === "student" || role === "tutor";
}

export function selfSuspensionRefused(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}

/** Everything promotion looks at, read under the profile row lock. */
export interface PromotionFacts {
  role: Role | null;
  isSuspended: boolean;
  email: string;
  walletBalance: number;
  /** confirmed or in_progress bookings where the user is student or tutor. */
  openBookings: number;
  /** requested or approved withdrawal requests. */
  openWithdrawals: number;
  /** tutor_earnings rows still held or available. */
  unpaidEarnings: number;
}

export type PromotionBlocker =
  | "not_found"
  | "already_admin"
  | "not_onboarded"
  | "suspended"
  | "email_mismatch"
  | "wallet_balance"
  | "open_bookings"
  | "open_withdrawal"
  | "unpaid_earnings";

/**
 * Why this account can't be promoted right now, in the order an admin should
 * fix them; an empty list means go.
 *
 * An admin has no wallet, bookings or earnings pages, so promoting someone who
 * still has credits, sessions or money owed would strand it. The admin types
 * the account's email to confirm, so a mis-click on the wrong row can't make
 * someone an admin.
 */
export function promotionBlockers(
  facts: PromotionFacts | null,
  confirmEmail: string,
): PromotionBlocker[] {
  if (!facts) return ["not_found"];
  if (facts.role === "admin") return ["already_admin"];
  const out: PromotionBlocker[] = [];
  if (facts.role === null) out.push("not_onboarded");
  if (facts.isSuspended) out.push("suspended");
  if (confirmEmail.trim().toLowerCase() !== facts.email.trim().toLowerCase()) {
    out.push("email_mismatch");
  }
  if (facts.walletBalance !== 0) out.push("wallet_balance");
  if (facts.openBookings > 0) out.push("open_bookings");
  if (facts.openWithdrawals > 0) out.push("open_withdrawal");
  if (facts.unpaidEarnings > 0) out.push("unpaid_earnings");
  return out;
}

const BLOCKER_MESSAGES: Record<PromotionBlocker, string> = {
  not_found: "User not found.",
  already_admin: "This account is already an admin.",
  not_onboarded: "This account hasn't finished onboarding.",
  suspended: "Unsuspend the account first.",
  email_mismatch: "The email you typed doesn't match this account.",
  wallet_balance: "The wallet still holds credits. Bring the balance to 0 first.",
  open_bookings: "The account has upcoming or in-progress sessions.",
  open_withdrawal: "The account has an open withdrawal request.",
  unpaid_earnings: "The account has tutor earnings that haven't been paid out.",
};

export function promotionBlockerMessage(b: PromotionBlocker): string {
  return BLOCKER_MESSAGES[b];
}

/**
 * The search box. Trimmed, capped, and matched with `position()` in SQL rather
 * than `LIKE`, so `%` or `_` typed by an admin is a literal character.
 */
export function normalizeUserSearch(q: string | null | undefined): string | null {
  const t = (q ?? "").trim().slice(0, 100);
  return t.length ? t.toLowerCase() : null;
}

export const USER_FILTERS = ["student", "tutor", "admin", "unset", "suspended"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export function parseUserFilter(v: string | null | undefined): UserFilter | null {
  return (USER_FILTERS as readonly string[]).includes(v ?? "") ? (v as UserFilter) : null;
}
