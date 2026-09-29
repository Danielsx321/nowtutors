import * as React from "react";
import { LegalPage, Section, ToConfirm } from "@/components/features/legal/legal-page";

export const metadata = { title: "Refunds and no-shows · NowTutors" };

/**
 * Refunds and no-shows (Phase 10 Part 4). The mechanics are SPEC §7.3, §7.4,
 * §7.6 and §18 item 4 as built; the policy wording is Noora's to approve.
 */
export default function RefundsPage() {
  return (
    <LegalPage title="Refunds and no-shows" updated="29 September 2026" draft>
      <p>
        <ToConfirm>a sentence in NowTutors&rsquo; own words on its refund policy</ToConfirm>
      </p>

      <Section title="If your tutor doesn't show">
        <p>
          If your tutor doesn&rsquo;t join a booked session, your credits come back. Contact us and our team
          will return them to your wallet, and you can book again straight away.
        </p>
      </Section>

      <Section title="If you don't show">
        <p>
          If you don&rsquo;t join a session your tutor turned up for, the session counts as taken. The tutor
          is paid and the credits aren&rsquo;t returned.
        </p>
      </Section>

      <Section title="Cancelling or moving a booking">
        <p>
          Bookings can&rsquo;t be cancelled or rescheduled from your account. If you need to change one,
          contact us before the start time. When our team cancels a booking, the credits it cost go back to
          your wallet in full.
        </p>
      </Section>

      <Section title="Leaving a session early">
        <p>
          A session is charged in full when it&rsquo;s booked or accepted. Leaving early, on either side,
          doesn&rsquo;t return part of the price.
        </p>
      </Section>

      <Section title="Refunds of a PayPal payment">
        <ul>
          <li>
            A refund of a payment goes back through PayPal to the account or card you paid with. The credits
            that payment added are then removed from your wallet.
          </li>
          <li>
            If a direct payment went through but the time slot had just been taken, you keep the credits and
            can book another time.
          </li>
          <li>
            <ToConfirm>when a PayPal refund is given, and whether unused credits can be refunded</ToConfirm>
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          Email <ToConfirm>support email address</ToConfirm> with your booking or payment date and we&rsquo;ll
          look into it.
        </p>
      </Section>
    </LegalPage>
  );
}
