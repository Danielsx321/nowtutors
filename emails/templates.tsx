import * as React from "react";
import { Facts, P, Quote, Shell } from "./shell";
import type { BookingFacts, EmailPropsByType, EmailType } from "@/lib/email/types";
import { absoluteWhen, creditsLine, slugToWords, usdLine } from "@/lib/email/format";
import { bookingIcs } from "@/lib/email/ics";
import { maskEmail } from "@/lib/withdrawals/mask-email";

/**
 * Every template NowTutors sends (SPEC §11), one entry per `EmailType`. Each
 * has a subject and a body; both get the props the hook supplied plus the
 * context the renderer resolved from the recipient's row. Copy follows
 * `reference/writing-style.md`: short, plain, one action, no em dashes.
 *
 * The kitchen sink's Email section renders each `body` with `SAMPLE_PROPS`,
 * so a copy change can be seen without sending anything.
 */

export interface TemplateContext {
  firstName: string;
  timezone: string | null;
  url(path?: string): string;
  /** Set only for preference-controlled types. */
  manageUrl?: string;
  /** The support address replies land in, when configured. */
  replyTo?: string;
}

export interface Template<T extends EmailType> {
  subject(props: EmailPropsByType[T], ctx: TemplateContext): string;
  body(props: EmailPropsByType[T], ctx: TemplateContext): React.ReactElement;
  /** Files to attach. Content is base64 (what Resend takes as a string). */
  attachments?(
    props: EmailPropsByType[T],
    ctx: TemplateContext,
  ): Array<{ filename: string; content: string; contentType: string }>;
}

const when = (p: BookingFacts, ctx: TemplateContext) => absoluteWhen(new Date(p.startAt), ctx.timezone);
const minutes = (n: number) => `${n} minutes`;

/** The session as a calendar event, attached to both confirmations. */
function icsAttachment(p: BookingFacts, ctx: TemplateContext, path: string, withWhom: string) {
  const text = bookingIcs({
    bookingId: p.bookingId,
    startAt: new Date(p.startAt),
    endAt: new Date(p.endAt),
    summary: `NowTutors: ${p.subjectName} with ${withWhom}`,
    description: `Your ${minutes(p.durationMinutes)} ${p.subjectName} session on NowTutors. Join from ${ctx.url(path)}`,
    url: ctx.url(path),
    now: new Date(),
  });
  return [
    {
      filename: "nowtutors-session.ics",
      content: Buffer.from(text, "utf8").toString("base64"),
      contentType: "text/calendar; charset=utf-8; method=PUBLISH",
    },
  ];
}

const replyLine = (ctx: TemplateContext) =>
  ctx.replyTo ? `Reply to this email and it reaches ${ctx.replyTo}.` : "Reply to this email if anything looks wrong.";

