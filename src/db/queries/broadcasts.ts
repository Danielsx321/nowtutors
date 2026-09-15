import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { bookings, broadcasts, sessionRequests, subjects, tutorProfiles } from "@/db/schema";
import { pgErrorCode } from "@/lib/credits/ledger";
import type { BroadcastAccessRow } from "@/lib/broadcasts/access";
import {
  AlreadyLiveError,
  type BroadcastLockRow,
  type BroadcastRunner,
  type BroadcastStore,
  type HostProfile,
} from "@/lib/broadcasts/service";

/**
 * The Drizzle adapter for live broadcasts (SPEC §4.6, §7.8; Phase 9 Part 3).
 * The rules live in `lib/broadcasts/`; this file says how each step reaches
 * Postgres, plus the reads the pages and the token route need.
 *
 * **Trusted server connection only.** `drizzle/0018` revoked every client write
 * on `broadcasts` and `broadcast_viewers`. Every caller has derived the viewer
 * from the session first.
 *
 * **"Live" for anyone but the host is derived**, as for tutors (§3.1): the row
 * is `live` AND the host is in `live_tutors` with `live_mode = 'broadcast'`. The
 * fragment below is the one place that says so.
 */

const UNIQUE_VIOLATION = "23505";

/** The host of `b` is fresh and broadcasting. `b` must be the broadcasts alias. */
const hostFreshSql = sql`exists (
  select 1 from public.live_tutors lt
   where lt.user_id = b.tutor_id and lt.live_mode = 'broadcast'
)`;

function broadcastStore(tx: DbTransaction): BroadcastStore {
  return {
    async lockHost(tutorId): Promise<HostProfile | null> {
      // Locks the tutor_profiles row only. The accept transaction takes the same
      // lock, which is what serializes a start against an instant accept.
      const rows = await tx.execute<{
        user_id: string;
        role: HostProfile["role"];
        is_suspended: boolean;
        approval_status: string | null;
      }>(sql`
        select tp.user_id, p.role, p.is_suspended, tp.approval_status
          from tutor_profiles tp
          join profiles p on p.id = tp.user_id
         where tp.user_id = ${tutorId}
           for update of tp
      `);
      const r = rows[0];
      if (!r) return null;
      return {
        userId: r.user_id,
        role: r.role,
        isSuspended: r.is_suspended,
        approvalStatus: r.approval_status,
      };
    },

    async hasInProgressBooking(tutorId): Promise<boolean> {
      const [row] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.tutorId, tutorId), eq(bookings.status, "in_progress")))
        .limit(1);
      return row != null;
    },

    async findLiveBroadcastId(tutorId): Promise<string | null> {
      const [row] = await tx
        .select({ id: broadcasts.id })
        .from(broadcasts)
        .where(and(eq(broadcasts.tutorId, tutorId), eq(broadcasts.status, "live")))
        .limit(1);
      return row?.id ?? null;
    },

    async isSubjectActive(subjectId): Promise<boolean> {
      const [row] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, subjectId), eq(subjects.isActive, true)))
        .limit(1);
      return row != null;
    },

    async insertLiveBroadcast(row) {
      try {
        // The id is generated in the statement so the channel can be derived
        // from it in the same INSERT. No caller, and no client, names a channel.
        const rows = await tx.execute<{ id: string; agora_channel: string }>(sql`
          insert into broadcasts (id, tutor_id, title, description, subject_id, agora_channel, status, started_at)
          select g.id, ${row.tutorId}::uuid, ${row.title}, ${row.description},
                 ${row.subjectId}::uuid, 'broadcast_' || g.id::text, 'live', now()
            from (select gen_random_uuid() as id) g
          returning id, agora_channel
        `);
        const r = rows[0];
        if (!r) throw new Error("broadcast insert returned no row");
        return { id: r.id, agoraChannel: r.agora_channel };
      } catch (err) {
        // The channel is derived from a fresh uuid, so the only unique index
        // this insert can hit is broadcasts_one_live_per_tutor.
        if (pgErrorCode(err) === UNIQUE_VIOLATION) throw new AlreadyLiveError(row.tutorId);
        throw err;
      }
    },

    async markTutorBroadcasting(tutorId): Promise<void> {
      await tx
        .update(tutorProfiles)
        .set({ isLive: true, liveMode: "broadcast", lastSeenAt: sql`now()` })
        .where(eq(tutorProfiles.userId, tutorId));
    },

    async expirePendingRequests(tutorId): Promise<number> {
      const rows = await tx
        .update(sessionRequests)
        .set({ status: "expired", updatedAt: sql`now()` })
        .where(and(eq(sessionRequests.tutorId, tutorId), eq(sessionRequests.status, "pending")))
        .returning({ id: sessionRequests.id });
      return rows.length;
    },

    async lockBroadcast(broadcastId): Promise<BroadcastLockRow | null> {
      const [row] = await tx
        .select({ id: broadcasts.id, tutorId: broadcasts.tutorId, status: broadcasts.status })
        .from(broadcasts)
        .where(eq(broadcasts.id, broadcastId))
        .for("update")
        .limit(1);
      return row ?? null;
    },

    async markEnded(broadcastId): Promise<void> {
      await tx
        .update(broadcasts)
        .set({ status: "ended", endedAt: sql`now()` })
        .where(eq(broadcasts.id, broadcastId));
    },

    async clearTutorBroadcasting(tutorId): Promise<void> {
      await tx
        .update(tutorProfiles)
        .set({ isLive: false, liveMode: null })
        .where(and(eq(tutorProfiles.userId, tutorId), eq(tutorProfiles.liveMode, "broadcast")));
    },
  };
}

