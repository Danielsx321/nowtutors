import * as React from "react";
import { Facts, P, Quote, Shell } from "./shell";
import type { EmailPropsByType, EmailType } from "@/lib/email/types";
import { creditsLine, slugToWords, usdLine } from "@/lib/email/format";
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
};

export const SAMPLE_CONTEXT: TemplateContext = {
  firstName: "Tina",
  timezone: "Europe/Madrid",
  url: (path = "/") => `https://nowtutors.com${path}`,
  replyTo: "hello@nowtutors.com",
};
