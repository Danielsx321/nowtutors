import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixtureBooking,
  deleteFixtureBooking,
  openConnection,
  type TestConnection,
} from "./helpers/test-db";

/**
 * drizzle/0032: tutor_profiles.completed_sessions / total_minutes_taught follow
 * the tutor's completed bookings, by trigger. The expected numbers are read
 * from bookings itself, so other rows in the test project can't skew them.
 */
describe("tutor session counts (test project)", () => {
  let conn: TestConnection;
  const created: string[] = [];

  beforeAll(() => {
    conn = openConnection("session-counts");
  });
  afterAll(async () => {
    for (const id of created) await deleteFixtureBooking(conn, id).catch(() => undefined);
    await conn.end();
  });

  async function state(tutorId: string) {
    const [r] = await conn.db.execute<{ n: number; minutes: number; want_n: number; want_minutes: number }>(sql`
      select tp.completed_sessions as n, tp.total_minutes_taught as minutes,
             (select count(*)::int from bookings where tutor_id = ${tutorId} and status = 'completed') as want_n,
             (select coalesce(sum(coalesce(billed_minutes, duration_minutes, 0)), 0)::int
                from bookings where tutor_id = ${tutorId} and status = 'completed') as want_minutes
        from tutor_profiles tp where tp.user_id = ${tutorId}
    `);
    return r;
  }

  it("counts a completed lesson, and takes it back off when it leaves completed or is deleted", async () => {
    const b = await createFixtureBooking(conn, { status: "in_progress", startedMinutesAgo: 30, durationMinutes: 45 });
    created.push(b.bookingId);
    const start = await state(b.tutorId);
    expect(start.n).toBe(start.want_n);
    expect(start.minutes).toBe(start.want_minutes);

    await conn.db.execute(sql`update bookings set status = 'completed', billed_minutes = 45 where id = ${b.bookingId}`);
    const done = await state(b.tutorId);
    expect(done.n).toBe(start.n + 1);
    expect(done.minutes).toBe(start.minutes + 45);
    expect(done.n).toBe(done.want_n);

    await conn.db.execute(sql`update bookings set status = 'no_show_tutor' where id = ${b.bookingId}`);
    const undone = await state(b.tutorId);
    expect(undone.n).toBe(start.n);
    expect(undone.minutes).toBe(start.minutes);

    await conn.db.execute(sql`update bookings set status = 'completed' where id = ${b.bookingId}`);
    await deleteFixtureBooking(conn, b.bookingId);
    const gone = await state(b.tutorId);
    expect(gone.n).toBe(start.n);
    expect(gone.n).toBe(gone.want_n);
  });

  it("counts a booking inserted as completed", async () => {
    const before = await createFixtureBooking(conn, { status: "in_progress", startedMinutesAgo: 10 });
    created.push(before.bookingId);
    const s0 = await state(before.tutorId);
    const b = await createFixtureBooking(conn, { status: "completed", startedMinutesAgo: 60 });
    created.push(b.bookingId);
    const s1 = await state(b.tutorId);
    expect(s1.n).toBe(s0.n + 1);
    expect(s1.n).toBe(s1.want_n);
  });
});
