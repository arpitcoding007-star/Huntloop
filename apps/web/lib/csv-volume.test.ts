import { describe, expect, it } from "vitest";
import { detectColumns, parseCsv } from "./csv";

/**
 * The CSV import at the size it allows (debt #20): 1,000 rows, the import's
 * cap, and the 2 MB the form accepts. The parse runs in the browser (preview)
 * and again in the Server Action, so a slow one costs twice.
 *
 * The database half (chunked `.in()` reads, `lib/in-chunks.ts`) is covered by
 * `in-chunks.test.ts`; timing it needs a real project.
 */
function bigCsv(rows: number, descriptionLength: number): string {
  const header = "Company,Domain,Industry,Employees,Country,Description,First name,Last name,Title,Email";
  const lines = [header];
  const filler = "x".repeat(descriptionLength);
  for (let i = 0; i < rows; i++) {
    lines.push(
      [
        `"Company ${i}, Inc."`,
        `company-${i}.example.com`,
        "Logistics",
        "51-200",
        "Germany",
        `"Line one ""quoted"" ${filler}"`,
        "Ana",
        `Ruiz${i}`,
        "VP Operations",
        `ana.ruiz${i}@company-${i}.example.com`,
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

describe("CSV import at volume", () => {
  it("parses 1,000 rows with every column, quickly and completely", () => {
    const text = bigCsv(1000, 200);
    const started = performance.now();
    const parsed = parseCsv(text, 1000);
    const ms = performance.now() - started;

    expect(parsed.rows).toHaveLength(1000);
    expect(parsed.truncated).toBe(false);
    expect(parsed.malformed).toBe(0);
    expect(parsed.rows[999]?.[Object.keys(parsed.rows[999]!)[0]!]).toBe("Company 999, Inc.");
    expect(detectColumns(parsed.headers).email).toBeDefined();
    // Generous: a loaded CI box, not a benchmark claim. Measured ~10–30 ms locally.
    expect(ms).toBeLessThan(1000);
  });

  it("a file at the 2 MB limit stops at the cap and says so", () => {
    const text = bigCsv(3500, 400);
    expect(text.length).toBeLessThan(2_000_000);
    const parsed = parseCsv(text, 1000);
    expect(parsed.rows).toHaveLength(1000);
    expect(parsed.truncated).toBe(true);
  });
});
