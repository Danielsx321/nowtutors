import { loadDbEnv, assertTestProjectRef } from "./load-env";
const dbEnv = loadDbEnv();

import { createClient } from "@supabase/supabase-js";
import { sessionPoolerUrl } from "./session-url";
import { renderEmail } from "../../emails/render";
import { appUrl } from "../lib/email/app-url";
import { logTransport, senderFromEnv, transportFromEnv } from "../lib/email/client";
import { maskEmail } from "../lib/withdrawals/mask-email";
import type { Recipient } from "../lib/email/types";

// Sends the `tutor-guide` email (emails/templates.tsx), with the guide PDF
// attached by URL, to every approved tutor. Made for the tutors approved before
// the guide existed (four on 2026-10-11); reusable whenever the guide changes
// enough to be worth re-sending.
//
// Flags:
//   --dry-run        list who would get it (emails masked) and send nothing
//   --only <email>   send to that one approved tutor, nobody else
//
// Run via the pnpm scripts, never directly:
//   pnpm email:tutor-guide -- --dry-run                 dev project, log transport
//   pnpm email:tutor-guide:test -- --dry-run            test project
//   CONFIRM_PROD=1 pnpm email:tutor-guide:prod -- --dry-run
//   CONFIRM_PROD=1 pnpm email:tutor-guide:prod          the real send
//
// load-env refuses prod without CONFIRM_PROD=1 or with a dev/test ref. With no
// Dev and test always print each envelope through the log transport instead
// of sending (the dev project still holds real sign-ups from before the
// cutover), which is the local proof; on prod a missing RESEND_API_KEY stops
// the run before any send. It never goes through lib/email/index.ts: that module is server-only
// and uses Next's `after()`, neither of which exists here.

if (dbEnv === "test") assertTestProjectRef(sessionPoolerUrl());

const DRY_RUN = process.argv.includes("--dry-run");
const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt >= 0 ? process.argv[onlyAt + 1]?.trim().toLowerCase() : undefined;
if (onlyAt >= 0 && !ONLY) throw new Error("--only needs an email address after it.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

// A dry run only reads the database. The email values are checked before a
// real send, so the list can be looked at before the env file is complete.
const missing = DRY_RUN ? [] : ["EMAIL_FROM", "NEXT_PUBLIC_APP_URL"].filter((k) => !process.env[k]?.trim());
if (!DRY_RUN && dbEnv === "prod" && !process.env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
if (missing.length) {
  throw new Error(
    `Refusing to send: ${missing.join(", ")} not set in the env file for --env=${dbEnv}. ` +
      "Copy the values from Vercel's Production environment (docs/RUNBOOK.md, Tutor guide).",
  );
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function check<T>(res: { error: unknown; data?: T | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  return res.data as T;
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

async function approvedTutors(): Promise<ProfileRow[]> {
  const ids = check(
    await admin.from("tutor_profiles").select("user_id").eq("approval_status", "approved"),
    "approved tutors lookup",
  ) as { user_id: string }[];
  if (ids.length === 0) return [];
  return check(
    await admin
      .from("profiles")
      .select("id, email, full_name, display_name, timezone, notification_preferences, role, is_suspended")
      .in(
        "id",
        ids.map((r) => r.user_id),
      )
      .order("email"),
    "profiles lookup",
  ) as ProfileRow[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = await approvedTutors();
  const skipped: string[] = [];
  const targets: Recipient[] = [];
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
    targets.push({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      displayName: r.display_name,
      timezone: r.timezone,
      notificationPreferences: r.notification_preferences,
      role: r.role,
    });
  }
  if (ONLY && targets.length === 0) throw new Error(`No approved, unsuspended tutor with the email ${ONLY}.`);

  console.log(`[tutor-guide] env=${dbEnv} approved=${rows.length} to send=${targets.length} skipped=${skipped.length}`);
  for (const s of skipped) console.log(`  skip ${s}`);
  for (const t of targets) console.log(`  ${DRY_RUN ? "would send" : "queued"} ${maskEmail(t.email)}`);
  if (DRY_RUN) {
    console.log("[tutor-guide] dry run, nothing sent.");
    return;
  }

  const sender = senderFromEnv();
  if (!sender) throw new Error("EMAIL_FROM is not set.");
  // Only production ever reaches Resend. The dev project still holds real
  // people who signed up before the 2026-10-07 cutover, so a dev or test run
  // prints envelopes through the log transport whatever the env file says.
  const { transport, configured } = dbEnv === "prod" ? transportFromEnv() : { transport: logTransport, configured: false };
  if (!configured) console.log(`[tutor-guide] env=${dbEnv}: printing envelopes through the log transport, nothing sent.`);

  let sent = 0;
  let failed = 0;
  for (const recipient of targets) {
    const rendered = await renderEmail("tutor-guide", {}, { recipient, appUrl });
    const result = await transport.send({
      from: sender.from,
      to: recipient.email,
      replyTo: sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: rendered.attachments,
    });
    if (result.ok) {
      sent += 1;
      console.log(`  sent ${maskEmail(recipient.email)} id=${result.id ?? "(log)"}`);
    } else {
      failed += 1;
      console.log(`  FAILED ${maskEmail(recipient.email)}: ${result.error}`);
    }
    // Resend allows 2 requests a second; stay well under it.
    await sleep(700);
  }
  console.log(`[tutor-guide] ${sent} sent, ${failed} failed, ${skipped.length} skipped.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
