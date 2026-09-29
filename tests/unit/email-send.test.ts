import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail, type SendDeps } from "@/lib/email/send";
import type { EmailMessage, EmailTransport, Recipient } from "@/lib/email/types";

/**
 * The sender's contract (SPEC §11): best-effort, never throws, honours
 * preferences, reports what happened. The transport is a fake; nothing here
 * touches Resend, the database or the network.
 */

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

function recipient(over: Partial<Recipient> = {}): Recipient {
  return {
    id: randomUUID(),
    email: "tina@example.com",
    fullName: "Tina Reyes",
    displayName: null,
    timezone: "Europe/Madrid",
    notificationPreferences: {},
    ...over,
  };
}

function fakeTransport(impl?: EmailTransport["send"]) {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    name: "fake",
    send: impl ?? (async (m) => {
      sent.push(m);
      return { ok: true, id: "msg_1" };
    }),
  };
  return { transport, sent };
}

function deps(over: Partial<SendDeps> = {}, r: Recipient | null = recipient()): SendDeps {
  const { transport } = fakeTransport();
  return {
    transport,
    configured: true,
    sender: { from: "NowTutors <hello@nowtutors.test>", replyTo: "support@nowtutors.test" },
    getRecipient: async () => r,
    getAdminRecipients: async () => [],
    appUrl: (path = "/") => `https://nowtutors.test${path}`,
    ...over,
  };
}

const approved = (userId: string) => ({ type: "tutor-approved" as const, to: { userId }, props: {} });

beforeEach(() => vi.clearAllMocks());

describe("sendEmail", () => {
  it("renders and hands a full message to the transport", async () => {
    const r = recipient();
    const { transport, sent } = fakeTransport();
    const out = await sendEmail(approved(r.id), deps({ transport }, r));
    expect(out).toEqual({ sent: true, id: "msg_1", to: "tina@example.com" });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.from).toBe("NowTutors <hello@nowtutors.test>");
    expect(m.replyTo).toBe("support@nowtutors.test");
    expect(m.to).toBe("tina@example.com");
    expect(m.subject).toBe("You're approved to teach on NowTutors");
    expect(m.html).toContain("https://nowtutors.test/tutor");
    expect(m.text).toMatch(/tina/i);
    expect(m.html).not.toContain("—");
  });

  it("reports no_recipient for an unknown user and sends nothing", async () => {
    const { transport, sent } = fakeTransport();
    const out = await sendEmail(approved(randomUUID()), deps({ transport }, null));
    expect(out).toEqual({ sent: false, reason: "no_recipient" });
    expect(sent).toHaveLength(0);
  });

  it("goes to every active admin for an admin audience", async () => {
    const { transport, sent } = fakeTransport();
    const admins = [recipient({ email: "a@x.test" }), recipient({ email: "b@x.test" })];
    const out = await sendEmail(
      {
        type: "admin-new-withdrawal",
        to: { admins: true },
        props: { tutorName: "Tina Reyes", amountCredits: 23, amountUsd: "30.66" },
      },
      deps({ transport, getAdminRecipients: async () => admins }),
    );
    expect(out.sent).toBe(true);
    expect(sent.map((m) => m.to)).toEqual(["a@x.test", "b@x.test"]);
    expect(sent[0].subject).toBe("New withdrawal request: $30.66 from Tina Reyes");
  });

  it("never throws when the transport throws, and reports transport_error", async () => {
    const { transport } = fakeTransport(async () => {
      throw new Error("socket hang up");
    });
    const out = await sendEmail(approved(recipient().id), deps({ transport }));
    expect(out).toMatchObject({ sent: false, reason: "transport_error" });
  });

  it("reports transport_error when the API refuses", async () => {
    const { transport } = fakeTransport(async () => ({ ok: false, error: "validation_error: bad from" }));
    const out = await sendEmail(approved(recipient().id), deps({ transport }));
    expect(out).toMatchObject({ sent: false, reason: "transport_error" });
  });

  it("reports not_configured, after rendering, when the key is unset (log-only)", async () => {
    const { transport, sent } = fakeTransport();
    const out = await sendEmail(approved(recipient().id), deps({ transport, configured: false }));
    expect(out).toMatchObject({ sent: false, reason: "not_configured" });
    expect(sent).toHaveLength(1);
  });

  it("reports not_configured and sends nothing when EMAIL_FROM is unset", async () => {
    const { transport, sent } = fakeTransport();
    const out = await sendEmail(approved(recipient().id), deps({ transport, sender: null }));
    expect(out).toMatchObject({ sent: false, reason: "not_configured" });
    expect(sent).toHaveLength(0);
  });

  it("reports render_error when a link cannot be built, and sends nothing", async () => {
    const { transport, sent } = fakeTransport();
    const out = await sendEmail(
      approved(recipient().id),
      deps({
        transport,
        appUrl: () => {
          throw new Error("NEXT_PUBLIC_APP_URL is not set");
        },
      }),
    );
    expect(out).toMatchObject({ sent: false, reason: "render_error" });
    expect(sent).toHaveLength(0);
  });

  it("survives a recipient lookup that throws", async () => {
    const out = await sendEmail(
      approved(randomUUID()),
      deps({
        getRecipient: async () => {
          throw new Error("db down");
        },
      }),
    );
    expect(out).toEqual({ sent: false, reason: "no_recipient" });
  });
});
