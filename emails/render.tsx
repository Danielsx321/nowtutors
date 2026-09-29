import * as React from "react";
import { render } from "@react-email/render";
import { templates, type TemplateContext } from "./templates";
import type { EmailPropsByType, EmailType, Recipient } from "@/lib/email/types";
import { firstNameOf } from "@/lib/email/format";
import { PREFERENCE_BY_TYPE } from "@/lib/email/preferences";
import { isExistingRoute } from "@/lib/routes";

/**
 * Where "Manage notifications" points for this person, or nothing when their
 * settings page does not exist yet. The student page arrives in Phase 10
 * Part 4; checking `routes.ts` means the link appears on its own the day the
 * route is added, and never 404s before then.
 */
function settingsPathFor(role: Recipient["role"]): string | undefined {
  const path = role === "tutor" ? "/tutor/settings" : role === "admin" ? "/admin/settings" : "/dashboard/settings";
  return isExistingRoute(path) ? path : undefined;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}

/**
 * Turn a type and its props into subject, HTML and plain text. Pure apart
 * from `appUrl`, which is injected so a test can pin the links. The recipient
 * gives the greeting name, the timezone for any time printed, and whether the
 * footer carries a "Manage notifications" link (only for preference-controlled
 * types; none in Part 1).
 */
export async function renderEmail<T extends EmailType>(
  type: T,
  props: EmailPropsByType[T],
  input: { recipient: Recipient; appUrl(path?: string): string },
): Promise<RenderedEmail> {
  const template = templates[type];
  const ctx: TemplateContext = {
    firstName: firstNameOf(input.recipient.fullName, input.recipient.displayName),
    timezone: input.recipient.timezone,
    url: input.appUrl,
    manageUrl: manageUrlFor(type, input),
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
  };
  const element = template.body(props, ctx);
  const doc = (
    <html lang="en">
      {/* An email document, not a Next page: the plain element is correct here. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>{template.subject(props, ctx)}</title>
      </head>
      <body style={{ margin: 0, padding: 0 }}>{element}</body>
    </html>
  );
  const [html, text] = await Promise.all([render(doc), render(doc, { plainText: true })]);
  const attachments = template.attachments?.(props, ctx);
  return { subject: template.subject(props, ctx), html, text, ...(attachments?.length ? { attachments } : {}) };
}

function manageUrlFor(type: EmailType, input: { recipient: Recipient; appUrl(path?: string): string }) {
  if (PREFERENCE_BY_TYPE[type] === "always") return undefined;
  const path = settingsPathFor(input.recipient.role);
  return path ? input.appUrl(path) : undefined;
}
