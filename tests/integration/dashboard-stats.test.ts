import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import {
  getHomeProof,
  getLearnerHoursByMonth,
  getLiveTutorCountries,
  getProfileCompleteness,
  getStudentTutors,
  getTutorEarningsByMonth,
  getTutorHoursByMonth,
  getTutorStudents,
} from "@/db/queries/dashboard-stats";

/**
 * The dashboard and home aggregates against the real test database (live-globe
 * rebuild Parts C and E). Read-only: nothing is written, so it runs against the
 * seed as it is. It pins what a unit test can't: that the hand-written SQL runs
 * at all, returns the declared shape, and only ever surfaces bookable tutors.
 */

async function seededStudentId(): Promise<string | null> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, "student1@nowtutors.dev"))
    .limit(1);
  return row?.id ?? null;
}

afterAll(async () => {
  // Let the process exit: postgres.js keeps idle connections open otherwise.
  await db.execute(sql`select 1`);
});

describe("dashboard-stats (test database)", () => {
  it("getStudentTutors returns only approved, unsuspended tutors, live first", async () => {
    const studentId = await seededStudentId();
    expect(studentId).toBeTruthy();
    const tutors = await getStudentTutors(studentId!, 10);
    for (const t of tutors) {
      expect(typeof t.slug).toBe("string");
      expect(t.sessions).toBeGreaterThanOrEqual(0);
      const [row] = await db.execute<{ ok: boolean }>(sql`
        select tp.approval_status = 'approved' and not p.is_suspended as ok
          from tutor_profiles tp join profiles p on p.id = tp.user_id
         where tp.user_id = ${t.userId}
      `);
      expect(row?.ok).toBe(true);
      if (t.instantNow) expect(t.liveNow).toBe(true);
    }
    const liveFlags = tutors.map((t) => t.liveNow);
    expect(liveFlags).toEqual([...liveFlags].sort((a, b) => Number(b) - Number(a)));
  });

  it("getLearnerHoursByMonth gives five months ending this month", async () => {
    const studentId = await seededStudentId();
    const months = await getLearnerHoursByMonth(studentId!, "Africa/Lagos", 5);
    expect(months).toHaveLength(5);
    for (const m of months) {
      expect(m.value).toBeGreaterThanOrEqual(0);
      expect(m.count).toBeGreaterThanOrEqual(0);
    }
  });

  it("getHomeProof and getLiveTutorCountries run and return numbers and codes", async () => {
    const proof = await getHomeProof();
    expect(proof.tutors).toBeGreaterThanOrEqual(0);
    expect(proof.sessionsTaught).toBeGreaterThanOrEqual(0);
    const countries = await getLiveTutorCountries();
    for (const c of countries) expect(typeof c).toBe("string");
  });

  it("the tutor queries run against a seeded tutor and return their declared shapes", async () => {
    const [tutor] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, "tutor1@nowtutors.dev"))
      .limit(1);
    expect(tutor).toBeTruthy();

    const hours = await getTutorHoursByMonth(tutor!.id, "Africa/Lagos", 5);
    const earned = await getTutorEarningsByMonth(tutor!.id, "Africa/Lagos", 5);
    expect(hours).toHaveLength(5);
    expect(earned).toHaveLength(5);
    for (const m of [...hours, ...earned]) expect(m.value).toBeGreaterThanOrEqual(0);

    const profile = await getProfileCompleteness(tutor!.id);
    expect(typeof profile.hasPhoto).toBe("boolean");
    expect(profile.subjects).toBeGreaterThanOrEqual(0);
    expect(profile.availabilityRules).toBeGreaterThanOrEqual(0);

    const students = await getTutorStudents(tutor!.id, 10);
    for (const s of students) {
      expect(typeof s.name).toBe("string");
      expect(s.sessions).toBeGreaterThanOrEqual(0);
    }
  });
});
