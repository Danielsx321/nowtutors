import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DataTable, StatusDot } from "@/components/ui/data-table";

/**
 * The shared admin table (Part G). Asserted: headers and cells render in
 * order; numbers align right with tabular figures; a visually hidden header
 * still names its column; the caption is there for screen readers; the empty
 * state replaces the table; statuses carry a word, not colour alone.
 */
type Row = { id: string; name: string; amount: number; status: "open" | "paid" };

const columns = [
  { key: "name", header: "Tutor", cell: (r: Row) => r.name },
  { key: "amount", header: "Amount", align: "right" as const, cell: (r: Row) => `${r.amount} cr` },
  {
    key: "status",
    header: "Status",
    cell: (r: Row) => (r.status === "open" ? <StatusDot tone="spark">To approve</StatusDot> : <StatusDot tone="muted">Paid</StatusDot>),
  },
  { key: "open", header: "Open", srOnlyHeader: true, cell: () => <a href="/x">Open</a> },
];

describe("DataTable", () => {
  it("renders headers, cells and a caption", () => {
    render(
      <DataTable
        caption="Withdrawals"
        columns={columns}
        rowKey={(r) => r.id}
        rows={[
          { id: "1", name: "Sofia", amount: 310, status: "open" },
          { id: "2", name: "Marco", amount: 480, status: "paid" },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Withdrawals" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Tutor", "Amount", "Status", "Open"]);
    const firstRow = within(table).getAllByRole("row")[1]!;
    const cells = within(firstRow).getAllByRole("cell");
    expect(cells[0]!.textContent).toBe("Sofia");
    expect(cells[1]!.className).toContain("text-right");
    expect(cells[1]!.className).toContain("tabular-nums");
    expect(within(firstRow).getByText("To approve")).toBeTruthy();
  });

  it("shows the empty state instead of an empty table", () => {
    render(<DataTable columns={columns} rowKey={(r) => r.id} rows={[]} empty={<p>No withdrawals waiting.</p>} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No withdrawals waiting.")).toBeTruthy();
  });
});
