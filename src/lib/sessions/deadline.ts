/**
 * When an instant session is over (SPEC §7.4, §4.3).
 *
 * Pure and `server-only`-free, for the same reason `lib/agora/session-access.ts`
 * is: the route files that consume it pull in `server-only` transitively and so
 * cannot be imported by a unit test, while this rule is one of the ones that
 * must never regress unnoticed.
 *
 * **This module is one half of a deliberate pair.** The other half is the SQL
 * fragment in `db/queries/sessions.ts` (`sessionDeadlineSql` /
 * `sessionElapsedSql`), and the two cannot be collapsed into one artefact:
 *
 *  - the **authoritative** comparison has to happen inside the `UPDATE`
 *    statement, because "exactly one transition" is a property of how Postgres
 *    re-evaluates a blocked write, not of anything TypeScript can arrange;
 *  - the **displayed** deadline has to exist in TypeScript, because a countdown
 *    renders in a browser.
 *
 * What stops them drifting is `tests/integration/session-end-concurrency.test.ts`,
 * which seeds a row at exactly `started_at + duration` and asserts that
 * {@link hasElapsed} and the SQL predicate give the same answer at `t - 1s`,
 * `t`, and `t + 1s`. That test is the contract between the two halves, and it is
 * the reason {@link hasElapsed} below is `>=` rather than `>`: SQL's
 * `started_at + interval <= now()` is inclusive at the boundary, so this is too.
 *
 * **Nothing here decides anything on a client's behalf.** A browser uses these
 * to draw a number. The server uses them to decide whether to *attempt* a
 * transition, and the statement itself re-checks. A fast client clock cannot end
 * a session early because `now()` in the predicate is Postgres's clock, not the
 * caller's.
 */

/** The `bookings` columns the deadline is computed from. */
export interface SessionTiming {
  /** "First moment both were present" (§4.3). Null until the pair completes. */
  startedAt: Date | null;
  /** Booked duration, pinned from the request at accept (§7.4). */
  durationMinutes: number | null;
}

const MS_PER_MINUTE = 60_000;

/**
 * The moment this session hard-stops, or null if it has not started.
 *
 * Null is the honest answer in three cases and they are deliberately not
 * distinguished, because every caller does the same thing with all three:
 *
 *  - `started_at` is null — one party is still not in the room, so no clock is
 *    running. §4.3 defines the column as "first moment both were present" and
 *    §7.4 makes it the clock the hard stop measures against; a session that
 *    hasn't started cannot have elapsed.
 *  - `duration_minutes` is null — structurally impossible for an instant booking
 *    (the accept transaction pins it from the request row), but the column is
 *    nullable for scheduled bookings and a null here must not become `NaN`
 *    arithmetic on a billing clock.
 *  - either value is nonsense (invalid `Date`, non-finite or non-positive
 *    duration) — a deadline computed from it would be worse than no deadline.
 *
 * The SQL half returns null for exactly the same inputs, because `NULL +
 * interval` is `NULL` and a `NULL <= now()` predicate is not true.
 */
export function sessionDeadline(timing: SessionTiming): Date | null {
  const { startedAt, durationMinutes } = timing;
  if (startedAt === null || durationMinutes === null) return null;

  const start = startedAt.getTime();
  if (Number.isNaN(start)) return null;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  return new Date(start + durationMinutes * MS_PER_MINUTE);
}

/**
 * Has the booked duration run out?
 *
 * Inclusive at the boundary (`now >= deadline`), matching the SQL predicate's
 * `<=`. A session that has not started has not elapsed — which is what keeps the
 * room openable for whoever arrives first.
 */
export function hasElapsed(timing: SessionTiming, now: Date): boolean {
  const deadline = sessionDeadline(timing);
  if (deadline === null) return false;
  return now.getTime() >= deadline.getTime();
}

/**
 * Milliseconds left on the clock, floored at 0; null when nothing is running.
 *
 * For the cosmetic countdown only. Clock skew in the browser moves this by a
 * second or two and changes nothing about what is charged or when the session
 * actually stops — the same property §7.4 already accepts for the 60-second
 * request ring.
 */
export function msRemaining(timing: SessionTiming, now: Date): number | null {
  const deadline = sessionDeadline(timing);
  if (deadline === null) return null;
  return Math.max(0, deadline.getTime() - now.getTime());
}
