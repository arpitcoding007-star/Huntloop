import { describe, expect, it } from "vitest";
import { DAILY_BUDGET, nextQuestion, type QuestionState } from "./planner";
import { QUESTIONS, type QuestionContext } from "./catalog";

const now = new Date("2026-10-07T15:00:00Z");
const ctx = (over: Partial<QuestionContext> = {}): QuestionContext => ({
  memoryKeys: new Set(),
  workspaceKind: "company",
  hasProduct: true,
  hasIcp: true,
  ...over,
});
const state = (key: string, status: QuestionState["status"], over: Partial<QuestionState> = {}): QuestionState => ({
  key,
  status,
  snoozeUntil: null,
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("nextQuestion", () => {
  it("asks only what belongs to the screen", () => {
    expect(nextQuestion("inbox", ctx(), [], now)?.key).toBe("outreach.signoff");
    expect(nextQuestion("assistant", ctx(), [], now)?.key).toBe("assistant.format");
  });

  it("never asks again once answered or dismissed", () => {
    const states = [state("outreach.signoff", "answered"), state("outreach.length", "dismissed")];
    expect(nextQuestion("inbox", ctx(), states, now)).toBeNull();
  });

  it("waits out a snooze, then asks again", () => {
    const snoozed = [state("assistant.format", "snoozed", { snoozeUntil: "2026-10-10T00:00:00Z" })];
    expect(nextQuestion("assistant", ctx(), snoozed, now)).toBeNull();
    expect(nextQuestion("assistant", ctx(), snoozed, new Date("2026-10-11T00:00:00Z"))?.key).toBe("assistant.format");
  });

  it("does not ask what the person already stated or Huntloop learned", () => {
    expect(nextQuestion("inbox", ctx({ memoryKeys: new Set(["email.signoff"]) }), [], now)?.key).toBe("outreach.length");
  });

  it("asks what you sell only when nothing says so", () => {
    expect(nextQuestion("dashboard", ctx({ hasProduct: true }), [], now)?.key).toBe("context.focus");
    expect(nextQuestion("dashboard", ctx({ hasProduct: false }), [], now)?.key).toBe("context.offer");
  });

  it(`stops for the day after ${DAILY_BUDGET} questions were dealt with`, () => {
    const today = { updatedAt: "2026-10-07T09:00:00Z" };
    const handled = [
      state("context.offer", "answered", today),
      state("context.focus", "dismissed", today),
      state("research.focus", "snoozed", { ...today, snoozeUntil: "2026-10-14T00:00:00Z" }),
    ];
    expect(nextQuestion("assistant", ctx(), handled, now)).toBeNull();
  });

  it("does not count a question merely shown against the budget", () => {
    const shown = QUESTIONS.slice(0, 4).map((q) => state(q.key, "asked", { updatedAt: "2026-10-07T09:00:00Z" }));
    expect(nextQuestion("assistant", ctx(), shown, now)?.key).toBe("assistant.format");
  });

  it("turns every text answer into an instruction and every choice into one or nothing", () => {
    for (const q of QUESTIONS) {
      if (q.input.kind === "text") expect(q.writes.template?.("x")).toBeTruthy();
      else expect(q.input.choices.length).toBeGreaterThan(1);
    }
  });
});
