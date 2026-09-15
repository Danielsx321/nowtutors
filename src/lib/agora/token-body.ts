import { z } from "zod";

/**
 * The body of `POST /api/agora/token` (SPEC §9; Phase 9 Part 3).
 *
 * Exactly one id: `{ bookingId }` for an instant session, `{ broadcastId }` for
 * a broadcast. Both shapes are `.strict()`, so a body carrying both ids, or any
 * other field (a channel, a role, a uid), is refused rather than quietly picking
 * one. The route derives everything else from the row.
 *
 * Pure so the schema is unit-tested without the route (which imports
 * `server-only`).
 */

const uuid = z.string().uuid();

export const tokenBodySchema = z.union([
  z.object({ bookingId: uuid }).strict(),
  z.object({ broadcastId: uuid }).strict(),
]);

/** What a client may send. */
export type TokenRequestBody = { bookingId: string } | { broadcastId: string };

export type ParsedTokenBody =
  | { kind: "booking"; bookingId: string }
  | { kind: "broadcast"; broadcastId: string };

export function parseTokenBody(json: unknown): ParsedTokenBody | null {
  const parsed = tokenBodySchema.safeParse(json);
  if (!parsed.success) return null;
  return "bookingId" in parsed.data
    ? { kind: "booking", bookingId: parsed.data.bookingId }
    : { kind: "broadcast", broadcastId: parsed.data.broadcastId };
}
