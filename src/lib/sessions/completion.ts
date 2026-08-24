/**
 * Which completion outcomes pay a tutor (SPEC §7.11, Phase 6 Part 3C).
 *
 * Pure and `server-only`-free, like `deadline.ts` beside it, so the rule that
 * decides whether money is promised can be asserted without a database.
 *
 * The rule has three cases and only two answers:
 *
 *  - **`completed`** — the session happened. The tutor is paid.
 *  - **`no_show_student`** — the tutor held the slot and was in the room; the
 *    student never arrived. **Paid in full, identically to `completed`.** The
 *    student's credits were taken at booking and §7.4 refunds nothing on any
 *    path, so the alternative is the platform keeping the whole charge — which
 *    would make the platform's best outcome a session that never happens.
 *  - **`no_show_tutor`** — the tutor was not in the room. **Nothing is
 *    written.** Paying an absent tutor while the student cannot be refunded is a
 *    double loss with no recovery path, which is the same reasoning that keeps a
 *    never-started session out of `completed` (Part 3B, `started_at IS NOT
 *    NULL`).
 *
 * Note this is a statement about `tutor_earnings` only. No wallet is credited at
 * any of these — a `held` row is a promise, and the ledger entry that makes it
 * money is written at release (Phase 8).
 */
export const EARNING_STATUSES = ["completed", "no_show_student"] as const;

/** True when this classification writes a `tutor_earnings` row. */
export function statusEarnsPayout(status: string): boolean {
  return (EARNING_STATUSES as readonly string[]).includes(status);
}
