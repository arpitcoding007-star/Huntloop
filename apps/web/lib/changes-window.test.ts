import { describe, expect, it } from "vitest";
import { resolveWindow, seenCookieName } from "./changes-window";

const NOW = new Date("2026-11-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

describe("resolveWindow", () => {
  it("uses the last visit when there is one", () => {
    expect(resolveWindow(daysAgo(2), NOW)).toEqual({ since: daysAgo(2), label: "since your last visit" });
  });

  it("falls back to a week with no cookie, or one it cannot read", () => {
    for (const cookie of [null, undefined, "", "yesterday-ish"]) {
      expect(resolveWindow(cookie, NOW)).toEqual({ since: daysAgo(7), label: "in the last 7 days" });
    }
  });

  it("treats a visit in the future as unreadable", () => {
    expect(resolveWindow(new Date(NOW.getTime() + 60_000).toISOString(), NOW).label).toBe("in the last 7 days");
  });

  it("caps a long absence at thirty days and says so", () => {
    expect(resolveWindow(daysAgo(90), NOW)).toEqual({ since: daysAgo(30), label: "in the last 30 days" });
  });
});

describe("seenCookieName", () => {
  it("is per workspace and keeps only slug characters", () => {
    expect(seenCookieName("acme-co")).toBe("hl_seen_acme-co");
    expect(seenCookieName("a;b=c")).toBe("hl_seen_abc");
  });
});
