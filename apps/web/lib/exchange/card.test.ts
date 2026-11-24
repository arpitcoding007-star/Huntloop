import { describe, expect, it } from "vitest";
import { budgetBand, magnitudeBand, previewCard, region } from "./card";

/* The same examples as the 0062 migration tests, so the preview and the
   database agree on what a supplier sees. */
describe("card bands mirror 0062", () => {
  it("bands amounts by order of magnitude", () => {
    expect(magnitudeBand(200)).toBe("100–1K");
    expect(magnitudeBand(5)).toBe("1–10");
    expect(magnitudeBand(1000)).toBe("1K–10K");
    expect(budgetBand(6_000_000, "EUR")).toBe("EUR 1M–10M");
    expect(budgetBand(10, null)).toBeNull();
    expect(magnitudeBand(null)).toBeNull();
  });
  it("widens a country to its region", () => {
    expect(region("DE")).toBe("Europe");
    expect(region("IN")).toBe("South Asia");
    expect(region(null)).toBeNull();
  });
});

describe("previewCard", () => {
  const fields = {
    categoryPath: "Electronics › GPUs",
    quantity: 200,
    budgetMax: 6_000_000,
    currency: "EUR",
    country: "DE",
    timeline: "This quarter",
    summary: "Acme needs 200 cards, call Jan",
    mustHaves: "authorised partner",
  };
  it("shows suppliers nothing below level 2", () => {
    expect(previewCard(1, fields).visible).toBe(false);
    expect(previewCard(0, fields).rows).toEqual([]);
  });
  it("shows bands and none of the buyer's words at level 2", () => {
    const card = previewCard(2, fields);
    const text = JSON.stringify(card.rows);
    expect(text).toContain("100–1K");
    expect(text).toContain("EUR 1M–10M");
    expect(text).not.toContain("Jan");
    expect(text).not.toContain("6,000,000");
  });
  it("adds the buyer's own words at level 3", () => {
    expect(JSON.stringify(previewCard(3, fields).rows)).toContain("call Jan");
  });
});
