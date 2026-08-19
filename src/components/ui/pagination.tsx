"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaginationProps
  extends React.HTMLAttributes<HTMLElement> {
  page: number; // 1-based
  pageCount: number;
  onPageChange?: (page: number) => void;
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/** Numbered pagination with prev/next and ellipsis truncation. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
  ...props
}: PaginationProps) {
  if (pageCount <= 1) return null;

  const pages: (number | "…")[] = [];
  const window = 1;
  const first = 1;
  const last = pageCount;
  const from = Math.max(first, page - window);
  const to = Math.min(last, page + window);

  pages.push(first);
  if (from > first + 1) pages.push("…");
  for (const p of range(from, to)) if (p !== first && p !== last) pages.push(p);
  if (to < last - 1) pages.push("…");
  if (last !== first) pages.push(last);

  const go = (p: number) => onPageChange?.(Math.max(1, Math.min(pageCount, p)));

  const btn =
    "focus-ring grid size-9 place-items-center rounded-md text-small font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      <button
        className={cn(btn, "text-gray-500 hover:bg-gray-50")}
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" />
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="grid size-9 place-items-center text-gray-500">
            …
          </span>
        ) : (
          <button
            key={p}
            className={cn(
              btn,
              p === page
                ? "bg-purple-500 text-white"
                : "text-gray-700 hover:bg-gray-50",
            )}
            onClick={() => go(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </button>
        ),
      )}
      <button
        className={cn(btn, "text-gray-500 hover:bg-gray-50")}
        onClick={() => go(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}
