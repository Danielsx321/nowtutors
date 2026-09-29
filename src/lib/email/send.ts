import * as Sentry from "@sentry/nextjs";
import { renderEmail } from "@emails/render";
import { allowsEmail, readPreferences } from "./preferences";
import type { EmailRequest, EmailTransport, Recipient, SendOutcome } from "./types";

export interface SendDeps {
  transport: EmailTransport;
  /** False when the transport is the log fallback; the outcome says so. */
  configured: boolean;
  sender: { from: string; replyTo?: string } | null;
  getRecipient(userId: string): Promise<Recipient | null>;
  getAdminRecipients(): Promise<Recipient[]>;
  /** Injected so tests can pin the links; production passes `appUrl`. */
  appUrl(path?: string): string;
}

/**
 * Send one email (SPEC §11). Best-effort by contract: this function never
 * throws. Every failure is logged with the type and the recipient id, reported
 * to Sentry when a DSN is configured, and returned as `{ sent: false, reason }`
 * so a caller that cares (a cron summary) can count it. Callers that do not
 * care (server actions) fire it from `after()` and move on.
 *
 * Preferences are read from the recipient's row on every send, so a change on
 * the settings page takes effect for the next email with no cache to clear.
 */
export async function sendEmail(request: EmailRequest, deps: SendDeps): Promise<SendOutcome> {
  const targets = await resolveRecipients(request, deps);
  if (targets.length === 0) return { sent: false, reason: "no_recipient" };

  // One request, possibly several admins. The outcome reports the first
  // recipient; each send is logged on its own.
  let outcome: SendOutcome = { sent: false, reason: "no_recipient" };
  for (const recipient of targets) {
    const one = await sendToOne(request, recipient, deps);
    if (outcome.sent === false && outcome.reason === "no_recipient") outcome = one;
  }
  return outcome;
}

async function resolveRecipients(request: EmailRequest, deps: SendDeps): Promise<Recipient[]> {
  try {
    if ("admins" in request.to) return await deps.getAdminRecipients();
    const one = await deps.getRecipient(request.to.userId);
    return one ? [one] : [];
  } catch (err) {
    report(request, "recipient lookup failed", err);
    return [];
  }
}

async function sendToOne(
  request: EmailRequest,
  recipient: Recipient,
  deps: SendDeps,
): Promise<SendOutcome> {
  if (!allowsEmail(readPreferences(recipient.notificationPreferences), request.type)) {
    return { sent: false, reason: "preference_off", to: recipient.email };
  }
  if (!deps.sender) {
    console.error(`[email] ${request.type}: EMAIL_FROM is not set, nothing sent`);
    return { sent: false, reason: "not_configured", to: recipient.email };
  }

  let rendered: Awaited<ReturnType<typeof renderEmail>>;
  try {
    rendered = await renderEmail(request.type, request.props, { recipient, appUrl: deps.appUrl });
  } catch (err) {
    report(request, `render failed for ${recipient.id}`, err);
    return { sent: false, reason: "render_error", to: recipient.email };
  }

  try {
    const result = await deps.transport.send({
      from: deps.sender.from,
      to: recipient.email,
      replyTo: deps.sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: rendered.attachments,
    });
    if (!result.ok) {
      report(request, `transport ${deps.transport.name} refused for ${recipient.id}`, result.error);
      return { sent: false, reason: "transport_error", to: recipient.email };
    }
    if (!deps.configured) return { sent: false, reason: "not_configured", to: recipient.email };
    console.info(`[email] ${request.type} sent to ${recipient.id} id=${result.id ?? "?"}`);
    return { sent: true, id: result.id, to: recipient.email };
  } catch (err) {
    report(request, `transport ${deps.transport.name} threw for ${recipient.id}`, err);
    return { sent: false, reason: "transport_error", to: recipient.email };
  }
}

function report(request: EmailRequest, what: string, err: unknown) {
  console.error(`[email] ${request.type}: ${what}`, err);
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
    tags: { email_type: request.type },
    extra: { what },
  });
}
