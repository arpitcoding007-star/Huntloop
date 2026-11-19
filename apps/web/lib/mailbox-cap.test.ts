import { describe, expect, it } from "vitest";
import { mailboxDailyCap } from "./mailbox-cap";

describe("mailboxDailyCap", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("is the limit for a warm mailbox", () => {
    expect(mailboxDailyCap({ daily_limit: 50 }, now)).toBe(50);
  });
  it("ramps a warming mailbox from 10", () => {
    expect(mailboxDailyCap({ daily_limit: 50, warmup_started_at: "2026-11-10T08:00:00Z" }, now)).toBe(10);
    expect(mailboxDailyCap({ daily_limit: 50, warmup_started_at: "2026-11-07T08:00:00Z" }, now)).toBe(25);
  });
  it("respects a warm-up target", () => {
    expect(mailboxDailyCap({ daily_limit: 50, warmup_target: 30 }, now)).toBe(30);
  });
});
