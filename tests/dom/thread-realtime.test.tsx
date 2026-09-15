import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * The open thread, rendered (SPEC §7.9, §8 "Open thread"; Phase 9 Part 1).
 *
 * What is faked is only what leaves the browser, as in
 * `incoming-requests.test.tsx`: the Supabase socket and the messaging Server
 * Actions. The real `useConversationMessages`, the real retrying channel, the
 * real `Thread`, `Composer` and `mergeMessages` are under test.
 *
 * The properties asserted are the ones a unit test on a pure function can't
 * see: a message the socket announces is painted exactly once, the sender's own
 * message is not painted twice when its INSERT event follows the action's
 * reply, and a (re)subscribe fills in what arrived while the channel was down.
 */

type Payload = { new: Record<string, unknown> };
const bound = new Map<string, (payload: Payload) => void>();
let subscribedCallbacks: ((status: string) => void)[] = [];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-access-token" } },
        error: null,
      }),
    },
    realtime: { setAuth: async () => {} },
    storage: { from: () => ({ uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrl(...args) }) },
    channel: () => {
      const channel = {
        on(_type: string, opts: { event: string }, cb: (payload: Payload) => void) {
          bound.set(opts.event, cb);
          return channel;
        },
        subscribe(cb: (status: string) => void) {
          subscribedCallbacks.push(cb);
          cb("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

const getMessage = vi.fn();
const getThreadPage = vi.fn();
const markConversationRead = vi.fn();
const sendMessage = vi.fn();
const createAttachmentUpload = vi.fn();
const getAttachmentUrl = vi.fn();
const uploadToSignedUrl = vi.fn();
vi.mock("@/actions/messaging", () => ({
  createAttachmentUpload: (input: unknown) => createAttachmentUpload(input),
  getAttachmentUrl: (input: unknown) => getAttachmentUrl(input),
  getMessage: (input: unknown) => getMessage(input),
  getThreadPage: (input: unknown) => getThreadPage(input),
  markConversationRead: (input: unknown) => markConversationRead(input),
  sendMessage: (input: unknown) => sendMessage(input),
  getUnreadCount: async () => 0,
}));

import { mergeMessages, Thread } from "@/components/features/messaging/thread";

const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

function msg(id: string, senderId: string, body: string | null, createdAt: string) {
  return { id, senderId, body, attachment: null, createdAt, readAt: null } as {
    id: string;
    senderId: string;
    body: string | null;
    attachment: { name: string; kind: "image" | "pdf" } | null;
    createdAt: string;
    readAt: string | null;
  };
}

async function handlerFor(event: string) {
  await act(async () => {});
  const handler = bound.get(event);
  if (!handler) throw new Error(`no ${event} handler bound — channel not subscribed`);
  return handler;
}

beforeEach(() => {
  bound.clear();
  subscribedCallbacks = [];
  getMessage.mockReset();
  getThreadPage.mockReset().mockResolvedValue({ messages: [], hasOlder: false });
  markConversationRead.mockReset().mockResolvedValue({ ok: true, marked: 0 });
  sendMessage.mockReset();
  createAttachmentUpload.mockReset();
  getAttachmentUrl.mockReset();
  uploadToSignedUrl.mockReset().mockResolvedValue({ data: { path: "p" }, error: null });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  // jsdom has no layout, so there's nothing to scroll; the thread only reads these.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { value: 0, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderThread(initial = [msg("m0", THEM, "Earlier hello", "2026-09-15T09:00:00.000000Z")]) {
  return render(
    <Thread
      conversationId={CONVERSATION}
      viewerId={ME}
      initialMessages={initial}
      initialHasOlder={false}
    />,
  );
}

describe("Thread", () => {
  it("renders the server's page and marks the thread read on open", async () => {
    renderThread();
    await act(async () => {});
    expect(screen.getByText("Earlier hello")).toBeTruthy();
    expect(markConversationRead).toHaveBeenCalledWith({ conversationId: CONVERSATION });
  });

  it("paints a message the socket announces, read back through the action, exactly once", async () => {
    const incoming = msg("m1", THEM, "Are you free at 5?", "2026-09-15T10:00:00.000000Z");
    getMessage.mockResolvedValue(incoming);
    renderThread();

    const onInsert = await handlerFor("INSERT");
    await act(async () => {
      onInsert({ new: { id: "m1", conversation_id: CONVERSATION } });
    });
    await act(async () => {
      onInsert({ new: { id: "m1", conversation_id: CONVERSATION } });
    });

    expect(getMessage).toHaveBeenCalledWith({ messageId: "m1", conversationId: CONVERSATION });
    expect(screen.getAllByText("Are you free at 5?")).toHaveLength(1);
    // A message from the other person while visible marks the thread read again.
    expect(markConversationRead.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores an event for another conversation and a read-back the viewer can't see", async () => {
    getMessage.mockResolvedValue(null);
    renderThread();
    const onInsert = await handlerFor("INSERT");
    await act(async () => {
      onInsert({ new: { id: "x1", conversation_id: "44444444-4444-4444-8444-444444444444" } });
    });
    expect(getMessage).not.toHaveBeenCalled();

    await act(async () => {
      onInsert({ new: { id: "x2", conversation_id: CONVERSATION } });
    });
    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(/./, { selector: "p.whitespace-pre-wrap" })).toHaveLength(1);
  });

  it("shows the sender's own message once when its INSERT follows the action's reply", async () => {
    const mine = msg("m2", ME, "Yes, 5 works", "2026-09-15T10:01:00.000000Z");
    sendMessage.mockResolvedValue({ ok: true, message: mine });
    getMessage.mockResolvedValue(mine);
    renderThread();
    await act(async () => {});

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Yes, 5 works" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0] as { clientKey: string; body: string };
    expect(sent.body).toBe("Yes, 5 works");
    expect(sent.clientKey).toMatch(/^[0-9a-f-]{36}$/);

    const onInsert = await handlerFor("INSERT");
    await act(async () => {
      onInsert({ new: { id: "m2", conversation_id: CONVERSATION } });
    });

    expect(screen.getAllByText("Yes, 5 works")).toHaveLength(1);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the text and the client key when a send fails, so a retry can't double-post", async () => {
    sendMessage
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        message: msg("m3", ME, "Retry me", "2026-09-15T10:02:00.000000Z"),
      });
    renderThread();
    await act(async () => {});

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Retry me" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
    expect(screen.getByText(/didn't send/)).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Retry me");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
    const [first, second] = sendMessage.mock.calls.map((c) => (c[0] as { clientKey: string }).clientKey);
    expect(second).toBe(first);
    expect(screen.getAllByText("Retry me")).toHaveLength(1);
  });

  it("fills in what arrived while the channel was connecting, with no event at all", async () => {
    getThreadPage.mockResolvedValue({
      messages: [msg("m4", THEM, "Sent while you were offline", "2026-09-15T10:03:00.000000Z")],
      hasOlder: false,
    });
    renderThread();
    await act(async () => {});
    await act(async () => {});
    expect(getThreadPage).toHaveBeenCalledWith({ conversationId: CONVERSATION });
    expect(screen.getByText("Sent while you were offline")).toBeTruthy();
  });
});

describe("Composer attachments (Part 2)", () => {
  const PATH = `${CONVERSATION}/55555555-5555-4555-8555-555555555555/scan.png`;

  it("uploads once and keeps the path and client key across a failed send", async () => {
    createAttachmentUpload.mockResolvedValue({ ok: true, path: PATH, token: "signed-token" });
    const sent = msg("m9", ME, null, "2026-09-15T10:09:00.000000Z");
    sent.attachment = { name: "scan.png", kind: "image" };
    sendMessage.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true, message: sent });
    getAttachmentUrl.mockResolvedValue("https://signed.example/scan.png");
    renderThread([]);
    await act(async () => {});

    const file = new File(["png"], "scan.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Attach a file"), { target: { files: [file] } });
    });
    expect(screen.getByText("scan.png")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
    expect(screen.getByText(/didn't send/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });

    expect(createAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(uploadToSignedUrl.mock.calls[0][0]).toBe(PATH);
    expect(uploadToSignedUrl.mock.calls[0][1]).toBe("signed-token");
    const calls = sendMessage.mock.calls.map((c) => c[0] as { attachmentPath: string; clientKey: string });
    expect(calls).toHaveLength(2);
    expect(calls[1].attachmentPath).toBe(PATH);
    expect(calls[1].clientKey).toBe(calls[0].clientKey);
  });

  it("refuses a file type that isn't allowed before anything is uploaded", async () => {
    renderThread([]);
    await act(async () => {});
    const file = new File(["<script>"], "page.html", { type: "text/html" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Attach a file"), { target: { files: [file] } });
    });
    expect(screen.getByText("You can attach jpg, png or PDF files.")).toBeTruthy();
    expect(createAttachmentUpload).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an image attachment through a signed link from the action", async () => {
    const withImage = msg("m10", THEM, null, "2026-09-15T10:10:00.000000Z");
    withImage.attachment = { name: "diagram.png", kind: "image" };
    getAttachmentUrl.mockResolvedValue("https://signed.example/diagram.png");
    renderThread([withImage]);
    await act(async () => {});
    await act(async () => {});
    expect(getAttachmentUrl).toHaveBeenCalledWith({ messageId: "m10", conversationId: CONVERSATION });
    const img = screen.getByAltText("diagram.png") as HTMLImageElement;
    expect(img.src).toBe("https://signed.example/diagram.png");
  });
});

describe("mergeMessages", () => {
  it("dedupes by id and orders by time, then id", () => {
    const a = msg("a", ME, "1", "2026-09-15T10:00:00.000001Z");
    const b = msg("b", THEM, "2", "2026-09-15T10:00:00.000002Z");
    const c = msg("c", THEM, "3", "2026-09-15T10:00:00.000002Z");
    const merged = mergeMessages([b, a], [c, a, b]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("returns the same array when nothing comes in", () => {
    const current = [msg("a", ME, "1", "2026-09-15T10:00:00.000000Z")];
    expect(mergeMessages(current, [])).toBe(current);
  });
});