export const templates: { [T in EmailType]: Template<T> } = {
  "tutor-welcome": {
    subject: (_p, ctx) => `Welcome to NowTutors, ${ctx.firstName}`,
    body: (_p, ctx) => (
      <Shell
        preview="Your application is in. An admin reviews every profile by hand."
        heading={`Your application is in, ${ctx.firstName}.`}
        cta={{ label: "See your application", href: ctx.url("/tutor/pending-approval") }}
        footerNote={replyLine(ctx)}
      >
        <P>
          Thanks for applying to teach on NowTutors. An admin reviews every profile by hand, so this
          usually takes a day or two. You&rsquo;ll get an email the moment it&rsquo;s approved.
        </P>
        <P>While you wait, check your profile reads the way you want and set the hours you can teach.</P>
      </Shell>
    ),
  },

  "tutor-approved": {
    subject: () => "You're approved to teach on NowTutors",
    body: (_p, ctx) => (
      <Shell
        preview="Students can find you from today."
        heading={`You're in, ${ctx.firstName}.`}
        cta={{ label: "Open your tutor dashboard", href: ctx.url("/tutor") }}
        footerNote={replyLine(ctx)}
      >
        <P>An admin has reviewed your profile and approved it. Students can find you from today.</P>
        <P>
          Go live when you&rsquo;re ready to take instant requests, or set your availability so students
          can book ahead. Your earnings show on the dashboard as sessions complete.
        </P>
      </Shell>
    ),
  },

  "tutor-rejected": {
    subject: () => "Your NowTutors application wasn't approved",
    body: (p, ctx) => (
      <Shell
        preview="An admin left a note about your application."
        heading="Not this time."
        cta={{ label: "See your application", href: ctx.url("/tutor/pending-approval") }}
        footerNote={replyLine(ctx)}
      >
        <P>
          An admin looked at your application and couldn&rsquo;t approve it as it stands. Here&rsquo;s the
          note they left:
        </P>
        <Quote>{p.note}</Quote>
        <P>If you think this was a mistake, or you&rsquo;ve sorted what the note asks for, reply to this email.</P>
      </Shell>
    ),
  },

  "withdrawal-requested": {
    subject: (p) => `Withdrawal request received: ${usdLine(p.amountUsd)}`,
    body: (p, ctx) => (
      <Shell
        preview={`${usdLine(p.amountUsd)} for ${creditsLine(p.amountCredits)}. An admin checks it before it's paid.`}
        heading="We've got your withdrawal request."
        cta={{ label: "View your withdrawals", href: ctx.url("/tutor/withdrawals") }}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Amount", `${usdLine(p.amountUsd)} for ${creditsLine(p.amountCredits)}`],
            ["Paid to", p.destination ? maskEmail(p.destination) : "your PayPal address"],
          ]}
        />
        <P>
          An admin checks each request before it&rsquo;s paid. The credits have left your wallet and are
          held for this request. You&rsquo;ll get another email when the money is sent.
        </P>
      </Shell>
    ),
  },

  "withdrawal-paid": {
    subject: (p) => `Your ${usdLine(p.amountUsd)} withdrawal has been paid`,
    body: (p, ctx) => (
      <Shell
        preview={`${usdLine(p.amountUsd)} sent to ${maskEmail(p.destination)}.`}
        heading="Your withdrawal is on its way."
        cta={{ label: "View your withdrawals", href: ctx.url("/tutor/withdrawals") }}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Amount", `${usdLine(p.amountUsd)} for ${creditsLine(p.amountCredits)}`],
            ["Sent to", maskEmail(p.destination)],
            ["PayPal reference", p.externalReference || "none given"],
          ]}
        />
        <P>
          PayPal usually shows it within a few minutes. If it hasn&rsquo;t arrived in two working days, reply to
          this email with the reference above.
        </P>
      </Shell>
    ),
  },

  "withdrawal-rejected": {
    subject: () => "Your withdrawal request was declined",
    body: (p, ctx) => (
      <Shell
        preview="The credits are back in your wallet."
        heading="Your withdrawal request was declined."
        cta={{ label: "View your withdrawals", href: ctx.url("/tutor/withdrawals") }}
        footerNote={replyLine(ctx)}
      >
        <P>
          An admin declined your request for {usdLine(p.amountUsd)} ({creditsLine(p.amountCredits)}) and
          left this note:
        </P>
        <Quote>{p.note}</Quote>
        <P>The credits are back in your wallet. Once the note is sorted, you can request again.</P>
      </Shell>
    ),
  },

  "admin-new-tutor-application": {
    subject: (p) => `New tutor application: ${p.tutorName}`,
    body: (p, ctx) => (
      <Shell
        preview={`${p.tutorName} is waiting in the approval queue.`}
        heading="A new tutor applied."
        cta={{ label: "Open the approval queue", href: ctx.url("/admin/tutors") }}
      >
        <Facts
          rows={[
            ["Name", p.tutorName],
            ["Email", p.tutorEmail ?? "not on file"],
            ["Teaches", p.subjectSlugs.length ? p.subjectSlugs.map(slugToWords).join(", ") : "no subjects listed"],
          ]}
        />
        <P>The profile is waiting in the approval queue. Nothing is visible to students until you approve it.</P>
      </Shell>
    ),
  },

  "admin-new-withdrawal": {
    subject: (p) => `New withdrawal request: ${usdLine(p.amountUsd)} from ${p.tutorName}`,
    body: (p, ctx) => (
      <Shell
        preview={`${p.tutorName} requested ${usdLine(p.amountUsd)}.`}
        heading="A tutor wants to withdraw."
        cta={{ label: "Open the withdrawals queue", href: ctx.url("/admin/withdrawals") }}
      >
        <Facts
          rows={[
            ["Tutor", p.tutorName],
            ["Amount", `${usdLine(p.amountUsd)} for ${creditsLine(p.amountCredits)}`],
          ]}
        />
        <P>
          The credits are already held against this request. Approve it, send the money from PayPal, then
          mark it paid with the PayPal reference.
        </P>
      </Shell>
    ),
  },

  "booking-confirmed": {
    subject: (p) => `Booked: ${p.subjectName} with ${p.otherPartyName}`,
    body: (p, ctx) => (
      <Shell
        preview={`${when(p, ctx)}. The calendar invite is attached.`}
        heading="Your session is booked."
        cta={{ label: "View your booking", href: ctx.url(`/dashboard/bookings/${p.bookingId}`) }}
        manageUrl={ctx.manageUrl}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Subject", p.subjectName],
            ["Tutor", p.otherPartyName],
            ["When", when(p, ctx)],
            ["Length", minutes(p.durationMinutes)],
            ...(p.priceCredits != null ? ([["Paid", creditsLine(p.priceCredits)]] as Array<[string, string]>) : []),
          ]}
        />
        <P>
          The calendar invite is attached. The classroom opens a few minutes before the start time, and
          you join from your booking page.
        </P>
      </Shell>
    ),
    attachments: (p, ctx) => icsAttachment(p, ctx, `/dashboard/bookings/${p.bookingId}`, p.otherPartyName),
  },

  "tutor-new-booking": {
    subject: (p) => `New booking: ${p.subjectName} with ${p.otherPartyName}`,
    body: (p, ctx) => (
      <Shell
        preview={`${p.otherPartyName} booked ${when(p, ctx)}.`}
        heading={`${p.otherPartyName} booked a session.`}
        cta={{ label: "View the booking", href: ctx.url(`/tutor/bookings/${p.bookingId}`) }}
        manageUrl={ctx.manageUrl}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Subject", p.subjectName],
            ["Student", p.otherPartyName],
            ["When", when(p, ctx)],
            ["Length", minutes(p.durationMinutes)],
          ]}
        />
        {p.studentNotes ? (
          <>
            <P>They left a note:</P>
            <Quote>{p.studentNotes}</Quote>
          </>
        ) : null}
        <P>The calendar invite is attached. You join the classroom from the booking page.</P>
      </Shell>
    ),
    attachments: (p, ctx) => icsAttachment(p, ctx, `/tutor/bookings/${p.bookingId}`, p.otherPartyName),
  },

  "booking-cancelled-by-tutor": {
    // The day in the student's own zone: a 23:30 UTC session is tomorrow in Lagos.
    subject: (p, ctx) => `Cancelled: ${p.subjectName} on ${absoluteWhen(new Date(p.startAt), ctx.timezone).split(",")[0]}`,
    body: (p, ctx) => (
      <Shell
        preview={
          p.refundedCredits > 0
            ? `${creditsLine(p.refundedCredits)} are back in your wallet.`
            : "Your session was cancelled."
        }
        heading="Your session was cancelled."
        cta={{ label: "Find another tutor", href: ctx.url("/tutors") }}
        footerNote={replyLine(ctx)}
      >
        <P>
          Your {p.subjectName} session with {p.otherPartyName} on {when(p, ctx)} was cancelled on the
          tutor&rsquo;s side.
        </P>
        {p.refundedCredits > 0 ? (
          <P>
            The {creditsLine(p.refundedCredits)} you paid are back in your wallet, so you can book again
            straight away.
          </P>
        ) : (
          <P>Nothing was charged for this session.</P>
        )}
      </Shell>
    ),
  },

  "tutor-booking-cancelled": {
    subject: (p) => `Booking cancelled: ${p.subjectName} with ${p.otherPartyName}`,
    body: (p, ctx) => (
      <Shell
        preview={`${when(p, ctx)} is free again.`}
        heading="A booking was cancelled."
        cta={{ label: "View your bookings", href: ctx.url("/tutor/bookings") }}
        footerNote={replyLine(ctx)}
      >
        <P>
          The {p.subjectName} session with {p.otherPartyName} on {when(p, ctx)} was cancelled
          {p.cancelledBy === "student" ? " at the student's request" : ""}. The slot is open on your
          calendar again.
        </P>
      </Shell>
    ),
  },

  "refund-issued": {
    subject: (p) =>
      p.via === "credits" ? `${creditsLine(p.credits)} refunded to your wallet` : `Your ${usdLine(p.amountUsd)} refund`,
    body: (p, ctx) =>
      p.via === "credits" ? (
        <Shell
          preview={`${creditsLine(p.credits)} are back in your wallet.`}
          heading="Your credits are back."
          cta={{ label: "Open your wallet", href: ctx.url("/dashboard/wallet") }}
          footerNote={replyLine(ctx)}
        >
          <P>
            We&rsquo;ve refunded {creditsLine(p.credits)} to your wallet
            {p.bookingSubject ? ` for your ${p.bookingSubject} session` : ""}. You can use them for any
            tutor, any time.
          </P>
        </Shell>
      ) : (
        <Shell
          preview={`${usdLine(p.amountUsd)} is on its way back to you through PayPal.`}
          heading="Your refund is on its way."
          cta={{ label: "Open your wallet", href: ctx.url("/dashboard/wallet") }}
          footerNote={replyLine(ctx)}
        >
          <P>
            We&rsquo;ve refunded {usdLine(p.amountUsd)} {p.currency !== "USD" ? `(${p.currency}) ` : ""}
            through PayPal. It goes back to the card or account you paid with, usually within 5 working
            days depending on your bank.
          </P>
          <P>Any credits that payment added have been taken back out of your wallet.</P>
        </Shell>
      ),
  },

  "credits-purchased": {
    subject: (p) => `Receipt: ${creditsLine(p.credits)} for ${usdLine(p.amountUsd)}`,
    body: (p, ctx) => (
      <Shell
        preview={`Your wallet now holds ${creditsLine(p.balanceAfter)}.`}
        heading="Thanks, your credits are in."
        cta={{ label: "Find a tutor", href: ctx.url("/tutors") }}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Credits", creditsLine(p.credits)],
            ["Paid", `${usdLine(p.amountUsd)}${p.currency !== "USD" ? ` ${p.currency}` : ""} via PayPal`],
            ["Wallet balance", creditsLine(p.balanceAfter)],
          ]}
        />
        <P>Keep this email as your receipt. Every purchase is also listed in your wallet.</P>
      </Shell>
    ),
  },

  "admin-capture-failed": {
    subject: (p) => `Payment failed: ${usdLine(p.amountUsd)} from ${p.payerName}`,
    body: (p, ctx) => (
      <Shell
        preview="PayPal declined or failed a capture."
        heading="A PayPal payment failed."
        cta={{ label: "Open payments", href: ctx.url("/admin/payments") }}
      >
        <Facts
          rows={[
            ["Payer", p.payerName],
            ["Email", p.payerEmail ?? "not on file"],
            ["Amount", `${usdLine(p.amountUsd)} ${p.currency}`],
            ["For", p.purpose === "booking" ? "a session (direct pay)" : "credits"],
            ["Payment id", p.paymentId],
          ]}
        />
        <P>
          No credits were added and no booking was confirmed. If the payer contacts support, this is the
          payment to look up.
        </P>
      </Shell>
    ),
  },

  "session-summary-student": {
    subject: (p) => (p.noShow ? `You missed your ${p.subjectName} session` : `Your ${p.subjectName} session with ${p.otherPartyName}`),
    body: (p, ctx) => (
      <Shell
        preview={p.noShow ? "The tutor waited, but you didn't join." : "Thanks for learning on NowTutors."}
        heading={p.noShow ? "You missed this one." : "Session done."}
        cta={{ label: "Book again", href: ctx.url("/tutors") }}
        manageUrl={ctx.manageUrl}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Subject", p.subjectName],
            ["Tutor", p.otherPartyName],
            ["When", when(p, ctx)],
            ["Length", minutes(p.durationMinutes)],
            ...(p.priceCredits != null ? ([["Credits", creditsLine(p.priceCredits)]] as Array<[string, string]>) : []),
          ]}
        />
        {p.noShow ? (
          <P>
            Your tutor was in the room and you didn&rsquo;t join, so the session counts as taken and the
            credits aren&rsquo;t returned. If something went wrong on our side, reply and tell us.
          </P>
        ) : (
          <P>If anything about the session wasn&rsquo;t right, reply to this email and tell us.</P>
        )}
      </Shell>
    ),
  },

  "session-summary-tutor": {
    subject: (p) => (p.noShow ? `${p.otherPartyName} didn't join, you're still paid` : `Session done: ${p.subjectName} with ${p.otherPartyName}`),
    body: (p, ctx) => (
      <Shell
        preview={`${creditsLine(p.netCredits)} earned.`}
        heading={p.noShow ? "Your student didn't show." : "Session done."}
        cta={{ label: "View your earnings", href: ctx.url("/tutor/earnings") }}
        manageUrl={ctx.manageUrl}
        footerNote={replyLine(ctx)}
      >
        <Facts
          rows={[
            ["Subject", p.subjectName],
            ["Student", p.otherPartyName],
            ["When", when(p, ctx)],
            ["Earned", creditsLine(p.netCredits)],
            ...(p.availableAt
              ? ([["Withdrawable from", absoluteWhen(new Date(p.availableAt), ctx.timezone)]] as Array<[string, string]>)
              : []),
          ]}
        />
        <P>
          {p.noShow
            ? "You were in the room and the student didn't join, so you're paid in full. "
            : ""}
          Earnings are held for a short period after each session, then move to your available balance.
        </P>
      </Shell>
    ),
  },
};

