import { describe, expect, it } from "vitest";
import { MATCH_REASONS, mapCandidate } from "./merge-candidates.shared";

const company = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Co ${id}`,
  canonical_domain: `${id}.test`,
  country: "GB",
  deleted_at: null,
  ...extra,
});

describe("mapCandidate", () => {
  it("maps a pending pair with both sides", () => {
    const c = mapCandidate({ id: "m1", matched_on: "domain", confidence: "high", a: company("a"), b: [company("b")] });
    expect(c).toMatchObject({ id: "m1", matchedOn: "domain", a: { id: "a", domain: "a.test" }, b: { id: "b" } });
  });

  it("drops a pair where either side was removed since", () => {
    expect(mapCandidate({ id: "m2", matched_on: "domain", confidence: "high", a: company("a"), b: company("b", { deleted_at: "2026-10-01" }) })).toBeNull();
  });

  it("drops a pair with a side missing", () => {
    expect(mapCandidate({ id: "m3", matched_on: "domain", confidence: "high", a: company("a"), b: null })).toBeNull();
  });

  it("explains every match the resolver can produce", () => {
    for (const k of ["provider_id", "domain", "redirect", "normalized_name", "name_and_country"]) {
      expect(MATCH_REASONS[k]).toBeTruthy();
    }
  });
});
