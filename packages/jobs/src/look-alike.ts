/**
 * "Companies like Stripe and Ramp."
 *
 * ── Why this is worth its own module ─────────────────────────────────────
 *
 * It is how people actually describe a market. Asked to define an ICP, almost
 * nobody produces "B2B SaaS, 51–200 employees, North America, using Segment";
 * they name three companies and say *those*. The named companies are also the
 * most reliable thing in the whole profile — a customer can be wrong about
 * their own segment wording and cannot be wrong about who their best accounts
 * are.
 *
 * `translateIcp` records `exampleCompanies` as unmapped, with the honest note
 * that "example companies describe the target rather than filter for it". That
 * is true of the *names*. It stops being true once the names are resolved into
 * attributes, which is what this does.
 *
 * ── How it works, and why not a vendor "similar companies" endpoint ──────
 *
 * Enrich each named company, then fold what comes back — industry, size,
 * technologies — into the search filters. Three reasons to build it this way
 * rather than calling a provider's own look-alike feature:
 *
 *   1. **It uses a capability the adapter already declares.**
 *      `company.enrich` is routed, cached and metered today. A similar-company
 *      endpoint would be a new capability, a new adapter method, and a new
 *      thing to reimplement for the second vendor.
 *   2. **The result is inspectable.** A vendor's look-alike score is a black
 *      box; "we added Financial Services and Kubernetes because that is what
 *      stripe.com and ramp.com have in common" is a sentence the customer can
 *      disagree with — which is the only kind of expansion this product should
 *      make to a search somebody is paying for.
 *   3. **It degrades to nothing.** With no enrichment provider the filters are
 *      returned unchanged and the caller says the examples were not used,
 *      rather than a search silently ignoring them.
 *
 * ── The rule that governs the merge ──────────────────────────────────────
 *
 * **Widen, never narrow.** An attribute found on an example company is added
 * to the filter set; nothing the user stated is ever removed or overridden. A
 * user who said "51–200" and named a 2,000-person company gets a range that
 * covers both, because the alternative is a look-alike feature that quietly
 * deletes the size band they typed.
 */
import { enrichCompany, ProviderRefused, adapterFor } from "@huntloop/providers";
import { canonicalizeDomain } from "@huntloop/db/identity";
import type { DiscoveryFilters } from "@huntloop/db/discovery";
import { adminClient } from "./scope.ts";

export interface LookAlikeResult {
  filters: DiscoveryFilters;
  /** Domains that were successfully read. */
  resolved: string[];
  /** What the examples contributed, in words fit for a screen. */
  added: string[];
  /** Why nothing was added, when nothing was. Null on success. */
  skipped: string | null;
}

/**
 * How many examples one expansion reads.
 *
 * Each is a metered enrichment call. Five is more than enough to find what a
 * set of accounts has in common — past that the attributes converge and the
 * marginal company costs a credit to confirm what the previous four said.
 */
const MAX_EXAMPLES = 5;

/**
 * How many attributes one example may contribute per field.
 *
 * A provider's `technology_names` can run to two hundred entries, and folding
 * all of them into a filter would produce a query matching everything that
 * uses Google Analytics. The cap keeps an expansion recognisable as an
 * expansion rather than turning the search into noise.
 */
const MAX_PER_FIELD = 4;

export async function expandWithLookAlikes(
  orgId: string,
  filters: DiscoveryFilters,
  exampleCompanies: string[],
): Promise<LookAlikeResult> {
  const base: LookAlikeResult = {
    filters,
    resolved: [],
    added: [],
    skipped: null,
  };

  if (exampleCompanies.length === 0) return base;

  if (!adapterFor("company.enrich")) {
    return {
      ...base,
      skipped:
        "No enrichment provider is connected, so the example companies " +
        "could not be read. They are still recorded on your profile.",
    };
  }

  /* Names that are not domains are dropped rather than guessed at. "Stripe"
     could be resolved to stripe.com by a lookup, and that lookup is exactly
     the kind of confident guess that puts the wrong company's attributes into
     somebody's search. The ICP screen asks for domains and says so. */
  const domains = exampleCompanies
    .map((value) => canonicalizeDomain(value))
    .filter((d): d is string => Boolean(d))
    .slice(0, MAX_EXAMPLES);

  if (domains.length === 0) {
    return {
      ...base,
      skipped:
        "None of the example companies is a domain we can look up. Enter them " +
        "as addresses — stripe.com rather than Stripe — and we can use them.",
    };
  }

  const industries = new Set<string>();
  const technologies = new Set<string>();
  const employeeCounts: number[] = [];
  const resolved: string[] = [];

  for (const domain of domains) {
    try {
      const result = await enrichCompany(
        { db: adminClient(), orgId, entity: { type: "org", id: orgId } },
        { domain, name: null, providerId: null },
      );

      const company = result.data;
      if (!company) continue;

      resolved.push(domain);

      if (company.industry) industries.add(company.industry);
      for (const tech of (company.technologies ?? []).slice(0, MAX_PER_FIELD)) {
        technologies.add(tech);
      }
      if (typeof company.employeeCount === "number" && company.employeeCount > 0) {
        employeeCounts.push(company.employeeCount);
      }
    } catch (error) {
      /* One unreadable example does not sink the expansion. A refusal is
         reported only if *every* example failed, because a partial result is
         still a better search than none. */
      if (!(error instanceof ProviderRefused)) throw error;
    }
  }

  if (resolved.length === 0) {
    return {
      ...base,
      skipped:
        "We couldn't read any of the example companies just now. Your profile " +
        "still works; the search simply isn't widened by them.",
    };
  }

  /* Only what is genuinely new. Reporting "added Financial Services" when the
     user already typed it would overstate what the examples contributed, on a
     line whose whole job is to let them judge whether the expansion was
     sensible. */
  const newIndustries = [...industries].filter(
    (i) => !filters.industries.some((existing) => same(existing, i)),
  );
  const newTechnologies = [...technologies].filter(
    (t) => !filters.technologies.some((existing) => same(existing, t)),
  );

  /* Widen, never narrow — see the header. `null` on either end means the user
     stated no bound there, and a bound invented from an example would be a
     narrowing dressed up as an expansion, so it is left null. */
  const min =
    filters.employeeMin === null || employeeCounts.length === 0
      ? filters.employeeMin
      : Math.min(filters.employeeMin, ...employeeCounts);
  const max =
    filters.employeeMax === null || employeeCounts.length === 0
      ? filters.employeeMax
      : Math.max(filters.employeeMax, ...employeeCounts);

  const added: string[] = [];
  if (newIndustries.length) added.push(`industries: ${newIndustries.join(", ")}`);
  if (newTechnologies.length) added.push(`technologies: ${newTechnologies.join(", ")}`);
  if (min !== filters.employeeMin || max !== filters.employeeMax) {
    added.push(`size range widened to ${min ?? "any"}–${max ?? "any"}`);
  }

  return {
    filters: {
      ...filters,
      industries: [...filters.industries, ...newIndustries],
      technologies: [...filters.technologies, ...newTechnologies],
      employeeMin: min,
      employeeMax: max,
      /* The examples themselves are excluded from the results. They are the
         customer's existing accounts or their stated dream list — either way,
         surfacing one back to them as a discovery is the product telling them
         about a company they just told it about. */
      excludeDomains: [...new Set([...filters.excludeDomains, ...resolved])],
    },
    resolved,
    added,
    skipped: added.length === 0 ? "The example companies matched what you had already described." : null,
  };
}

/** Case- and whitespace-insensitive, because a filter list is a set of labels. */
function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
