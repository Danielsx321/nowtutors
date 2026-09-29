import "server-only";
import { after } from "next/server";
import { appUrl } from "./app-url";
import { senderFromEnv, transportFromEnv } from "./client";
import { getAdminRecipients, getRecipient } from "./recipient";
import { sendEmail, type SendDeps } from "./send";
import type { EmailRequest, EmailType, SendOutcome } from "./types";

export type { EmailRequest, EmailType, SendOutcome } from "./types";

let deps: SendDeps | null = null;

/** Wired once per process from the environment. */
function productionDeps(): SendDeps {
  if (deps) return deps;
  const { transport, configured } = transportFromEnv();
  deps = {
    transport,
    configured,
    sender: senderFromEnv(),
    getRecipient,
    getAdminRecipients,
    appUrl,
  };
  return deps;
}

/**
 * Send now and wait for the outcome. For crons and webhooks, which have no
 * response to hurry and want the count in their summary. Never throws.
 */
export function sendEmailNow<T extends EmailType>(request: EmailRequest<T>): Promise<SendOutcome> {
  return sendEmail(request, productionDeps());
}

/**
 * Send after the response has gone out (Next's `after()`), so a server action
 * returns as fast as it did before Phase 10 and a slow mail API can never hold
 * a transaction's caller. `after` runs even when the action ends in
 * `redirect()`, which onboarding does.
 *
 * The thunk form is for hooks that still need a lookup (a name, a payout
 * address) before they can fill the template: the lookup runs after the
 * response too. Whatever it throws is logged, never surfaced.
 */
export function queueEmail<T extends EmailType>(request: EmailRequest<T>): void {
  later(() => sendEmailNow(request).then(() => undefined));
}

export function queueEmails(
  build: () => Promise<ReadonlyArray<EmailRequest> | EmailRequest | null>,
): void {
  later(async () => {
    try {
      const built = await build();
      const list = built == null ? [] : Array.isArray(built) ? built : [built as EmailRequest];
      for (const request of list) await sendEmailNow(request);
    } catch (err) {
      console.error("[email] queued build failed", err);
    }
  });
}

/**
 * `after()` inside a request (actions, route handlers). Outside one (a script,
 * an integration test calling a query adapter) `after` throws, and the send
 * runs detached instead: still after the caller's transaction, still unable
 * to fail it.
 */
function later(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task().catch((err) => console.error("[email] detached send failed", err));
  }
}
