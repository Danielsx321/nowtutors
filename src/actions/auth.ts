"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { homeFor } from "@/lib/auth/guards";
import {
  loginSchema,
  signupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type LoginValues,
  type SignupValues,
  type ForgotPasswordValues,
  type ResetPasswordValues,
} from "@/lib/auth/schemas";

export type ActionResult = { error: string } | { ok: true; message?: string };

// Only ever redirect to an in-app path — never an attacker-supplied absolute URL.
function safeNext(next: string | undefined | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Where a just-authenticated user belongs. Reads the role by user id from the DB
 * rather than via getUser()/cookies — right after signInWithPassword the new
 * session cookie is not reliably readable back within the same request (Supabase
 * SSR), so we trust the id the auth call returned, not a cookie round-trip.
 */
async function destinationForUser(
  userId: string,
  next?: string | null,
): Promise<string> {
  const safe = safeNext(next);
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!p || p.role == null) return "/onboarding";
  return safe ?? homeFor[p.role];
}

export async function login(
  values: LoginValues,
  next?: string,
): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(values); // never trust the client's parse
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  // Do NOT reveal whether the email exists — same message for both cases.
  if (error || !data.user) return { error: "Invalid email or password." };

  redirect(await destinationForUser(data.user.id, next));
}

export async function signup(
  values: SignupValues,
  next?: string,
): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(values);
  if (!parsed.success) return { error: "Check the form and try again." };

  const supabase = await createClient();
  const origin = await originFromHeaders();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/onboarding` },
  });

  if (error) {
    // "User already registered" is safe to surface only as a generic hint that
    // routes the user to sign in — do not confirm the address exists.
    return { error: "Could not create your account. Try signing in instead." };
  }

  // A confirmed session means email confirmation is disabled (dev) → onboard now.
  // Otherwise the user must click the verification link first.
  if (data.session) redirect(safeNext(next) ?? "/onboarding");
  return {
    ok: true,
    message:
      "Check your email for a confirmation link to finish creating your account.",
  };
}

export async function requestPasswordReset(
  values: ForgotPasswordValues,
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(values);
  // Even on a bad email, return the same success message — never reveal whether
  // an address has an account (§7.1 safe errors).
  if (parsed.success) {
    const supabase = await createClient();
    const origin = await originFromHeaders();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
  }
  return {
    ok: true,
    message:
      "If an account exists for that email, we've sent a password reset link.",
  };
}

export async function updatePassword(
  values: ResetPasswordValues,
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(values);
  if (!parsed.success) return { error: "Check the form and try again." };

  const supabase = await createClient();
  // updateUser only works with the recovery session established by the reset
  // link's code exchange (/auth/callback). No session → not authorized.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { error: "Your reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { error: "Could not update your password. Try again." };

  redirect(await destinationForUser(userData.user.id, null));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
