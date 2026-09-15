/**
 * Who may message whom, and what a message may be (SPEC §7.9; Phase 9 Part 1).
 *
 * Pure and `server-only`-free so the unit lane can import it, for the same
 * reason `lib/agora/session-access.ts` is.
 *
 * **Starting a conversation (settled 2026-09-15, DECISIONS "Phase 9 Part 1"):**
 * only a student, only with an approved tutor who is not suspended. A tutor
 * replies inside a thread a student opened but never opens one. There are no
 * student-to-student, tutor-to-tutor or admin threads.
 *
 * **Replying is not re-gated by the target's approval.** Once a thread exists,
 * either participant may keep writing in it while they themselves are not
 * suspended. A tutor whose approval is later revoked can still answer a student
 * who already wrote to them; nobody new can start a thread with them.
 *
 * Refusals are tags, never throws, so a refusal writes nothing. Every tag that
 * would reveal whether an account exists or what role it has maps to the SAME
 * message, so the start action cannot be used to probe profile ids.
 */

export type Role = "student" | "tutor" | "admin";

export interface StarterProfile {
  id: string;
  role: Role | null;
  isSuspended: boolean;
}

export interface TargetProfile {
  id: string;
  role: Role | null;
  isSuspended: boolean;
  /** `tutor_profiles.approval_status`, or null when there is no tutor profile. */
  approvalStatus: string | null;
}

export type StartRefusal =
  | "self"
  | "not_student"
  | "starter_suspended"
  | "target_unavailable";

/**
 * May `starter` open a thread with `target`? `target` is null when no profile
 * exists for the id; that and every other reason the target can't be messaged
 * collapse into `target_unavailable`.
 */
export function canStartConversation(
  starter: StarterProfile,
  target: TargetProfile | null,
): { ok: true } | { ok: false; reason: StartRefusal } {
  if (starter.isSuspended) return { ok: false, reason: "starter_suspended" };
  if (starter.role !== "student") return { ok: false, reason: "not_student" };
  if (target && target.id === starter.id) return { ok: false, reason: "self" };
  if (
    !target ||
    target.role !== "tutor" ||
    target.isSuspended ||
    target.approvalStatus !== "approved"
  ) {
    return { ok: false, reason: "target_unavailable" };
  }
  return { ok: true };
}

export const MAX_BODY_CHARS = 4_000;

/** At most this many messages from one sender in any rolling window. */
export const RATE_LIMIT = { count: 20, windowSeconds: 60 } as const;

export type BodyRefusal = "empty" | "too_long";

/**
 * Trim the ends and check the length. Inner whitespace and newlines are kept
 * exactly as typed; the thread renders with `whitespace-pre-wrap`. Length is
 * counted in UTF-16 code units, the same unit the composer's counter shows.
 */
export function validateBody(
  raw: string,
): { ok: true; body: string } | { ok: false; reason: BodyRefusal } {
  const body = raw.trim();
  if (body.length === 0) return { ok: false, reason: "empty" };
  if (body.length > MAX_BODY_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, body };
}

export type SendRefusal =
  | BodyRefusal
  | "not_found"
  | "sender_suspended"
  | "rate_limited"
  /** The attachment path isn't a valid attachment under this conversation. */
  | "attachment_invalid";

export type MarkReadRefusal = "not_found";

/** User-facing wording for every refusal tag. */
export function messagingRefusalMessage(
  reason: StartRefusal | SendRefusal | MarkReadRefusal,
): string {
  switch (reason) {
    case "self":
      return "You can't message yourself.";
    case "not_student":
      return "Only students can start a conversation. You can reply to students who message you.";
    case "starter_suspended":
    case "sender_suspended":
      return "Your account is suspended, so you can't send messages.";
    case "target_unavailable":
      return "This tutor isn't available to message.";
    case "empty":
      return "Write a message before sending.";
    case "too_long":
      return `Messages can be up to ${MAX_BODY_CHARS.toLocaleString("en-US")} characters.`;
    case "not_found":
      return "Conversation not found.";
    case "rate_limited":
      return "You're sending messages too quickly. Wait a moment and try again.";
    case "attachment_invalid":
      return "The attachment didn't upload. Try attaching it again.";
  }
}
