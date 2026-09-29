/**
 * The email types NowTutors sends itself (SPEC §11). Verify-email and
 * password-reset are not here: Supabase Auth sends those, over Resend's SMTP
 * once the domain is verified (RUNBOOK, Phase 10 Part 6).
 *
 * Part 1: the tutor-application and withdrawal emails plus the two admin
 * alerts behind them. Part 2: booking, payment, cancellation, refund and
 * session-summary emails. Reminders and the message nudge arrive in Part 3.
 */
export type EmailType =
  | "tutor-welcome"
  | "tutor-approved"
  | "tutor-rejected"
  | "withdrawal-requested"
  | "withdrawal-paid"
  | "withdrawal-rejected"
  | "admin-new-tutor-application"
  | "admin-new-withdrawal"
  | "booking-confirmed"
  | "tutor-new-booking"
  | "booking-cancelled-by-tutor"
  | "tutor-booking-cancelled"
  | "refund-issued"
  | "credits-purchased"
  | "admin-capture-failed"
  | "session-summary-student"
  | "session-summary-tutor";

/** What every booking email knows about the session. Times are ISO strings. */
export interface BookingFacts {
  bookingId: string;
  subjectName: string;
  /** The other person, by the name they show on the site. */
  otherPartyName: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  priceCredits: number | null;
}

/** Props each template needs beyond the recipient, which the sender resolves. */
export interface EmailPropsByType {
  "tutor-welcome": Record<string, never>;
  "tutor-approved": Record<string, never>;
  "tutor-rejected": { note: string };
  "withdrawal-requested": {
    amountCredits: number;
    /** `numeric(10,2)` text, e.g. `"30.66"`. */
    amountUsd: string;
    /** The PayPal address the money goes to; the template masks it. */
    destination: string | null;
  };
  "withdrawal-paid": {
    amountCredits: number;
    amountUsd: string;
    destination: string;
    externalReference: string;
  };
  "withdrawal-rejected": { amountCredits: number; amountUsd: string; note: string };
  "admin-new-tutor-application": {
    tutorName: string;
    tutorEmail: string | null;
    subjectSlugs: string[];
  };
  "admin-new-withdrawal": { tutorName: string; amountCredits: number; amountUsd: string };
  "booking-confirmed": BookingFacts;
  "tutor-new-booking": BookingFacts & { studentNotes: string | null };
  "booking-cancelled-by-tutor": BookingFacts & { refundedCredits: number };
  "tutor-booking-cancelled": BookingFacts & { cancelledBy: "tutor" | "student" };
  "refund-issued":
    | { via: "credits"; credits: number; bookingSubject: string | null }
    | { via: "paypal"; amountUsd: string; currency: string };
  "credits-purchased": { credits: number; amountUsd: string; currency: string; balanceAfter: number };
  "admin-capture-failed": {
    paymentId: string;
    payerName: string;
    payerEmail: string | null;
    amountUsd: string;
    currency: string;
    purpose: "credit_purchase" | "booking";
  };
  "session-summary-student": BookingFacts & { noShow: boolean };
  "session-summary-tutor": BookingFacts & {
    noShow: boolean;
    netCredits: number;
    /** When the held earnings become withdrawable. ISO string, null if unknown. */
    availableAt: string | null;
  };
}

/** Who gets it: one user by id, or every active admin. */
export type EmailAudience = { userId: string } | { admins: true };

export interface EmailRequest<T extends EmailType = EmailType> {
  type: T;
  to: EmailAudience;
  props: EmailPropsByType[T];
}

/** What the sender knows about a person. Read from `profiles`. */
export interface Recipient {
  id: string;
  email: string;
  fullName: string | null;
  displayName: string | null;
  timezone: string | null;
  notificationPreferences: unknown;
  /** Decides where "Manage notifications" points. Null before onboarding. */
  role: "student" | "tutor" | "admin" | null;
}

/** The message handed to a transport. Already rendered. */
export interface EmailMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** `content` is base64, which is what Resend expects for a string. */
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}

export type TransportResult = { ok: true; id: string | null } | { ok: false; error: string };

/** Something that delivers a message. Resend in production, a log or a fake elsewhere. */
export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<TransportResult>;
}

export type SendOutcome =
  | { sent: true; id: string | null; to: string }
  | {
      sent: false;
      reason:
        | "no_recipient"
        | "preference_off"
        | "not_configured"
        | "render_error"
        | "transport_error";
      to?: string;
    };
