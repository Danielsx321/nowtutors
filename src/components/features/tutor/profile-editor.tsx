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
  tutorProfileEditSchema,
  type TutorProfileEditValues,
} from "@/lib/auth/schemas";
import { updateTutorProfile } from "@/actions/tutor-profile";
import { AvatarUpload } from "@/components/features/onboarding/avatar-upload";
import type { SubjectOption } from "@/components/features/onboarding/student-form";
import { TutorCard } from "@/components/features/tutor-card";

const LEVELS = [
  { value: "all", label: "All levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

/**
 * /tutor/profile. Same zod schema as tutor onboarding (derived via omit/extend),
 * so validation cannot drift between the two forms. approval_status,
 * approval_note, slug and role are not fields here and are rejected server-side.
 */
export function TutorProfileEditor({
  userId,
  subjects,
  defaults,
  isApproved,
  preview,
}: {
  userId: string;
  subjects: SubjectOption[];
  defaults: TutorProfileEditValues;
  isApproved: boolean;
  /** What the card needs that the form doesn't edit (live-globe Part F preview). */
  preview?: { slug: string; country: string | null; completedSessions: number };
}) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TutorProfileEditValues>({
    resolver: zodResolver(tutorProfileEditSchema),
    defaultValues: defaults,
  });

  const fullName = watch("fullName");
  const avatarUrl = watch("avatarUrl");
  const selectedSubjects = watch("subjects");
  const languages = watch("languages");
  const headline = watch("headline");
  const rate = watch("hourlyRateCredits");
  const years = watch("yearsExperience");

  const nameFor = React.useMemo(
    () => new Map(subjects.map((s) => [s.slug, s.name])),
    [subjects],
  );

  function toggleSubject(slug: string) {
    const exists = selectedSubjects.some((s) => s.slug === slug);
    setValue(
      "subjects",
      exists
        ? selectedSubjects.filter((s) => s.slug !== slug)
        : [...selectedSubjects, { slug, level: "all" as const }],
      { shouldValidate: true },
    );
  }
  function setLevel(slug: string, level: (typeof LEVELS)[number]["value"]) {
    setValue(
      "subjects",
      selectedSubjects.map((s) => (s.slug === slug ? { ...s, level } : s)),
      { shouldValidate: true },
    );
  }
  function toggleLanguage(lang: (typeof LANGUAGES)[number]) {
    setValue(
      "languages",
      languages.includes(lang)
        ? languages.filter((l) => l !== lang)
        : [...languages, lang],
      { shouldValidate: true },
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    const res = await updateTutorProfile(values);
    if ("error" in res) setFormError(res.error);
    else setSaved(true);
  });

  const form = (
    <form onSubmit={onSubmit} noValidate className="min-w-0 space-y-6">
      {formError && <Alert variant="danger">{formError}</Alert>}
      {saved && (
        <Alert variant="success" title="Profile saved">
          {isApproved ? (
            <p>
              Your changes are live now. Edits to your headline, about, subjects,
              rate or intro video are re-checked by our team — you stay visible
              and bookable in the meantime.
            </p>
          ) : (
            <p>Your changes have been saved and will be reviewed with your application.</p>
          )}
        </Alert>
      )}

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
        <Label htmlFor="fullName" required>Display name</Label>
        <Input id="fullName" invalid={!!errors.fullName} {...register("fullName")} />
        <FieldError>{errors.fullName?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="headline" required>Headline</Label>
        <Input id="headline" invalid={!!errors.headline} {...register("headline")} />
        <FieldError>{errors.headline?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="about" required>About you</Label>
        <Textarea id="about" rows={6} invalid={!!errors.about} {...register("about")} />
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
          <div className="space-y-2 rounded-md border border-border p-3">
            {selectedSubjects.map((s) => (
              <div key={s.slug} className="flex items-center justify-between gap-3">
                <span className="text-small text-text">
                  {nameFor.get(s.slug) ?? s.slug}
                </span>
                <div className="w-40">
                  <Select
                    value={s.level}
                    onValueChange={(v) => setLevel(s.slug, v as typeof s.level)}
                  >
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
          <Label htmlFor="hourlyRateCredits" required>Hourly rate (credits)</Label>
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
            <label key={lang} className="flex items-center gap-2 text-small text-text">
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
        <Label htmlFor="education">Education</Label>
        <Input id="education" {...register("education")} />
        <FieldError>{errors.education?.message}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="introVideoUrl">Intro video URL</Label>
        <Input
          id="introVideoUrl"
          type="url"
          placeholder="https://..."
          invalid={!!errors.introVideoUrl}
          {...register("introVideoUrl")}
        />
        <FieldError>{errors.introVideoUrl?.message}</FieldError>
      </div>

      <Button type="submit" loading={isSubmitting}>
        Save changes
      </Button>
    </form>
  );

  if (!preview) return form;

  // The card as students will see it, redrawn as the form changes (Part F).
  // `inert` so its links and heart don't navigate away mid-edit.
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {form}
      <aside aria-label="Card preview" className="lg:sticky lg:top-28 lg:self-start">
        <p className="mb-2 text-small font-medium text-text">How students see your card</p>
        <div inert>
          <TutorCard
            favouriteMode="hidden"
            tutor={{
              userId,
              slug: preview.slug,
              displayName: fullName?.trim() || "Your name",
              avatarUrl: avatarUrl ?? null,
              country: preview.country,
              headline: headline?.trim() || null,
              ratingAvg: 0,
              ratingCount: 0,
              hourlyRateCredits: Number(rate) > 0 ? Number(rate) : 0,
              yearsExperience: years != null && Number(years) > 0 ? Number(years) : null,
              completedSessions: preview.completedSessions,
              acceptsInstant: false,
              subjects: selectedSubjects.map((sub) => nameFor.get(sub.slug) ?? sub.slug).slice(0, 3),
              liveStatus: "offline",
              liveBroadcastId: null,
              isFavourited: false,
            }}
          />
        </div>
        <p className="mt-2 text-caption text-text-muted">
          Saved changes show on your public page straight away.
        </p>
      </aside>
    </div>
  );
}
