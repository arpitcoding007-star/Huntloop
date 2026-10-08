import { describe, expect, it } from "vitest";
import { dailyGoal, oneLine, pickBuyer, type ContextPerson } from "./context";

const person = (over: Partial<ContextPerson> = {}): ContextPerson => ({
  first_name: "Ada",
  last_name: "Lovelace",
  title: "CTO",
  is_decision_maker: false,
  deleted_at: null,
  ...over,
});

describe("pickBuyer", () => {
  it("prefers a decision maker over whoever is first", () => {
    expect(
      pickBuyer([person({ first_name: "Sam", title: "Engineer" }), person({ is_decision_maker: true })]),
    ).toEqual({ name: "Ada Lovelace", title: "CTO" });
  });

  it("falls back to anyone named, and skips removed and nameless people", () => {
    expect(
      pickBuyer([
        person({ is_decision_maker: true, deleted_at: "2026-09-01" }),
        person({ first_name: null, last_name: " ", is_decision_maker: true }),
        person({ first_name: "Grace", last_name: null, title: " " }),
      ]),
    ).toEqual({ name: "Grace", title: null });
  });

  it("says nobody is on file rather than inventing someone", () => {
    expect(pickBuyer([])).toBeNull();
    expect(pickBuyer([person({ deleted_at: "2026-09-01" })])).toBeNull();
  });
});

describe("oneLine", () => {
  it("collapses whitespace and treats blank as absent", () => {
    expect(oneLine("  Raised a\n Series A ")).toBe("Raised a Series A");
    expect(oneLine("   ")).toBeNull();
    expect(oneLine(null)).toBeNull();
  });
});

describe("dailyGoal", () => {
  it("splits a weekly goal over five working days, rounding up", () => {
    expect(dailyGoal(12)).toBe(3);
    expect(dailyGoal(10)).toBe(2);
    expect(dailyGoal(1)).toBe(1);
  });

  it("has no daily goal without a weekly one", () => {
    expect(dailyGoal(null)).toBeNull();
    expect(dailyGoal(0)).toBeNull();
  });
});
