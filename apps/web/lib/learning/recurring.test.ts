import { describe, expect, it } from "vitest";
import { recurringQuestions } from "./recurring";

describe("recurringQuestions", () => {
  it("offers back a question asked on two different days, in its latest wording", () => {
    const out = recurringQuestions([
      { content: "Which hot accounts has nobody touched?", at: "2026-10-01T09:00:00Z" },
      { content: "which hot accounts has nobody touched", at: "2026-10-05T09:00:00Z" },
      { content: "How did the last 30 days go?", at: "2026-10-05T10:00:00Z" },
    ]);
    expect(out).toEqual([{ text: "which hot accounts has nobody touched", days: 2 }]);
  });

  it("does not count the same day twice", () => {
    expect(
      recurringQuestions([
        { content: "Where am I losing deals?", at: "2026-10-01T09:00:00Z" },
        { content: "Where am I losing deals?", at: "2026-10-01T15:00:00Z" },
      ]),
    ).toEqual([]);
  });

  it("ignores one-word follow-ups like corrections", () => {
    expect(
      recurringQuestions([
        { content: "shorter", at: "2026-10-01T09:00:00Z" },
        { content: "shorter", at: "2026-10-02T09:00:00Z" },
      ]),
    ).toEqual([]);
  });
});
