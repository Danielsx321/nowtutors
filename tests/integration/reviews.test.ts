import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixtureBooking,
  deleteFixtureBooking,
  openConnection,
  type TestConnection,
} from "./helpers/test-db";

/**
 * Reviews v1 (drizzle/0031) against the test project. The rules under test
 * live in SQL: the BEFORE INSERT guard (a review needs a completed booking of
 * that student with that tutor), the one-per-booking unique index, the
 * checks, and the AFTER trigger that keeps tutor_profiles.rating_avg /
 * rating_count equal to the published rows. Only rows this file creates are
 * touched, and the expected rating is read from the reviews table itself, so
 * leftovers elsewhere in the project can't make it pass or fail.
 */

describe("reviews (test project)", () => {
  let conn: TestConnection;
  const bookings: string[] = [];

  beforeAll(() => {
    conn = openConnection("reviews");
  });

  afterAll(async () => {
    for (const id of bookings) await deleteFixtureBooking(conn, id).catch(() => undefined);
    await conn.end();
  });

  async function insertReview(b: { bookingId: string; studentId: string; tutorId: string }, rating = 5) {
    return conn.db.execute<{ id: string }>(sql`
      insert into reviews (booking_id, student_id, tutor_id, rating, comment)
      values (${b.bookingId}, ${b.studentId}, ${b.tutorId}, ${rating}, 'Clear and patient.')
      returning id
    `);
  }

  /** Drizzle wraps the Postgres error as "Failed query"; the reason is on `cause`. */
  async function failure(p: Promise<unknown>): Promise<string> {
    try {
      await p;
    } catch (e) {
      const err = e as { message?: string; cause?: { message?: string; constraint_name?: string } };
      return [err.message, err.cause?.message, err.cause?.constraint_name].filter(Boolean).join(" | ");
    }
    throw new Error("expected the statement to fail, and it succeeded");
  }

  async function ratingState(tutorId: string) {
    const [row] = await conn.db.execute<{ avg: string; count: number; want_avg: string | null; want_count: number }>(sql`
      select tp.rating_avg::text as avg, tp.rating_count as count,
             (select round(avg(rating)::numeric, 2)::text from reviews where tutor_id = ${tutorId} and is_published) as want_avg,
             (select count(*)::int from reviews where tutor_id = ${tutorId} and is_published) as want_count
        from tutor_profiles tp where tp.user_id = ${tutorId}
    `);
    return row;
  }

  it("refuses a review of a lesson that is not completed", async () => {
    const b = await createFixtureBooking(conn, { status: "in_progress", startedMinutesAgo: 5 });
    bookings.push(b.bookingId);
    expect(await failure(insertReview(b))).toMatch(/completed booking/);
  });

  it("refuses a review written for someone else's lesson", async () => {
    const b = await createFixtureBooking(conn, { status: "completed", startedMinutesAgo: 60 });
    bookings.push(b.bookingId);
    expect(await failure(insertReview({ ...b, studentId: b.tutorId }))).toMatch(/completed booking/);
  });

  it("takes one review of a completed lesson and keeps the tutor's rating equal to the published rows", async () => {
    const b = await createFixtureBooking(conn, { status: "completed", startedMinutesAgo: 60 });
    bookings.push(b.bookingId);
    const [r] = await insertReview(b, 4);
    expect(r?.id).toBeTruthy();

    let s = await ratingState(b.tutorId);
    expect(s.count).toBe(s.want_count);
    expect(Number(s.avg)).toBe(Number(s.want_avg));

    // One per booking.
    expect(await failure(insertReview(b, 5))).toMatch(/reviews_booking_unique|duplicate/);

    // Hiding takes it out of the average; showing puts it back.
    const before = s.count;
    await conn.db.execute(sql`update reviews set is_published = false where id = ${r!.id}`);
    s = await ratingState(b.tutorId);
    expect(s.count).toBe(before - 1);
    expect(s.count).toBe(s.want_count);
    await conn.db.execute(sql`update reviews set is_published = true where id = ${r!.id}`);
    s = await ratingState(b.tutorId);
    expect(s.count).toBe(before);

    // Deleting the booking removes the review and recomputes.
    await deleteFixtureBooking(conn, b.bookingId);
    s = await ratingState(b.tutorId);
    expect(s.count).toBe(before - 1);
    expect(s.count).toBe(s.want_count);
  });

  it("checks the rating range and the comment length", async () => {
    const b = await createFixtureBooking(conn, { status: "completed", startedMinutesAgo: 60 });
    bookings.push(b.bookingId);
    expect(await failure(insertReview(b, 6))).toMatch(/reviews_rating_chk/);
    expect(
      await failure(
        conn.db.execute(sql`
          insert into reviews (booking_id, student_id, tutor_id, rating, comment)
          values (${b.bookingId}, ${b.studentId}, ${b.tutorId}, 5, ${"x".repeat(1001)})
        `),
      ),
    ).toMatch(/reviews_comment_len_chk/);
  });
});
