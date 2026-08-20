import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { sessionPoolerUrl } from "./session-url";
import { splitEarnings } from "../lib/credits/fees";
import { sessionPriceCredits } from "../lib/credits/pricing";

// DEV seed (idempotent). Creates auth users via the admin API — the signup
// trigger makes each profiles row (role NULL) — then fills roles/details,
// wallets, subjects, settings, availability, favourites, and sample bookings.
// Canonical 26-subject list + languages from the Bubble option sets (Phase 3).
// platform_settings + credit_packages carry the resolved SPEC §18 values (see docs/DECISIONS.md).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error("Missing Supabase env for seed");

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "Password123!";

// Canonical 26 subjects (Bubble option set), in order → sort_order 1..26.
// #3/#11 corrected per the §18 resolution; #6/#10 confirmed correct as seeded (see DECISIONS.md).
const SUBJECT_NAMES = [
  "Algebra",
  "Advanced Calculus",
  "English as a Second Language (ESL)",
  "Python Programming",
  "Physics",
  "IELTS / TOEFL Essay Proofreading",
  "Chemistry",
  "SAT / ACT Test Prep",
  "Statistics & Data Analysis",
  "Data Science & Machine Learning",
  "Live IELTS / TOEFL Speaking Prep",
  "Java & C++ Programming",
  "Financial Accounting",
  "Academic Essay Writing",
  "Spanish",
  "French",
  "Biology & Genetics",
  "GRE / GMAT Test Prep",
  "Web Development",
  "Macro / Microeconomics",
  "Arabic",
  "MCAT / LSAT Test Prep",
  "Geometry",
  "Mandarin Chinese",
  "Study Skills",
  "ACT Maths",
];

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const SUBJECTS = SUBJECT_NAMES.map((name, i) => ({
  name,
  slug: slugify(name),
  sort_order: i + 1,
}));
const slugOf = Object.fromEntries(SUBJECTS.map((s) => [s.name, s.slug]));

// Resolved values from SPEC §18 (2026-08-20). All live in platform_settings so retuning is a
// settings change, not a rebuild. Keys removed by §18 (credit_usd_rate, min_withdrawal_credits,
// cancellation_window_hours, max_instant_minutes, min_instant_credits) are intentionally gone —
// see docs/DECISIONS.md.
const SETTINGS: { key: string; value: unknown; description: string }[] = [
  { key: "platform_fee_percent", value: 25, description: "platform fee on earnings; tutor keeps 75% (§18)" },
  { key: "earnings_hold_hours", value: 48, description: "hold before earnings become available (§18)" },
  { key: "instant_request_ttl_seconds", value: 60, description: "instant-request accept window" },
  { key: "min_withdrawal_usd", value: 30, description: "minimum withdrawal in USD; enforced server-side (§18)" },
  { key: "min_booking_notice_minutes", value: 120, description: "min notice before a slot (existing default, kept)" },
  { key: "max_booking_days_ahead", value: 7, description: "how far ahead students can book (§18)" },
  { key: "session_durations", value: [30, 60, 90], description: "fixed duration menu, not tutor-configurable (§18)" },
  { key: "cancellation_enabled", value: false, description: "no user cancel path; admin force-cancel only (§7.3, §18)" },
  {
    // Real Bubble tiers. No "minutes" column: credits are a purchased currency, not a
    // unit of time (credits-are-money amendment) — see docs/DECISIONS.md.
    key: "credit_packages",
    value: [
      { id: "starter", name: "Starter", credits: 5, price_usd: 9.99 },
      { id: "standard", name: "Standard", credits: 15, price_usd: 24.99 },
      { id: "popular", name: "Popular", credits: 30, price_usd: 39.99 },
      { id: "pro", name: "Pro", credits: 60, price_usd: 67.99 },
      { id: "premium", name: "Premium", credits: 100, price_usd: 97.99 },
    ],
    description: "buyable credit packages: credits + USD price (no minutes column — §18/DECISIONS)",
  },
];

type SeedUser = {
  key: string;
  email: string;
  role: "admin" | "tutor" | "student";
  fullName: string;
  isSuspended?: boolean;
  country?: string;
};

// Rates (credits/hour) chosen to span every browse price band:
// <50=Under 50 · 50–100 · 100–200 · 200–400 · 400+ (see src/lib/tutors/filters.ts).
type TutorDef = {
  key: string;
  slug: string;
  rate: number;
  subjects: string[];
  languages: string[];
  completed: number;
  approval: "approved" | "pending";
};

