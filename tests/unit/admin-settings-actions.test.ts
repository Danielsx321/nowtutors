import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization and ordering for the `/admin/settings` actions (SPEC §5 Layer 2,
 * §12; Phase 8 Part 4). The guard must run before any input is trusted, any job
 * runs or any row is touched, and the audit actor must come from the guard.
 *
 * Everything below the action is mocked: the job bodies, the database and the
 * guard. What's under test is the action's own order of operations.
 */

const m = vi.hoisted(() => ({
  calls: [] as string[],
  requireRole: vi.fn(),
  runCronJob: vi.fn(),
  reportCronFailure: vi.fn(),
  insertValues: vi.fn(),
  transaction: vi.fn(),
  applySettingUpdate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireRole: (...args: unknown[]) => {
    m.calls.push("guard");
    return m.requireRole(...args);
  },
}));
vi.mock("@/lib/cron/jobs", () => ({
  runCronJob: (...args: unknown[]) => {
    m.calls.push("job");
    return m.runCronJob(...args);
  },
  reportCronFailure: (...args: unknown[]) => m.reportCronFailure(...args),
  cronFailureMessage: () => "Sweep failed.",
}));
vi.mock("@/db/schema", () => ({ auditLog: { table: "audit_log" } }));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        m.calls.push("audit");
        return m.insertValues(v);
      },
    }),
    transaction: (fn: (tx: unknown) => unknown) => {
      m.calls.push("transaction");
      return m.transaction(fn);
    },
  },
}));
vi.mock("@/db/queries/admin-settings", () => ({
  applySettingUpdate: (...args: unknown[]) => m.applySettingUpdate(...args),
}));

const { runCronNow, updateSetting } = await import("@/actions/admin-settings");

const ADMIN = { user: { id: "admin-1" }, profile: { role: "admin" } };
const redirect = () => Promise.reject(new Error("NEXT_REDIRECT"));

beforeEach(() => {
  vi.clearAllMocks();
  m.calls.length = 0;
  m.requireRole.mockResolvedValue(ADMIN);
  m.insertValues.mockResolvedValue(undefined);
  m.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn("tx"));
});

describe("runCronNow", () => {
  it("a non-admin is refused before any job runs or any audit row is written", async () => {
    m.requireRole.mockImplementation(redirect);
    await expect(runCronNow({ job: "release-earnings" })).rejects.toThrow("NEXT_REDIRECT");
    expect(m.requireRole).toHaveBeenCalledWith("admin");
    expect(m.calls).toEqual(["guard"]);
  });

  it("the guard runs before the job name is even checked", async () => {
    m.requireRole.mockImplementation(redirect);
    await expect(runCronNow({ job: "nope" })).rejects.toThrow("NEXT_REDIRECT");
    expect(m.calls).toEqual(["guard"]);
  });

  it("an unknown job is refused without running anything", async () => {
    expect(await runCronNow({ job: "../reconcile-wallets" })).toEqual({ error: "Unknown job." });
    expect(m.calls).toEqual(["guard"]);
  });

  it("runs the job, then audits it with the guard's user as actor", async () => {
    const summary = { ok: true, job: "expire-unpaid", expired: 0, durationMs: 3 };
    m.runCronJob.mockResolvedValue(summary);
    const res = await runCronNow({ job: "expire-unpaid", actorId: "someone-else" } as { job: string });
    expect(res).toEqual({ ok: true, summary });
    expect(m.calls).toEqual(["guard", "job", "audit"]);
    expect(m.runCronJob).toHaveBeenCalledWith("expire-unpaid");
    expect(m.insertValues).toHaveBeenCalledWith({
      actorId: "admin-1",
      action: "cron.run_now",
      targetType: "cron_job",
      targetId: null,
      payload: { job: "expire-unpaid", summary },
    });
  });

  it("a job that throws is reported, audited as a failure and answered without detail", async () => {
    const boom = new Error("connection reset by 10.0.0.3");
    m.runCronJob.mockRejectedValue(boom);
    const res = await runCronNow({ job: "reconcile-wallets" });
    expect(res).toEqual({ error: "Sweep failed." });
    expect(m.reportCronFailure).toHaveBeenCalledWith("reconcile-wallets", boom);
    expect(m.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { job: "reconcile-wallets", error: "Sweep failed." } }),
    );
  });

  it("says the job ran when only the audit insert failed", async () => {
    m.runCronJob.mockResolvedValue({ ok: true, job: "expire-requests", durationMs: 1 });
    m.insertValues.mockRejectedValue(new Error("audit down"));
    const res = await runCronNow({ job: "expire-requests" });
    expect(res).toEqual({ error: "The job ran, but the audit row could not be written." });
  });
});

describe("updateSetting", () => {
  it("a non-admin is refused before any database work", async () => {
    m.requireRole.mockImplementation(redirect);
    await expect(
      updateSetting({ key: "platform_fee_percent", value: "0", expected: "25" }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(m.calls).toEqual(["guard"]);
    expect(m.applySettingUpdate).not.toHaveBeenCalled();
  });

  it("an invalid value is refused before the transaction opens", async () => {
    const res = await updateSetting({ key: "platform_fee_percent", value: "250", expected: "25" });
    expect(res).toEqual({ error: "Must be at most 100 percent." });
    expect(m.calls).toEqual(["guard"]);
  });

  it("an unknown or read-only key is refused before the transaction opens", async () => {
    expect("error" in (await updateSetting({ key: "credit_usd_rate", value: "1", expected: null }))).toBe(true);
    expect("error" in (await updateSetting({ key: "cancellation_enabled", value: "true", expected: "false" }))).toBe(true);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("an `expected` that isn't JSON is refused before the transaction opens", async () => {
    const res = await updateSetting({ key: "platform_fee_percent", value: "20", expected: "{oops" });
    expect(res).toEqual({ error: "Invalid setting." });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("writes the parsed value with the guard's user as actor", async () => {
    m.applySettingUpdate.mockResolvedValue({ ok: true, changed: true });
    const res = await updateSetting({ key: "min_withdrawal_usd", value: "35", expected: "30" });
    expect(res).toEqual({ ok: true, changed: true });
    expect(m.calls).toEqual(["guard", "transaction"]);
    expect(m.applySettingUpdate).toHaveBeenCalledWith("tx", {
      key: "min_withdrawal_usd",
      value: 35,
      expected: "30",
      actorId: "admin-1",
    });
  });

  it("a stale save is refused with a reload message", async () => {
    m.applySettingUpdate.mockResolvedValue({ ok: false, reason: "stale" });
    const res = await updateSetting({ key: "min_withdrawal_usd", value: "35", expected: "30" });
    expect(res).toEqual({
      error: "Someone changed this setting after you opened the page. Reload to see the current value.",
    });
  });
});
