/**
 * The tutor guide, written once. Rendered three ways:
 *
 * - `/tutor/guide` (`components/features/guide/guide-article.tsx`), in the
 *   tutor sidebar as "Guide";
 * - `public/tutor-guide.pdf`, built by `pnpm guide:pdf`
 *   (`scripts/build-tutor-guide-pdf.ts`), attached to the approval email and
 *   to the one-off `tutor-guide` email, and linked from the pending page;
 * - nothing else. The emails only link and attach; they carry no copy of it.
 *
 * Text is plain with one bit of markup, `[label](/path)` for links
 * (`content/inline.ts`). Links go to routes the app serves (`lib/routes.ts`);
 * `tests/unit/tutor-guide.test.ts` checks every one, and that no em dash slipped
 * in (`reference/writing-style.md`).
 *
 * The numbers (fee, hold, minimum, booking windows) are the platform settings
 * as seeded (`db/platform-settings-defaults.ts`), written as "currently" the
 * way `/legal/terms` does. The PDF can't read settings live, and a page that
 * says 48 hours next to a PDF that says "see settings" helps nobody. When an
 * admin changes one, edit it here and run `pnpm guide:pdf` (RUNBOOK).
 */

export interface GuideSection {
  /** The anchor on the page and the bookmark in the PDF. */
  id: string;
  title: string;
  blocks: GuideBlock[];
}

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string };

export interface Guide {
  title: string;
  /** Printed under the title and on the PDF's first page. Bump it with every edit. */
  updated: string;
  intro: string[];
  sections: GuideSection[];
}

const p = (text: string): GuideBlock => ({ kind: "p", text });
const list = (...items: string[]): GuideBlock => ({ kind: "list", items });
const steps = (...items: string[]): GuideBlock => ({ kind: "steps", items });
const note = (text: string): GuideBlock => ({ kind: "note", text });