const TUTORS: (SeedUser & TutorDef)[] = [
  { key: "tutor1", email: "tutor1@nowtutors.dev", role: "tutor", fullName: "Tom Turner", country: "US",
    slug: "tom-turner", rate: 20, subjects: ["Algebra", "Geometry", "ACT Maths"], languages: ["English"], completed: 45, approval: "approved" },
  { key: "tutor2", email: "tutor2@nowtutors.dev", role: "tutor", fullName: "Tina Reyes", country: "ES",
    slug: "tina-reyes", rate: 40, subjects: ["English as a Second Language (ESL)", "Academic Essay Writing", "Spanish"], languages: ["English", "Spanish"], completed: 30, approval: "approved" },
  { key: "tutor3", email: "tutor3@nowtutors.dev", role: "tutor", fullName: "Theo Chen", country: "CN",
    slug: "theo-chen", rate: 80, subjects: ["Python Programming", "Web Development", "Data Science & Machine Learning"], languages: ["English", "Mandarin"], completed: 120, approval: "approved" },
  { key: "tutor4", email: "tutor4@nowtutors.dev", role: "tutor", fullName: "Nadia Hassan", country: "EG",
    slug: "nadia-hassan", rate: 160, subjects: ["Physics", "Advanced Calculus", "Statistics & Data Analysis"], languages: ["English", "Arabic"], completed: 78, approval: "approved" },
  { key: "tutor5", email: "tutor5@nowtutors.dev", role: "tutor", fullName: "Marco Silva", country: "BR",
    slug: "marco-silva", rate: 240, subjects: ["Financial Accounting", "Macro / Microeconomics", "GRE / GMAT Test Prep"], languages: ["English", "French", "Portuguese"], completed: 205, approval: "approved" },
  { key: "tutor6", email: "tutor6@nowtutors.dev", role: "tutor", fullName: "Priya Nair", country: "IN",
    slug: "priya-nair", rate: 55, subjects: ["Chemistry", "Biology & Genetics", "MCAT / LSAT Test Prep"], languages: ["English", "Hindi"], completed: 64, approval: "approved" },
  // Pending — shows in the admin approval queue, hidden from browse.
  { key: "tutor7", email: "tutor7@nowtutors.dev", role: "tutor", fullName: "Fabien Roux", country: "FR",
    slug: "fabien-roux", rate: 45, subjects: ["French", "IELTS / TOEFL Essay Proofreading"], languages: ["French", "English"], completed: 0, approval: "pending" },
  // Approved profile but SUSPENDED owner — must be excluded from browse.
  { key: "tutor8", email: "tutor8@nowtutors.dev", role: "tutor", fullName: "Sana Malik", country: "PK", isSuspended: true,
    slug: "sana-malik", rate: 30, subjects: ["Study Skills"], languages: ["English", "Other"], completed: 5, approval: "approved" },
];

const STUDENTS: SeedUser[] = [
  { key: "student1", email: "student1@nowtutors.dev", role: "student", fullName: "Sam Stone", country: "US" },
  { key: "student2", email: "student2@nowtutors.dev", role: "student", fullName: "Sara Diallo", country: "SN" },
];

const ADMIN: SeedUser = { key: "admin", email: "admin@nowtutors.dev", role: "admin", fullName: "Ada Admin" };

const USERS: SeedUser[] = [ADMIN, ...TUTORS, ...STUDENTS];

// 1x1 transparent PNG — a real object in Storage to prove the avatar pipeline
// (next/image + remotePatterns) end to end; the visual is a plain circle.
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function check<T>(res: { error: unknown; data?: T }, label: string): T {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  return res.data as T;
}

async function ensureUsers(): Promise<Record<string, string>> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const byEmail = new Map(data.users.map((u) => [u.email, u.id]));
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const existing = byEmail.get(u.email);
    if (existing) {
      ids[u.key] = existing;
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: u.email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (cErr) throw cErr;
      ids[u.key] = created.user.id;
    }
  }
  return ids;
}

