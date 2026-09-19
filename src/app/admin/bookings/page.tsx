import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { bookingStatus } from "@/db/schema/enums";
import { requireRole } from "@/lib/auth/guards";
import { listAdminBookings } from "@/db/queries/admin-bookings";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { normalizeUserSearch } from "@/lib/admin/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const metadata = { title: "Bookings · NowTutors" };
export const dynamic = "force-dynamic";

type Params = { status?: string; q?: string; from?: string; to?: string; page?: string };

const STATUSES = bookingStatus.enumValues;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: string | undefined): string | null {
  if (!v || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function href(p: { status?: string | null; q?: string; from?: string | null; to?: string | null; page?: number }) {
  const s = new URLSearchParams();
  if (p.status) s.set("status", p.status);
  if (p.q) s.set("q", p.q);
  if (p.from) s.set("from", p.from);
  if (p.to) s.set("to", p.to);
  if (p.page && p.page > 1) s.set("page", String(p.page));
  const qs = s.toString();
  return qs ? `/admin/bookings?${qs}` : "/admin/bookings";
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring rounded-full border px-3 py-1 text-small font-medium",
        active ? "border-ink bg-ink text-on-ink" : "border-border text-text hover:bg-surface-muted",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * `/admin/bookings` (SPEC §6; Phase 8 Part 6): every booking, newest first, 25
 * per page, filtered by status, by student or tutor (email or name, matched
 * literally), and by start date in the admin's timezone. Filters live in the URL.
 * `requireRole('admin')` first (§5 Layer 2).
 */
export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { user } = await requireRole("admin");
  const params = await searchParams;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "") ? params.status! : null;
  const rawQ = (params.q ?? "").slice(0, 100);
  const from = validDate(params.from);
  const to = validDate(params.to);
  const pageParam = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const [me] = await db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const timeZone = safeTimeZone(me?.timezone);
  const result = await listAdminBookings({ status, q: normalizeUserSearch(rawQ), from, to, timeZone, page });
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });

  return (
    <div className="w-full space-y-6 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Bookings</h1>
        <p className="mt-1 text-body text-text-muted">
          {result.total.toLocaleString()} matching {result.total === 1 ? "booking" : "bookings"}. Open one to cancel
          with a refund or mark it completed.
        </p>
      </div>

      <form action="/admin/bookings" method="get" className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="space-y-1.5">
          <Label htmlFor="booking-q">Student or tutor</Label>
          <Input id="booking-q" name="q" type="search" defaultValue={rawQ} placeholder="Email or name" maxLength={100} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-from">From</Label>
          <Input id="booking-from" name="from" type="date" defaultValue={from ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-to">To</Label>
          <Input id="booking-to" name="to" type="date" defaultValue={to ?? ""} />
        </div>
        <Button type="submit">Filter</Button>
      </form>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        <Chip to={href({ q: rawQ, from, to })} active={!status}>
          All
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} to={href({ status: s, q: rawQ, from, to })} active={status === s}>
            {bookingStatusMeta(s).label}
          </Chip>
        ))}
      </nav>

      {result.bookings.length === 0 ? (
        <EmptyState title="No bookings found" description="Try a different filter." />
      ) : (
        <ul className="space-y-3">
          {result.bookings.map((b) => {
            const meta = bookingStatusMeta(b.status);
            return (
              <li key={b.id}>
                <Card>
                  <CardContent className="p-0">
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="focus-ring flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 hover:bg-surface-muted"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-body font-bold text-text">
                          {b.studentName} with {b.tutorName}
                        </p>
                        <p className="text-small text-text-muted">
                          {fmt.format(b.startsAt)} · {b.type} · {b.durationMinutes ?? "?"} min
                          {b.subjectName ? ` · ${b.subjectName}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {b.earningStatus && <Badge variant="neutral">earnings {b.earningStatus}</Badge>}
                        <span className="text-small text-text-muted">{b.priceCredits ?? "?"} credits</span>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {result.page > 1 ? (
            <Link href={href({ status, q: rawQ, from, to, page: result.page - 1 })} className="focus-ring text-body font-medium text-accent">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-small text-text-muted">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link href={href({ status, q: rawQ, from, to, page: result.page + 1 })} className="focus-ring text-body font-medium text-accent">
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
