import { z } from "zod";
import { LANGUAGES } from "@/lib/geo/languages";
import { isValidTimeZone } from "@/lib/geo/timezones";
import { CAPTCHA_MESSAGE, CAPTCHA_REQUIRED } from "@/lib/auth/captcha";

/**
 * ONE zod schema per form, defined once and reused on BOTH sides (SPEC §5,
 * §7.1): react-hook-form validates for UX, and the Server Action re-parses the
 * SAME schema before trusting anything — the server never trusts the client's
 * parse. Keep these free of server-only imports so they can run in the browser.
 */

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

// Signup/reset enforce a real password; login only checks non-empty (the server
// is the auth authority — over-validating login just leaks policy + annoys users
// whose account predates a rule).
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.") // bcrypt's 72-byte limit
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

/**
 * The Turnstile token (Security D). Required, non-empty, when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; optional when it is not, so local
 * dev and CI work without keys. Supabase verifies it; the app only carries it.
 */
export const captchaToken = (
  CAPTCHA_REQUIRED
    ? z.string({ message: CAPTCHA_MESSAGE }).trim().min(1, CAPTCHA_MESSAGE)
    : z.string().trim().optional()
) as z.ZodOptional<z.ZodString>; // typed optional: the forms start without one
// (Not `.optional().refine(...)`: zod 4 skips the refine when the key is absent.)

/** True when a failed parse failed (also) on the captcha token. */
export function failedOnCaptcha(error: z.ZodError): boolean {
  return error.issues.some((i) => i.path[0] === "captchaToken");
}

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
  captchaToken,
});
export type LoginValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    email,
    password: strongPassword,
    confirmPassword: z.string(),
    captchaToken,
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type SignupValues = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({ email, captchaToken });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

// ── Onboarding ───────────────────────────────────────────────────────────────

// Role choice — student/tutor only. Admin is never self-assignable (SPEC §5).
export const roleChoiceSchema = z.object({
  role: z.enum(["student", "tutor"]),
});
export type RoleChoiceValues = z.infer<typeof roleChoiceSchema>;

const fullName = z.string().trim().min(2, "Enter your name.").max(80);
const timezone = z.string().trim().min(1, "Select your timezone.");
const subjectSlugs = z.array(z.string().trim().min(1)).max(30);
const avatarUrl = z
  .string()
  .trim()
  .url("Invalid avatar URL.")
  .optional()
  .or(z.literal("").transform(() => undefined));

// ── Link rules (Security C, 2026-10-22; SPEC §5) ─────────────────────────────

/**
 * Hosts an intro video may come from. `https:` only, exact host match (no
 * subdomain wildcard, so `youtube.com.evil.net` and `evil-youtube.com` fail).
 * Add a host here and nowhere else.
 */
export const INTRO_VIDEO_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  "loom.com",
  "www.loom.com",
] as const;

export const INTRO_VIDEO_HOST_MESSAGE = "Use a YouTube, Vimeo or Loom link.";

/** True for an `https:` URL on one of {@link INTRO_VIDEO_HOSTS}. */
export function isAllowedIntroVideoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return (INTRO_VIDEO_HOSTS as readonly string[]).includes(u.hostname.toLowerCase());
}

/**
 * The public URL prefix of a user's own avatar folder, exactly what
 * `getPublicUrl` returns for `avatars/{uid}/...` (components/features/
 * onboarding/avatar-upload.tsx). The base defaults to
 * `NEXT_PUBLIC_SUPABASE_URL`, inlined at build time on both sides.
 */
