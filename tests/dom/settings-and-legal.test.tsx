import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The settings forms and the legal pages (Phase 10 Part 4), rendered.
 *
 * Settings: the notification switches reflect what's stored and save as they
 * flip (rolling back on a refusal); a Google-only account sees a sentence, not
 * a password form; a tutor's account form has no name field.
 * Legal: each page has one h1, the draft note, and its marked placeholders.
 */

const m = vi.hoisted(() => ({
  updateNotificationSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/actions/settings", () => ({
  updateNotificationSettings: (...a: unknown[]) => m.updateNotificationSettings(...a),
  updateAccountSettings: (...a: unknown[]) => m.updateAccountSettings(...a),
  changePassword: (...a: unknown[]) => m.changePassword(...a),
}));

import { NotificationForm } from "@/components/features/settings/notification-form";
import { PasswordForm } from "@/components/features/settings/password-form";
import { AccountForm } from "@/components/features/settings/account-form";
import TermsPage from "@/app/(public)/legal/terms/page";
import PrivacyPage from "@/app/(public)/legal/privacy/page";
import RefundsPage from "@/app/(public)/legal/refunds/page";
import { isExistingRoute } from "@/lib/routes";

beforeEach(() => vi.clearAllMocks());

describe("NotificationForm", () => {
  it("shows the stored switches and saves a flip with all three values", async () => {
    m.updateNotificationSettings.mockResolvedValue({ ok: true });
    render(<NotificationForm initial={{ booking_confirmations: true, reminders: false, messages: true }} />);
    const reminders = screen.getByRole("switch", { name: "Session reminders" });
    expect(reminders.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(reminders);
    });
    await waitFor(() =>
      expect(m.updateNotificationSettings).toHaveBeenCalledWith({
        booking_confirmations: true,
        reminders: true,
        messages: true,
      }),
    );
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Session reminders" }).getAttribute("aria-checked")).toBe("true");
  });

  it("puts a switch back when the save is refused", async () => {
    m.updateNotificationSettings.mockResolvedValue({ error: "Please check the form." });
    render(<NotificationForm initial={{ booking_confirmations: true, reminders: true, messages: true }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "New messages while you're away" }));
    });
    expect(await screen.findByText("Please check the form.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "New messages while you're away" }).getAttribute("aria-checked")).toBe("true");
  });

  it("offers no marketing switch, since no marketing email exists", () => {
    render(<NotificationForm initial={{ booking_confirmations: true, reminders: true, messages: true }} />);
    expect(screen.getAllByRole("switch")).toHaveLength(3);
  });
});

describe("PasswordForm", () => {
  it("tells a Google-only account there's no password", () => {
    render(<PasswordForm hasPassword={false} />);
    expect(screen.getByText(/sign in with Google/)).toBeTruthy();
    expect(screen.queryByLabelText(/Current password/)).toBeNull();
  });

  it("shows three labelled password fields otherwise", () => {
    render(<PasswordForm hasPassword />);
    for (const label of [/Current password/, /^New password/, /Confirm new password/]) {
      expect(screen.getByLabelText(label).getAttribute("type")).toBe("password");
    }
  });
});

describe("AccountForm", () => {
  it("has a name field for students and none for tutors", () => {
    const { unmount } = render(<AccountForm showName displayName="Sam" timezone="Africa/Lagos" />);
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    unmount();
    render(<AccountForm showName={false} displayName="Tom" timezone="Africa/Lagos" />);
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect((screen.getByLabelText(/Timezone/) as HTMLSelectElement).value).toBe("Africa/Lagos");
  });

  it("keeps a stored alias zone selectable rather than silently changing it", () => {
    render(<AccountForm showName={false} displayName={null} timezone="Asia/Calcutta" />);
    expect((screen.getByLabelText(/Timezone/) as HTMLSelectElement).value).toBe("Asia/Calcutta");
  });
});

describe("legal pages", () => {
  const pages = [
    { name: "terms", Page: TermsPage, h1: "Terms of service", path: "/legal/terms" },
    { name: "privacy", Page: PrivacyPage, h1: "Privacy policy", path: "/legal/privacy" },
    { name: "refunds", Page: RefundsPage, h1: "Refunds and no-shows", path: "/legal/refunds" },
  ];
  for (const { name, Page, h1, path } of pages) {
    it(`${name}: one h1, the draft note, marked placeholders, a known route`, () => {
      const { container } = render(<Page />);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(h1);
      expect(screen.getByRole("note").textContent).toContain("Draft for review");
      expect(container.querySelectorAll("[data-to-confirm]").length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain("—");
      expect(isExistingRoute(path)).toBe(true);
      const legalNav = screen.getByRole("navigation", { name: "Legal" });
      expect(within(legalNav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
        "/legal/terms",
        "/legal/privacy",
        "/legal/refunds",
      ]);
    });
  }
});
