import "server-only";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, profiles } from "@/db/schema";

/**
 * `/admin/audit` reads (SPEC §4.7, §6; Phase 8 Part 4). Read-only: `audit_log`
 * is append-only and nothing here writes.
 *
 * The action filter is by **prefix**, the part before the first dot
 * (`withdrawal` matches `withdrawal.approve` and `withdrawal.reject`), compared
 * with `split_part` rather than `LIKE`, so an underscore or percent in a prefix
 * can never act as a wildcard.
 */

export const AUDIT_PAGE_SIZE = 25;

export interface AuditFilter {
  actionPrefix?: string | null;
  actorId?: string | null;
  page?: number;
}

export interface AuditEntry {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
}

function filterSql(f: AuditFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (f.actionPrefix) {
    conditions.push(sql`split_part(${auditLog.action}, '.', 1) = ${f.actionPrefix}`);
  }
  if (f.actorId) conditions.push(eq(auditLog.actorId, f.actorId));
  return conditions.length ? and(...conditions) : undefined;
}

export async function listAuditLog(f: AuditFilter): Promise<{
  entries: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const where = filterSql(f);

  const [[totalRow], entries] = await Promise.all([
    db.select({ n: count() }).from(auditLog).where(where),
    db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        payload: auditLog.payload,
        ip: auditLog.ip,
        actorId: auditLog.actorId,
        actorName: profiles.displayName,
        actorEmail: profiles.email,
      })
      .from(auditLog)
      .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
      .where(where)
      // id breaks ties so rows written in one transaction page stably.
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
  ]);

  const total = Number(totalRow?.n ?? 0);
  return {
    entries,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/** The prefixes and actors that actually appear, for the filter chips. */
export async function listAuditFacets(): Promise<{
  prefixes: { prefix: string; count: number }[];
  actors: { id: string; name: string | null; email: string; count: number }[];
}> {
  const prefix = sql<string>`split_part(${auditLog.action}, '.', 1)`;
  const [prefixes, actors] = await Promise.all([
    db
      .select({ prefix, count: count() })
      .from(auditLog)
      .groupBy(prefix)
      .orderBy(prefix),
    db
      .select({
        id: profiles.id,
        name: profiles.displayName,
        email: profiles.email,
        count: count(),
      })
      .from(auditLog)
      .innerJoin(profiles, eq(profiles.id, auditLog.actorId))
      .groupBy(profiles.id, profiles.displayName, profiles.email)
      .orderBy(desc(count())),
  ]);
  return {
    prefixes: prefixes.map((p) => ({ prefix: p.prefix, count: Number(p.count) })),
    actors: actors.map((a) => ({ ...a, count: Number(a.count) })),
  };
}
