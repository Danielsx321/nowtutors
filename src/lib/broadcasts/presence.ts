/**
 * The broadcast viewer count (SPEC §7.8, §8; Phase 9 Part 3).
 *
 * **Supabase Realtime Presence, not Agora.** In Agora `live` mode an audience
 * member produces no `user-joined` event for anyone, so neither the host nor the
 * SDK can count viewers. Presence is a push channel, so this needs no polling.
 *
 * The count is display-only. The channel is public, so anyone holding the anon
 * key could join it and inflate the number; nothing is decided or paid on it.
 * `peak_viewers` only ever rises, and is capped.
 *
 * Pure so the counting rules are unit-tested without a socket.
 */

export const MAX_REPORTED_VIEWERS = 10_000;

export function broadcastPresenceTopic(broadcastId: string): string {
  return `broadcast-viewers:${broadcastId}`;
}

/** One entry of a Presence state: the metas one key has tracked. */
export type PresenceState = Record<string, ReadonlyArray<{ role?: unknown }>>;

/**
 * Distinct viewers in a Presence state. One key per signed-in person (their
 * Agora uid), so two tabs count once. The host never tracks a `viewer` meta, so
 * they are not counted.
 */
export function countViewers(state: PresenceState): number {
  let n = 0;
  for (const metas of Object.values(state)) {
    if (metas.some((m) => m.role === "viewer")) n += 1;
  }
  return n;
}

/**
 * The number the host should report, or null when nothing new should be sent:
 * only a count above the last reported peak goes to the server, capped.
 */
export function nextPeakToReport(count: number, lastReported: number): number | null {
  const capped = Math.min(Math.max(0, Math.floor(count)), MAX_REPORTED_VIEWERS);
  return capped > lastReported ? capped : null;
}
