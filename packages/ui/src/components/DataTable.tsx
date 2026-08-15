"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "../utils/cn";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Fixed width, e.g. "180px" or "22%". Omit to auto-size. */
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Enables the leading checkbox column. */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  sort?: { key: string; direction: "asc" | "desc" };
  onSortChange?: (sort: { key: string; direction: "asc" | "desc" }) => void;
  /**
   * Whole-row activation. Keyboard-operable (Tab to the row, Enter or Space),
   * but treat it as a *redundant* convenience rather than the only way in:
   * the accessible pattern is a real `<a>` in the identifying cell, which is
   * what `OpportunityTable` does. A row is not a link, screen readers do not
   * announce it as one, and `role="button"` on a `<tr>` would fix the
   * announcement by removing the row from the table's structure entirely —
   * which is a worse trade than leaving it a row.
   */
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
}

/**
 * Supabase Auth→Users table: checkbox column, muted uppercase header,
 * 44px rows, hairline dividers, sticky header, horizontal scroll contained
 * inside the component (the page body must never scroll sideways).
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selectedIds,
  onSelectionChange,
  sort,
  onSortChange,
  onRowClick,
  loading,
  empty,
  className,
}: DataTableProps<T>) {
  const selectable = Boolean(selectedIds && onSelectionChange);
  const selected = new Set(selectedIds ?? []);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : rows.map(rowKey));
  }

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  }

  function headerClick(col: Column<T>) {
    if (!col.sortable || !onSortChange) return;
    const direction =
      sort?.key === col.key && sort.direction === "desc" ? "asc" : "desc";
    onSortChange({ key: col.key, direction });
  }

  return (
    <div
      className={cn(
        // min-w-0 is load-bearing: a scroll container defaults to
        // min-width:auto, which lets the 720px table widen its flex/grid
        // parent and scroll the whole page sideways instead of itself.
        "min-w-0 overflow-x-auto rounded-md border border-line-subtle bg-surface",
        className,
      )}
    >
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line-subtle">
            {selectable && (
              <th scope="col" className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="hl-focusable size-3.5 cursor-pointer accent-[var(--hl-brand)]"
                />
              </th>
            )}
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    active
                      ? sort!.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={cn(
                    "px-4 py-2.5 text-[11px] leading-4 font-medium tracking-[0.06em] text-fg-muted uppercase",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => headerClick(col)}
                      className={cn(
                        "hl-focusable inline-flex items-center gap-1 rounded-sm transition-colors duration-[120ms] hover:text-fg-secondary",
                        active && "text-fg-secondary",
                      )}
                    >
                      {col.header}
                      {active &&
                        (sort!.direction === "asc" ? (
                          <ArrowUp className="size-3" strokeWidth={2} />
                        ) : (
                          <ArrowDown className="size-3" strokeWidth={2} />
                        ))}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-b border-line-subtle">
                {selectable && <td className="px-4" />}
                {columns.map((col) => (
                  <td key={col.key} className="h-11 px-4">
                    <span className="block h-3 w-2/3 animate-pulse rounded-sm bg-surface-active" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-4 py-14 text-center"
              >
                {empty ?? (
                  <span className="text-[13px] text-fg-muted">No results</span>
                )}
              </td>
            </tr>
          )}

          {!loading &&
            rows.map((row) => {
              const id = rowKey(row);
              const isSelected = selected.has(id);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          // Only the row itself. Without this, Enter on the
                          // selection checkbox — or on a link inside a cell —
                          // bubbles up and fires the row action too, so one
                          // keypress does two things.
                          if (e.target !== e.currentTarget) return;
                          if (e.key !== "Enter" && e.key !== " ") return;
                          // Space scrolls the page by default, which on a long
                          // table moves the thing you just activated off-screen.
                          e.preventDefault();
                          onRowClick(row);
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-line-subtle transition-colors duration-[120ms] last:border-b-0",
                    isSelected ? "bg-surface-hover" : "hover:bg-surface-hover",
                    onRowClick && "hl-focusable-row cursor-pointer",
                  )}
                >
                  {selectable && (
                    <td className="px-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${id}`}
                        checked={isSelected}
                        onChange={() => toggleRow(id)}
                        className="hl-focusable size-3.5 cursor-pointer accent-[var(--hl-brand)]"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "h-11 px-4 text-[13px] text-fg-secondary",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center",
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
