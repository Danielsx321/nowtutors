import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * The topbar's unread-messages badge (SPEC §7.9, §8 "Unread messages"; Phase 9
 * Part 1). The real `useUnreadCount` and retrying channel run on a faked socket
 * and a faked `getUnreadCount`.
 *
 * Asserted: the count is read on mount; a `conversations` UPDATE (what every
 * send produces) re-reads it; reading a thread, which produces no Realtime
 * event, clears it through the same-tab event; and a zero count shows no badge.
 */

type Payload = { new: Record<string, unknown> };
const bound = new Map<string, (payload: Payload) => void>();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-access-token" } },
        error: null,
      }),
    },
    realtime: { setAuth: async () => {} },
    channel: () => {
      const channel = {
        on(_type: string, opts: { event: string }, cb: (payload: Payload) => void) {
          bound.set(opts.event, cb);
          return channel;
        },
        subscribe(cb: (status: string) => void) {
          cb("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

const getUnreadCount = vi.fn();
vi.mock("@/actions/messaging", () => ({
  getUnreadCount: () => getUnreadCount(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { UnreadMessagesLink } from "@/components/features/messaging/unread-messages-link";
import { MESSAGES_READ_EVENT } from "@/hooks/use-unread-count";

beforeEach(() => {
  bound.clear();
  getUnreadCount.mockReset();
});

async function flush() {
  await act(async () => {});
  await act(async () => {});
}

describe("UnreadMessagesLink", () => {
  it("shows the count read on mount and links to the inbox", async () => {
    getUnreadCount.mockResolvedValue(2);
    render(<UnreadMessagesLink href="/dashboard/messages" />);
    await flush();
    expect(screen.getByTestId("unread-badge").textContent).toBe("2");
    expect(screen.getByLabelText("Messages, 2 unread").getAttribute("href")).toBe(
      "/dashboard/messages",
    );
  });

  it("re-reads on a conversations UPDATE without a reload", async () => {
    getUnreadCount.mockResolvedValue(0);
    render(<UnreadMessagesLink href="/tutor/messages" />);
    await flush();
    expect(screen.queryByTestId("unread-badge")).toBeNull();

    getUnreadCount.mockResolvedValue(1);
    const onUpdate = bound.get("UPDATE");
    if (!onUpdate) throw new Error("no UPDATE handler bound — channel not subscribed");
    await act(async () => {
      onUpdate({ new: { id: "c1" } });
    });
    await flush();
    expect(screen.getByTestId("unread-badge").textContent).toBe("1");
  });

  it("clears after the thread marks messages read, which sends no Realtime event", async () => {
    getUnreadCount.mockResolvedValue(3);
    render(<UnreadMessagesLink href="/dashboard/messages" />);
    await flush();
    expect(screen.getByTestId("unread-badge").textContent).toBe("3");

    getUnreadCount.mockResolvedValue(0);
    await act(async () => {
      window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
    });
    await flush();
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("caps a large count", async () => {
    getUnreadCount.mockResolvedValue(150);
    render(<UnreadMessagesLink href="/dashboard/messages" />);
    await flush();
    expect(screen.getByTestId("unread-badge").textContent).toBe("99+");
  });
});
