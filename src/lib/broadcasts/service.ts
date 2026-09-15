/**
 * Starting and ending a live broadcast (SPEC §4.6, §7.8; Phase 9 Part 3).
 *
 * **Every write is a server action on the trusted connection.** `drizzle/0018`
 * removed every client write on `broadcasts`, so nothing here can be skipped by
 * talking to PostgREST.
 *
 * **Start is one transaction** that locks the tutor's `tutor_profiles` row
 * first. The accept transaction takes the same lock (`lib/session-requests/
 * accept.ts`), so a start and an instant accept serialize: whichever commits
 * second sees the other and is refused. Inside the lock: the host is a tutor,
 * approved and not suspended; the subject (if any) is active; they have no
 * `in_progress` booking; they aren't already live. Then the row is inserted with
 * its channel written in SQL, the tutor becomes `is_live, live_mode =
 * 'broadcast'`, and any instant requests still waiting on them expire (Q5: a
 * broadcasting tutor can't take one, so there is no point leaving a student
 * watching a countdown). The partial unique index `broadcasts_one_live_per_tutor`
 * (`drizzle/0020`) backs up "not already live".
 *
 * **End** is host-only, idempotent on an ended row, and clears `live_mode` only
 * if it is still `broadcast`.
 *
 * Behind {@link BroadcastStore} so the rules run in unit tests without Postgres;
 * the adapter is `db/queries/broadcasts.ts`, and the lock and index are asserted
 * in `tests/integration/broadcasts.test.ts`.
 */

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 1000;

export type StartRefusal =
  | "not_tutor"
  | "not_approved"
  | "suspended"
  | "subject_unavailable"
  | "in_session"
  | "already_live"
  | "title_length"
  | "description_length";

export type EndRefusal = "not_found";

export interface HostProfile {
  userId: string;
  role: "student" | "tutor" | "admin" | null;
  isSuspended: boolean;
  approvalStatus: string | null;
}

export interface NewBroadcast {
  tutorId: string;
  title: string;
  description: string | null;
  subjectId: string | null;
}

export interface BroadcastLockRow {
  id: string;
  tutorId: string;
  status: string;
}

/** Raised by the adapter when `broadcasts_one_live_per_tutor` refuses an insert. */
export class AlreadyLiveError extends Error {
  readonly code = "already_live" as const;
  constructor(readonly tutorId: string) {
    super("This tutor already has a live broadcast.");
    this.name = "AlreadyLiveError";
  }
}

/** Storage for ONE transaction. Every method runs inside it. */
export interface BroadcastStore {
  /** The tutor's profile under `SELECT ... FOR UPDATE` on `tutor_profiles`, or null. */
  lockHost(tutorId: string): Promise<HostProfile | null>;
  hasInProgressBooking(tutorId: string): Promise<boolean>;
  findLiveBroadcastId(tutorId: string): Promise<string | null>;
  isSubjectActive(subjectId: string): Promise<boolean>;
  /**
   * Insert a `live` broadcast, `started_at = now()`, channel `broadcast_{id}`
   * written in SQL. Throws {@link AlreadyLiveError} on the one-live index.
   */
  insertLiveBroadcast(row: NewBroadcast): Promise<{ id: string; agoraChannel: string }>;
  /** `is_live = true, live_mode = 'broadcast', last_seen_at = now()`. */
  markTutorBroadcasting(tutorId: string): Promise<void>;
  /** Every `pending` instant request to this tutor → `expired`. Returns the count. */
  expirePendingRequests(tutorId: string): Promise<number>;
  /** The broadcast under `SELECT ... FOR UPDATE`, or null. */
  lockBroadcast(broadcastId: string): Promise<BroadcastLockRow | null>;
  /** `status = 'ended', ended_at = now()`. */
  markEnded(broadcastId: string): Promise<void>;
  /** `is_live = false, live_mode = null`, only where `live_mode = 'broadcast'`. */
  clearTutorBroadcasting(tutorId: string): Promise<void>;
}

/** Runs `fn` in one transaction; a throw rolls everything back. */
export type BroadcastRunner = <T>(fn: (store: BroadcastStore) => Promise<T>) => Promise<T>;

