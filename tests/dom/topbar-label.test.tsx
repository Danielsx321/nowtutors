import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The avatar button's accessible name starts with the name it shows, so voice
 * control ("click Elizabeth") and screen readers agree (Lighthouse
 * label-content-name-mismatch, Phase 10 Part 5).
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/components/features/messaging/unread-messages-link", () => ({ UnreadMessagesLink: () => null }));
vi.mock("@/components/features/tutor/go-live-toggle", () => ({ GoLiveToggle: () => null }));

import { Topbar } from "@/components/layout/topbar";

describe("Topbar account menu", () => {
  it("is named after the person, then what it does", () => {
    render(<Topbar userName="Elizabeth" />);
    const button = screen.getByRole("button", { name: "Elizabeth, account menu" });
    expect(button.textContent).toContain("Elizabeth");
  });
});
