import { describe, expect, it } from "vitest";
import {
  AlreadyLiveError,
  broadcastRefusalMessage,
  DESCRIPTION_MAX,
  endBroadcast,
  startBroadcast,
  TITLE_MAX,
  validateBroadcastDetails,
  type BroadcastLockRow,
  type BroadcastRunner,
  type BroadcastStore,
  type EndRefusal,
  type HostProfile,
  type NewBroadcast,
  type StartRefusal,
} from "@/lib/broadcasts/service";

/**
 * Starting and ending a broadcast (SPEC §7.8; Phase 9 Part 3), against an
 * in-memory store. Every refusal writes nothing, a start writes the three
 * things it must (row, live mode, expired requests), and end is host-only and
 * idempotent. The lock and the index are Postgres properties and live in
 * `tests/integration/broadcasts.test.ts`.
 */

const TUTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";

class InMemoryBroadcasts implements BroadcastStore {
  hosts = new Map<string, HostProfile>();
  inProgress = new Set<string>();
  inactiveSubjects = new Set<string>();
  broadcasts: (BroadcastLockRow & NewBroadcast & { agoraChannel: string })[] = [];
  liveMode = new Map<string, "instant" | "broadcast" | null>();
  pendingRequests = new Map<string, number>();
  /** Make the next insert hit the one-live index. */
  failInsertWithIndex = false;
  writes: string[] = [];
  private nextId = 1;

  async lockHost(tutorId: string) {
    return this.hosts.get(tutorId) ?? null;
  }
  async hasInProgressBooking(tutorId: string) {
    return this.inProgress.has(tutorId);
  }
  async findLiveBroadcastId(tutorId: string) {
    return this.broadcasts.find((b) => b.tutorId === tutorId && b.status === "live")?.id ?? null;
  }
  async isSubjectActive(subjectId: string) {
    return !this.inactiveSubjects.has(subjectId);
  }
  async insertLiveBroadcast(row: NewBroadcast) {
    if (this.failInsertWithIndex) throw new AlreadyLiveError(row.tutorId);
    const id = `b${this.nextId++}`;
    this.broadcasts.push({ ...row, id, status: "live", agoraChannel: `broadcast_${id}` });
    this.writes.push("insert");
    return { id, agoraChannel: `broadcast_${id}` };
  }
  async markTutorBroadcasting(tutorId: string) {
    this.liveMode.set(tutorId, "broadcast");
    this.writes.push("mark-broadcasting");
  }
  async expirePendingRequests(tutorId: string) {
    const n = this.pendingRequests.get(tutorId) ?? 0;
    this.pendingRequests.set(tutorId, 0);
    this.writes.push("expire-requests");
    return n;
  }
  async lockBroadcast(id: string) {
    const b = this.broadcasts.find((x) => x.id === id);
    return b ? { id: b.id, tutorId: b.tutorId, status: b.status } : null;
  }
  async markEnded(id: string) {
    this.broadcasts.find((x) => x.id === id)!.status = "ended";
    this.writes.push("mark-ended");
  }
  async clearTutorBroadcasting(tutorId: string) {
    if (this.liveMode.get(tutorId) === "broadcast") this.liveMode.set(tutorId, null);
    this.writes.push("clear-broadcasting");
  }
}

function setup() {
  const store = new InMemoryBroadcasts();
  store.hosts.set(TUTOR, { userId: TUTOR, role: "tutor", isSuspended: false, approvalStatus: "approved" });
  const run: BroadcastRunner = (fn) => fn(store);
  return { store, run };
}

const start = (run: BroadcastRunner, over: Partial<{ title: string; description: string; subjectId: string }> = {}) =>
  startBroadcast(run, { tutorId: TUTOR, title: "Quadratic equations", ...over });

describe("validateBroadcastDetails", () => {
  it("trims the title and bounds it to 3..120 characters", () => {
    expect(validateBroadcastDetails({ title: "  Abc  " })).toMatchObject({ ok: true, title: "Abc" });
    expect(validateBroadcastDetails({ title: "Ab" })).toEqual({ ok: false, reason: "title_length" });
    expect(validateBroadcastDetails({ title: "   ab   " })).toEqual({ ok: false, reason: "title_length" });
    expect(validateBroadcastDetails({ title: "x".repeat(TITLE_MAX) })).toMatchObject({ ok: true });
    expect(validateBroadcastDetails({ title: "x".repeat(TITLE_MAX + 1) })).toEqual({ ok: false, reason: "title_length" });
  });

  it("bounds the description and turns blanks into null", () => {
    expect(validateBroadcastDetails({ title: "Abc", description: "x".repeat(DESCRIPTION_MAX + 1) })).toEqual({
      ok: false,
      reason: "description_length",
    });
    expect(validateBroadcastDetails({ title: "Abc", description: "   ", subjectId: "" })).toEqual({
      ok: true,
      title: "Abc",
      description: null,
      subjectId: null,
    });
  });
});

