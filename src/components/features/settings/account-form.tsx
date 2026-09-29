"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { accountSettingsSchema, type AccountSettingsValues } from "@/lib/auth/schemas";
import { timeZoneLabel, timeZoneOptions } from "@/lib/geo/timezones";
import { updateAccountSettings } from "@/actions/settings";

/**
 * Name (students) and timezone (everyone). The timezone is a native select:
 * four hundred options are fine in the platform picker, which also gives
 * type-to-find and a proper phone wheel, and nothing in DESIGN.md needs more.
 * A stored zone the list doesn't carry (an alias from the browser) is kept as
 * the first option so saving never silently changes it.
 */
export function AccountForm({
  showName,
  displayName,
  timezone,
}: {
  showName: boolean;
  displayName: string | null;
  timezone: string | null;
}) {
  const [saved, setSaved] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const zones = React.useMemo(() => {
    const list = timeZoneOptions();
    return timezone && !list.includes(timezone) ? [timezone, ...list] : list;
  }, [timezone]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccountSettingsValues>({
    resolver: zodResolver(accountSettingsSchema),
    defaultValues: {
      displayName: showName ? (displayName ?? "") : undefined,
      timezone: timezone ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    const res = await updateAccountSettings(showName ? values : { timezone: values.timezone });
    if ("error" in res) setFormError(res.error);
    else setSaved(true);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {showName ? (
        <div className="space-y-1.5">
          <Label htmlFor="displayName" required>
            Name
          </Label>
          <Input
            id="displayName"
            autoComplete="name"
            invalid={!!errors.displayName}
            aria-describedby="displayName-help"
            {...register("displayName")}
          />
          <p id="displayName-help" className="text-small text-text-muted">
            What tutors see on your bookings and messages.
          </p>
          <FieldError>{errors.displayName?.message}</FieldError>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="timezone" required>
          Timezone
        </Label>
        <select
          id="timezone"
          aria-invalid={!!errors.timezone || undefined}
          aria-describedby="timezone-help"
          // Selected in the server HTML too, so a slow phone never shows UTC
          // before the form script has run (react-hook-form sets it on mount).
          defaultValue={timezone ?? ""}
          className={cn(
            "focus-ring h-11 w-full rounded-lg border bg-surface-raised px-3 text-body text-text",
            errors.timezone ? "border-danger" : "border-border hover:border-border-strong",
          )}
          {...register("timezone")}
        >
          {!timezone ? <option value="">Select your timezone</option> : null}
          {zones.map((z) => (
            <option key={z} value={z}>
              {timeZoneLabel(z)}
            </option>
          ))}
        </select>
        <p id="timezone-help" className="text-small text-text-muted">
          Session times on the site and in emails are shown in this timezone.
        </p>
        <FieldError>{errors.timezone?.message}</FieldError>
      </div>

      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      {saved ? <Alert variant="success">Saved.</Alert> : null}
      <Button type="submit" loading={isSubmitting}>
        Save
      </Button>
    </form>
  );
}
