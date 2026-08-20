import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// DEV seed (idempotent). Creates auth users via the admin API — the signup
// trigger makes each profiles row (role NULL) — then fills roles/details,
// wallets, subjects, settings, availability, and a couple of sample bookings.
// platform_settings + credit_packages now carry the resolved SPEC §18 values. The SUBJECTS
// list below is still the 8 dev placeholders — the canonical 26-subject list lives on
// phase-3-auth-onboarding-browse (cf4e5b8) and is not ported here (see docs/DECISIONS.md).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error("Missing Supabase env for seed");

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "Password123!";

const SUBJECTS = [
  { name: "Mathematics", slug: "mathematics", sort_order: 1 },
  { name: "Physics", slug: "physics", sort_order: 2 },
  { name: "Chemistry", slug: "chemistry", sort_order: 3 },
  { name: "Biology", slug: "biology", sort_order: 4 },
  { name: "English", slug: "english", sort_order: 5 },
  { name: "Computer Science", slug: "computer-science", sort_order: 6 },
  { name: "Economics", slug: "economics", sort_order: 7 },
  { name: "History", slug: "history", sort_order: 8 },
];

// Resolved values from SPEC §18 (2026-08-20). All live in platform_settings so retuning is a
// settings change, not a rebuild. Keys removed by §18 (credit_usd_rate, min_withdrawal_credits,
// cancellation_window_hours, max_instant_minutes, min_instant_credits) are intentionally gone —
// see docs/DECISIONS.md.
const SETTINGS: { key: string; value: unknown; description: string }[] = [
  { key: "credit_minutes_ratio", value: 3, description: "1 credit = 3 minutes (§18)" },
  { key: "platform_fee_percent", value: 25, description: "platform fee on earnings; tutor keeps 75% (§18)" },
  { key: "earnings_hold_hours", value: 48, description: "hold before earnings become available (§18)" },
  { key: "instant_request_ttl_seconds", value: 60, description: "instant-request accept window" },
  { key: "min_withdrawal_usd", value: 30, description: "minimum withdrawal in USD; enforced server-side (§18)" },
  { key: "min_booking_notice_minutes", value: 120, description: "min notice before a slot (existing default, kept)" },
  { key: "max_booking_days_ahead", value: 7, description: "how far ahead students can book (§18)" },
  { key: "session_durations", value: [30, 60, 90], description: "fixed duration menu, not tutor-configurable (§18)" },
  { key: "cancellation_enabled", value: false, description: "no user cancel path; admin force-cancel only (§7.3, §18)" },
  {
    // Real Bubble tiers. No "minutes" column: Bubble's minutes labels are marketing copy
    // inconsistent with the enforced 1-credit-=-3-minutes rate — see docs/DECISIONS.md.
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
};

const USERS: SeedUser[] = [
  { key: "admin", email: "admin@nowtutors.dev", role: "admin", fullName: "Ada Admin" },
  { key: "tutor1", email: "tutor1@nowtutors.dev", role: "tutor", fullName: "Tom Tutor" },
  { key: "tutor2", email: "tutor2@nowtutors.dev", role: "tutor", fullName: "Tina Tutor" },
  { key: "tutor3", email: "tutor3@nowtutors.dev", role: "tutor", fullName: "Theo Tutor" },
  { key: "student1", email: "student1@nowtutors.dev", role: "student", fullName: "Sam Student" },
  { key: "student2", email: "student2@nowtutors.dev", role: "student", fullName: "Sara Student" },
];

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
  // Subjects + settings (upsert by natural key).
  check(await admin.from("subjects").upsert(SUBJECTS, { onConflict: "slug" }), "subjects upsert");
  check(await admin.from("platform_settings").upsert(SETTINGS, { onConflict: "key" }), "settings upsert");

  const subjectRows = check(
    await admin.from("subjects").select("id, slug"),
    "subjects select",
  ) as { id: string; slug: string }[];
  const subjectId = Object.fromEntries(subjectRows.map((s) => [s.slug, s.id]));

  const id = await ensureUsers();
  const tutorIds = [id.tutor1, id.tutor2, id.tutor3];
  const studentIds = [id.student1, id.student2];
  const allIds = USERS.map((u) => id[u.key]);

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
        timezone: "Africa/Lagos",
        onboarding_completed_at: now,
      })),
      { onConflict: "id" },
    ),
    "profiles upsert",
  );

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
  await admin.from("tutor_earnings").delete().in("tutor_id", tutorIds);
  await admin.from("bookings").delete().in("student_id", studentIds);
  await admin.from("credit_transactions").delete().in("user_id", allIds);
  await admin.from("tutor_subjects").delete().in("tutor_id", tutorIds);
  await admin.from("availability_rules").delete().in("tutor_id", tutorIds);

  // Tutor profiles + payout + subjects + availability.
  const tutorDefs = [
    { uid: id.tutor1, slug: "tom-tutor", rate: 60, subjects: ["mathematics", "physics"] },
    { uid: id.tutor2, slug: "tina-tutor", rate: 45, subjects: ["english", "history"] },
    { uid: id.tutor3, slug: "theo-tutor", rate: 90, subjects: ["computer-science", "economics"] },
  ];
  check(
    await admin.from("tutor_profiles").upsert(
      tutorDefs.map((t) => ({
        user_id: t.uid,
        slug: t.slug,
        headline: "Experienced tutor",
        about: "Seeded tutor profile for development.",
        languages: ["English"],
        hourly_rate_credits: t.rate,
        accepts_instant: true,
        approval_status: "approved",
        approved_at: now,
      })),
      { onConflict: "user_id" },
    ),
    "tutor_profiles upsert",
  );
  check(
    await admin.from("tutor_payout_details").upsert(
      tutorDefs.map((t) => ({ tutor_id: t.uid, paypal_email: `${t.slug}@paypal.dev` })),
      { onConflict: "tutor_id" },
    ),
    "payout upsert",
  );
  check(
    await admin.from("tutor_subjects").insert(
      tutorDefs.flatMap((t) =>
        t.subjects.map((slug) => ({ tutor_id: t.uid, subject_id: subjectId[slug], level: "all" })),
      ),
    ),
    "tutor_subjects insert",
  );
  check(
    await admin.from("availability_rules").insert(
      tutorDefs.flatMap((t) =>
        [1, 2, 3, 4, 5].map((weekday) => ({
          tutor_id: t.uid,
          weekday,
          start_time: "09:00",
          end_time: "17:00",
          is_active: true,
        })),
      ),
    ),
    "availability insert",
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
  const scheduled = check(
    await admin
      .from("bookings")
      .insert({
        student_id: id.student1,
        tutor_id: id.tutor1,
        subject_id: subjectId["mathematics"],
        type: "scheduled",
        status: "confirmed",
        scheduled_start_at: in2days.toISOString(),
        scheduled_end_at: end2days.toISOString(),
        duration_minutes: 60,
        price_credits: 60,
        payment_method: "credits",
      })
      .select("id"),
    "scheduled booking",
  ) as { id: string }[];

  // Flat instant model (§18/§7.4): duration ∈ {30,60,90}; charge = duration/3 credits,
  // upfront. billed_minutes is no longer a metered value — omitted. ended_at = started_at +
  // the booked duration (server enforces length from started_at). Values derived from the
  // constants so the fixture can't drift from the model again.
  const INSTANT_DURATION = 30; // minutes
  const instantPrice = INSTANT_DURATION / 3; // 10 credits, flat
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

  // Earnings at platform_fee_percent = 25 (tutor keeps 75%). 25% of 10 = 2.5; 10 credits
  // can't split exactly 25/75, so the fee rounds half-up to 3 (net 7). The authoritative
  // rounding rule is Phase 5 code — this is a dev fixture, kept internally consistent.
  const grossCredits = instantPrice; // 10
  const platformFeeCredits = Math.round((grossCredits * 25) / 100); // 3
  const netCredits = grossCredits - platformFeeCredits; // 7
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
  console.log(`  users: ${USERS.length} (1 admin, 3 tutors, 2 students)`);
  console.log(`  subjects: ${SUBJECTS.length}, settings: ${SETTINGS.length}`);
  console.log(`  bookings: scheduled=${scheduled[0].id.slice(0, 8)} instant=${instant[0].id.slice(0, 8)}`);
  console.log(`  login password for all seeded users: ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
