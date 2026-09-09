/**
 * How many companies actually match a profile.
 *
 * ── Why this is worth a paid call ────────────────────────────────────────
 *
 * It is the moment a user believes their ICP is real. Up to this point in
 * onboarding every screen has been Huntloop telling them things; this is the
 * first one where the world answers back, and "about 3,400 companies match"
 * turns an abstract form into a market.
 *
 * It is also the flow's only correction mechanism that works *before* money is
 * spent. A profile that matches twelve companies or four hundred thousand is
 * wrong in a way its author cannot see by reading it — and without this they
 * find out a week later, from an empty pipeline or a flooded one, by which
 * point nobody suspects the size band.
 *
 * ── Why it is not inferred ───────────────────────────────────────────────
 *
 * `0013` is emphatic and it is worth repeating at the call site: this number
 * is what a customer repeats to their board. `addressable_source` has exactly
 * two values, `provider` and `manual`, and there is deliberately no third for
 * "estimated" — because a market size a model produced is the most expensive
 * kind of fabrication this product could commit.
 *
 * So this returns the provider's own `total_entries` for the query, or null.
 * Null is a real answer and the screen says so in words; it never becomes a
 * number by any other route.
 *
 * ── Why it lives in `packages/jobs` ──────────────────────────────────────
 *
 * Because provider calls need the service-role client — the ledger in
 * `provider_calls` and the response cache are both written without a user
 * session — and `scope.ts` is the only runtime file in the repo permitted to
 * hold it (see `check-admin-imports.ts`). `apps/web` calls this with an
 * `orgId` it resolved from a *verified membership*, never from user input,
 * which is the same contract every job handler runs under.
 */
import {
  ProviderRefused,
  searchCompanies,
  adapterFor,
  type CompanySearchQuery,
} from "@huntloop/providers";
import type { DiscoveryFilters } from "@huntloop/db/discovery";
import { adminClient } from "./scope.ts";

export interface ReachEstimate {
  /** The provider's own count, or null when it did not say. Never inferred. */
  total: number | null;
  /** Which provider answered, for the screen to name. */
  provider: string | null;
  /** False when no provider is configured — a state, not a failure. */
  configured: boolean;
  /**
   * Why there is no number, in words fit to show a user.
   *
   * Present whenever `total` is null and the reason is something other than
   * "the provider does not report totals". A screen that showed a blank where
   * a number failed to arrive would read as "no companies match", which is the
   * single most damaging confusion available on this screen.
   */
  error: string | null;
}

/**
 * The smallest page a provider will sell us.
 *
 * One row rather than zero. Apollo bills organization search per *request*
 * rather than per record, so a one-row page costs the same as a zero-row one
 * would — and asking for zero is the kind of edge case a vendor's API handles
 * inconsistently. One row is unambiguously a valid search and the count comes
 * back on it.
 */
const COUNT_PAGE = 1;

export async function estimateReach(
  orgId: string,
  filters: DiscoveryFilters,
): Promise<ReachEstimate> {
  if (!adapterFor("company.search")) {
    return {
      total: null,
      provider: null,
      configured: false,
      error: null,
    };
  }

  /* A search with no filters is a search for "all companies". It costs money
     and returns the internet, and the number it produces — every company the
     provider has ever heard of — would be displayed next to the words "match
     your profile", which is false. */
  const empty =
    filters.keywords.length === 0 &&
    filters.industries.length === 0 &&
    filters.locations.length === 0 &&
    filters.technologies.length === 0 &&
    filters.revenueBands.length === 0 &&
    filters.employeeMin === null &&
    filters.employeeMax === null;

  if (empty) {
    return {
      total: null,
      provider: null,
      configured: true,
      error:
        "There's nothing here a search can act on yet. Add a segment, an " +
        "industry or a size band and we'll count what matches.",
    };
  }

  const query: CompanySearchQuery = {
    keywords: filters.keywords,
    industries: filters.industries,
    locations: filters.locations,
    employeeMin: filters.employeeMin,
    employeeMax: filters.employeeMax,
    revenueBands: filters.revenueBands,
    technologies: filters.technologies,
    excludeDomains: filters.excludeDomains,
    cursor: null,
    limit: COUNT_PAGE,
  };

  try {
    const result = await searchCompanies(
      {
        db: adminClient(),
        orgId,
        /* `org`, not `icp`. The ledger records what a call was *about*, and
           labelling this an ICP would file it under an id that is the
           organisation's — so a later reader joining `provider_calls` to
           `icps` would find nothing and conclude the row was orphaned. The
           profile is not saved at the point this runs (the counter is live
           while the user edits), so there is genuinely no ICP id to give. */
        entity: { type: "org", id: orgId },
      },
      query,
    );

    return {
      total: result.data.total,
      provider: result.meta.provider,
      configured: true,
      error:
        result.data.total === null
          ? "The provider didn't report a total for this search."
          : null,
    };
  } catch (error) {
    /* A refusal is a configuration state, not an outage, and the two need
       different words — "your key was rejected" is actionable and "we could
       not reach the provider" is not. Both are far better than a silent zero. */
    if (error instanceof ProviderRefused) {
      return {
        total: null,
        provider: error.meta.provider,
        configured: error.meta.refusal !== "no_provider",
        error:
          error.meta.refusal === "credentials_invalid"
            ? "The company-search credentials for this workspace were rejected. " +
              "The profile still saves; the count needs a working key."
            : "Couldn't count matching companies just now. Your profile still saves.",
      };
    }
    return {
      total: null,
      provider: null,
      configured: true,
      error: "Couldn't count matching companies just now. Your profile still saves.",
    };
  }
}
