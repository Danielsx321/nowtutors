import { describe, expect, it } from "vitest";
import { approvalBlocker, approvalBlockerMessage } from "@/lib/tutors/approval";
import { tutorOnboardingSchema, tutorProfileEditSchema } from "@/lib/auth/schemas";

describe("approvalBlocker (photo rule)", () => {
  it("blocks a tutor with no photo, or a blank one", () => {
    expect(approvalBlocker({ avatarUrl: null })).toBe("avatar_missing");
    expect(approvalBlocker({ avatarUrl: undefined })).toBe("avatar_missing");
    expect(approvalBlocker({ avatarUrl: "   " })).toBe("avatar_missing");
  });

  it("lets a tutor with a photo through", () => {
    expect(approvalBlocker({ avatarUrl: "https://x.supabase.co/storage/v1/object/public/avatars/a.jpg" })).toBeNull();
  });

  it("explains itself in plain words", () => {
    expect(approvalBlockerMessage("avatar_missing")).toMatch(/profile photo is required/i);
  });
});

describe("tutor forms require a photo", () => {
  const base = {
    fullName: "Ada Obi",
    headline: "Maths for GCSE and A-level",
    about: "I have taught maths for eight years and love exam prep.",
    subjects: [{ slug: "algebra", level: "all" as const }],
    hourlyRateCredits: 40,
    languages: ["English" as const],
  };

  it("onboarding refuses a tutor without a photo, with a clear message", () => {
    const r = tutorOnboardingSchema.safeParse({ ...base, paypalEmail: "ada@example.com" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/profile photo/i);
  });

  it("the profile editor refuses removing the photo too", () => {
    expect(tutorProfileEditSchema.safeParse({ ...base, avatarUrl: "" }).success).toBe(false);
    expect(
      tutorProfileEditSchema.safeParse({ ...base, avatarUrl: "https://x.supabase.co/a.jpg" }).success,
    ).toBe(true);
  });
});
