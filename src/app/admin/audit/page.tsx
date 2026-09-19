import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { listAuditFacets, listAuditLog } from "@/db/queries/admin-audit";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { auditActionLabel } from "@/lib/admin/audit-labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Audit log · NowTutors" };
export const dynamic = "force-dynamic";

const PREFIX_RE = /^[a-z_]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { action?: string; actor?: string; page?: string };

function href(p: { action?: string | null; actor?: string | null; page?: number }) {
  const q = new URLSearchParams();
  if (p.action) q.set("action", p.action);
  if (p.actor) q.set("actor", p.actor);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? `/admin/audit?${s}` : "/admin/audit";
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring rounded-full border px-3 py-1 text-small font-medium",
        active
          ? "border-ink bg-ink text-on-ink"
          : "border-border text-text hover:bg-surface-muted",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * `/admin/audit` (SPEC §6; Phase 8 Part 4). Newest first, 25 per page,
 * filterable by action prefix and by actor. Filters are links, so a filtered
 * view is shareable. Read-only.
 *
 * `requireRole('admin')` first, independently of the layout (§5 Layer 2).
 * Query params are validated before they reach SQL; anything malformed is
 * ignored rather than erroring.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { user } = await requireRole("admin");
  const params = await searchParams;
  const action = params.action && PREFIX_RE.test(params.action) ? params.action : null;
  const actor = params.actor && UUID_RE.test(params.actor) ? params.actor : null;
  const pageParam = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const [log, facets, [me]] = await Promise.all([
    listAuditLog({ actionPrefix: action, actorId: actor, page }),
    listAuditFacets(),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: safeTimeZone(me?.timezone),
  });

  return (
    <div className="w-full space-y-6 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Audit log</h1>
        <p className="mt-1 text-body text-text-muted">
          Every admin change, newest first. {log.total.toLocaleString()} matching{" "}
          {log.total === 1 ? "entry" : "entries"}.
        </p>
      </div>

      <div className="space-y-3">
        <nav aria-label="Filter by action" className="flex flex-wrap gap-2">
          <Chip to={href({ actor })} active={!action}>
            All actions
          </Chip>
          {facets.prefixes.map((p) => (
            <Chip key={p.prefix} to={href({ action: p.prefix, actor })} active={action === p.prefix}>
              {p.prefix} ({p.count})
            </Chip>
          ))}
        </nav>
        {facets.actors.length > 0 && (
          <nav aria-label="Filter by admin" className="flex flex-wrap gap-2">
            <Chip to={href({ action })} active={!actor}>
              All admins
            </Chip>
            {facets.actors.map((a) => (
              <Chip key={a.id} to={href({ action, actor: a.id })} active={actor === a.id}>
                {a.name ?? a.email} ({a.count})
              </Chip>
            ))}
          </nav>
        )}
      </div>

      {/* v2 (live-globe Part I): the shared DataTable. The action reads in plain
          words (Part G labels) with the raw name under it, since the filter
          chips above use the raw prefixes; the payload stays behind Details. */}
      <DataTable
        caption="Audit log"
        rows={log.entries}
        rowKey={(e) => e.id}
        minWidth={860}
        empty={<EmptyState title="No audit entries" description="Nothing matches these filters." />}
        columns={[
          {
            key: "when",
            header: "When",
            className: "whitespace-nowrap align-top",
            cell: (e) => (
              <time dateTime={e.createdAt.toISOString()} className="text-small text-text-muted">
                {fmt.format(e.createdAt)}
              </time>
            ),
          },
          {
            key: "action",
            header: "Action",
            className: "align-top",
            cell: (e) => (
              <span className="grid gap-0.5">
                <span className="font-medium text-text">{auditActionLabel(e.action)}</span>
                <code className="text-caption text-text-muted">{e.action}</code>
              </span>
            ),
          },
          {
            key: "actor",
            header: "By",
            className: "align-top",
            cell: (e) => e.actorName ?? e.actorEmail ?? "Unknown actor",
          },
          {
            key: "target",
            header: "Target",
            className: "align-top",
            cell: (e) =>
              e.targetType || e.targetId ? (
                <span className="break-all text-small text-text-muted">
                  {e.targetType ?? "unknown"}
                  {e.targetId ? ` ${e.targetId}` : ""}
                </span>
              ) : (
                <span className="text-small text-text-muted">None</span>
              ),
          },
          {
            key: "details",
            header: "Details",
            srOnlyHeader: true,
            className: "align-top",
            cell: (e) =>
              e.payload != null ? (
                <details>
                  <summary className="cursor-pointer text-small font-medium text-accent">Details</summary>
                  <pre className="mt-2 max-h-96 max-w-[420px] overflow-auto rounded-md bg-surface-muted p-3 text-caption text-text">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              ) : null,
          },
        ]}
      />

      {log.pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {log.page > 1 ? (
            <Link href={href({ action, actor, page: log.page - 1 })} className="focus-ring text-body font-medium text-accent">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-small text-text-muted">
            Page {log.page} of {log.pageCount}
          </span>
          {log.page < log.pageCount ? (
            <Link href={href({ action, actor, page: log.page + 1 })} className="focus-ring text-body font-medium text-accent">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