export const TUTOR_GUIDE: Guide = {
  title: "Tutor guide",
  updated: "12 October 2026",
  intro: [
    "You're approved, so students can find you from today. This guide walks through the site the way your first week will: your profile, going live, taking a request, bookings ahead, the classroom, and how you get paid.",
    "Keep it handy. It's always under Guide in your sidebar, and you can download it as a PDF from the top of that page.",
  ],
  sections: [
    {
      id: "start",
      title: "Your first ten minutes",
      blocks: [
        p(
          "Every tutor profile is reviewed by a person before it goes live. Yours has been, which is why you're reading this. The [Today page](/tutor) is your home: a greeting, the live banner, your next session, what you can withdraw right now, and how many sessions you've taught this month.",
        ),
        p("Before anything else, finish the profile checklist on the right of the Today page:"),
        steps(
          "Add a profile photo. Students see it on your card and it's required.",
          "Write a few lines about yourself and how you teach.",
          "Pick the subjects you teach.",
          "Set your hourly rate in credits.",
          "Set your timezone in [Settings](/tutor/settings). Every time you see on the site, and in every email, follows it.",
          "Add the hours you can teach in [Availability](/tutor/availability), if you want bookings ahead as well as instant sessions.",
        ),
        note(
          "A complete profile is what students compare you on. A card with no photo or no subjects is the one they skip.",
        ),
      ],
    },
    {
      id: "profile",
      title: "Your profile",
      blocks: [
        p(
          "[Profile](/tutor/profile) is where you edit your photo, your bio, your subjects and your rate. The card preview on that page shows exactly what a student sees in the [tutor list](/tutors), and the Live badge shows when you're taking instant requests.",
        ),
        p(
          "Your public page is yours to shape. Say who you teach best, what a session with you looks like, and what a student should bring. Students pick the tutor whose page reads like it was written for them.",
        ),
        p(
          "If you change your profile after it's live, an admin looks at the new version too. Nothing goes offline while they do.",
        ),
      ],
    },
    {
      id: "go-live",
      title: "Going live for instant sessions",
      blocks: [
        p(
          "Instant sessions are the heart of NowTutors. A student who needs help now picks a live tutor and starts a session in under a minute. To be one of those tutors, switch on \"Available for instant sessions\" in the top bar. It works from any page in your dashboard.",
        ),
        p("A few things to know about being live:"),
        list(
          "You stay live while the tab is open and in front. The site checks in every 30 seconds.",
          "Close the tab, or leave it hidden behind another one, and you drop off the live list within about two minutes. Students never see a tutor who can't answer.",
          "Switching off is immediate.",
          "Finishing a session doesn't switch you off. You're usually ready for the next one, so you stay live until you say otherwise.",
        ),
        note(
          "Keep the NowTutors tab in front while you're live, with your camera and microphone to hand. A request gives you 60 seconds to answer.",
        ),
      ],
    },
    {
      id: "requests",
      title: "When a request comes in",
      blocks: [
        p(
          "A request pops up over whatever page you're on, with a sound: the student's name, the subject, any note they left, and a 60-second ring. You have two buttons.",
        ),
        list(
          "Accept opens the session room for both of you. Allow your camera and microphone when the browser asks.",
          "Decline is free. The student is shown the other tutors who are live.",
          "No answer in 60 seconds and the request expires on its own. The student moves on; you stay live for the next one.",
        ),
        p(
          "The student chooses the length when they ask: 30, 60, 90 or 120 minutes. The price is your hourly rate times the minutes, divided by 60 and rounded up, and it's charged to the student the moment you accept. The room closes when the time is up.",
        ),
        p("If two students ask at once, accepting one declines the rest automatically."),
      ],
    },
    {
      id: "availability",
      title: "Availability and bookings ahead",
      blocks: [
        p(
          "Students can also book you for a set time. [Availability](/tutor/availability) is where you set your weekly hours, in half-hour slots, and add exceptions for days off. Students currently book from two hours ahead up to seven days ahead.",
        ),
        p(
          "Each new booking arrives by email with a calendar file you can add to your phone, and every booking is listed under [Bookings](/tutor/bookings) with the student, the subject and the time in your timezone.",
        ),
        note("Only set hours you'll keep. A booking is a promise, and there's no cancel button on either side."),
      ],
    },
    {
      id: "classroom",
      title: "Joining a scheduled session",
      blocks: [
        p(
          "Open the booking under [Bookings](/tutor/bookings). The Join button switches on 10 minutes before the start and stays on until 30 minutes after the end. It takes you into the classroom: video, audio and a shared whiteboard, all in the browser.",
        ),
        list(
          "Be there on time. A tutor who doesn't join isn't paid for that session.",
          "If the student doesn't show, stay in the room for the session. You're paid for the slot, because you held it and were there.",
          "Neither you nor the student can cancel a booking. If something's wrong, reply to the booking email and an admin will sort it out.",
        ),
      ],
    },
    {
      id: "messages",
      title: "Messages",
      blocks: [
        p(
          "Students write to you under [Messages](/tutor/messages), and they can attach files. If you've been away from the site for more than five minutes when a message arrives, you get an email so nothing waits unseen.",
        ),
        p(
          "Answer the same day where you can. A student who's deciding between two tutors usually books the one who replied.",
        ),
      ],
    },
    {
      id: "broadcasts",
      title: "Broadcasts (live classes)",
      blocks: [
        p(
          "A broadcast is a live class anyone signed in can watch for free. Start one under [Broadcasts](/tutor/broadcasts) with a title, a short description and, if you like, a subject. You're on camera; viewers watch and can't speak.",
        ),
        list(
          "While you're broadcasting you can't take instant requests, and the live switch is locked until you end the class.",
          "Press End broadcast when you're done. If you just close the tab, the class ends on its own within about two minutes.",
          "Broadcasts are a good way to be seen before anyone books you. A 20-minute class on a topic you teach well brings students to your page.",
        ),
      ],
    },
    {
      id: "earnings",
      title: "How you get paid",
      blocks: [
        p(
          "Students pay in credits, and you earn credits for every session you teach. NowTutors keeps a platform fee from each one, currently 25%, rounded down so any remainder goes to you.",
        ),
        p(
          "Your share is held for 48 hours after the session ends, then it becomes available. [Earnings](/tutor/earnings) shows the three stages side by side: held, available and withdrawn. The Today page has a month-by-month chart of what you've earned.",
        ),
        note(
          "The hold is there so a problem with a session can be looked at before money moves. It runs on its own; you don't need to do anything to release it.",
        ),
      ],
    },
    {
      id: "withdrawals",
      title: "Withdrawing",
      blocks: [
        p(
          "First, add your PayPal address under [Settings](/tutor/settings). Then open [Withdrawals](/tutor/withdrawals) and request a withdrawal. A request takes your whole available balance, and the minimum is currently $30.",
        ),
        list(
          "The credits leave your wallet when you request, so your available balance shows zero until you've earned more.",
          "An admin checks each request before it's paid. You get an email when the request is in and another when the money is sent.",
          "The payout rate, how many dollars a credit is worth to you, is shown on the Withdrawals page.",
        ),
      ],
    },
    {
      id: "settings",
      title: "Settings and emails",
      blocks: [
        p("[Settings](/tutor/settings) holds the things you set once and forget:"),
        list(
          "Your timezone. Change it when you travel, and every time on the site follows.",
          "Which emails you want: booking confirmations, session reminders and new-message nudges can each be switched off. Emails about money and about your application always arrive.",
          "Your PayPal address for withdrawals.",
          "Your password.",
        ),
      ],
    },
    {
      id: "help",
      title: "Getting help",
      blocks: [
        p(
          "Reply to any email from NowTutors and it reaches a person. Include the booking or the time the problem happened and you'll get a quicker answer.",
        ),
        p(
          "The rules behind all of this are in the [terms of service](/legal/terms) and the [refunds and no-shows page](/legal/refunds).",
        ),
        p("Welcome aboard. Your first student is probably looking for you right now."),
      ],
    },
  ],
};
