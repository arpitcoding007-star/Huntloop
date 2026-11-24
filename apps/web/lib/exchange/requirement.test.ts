import { describe, expect, it } from "vitest";
import {
  confirmedRequirement,
  needColumns,
  parseAmount,
  parseCurrency,
  parseTimeline,
} from "./requirement";

describe("parseAmount", () => {
  it("reads one plain number, with separators and multipliers", () => {
    expect(parseAmount("200")).toBe(200);
    expect(parseAmount("about 200 units")).toBe(200);
    expect(parseAmount("1,500")).toBe(1500);
    expect(parseAmount("2.5k")).toBe(2500);
    expect(parseAmount("EUR 6 million")).toBe(6_000_000);
  });
  it("leaves anything that is not one number unknown", () => {
    expect(parseAmount("a few hundred")).toBeNull();
    expect(parseAmount("100-200")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("parseCurrency", () => {
  it("reads an ISO code or a symbol", () => {
    expect(parseCurrency("EUR 6,000,000")).toBe("EUR");
    expect(parseCurrency("$200k")).toBe("USD");
    expect(parseCurrency("₹50 lakh")).toBe("INR");
  });
  it("is unknown when none or two are named", () => {
    expect(parseCurrency("6,000,000")).toBeNull();
    expect(parseCurrency("USD or EUR")).toBeNull();
  });
});

describe("parseTimeline", () => {
  it("maps clear wording to the enum", () => {
    expect(parseTimeline("ASAP")).toBe("this_month");
    expect(parseTimeline("within 2 months")).toBe("this_quarter");
    expect(parseTimeline("just exploring")).toBe("exploring");
    expect(parseTimeline("next year")).toBe("later");
    expect(parseTimeline("this_quarter")).toBe("this_quarter");
  });
  it("is unknown for wording it cannot place", () => {
    expect(parseTimeline("whenever the board signs off")).toBeNull();
  });
});

describe("needColumns", () => {
  const extras = { country: "DE", currency: null, budgetMax: null, visibility: 1 as const };

  it("takes the matching columns from the answers", () => {
    const cols = needColumns(
      {
        quantity: { value: "200", kind: "fact", source: "answer" },
        budget: { value: "EUR 6,000,000", kind: "fact", source: "answer" },
        deliver_to: { value: "Munich", kind: "fact", source: "answer" },
        timeline: { value: "this quarter", kind: "fact", source: "answer" },
      },
      extras,
    );
    expect(cols).toMatchObject({
      quantity: 200,
      budget_max: 6_000_000,
      currency: "EUR",
      country: "DE",
      deliver_to: "Munich",
      timeline: "this_quarter",
    });
  });

  it("drops a budget with no currency rather than guess one", () => {
    const cols = needColumns({ budget: { value: "6,000,000", kind: "fact", source: "answer" } }, extras);
    expect(cols.budget_max).toBeNull();
    expect(cols.currency).toBeNull();
  });

  it("lets the summary card's choices win", () => {
    const cols = needColumns(
      { budget: { value: "EUR 6,000,000", kind: "fact", source: "answer" } },
      { ...extras, currency: "USD", budgetMax: 5_000 },
    );
    expect(cols.currency).toBe("USD");
    expect(cols.budget_max).toBe(5_000);
  });

  it("refuses a malformed country", () => {
    expect(needColumns({}, { ...extras, country: "Germany" }).country).toBeNull();
  });
});

describe("confirmedRequirement", () => {
  const attrs = [
    { key: "item", label: "Item", type: "text", required: true },
    { key: "quantity", label: "Quantity", type: "number", required: true },
  ];
  it("makes submitted values facts and empty ones unknown, and drops unknown keys", () => {
    const req = confirmedRequirement(attrs, { item: " H100 ", quantity: "", injected: "x" });
    expect(req.item).toEqual({ value: "H100", kind: "fact", source: "answer" });
    expect(req.quantity).toEqual({ value: null, kind: "unknown", source: "skipped" });
    expect(req).not.toHaveProperty("injected");
  });
});
