import * as React from "react";
import { render } from "@react-email/render";
import { templates, type TemplateContext } from "./templates";
import type { EmailPropsByType, EmailType, Recipient } from "@/lib/email/types";
import { firstNameOf } from "@/lib/email/format";
import { PREFERENCE_BY_TYPE } from "@/lib/email/preferences";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string }>;
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
    manageUrl: PREFERENCE_BY_TYPE[type] === "always" ? undefined : input.appUrl("/dashboard/settings"),
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
  return { subject: template.subject(props, ctx), html, text };
}
