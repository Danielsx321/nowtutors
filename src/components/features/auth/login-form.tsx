"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { Alert } from "@/components/ui/alert";
import { loginSchema, type LoginValues } from "@/lib/auth/schemas";
import { login } from "@/actions/auth";
import { GoogleButton } from "./google-button";
import { AuthDivider } from "./auth-divider";

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const [formError, setFormError] = React.useState<string | null>(
    initialError ?? null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await login(values, next); // server re-validates + authenticates
    if (res && "error" in res) setFormError(res.error);
    // success redirects server-side
  });

  return (
    <div className="space-y-6">
      {formError && <Alert variant="danger">{formError}</Alert>}
      <GoogleButton />
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password" required>
              Password
            </Label>
            <Link
              href="/forgot-password"
              className="focus-ring rounded-sm text-small text-purple-500 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            invalid={!!errors.password}
            aria-describedby="password-error"
            {...register("password")}
          />
          <FieldError id="password-error">{errors.password?.message}</FieldError>
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Log in
        </Button>
      </form>

      <p className="text-center text-small text-gray-500">
        New to NowTutors?{" "}
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="focus-ring rounded-sm font-medium text-purple-500 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
