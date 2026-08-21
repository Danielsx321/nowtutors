"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { Alert } from "@/components/ui/alert";
import { SubjectChip } from "@/components/ui/subject-chip";
import {
  studentOnboardingSchema,
  type StudentOnboardingValues,
} from "@/lib/auth/schemas";
import { completeStudentOnboarding } from "@/actions/onboarding";
import { AvatarUpload } from "./avatar-upload";

export interface SubjectOption {
  slug: string;
  name: string;
}

export function StudentForm({
  userId,
  subjects,
}: {
  userId: string;
  subjects: SubjectOption[];
}) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<StudentOnboardingValues>({
    resolver: zodResolver(studentOnboardingSchema),
    defaultValues: { fullName: "", timezone: "", avatarUrl: undefined, subjects: [] },
  });

  // Prefill timezone from the browser (SPEC §7.1) after mount to avoid SSR mismatch.
  React.useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setValue("timezone", tz);
    } catch {
      /* leave blank; the field is editable */
    }
  }, [setValue]);

  const selected = watch("subjects");
  const fullName = watch("fullName");
  const avatarUrl = watch("avatarUrl");

  function toggleSubject(slug: string) {
    const next = selected.includes(slug)
      ? selected.filter((s) => s !== slug)
      : [...selected, slug];
    setValue("subjects", next, { shouldValidate: true });
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await completeStudentOnboarding(values);
    if (res && "error" in res) setFormError(res.error);
    // success redirects to /dashboard server-side
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError && <Alert variant="danger">{formError}</Alert>}

      <div className="space-y-1.5">
        <Label>Profile photo (optional)</Label>
        <AvatarUpload
          userId={userId}
          name={fullName}
          value={avatarUrl}
          onChange={(url) => setValue("avatarUrl", url)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fullName" required>
          Your name
        </Label>
        <Input
          id="fullName"
          autoComplete="name"
          invalid={!!errors.fullName}
          aria-describedby="fullName-error"
          {...register("fullName")}
        />
        <FieldError id="fullName-error">{errors.fullName?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone" required>
          Timezone
        </Label>
        <Input
          id="timezone"
          invalid={!!errors.timezone}
          aria-describedby="timezone-error"
          {...register("timezone")}
        />
        <FieldError id="timezone-error">{errors.timezone?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label>Subjects you&apos;re interested in</Label>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <SubjectChip
              key={s.slug}
              interactive
              selected={selected.includes(s.slug)}
              onClick={() => toggleSubject(s.slug)}
            >
              {s.name}
            </SubjectChip>
          ))}
        </div>
      </div>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        Finish setup
      </Button>
    </form>
  );
}
