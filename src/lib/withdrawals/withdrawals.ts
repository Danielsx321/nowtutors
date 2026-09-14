import { randomUUID } from "node:crypto";
import {
  creditWallet,
  debitWallet,
  DuplicateLedgerReferenceError,
  type LedgerExecutor,
} from "@/lib/credits/ledger";
import {
  centsToUsdString,
  creditsToPayoutCents,
  usdToCents,
} from "@/lib/withdrawals/payout-rate";

/**
 * The withdrawal money path (SPEC §7.11; Phase 8 Part 2).
 *
 * **The hold IS the debit, and it is the only one.** Request writes the
 * `withdrawal_requests` row and a `withdrawal_hold` debit for the same amount in
 * one transaction, so the credits leave `wallets.credit_balance` the moment they
 * are promised to PayPal and cannot be spent or requested twice. Reject writes a
 * `withdrawal_reversed` credit against the same reference. **Mark paid writes no
 * ledger row**: the money already left at the hold, and a second debit would
 * take it twice (`credit_transactions.delta <> 0` rules out a zero marker row
 * too). Paid is recorded by the request's status, `external_reference`,
 * `processed_by/at` and `audit_log`. `withdrawal_paid` stays in the enum unused.
 * See DECISIONS, "Phase 8 Part 2".
 *
 * **A request always withdraws the whole available balance.** No amount comes
 * from the client. Partial withdrawals would make "which earnings rows are
 * withdrawn" ambiguous, and it matches the live Bubble behaviour.
 *
 * **`available` is derived from the ledger, never a counter.** The balance is
 * read under the wallet row lock; there is no `total_withdrawn` to forget to
 * write (§7.11, Decision 4).
 *
 * **Every transition locks its request row and re-checks status inside the
 * transaction**, so a double-clicked "Mark paid" transitions once and the loser
 * gets `wrong_status`. The `(type, reference_id)` unique index (§4.4) is the
 * database-level second guarantee that a request is held once and reversed once.
 *
 * Refusals are returned as tags the UI switches on, never thrown, so a refusal
 * writes nothing and needs no rollback. Behind {@link WithdrawalStore} so the
 * rules run in unit tests without Postgres; the adapter is
 * `db/queries/withdrawals.ts`, and the concurrency properties are asserted
 * against real Postgres in `tests/integration/withdrawals.test.ts`.
 */

export type WithdrawalStatus =
  | "requested"
  | "approved"
  | "paid"
  | "rejected"
  | "cancelled";

export interface WithdrawalRow {
  id: string;
  tutorId: string;
  amountCredits: number;
  /** `numeric(10,2)` text, e.g. `"30.66"`. */
  amountUsd: string;
  payoutDestination: string;
  status: WithdrawalStatus;
  createdAt: Date;
}

export interface NewWithdrawal {
  id: string;
  tutorId: string;
  amountCredits: number;
  amountUsd: string;
  payoutDestination: string;
}

export interface WithdrawalAudit {
  actorId: string;
  action:
    | "withdrawal.request"
    | "withdrawal.approve"
    | "withdrawal.mark_paid"
    | "withdrawal.reject";
  targetId: string;
  payload: Record<string, unknown>;
}

/** Raised by the adapter when the one-open-request index refuses an insert. */
export class OpenWithdrawalExistsError extends Error {
  readonly code = "open_withdrawal_exists" as const;
  constructor(readonly tutorId: string) {
    super("This tutor already has an open withdrawal request.");
    this.name = "OpenWithdrawalExistsError";
  }
}

/** Storage for ONE transaction. Every method runs inside it. */
export interface WithdrawalStore {
  readonly ledger: LedgerExecutor;
  /**
   * The tutor's balance under `SELECT ... FOR UPDATE` on their wallet row; 0
   * when no wallet exists. This lock is what serializes two requests.
   */
  lockWalletBalance(tutorId: string): Promise<number>;
  getPayoutEmail(tutorId: string): Promise<string | null>;
  hasOpenRequest(tutorId: string): Promise<boolean>;
  /** Throws {@link OpenWithdrawalExistsError} on the one-open index. */
  insertRequest(row: NewWithdrawal): Promise<WithdrawalRow>;
  /** The row under `SELECT ... FOR UPDATE`, or null. */
  lockRequest(id: string): Promise<WithdrawalRow | null>;
  setStatus(
    id: string,
    patch: {
      status: WithdrawalStatus;
      processedBy: string;
      adminNote?: string;
      externalReference?: string;
    },
  ): Promise<void>;
  /**
   * Flip to `withdrawn` every `available` earnings row of this tutor whose
   * `session_earning` credit was written at or before `requestedAt`. Those are
   * exactly the credits the full-balance request swept up. Returns the ids.
   */
  markEarningsWithdrawn(tutorId: string, requestedAt: Date): Promise<string[]>;
  insertAudit(entry: WithdrawalAudit): Promise<void>;
}

