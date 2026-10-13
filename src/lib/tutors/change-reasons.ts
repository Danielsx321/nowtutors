/**
 * What an admin can ask a tutor to change (tutor-request-changes, 2026-10-13).
 *
 * Tick boxes for the admin, a list with guidance for the tutor, and the same
 * list in the email. The reasons and the free-text note are stored together
 * in `tutor_profiles.approval_note` (one text column, shared with the
 * rejection note) in a shape `parseApprovalNote` can read back:
 *
 *   reasons: photo,rate
 *
 *   <the admin's note>
 *
 * A plain note with no `reasons:` line (every rejection) parses as
 * `{ reasons: [], note }`, so nothing that already reads approval_note changes.
 */
export const CHANGE_REASONS = [
  {
    key: "photo",
    label: "Profile photo",
    guidance:
      "A clear photo of just you, facing the camera, head and shoulders, with good light and a plain background.",
  },
  {
    key: "headline_about",
    label: "Headline or about",
    guidance: "Say what you teach, who you teach it to, and what a student gets from a session with you.",
  },
  {
    key: "subjects",
    label: "Subjects",
    guidance: "List only the subjects you can teach today, at the level you teach them.",
  },
  {
    key: "rate",
    label: "Hourly rate",
    guidance: "Set a rate in line with your experience and the subjects you teach.",
  },
  {
    key: "intro_video",
    label: "Intro video",
    guidance: "A short video that plays with sound, where students can see and hear you.",
  },
  {
    key: "other",
    label: "Something else",
    guidance: "See the note below.",
  },
] as const;

export type ChangeReason = (typeof CHANGE_REASONS)[number]["key"];

export const CHANGE_REASON_KEYS = CHANGE_REASONS.map((r) => r.key) as [ChangeReason, ...ChangeReason[]];

const byKey = new Map(CHANGE_REASONS.map((r) => [r.key, r] as const));

export function isChangeReason(value: unknown): value is ChangeReason {
  return typeof value === "string" && byKey.has(value as ChangeReason);
}

export function changeReason(key: ChangeReason) {
  return byKey.get(key)!;
}

const REASONS_LINE = /^reasons:\s*(.*)$/m;

/** The text that goes into `approval_note`. */
export function formatApprovalNote(reasons: readonly ChangeReason[], note: string): string {
  const keys = Array.from(new Set(reasons.filter(isChangeReason)));
  const trimmed = note.trim();
  if (keys.length === 0) return trimmed;
  return trimmed ? `reasons: ${keys.join(",")}\n\n${trimmed}` : `reasons: ${keys.join(",")}`;
}

/** `approval_note` back to the structure the pages and emails render. */
export function parseApprovalNote(text: string | null | undefined): {
  reasons: ChangeReason[];
  note: string | null;
} {
  if (!text) return { reasons: [], note: null };
  const match = text.match(REASONS_LINE);
  if (!match) return { reasons: [], note: text.trim() || null };
  const reasons = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(isChangeReason);
  const note = text.replace(REASONS_LINE, "").trim();
  return { reasons: Array.from(new Set(reasons)), note: note || null };
}
