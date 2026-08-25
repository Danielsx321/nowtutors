import "server-only";

/**
 * The one place that talks to LessonSpace (SPEC §7.7). Everything that reaches
 * their API goes through here: host, auth header, and a thin typed fetch. Same
 * shape as `lib/paypal/client.ts` and `lib/agora/token-service.ts` — no SDK, the
 * REST launch endpoint is a single call and SPEC §2 pins the dependency list
 * (CLAUDE.md — no unlisted deps).
 *
 * **Server-only, and the reason this file exists.** SPEC §7.7's first line is
 * "server-side only; the API key never reaches the browser", and CLAUDE.md keeps
 * third-party secrets off the client. `LESSONSPACE_API_KEY` authenticates the
 * whole organisation; a leaked key would let anyone launch spaces as us. The
 * `server-only` import makes importing this into a Client Component a build
 * error, and the key is read lazily inside the request path (never at module
 * load) so a build or a test that never launches a space needs no credential.
 *
 * **One call does create-or-get *and* the per-user link.** LessonSpace's
 * `spaces/launch/` is idempotent on the `id` we send: the first launch for a
 * booking creates the space, every later launch returns that same space
 * (`room_id`), and each launch returns a fresh join `client_url` scoped to the
 * user and leader flag in *that* request. So §7.7's step 2 (create-or-get,
 * persist the room id) and step 3 (per-user link with the caller's role) are
 * one round trip, exactly as the live app makes it — see the payload note
 * below.
 *
 * **Wire format is verified**, not inferred: the host, the `Organisation`
 * auth scheme, the nested request body and the response field names below are
 * confirmed against both LessonSpace's own developer docs and the live
 * Bubble app's API Connector definition (SPEC §7.7, DECISIONS).
 */

/**
 * The production host and launch path. Hardcoded like `lib/paypal/client.ts`'s
 * hosts rather than read from env: LessonSpace has a single production API and
 * SPEC §2.1 lists no base-URL variable for it. The org is identified by the
 * `Authorization` header, not by the URL.
 */
const LAUNCH_URL = "https://api.thelessonspace.com/v2/spaces/launch/";

/** How long we wait on the launch call before giving up. LessonSpace is a normal
 *  hosted API (not a sleeping free-tier dyno like the Agora token service), so a
 *  modest ceiling is right — a hung launch should fail the join cleanly, not hang
 *  the request handler. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Raised when the server has no LessonSpace API key configured. Mirrors
 *  {@link import("@/lib/agora/token-service").AgoraConfigError}. */
export class LessonSpaceConfigError extends Error {
  readonly code = "lessonspace_not_configured" as const;
  constructor(missing: string) {
    super(`LessonSpace is not configured: ${missing} is unset.`);
    this.name = "LessonSpaceConfigError";
  }
}

/** Raised when the launch endpoint answers with a non-2xx, a body we can't read,
 *  or not at all. Carries a status the caller can map to a clean response. */
export class LessonSpaceApiError extends Error {
  readonly code = "lessonspace_api_error" as const;
  constructor(
    /** HTTP status, or 0 when the request never completed (timeout/DNS/TLS). */
    readonly status: number,
    readonly detail: string,
  ) {
    super(`LessonSpace launch failed (${status}): ${detail}`);
    this.name = "LessonSpaceApiError";
  }
}

/** `LESSONSPACE_API_KEY`. Read lazily, never at import. */
function apiKey(): string {
  const raw = process.env.LESSONSPACE_API_KEY?.trim();
  if (!raw) throw new LessonSpaceConfigError("LESSONSPACE_API_KEY");
  return raw;
}

// The role type (`teacher` / `student`) belongs to the access decision that
// derives it — `lib/lessonspace/session-access.ts` — and is deliberately not
// redeclared here. This file's payload carries the `leader` boolean the live app
// sends (Finding A), which is what LessonSpace is actually given.

export interface LaunchSpaceInput {
  /** The booking's id. Doubles as the space `id` so a launch is create-or-get:
   *  the same booking always resolves to the same space. */
  bookingId: string;
  /** Shown to the other participant inside the room. */
  displayName: string;
  /** Tutor = leader = teacher controls (whiteboard admin, recording,
   *  end-for-all). Derived server-side from the booking, never from the client
   *  (SPEC §7.7 step 3, Finding A). */
  leader: boolean;
}

export interface LaunchedSpace {
  /** LessonSpace's persistent id for the space. Persisted to
   *  `bookings.lessonspace_room_id` on the first join (§7.7 step 2). */
  roomId: string;
  /** The per-user join URL to hand back to the caller (§7.7 step 3, step 5).
   *  LessonSpace's field is `client_url`; the response also carries `api_base`,
   *  `secret` and `session_id`, none of which we keep — `secret` is a room
   *  credential and must never reach the browser. */
  clientUrl: string;
}

/**
 * Create-or-get the booking's space and return a join URL for this user.
 *
 * **The payload carries exactly three values — booking id, display name, and a
 * leader boolean — and nothing else.** Confirmed against the live app (Finding
 * A, DECISIONS): Bubble's own `POST /v2/spaces/launch/` sends no duration, no
 * expiry, and no time limit. Our join-window enforcement is a server-side gate
 * (`lib/lessonspace/session-access.ts`, §7.7 step 1), not something LessonSpace
 * is asked to police — so there is nothing to add here, and adding a time box
 * would be inventing a field the live app never sends. Do not extend this body
 * without a spec change.
 *
 * Every failure — a non-2xx, an unreadable body, a timeout, a dead host — leaves
 * as a {@link LessonSpaceApiError} carrying a status; nothing here throws a raw
 * fetch rejection.
 */
export async function launchSpace(input: LaunchSpaceInput): Promise<LaunchedSpace> {
  const key = apiKey();

  let res: Response;
  try {
    res = await fetch(LAUNCH_URL, {
      method: "POST",
      headers: {
        // LessonSpace authenticates the organisation with the secret key on the
        // `Organisation` scheme. This is the whole reason the file is server-only.
        Authorization: `Organisation ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        id: input.bookingId,
        user: {
          name: input.displayName,
          leader: input.leader,
        },
      }),
    });
  } catch (err) {
    // Timeout, DNS, TLS, connection reset — the request never produced a status.
    throw new LessonSpaceApiError(
      0,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LessonSpaceApiError(res.status, body.slice(0, 200));
  }

  const parsed: unknown = await res.json().catch(() => null);
  const launched = parseLaunchResponse(parsed);
  if (!launched) {
    throw new LessonSpaceApiError(
      res.status,
      "response carried no room_id/client_url",
    );
  }
  return launched;
}

/**
 * Pull `{ roomId, clientUrl }` out of a launch response, or null if either is
 * missing. `api_base`, `secret` and `session_id` also come back on the
 * response but are deliberately not extracted here — `secret` is a room
 * credential and must never reach the browser.
 *
 * Kept `server-only`-free of anything but pure parsing so it stays trivial to
 * reason about; the launch body is untyped third-party JSON, so both fields are
 * checked for being non-empty strings before we trust them — a null `room_id`
 * would otherwise be persisted as the booking's permanent (dead) room id.
 */
function parseLaunchResponse(value: unknown): LaunchedSpace | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const roomId = obj.room_id;
  const clientUrl = obj.client_url;
  if (typeof roomId !== "string" || roomId.length === 0) return null;
  if (typeof clientUrl !== "string" || clientUrl.length === 0) return null;
  return { roomId, clientUrl };
}
