"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { SubjectChip } from "@/components/ui/subject-chip";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { LANGUAGES } from "@/lib/geo/languages";
import {
  tutorOnboardingSchema,
  type TutorOnboardingValues,
} from "@/lib/auth/schemas";
import { completeTutorOnboarding } from "@/actions/onboarding";
import { AvatarUpload } from "./avatar-upload";
import type { SubjectOption } from "./student-form";

const LEVELS = [
  { value: "all", label: "All levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export function TutorForm({
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
  } = useForm<TutorOnboardingValues>({
    resolver: zodResolver(tutorOnboardingSchema),
    defaultValues: {
      fullName: "",
      avatarUrl: undefined,
      headline: "",
      about: "",
      subjects: [],
      languages: [],
      education: undefined,
      yearsExperience: undefined,
      paypalEmail: "",
    },
  });

  const fullName = watch("fullName");
  const avatarUrl = watch("avatarUrl");
  const selectedSubjects = watch("subjects");
  const languages = watch("languages");

  const nameFor = React.useMemo(
    () => new Map(subjects.map((s) => [s.slug, s.name])),
    [subjects],
  );

  function toggleSubject(slug: string) {
    const exists = selectedSubjects.some((s) => s.slug === slug);
    const next = exists
      ? selectedSubjects.filter((s) => s.slug !== slug)
      : [...selectedSubjects, { slug, level: "all" as const }];
    setValue("subjects", next, { shouldValidate: true });
  }
  function setLevel(slug: string, level: (typeof LEVELS)[number]["value"]) {
    setValue(
      "subjects",
      selectedSubjects.map((s) => (s.slug === slug ? { ...s, level } : s)),
      { shouldValidate: true },
    );
  }
  function toggleLanguage(lang: (typeof LANGUAGES)[number]) {
    const next = languages.includes(lang)
      ? languages.filter((l) => l !== lang)
      : [...languages, lang];
    setValue("languages", next, { shouldValidate: true });
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await completeTutorOnboarding(values);
    if (res && "error" in res) setFormError(res.error);
    // success redirects to /tutor/pending-approval server-side
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError && <Alert variant="danger">{formError}</Alert>}

      <div className="space-y-1.5">
        <Label>Profile photo</Label>
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
        <Input id="fullName" invalid={!!errors.fullName} {...register("fullName")} />
        <FieldError>{errors.fullName?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="headline" required>
          Headline
        </Label>
        <Input
          id="headline"
          placeholder="e.g. Physics & maths tutor, 8 years' experience"
          invalid={!!errors.headline}
          {...register("headline")}
        />
        <FieldError>{errors.headline?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="about" required>
          About you
        </Label>
        <Textarea id="about" rows={5} invalid={!!errors.about} {...register("about")} />
        <FieldError>{errors.about?.message}</FieldError>
      </div>

      <div className="space-y-2">
        <Label required>Subjects you teach</Label>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <SubjectChip
              key={s.slug}
              interactive
              selected={selectedSubjects.some((x) => x.slug === s.slug)}
              onClick={() => toggleSubject(s.slug)}
            >
              {s.name}
            </SubjectChip>
          ))}
        </div>
        {selectedSubjects.length > 0 && (
          <div className="space-y-2 rounded-md border border-gray-200 p-3">
            {selectedSubjects.map((s) => (
              <div key={s.slug} className="flex items-center justify-between gap-3">
                <span className="text-small text-gray-700">
                  {nameFor.get(s.slug) ?? s.slug}
                </span>
                <div className="w-40">
                  <Select value={s.level} onValueChange={(v) => setLevel(s.slug, v as typeof s.level)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
        <FieldError>{errors.subjects?.message as string | undefined}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="hourlyRateCredits" required>
            Hourly rate (credits)
          </Label>
          <Input
            id="hourlyRateCredits"
            type="number"
            min={1}
            invalid={!!errors.hourlyRateCredits}
            {...register("hourlyRateCredits", { valueAsNumber: true })}
          />
          <FieldError>{errors.hourlyRateCredits?.message}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yearsExperience">Years of experience</Label>
          <Input
            id="yearsExperience"
            type="number"
            min={0}
            {...register("yearsExperience", {
              setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
            })}
          />
          <FieldError>{errors.yearsExperience?.message}</FieldError>
        </div>
      </div>

      <div className="space-y-2">
        <Label required>Languages you teach in</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {LANGUAGES.map((lang) => (
            <label key={lang} className="flex items-center gap-2 text-small text-gray-700">
              <Checkbox
                checked={languages.includes(lang)}
                onCheckedChange={() => toggleLanguage(lang)}
              />
              {lang}
            </label>
          ))}
        </div>
        <FieldError>{errors.languages?.message as string | undefined}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="education">Education (optional)</Label>
        <Input id="education" {...register("education")} />
        <FieldError>{errors.education?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paypalEmail" required>
          PayPal email (for payouts)
        </Label>
        <Input
          id="paypalEmail"
          type="email"
          invalid={!!errors.paypalEmail}
          {...register("paypalEmail")}
        />
        <FieldError>{errors.paypalEmail?.message}</FieldError>
      </div>

      <p className="text-small text-gray-500">
        Your profile is reviewed by our team before it goes live. You&apos;ll get
        an email once you&apos;re approved.
      </p>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        Submit for review
      </Button>
    </form>
  );
}
