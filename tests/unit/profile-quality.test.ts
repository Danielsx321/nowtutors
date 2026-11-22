import { describe, expect, it } from "vitest";
import {
  ABOUT_MIN,
  tutorOnboardingSchema,
  tutorProfileEditSchema,
} from "@/lib/auth/schemas";
import { profileChecklist } from "@/lib/profile/checklist";

/**
 * Audit pass 2 (point 8, "profiles are uneven"): new tutors write an About of
 * at least ABOUT_MIN characters and can add an intro video at onboarding;
 * tutors approved with a shorter bio can still save other edits, and the
 * Today checklist nudges them.
 */

const LONG = "x".repeat(ABOUT_MIN);
const SHORT = "I teach maths and physics to secondary students.";

const tutor = {
  fullName: "Ada Obi",
  avatarUrl: "https://x.supabase.co/storage/v1/object/public/avatars/u/a.jpg",
  headline: "Maths tutor, ten years' experience",
  subjects: [{ slug: "algebra", level: "all" as const }],
  hourlyRateCredits: 40,
  languages: ["English"],
};

describe("About minimum", () => {
  it("onboarding refuses an About under the minimum and accepts one at it", () => {
    const short = tutorOnboardingSchema.safeParse({ ...tutor, about: SHORT, paypalEmail: "a@example.com" });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toContain(`${ABOUT_MIN} characters`);
    expect(
      tutorOnboardingSchema.safeParse({ ...tutor, about: LONG, paypalEmail: "a@example.com" }).success,
    ).toBe(true);
  });

  it("counts trimmed characters", () => {
    const padded = `  ${"x".repeat(ABOUT_MIN - 1)}  `;
    expect(tutorOnboardingSchema.safeParse({ ...tutor, about: padded, paypalEmail: "a@example.com" }).success).toBe(false);
  });

  it("the editor still accepts an existing short bio, so other edits are not blocked", () => {
    expect(tutorProfileEditSchema.safeParse({ ...tutor, about: SHORT }).success).toBe(true);
    expect(tutorProfileEditSchema.safeParse({ ...tutor, about: "too short" }).success).toBe(false);
  });
});

describe("intro video at onboarding", () => {
  const base = { ...tutor, about: LONG, paypalEmail: "a@example.com" };
  it("is optional and empty is fine", () => {
    expect(tutorOnboardingSchema.safeParse(base).success).toBe(true);
    const r = tutorOnboardingSchema.safeParse({ ...base, introVideoUrl: "" });
    expect(r.success && r.data.introVideoUrl).toBe(undefined);
  });
  it("takes YouTube, Vimeo or Loom and refuses other hosts", () => {
    expect(tutorOnboardingSchema.safeParse({ ...base, introVideoUrl: "https://youtu.be/abc" }).success).toBe(true);
    expect(tutorOnboardingSchema.safeParse({ ...base, introVideoUrl: "https://evil.com/v" }).success).toBe(false);
  });
});

describe("profileChecklist", () => {
  const full = { hasPhoto: true, subjects: 2, availabilityRules: 3, hasAbout: true, aboutLength: ABOUT_MIN, hasVideo: true };

  it("is all done for a full profile", () => {
    expect(profileChecklist(full).every((c) => c.ok)).toBe(true);
  });

  it("asks a short bio to grow, with the current length", () => {
    const item = profileChecklist({ ...full, aboutLength: 48 }).find((c) => c.text.includes("About"));
    expect(item).toEqual({ ok: false, text: `Grow your About to ${ABOUT_MIN}+ characters (now 48)` });
  });

  it("asks for an About when there is none, and for a video when missing", () => {
    const items = profileChecklist({ ...full, aboutLength: 0, hasAbout: false, hasVideo: false });
    expect(items.map((c) => c.text)).toContain("Write your About");
    expect(items.map((c) => c.text)).toContain("Add a short intro video");
  });
});
