"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { Alert } from "@/components/ui/alert";
import {
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/lib/auth/schemas";
import { updatePassword } from "@/actions/auth";

export function ResetPasswordForm() {
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await updatePassword(values); // requires the recovery session
    if (res && "error" in res) setFormError(res.error);
    // success redirects server-side
  });

  return (
    <div className="space-y-6">
      {formError && <Alert variant="danger">{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password" required>
            New password
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
            Confirm new password
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
          Update password
        </Button>
      </form>
    </div>
  );
}