/** Runs `fn` in one transaction; a throw rolls everything back. */
export type WithdrawalRunner = <T>(
  fn: (store: WithdrawalStore) => Promise<T>,
) => Promise<T>;

export interface WithdrawalSettings {
  minWithdrawalUsd: number;
  /** `null` when the setting is missing or invalid. Requests refuse. */
  payoutUsdPerCredit: number | null;
}

export type RequestRefusal =
  | "payout_rate_unset"
  | "no_payout_email"
  | "already_open"
  | "no_balance"
  | "below_minimum";

export type TransitionRefusal =
  | "not_found"
  | "wrong_status"
  | "reference_required"
  | "note_required"
  | "already_reversed";

export type RequestResult =
  | {
      ok: true;
      withdrawal: { id: string; amountCredits: number; amountUsd: string };
    }
  | { ok: false; reason: RequestRefusal };

export type TransitionResult =
  | { ok: true; earningsWithdrawn?: number }
  | { ok: false; reason: TransitionRefusal; status?: WithdrawalStatus };

/** Minimum length of a rejection note, same as a tutor-application rejection. */
export const REJECT_NOTE_MIN = 5;

export async function requestWithdrawal(
  run: WithdrawalRunner,
  params: { tutorId: string; settings: WithdrawalSettings },
): Promise<RequestResult> {
  const { tutorId, settings } = params;
  const rate = settings.payoutUsdPerCredit;
  if (rate === null) return { ok: false, reason: "payout_rate_unset" };

  try {
    return await run(async (store): Promise<RequestResult> => {
      // Lock first: every check below reads state a concurrent request could
      // change, so none of them means anything outside this lock.
      const balance = await store.lockWalletBalance(tutorId);
      if (await store.hasOpenRequest(tutorId)) {
        return { ok: false, reason: "already_open" };
      }
      const email = (await store.getPayoutEmail(tutorId))?.trim();
      if (!email) return { ok: false, reason: "no_payout_email" };
      if (balance <= 0) return { ok: false, reason: "no_balance" };

      const cents = creditsToPayoutCents(balance, rate);
      if (cents < usdToCents(settings.minWithdrawalUsd)) {
        return { ok: false, reason: "below_minimum" };
      }
      const amountUsd = centsToUsdString(cents);

      const row = await store.insertRequest({
        id: randomUUID(),
        tutorId,
        amountCredits: balance,
        amountUsd,
        payoutDestination: email,
      });
      await debitWallet(store.ledger, {
        userId: tutorId,
        amount: balance,
        type: "withdrawal_hold",
        referenceType: "withdrawal_request",
        referenceId: row.id,
        description: "Withdrawal requested",
      });
      await store.insertAudit({
        actorId: tutorId,
        action: "withdrawal.request",
        targetId: row.id,
        payload: {
          amount_credits: balance,
          amount_usd: amountUsd,
          // Snapshotted so a later rate change never re-prices this request.
          payout_usd_per_credit: rate,
        },
      });
      return {
        ok: true,
        withdrawal: { id: row.id, amountCredits: balance, amountUsd },
      };
    });
  } catch (err) {
    if (err instanceof OpenWithdrawalExistsError) {
      return { ok: false, reason: "already_open" };
    }
    throw err;
  }
}

export async function approveWithdrawal(
  run: WithdrawalRunner,
  params: { id: string; adminId: string },
): Promise<TransitionResult> {
  return run(async (store): Promise<TransitionResult> => {
    const row = await store.lockRequest(params.id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "requested") {
      return { ok: false, reason: "wrong_status", status: row.status };
    }
    await store.setStatus(row.id, {
      status: "approved",
      processedBy: params.adminId,
    });
    await store.insertAudit({
      actorId: params.adminId,
      action: "withdrawal.approve",
      targetId: row.id,
      payload: { from: row.status, to: "approved" },
    });
    return { ok: true };
  });
}

