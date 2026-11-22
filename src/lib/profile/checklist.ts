import { ABOUT_MIN } from "@/lib/auth/schemas";
import type { ProfileCompleteness } from "@/db/queries/dashboard-stats";

export interface ChecklistItem {
  ok: boolean;
  text: string;
}

/**
 * The profile checklist on the tutor's Today page. After the audit of
 * 18 Nov 2026 ("profiles are uneven") it also asks for an About of at least
 * {@link ABOUT_MIN} characters and an intro video. Nudges only: a tutor
 * approved with a shorter bio is never blocked (lib/auth/schemas.ts).
 */
export function profileChecklist(p: ProfileCompleteness): ChecklistItem[] {
  const about: ChecklistItem =
    p.aboutLength >= ABOUT_MIN
      ? { ok: true, text: "About written" }
      : p.aboutLength === 0
        ? { ok: false, text: "Write your About" }
        : { ok: false, text: `Grow your About to ${ABOUT_MIN}+ characters (now ${p.aboutLength})` };

  return [
    { ok: p.hasPhoto, text: p.hasPhoto ? "Photo added" : "Add a photo" },
    {
      ok: p.subjects > 0,
      text: p.subjects > 0 ? `${p.subjects} ${p.subjects === 1 ? "subject" : "subjects"} listed` : "List your subjects",
    },
    {
      ok: p.availabilityRules > 0,
      text: p.availabilityRules > 0 ? "Weekly availability set" : "Set your weekly availability",
    },
    about,
    { ok: p.hasVideo, text: p.hasVideo ? "Intro video added" : "Add a short intro video" },
  ];
}
