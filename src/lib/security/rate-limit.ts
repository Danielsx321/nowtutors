import "server-only";
import { sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";

/**
 * App-level rate limits (SPEC §5; Security C, 2026-10-22; DECISIONS).
 *
 * Supabase Auth sees every call from Vercel's IP, so its own limits are one
 * bucket for the whole site. These count per visitor IP, per email and per
 * signed-in user, in Postgres (`rate_limits` + `public.hit_rate_limit()`,
 * drizzle/0028), on the trusted Drizzle connection. Fixed windows: simple,
 * atomic in one statement, and good enough for "stop a bot hammering this".
 *
 * **Fails open.** If the counter cannot be reached (the migration not yet
 * applied right after a deploy, a database blip), the attempt is allowed and
 * the failure goes to the log and Sentry. Refusing every sign-in because a
 * counter table is missing would be a worse outage than the one it prevents.
 */

export type RateLimitAction =
  | "signIn"
  | "signUp"
  | "passwordReset"
  | "changePassword"
  | "createAttachmentUpload"
  | "startConversation";

type Subject = "ip" | "email" | "user";

interface Rule {
  by: Subject;
  limit: number;
  windowSeconds: number;
}

const MIN = 60;
const HOUR = 60 * MIN;

/** Every limit in one place. Order matters: the first key over its limit answers. */
export const RATE_LIMITS: Record<RateLimitAction, readonly Rule[]> = {
  signIn: [
    { by: "ip", limit: 10, windowSeconds: 15 * MIN },
    { by: "email", limit: 5, windowSeconds: 15 * MIN },
  ],
  signUp: [{ by: "ip", limit: 5, windowSeconds: HOUR }],
  passwordReset: [{ by: "email", limit: 3, windowSeconds: HOUR }],
  changePassword: [{ by: "user", limit: 5, windowSeconds: 15 * MIN }],
  createAttachmentUpload: [{ by: "user", limit: 30, windowSeconds: HOUR }],
  startConversation: [{ by: "user", limit: 20, windowSeconds: HOUR }],
};

/** The message every limited action returns, in its usual `{ error }` shape. */
export const RATE_LIMIT_MESSAGE = "Too many attempts. Try again in a few minutes.";

export interface RateLimitInput {
  action: RateLimitAction;
  ip?: string | null;
  userId?: string | null;
  email?: string | null;
}

export interface RateLimitKey {
  key: string;
  limit: number;
  windowSeconds: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Longest subject value kept in a key; an email is capped at 254 anyway. */
const MAX_SUBJECT_LENGTH = 320;

function subjectValue(input: RateLimitInput, by: Subject): string | null {
  const raw = by === "ip" ? input.ip : by === "user" ? input.userId : input.email;
  const v = raw?.trim().toLowerCase();
  return v ? v.slice(0, MAX_SUBJECT_LENGTH) : null;
}

/**
 * The keys this attempt counts against, `<action>:<subject>:<value>`. A rule
 * whose subject is missing (no IP header, no email typed) is skipped rather
 * than sharing one bucket among everyone without it. Emails are lowercased so
 * `Ada@x.com` and `ada@x.com` are one person.
 */
export function rateLimitKeys(input: RateLimitInput): RateLimitKey[] {
  const keys: RateLimitKey[] = [];
  for (const rule of RATE_LIMITS[input.action]) {
    const value = subjectValue(input, rule.by);
    if (!value) continue;
    keys.push({
      key: `${input.action}:${rule.by}:${value}`,
      limit: rule.limit,
      windowSeconds: rule.windowSeconds,
    });
  }
  return keys;
}

/** Seconds until the fixed window containing `nowMs` ends (at least 1). */
export function retryAfterSeconds(windowSeconds: number, nowMs: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  return Math.max(1, windowSeconds - (nowSec % windowSeconds));
}

/** Counts one hit on a key; true while the key is still within its limit. */
export type HitRateLimit = (k: RateLimitKey) => Promise<boolean>;

const hitInDatabase: HitRateLimit = async ({ key, limit, windowSeconds }) => {
  const [row] = Array.from(
    await db.execute<{ allowed: boolean }>(
      sql`select public.hit_rate_limit(${key}, ${limit}::int, ${windowSeconds}::int) as allowed`,
    ),
  );
  return row?.allowed === true;
};

/**
 * Count this attempt against each of its keys, in order, and answer
 * `{ ok: false, retryAfterSeconds }` on the first key over its limit. Keys
 * after a refused one are not counted.
 */
export async function checkRateLimit(
  input: RateLimitInput,
  deps: { hit?: HitRateLimit; now?: () => number } = {},
): Promise<RateLimitResult> {
  const hit = deps.hit ?? hitInDatabase;
  const now = deps.now ?? Date.now;
  for (const k of rateLimitKeys(input)) {
    let allowed: boolean;
    try {
      allowed = await hit(k);
    } catch (err) {
      console.error("[rate-limit] counter unavailable, allowing", {
        action: input.action,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, { tags: { rateLimitAction: input.action } });
      return { ok: true };
    }
    if (!allowed) {
      return { ok: false, retryAfterSeconds: retryAfterSeconds(k.windowSeconds, now()) };
    }
  }
  return { ok: true };
}
