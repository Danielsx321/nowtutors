"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  EmailNotVerifiedError,
  getSessionProfile,
  requireRole,
  requireVerifiedEmail,
} from "@/lib/auth/guards";
import {
  broadcastRunner,
  isBroadcastWatchable,
  raisePeakViewers,
} from "@/db/queries/broadcasts";
import { MAX_REPORTED_VIEWERS } from "@/lib/broadcasts/presence";
import {
  broadcastRefusalMessage,
  endBroadcast as endBroadcastCore,
  startBroadcast as startBroadcastCore,
} from "@/lib/broadcasts/service";

/**
 * Live broadcast server actions (SPEC §7.8; Phase 9 Part 3).
 *
 * **Identity always comes from the session** (§5 Layer 2). Starting needs an
 * approved tutor with a verified email, the same gate as going live for instant
 * sessions (§7.1). Ending and reporting the viewer count relax approval: they
 * are authorized by owning the broadcast, and a tutor whose approval changed
 * mid-broadcast must still be able to end it.
 */

const uuid = z.string().uuid();

function revalidateLiveLists() {
  revalidatePath("/live");
  revalidatePath("/tutors");
  revalidatePath("/");
  revalidatePath("/tutor");
  revalidatePath("/tutor/broadcasts");
}

export type StartBroadcastResult =
  | { ok: true; broadcastId: string; href: string }
  | { error: string; liveBroadcastHref?: string };

const startSchema = z.object({
  // The service trims and enforces the real limits; these only stop an absurd payload.
  title: z.string().max(1000),
  description: z.string().max(10_000).optional(),
  subjectId: z.union([uuid, z.literal("")]).optional(),
});

export async function startBroadcast(input: {
  title: string;
  description?: string;
  subjectId?: string;
}): Promise<StartBroadcastResult> {
  let tutorId: string;
  try {
    const { user } = await requireRole("tutor");
    await requireVerifiedEmail();
    tutorId = user.id;
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return { error: err.message };
    throw err; // a redirect (not signed in / wrong role / unapproved) must propagate
  }

  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { error: broadcastRefusalMessage("title_length") };

  const res = await startBroadcastCore(broadcastRunner, {
    tutorId,
    title: parsed.data.title,
    description: parsed.data.description,
    subjectId: parsed.data.subjectId || null,
  });
  if (!res.ok) {
    return {
      error: broadcastRefusalMessage(res.reason),
      liveBroadcastHref: res.liveBroadcastId ? `/broadcast/${res.liveBroadcastId}` : undefined,
    };
  }

  revalidateLiveLists();
  return { ok: true, broadcastId: res.broadcastId, href: `/broadcast/${res.broadcastId}` };
}

export type EndBroadcastResult = { ok: true; alreadyEnded: boolean } | { error: string };

export async function endBroadcast(input: { broadcastId: string }): Promise<EndBroadcastResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const parsed = z.object({ broadcastId: uuid }).safeParse(input);
  if (!parsed.success) return { error: broadcastRefusalMessage("not_found") };

  const res = await endBroadcastCore(broadcastRunner, {
    tutorId: user.id,
    broadcastId: parsed.data.broadcastId,
  });
  if (!res.ok) return { error: broadcastRefusalMessage(res.reason) };

  revalidateLiveLists();
  return { ok: true, alreadyEnded: res.alreadyEnded };
}

export type ReportViewerCountResult = { ok: true; peakViewers: number } | { error: string };

/**
 * The host's client reports a new high in the Presence count. Only raises
 * `peak_viewers`, only for the host, only while live, capped. Display data.
 */
export async function reportViewerCount(input: {
  broadcastId: string;
  count: number;
}): Promise<ReportViewerCountResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const parsed = z
    .object({ broadcastId: uuid, count: z.number().int().min(0) })
    .safeParse(input);
  if (!parsed.success) return { error: "Couldn't record the viewer count." };

  const peak = await raisePeakViewers(
    parsed.data.broadcastId,
    user.id,
    Math.min(parsed.data.count, MAX_REPORTED_VIEWERS),
  );
  if (peak === null) return { error: "This broadcast isn't live." };
  return { ok: true, peakViewers: peak };
}

/**
 * Can this broadcast be watched right now? The viewer page asks when Agora says
 * the host left or stopped their video, instead of polling. Called unawaited by
 * a client hook, so it reads the session rather than redirecting.
 */
export async function getBroadcastWatchable(input: {
  broadcastId: string;
}): Promise<{ watchable: boolean }> {
  const profile = await getSessionProfile();
  const parsed = z.object({ broadcastId: uuid }).safeParse(input);
  if (!profile || !parsed.success) return { watchable: false };
  return { watchable: await isBroadcastWatchable(parsed.data.broadcastId) };
}
