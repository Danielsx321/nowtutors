"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordSchema, type ChangePasswordValues } from "@/lib/auth/schemas";
import { changePassword } from "@/actions/settings";

/**
 * Change password. Google-only accounts get a sentence instead of a form: they
 * have no NowTutors password, and a form that can only fail is worse than none.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [saved, setSaved] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });

  if (!hasPassword) {
    return (
      <p className="text-body text-text-muted">
        You sign in with Google, so there&rsquo;s no NowTutors password to change. Manage it in your Google
        account.
      </p>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    const res = await changePassword(values);
    if ("error" in res) setFormError(res.error);
    else {
      setSaved(true);
      reset();
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword" required>
          Current password
        </Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          invalid={!!errors.currentPassword}
          {...register("currentPassword")}
        />
        <FieldError>{errors.currentPassword?.message}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password" required>
          New password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          invalid={!!errors.password}
          aria-describedby="password-help"
          {...register("password")}
        />
        <p id="password-help" className="text-small text-text-muted">
          At least 8 characters, with a letter and a number.
        </p>
        <FieldError>{errors.password?.message}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword" required>
          Confirm new password
        </Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
        <FieldError>{errors.confirmPassword?.message}</FieldError>
      </div>
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      {saved ? <Alert variant="success">Password changed.</Alert> : null}
      <Button type="submit" loading={isSubmitting}>
        Change password
      </Button>
    </form>
  );
}