describe("startBroadcast — refusals write nothing", () => {
  const cases: [string, (s: InMemoryBroadcasts) => void, StartRefusal][] = [
    ["no tutor profile", (s) => s.hosts.delete(TUTOR), "not_tutor"],
    ["a student", (s) => s.hosts.set(TUTOR, { ...s.hosts.get(TUTOR)!, role: "student" }), "not_tutor"],
    ["a suspended tutor", (s) => s.hosts.set(TUTOR, { ...s.hosts.get(TUTOR)!, isSuspended: true }), "suspended"],
    ["an unapproved tutor", (s) => s.hosts.set(TUTOR, { ...s.hosts.get(TUTOR)!, approvalStatus: "pending" }), "not_approved"],
    ["a tutor in an in_progress session", (s) => s.inProgress.add(TUTOR), "in_session"],
  ];

  it.each(cases)("refuses %s", async (_label, arrange, reason) => {
    const { store, run } = setup();
    arrange(store);
    expect(await start(run)).toEqual({ ok: false, reason });
    expect(store.writes).toEqual([]);
  });

  it("refuses an inactive subject", async () => {
    const { store, run } = setup();
    store.inactiveSubjects.add(SUBJECT);
    expect(await start(run, { subjectId: SUBJECT })).toEqual({ ok: false, reason: "subject_unavailable" });
    expect(store.writes).toEqual([]);
  });

  it("refuses a bad title before opening a transaction", async () => {
    let ran = false;
    const run: BroadcastRunner = () => {
      ran = true;
      throw new Error("should not run");
    };
    expect(await start(run, { title: "no" })).toEqual({ ok: false, reason: "title_length" });
    expect(ran).toBe(false);
  });

  it("refuses a second live broadcast and says which one is live", async () => {
    const { store, run } = setup();
    const first = await start(run);
    store.writes = [];
    const second = await start(run);
    expect(first.ok && second).toEqual({
      ok: false,
      reason: "already_live",
      liveBroadcastId: first.ok ? first.broadcastId : undefined,
    });
    expect(store.writes).toEqual([]);
  });

  it("maps the one-live index to already_live", async () => {
    const { store, run } = setup();
    store.failInsertWithIndex = true;
    expect(await start(run)).toEqual({ ok: false, reason: "already_live" });
    expect(store.writes).toEqual([]);
  });
});

describe("startBroadcast — a start", () => {
  it("inserts the live row, puts the tutor in broadcast mode and expires waiting requests", async () => {
    const { store, run } = setup();
    store.pendingRequests.set(TUTOR, 2);
    const res = await start(run, { title: "  Quadratic equations ", subjectId: SUBJECT });
    expect(res).toMatchObject({ ok: true, expiredRequests: 2 });
    expect(store.writes).toEqual(["insert", "mark-broadcasting", "expire-requests"]);
    expect(store.broadcasts[0]).toMatchObject({ tutorId: TUTOR, title: "Quadratic equations", subjectId: SUBJECT, status: "live" });
    expect(store.liveMode.get(TUTOR)).toBe("broadcast");
  });
});

describe("endBroadcast", () => {
  it("ends the host's live broadcast and clears broadcast mode", async () => {
    const { store, run } = setup();
    const started = await start(run);
    if (!started.ok) throw new Error("start failed");
    store.writes = [];
    expect(await endBroadcast(run, { tutorId: TUTOR, broadcastId: started.broadcastId })).toEqual({
      ok: true,
      alreadyEnded: false,
    });
    expect(store.writes).toEqual(["mark-ended", "clear-broadcasting"]);
    expect(store.liveMode.get(TUTOR)).toBeNull();
  });

  it("is idempotent on an ended broadcast", async () => {
    const { store, run } = setup();
    const started = await start(run);
    if (!started.ok) throw new Error("start failed");
    await endBroadcast(run, { tutorId: TUTOR, broadcastId: started.broadcastId });
    store.writes = [];
    expect(await endBroadcast(run, { tutorId: TUTOR, broadcastId: started.broadcastId })).toEqual({
      ok: true,
      alreadyEnded: true,
    });
    expect(store.writes).toEqual([]);
  });

  it("answers someone else's broadcast exactly like a missing one", async () => {
    const { store, run } = setup();
    const started = await start(run);
    if (!started.ok) throw new Error("start failed");
    store.writes = [];
    const foreign = await endBroadcast(run, { tutorId: OTHER, broadcastId: started.broadcastId });
    const missing = await endBroadcast(run, { tutorId: OTHER, broadcastId: "nope" });
    expect(foreign).toEqual({ ok: false, reason: "not_found" });
    expect(missing).toEqual(foreign);
    expect(store.writes).toEqual([]);
  });
});

describe("broadcastRefusalMessage", () => {
  it("has a message for every refusal", () => {
    const reasons: (StartRefusal | EndRefusal)[] = [
      "not_tutor",
      "not_approved",
      "suspended",
      "subject_unavailable",
      "in_session",
      "already_live",
      "title_length",
      "description_length",
      "not_found",
    ];
    for (const r of reasons) expect(broadcastRefusalMessage(r)).toBeTruthy();
  });
});
