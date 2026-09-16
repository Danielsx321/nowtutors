"use client";

import * as React from "react";
import { GraduationCap, Presentation, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { StudentForm, type SubjectOption } from "./student-form";
import { TutorForm } from "./tutor-form";

type Step = "role" | "student" | "tutor";

export function OnboardingFlow({
  userId,
  subjects,
}: {
  userId: string;
  subjects: SubjectOption[];
}) {
  const [step, setStep] = React.useState<Step>("role");

  if (step === "role") {
    return (
      <div className="space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-h2 font-bold text-text">Welcome to NowTutors</h1>
          <p className="text-body text-text-muted">
            How do you want to use NowTutors? You can&apos;t change this later.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RoleCard
            icon={<GraduationCap className="size-7" aria-hidden />}
            title="I want to learn"
            description="Find tutors, book sessions, and go live instantly."
            onClick={() => setStep("student")}
          />
          <RoleCard
            icon={<Presentation className="size-7" aria-hidden />}
            title="I want to teach"
            description="Create a tutor profile, set your rate, and earn."
            onClick={() => setStep("tutor")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setStep("role")}
          className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-small font-medium text-text-muted hover:text-text"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Change
        </button>
        <div className="space-y-1">
          <h1 className="text-h2 font-bold text-text">
            {step === "student" ? "Set up your account" : "Create your tutor profile"}
          </h1>
          <p className="text-body text-text-muted">
            {step === "student"
              ? "A few details so we can tailor your experience."
              : "Tell students who you are. Your profile is reviewed before it goes live."}
          </p>
        </div>
      </div>
      {step === "student" ? (
        <StudentForm userId={userId} subjects={subjects} />
      ) : (
        <TutorForm userId={userId} subjects={subjects} />
      )}
    </div>
  );
}

export function RoleCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-ring flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised p-5 text-left transition-colors",
        "hover:border-accent hover:bg-surface-muted/40",
      )}
    >
      <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-accent">
        {icon}
      </span>
      <span className="text-body-lg font-bold text-text">{title}</span>
      <span className="text-small text-text-muted">{description}</span>
    </button>
  );
}
