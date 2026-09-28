import { Resend } from "resend";
import type { EmailMessage, EmailTransport, TransportResult } from "./types";

/**
 * Transports (SPEC §11: Resend). The port is `EmailTransport`; this file holds
 * the two real ones. Tests pass their own fake and never reach the network.
 *
 * `logTransport` is what runs when `RESEND_API_KEY` is unset: local dev, the
 * test project, every Vercel preview. It prints the envelope and the plain
 * text so a flow can be followed in the terminal, and reports `ok` so the
 * calling code behaves exactly as it will in production.
 */
export const logTransport: EmailTransport = {
  name: "log",
  async send(message: EmailMessage): Promise<TransportResult> {
    console.info(
      `[email] (not sent, RESEND_API_KEY unset) to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    );
    return { ok: true, id: null };
  },
};

export function resendTransport(apiKey: string): EmailTransport {
  const resend = new Resend(apiKey);
  return {
    name: "resend",
    async send(message: EmailMessage): Promise<TransportResult> {
      const { data, error } = await resend.emails.send({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments,
      });
      if (error) return { ok: false, error: `${error.name}: ${error.message}` };
      return { ok: true, id: data?.id ?? null };
    },
  };
}

/** The transport for this process, decided once from the environment. */
export function transportFromEnv(): { transport: EmailTransport; configured: boolean } {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { transport: logTransport, configured: false };
  return { transport: resendTransport(key), configured: true };
}

/**
 * `EMAIL_FROM` is the display form Resend accepts, `NowTutors <hello@nowtutors.com>`.
 * Replies go to `EMAIL_REPLY_TO` when set (the support inbox), otherwise to
 * the from address. Unset `EMAIL_FROM` is a configuration fault, surfaced by
 * the sender as `not_configured` rather than a half-addressed message.
 */
export function senderFromEnv(): { from: string; replyTo?: string } | null {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  return replyTo ? { from, replyTo } : { from };
}
