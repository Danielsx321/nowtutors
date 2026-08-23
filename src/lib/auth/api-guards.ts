import "server-only";
import { NextResponse } from "next/server";
import {
  getSessionProfile,
  getUser,
  isEmailVerified,
  type Role,
  type SessionProfile,
} from "./guards";

/**
 * Route-handler authorization (SPEC §5 Layer 2). The page/action guards in
 * `guards.ts` `redirect()` on failure, which is right for a navigation but wrong
 * for an API route the client calls with `fetch` — a 307 to /login is not
 * something the caller can act on. These raise a typed error the route maps to a
 * JSON status instead. Every route in `app/api/**` starts with one of these; the
 * caller's id always comes from the session, never from the request body.
 */

export class ApiAuthError extends Error {
  constructor(
    readonly status: number,
    /** Safe to show a user — no internal detail. */
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "ApiAuthError";
  }
}

/** Signed-in caller, or 401. */
export async function requireApiUser(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) throw new ApiAuthError(401, "You need to be signed in.");
  if (profile.isSuspended) {
    throw new ApiAuthError(403, "This account is suspended.");
  }
  return profile;
}

/** Signed-in caller holding `role`, or 401/403. */
export async function requireApiRole(role: Role): Promise<SessionProfile> {
  const profile = await requireApiUser();
  if (profile.role == null) {
    throw new ApiAuthError(403, "Finish setting up your account first.");
  }
  if (profile.role !== role) {
    throw new ApiAuthError(403, "You don't have access to this.");
  }
  return profile;
}

/**
 * Email-verification gate for a route (SPEC §7.1). Credits are only spendable on
 * bookings, which require a verified email — so verify *before* taking money
 * rather than leaving a paid-up student unable to book (docs/DECISIONS.md).
 */
export async function requireApiVerifiedEmail(): Promise<void> {
  const user = await getUser();
  if (!isEmailVerified(user)) {
    throw new ApiAuthError(403, "Please verify your email address to continue.");
  }
}

/** `{ error }` with the right status for an {@link ApiAuthError}; else null. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof ApiAuthError) {
    return NextResponse.json({ error: err.publicMessage }, { status: err.status });
  }
  return null;
}

/**
 * The cron-route bearer guard (SPEC §12), shared by every `app/api/cron/*`
 * handler. Returns a response to send when the caller is not the scheduler, or
 * `null` when the job may run.
 *
 * **Fails closed on a missing secret.** An unset `CRON_SECRET` returns 503, not
 * "no auth required" — otherwise an environment that simply forgot the variable
 * would expose a public write endpoint, which is the failure mode most likely to
 * go unnoticed because nothing errors.
 *
 * It lives here rather than being copy-pasted per handler because it is a
 * security check with a fail-closed branch: two copies are two things to keep in
 * step, and the one that drifts is the one nobody reads again.
 */
export function cronAuthFailure(request: Request, job: string): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(`[cron/${job}] CRON_SECRET is not set`);
    return NextResponse.json({ error: "Cron is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
