import { describe, expect, it } from "vitest";
import { draftBlocked } from "./draft-blocked";

const live = { status: "active", campaigns: { status: "active" }, opportunities: [{ status: "contacted" }] };

describe("draftBlocked", () => {
  it("lets a live sequence through, and one that is only paused", () => {
    expect(draftBlocked(live)).toBeNull();
    expect(draftBlocked({ ...live, status: "parked" })).toBeNull();
    expect(draftBlocked({ ...live, campaigns: { status: "paused" } })).toBeNull();
  });
  it("names the parent that died", () => {
    expect(draftBlocked(null)).toMatch(/removed/);
    expect(draftBlocked({ ...live, status: "stopped" })).toMatch(/stopped/);
    expect(draftBlocked({ ...live, campaigns: { status: "archived" } })).toMatch(/archived/);
    expect(draftBlocked({ ...live, opportunities: { status: "lost" } })).toMatch(/lost/);
    expect(draftBlocked({ ...live, opportunities: { status: "contacted", deleted_at: "x" } })).toMatch(/removed/);
  });
});
