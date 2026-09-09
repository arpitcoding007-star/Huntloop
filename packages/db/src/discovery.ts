/**
 * ICP → a provider-neutral search.
 *
 * ── Why this is not a model call ─────────────────────────────────────────
 *
 * `DSC-02`. The obvious design is to hand the ICP to a model and ask for a
 * search query, and it is wrong for three reasons that compound:
 *
 *   1. **It is not a judgement.** "Segments become keywords, sizes become an
 *      employee range, regions become locations" is a mapping. A mapping with
 *      a correct answer does not need a model, and architecture principle 3
 *      says so.
 *   2. **It would be non-deterministic.** The same ICP would produce a
 *      slightly different query each run, so a scheduled search would drift
 *      and its results could not be compared across weeks — which destroys
 *      `LRN-03`, whose entire method is comparing what a query found against
 *      what converted.
 *   3. **It would hide the lossiness.** A model asked to translate an
 *      un-translatable criterion produces something plausible. This function
 *      reports it as unmappable, which is the difference between a customer
 *      knowing their "uses Kubernetes" filter was dropped and a customer
 *      believing the results honour it.
 *
 * A model *does* have a role, and it is a different one: proposing keyword
 * expansions a human then accepts. The proposal is not the query.
 *
 * ── The one rule ────────────────────────────────────────────────────────
 *
 * **Every ICP field either maps or is reported.** Nothing is silently
 * dropped. `translateIcp` is total over `IcpCriteria`, and the test asserts
 * that by construction — a field added to the ICP without a case here shows
 * up as unmapped rather than as nothing.
 */
import type { Icp, IcpCriteria } from "./icp.ts";

/**
 * A search, in this system's terms rather than a vendor's.
 *
 * Deliberately the shape of a *question*, not of a request body. An adapter
 * turns this into whatever its vendor wants; storing a vendor's body in
 * `discovery_queries.filters` would make every saved search un-replayable the
 * day the provider changes, which is the coupling principle 12 forbids.
 */
export interface DiscoveryFilters {
  keywords: string[];
  industries: string[];
  locations: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  revenueBands: string[];
  technologies: string[];
  excludeDomains: string[];
}

export const EMPTY_FILTERS: DiscoveryFilters = {
  keywords: [],
  industries: [],
  locations: [],
  employeeMin: null,
  employeeMax: null,
  revenueBands: [],
  technologies: [],
  excludeDomains: [],
};

/**
 * A criterion no configured provider can express.
 *
 * Shown on the discovery screen beside the results. A customer whose "hiring
 * a VP of Data" trigger silently vanished would reasonably believe the
 * results honour it — and would then wonder why every company looks wrong.
 *
 * `handledElsewhere` is the important distinction. Most unmappable criteria
 * are not lost: triggers and pain points are applied by qualification, and
 * exclusions are applied to the result set. Reporting those as "dropped"
 * would be its own lie, and would push a user to weaken an ICP that is
 * working correctly.
 */
export interface UnmappedCriterion {
  field: keyof IcpCriteria | "exclusions";
  values: string[];
  reason: string;
  handledElsewhere: string | null;
}

export interface Translation {
  filters: DiscoveryFilters;
  unmapped: UnmappedCriterion[];
  /**
   * True when the filters say nothing a provider can act on.
   *
   * The guard in front of every paid search. A search with no filters is a
   * search for "all companies", which costs money and returns the internet.
   */
  empty: boolean;
}

/**
 * The whole mapping, in one function.
 *
 * Every branch is a case in the switch below, and the switch is exhaustive
 * over `IcpCriteria` — TypeScript proves it through the `keys` array, so a
 * field added to the ICP without a decision here fails the build rather than
 * disappearing.
 */
