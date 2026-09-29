"use client";

import * as React from "react";
import { Section, Demo, type Surface } from "./kit";
import { SAMPLE_CONTEXT, SAMPLE_PROPS, templates } from "@emails/templates";
import type { EmailType } from "@/lib/email/types";

const ORDER: EmailType[] = [
  "tutor-welcome",
  "tutor-approved",
  "tutor-rejected",
  "withdrawal-requested",
  "withdrawal-paid",
  "withdrawal-rejected",
  "admin-new-tutor-application",
  "admin-new-withdrawal",
];

/**
 * Every email template with sample props (Phase 10 Part 1). The body is the
 * same React the sender renders, minus the `<html>` wrapper, so copy and
 * layout can be checked here without a Resend key or an inbox. Emails are
 * always light: no inbox honours the page theme.
 */
export function EmailSection({ surface }: { surface: Surface }) {
  return (
    <Section id="email" title="Email" surface={surface}>
      {ORDER.map((type) => {
        const t = templates[type] as {
          subject(p: unknown, c: typeof SAMPLE_CONTEXT): string;
          body(p: unknown, c: typeof SAMPLE_CONTEXT): React.ReactElement;
        };
        return (
          <Demo
            key={type}
            label={`${type}: "${t.subject(SAMPLE_PROPS[type], SAMPLE_CONTEXT)}"`}
            surface={surface}
            className="flex-col items-stretch"
          >
            <div className="overflow-hidden rounded-lg border border-border">
              {t.body(SAMPLE_PROPS[type], SAMPLE_CONTEXT)}
            </div>
          </Demo>
        );
      })}
    </Section>
  );
}
