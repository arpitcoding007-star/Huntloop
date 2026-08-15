import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";

/**
 * Explicit cleanup, because `globals: false`.
 *
 * Testing Library auto-registers its own `afterEach` only when it can see a
 * global one, and this config deliberately does not create globals. Without
 * this the mounted trees accumulate in the document, `getAllByRole("row")`
 * returns rows from every test that ran before, and assertions start reporting
 * on the wrong table — which is how three of these tests first "failed"
 * against correct code.
 */
afterEach(cleanup);

/**
 * A11Y-01, and the reason it needed a unit test rather than a browser one.
 *
 * `onRowClick` was pointer-only: `<tr onClick=…>` with no tabIndex, no
 * onKeyDown and no role, so a keyboard user could not activate a row. The
 * finding was recorded as *latent* — the only consumer, `OpportunityTable`,
 * renders a real `<a>` in the company cell and never passes `onRowClick` — and
 * that is exactly what makes this the wrong thing to test end-to-end. There is
 * no page to visit. The trap is set for the next consumer of a shared
 * component, so the test has to instantiate the trap directly.
 */

interface Row {
  id: string;
  company: string;
}

const rows: Row[] = [
  { id: "a", company: "Alphio AI" },
  { id: "b", company: "Northwind Logistics" },
];

const columns: Column<Row>[] = [
  { key: "company", header: "Company", render: (r) => r.company },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} {...props} />,
  );
}

/**
 * Plain DOM assertions rather than `@testing-library/jest-dom`. The matchers
 * read a little better; they are not worth a fourth test dependency in a
 * package that had none, and `getAttribute` is unambiguous about the
 * difference between "absent" and "present and empty" — which is exactly the
 * distinction the first test below turns on.
 */
const bodyRows = () => screen.getAllByRole("row").slice(1);

/** The first data row. Throws rather than returning undefined, so a query that
 *  silently matched nothing fails here instead of three assertions later. */
function firstBodyRow(): HTMLElement {
  const [first] = bodyRows();
  if (!first) throw new Error("no data rows rendered");
  return first;
}

describe("DataTable rows without onRowClick", () => {
  it("are not focusable, because they do nothing", () => {
    renderTable();
    for (const row of bodyRows()) {
      expect(row.getAttribute("tabindex")).toBeNull();
    }
  });
});

describe("DataTable rows with onRowClick", () => {
  it("can be reached by keyboard", () => {
    renderTable({ onRowClick: vi.fn() });
    for (const row of bodyRows()) {
      expect(row.getAttribute("tabindex")).toBe("0");
    }
  });

  it("activates on Enter and on Space", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    const first = firstBodyRow();

    fireEvent.keyDown(first, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);

    fireEvent.keyDown(first, { key: " " });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("ignores keys that are not activation keys", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    const first = firstBodyRow();
    for (const key of ["a", "Tab", "ArrowDown", "Escape", "Shift"]) {
      fireEvent.keyDown(first, { key });
    }
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("prevents the default on Space, which would otherwise scroll the page", () => {
    // On a long table, the default Space behaviour moves the thing you just
    // activated off screen.
    renderTable({ onRowClick: vi.fn() });
    const first = firstBodyRow();

    const prevented = !fireEvent.keyDown(first, { key: " " });
    expect(prevented).toBe(true);
  });

  it("stays a table row rather than becoming a button", () => {
    /*
     * The tempting fix is `role="button"`, which makes screen readers announce
     * the activation correctly — and removes the row from the table's
     * structure entirely, so the column headers stop applying and the table
     * stops being navigable as a table. That is a worse trade. The row keeps
     * its implicit `row` role; the accessible pattern remains a real link in
     * the identifying cell, which is what OpportunityTable does.
     */
    renderTable({ onRowClick: vi.fn() });
    for (const row of bodyRows()) {
      expect(row.getAttribute("role")).toBeNull();
    }
  });

  it("does not fire twice when the event came from inside the row", () => {
    /*
     * The bug this prevents: with selection enabled, pressing Enter on a row's
     * checkbox bubbles to the row handler, so one keypress both toggles the
     * checkbox and opens the record. Same for a link inside any cell.
     */
    const onRowClick = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText("Select row a");
    fireEvent.keyDown(checkbox, { key: "Enter", bubbles: true });
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