export function translateIcp(icp: Icp): Translation {
  const c = icp.criteria;
  const filters: DiscoveryFilters = { ...EMPTY_FILTERS };
  const unmapped: UnmappedCriterion[] = [];

  const note = (
    field: keyof IcpCriteria | "exclusions",
    values: string[] | null,
    reason: string,
    handledElsewhere: string | null,
  ) => {
    if (values && values.length) unmapped.push({ field, values, reason, handledElsewhere });
  };

  /* ── Direct maps ─────────────────────────────────────────────────────── */

  filters.industries = [...(c.industries ?? [])];
  filters.locations = [...(c.regions ?? [])];
  filters.technologies = [...(c.technologies ?? [])];
  filters.revenueBands = [...(c.revenueBands ?? [])];

  if (c.employeeRange) {
    filters.employeeMin = c.employeeRange.min;
    filters.employeeMax = c.employeeRange.max;
  }

  /* ── Keywords ────────────────────────────────────────────────────────
     Three fields feed the keyword bag, and they are the three that describe
     *what a company is* rather than what is happening to it. Segments are the
     most valuable — they are what a person actually typed to describe their
     market — and explicit keywords are second.

     `businessModels` joins them because "B2B SaaS" is a searchable phrase and
     there is no provider filter for it. That is lossy in the direction of
     returning too much, which the exclusions and qualification then narrow. */
  const keywords = new Set<string>();
  for (const value of c.segments ?? []) keywords.add(value);
  for (const value of c.keywords ?? []) keywords.add(value);
  for (const value of c.businessModels ?? []) keywords.add(value);
  filters.keywords = [...keywords];

  /* ── Exclusions, pushed down where possible ──────────────────────────
     Only domains. Every other exclusion is a substring match against fields
     the provider does not filter on, and asking it to is how a filter that
     silently matches nothing gets shipped. The rest are applied by
     `isExcluded` after the call — which costs the credits but produces a
     visible, explained rejection rather than a silent absence. */
  filters.excludeDomains = [...(icp.exclusions.domains ?? [])];

  /* ── What could not be expressed ─────────────────────────────────────
     Ordered by how surprising the omission would be to a user. */

  note(
    "sizes",
    /* Only when the bands produced nothing — otherwise the range above IS
       the mapping and reporting it as unmapped would be a false alarm. */
    c.employeeRange === null ? c.sizes : null,
    "None of these size bands could be read as a number of employees.",
    null,
  );

  note(
    "triggers",
    c.triggers,
    "Providers search for what a company is, not for what has just happened to it.",
    "Triggers are found by source scanning and applied during qualification.",
  );

  note(
    "buyingSignals",
    c.buyingSignals,
    "A buying signal is an event, and company search filters on attributes.",
    "Applied during qualification, against the evidence gathered by research.",
  );

  note(
    "painPoints",
    c.painPoints,
    "A pain point is not a field a provider holds.",
    "Applied during qualification, which looks for evidence of it.",
  );

  note(
    "useCases",
    c.useCases,
    "A use case is not a field a provider holds.",
    "Applied during qualification and when the outreach angle is chosen.",
  );

  note(
    "exampleCompanies",
    c.exampleCompanies,
    "Example companies describe the target rather than filter for it.",
    "Used as a sanity check on the results, not as a query.",
  );

  if (icp.exclusions.industries?.length || icp.exclusions.regions?.length || icp.exclusions.keywords?.length || icp.exclusions.exclusions?.length) {
    unmapped.push({
      field: "exclusions",
      values: [
        ...(icp.exclusions.industries ?? []),
        ...(icp.exclusions.regions ?? []),
        ...(icp.exclusions.keywords ?? []),
        ...(icp.exclusions.exclusions ?? []),
      ],
      reason: "The provider has no filter for these, so the results include them.",
      handledElsewhere:
        "Applied to every result before a company row is created. Excluded " +
        "companies are shown on the run with the rule that rejected them.",
    });
  }

  /* `notes` is prose for a human and is never a filter. Not reported as
     unmapped, because reporting it would train users to ignore the list. */

  return {
    filters,
    unmapped,
    empty:
      filters.keywords.length === 0 &&
      filters.industries.length === 0 &&
      filters.locations.length === 0 &&
      filters.technologies.length === 0 &&
      filters.employeeMin === null &&
      filters.employeeMax === null,
  };
}

/**
 * A stable fingerprint for a set of filters.
 *
 * `discovery_queries.filters_hash` is unique per org, so two users building
 * the same search get one row and one cache entry. That only works if the
 * same filters always hash the same, which means sorting — both the keys and
 * the values, because a filter list is a set and the order chips appear in a
 * UI is not part of the question.
 *
 * Not a cryptographic hash: `requestHash` in the providers package does that
 * job for the cache. This is a canonical *string*, hashed by the caller, and
 * it is separate so that this module stays free of `node:crypto` and can be
 * imported by the browser bundle.
 */
export function canonicalFilters(filters: DiscoveryFilters): string {
  const sorted = (values: string[]) =>
    [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))].sort();

  return JSON.stringify({
    keywords: sorted(filters.keywords),
    industries: sorted(filters.industries),
    locations: sorted(filters.locations),
    employeeMin: filters.employeeMin,
    employeeMax: filters.employeeMax,
    revenueBands: sorted(filters.revenueBands),
    technologies: sorted(filters.technologies),
    excludeDomains: sorted(filters.excludeDomains),
  });
}

/**
 * A sentence describing what will be searched for.
 *
 * Rendered on the discovery screen *before* the run, next to the estimated
 * count, so a person can see what they are about to pay for. "Software
 * companies in Europe with 11–200 people" is checkable in a way a JSON blob
 * is not, and the whole point of showing it is that somebody notices when it
 * is wrong.
 */
export function describeFilters(filters: DiscoveryFilters): string {
  const parts: string[] = [];

  if (filters.keywords.length) parts.push(`matching ${list(filters.keywords)}`);
  if (filters.industries.length) parts.push(`in ${list(filters.industries)}`);
  if (filters.technologies.length) parts.push(`using ${list(filters.technologies)}`);

  if (filters.employeeMin !== null || filters.employeeMax !== null) {
    if (filters.employeeMin !== null && filters.employeeMax !== null) {
      parts.push(`with ${filters.employeeMin}–${filters.employeeMax} people`);
    } else if (filters.employeeMin !== null) {
      parts.push(`with ${filters.employeeMin} or more people`);
    } else {
      parts.push(`with up to ${filters.employeeMax} people`);
    }
  }

  if (filters.locations.length) parts.push(`located in ${list(filters.locations)}`);
  if (filters.revenueBands.length) parts.push(`with revenue ${list(filters.revenueBands)}`);

  if (!parts.length) return "Every company the provider knows about — no filters are set.";

  const excluded = filters.excludeDomains.length
    ? `, excluding ${filters.excludeDomains.length} domain${filters.excludeDomains.length === 1 ? "" : "s"}`
    : "";

  return `Companies ${parts.join(", ")}${excluded}.`;
}

function list(values: string[]): string {
  const shown = values.slice(0, 3);
  const rest = values.length - shown.length;
  const joined =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(", ")} or ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} (+${rest} more)` : String(joined);
}
