import * as React from "react";
import { tokens } from "@/lib/design/tokens";

/**
 * The one email layout (SPEC §11; DESIGN.md v3). Plain React and inline
 * styles: email clients ignore stylesheets, and tables still lay out more
 * reliably than flex in Outlook. Colours come from `tokens.ts`, the same
 * source as the site, so a palette change reaches the inbox too.
 *
 * `Shell` is the body only. `renderEmail` wraps it in `<html>` for sending;
 * the kitchen sink renders `Shell` inline to preview every template in the
 * browser without an `<html>` inside a `<div>`.
 */

const c = {
  ground: tokens.ground.light,
  card: tokens["surface-raised"].light,
  text: tokens.text.light,
  muted: tokens["text-muted"].light,
  navy: tokens.band.light,
  onNavy: tokens["on-primary"].light,
  highlight: tokens.highlight.light,
  onHighlight: tokens["on-highlight"].light,
  border: tokens.border.light,
  quoteBar: tokens.accent.light,
};

const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface ShellProps {
  /** The one line the inbox shows under the subject. */
  preview: string;
  heading: string;
  children: React.ReactNode;
  cta?: { label: string; href: string };
  /** Shown above the footer line when the email is preference-controlled. */
  manageUrl?: string;
  /** Postal or support line. Filled from the sender's reply-to by the renderer. */
  footerNote?: string;
}

export function Shell({ preview, heading, children, cta, manageUrl, footerNote }: ShellProps) {
  return (
    <div style={{ backgroundColor: c.ground, padding: "24px 12px", fontFamily: font, color: c.text }}>
      {/* Preview text: read by the inbox, hidden in the body. */}
      <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{preview}</div>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ maxWidth: 560, margin: "0 auto" }}
      >
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: c.navy,
                color: c.onNavy,
                padding: "18px 28px",
                borderRadius: "12px 12px 0 0",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              nowtutors
            </td>
          </tr>
          <tr>
            <td
              style={{
                backgroundColor: c.card,
                padding: "28px 28px 8px",
                borderLeft: `1px solid ${c.border}`,
                borderRight: `1px solid ${c.border}`,
              }}
            >
              <h1 style={{ margin: "0 0 16px", fontSize: 24, lineHeight: 1.2, fontWeight: 700 }}>{heading}</h1>
              <div style={{ fontSize: 16, lineHeight: 1.55 }}>{children}</div>
            </td>
          </tr>
          {cta ? (
            <tr>
              <td
                style={{
                  backgroundColor: c.card,
                  padding: "8px 28px 28px",
                  borderLeft: `1px solid ${c.border}`,
                  borderRight: `1px solid ${c.border}`,
                }}
              >
                <a
                  href={cta.href}
                  style={{
                    display: "inline-block",
                    backgroundColor: c.highlight,
                    color: c.onHighlight,
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: 16,
                    padding: "12px 22px",
                    borderRadius: 999,
                  }}
                >
                  {cta.label}
                </a>
              </td>
            </tr>
          ) : (
            <tr>
              <td
                style={{
                  backgroundColor: c.card,
                  padding: "0 28px 20px",
                  borderLeft: `1px solid ${c.border}`,
                  borderRight: `1px solid ${c.border}`,
                }}
              />
            </tr>
          )}
          <tr>
            <td
              style={{
                backgroundColor: c.card,
                padding: "16px 28px 24px",
                borderRadius: "0 0 12px 12px",
                border: `1px solid ${c.border}`,
                borderTop: `1px solid ${c.border}`,
                color: c.muted,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <p style={{ margin: 0 }}>You&rsquo;re getting this because you have a NowTutors account.</p>
              {manageUrl ? (
                <p style={{ margin: "6px 0 0" }}>
                  <a href={manageUrl} style={{ color: c.muted }}>
                    Manage notifications
                  </a>
                </p>
              ) : null}
              {footerNote ? <p style={{ margin: "6px 0 0" }}>{footerNote}</p> : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** A paragraph with the body rhythm. */
export function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 14px" }}>{children}</p>;
}

/** An admin's note or a reference, set apart from the sender's words. */
export function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote
      style={{
        margin: "0 0 14px",
        padding: "10px 16px",
        borderLeft: `3px solid ${c.quoteBar}`,
        backgroundColor: c.ground,
        color: c.text,
        borderRadius: 6,
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </blockquote>
  );
}

/**
 * Label and value rows for amounts and references. One paragraph per row
 * rather than a table: the plain-text part is rendered from the same markup,
 * and table cells there run together ("Amount$40.00").
 */
export function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div style={{ margin: "0 0 14px", fontSize: 15 }}>
      {rows.map(([label, value]) => (
        <p key={label} style={{ margin: "0 0 4px" }}>
          <span style={{ color: c.muted }}>{label}:</span> <strong>{value}</strong>
        </p>
      ))}
    </div>
  );
}
