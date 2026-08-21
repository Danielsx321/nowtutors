"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { Alert } from "@/components/ui/alert";
import { signupSchema, type SignupValues } from "@/lib/auth/schemas";
import { signup } from "@/actions/auth";
import { GoogleButton } from "./google-button";
import { AuthDivider } from "./auth-divider";

export function SignupForm({ next }: { next?: string }) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [checkEmail, setCheckEmail] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await signup(values, next); // server re-validates + creates user
    if (res && "error" in res) setFormError(res.error);
    else if (res?.ok && res.message) setCheckEmail(res.message);
    // if a session was created, signup() redirects to /onboarding server-side
  });

  if (checkEmail) {
    return (
      <Alert variant="success" title="Almost there">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>{checkEmail}</span>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {formError && <Alert variant="danger">{formError}</Alert>}
      <GoogleButton label="Sign up with Google" />
      <AuthDivider />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" required>
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            invalid={!!errors.email}
            aria-describedby="email-error"
            {...register("email")}
          />
          <FieldError id="email-error">{errors.email?.message}</FieldError>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" required>
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.password}
            aria-describedby="password-error"
            {...register("password")}
          />
          <FieldError id="password-error">{errors.password?.message}</FieldError>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword" required>
            Confirm password
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.confirmPassword}
            aria-describedby="confirm-error"
            {...register("confirmPassword")}
          />
          <FieldError id="confirm-error">
            {errors.confirmPassword?.message}
          </FieldError>
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="text-center text-small text-gray-500">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="focus-ring rounded-sm font-medium text-purple-500 hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