const SAMPLE_BOOKING: BookingFacts = {
  bookingId: "3f0c1b7e-0000-4000-8000-000000000001",
  subjectName: "Spanish",
  otherPartyName: "Tina Reyes",
  startAt: "2026-10-02T15:30:00.000Z",
  endAt: "2026-10-02T16:30:00.000Z",
  durationMinutes: 60,
  priceCredits: 40,
};

/** Sample props per type, for the kitchen sink and the render tests. */
export const SAMPLE_PROPS: { [T in EmailType]: EmailPropsByType[T] } = {
  "tutor-welcome": {},
  "tutor-approved": {},
  "tutor-rejected": { note: "Your intro video is missing sound. Re-upload it and we'll take another look." },
  "withdrawal-requested": { amountCredits: 23, amountUsd: "30.66", destination: "tina.reyes@example.com" },
  "withdrawal-paid": {
    amountCredits: 23,
    amountUsd: "30.66",
    destination: "tina.reyes@example.com",
    externalReference: "5PP12345AB678901C",
  },
  "withdrawal-rejected": {
    amountCredits: 23,
    amountUsd: "30.66",
    note: "The PayPal address on your profile bounced. Update it and request again.",
  },
  "admin-new-tutor-application": {
    tutorName: "Tina Reyes",
    tutorEmail: "tutor2@nowtutors.dev",
    subjectSlugs: ["spanish", "sat-act-test-prep"],
  },
  "admin-new-withdrawal": { tutorName: "Tina Reyes", amountCredits: 23, amountUsd: "30.66" },
  "booking-confirmed": SAMPLE_BOOKING,
  "tutor-new-booking": { ...SAMPLE_BOOKING, otherPartyName: "Sam Stone", studentNotes: "Working on the subjunctive, please." },
  "booking-cancelled-by-tutor": { ...SAMPLE_BOOKING, refundedCredits: 40 },
  "tutor-booking-cancelled": { ...SAMPLE_BOOKING, otherPartyName: "Sam Stone", cancelledBy: "student" },
  "refund-issued": { via: "credits", credits: 40, bookingSubject: "Spanish" },
  "credits-purchased": { credits: 30, amountUsd: "39.99", currency: "USD", balanceAfter: 70 },
  "admin-capture-failed": {
    paymentId: "8a1d2c3b-0000-4000-8000-000000000002",
    payerName: "Sam Stone",
    payerEmail: "student1@nowtutors.dev",
    amountUsd: "39.99",
    currency: "USD",
    purpose: "credit_purchase",
  },
  "session-summary-student": { ...SAMPLE_BOOKING, noShow: false },
  "session-summary-tutor": {
    ...SAMPLE_BOOKING,
    otherPartyName: "Sam Stone",
    noShow: false,
    netCredits: 30,
    availableAt: "2026-10-04T16:30:00.000Z",
  },
};

export const SAMPLE_CONTEXT: TemplateContext = {
  firstName: "Tina",
  timezone: "Europe/Madrid",
  url: (path = "/") => `https://nowtutors.com${path}`,
  replyTo: "hello@nowtutors.com",
};
