import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openConnection, type TestConnection } from "./helpers/test-db";

/**
 * "A student may have at most one `pending` request at a time" (SPEC §7.4),
 * against a real Postgres (code review 2026-09-20, R1).
 *
 * **Why this cannot be a unit test.** The rule was a read followed by an insert
 * in `createSessionRequest`. Two requests sent at the same moment both pass the
 * read before either inserts, so the only thing that can refuse the second one
 * is the database. This file does not mock `@/db`: it calls the shipped
 * `insertSessionRequest` twice, which is what two simultaneous actions do once
 * both are past their check.
 */

const { insertSessionRequest, PendingRequestExistsError } = await import(
  "@/db/queries/session-requests"
);

describe("one pending session request per student (test project)", () => {
  let conn: TestConnection;
  let studentId: string;
  let tutorIds: string[];

  async function clearStudentRequests() {
    await conn.db.execute(
      sql`delete from session_requests where student_id = ${studentId} and message = 'one-pending-probe'`,
    );
  }

  beforeAll(async () => {
    conn = openConnection("one-pending");
    const rows = await conn.db.execute<{ id: string; role: string }>(sql`
      (select id, role::text from profiles where role = 'student' order by created_at limit 1)
      union all
      (select id, role::text from profiles where role = 'tutor' order by created_at limit 2)
    `);
    studentId = rows.find((r) => r.role === "student")!.id;
    tutorIds = rows.filter((r) => r.role === "tutor").map((r) => r.id);
    expect(tutorIds.length).toBe(2);
    // A pending row the seed or an earlier run left behind would make the first
    // insert below fail for the wrong reason.
    await conn.db.execute(
      sql`update session_requests set status = 'expired' where student_id = ${studentId} and status = 'pending'`,
    );
  });

  afterEach(clearStudentRequests);

  afterAll(async () => {
    await clearStudentRequests();
    await conn.end();
    const { db } = await import("@/db");
    await (db.$client as { end: (o?: unknown) => Promise<void> }).end({ timeout: 5 });
  });

  const request = (tutorId: string) =>
    insertSessionRequest({
      studentId,
      tutorId,
      subjectId: null,
      message: "one-pending-probe",
      durationMinutes: 30,
      priceCredits: 20,
      ttlSeconds: 60,
    });

  it("lands exactly one of two requests sent at the same moment", async () => {
    const results = await Promise.allSettled([request(tutorIds[0]), request(tutorIds[1])]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(PendingRequestExistsError);

    const rows = await conn.db.execute<{ n: string }>(sql`
      select count(*) as n from session_requests
       where student_id = ${studentId} and status = 'pending'
    `);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("allows a new request once the earlier one is no longer pending", async () => {
    const first = await request(tutorIds[0]);
    await conn.db.execute(
      sql`update session_requests set status = 'declined' where id = ${first.id}`,
    );
    await expect(request(tutorIds[1])).resolves.toMatchObject({ id: expect.any(String) });
  });
});
