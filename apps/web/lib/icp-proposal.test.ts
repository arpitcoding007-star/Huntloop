import { describe, expect, it } from "vitest";
import { proposeTighterProfile, sizeBand, type ProposalCompany } from "./icp-proposal";

const company = (
  i: number,
  outcome: ProposalCompany["outcome"],
  fields: Partial<ProposalCompany> = {},
): ProposalCompany => ({
  id: `c${i}`,
  name: `Company ${i}`,
  industry: null,
  employeeCount: null,
  region: null,
  outcome,
  ...fields,
});

const empty = { industries: [], segments: [], sizes: [], regions: [], exclusions: [] };

describe("sizeBand", () => {
  it.each([
    [5, "1–10"],
    [50, "11–50"],
    [51, "51–200"],
    [1000, "201–1000"],
    [5001, "5000+"],
  ])("puts %i employees in %s", (n, band) => {
    expect(sizeBand(n)).toBe(band);
  });

  it("has no band for an unknown count", () => {
    expect(sizeBand(null)).toBeNull();
    expect(sizeBand(0)).toBeNull();
  });
});

describe("proposeTighterProfile", () => {
  it("says nothing below ten accepted companies", () => {
    const few = Array.from({ length: 9 }, (_, i) => company(i, "accepted", { industry: "Fintech" }));
    expect(proposeTighterProfile(few, empty)).toBeNull();
  });

  it("proposes what most accepted companies share and the profile does not say", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        company(i, "accepted", { industry: "Fintech", employeeCount: 120, region: "europe" }),
      ),
      ...Array.from({ length: 4 }, (_, i) => company(10 + i, "accepted", { industry: "Retail" })),
    ];
    const proposal = proposeTighterProfile(rows, { ...empty, regions: ["Europe"] })!;
    const values = proposal.items.map((i) => `${i.field}:${i.value}`);
    expect(values).toContain("industries:Fintech");
    expect(values).toContain("sizes:51–200");
    expect(values).toContain("industries:Retail");
    // Already on the profile, in another case.
    expect(values).not.toContain("regions:Europe");
    expect(proposal.basis).toEqual({ accepted: 10, declined: 0 });
  });

  it("does not repeat an industry already written as a segment", () => {
    const rows = Array.from({ length: 10 }, (_, i) => company(i, "accepted", { industry: "Fintech" }));
    const proposal = proposeTighterProfile(rows, { ...empty, segments: ["fintech"] })!;
    expect(proposal.items).toEqual([]);
  });

  it("suggests excluding an industry that is only ever declined", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => company(i, "accepted", { industry: "Fintech" })),
      ...Array.from({ length: 3 }, (_, i) => company(20 + i, "declined", { industry: "Gambling" })),
      ...Array.from({ length: 3 }, (_, i) => company(30 + i, "declined", { industry: "Fintech" })),
    ];
    const proposal = proposeTighterProfile(rows, empty)!;
    const exclusions = proposal.items.filter((i) => i.field === "exclusions");
    expect(exclusions).toEqual([
      expect.objectContaining({ value: "Gambling", declined: 3, accepted: 0 }),
    ]);
  });

  it("ignores regions a search cannot act on", () => {
    const rows = Array.from({ length: 10 }, (_, i) => company(i, "accepted", { region: "Bavaria" }));
    expect(proposeTighterProfile(rows, empty)!.items).toEqual([]);
  });
});
