import { describe, expect, it } from "vitest";
import {
  detectColumns,
  field,
  normalizeHeader,
  parseCsv,
  parseEmployeeCount,
} from "./csv";
import { normalizeDomain } from "./domain";

/**
 * The importer's parsing, tested where it is pure.
 *
 * These are the cases that decide whether an import corrupts the entity
 * key. §59 makes `canonical_domain` the thing that keeps one company one row,
 * and every failure below would put something that is not a domain into that
 * column — quietly, on every row, with no error anywhere.
 */

describe("parseCsv", () => {
  it("keeps a quoted comma inside its field", () => {
    // The failure this exists to prevent: split(",") makes this three fields,
    // the domain column shifts by one, and every row imports a company whose
    // canonical domain is " Inc.".
    const { rows } = parseCsv('company,domain\n"Acme, Inc.",acme.com\n');
    expect(rows).toEqual([{ company: "Acme, Inc.", domain: "acme.com" }]);
  });

  it("reads a doubled quote as one literal quote", () => {
    const { rows } = parseCsv('company,domain\n"The ""Real"" Co",real.com\n');
    expect(rows[0].company).toBe('The "Real" Co');
  });

  it("keeps a newline inside a quoted field", () => {
    const { rows } = parseCsv('company,notes\nAcme,"line one\nline two"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBe("line one\nline two");
  });

  it("handles CRLF, which is what Excel writes", () => {
    const { rows } = parseCsv("company,domain\r\nAcme,acme.com\r\n");
    expect(rows).toEqual([{ company: "Acme", domain: "acme.com" }]);
  });

  it("strips the BOM rather than gluing it to the first header", () => {
    // Survives every round trip through Excel. Without this the first column
    // silently never matches an alias, so `name` is never detected.
    const { headers } = parseCsv("﻿company,domain\nAcme,acme.com\n");
    expect(headers[0]).toBe("company");
  });

  it("does not treat a trailing newline as an empty row", () => {
    const { rows, malformed } = parseCsv("company,domain\nAcme,acme.com\n");
    expect(rows).toHaveLength(1);
    expect(malformed).toBe(0);
  });

  it("counts a row with the wrong field count as malformed rather than importing it", () => {
    // Importing a short row would shift every value left of the gap into the
    // wrong column, which is worse than refusing it.
    const { rows, malformed } = parseCsv("company,domain\nAcme,acme.com\nBroken\n");
    expect(rows).toHaveLength(1);
    expect(malformed).toBe(1);
  });

  it("stops at maxRows and says that it did", () => {
    const csv = "company,domain\n" + "Acme,acme.com\n".repeat(5);
    const { rows, truncated } = parseCsv(csv, 3);
    expect(rows).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it("returns nothing for an empty file rather than throwing", () => {
    expect(parseCsv("")).toEqual({
      headers: [],
      rows: [],
      malformed: 0,
      truncated: false,
    });
  });

  it("does not hang on an unbalanced quote", () => {
    // The input a regex-based parser backtracks forever on.
    const { rows } = parseCsv('company,domain\n"Acme,acme.com\n');
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe("normalizeHeader", () => {
  it("folds punctuation and case so spreadsheet spellings converge", () => {
    expect(normalizeHeader("  First_Name ")).toBe("first name");
    expect(normalizeHeader("Company Domain")).toBe("company domain");
  });
});

describe("detectColumns", () => {
  it("finds the fields a real export uses", () => {
    const { headers } = parseCsv("Company Name,Website,Job Title,Work Email\na,b,c,d\n");
    const columns = detectColumns(headers);
    expect(columns.name).toBe("company name");
    expect(columns.domain).toBe("website");
    expect(columns.title).toBe("job title");
    expect(columns.email).toBe("work email");
  });

  it("prefers `domain` over `website` when a file has both", () => {
    // They disagree often — `website` is frequently a full marketing URL with
    // a path, and the alias order is what decides which one becomes the key.
    const { headers } = parseCsv("company,website,domain\na,b,c\n");
    expect(detectColumns(headers).domain).toBe("domain");
  });

  it("omits what it did not recognise, so the screen can say so", () => {
    const { headers } = parseCsv("company,mystery column\na,b\n");
    const columns = detectColumns(headers);
    expect(columns.name).toBe("company");
    expect(columns.industry).toBeUndefined();
  });
});

describe("field", () => {
  it("returns an empty string for a column the file does not have", () => {
    const { headers, rows } = parseCsv("company\nAcme\n");
    const columns = detectColumns(headers);
    expect(field(rows[0], columns, "industry")).toBe("");
  });
});

describe("parseEmployeeCount", () => {
  it("reads the numbers spreadsheets actually contain", () => {
    expect(parseEmployeeCount("1,200")).toBe(1200);
    expect(parseEmployeeCount("~500")).toBe(500);
  });

  it("is null for anything unparseable, never 0", () => {
    // §78: a 0 asserts a company with no employees, which is a finding
    // nobody made. Null is UNKNOWN and renders as UNKNOWN.
    expect(parseEmployeeCount("unknown")).toBeNull();
    expect(parseEmployeeCount("")).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("reduces the spellings of one company to one key", () => {
    // §59: this is what keeps the same company one row when it arrives from
    // a form and from a spreadsheet.
    for (const input of [
      "acme.com",
      "ACME.com",
      "https://acme.com",
      "http://www.acme.com/pricing?ref=x",
      " www.Acme.com. ",
      "https://acme.com:443/",
    ]) {
      expect(normalizeDomain(input), input).toBe("acme.com");
    }
  });

  it("keeps a subdomain, which is a different host", () => {
    expect(normalizeDomain("eu.acme.com")).toBe("eu.acme.com");
  });

  it("refuses what is not a public host", () => {
    for (const input of ["", "   ", "Acme Inc", "localhost", "not a domain"]) {
      expect(normalizeDomain(input), input).toBeNull();
    }
  });

  it("refuses a host longer than DNS allows", () => {
    expect(normalizeDomain(`${"a".repeat(250)}.com`)).toBeNull();
  });
});