export const broadcastRunner: BroadcastRunner = (fn) =>
  db.transaction((tx) => fn(broadcastStore(tx)));

// ── The token route ──────────────────────────────────────────────────────────

/** What `checkBroadcastAccess` reads, or null for a missing broadcast. */
export async function getBroadcastAccessRow(broadcastId: string): Promise<BroadcastAccessRow | null> {
  const rows = await db.execute<{
    id: string;
    tutor_id: string;
    status: string;
    agora_channel: string;
    host_fresh: boolean;
  }>(sql`
    select b.id, b.tutor_id, b.status, b.agora_channel, ${hostFreshSql} as host_fresh
      from broadcasts b
     where b.id = ${broadcastId}
     limit 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tutorId: r.tutor_id,
    status: r.status,
    agoraChannel: r.agora_channel,
    hostFresh: r.host_fresh === true,
  };
}

/**
 * Record a signed-in viewer joining. One open row per viewer per broadcast, so a
 * refresh or a token renewal doesn't add another. A rare concurrent double
 * insert is harmless: the rows are a record, and the count on screen comes from
 * Presence.
 */
export async function stampBroadcastViewer(broadcastId: string, userId: string): Promise<void> {
  await db.execute(sql`
    insert into broadcast_viewers (broadcast_id, user_id)
    select ${broadcastId}::uuid, ${userId}::uuid
     where not exists (
       select 1 from broadcast_viewers v
        where v.broadcast_id = ${broadcastId}::uuid
          and v.user_id = ${userId}::uuid
          and v.left_at is null
     )
  `);
}

// ── Pages ────────────────────────────────────────────────────────────────────

export interface LiveBroadcastCard {
  id: string;
  title: string;
  subjectName: string | null;
  startedAt: Date | null;
  tutorName: string;
  tutorAvatarUrl: string | null;
  tutorSlug: string | null;
}

/** `/live`: broadcasts that are live with a fresh host, newest first. */
export async function listLiveBroadcasts(): Promise<LiveBroadcastCard[]> {
  const rows = await db.execute<{
    id: string;
    title: string | null;
    subject_name: string | null;
    started_at: string | null;
    display_name: string | null;
    avatar_url: string | null;
    slug: string | null;
  }>(sql`
    select b.id, b.title, s.name as subject_name, b.started_at::text as started_at,
           pp.display_name, pp.avatar_url, tp.slug
      from broadcasts b
      join tutor_profiles tp on tp.user_id = b.tutor_id
      left join public_profiles pp on pp.id = b.tutor_id
      left join subjects s on s.id = b.subject_id
     where b.status = 'live'
       and ${hostFreshSql}
     order by b.started_at desc nulls last
     limit 50
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? "Live broadcast",
    subjectName: r.subject_name,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    tutorName: r.display_name ?? "Tutor",
    tutorAvatarUrl: r.avatar_url,
    tutorSlug: r.slug,
  }));
}

export interface BroadcastPageData {
  id: string;
  tutorId: string;
  title: string;
  description: string | null;
  subjectName: string | null;
  status: "live" | "ended";
  startedAt: Date | null;
  endedAt: Date | null;
  peakViewers: number;
  /** Live and the host is fresh: what a viewer can actually watch. */
  watchable: boolean;
  tutorName: string;
  tutorAvatarUrl: string | null;
  tutorSlug: string | null;
}

