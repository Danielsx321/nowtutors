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
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/lib/auth/schemas";
import { requestPasswordReset } from "@/actions/auth";

export function ForgotPasswordForm() {
  const [message, setMessage] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    // Always returns the same neutral message — never reveals if the email exists.
    // The one error it can return is the rate limit, which is the same for
    // every address.
    setFormError(null);
    const res = await requestPasswordReset(values);
    if ("error" in res) setFormError(res.error);
    else if (res.message) setMessage(res.message);
  });

  if (message) {
    return <Alert variant="info">{message}</Alert>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert variant="danger">{formError}</Alert>}
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
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Send reset link
      </Button>
      <p className="text-center text-small text-text-muted">
        <Link
          href="/login"
          className="focus-ring rounded-sm font-medium text-accent hover:underline"
        >
          Back to log in
        </Link>
      </p>
    </form>
  );
}
