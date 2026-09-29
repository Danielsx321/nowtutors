import { z } from "zod";
import { LANGUAGES } from "@/lib/geo/languages";
import { isValidTimeZone } from "@/lib/geo/timezones";

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

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    email,
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type SignupValues = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({ email });
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
      .optional()
      .or(z.literal("").transform(() => undefined)),
  });
export type TutorProfileEditValues = z.infer<typeof tutorProfileEditSchema>;

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

