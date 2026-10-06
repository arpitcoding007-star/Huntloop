import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv-write";

describe("csv out", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Acme, "Inc"')).toBe('"Acme, ""Inc"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises cells that a spreadsheet would execute", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("leaves numbers, including negative ones, as numbers", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(0.25)).toBe("0.25");
    expect(csvCell(null)).toBe("");
  });

  it("writes a header and rows with CRLF line ends", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});
