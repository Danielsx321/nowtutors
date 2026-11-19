import * as React from "react";
import Link from "next/link";
import { LegalPage, Section } from "@/components/features/legal/legal-page";

const SUPPORT_EMAIL = "nowtutors.pays@gmail.com";

export const metadata = { title: "Refunds and no-shows · NowTutors" };

/**
 * Refunds and no-shows (Phase 10 Part 4). The mechanics are SPEC §7.3, §7.4,
 * §7.6 and §18 item 4 as built. The three blanks it carried (opening line,
 * when a PayPal refund is given, support email) are filled from the final
 * Terms (PR 172, section 7 "Credit Restrictions" and section 9) and the
 * support email the Terms and Privacy pages already use, so this page says
 * nothing the Terms don't (audit fix, 18 Nov 2026).
 */
export default function RefundsPage() {
  return (
    <LegalPage title="Refunds and no-shows" updated="18 November 2026" draft={false}>
      <p>
        You pay for lessons in credits, and we want every credit to buy a lesson that happened. This page
        explains when credits come back, when they don&rsquo;t, and how a PayPal payment is refunded. It
        sits alongside section 9 of our <Link href="/legal/terms">Terms and Conditions</Link>.
      </p>

      <Section id="no-show" title="If your tutor doesn't show">
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
            Refunds of eligible PayPal payments are processed through the original payment method. Credits
            can&rsquo;t be exchanged directly for cash, so credits already in your wallet aren&rsquo;t paid
            out on their own. If you think a payment should be refunded, contact us and we&rsquo;ll review it.
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your booking or payment date and
          we&rsquo;ll look into it.
        </p>
      </Section>
    </LegalPage>
  );
}
