/**
 * The email types NowTutors sends itself (SPEC §11). Verify-email and
 * password-reset are not here: Supabase Auth sends those, over Resend's SMTP
 * once the domain is verified (RUNBOOK, Phase 10 Part 6).
 *
 * Part 1 covers the tutor-application and withdrawal emails plus the two
 * admin alerts behind them. Booking, payment, session and reminder types
 * arrive in Parts 2 and 3 and are added to this union as they are built.
 */
export type EmailType =
  | "tutor-welcome"
  | "tutor-approved"
  | "tutor-rejected"
  | "withdrawal-requested"
  | "withdrawal-paid"
  | "withdrawal-rejected"
  | "admin-new-tutor-application"
  | "admin-new-withdrawal";

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
}

/** The message handed to a transport. Already rendered. */
export interface EmailMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string }>;
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
