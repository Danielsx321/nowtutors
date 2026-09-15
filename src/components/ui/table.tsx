import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Low-level table primitives. Wrap <Table> in an overflow-x container at call
 * sites so wide tables scroll rather than break the layout (SPEC §10.3).
 * Text left, numbers right (`numeric` on the head and cell), tabular figures
 * throughout, no stripes, no centred columns (DESIGN.md, "Tables").
 */
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-body", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-muted", className)} {...props} />;
}

export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn(className)} {...props} />;
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 hover:bg-surface-muted/60",
        className,
      )}
      {...props}
    />
  );
}

export interface TableHeadProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align: the column holds numbers. */
  numeric?: boolean;
}

export function TableHead({ className, numeric, ...props }: TableHeadProps) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-left text-small font-medium text-text-muted",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps
  extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Right-align in tabular figures: the cell holds a number. */
  numeric?: boolean;
}

export function TableCell({ className, numeric, ...props }: TableCellProps) {
  return (
    <td
      data-numeric={numeric || undefined}
      className={cn("px-4 py-3 text-text", numeric && "text-right", className)}
      {...props}
    />
  );
}