async function main() {
  // Ensure the avatars bucket exists (idempotent) even before the migration runs
  // in some dev flows; migration 0007 is the source of truth for its policies.
  await admin.storage.createBucket("avatars", { public: true }).catch(() => {});

  check(await admin.from("subjects").upsert(SUBJECTS, { onConflict: "slug" }), "subjects upsert");
  check(await admin.from("platform_settings").upsert(SETTINGS, { onConflict: "key" }), "settings upsert");

  const subjectRows = check(
    await admin.from("subjects").select("id, slug"),
    "subjects select",
  ) as { id: string; slug: string }[];
  const subjectId = Object.fromEntries(subjectRows.map((s) => [s.slug, s.id]));

  const id = await ensureUsers();
  const tutorIds = TUTORS.map((t) => id[t.key]);
  const studentIds = STUDENTS.map((s) => id[s.key]);
  const allIds = USERS.map((u) => id[u.key]);

  // Upload a sample avatar for tutor3 (proves the Storage → next/image pipeline).
  const avatarTutor = TUTORS[2];
  const avatarPath = `${id[avatarTutor.key]}/avatar.png`;
  await admin.storage.from("avatars").upload(avatarPath, SAMPLE_PNG, {
    contentType: "image/png",
    upsert: true,
  });
  const avatarUrl = `${url}/storage/v1/object/public/avatars/${avatarPath}`;

  // Profiles (upsert onto the trigger-created rows).
  const now = new Date().toISOString();
  check(
    await admin.from("profiles").upsert(
      USERS.map((u) => ({
        id: id[u.key],
        email: u.email,
        role: u.role,
        full_name: u.fullName,
        display_name: u.fullName.split(" ")[0],
        country: u.country ?? null,
        timezone: "Africa/Lagos",
        avatar_url: u.key === avatarTutor.key ? avatarUrl : null,
        onboarding_completed_at: now,
      })),
      { onConflict: "id" },
    ),
    "profiles upsert",
  );

  // Suspend the one suspended-owner fixture. profiles_guard (drizzle/0003) blocks
  // is_suspended changes by anyone who isn't an admin — correct for user paths, but
  // the seed's service role isn't an admin, so set it as the table owner with the
  // guard briefly disabled. Seed-only; the trigger stays the backstop for the app.
  const suspendedIds = TUTORS.filter((t) => t.isSuspended).map((t) => id[t.key]);
  if (suspendedIds.length) {
    const sql = postgres(sessionPoolerUrl(), { prepare: false, max: 1 });
    try {
      await sql`ALTER TABLE public.profiles DISABLE TRIGGER profiles_guard`;
      await sql`UPDATE public.profiles SET is_suspended = true WHERE id IN ${sql(suspendedIds)}`;
      await sql`ALTER TABLE public.profiles ENABLE TRIGGER profiles_guard`;
    } finally {
      await sql.end();
    }
  }

  // Wallets (students funded; others zero).
  check(
    await admin.from("wallets").upsert(
      allIds.map((uid) => ({
        user_id: uid,
        credit_balance: studentIds.includes(uid) ? 300 : 0,
      })),
      { onConflict: "user_id" },
    ),
    "wallets upsert",
  );

  // Clear child seed data so re-runs stay clean (respect FK order).
  await admin.from("favourites").delete().in("student_id", studentIds);
  await admin.from("tutor_earnings").delete().in("tutor_id", tutorIds);
  await admin.from("bookings").delete().in("student_id", studentIds);
  await admin.from("credit_transactions").delete().in("user_id", allIds);
  await admin.from("tutor_subjects").delete().in("tutor_id", tutorIds);
  await admin.from("availability_rules").delete().in("tutor_id", tutorIds);

  // Tutor profiles + payout + subjects + availability.
  check(
    await admin.from("tutor_profiles").upsert(
      TUTORS.map((t) => ({
        user_id: id[t.key],
        slug: t.slug,
        headline: `${t.subjects[0]} tutor`,
        about: "Seeded tutor profile for development.",
        languages: t.languages,
        hourly_rate_credits: t.rate,
        accepts_instant: true,
        completed_sessions: t.completed,
        approval_status: t.approval,
        approved_at: t.approval === "approved" ? now : null,
      })),
      { onConflict: "user_id" },
    ),
    "tutor_profiles upsert",
  );
  check(
    await admin.from("tutor_payout_details").upsert(
      TUTORS.map((t) => ({ tutor_id: id[t.key], paypal_email: `${t.slug}@paypal.dev` })),
      { onConflict: "tutor_id" },
    ),
    "payout upsert",
  );
  check(
    await admin.from("tutor_subjects").insert(
      TUTORS.flatMap((t) =>
        t.subjects.map((name) => ({ tutor_id: id[t.key], subject_id: subjectId[slugOf[name]], level: "all" })),
      ),
    ),
    "tutor_subjects insert",
  );
  check(
    await admin.from("availability_rules").insert(
      tutorIds.flatMap((uid) =>
        [1, 2, 3, 4, 5].map((weekday) => ({
          tutor_id: uid,
          weekday,
          start_time: "09:00",
          end_time: "17:00",
          is_active: true,
        })),
      ),
    ),
    "availability insert",
  );

  // Favourites: student1 hearts a couple of tutors.
  check(
    await admin.from("favourites").insert([
      { student_id: id.student1, tutor_id: id.tutor1 },
      { student_id: id.student1, tutor_id: id.tutor3 },
    ]),
    "favourites insert",
  );

  // Ledger funding for students (keeps wallet balance = sum(ledger)).
  check(
    await admin.from("credit_transactions").insert(
      studentIds.map((uid) => ({
        user_id: uid,
        delta: 300,
        balance_after: 300,
        type: "admin_adjustment",
        reference_type: "admin",
        description: "Seed funding",
        created_by: id.admin,
      })),
    ),
    "credit_transactions insert",
  );

  // Sample bookings: one scheduled/confirmed, one instant/completed (+earning).
  const in2days = new Date(Date.now() + 2 * 864e5);
  const end2days = new Date(in2days.getTime() + 60 * 60000);
  check(
    await admin.from("bookings").insert({
      student_id: id.student1,
      tutor_id: id.tutor1,
      subject_id: subjectId[slugOf["Algebra"]],
      type: "scheduled",
      status: "confirmed",
      scheduled_start_at: in2days.toISOString(),
      scheduled_end_at: end2days.toISOString(),
      duration_minutes: 60,
      price_credits: 60,
      payment_method: "credits",
    }),
    "scheduled booking",
  );

  // Instant billing (§7.4, credits-are-money amendment): flat, upfront, priced by the
  // SAME formula as scheduled — hourly_rate_credits × duration / 60, rounded up. No metering.
  // ended_at = started_at + the booked duration (server enforces length from started_at).
  // Priced via the shared helper off tutor2's rate so the fixture can't drift from the model.
  const INSTANT_DURATION = 30; // minutes
  const tutor2Rate = TUTORS.find((t) => t.key === "tutor2")!.rate; // 40 cr/hr
  const instantPrice = sessionPriceCredits(tutor2Rate, INSTANT_DURATION); // 40×30/60 = 20
  const start = new Date(Date.now() - 864e5);
  const finish = new Date(start.getTime() + INSTANT_DURATION * 60000);
  const instant = check(
    await admin
      .from("bookings")
      .insert({
        student_id: id.student2,
        tutor_id: id.tutor2,
        type: "instant",
        status: "completed",
        agora_channel: "session_seed_instant",
        started_at: start.toISOString(),
        ended_at: finish.toISOString(),
        duration_minutes: INSTANT_DURATION,
        price_credits: instantPrice,
        payment_method: "credits",
      })
      .select("id"),
    "instant booking",
  ) as { id: string }[];

  // Earnings split via the authoritative helper (SPEC §7.11) so the fixture can't diverge
  // from Phase 5: fee rounds DOWN, remainder to the tutor. gross 20 @ 25% → fee 5, net 15.
  const { grossCredits, platformFeeCredits, netCredits } = splitEarnings(instantPrice, 25);
  check(
    await admin.from("tutor_earnings").insert({
      tutor_id: id.tutor2,
      booking_id: instant[0].id,
      gross_credits: grossCredits,
      platform_fee_credits: platformFeeCredits,
      net_credits: netCredits,
      status: "available",
      available_at: now,
    }),
    "tutor_earnings insert",
  );

  console.log("Seed complete:");
  console.log(`  users: ${USERS.length} (1 admin, ${TUTORS.length} tutors, ${STUDENTS.length} students)`);
  console.log(`  tutors: 6 approved, 1 pending (admin queue), 1 approved-but-suspended (browse-excluded)`);
  console.log(`  subjects: ${SUBJECTS.length}, settings: ${SETTINGS.length}, favourites: 2 (student1)`);
  console.log(`  sample avatar uploaded for ${avatarTutor.slug}`);
  console.log(`  NOTE: live_now yields 0 rows until Phase 6 (no fresh presence) — expected`);
  console.log(`  login password for all seeded users: ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
