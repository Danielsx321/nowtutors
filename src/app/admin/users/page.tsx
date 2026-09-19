import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { searchAdminUsers } from "@/db/queries/admin-users";
import {
  normalizeUserSearch,
  parseUserFilter,
  USER_FILTERS,
  type UserFilter,
} from "@/lib/admin/users";
import { Button } from "@/components/ui/button";
import { DataTable, StatusDot } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata = { title: "Users · NowTutors" };
export const dynamic = "force-dynamic";

type Params = { q?: string; filter?: string; page?: string };

const FILTER_LABELS: Record<UserFilter, string> = {
  student: "Students",
  tutor: "Tutors",
  admin: "Admins",
  unset: "Not onboarded",
  suspended: "Suspended",
};

function href(p: { q?: string | null; filter?: string | null; page?: number }) {
  const s = new URLSearchParams();
  if (p.q) s.set("q", p.q);
  if (p.filter) s.set("filter", p.filter);
  if (p.page && p.page > 1) s.set("page", String(p.page));
  const qs = s.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
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
 * `/admin/users` (SPEC §6; Phase 8 Part 5). Search by email or name, filter by
 * role or suspension, 25 per page, newest first. Search and filters are in the
 * URL, so a view is shareable. `requireRole('admin')` first (§5 Layer 2).
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireRole("admin");
  const params = await searchParams;
  const rawQ = (params.q ?? "").slice(0, 100);
  const q = normalizeUserSearch(rawQ);
  const filter = parseUserFilter(params.filter);
  const pageParam = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const result = await searchAdminUsers({ q, filter, page });

  return (
    <div className="w-full space-y-6 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Users</h1>
        <p className="mt-1 text-body text-text-muted">
          {result.total.toLocaleString()} matching {result.total === 1 ? "account" : "accounts"}.
        </p>
      </div>

      <form action="/admin/users" method="get" role="search" className="flex flex-wrap gap-2">
        {filter && <input type="hidden" name="filter" value={filter} />}
        <label htmlFor="user-search" className="sr-only">
          Search by email or name
        </label>
        <Input
          id="user-search"
          name="q"
          type="search"
          defaultValue={rawQ}
          placeholder="Search by email or name"
          maxLength={100}
          autoComplete="off"
          className="min-w-0 flex-1 basis-60"
        />
        <Button type="submit">Search</Button>
      </form>

      <nav aria-label="Filter users" className="flex flex-wrap gap-2">
        <Chip to={href({ q: rawQ })} active={!filter}>
          Everyone
        </Chip>
        {USER_FILTERS.map((f) => (
          <Chip key={f} to={href({ q: rawQ, filter: f })} active={filter === f}>
            {FILTER_LABELS[f]}
          </Chip>
        ))}
      </nav>

      {/* v2 (live-globe Part I): the shared DataTable, one row per account.
          The name links to the account page; status is a dot and a word. */}
      <DataTable
        caption="Accounts"
        rows={result.users}
        rowKey={(u) => u.id}
        minWidth={640}
        empty={<EmptyState title="No users found" description="Try a different search or filter." />}
        columns={[
          {
            key: "who",
            header: "Account",
            cell: (u) => (
              <Link href={`/admin/users/${u.id}`} className="focus-ring block min-w-0 rounded-sm hover:underline">
                <span className="block truncate font-medium text-text">{u.displayName ?? u.fullName ?? "No name"}</span>
                <span className="block truncate text-small text-text-muted">{u.email}</span>
              </Link>
            ),
          },
          { key: "role", header: "Role", cell: (u) => (u.role ? capitalise(u.role) : "Not onboarded") },
          {
            key: "status",
            header: "Status",
            cell: (u) =>
              u.isSuspended ? (
                <StatusDot tone="danger">Suspended</StatusDot>
              ) : u.role === "tutor" && u.approvalStatus && u.approvalStatus !== "approved" ? (
                <StatusDot tone="spark">{capitalise(u.approvalStatus.replace(/_/g, " "))}</StatusDot>
              ) : (
                <StatusDot tone="live">Active</StatusDot>
              ),
          },
          { key: "credits", header: "Credits", align: "right", cell: (u) => u.balance.toLocaleString("en-US") },
        ]}
      />

      {result.pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {result.page > 1 ? (
            <Link
              href={href({ q: rawQ, filter, page: result.page - 1 })}
              className="focus-ring text-body font-medium text-accent"
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-small text-text-muted">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link
              href={href({ q: rawQ, filter, page: result.page + 1 })}
              className="focus-ring text-body font-medium text-accent"
            >
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

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
