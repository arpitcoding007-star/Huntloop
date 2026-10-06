import { describe, expect, it } from "vitest";
import { icpFit, type FitCompany } from "./icp-fit";

const company: FitCompany = {
  name: "Northwind",
  industry: "Fintech",
  employeeCount: 120,
  region: "Europe",
  country: "DE",
  techStack: ["Go", "Postgres"],
  businessModel: "SaaS",
  description: "Payments infrastructure for marketplaces.",
};

const none = {
  industries: null,
  segments: null,
  sizes: null,
  regions: null,
  technologies: null,
  businessModels: null,
};

describe("icpFit", () => {
  it("checks only what the profile states", () => {
    expect(icpFit(company, none, { exclusions: null })).toEqual([]);
  });

  it("matches, misses and says unknown", () => {
    const rows = icpFit(
      company,
      { ...none, industries: ["fintech"], sizes: ["1–10"], technologies: ["Kafka"] },
      { exclusions: null },
    );
    expect(rows.map((r) => [r.criterion, r.status])).toEqual([
      ["Industry", "match"],
      ["Company size", "miss"],
      ["Technology", "miss"],
    ]);
  });

  it("treats a missing value as unknown, never as a miss", () => {
    const rows = icpFit(
      { ...company, industry: null, employeeCount: null, techStack: [] },
      { ...none, industries: ["Fintech"], sizes: ["51–200"], technologies: ["Go"] },
      { exclusions: null },
    );
    expect(rows.every((r) => r.status === "unknown")).toBe(true);
  });

  it("includes an open-ended top band", () => {
    const rows = icpFit({ ...company, employeeCount: 9000 }, { ...none, sizes: ["5000+"] }, { exclusions: null });
    expect(rows[0]!.status).toBe("match");
  });

  it("flags a company matching an exclusion", () => {
    const rows = icpFit(company, none, { exclusions: ["marketplaces"] });
    expect(rows[0]).toMatchObject({ criterion: "Not a fit", status: "miss", actual: "marketplaces" });
  });

  it("lets a Global region match anywhere", () => {
    const rows = icpFit({ ...company, region: null, country: null }, { ...none, regions: ["Global"] }, { exclusions: null });
    expect(rows[0]!.status).toBe("match");
  });
});
