import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbProps
  extends React.HTMLAttributes<HTMLElement> {
  items: Crumb[];
}

/** Navigation breadcrumb. The last item is the current page (no link). */
export function Breadcrumb({ items, className, ...props }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-small", className)} {...props}>
      <ol className="flex flex-wrap items-center gap-1.5 text-gray-500">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="focus-ring rounded-sm hover:text-purple-500 hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(last && "font-medium text-gray-700")}
                  aria-current={last ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <ChevronRight className="size-3.5 text-gray-200" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
