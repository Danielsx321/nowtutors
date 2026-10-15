import type { ChangeReason } from "@/lib/tutors/change-reasons";

/**
 * The email types NowTutors sends itself (SPEC §11). Verify-email and
 * password-reset are not here: Supabase Auth sends those, over Resend's SMTP
 * once the domain is verified (RUNBOOK, Phase 10 Part 6).
 *
 * Part 1: the tutor-application and withdrawal emails plus the two admin
 * alerts behind them. Part 2: booking, payment, cancellation, refund and
 * session-summary emails. Part 3: reminders and the new-message nudge.
 */
export type EmailType =
  | "tutor-welcome"
  | "tutor-approved"
  | "tutor-rejected"
  | "tutor-changes-requested"
  | "tutor-back-live"
  | "tutor-guide"
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
  | "session-summary-tutor"
  | "reminder-24h"
  | "reminder-1h-student"
  | "reminder-1h-tutor"
  | "new-message"
  | "availability-bonus-paid"
  | "availability-bonus-launch"
  | "availability-bonus-launch-applicant";

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
  /** On hold with a reason (tutor-request-changes): what to fix, then save. */
  "tutor-changes-requested": { reasons: ChangeReason[]; note: string | null };
  /** Approved again after a hold. No guide attached; they have it. */
  "tutor-back-live": Record<string, never>;
  /** The one-off guide send (`db/send-tutor-guide.ts`) for tutors approved before the guide existed. */
  "tutor-guide": Record<string, never>;
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
  "reminder-24h": BookingFacts;
  "reminder-1h-student": BookingFacts;
  "reminder-1h-tutor": BookingFacts;
  /** The weekly availability bonus landed in the wallet (availability-bonus, 2026-10-14). */
  "availability-bonus-paid": {
    credits: number;
    /** `numeric(10,2)` text at the payout rate, or null when no rate is set. */
    amountUsd: string | null;
    /** "6 to 12 Oct", the UTC week that was paid. */
    weekLabel: string;
    /** "6h 10m", what they were live for. */
    hoursLabel: string;
  };
  /**
   * The one-off announcement of the weekly bonus (`db/send-bonus-announcement.ts`,
   * 2026-10-15). Amounts come from platform_settings at send time.
   */
  "availability-bonus-launch": {
    credits: number;
    /** `numeric(10,2)` text at the payout rate, or null when no rate is set. */
    amountUsd: string | null;
    minHours: number;
    /** "Monday 19 October", the first Monday the cron pays. */
    firstPayoutLabel: string;
  };
  /** The same announcement for applicants not approved yet; the copy depends on where they stand. */
  "availability-bonus-launch-applicant": {
    credits: number;
    amountUsd: string | null;
    minHours: number;
    status: "pending" | "changes_requested";
  };
  "new-message": {
    senderName: string;
    /** The first 140 characters, or null for an attachment-only message. */
    preview: string | null;
    hasAttachment: boolean;
    /** Where the recipient reads it: their own messages route. */
    threadPath: string;
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
  /**
   * `content` is base64, which is what Resend expects for a string. `path` is
   * a URL Resend fetches itself, used for the static tutor guide PDF so the
   * bytes never ride through the app. One of the two is set.
   */
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content?: string;
  path?: string;
  contentType?: string;
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