export async function markWithdrawalPaid(
  run: WithdrawalRunner,
  params: { id: string; adminId: string; externalReference: string },
): Promise<TransitionResult> {
  const reference = params.externalReference.trim();
  if (!reference) return { ok: false, reason: "reference_required" };

  return run(async (store): Promise<TransitionResult> => {
    const row = await store.lockRequest(params.id);
    if (!row) return { ok: false, reason: "not_found" };
    // Approve first, always (SPEC §6: approve → pay → mark paid).
    if (row.status !== "approved") {
      return { ok: false, reason: "wrong_status", status: row.status };
    }
    await store.setStatus(row.id, {
      status: "paid",
      processedBy: params.adminId,
      externalReference: reference,
    });
    // No ledger row: the hold was the debit. See the module note.
    const flipped = await store.markEarningsWithdrawn(row.tutorId, row.createdAt);
    await store.insertAudit({
      actorId: params.adminId,
      action: "withdrawal.mark_paid",
      targetId: row.id,
      payload: {
        from: row.status,
        to: "paid",
        external_reference: reference,
        amount_credits: row.amountCredits,
        amount_usd: row.amountUsd,
        earnings_withdrawn: flipped,
      },
    });
    return { ok: true, earningsWithdrawn: flipped.length };
  });
}

export async function rejectWithdrawal(
  run: WithdrawalRunner,
  params: { id: string; adminId: string; note: string },
): Promise<TransitionResult> {
  const note = params.note.trim();
  if (note.length < REJECT_NOTE_MIN) {
    return { ok: false, reason: "note_required" };
  }

  try {
    return await run(async (store): Promise<TransitionResult> => {
      const row = await store.lockRequest(params.id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status !== "requested" && row.status !== "approved") {
        return { ok: false, reason: "wrong_status", status: row.status };
      }
      await creditWallet(store.ledger, {
        userId: row.tutorId,
        delta: row.amountCredits,
        type: "withdrawal_reversed",
        referenceType: "withdrawal_request",
        referenceId: row.id,
        description: "Withdrawal rejected, credits returned",
        createdBy: params.adminId,
      });
      await store.setStatus(row.id, {
        status: "rejected",
        processedBy: params.adminId,
        adminNote: note,
      });
      await store.insertAudit({
        actorId: params.adminId,
        action: "withdrawal.reject",
        targetId: row.id,
        payload: {
          from: row.status,
          to: "rejected",
          note,
          amount_credits: row.amountCredits,
        },
      });
      return { ok: true };
    });
  } catch (err) {
    // A reversal already exists for a request that is still open: the
    // database refused a second one and the transaction rolled back. Surfaced,
    // never retried, because it means the row and the ledger disagree.
    if (err instanceof DuplicateLedgerReferenceError) {
      return { ok: false, reason: "already_reversed" };
    }
    throw err;
  }
}

/** Plain-English message for a refusal, shown by the UI and the actions. */
export function withdrawalRefusalMessage(
  reason: RequestRefusal | TransitionRefusal,
  context: { minWithdrawalUsd?: number } = {},
): string {
  switch (reason) {
    case "payout_rate_unset":
      return "Withdrawals aren't open yet. The payout rate hasn't been set.";
    case "no_payout_email":
      return "Add your PayPal email in Settings before requesting a withdrawal.";
    case "already_open":
      return "You already have a withdrawal in progress.";
    case "no_balance":
      return "You have no available credits to withdraw.";
    case "below_minimum":
      return context.minWithdrawalUsd != null
        ? `The minimum withdrawal is $${context.minWithdrawalUsd.toFixed(2)}.`
        : "Your available balance is below the minimum withdrawal.";
    case "not_found":
      return "Withdrawal request not found.";
    case "wrong_status":
      return "This request has already moved on. Refresh to see its current status.";
    case "reference_required":
      return "Enter the PayPal transaction ID.";
    case "note_required":
      return `A note of at least ${REJECT_NOTE_MIN} characters is required.`;
    case "already_reversed":
      return "The credits for this request were already returned. Check the audit log.";
  }
}