export type BroadcastDetails =
  | { ok: true; title: string; description: string | null; subjectId: string | null }
  | { ok: false; reason: "title_length" | "description_length" };

/** Trim and bound what the form sends. Blank description and subject become null. */
export function validateBroadcastDetails(input: {
  title: string;
  description?: string | null;
  subjectId?: string | null;
}): BroadcastDetails {
  const title = input.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    return { ok: false, reason: "title_length" };
  }
  const description = input.description?.trim() || null;
  if (description && description.length > DESCRIPTION_MAX) {
    return { ok: false, reason: "description_length" };
  }
  return { ok: true, title, description, subjectId: input.subjectId || null };
}

export type StartResult =
  | { ok: true; broadcastId: string; agoraChannel: string; expiredRequests: number }
  | { ok: false; reason: StartRefusal; liveBroadcastId?: string };

export async function startBroadcast(
  run: BroadcastRunner,
  input: { tutorId: string; title: string; description?: string | null; subjectId?: string | null },
): Promise<StartResult> {
  const details = validateBroadcastDetails(input);
  if (!details.ok) return { ok: false, reason: details.reason };

  try {
    return await run(async (store): Promise<StartResult> => {
      const host = await store.lockHost(input.tutorId);
      if (!host || host.role !== "tutor") return { ok: false, reason: "not_tutor" };
      if (host.isSuspended) return { ok: false, reason: "suspended" };
      if (host.approvalStatus !== "approved") return { ok: false, reason: "not_approved" };

      if (details.subjectId && !(await store.isSubjectActive(details.subjectId))) {
        return { ok: false, reason: "subject_unavailable" };
      }

      const liveId = await store.findLiveBroadcastId(input.tutorId);
      if (liveId) return { ok: false, reason: "already_live", liveBroadcastId: liveId };

      if (await store.hasInProgressBooking(input.tutorId)) {
        return { ok: false, reason: "in_session" };
      }

      const row = await store.insertLiveBroadcast({
        tutorId: input.tutorId,
        title: details.title,
        description: details.description,
        subjectId: details.subjectId,
      });
      await store.markTutorBroadcasting(input.tutorId);
      const expiredRequests = await store.expirePendingRequests(input.tutorId);
      return { ok: true, broadcastId: row.id, agoraChannel: row.agoraChannel, expiredRequests };
    });
  } catch (err) {
    // Out here, not inside the transaction: a unique violation aborts it, and
    // nothing more can run on it. Unreachable while every start takes the host
    // lock; the index is the backstop for a writer that doesn't.
    if (err instanceof AlreadyLiveError) return { ok: false, reason: "already_live" };
    throw err;
  }
}

export type EndResult =
  | { ok: true; alreadyEnded: boolean }
  | { ok: false; reason: EndRefusal };

export async function endBroadcast(
  run: BroadcastRunner,
  input: { tutorId: string; broadcastId: string },
): Promise<EndResult> {
  return run(async (store): Promise<EndResult> => {
    const row = await store.lockBroadcast(input.broadcastId);
    // Someone else's broadcast is reported exactly as a missing one.
    if (!row || row.tutorId !== input.tutorId) return { ok: false, reason: "not_found" };
    if (row.status !== "live") return { ok: true, alreadyEnded: true };
    await store.markEnded(row.id);
    await store.clearTutorBroadcasting(input.tutorId);
    return { ok: true, alreadyEnded: false };
  });
}

const START_MESSAGES: Record<StartRefusal | EndRefusal, string> = {
  not_tutor: "Only tutors can broadcast.",
  not_approved: "Your tutor profile needs to be approved before you can broadcast.",
  suspended: "This account is suspended.",
  subject_unavailable: "That subject isn't available. Pick another one.",
  in_session: "You're in a session right now. Finish it before you go live.",
  already_live: "You're already live. Return to your broadcast or end it first.",
  title_length: `Give your broadcast a title between ${TITLE_MIN} and ${TITLE_MAX} characters.`,
  description_length: `Keep the description under ${DESCRIPTION_MAX} characters.`,
  not_found: "This broadcast doesn't exist.",
};

export function broadcastRefusalMessage(reason: StartRefusal | EndRefusal): string {
  return START_MESSAGES[reason];
}
