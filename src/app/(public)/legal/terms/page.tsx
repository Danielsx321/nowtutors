import * as React from "react";
import Link from "next/link";
import { LegalPage, Section } from "@/components/features/legal/legal-page";

export const metadata = { title: "Terms and Conditions · NowTutors" };

const SUPPORT_EMAIL = "nowtutors.pays@gmail.com";

/**
 * Terms and Conditions, the business's own text (supplied 10 Nov 2026),
 * replacing the Phase 10 draft. The blanks it left (legal name, address,
 * governing-law jurisdiction) are left out, not marked, by the business's
 * choice: nothing on the page reads as a draft. Add them here once known.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms and Conditions" updated="10 November 2026" draft={false}>
      <p>
        Welcome to NowTutors. These Terms and Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the
        NowTutors website, platform, and related services.
      </p>
      <p>
        NowTutors is an online tutoring marketplace that connects students seeking educational support with
        independent tutors offering one-to-one online lessons.
      </p>
      <p>
        By accessing or using NowTutors, creating an account, booking a lesson, purchasing credits, or registering
        as a tutor, you agree to these Terms. If you do not agree, you must not use the platform.
      </p>

      <Section title="1. About NowTutors">
        <p>
          NowTutors (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;us&rdquo;, or &ldquo;the Platform&rdquo;) operates
          an online marketplace designed to make private tutoring accessible, flexible, and convenient.
        </p>
        <p>Our services allow users to:</p>
        <ul>
          <li>Discover tutors based on subjects, availability, language, and hourly rates.</li>
          <li>Book scheduled tutoring sessions.</li>
          <li>Request immediate sessions with tutors who are currently available.</li>
          <li>Communicate with tutors through the platform.</li>
          <li>Purchase and use platform credits to pay for lessons.</li>
          <li>Register as a tutor and offer educational services to students.</li>
        </ul>
        <h3 className="font-semibold text-text">Business Information</h3>
        <p>NowTutors is operated by:</p>
        <ul>
          <li>
            Contact Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </li>
          <li>
            Website: <a href="https://nowtutors.com/">https://nowtutors.com/</a>
          </li>
        </ul>
      </Section>

      <Section title="2. Eligibility and Account Registration">
        <p>To use NowTutors, you must provide accurate and complete information when creating an account.</p>
        <p>By registering, you agree that:</p>
        <ul>
          <li>The information you provide is truthful, accurate, and up to date.</li>
          <li>You will maintain the confidentiality of your login credentials.</li>
          <li>You will not share your account with unauthorized individuals.</li>
          <li>You will notify us promptly if you suspect unauthorized access.</li>
          <li>You will not create an account using another person&rsquo;s identity or information.</li>
        </ul>
        <h3 className="font-semibold text-text">Age Requirements</h3>
        <p>
          Users must meet the minimum age requirements applicable to their location and the services they wish to
          access.
        </p>
        <p>
          Where required by applicable law, users under the age of 18 must have permission and appropriate
          supervision from a parent or legal guardian.
        </p>
        <p>
          Tutors providing services to minors must comply with all applicable child protection, safeguarding, and
          professional conduct requirements.
        </p>
        <p>
          We reserve the right to request age or identity verification where reasonably necessary to protect users
          and maintain platform safety.
        </p>
      </Section>

      <Section title="3. User Accounts">
        <p>NowTutors provides separate account experiences for students and tutors.</p>
        <p>When creating an account, you must select the appropriate account type.</p>
        <p>You are responsible for all activities conducted through your account.</p>
        <p>We reserve the right to restrict, suspend, or terminate accounts that:</p>
        <ul>
          <li>Provide false or misleading information.</li>
          <li>Violate these Terms.</li>
          <li>Engage in fraudulent or suspicious activities.</li>
          <li>Harass, threaten, or abuse other users.</li>
          <li>Attempt to manipulate payments, credits, bookings, or tutor earnings.</li>
          <li>Compromise the safety, integrity, or operation of the platform.</li>
        </ul>
        <p>
          Account restrictions may be applied where reasonably necessary to protect users or comply with legal
          obligations.
        </p>
      </Section>

      <Section title="4. Tutor Services and Responsibilities">
        <p>
          Tutors using NowTutors operate as independent service providers and are not employees, agents, or
          representatives of NowTutors.
        </p>
        <p>Tutors are responsible for:</p>
        <ul>
          <li>Providing accurate professional and educational information.</li>
          <li>Maintaining an appropriate and professional tutor profile.</li>
          <li>Offering lessons only in subjects they are qualified to teach.</li>
          <li>Setting their availability and hourly rates.</li>
          <li>Attending accepted and confirmed tutoring sessions.</li>
          <li>Delivering lessons professionally and respectfully.</li>
          <li>Protecting students&rsquo; personal information.</li>
          <li>Complying with applicable laws and safeguarding requirements.</li>
        </ul>
        <p>All tutor profiles are subject to review before being made publicly available.</p>
        <p>
          Profile approval does not constitute a guarantee of a tutor&rsquo;s qualifications, identity, professional
          standing, or teaching outcomes.
        </p>
        <p>
          Tutors must not use the platform to misrepresent their qualifications or offer services that violate
          applicable laws.
        </p>
      </Section>

      <Section title="5. Student Responsibilities">
        <p>Students using NowTutors agree to:</p>
        <ul>
          <li>Provide accurate booking and account information.</li>
          <li>Treat tutors and other users respectfully.</li>
          <li>Attend booked sessions on time.</li>
          <li>Provide relevant learning information where necessary.</li>
          <li>Use the platform for legitimate educational purposes.</li>
          <li>Avoid abusive, threatening, discriminatory, or inappropriate conduct.</li>
          <li>Respect tutors&rsquo; intellectual property and personal information.</li>
        </ul>
        <p>
          Students must not use NowTutors to request academic dishonesty, impersonation, fraudulent academic work,
          or other activities that violate applicable academic integrity policies.
        </p>
      </Section>

      <Section title="6. Booking and Tutoring Sessions">
        <p>NowTutors supports scheduled and instant tutoring sessions.</p>
        <h3 className="font-semibold text-text">Scheduled Sessions</h3>
        <p>
          Students may book available tutors for future sessions, subject to the availability displayed on the
          platform.
        </p>
        <p>
          Scheduled sessions may be booked between two hours and seven days in advance, where the booking system
          permits.
        </p>
        <p>Available session durations may include 30, 60, 90, and 120 minutes.</p>
        <h3 className="font-semibold text-text">Instant Sessions</h3>
        <p>Students may request an immediate session with a tutor displaying an available or live status.</p>
        <p>An instant booking is confirmed when the tutor accepts the request.</p>
        <h3 className="font-semibold text-text">Session Completion</h3>
        <p>
          A session is considered completed when its scheduled duration has elapsed, subject to the platform&rsquo;s
          applicable session and attendance records.
        </p>
        <p>Leaving a session early does not automatically entitle either party to a partial credit refund.</p>
        <p>Users should contact support if a technical issue or exceptional circumstance affects a session.</p>
      </Section>

      <Section title="7. Credits, Pricing, and Payments">
        <p>NowTutors uses a credit-based payment system for tutoring sessions.</p>
        <h3 className="font-semibold text-text">Purchasing Credits</h3>
        <p>Students may purchase credits through supported payment methods, including PayPal, where available.</p>
        <p>The applicable credit package, price, and payment terms will be displayed before purchase.</p>
        <h3 className="font-semibold text-text">Paying for Lessons</h3>
        <p>Each tutor establishes an hourly rate in credits.</p>
        <p>
          The cost of a session is calculated using the tutor&rsquo;s hourly rate and the booked session duration.
          The amount is rounded up to the nearest whole credit.
        </p>
        <p>
          Credits are deducted when a scheduled booking is completed through the applicable booking process or when
          an instant tutoring request is accepted.
        </p>
        <h3 className="font-semibold text-text">Credit Restrictions</h3>
        <p>Unless otherwise required by applicable law:</p>
        <ul>
          <li>Credits are intended for use within NowTutors.</li>
          <li>Credits cannot be transferred between user accounts.</li>
          <li>Credits cannot be exchanged directly for cash.</li>
          <li>Credits may only be used for eligible services offered through the platform.</li>
        </ul>
        <p>Any applicable credit expiration rules will be disclosed before purchase.</p>
        <h3 className="font-semibold text-text">Payment Processing</h3>
        <p>Payments are processed by third-party payment providers.</p>
        <p>
          NowTutors does not directly store complete payment card or banking credentials. Payment providers handle
          sensitive payment information in accordance with their own privacy and security policies.
        </p>
      </Section>

      <Section title="8. Tutor Earnings and Platform Fees">
        <p>Tutors receive earnings for eligible completed tutoring sessions.</p>
        <p>NowTutors currently retains a platform service fee of 25% of the applicable session amount.</p>
        <p>
          The remaining 75% is allocated to the tutor, subject to applicable payment adjustments and platform rules.
        </p>
        <h3 className="font-semibold text-text">Earnings Availability</h3>
        <p>
          Tutor earnings are held for a period of 48 hours following the completion of a session before becoming
          available for withdrawal, subject to applicable reviews or payment adjustments.
        </p>
        <h3 className="font-semibold text-text">Withdrawals</h3>
        <ul>
          <li>Tutor withdrawals are processed through the supported PayPal payout system.</li>
          <li>The minimum withdrawal balance is currently $30.</li>
          <li>Withdrawals are subject to account verification and administrative review.</li>
          <li>Applicable currency conversion rates and payout charges may affect the final amount received.</li>
        </ul>
        <p>
          NowTutors may delay or reject a withdrawal where there is reasonable evidence of fraud, a payment dispute,
          a policy violation, or a legal restriction.
        </p>
      </Section>

      <Section title="9. Cancellations, Refunds, and No-Shows">
        <p>
          Refunds and attendance-related matters are governed by our separate{" "}
          <Link href="/legal/refunds">Refunds and No-Shows Policy</Link>.
        </p>
        <p>The following general rules apply:</p>
        <ul>
          <li>If a tutor fails to attend a confirmed booking, the student may qualify for a full credit restoration.</li>
          <li>
            If a student fails to attend a session that the tutor attended, the session may be treated as completed.
          </li>
          <li>
            If a booking is cancelled by NowTutors, the applicable credits will generally be returned to the
            student&rsquo;s account.
          </li>
          <li>Leaving a session early does not automatically qualify for a partial refund.</li>
          <li>Refunds of eligible PayPal payments will generally be processed through the original payment method.</li>
        </ul>
        <p>
          For complete details, please review our <Link href="/legal/refunds">Refunds and No-Shows Policy</Link>.
        </p>
      </Section>

      <Section title="10. Messaging and Communication">
        <p>
          NowTutors may provide messaging and file-sharing features to support communication between students and
          tutors.
        </p>
        <p>Users agree not to:</p>
        <ul>
          <li>Send spam, unsolicited advertising, or fraudulent messages.</li>
          <li>Share harmful, illegal, or inappropriate content.</li>
          <li>Harass, intimidate, or threaten other users.</li>
          <li>Request or disclose another person&rsquo;s confidential information without permission.</li>
          <li>Use communication features to facilitate scams or other unlawful activities.</li>
        </ul>
        <p>Users must exercise caution when sharing personal information or files through the platform.</p>
      </Section>

      <Section title="11. Live Lessons and Technical Requirements">
        <p>NowTutors provides browser-based tutoring experiences through supported third-party technologies.</p>
        <p>Users are responsible for having:</p>
        <ul>
          <li>A compatible device and browser.</li>
          <li>A stable internet connection.</li>
          <li>A functioning microphone and camera where required.</li>
          <li>An appropriate learning environment.</li>
        </ul>
        <p>
          We do not guarantee uninterrupted availability of live sessions or third-party communication services.
        </p>
        <p>Technical interruptions should be reported to our support team for review.</p>
      </Section>

      <Section title="12. Intellectual Property">
        <p>
          All original content, branding, logos, website designs, software, platform features, and materials owned
          by NowTutors remain the intellectual property of NowTutors or its respective licensors.
        </p>
        <p>
          Users retain ownership of content they independently create and upload, subject to applicable third-party
          rights.
        </p>
        <p>
          By uploading content to NowTutors, you grant us a limited, non-exclusive license to host, display, store,
          and process that content solely as necessary to operate and provide the platform.
        </p>
        <p>
          You must not copy, distribute, reproduce, modify, or commercially exploit NowTutors&rsquo; intellectual
          property without prior written permission.
        </p>
      </Section>

      <Section title="13. Prohibited Activities">
        <p>Users must not:</p>
        <ul>
          <li>Use the platform for illegal or fraudulent activities.</li>
          <li>Attempt to access another user&rsquo;s account.</li>
          <li>Interfere with the platform&rsquo;s security or functionality.</li>
          <li>Upload malicious software or harmful files.</li>
          <li>Misrepresent their identity, qualifications, or professional experience.</li>
          <li>Manipulate reviews, ratings, bookings, or payment records.</li>
          <li>Harass, discriminate against, or abuse other users.</li>
          <li>Circumvent platform security or payment procedures.</li>
          <li>Use automated systems to extract platform data without authorization.</li>
          <li>Engage in conduct that compromises the safety of students or tutors.</li>
        </ul>
        <p>We may investigate suspected violations and take appropriate action.</p>
      </Section>

      <Section title="14. User Safety and Safeguarding">
        <p>NowTutors expects all users to maintain a respectful and safe learning environment.</p>
        <p>
          Tutors must maintain appropriate professional boundaries and must not engage in exploitation, harassment,
          intimidation, or inappropriate conduct toward students.
        </p>
        <p>Users may report concerning behaviour to NowTutors through the designated support channels.</p>
        <p>
          We reserve the right to investigate reports and take appropriate protective action, including account
          suspension or termination and referral to relevant authorities where legally required or appropriate.
        </p>
      </Section>

      <Section title="15. Account Suspension and Termination">
        <p>You may stop using NowTutors and request account closure by contacting our support team.</p>
        <p>We may suspend, restrict, or terminate an account where:</p>
        <ul>
          <li>These Terms have been violated.</li>
          <li>Fraudulent or suspicious activity is identified.</li>
          <li>A user poses a safety risk to another person.</li>
          <li>We are legally required to do so.</li>
          <li>Continued access creates a material risk to the platform or its users.</li>
        </ul>
        <p>Termination does not automatically eliminate outstanding financial obligations or legal responsibilities.</p>
        <p>
          Any remaining credits or earnings will be handled in accordance with applicable laws and our refund and
          payment policies.
        </p>
      </Section>

      <Section title="16. Third-Party Services">
        <p>
          NowTutors may integrate with third-party services to provide website hosting, authentication, payments,
          communications, video sessions, and other platform functionality.
        </p>
        <p>
          These services may include PayPal, Supabase, Vercel, Agora, LessonSpace, Resend, Sentry, and Google
          authentication.
        </p>
        <p>Your use of third-party services may be subject to their respective terms and privacy policies.</p>
        <p>NowTutors is not responsible for independent third-party services outside its reasonable control.</p>
      </Section>

      <Section title="17. Disclaimers">
        <p>NowTutors operates as an online marketplace connecting students with independent tutors.</p>
        <p>We facilitate access to tutoring services but do not directly provide or control every lesson.</p>
        <p>We do not guarantee:</p>
        <ul>
          <li>Specific academic results or examination scores.</li>
          <li>Admission into educational institutions.</li>
          <li>Employment or professional outcomes.</li>
          <li>The accuracy or completeness of every tutor profile.</li>
          <li>Uninterrupted or error-free platform availability.</li>
        </ul>
        <p>
          Users are responsible for evaluating whether a tutor&rsquo;s experience and services meet their educational
          needs.
        </p>
      </Section>

      <Section title="18. Limitation of Liability">
        <p>
          To the maximum extent permitted by applicable law, NowTutors shall not be liable for indirect, incidental,
          special, consequential, or punitive damages arising from the use of the platform.
        </p>
        <p>This includes loss of profits, data, business opportunities, or anticipated academic outcomes.</p>
        <p>
          Nothing in these Terms excludes or limits liability where such exclusion or limitation is prohibited by
          applicable law, including liability for fraud, intentional misconduct, or other non-excludable legal
          obligations.
        </p>
      </Section>

      <Section title="19. Indemnification">
        <p>
          To the extent permitted by law, you agree to indemnify and hold harmless NowTutors, its operators,
          affiliates, and representatives against claims, losses, liabilities, and reasonable expenses arising from:
        </p>
        <ul>
          <li>Your violation of these Terms.</li>
          <li>Your unlawful use of the platform.</li>
          <li>Your infringement of another person&rsquo;s rights.</li>
          <li>Your misuse of platform services or content.</li>
        </ul>
        <p>
          This provision does not apply to the extent a claim arises from our own unlawful conduct or
          non-excludable legal responsibilities.
        </p>
      </Section>

      <Section title="20. Changes to These Terms">
        <p>
          We may update these Terms from time to time to reflect changes in our services, business operations,
          technology, or legal requirements.
        </p>
        <p>The latest version will be published on this page with an updated revision date.</p>
        <p>Where required by law, we will provide notice of material changes before they take effect.</p>
        <p>
          Continued use of NowTutors after the effective date of updated Terms constitutes acceptance where legally
          permissible.
        </p>
      </Section>

      <Section title="21. Governing Law and Disputes">
        <p>
          These Terms shall be governed by applicable law, without prejudice to mandatory consumer protection rights
          that apply in the user&rsquo;s location.
        </p>
        <p>
          Any disputes arising from the use of NowTutors shall be handled through the courts or dispute resolution
          procedures with appropriate jurisdiction, subject to applicable law.
        </p>
      </Section>

      <Section title="22. Contact Us">
        <p>If you have questions, concerns, or complaints regarding these Terms, please contact us:</p>
        <ul>
          <li>NowTutors Support</li>
          <li>
            Website: <a href="https://nowtutors.com/">https://nowtutors.com/</a>
          </li>
          <li>
            Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </li>
        </ul>
        <p>We aim to respond to legitimate enquiries within a reasonable timeframe.</p>
        <p>Thank you for choosing NowTutors.</p>
      </Section>
    </LegalPage>
  );
}
