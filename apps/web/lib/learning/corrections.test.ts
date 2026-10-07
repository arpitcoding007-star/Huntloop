import { describe, expect, it } from "vitest";
import { isCorrection } from "./corrections";

describe("isCorrection", () => {
  it.each([
    "shorter",
    "Make it shorter please",
    "too long",
    "as bullets",
    "use a table",
    "just the numbers",
    "From now on, lead with the number",
    "don't mention competitors",
    "less detail",
  ])("treats %j as a correction", (text) => {
    expect(isCorrection(text)).toBe(true);
  });

  it.each([
    "and what about Acme?",
    "which hot accounts have no next step?",
    "How did the last 30 days go?",
    "",
  ])("leaves %j alone", (text) => {
    expect(isCorrection(text)).toBe(false);
  });

  it("ignores long messages, which are new questions rather than corrections", () => {
    expect(isCorrection(`too long ${"x".repeat(400)}`)).toBe(false);
  });
});
