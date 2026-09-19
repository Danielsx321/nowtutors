import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { searchAdminUsers } from "@/db/queries/admin-users";
import {
  normalizeUserSearch,
  parseUserFilter,
  USER_FILTERS,
  type UserFilter,
} from "@/lib/admin/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

      {result.users.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search or filter." />
      ) : (
        <ul className="space-y-3">
          {result.users.map((u) => (
            <li key={u.id}>
              <Card>
                <CardContent className="p-0">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="focus-ring flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body font-bold text-text">
                        {u.displayName ?? u.fullName ?? "No name"}
                      </p>
                      <p className="truncate text-small text-text-muted">{u.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={u.role === "admin" ? "solid" : u.role ? "accent" : "neutral"}>
                        {u.role ?? "not onboarded"}
                      </Badge>
                      {u.role === "tutor" && u.approvalStatus && u.approvalStatus !== "approved" && (
                        <Badge variant="warning">{u.approvalStatus}</Badge>
                      )}
                      {u.isSuspended && <Badge variant="danger">suspended</Badge>}
                      <span className="text-small text-text-muted">{u.balance} credits</span>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

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
