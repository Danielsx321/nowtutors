import * as React from "react";
import Link from "next/link";
import { LegalPage, Section, ToConfirm } from "@/components/features/legal/legal-page";

export const metadata = { title: "Terms of service · NowTutors" };

/**
 * Terms of service (Phase 10 Part 4). Drafted from what the product does
 * (SPEC §7, §18); every business fact the spec doesn't hold is a <ToConfirm>.
 * The draft note comes off when Noora approves the text (RUNBOOK, Part 6).
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="29 September 2026" draft>
      <p>
        These terms cover your use of NowTutors, a website where students book live one-to-one lessons
        with independent tutors. NowTutors is run by <ToConfirm>legal name of the business</ToConfirm>,{" "}
        <ToConfirm>registered address</ToConfirm> (&ldquo;we&rdquo;). By creating an account you agree to
        them.
      </p>

      <Section title="Your account">
        <ul>
          <li>You sign up with an email and password or with Google, and you keep your sign-in details to yourself.</li>
          <li>You choose to join as a student or as a tutor. That choice can&rsquo;t be changed later.</li>
          <li>
            You must be at least <ToConfirm>minimum age, and whether under-18s need a parent&rsquo;s consent</ToConfirm>{" "}
            to use NowTutors.
          </li>
          <li>
            We can suspend an account that breaks these terms. A suspended account can&rsquo;t book, teach or
            send messages.
          </li>
        </ul>
      </Section>

      <Section title="Tutors">
        <ul>
          <li>
            Tutors are independent. They aren&rsquo;t employed by NowTutors and they decide what they teach,
            when they&rsquo;re available and their hourly rate in credits.
          </li>
          <li>
            Every tutor profile is reviewed by our team before students can see it, and a profile photo is
            required.
          </li>
          <li>
            NowTutors keeps a platform fee from each paid session, currently 25%. The tutor&rsquo;s share is
            held for 48 hours after the session ends, then becomes available to withdraw.
          </li>
          <li>
            Withdrawals are paid to the tutor&rsquo;s PayPal address, at the payout rate we set, once the
            balance is at least $30. Each request is checked by our team before it&rsquo;s paid.
          </li>
          <li>A tutor who doesn&rsquo;t join a booked session isn&rsquo;t paid for it.</li>
        </ul>
      </Section>

      <Section title="Credits and payment">
        <ul>
          <li>
            Sessions are paid for in credits. You buy credits in packages through PayPal, or pay for a single
            scheduled session through PayPal at checkout. We never see your card details.
          </li>
          <li>
            A session costs the tutor&rsquo;s hourly rate multiplied by its length, rounded up to a whole
            credit, and is charged in full when you book or when a tutor accepts your instant request.
          </li>
          <li>
            Credits are for sessions on NowTutors only. They can&rsquo;t be exchanged for cash or moved to
            another account. <ToConfirm>whether unused credits expire, and after how long</ToConfirm>
          </li>
          <li>
            Refunds and no-shows are covered on the{" "}
            <Link href="/legal/refunds">refunds page</Link>.
          </li>
        </ul>
      </Section>

      <Section title="Sessions">
        <ul>
          <li>
            Scheduled sessions are booked at least two hours ahead and up to seven days ahead, for 30, 60, 90
            or 120 minutes. Instant sessions start as soon as a live tutor accepts.
          </li>
          <li>
            A session ends when its booked time runs out. Leaving early, on either side, doesn&rsquo;t change
            the price.
          </li>
          <li>
            Bookings can&rsquo;t be cancelled or moved from your account. If something goes wrong, contact us
            and our team will sort it out.
          </li>
        </ul>
      </Section>

      <Section title="How to behave">
        <ul>
          <li>Be respectful to the people you meet here, in sessions, messages and broadcasts.</li>
          <li>Don&rsquo;t share anyone&rsquo;s personal details without their permission.</li>
          <li>Don&rsquo;t upload anything you don&rsquo;t have the right to share.</li>
          <li>
            <ToConfirm>whether arranging lessons or payment outside NowTutors is allowed</ToConfirm>
          </li>
        </ul>
      </Section>

      <Section title="Our responsibility">
        <p>
          We run the platform and handle payments. Tutors are responsible for the lessons they give. We work
          to keep NowTutors available, but can&rsquo;t promise it will never be interrupted.{" "}
          <ToConfirm>limitation of liability wording and governing law</ToConfirm>
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          When these terms change, the date at the top of this page changes with them.{" "}
          <ToConfirm>whether members are told by email before a change applies</ToConfirm> Questions go to{" "}
          <ToConfirm>support email address</ToConfirm>.
        </p>
      </Section>
    </LegalPage>
  );
}
