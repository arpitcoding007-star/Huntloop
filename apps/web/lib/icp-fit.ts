import { bandsToRange, type IcpCriteria, type IcpExclusions } from "@huntloop/db/icp";

/**
 * Why a company fits the profile — computed, not written. COMMAND.md §16.3-C.
 *
 * Each criterion the profile states is checked against what is on file about
 * the company, and lands in one of three states:
 *
 *   · match    — the company's value is one the profile asks for
 *   · miss     — the company's value is known and is not one of them
 *   · unknown  — nothing on file to check it against
 *
 * Unknown is never folded into match or miss. It is the list of things that,
 * once researched, would make the verdict firmer — which is why the page shows
 * it as a research to-do list.
 */

export type FitStatus = "match" | "miss" | "unknown";

export interface FitRow {
  criterion: "Industry" | "Company size" | "Region" | "Technology" | "Business model" | "Not a fit";
  wanted: string[];
  actual: string | null;
  status: FitStatus;
}

export interface FitCompany {
  industry: string | null;
  employeeCount: number | null;
  region: string | null;
  country: string | null;
  techStack: string[];
  businessModel: string | null;
  description: string | null;
  name: string;
}

const norm = (v: string) => v.trim().toLowerCase();
const overlaps = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
};

export function icpFit(
  company: FitCompany,
  criteria: Pick<IcpCriteria, "industries" | "segments" | "sizes" | "regions" | "technologies" | "businessModels">,
  exclusions: Pick<IcpExclusions, "exclusions">,
): FitRow[] {
  const rows: FitRow[] = [];

  const industries = [...(criteria.industries ?? []), ...(criteria.segments ?? [])];
  if (industries.length) {
    const actual = company.industry?.trim() || null;
    rows.push({
      criterion: "Industry",
      wanted: industries,
      actual,
      status: !actual ? "unknown" : industries.some((w) => overlaps(w, actual)) ? "match" : "miss",
    });
  }

  if (criteria.sizes?.length) {
    const range = bandsToRange(criteria.sizes);
    const n = company.employeeCount;
    rows.push({
      criterion: "Company size",
      wanted: criteria.sizes,
      actual: n === null ? null : `${n.toLocaleString()} employees`,
      status:
        n === null || !range
          ? "unknown"
          : (range.min === null || n >= range.min) && (range.max === null || n <= range.max)
            ? "match"
            : "miss",
    });
  }

  if (criteria.regions?.length) {
    const actual = company.region?.trim() || company.country?.trim() || null;
    const global = criteria.regions.some((r) => norm(r) === "global");
    rows.push({
      criterion: "Region",
      wanted: criteria.regions,
      actual,
      status: global
        ? "match"
        : !actual
          ? "unknown"
          : criteria.regions.some((w) => overlaps(w, actual) || (company.country ? overlaps(w, company.country) : false))
            ? "match"
            : "miss",
    });
  }

  if (criteria.technologies?.length) {
    const stack = company.techStack.filter(Boolean);
    const hits = criteria.technologies.filter((t) => stack.some((s) => overlaps(s, t)));
    rows.push({
      criterion: "Technology",
      wanted: criteria.technologies,
      actual: stack.length ? stack.slice(0, 6).join(", ") : null,
      // An empty stack is unknown, not a miss: absence of a detected tool is
      // not evidence they do not use it.
      status: hits.length ? "match" : stack.length ? "miss" : "unknown",
    });
  }

  if (criteria.businessModels?.length) {
    const actual = company.businessModel?.trim() || null;
    rows.push({
      criterion: "Business model",
      wanted: criteria.businessModels,
      actual,
      status: !actual ? "unknown" : criteria.businessModels.some((w) => overlaps(w, actual)) ? "match" : "miss",
    });
  }

  if (exclusions.exclusions?.length) {
    const haystack = [company.industry, company.description, company.name, company.businessModel]
      .filter((v): v is string => Boolean(v))
      .map(norm)
      .join(" | ");
    const hit = exclusions.exclusions.find((e) => norm(e) && haystack.includes(norm(e)));
    rows.push({
      criterion: "Not a fit",
      wanted: exclusions.exclusions,
      actual: hit ?? null,
      // Here "match" means it matched an exclusion — the bad case — so the
      // page renders it as a warning. Nothing matching is a clean pass.
      status: hit ? "miss" : "match",
    });
  }

  return rows;
}
