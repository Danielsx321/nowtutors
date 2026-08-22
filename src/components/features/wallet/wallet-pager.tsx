"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pagination } from "@/components/ui/pagination";

/**
 * URL-driven pager for wallet history. The page number lives in `?page=`, so the
 * server component re-renders one window from the DB rather than the client
 * holding the whole ledger (SPEC §4.4 — `credit_transactions` is append-only and
 * unbounded).
 */
export function WalletPager({ page, pageCount }: { page: number; pageCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      onPageChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        if (next <= 1) params.delete("page");
        else params.set("page", String(next));
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }}
    />
  );
}
