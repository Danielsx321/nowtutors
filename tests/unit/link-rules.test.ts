import { describe, expect, it } from "vitest";
import {
  INTRO_VIDEO_HOSTS,
  isAllowedIntroVideoUrl,
  isOwnAvatarUrl,
  ownAvatarPrefix,
  studentOnboardingSchemaFor,
  tutorOnboardingSchemaFor,
  tutorProfileEditSchema,
  tutorProfileEditSchemaFor,
} from "@/lib/auth/schemas";

/**
 * Security C (2026-10-22): intro videos only from the allowed hosts over
 * https, and avatars only from the caller's own folder in the public bucket.
 */

const SB = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const mine = `${SB}/storage/v1/object/public/avatars/${ME}/avatar-1760000000000.jpg`;

describe("intro video links", () => {
  it("accepts https links on each allowed host", () => {
    expect(INTRO_VIDEO_HOSTS).toContain("youtu.be");
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/123456",
      "https://player.vimeo.com/video/123456",
      "https://www.loom.com/share/abc",
      "https://loom.com/share/abc",
      "https://WWW.YOUTUBE.COM/watch?v=x",
    ]) {
      expect(isAllowedIntroVideoUrl(url), url).toBe(true);
    }
  });

  it("refuses javascript:, data:, http: and foreign or look-alike hosts", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://www.youtube.com/watch?v=x",
      "https://evil.com/watch?v=x",
      "https://youtube.com.evil.com/x",
      "https://evil-youtube.com/x",
      "https://m.youtube.com/watch?v=x",
      "https://user:pw@youtube.com/x",
      "https://youtube.com:8443/x",
      "not a url",
    ]) {
      expect(isAllowedIntroVideoUrl(url), url).toBe(false);
    }
  });

  it("is enforced by the profile edit schema, and empty still means no video", () => {
    const base = {
      fullName: "Ada Lovelace",
      avatarUrl: mine,
      headline: "Maths tutor for GCSE and A-level",
      about: "I have taught maths for ten years and love helping students.",
      subjects: [{ slug: "maths", level: "all" as const }],
      hourlyRateCredits: 30,
      languages: ["English" as const],
    };
    expect(tutorProfileEditSchema.safeParse({ ...base, introVideoUrl: "https://youtu.be/x" }).success).toBe(true);
    expect(tutorProfileEditSchema.safeParse({ ...base, introVideoUrl: "" }).success).toBe(true);
    expect(tutorProfileEditSchema.safeParse({ ...base }).success).toBe(true);
    const bad = tutorProfileEditSchema.safeParse({ ...base, introVideoUrl: "javascript:alert(1)" });
    expect(bad.success).toBe(false);
    expect(tutorProfileEditSchema.safeParse({ ...base, introVideoUrl: "https://evil.com/v" }).success).toBe(false);
  });
});

describe("avatar links", () => {
  it("builds the prefix getPublicUrl uses, ignoring a trailing slash on the base", () => {
    expect(ownAvatarPrefix(ME, SB)).toBe(`${SB}/storage/v1/object/public/avatars/${ME}/`);
    expect(ownAvatarPrefix(ME, `${SB}/`)).toBe(`${SB}/storage/v1/object/public/avatars/${ME}/`);
  });

  it("accepts a file in the user's own folder", () => {
    expect(isOwnAvatarUrl(mine, ME, SB)).toBe(true);
  });

  it("refuses another user's folder, other hosts and schemes, and traversal out of the folder", () => {
    for (const url of [
      `${SB}/storage/v1/object/public/avatars/${OTHER}/avatar.jpg`,
      `${SB}/storage/v1/object/public/avatars/${ME}/../${OTHER}/avatar.jpg`,
      `${SB}/storage/v1/object/public/avatars/${ME}/%2e%2e/${OTHER}/avatar.jpg`,
      `${SB}/storage/v1/object/public/avatars/${ME}/`,
      `${SB}/storage/v1/object/public/avatars/${ME}/\\x.jpg`,
      `${SB}/storage/v1/object/public/message-attachments/${ME}/x.jpg`,
      `https://evil.com/storage/v1/object/public/avatars/${ME}/avatar.jpg`,
      `http://proj.supabase.co/storage/v1/object/public/avatars/${ME}/avatar.jpg`,
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      expect(isOwnAvatarUrl(url, ME, SB), url).toBe(false);
    }
    expect(isOwnAvatarUrl(mine, "", SB)).toBe(false);
  });
});

describe("server-side schemas pin the avatar to the caller", () => {
  // The factories read NEXT_PUBLIC_SUPABASE_URL, as the actions do.
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB;

  const tutor = {
    fullName: "Ada Lovelace",
    avatarUrl: mine,
    headline: "Maths tutor for GCSE and A-level",
    about: "I have taught maths for ten years and love helping students.",
    subjects: [{ slug: "maths", level: "all" as const }],
    hourlyRateCredits: 30,
    languages: ["English" as const],
  };

  it("student onboarding: own avatar, empty or absent pass; someone else's fails", () => {
    const base = { fullName: "Sam Stone", timezone: "Europe/London", subjects: [] };
    const s = studentOnboardingSchemaFor(ME);
    expect(s.safeParse({ ...base, avatarUrl: mine }).success).toBe(true);
    expect(s.safeParse({ ...base, avatarUrl: "" }).success).toBe(true);
    expect(s.safeParse({ ...base }).success).toBe(true);
    expect(studentOnboardingSchemaFor(OTHER).safeParse({ ...base, avatarUrl: mine }).success).toBe(false);
    expect(s.safeParse({ ...base, avatarUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("tutor onboarding and profile edit: only the caller's own folder", () => {
    expect(tutorOnboardingSchemaFor(ME).safeParse({ ...tutor, paypalEmail: "ada@example.com" }).success).toBe(true);
    expect(tutorOnboardingSchemaFor(OTHER).safeParse({ ...tutor, paypalEmail: "ada@example.com" }).success).toBe(false);
    expect(tutorProfileEditSchemaFor(ME).safeParse(tutor).success).toBe(true);
    const r = tutorProfileEditSchemaFor(OTHER).safeParse(tutor);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["avatarUrl"]);
    expect(tutorProfileEditSchemaFor(ME).safeParse({ ...tutor, avatarUrl: "https://evil.com/a.jpg" }).success).toBe(false);
  });
});
