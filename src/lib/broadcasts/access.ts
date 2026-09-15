/**
 * Who may hold a token for a broadcast channel, and as what (SPEC §9 step 3;
 * Phase 9 Part 3).
 *
 * Pure and `server-only`-free, like `lib/agora/session-access.ts`, so the matrix
 * is unit-tested without a database or the route. The guarantees:
 *
 *  1. **Only the host publishes.** The host of a `live` broadcast gets
 *     `publisher`; everyone else gets `subscriber` at most. The role is never a
 *     request field.
 *  2. **A viewer needs a live broadcast AND a fresh host.** Liveness is derived
 *     like a tutor's (§3.1): the host must be in `live_tutors` with
 *     `live_mode = 'broadcast'`. A host who closed the tab drops out of the view
 *     within two minutes, and viewers stop getting tokens then, without waiting
 *     for the sweep to mark the row `ended`.
 *  3. **A missing broadcast, an ended one and a stale host are the same 404**,
 *     so the endpoint can't be used to probe ids or a tutor's whereabouts.
 *  4. **The channel must be `broadcast_{id}`.** No client can write the table
 *     (`drizzle/0018`) and the start transaction writes the channel in SQL, so
 *     this never fires. It is here so that if a row ever carried someone's
 *     `session_{booking}` channel, the route would refuse rather than hand out a
 *     token into a private session (the Gap 3 attack).
 */

import type { AgoraRole } from "@/lib/agora/session-access";

export interface BroadcastAccessRow {
  id: string;
  tutorId: string;
  /** `broadcast_status`: `live` or `ended`. */
  status: string;
  agoraChannel: string;
  /** The host is in `live_tutors` with `live_mode = 'broadcast'` right now. */
  hostFresh: boolean;
}

export type BroadcastAccess =
  | { ok: true; broadcastId: string; channel: string; isHost: boolean; role: AgoraRole }
  | { ok: false; status: number; message: string };

export const BROADCAST_NOT_LIVE = "This broadcast isn't live.";

/** The channel a broadcast must use. Mirrors the SQL in `db/queries/broadcasts.ts`. */
export function broadcastChannel(broadcastId: string): string {
  return `broadcast_${broadcastId}`;
}

export function checkBroadcastAccess(
  row: BroadcastAccessRow | null | undefined,
  userId: string,
): BroadcastAccess {
  if (!row || row.status !== "live") {
    return { ok: false, status: 404, message: BROADCAST_NOT_LIVE };
  }
  if (row.agoraChannel !== broadcastChannel(row.id)) {
    return { ok: false, status: 500, message: "This broadcast couldn't be opened." };
  }
  if (row.tutorId === userId) {
    return { ok: true, broadcastId: row.id, channel: row.agoraChannel, isHost: true, role: "publisher" };
  }
  if (!row.hostFresh) {
    return { ok: false, status: 404, message: BROADCAST_NOT_LIVE };
  }
  return { ok: true, broadcastId: row.id, channel: row.agoraChannel, isHost: false, role: "subscriber" };
}