export function ownAvatarPrefix(
  userId: string,
  supabaseUrl: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/avatars/${userId}/`;
}

/**
 * True when `raw` is a file inside `userId`'s own folder of the public
 * `avatars` bucket. The raw string must start with the prefix, and the parsed
 * URL must too, so `../other-user/x.jpg` (which the URL parser resolves out of
 * the folder) and a backslash are refused.
 */
export function isOwnAvatarUrl(raw: string, userId: string, supabaseUrl?: string): boolean {
  if (!userId || (!supabaseUrl && !process.env.NEXT_PUBLIC_SUPABASE_URL)) return false;
  const prefix = ownAvatarPrefix(userId, supabaseUrl);
  if (!raw.startsWith(prefix) || raw.length === prefix.length || raw.includes("\\")) return false;
  try {
    const u = new URL(raw);
    const p = new URL(prefix);
    return u.origin === p.origin && u.pathname.startsWith(p.pathname) && u.pathname.length > p.pathname.length;
  } catch {
    return false;
  }
}

const OWN_AVATAR_MESSAGE = "Upload your photo again.";

export const studentOnboardingSchema = z.object({
  fullName,
  timezone,
  avatarUrl,
  subjects: subjectSlugs, // subjects of interest (may be empty)
});
export type StudentOnboardingValues = z.infer<typeof studentOnboardingSchema>;

const subjectLevel = z.enum(["beginner", "intermediate", "advanced", "all"]);

/**
 * Tutors must have a photo (Part G; Noora, decision 4): students choose a
 * person, and approval refuses without one. Students keep the optional one.
 */
const tutorAvatarUrl = z
  .string({ message: "Add a profile photo." })
  .trim()
  .min(1, "Add a profile photo.")
  .url("Add a profile photo.");

export const tutorOnboardingSchema = z.object({
  fullName,
  // Added Phase 10 Part 4: tutors never set one before, so their availability
  // and emails read UTC. Optional so an old form still submits; validated when sent.
  timezone: z
    .string()
    .trim()
    .refine((tz) => tz === "" || isValidTimeZone(tz), "Pick a valid timezone.")
    .optional(),
  avatarUrl: tutorAvatarUrl,
  headline: z.string().trim().min(10, "Write a short headline.").max(120),
  about: z.string().trim().min(30, "Tell students about yourself.").max(2000),
  // At least one subject, each with a level.
  subjects: z
    .array(z.object({ slug: z.string().trim().min(1), level: subjectLevel }))
    .min(1, "Add at least one subject you teach."),
  hourlyRateCredits: z
    .number({ message: "Enter your hourly rate in credits." })
    .int("Whole credits only.")
    .min(1, "Rate must be at least 1 credit.")
    .max(100000),
  languages: z.array(z.enum(LANGUAGES)).min(1, "Select at least one language."),
  education: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  yearsExperience: z
    .number()
    .int()
    .min(0)
    .max(80)
    .optional(),
  paypalEmail: email, // payout destination (tutor_payout_details)
});
export type TutorOnboardingValues = z.infer<typeof tutorOnboardingSchema>;

/**
 * Tutor profile editor (/tutor/profile) — DERIVED from the onboarding schema so
 * the two can never drift: same field rules, one definition. Payout email is not
 * edited here (it lives in /tutor/settings), and the intro video is added
 * because it is offered after onboarding. Deliberately absent, and rejected
 * server-side if sent: approval_status, approval_note, slug, role.
 */
export const tutorProfileEditSchema = tutorOnboardingSchema
  .omit({ paypalEmail: true })
  .extend({
    introVideoUrl: z
      .string()
      .trim()
      .url("Enter a valid video URL.")
      .refine(isAllowedIntroVideoUrl, INTRO_VIDEO_HOST_MESSAGE)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  });
export type TutorProfileEditValues = z.infer<typeof tutorProfileEditSchema>;

/*
 * Server-side variants that also pin `avatarUrl` to the caller's own avatar
 * folder (Security C). The forms keep the plain schemas above, which run in
 * the browser before the user id matters; the actions parse with these, the
 * user id taken from the guard. Same optional / empty-string handling as the
 * field each one tightens.
 */
export function studentOnboardingSchemaFor(userId: string) {
  return studentOnboardingSchema.refine(
    (v) => v.avatarUrl === undefined || isOwnAvatarUrl(v.avatarUrl, userId),
    { message: OWN_AVATAR_MESSAGE, path: ["avatarUrl"] },
  );
}

export function tutorOnboardingSchemaFor(userId: string) {
  return tutorOnboardingSchema.refine((v) => isOwnAvatarUrl(v.avatarUrl, userId), {
    message: OWN_AVATAR_MESSAGE,
    path: ["avatarUrl"],
  });
}

export function tutorProfileEditSchemaFor(userId: string) {
  return tutorProfileEditSchema.refine((v) => isOwnAvatarUrl(v.avatarUrl, userId), {
    message: OWN_AVATAR_MESSAGE,
    path: ["avatarUrl"],
  });
}

// ── Settings (Phase 10 Part 4) ───────────────────────────────────────────────

/** An IANA zone the runtime can format with. Aliases accepted (see lib/geo/timezones). */
export const timeZoneField = z
  .string()
  .trim()
  .min(1, "Select your timezone.")
  .refine(isValidTimeZone, "Pick a timezone from the list.");

/** Students set a display name and a timezone. Tutors edit their name on their profile. */
export const accountSettingsSchema = z.object({
  displayName: z.string().trim().min(2, "Enter at least 2 characters.").max(60).optional(),
  timezone: timeZoneField,
});
export type AccountSettingsValues = z.infer<typeof accountSettingsSchema>;

/**
 * The three switches a person can turn off. `marketing` exists in the column
 * but no marketing email does, so it is not offered (DECISIONS, Part 4).
 */
export const notificationSettingsSchema = z.object({
  booking_confirmations: z.boolean(),
  reminders: z.boolean(),
  messages: z.boolean(),
});
export type NotificationSettingsValues = z.infer<typeof notificationSettingsSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    password: strongPassword,
    confirmPassword: z.string(),
    // The current password is re-checked with signInWithPassword, which
    // Supabase captcha-gates like any sign-in.
    captchaToken,
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((v) => v.password !== v.currentPassword, {
    message: "Choose a password you haven't used here.",
    path: ["password"],
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