/** One broadcast for `/live/[id]` and the host view, or null. */
export async function getBroadcastPage(broadcastId: string): Promise<BroadcastPageData | null> {
  const rows = await db.execute<{
    id: string;
    tutor_id: string;
    title: string | null;
    description: string | null;
    subject_name: string | null;
    status: "live" | "ended";
    started_at: string | null;
    ended_at: string | null;
    peak_viewers: number;
    host_fresh: boolean;
    display_name: string | null;
    avatar_url: string | null;
    slug: string | null;
  }>(sql`
    select b.id, b.tutor_id, b.title, b.description, s.name as subject_name, b.status,
           b.started_at::text as started_at, b.ended_at::text as ended_at, b.peak_viewers,
           ${hostFreshSql} as host_fresh,
           pp.display_name, pp.avatar_url, tp.slug
      from broadcasts b
      left join tutor_profiles tp on tp.user_id = b.tutor_id
      left join public_profiles pp on pp.id = b.tutor_id
      left join subjects s on s.id = b.subject_id
     where b.id = ${broadcastId}
     limit 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tutorId: r.tutor_id,
    title: r.title ?? "Live broadcast",
    description: r.description,
    subjectName: r.subject_name,
    status: r.status,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    endedAt: r.ended_at ? new Date(r.ended_at) : null,
    peakViewers: Number(r.peak_viewers),
    watchable: r.status === "live" && r.host_fresh === true,
    tutorName: r.display_name ?? "Tutor",
    tutorAvatarUrl: r.avatar_url,
    tutorSlug: r.slug,
  };
}

/** The tutor's own live broadcast id, fresh or not (for "Return to your broadcast"). */
export async function getOwnLiveBroadcastId(tutorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.tutorId, tutorId), eq(broadcasts.status, "live")))
    .limit(1);
  return row?.id ?? null;
}

/** Whether a viewer can watch right now. The viewer page's re-read when the host drops. */
export async function isBroadcastWatchable(broadcastId: string): Promise<boolean> {
  const rows = await db.execute<{ watchable: boolean }>(sql`
    select (b.status = 'live' and ${hostFreshSql}) as watchable
      from broadcasts b
     where b.id = ${broadcastId}
  `);
  return rows[0]?.watchable === true;
}

export interface PastBroadcastRow {
  id: string;
  title: string;
  status: "live" | "ended";
  startedAt: Date | null;
  endedAt: Date | null;
  peakViewers: number;
}

/** The tutor's broadcasts, newest first, for `/tutor/broadcasts`. */
export async function listTutorBroadcasts(tutorId: string): Promise<PastBroadcastRow[]> {
  const rows = await db
    .select({
      id: broadcasts.id,
      title: broadcasts.title,
      status: broadcasts.status,
      startedAt: broadcasts.startedAt,
      endedAt: broadcasts.endedAt,
      peakViewers: broadcasts.peakViewers,
    })
    .from(broadcasts)
    .where(eq(broadcasts.tutorId, tutorId))
    .orderBy(desc(broadcasts.startedAt))
    .limit(50);
  return rows.map((r) => ({ ...r, title: r.title ?? "Live broadcast" }));
}

/** Active subjects for the start form, in the canonical order. */
export async function listActiveSubjects(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.isActive, true))
    .orderBy(asc(subjects.sortOrder));
}

/**
 * Raise `peak_viewers` to `count` if it is higher. Host-only and live-only in
 * the WHERE clause, so a stranger or a late report changes nothing. Returns the
 * stored peak, or null when nothing matched.
 */
export async function raisePeakViewers(
  broadcastId: string,
  tutorId: string,
  count: number,
): Promise<number | null> {
  const [row] = await db
    .update(broadcasts)
    .set({ peakViewers: sql`greatest(${broadcasts.peakViewers}, ${count}::int)` })
    .where(
      and(
        eq(broadcasts.id, broadcastId),
        eq(broadcasts.tutorId, tutorId),
        eq(broadcasts.status, "live"),
      ),
    )
    .returning({ peakViewers: broadcasts.peakViewers });
  return row?.peakViewers ?? null;
}

// ── The sweep ────────────────────────────────────────────────────────────────

/**
 * `sweep-presence`'s broadcast half (SPEC §7.5, §7.8, §12): a `live` broadcast
 * whose host is no longer a fresh `broadcast`-mode row in `live_tutors` is
 * `ended`. Viewers already stopped getting tokens at read time; this tidies the
 * row. Idempotent: the predicate stops matching what it just ended.
 */
export async function endStaleBroadcasts(): Promise<{ endedIds: string[] }> {
  const rows = await db.execute<{ id: string }>(sql`
    update broadcasts b
       set status = 'ended', ended_at = now()
     where b.status = 'live'
       and not ${hostFreshSql}
    returning b.id
  `);
  return { endedIds: rows.map((r) => r.id) };
}
