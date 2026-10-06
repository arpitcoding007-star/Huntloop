/**
 * CSV out. The parser in `csv.ts` reads what people upload; this writes what
 * they download.
 *
 * ── Formula injection ────────────────────────────────────────────────────
 *
 * Company names and loss reasons are text other people typed, and a cell that
 * begins with `=`, `+`, `-`, `@`, tab or carriage return is executed as a
 * formula by Excel and Sheets. A prospect named `=HYPERLINK(...)` would become
 * a link in a manager's spreadsheet. Such cells are prefixed with a single
 * quote — the OWASP-recommended neutraliser — so they open as the text they are.
 */

export type CsvValue = string | number | null | undefined;

const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  if (typeof value === "string" && DANGEROUS.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
