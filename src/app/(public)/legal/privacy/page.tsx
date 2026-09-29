import * as React from "react";
import { LegalPage, Section, ToConfirm } from "@/components/features/legal/legal-page";

export const metadata = { title: "Privacy policy · NowTutors" };

/**
 * Privacy policy (Phase 10 Part 4). Lists what the code actually stores and
 * which services process it (SPEC §2, §4). Business and legal facts are
 * <ToConfirm> until Noora approves the text (RUNBOOK, Part 6).
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="29 September 2026" draft>
      <p>
        This explains what NowTutors keeps about you, why, and who else handles it.{" "}
        <ToConfirm>legal name and address of the business responsible for your data</ToConfirm>
      </p>

      <Section title="What we keep">
        <ul>
          <li>Your account: email address, name, profile photo, country, timezone and email preferences.</li>
          <li>
            If you teach: your headline, about text, subjects, languages, education, hourly rate and the
            PayPal address your earnings are paid to.
          </li>
          <li>Your bookings, sessions, credits, purchases, earnings and withdrawals.</li>
          <li>
            Your messages and the files you attach to them. Files are private and only the two people in the
            conversation can open them. Our admins can&rsquo;t read messages.
          </li>
          <li>When you were last active, so students can see which tutors are live.</li>
          <li>
            For payments, the PayPal order and capture references and the amount. Your card or bank details
            go to PayPal and never reach us.
          </li>
        </ul>
      </Section>

      <Section title="Why">
        <p>
          To run your account, match students with tutors, hold sessions, take payments, pay tutors, send
          the emails you&rsquo;ve asked for, and keep the service safe and working.
        </p>
      </Section>

      <Section title="Who else handles it">
        <ul>
          <li>Supabase: our database, sign-in and file storage <ToConfirm>data region</ToConfirm>.</li>
          <li>Vercel: hosts the website.</li>
          <li>PayPal: takes payments and pays tutors.</li>
          <li>Agora: the live video for instant sessions and broadcasts.</li>
          <li>LessonSpace: the classroom for scheduled sessions.</li>
          <li>Resend: sends our emails.</li>
          <li>Sentry: error reports, so we can fix what breaks.</li>
          <li>Google: only if you choose to sign in with Google.</li>
        </ul>
        <p>
          <ToConfirm>whether live sessions or classroom sessions can be recorded, and who can see a recording</ToConfirm>
        </p>
      </Section>

      <Section title="Emails">
        <p>
          Receipts, refunds, cancellations and account decisions are always sent. Booking confirmations,
          reminders and message alerts can be turned off in your settings. We don&rsquo;t send marketing
          email.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          <ToConfirm>how long account, message and payment records are kept after an account closes</ToConfirm>{" "}
          Payment and credit records are never edited once written, so they may be kept after an account
          closes where the law requires it.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can change your name, timezone and email preferences in your settings at any time. To get a
          copy of your data, correct it or close your account, contact{" "}
          <ToConfirm>support or privacy email address</ToConfirm>.
        </p>
      </Section>
    </LegalPage>
  );
}
