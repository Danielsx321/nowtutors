"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { withdrawalRunner } from "@/db/queries/withdrawals";
import {
  approveWithdrawal as approveCore,
  markWithdrawalPaid as markPaidCore,
  rejectWithdrawal as rejectCore,
  withdrawalRefusalMessage,
  type TransitionResult,
} from "@/lib/withdrawals/withdrawals";

export type AdminWithdrawalResult = { error: string } | { ok: true };

const idSchema = z.object({ id: z.string().uuid() });
const paidSchema = idSchema.extend({ externalReference: z.string().max(200) });
const rejectSchema = idSchema.extend({ note: z.string().max(2000) });

/**
 * The admin withdrawal queue (SPEC §6 `/admin/withdrawals`, §7.11; Phase 8
 * Part 2): approve → mark paid, or reject.
 *
 * `requireRole('admin')` is the FIRST statement of each (the layout guard is
 * only a redirect, §5 Layer 2). The request id is a legitimate client input; the
 * ACTOR is always the guard's user. The rules, the row lock and the audit row
 * live in `lib/withdrawals/withdrawals.ts`.
 */

function done(res: TransitionResult): AdminWithdrawalResult {
  revalidatePath("/admin/withdrawals");
  revalidatePath("/tutor/withdrawals");
  revalidatePath("/tutor/earnings");
  return res.ok ? { ok: true } : { error: withdrawalRefusalMessage(res.reason) };
}

export async function approveWithdrawal(input: {
  id: string;
}): Promise<AdminWithdrawalResult> {
  const { user } = await requireRole("admin");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid withdrawal." };
  return done(await approveCore(withdrawalRunner, { id: parsed.data.id, adminId: user.id }));
}

export async function markWithdrawalPaid(input: {
  id: string;
  externalReference: string;
}): Promise<AdminWithdrawalResult> {
  const { user } = await requireRole("admin");
  const parsed = paidSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid withdrawal or reference." };
  const res = await markPaidCore(withdrawalRunner, {
    id: parsed.data.id,
    adminId: user.id,
    externalReference: parsed.data.externalReference,
  });
  // TODO(Phase 10): "withdrawal paid" email to the tutor (SPEC §11).
  return done(res);
}

export async function rejectWithdrawal(input: {
  id: string;
  note: string;
}): Promise<AdminWithdrawalResult> {
  const { user } = await requireRole("admin");
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid withdrawal or note." };
  const res = await rejectCore(withdrawalRunner, {
    id: parsed.data.id,
    adminId: user.id,
    note: parsed.data.note,
  });
  // TODO(Phase 10): "withdrawal rejected" email with the note (SPEC §11).
  return done(res);
}
