import Link from "next/link";
import { eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getCreditPackages } from "@/lib/settings";
import { basisUsdPerCredit } from "@/lib/credits/packages";
import { TRUST_PAYMENT } from "@/lib/copy/trust";
import { cn } from "@/lib/utils";
import {
  getWalletBalanceFor,
  getWalletHistory,
  WALLET_PAGE_SIZE,
  type WalletDirection,
} from "@/db/queries/wallet";
import { formatUsd } from "@/components/ui/money";
import { BuyCredits } from "@/components/features/wallet/buy-credits";
import { TransactionHistory } from "@/components/features/wallet/transaction-history";
import { WalletPager } from "@/components/features/wallet/wallet-pager";

export const metadata = { title: "Wallet · NowTutors" };
export const dynamic = "force-dynamic";

const FILTERS: { value: WalletDirection | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "in", label: "Added" },
  { value: "out", label: "Spent" },
];

/**
 * `/dashboard/wallet`: balance, buy credits, transaction history (SPEC §6,
 * §7.10, §4.4).
 *
 * The role guard is the first statement (SPEC §5 Layer 2) and the user id comes
 * from it, never from the URL: `?page=` and `?show=` only select a window of
 * *that* user's ledger. History is paginated; the whole ledger is never loaded.
 *
 * Design overhaul Part 3: one large balance in tabular figures with its dollar
 * anchor, a line on what credits are for, then buy, then the history with an
 * Added / Spent filter. The balance keeps `aria-label="N credits"`, which E2E
 * reads.
 */
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; show?: string }>;
}) {
  const { user } = await requireRole("student");

  const { page: pageParam, show } = await searchParams;
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);
  const direction: WalletDirection | undefined = show === "in" || show === "out" ? show : undefined;

  const [balance, history, packages, [me]] = await Promise.all([
    getWalletBalanceFor(user.id),
    getWalletHistory(
      user.id,
      Number.isFinite(requestedPage) ? requestedPage : 1,
      WALLET_PAGE_SIZE,
      direction,
    ),
    getCreditPackages(),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const timeZone = me?.timezone ?? "UTC";
  const usdPerCredit = basisUsdPerCredit(packages);

  return (
    <div className="w-full space-y-8 py-2">
      <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Wallet</h1>

      <section aria-labelledby="balance-title" className="rounded-panel border border-border bg-surface-raised p-6">
        <h2 id="balance-title" className="text-small font-medium text-text-muted">
          Credit balance
        </h2>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span
            data-numeric
            aria-label={`${balance.toLocaleString()} credits`}
            className="font-display text-[48px] font-bold leading-none text-text"
          >
            {balance.toLocaleString()}
          </span>
          <span aria-hidden className="text-body text-text-muted">
            credits
            {usdPerCredit != null && <> ≈ {formatUsd(balance * usdPerCredit)}</>}
          </span>
        </p>
        <p className="mt-3 max-w-prose text-small text-text-muted">
          Credits pay for sessions with any tutor, booked or started live. A session&apos;s price in
          credits is shown before you confirm.
        </p>
      </section>

      <section aria-labelledby="buy-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="buy-title" className="text-h2 font-semibold text-text">
            Buy credits
          </h2>
          <p className="inline-flex items-center gap-1.5 text-small text-text-muted">
            <ShieldCheck className="size-4 text-accent" aria-hidden />
            {TRUST_PAYMENT}
          </p>
        </div>
        <BuyCredits
          packages={packages}
          paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() || null}
        />
      </section>

      <section aria-labelledby="history-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-title" className="text-h2 font-semibold text-text">
            History
          </h2>
          <nav aria-label="Filter transactions" className="flex gap-1 rounded-full bg-surface-muted p-1">
            {FILTERS.map((f) => {
              const active = (direction ?? null) === f.value;
              return (
                <Link
                  key={f.label}
                  href={f.value ? `/dashboard/wallet?show=${f.value}` : "/dashboard/wallet"}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "focus-ring rounded-full px-3 py-1 text-small font-medium",
                    active ? "bg-surface-raised text-accent shadow-sm" : "text-text-muted hover:text-text",
                  )}
                >
                  {f.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="rounded-card border border-border bg-surface-raised">
          <TransactionHistory transactions={history.transactions} timeZone={timeZone} />
        </div>
        {history.pageCount > 1 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-small text-text-muted">
              Page {history.page} of {history.pageCount} · {history.total} transaction
              {history.total === 1 ? "" : "s"}
            </p>
            <WalletPager page={history.page} pageCount={history.pageCount} />
          </div>
        )}
      </section>
    </div>
  );
}
