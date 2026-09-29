import { describe, expect, it } from "vitest";
import { translateIcp } from "@huntloop/db/discovery";
import { stepIcp } from "./icp-step";
import { SIZE_BANDS } from "./steps";

/**
 * The ICP screen sends size bands, never an explicit range. `translateIcp`
 * reads only the range, so a `stepIcp` that left it null dropped every band
 * from the reach count and listed them as "could not be read as a number of
 * employees" — for the exact strings the screen offers.
 */
describe("stepIcp", () => {
  it("turns the screen's size bands into an employee range", () => {
    const { criteria } = stepIcp({ sizes: ["11–50", "51–200"] });
    expect(criteria.employeeRange).toEqual({ min: 11, max: 200 });
  });

  it("parses every band the screen offers", () => {
    for (const band of SIZE_BANDS) {
      expect(stepIcp({ sizes: [band] }).criteria.employeeRange, band).not.toBeNull();
    }
  });

  it("does not report parsed bands as unmapped", () => {
    const translation = translateIcp(stepIcp({ segments: ["Fintech"], sizes: ["11–50"] }));
    expect(translation.unmapped.map((u) => u.field)).not.toContain("sizes");
  });

  it("keeps an explicit range over the bands", () => {
    const { criteria } = stepIcp({ sizes: ["11–50"], employeeRange: { min: 5, max: 9 } });
    expect(criteria.employeeRange).toEqual({ min: 5, max: 9 });
  });

  it("leaves the range unstated when no size was given", () => {
    expect(stepIcp({}).criteria.employeeRange).toBeNull();
  });
});
