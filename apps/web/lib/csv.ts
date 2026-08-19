/**
 * CSV parsing for the importer — master context §60.
 *
 * Pure, and deliberately not in a `"use server"` module: the import screen
 * parses to build a preview, and the action re-parses the same text on the
 * server. Both must agree, or the user approves one thing and imports
 * another. One function, called twice, is what makes that guarantee cheap.
 *
 * ── Why not split on commas ──────────────────────────────────────────────
 *
 * Because company descriptions contain commas. `"Acme, Inc.",acme.com` is
 * three fields to `String.split(",")` and two to anything that reads the
 * quotes, and the failure is silent: the domain column shifts by one and
 * every row imports a company whose canonical domain is ` Inc.`. That is a
 * corrupted entity-resolution key, which §59 makes the one thing in this
 * schema that must not be wrong.
 *
 * So this handles the parts of RFC 4180 that real spreadsheets emit: quoted
 * fields, escaped quotes (`""`), embedded commas and newlines, and CRLF. It
 * does not handle alternative delimiters or comment lines, because Excel,
 * Sheets and Numbers all export commas and neither of the others.
 */

/** One parsed record, keyed by its normalized header. */
export type CsvRow = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
  /** Rows dropped for having a different field count than the header. */
  malformed: number;
  /** True when `maxRows` cut the file short. */
  truncated: boolean;
}

/**
 * Splits CSV text into fields, respecting quotes.
 *
 * A hand-rolled state machine rather than a regex: a regex that handles
 * embedded newlines inside quoted fields is both unreadable and, in every
 * version anyone actually writes, catastrophically backtracking on a file
 * with an unbalanced quote — which is exactly the malformed input this is
 * most likely to meet.
 */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let started = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === ",") {
      endField();
      started = false;
    } else if (c === "\n") {
      endRecord();
    } else if (c === "\r") {
      // CRLF: the \n does the work. A lone \r (classic Mac) also ends a row.
      if (text[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += c;
      started = true;
    }
  }

  // A file that does not end in a newline still has a last record — unless
  // nothing at all was accumulated, in which case the file ended cleanly.
  if (field !== "" || record.length > 0) endRecord();

  return records;
}

/** Lowercased, punctuation folded to spaces, so `First Name` matches `first_name`. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCsv(text: string, maxRows = 1000): ParsedCsv {
  /* A BOM survives every round trip through Excel and would otherwise become
     part of the first header, so the first column silently never matches an
     alias. Written as an escape rather than as the literal character: a bare
     BOM in source is invisible in every editor and diff, which is how it gets
     deleted by accident, and `no-irregular-whitespace` rejects it outright. */
  const records = splitRecords(text.replace(/^\uFEFF/, ""));

  const headerRecord = records.find((r) => r.some((f) => f.trim() !== ""));
  if (!headerRecord) return { headers: [], rows: [], malformed: 0, truncated: false };

  const headers = headerRecord.map(normalizeHeader);
  const body = records.slice(records.indexOf(headerRecord) + 1);

  const rows: CsvRow[] = [];
  let malformed = 0;
  let truncated = false;

  for (const record of body) {
    // A trailing newline produces one empty record; that is not malformed.
    if (record.every((f) => f.trim() === "")) continue;

    if (record.length !== headers.length) {
      malformed++;
      continue;
    }
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }

    const row: CsvRow = {};
    headers.forEach((h, i) => {
      row[h] = (record[i] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows, malformed, truncated };
}

/**
 * Which column means what.
 *
 * Spreadsheets in the wild call the same column `domain`, `website`, `url`,
 * `company domain`. Rather than make the user map columns by hand — a step
 * that turns a paste into a form — the importer accepts any of the spellings
 * below and *shows* which ones it recognised, so a column it silently ignored
 * is visible rather than discovered later as missing data.
 *
 * Order matters: the first alias present in the file wins, so `domain` beats
 * `website` when a file has both and they disagree.
 */
export const COLUMN_ALIASES = {
  name: ["company", "company name", "name", "account", "organisation", "organization"],
  domain: ["domain", "company domain", "website", "url", "site", "web"],
  industry: ["industry", "sector", "vertical", "category"],
  employeeCount: ["employees", "employee count", "headcount", "size", "staff"],
  country: ["country"],
  region: ["region", "location", "city", "state"],
  businessModel: ["business model", "model", "type"],
  description: ["description", "about", "summary", "notes"],
  firstName: ["first name", "firstname", "given name", "contact first name"],
  lastName: ["last name", "lastname", "surname", "family name", "contact last name"],
  fullName: ["contact", "contact name", "full name", "person"],
  title: ["title", "job title", "role", "position"],
  email: ["email", "email address", "e mail", "contact email", "work email"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
} as const;

export type ColumnKey = keyof typeof COLUMN_ALIASES;

/** Maps each known field to the header that supplies it, when one does. */
export function detectColumns(headers: string[]): Partial<Record<ColumnKey, string>> {
  const present = new Set(headers);
  const found: Partial<Record<ColumnKey, string>> = {};

  for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [
    ColumnKey,
    readonly string[],
  ][]) {
    const hit = aliases.find((a) => present.has(a));
    if (hit) found[key] = hit;
  }
  return found;
}

/** Reads one mapped field out of a row. */
export function field(
  row: CsvRow,
  columns: Partial<Record<ColumnKey, string>>,
  key: ColumnKey,
): string {
  const header = columns[key];
  return header ? (row[header] ?? "") : "";
}

/**
 * A headcount, or null.
 *
 * Null rather than 0 for anything unparseable — §78's rule again. `"1,200"`
 * and `"~500"` are both real spreadsheet values and both mean a number;
 * `"unknown"` means we have not looked, and storing 0 for it would assert a
 * company with no employees.
 */
export function parseEmployeeCount(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
}
