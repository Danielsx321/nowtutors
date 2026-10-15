import { loadDbEnv, assertTestProjectRef } from "./load-env";
const dbEnv = loadDbEnv();

import { createClient } from "@supabase/supabase-js";
import { sessionPoolerUrl } from "./session-url";
import { renderEmail } from "../../emails/render";
import { appUrl } from "../lib/email/app-url";
import { logTransport, senderFromEnv, transportFromEnv } from "../lib/email/client";
import { maskEmail } from "../lib/withdrawals/mask-email";
import { nextMondayLabel } from "../lib/email/format";
import type { EmailPropsByType, Recipient } from "../lib/email/types";

// Announces the weekly availability bonus (availability-bonus, live 2026-10-15)
// once, to every tutor already on the site:
//   approved tutors                         -> `availability-bonus-launch`
//   applicants (pending, changes_requested) -> `availability-bonus-launch-applicant`
// Rejected and suspended accounts get nothing. The amount, the hours and the
// payout rate come from platform_settings, so the email says what the cron pays.
// Same shape and guards as `send-tutor-guide.ts`.
//
// Flags:
//   --dry-run                  list who would get which email (masked) and send nothing
//   --audience <who>           approved | applicants | all (default all)
//   --only <email>             send to that one tutor on the list, nobody else
//   --to <email>               a preview: both emails to that address, without
//                              reading the tutor list
//
// Run via the pnpm scripts, never directly:
//   pnpm email:bonus-announcement -- --dry-run                 dev project, log transport
//   CONFIRM_PROD=1 pnpm email:bonus-announcement:prod -- --dry-run
//   CONFIRM_PROD=1 pnpm email:bonus-announcement:prod -- --to you@example.com
//   CONFIRM_PROD=1 pnpm email:bonus-announcement:prod          the real send
//
// Dev and test always print envelopes through the log transport; only prod
// reaches Resend, and a missing RESEND_API_KEY stops a prod send before it starts.

if (dbEnv === "test") assertTestProjectRef(sessionPoolerUrl());

