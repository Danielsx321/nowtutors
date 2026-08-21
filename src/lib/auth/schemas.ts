import { z } from "zod";
import { LANGUAGES } from "@/lib/geo/languages";

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

export const tutorOnboardingSchema = z.object({
  fullName,
  avatarUrl,
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
