import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getAdminUserDetail } from "@/db/queries/admin-users";
import { getWalletHistory, WALLET_PAGE_SIZE } from "@/db/queries/wallet";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditBalance } from "@/components/ui/credit-balance";
import { TransactionHistory } from "@/components/features/wallet/transaction-history";
import { WalletPager } from "@/components/features/wallet/wallet-pager";
import { UserAdminActions } from "@/components/features/admin/user-admin-actions";

export const metadata = { title: "User · NowTutors" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BOOKING_GROUPS: { label: string; statuses: string[] }[] = [
  { label: "Upcoming or live", statuses: ["pending_payment", "confirmed", "in_progress"] },
  { label: "Completed", statuses: ["completed"] },
  { label: "Cancelled", statuses: ["cancelled_by_student", "cancelled_by_tutor"] },
  { label: "No-show", statuses: ["no_show_student", "no_show_tutor"] },
  { label: "Expired", statuses: ["expired"] },
];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-border py-2 last:border-0">
      <dt className="text-small text-text-muted">{label}</dt>
      <dd className="text-small text-text">{children}</dd>
    </div>
  );
}

/**
 * `/admin/users/[id]` (SPEC §6; Phase 8 Part 5): profile, wallet and ledger,
 * bookings summary, tutor earnings, and the suspend / adjust / promote controls.
 * `requireRole('admin')` first (§5 Layer 2). Ledger history is paginated.
 */
export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { user } = await requireRole("admin");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { page: pageParam } = await searchParams;
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);

  const [detail, history, [me]] = await Promise.all([
    getAdminUserDetail(id),
    getWalletHistory(id, Number.isFinite(requestedPage) ? requestedPage : 1, WALLET_PAGE_SIZE),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);
  if (!detail) notFound();

  const timeZone = safeTimeZone(me?.timezone);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });
  const count = (statuses: string[]) => statuses.reduce((n, s) => n + (detail.bookingsByStatus[s] ?? 0), 0);

  return (
    <div className="w-full space-y-6 py-2">
      <div className="space-y-2">
        <Link href="/admin/users" className="focus-ring text-small font-medium text-accent">
          All users
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">
              {detail.displayName ?? detail.fullName ?? "No name"}
            </h1>
            <p className="break-all text-body text-text-muted">{detail.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={detail.role === "admin" ? "solid" : detail.role ? "accent" : "neutral"}>
              {detail.role ?? "not onboarded"}
            </Badge>
            {detail.isSuspended && <Badge variant="danger">suspended</Badge>}
            {detail.tutor?.isLive && <Badge variant="success">live</Badge>}
          </div>
        </div>
      </div>

      <UserAdminActions
        userId={detail.id}
        email={detail.email}
        role={detail.role}
        isSuspended={detail.isSuspended}
        isSelf={detail.id === user.id}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              {detail.fullName && <Fact label="Full name">{detail.fullName}</Fact>}
              <Fact label="Country">{detail.country ?? "Not set"}</Fact>
              <Fact label="Timezone">{detail.timezone ?? "Not set"}</Fact>
              <Fact label="Joined">{fmt.format(detail.createdAt)}</Fact>
              <Fact label="Onboarded">
                {detail.onboardingCompletedAt ? fmt.format(detail.onboardingCompletedAt) : "No"}
              </Fact>
              <Fact label="Last seen">{detail.lastSeenAt ? fmt.format(detail.lastSeenAt) : "Never"}</Fact>
              {detail.tutor && (
                <Fact label="Tutor profile">
                  <Link href={`/tutors/${detail.tutor.slug}`} className="focus-ring text-accent">
                    {detail.tutor.slug}
                  </Link>{" "}
                  ({detail.tutor.approvalStatus})
                </Fact>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions and earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              {BOOKING_GROUPS.map((g) => (
                <Fact key={g.label} label={g.label}>
                  {count(g.statuses)}
                </Fact>
              ))}
              {detail.role === "tutor" && (
                <>
                  <Fact label="Earnings held">{detail.earnings.held} credits</Fact>
                  <Fact label="Earnings available">{detail.earnings.available} credits</Fact>
                  <Fact label="Earnings withdrawn">{detail.earnings.withdrawn} credits</Fact>
                  <Fact label="Open withdrawal">
                    {detail.openWithdrawal
                      ? `${detail.openWithdrawal.amountCredits} credits (${detail.openWithdrawal.status})`
                      : "None"}
                  </Fact>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Wallet</CardTitle>
            <CreditBalance credits={detail.walletBalance} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <TransactionHistory transactions={history.transactions} timeZone={timeZone} />
          </div>
          {history.pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-small text-text-muted">
                Page {history.page} of {history.pageCount} · {history.total} transaction
                {history.total === 1 ? "" : "s"}
              </p>
              <WalletPager page={history.page} pageCount={history.pageCount} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