const argAfter = (flag: string) => {
  const at = process.argv.indexOf(flag);
  if (at < 0) return undefined;
  const v = process.argv[at + 1]?.trim();
  if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value after it.`);
  return v;
};

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY = argAfter("--only")?.toLowerCase();
const TO = argAfter("--to")?.toLowerCase();
const AUDIENCE = argAfter("--audience") ?? "all";
if (!["approved", "applicants", "all"].includes(AUDIENCE)) {
  throw new Error(`--audience must be approved, applicants or all (got ${AUDIENCE}).`);
}
if (TO && (ONLY || DRY_RUN)) throw new Error("--to is a preview send on its own; drop --only and --dry-run.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const missing = DRY_RUN ? [] : ["EMAIL_FROM", "NEXT_PUBLIC_APP_URL"].filter((k) => !process.env[k]?.trim());
if (!DRY_RUN && dbEnv === "prod" && !process.env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
if (missing.length) {
  throw new Error(
    `Refusing to send: ${missing.join(", ")} not set in the env file for --env=${dbEnv}. ` +
      "Copy the values from Vercel's Production environment (docs/RUNBOOK.md, Bonus announcement).",
  );
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function check<T>(res: { error: unknown; data?: T | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  return res.data as T;
}

interface BonusSettings {
  enabled: boolean;
  credits: number;
  minHours: number;
  usdPerCredit: number | null;
}

async function bonusSettings(): Promise<BonusSettings> {
  const rows = check(
    await admin
      .from("platform_settings")
      .select("key, value")
      .in("key", [
        "availability_bonus_enabled",
        "availability_bonus_credits",
        "availability_bonus_min_hours",
        "payout_usd_per_credit",
      ]),
    "settings lookup",
  ) as { key: string; value: unknown }[];
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const credits = Number(get("availability_bonus_credits"));
  const minHours = Number(get("availability_bonus_min_hours"));
  if (!Number.isFinite(credits) || !Number.isFinite(minHours)) {
    throw new Error("availability_bonus_credits / _min_hours missing from platform_settings; seed the settings first.");
  }
  const rate = Number(get("payout_usd_per_credit"));
  return { enabled: get("availability_bonus_enabled") === true, credits, minHours, usdPerCredit: rate > 0 ? rate : null };
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  display_name: string | null;
  timezone: string | null;
  notification_preferences: unknown;
  role: "student" | "tutor" | "admin" | null;
  is_suspended: boolean;
}

type Status = "approved" | "pending" | "changes_requested";

async function tutorsByStatus(): Promise<Array<ProfileRow & { status: Status }>> {
  const statuses: Status[] =
    AUDIENCE === "approved" ? ["approved"] : AUDIENCE === "applicants" ? ["pending", "changes_requested"] : ["approved", "pending", "changes_requested"];
  const tps = check(
    await admin.from("tutor_profiles").select("user_id, approval_status").in("approval_status", statuses),
    "tutor lookup",
  ) as { user_id: string; approval_status: Status }[];
  if (tps.length === 0) return [];
  const profiles = check(
    await admin
      .from("profiles")
      .select("id, email, full_name, display_name, timezone, notification_preferences, role, is_suspended")
      .in(
        "id",
        tps.map((r) => r.user_id),
      )
      .order("email"),
    "profiles lookup",
  ) as ProfileRow[];
  const statusOf = new Map(tps.map((r) => [r.user_id, r.approval_status]));
  return profiles.map((p) => ({ ...p, status: statusOf.get(p.id)! }));
}

const toRecipient = (r: ProfileRow): Recipient => ({
  id: r.id,
  email: r.email!,
  fullName: r.full_name,
  displayName: r.display_name,
  timezone: r.timezone,
  notificationPreferences: r.notification_preferences,
  role: r.role,
});

type Job =
  | { recipient: Recipient; type: "availability-bonus-launch"; props: EmailPropsByType["availability-bonus-launch"] }
  | {
      recipient: Recipient;
      type: "availability-bonus-launch-applicant";
      props: EmailPropsByType["availability-bonus-launch-applicant"];
    };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const s = await bonusSettings();
  if (!s.enabled) throw new Error("availability_bonus_enabled is off in platform_settings; nothing to announce.");
  const amountUsd = s.usdPerCredit ? (s.credits * s.usdPerCredit).toFixed(2) : null;
  const base = { credits: s.credits, amountUsd, minHours: s.minHours };
  const launchProps = { ...base, firstPayoutLabel: nextMondayLabel(new Date()) };

  const jobs: Job[] = [];
  const skipped: string[] = [];
  const rows = TO ? [] : await tutorsByStatus();
  for (const r of rows) {
    if (!r.email) {
      skipped.push(`${r.id} (no email)`);
      continue;
    }
    if (r.is_suspended) {
      skipped.push(`${maskEmail(r.email)} (suspended)`);
      continue;
    }
    if (ONLY && r.email.toLowerCase() !== ONLY) continue;
    const recipient = toRecipient(r);
    if (r.status === "approved") jobs.push({ recipient, type: "availability-bonus-launch", props: launchProps });
    else jobs.push({ recipient, type: "availability-bonus-launch-applicant", props: { ...base, status: r.status } });
  }
  if (ONLY && jobs.length === 0) throw new Error(`No unsuspended tutor in the --audience ${AUDIENCE} list with the email ${ONLY}.`);
  if (TO) {
    const recipient = toRecipient({
      id: "preview",
      email: TO,
      full_name: TO.split("@")[0],
      display_name: null,
      timezone: null,
      notification_preferences: {},
      role: "tutor",
      is_suspended: false,
    });
    jobs.push({ recipient, type: "availability-bonus-launch", props: launchProps });
    jobs.push({ recipient, type: "availability-bonus-launch-applicant", props: { ...base, status: "pending" } });
  }

  const approved = jobs.filter((j) => j.type === "availability-bonus-launch").length;
  console.log(
    `[bonus-announcement] env=${dbEnv} audience=${AUDIENCE} bonus=${s.credits} credits for ${s.minHours}h ` +
      `first payout ${launchProps.firstPayoutLabel}`,
  );
  console.log(
    `[bonus-announcement] to send=${jobs.length} (approved ${approved}, applicants ${jobs.length - approved}) skipped=${skipped.length}`,
  );
  for (const x of skipped) console.log(`  skip ${x}`);
  for (const j of jobs) {
    const which = j.type === "availability-bonus-launch" ? "approved" : `applicant (${j.props.status})`;
    console.log(`  ${DRY_RUN ? "would send" : "queued"} ${maskEmail(j.recipient.email)}  ${which}`);
  }
  if (DRY_RUN) {
    console.log("[bonus-announcement] dry run, nothing sent.");
    return;
  }

  const sender = senderFromEnv();
  if (!sender) throw new Error("EMAIL_FROM is not set.");
  const { transport, configured } = dbEnv === "prod" ? transportFromEnv() : { transport: logTransport, configured: false };
  if (!configured) console.log(`[bonus-announcement] env=${dbEnv}: printing envelopes through the log transport, nothing sent.`);

  let sent = 0;
  let failed = 0;
  for (const j of jobs) {
    const rendered =
      j.type === "availability-bonus-launch"
        ? await renderEmail(j.type, j.props, { recipient: j.recipient, appUrl })
        : await renderEmail(j.type, j.props, { recipient: j.recipient, appUrl });
    const result = await transport.send({
      from: sender.from,
      to: j.recipient.email,
      replyTo: sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (result.ok) {
      sent += 1;
      console.log(`  sent ${maskEmail(j.recipient.email)} id=${result.id ?? "(log)"}`);
    } else {
      failed += 1;
      console.log(`  FAILED ${maskEmail(j.recipient.email)}: ${result.error}`);
    }
    // Resend allows 2 requests a second; stay well under it.
    await sleep(700);
  }
  console.log(`[bonus-announcement] ${sent} sent, ${failed} failed, ${skipped.length} skipped.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
