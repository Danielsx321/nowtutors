import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getCreditPackages } from "@/lib/settings";
import {
  getWalletBalanceFor,
  getWalletHistory,
  WALLET_PAGE_SIZE,
} from "@/db/queries/wallet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditBalance } from "@/components/ui/credit-balance";
import { BuyCredits } from "@/components/features/wallet/buy-credits";
import { TransactionHistory } from "@/components/features/wallet/transaction-history";
import { WalletPager } from "@/components/features/wallet/wallet-pager";

export const metadata = { title: "Wallet · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/dashboard/wallet` — balance, buy credits, transaction history (SPEC §6,
 * §7.10, §4.4).
 *
 * The role guard is the first statement (SPEC §5 Layer 2) and the user id comes
 * from it, never from the URL — `?page=` only selects a window of *that* user's
 * ledger. History is paginated; the whole ledger is never loaded.
 */
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { user } = await requireRole("student");

  const { page: pageParam } = await searchParams;
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);

  const [balance, history, packages, [me]] = await Promise.all([
    getWalletBalanceFor(user.id),
    getWalletHistory(
      user.id,
      Number.isFinite(requestedPage) ? requestedPage : 1,
      WALLET_PAGE_SIZE,
    ),
    getCreditPackages(),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const timeZone = me?.timezone ?? "UTC";

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold text-gray-700">Wallet</h1>
        <CreditBalance credits={balance} size="lg" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buy credits</CardTitle>
        </CardHeader>
        <CardContent>
          <BuyCredits
            packages={packages}
            paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() || null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transaction history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TransactionHistory
            transactions={history.transactions}
            timeZone={timeZone}
          />
          {history.pageCount > 1 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-small text-gray-500">
                Page {history.page} of {history.pageCount} · {history.total}{" "}
                transaction{history.total === 1 ? "" : "s"}
              </p>
              <WalletPager page={history.page} pageCount={history.pageCount} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
