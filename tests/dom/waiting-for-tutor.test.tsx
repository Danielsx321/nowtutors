import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Modal, ModalContent } from "@/components/ui/modal";

/**
 * The student's wait after "Request now" (design overhaul Part 4).
 *
 * Asserted: the waiting state keeps the words E2E reads; no answer and a
 * decline both say nothing was charged and offer the two ways forward
 * (another live tutor, a booked time with this one); Close is a real button a
 * keyboard reaches; a changed balance points at topping up, not at another
 * tutor.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { WaitingForTutor } from "@/components/features/booking/waiting-for-tutor";

function renderWait(props: Partial<React.ComponentProps<typeof WaitingForTutor>> = {}) {
  const onClose = vi.fn();
  const onBookTime = vi.fn();
  render(
    <Modal open>
      <ModalContent>
        <WaitingForTutor
          tutorName="Amina"
          priceCredits={12}
          secondsLeft={42}
          fraction={0.7}
          elapsed={false}
          status="pending"
          onClose={onClose}
          onBookTime={onBookTime}
          {...props}
        />
      </ModalContent>
    </Modal>,
  );
  return { onClose, onBookTime };
}

describe("WaitingForTutor", () => {
  it("waiting: the E2E wording, the seconds, and the charge-on-accept line", () => {
    renderWait();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/waiting for amina/i);
    expect(dialog.textContent).toMatch(/42 seconds to answer/);
    expect(dialog.textContent).toMatch(/charged 12 credits only if they accept/);
    expect(screen.queryByRole("link", { name: /try another live tutor/i })).toBeNull();
  });

  it("no answer: nothing was charged, and both ways forward", () => {
    const { onBookTime } = renderWait({ status: "expired" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/no answer/i);
    expect(dialog.textContent).toMatch(/nothing was charged/i);
    expect(screen.getByRole("link", { name: /try another live tutor/i }).getAttribute("href")).toBe(
      "/?live=1#tutors",
    );
    fireEvent.click(screen.getByRole("button", { name: /book a time with amina/i }));
    expect(onBookTime).toHaveBeenCalledTimes(1);
  });

  it("the ring running out reads as no answer even before the row updates", () => {
    renderWait({ elapsed: true, status: "pending" });
    expect(screen.getByRole("dialog").textContent).toMatch(/no answer/i);
  });

  it("declined: unavailable, nothing charged, both ways forward", () => {
    renderWait({ status: "declined" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/unavailable right now/i);
    expect(dialog.textContent).toMatch(/nothing was charged/i);
    expect(screen.getByRole("link", { name: /try another live tutor/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /book a time with amina/i })).toBeTruthy();
  });

  it("Close is a text button a keyboard can reach", () => {
    const { onClose } = renderWait({ status: "expired" });
    const close = screen
      .getAllByRole("button", { name: /^close$/i })
      .find((b) => b.textContent?.trim() === "Close");
    expect(close).toBeTruthy();
    expect(close!.tabIndex).toBe(0);
    fireEvent.click(close!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a changed balance points at topping up, not another tutor", () => {
    renderWait({ status: "failed_payment" });
    expect(screen.getByRole("link", { name: /top up credits/i }).getAttribute("href")).toBe("/dashboard/wallet");
    expect(screen.queryByRole("link", { name: /try another live tutor/i })).toBeNull();
  });
});
