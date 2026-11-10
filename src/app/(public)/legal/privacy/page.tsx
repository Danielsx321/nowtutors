import * as React from "react";
import { LegalPage, Section } from "@/components/features/legal/legal-page";

export const metadata = { title: "Privacy Policy · NowTutors" };

const PRIVACY_EMAIL = "nowtutors.pays@gmail.com";

/**
 * Privacy Policy, the business's own text (supplied 10 Nov 2026), replacing
 * the Phase 10 draft. The blanks it left (legal name, address) are left out,
 * not marked, by the business's choice. Add them here once known.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="10 November 2026" draft={false}>
      <p>
        At NowTutors, we value your privacy and are committed to protecting the personal information you share with
        us.
      </p>
      <p>
        This Privacy Policy explains how we collect, use, store, disclose, and protect your personal information when
        you visit our website, create an account, book tutoring sessions, provide tutoring services, or otherwise
        interact with our platform.
      </p>
      <p>By using NowTutors, you acknowledge that you have read and understood this Privacy Policy.</p>

      <Section title="1. Who We Are">
        <p>
          NowTutors is an online tutoring marketplace that connects students with independent tutors for live,
          one-to-one educational sessions.
        </p>
        <p>
          For the purposes of applicable data protection laws, the organization operating NowTutors is responsible
          for determining how and why personal information is processed.
        </p>
        <h3 className="font-semibold text-text">Business Details</h3>
        <ul>
          <li>
            Website: <a href="https://nowtutors.com/">https://nowtutors.com/</a>
          </li>
          <li>
            Privacy Contact: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
          </li>
        </ul>
        <p>
          In this policy, &ldquo;NowTutors&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;, and &ldquo;us&rdquo; refer to
          the business operating the platform.
        </p>
      </Section>

      <Section title="2. Information We Collect">
        <p>
          We collect information necessary to create accounts, provide tutoring services, process transactions,
          maintain platform security, and improve our services.
        </p>
        <h3 className="font-semibold text-text">A. Account Information</h3>
        <p>When you register for NowTutors, we may collect:</p>
        <ul>
          <li>Full name.</li>
          <li>Email address.</li>
          <li>Password or authentication credentials.</li>
          <li>Profile photograph.</li>
          <li>Country or general location.</li>
          <li>Preferred language.</li>
          <li>Time zone.</li>
          <li>Account type (student or tutor).</li>
          <li>Email notification preferences.</li>
        </ul>
        <h3 className="font-semibold text-text">B. Tutor Information</h3>
        <p>If you register as a tutor, we may collect additional information, including:</p>
        <ul>
          <li>Professional headline and biography.</li>
          <li>Profile photograph.</li>
          <li>Educational background.</li>
          <li>Teaching experience and qualifications.</li>
          <li>Subjects offered.</li>
          <li>Languages spoken.</li>
          <li>Hourly teaching rates.</li>
          <li>Availability and scheduling information.</li>
          <li>PayPal account or payout email address.</li>
          <li>Relevant verification information, where required.</li>
        </ul>
        <p>This information helps students discover tutors and understand the educational services they offer.</p>
        <h3 className="font-semibold text-text">C. Booking and Transaction Information</h3>
        <p>We collect information relating to your use of NowTutors, including:</p>
        <ul>
          <li>Tutoring bookings and session history.</li>
          <li>Session duration and attendance records.</li>
          <li>Credit purchases and balances.</li>
          <li>Payment transaction references.</li>
          <li>Tutor earnings and withdrawal requests.</li>
          <li>Refund and payment dispute records.</li>
        </ul>
        <p>
          We use this information to manage bookings, calculate payments, maintain account balances, and provide
          customer support.
        </p>
        <h3 className="font-semibold text-text">D. Messages and Uploaded Files</h3>
        <p>When you communicate with tutors or students through NowTutors, we may process:</p>
        <ul>
          <li>Messages exchanged through the platform.</li>
          <li>Files or documents attached to conversations.</li>
          <li>Message timestamps.</li>
          <li>Related communication records.</li>
        </ul>
        <p>
          Access to private conversations and attachments is restricted according to the platform&rsquo;s technical
          design and applicable access controls.
        </p>
        <p>We do not use private educational conversations for advertising.</p>
        <h3 className="font-semibold text-text">E. Technical and Usage Information</h3>
        <p>When you access our website, certain technical information may be collected automatically, including:</p>
        <ul>
          <li>IP address.</li>
          <li>Browser type and version.</li>
          <li>Device information.</li>
          <li>Operating system.</li>
          <li>Login and access timestamps.</li>
          <li>Platform activity.</li>
          <li>Error and diagnostic information.</li>
          <li>Security and fraud-prevention records.</li>
        </ul>
        <p>
          This information helps us maintain platform performance, identify technical issues, and protect user
          accounts.
        </p>
      </Section>

      <Section title="3. How We Use Your Information">
        <p>We use collected information for legitimate business and operational purposes, including:</p>
        <h3 className="font-semibold text-text">Account Management</h3>
        <p>To create and maintain user accounts, authenticate users, and manage account preferences.</p>
        <h3 className="font-semibold text-text">Tutor Discovery</h3>
        <p>To display tutor profiles, subjects, languages, availability, and hourly rates to prospective students.</p>
        <h3 className="font-semibold text-text">Booking Management</h3>
        <p>
          To process scheduled and instant tutoring requests, manage lesson availability, and facilitate
          communication between users.
        </p>
        <h3 className="font-semibold text-text">Payments and Earnings</h3>
        <p>
          To process credit purchases, manage payment records, calculate tutor earnings, facilitate withdrawals, and
          handle refunds.
        </p>
        <h3 className="font-semibold text-text">Customer Support</h3>
        <p>To respond to enquiries, resolve complaints, investigate reported issues, and provide assistance.</p>
        <h3 className="font-semibold text-text">Platform Security</h3>
        <p>To detect suspicious activity, prevent fraud, enforce platform policies, and protect users.</p>
        <h3 className="font-semibold text-text">Service Improvement</h3>
        <p>
          To diagnose technical problems, monitor platform performance, and improve the quality and reliability of
          our services.
        </p>
        <h3 className="font-semibold text-text">Legal Compliance</h3>
        <p>
          To comply with applicable laws, regulations, court orders, and legitimate requests from authorized
          authorities.
        </p>
      </Section>

      <Section title="4. Legal Basis for Processing">
        <p>
          Where required by applicable data protection legislation, we process personal information under one or
          more of the following legal bases:
        </p>
        <ul>
          <li>
            Contractual necessity: Processing information required to create accounts, facilitate tutoring sessions,
            and provide services requested by users.
          </li>
          <li>
            Legitimate interests: Processing information to protect the platform, prevent fraud, maintain security,
            and improve our services, provided these interests do not override applicable individual rights.
          </li>
          <li>
            Legal obligations: Processing information where required to comply with applicable laws and regulations.
          </li>
          <li>
            Consent: Processing information where we have obtained valid consent, including where consent is required
            for certain optional communications, cookies, or other processing activities.
          </li>
        </ul>
        <p>Where processing relies on consent, you may withdraw that consent subject to applicable legal requirements.</p>
      </Section>

      <Section title="5. Payment Information">
        <p>
          NowTutors uses third-party payment services, including PayPal, to facilitate credit purchases and tutor
          payouts.
        </p>
        <p>When you make a payment:</p>
        <ul>
          <li>Your payment may be processed directly by PayPal.</li>
          <li>Payment providers may collect card, bank, billing, and transaction information.</li>
          <li>
            NowTutors may receive transaction references, payment status, amounts, and other information necessary to
            manage your account.
          </li>
          <li>Your complete payment card or banking credentials are not intended to be stored directly by NowTutors.</li>
        </ul>
        <p>Payment processing is subject to the applicable payment provider&rsquo;s privacy policy and terms.</p>
      </Section>

      <Section title="6. Third-Party Services and Data Processors">
        <p>NowTutors works with selected third-party service providers to operate and maintain its platform.</p>
        <p>
          These providers may process personal information on our behalf or independently in accordance with their
          respective privacy policies.
        </p>
        <p>Our current service providers include:</p>
        <ul>
          <li>Supabase: used for database management, user authentication, and file storage.</li>
          <li>Vercel: used to host and deliver the NowTutors website.</li>
          <li>PayPal: used to process payments and facilitate tutor payouts.</li>
          <li>Agora: used to provide live video functionality for supported instant sessions and broadcasts.</li>
          <li>LessonSpace: used to facilitate scheduled online tutoring classrooms.</li>
          <li>Resend: used to deliver transactional and account-related emails.</li>
          <li>Sentry: used for technical diagnostics, error monitoring, and platform reliability.</li>
          <li>
            Google: used for authentication when users choose to register or log in using their Google accounts.
          </li>
        </ul>
        <p>
          These providers receive only the information reasonably necessary for their respective services, subject to
          applicable agreements and legal requirements.
        </p>
        <p>We encourage users to review the privacy policies of these third-party providers.</p>
      </Section>

      <Section title="7. Sharing of Personal Information">
        <p>We do not sell personal information to third parties.</p>
        <p>We may share information in the following circumstances:</p>
        <h3 className="font-semibold text-text">Between Students and Tutors</h3>
        <p>Certain information is shared between students and tutors to facilitate bookings and lessons.</p>
        <p>
          For example, tutors may receive relevant student booking information, while students can view tutor
          profiles and professional information.
        </p>
        <h3 className="font-semibold text-text">With Service Providers</h3>
        <p>
          We may share information with trusted providers that support payments, hosting, authentication, video
          sessions, file storage, and email delivery.
        </p>
        <h3 className="font-semibold text-text">Legal and Regulatory Requirements</h3>
        <p>
          We may disclose information where required by applicable law, legal proceedings, regulatory obligations, or
          valid requests from authorized authorities.
        </p>
        <h3 className="font-semibold text-text">Business Transfers</h3>
        <p>
          If NowTutors undergoes a merger, acquisition, restructuring, or business transfer, relevant information may
          be transferred as part of that transaction, subject to applicable data protection requirements.
        </p>
      </Section>

      <Section title="8. Children's Privacy and Safeguarding">
        <p>
          NowTutors recognizes the importance of protecting children and young learners who may use online
          educational services.
        </p>
        <p>
          We aim to handle children&rsquo;s personal information responsibly and in accordance with applicable child
          protection and data privacy laws.
        </p>
        <p>Where required by law:</p>
        <ul>
          <li>
            Parental or legal guardian consent must be obtained before a child uses services requiring such consent.
          </li>
          <li>
            Parents or legal guardians may request information about the personal information collected from their
            children.
          </li>
          <li>We may restrict certain platform features where necessary to protect younger users.</li>
          <li>
            Tutors must maintain appropriate professional boundaries and comply with applicable safeguarding
            requirements.
          </li>
        </ul>
        <p>
          We do not knowingly collect personal information from children in circumstances where such collection is
          prohibited or requires consent that has not been obtained.
        </p>
        <p>
          If you believe a child has provided personal information inappropriately, please contact us so that we can
          investigate and take appropriate action.
        </p>
      </Section>

      <Section title="9. Data Retention">
        <p>
          We retain personal information only for as long as reasonably necessary to fulfill the purposes described
          in this Privacy Policy, unless a longer retention period is required or permitted by law.
        </p>
        <p>Retention periods may depend on the type of information involved.</p>
        <p>For example:</p>
        <ul>
          <li>Account information may be retained while an account remains active.</li>
          <li>Booking and session records may be retained for operational and dispute-resolution purposes.</li>
          <li>
            Payment and transaction records may be retained to meet financial, accounting, and legal obligations.
          </li>
          <li>
            Technical and security logs may be retained for a limited period to investigate suspicious activity and
            maintain platform security.
          </li>
          <li>
            Customer support communications may be retained as necessary to resolve enquiries and maintain appropriate
            records.
          </li>
        </ul>
        <p>
          When information is no longer required, we will take reasonable steps to delete, anonymize, or securely
          dispose of it, subject to applicable legal obligations.
        </p>
        <p>Specific retention periods may vary depending on legal and operational requirements.</p>
      </Section>

      <Section title="10. Data Security">
        <p>
          We take reasonable technical and organizational measures to protect personal information against
          unauthorized access, disclosure, alteration, loss, and misuse.
        </p>
        <p>These measures may include:</p>
        <ul>
          <li>Secure authentication procedures.</li>
          <li>Access restrictions and permissions.</li>
          <li>Secure data transmission.</li>
          <li>Third-party infrastructure security.</li>
          <li>Monitoring for suspicious activity.</li>
          <li>Administrative access controls.</li>
          <li>Appropriate data handling procedures.</li>
        </ul>
        <p>
          However, no internet-based service or electronic storage system can be guaranteed to be completely secure.
        </p>
        <p>
          Users are responsible for protecting their account credentials and notifying us promptly of suspected
          unauthorized access.
        </p>
      </Section>

      <Section title="11. International Data Transfers">
        <p>NowTutors may use service providers and infrastructure located in different countries.</p>
        <p>
          As a result, personal information may be processed or stored outside the country in which you reside.
        </p>
        <p>
          Where international transfers are subject to data protection laws, we will take appropriate steps to ensure
          that personal information receives the level of protection required by applicable legislation.
        </p>
        <p>
          Such measures may include appropriate contractual safeguards or other legally recognized transfer
          mechanisms.
        </p>
      </Section>

      <Section title="12. Cookies and Similar Technologies">
        <p>
          NowTutors may use cookies and similar technologies to support website functionality and improve user
          experience.
        </p>
        <p>These technologies may be used to:</p>
        <ul>
          <li>Maintain login sessions.</li>
          <li>Remember user preferences.</li>
          <li>Support website security.</li>
          <li>Improve website performance.</li>
          <li>Understand technical usage patterns.</li>
        </ul>
        <p>
          Where required by law, we will request consent before placing non-essential cookies or using similar
          tracking technologies.
        </p>
        <p>
          You may manage available cookie preferences through your browser or any cookie preference tools provided on
          our website.
        </p>
        <p>Disabling certain cookies may affect the functionality of some platform features.</p>
      </Section>

      <Section title="13. Your Privacy Rights">
        <p>Depending on your country or region, you may have certain rights concerning your personal information.</p>
        <p>These may include the right to:</p>
        <ul>
          <li>Access: Request a copy of the personal information we hold about you.</li>
          <li>Correction: Request that inaccurate or incomplete information be corrected.</li>
          <li>Deletion: Request the deletion of personal information where legally applicable.</li>
          <li>Restriction: Request that we restrict certain processing activities.</li>
          <li>Objection: Object to certain types of personal information processing.</li>
          <li>
            Data Portability: Request your personal information in a commonly used electronic format where applicable.
          </li>
          <li>Withdraw Consent: Withdraw consent where processing is based on consent.</li>
          <li>Lodge a Complaint: Submit a complaint to the relevant data protection authority.</li>
        </ul>
        <p>To exercise your rights, please contact us using the details provided in the Contact Us section.</p>
        <p>We may need to verify your identity before responding to certain requests.</p>
        <p>We will respond within the timeframes required by applicable law.</p>
      </Section>

      <Section title="14. Email Communications">
        <p>NowTutors may send users transactional and service-related communications, including:</p>
        <ul>
          <li>Account registration confirmations.</li>
          <li>Booking confirmations.</li>
          <li>Session reminders.</li>
          <li>Payment receipts.</li>
          <li>Refund notifications.</li>
          <li>Account security notifications.</li>
          <li>Important platform updates.</li>
        </ul>
        <p>
          Certain notifications are necessary for the operation of the service and cannot be disabled while the
          relevant account remains active.
        </p>
        <p>Optional notifications may be managed through available account settings.</p>
        <p>We will obtain consent where required before sending promotional or marketing communications.</p>
      </Section>

      <Section title="15. Third-Party Websites and Links">
        <p>Our website may contain links to external websites and third-party services.</p>
        <p>
          NowTutors does not control the privacy practices, content, or security policies of those external websites.
        </p>
        <p>When you visit an external website, its own privacy policy and terms will apply.</p>
        <p>We recommend reviewing those policies before sharing personal information with third parties.</p>
      </Section>

      <Section title="16. Changes to This Privacy Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect changes in our business, platform
          functionality, technology, or legal obligations.
        </p>
        <p>When changes are made, we will update the revision date displayed at the beginning of this page.</p>
        <p>Where required by law, we will notify users of material changes and obtain consent where necessary.</p>
        <p>
          We encourage users to review this page periodically to remain informed about how their personal information
          is handled.
        </p>
      </Section>

      <Section title="17. Contact Us">
        <p>
          If you have questions about this Privacy Policy, wish to exercise your privacy rights, or have concerns about
          how your personal information is handled, please contact us.
        </p>
        <ul>
          <li>NowTutors Privacy Team</li>
          <li>
            Website: <a href="https://nowtutors.com/">https://nowtutors.com/</a>
          </li>
          <li>
            Email: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
          </li>
        </ul>
        <p>
          We take privacy enquiries seriously and will make reasonable efforts to address legitimate requests within
          the timeframes required by applicable law.
        </p>
        <p>Your privacy matters to us. Thank you for trusting NowTutors.</p>
      </Section>
    </LegalPage>
  );
}
